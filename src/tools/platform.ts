import type { CMSDetection, CMSName, PlatformAnalysis, PlatformIssue } from '../types.js'
import { analyzeWordPress } from './wordpress.js'

/**
 * Platform dispatcher — auto-detects CMS from the detection result and runs
 * the appropriate platform-specific analysis. WordPress gets a deep plugin
 * inspection; other platforms get tailored-but-lighter recommendations based
 * on their known architectural patterns.
 */
export async function analyzePlatform(url: string, cms: CMSDetection): Promise<PlatformAnalysis> {
  switch (cms.cms) {
    case 'WordPress':
      return analyzeWordPressPlatform(url, cms)
    case 'Shopify':
      return analyzeShopifyPlatform(url, cms)
    case 'Next.js':
      return analyzeNextjsPlatform(url, cms)
    case 'Nuxt':
      return analyzeNuxtPlatform(url, cms)
    case 'Astro':
      return analyzeAstroPlatform(url, cms)
    case 'Webflow':
      return analyzeWebflowPlatform(url, cms)
    case 'Wix':
    case 'Squarespace':
      return analyzePageBuilderSaaSPlatform(url, cms)
    default:
      return analyzeGenericPlatform(url, cms)
  }
}

// ─── WordPress ────────────────────────────────────────────────────────────────

async function analyzeWordPressPlatform(url: string, cms: CMSDetection): Promise<PlatformAnalysis> {
  const wordpress = await analyzeWordPress(url)
  const issues: PlatformIssue[] = []

  for (const wpIssue of wordpress.issues) {
    issues.push({
      type: 'wordpress',
      description: `[${wpIssue.plugin}] ${wpIssue.issue}`,
      recommendation: wpIssue.recommendation,
      estimatedImpact: { lcp: wpIssue.estimatedLcpImpactMs ?? undefined },
      difficulty: wpIssue.difficulty,
      severity: (wpIssue.estimatedLcpImpactMs ?? 0) >= 400 ? 'high' : 'medium',
    })
  }

  return { url, platform: 'WordPress', wordpress, issues }
}

// ─── Shopify ──────────────────────────────────────────────────────────────────

async function analyzeShopifyPlatform(url: string, cms: CMSDetection): Promise<PlatformAnalysis> {
  const issues: PlatformIssue[] = []

  let html = ''
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    html = await res.text()
  } catch { /* continue with empty html */ }

  // ── App scripts ──────────────────────────────────────────────────────────
  const appScriptPatterns = [
    /cdn\.shopify\.com\/s\/files\/1\/[^"]+\.js/g,
    /apps\.shopifycdn\.com/g,
  ]
  let appScriptCount = 0
  for (const pattern of appScriptPatterns) {
    appScriptCount += (html.match(pattern) ?? []).length
  }

  if (appScriptCount > 5) {
    issues.push({
      type: 'shopify_apps',
      description: `${appScriptCount} Shopify app scripts detected. Each app adds JS weight and can delay interactivity.`,
      recommendation: 'Audit installed apps in your Shopify admin. Remove apps you no longer use — their scripts may still be loading even after uninstall. Use Shopify\'s app performance dashboard.',
      estimatedImpact: { lcp: appScriptCount * 80, inp: appScriptCount * 20 },
      difficulty: 'easy',
      severity: appScriptCount > 10 ? 'high' : 'medium',
    })
  }

  // ── Shopify image CDN ─────────────────────────────────────────────────────
  const usesShopifyImageCDN = html.includes('cdn.shopify.com/s/files')
  if (usesShopifyImageCDN && !html.includes('width=')) {
    issues.push({
      type: 'shopify_image_cdn',
      description: 'Images are served from Shopify CDN but not using URL-based resizing.',
      recommendation: 'Use Shopify\'s image URL parameters to serve correctly sized images: append ?width=800 to CDN URLs, or use the image_url Liquid filter with width: parameter.',
      estimatedImpact: { lcp: 400 },
      difficulty: 'medium',
      severity: 'medium',
    })
  }

  // ── Liquid render-blocking ────────────────────────────────────────────────
  if (html.includes('render-blocking') || !html.includes('defer') && (html.match(/<script src/g) ?? []).length > 3) {
    issues.push({
      type: 'shopify_scripts',
      description: 'Multiple synchronous scripts detected. Shopify themes often include render-blocking theme JS.',
      recommendation: 'In your theme\'s layout/theme.liquid, move non-critical scripts to the end of <body> or add defer. Use Shopify\'s Script Editor app or Online Store 2.0 app blocks to control when scripts load.',
      estimatedImpact: { lcp: 300 },
      difficulty: 'medium',
      severity: 'medium',
    })
  }

  // ── No LCP image preload ──────────────────────────────────────────────────
  if (!html.includes('rel="preload"') || !html.includes('as="image"')) {
    issues.push({
      type: 'shopify_lcp_preload',
      description: 'LCP hero image is likely not preloaded in the theme head.',
      recommendation: 'In your Dawn or custom theme\'s layout/theme.liquid, add: {{ settings.featured_image | image_url: width: 1200 | preload_tag: as: "image" }} — or manually add a <link rel="preload"> for the hero image.',
      estimatedImpact: { lcp: 400 },
      difficulty: 'medium',
      severity: 'high',
    })
  }

  // ── Shopify-specific server hint ──────────────────────────────────────────
  issues.push({
    type: 'shopify_general',
    description: 'Shopify hosting provides limited server-side configuration access.',
    recommendation: 'Focus optimizations on: (1) reducing app scripts, (2) optimizing theme Liquid code, (3) using Shopify\'s native image CDN with proper sizing, (4) enabling Shopify Markets CDN, (5) using Online Store 2.0 section-based themes for granular script control.',
    estimatedImpact: {},
    difficulty: 'easy',
    severity: 'low',
  })

  return { url, platform: 'Shopify', wordpress: null, issues }
}

// ─── Next.js ─────────────────────────────────────────────────────────────────

async function analyzeNextjsPlatform(url: string, cms: CMSDetection): Promise<PlatformAnalysis> {
  const issues: PlatformIssue[] = []

  let html = ''
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    html = await res.text()
  } catch { /* continue */ }

  // ── next/image usage ─────────────────────────────────────────────────────
  const usesNextImage = html.includes('/_next/image') || html.includes('data-nimg')
  if (!usesNextImage && (html.match(/<img /g) ?? []).length > 2) {
    issues.push({
      type: 'nextjs_image',
      description: 'Plain <img> tags found. Next.js next/image component not detected.',
      recommendation: 'Replace <img> with Next.js <Image> component from next/image. It handles automatic WebP/AVIF conversion, lazy loading, size optimization, and LCP preloading.',
      estimatedImpact: { lcp: 600 },
      difficulty: 'medium',
      severity: 'high',
    })
  }

  // ── next/font usage ──────────────────────────────────────────────────────
  const usesNextFont = html.includes('__next_font') || html.includes('next/font')
  const hasGoogleFontsLink = html.includes('fonts.googleapis.com')
  if (hasGoogleFontsLink && !usesNextFont) {
    issues.push({
      type: 'nextjs_font',
      description: 'Google Fonts loaded via <link> instead of next/font.',
      recommendation: 'Use next/font/google to self-host Google Fonts automatically. This eliminates the external request, enables font-display: swap, and prevents layout shift.',
      estimatedImpact: { lcp: 300, cls: 0.05 },
      difficulty: 'easy',
      severity: 'medium',
    })
  }

  // ── Client-side rendering check ───────────────────────────────────────────
  const isCSR = html.includes('__NEXT_DATA__') && (html.match(/<div id="__next"><\/div>/) !== null)
  if (isCSR) {
    issues.push({
      type: 'nextjs_csr',
      description: 'Page appears to be client-side rendered (empty __next div at load time).',
      recommendation: 'Switch to Server-Side Rendering (getServerSideProps) or Static Generation (getStaticProps / generateStaticParams) to improve FCP and LCP. CSR pages have poor Core Web Vitals because content renders after JS loads.',
      estimatedImpact: { lcp: 1200, fcp: 800 },
      difficulty: 'hard',
      severity: 'high',
    })
  }

  // ── Vercel / Edge deployment ───────────────────────────────────────────────
  const isVercel = html.includes('vercel') || cms.hosting === 'Vercel'
  if (!isVercel) {
    issues.push({
      type: 'nextjs_hosting',
      description: 'Next.js app not detected on Vercel.',
      recommendation: 'For best Next.js performance, deploy on Vercel (the creators of Next.js). It provides Edge Functions, ISR, automatic image optimization, and global CDN out of the box. Alternatively, use Netlify or a Node.js server with a CDN in front.',
      estimatedImpact: { lcp: 200 },
      difficulty: 'hard',
      severity: 'low',
    })
  }

  return { url, platform: 'Next.js', wordpress: null, issues }
}

// ─── Nuxt ────────────────────────────────────────────────────────────────────

async function analyzeNuxtPlatform(url: string, _cms: CMSDetection): Promise<PlatformAnalysis> {
  const issues: PlatformIssue[] = []

  let html = ''
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    html = await res.text()
  } catch { /* continue */ }

  // ── Nuxt Image ────────────────────────────────────────────────────────────
  const usesNuxtImage = html.includes('nuxt-img') || html.includes('nuxt-picture') || html.includes('/_ipx/')
  if (!usesNuxtImage && (html.match(/<img /g) ?? []).length > 2) {
    issues.push({
      type: 'nuxt_image',
      description: 'Plain <img> tags found. @nuxt/image module not detected.',
      recommendation: 'Install @nuxt/image and replace <img> with <NuxtImg>. It handles automatic format conversion (WebP/AVIF), lazy loading, responsive srcset, and works with your CDN or Nuxt\'s built-in image optimizer.',
      estimatedImpact: { lcp: 500 },
      difficulty: 'medium',
      severity: 'high',
    })
  }

  // ── Google Fonts via @import ───────────────────────────────────────────────
  if (html.includes('@import') && html.includes('fonts.googleapis.com')) {
    issues.push({
      type: 'nuxt_fonts',
      description: 'Google Fonts loaded via CSS @import — blocks rendering.',
      recommendation: 'Use the @nuxtjs/google-fonts module, which self-hosts fonts and adds font-display: swap automatically.',
      estimatedImpact: { fcp: 400, lcp: 250 },
      difficulty: 'easy',
      severity: 'high',
    })
  }

  // ── SSR vs SSG ────────────────────────────────────────────────────────────
  const hasInlinePayload = html.includes('__NUXT_DATA__') || html.includes('window.__NUXT__')
  if (!hasInlinePayload) {
    issues.push({
      type: 'nuxt_rendering',
      description: 'Nuxt rendering mode is unclear — may be client-side only.',
      recommendation: 'Use Nuxt\'s Universal rendering (SSR) or Static Generation (nuxt generate / ISR) for best Core Web Vitals. Client-side-only pages will have poor FCP and LCP scores.',
      estimatedImpact: { lcp: 800, fcp: 600 },
      difficulty: 'hard',
      severity: 'medium',
    })
  }

  return { url, platform: 'Nuxt', wordpress: null, issues }
}

// ─── Astro ───────────────────────────────────────────────────────────────────

async function analyzeAstroPlatform(url: string, _cms: CMSDetection): Promise<PlatformAnalysis> {
  const issues: PlatformIssue[] = []

  let html = ''
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    html = await res.text()
  } catch { /* continue */ }

  // ── Island hydration ─────────────────────────────────────────────────────
  const clientOnlyCount = (html.match(/client:only/g) ?? []).length
  const clientLoadCount = (html.match(/client:load/g) ?? []).length

  if (clientOnlyCount > 3) {
    issues.push({
      type: 'astro_islands',
      description: `${clientOnlyCount} client:only directives detected. These skip SSR and increase JS payload.`,
      recommendation: 'Replace client:only with client:visible or client:idle for components that don\'t need to render immediately. Use client:only only for components that genuinely cannot SSR (browser-only APIs).',
      estimatedImpact: { lcp: clientOnlyCount * 100, inp: clientOnlyCount * 30 },
      difficulty: 'medium',
      severity: clientOnlyCount > 5 ? 'high' : 'medium',
    })
  }

  if (clientLoadCount > 5) {
    issues.push({
      type: 'astro_eager_hydration',
      description: `${clientLoadCount} client:load directives found — all hydrate immediately on page load.`,
      recommendation: 'Defer non-critical interactive components with client:visible (hydrates when in viewport) or client:idle (hydrates when browser is idle).',
      estimatedImpact: { lcp: 200, inp: clientLoadCount * 20 },
      difficulty: 'easy',
      severity: 'medium',
    })
  }

  // ── Astro Image ───────────────────────────────────────────────────────────
  const usesAstroImage = html.includes('astro-image') || html.includes('/_image')
  if (!usesAstroImage && (html.match(/<img /g) ?? []).length > 2) {
    issues.push({
      type: 'astro_image',
      description: 'Plain <img> tags used instead of Astro\'s built-in <Image> component.',
      recommendation: 'Use import { Image } from "astro:assets" and replace <img> tags. The Astro Image component automatically converts to WebP/AVIF, generates srcset, and adds loading="lazy".',
      estimatedImpact: { lcp: 400 },
      difficulty: 'easy',
      severity: 'medium',
    })
  }

  return { url, platform: 'Astro', wordpress: null, issues }
}

// ─── Webflow ─────────────────────────────────────────────────────────────────

async function analyzeWebflowPlatform(url: string, _cms: CMSDetection): Promise<PlatformAnalysis> {
  const issues: PlatformIssue[] = []

  issues.push({
    type: 'webflow_js',
    description: 'Webflow loads its own runtime JS (webflow.js) on every page.',
    recommendation: 'You cannot remove webflow.js, but you can reduce its impact: (1) disable unnecessary Webflow interactions, (2) remove unused animation triggers, (3) host the site on Webflow\'s Fast Hosting with Cloudflare CDN.',
    estimatedImpact: { lcp: 200 },
    difficulty: 'medium',
    severity: 'medium',
  })

  issues.push({
    type: 'webflow_images',
    description: 'Webflow does not automatically convert images to modern formats.',
    recommendation: 'Manually upload WebP images in Webflow\'s Asset Manager. For the hero image, use Webflow\'s responsive image settings and ensure it\'s marked as "eager" loading.',
    estimatedImpact: { lcp: 600 },
    difficulty: 'easy',
    severity: 'high',
  })

  issues.push({
    type: 'webflow_fonts',
    description: 'Webflow loads Google Fonts via a standard stylesheet link.',
    recommendation: 'Use font-display: swap by loading fonts with ?display=swap appended to the Google Fonts URL in Webflow\'s custom code settings. Consider self-hosting fonts by downloading the WOFF2 files and uploading to Webflow\'s assets.',
    estimatedImpact: { fcp: 200 },
    difficulty: 'medium',
    severity: 'medium',
  })

  return { url, platform: 'Webflow', wordpress: null, issues }
}

// ─── SaaS page builders (Wix, Squarespace) ───────────────────────────────────

async function analyzePageBuilderSaaSPlatform(url: string, cms: CMSDetection): Promise<PlatformAnalysis> {
  const issues: PlatformIssue[] = []
  const platform = cms.cms as 'Wix' | 'Squarespace'

  const platformNotes: Record<string, { mainIssue: string; imageRec: string; scriptRec: string }> = {
    Wix: {
      mainIssue: 'Wix generates heavy JavaScript bundles and hydrates the entire page client-side.',
      imageRec: 'Use Wix\'s native image optimizer and set images to "smart crop" for responsive loading. Avoid uploading oversized images — Wix serves them at full resolution if not configured.',
      scriptRec: 'Remove unused Wix apps from your site. Each installed app (even unused) loads scripts. Use Wix\'s Site Speed dashboard to identify slow elements.',
    },
    Squarespace: {
      mainIssue: 'Squarespace loads large framework JS and CSS on every page regardless of what is used.',
      imageRec: 'Upload images as WebP in Squarespace\'s asset manager. Use the Image Block\'s focal point and size settings to avoid serving oversized images.',
      scriptRec: 'Keep code injection (Settings > Advanced > Code Injection) minimal — each added script blocks rendering. Use Squarespace\'s built-in analytics instead of third-party GA where possible.',
    },
  }

  const notes = platformNotes[platform] ?? platformNotes['Squarespace']

  issues.push({
    type: `${platform.toLowerCase()}_platform`,
    description: notes.mainIssue,
    recommendation: `${platform} has limited performance tuning options. Focus on: (1) image optimization, (2) removing unused apps/plugins, (3) minimizing custom code injection, (4) using a custom domain with Cloudflare in front for caching and compression.`,
    estimatedImpact: {},
    difficulty: 'medium',
    severity: 'medium',
  })

  issues.push({
    type: `${platform.toLowerCase()}_images`,
    description: 'Images may not be optimally sized or formatted for this platform.',
    recommendation: notes.imageRec,
    estimatedImpact: { lcp: 500 },
    difficulty: 'easy',
    severity: 'high',
  })

  issues.push({
    type: `${platform.toLowerCase()}_scripts`,
    description: 'Third-party scripts and platform apps add significant JavaScript weight.',
    recommendation: notes.scriptRec,
    estimatedImpact: { lcp: 300, inp: 100 },
    difficulty: 'easy',
    severity: 'medium',
  })

  return { url, platform, wordpress: null, issues }
}

// ─── Generic (unknown or unrecognized CMS) ────────────────────────────────────

async function analyzeGenericPlatform(url: string, cms: CMSDetection): Promise<PlatformAnalysis> {
  const issues: PlatformIssue[] = []

  issues.push({
    type: 'generic_images',
    description: 'Ensure images use modern formats (AVIF/WebP) and are appropriately sized.',
    recommendation: 'Convert PNG/JPEG images to AVIF or WebP. Use sharp (Node.js) or Squoosh for batch conversion. Serve the correct size for each breakpoint with srcset and sizes attributes.',
    estimatedImpact: { lcp: 600 },
    difficulty: 'easy',
    severity: 'high',
  })

  issues.push({
    type: 'generic_caching',
    description: 'Static assets should be cached aggressively.',
    recommendation: 'Set Cache-Control: public, max-age=31536000, immutable on all versioned JS/CSS/font/image files. Cache HTML with a short TTL (60–300s) or use stale-while-revalidate.',
    estimatedImpact: { lcp: 300 },
    difficulty: 'medium',
    severity: 'high',
  })

  issues.push({
    type: 'generic_cdn',
    description: 'Assets should be served from a CDN close to users.',
    recommendation: 'Put a CDN (Cloudflare Free, Fastly, or AWS CloudFront) in front of your origin. This reduces TTFB for static assets to <50ms for most users globally.',
    estimatedImpact: { lcp: 400, ttfb: 300 },
    difficulty: 'medium',
    severity: 'high',
  })

  issues.push({
    type: 'generic_rendering',
    description: 'Ensure pages are server-rendered or statically generated rather than client-rendered.',
    recommendation: 'Client-side rendering (React/Vue/Angular apps without SSR) causes poor FCP and LCP. Use SSR (Next.js, Nuxt, SvelteKit) or static generation to deliver content-ready HTML.',
    estimatedImpact: { lcp: 800, fcp: 600 },
    difficulty: 'hard',
    severity: 'medium',
  })

  return {
    url,
    platform: cms.cms,
    wordpress: null,
    issues,
  }
}
