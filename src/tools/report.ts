import type { AnalysisReport, Recommendation } from '../types.js'
import { analyzeWebsite } from './recommendations.js'

export async function generateReport(url: string): Promise<string> {
  const report = await analyzeWebsite(url)
  return formatMarkdownReport(report)
}

export function formatMarkdownReport(report: AnalysisReport): string {
  const lines: string[] = []

  lines.push(`# Web Performance Report`)
  lines.push(`**URL:** ${report.url}  `)
  lines.push(`**Analyzed:** ${new Date(report.analyzedAt).toUTCString()}`)
  lines.push('')

  // ── Lighthouse scores ────────────────────────────────────────────────────────
  if (report.scores) {
    const s = report.scores
    lines.push('## Lighthouse Scores')
    lines.push('')
    lines.push('| Metric | Score |')
    lines.push('|--------|-------|')
    lines.push(`| Performance | ${scoreBar(s.performance)} ${s.performance}/100 |`)
    lines.push(`| Accessibility | ${scoreBar(s.accessibility)} ${s.accessibility}/100 |`)
    lines.push(`| Best Practices | ${scoreBar(s.bestPractices)} ${s.bestPractices}/100 |`)
    lines.push(`| SEO | ${scoreBar(s.seo)} ${s.seo}/100 |`)
    lines.push('')
  }

  // ── Core Web Vitals ──────────────────────────────────────────────────────────
  if (report.coreWebVitals) {
    const cwv = report.coreWebVitals
    lines.push('## Core Web Vitals')
    lines.push(`*Source: ${cwv.source === 'field' ? 'Real user data (CrUX)' : 'Lab simulation (Lighthouse)'}*`)
    lines.push('')
    lines.push('| Metric | Value | Rating |')
    lines.push('|--------|-------|--------|')
    if (cwv.lcp !== null) lines.push(`| LCP (Largest Contentful Paint) | ${(cwv.lcp / 1000).toFixed(2)}s | ${cwvRating(cwv.lcp, 2500, 4000)} |`)
    if (cwv.cls !== null) lines.push(`| CLS (Cumulative Layout Shift) | ${cwv.cls.toFixed(3)} | ${cwvRating(cwv.cls, 0.1, 0.25)} |`)
    if (cwv.inp !== null) lines.push(`| INP (Interaction to Next Paint) | ${cwv.inp}ms | ${cwvRating(cwv.inp, 200, 500)} |`)
    if (cwv.fcp !== null) lines.push(`| FCP (First Contentful Paint) | ${(cwv.fcp / 1000).toFixed(2)}s | ${cwvRating(cwv.fcp, 1800, 3000)} |`)
    if (cwv.ttfb !== null) lines.push(`| TTFB (Time to First Byte) | ${cwv.ttfb}ms | ${cwvRating(cwv.ttfb, 800, 1800)} |`)
    lines.push('')
  }

  // ── Platform ─────────────────────────────────────────────────────────────────
  if (report.cms) {
    lines.push('## Platform')
    if (report.cms.cms !== 'unknown') {
      lines.push(`**${report.cms.cms}** detected (${Math.round(report.cms.confidence * 100)}% confidence)`)
      if (report.cms.hosting) lines.push(`Hosting: ${report.cms.hosting}`)
      if (report.cms.plugins.length > 0) lines.push(`Plugins detected: ${report.cms.plugins.slice(0, 5).join(', ')}`)
    } else {
      lines.push('Platform not identified.')
    }
    lines.push('')
  }

  // ── Cloudflare ───────────────────────────────────────────────────────────────
  if (report.cloudflare) {
    const cf = report.cloudflare
    lines.push('## CDN & Infrastructure')
    if (cf.isCloudflare) {
      const features: string[] = [
        cf.brotliEnabled ? '✓ Brotli' : '✗ Brotli',
        cf.http3Enabled ? '✓ HTTP/3' : '✗ HTTP/3',
        cf.earlyHintsEnabled ? '✓ Early Hints' : '✗ Early Hints',
      ]
      lines.push(`Cloudflare detected — CF-Cache-Status: **${cf.cacheStatus ?? 'unknown'}**`)
      lines.push(`Features: ${features.join(' | ')}`)
    } else {
      lines.push('Cloudflare not detected. Consider proxying through Cloudflare for global CDN, Brotli compression, and HTTP/3.')
    }
    lines.push('')
  }

  // ── Image summary ────────────────────────────────────────────────────────────
  if (report.images && (report.images.images.length > 0 || report.images.totalSavingsBytes > 0)) {
    const { images, totalSavingsBytes, totalSavingsMs } = report.images
    lines.push('## Image Summary')
    lines.push(`${images.length} image(s) with issues detected.`)
    if (totalSavingsBytes > 0) {
      lines.push(`Estimated savings: **${formatBytes(totalSavingsBytes)}** (~${totalSavingsMs}ms LCP improvement)`)
    }
    const lcpImg = images.find(i => i.isLCPCandidate)
    if (lcpImg) {
      lines.push(`LCP candidate: \`${lcpImg.src.split('/').pop()}\` — ${lcpImg.format?.toUpperCase() ?? 'unknown format'}, ${lcpImg.displayWidth}×${lcpImg.displayHeight}px displayed`)
    }
    lines.push('')
  }

  // ── JS summary ───────────────────────────────────────────────────────────────
  if (report.js) {
    const { unusedJSPercent, thirdPartyScripts, scripts } = report.js
    const totalJsKB = Math.round(scripts.reduce((a, s) => a + (s.sizeBytes ?? 0), 0) / 1000)
    lines.push('## JavaScript Summary')
    lines.push(`Total JS: **${totalJsKB}KB** | Unused: **${unusedJSPercent}%**`)
    if (thirdPartyScripts.length > 0) {
      lines.push(`Third-party scripts (${thirdPartyScripts.length}): ${thirdPartyScripts.map(s => s.vendor).join(', ')}`)
    }
    lines.push('')
  }

  // ── CSS summary ──────────────────────────────────────────────────────────────
  if (report.css) {
    const { unusedCSSPercent, renderBlockingCount, stylesheets } = report.css
    const totalCssKB = Math.round(stylesheets.reduce((a, s) => a + (s.sizeBytes ?? 0), 0) / 1000)
    lines.push('## CSS Summary')
    lines.push(`Total CSS: **${totalCssKB}KB** | Unused: **${unusedCSSPercent}%** | Render-blocking sheets: **${renderBlockingCount}**`)
    lines.push('')
  }

  // ── Font summary ─────────────────────────────────────────────────────────────
  if (report.fonts && report.fonts.issues.length > 0) {
    lines.push('## Font Summary')
    if (report.fonts.hasGoogleFontsImport) lines.push('⚠ Google Fonts loaded via CSS @import — blocks rendering.')
    if (!report.fonts.hasGoogleFontsPreconnect) lines.push('⚠ Missing preconnect for Google Fonts.')
    if (report.fonts.fonts.length > 0) {
      const woff2Count = report.fonts.fonts.filter(f => f.isWOFF2).length
      lines.push(`Self-hosted fonts: ${report.fonts.fonts.length} (${woff2Count} in WOFF2 format)`)
    }
    lines.push('')
  }

  // ── Recommendations ──────────────────────────────────────────────────────────
  if (report.recommendations.length > 0) {
    lines.push('## Prioritized Recommendations')
    lines.push('')
    for (const rec of report.recommendations) {
      lines.push(`### ${rec.priority}. ${rec.issue}`)
      lines.push(`**Category:** \`${rec.category}\` | **Difficulty:** ${rec.difficulty} | **Est. Impact:** ${formatImpact(rec)}`)
      lines.push('')
      lines.push(`> ${rec.evidence}`)
      lines.push('')
      lines.push(`**Fix:** ${rec.fix}`)
      if (rec.learnMore) lines.push(`[Learn more →](${rec.learnMore})`)
      lines.push('')
      lines.push('---')
      lines.push('')
    }
  }

  // ── Errors ───────────────────────────────────────────────────────────────────
  if (report.errors.length > 0) {
    lines.push('## Analysis Errors')
    for (const err of report.errors) {
      lines.push(`- \`${err.tool}\`: ${err.message}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreBar(score: number): string {
  if (score >= 90) return '🟢'
  if (score >= 50) return '🟠'
  return '🔴'
}

function cwvRating(value: number, goodThreshold: number, poorThreshold: number): string {
  if (value <= goodThreshold) return '✅ Good'
  if (value <= poorThreshold) return '⚠️ Needs improvement'
  return '❌ Poor'
}

function formatImpact(rec: Recommendation): string {
  const parts: string[] = []
  if (rec.estimatedImpact.lcp) parts.push(`LCP −${rec.estimatedImpact.lcp}ms`)
  if (rec.estimatedImpact.fcp) parts.push(`FCP −${rec.estimatedImpact.fcp}ms`)
  if (rec.estimatedImpact.inp) parts.push(`INP −${rec.estimatedImpact.inp}ms`)
  if (rec.estimatedImpact.cls) parts.push(`CLS −${rec.estimatedImpact.cls.toFixed(2)}`)
  return parts.join(', ') || 'marginal'
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)}KB`
  return `${bytes}B`
}
