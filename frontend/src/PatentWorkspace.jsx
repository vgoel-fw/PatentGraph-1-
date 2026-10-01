import { useEffect, useState } from 'react'

const ISSUES = { eligibility: '§ 101 · Eligibility', anticipation: '§ 102 · Anticipation', obviousness: '§ 103 · Obviousness', indefiniteness: '§ 112 · Indefiniteness', infringement: 'Infringement' }
const FORUMS = { district_court: 'District court', federal_circuit: 'Federal Circuit', ptab: 'PTAB', supreme_court: 'Supreme Court' }
const STAGES = { pleadings: 'Pleadings', summary_judgment: 'Summary judgment', trial: 'Trial', appeal: 'Appeal', final_written_decision: 'Final written decision' }
const SOURCE_BASE = 'https://github.com/vgoel-fw/PatentGraph-1-/blob/6c9d1b1b23e0f807027857cf582d18dbbd2090b1/'
const percent = value => `${(value * 100).toFixed(1)}%`

async function request(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`Unable to load research data (${response.status}).`)
  return response.json()
}

export function AssessmentResult({ result }) {
  if (!result) return null
  return <section className="assessment-result" aria-live="polite">
    <div className="eyebrow">{result.status === 'historical_cohort' ? 'Historical comparison' : 'Evidence threshold'}</div>
    <h2>{result.historical_rate == null ? 'Not enough reviewed outcomes to estimate' : `${percent(result.historical_rate)} patentee-favorable outcomes`}</h2>
    <p>{result.reason}</p>
    {result.interval_95 && <p className="interval">95% confidence interval: {result.interval_95.map(percent).join(' – ')}</p>}
    {result.litigation_count != null && <div className="evidence-counts"><span><strong>{result.litigation_count}</strong> distinct litigations</span><span><strong>{result.favorable_count}</strong> favorable</span><span><strong>{result.adverse_count}</strong> adverse</span></div>}
    <details><summary>How this comparison works</summary><p>{result.method}</p><p>At least {result.minimum_cases || 20} reviewed litigation outcomes are required. Repeat decisions count once; conflicting labels are excluded. A historical rate is not the probability that your client will win.</p><ul>{(result.limitations || []).map(text => <li key={text}>{text}</li>)}</ul></details>
    {!!result.cases?.length && <div className="table-scroll"><table><caption>Reviewed decisions included in this cohort</caption><thead><tr><th>Authority</th><th>Decision date</th><th>Issue outcome</th><th>Supporting text</th></tr></thead><tbody>{result.cases.map(row => <tr key={row.litigation_id}><td><a href={row.source_url} target="_blank" rel="noreferrer">{row.citation || row.case_id}</a></td><td>{row.decision_date}</td><td>{row.outcome.replaceAll('_', ' ')}</td><td>{row.source_quote}</td></tr>)}</tbody></table></div>}
  </section>
}

export default function PatentWorkspace({ api, view }) {
  const [search, setSearch] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [library, setLibrary] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(null)
  const [context, setContext] = useState({ issue: 'eligibility', forum: 'federal_circuit', stage: 'appeal' })
  const [result, setResult] = useState(null)
  useEffect(() => {
    if (view !== 'patents') return
    const controller = new AbortController()
    request(`${api}/patents?q=${encodeURIComponent(submitted)}&limit=100`, { signal: controller.signal })
      .then(data => { setLibrary(data); setSelected(null); setError(null) })
      .catch(err => { if (err.name !== 'AbortError') setError(err.message) })
    return () => controller.abort()
  }, [api, submitted, view])
  async function assess(event) {
    event.preventDefault(); setBusy(true); setError(null); setResult(null)
    try { setResult(await request(`${api}/assessment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(context) })) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  return <main className="practice-workspace">
    <header className="practice-heading"><div className="eyebrow">PatentGraph / Counsel workspace</div><h1>{view === 'patents' ? 'Follow the patent. Inspect the evidence.' : 'Define the dispute before comparing outcomes.'}</h1><p>{view === 'patents' ? 'Patent references, publication records, and the language connecting them to the case law.' : 'Compare reviewed decisions on the same issue, in the same forum, at the same procedural stage.'}</p></header>
    {error && <p role="alert" className="practice-error">{error}</p>}
    {view === 'patents' ? <>
      <div className="library-summary"><span><strong>{library?.patent_count ?? '—'}</strong> patent numbers</span><span><strong>{library?.opinion_count ?? '—'}</strong> opinions</span><span><strong>{library?.mention_count ?? '—'}</strong> sourced mentions</span><span><strong>{library?.publication_count ?? '—'}</strong> publication records</span></div>
      <form className="library-search" onSubmit={event => { event.preventDefault(); setSubmitted(search) }}><label htmlFor="patent-search">Find a patent or authority</label><div><input id="patent-search" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} placeholder="Patent number, case name, or citation" /><button type="submit">Search evidence</button></div></form>
      <p className="practice-note">A patent’s appearance in an opinion does not establish that it was asserted, construed, or invalidated. These references await legal review.</p>
      <div className="patent-columns"><section className="patent-list" aria-label="Patent references"><div className="table-scroll"><table><caption>{library ? `${library.total} matching patent numbers` : 'Loading patent evidence…'}</caption><thead><tr><th>Patent</th><th>Publication title</th><th>Opinions</th></tr></thead><tbody>{library?.results.map(p => <tr key={p.patent_number} className={selected?.patent_number === p.patent_number ? 'selected' : ''}><td><button className="patent-link" onClick={() => setSelected(p)}>US {Number(p.patent_number).toLocaleString('en-US')}</button></td><td>{p.publication?.title || 'Publication metadata not yet imported'}</td><td>{new Set(p.references.map(r => r.case_id)).size}</td></tr>)}</tbody></table>{library?.total === 0 && <p>No matching patent references. Try a case name or patent number.</p>}</div></section>
      <aside className="patent-evidence" aria-label="Selected patent evidence">{selected ? <><div className="eyebrow">Source record · Pending review</div><h2>US {Number(selected.patent_number).toLocaleString('en-US')}</h2>{selected.publication && <div className="publication-record"><h3>{selected.publication.title}</h3><dl><dt>Filed</dt><dd>{selected.publication.filing_date}</dd><dt>Published</dt><dd>{selected.publication.publication_date}</dd><dt>Inventors</dt><dd>{selected.publication.inventors.join(', ')}</dd></dl><a href={selected.publication.source_url} target="_blank" rel="noreferrer">Read patent publication ↗</a><p>{selected.publication.notice}</p></div>}{selected.references.map(r => <article key={r.id}><h3>{r.case_name || r.citation}</h3><p className="reference-meta">{r.citation} · {r.court.toUpperCase()} · {r.date}</p><blockquote>{r.quote}</blockquote><a href={`${SOURCE_BASE}${r.source_path}`} target="_blank" rel="noreferrer">Inspect stored opinion ↗</a><p className="reference-meta">Normalized text offsets {r.start}–{r.end}. Mention only; no claim-level disposition inferred.</p></article>)}</> : <div className="evidence-empty"><h2>Read the connection</h2><p>Select a patent number to inspect the exact supporting passage and available publication metadata.</p></div>}</aside></div>
    </> : <>
      <form className="cohort-form" onSubmit={assess}>{[['issue','Legal issue',ISSUES],['forum','Forum',FORUMS],['stage','Procedural stage',STAGES]].map(([key,label,options]) => <label key={key}>{label}<select value={context[key]} disabled={busy} onChange={event => { const value = event.target.value; setContext({ ...context, [key]: value, ...(key === 'forum' ? { stage: value === 'district_court' ? 'pleadings' : value === 'ptab' ? 'final_written_decision' : 'appeal' } : {}) }); setResult(null) }}>{Object.entries(options).filter(([value]) => key !== 'stage' || (context.forum === 'district_court' ? ['pleadings','summary_judgment','trial'] : context.forum === 'ptab' ? ['final_written_decision'] : ['appeal']).includes(value)).map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select></label>)}<button type="submit" disabled={busy}>{busy ? 'Checking cohort…' : 'Compare outcomes'}</button></form>
      <p className="practice-note">Target: a patentee-favorable substantive decision on the selected issue. Settlements, remands, and an affirmance alone do not supply that label.</p>
      <AssessmentResult result={result} />
      {!result && <section className="assessment-result"><div className="eyebrow">An auditable starting point</div><h2>Evidence before a number.</h2><p>The current opinion sample has no attorney-reviewed outcome labels. The system will show the available count and withhold a numerical estimate until the selected cohort is large enough.</p></section>}
    </>}
  </main>
}
