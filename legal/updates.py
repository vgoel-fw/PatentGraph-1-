import json
from copy import deepcopy
from datetime import date
from pathlib import Path

PATH=Path(__file__).resolve().parents[1]/'data/legal_updates.json'

def matching_updates(issue=None, forum=None, as_of=None, court_id=None):
    snapshot=json.loads(PATH.read_text())
    cutoff=as_of or date.today()
    if isinstance(cutoff,str):cutoff=date.fromisoformat(cutoff)
    items=[deepcopy(item) for item in snapshot['items']
        if date.fromisoformat(item['published_on'])<=cutoff
        and (not issue or issue in item['issues'])
        and (not forum or forum in item['forums'])
        and (not item['court_ids'] or court_id in item['court_ids'])]
    items.sort(key=lambda i:i['published_on'],reverse=True)
    return {'checked_on':snapshot['checked_on'],'coverage':snapshot['coverage'],
        'stale':(date.today()-date.fromisoformat(snapshot['checked_on'])).days>30,
        'items':items,
        'scoring_note':'Developments flag context for review; they do not automatically increase or decrease a numerical rate.'}
