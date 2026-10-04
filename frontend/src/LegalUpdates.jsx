import { useEffect, useState } from 'react'

export function UpdateCards({ data }) {
  if (!data) return null
  return <section className="legal-updates"><p className="practice-note">Sources checked {data.checked_on}. {data.coverage} {data.stale && <strong>Refresh needed: this snapshot is more than 30 days old.</strong>}</p>{data.items.length ? data.items.map(item => <article className="update-card" key={item.id}><div className="eyebrow">{item.authority} · {item.type} · {item.published_on}</div><h2>{item.title}</h2><p>{item.summary}</p><p><strong>For counsel:</strong> {item.practice_note}</p><a href={item.source_url} target="_blank" rel="noreferrer">Read official source ↗</a><p className="reference-meta">{item.pinpoint} · {item.review_status}</p>{item.cohort_cases_before_update != null && <p className="reference-meta">{item.cohort_cases_before_update} included decisions predate this development; assess comparability.</p>}</article>) : <p>No matching developments in this curated snapshot. This does not mean that the law has not changed.</p>}<p className="practice-note">{data.scoring_note}</p></section>
}
export default function LegalUpdates({ api }) {
  const [data,setData] = useState(null)
  const [error,setError] = useState('')
  const [forum,setForum] = useState('')
  useEffect(() => {
    const controller=new AbortController()
    fetch(`${api}/legal-updates${forum ? `?forum=${forum}` : ''}`,{ signal:controller.signal }).then(async res => {
      if (!res.ok) throw new Error('Unable to load legal developments.')
      return res.json()
    }).then(value => { setData(value); setError('') }).catch(err => { if(err.name !== 'AbortError') setError(err.message) })
    return () => controller.abort()
  },[api,forum])
  return <main className="practice-workspace"><header className="practice-heading"><div className="eyebrow">Authority & practice</div><h1>What changed, and where it matters.</h1><p>Dated developments from official sources, separated by forum and authority. Agency guidance is identified separately from court precedent.</p></header><label className="chart-picker">Forum<select value={forum} onChange={e=>setForum(e.target.value)}><option value="">All covered forums</option><option value="district_court">District courts</option><option value="federal_circuit">Federal Circuit</option><option value="ptab">PTAB</option><option value="prosecution">USPTO prosecution</option></select></label>{error && <p role="alert">{error}</p>}<UpdateCards data={data}/></main>
}
