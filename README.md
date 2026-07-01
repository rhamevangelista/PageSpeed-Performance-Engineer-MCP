# Performance Engineer MCP

An MCP server that analyzes websites like a senior performance engineer and produces prioritized Core Web Vitals recommendations.

Connect it to Claude Desktop and ask things like:
- *"Analyze the performance of https://example.com"*
- *"Give me a visual performance report for https://example.com"*
- *"Give me a pagespeed document report for https://example.com"*
- *"Generate a WP Rocket config for my WordPress site"*
- *"Compare these two performance reports and tell me what improved"*

## Tools (18)

| # | Tool | What it does |
|---|------|-------------|
| 1 | `analyze_website` | Full orchestrator — runs all analyzers and returns prioritized recommendations |
| 2 | `run_lighthouse` | Lighthouse audit (scores + CWV lab data) via local Chromium |
| 3 | `get_core_web_vitals` | CrUX real-user field data via PageSpeed Insights API (falls back to Lighthouse) |
| 4 | `analyze_headers` | Compression, caching, CDN detection, security headers |
| 5 | `analyze_html` | Render-blocking resources, meta tags, script loading strategy |
| 6 | `detect_cms` | Fingerprints WordPress, Shopify, Next.js, Nuxt, Astro, Webflow, Wix, Squarespace |
| 7 | `analyze_images` | Oversized images, wrong formats, missing lazy load, LCP candidate |
| 8 | `analyze_css` | Unused CSS via Playwright coverage, render-blocking stylesheets |
| 9 | `analyze_javascript` | Unused JS, third-party scripts (GA4, GTM, Pixel, Hotjar), render-blocking |
| 10 | `analyze_fonts` | Google Fonts preconnect, font-display, WOFF2 format, preload hints |
| 11 | `wordpress_inspector` | Deep WordPress audit — 20+ plugin fingerprints, plugin-level recommendations |
| 12 | `cloudflare_inspector` | Cache status, Brotli, HTTP/3, Early Hints, Polish |
| 13 | `generate_report` | Narrative Markdown report with scores, CWV, and prioritized fixes |
| 14 | `generate_report_html` | Self-contained HTML dashboard — score cards, CWV grid, LCP bar chart, recommendations. Works for any CMS. Rendered as a visual Artifact in Claude. |
| 15 | `generate_report_docx` | Full Word document (.docx) saved to `~/Downloads/` — cover page, exec summary, CWV table, LCP savings table, all recommendations with evidence and fixes |
| 16 | `generate_wp_rocket_config` | WP Rocket settings JSON with Elementor/WooCommerce awareness |
| 17 | `generate_cloudflare_rules` | Cache Rules, Transform Rules, and settings guide |
| 18 | `compare_performance` | Before/after delta from two `analyze_website` JSON reports |

## Requirements

- Node.js 22+
- Claude Desktop

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/performance-engineer-mcp.git
cd performance-engineer-mcp
npm install        # also downloads Playwright Chromium (~300MB)
npm run build
```

### Optional: Google PageSpeed Insights API key

Without a key, `get_core_web_vitals` returns Lighthouse lab data. With a key it returns real-user CrUX field data (p75 from actual Chrome users).

```bash
cp .env.example .env
# Edit .env and add your key — get one free at:
# https://developers.google.com/speed/docs/insights/v5/get-started
```

## Connect to Claude Desktop

Add to your `claude_desktop_config.json`:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "performance": {
      "command": "node",
      "args": ["/absolute/path/to/performance-engineer-mcp/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop after saving.

## Usage examples

```
analyze_website { "url": "https://example.com" }

run_lighthouse { "url": "https://example.com", "strategy": "mobile" }

get_core_web_vitals { "url": "https://example.com" }

wordpress_inspector { "url": "https://my-wp-site.com" }

generate_report { "url": "https://example.com" }

# Visual HTML dashboard (rendered as an Artifact in Claude)
generate_report_html { "url": "https://example.com" }

# Word document saved to ~/Downloads/
generate_report_docx { "url": "https://example.com" }

generate_wp_rocket_config { "url": "https://my-wp-site.com" }

generate_cloudflare_rules { "url": "https://example.com" }

compare_performance {
  "before_report": "<JSON from first analyze_website>",
  "after_report": "<JSON from second analyze_website>"
}
```

## Development

```bash
npm run dev     # watch mode
npm test        # vitest unit tests
npm run build   # compile TypeScript → dist/
```

## Architecture

```
src/
├── server.ts              # MCP entry point — registers all 18 tools
├── types.ts               # TypeScript interfaces
├── browser.ts             # Playwright Chromium singleton
└── tools/
    ├── lighthouse.ts      # run_lighthouse
    ├── pagespeed.ts       # get_core_web_vitals
    ├── headers.ts         # analyze_headers
    ├── html.ts            # analyze_html
    ├── cms.ts             # detect_cms
    ├── images.ts          # analyze_images
    ├── css.ts             # analyze_css
    ├── javascript.ts      # analyze_javascript
    ├── fonts.ts           # analyze_fonts
    ├── platform.ts        # CMS dispatcher
    ├── wordpress.ts       # wordpress_inspector
    ├── cloudflare.ts      # cloudflare_inspector
    ├── report.ts          # generate_report (Markdown)
    ├── report-html.ts     # generate_report_html (visual HTML Artifact)
    ├── report-docx.ts     # generate_report_docx (Word document → Downloads/)
    ├── wp-rocket.ts       # generate_wp_rocket_config
    ├── cloudflare-rules.ts # generate_cloudflare_rules
    ├── compare.ts         # compare_performance
    └── recommendations.ts # generate_recommendations + analyze_website
```

## License

MIT
