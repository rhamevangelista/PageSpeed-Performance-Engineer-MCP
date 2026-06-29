import type {
  Recommendation,
  AnalysisReport,
  GenerateRecommendationsInput,
} from '../types.js'
import { runLighthouse } from './lighthouse.js'
import { getCoreWebVitals } from './pagespeed.js'
import { analyzeHeaders } from './headers.js'
import { analyzeHtml } from './html.js'
import { detectCMS } from './cms.js'
import { analyzeImages } from './images.js'
import { analyzeCSS } from './css.js'
import { analyzeJavaScript } from './javascript.js'
import { analyzeFonts } from './fonts.js'
import { analyzePlatform } from './platform.js'
import { analyzeCloudflare } from './cloudflare.js'

// Difficulty weights used to compute priority score:
// priority = estimatedImpact / difficultyWeight
const DIFFICULTY_WEIGHT: Record<string, number> = {
  easy: 1,
  medium: 2,
  hard: 4,
}

export function generateRecommendations(inputs: GenerateRecommendationsInput): Recommendation[] {
  const recs: Recommendation[] = []

  // ── From Lighthouse opportunities ─────────────────────────────────────────
  if (inputs.lighthouse) {
    for (const opp of inputs.lighthouse.opportunities) {
      if (!opp.savingsMs && !opp.savingsBytes) continue
      const savingsMs = opp.savingsMs ?? 0

      const difficulty = savingsBytes(opp.savingsBytes) > 500_000 ? 'medium' : 'easy'

      recs.push({
        priority: 0,
        category: oppCategory(opp.id),
        issue: opp.title,
        evidence: opp.description,
        estimatedImpact: {
          lcp: savingsMs > 0 ? Math.round(savingsMs) : undefined,
        },
        difficulty,
        fix: lighthouseFix(opp.id),
        learnMore: `https://developer.chrome.com/docs/lighthouse/performance/${opp.id}/`,
      })
    }
  }

  // ── From header analysis ───────────────────────────────────────────────────
  if (inputs.headers) {
    for (const issue of inputs.headers.issues) {
      if (issue.type === 'missing_compression') {
        recs.push({
          priority: 0,
          category: 'server',
          issue: 'Enable Brotli compression',
          evidence: issue.description,
          estimatedImpact: { lcp: 300 },
          difficulty: 'easy',
          fix: 'Enable Brotli on your web server or CDN. On Cloudflare, it is on by default. On nginx: brotli on; brotli_comp_level 6;',
        })
      }
      if (issue.type === 'no_cache') {
        recs.push({
          priority: 0,
          category: 'server',
          issue: 'Add caching headers for static assets',
          evidence: issue.description,
          estimatedImpact: { lcp: 200 },
          difficulty: 'easy',
          fix: 'Add Cache-Control: public, max-age=31536000, immutable for versioned JS/CSS/images.',
        })
      }
    }
  }

  // ── From HTML analysis ─────────────────────────────────────────────────────
  if (inputs.html) {
    for (const issue of inputs.html.issues) {
      if (issue.type === 'render_blocking_stylesheets') {
        recs.push({
          priority: 0,
          category: 'css',
          issue: 'Eliminate render-blocking stylesheets',
          evidence: issue.description,
          estimatedImpact: { lcp: 500, fcp: 400 },
          difficulty: 'medium',
          fix: 'Inline critical above-the-fold CSS, then load the full stylesheet with rel="preload" + onload trick or media="print" swap.',
        })
      }
      if (issue.type === 'render_blocking_scripts') {
        recs.push({
          priority: 0,
          category: 'javascript',
          issue: 'Add defer/async to render-blocking scripts',
          evidence: issue.description,
          estimatedImpact: { lcp: 400 },
          difficulty: 'easy',
          fix: 'Add the defer attribute to <script> tags that do not need to run before the page renders.',
        })
      }
      if (issue.type === 'no_preload_hints') {
        recs.push({
          priority: 0,
          category: 'html',
          issue: 'Add preload hints for critical resources',
          evidence: issue.description,
          estimatedImpact: { lcp: 300 },
          difficulty: 'easy',
          fix: 'Add <link rel="preload" as="image"> for the LCP image and <link rel="preload" as="font"> for the primary font.',
        })
      }
    }
  }

  // ── Platform-specific recommendations ────────────────────────────────────
  if (inputs.platform) {
    for (const issue of inputs.platform.issues) {
      const cat: Recommendation['category'] =
        inputs.platform.platform === 'WordPress' ? 'wordpress' : 'html'

      recs.push({
        priority: 0,
        category: cat,
        issue: issue.description,
        evidence: `Platform: ${inputs.platform.platform}`,
        estimatedImpact: issue.estimatedImpact,
        difficulty: issue.difficulty,
        fix: issue.recommendation,
      })
    }
  }

  // ── Cloudflare recommendations ────────────────────────────────────────────
  if (inputs.cloudflare?.isCloudflare) {
    for (const issue of inputs.cloudflare.issues) {
      if (issue.severity === 'low') continue
      recs.push({
        priority: 0,
        category: 'cloudflare',
        issue: issue.description,
        evidence: `Cloudflare header analysis`,
        estimatedImpact: { lcp: issue.severity === 'high' ? 300 : 150 },
        difficulty: 'easy',
        fix: inputs.cloudflare.recommendations.find((r) => r.title.toLowerCase().includes(issue.type.replace('_', ' ')))?.description ?? 'Review Cloudflare dashboard settings.',
      })
    }
  }

  // ── Image recommendations ─────────────────────────────────────────────────
  if (inputs.images) {
    const { images, totalSavingsBytes } = inputs.images

    const lcpImage = images.find((img) => img.isLCPCandidate)
    if (lcpImage) {
      if (lcpImage.issues.includes('wrong_format')) {
        recs.push({
          priority: 0,
          category: 'images',
          issue: 'LCP hero image is not in AVIF/WebP format',
          evidence: `${lcpImage.src.split('/').pop()} — ${formatBytes(lcpImage.sizeBytes ?? 0)} ${lcpImage.format?.toUpperCase()}`,
          estimatedImpact: { lcp: Math.round((lcpImage.potentialSavingsBytes / 50_000) * 1000) },
          difficulty: 'easy',
          fix: 'Convert the hero image to AVIF (best compression) or WebP. Use <picture> with AVIF source and JPEG/PNG fallback.',
        })
      }
      if (!lcpImage.issues.includes('needs_preload') === false) {
        recs.push({
          priority: 0,
          category: 'images',
          issue: 'LCP image is not preloaded',
          evidence: `Largest above-fold image: ${lcpImage.src.split('/').pop()}`,
          estimatedImpact: { lcp: 400 },
          difficulty: 'easy',
          fix: 'Add to <head>: <link rel="preload" as="image" fetchpriority="high" href="[hero-image-url]">',
        })
      }
    }

    const wrongFormatImages = images.filter((img) => img.issues.includes('wrong_format') && !img.isLCPCandidate)
    if (wrongFormatImages.length > 0) {
      recs.push({
        priority: 0,
        category: 'images',
        issue: `${wrongFormatImages.length} image(s) in legacy format (PNG/JPEG)`,
        evidence: `Estimated savings: ${formatBytes(totalSavingsBytes)}`,
        estimatedImpact: { lcp: Math.min(Math.round(totalSavingsBytes / 100_000) * 200, 1200) },
        difficulty: 'easy',
        fix: 'Convert images to AVIF or WebP. Cloudflare Polish, Imagify, or ShortPixel can automate this for WordPress.',
      })
    }

    const missingLazyImages = images.filter((img) => img.issues.includes('missing_lazy'))
    if (missingLazyImages.length > 0) {
      recs.push({
        priority: 0,
        category: 'images',
        issue: `${missingLazyImages.length} below-fold image(s) missing lazy loading`,
        evidence: missingLazyImages.slice(0, 3).map((i) => i.src.split('/').pop()).join(', '),
        estimatedImpact: { lcp: missingLazyImages.length * 60 },
        difficulty: 'easy',
        fix: 'Add loading="lazy" to all images below the fold. Never add it to the LCP/hero image.',
      })
    }

    const missingDimensionImages = images.filter((img) => img.issues.includes('missing_dimensions'))
    if (missingDimensionImages.length > 0) {
      recs.push({
        priority: 0,
        category: 'images',
        issue: `${missingDimensionImages.length} image(s) missing explicit width/height`,
        evidence: 'Missing dimensions cause layout shift (CLS) as images load.',
        estimatedImpact: { cls: 0.05 * missingDimensionImages.length },
        difficulty: 'easy',
        fix: 'Add width and height attributes to every <img> element matching the intrinsic dimensions of the image.',
      })
    }
  }

  // ── CSS recommendations ────────────────────────────────────────────────────
  if (inputs.css) {
    const { unusedCSSPercent, hasCriticalCSS, issues: cssIssues } = inputs.css

    for (const issue of cssIssues) {
      if (issue.type === 'unused_css' && unusedCSSPercent > 50) {
        recs.push({
          priority: 0,
          category: 'css',
          issue: `${unusedCSSPercent}% of CSS is unused`,
          evidence: issue.description,
          estimatedImpact: { lcp: Math.round(unusedCSSPercent * 8) },
          difficulty: 'medium',
          fix: 'Use PurgeCSS or Tailwind JIT to remove unused rules. For WordPress, use WP Rocket or Perfmatters "Remove Unused CSS" feature.',
        })
        break
      }
    }

    if (!hasCriticalCSS && inputs.css.renderBlockingCount > 0) {
      recs.push({
        priority: 0,
        category: 'css',
        issue: 'No critical CSS inlined',
        evidence: `${inputs.css.renderBlockingCount} render-blocking stylesheet(s) delay first paint`,
        estimatedImpact: { lcp: 500, fcp: 400 },
        difficulty: 'medium',
        fix: 'Extract above-the-fold CSS and inline it in <head>. Tools: Critical (npm), or enable "Critical CSS" in WP Rocket/LiteSpeed Cache.',
      })
    }

    const largeFramework = cssIssues.find((i) => i.type === 'large_framework')
    if (largeFramework) {
      recs.push({
        priority: 0,
        category: 'css',
        issue: largeFramework.description,
        evidence: largeFramework.url ?? '',
        estimatedImpact: { lcp: 300 },
        difficulty: 'hard',
        fix: 'Enable PurgeCSS for Tailwind. For Bootstrap, import only the components you use rather than the full bundle.',
      })
    }
  }

  // ── JavaScript recommendations ─────────────────────────────────────────────
  if (inputs.js) {
    const { unusedJSPercent, thirdPartyScripts, issues: jsIssues } = inputs.js

    if (unusedJSPercent > 40) {
      recs.push({
        priority: 0,
        category: 'javascript',
        issue: `${unusedJSPercent}% of JavaScript is unused`,
        evidence: `${unusedJSPercent}% of downloaded JS code is never executed on this page`,
        estimatedImpact: { lcp: Math.round(unusedJSPercent * 10) },
        difficulty: 'medium',
        fix: 'Enable code splitting so each page only loads the JS it needs. In WordPress, use Perfmatters or WP Rocket to exclude scripts per page.',
      })
    }

    if (thirdPartyScripts.length > 3) {
      const totalThirdPartyKB = Math.round(
        thirdPartyScripts.reduce((acc, s) => acc + (s.sizeBytes ?? 0), 0) / 1_000
      )
      recs.push({
        priority: 0,
        category: 'javascript',
        issue: `${thirdPartyScripts.length} third-party scripts detected`,
        evidence: thirdPartyScripts.map((s) => s.vendor).join(', '),
        estimatedImpact: { lcp: thirdPartyScripts.length * 120, inp: thirdPartyScripts.length * 30 },
        difficulty: 'medium',
        fix: 'Delay non-critical third-party scripts until after user interaction. Use Partytown to run analytics in a Web Worker. Audit and remove unused tags in GTM.',
      })
    }

    for (const issue of jsIssues) {
      if (issue.type === 'sync_third_party') {
        recs.push({
          priority: 0,
          category: 'javascript',
          issue: issue.description,
          evidence: issue.url ?? '',
          estimatedImpact: { lcp: 300 },
          difficulty: 'easy',
          fix: 'Add defer or async to the script tag. Most analytics libraries work fine with defer.',
        })
      }
    }
  }

  // ── Font recommendations ───────────────────────────────────────────────────
  if (inputs.fonts) {
    const { issues: fontIssues } = inputs.fonts

    for (const issue of fontIssues) {
      if (issue.type === 'css_import') {
        recs.push({
          priority: 0,
          category: 'fonts',
          issue: 'Google Fonts loaded via CSS @import',
          evidence: issue.description,
          estimatedImpact: { fcp: 500, lcp: 300 },
          difficulty: 'easy',
          fix: 'Replace @import with <link rel="stylesheet"> in HTML and add <link rel="preconnect" href="https://fonts.googleapis.com"> before it.',
        })
      }
      if (issue.type === 'missing_preconnect') {
        recs.push({
          priority: 0,
          category: 'fonts',
          issue: 'Missing preconnect for Google Fonts',
          evidence: issue.description,
          estimatedImpact: { fcp: 200 },
          difficulty: 'easy',
          fix: 'Add to <head>:\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
        })
        break
      }
      if (issue.type === 'missing_font_display') {
        recs.push({
          priority: 0,
          category: 'fonts',
          issue: 'Missing font-display on self-hosted font',
          evidence: issue.description,
          estimatedImpact: { lcp: 200 },
          difficulty: 'easy',
          fix: 'Add font-display: swap to each @font-face rule, or use font-display: optional to prevent layout shift.',
        })
        break
      }
    }
  }

  // ── Score and sort ─────────────────────────────────────────────────────────
  const scored = recs.map((r, i) => {
    const totalImpact = (r.estimatedImpact.lcp ?? 0) + (r.estimatedImpact.inp ?? 0) + (r.estimatedImpact.fcp ?? 0)
    const weight = DIFFICULTY_WEIGHT[r.difficulty] ?? 2
    const score = totalImpact / weight
    return { ...r, _score: score, _i: i }
  })

  scored.sort((a, b) => b._score - a._score)

  return scored.slice(0, 15).map((r, i) => {
    const { _score, _i, ...clean } = r
    return { ...clean, priority: i + 1 }
  })
}

// ── analyze_website orchestrator ──────────────────────────────────────────────

export async function analyzeWebsite(url: string): Promise<AnalysisReport> {
  const errors: AnalysisReport['errors'] = []
  const report: AnalysisReport = {
    url,
    analyzedAt: new Date().toISOString(),
    scores: null,
    coreWebVitals: null,
    cms: null,
    platform: null,
    cloudflare: null,
    headers: null,
    html: null,
    images: null,
    css: null,
    js: null,
    fonts: null,
    recommendations: [],
    errors,
  }

  // Phase 1: fast parallel fetches (no browser needed)
  const [headersResult, htmlResult] = await Promise.allSettled([
    analyzeHeaders(url),
    analyzeHtml(url),
  ])

  if (headersResult.status === 'fulfilled') {
    report.headers = headersResult.value
  } else {
    errors.push({ tool: 'analyze_headers', message: String(headersResult.reason) })
  }

  if (htmlResult.status === 'fulfilled') {
    report.html = htmlResult.value
  } else {
    errors.push({ tool: 'analyze_html', message: String(htmlResult.reason) })
  }

  // CMS detection first — platform inspector depends on this result
  const cmsResult = await detectCMS(url).catch((err) => {
    errors.push({ tool: 'detect_cms', message: String(err) })
    return null
  })
  report.cms = cmsResult

  // All analysis tools in parallel (Phase 2 + Phase 3 CDN + platform dispatch)
  const [imagesResult, cssResult, jsResult, fontsResult, lhResult, cloudflareResult, platformResult] = await Promise.allSettled([
    analyzeImages(url),
    analyzeCSS(url),
    analyzeJavaScript(url),
    analyzeFonts(url),
    runLighthouse(url, 'mobile'),
    analyzeCloudflare(url),
    // Platform analysis only runs when CMS is confidently detected
    cmsResult && cmsResult.confidence > 0.3
      ? analyzePlatform(url, cmsResult)
      : Promise.resolve(null),
  ])

  const images = imagesResult.status === 'fulfilled' ? imagesResult.value : (errors.push({ tool: 'analyze_images', message: String((imagesResult as PromiseRejectedResult).reason) }), null)
  const css = cssResult.status === 'fulfilled' ? cssResult.value : (errors.push({ tool: 'analyze_css', message: String((cssResult as PromiseRejectedResult).reason) }), null)
  const js = jsResult.status === 'fulfilled' ? jsResult.value : (errors.push({ tool: 'analyze_javascript', message: String((jsResult as PromiseRejectedResult).reason) }), null)
  const fonts = fontsResult.status === 'fulfilled' ? fontsResult.value : (errors.push({ tool: 'analyze_fonts', message: String((fontsResult as PromiseRejectedResult).reason) }), null)
  const lh = lhResult.status === 'fulfilled' ? lhResult.value : (errors.push({ tool: 'run_lighthouse', message: String((lhResult as PromiseRejectedResult).reason) }), null)
  const cloudflare = cloudflareResult.status === 'fulfilled' ? cloudflareResult.value : (errors.push({ tool: 'cloudflare_inspector', message: String((cloudflareResult as PromiseRejectedResult).reason) }), null)
  const platform = platformResult.status === 'fulfilled' ? platformResult.value : (errors.push({ tool: 'analyze_platform', message: String((platformResult as PromiseRejectedResult).reason) }), null)

  report.images = images
  report.css = css
  report.js = js
  report.fonts = fonts
  report.cloudflare = cloudflare
  report.platform = platform

  if (lh) {
    report.scores = lh.scores
    report.coreWebVitals = lh.coreWebVitals
  }

  // Upgrade to real-user CrUX field data if API key is set
  if (process.env.GOOGLE_PAGESPEED_API_KEY) {
    const cwvResult = await getCoreWebVitals(url, 'mobile').catch(() => null)
    if (cwvResult?.source === 'field') {
      report.coreWebVitals = cwvResult
    }
  }

  // Generate recommendations from all collected data
  report.recommendations = generateRecommendations({
    lighthouse: lh ?? undefined,
    headers: report.headers ?? undefined,
    html: report.html ?? undefined,
    cms: report.cms ?? undefined,
    platform: platform ?? undefined,
    cloudflare: cloudflare ?? undefined,
    images: images ?? undefined,
    css: css ?? undefined,
    js: js ?? undefined,
    fonts: fonts ?? undefined,
  })

  return report
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)}KB`
  return `${bytes}B`
}

function savingsBytes(bytes?: number): number {
  return bytes ?? 0
}

function oppCategory(id: string): Recommendation['category'] {
  if (id.includes('image') || id.includes('uses-webp') || id.includes('uses-optimized')) return 'images'
  if (id.includes('css') || id.includes('render-blocking')) return 'css'
  if (id.includes('script') || id.includes('javascript') || id.includes('unused-javascript')) return 'javascript'
  if (id.includes('font')) return 'fonts'
  if (id.includes('server') || id.includes('time-to-first-byte') || id.includes('cache')) return 'server'
  return 'html'
}

function lighthouseFix(id: string): string {
  const fixes: Record<string, string> = {
    'uses-webp-images': 'Convert images to WebP or AVIF format. Use sharp, Squoosh, or enable server-side conversion via Cloudflare Polish or Nginx image_filter.',
    'uses-optimized-images': 'Compress images. Run through imagemin or use a CDN with on-the-fly optimization.',
    'uses-responsive-images': 'Add srcset and sizes attributes so the browser can pick the right image size for each viewport.',
    'offscreen-images': 'Add loading="lazy" to below-the-fold images. Ensure the hero/LCP image does NOT have lazy loading.',
    'render-blocking-resources': 'Defer non-critical CSS and JS. Inline critical CSS.',
    'unused-css-rules': 'Remove unused CSS. Use PurgeCSS for utility frameworks. Consider splitting per-page stylesheets.',
    'unused-javascript': 'Enable code splitting. Load JavaScript only on pages that need it.',
    'unminified-css': 'Minify CSS at build time with cssnano or enable minification in your CDN.',
    'unminified-javascript': 'Minify JS at build time with esbuild or Terser.',
    'uses-long-cache-ttl': 'Set Cache-Control: max-age=31536000, immutable on versioned assets.',
    'server-response-time': 'Reduce TTFB: enable full-page caching, move to a server closer to users, or use a CDN.',
    'uses-text-compression': 'Enable Brotli or gzip compression on your web server or CDN.',
    'efficient-animated-content': 'Replace animated GIFs with video (MP4/WebM). GIFs are far larger for the same content.',
    'preload-lcp-image': 'Add <link rel="preload" as="image" fetchpriority="high"> for the LCP image in the <head>.',
    'prioritize-lcp-image': 'Add fetchpriority="high" to the LCP <img> element.',
  }
  return fixes[id] ?? 'Follow the Lighthouse documentation for this audit.'
}
