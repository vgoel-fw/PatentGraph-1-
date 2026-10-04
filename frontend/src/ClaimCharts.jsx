import { useRef, useState } from 'react'
import { CHART_TYPES, MAX_BYTES, MAX_ROWS, STATUSES, STORAGE_KEY, exportCSV, importChart, newChart, newRow, safeSource, summarizeChart, validateChart } from './claimChartData.js'

function initial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { charts: [], error: '' }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > 25) throw new Error('Invalid saved workspace')
    return { charts: parsed.map(item => ({ id: String(item.id), chart: validateChart(item.chart) })), error: '' }
  } catch { return { charts: [], error: 'Saved charts could not be opened. Existing browser storage is preserved; export a backup before replacing it.', blocked: true } }
}
function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a')
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function ClaimCharts() {
  const [saved] = useState(initial)
  const [charts, setCharts] = useState(saved.charts)
  const [selected, setSelected] = useState(saved.charts[0]?.id || '')
  const [error, setError] = useState(saved.error)
  const [saveState, setSaveState] = useState('')
  const [claim, setClaim] = useState('')
  const [limitations, setLimitations] = useState('')
  const fileRef = useRef(null)
  const current = charts.find(item => item.id === selected)
  const chart = current?.chart
  function persist(next) {
    setCharts(next)
    try { next.forEach(item => validateChart(item.chart)); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaveState('Saved in this browser') }
    catch { setSaveState('Draft not saved. Complete any invalid source URL, or export JSON if browser storage is unavailable.') }
  }
  function add(value) {
    if (saved.blocked) return
    if (charts.length >= 25) { setError('This workspace holds up to 25 charts. Export your charts before using another browser workspace.'); return }
    const id = crypto.randomUUID(); persist([...charts, { id, chart: validateChart(value) }]); setSelected(id); setError('')
  }
  function change(value) { persist(charts.map(item => item.id === selected ? { ...item, chart: value } : item)) }
  function field(key, value) { change({ ...chart, [key]: value }) }
  function rowField(index, key, value) { change({ ...chart, rows: chart.rows.map((row, i) => i === index ? { ...row, [key]: value } : row) }) }
  function append() {
    const lines = limitations.split(/\r?\n/).filter(line => line.trim())
    if (!lines.length) { setError('Enter at least one limitation, with one limitation per line.'); return }
    const rows = chart.rows.length === 1 && Object.entries(chart.rows[0]).every(([k,v]) => k === 'status' ? v === 'unmapped' : v === '') ? [] : chart.rows
    if (rows.length + lines.length > MAX_ROWS || lines.some(line => line.length > 20000)) { setError('Chart limit: 500 rows, 20,000 characters per cell.'); return }
    change({ ...chart, rows: [...rows, ...lines.map(limitation => ({ ...newRow(claim), limitation }))] }); setLimitations(''); setError('')
  }
  async function imported(event) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    try {
      if (!/\.(csv|json)$/i.test(file.name)) throw new Error('Use CSV or PatentGraph JSON. Export Word, PDF, or Excel charts to the CSV template first.')
      if (file.size > MAX_BYTES) throw new Error('Import must be no larger than 2 MB.')
      add(importChart(await file.text(), file.name))
    } catch (e) { setError(e.message) }
  }
  function exported(format) {
    try {
      const value = validateChart(chart)
      download(format === 'json' ? JSON.stringify(value, null, 2) : exportCSV(value), `claim-chart.${format}`, format === 'json' ? 'application/json' : 'text/csv;charset=utf-8')
      setError('')
    } catch (e) { setError(e.message) }
  }
  const stats = chart ? summarizeChart(chart) : null
  return <main className="practice-workspace chart-workspace">
    <header className="practice-heading"><div className="eyebrow">Counsel work product</div><h1>Build the chart, limitation by limitation.</h1><p>Create an infringement or invalidity chart, map evidence, and keep the source beside each assertion.</p></header>
    <div className="chart-toolbar"><button onClick={() => add(newChart())} disabled={saved.blocked}>New chart</button><button onClick={() => fileRef.current.click()} disabled={saved.blocked}>Import CSV / JSON</button><input ref={fileRef} aria-label="Import claim chart file" type="file" accept=".csv,.json" onChange={imported} hidden /><button onClick={() => download(exportCSV(newChart()), 'claim-chart-template.csv', 'text/csv;charset=utf-8')}>Download CSV template</button>{chart && <><button onClick={() => exported('json')}>Export JSON</button><button onClick={() => exported('csv')}>Export CSV</button><button onClick={() => window.print()}>Print / PDF</button></>}</div>
    <p className="practice-note">Charts stay in this browser and are never submitted to an AI service. Imported charts become a separate draft. Status labels are attorney work product, not a court ruling. CSV export neutralizes spreadsheet formulas; JSON preserves exact text.</p>
    {error && <p role="alert" className="practice-error">{error}</p>}
    {charts.length > 0 && <label className="chart-picker">Saved charts<select value={selected} onChange={e => { setSelected(e.target.value); setLimitations(''); setClaim('') }}>{charts.map(item => <option key={item.id} value={item.id}>{item.chart.title || 'Untitled chart'}</option>)}</select></label>}
    {chart ? <>
      <div className="chart-metadata">{[['title','Chart title'],['patent_number','Patent / publication number'],['subject',chart.chart_type === 'invalidity' ? 'Prior-art reference / combination' : 'Accused product / process']].map(([key,label]) => <label key={key}>{label}<input maxLength={500} value={chart[key]} onChange={e => field(key,e.target.value)} /></label>)}<label>Chart type<select value={chart.chart_type} onChange={e => field('chart_type',e.target.value)}>{CHART_TYPES.map(t => <option key={t}>{t}</option>)}</select></label></div>
      <details className="chart-add"><summary>Add limitations from claim text</summary><p>Use one limitation per line. Text is preserved; review dependencies and claim construction yourself.</p><label>Claim number<input value={claim} maxLength={200} onChange={e => setClaim(e.target.value)} /></label><label>Claim limitations<textarea value={limitations} maxLength={100000} onChange={e => setLimitations(e.target.value)} rows={5} /></label><button onClick={append}>Add limitation rows</button></details>
      <div className="chart-status"><span>{stats.rows} rows · {stats.sourced} with limitation, evidence, and source · {stats.unmapped} unmapped</span><span role="status">{saveState}</span></div>
      <div className="table-scroll chart-table"><table><caption>{chart.title || 'Claim chart'} · {chart.patent_number || 'Patent not specified'} · {chart.chart_type} · Draft</caption><thead><tr><th>Claim / limitation</th><th>Construction / interpretation</th><th>{chart.chart_type === 'invalidity' ? 'Prior-art mapping' : 'Product / process mapping'}</th><th>Evidence and source</th><th>Review and notes</th></tr></thead><tbody>{chart.rows.map((row,i) => <tr key={i}><td><label>Claim number<input aria-label={`Row ${i+1} claim number`} value={row.claim_number} maxLength={20000} onChange={e => rowField(i,'claim_number',e.target.value)} /></label><label>Limitation<textarea aria-label={`Row ${i+1} limitation`} value={row.limitation} maxLength={20000} onChange={e => rowField(i,'limitation',e.target.value)} /></label></td><td><textarea aria-label={`Row ${i+1} construction`} value={row.construction} maxLength={20000} onChange={e => rowField(i,'construction',e.target.value)} /></td><td><textarea aria-label={`Row ${i+1} mapping`} value={row.mapping} maxLength={20000} onChange={e => rowField(i,'mapping',e.target.value)} /></td><td><label>Evidence quotation<textarea aria-label={`Row ${i+1} evidence`} value={row.evidence} maxLength={20000} onChange={e => rowField(i,'evidence',e.target.value)} /></label><label>Page / paragraph / Bates<input aria-label={`Row ${i+1} source reference`} value={row.source_ref} maxLength={20000} onChange={e => rowField(i,'source_ref',e.target.value)} /></label><label>Source URL<input aria-label={`Row ${i+1} source URL`} value={row.source_url} maxLength={20000} onChange={e => rowField(i,'source_url',e.target.value)} /></label>{safeSource(row.source_url) && <a href={safeSource(row.source_url)} target="_blank" rel="noreferrer">Open source ↗</a>}</td><td><select aria-label={`Row ${i+1} review status`} value={row.status} onChange={e => rowField(i,'status',e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select><textarea aria-label={`Row ${i+1} notes`} value={row.notes} maxLength={20000} onChange={e => rowField(i,'notes',e.target.value)} /><button onClick={() => { if (chart.rows.length === 1) { setError('Keep at least one row in a chart.'); return } change({ ...chart, rows: chart.rows.filter((_,n) => n !== i) }) }}>Remove row</button></td></tr>)}</tbody></table></div>
      <section className="chart-print-document"><h1>{chart.title}</h1><p>{chart.patent_number} · {chart.chart_type} · {chart.subject} · Attorney draft</p><table><thead><tr><th>Claim / limitation</th><th>Construction</th><th>Mapping</th><th>Evidence / source</th><th>Review / notes</th></tr></thead><tbody>{chart.rows.map((row,i) => <tr key={i}><td>{row.claim_number}{'\n'}{row.limitation}</td><td>{row.construction}</td><td>{row.mapping}</td><td>{row.evidence}{'\n'}{row.source_ref}{'\n'}{row.source_url}</td><td>{row.status}{'\n'}{row.notes}</td></tr>)}</tbody></table></section>
      <button className="add-chart-row" disabled={chart.rows.length >= MAX_ROWS} onClick={() => change({ ...chart, rows:[...chart.rows,newRow()] })}>Add blank row</button>
    </> : <div className="assessment-result"><h2>A working chart with a traceable record.</h2><p>Create a chart or import a CSV / JSON file to begin. PDF and Word parsing are not supported; the CSV template defines the supported interchange format.</p></div>}
  </main>
}
