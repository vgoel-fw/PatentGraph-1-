"""Refresh a small, explicit sample from public patent publication metadata.
Usage: python -m patent_data.import_publications US5970479A US7149720B2
No legal-status or current-ownership inference is made from this service.
"""
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
import requests
from .corpus import ROOT

class Metadata(HTMLParser):
    def __init__(self):
        super().__init__(); self.values={}
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='meta' and a.get('name'):
            self.values.setdefault((a['name'],a.get('scheme','')),[]).append(' '.join(a.get('content','').split()))

def parse_publication(publication, html):
    if not re.fullmatch(r'US\d{6,11}[AB]\d?',publication):
        raise ValueError('Provide a US publication number including its kind code.')
    parser=Metadata(); parser.feed(html)
    values=parser.values
    def one(name,scheme=''):return next(iter(values.get((name,scheme),[])),None)
    if not one('DC.title') or not one('DC.date','issue'):
        raise ValueError('Publication metadata missing; refusing to import an error page.')
    return {'publication_number':publication,'patent_number':re.search(r'\d+',publication).group(),
        'title':one('DC.title'),'abstract':one('DC.description'),
        'filing_date':one('DC.date','dateSubmitted'),'publication_date':one('DC.date','issue'),
        'inventors':values.get(('DC.contributor','inventor'),[]),
        'publication_assignees':values.get(('DC.contributor','assignee'),[]),
        'source_url':f'https://patents.google.com/patent/{publication}/en',
        'pdf_url':one('citation_pdf_url'), 'retrieved_at':datetime.now(timezone.utc).isoformat(),
        'response_sha256':hashlib.sha256(html.encode()).hexdigest(),
        'review_status':'unreviewed','notice':'Publication metadata; verify current ownership and legal status separately.'}

def main(publications):
    destination=ROOT/'data/patent_publications.json'
    existing=json.loads(destination.read_text()) if destination.exists() else []
    by_id={p['publication_number']:p for p in existing}
    for publication in publications:
        if not re.fullmatch(r'US\d{6,11}[AB]\d?',publication):raise ValueError('Invalid publication number')
        response=requests.get(f'https://patents.google.com/patent/{publication}/en',timeout=30)
        response.raise_for_status()
        by_id[publication]=parse_publication(publication,response.text)
    destination.write_text(json.dumps(sorted(by_id.values(),key=lambda p:p['publication_number']),ensure_ascii=False,indent=2)+'\n')
    print(f'{len(by_id)} patent publications stored')

if __name__=='__main__': main(sys.argv[1:])
