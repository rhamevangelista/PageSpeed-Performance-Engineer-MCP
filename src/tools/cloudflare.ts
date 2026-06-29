import type { CloudflareAnalysis, CloudflareIssue, CloudflareRecommendation } from '../types.js'

export async function analyzeCloudflare(url: string): Promise<CloudflareAnalysis> {
  const issues: CloudflareIssue[] = []
  const recommendations: CloudflareRecommendation[] = []

  let response: Response
  try {
    response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  }

  const h = response.headers

  // ── Cloudflare detection ──────────────────────────────────────────────────
  const cfRay = h.get('cf-ray')
  const serverHeader = (h.get('server') ?? '').toLowerCase()
  const isCloudflare = !!cfRay || serverHeader.includes('cloudflare')

  if (!isCloudflare) {
    return {
      url,
      isCloudflare: false,
      cacheStatus: null,
      cfRay: null,
      brotliEnabled: false,
      http3Enabled: false,
      earlyHintsEnabled: false,
      polishEnabled: null,
      issues: [{
        type: 'not_cloudflare',
        description: 'This site does not appear to be behind Cloudflare.',
        severity: 'low',
      }],
      recommendations: [{
        title: 'Consider using Cloudflare',
        description: 'Cloudflare\'s free plan provides a global CDN, DDoS protection, Brotli compression, HTTP/3, and image optimization (Polish) with no configuration. Proxying through Cloudflare typically reduces TTFB by 50–200ms for international visitors.',
        ruleType: 'setting',
      }],
    }
  }

  // ── Cache status ───────────────────────────────────────────────────────────
  const cacheStatus = h.get('cf-cache-status')

  if (cacheStatus === 'MISS' || cacheStatus === 'BYPASS' || cacheStatus === 'DYNAMIC') {
    issues.push({
      type: 'cache_miss',
      description: `Cloudflare is not caching this response (CF-Cache-Status: ${cacheStatus}).`,
      severity: 'high',
    })

    if (cacheStatus === 'BYPASS') {
      recommendations.push({
        title: 'Remove cache bypass conditions',
        description: 'The response is being bypassed from cache. Check for a Cookie header or cache bypass rule. For WordPress: ensure WP Rocket or LiteSpeed Cache isn\'t setting a bypass cookie for logged-out visitors.',
        ruleType: 'cache_rule',
        config: {
          rule: 'Cache Everything',
          edgeTTL: '2 hours',
          browserTTL: '4 hours',
          bypassConditions: 'logged-in users only (wp-settings-* cookie)',
        },
      })
    } else {
      recommendations.push({
        title: 'Enable "Cache Everything" for HTML pages',
        description: 'Cloudflare does not cache HTML by default. Create a Cache Rule to cache HTML responses.',
        ruleType: 'cache_rule',
        config: {
          expression: '(http.request.uri.path matches "^/[^?]*$") and not (http.cookie contains "wordpress_logged_in")',
          action: 'Set cache level: Cache Everything',
          edgeTTL: 'Override: 2 hours',
          browserTTL: 'Override: 4 hours',
        },
      })
    }
  } else if (cacheStatus === 'HIT') {
    // Cache is working — look for optimization opportunities
    const cacheControl = h.get('cache-control') ?? ''
    const maxAge = /max-age=(\d+)/.exec(cacheControl)?.[1]
    if (maxAge && parseInt(maxAge) < 3600) {
      issues.push({
        type: 'short_cache_ttl',
        description: `Cache TTL is ${maxAge}s (${Math.round(parseInt(maxAge) / 60)} min). Short TTLs mean frequent origin fetches.`,
        severity: 'medium',
      })
      recommendations.push({
        title: 'Increase Edge Cache TTL',
        description: 'Set a longer edge TTL in Cloudflare\'s Cache Rule to reduce origin load. Use Cache-Control: stale-while-revalidate for HTML so users always get a fast response while the cache refreshes in the background.',
        ruleType: 'cache_rule',
        config: {
          edgeTTL: '4 hours',
          staleWhileRevalidate: '1 hour',
        },
      })
    }
  }

  // ── Brotli ────────────────────────────────────────────────────────────────
  const encoding = h.get('content-encoding') ?? ''
  const brotliEnabled = encoding.includes('br')

  if (!brotliEnabled) {
    if (encoding.includes('gzip')) {
      issues.push({
        type: 'no_brotli',
        description: 'Response is gzip-compressed but not Brotli. Cloudflare Brotli is enabled by default — your origin may be overriding it.',
        severity: 'low',
      })
    } else if (!encoding) {
      issues.push({
        type: 'no_compression',
        description: 'Response has no compression. Enable Brotli in Cloudflare Speed > Optimization.',
        severity: 'high',
      })
    }
    recommendations.push({
      title: 'Enable Brotli compression',
      description: 'In Cloudflare Dashboard: Speed > Optimization > Content Optimization > enable Brotli. This compresses HTML/CSS/JS ~15% better than gzip.',
      ruleType: 'setting',
      config: { setting: 'Brotli', value: 'On' },
    })
  }

  // ── HTTP/3 ────────────────────────────────────────────────────────────────
  const altSvc = h.get('alt-svc') ?? ''
  const http3Enabled = altSvc.includes('h3') || altSvc.includes('quic')

  if (!http3Enabled) {
    issues.push({
      type: 'no_http3',
      description: 'HTTP/3 (QUIC) is not advertised. HTTP/3 reduces latency especially on lossy mobile connections.',
      severity: 'medium',
    })
    recommendations.push({
      title: 'Enable HTTP/3',
      description: 'In Cloudflare Dashboard: Speed > Optimization > Protocol Optimization > enable HTTP/3 (with QUIC). Most browsers will automatically upgrade to HTTP/3 for subsequent requests.',
      ruleType: 'setting',
      config: { setting: 'HTTP/3', value: 'On' },
    })
  }

  // ── Early Hints ────────────────────────────────────────────────────────────
  const earlyHintsEnabled = h.has('link') && (h.get('link') ?? '').includes('preload')

  if (!earlyHintsEnabled) {
    issues.push({
      type: 'no_early_hints',
      description: 'Cloudflare Early Hints (103) not detected. Early Hints lets the browser preload critical resources while the server prepares the HTML response.',
      severity: 'medium',
    })
    recommendations.push({
      title: 'Enable Early Hints',
      description: 'In Cloudflare Dashboard: Speed > Optimization > Protocol Optimization > enable Early Hints. Also ensure your origin server sends Link: <url>; rel=preload headers for critical CSS, fonts, and the LCP image.',
      ruleType: 'setting',
      config: { setting: 'Early Hints', value: 'On' },
    })
  }

  // ── Polish (image optimization) ────────────────────────────────────────────
  // Polish cannot be detected via headers alone on a HEAD request — we flag unknown
  const polishEnabled: boolean | null = null

  recommendations.push({
    title: 'Enable Cloudflare Polish',
    description: 'Cloudflare Polish (Pro plan+) converts images to WebP on the fly and strips metadata. Enable in Speed > Optimization > Image Optimization. For free plan, use Cloudflare Images or configure your origin to serve WebP.',
    ruleType: 'setting',
    config: { setting: 'Polish', value: 'Lossless or Lossy (based on tolerance)' },
  })

  // ── Tiered Cache ──────────────────────────────────────────────────────────
  recommendations.push({
    title: 'Enable Tiered Cache (Argo)',
    description: 'Cloudflare Argo Smart Routing routes requests through Cloudflare\'s Tier 1 network. Tiered Cache reduces origin requests by using upper-tier data centers as an additional cache layer.',
    ruleType: 'setting',
    config: { setting: 'Argo + Tiered Cache', value: 'On (paid feature, ~$5/month)' },
  })

  // ── Transform Rules for security headers ─────────────────────────────────
  if (!h.has('strict-transport-security')) {
    recommendations.push({
      title: 'Add HSTS via Transform Rule',
      description: 'Set security headers without modifying server config.',
      ruleType: 'transform_rule',
      config: {
        name: 'Security Headers',
        action: 'Rewrite response header',
        headers: [
          { name: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { name: 'X-Content-Type-Options', value: 'nosniff' },
          { name: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    })
  }

  return {
    url,
    isCloudflare,
    cacheStatus,
    cfRay,
    brotliEnabled,
    http3Enabled,
    earlyHintsEnabled,
    polishEnabled,
    issues,
    recommendations,
  }
}
