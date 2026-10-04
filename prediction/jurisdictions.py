"""Supported US court geography; state grouping is not a choice-of-law rule."""
COURTS = {
    'cand': ('N.D. California', 'US-CA', 'district_court'),
    'cacd': ('C.D. California', 'US-CA', 'district_court'),
    'casd': ('S.D. California', 'US-CA', 'district_court'),
    'caed': ('E.D. California', 'US-CA', 'district_court'),
    'txed': ('E.D. Texas', 'US-TX', 'district_court'),
    'txwd': ('W.D. Texas', 'US-TX', 'district_court'),
    'txnd': ('N.D. Texas', 'US-TX', 'district_court'),
    'txsd': ('S.D. Texas', 'US-TX', 'district_court'),
    'ded': ('D. Delaware', 'US-DE', 'district_court'),
    'nysd': ('S.D. New York', 'US-NY', 'district_court'),
    'nyed': ('E.D. New York', 'US-NY', 'district_court'),
    'ilnd': ('N.D. Illinois', 'US-IL', 'district_court'),
    'mad': ('D. Massachusetts', 'US-MA', 'district_court'),
    'njd': ('D. New Jersey', 'US-NJ', 'district_court'),
    'vaed': ('E.D. Virginia', 'US-VA', 'district_court'),
    'flsd': ('S.D. Florida', 'US-FL', 'district_court'),
    'wawd': ('W.D. Washington', 'US-WA', 'district_court'),
    'cafc': ('Federal Circuit', 'US', 'federal_circuit'),
    'scotus': ('Supreme Court', 'US', 'supreme_court'),
    'ptab': ('PTAB', 'US', 'ptab'),
}

def options():
    return {'courts':[{'id':k,'label':v[0],'jurisdiction':v[1],'forum':v[2]} for k,v in COURTS.items()],
        'jurisdictions': sorted({v[1] for v in COURTS.values()}),
        'notice':'US coverage only. State groups describe court location, not the substantive law governing a patent issue. Court list is a supported subset.'}

def geography(row):
    court=row.get('court_id')
    if court in COURTS:
        _,state,forum=COURTS[court]
        if row.get('forum')!=forum or row.get('jurisdiction') not in (None,state):return None,None
        return court,state
    # Unknown or inconsistent courts are excluded from local cohorts, not assigned by guesswork.
    return None,None
