import { load } from 'cheerio'
import type { HtmlAnalysis, HtmlIssue } from '../types.js'

export async function analyzeHtml(url: string): Promise<HtmlAnalysis> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })

  const html = await response.text()
  const $ = load(html)
  const issues: HtmlIssue[] = []

  // ── Title ────────────────────────────────────────────────────────────────
  const title = $('title').first().text().trim() || null
  if (!title) {
    issues.push({ type: 'missing_title', description: 'Page has no <title> tag.', severity: 'high' })
  }

  // ── Meta description ───────────────────────────────────────────────────────
  const metaDescription = $('meta[name="description"]').attr('content') ?? null
  if (!metaDescription) {
    issues.push({ type: 'missing_meta_description', description: 'No <meta name="description"> found.', severity: 'medium' })
  }

  // ── Canonical ──────────────────────────────────────────────────────────────
  const hasCanonical = $('link[rel="canonical"]').length > 0

  // ── Viewport ───────────────────────────────────────────────────────────────
  const hasViewport = $('meta[name="viewport"]').length > 0
  if (!hasViewport) {
    issues.push({ type: 'missing_viewport', description: 'No <meta name="viewport"> tag. Mobile rendering will be broken.', severity: 'high' })
  }

  // ── H1 count ───────────────────────────────────────────────────────────────
  const h1Count = $('h1').length
  if (h1Count === 0) {
    issues.push({ type: 'missing_h1', description: 'Page has no <h1> element.', severity: 'medium' })
  } else if (h1Count > 1) {
    issues.push({ type: 'multiple_h1', description: `Page has ${h1Count} <h1> elements. Use a single H1 for clarity.`, severity: 'low' })
  }

  // ── Render-blocking stylesheets ────────────────────────────────────────────
  // A <link rel="stylesheet"> in <head> without media="print" blocks rendering
  const renderBlockingStylesheets: string[] = []
  $('head link[rel="stylesheet"]').each((_, el) => {
    const media = $(el).attr('media')
    const href = $(el).attr('href') ?? ''
    if (!media || media === 'all' || media === 'screen') {
      renderBlockingStylesheets.push(href)
    }
  })

  if (renderBlockingStylesheets.length > 0) {
    issues.push({
      type: 'render_blocking_stylesheets',
      description: `${renderBlockingStylesheets.length} render-blocking stylesheet(s) in <head>. Consider inlining critical CSS and deferring the rest.`,
      severity: 'high',
    })
  }

  // ── Render-blocking and deferred scripts ───────────────────────────────────
  const renderBlockingScripts: string[] = []
  let deferredScripts = 0
  let asyncScripts = 0
  let inlineScriptCount = 0
  let totalExternalScripts = 0

  $('script').each((_, el) => {
    const src = $(el).attr('src')
    const defer = $(el).attr('defer') !== undefined
    const async_ = $(el).attr('async') !== undefined
    const type = $(el).attr('type') ?? ''

    // Skip module scripts and non-JS types
    if (type === 'module' || type === 'application/json' || type === 'text/template') return

    if (!src) {
      inlineScriptCount++
      return
    }

    totalExternalScripts++

    if (defer) {
      deferredScripts++
    } else if (async_) {
      asyncScripts++
    } else {
      // Synchronous external script — render-blocking
      renderBlockingScripts.push(src)
    }
  })

  if (renderBlockingScripts.length > 0) {
    issues.push({
      type: 'render_blocking_scripts',
      description: `${renderBlockingScripts.length} synchronous <script> tag(s) without defer/async. Add defer or async to avoid blocking rendering.`,
      severity: 'high',
    })
  }

  // ── Preload hints ──────────────────────────────────────────────────────────
  const preloads = $('link[rel="preload"]').length
  if (preloads === 0 && renderBlockingStylesheets.length > 0) {
    issues.push({
      type: 'no_preload_hints',
      description: 'No <link rel="preload"> hints found. Consider preloading the LCP image and critical fonts.',
      severity: 'medium',
    })
  }

  return {
    url,
    title,
    metaDescription,
    hasCanonical,
    hasViewport,
    h1Count,
    renderBlockingStylesheets,
    renderBlockingScripts,
    inlineScriptCount,
    totalExternalScripts,
    deferredScripts,
    asyncScripts,
    issues,
  }
}
