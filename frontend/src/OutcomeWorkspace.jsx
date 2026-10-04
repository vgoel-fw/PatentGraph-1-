import { useEffect, useState } from 'react'
import { AssessmentResult } from './PatentWorkspace'
import { UpdateCards } from './LegalUpdates'
const issues={ eligibility:'§ 101 · Eligibility',anticipation:'§ 102 · Anticipation',obviousness:'§ 103 · Obviousness',indefiniteness:'§ 112 · Indefiniteness',infringement:'Infringement' }
const forums={ district_court:'District court',federal_circuit:'Federal Circuit',ptab:'PTAB',supreme_court:'Supreme Court' }
const stages={pleadings:'Pleadings',summary_judgment:'Summary judgment',trial:'Trial',appeal:'Appeal',final_written_decision:'Final written decision'}
function localDate() { const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
export default function OutcomeWorkspace({api}) {
  const [options,setOptions]=useState(null)
  const [context,setContext]=useState({issue:'eligibility',forum:'district_court',stage:'summary_judgment',court_id:'cand',jurisdiction:'US-CA',date_from:'2016-01-01',as_of:localDate()})
  const [result,setResult]=useState(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{
    const controller=new AbortController()
    fetch(`${api}/assessment/options`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('Unable to load court options.');return r.json()}).then(setOptions).catch(e=>{if(e.name!=='AbortError')setError(e.message)})
    return()=>controller.abort()
  },[api])
  function change(key,value) {
    let next={...context,[key]:value||null}
    if(key==='forum')next={...next,court_id:null,jurisdiction:null,stage:value==='district_court'?'pleadings':value==='ptab'?'final_written_decision':'appeal'}
    if(key==='jurisdiction')next.court_id=null
    if(key==='court_id' && value)next.jurisdiction=options.courts.find(c=>c.id===value).jurisdiction
    setContext(next);setResult(null)
  }
  async function submit(event) {
    event.preventDefault();setBusy(true);setError('');setResult(null)
    try {
      const r=await fetch(`${api}/assessment`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context)})
      const value=await r.json()
      if(!r.ok)throw new Error(Array.isArray(value.detail)?value.detail.map(x=>x.msg).join('; '):'Unable to compare this cohort.')
      setResult(value)
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  const supportedStages=context.forum==='district_court'?['pleadings','summary_judgment','trial']:context.forum==='ptab'?['final_written_decision']:['appeal']
  const courtOptions=options?.courts.filter(c=>c.forum===context.forum && (!context.jurisdiction||context.jurisdiction==='US'||c.jurisdiction===context.jurisdiction)) || []
  return <main className="practice-workspace"><header className="practice-heading"><div className="eyebrow">Litigation risk / empirical context</div><h1>Compare the right court and the right issue.</h1><p>Start with the selected court, then inspect broader geographic comparisons and developments that may limit older precedents.</p></header>
    <form className="jurisdiction-form" onSubmit={submit}><fieldset disabled={busy || !options}>
      <label>Legal issue<select value={context.issue} onChange={e=>change('issue',e.target.value)}>{Object.entries(issues).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Forum<select value={context.forum} onChange={e=>change('forum',e.target.value)}>{Object.entries(forums).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Procedural stage<select value={context.stage} onChange={e=>change('stage',e.target.value)}>{supportedStages.map(id=><option key={id} value={id}>{stages[id]}</option>)}</select></label>
      <label>Jurisdiction / geography<select value={context.jurisdiction||''} onChange={e=>change('jurisdiction',e.target.value)}><option value="">All US jurisdictions</option>{(options?.jurisdictions||[]).filter(j=>j!=='US' && context.forum==='district_court').map(j=><option key={j} value={j}>{j}</option>)}{context.forum!=='district_court'&&<option value="US">US national forum</option>}</select></label>
      <label>Court<select value={context.court_id||''} onChange={e=>change('court_id',e.target.value)}><option value="">All matching courts</option>{courtOptions.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Decisions from<input type="date" value={context.date_from||''} max={context.as_of} onChange={e=>change('date_from',e.target.value)}/></label>
      <label>As of<input type="date" required value={context.as_of} onChange={e=>change('as_of',e.target.value)}/></label>
      <button type="submit">{busy?'Checking reviewed outcomes…':'Compare outcomes'}</button></fieldset></form>
    <p className="practice-note">{options?.notice} Target: a substantive patentee-favorable determination on the selected issue, not settlement or an overall win.</p>
    {error&&<p className="practice-error" role="alert">{error}</p>}
    {result?<><div className="eyebrow">Selected cohort</div><AssessmentResult result={result}/>{result.adverse_rate!=null&&<p className="practice-note">Patentee-adverse outcomes: {(100*result.adverse_rate).toFixed(1)}% (95% interval {result.adverse_interval_95.map(n=>(100*n).toFixed(1)+'%').join('–')}). This is a historical frequency, not a forecast for this matter.</p>}
      <p className="practice-note">Included decisions: {result.date_range.first||'none'} — {result.date_range.last||'none'}. {result.coverage.records_missing_valid_court} reviewed records in the broader forum lack a supported, consistent court identifier.</p>
      {!!result.comparisons.length&&<section className="peer-cohorts"><h2>Broader comparisons</h2><p className="practice-note">{result.coverage.note}</p><div className="peer-grid">{result.comparisons.map(peer=><article key={peer.label}><h3>{peer.label}</h3><strong>{peer.historical_rate==null?'Rate withheld':(100*peer.historical_rate).toFixed(1)+'% favorable'}</strong><p>{peer.litigation_count} distinct litigations</p>{peer.interval_95&&<p>95% interval {peer.interval_95.map(n=>(100*n).toFixed(1)+'%').join('–')}</p>}</article>)}</div></section>}
      <h2 className="updates-heading">Relevant legal developments</h2><UpdateCards data={result.legal_updates}/>
    </>:<section className="assessment-result"><h2>Evidence before a number.</h2><p>At least 20 reviewed, distinct litigation outcomes are required in each displayed cohort. The present repository has no attorney-reviewed outcome labels, so its rates remain withheld; court and date filters never manufacture data.</p></section>}
  </main>
}
