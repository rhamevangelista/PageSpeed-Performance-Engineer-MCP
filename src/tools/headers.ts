import type { HeaderAnalysis, HeaderIssue } from '../types.js'

export async function analyzeHeaders(url: string): Promise<HeaderAnalysis> {
  const issues: HeaderIssue[] = []

  let response: Response
  try {
    response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    // Fall back to GET if HEAD is rejected (some servers return 405)
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  }

  const h = response.headers
  const status = response.status

  // ── Compression ──────────────────────────────────────────────────────────
  const encoding = h.get('content-encoding') ?? ''
  const compression: HeaderAnalysis['compression'] = encoding.includes('br')
    ? 'brotli'
    : encoding.includes('gzip')
    ? 'gzip'
    : 'none'

  if (compression === 'none') {
    issues.push({
      type: 'missing_compression',
      description: 'Response is not compressed. Enable Brotli (preferred) or gzip.',
      severity: 'high',
    })
  } else if (compression === 'gzip') {
    issues.push({
      type: 'missing_compression',
      description: 'Response uses gzip. Upgrade to Brotli for ~15–20% smaller transfers.',
      severity: 'low',
    })
  }

  // ── Cache-Control ─────────────────────────────────────────────────────────
  const cacheControl = h.get('cache-control')
  if (!cacheControl) {
    issues.push({
      type: 'no_cache',
      description: 'No Cache-Control header. Add cache-control: public, max-age=31536000, immutable for static assets.',
      severity: 'high',
    })
  } else if (cacheControl.includes('no-store') || cacheControl.includes('no-cache')) {
    // not necessarily an issue for HTML — log but keep low severity
    issues.push({
      type: 'no_cache',
      description: `Cache-Control disables caching: "${cacheControl}". Ensure static assets have long TTLs.`,
      severity: 'low',
    })
  }

  // ── ETag ──────────────────────────────────────────────────────────────────
  const etag = h.get('etag')
  if (!etag && !cacheControl?.includes('immutable')) {
    issues.push({
      type: 'no_etag',
      description: 'No ETag header. ETags enable efficient conditional requests (304 Not Modified).',
      severity: 'low',
    })
  }

  // ── Security headers ───────────────────────────────────────────────────────
  const hsts = h.has('strict-transport-security')
  const csp = h.has('content-security-policy')
  const xFrameOptions = h.has('x-frame-options')

  if (!hsts) {
    issues.push({
      type: 'missing_security_header',
      description: 'Missing Strict-Transport-Security (HSTS). Add: max-age=31536000; includeSubDomains',
      severity: 'medium',
    })
  }

  // ── Cloudflare detection ───────────────────────────────────────────────────
  const cfHeaders: Record<string, string> = {}
  for (const [key, value] of h.entries()) {
    if (key.toLowerCase().startsWith('cf-')) {
      cfHeaders[key] = value
    }
  }
  const isCloudflare =
    (h.get('server') ?? '').toLowerCase().includes('cloudflare') ||
    Object.keys(cfHeaders).length > 0

  // ── HTTP/2 detection ───────────────────────────────────────────────────────
  // Node fetch doesn't expose protocol version directly, so we infer from headers
  // Cloudflare and most CDNs serve over HTTP/2+; we flag absence as a likely concern
  const server = h.get('server')
  const http2 = isCloudflare || (server ?? '').toLowerCase().includes('nginx') || (server ?? '').toLowerCase().includes('apache')

  return {
    url,
    statusCode: status,
    compression,
    cacheControl,
    etag,
    server,
    poweredBy: h.get('x-powered-by'),
    isCloudflare,
    cloudflareHeaders: cfHeaders,
    http2,
    securityHeaders: { hsts, csp, xFrameOptions },
    issues,
  }
}
