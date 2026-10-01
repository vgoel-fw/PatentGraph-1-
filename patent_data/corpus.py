"""Deterministic opinion normalization and patent mentions, not claim rulings."""
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATENT = re.compile(r"(?:(?:U\.?\s*S\.?|United States)\s*Patents?\s*(?:Nos?\.?\s*)?|Patent\s+Nos?\.?\s*)(\d{1,2},\d{3},\d{3})(?P<more>(?:\s*\([^)]{0,80}\))?(?:\s*[,;]\s*\d{1,2},\d{3},\d{3}|\s*(?:,?\s*and)\s*\d{1,2},\d{3},\d{3})*)", re.I)

class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)
    def handle_starttag(self, tag, attrs):
        if tag in {'p','div','br','li','summary','details'}: self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in {'p','div','li','summary','details'}: self.parts.append('\n')

def plain_text(raw):
    parser = TextParser()
    # Some stored responses use literal backslash-n separators.
    parser.feed(raw.replace('\\n', '\n'))
    return re.sub(r'\n{3,}', '\n\n', ''.join(parser.parts)).strip()

def build_catalog(root=ROOT):
    cases, mentions = [], []
    for path in sorted((root/'data/raw/cases').glob('*.json')):
        source = json.loads(path.read_text())
        case_id = str(source.get('id') or source.get('case_id') or path.stem)
        text = plain_text(source.get('full_text') or source.get('text') or '')
        case = {'id':case_id,'name':source.get('case_name',''),
                'citation':source.get('citation_str') or source.get('citation',''),
                'court':source.get('court',''),'date':source.get('date_decided',''),
                'source_path':str(path.relative_to(root)), 'text':text,
                'text_sha256':hashlib.sha256(text.encode()).hexdigest(),
                'provenance':'Existing repository Midpage opinion snapshot',
                'review_status':'unreviewed','outcome':None}
        cases.append(case)
        for match in PATENT.finditer(text):
            for number in re.finditer(r'\d{1,2},\d{3},\d{3}', match.group()):
                start,end=match.start()+number.start(),match.start()+number.end()
                lo,hi=max(0,start-160),min(len(text),end+240)
                digits=number.group().replace(',','')
                mentions.append({'id':f'{case_id}:{start}:{digits}','case_id':case_id,
                    'patent_number':digits,'quote':text[lo:hi],'start':lo,'end':hi,
                    'number_start':start,'number_end':end,'review_status':'unreviewed',
                    'relationship':'mentioned_in','claim_number':None,'scope_ruling':None,
                    'source_path':case['source_path'],'text_sha256':case['text_sha256']})
    return {'schema_version':1,'cases':cases,'mentions':mentions,
        'notice':'Patent references may describe cited art or other litigation. A mention is not an asserted claim or adjudicated ruling.'}

if __name__ == '__main__':
    catalog=build_catalog()
    destination=ROOT/'data/patent_catalog.json'
    destination.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
    print(f"{len(catalog['cases'])} opinions; {len(catalog['mentions'])} source-backed mentions; {len({m['patent_number'] for m in catalog['mentions']})} patent numbers")
