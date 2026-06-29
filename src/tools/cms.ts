import { load } from 'cheerio'
import type { CMSDetection, CMSName } from '../types.js'

interface Signal {
  score: number
  evidence: string
}

type CMSSignals = Partial<Record<CMSName, Signal[]>>

export async function detectCMS(url: string): Promise<CMSDetection> {
  let html = ''
  let responseHeaders: Headers = new Headers()

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
    html = await response.text()
    responseHeaders = response.headers
  } catch {
    return { cms: 'unknown', confidence: 0, signals: ['Failed to fetch page'], plugins: [], hosting: null }
  }

  const $ = load(html)
  const scores: CMSSignals = {}

  function addSignal(cms: CMSName, score: number, evidence: string) {
    if (!scores[cms]) scores[cms] = []
    scores[cms]!.push({ score, evidence })
  }

  // ── WordPress ──────────────────────────────────────────────────────────────
  if ($('meta[name="generator"][content*="WordPress"]').length) addSignal('WordPress', 10, 'meta generator tag')
  if (html.includes('/wp-content/')) addSignal('WordPress', 8, '/wp-content/ path in HTML')
  if (html.includes('/wp-includes/')) addSignal('WordPress', 8, '/wp-includes/ path in HTML')
  if (html.includes('wp-json')) addSignal('WordPress', 6, 'wp-json REST API reference')
  if ((responseHeaders.get('x-powered-by') ?? '').toLowerCase().includes('wp engine')) addSignal('WordPress', 7, 'x-powered-by: WP Engine header')
  if ((responseHeaders.get('x-powered-by') ?? '').toLowerCase().includes('wordpress')) addSignal('WordPress', 7, 'x-powered-by WordPress header')
  if (html.includes('wp-emoji-release')) addSignal('WordPress', 5, 'wp-emoji-release script')
  if ($('link[rel="https://api.w.org/"]').length) addSignal('WordPress', 9, 'WP REST API link header')
  if (html.includes('class="wp-block-')) addSignal('WordPress', 7, 'Gutenberg block classes')

  // ── Shopify ────────────────────────────────────────────────────────────────
  const shopifyDomain = new URL(url).hostname.endsWith('myshopify.com')
  if (shopifyDomain) addSignal('Shopify', 10, 'myshopify.com domain')
  if (html.includes('Shopify.theme')) addSignal('Shopify', 9, 'Shopify.theme JS global')
  if (html.includes('cdn.shopify.com')) addSignal('Shopify', 9, 'cdn.shopify.com asset URL')
  if ((responseHeaders.get('x-shopify-stage') ?? '')) addSignal('Shopify', 10, 'x-shopify-stage header')
  if (html.includes('shopify.com/s/files/')) addSignal('Shopify', 8, 'Shopify files CDN URL')

  // ── Next.js ────────────────────────────────────────────────────────────────
  if (html.includes('__NEXT_DATA__')) addSignal('Next.js', 10, '__NEXT_DATA__ JSON in HTML')
  if (html.includes('/_next/static/')) addSignal('Next.js', 9, '/_next/static/ asset path')
  if (html.includes('next/dist/')) addSignal('Next.js', 7, 'next/dist/ module reference')
  if ($('script[src*="/_next/"]').length) addSignal('Next.js', 8, '_next script tags')

  // ── Nuxt ──────────────────────────────────────────────────────────────────
  if (html.includes('__NUXT__')) addSignal('Nuxt', 10, '__NUXT__ JSON in HTML')
  if (html.includes('/_nuxt/')) addSignal('Nuxt', 9, '/_nuxt/ asset path')

  // ── Astro ──────────────────────────────────────────────────────────────────
  if (html.includes('data-astro-cid')) addSignal('Astro', 9, 'data-astro-cid attribute')
  if ($('meta[name="generator"][content*="Astro"]').length) addSignal('Astro', 10, 'Astro generator meta')

  // ── Laravel ────────────────────────────────────────────────────────────────
  if ((responseHeaders.get('x-powered-by') ?? '').toLowerCase().includes('php')) {
    if (html.includes('laravel')) addSignal('Laravel', 6, 'PHP + laravel reference in HTML')
    if (html.includes('/storage/app/')) addSignal('Laravel', 7, 'Laravel storage path')
  }

  // ── Wix ───────────────────────────────────────────────────────────────────
  if (html.includes('static.parastorage.com')) addSignal('Wix', 9, 'Wix CDN URL')
  if ($('meta[name="generator"][content*="Wix"]').length) addSignal('Wix', 10, 'Wix generator meta')
  if (html.includes('wix.com/')) addSignal('Wix', 7, 'wix.com reference in HTML')

  // ── Squarespace ────────────────────────────────────────────────────────────
  if (html.includes('squarespace.com')) addSignal('Squarespace', 8, 'squarespace.com reference')
  if ($('meta[name="generator"][content*="Squarespace"]').length) addSignal('Squarespace', 10, 'Squarespace generator meta')

  // ── Webflow ────────────────────────────────────────────────────────────────
  if (html.includes('webflow.com')) addSignal('Webflow', 8, 'webflow.com reference')
  if ($('[data-wf-site]').length) addSignal('Webflow', 10, 'data-wf-site attribute')

  // ── Joomla ─────────────────────────────────────────────────────────────────
  if ($('meta[name="generator"][content*="Joomla"]').length) addSignal('Joomla', 10, 'Joomla generator meta')
  if (html.includes('/media/jui/')) addSignal('Joomla', 8, 'Joomla JUI media path')

  // ── Drupal ─────────────────────────────────────────────────────────────────
  if (html.includes('Drupal.settings')) addSignal('Drupal', 9, 'Drupal.settings JS global')
  if ($('meta[name="generator"][content*="Drupal"]').length) addSignal('Drupal', 10, 'Drupal generator meta')
  if (html.includes('/sites/default/files/')) addSignal('Drupal', 7, 'Drupal files path')

  // ── Pick winner ───────────────────────────────────────────────────────────
  let topCMS: CMSName = 'unknown'
  let topScore = 0
  const allSignals: string[] = []

  for (const [cms, sigs] of Object.entries(scores) as [CMSName, Signal[]][]) {
    const total = sigs.reduce((acc, s) => acc + s.score, 0)
    if (total > topScore) {
      topScore = total
      topCMS = cms
    }
  }

  if (topCMS !== 'unknown' && scores[topCMS]) {
    allSignals.push(...scores[topCMS]!.map((s) => s.evidence))
  }

  // confidence: max at score=20+, scaled 0–1
  const confidence = Math.min(topScore / 20, 1)

  // WordPress-specific: detect plugins from HTML
  const plugins: string[] = []
  if (topCMS === 'WordPress') {
    if (html.includes('elementor')) plugins.push('Elementor')
    if (html.includes('et_pb_') || html.includes('Divi')) plugins.push('Divi')
    if (html.includes('woocommerce') || html.includes('WooCommerce')) plugins.push('WooCommerce')
    if (html.includes('wp-rocket') || html.includes('rocketlazyload')) plugins.push('WP Rocket')
    if (html.includes('litespeed') || (responseHeaders.get('x-litespeed-cache') ?? '')) plugins.push('LiteSpeed Cache')
    if (html.includes('nitropack') || html.includes('__nitropack')) plugins.push('NitroPack')
    if (html.includes('perfmatters')) plugins.push('Perfmatters')
    if (html.includes('flying-press') || html.includes('flyingpress')) plugins.push('FlyingPress')
    if (html.includes('window.acf')) plugins.push('ACF')
    if (html.includes('Yoast SEO') || html.includes('yoast.com')) plugins.push('Yoast SEO')
    if (html.includes('rankMath') || html.includes('rank-math')) plugins.push('RankMath')
    if (html.includes('wpforms')) plugins.push('WPForms')
    if (html.includes('contact-form-7') || html.includes('wpcf7')) plugins.push('Contact Form 7')
  }

  // Detect hosting
  const server = responseHeaders.get('server') ?? ''
  const poweredBy = responseHeaders.get('x-powered-by') ?? ''
  let hosting: string | null = null
  if (server.toLowerCase().includes('cloudflare')) hosting = 'Cloudflare'
  else if (poweredBy.toLowerCase().includes('wp engine') || server.toLowerCase().includes('wp engine')) hosting = 'WP Engine'
  else if (server.toLowerCase().includes('litespeed')) hosting = 'LiteSpeed'
  else if (responseHeaders.has('x-kinsta-cache')) hosting = 'Kinsta'
  else if (responseHeaders.has('x-flywheel-cache')) hosting = 'Flywheel'
  else if (server.toLowerCase().includes('nginx')) hosting = 'nginx'
  else if (server.toLowerCase().includes('apache')) hosting = 'Apache'

  return {
    cms: topCMS,
    confidence: Math.round(confidence * 100) / 100,
    signals: allSignals,
    plugins,
    hosting,
  }
}
