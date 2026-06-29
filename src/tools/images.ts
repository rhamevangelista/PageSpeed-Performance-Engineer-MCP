import { newContext } from '../browser.js'
import type { ImageAnalysis, ImageIssue } from '../types.js'

// Rough LCP contribution: ~1ms per 50KB over the wire
const MS_PER_BYTE = 1 / 50_000

interface RawImage {
  src: string
  srcset: string | null
  loading: string | null
  width: number | null
  height: number | null
  naturalWidth: number
  naturalHeight: number
  displayWidth: number
  displayHeight: number
  isAboveFold: boolean
  isLargest: boolean
}

export async function analyzeImages(url: string): Promise<ImageAnalysis> {
  const ctx = await newContext()
  const page = await ctx.newPage()

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })

    // Collect all <img> elements with their metrics
    const rawImages: RawImage[] = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'))
      const viewportH = window.innerHeight

      let largestArea = 0
      let largestIdx = 0
      imgs.forEach((img, i) => {
        const rect = img.getBoundingClientRect()
        const area = rect.width * rect.height
        if (area > largestArea) {
          largestArea = area
          largestIdx = i
        }
      })

      return imgs.map((img, i) => {
        const rect = img.getBoundingClientRect()
        return {
          src: img.src,
          srcset: img.getAttribute('srcset'),
          loading: img.getAttribute('loading'),
          width: img.hasAttribute('width') ? img.width : null,
          height: img.hasAttribute('height') ? img.height : null,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          displayWidth: Math.round(rect.width),
          displayHeight: Math.round(rect.height),
          isAboveFold: rect.top < viewportH,
          isLargest: i === largestIdx,
        }
      })
    })

    // For each image, fetch Content-Length via HEAD to get file size
    const imageIssues: ImageIssue[] = []
    let totalSavingsBytes = 0

    for (const raw of rawImages) {
      if (!raw.src || raw.src.startsWith('data:')) continue

      const issues: ImageIssue['issues'] = []
      let sizeBytes: number | null = null
      let format: string | null = null

      try {
        const headRes = await fetch(raw.src, {
          method: 'HEAD',
          signal: AbortSignal.timeout(8_000),
        })
        const cl = headRes.headers.get('content-length')
        if (cl) sizeBytes = parseInt(cl, 10)
        const ct = headRes.headers.get('content-type') ?? ''
        format = parseFormat(ct, raw.src)
      } catch {
        // Size unknown — use URL to guess format at least
        format = guessFormatFromUrl(raw.src)
      }

      // ── Issue detection ─────────────────────────────────────────────────
      const isOversized =
        sizeBytes !== null &&
        sizeBytes > 200_000 &&
        !['webp', 'avif'].includes(format ?? '')

      if (isOversized) issues.push('oversized')

      const isWrongFormat = ['jpeg', 'jpg', 'png', 'gif'].includes(format ?? '')
      if (isWrongFormat && (sizeBytes ?? 0) > 50_000) issues.push('wrong_format')

      // Missing lazy loading on a below-fold image
      const isBelowFold = !raw.isAboveFold
      const hasLazyLoading = raw.loading === 'lazy'
      if (isBelowFold && !hasLazyLoading) issues.push('missing_lazy')

      // Missing explicit width/height → causes layout shift
      const hasDimensions = raw.width !== null && raw.height !== null
      if (!hasDimensions) issues.push('missing_dimensions')

      // LCP hero candidate should be preloaded
      const isLCPCandidate = raw.isLargest && raw.isAboveFold
      if (isLCPCandidate && !hasDimensions) issues.push('missing_dimensions')
      if (isLCPCandidate && hasLazyLoading) issues.push('needs_preload') // lazy on LCP is bad
      if (isLCPCandidate && !hasLazyLoading) issues.push('needs_preload') // should be preloaded

      // Potential savings: converting PNG/JPEG > 50KB to AVIF saves ~70%
      let potentialSavingsBytes = 0
      if (isWrongFormat && sizeBytes !== null && sizeBytes > 50_000) {
        potentialSavingsBytes = Math.round(sizeBytes * 0.65) // ~65% savings with AVIF
        totalSavingsBytes += potentialSavingsBytes
      } else if (isOversized && sizeBytes !== null) {
        // Resizing to displayed dimensions
        const displayArea = raw.displayWidth * raw.displayHeight
        const naturalArea = raw.naturalWidth * raw.naturalHeight
        if (naturalArea > 0 && displayArea < naturalArea) {
          potentialSavingsBytes = Math.round(sizeBytes * (1 - displayArea / naturalArea) * 0.8)
          totalSavingsBytes += potentialSavingsBytes
        }
      }

      // Only include images with actual issues
      if (issues.length > 0 || isLCPCandidate) {
        imageIssues.push({
          src: raw.src,
          sizeBytes,
          format,
          displayWidth: raw.displayWidth,
          displayHeight: raw.displayHeight,
          naturalWidth: raw.naturalWidth,
          naturalHeight: raw.naturalHeight,
          hasLazyLoading,
          hasDimensions,
          isLCPCandidate,
          issues,
          potentialSavingsBytes,
        })
      }
    }

    // Rough LCP savings: every 100KB saved ≈ 600ms LCP improvement on mobile
    const totalSavingsMs = Math.round(totalSavingsBytes * MS_PER_BYTE * 30_000)

    return {
      url,
      images: imageIssues,
      totalSavingsBytes,
      totalSavingsMs,
    }
  } finally {
    await ctx.close()
  }
}

function parseFormat(contentType: string, src: string): string | null {
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('avif')) return 'avif'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpeg'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('svg')) return 'svg'
  return guessFormatFromUrl(src)
}

function guessFormatFromUrl(src: string): string | null {
  const ext = src.split('?')[0].split('.').pop()?.toLowerCase()
  const known = ['webp', 'avif', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico']
  return known.includes(ext ?? '') ? (ext === 'jpg' ? 'jpeg' : (ext ?? null)) : null
}
