import { load } from 'cheerio'
import type { WordPressAnalysis, WordPressPlugin, WordPressIssue, Difficulty } from '../types.js'

// ── Plugin fingerprints ───────────────────────────────────────────────────────

interface PluginDef {
  name: string
  slug: string
  signals: Array<(html: string, headers: Headers) => boolean>
}

const PLUGIN_DEFS: PluginDef[] = [
  {
    name: 'Elementor',
    slug: 'elementor',
    signals: [
      (h) => h.includes('elementor-frontend') || h.includes('elementor/assets'),
      (h) => h.includes('class="elementor-'),
      (h) => h.includes('window.elementorFrontendConfig'),
    ],
  },
  {
    name: 'Divi',
    slug: 'divi',
    signals: [
      (h) => h.includes('et_pb_section') || h.includes('et_pb_row'),
      (h) => h.includes('window.et_pb_custom') || h.includes('DiviBuilder'),
      (h) => h.includes('/plugins/divi-builder/'),
    ],
  },
  {
    name: 'Beaver Builder',
    slug: 'beaver-builder',
    signals: [
      (h) => h.includes('fl-builder') || h.includes('fl-row'),
      (h) => h.includes('FLBuilderLayout'),
    ],
  },
  {
    name: 'WooCommerce',
    slug: 'woocommerce',
    signals: [
      (h) => h.includes('woocommerce') || h.includes('WooCommerce'),
      (h) => h.includes('wc-cart-fragments') || h.includes('wc_cart_fragments_params'),
      (h) => h.includes('/plugins/woocommerce/'),
    ],
  },
  {
    name: 'WP Rocket',
    slug: 'wp-rocket',
    signals: [
      (h) => h.includes('data-rocketlazyloadscript') || h.includes('rocket-loader'),
      (h) => h.includes('<!-- This website is like a Rocket'),
      (h) => h.includes('wprocket') || h.includes('wp-rocket'),
    ],
  },
  {
    name: 'LiteSpeed Cache',
    slug: 'litespeed-cache',
    signals: [
      (_, headers) => headers.has('x-litespeed-cache') || headers.has('x-lsw-cache'),
      (h) => h.includes('litespeed'),
    ],
  },
  {
    name: 'NitroPack',
    slug: 'nitropack',
    signals: [
      (h) => h.includes('__nitropack_dynamicUrl') || h.includes('nitropack'),
      (h) => h.includes('window.nitropack'),
    ],
  },
  {
    name: 'Perfmatters',
    slug: 'perfmatters',
    signals: [
      (h) => h.includes('perfmatters'),
    ],
  },
  {
    name: 'FlyingPress',
    slug: 'flying-press',
    signals: [
      (h) => h.includes('flying-press') || h.includes('flyingpress'),
      (h) => h.includes('FlyingPress'),
    ],
  },
  {
    name: 'WP Super Cache',
    slug: 'wp-super-cache',
    signals: [
      (h) => h.includes('WP Super Cache') || h.includes('wp-super-cache'),
    ],
  },
  {
    name: 'W3 Total Cache',
    slug: 'w3-total-cache',
    signals: [
      (h) => h.includes('W3 Total Cache') || h.includes('w3tc'),
    ],
  },
  {
    name: 'ACF',
    slug: 'advanced-custom-fields',
    signals: [
      (h) => h.includes('window.acf') || h.includes('acf-field'),
    ],
  },
  {
    name: 'Yoast SEO',
    slug: 'wordpress-seo',
    signals: [
      (h) => h.includes('This site is optimized with the Yoast SEO') || h.includes('yoast.com/wordpress/plugins/seo'),
      (h) => h.includes('wpseo_'),
    ],
  },
  {
    name: 'RankMath',
    slug: 'seo-by-rank-math',
    signals: [
      (h) => h.includes('rank-math') || h.includes('rankMath'),
      (h) => h.includes('window.rankMathEditor') || h.includes('window.rankMath'),
    ],
  },
  {
    name: 'Contact Form 7',
    slug: 'contact-form-7',
    signals: [
      (h) => h.includes('wpcf7') || h.includes('contact-form-7'),
    ],
  },
  {
    name: 'WPForms',
    slug: 'wpforms-lite',
    signals: [
      (h) => h.includes('wpforms') || h.includes('WPForms'),
    ],
  },
  {
    name: 'Gravity Forms',
    slug: 'gravityforms',
    signals: [
      (h) => h.includes('gform_') || h.includes('GravityForms'),
    ],
  },
  {
    name: 'WPML',
    slug: 'sitepress-multilingual-cms',
    signals: [
      (h) => h.includes('icl_') || h.includes('wpml'),
    ],
  },
  {
    name: 'Polylang',
    slug: 'polylang',
    signals: [
      (h) => h.includes('pll_') || h.includes('polylang'),
    ],
  },
  {
    name: 'WP Migrate DB',
    slug: 'wp-migrate-db',
    signals: [
      (h) => h.includes('wpmdb'),
    ],
  },
  {
    name: 'Jetpack',
    slug: 'jetpack',
    signals: [
      (h) => h.includes('jetpack') || h.includes('Jetpack'),
    ],
  },
  {
    name: 'MonsterInsights',
    slug: 'google-analytics-for-wordpress',
    signals: [
      (h) => h.includes('monsterinsights') || h.includes('MonsterInsights'),
    ],
  },
]

// ── WordPress version detection ───────────────────────────────────────────────

function detectVersion(html: string): string | null {
  const match = /\?ver=([\d.]+)/.exec(html) ??
    /WordPress ([\d.]+)/.exec(html) ??
    /<meta name="generator" content="WordPress ([\d.]+)/.exec(html)
  return match?.[1] ?? null
}

// ── Theme detection ───────────────────────────────────────────────────────────

function detectTheme(html: string): string | null {
  const match = /wp-content\/themes\/([\w-]+)\//.exec(html)
  return match?.[1] ?? null
}

// ─── Main inspector ───────────────────────────────────────────────────────────

export async function analyzeWordPress(url: string): Promise<WordPressAnalysis> {
  let html = ''
  let headers = new Headers()

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
    html = await response.text()
    headers = response.headers
  } catch {
    return {
      url,
      isWordPress: false,
      version: null,
      theme: null,
      plugins: [],
      hasPageBuilder: false,
      hasEcommerce: false,
      hasCachePlugin: false,
      hasSEOPlugin: false,
      issues: [],
    }
  }

  // Quick WordPress check
  const isWordPress = html.includes('/wp-content/') || html.includes('/wp-includes/')
  if (!isWordPress) {
    return {
      url,
      isWordPress: false,
      version: null,
      theme: null,
      plugins: [],
      hasPageBuilder: false,
      hasEcommerce: false,
      hasCachePlugin: false,
      hasSEOPlugin: false,
      issues: [],
    }
  }

  const version = detectVersion(html)
  const theme = detectTheme(html)

  // ── Plugin detection ──────────────────────────────────────────────────────
  const plugins: WordPressPlugin[] = []

  for (const def of PLUGIN_DEFS) {
    const firedSignals: string[] = []
    for (const signal of def.signals) {
      if (signal(html, headers)) {
        firedSignals.push(signal.toString().slice(0, 80).replace(/\s+/g, ' '))
      }
    }
    if (firedSignals.length > 0) {
      plugins.push({
        name: def.name,
        slug: def.slug,
        detected: true,
        signals: firedSignals,
      })
    }
  }

  const hasPlugin = (slug: string) => plugins.some((p) => p.slug === slug)
  const hasAny = (...slugs: string[]) => slugs.some(hasPlugin)

  const hasPageBuilder = hasAny('elementor', 'divi', 'beaver-builder')
  const hasEcommerce = hasPlugin('woocommerce')
  const hasCachePlugin = hasAny('wp-rocket', 'litespeed-cache', 'nitropack', 'flying-press', 'perfmatters', 'wp-super-cache', 'w3-total-cache')
  const hasSEOPlugin = hasAny('wordpress-seo', 'seo-by-rank-math')

  // ── Issue generation ──────────────────────────────────────────────────────
  const issues: WordPressIssue[] = []

  // No cache plugin
  if (!hasCachePlugin) {
    issues.push({
      plugin: 'Core',
      issue: 'No caching or performance optimization plugin detected',
      recommendation: 'Install a caching plugin. Recommended: WP Rocket (paid, all-in-one), LiteSpeed Cache (free, excellent for LiteSpeed/OpenLiteSpeed servers), or Perfmatters (lightweight, pairs well with any host).',
      estimatedLcpImpactMs: 800,
      difficulty: 'easy',
    })
  }

  // WooCommerce cart fragments
  if (hasPlugin('woocommerce')) {
    const hasCartFragmentsDisabled =
      html.includes('cart_fragments') === false ||
      html.includes('wc-cart-fragments') === false

    if (!hasCartFragmentsDisabled || html.includes('wc-cart-fragments')) {
      issues.push({
        plugin: 'WooCommerce',
        issue: 'wc-cart-fragments.js loads on every page, preventing full-page caching',
        recommendation: 'Disable cart fragments on non-cart/checkout pages using WP Rocket\'s WooCommerce tab, or add this snippet to functions.php:\nadd_action(\'wp_enqueue_scripts\', function() {\n  if (!is_cart() && !is_checkout()) {\n    wp_dequeue_script(\'wc-cart-fragments\');\n  }\n});',
        estimatedLcpImpactMs: 400,
        difficulty: 'easy',
      })
    }
  }

  // Elementor
  if (hasPlugin('elementor')) {
    // Check if Improved Asset Loading is enabled (loads CSS per-page instead of globally)
    const usesImprovedAssetLoading = html.includes('elementor-post-') && !html.includes('elementor/assets/css/frontend.min.css')
    if (!usesImprovedAssetLoading) {
      issues.push({
        plugin: 'Elementor',
        issue: 'Elementor loads CSS and JS on all pages, not just pages built with Elementor',
        recommendation: 'Enable "Improved Asset Loading" in Elementor > Settings > Performance tab. This loads Elementor\'s CSS/JS only on pages that actually use Elementor, reducing payload on other pages.',
        estimatedLcpImpactMs: 250,
        difficulty: 'easy',
      })
    }

    // Check for render-blocking Elementor font loading
    const $ = load(html)
    const elementorFontLinks = $('link[rel="stylesheet"][href*="elementor"]').length
    if (elementorFontLinks > 2) {
      issues.push({
        plugin: 'Elementor',
        issue: `${elementorFontLinks} Elementor stylesheet(s) loading in <head>`,
        recommendation: 'In Elementor > Settings > Performance, enable "Optimized DOM Output" and "Improved Asset Loading". Also consider using WP Rocket\'s "Delay JavaScript" for elementor scripts not needed on initial load.',
        estimatedLcpImpactMs: 200,
        difficulty: 'medium',
      })
    }
  }

  // Divi
  if (hasPlugin('divi')) {
    issues.push({
      plugin: 'Divi',
      issue: 'Divi Builder generates inline CSS that can significantly increase page weight',
      recommendation: 'Enable Divi\'s "Static CSS File Generation" (Divi > Theme Options > Performance) to write inline styles to a file that can be cached. Also enable "Critical CSS" in Divi 5 if available.',
      estimatedLcpImpactMs: 300,
      difficulty: 'medium',
    })
  }

  // WP Rocket present but check if key features are enabled
  if (hasPlugin('wp-rocket')) {
    const hasLazyLoad = html.includes('data-lazy-src') || html.includes('rocket-lazyload')
    if (!hasLazyLoad) {
      issues.push({
        plugin: 'WP Rocket',
        issue: 'WP Rocket detected but lazy loading appears disabled',
        recommendation: 'Enable lazy loading in WP Rocket > Media > Lazyload. Enable for images and iframes. Exclude the LCP hero image from lazy loading.',
        estimatedLcpImpactMs: 200,
        difficulty: 'easy',
      })
    }
  }

  // Jetpack performance note
  if (hasPlugin('jetpack')) {
    issues.push({
      plugin: 'Jetpack',
      issue: 'Jetpack loads JavaScript on every page for all enabled modules',
      recommendation: 'Disable unused Jetpack modules under Jetpack > Settings. Common resource-heavy modules: Related Posts, Site Stats, Social Sharing, Subscriptions. Each enabled module adds JS weight.',
      estimatedLcpImpactMs: 150,
      difficulty: 'easy',
    })
  }

  // Missing SSL / HTTP
  if (!url.startsWith('https://')) {
    issues.push({
      plugin: 'Core',
      issue: 'Site is not served over HTTPS',
      recommendation: 'Install Really Simple SSL plugin or configure SSL in your hosting panel. HTTPS is required for HTTP/2, which significantly improves performance for multiple concurrent requests.',
      estimatedLcpImpactMs: null,
      difficulty: 'easy',
    })
  }

  // Outdated jQuery (commonly enqueued by WordPress and plugins)
  const jqueryMatch = /jquery(?:\.min)?\.js\?ver=([\d.]+)/.exec(html)
  if (jqueryMatch) {
    const [major, minor] = jqueryMatch[1].split('.').map(Number)
    if (major < 3 || (major === 3 && minor < 6)) {
      issues.push({
        plugin: 'Core',
        issue: `Outdated jQuery version detected (${jqueryMatch[1]})`,
        recommendation: 'Update WordPress and all plugins to their latest versions to get the current jQuery 3.7+. Older jQuery versions have known performance and security issues.',
        estimatedLcpImpactMs: null,
        difficulty: 'medium',
      })
    }
  }

  return {
    url,
    isWordPress,
    version,
    theme,
    plugins,
    hasPageBuilder,
    hasEcommerce,
    hasCachePlugin,
    hasSEOPlugin,
    issues,
  }
}
