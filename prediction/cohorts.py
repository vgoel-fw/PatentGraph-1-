"""Case-grouped historical rates with strict cohort matching and abstention.
The target is a patentee-favorable substantive determination on the selected issue,
not settlement, appeal affirmance, damages, or an overall probability of winning.
"""
import json
from collections import defaultdict
from datetime import date
from math import sqrt
from pathlib import Path
from typing import Literal
from .jurisdictions import COURTS, geography
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Context(BaseModel):
    model_config=ConfigDict(extra='forbid')
    issue: Literal['eligibility','anticipation','obviousness','indefiniteness','infringement']
    forum: Literal['district_court','federal_circuit','ptab','supreme_court']
    stage: Literal['pleadings','summary_judgment','trial','appeal','final_written_decision']
    as_of: date = Field(default_factory=date.today)
    date_from: date | None = None
    court_id: str | None = None
    jurisdiction: str | None = None

    @model_validator(mode='after')
    def valid_posture(self):
        stages={'district_court':{'pleadings','summary_judgment','trial'},
                'federal_circuit':{'appeal'},'supreme_court':{'appeal'},
                'ptab':{'final_written_decision'}}
        if self.stage not in stages[self.forum]:
            raise ValueError('Select a procedural stage applicable to this forum.')
        if self.date_from and self.date_from > self.as_of:
            raise ValueError('Start date must not be after the as-of date.')
        if self.jurisdiction is not None and self.jurisdiction not in {v[1] for v in COURTS.values()}:
            raise ValueError('Select a supported US jurisdiction.')
        if self.forum != 'district_court' and self.jurisdiction not in (None,'US'):
            raise ValueError('A national forum cannot be limited to a state jurisdiction.')
        if self.court_id:
            if self.court_id not in COURTS or COURTS[self.court_id][2] != self.forum:
                raise ValueError('Court does not match the selected forum.')
            if self.jurisdiction not in (None,COURTS[self.court_id][1]):
                raise ValueError('Court does not match the selected jurisdiction.')
        return self

MIN_CASES=20
TARGET='Patentee-favorable substantive determination on the selected issue'

def load_outcomes():
    path=Path(__file__).resolve().parents[1]/'data/reviewed_outcomes.json'
    return json.loads(path.read_text())['records']

def eligible(row, context):
    try:
        return (row.get('review_status')=='reviewed' and row.get('data_kind')=='real'
            and row.get('outcome') in {'patentee_favorable','patentee_adverse'}
            and all(row.get(k)==getattr(context,k) for k in ('issue','forum','stage'))
            and date.fromisoformat(row['decision_date'])<=context.as_of
            and (context.date_from is None or date.fromisoformat(row['decision_date'])>=context.date_from)
            and (context.court_id is None or geography(row)[0]==context.court_id)
            and (context.jurisdiction in (None,'US') or geography(row)[1]==context.jurisdiction)
            and bool(row.get('litigation_id')) and bool(row.get('case_id'))
            and bool(row.get('source_quote','').strip())
            and str(row.get('source_url','')).startswith('https://')
            and bool(row.get('reviewer')))
    except (ValueError,KeyError,TypeError): return False

def wilson(successes,total):
    z=1.959963984540054
    p=successes/total; den=1+z*z/total
    center=(p+z*z/(2*total))/den
    delta=z*sqrt(p*(1-p)/total+z*z/(4*total*total))/den
    return [max(0,center-delta),min(1,center+delta)]

def estimate(rows, context, exclude_litigation=None):
    if not isinstance(context,Context):context=Context.model_validate(context)
    groups=defaultdict(list)
    aliases=defaultdict(set)
    for row in rows:
        if eligible(row,context): aliases[row['case_id']].add(row['litigation_id'])
    ambiguous={case_id for case_id,ids in aliases.items() if len(ids)>1}
    for row in rows:
        if eligible(row,context) and row['litigation_id']!=exclude_litigation and row['case_id'] not in ambiguous:
            groups[row['litigation_id']].append(row)
    selected=[]; conflicts=0
    for group in groups.values():
        # Duplicate decisions never increase n; mixed labels are not forced into a binary result.
        if len({r['outcome'] for r in group})>1:
            conflicts+=1;continue
        selected.append(max(group,key=lambda r:(r['decision_date'],r['case_id'])))
    selected.sort(key=lambda r:(r['decision_date'],r['case_id']),reverse=True)
    n=len(selected); wins=sum(r['outcome']=='patentee_favorable' for r in selected)
    sufficient=n>=MIN_CASES
    return {'status':'historical_cohort' if sufficient else 'insufficient_data',
        'target':TARGET,'context':context.model_dump(mode='json'),
        'litigation_count':n,'favorable_count':wins,'adverse_count':n-wins,
        'minimum_cases':MIN_CASES,'excluded_ambiguous_case_ids':len(ambiguous),'excluded_conflicting_litigations':conflicts,
        'historical_rate':wins/n if sufficient else None,
        'interval_95':wilson(wins,n) if sufficient else None,
        'adverse_rate':(n-wins)/n if sufficient else None,
        'adverse_interval_95':wilson(n-wins,n) if sufficient else None,
        'date_range':{'first':min((r['decision_date'] for r in selected),default=None),
                      'last':max((r['decision_date'] for r in selected),default=None)},
        'litigation_risk_score':None,
        'method':'Distinct litigation groups, exact issue/forum/stage match, 95% Wilson interval',
        'reason':('Historical frequency, not a validated prediction for this matter.' if sufficient else
                  f'Need {MIN_CASES} distinct reviewed litigation outcomes in this cohort; found {n}.'),
        'limitations':['The available cases may not represent all disputes.',
            'The interval reflects sampling uncertainty, not selection bias or changes in law.',
            'Case facts, claim language, technology, and later treatment require attorney analysis.'],
        'cases':[{k:r.get(k) for k in ('case_id','litigation_id','citation','decision_date','outcome','source_url','source_quote','court_id','jurisdiction')} for r in selected]}

def attach_assessment(memo, context=None):
    # Strip legacy/generated scores in both cached and live responses.
    memo=dict(memo)
    memo['litigation_risk_score']=None
    memo['litigation_risk_rationale']='A model-generated number is not a calibrated litigation probability.'
    memo['assessment']=assess(load_outcomes(),context) if context else {
        'status':'context_required','historical_rate':None,'interval_95':None,
        'reason':'Select an issue, forum, and procedural stage to define the comparison cohort.'}
    return memo


def assess(rows, context):
    """Show the requested cohort and explicit broader comparisons; never substitute a broader rate."""
    if not isinstance(context,Context):context=Context.model_validate(context)
    result=estimate(rows,context)
    result['comparisons']=[]
    state=context.jurisdiction or (COURTS[context.court_id][1] if context.court_id else None)
    if context.court_id and state and state!='US':
        broader=context.model_copy(update={'court_id':None,'jurisdiction':state})
        result['comparisons'].append({'label':f'{state} courts',**estimate(rows,broader)})
    if context.court_id or context.jurisdiction not in (None,'US'):
        broader=context.model_copy(update={'court_id':None,'jurisdiction':None})
        result['comparisons'].append({'label':'All US courts in this forum',**estimate(rows,broader)})
    national=context.model_copy(update={'court_id':None,'jurisdiction':None})
    same_forum=[r for r in rows if eligible(r,national)]
    result['coverage']={'reviewed_records_in_forum':len(same_forum),
        'records_missing_valid_court':sum(geography(r)[0] is None for r in same_forum),
        'note':'Broader rates are descriptive comparisons, not replacements for the selected court.'}
    from legal.updates import matching_updates
    result['legal_updates']=matching_updates(context.issue,context.forum,context.as_of,context.court_id)
    for update in result['legal_updates']['items']:
        update['cohort_cases_before_update']=sum(r['decision_date']<update['published_on'] for r in result['cases'])
    return result
