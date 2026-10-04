import test from 'node:test'
import assert from 'node:assert/strict'
import { newChart, validateChart, importChart, exportCSV, parseCSV, safeSource, summarizeChart, MAX_BYTES } from './claimChartData.js'

test('JSON round trip preserves exact quotations and metadata',()=>{
  const chart=newChart();chart.title='Counsel draft';chart.rows[0].limitation='a "processor";\nreceiving data';chart.rows[0].evidence='=not a formula in JSON';
  assert.deepEqual(importChart(JSON.stringify(chart),'chart.json'),chart)
})
test('CSV preserves commas, escaped quotation marks, CRLF and embedded newlines',()=>{
  const chart=newChart();chart.title='Alpha, Inc.';chart.rows[0].limitation='a "sensor"\nreceiving data';
  assert.deepEqual(importChart(exportCSV(chart),'chart.csv'),chart)
})
test('spreadsheet formulas are neutralized in every exported column',()=>{
  const chart=newChart();chart.title='=WEBSERVICE("https://example.org")';chart.rows[0].notes='\t+1';
  const csv=exportCSV(chart);const cells=parseCSV(csv)[1];assert.equal(cells[0][0],"'");assert.ok(cells.at(-1).startsWith("'"))
})
test('bad CSV quotation and mismatched field counts fail without truncation',()=>{
  assert.throws(()=>parseCSV('a,"unfinished'),/unclosed/)
  assert.throws(()=>parseCSV('a,"finished"junk'),/Malformed/)
  assert.throws(()=>importChart(exportCSV(newChart())+'\na,b','x.csv'),/wrong number/)
})
test('unsupported fields and malicious source protocols are rejected',()=>{
  const c=newChart();c.rows[0].source_url='javascript:alert(1)';assert.throws(()=>validateChart(c),/source URL/)
  assert.equal(safeSource('data:text/html,hello'),'');assert.equal(safeSource('https://user:secret@example.org'),'')
  assert.throws(()=>importChart('{"version":1,"__proto__":{}}','x.json'),/unsupported/)
})
test('safe source links are preserved',()=>assert.equal(safeSource('https://example.org/patent#claim-1'),'https://example.org/patent#claim-1'))
test('unknown chart type and review status are rejected',()=>{
  assert.throws(()=>validateChart({...newChart(),chart_type:'verdict'}),/Chart type/)
  const c=newChart();c.rows[0].status='court affirmed';assert.throws(()=>validateChart(c),/status/)
})
test('import size and row limits fail explicitly',()=>{
  assert.throws(()=>importChart('x'.repeat(MAX_BYTES+1),'x.csv'),/2 MB/)
  const c=newChart();c.rows=Array.from({length:501},()=>c.rows[0]);assert.throws(()=>validateChart(c),/500/)
})
test('CSV rejects ambiguous repeated headers and mixed chart metadata',()=>{
  const csv=exportCSV(newChart());assert.throws(()=>importChart(csv.replace('"title"','"subject"'),'x.csv'),/columns/)
  const second=exportCSV({...newChart(),title:'Another'}).split('\r\n')[1];assert.throws(()=>importChart(csv+'\r\n'+second,'x.csv'),/metadata/)
})
test('template imports as an editable blank chart',()=>assert.deepEqual(importChart(exportCSV(newChart()),'x.csv'),newChart()))
test('coverage describes sources, not legal sufficiency',()=>{
  const c=newChart();c.rows[0].status='supported';assert.equal(summarizeChart(c).sourced,0)
  Object.assign(c.rows[0],{limitation:'a sensor',evidence:'text',source_ref:'Ex. A at 3'});assert.equal(summarizeChart(c).sourced,1)
})
test('unsupported or empty files fail closed',()=>{
  assert.throws(()=>importChart('','empty.csv'))
  assert.throws(()=>importChart('[]','wrong.json'))
  assert.throws(()=>validateChart({...newChart(),rows:[]}))
})
