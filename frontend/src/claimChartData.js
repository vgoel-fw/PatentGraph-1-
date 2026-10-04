// Local-only chart interchange. Draft mappings are never used as outcome labels.
export const MAX_BYTES = 2_000_000
export const MAX_ROWS = 500
export const ROW_FIELDS = ['claim_number', 'limitation', 'construction', 'mapping', 'evidence', 'source_ref', 'source_url', 'status', 'notes']
export const META_FIELDS = ['title', 'patent_number', 'chart_type', 'subject']
export const STATUSES = ['unmapped', 'supported', 'disputed', 'not supported']
export const CHART_TYPES = ['infringement', 'invalidity']
export const STORAGE_KEY = 'patentgraph.claimCharts.v1'
const string = (v, name, max = 20000) => {
  if (typeof v !== 'string' || v.length > max) throw new Error(`${name} must be text of at most ${max.toLocaleString()} characters.`)
  return v
}
export function safeSource(value) {
  if (!value) return ''
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : '' }
  catch { return '' }
}
export function newRow(claim = '') {
  return Object.fromEntries(ROW_FIELDS.map(key => [key, key === 'claim_number' ? claim : key === 'status' ? 'unmapped' : '']))
}
export function newChart() {
  return { version: 1, title: 'Untitled claim chart', patent_number: '', chart_type: 'infringement', subject: '', rows: [newRow()] }
}
export function validateChart(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) throw new Error('Expected a version 1 PatentGraph claim chart.')
  const allowed = new Set(['version', 'rows', ...META_FIELDS])
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('The chart contains unsupported fields.')
  const chart = { version: 1 }
  for (const key of META_FIELDS) chart[key] = string(input[key], key, 500)
  if (!CHART_TYPES.includes(chart.chart_type)) throw new Error('Chart type must be infringement or invalidity.')
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > MAX_ROWS) throw new Error(`A chart must have 1–${MAX_ROWS} rows.`)
  chart.rows = input.rows.map((row, i) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !ROW_FIELDS.includes(key))) throw new Error(`Row ${i + 1} has unsupported fields.`)
    const clean = Object.fromEntries(ROW_FIELDS.map(key => [key, string(row[key] ?? (key === 'status' ? 'unmapped' : ''), `Row ${i + 1}: ${key}`)]))
    if (!STATUSES.includes(clean.status)) throw new Error(`Row ${i + 1} has an unknown review status.`)
    if (clean.source_url && !safeSource(clean.source_url)) throw new Error(`Row ${i + 1}: source URL must use http or https without credentials.`)
    return clean
  })
  return chart
}

// RFC 4180-style quoted fields, embedded newlines, CRLF, and escaped quotes.
export function parseCSV(text) {
  const rows = []; let row = []; let field = ''; let quoted = false; let closed = false
  text = text.replace(/^\uFEFF/, '')
  const cell = () => { row.push(field); field = ''; closed = false }
  const line = () => { cell(); if (row.some(x => x !== '')) rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else field += c
    } else if (c === ',') cell()
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; line() }
    else if (c === '"' && !field && !closed) quoted = true
    else {
      if (closed || c === '"') throw new Error('Malformed CSV quotation.')
      field += c
    }
  }
  if (quoted) throw new Error('CSV has an unclosed quotation.')
  if (field || row.length || closed) line()
  return rows
}
export function importChart(text, filename = '') {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Import must be no larger than 2 MB.')
  if (filename.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{')) return validateChart(JSON.parse(text))
  const [headers, ...records] = parseCSV(text)
  const expected = [...META_FIELDS, ...ROW_FIELDS]
  if (!headers || headers.length !== expected.length || new Set(headers).size !== headers.length || expected.some(k => !headers.includes(k))) throw new Error('CSV columns must match the downloadable template.')
  if (!records.length || records.length > MAX_ROWS) throw new Error(`Import 1–${MAX_ROWS} rows.`)
  const objects = records.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`CSV row ${i + 2} has the wrong number of columns.`)
    return Object.fromEntries(headers.map((key, n) => [key, cells[n]]))
  })
  const chart = { version: 1, ...Object.fromEntries(META_FIELDS.map(k => [k, objects[0][k]])) }
  if (objects.some(row => META_FIELDS.some(k => row[k] !== chart[k]))) throw new Error('Import one chart at a time; chart metadata must match on every row.')
  chart.rows = objects.map(row => Object.fromEntries(ROW_FIELDS.map(k => [k, row[k]])))
  return validateChart(chart)
}
export function exportCSV(input) {
  const chart = validateChart(input); const fields = [...META_FIELDS, ...ROW_FIELDS]
  const escape = value => {
    // Prevent spreadsheet formula execution. JSON preserves the exact original text.
    const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  return [fields, ...chart.rows.map(row => fields.map(k => k in row ? row[k] : chart[k]))].map(row => row.map(escape).join(',')).join('\r\n')
}
export function summarizeChart(chart) {
  return { rows: chart.rows.length, limitations: chart.rows.filter(r => r.limitation.trim()).length,
    sourced: chart.rows.filter(r => r.limitation.trim() && r.evidence.trim() && (r.source_ref.trim() || r.source_url.trim())).length,
    unmapped: chart.rows.filter(r => r.status === 'unmapped').length }
}
