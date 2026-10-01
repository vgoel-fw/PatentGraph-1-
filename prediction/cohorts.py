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
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Context(BaseModel):
    model_config=ConfigDict(extra='forbid')
    issue: Literal['eligibility','anticipation','obviousness','indefiniteness','infringement']
    forum: Literal['district_court','federal_circuit','ptab','supreme_court']
    stage: Literal['pleadings','summary_judgment','trial','appeal','final_written_decision']
    as_of: date = Field(default_factory=date.today)

    @model_validator(mode='after')
    def valid_posture(self):
        stages={'district_court':{'pleadings','summary_judgment','trial'},
                'federal_circuit':{'appeal'},'supreme_court':{'appeal'},
                'ptab':{'final_written_decision'}}
        if self.stage not in stages[self.forum]:
            raise ValueError('Select a procedural stage applicable to this forum.')
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
        'litigation_risk_score':None,
        'method':'Distinct litigation groups, exact issue/forum/stage match, 95% Wilson interval',
        'reason':('Historical frequency, not a validated prediction for this matter.' if sufficient else
                  f'Need {MIN_CASES} distinct reviewed litigation outcomes in this cohort; found {n}.'),
        'limitations':['The available cases may not represent all disputes.',
            'The interval reflects sampling uncertainty, not selection bias or changes in law.',
            'Case facts, claim language, technology, and later treatment require attorney analysis.'],
        'cases':[{k:r.get(k) for k in ('case_id','litigation_id','citation','decision_date','outcome','source_url','source_quote')} for r in selected]}

def attach_assessment(memo, context=None):
    # Strip legacy/generated scores in both cached and live responses.
    memo=dict(memo)
    memo['litigation_risk_score']=None
    memo['litigation_risk_rationale']='A model-generated number is not a calibrated litigation probability.'
    memo['assessment']=estimate(load_outcomes(),context) if context else {
        'status':'context_required','historical_rate':None,'interval_95':None,
        'reason':'Select an issue, forum, and procedural stage to define the comparison cohort.'}
    return memo
