import unittest
from datetime import date
from unittest.mock import patch
from prediction.cohorts import Context, assess, estimate
from prediction.jurisdictions import geography
from legal.updates import matching_updates

BASE={'issue':'eligibility','forum':'district_court','stage':'summary_judgment','as_of':'2026-10-03'}
def record(i,court='cand',**changes):
    return {'case_id':str(i),'litigation_id':f'case-{i}','citation':f'Test {i}',
            'issue':'eligibility','forum':'district_court','stage':'summary_judgment',
            'court_id':court,'decision_date':'2020-05-01','review_status':'reviewed',
            'reviewer':'test fixture','data_kind':'real','source_url':'https://example.org/test',
            'source_quote':'Test fixture only.','outcome':'patentee_favorable' if i%2 else 'patentee_adverse',**changes}

class JurisdictionTests(unittest.TestCase):
    def test_court_never_silently_borrows_national_rate(self):
        rows=[record(i,'cand') for i in range(4)]+[record(i,'txed') for i in range(4,30)]
        result=assess(rows,{**BASE,'court_id':'cand'})
        self.assertIsNone(result['historical_rate'])
        self.assertEqual(result['litigation_count'],4)
        self.assertEqual(result['comparisons'][0]['litigation_count'],4)
        self.assertEqual(result['comparisons'][1]['historical_rate'],.5)
    def test_state_includes_only_supported_courts_in_state(self):
        rows=[record(1),record(2,'cacd'),record(3,'txed'),record(4,None)]
        result=estimate(rows,{**BASE,'jurisdiction':'US-CA'})
        self.assertEqual(result['litigation_count'],2)
    def test_invalid_geography_is_not_guessed(self):
        self.assertEqual(geography(record(1,jurisdiction='US-TX')),(None,None))
        self.assertEqual(geography(record(1,'unknown')),(None,None))
        self.assertEqual(geography(record(1,forum='ptab')),(None,None))
    def test_date_window_inclusive_and_future_excluded(self):
        rows=[record(1,decision_date='2021-01-01'),record(2,decision_date='2026-10-03'),record(3,decision_date='2026-10-04'),record(4,decision_date='2020-12-31')]
        result=estimate(rows,{**BASE,'date_from':'2021-01-01'})
        self.assertEqual(result['litigation_count'],2)
        self.assertEqual(result['date_range'],{'first':'2021-01-01','last':'2026-10-03'})
    def test_adverse_and_favorable_intervals_are_complements(self):
        result=estimate([record(i) for i in range(21)],BASE)
        self.assertAlmostEqual(result['adverse_rate']+result['historical_rate'],1)
        self.assertAlmostEqual(result['adverse_interval_95'][0],1-result['interval_95'][1])
    def test_bad_contexts_rejected(self):
        for extra in [{'court_id':'made-up'},{'court_id':'ptab'},{'court_id':'cand','jurisdiction':'US-TX'},{'jurisdiction':'EU'},{'date_from':'2027-01-01'}]:
            with self.subTest(extra=extra),self.assertRaises(ValueError):Context(**{**BASE,**extra})
    def test_coverage_identifies_missing_courts(self):
        result=assess([record(1),record(2,None)],BASE)
        self.assertEqual(result['coverage']['records_missing_valid_court'],1)
    def test_updates_do_not_change_rate(self):
        rows=[record(i) for i in range(20)]
        self.assertEqual(estimate(rows,BASE)['historical_rate'],assess(rows,BASE)['historical_rate'])
    def test_prosecution_guidance_not_used_as_district_court_law(self):
        result=matching_updates('eligibility','district_court',date(2026,10,3))
        self.assertFalse(any(i['id']=='smed-2026-09-29' for i in result['items']))
        self.assertTrue(any(i['id']=='smed-2026-09-29' for i in matching_updates('eligibility','prosecution',date(2026,10,3))['items']))
    def test_updates_obey_as_of_date(self):
        self.assertEqual(matching_updates(as_of=date(2020,1,1))['items'],[])
    def test_update_links_are_official(self):
        for item in matching_updates()['items']:
            self.assertTrue(item['source_url'].startswith(('https://www.uspto.gov/','https://www.cafc.uscourts.gov/')))
            self.assertTrue(item['pinpoint'])
