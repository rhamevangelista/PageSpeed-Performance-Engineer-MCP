import type { AnalysisReport, LighthouseScores, Recommendation } from '../types.js'
import { analyzeWebsite } from './recommendations.js'

export async function generateReportHtml(url: string): Promise<string> {
  const report = await analyzeWebsite(url)
  return buildHtml(report)
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function esc(val: string | null | undefined): string {
  if (!val) return ''
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getDomain(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function scoreColor(score: number): string {
  if (score >= 90) return '#4ade80'
  if (score >= 50) return '#fb923c'
  return '#f87171'
}

function cwvStatus(value: number, good: number, poor: number): { color: string; icon: string; label: string } {
  if (value <= good) return { color: '#4ade80', icon: '✓', label: 'Good' }
  if (value <= poor) return { color: '#fb923c', icon: '△', label: 'Needs improvement' }
  return { color: '#f87171', icon: '✕', label: 'Poor' }
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
}

function barColor(rank: number): string {
  const palette = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e']
  return palette[Math.min(rank, palette.length - 1)]
}

function truncate(text: string, max = 26): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// ─── Section builders ─────────────────────────────────────────────────────────

function scoreCard(label: string, score: number): string {
  return `<div class="score-card">
    <div class="score-num" style="color:${scoreColor(score)}">${score}</div>
    <div class="score-label">${esc(label)}</div>
  </div>`
}

function cwvCard(name: string, value: string, color: string, sub: string): string {
  return `<div class="cwv-card">
    <div class="cwv-name">${esc(name)}</div>
    <div class="cwv-value" style="color:${color}">${esc(value)}</div>
    <div class="cwv-sub" style="color:${color}">${esc(sub)}</div>
  </div>`
}

function buildScoreSection(scores: LighthouseScores): string {
  return `<section>
  <div class="section-title">Lighthouse Scores</div>
  <div class="score-grid">
    ${scoreCard('Performance', scores.performance)}
    ${scoreCard('Accessibility', scores.accessibility)}
    ${scoreCard('Best Practices', scores.bestPractices)}
    ${scoreCard('SEO', scores.seo)}
  </div>
</section>`
}

function buildCwvSection(report: AnalysisReport, cwvSource: string): string {
  const cwv = report.coreWebVitals!
  const cards: string[] = []

  if (cwv.lcp !== null) {
    const s = cwvStatus(cwv.lcp, 2500, 4000)
    cards.push(cwvCard('LCP', fmtMs(cwv.lcp), s.color, `${s.icon} ${s.label} (target <2.5s)`))
  }
  if (cwv.inp !== null) {
    const s = cwvStatus(cwv.inp, 200, 500)
    cards.push(cwvCard('INP', `${cwv.inp}ms`, s.color, `${s.icon} ${s.label} (target <200ms)`))
  }
  if (cwv.cls !== null) {
    const s = cwvStatus(cwv.cls, 0.1, 0.25)
    cards.push(cwvCard('CLS', cwv.cls.toFixed(2), s.color, `${s.icon} ${s.label} (target <0.1)`))
  }
  if (cwv.fcp !== null) {
    const s = cwvStatus(cwv.fcp, 1800, 3000)
    cards.push(cwvCard('FCP', fmtMs(cwv.fcp), s.color, `${s.icon} ${s.label} (target <1.8s)`))
  }
  if (cwv.ttfb !== null) {
    const s = cwvStatus(cwv.ttfb, 800, 1800)
    const hdr = report.headers
    const noCache = !hdr?.cacheControl || /no-(cache|store)/.test(hdr.cacheControl)
    const sub = noCache
      ? `${s.icon} ${s.label} — no HTML caching`
      : `${s.icon} ${s.label} (target <800ms)`
    cards.push(cwvCard('TTFB', `${cwv.ttfb}ms`, s.color, sub))
  }

  const rbCount = report.css?.renderBlockingCount ?? report.html?.renderBlockingStylesheets?.length ?? 0
  if (rbCount > 0) {
    const names = (report.css?.stylesheets ?? [])
      .filter(s => s.isRenderBlocking)
      .map(s => { try { return new URL(s.url).pathname.split('/').pop()! } catch { return s.url } })
      .slice(0, 3)
      .join(', ')
    cards.push(cwvCard(
      'Render-blocking CSS',
      `${rbCount} sheet${rbCount !== 1 ? 's' : ''}`,
      '#fb923c',
      names || 'Blocking first paint',
    ))
  }

  return `<section>
  <div class="section-title">Core Web Vitals (${esc(cwvSource)})</div>
  <div class="cwv-grid">${cards.join('\n    ')}</div>
</section>`
}

function buildChartSection(report: AnalysisReport): string {
  const lcpRecs = report.recommendations
    .filter(r => (r.estimatedImpact.lcp ?? 0) > 0)
    .sort((a, b) => (b.estimatedImpact.lcp ?? 0) - (a.estimatedImpact.lcp ?? 0))
    .slice(0, 10)

  if (lcpRecs.length === 0) return ''

  const maxLcp = Math.max(...lcpRecs.map(r => r.estimatedImpact.lcp ?? 0))
  // Round up to a clean tick
  const axisMax = Math.ceil(maxLcp / 200) * 200
  const ticks = [0, axisMax * 0.25, axisMax * 0.5, axisMax * 0.75, axisMax]
    .map(t => `<span>${Math.round(t)}ms</span>`)
    .join('')

  const rows = lcpRecs.map((rec, i) => {
    const lcp = rec.estimatedImpact.lcp ?? 0
    const pct = Math.round((lcp / axisMax) * 100)
    return `<div class="chart-row">
      <div class="chart-label">${esc(truncate(rec.issue))}</div>
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="width:${pct}%;background:${barColor(i)}"></div>
        <span class="chart-value">${lcp}ms</span>
      </div>
    </div>`
  }).join('\n    ')

  return `<section>
  <div class="section-title">Estimated LCP Savings by Fix</div>
  <div class="chart">
    ${rows}
    <div class="chart-x-labels">${ticks}</div>
  </div>
</section>`
}

function buildRecsSection(report: AnalysisReport): string {
  const recs = report.recommendations.slice(0, 20)
  if (recs.length === 0) return ''

  const cards = recs.map(rec => {
    const lcpBadge = rec.estimatedImpact.lcp
      ? `<span class="badge badge-lcp">−${rec.estimatedImpact.lcp}ms LCP</span>`
      : ''
    const fcpBadge = rec.estimatedImpact.fcp && !rec.estimatedImpact.lcp
      ? `<span class="badge badge-fcp">−${rec.estimatedImpact.fcp}ms FCP</span>`
      : ''
    const diffColor = rec.difficulty === 'easy' ? '#4ade80' : rec.difficulty === 'medium' ? '#fb923c' : '#f87171'
    const catColor: Record<string, string> = {
      images: '#7c3aed', css: '#0891b2', javascript: '#b45309',
      fonts: '#0d9488', server: '#0369a1', wordpress: '#1d4ed8',
      cloudflare: '#f59e0b', html: '#4f46e5',
    }
    const catBg = catColor[rec.category] ?? '#333'

    return `<div class="rec-card">
      <div class="rec-header">
        <span class="priority-badge">P${rec.priority}</span>
        <span class="rec-title">${esc(rec.issue)}</span>
        ${lcpBadge}${fcpBadge}
        <span class="cat-badge" style="background:${catBg}22;color:${catBg};border-color:${catBg}44">${esc(rec.category)}</span>
        <span class="diff-badge" style="color:${diffColor}">${esc(rec.difficulty)}</span>
      </div>
      <div class="rec-evidence">${esc(rec.evidence)}</div>
      <div class="rec-fix"><strong>Fix:</strong> ${esc(rec.fix)}</div>
    </div>`
  }).join('\n  ')

  return `<section>
  <div class="section-title">Prioritised Recommendations (${recs.length})</div>
  ${cards}
</section>`
}

function buildErrorsSection(report: AnalysisReport): string {
  if (report.errors.length === 0) return ''
  const items = report.errors
    .map(e => `<div class="error-row">⚠ <strong>${esc(e.tool)}</strong>: ${esc(e.message)}</div>`)
    .join('')
  return `<section>
  <div class="section-title">Analysis Errors</div>
  <div class="error-box">${items}</div>
</section>`
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f0f0f;color:#d0d0d0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;padding:28px 20px}
.container{max-width:920px;margin:0 auto}
a{color:#60a5fa;text-decoration:none}
a:hover{text-decoration:underline}

/* Header */
.report-title{font-size:20px;color:#fff;font-weight:700;margin-bottom:4px}
.report-meta{font-size:12px;color:#666;margin-bottom:30px;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.platform-badge{background:#1e3a5f;color:#60a5fa;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.source-badge{background:#1a1a2e;color:#818cf8;padding:2px 8px;border-radius:4px;font-size:11px}

/* Sections */
section{margin-bottom:28px}
.section-title{font-size:10px;letter-spacing:.1em;color:#666;font-weight:700;text-transform:uppercase;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #1f1f1f}

/* Score grid */
.score-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.score-card{background:#181818;border:1px solid #252525;border-radius:8px;padding:20px 14px;text-align:center}
.score-num{font-size:44px;font-weight:800;line-height:1.1}
.score-label{font-size:11px;color:#777;margin-top:6px;font-weight:500}

/* CWV grid */
.cwv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.cwv-card{background:#181818;border:1px solid #252525;border-radius:8px;padding:14px 16px}
.cwv-name{font-size:10px;color:#777;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.cwv-value{font-size:26px;font-weight:800;line-height:1.1}
.cwv-sub{font-size:11px;margin-top:5px;font-weight:500}

/* Chart */
.chart{background:#181818;border:1px solid #252525;border-radius:8px;padding:18px 20px}
.chart-row{display:flex;align-items:center;gap:12px;margin-bottom:9px}
.chart-row:last-of-type{margin-bottom:0}
.chart-label{width:150px;min-width:150px;font-size:12px;color:#aaa;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chart-bar-wrap{display:flex;align-items:center;flex:1;gap:8px;min-width:0}
.chart-bar{height:20px;border-radius:3px;min-width:6px}
.chart-value{font-size:11px;color:#777;white-space:nowrap}
.chart-x-labels{display:flex;justify-content:space-between;padding-left:162px;margin-top:10px;font-size:10px;color:#444}

/* Recommendations */
.rec-card{background:#181818;border:1px solid #252525;border-radius:8px;padding:13px 16px;margin-bottom:8px}
.rec-header{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:7px}
.priority-badge{background:#222;border:1px solid #3a3a3a;color:#ccc;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;letter-spacing:.02em}
.rec-title{font-size:14px;color:#f0f0f0;font-weight:600;flex:1;min-width:120px}
.badge{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}
.badge-lcp{background:#14290f;color:#4ade80;border:1px solid #1c3d15}
.badge-fcp{background:#0f1e29;color:#60a5fa;border:1px solid #153048}
.cat-badge{padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;border:1px solid;text-transform:uppercase;letter-spacing:.04em}
.diff-badge{font-size:11px;font-weight:600}
.rec-evidence{font-size:12px;color:#888;margin-bottom:7px;padding:8px 10px;background:#121212;border-radius:4px;border-left:2px solid #2a2a2a}
.rec-fix{font-size:12px;color:#b0b0b0}
.rec-fix strong{color:#d0d0d0}

/* Errors */
.error-box{background:#181818;border:1px solid #2a2a2a;border-radius:8px;padding:14px 16px}
.error-row{color:#f87171;font-size:12px;margin-bottom:4px}
.error-row:last-child{margin-bottom:0}

@media(max-width:640px){
  .score-grid{grid-template-columns:repeat(2,1fr)}
  .cwv-grid{grid-template-columns:repeat(2,1fr)}
  .chart-label{width:90px;min-width:90px}
  .chart-x-labels{padding-left:102px}
}
`

// ─── Main HTML builder ────────────────────────────────────────────────────────

function buildHtml(report: AnalysisReport): string {
  const domain = getDomain(report.url)
  const platform = report.cms?.cms && report.cms.cms !== 'unknown' ? report.cms.cms : null
  const date = new Date(report.analyzedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const cwvSource = report.coreWebVitals?.source === 'field' ? 'Field Data' : 'Lab Data'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Performance Report — ${esc(domain)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="container">

<h1 class="report-title">Performance Report</h1>
<div class="report-meta">
  <a href="${esc(report.url)}">${esc(report.url)}</a>
  <span>·</span>
  <span>${esc(date)}</span>
  ${platform ? `<span class="platform-badge">${esc(platform)}</span>` : ''}
  <span class="source-badge">${esc(cwvSource)}</span>
</div>

${report.scores ? buildScoreSection(report.scores) : ''}
${report.coreWebVitals ? buildCwvSection(report, cwvSource) : ''}
${buildChartSection(report)}
${buildRecsSection(report)}
${buildErrorsSection(report)}

</div>
</body>
</html>`
}
