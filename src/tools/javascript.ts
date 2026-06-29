import { load } from 'cheerio'
import { newContext } from '../browser.js'
import type { JSAnalysis, ScriptInfo, ThirdPartyScript, JSIssue } from '../types.js'

// Known third-party vendor patterns
const THIRD_PARTY_VENDORS: Array<{ pattern: RegExp; vendor: string; category: ThirdPartyScript['category'] }> = [
  { pattern: /google-analytics\.com|googletagmanager\.com|gtag\/js/, vendor: 'Google Analytics / GTM', category: 'analytics' },
  { pattern: /connect\.facebook\.net|fbevents\.js/, vendor: 'Facebook Pixel', category: 'marketing' },
  { pattern: /hotjar\.com/, vendor: 'Hotjar', category: 'analytics' },
  { pattern: /intercom\.io|intercomcdn\.com/, vendor: 'Intercom', category: 'support' },
  { pattern: /static\.zdassets\.com|zendesk\.com/, vendor: 'Zendesk', category: 'support' },
  { pattern: /cdn\.segment\.com/, vendor: 'Segment', category: 'analytics' },
  { pattern: /js\.stripe\.com/, vendor: 'Stripe', category: 'other' },
  { pattern: /platform\.twitter\.com|twq\.js/, vendor: 'Twitter/X', category: 'social' },
  { pattern: /snap\.licdn\.com|linkedin\.com\/insight/, vendor: 'LinkedIn', category: 'marketing' },
  { pattern: /static\.klaviyo\.com/, vendor: 'Klaviyo', category: 'marketing' },
  { pattern: /cdn\.shopify\.com/, vendor: 'Shopify', category: 'other' },
  { pattern: /maps\.googleapis\.com/, vendor: 'Google Maps', category: 'other' },
  { pattern: /youtube\.com\/iframe_api|ytimg\.com/, vendor: 'YouTube', category: 'other' },
  { pattern: /tiktok\.com\/i18n\/pixel/, vendor: 'TikTok Pixel', category: 'marketing' },
  { pattern: /clarity\.ms/, vendor: 'Microsoft Clarity', category: 'analytics' },
]

// Playwright JS coverage uses a different shape than CSS coverage
interface JSCoverageEntry {
  url: string
  scriptId: string
  source?: string
  functions: Array<{
    functionName: string
    isBlockCoverage: boolean
    ranges: Array<{ count: number; startOffset: number; endOffset: number }>
  }>
}

export async function analyzeJavaScript(url: string): Promise<JSAnalysis> {
  const ctx = await newContext()
  const page = await ctx.newPage()
  const issues: JSIssue[] = []

  try {
    // Start JS coverage BEFORE navigation
    await page.coverage.startJSCoverage({ resetOnNavigation: false })

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })

    const coverageEntries = (await page.coverage.stopJSCoverage()) as unknown as JSCoverageEntry[]

    // Parse the HTML to get script loading attributes
    const html = await page.content()
    const $ = load(html)
    const pageOrigin = new URL(url).origin

    // Build a map of script src → {defer, async} from raw HTML
    const scriptAttrs = new Map<string, { defer: boolean; async: boolean }>()
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src') ?? ''
      const defer = $(el).attr('defer') !== undefined
      const async_ = $(el).attr('async') !== undefined
      try {
        const resolved = new URL(src, url).href
        scriptAttrs.set(resolved, { defer, async: async_ })
      } catch {
        scriptAttrs.set(src, { defer, async: async_ })
      }
    })

    const scripts: ScriptInfo[] = []
    const thirdPartyScripts: ThirdPartyScript[] = []
    let totalText = 0
    let totalUsed = 0
    let largestBundleBytes = 0

    for (const entry of coverageEntries) {
      if (!entry.url || entry.url.startsWith('data:') || entry.url.startsWith('extensions::')) continue
      if (entry.url.includes('playwright') || entry.url.includes('__pwInitScripts')) continue

      const source = entry.source ?? ''
      const textLength = source.length

      // Flatten per-function ranges and sum bytes with count > 0
      const usedLength = entry.functions.reduce((acc, fn) => {
        const usedInFn = fn.ranges
          .filter((r) => r.count > 0)
          .reduce((a, r) => a + (r.endOffset - r.startOffset), 0)
        return acc + usedInFn
      }, 0)

      const usedPercent = textLength > 0 ? Math.round((usedLength / textLength) * 100) : 100
      const sizeBytes = new TextEncoder().encode(source).length

      totalText += textLength
      totalUsed += usedLength

      const attrs = scriptAttrs.get(entry.url) ?? { defer: false, async: false }
      const isThirdParty = !entry.url.startsWith(pageOrigin) && !entry.url.startsWith('/')
      const isRenderBlocking = !attrs.defer && !attrs.async && isFirstParty(entry.url, pageOrigin)

      // Check for third-party vendor match
      for (const vendor of THIRD_PARTY_VENDORS) {
        if (vendor.pattern.test(entry.url)) {
          thirdPartyScripts.push({
            domain: new URL(entry.url).hostname,
            vendor: vendor.vendor,
            sizeBytes,
            category: vendor.category,
          })
          break
        }
      }

      scripts.push({
        url: entry.url,
        sizeBytes,
        usedPercent,
        isDeferred: attrs.defer,
        isAsync: attrs.async,
        isRenderBlocking,
        isThirdParty,
      })

      if (sizeBytes > largestBundleBytes) largestBundleBytes = sizeBytes

      // Issue detection
      if (isRenderBlocking && sizeBytes > 5_000) {
        issues.push({
          type: 'render_blocking',
          description: `Render-blocking script: ${shortenUrl(entry.url)} (${formatBytes(sizeBytes)})`,
          url: entry.url,
          severity: 'high',
        })
      }

      if (usedPercent < 30 && sizeBytes > 20_000 && !isThirdParty) {
        issues.push({
          type: 'unused_js',
          description: `${100 - usedPercent}% of ${formatBytes(sizeBytes)} unused in ${shortenUrl(entry.url)}`,
          url: entry.url,
          severity: usedPercent < 15 ? 'high' : 'medium',
        })
      }

      if (sizeBytes > 150_000 && !isThirdParty) {
        issues.push({
          type: 'large_bundle',
          description: `Large JS bundle: ${shortenUrl(entry.url)} is ${formatBytes(sizeBytes)}. Consider code splitting.`,
          url: entry.url,
          severity: sizeBytes > 300_000 ? 'high' : 'medium',
        })
      }
    }

    // Flag third-party scripts that load synchronously
    for (const tp of thirdPartyScripts) {
      const src = scripts.find((s) => s.url?.includes(tp.domain))
      if (src && !src.isDeferred && !src.isAsync) {
        issues.push({
          type: 'sync_third_party',
          description: `${tp.vendor} loads synchronously. Add defer or async to avoid blocking rendering.`,
          severity: 'high',
        })
      }
    }

    const unusedJSPercent = totalText > 0 ? Math.round(((totalText - totalUsed) / totalText) * 100) : 0

    return {
      url,
      scripts,
      unusedJSPercent,
      thirdPartyScripts,
      issues,
    }
  } finally {
    await ctx.close()
  }
}

function isFirstParty(scriptUrl: string, origin: string): boolean {
  try {
    return new URL(scriptUrl).origin === origin
  } catch {
    return true
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
