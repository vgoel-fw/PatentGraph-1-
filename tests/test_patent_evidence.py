import csv
import hashlib
import json
import unittest
from unittest.mock import patch
from patent_data.corpus import ROOT, build_catalog, plain_text
from patent_data.library import catalog, search
from patent_data.import_publications import parse_publication
from scripts.extract_claims import extract_scope_ruling
from scripts.load_cases import get_holding_summary
from prediction.cohorts import Context, estimate, attach_assessment, wilson
from prediction.evaluate import evaluate
from api.main import patent_library, outcome_assessment, QueryBody, query
import asyncio

CONTEXT={'issue':'eligibility','forum':'federal_circuit','stage':'appeal','as_of':'2026-09-30'}
def row(i, **changes):
    return {'case_id':str(i),'litigation_id':f'litigation-{i}','citation':f'Test {i}',
        'decision_date':'2020-01-01','issue':'eligibility','forum':'federal_circuit','stage':'appeal',
        'outcome':'patentee_favorable' if i%2 else 'patentee_adverse', 'review_status':'reviewed',
        'data_kind':'real','reviewer':'TEST FIXTURE','source_quote':'TEST ONLY',
        'source_url':'https://example.org/test-fixture',**changes}

class PatentDataTests(unittest.TestCase):
    def test_all_source_offsets_and_digests(self):
        data=catalog();cases={c['id']:c for c in data['cases']}
        self.assertEqual(len(cases),52)
        self.assertGreaterEqual(len(data['mentions']),100)
        self.assertEqual(len({m['id'] for m in data['mentions']}),len(data['mentions']))
        for c in cases.values():
            self.assertEqual(hashlib.sha256(c['text'].encode()).hexdigest(),c['text_sha256'])
            self.assertTrue((ROOT/c['source_path']).is_file())
        for m in data['mentions']:
            c=cases[m['case_id']]
            self.assertEqual(c['text'][m['start']:m['end']],m['quote'])
            self.assertEqual(c['text'][m['number_start']:m['number_end']].replace(',',''),m['patent_number'])
            self.assertIsNone(m['scope_ruling'])
            self.assertIsNone(m['claim_number'])
    def test_rebuild_is_deterministic(self):self.assertEqual(catalog(),build_catalog())
    def test_parenthetical_patent_list_in_alice(self):
        numbers={m['patent_number'] for m in catalog()['mentions'] if m['case_id']=='2679558'}
        self.assertTrue({'5970479','6912510','7149720','7725375'}<=numbers)
    def test_html_normalization(self):
        self.assertEqual(plain_text('<p>A &amp; B</p>\\n<p>C</p>'),'A & B\n\nC')
    def test_keyword_is_not_a_ruling(self):
        self.assertEqual(extract_scope_ruling('The claim is not indefinite.'),'unreviewed')
        with (ROOT/'data/claims.csv').open() as f:
            for record in csv.DictReader(f):
                self.assertNotEqual(record['patent_number'],'UNKNOWN')
                self.assertEqual(record['scope_ruling'],'unreviewed')
    def test_nonportable_source_path_fixed(self):
        text=get_holding_summary({'case_id':'2679558','full_text_path':'C:\\missing\\file'})
        self.assertTrue(text);self.assertNotIn('<p>',text)
    def test_library_search_and_publications(self):
        result=search('5,970,479');self.assertEqual(result['total'],1)
        p=result['results'][0];self.assertEqual(p['publication']['publication_number'],'US5970479A')
        self.assertTrue(p['references'][0]['quote'])
        self.assertEqual(search('nosuchpatentxyz')['total'],0)
        self.assertTrue(search('Alice')['total']>=4)
    def test_import_rejects_error_pages(self):
        with self.assertRaises(ValueError):parse_publication('US5970479A','<html>Access denied</html>')
        with self.assertRaises(ValueError):parse_publication('../secret','')
    def test_publications_have_sources_and_no_legal_status(self):
        for p in json.loads((ROOT/'data/patent_publications.json').read_text()):
            self.assertTrue(p['source_url'].startswith('https://patents.google.com/patent/US'))
            self.assertEqual(len(p['response_sha256']),64)
            self.assertNotIn('legal_status',p)
            self.assertNotIn('current_assignee',p)

class CohortTests(unittest.TestCase):
    def test_no_labels_no_probability(self):
        self.assertIsNone(estimate([],CONTEXT)['historical_rate'])
    def test_small_sample_abstention(self):
        result=estimate([row(i) for i in range(19)],CONTEXT)
        self.assertEqual(result['status'],'insufficient_data')
        self.assertIsNone(result['interval_95'])
    def test_known_rate_and_interval(self):
        result=estimate([row(i) for i in range(20)],CONTEXT)
        self.assertEqual(result['historical_rate'],.5)
        self.assertAlmostEqual(result['interval_95'][0],.299298,places=5)
        self.assertIsNone(result['litigation_risk_score'])
    def test_duplicates_count_once(self):
        self.assertEqual(estimate([row(1)]*40,CONTEXT)['litigation_count'],1)
    def test_conflicts_excluded(self):
        result=estimate([row(1),row(2,litigation_id='litigation-1')],CONTEXT)
        self.assertEqual(result['litigation_count'],0)
        self.assertEqual(result['excluded_conflicting_litigations'],1)
    def test_ambiguous_case_identity_excluded(self):
        result=estimate([row(1),row(1,litigation_id='another')],CONTEXT)
        self.assertEqual(result['litigation_count'],0)
    def test_strict_matching_and_review_gates(self):
        changes=[{'issue':'obviousness'},{'forum':'ptab'},{'stage':'trial'},
            {'review_status':'unreviewed'},{'data_kind':'synthetic'},
            {'source_quote':''},{'source_url':''},{'reviewer':''},{'decision_date':'2030-01-01'},
            {'decision_date':'unknown'},{'outcome':'mixed'},{'outcome':'affirmed'}]
        self.assertEqual(estimate([row(i,**c) for i,c in enumerate(changes)],CONTEXT)['litigation_count'],0)
    def test_impossible_posture_rejected(self):
        with self.assertRaises(ValueError):Context(issue='eligibility',forum='ptab',stage='trial')
    def test_extreme_intervals_are_not_certainty(self):
        low,high=wilson(0,20);self.assertEqual(low,0);self.assertGreater(high,.1)
        low,high=wilson(20,20);self.assertLess(low,.9);self.assertAlmostEqual(high,1)
    def test_generated_score_stripped_without_mutating_input(self):
        original={'litigation_risk_score':9};result=attach_assessment(original)
        self.assertIsNone(result['litigation_risk_score']);self.assertEqual(original['litigation_risk_score'],9)
    def test_backtest_never_trains_on_future_or_held_out_litigation(self):
        rows=[row(i) for i in range(20)]+[row(21,decision_date='2021-01-01')]
        result=evaluate(rows)
        self.assertEqual(result['evaluated_litigations'],1)
        self.assertEqual(result['brier_score'],.25)
        self.assertEqual(evaluate([row(i) for i in range(50)])['evaluated_litigations'],0)
    def test_empty_evaluation_does_not_claim_accuracy(self):
        self.assertIsNone(evaluate([])['brier_score'])

class ApiEvidenceTests(unittest.TestCase):
    def test_library_is_available_without_external_services(self):
        self.assertEqual(patent_library('5,970,479',10)['total'],1)
    def test_assessment_returns_insufficient_reviewed_data(self):
        self.assertEqual(outcome_assessment(Context(**CONTEXT))['status'],'insufficient_data')
    def test_cached_memo_cannot_bypass_score_gate(self):
        with patch('api.main._load_demo_cache',return_value={'eligibility':{'litigation_risk_score':10}}):
            result=asyncio.run(query(QueryBody(question='eligibility',demo=True)))
        self.assertIsNone(result['litigation_risk_score'])
        self.assertTrue(result['_demo_mode'])
