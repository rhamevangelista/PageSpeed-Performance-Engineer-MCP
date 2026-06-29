import { load } from 'cheerio'
import { newContext } from '../browser.js'
import type { CSSAnalysis, StylesheetInfo, CSSIssue } from '../types.js'

// Known framework bundle patterns (URL fragment → framework name)
const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/bootstrap(?!\.min\.css)/, 'Bootstrap'],
  [/bootstrap\.min\.css/, 'Bootstrap'],
  [/foundation\.css/, 'Foundation'],
  [/bulma\.css/, 'Bulma'],
  [/tailwind(?!\.min)/, 'Tailwind CSS (full build — use JIT/purge)'],
  [/materialize\.css/, 'Materialize'],
  [/semantic\.min\.css/, 'Semantic UI'],
]

interface CoverageEntry {
  url: string
  text: string
  ranges: Array<{ start: number; end: number }>
}

export async function analyzeCSS(url: string): Promise<CSSAnalysis> {
  const ctx = await newContext()
  const page = await ctx.newPage()
  const issues: CSSIssue[] = []

  try {
    // Start coverage BEFORE navigation
    await page.coverage.startCSSCoverage()

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })

    const coverageEntries = (await page.coverage.stopCSSCoverage()) as CoverageEntry[]

    // ── Cheerio: fetch raw HTML for render-blocking link tags ─────────────
    const html = await page.content()
    const $ = load(html)

    const renderBlockingUrls = new Set<string>()
    $('head link[rel="stylesheet"]').each((_, el) => {
      const media = $(el).attr('media')
      const href = $(el).attr('href') ?? ''
      if (!media || media === 'all' || media === 'screen') {
        renderBlockingUrls.add(resolveUrl(href, url))
      }
    })

    // ── Process each stylesheet ───────────────────────────────────────────
    const stylesheets: StylesheetInfo[] = []
    let totalUsed = 0
    let totalText = 0

    for (const entry of coverageEntries) {
      if (!entry.url || entry.url.startsWith('data:')) continue

      const textLength = entry.text.length
      const usedLength = entry.ranges.reduce((acc, r) => acc + (r.end - r.start), 0)
      const usedPercent = textLength > 0 ? Math.round((usedLength / textLength) * 100) : 100

      totalText += textLength
      totalUsed += usedLength

      const isRenderBlocking = renderBlockingUrls.has(entry.url)

      // Check for known frameworks
      let isFramework: string | null = null
      for (const [pattern, name] of FRAMEWORK_PATTERNS) {
        if (pattern.test(entry.url)) {
          isFramework = name
          break
        }
      }

      // Estimate size (byte length of CSS text is close enough without gzip)
      const sizeBytes = new TextEncoder().encode(entry.text).length

      stylesheets.push({
        url: entry.url,
        sizeBytes,
        usedPercent,
        isRenderBlocking,
        isFramework,
      })

      // ── Issue detection ───────────────────────────────────────────────
      if (isRenderBlocking) {
        issues.push({
          type: 'render_blocking',
          description: `Render-blocking stylesheet: ${shortenUrl(entry.url)}`,
          url: entry.url,
          severity: 'high',
        })
      }

      if (usedPercent < 30 && sizeBytes > 10_000) {
        issues.push({
          type: 'unused_css',
          description: `${100 - usedPercent}% of ${formatBytes(sizeBytes)} CSS unused in ${shortenUrl(entry.url)}`,
          url: entry.url,
          severity: usedPercent < 10 ? 'high' : 'medium',
        })
      }

      if (isFramework && sizeBytes > 50_000) {
        issues.push({
          type: 'large_framework',
          description: `${isFramework} bundle (${formatBytes(sizeBytes)}) detected — only ${usedPercent}% used. Purge unused rules or use a utility-first approach.`,
          url: entry.url,
          severity: 'medium',
        })
      }
    }

    // ── Overall unused CSS ─────────────────────────────────────────────────
    const unusedCSSPercent = totalText > 0 ? Math.round(((totalText - totalUsed) / totalText) * 100) : 0

    // ── Critical CSS detection ─────────────────────────────────────────────
    // Simple heuristic: if there are render-blocking stylesheets and no <style> in head > 2KB
    const inlineStyles = $('head style')
    let largestInlineStyle = 0
    inlineStyles.each((_, el) => {
      largestInlineStyle = Math.max(largestInlineStyle, ($(el).html() ?? '').length)
    })
    const hasCriticalCSS = largestInlineStyle > 2_000

    if (!hasCriticalCSS && renderBlockingUrls.size > 0) {
      issues.push({
        type: 'no_critical_css',
        description: 'No critical CSS inlined in <head>. Above-the-fold rendering is blocked by external stylesheets.',
        severity: 'high',
      })
    }

    return {
      url,
      stylesheets,
      unusedCSSPercent,
      renderBlockingCount: renderBlockingUrls.size,
      hasCriticalCSS,
      issues,
    }
  } finally {
    await ctx.close()
  }
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href
  } catch {
    return href
  }
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/')
    return parts[parts.length - 1] || u.hostname
  } catch {
    return url.slice(0, 60)
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)}KB`
  return `${bytes}B`
}
