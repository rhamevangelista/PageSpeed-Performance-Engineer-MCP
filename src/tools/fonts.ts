import { load } from 'cheerio'
import type { FontAnalysis, FontInfo, FontIssue } from '../types.js'

const GOOGLE_FONTS_DOMAIN = 'fonts.googleapis.com'
const GOOGLE_FONTS_STATIC = 'fonts.gstatic.com'

export async function analyzeFonts(url: string): Promise<FontAnalysis> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })

  const html = await response.text()
  const $ = load(html)
  const issues: FontIssue[] = []
  const fonts: FontInfo[] = []

  // ── Google Fonts preconnect ────────────────────────────────────────────────
  const hasGoogleFontsPreconnect =
    $(`link[rel="preconnect"][href*="${GOOGLE_FONTS_DOMAIN}"]`).length > 0 ||
    $(`link[rel="dns-prefetch"][href*="${GOOGLE_FONTS_DOMAIN}"]`).length > 0

  // ── Google Fonts @import detection ────────────────────────────────────────
  // @import in CSS is the worst-case scenario: blocks rendering until the import resolves
  let hasGoogleFontsImport = false

  // Check inline <style> tags for @import
  $('style').each((_, el) => {
    const css = $(el).html() ?? ''
    if (css.includes(`@import`) && css.includes(GOOGLE_FONTS_DOMAIN)) {
      hasGoogleFontsImport = true
    }
  })

  // Also check external stylesheets (fetch up to 5 to keep it fast)
  const stylesheetLinks: string[] = []
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (href && !href.includes(GOOGLE_FONTS_DOMAIN)) {
      try {
        stylesheetLinks.push(new URL(href, url).href)
      } catch {
        // skip malformed URLs
      }
    }
  })

  const cssCheckPromises = stylesheetLinks.slice(0, 5).map(async (cssUrl) => {
    try {
      const res = await fetch(cssUrl, { signal: AbortSignal.timeout(8_000) })
      const text = await res.text()
      if (text.includes('@import') && text.includes(GOOGLE_FONTS_DOMAIN)) {
        hasGoogleFontsImport = true
      }
      return text
    } catch {
      return ''
    }
  })

  const cssTexts = await Promise.all(cssCheckPromises)

  if (hasGoogleFontsImport) {
    issues.push({
      type: 'css_import',
      description: 'Google Fonts is loaded via CSS @import, which blocks rendering. Use <link rel="stylesheet"> with preconnect instead.',
      severity: 'high',
    })
  }

  // ── Google Fonts <link> tags → should have preconnect ─────────────────────
  const googleFontsLinks = $(`link[rel="stylesheet"][href*="${GOOGLE_FONTS_DOMAIN}"]`)

  if (googleFontsLinks.length > 0 && !hasGoogleFontsPreconnect) {
    issues.push({
      type: 'missing_preconnect',
      description: 'Google Fonts stylesheet detected but no <link rel="preconnect" href="https://fonts.googleapis.com"> found. Add preconnect to reduce connection latency.',
      severity: 'high',
    })
  }

  if (googleFontsLinks.length > 0) {
    // Check for fonts.gstatic.com preconnect (needed for font files)
    const hasStaticPreconnect = $(`link[rel="preconnect"][href*="${GOOGLE_FONTS_STATIC}"]`).length > 0
    if (!hasStaticPreconnect) {
      issues.push({
        type: 'missing_preconnect',
        description: 'Missing <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin> for font files from fonts.gstatic.com.',
        severity: 'medium',
      })
    }

    // Google Fonts should use display=swap in the URL
    googleFontsLinks.each((_, el) => {
      const href = $(el).attr('href') ?? ''
      if (!href.includes('display=swap') && !href.includes('display=optional')) {
        issues.push({
          type: 'missing_font_display',
          description: 'Google Fonts URL missing display=swap. Add &display=swap to prevent invisible text during load (FOIT).',
          severity: 'medium',
        })
      }
    })
  }

  // ── Self-hosted font analysis ─────────────────────────────────────────────
  // Parse @font-face blocks from all collected CSS texts
  const allCSS = cssTexts.join('\n') + $('style').map((_, el) => $(el).html()).toArray().join('\n')
  const fontFaceBlocks = extractFontFaceBlocks(allCSS)

  for (const block of fontFaceBlocks) {
    const srcUrls = extractFontSrcUrls(block)
    const fontDisplay = extractFontDisplay(block)

    for (const fontUrl of srcUrls) {
      const isWOFF2 = fontUrl.includes('.woff2') || block.includes("format('woff2')")
      const isPreloaded = $(`link[rel="preload"][href*="${fontUrl.split('/').pop()}"]`).length > 0

      if (!isWOFF2) {
        issues.push({
          type: 'not_woff2',
          description: `Font not in WOFF2 format: ${fontUrl.split('/').pop() ?? fontUrl}. WOFF2 is 30% smaller than WOFF.`,
          severity: 'medium',
        })
      }

      if (!fontDisplay) {
        issues.push({
          type: 'missing_font_display',
          description: `Missing font-display property in @font-face for ${fontUrl.split('/').pop() ?? fontUrl}. Add font-display: swap or optional.`,
          severity: 'medium',
        })
      }

      fonts.push({
        url: fontUrl,
        format: isWOFF2 ? 'woff2' : guessFormat(fontUrl),
        isWOFF2,
        fontDisplay: fontDisplay ?? null,
        isPreloaded,
      })

      if (!isPreloaded && isWOFF2) {
        issues.push({
          type: 'not_preloaded',
          description: `Primary font ${fontUrl.split('/').pop()} is not preloaded. Add <link rel="preload" as="font" type="font/woff2" href="${fontUrl}" crossorigin> to the <head>.`,
          severity: 'low',
        })
      }
    }
  }

  // Deduplicate issues by type+description
  const seen = new Set<string>()
  const dedupedIssues = issues.filter((i) => {
    const key = `${i.type}:${i.description}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    url,
    fonts,
    hasGoogleFontsPreconnect,
    hasGoogleFontsImport,
    issues: dedupedIssues,
  }
}

// ── CSS parsing helpers ───────────────────────────────────────────────────────

function extractFontFaceBlocks(css: string): string[] {
  const blocks: string[] = []
  let i = 0
  while (i < css.length) {
    const idx = css.indexOf('@font-face', i)
    if (idx === -1) break
    let depth = 0
    let start = idx
    for (let j = idx; j < css.length; j++) {
      if (css[j] === '{') {
        if (depth === 0) start = j
        depth++
      } else if (css[j] === '}') {
        depth--
        if (depth === 0) {
          blocks.push(css.slice(start, j + 1))
          i = j + 1
          break
        }
      }
    }
    if (depth !== 0) break
  }
  return blocks
}

function extractFontSrcUrls(block: string): string[] {
  const urls: string[] = []
  const urlRegex = /url\(['"]?([^'")\s]+\.(?:woff2?|ttf|otf|eot))['"]?\)/gi
  let match: RegExpExecArray | null
  while ((match = urlRegex.exec(block)) !== null) {
    urls.push(match[1])
  }
  return [...new Set(urls)]
}

function extractFontDisplay(block: string): string | undefined {
  const match = /font-display\s*:\s*(\w+)/.exec(block)
  return match?.[1]
}

function guessFormat(url: string): string | null {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  return ext ?? null
}
