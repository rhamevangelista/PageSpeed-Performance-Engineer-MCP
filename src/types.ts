// ─── Shared primitives ────────────────────────────────────────────────────────

export type Strategy = 'mobile' | 'desktop'
export type Difficulty = 'easy' | 'medium' | 'hard'
export type CWVSource = 'field' | 'lab'

// ─── Core Web Vitals ──────────────────────────────────────────────────────────

export interface CoreWebVitals {
  lcp: number | null   // ms
  cls: number | null   // score (0–1)
  inp: number | null   // ms
  fcp: number | null   // ms
  ttfb: number | null  // ms
  source: CWVSource
}

// ─── Lighthouse ───────────────────────────────────────────────────────────────

export interface LighthouseScores {
  performance: number        // 0–100
  accessibility: number
  bestPractices: number
  seo: number
}

export interface LighthouseResult {
  url: string
  strategy: Strategy
  scores: LighthouseScores
  coreWebVitals: CoreWebVitals
  opportunities: LighthouseOpportunity[]
  rawReportPath?: string
}

export interface LighthouseOpportunity {
  id: string
  title: string
  description: string
  savingsMs?: number
  savingsBytes?: number
}

// ─── HTTP Headers ─────────────────────────────────────────────────────────────

export interface HeaderAnalysis {
  url: string
  statusCode: number
  compression: 'brotli' | 'gzip' | 'none'
  cacheControl: string | null
  etag: string | null
  server: string | null
  poweredBy: string | null
  isCloudflare: boolean
  cloudflareHeaders: Record<string, string>
  http2: boolean
  securityHeaders: {
    hsts: boolean
    csp: boolean
    xFrameOptions: boolean
  }
  issues: HeaderIssue[]
}

export interface HeaderIssue {
  type: 'missing_compression' | 'no_cache' | 'missing_security_header' | 'no_etag'
  description: string
  severity: 'high' | 'medium' | 'low'
}

// ─── HTML Analysis ────────────────────────────────────────────────────────────

export interface HtmlAnalysis {
  url: string
  title: string | null
  metaDescription: string | null
  hasCanonical: boolean
  hasViewport: boolean
  h1Count: number
  renderBlockingStylesheets: string[]
  renderBlockingScripts: string[]
  inlineScriptCount: number
  totalExternalScripts: number
  deferredScripts: number
  asyncScripts: number
  issues: HtmlIssue[]
}

export interface HtmlIssue {
  type: string
  description: string
  element?: string
  severity: 'high' | 'medium' | 'low'
}

// ─── CMS Detection ────────────────────────────────────────────────────────────

export type CMSName =
  | 'WordPress'
  | 'Shopify'
  | 'Next.js'
  | 'Nuxt'
  | 'Astro'
  | 'Laravel'
  | 'Joomla'
  | 'Drupal'
  | 'Wix'
  | 'Squarespace'
  | 'Webflow'
  | 'unknown'

export interface CMSDetection {
  cms: CMSName
  confidence: number   // 0–1
  signals: string[]    // evidence that led to detection
  plugins: string[]    // detected plugins/themes (WordPress-centric initially)
  hosting: string | null
}

// ─── WordPress Inspector ──────────────────────────────────────────────────────

export interface WordPressPlugin {
  name: string
  slug: string
  detected: boolean
  signals: string[]
}

export interface WordPressAnalysis {
  url: string
  isWordPress: boolean
  version: string | null
  theme: string | null
  plugins: WordPressPlugin[]
  hasPageBuilder: boolean
  hasEcommerce: boolean
  hasCachePlugin: boolean
  hasSEOPlugin: boolean
  issues: WordPressIssue[]
}

export interface WordPressIssue {
  plugin: string
  issue: string
  recommendation: string
  estimatedLcpImpactMs: number | null
  difficulty: Difficulty
}

// ─── Cloudflare Inspector ─────────────────────────────────────────────────────

export interface CloudflareAnalysis {
  url: string
  isCloudflare: boolean
  cacheStatus: string | null
  cfRay: string | null
  brotliEnabled: boolean
  http3Enabled: boolean
  earlyHintsEnabled: boolean
  polishEnabled: boolean | null  // null = unknown (can't detect without API)
  issues: CloudflareIssue[]
  recommendations: CloudflareRecommendation[]
}

export interface CloudflareIssue {
  type: string
  description: string
  severity: 'high' | 'medium' | 'low'
}

export interface CloudflareRecommendation {
  title: string
  description: string
  ruleType: 'cache_rule' | 'transform_rule' | 'page_rule' | 'setting'
  config?: Record<string, unknown>
}

// ─── Platform Analysis (generic + platform-specific) ─────────────────────────

export interface PlatformIssue {
  type: string
  description: string
  recommendation: string
  estimatedImpact: { lcp?: number; cls?: number; inp?: number; fcp?: number; ttfb?: number }
  difficulty: Difficulty
  severity: 'high' | 'medium' | 'low'
}

export interface PlatformAnalysis {
  url: string
  platform: CMSName
  // WordPress populated only when platform === 'WordPress'
  wordpress: WordPressAnalysis | null
  issues: PlatformIssue[]
}

// ─── Image Analysis ───────────────────────────────────────────────────────────

export interface ImageAnalysis {
  url: string
  images: ImageIssue[]
  totalSavingsBytes: number
  totalSavingsMs: number
}

export interface ImageIssue {
  src: string
  sizeBytes: number | null
  format: string | null
  displayWidth: number | null
  displayHeight: number | null
  naturalWidth: number | null
  naturalHeight: number | null
  hasLazyLoading: boolean
  hasDimensions: boolean
  isLCPCandidate: boolean
  issues: Array<'oversized' | 'wrong_format' | 'missing_lazy' | 'missing_dimensions' | 'needs_preload'>
  potentialSavingsBytes: number
}

// ─── CSS Analysis ─────────────────────────────────────────────────────────────

export interface CSSAnalysis {
  url: string
  stylesheets: StylesheetInfo[]
  unusedCSSPercent: number
  renderBlockingCount: number
  hasCriticalCSS: boolean
  issues: CSSIssue[]
}

export interface StylesheetInfo {
  url: string
  sizeBytes: number | null
  usedPercent: number | null
  isRenderBlocking: boolean
  isFramework: string | null  // 'Bootstrap', 'Tailwind', etc.
}

export interface CSSIssue {
  type: 'render_blocking' | 'unused_css' | 'large_framework' | 'no_critical_css' | 'duplicate_rules'
  description: string
  url?: string
  severity: 'high' | 'medium' | 'low'
}

// ─── JavaScript Analysis ──────────────────────────────────────────────────────

export interface JSAnalysis {
  url: string
  scripts: ScriptInfo[]
  unusedJSPercent: number
  thirdPartyScripts: ThirdPartyScript[]
  issues: JSIssue[]
}

export interface ScriptInfo {
  url: string | null  // null for inline scripts
  sizeBytes: number | null
  usedPercent: number | null
  isDeferred: boolean
  isAsync: boolean
  isRenderBlocking: boolean
  isThirdParty: boolean
}

export interface ThirdPartyScript {
  domain: string
  vendor: string
  sizeBytes: number | null
  category: 'analytics' | 'marketing' | 'support' | 'social' | 'other'
}

export interface JSIssue {
  type: 'render_blocking' | 'unused_js' | 'large_bundle' | 'sync_third_party' | 'no_defer'
  description: string
  url?: string
  severity: 'high' | 'medium' | 'low'
}

// ─── Font Analysis ────────────────────────────────────────────────────────────

export interface FontAnalysis {
  url: string
  fonts: FontInfo[]
  hasGoogleFontsPreconnect: boolean
  hasGoogleFontsImport: boolean  // CSS @import — worst case
  issues: FontIssue[]
}

export interface FontInfo {
  url: string
  format: string | null
  isWOFF2: boolean
  fontDisplay: string | null
  isPreloaded: boolean
}

export interface FontIssue {
  type: 'missing_preconnect' | 'css_import' | 'missing_font_display' | 'not_woff2' | 'not_preloaded'
  description: string
  severity: 'high' | 'medium' | 'low'
}

// ─── Recommendation Engine ────────────────────────────────────────────────────

export interface Recommendation {
  priority: number
  category: 'images' | 'css' | 'javascript' | 'fonts' | 'server' | 'wordpress' | 'cloudflare' | 'html'
  issue: string
  evidence: string
  estimatedImpact: {
    lcp?: number   // ms improvement
    cls?: number   // score improvement
    inp?: number   // ms improvement
    fcp?: number   // ms improvement
    score?: number // Lighthouse score points
  }
  difficulty: Difficulty
  fix: string
  learnMore?: string
}

// ─── Full Analysis Report ─────────────────────────────────────────────────────

export interface AnalysisReport {
  url: string
  analyzedAt: string              // ISO 8601
  scores: LighthouseScores | null
  coreWebVitals: CoreWebVitals | null
  cms: CMSDetection | null
  platform: PlatformAnalysis | null
  cloudflare: CloudflareAnalysis | null
  headers: HeaderAnalysis | null
  html: HtmlAnalysis | null
  images: ImageAnalysis | null
  css: CSSAnalysis | null
  js: JSAnalysis | null
  fonts: FontAnalysis | null
  recommendations: Recommendation[]
  errors: AnalysisError[]
}

export interface AnalysisError {
  tool: string
  message: string
}

// ─── Tool input/output contracts (used by server.ts for Zod schemas) ──────────

export interface AnalyzeWebsiteInput {
  url: string
  includeScreenshot?: boolean
}

export interface RunLighthouseInput {
  url: string
  strategy?: Strategy
}

export interface GetCoreWebVitalsInput {
  url: string
  strategy?: Strategy
}

export interface AnalyzeHeadersInput {
  url: string
}

export interface DetectCMSInput {
  url: string
}

export interface WordPressInspectorInput {
  url: string
}

export interface CloudflareInspectorInput {
  url: string
}

export interface AnalyzeImagesInput {
  url: string
}

export interface AnalyzeCSSInput {
  url: string
}

export interface AnalyzeJSInput {
  url: string
}

export interface AnalyzeFontsInput {
  url: string
}

// ─── WP Rocket Config Generator ───────────────────────────────────────────────

export interface WPRocketConfig {
  version: string
  generated_at: string
  url: string
  settings: {
    cache: Record<string, unknown>
    file_optimization: Record<string, unknown>
    media: Record<string, unknown>
    preload: Record<string, unknown>
    advanced_rules: Record<string, unknown>
  }
  rationale: string[]
  warnings: string[]
}

// ─── Performance Comparison ───────────────────────────────────────────────────

export interface MetricDelta {
  metric: string
  before: number | null
  after: number | null
  delta: number | null
  improved: boolean | null
}

export interface ComparisonReport {
  url_before: string
  url_after: string
  analyzed_at: string
  score_deltas: MetricDelta[]
  cwv_deltas: MetricDelta[]
  recommendations_before: number
  recommendations_after: number
  new_issues: string[]
  resolved_issues: string[]
  summary: string
}

export interface GenerateRecommendationsInput {
  lighthouse?: LighthouseResult
  headers?: HeaderAnalysis
  html?: HtmlAnalysis
  cms?: CMSDetection
  platform?: PlatformAnalysis
  cloudflare?: CloudflareAnalysis
  images?: ImageAnalysis
  css?: CSSAnalysis
  js?: JSAnalysis
  fonts?: FontAnalysis
}
