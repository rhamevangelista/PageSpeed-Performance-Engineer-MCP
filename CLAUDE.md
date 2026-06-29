# Performance Engineer MCP

## Goal

Build a production-ready MCP server that analyzes websites and provides actionable recommendations to improve Core Web Vitals.

## Core Principles

- Each analyzer is an independent tool that returns structured JSON. Never return prose from a tool.
- Never mix data collection with recommendation logic. Tools collect; `recommendations.ts` decides.
- Every recommendation must include: issue, evidence, estimatedImpact, difficulty, and fix.
- Design analyzers to be extensible for future frameworks (WordPress, Shopify, Next.js, etc.).
- Keep all tool outputs deterministic so Claude can reliably compose them into reports.
- Tools may be called individually or orchestrated by `analyze_website`.

## Architecture

```
src/
├── server.ts              # MCP entry point — registers all 12 tools
├── types.ts               # All TypeScript interfaces (the contract layer)
├── browser.ts             # Playwright Chromium singleton (shared across tools)
└── tools/
    ├── lighthouse.ts      # run_lighthouse
    ├── pagespeed.ts       # get_core_web_vitals (PSI API + CrUX field data)
    ├── headers.ts         # analyze_headers
    ├── html.ts            # analyze_html (Cheerio)
    ├── cms.ts             # detect_cms (10+ platform fingerprints)
    ├── images.ts          # analyze_images (Playwright)
    ├── css.ts             # analyze_css (Playwright CSS coverage)
    ├── javascript.ts      # analyze_javascript (Playwright JS coverage)
    ├── fonts.ts           # analyze_fonts
    ├── platform.ts        # Platform dispatcher — auto-routes by CMS:
    │                      #   WordPress → deep plugin inspection
    │                      #   Shopify / Next.js / Nuxt / Astro / Webflow / Wix / Squarespace
    │                      #     → platform-tailored recommendations
    │                      #   unknown → generic web performance recommendations
    ├── wordpress.ts       # analyzeWordPress() — used by platform.ts + wordpress_inspector tool
    ├── cloudflare.ts      # cloudflare_inspector + analyzeCloudflare()
    └── recommendations.ts # generate_recommendations + analyze_website orchestrator
```

## Platform Analysis Design

`analyze_website` auto-detects CMS, then dispatches:
- **WordPress** → full plugin-level inspection (20+ plugins, WooCommerce cart fragments, Elementor asset loading, cache plugin gaps)
- **Shopify** → app script count, Shopify image CDN sizing, LCP preload, script loading
- **Next.js** → next/image usage, next/font, CSR vs SSR detection
- **Nuxt** → @nuxt/image, Google Fonts module, rendering mode
- **Astro** → island hydration directives, Astro Image component
- **Webflow** → webflow.js impact, manual image optimization guidance
- **Wix / Squarespace** → platform-specific constraints and workarounds
- **Unknown / generic** → standard recommendations (images, caching, CDN, rendering mode)

The `wordpress_inspector` tool is also callable independently for explicit WordPress deep-dives.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_PAGESPEED_API_KEY` | Optional | Enables CrUX real-user field data. Without it, `get_core_web_vitals` returns Lighthouse lab data only. |

Copy `.env.example` to `.env` and fill in your key.

## Development

```bash
npm install          # also runs playwright install chromium
npm run build        # compile TypeScript → dist/
npm run dev          # watch mode
npm test             # vitest unit tests
npm start            # run the MCP server (after build)
```

## Adding a New Analyzer

1. Create `src/tools/my-analyzer.ts` — export a single async function that returns a typed result
2. Add the result type to `src/types.ts`
3. Register the tool in `src/server.ts` with a Zod input schema
4. Teach `generateRecommendations()` in `recommendations.ts` how to interpret its output
5. Add it to the `GenerateRecommendationsInput` interface in `types.ts`
6. Wire it into `analyzeWebsite()` in `recommendations.ts`

## Tool Output Contract

Every tool function must:
- Accept a `url: string` as its first argument
- Return a typed object (never `any`)
- Include an `issues` array of typed issue objects
- Never throw on expected failures — catch and return partial data with the issue noted

## Milestones

### Phase 1 — MVP ✅
- [x] MCP server scaffold
- [x] `run_lighthouse`
- [x] `get_core_web_vitals` (PSI API + graceful fallback)
- [x] `analyze_headers`
- [x] `analyze_html`
- [x] `detect_cms`
- [x] `generate_recommendations`
- [x] `analyze_website` orchestrator

### Phase 2 — Deep Analyzers ✅
- [x] `analyze_images` — format, size, lazy loading, LCP candidate
- [x] `analyze_css` — unused CSS, render blocking, framework detection
- [x] `analyze_javascript` — unused JS, third-party scripts, sync loading
- [x] `analyze_fonts` — preconnect, font-display, WOFF2, preload

### Phase 3 — Platform-Aware Inspectors ✅
- [x] `platform.ts` dispatcher — auto-routes by CMS, no WordPress hardcoding
- [x] `wordpress_inspector` — 20+ plugin fingerprints, plugin-level recommendations
- [x] `cloudflare_inspector` — cache status, Brotli, HTTP/3, Early Hints, rule generation
- [x] Platform support: Shopify, Next.js, Nuxt, Astro, Webflow, Wix, Squarespace, generic

### Phase 4 — Intelligence Layer ✅
- [x] `generate_report` — Narrative Markdown report with scores, CWV, and prioritized fixes
- [x] `generate_wp_rocket_config` — WP Rocket settings JSON with Elementor/WooCommerce awareness
- [x] `generate_cloudflare_rules` — Cache Rules, Transform Rules, and settings guide
- [x] `compare_performance` — Before/after delta from two analyze_website JSON reports

## MCP Server Registration

Add to `.claude/settings.json` (or Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "performance": {
      "command": "node",
      "args": ["C:/path/to/performance-mcp/dist/server.js"]
    }
  }
}
```

## Example Claude Commands

```
analyze_website { "url": "https://example.com" }

run_lighthouse { "url": "https://example.com", "strategy": "mobile" }

get_core_web_vitals { "url": "https://example.com" }

detect_cms { "url": "https://example.com" }

generate_report { "url": "https://example.com" }

generate_wp_rocket_config { "url": "https://my-wordpress-site.com" }

generate_cloudflare_rules { "url": "https://example.com" }

compare_performance { "before_report": "<JSON from first analyze_website>", "after_report": "<JSON from second analyze_website>" }
```
