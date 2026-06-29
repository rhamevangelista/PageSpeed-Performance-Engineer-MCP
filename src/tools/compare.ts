import type { AnalysisReport, ComparisonReport, MetricDelta } from '../types.js'

export function compareReports(before: AnalysisReport, after: AnalysisReport): ComparisonReport {
  const scoreDeltas: MetricDelta[] = []
  const cwvDeltas: MetricDelta[] = []

  // ── Lighthouse score deltas ───────────────────────────────────────────────────
  if (before.scores && after.scores) {
    for (const key of ['performance', 'accessibility', 'bestPractices', 'seo'] as const) {
      const b = before.scores[key]
      const a = after.scores[key]
      scoreDeltas.push({
        metric: key,
        before: b,
        after: a,
        delta: a - b,
        improved: a > b,
      })
    }
  }

  // ── Core Web Vitals deltas (lower is better for all) ─────────────────────────
  if (before.coreWebVitals && after.coreWebVitals) {
    const metrics: { key: 'lcp' | 'cls' | 'inp' | 'fcp' | 'ttfb'; label: string }[] = [
      { key: 'lcp', label: 'LCP (ms)' },
      { key: 'cls', label: 'CLS' },
      { key: 'inp', label: 'INP (ms)' },
      { key: 'fcp', label: 'FCP (ms)' },
      { key: 'ttfb', label: 'TTFB (ms)' },
    ]
    for (const m of metrics) {
      const b = before.coreWebVitals[m.key]
      const a = after.coreWebVitals[m.key]
      if (b === null && a === null) continue
      const delta = b !== null && a !== null ? a - b : null
      cwvDeltas.push({
        metric: m.label,
        before: b,
        after: a,
        delta,
        improved: delta !== null ? delta < 0 : null,
      })
    }
  }

  // ── New vs resolved issues ────────────────────────────────────────────────────
  const beforeIssues = new Set(before.recommendations.map(r => r.issue))
  const afterIssues = new Set(after.recommendations.map(r => r.issue))
  const newIssues = after.recommendations
    .filter(r => !beforeIssues.has(r.issue))
    .map(r => r.issue)
  const resolvedIssues = before.recommendations
    .filter(r => !afterIssues.has(r.issue))
    .map(r => r.issue)

  // ── Summary sentence ──────────────────────────────────────────────────────────
  const perfBefore = before.scores?.performance ?? null
  const perfAfter = after.scores?.performance ?? null
  let summary = ''
  if (perfBefore !== null && perfAfter !== null) {
    const delta = perfAfter - perfBefore
    if (delta > 0) summary = `Performance improved by ${delta} points (${perfBefore} → ${perfAfter}). `
    else if (delta < 0) summary = `Performance regressed by ${Math.abs(delta)} points (${perfBefore} → ${perfAfter}). `
    else summary = `Performance score unchanged at ${perfBefore}. `
  }
  summary += `${resolvedIssues.length} issue(s) resolved, ${newIssues.length} new issue(s) found.`

  return {
    url_before: before.url,
    url_after: after.url,
    analyzed_at: new Date().toISOString(),
    score_deltas: scoreDeltas,
    cwv_deltas: cwvDeltas,
    recommendations_before: before.recommendations.length,
    recommendations_after: after.recommendations.length,
    new_issues: newIssues,
    resolved_issues: resolvedIssues,
    summary,
  }
}
