"""Search the curated local patent evidence without a database or API key."""
import json
from functools import lru_cache
from .corpus import ROOT

@lru_cache(maxsize=1)
def catalog():
    return json.loads((ROOT/'data/patent_catalog.json').read_text())

@lru_cache(maxsize=1)
def publications():
    return json.loads((ROOT/'data/patent_publications.json').read_text())

def search(query='',limit=30):
    query=query.strip().casefold()
    if len(query)>200: raise ValueError('Search must be 200 characters or fewer.')
    if type(limit) is not int or not 1<=limit<=100: raise ValueError('Limit must be 1–100.')
    data=catalog(); cases={c['id']:c for c in data['cases']}
    details={p['patent_number']:p for p in publications()}
    groups={}
    for m in data['mentions']:
        p=groups.setdefault(m['patent_number'],{'patent_number':m['patent_number'],
            'publication':details.get(m['patent_number']),'references':[]})
        c=cases[m['case_id']]
        p['references'].append({**m,'case_name':c['name'],'citation':c['citation'],
            'court':c['court'],'date':c['date']})
    rows=[]
    for p in groups.values():
        search_text=' '.join([p['patent_number'],(p['publication'] or {}).get('title','')]+[
            r['case_name']+' '+r['citation'] for r in p['references']]).casefold()
        if not query or query in search_text or query.replace(',','')==p['patent_number']: rows.append(p)
    rows.sort(key=lambda p:(-len({r['case_id'] for r in p['references']}),p['patent_number']))
    return {'results':rows[:limit],'total':len(rows),'limit':limit,'opinion_count':len(cases),
        'patent_count':len(groups),'mention_count':len(data['mentions']),
        'publication_count':len(details),'notice':data['notice']}
