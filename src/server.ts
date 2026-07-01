import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Resolve .env relative to dist/server.js so it loads correctly regardless of cwd
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env') })

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { closeBrowser } from './browser.js'

// Tool implementations
import { analyzeWebsite } from './tools/recommendations.js'
import { runLighthouse } from './tools/lighthouse.js'
import { getCoreWebVitals } from './tools/pagespeed.js'
import { analyzeHeaders } from './tools/headers.js'
import { analyzeHtml } from './tools/html.js'
import { detectCMS } from './tools/cms.js'
import { analyzeImages } from './tools/images.js'
import { analyzeCSS } from './tools/css.js'
import { analyzeJavaScript } from './tools/javascript.js'
import { analyzeFonts } from './tools/fonts.js'
import { analyzeWordPress } from './tools/wordpress.js'
import { analyzeCloudflare } from './tools/cloudflare.js'
import { generateReport } from './tools/report.js'
import { generateReportHtml } from './tools/report-html.js'
import { generateReportDocx } from './tools/report-docx.js'
import { generateWPRocketConfig } from './tools/wp-rocket.js'
import { generateCloudflareRules } from './tools/cloudflare-rules.js'
import { compareReports } from './tools/compare.js'

const server = new McpServer({
  name: 'performance-engineer-mcp',
  version: '1.0.0',
})

// ─── 1. analyze_website ───────────────────────────────────────────────────────
server.tool(
  'analyze_website',
  'Full performance analysis: runs Lighthouse, PageSpeed Insights, header check, HTML audit, and CMS detection, then returns a prioritized list of Core Web Vitals improvements.',
  {
    url: z.string().url().describe('The URL to analyze'),
  },
  async ({ url }) => {
    const report = await analyzeWebsite(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
    }
  }
)

// ─── 2. run_lighthouse ────────────────────────────────────────────────────────
server.tool(
  'run_lighthouse',
  'Run a Lighthouse audit against a URL for mobile or desktop and return scores, Core Web Vitals lab data, and improvement opportunities.',
  {
    url: z.string().url().describe('The URL to audit'),
    strategy: z.enum(['mobile', 'desktop']).default('mobile').describe('Device type'),
  },
  async ({ url, strategy }) => {
    const result = await runLighthouse(url, strategy)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 3. get_core_web_vitals ───────────────────────────────────────────────────
server.tool(
  'get_core_web_vitals',
  'Fetch Core Web Vitals from Google PageSpeed Insights API (real-user CrUX field data when API key is set, Lighthouse lab data otherwise). Returns LCP, CLS, INP, FCP, TTFB.',
  {
    url: z.string().url().describe('The URL to measure'),
    strategy: z.enum(['mobile', 'desktop']).default('mobile').describe('Device type'),
  },
  async ({ url, strategy }) => {
    const vitals = await getCoreWebVitals(url, strategy)
    return {
      content: [{ type: 'text', text: JSON.stringify(vitals, null, 2) }],
    }
  }
)

// ─── 4. analyze_headers ───────────────────────────────────────────────────────
server.tool(
  'analyze_headers',
  'Inspect HTTP response headers: compression (Brotli/gzip), caching, CDN detection, security headers, and HTTP/2 support.',
  {
    url: z.string().url().describe('The URL to inspect'),
  },
  async ({ url }) => {
    const result = await analyzeHeaders(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 5. analyze_html ─────────────────────────────────────────────────────────
server.tool(
  'analyze_html',
  'Parse the HTML of a page and check for render-blocking resources, missing meta tags, script loading strategy, and head optimizations.',
  {
    url: z.string().url().describe('The URL to parse'),
  },
  async ({ url }) => {
    const result = await analyzeHtml(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 6. detect_cms ───────────────────────────────────────────────────────────
server.tool(
  'detect_cms',
  'Fingerprint the CMS and hosting platform of a website (WordPress, Shopify, Next.js, Nuxt, Astro, etc.).',
  {
    url: z.string().url().describe('The URL to fingerprint'),
  },
  async ({ url }) => {
    const result = await detectCMS(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 7. analyze_images ───────────────────────────────────────────────────────
server.tool(
  'analyze_images',
  'Scan all images on a page: detect oversized images, wrong formats (PNG/JPEG instead of AVIF/WebP), missing lazy loading, missing width/height attributes, and the LCP hero candidate that should be preloaded.',
  {
    url: z.string().url().describe('The URL to scan'),
  },
  async ({ url }) => {
    const result = await analyzeImages(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 8. analyze_css ──────────────────────────────────────────────────────────
server.tool(
  'analyze_css',
  'Use Playwright CSS coverage to find unused CSS, render-blocking stylesheets, and large framework bundles (Bootstrap, Tailwind). Reports per-stylesheet usage percentages and critical CSS opportunities.',
  {
    url: z.string().url().describe('The URL to analyze'),
  },
  async ({ url }) => {
    const result = await analyzeCSS(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 9. analyze_javascript ───────────────────────────────────────────────────
server.tool(
  'analyze_javascript',
  'Use Playwright JS coverage to find unused JavaScript, render-blocking scripts, large bundles, and third-party scripts (GA4, GTM, Facebook Pixel, Hotjar, etc.) with their impact on load time.',
  {
    url: z.string().url().describe('The URL to analyze'),
  },
  async ({ url }) => {
    const result = await analyzeJavaScript(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 10. analyze_fonts ───────────────────────────────────────────────────────
server.tool(
  'analyze_fonts',
  'Check font loading strategy: Google Fonts preconnect, CSS @import anti-pattern, font-display values, WOFF2 format usage, and preload hints for self-hosted fonts.',
  {
    url: z.string().url().describe('The URL to analyze'),
  },
  async ({ url }) => {
    const result = await analyzeFonts(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 11. wordpress_inspector ─────────────────────────────────────────────────
server.tool(
  'wordpress_inspector',
  'Deep WordPress audit: detects 20+ plugins (Elementor, Divi, WooCommerce, WP Rocket, LiteSpeed Cache, NitroPack, Perfmatters, FlyingPress, Yoast, RankMath, and more) and generates plugin-specific recommendations with estimated LCP impact. Only useful on WordPress sites.',
  {
    url: z.string().url().describe('URL of the WordPress site to inspect'),
  },
  async ({ url }) => {
    const result = await analyzeWordPress(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 12. cloudflare_inspector ────────────────────────────────────────────────
server.tool(
  'cloudflare_inspector',
  'Detect Cloudflare and audit cache status, Brotli compression, HTTP/3, Early Hints, and Polish image optimization. Generates ready-to-use Cloudflare Cache Rules, Transform Rules, and setting recommendations.',
  {
    url: z.string().url().describe('URL to inspect'),
  },
  async ({ url }) => {
    const result = await analyzeCloudflare(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  }
)

// ─── 13. generate_report ─────────────────────────────────────────────────────
server.tool(
  'generate_report',
  'Run a full performance analysis and return a human-readable Markdown report with Lighthouse scores, Core Web Vitals, platform detection, and prioritized recommendations. Use this when you need a shareable, narrative summary instead of raw JSON.',
  {
    url: z.string().url().describe('The URL to analyze'),
  },
  async ({ url }) => {
    const markdown = await generateReport(url)
    return {
      content: [{ type: 'text', text: markdown }],
    }
  }
)

// ─── 14. generate_report_html ────────────────────────────────────────────────
server.tool(
  'generate_report_html',
  'Run a full performance analysis and return a self-contained HTML dashboard with Lighthouse score cards, Core Web Vitals, an LCP-savings bar chart, and prioritized recommendations. Works for any site (WordPress, Shopify, Next.js, generic). Render the returned HTML as an Artifact for the user.',
  {
    url: z.string().url().describe('The URL to analyze'),
  },
  async ({ url }) => {
    const html = await generateReportHtml(url)
    return {
      content: [{ type: 'text', text: html }],
    }
  }
)

// ─── 15. generate_report_docx ────────────────────────────────────────────────
server.tool(
  'generate_report_docx',
  'Run a full performance analysis and save a Word document (.docx) report to the user\'s Downloads folder. The document includes an executive summary, Lighthouse scores table, Core Web Vitals table, LCP savings table, and all prioritised recommendations with evidence and fixes. Works for any site. Returns the full file path of the saved document.',
  {
    url: z.string().url().describe('The URL to analyze'),
  },
  async ({ url }) => {
    const filepath = await generateReportDocx(url)
    return {
      content: [{ type: 'text', text: `Report saved to: ${filepath}` }],
    }
  }
)

// ─── 16. generate_wp_rocket_config ───────────────────────────────────────────
server.tool(
  'generate_wp_rocket_config',
  'Analyze a WordPress site and generate a recommended WP Rocket settings configuration. Accounts for detected page builders (Elementor, Divi), WooCommerce, cache conflicts, and third-party scripts. Returns a JSON settings object with rationale and warnings.',
  {
    url: z.string().url().describe('URL of the WordPress site'),
  },
  async ({ url }) => {
    const config = await generateWPRocketConfig(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(config, null, 2) }],
    }
  }
)

// ─── 17. generate_cloudflare_rules ───────────────────────────────────────────
server.tool(
  'generate_cloudflare_rules',
  'Generate ready-to-implement Cloudflare Cache Rules, Transform Rules, and recommended settings for a domain. Includes CMS-aware cache bypass rules (WordPress admin, WooCommerce cart, Shopify checkout), security header injection, and static asset caching.',
  {
    url: z.string().url().describe('URL of the site to generate rules for'),
  },
  async ({ url }) => {
    const rules = await generateCloudflareRules(url)
    return {
      content: [{ type: 'text', text: JSON.stringify(rules, null, 2) }],
    }
  }
)

// ─── 18. compare_performance ─────────────────────────────────────────────────
server.tool(
  'compare_performance',
  'Compare two analyze_website JSON reports (before and after a change) and return a delta report: Lighthouse score changes, Core Web Vitals improvements/regressions, newly introduced issues, and resolved issues. Pass the raw JSON output from two separate analyze_website calls.',
  {
    before_report: z.string().describe('JSON string from a previous analyze_website call (the baseline)'),
    after_report: z.string().describe('JSON string from a recent analyze_website call (after changes)'),
  },
  async ({ before_report, after_report }) => {
    let before: ReturnType<typeof JSON.parse>
    let after: ReturnType<typeof JSON.parse>
    try {
      before = JSON.parse(before_report)
      after = JSON.parse(after_report)
    } catch {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid JSON in before_report or after_report.' }) }],
      }
    }
    const comparison = compareReports(before, after)
    return {
      content: [{ type: 'text', text: JSON.stringify(comparison, null, 2) }],
    }
  }
)

// ─── Server startup ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Performance Engineer MCP server running on stdio')
}

process.on('SIGTERM', async () => {
  await closeBrowser()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await closeBrowser()
  process.exit(0)
})

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
