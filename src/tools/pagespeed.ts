import type { CoreWebVitals } from '../types.js'
import type { Strategy } from '../types.js'

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

interface PSICategory {
  score: number | null
}

interface PSIMetricValue {
  displayValue?: string
  numericValue?: number
  percentile?: number
}

interface PSILoadingExperience {
  metrics?: {
    LARGEST_CONTENTFUL_PAINT_MS?: PSIMetricValue
    CUMULATIVE_LAYOUT_SHIFT_SCORE?: PSIMetricValue
    INTERACTION_TO_NEXT_PAINT?: PSIMetricValue
    FIRST_CONTENTFUL_PAINT_MS?: PSIMetricValue
    EXPERIMENTAL_TIME_TO_FIRST_BYTE?: PSIMetricValue
  }
}

interface PSIResponse {
  lighthouseResult?: {
    categories?: {
      performance?: PSICategory
      accessibility?: PSICategory
      'best-practices'?: PSICategory
      seo?: PSICategory
    }
    audits?: {
      'largest-contentful-paint'?: { numericValue?: number }
      'cumulative-layout-shift'?: { numericValue?: number }
      'interaction-to-next-paint'?: { numericValue?: number }
      'first-contentful-paint'?: { numericValue?: number }
      'server-response-time'?: { numericValue?: number }
    }
  }
  loadingExperience?: PSILoadingExperience
  originLoadingExperience?: PSILoadingExperience
}

export async function getCoreWebVitals(url: string, strategy: Strategy = 'mobile'): Promise<CoreWebVitals> {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY

  if (!apiKey) {
    return getLabDataFromLighthouse(url, strategy)
  }

  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy: strategy.toUpperCase(),
    category: 'performance',
  })

  const response = await fetch(`${PSI_ENDPOINT}?${params}`, {
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    console.error(`PSI API error ${response.status}: ${await response.text()}`)
    return getLabDataFromLighthouse(url, strategy)
  }

  const data = (await response.json()) as PSIResponse
  const lhr = data.lighthouseResult
  const fieldData = data.loadingExperience?.metrics ?? data.originLoadingExperience?.metrics

  // Prefer field data (real-user CrUX), fall back to lab data
  if (fieldData) {
    return {
      lcp: fieldData.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
      cls: fieldData.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null
        ? fieldData.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
        : null,
      inp: fieldData.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
      fcp: fieldData.FIRST_CONTENTFUL_PAINT_MS?.percentile ?? null,
      ttfb: fieldData.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile ?? null,
      source: 'field',
    }
  }

  // Lab data fallback from PSI Lighthouse
  const audits = lhr?.audits
  return {
    lcp: audits?.['largest-contentful-paint']?.numericValue ?? null,
    cls: audits?.['cumulative-layout-shift']?.numericValue ?? null,
    inp: audits?.['interaction-to-next-paint']?.numericValue ?? null,
    fcp: audits?.['first-contentful-paint']?.numericValue ?? null,
    ttfb: audits?.['server-response-time']?.numericValue ?? null,
    source: 'lab',
  }
}

// Used when no API key is present — runs a minimal Lighthouse pass locally
async function getLabDataFromLighthouse(url: string, strategy: Strategy): Promise<CoreWebVitals> {
  try {
    const { runLighthouse } = await import('./lighthouse.js')
    const result = await runLighthouse(url, strategy)
    return result.coreWebVitals
  } catch (err) {
    console.error('Lighthouse fallback failed:', err)
    return {
      lcp: null,
      cls: null,
      inp: null,
      fcp: null,
      ttfb: null,
      source: 'lab',
    }
  }
}
