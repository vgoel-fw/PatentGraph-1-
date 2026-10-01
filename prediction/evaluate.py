"""Out-of-time, litigation-group-held-out evaluation. Run: python -m prediction.evaluate
An empty or undersized dataset produces no claimed accuracy measurement.
"""
import json
from collections import defaultdict
from datetime import date, timedelta
from .cohorts import Context, eligible, estimate, load_outcomes

def evaluate(rows):
    groups=defaultdict(list)
    for row in rows:
        try:
            context=Context(issue=row['issue'],forum=row['forum'],stage=row['stage'])
            if eligible(row,context):groups[(row['litigation_id'],row['issue'],row['forum'],row['stage'])].append(row)
        except (ValueError,KeyError):continue
    errors=[]; eligible_count=0; conflicts=0
    for group in groups.values():
        if len({r['outcome'] for r in group})!=1:conflicts+=1;continue
        row=min(group,key=lambda r:r['decision_date']);eligible_count+=1
        cutoff=date.fromisoformat(row['decision_date'])-timedelta(days=1)
        context=Context(issue=row['issue'],forum=row['forum'],stage=row['stage'],as_of=cutoff)
        training=[r for r in rows if r.get('case_id')!=row['case_id']]
        result=estimate(training,context,exclude_litigation=row['litigation_id'])
        if result['historical_rate'] is not None:
            target=int(row['outcome']=='patentee_favorable')
            errors.append((result['historical_rate']-target)**2)
    return {'evaluated_litigations':len(errors),'eligible_litigations':eligible_count,
        'excluded_conflicting_groups':conflicts,
        'coverage':len(errors)/eligible_count if eligible_count else None,
        'brier_score':sum(errors)/len(errors) if errors else None,
        'status':'measured_on_supplied_labels' if errors else 'not_evaluable',
        'method':'Earlier decisions only; held-out litigation excluded; Brier score (lower is better).',
        'notice':'Regression tests do not measure predictive accuracy; representativeness of the labeled corpus requires separate assessment.'}

if __name__=='__main__':print(json.dumps(evaluate(load_outcomes()),indent=2))
