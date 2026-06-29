import type { CMSDetection } from '../types.js'
import { analyzeCloudflare } from './cloudflare.js'
import { detectCMS } from './cms.js'

export interface CloudflareRulesOutput {
  domain: string
  is_cloudflare: boolean
  settings: CloudflareSettingStep[]
  cache_rules: CloudflareRule[]
  transform_rules: CloudflareRule[]
  notes: string[]
}

export interface CloudflareSettingStep {
  setting: string
  recommended_value: string
  current_status: string | null
  priority: 'critical' | 'high' | 'medium'
}

export interface CloudflareRule {
  name: string
  expression: string
  action: string
  action_parameters: Record<string, unknown>
  rationale: string
}

export async function generateCloudflareRules(url: string): Promise<CloudflareRulesOutput> {
  const [cf, cms] = await Promise.all([
    analyzeCloudflare(url),
    detectCMS(url).catch((): CMSDetection => ({ cms: 'unknown', confidence: 0, signals: [], plugins: [], hosting: null })),
  ])

  let domain: string
  try {
    domain = new URL(url).hostname
  } catch {
    domain = url
  }

  const notes: string[] = []
  const settings: CloudflareSettingStep[] = []
  const cacheRules: CloudflareRule[] = []
  const transformRules: CloudflareRule[] = []

  // ── Essential Cloudflare settings ─────────────────────────────────────────────
  settings.push({
    setting: 'SSL/TLS Mode',
    recommended_value: 'Full (strict)',
    current_status: null,
    priority: 'critical',
  })

  settings.push({
    setting: 'Brotli Compression',
    recommended_value: 'On',
    current_status: cf.isCloudflare ? (cf.brotliEnabled ? 'On' : 'Off') : null,
    priority: 'critical',
  })

  settings.push({
    setting: 'HTTP/2',
    recommended_value: 'On',
    current_status: null,
    priority: 'high',
  })

  settings.push({
    setting: 'HTTP/3 (QUIC)',
    recommended_value: 'On',
    current_status: cf.isCloudflare ? (cf.http3Enabled ? 'On' : 'Off') : null,
    priority: 'high',
  })

  settings.push({
    setting: 'Early Hints',
    recommended_value: 'On',
    current_status: cf.isCloudflare ? (cf.earlyHintsEnabled ? 'On' : 'Off') : null,
    priority: 'high',
  })

  settings.push({
    setting: 'Minify (HTML/CSS/JS)',
    recommended_value: 'Off (minify at build time instead)',
    current_status: null,
    priority: 'medium',
  })

  settings.push({
    setting: 'Polish (image compression)',
    recommended_value: 'Lossless or Lossy',
    current_status: cf.isCloudflare && cf.polishEnabled !== null ? (cf.polishEnabled ? 'On' : 'Off') : 'Unknown',
    priority: 'high',
  })

  settings.push({
    setting: 'Rocket Loader',
    recommended_value: 'Off (interferes with some JS frameworks)',
    current_status: null,
    priority: 'medium',
  })

  // ── Cache Rules ───────────────────────────────────────────────────────────────

  // Rule 1: Cache static assets with long TTL
  cacheRules.push({
    name: 'Cache static assets (1 year)',
    expression: `(http.host eq "${domain}") and (http.request.uri.path.extension in {"js" "css" "woff" "woff2" "ttf" "ico" "svg" "webp" "avif" "jpg" "jpeg" "png" "gif"})`,
    action: 'set_cache_settings',
    action_parameters: {
      cache: true,
      edge_ttl: {
        mode: 'override_origin',
        default: 31536000,
      },
      browser_ttl: {
        mode: 'override_origin',
        default: 31536000,
      },
      cache_key: {
        ignore_query_strings_order: false,
        cache_deception_armor: true,
      },
    },
    rationale: 'Versioned static assets should be cached for 1 year. Your deploy pipeline must add content hashes to filenames.',
  })

  // Rule 2: Cache HTML with short TTL
  cacheRules.push({
    name: 'Cache HTML pages (5 min)',
    expression: `(http.host eq "${domain}") and (http.request.uri.path matches "^[^.]*$")`,
    action: 'set_cache_settings',
    action_parameters: {
      cache: true,
      edge_ttl: {
        mode: 'override_origin',
        default: 300,
      },
      browser_ttl: {
        mode: 'bypass',
      },
    },
    rationale: 'Cache HTML at the edge for 5 minutes to reduce origin load. Browser always revalidates so users see fresh content.',
  })

  // Rule 3: Bypass cache for sensitive paths
  const bypassPaths: string[] = ['/wp-admin', '/wp-login.php', '/admin']
  if (cms.cms === 'WordPress') bypassPaths.push('/wp-json')
  if (cms.cms === 'Shopify') bypassPaths.push('/cart', '/checkout', '/account')

  cacheRules.push({
    name: 'Bypass cache for authenticated/dynamic paths',
    expression: `(http.host eq "${domain}") and (http.request.uri.path in {${bypassPaths.map(p => `"${p}"`).join(' ')}}) or (http.cookie contains "wordpress_logged_in") or (http.cookie contains "woocommerce_cart_hash")`,
    action: 'bypass_cache',
    action_parameters: {},
    rationale: 'Never cache admin, authenticated, or cart pages — they contain user-specific data.',
  })

  // ── Transform Rules ───────────────────────────────────────────────────────────

  // Add security headers via transform rule
  transformRules.push({
    name: 'Add security headers',
    expression: `(http.host eq "${domain}")`,
    action: 'rewrite',
    action_parameters: {
      headers: {
        'X-Frame-Options': { operation: 'set', value: 'SAMEORIGIN' },
        'X-Content-Type-Options': { operation: 'set', value: 'nosniff' },
        'Referrer-Policy': { operation: 'set', value: 'strict-origin-when-cross-origin' },
        'Permissions-Policy': { operation: 'set', value: 'camera=(), microphone=(), geolocation=()' },
      },
    },
    rationale: 'Add security headers at the Cloudflare edge so they apply to all responses regardless of origin server configuration.',
  })

  // Platform-specific notes
  if (cms.cms === 'WordPress') {
    notes.push('WordPress: Install the Cloudflare plugin and connect your API key to enable automatic cache purging on post publish/update.')
    notes.push('WordPress: Enable "Automatic Platform Optimization (APO)" in Cloudflare to cache WordPress pages at the edge and bypass PHP/MySQL for most requests.')
    notes.push('WooCommerce: Always add bypass rules for /cart/, /checkout/, /my-account/ and any page using the [woocommerce_checkout] shortcode.')
  } else if (cms.cms === 'Shopify') {
    notes.push('Shopify: Your storefront is already on Shopify\'s CDN. Cloudflare adds an additional CDN layer. Configure it in "Orange Cloud" mode to benefit from WAF and performance features without breaking Shopify\'s native CDN.')
  } else if (cms.cms === 'Next.js') {
    notes.push('Next.js: If deployed on Vercel, Vercel already provides edge caching. Use Cloudflare in front of Vercel with Cache Rules that respect Cache-Control headers from Next.js.')
  }

  if (!cf.isCloudflare) {
    notes.push('This site is not currently behind Cloudflare. To onboard: add your domain in the Cloudflare dashboard, update your nameservers at your registrar, and configure these rules.')
  } else {
    const missedFeatures: string[] = []
    if (!cf.brotliEnabled) missedFeatures.push('Brotli')
    if (!cf.http3Enabled) missedFeatures.push('HTTP/3')
    if (!cf.earlyHintsEnabled) missedFeatures.push('Early Hints')
    if (missedFeatures.length > 0) {
      notes.push(`Cloudflare is active but ${missedFeatures.join(', ')} should be enabled in Speed → Optimization.`)
    }
    if (cf.cacheStatus === 'MISS' || cf.cacheStatus === 'BYPASS') {
      notes.push(`Cache status is ${cf.cacheStatus} — the HTML response is not being cached. Review Cache Rules to ensure HTML is cached at the edge.`)
    }
  }

  return {
    domain,
    is_cloudflare: cf.isCloudflare,
    settings,
    cache_rules: cacheRules,
    transform_rules: transformRules,
    notes,
  }
}
