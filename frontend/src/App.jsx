import { useState, useRef } from 'react'
import GraphPanel from './GraphPanel'
import { normalizeGraph } from './graphData'
import './App.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const DEMO_QUERIES = {
  eligibility: 'How has the Federal Circuit treated software patent eligibility under Alice after 2019? Which judges apply the two-step test most strictly?',
  claim_construction: 'What is the CAFC standard for means-plus-function construction under 35 USC 112(f)? How has it shifted since Williamson v. Citrix?',
  obviousness: 'After KSR, how do NDCA district courts handle obviousness challenges to software patents with UI claim elements?',
}

function riskColor(score) {
  if (score <= 3) return '#22C55E'
  if (score <= 6) return '#F59E0B'
  return '#EF4444'
}

function SourceBadge({ source }) {
  const colors = { graph: '#8B5CF6', midpage: '#22C55E' }
  const bg = colors[source] || '#6B7280'
  return (
    <span style={{
      background: bg, color: '#fff', fontSize: 10, fontWeight: 700,
      padding: '1px 6px', borderRadius: 4, marginLeft: 6, letterSpacing: 0.5,
    }}>{(source || 'N/A').toUpperCase()}</span>
  )
}

function TrustBadge({ verified }) {
  if (verified === true) return <span title="TrustFoundry verified" style={{ color: '#22C55E', fontSize: 13, marginRight: 4 }}>✓</span>
  if (verified === false) return <span title="Could not verify" style={{ color: '#EF4444', fontSize: 13, marginRight: 4 }}>⚠</span>
  return <span style={{ color: '#6B7280', fontSize: 11, marginRight: 4 }}>?</span>
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [memo, setMemo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [demoMode, setDemoMode] = useState(false)
  const inputRef = useRef(null)
  const requestPending = useRef(false)

  async function handleQuery(q, isDemo) {
    const finalQ = q || question
    if (!finalQ.trim() || requestPending.current) return
    requestPending.current = true
    setLoading(true); setError(null); setMemo(null); setSelectedNode(null); setDemoMode(false)
    try {
      const res = await fetch(`${API}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: finalQ, demo: !!isDemo }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const result = await res.json()
      setMemo(result)
      setDemoMode(!!result._demo_mode)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      requestPending.current = false
    }
  }

  function highlightCase(citation) {
    if (!citation) return
    const graph = normalizeGraph(memo?.subgraph, memo?.anchor_cases)
    const node = graph.nodes.find(n => n.citation === citation) ||
      graph.nodes.find(n => n.citation?.includes(citation.split(',')[0]))
    if (node) setSelectedNode(node)
  }

  return (
    <div className="app">
      <div className="header">
        <div className="logo">⬡ PatentGraph <span className="logo-sub">Patent Litigation Intelligence</span></div>
        <div className="header-right">
          {demoMode && <span className="demo-badge">DEMO MODE</span>}
          <span className="header-tag">Harvey Challenge · Stanford LLM×Law #6</span>
        </div>
      </div>

      <div className="search-row">
        <input
          ref={inputRef}
          className="search-input"
          aria-label="Patent litigation question"
          placeholder="Ask a patent litigation question…"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleQuery(question, false)}
        />
        <button className="btn-primary" onClick={() => handleQuery(question, false)} disabled={loading || !question.trim()}>
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {!memo && !loading && <section className="sample-questions" aria-label="Sample questions">
        <div className="sample-heading">Start with a sample question <span>Choose one, edit it, then Analyze using live data.</span></div>
        <div className="sample-grid">
          {Object.entries(DEMO_QUERIES).map(([key, q]) => (
            <button key={key} className="sample-card" onClick={() => {
              setQuestion(q)
              inputRef.current?.focus()
            }}>
              <strong>{key.replaceAll('_', ' ')}</strong>
              <span>{q}</span>
            </button>
          ))}
        </div>
      </section>}

      <div className="demo-pills">
        <span className="demo-label">Cached demo:</span>
        {Object.entries(DEMO_QUERIES).map(([key, q]) => (
          <button key={key} className="pill" disabled={loading} onClick={() => { setQuestion(q); handleQuery(q, true) }}>
            {key.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error && <div className="error-bar">⚠ {error}</div>}

      <div className="main-content">
        <GraphPanel memo={memo} loading={loading} selectedNode={selectedNode} onSelect={setSelectedNode} />

        {/* Memo panel */}
        <div className="memo-panel">
          {memo ? (
            <div className="memo-content">
              <div className="memo-summary">
                <div className="section-title">Executive Summary</div>
                <p>{memo.executive_summary}</p>
              </div>

              <div className="metrics-row">
                <div className="risk-block">
                  <div className="metric-label">Litigation Risk</div>
                  <div className="risk-bar-wrap">
                    <div className="risk-bar-fill" style={{ width: `${(memo.litigation_risk_score || 0) * 10}%`, background: riskColor(memo.litigation_risk_score) }} />
                  </div>
                  <div className="risk-num" style={{ color: riskColor(memo.litigation_risk_score) }}>{memo.litigation_risk_score}/10</div>
                  <div className="risk-rationale">{memo.litigation_risk_rationale}</div>
                </div>

                <div className={`circuit-split-block ${memo.circuit_split?.exists ? 'split-yes' : 'split-no'}`}>
                  <div className="metric-label">Circuit Split</div>
                  <div className="split-status">{memo.circuit_split?.exists ? '⚠ Yes' : '✓ No'}</div>
                  {memo.circuit_split?.exists && <div className="split-detail">{memo.circuit_split.description}</div>}
                </div>
              </div>

              {memo.claim_construction_trend && (
                <div className="section">
                  <div className="section-title">
                    Claim Construction
                    <span className="trend-chip">{memo.claim_construction_trend.direction}</span>
                  </div>
                  <p className="small-text">{memo.claim_construction_trend.summary}</p>
                </div>
              )}

              <div className="section">
                <div className="section-title">Precedent Chain ({(memo.precedent_chain || []).length} cases)</div>
                <div className="precedent-list">
                  {(memo.precedent_chain || []).map((p, i) => (
                    <div key={i} className="prec-item" role="button" tabIndex={0}
                      onClick={() => highlightCase(p.citation)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          highlightCase(p.citation)
                        }
                      }}>
                      <div className="prec-header">
                        <TrustBadge verified={p.trust_verified} />
                        <span className="prec-citation">{p.citation}</span>
                        <SourceBadge source={p.source} />
                        {p.hops_from_anchor > 0 && <span className="hop-chip">{p.hops_from_anchor}h</span>}
                      </div>
                      <div className="prec-holding">{p.holding}</div>
                      <div className="prec-relevance">{p.relevance}</div>
                      {p.verification_warning && <div className="verify-warn">⚠ {p.verification_warning}</div>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="cite-row">
                <div className="cite-col">
                  <div className="section-title cite-for-title">Cite For</div>
                  {(memo.cases_to_cite_for || []).map((c, i) => (
                    <div key={i} className="cite-item">
                      <TrustBadge verified={typeof c === 'object' ? c.trust_verified : null} />
                      {typeof c === 'string' ? c : c.citation}
                    </div>
                  ))}
                </div>
                <div className="cite-col">
                  <div className="section-title cite-against-title">Cite Against</div>
                  {(memo.cases_to_cite_against || []).map((c, i) => (
                    <div key={i} className="cite-item">
                      <TrustBadge verified={typeof c === 'object' ? c.trust_verified : null} />
                      {typeof c === 'string' ? c : c.citation}
                    </div>
                  ))}
                </div>
              </div>

              <div className="confidence-row">
                <span className="conf-label">Confidence:</span>
                <span className="conf-score">{memo.confidence}/10</span>
                <span className="conf-rationale"> — {memo.confidence_rationale}</span>
              </div>
              {memo.trust_verification && (
                <div className="trust-status">TrustFoundry: {memo.trust_verification}</div>
              )}
            </div>
          ) : (
            <div className="memo-empty">
              {loading ? 'Generating legal memo…' : 'Legal memo will appear here after your query.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
