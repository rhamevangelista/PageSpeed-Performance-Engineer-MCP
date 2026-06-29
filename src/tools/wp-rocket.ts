import type { WPRocketConfig } from '../types.js'
import { analyzeWordPress } from './wordpress.js'

export async function generateWPRocketConfig(url: string): Promise<WPRocketConfig> {
  const wp = await analyzeWordPress(url)

  if (!wp.isWordPress) {
    return {
      version: '3.x',
      generated_at: new Date().toISOString(),
      url,
      settings: { cache: {}, file_optimization: {}, media: {}, preload: {}, advanced_rules: {} },
      rationale: [],
      warnings: ['This URL does not appear to be a WordPress site. WP Rocket config cannot be generated.'],
    }
  }

  return buildConfig(url, wp)
}

function buildConfig(url: string, wp: Awaited<ReturnType<typeof analyzeWordPress>>): WPRocketConfig {
  const rationale: string[] = []
  const warnings: string[] = []

  const detected = (slug: string) => wp.plugins.some(p => p.slug === slug && p.detected)

  const hasElementor = detected('elementor')
  const hasDivi = detected('divi')
  const hasWooCommerce = detected('woocommerce')
  const hasNitroPack = detected('nitropack')
  const hasLiteSpeed = detected('litespeed-cache')
  const hasW3Total = detected('w3-total-cache')
  const hasWPSuperCache = detected('wp-super-cache')
  const hasWPRocketAlready = detected('wp-rocket')
  const hasGTM = detected('google-tag-manager') || detected('google-analytics')
  const hasFBPixel = detected('facebook-for-woocommerce')
  const pageBuilder = hasElementor ? 'Elementor' : hasDivi ? 'Divi' : null

  // Conflict warnings
  if (hasNitroPack) warnings.push('NitroPack detected — it conflicts with WP Rocket. Deactivate and remove NitroPack before installing WP Rocket.')
  if (hasLiteSpeed) warnings.push('LiteSpeed Cache detected — it conflicts with WP Rocket. Deactivate LiteSpeed Cache first.')
  if (hasW3Total) warnings.push('W3 Total Cache detected — deactivate it before activating WP Rocket.')
  if (hasWPSuperCache) warnings.push('WP Super Cache detected — deactivate it before activating WP Rocket.')

  // ── Cache ─────────────────────────────────────────────────────────────────────
  const cache: Record<string, unknown> = {
    cache_enabled: true,
    cache_lifespan: 10,
    cache_mobile: true,
    mobile_wl_cache: false,
    cache_logged_user: false,
  }
  rationale.push('Cache lifespan set to 10 hours — suitable for most sites. Increase to 24h for rarely-updated content.')
  if (hasWooCommerce) {
    rationale.push('Mobile caching enabled (separate cache for mobile users).')
  }

  // ── File optimization ─────────────────────────────────────────────────────────
  const shouldCombine = !pageBuilder

  const neverMinifyJs: string[] = []
  const delayJsScripts: string[] = []
  const delayJsExclusions: string[] = ['jquery.js', 'jquery.min.js']

  if (hasGTM) {
    delayJsScripts.push('googletagmanager.com', 'google-analytics.com')
    rationale.push('Google Analytics / GTM added to JS delay list — reduces INP.')
  }
  if (hasFBPixel) {
    delayJsScripts.push('connect.facebook.net')
    rationale.push('Facebook Pixel added to JS delay list.')
  }
  if (hasWooCommerce) {
    delayJsExclusions.push('wc-cart-fragments', 'woocommerce', 'add-to-cart')
    warnings.push('Exclude wc-cart-fragments.js from JS delay — delaying it prevents the cart count from updating without a page reload.')
    neverMinifyJs.push('woocommerce/assets/js/frontend/cart-fragments.min.js')
  }

  const fileOptimization: Record<string, unknown> = {
    minify_css: true,
    combine_css: shouldCombine,
    optimize_css_delivery: true,
    minify_js: true,
    combine_js: shouldCombine,
    defer_all_js: true,
    delay_js: delayJsScripts.length > 0,
    delay_js_scripts: delayJsScripts,
    delay_js_exclusions: delayJsExclusions,
    never_minify_js: neverMinifyJs,
  }

  if (pageBuilder) {
    rationale.push(`CSS/JS combination disabled — ${pageBuilder} uses inline scripts that break when bundles are merged.`)
  } else {
    rationale.push('CSS and JS combination enabled. Disable if layout breaks after activation.')
  }

  rationale.push('Critical CSS (async CSS loading) enabled — reduces render-blocking time.')
  rationale.push('Defer all JS enabled — ensures scripts run after HTML parsing.')

  // ── Media ─────────────────────────────────────────────────────────────────────
  const media: Record<string, unknown> = {
    lazyload: true,
    lazyload_iframes: true,
    lazyload_youtube: true,
    image_dimensions: true,
  }
  rationale.push('Lazy loading enabled for images and iframes.')
  rationale.push('Automatic image dimensions enabled — prevents Cumulative Layout Shift (CLS).')

  // ── Preload ───────────────────────────────────────────────────────────────────
  const dnsPrefetch: string[] = ['//fonts.googleapis.com', '//fonts.gstatic.com']
  if (hasWooCommerce) dnsPrefetch.push('//cdn.woocommerce.com')

  const preload: Record<string, unknown> = {
    manual_preload: true,
    preload_links: false,
    sitemap_preload: false,
    dns_prefetch: dnsPrefetch,
  }
  rationale.push('DNS prefetch configured for Google Fonts and common external resources.')
  rationale.push('Enable Sitemap preload if you have an XML sitemap for faster cache warming after purges.')

  // ── Advanced rules ────────────────────────────────────────────────────────────
  const neverCacheUrls: string[] = []
  const neverCacheCookies: string[] = []

  if (hasWooCommerce) {
    neverCacheUrls.push('/cart/', '/checkout/', '/my-account/', '/?wc-ajax=')
    neverCacheCookies.push('woocommerce_cart_hash', 'woocommerce_items_in_cart', 'wp_woocommerce_session_')
    rationale.push('WooCommerce cart, checkout, and account pages excluded from caching to prevent stale cart data.')
  }

  const advancedRules: Record<string, unknown> = {
    cache_reject_uri: neverCacheUrls,
    cache_reject_cookies: neverCacheCookies,
    always_purge_urls: [],
  }

  return {
    version: '3.x',
    generated_at: new Date().toISOString(),
    url,
    settings: { cache, file_optimization: fileOptimization, media, preload, advanced_rules: advancedRules },
    rationale,
    warnings,
  }
}
