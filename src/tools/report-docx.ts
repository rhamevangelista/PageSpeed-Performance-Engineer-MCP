import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Header, Footer, PageNumber,
  UnderlineType,
} from 'docx'
import { writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { AnalysisReport, Recommendation } from '../types.js'
import { analyzeWebsite } from './recommendations.js'

// ─── Public entry point ───────────────────────────────────────────────────────

export async function generateReportDocx(url: string): Promise<string> {
  const report = await analyzeWebsite(url)

  const downloadsDir = join(homedir(), 'Downloads')
  await mkdir(downloadsDir, { recursive: true })

  const domain = getDomain(url)
  const date   = new Date(report.analyzedAt).toISOString().slice(0, 10)
  const filename = `${domain}-performance-report-${date}.docx`
  const filepath = join(downloadsDir, filename)

  const doc = buildDocument(report)
  const buffer = await Packer.toBuffer(doc)
  await writeFile(filepath, buffer)

  return filepath
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'Good'
  if (score >= 50) return 'Needs Improvement'
  return 'Poor'
}

function cwvRating(value: number, good: number, poor: number): string {
  if (value <= good) return 'Good'
  if (value <= poor) return 'Needs Improvement'
  return 'Poor'
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
}

function impactText(rec: Recommendation): string {
  const parts: string[] = []
  if (rec.estimatedImpact.lcp)   parts.push(`LCP −${rec.estimatedImpact.lcp}ms`)
  if (rec.estimatedImpact.fcp)   parts.push(`FCP −${rec.estimatedImpact.fcp}ms`)
  if (rec.estimatedImpact.inp)   parts.push(`INP −${rec.estimatedImpact.inp}ms`)
  if (rec.estimatedImpact.cls)   parts.push(`CLS −${rec.estimatedImpact.cls.toFixed(2)}`)
  return parts.join(', ') || 'Marginal'
}

// ─── Colour palette (hex without #) ──────────────────────────────────────────

const C = {
  black:    '0D1117',
  darkGray: '21262D',
  midGray:  '30363D',
  text:     '58A6FF',   // accent blue for headers
  muted:    '6E7681',
  good:     '3FB950',
  warn:     'D29922',
  poor:     'DA3633',
  white:    'FFFFFF',
  lightBg:  'F0F6FC',   // page background tint
  rowAlt:   'EFF2F5',
}

// ─── Reusable paragraph builders ─────────────────────────────────────────────

function h1(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 120 },
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 100 },
  })
}

function body(text: string, bold = false): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold, size: 22 })],
    spacing: { after: 80 },
  })
}

function label(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({
      text: text.toUpperCase(),
      bold: true,
      size: 18,
      color: C.muted,
      characterSpacing: 40,
    })],
    spacing: { before: 200, after: 60 },
  })
}

function divider(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.midGray } },
    spacing: { before: 80, after: 80 },
  })
}

function scoreColor(score: number): string {
  if (score >= 90) return C.good
  if (score >= 50) return C.warn
  return C.poor
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function headerCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 20, color: C.white })],
    })],
    shading: { type: ShadingType.SOLID, fill: C.black },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  })
}

function dataCell(text: string, color?: string, bold = false): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, color: color ?? C.black, bold, size: 20 })],
    })],
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
  })
}

function altDataCell(text: string, color?: string, bold = false, altRow = false): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, color: color ?? C.black, bold, size: 20 })],
    })],
    shading: altRow ? { type: ShadingType.SOLID, fill: C.rowAlt } : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
  })
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildScoreTable(report: AnalysisReport): (Paragraph | Table)[] {
  if (!report.scores) return []
  const s = report.scores

  const rows = [
    ['Performance',    s.performance,    scoreLabel(s.performance)],
    ['Accessibility',  s.accessibility,  scoreLabel(s.accessibility)],
    ['Best Practices', s.bestPractices,  scoreLabel(s.bestPractices)],
    ['SEO',            s.seo,            scoreLabel(s.seo)],
  ] as [string, number, string][]

  return [
    h2('Lighthouse Scores'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            headerCell('Category'),
            headerCell('Score'),
            headerCell('Rating'),
          ],
          tableHeader: true,
        }),
        ...rows.map(([cat, score, rating], i) => new TableRow({
          children: [
            altDataCell(cat, C.black, true, i % 2 === 1),
            altDataCell(String(score), scoreColor(score), true, i % 2 === 1),
            altDataCell(rating, scoreColor(score), false, i % 2 === 1),
          ],
        })),
      ],
    }),
  ]
}

function buildCwvTable(report: AnalysisReport): (Paragraph | Table)[] {
  if (!report.coreWebVitals) return []
  const cwv = report.coreWebVitals
  const src = cwv.source === 'field' ? 'Real-user data (CrUX / Field Data)' : 'Lab simulation (Lighthouse)'

  type Row = [string, string, string, string]
  const rows: Row[] = []
  if (cwv.lcp !== null)  rows.push(['LCP (Largest Contentful Paint)', fmtMs(cwv.lcp),          cwvRating(cwv.lcp, 2500, 4000),    'Target < 2.5s'])
  if (cwv.inp !== null)  rows.push(['INP (Interaction to Next Paint)', `${cwv.inp}ms`,           cwvRating(cwv.inp, 200, 500),      'Target < 200ms'])
  if (cwv.cls !== null)  rows.push(['CLS (Cumulative Layout Shift)',   cwv.cls.toFixed(3),       cwvRating(cwv.cls, 0.1, 0.25),     'Target < 0.1'])
  if (cwv.fcp !== null)  rows.push(['FCP (First Contentful Paint)',    fmtMs(cwv.fcp),           cwvRating(cwv.fcp, 1800, 3000),    'Target < 1.8s'])
  if (cwv.ttfb !== null) rows.push(['TTFB (Time to First Byte)',       `${cwv.ttfb}ms`,          cwvRating(cwv.ttfb, 800, 1800),    'Target < 800ms'])

  const ratingColor = (r: string) => r === 'Good' ? C.good : r === 'Needs Improvement' ? C.warn : C.poor

  return [
    h2('Core Web Vitals'),
    new Paragraph({
      children: [new TextRun({ text: `Source: ${src}`, italics: true, size: 20, color: C.muted })],
      spacing: { after: 100 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            headerCell('Metric'),
            headerCell('Value'),
            headerCell('Rating'),
            headerCell('Benchmark'),
          ],
          tableHeader: true,
        }),
        ...rows.map(([metric, value, rating, benchmark], i) => new TableRow({
          children: [
            altDataCell(metric, C.black, true, i % 2 === 1),
            altDataCell(value, ratingColor(rating), true, i % 2 === 1),
            altDataCell(rating, ratingColor(rating), false, i % 2 === 1),
            altDataCell(benchmark, C.muted, false, i % 2 === 1),
          ],
        })),
      ],
    }),
  ]
}

function buildLcpSavingsTable(report: AnalysisReport): (Paragraph | Table)[] {
  const lcpRecs = report.recommendations
    .filter(r => (r.estimatedImpact.lcp ?? 0) > 0)
    .sort((a, b) => (b.estimatedImpact.lcp ?? 0) - (a.estimatedImpact.lcp ?? 0))
    .slice(0, 10)

  if (lcpRecs.length === 0) return []

  return [
    h2('Estimated LCP Savings by Fix'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            headerCell('Fix'),
            headerCell('Category'),
            headerCell('Est. LCP Saving'),
            headerCell('Difficulty'),
          ],
          tableHeader: true,
        }),
        ...lcpRecs.map((rec, i) => {
          const lcp = rec.estimatedImpact.lcp ?? 0
          const diffColor = rec.difficulty === 'easy' ? C.good : rec.difficulty === 'medium' ? C.warn : C.poor
          return new TableRow({
            children: [
              altDataCell(rec.issue, C.black, true, i % 2 === 1),
              altDataCell(rec.category, C.muted, false, i % 2 === 1),
              altDataCell(`−${lcp}ms`, lcp >= 1000 ? C.poor : lcp >= 500 ? C.warn : C.good, true, i % 2 === 1),
              altDataCell(rec.difficulty, diffColor, false, i % 2 === 1),
            ],
          })
        }),
      ],
    }),
  ]
}

function buildRecommendations(report: AnalysisReport): Paragraph[] {
  if (report.recommendations.length === 0) return []
  const items: Paragraph[] = [h2('Prioritised Recommendations')]

  for (const rec of report.recommendations) {
    // Recommendation heading
    items.push(new Paragraph({
      children: [
        new TextRun({ text: `P${rec.priority}  `, bold: true, size: 24, color: C.muted }),
        new TextRun({ text: rec.issue, bold: true, size: 24 }),
      ],
      spacing: { before: 240, after: 60 },
    }))

    // Impact / category / difficulty chips on one line
    const impactStr = impactText(rec)
    items.push(new Paragraph({
      children: [
        new TextRun({ text: 'Impact: ', bold: true, size: 20 }),
        new TextRun({ text: impactStr, size: 20, color: C.warn }),
        new TextRun({ text: '   Category: ', bold: true, size: 20 }),
        new TextRun({ text: rec.category, size: 20, color: C.muted }),
        new TextRun({ text: '   Difficulty: ', bold: true, size: 20 }),
        new TextRun({
          text: rec.difficulty,
          size: 20,
          color: rec.difficulty === 'easy' ? C.good : rec.difficulty === 'medium' ? C.warn : C.poor,
        }),
      ],
      spacing: { after: 60 },
    }))

    // Evidence
    items.push(new Paragraph({
      children: [
        new TextRun({ text: 'Evidence: ', bold: true, size: 20 }),
        new TextRun({ text: rec.evidence, size: 20, color: C.muted }),
      ],
      spacing: { after: 60 },
    }))

    // Fix
    items.push(new Paragraph({
      children: [
        new TextRun({ text: 'Fix: ', bold: true, size: 20 }),
        new TextRun({ text: rec.fix, size: 20 }),
      ],
      spacing: { after: 80 },
    }))

    items.push(divider())
  }

  return items
}

// ─── Main document builder ────────────────────────────────────────────────────

function buildDocument(report: AnalysisReport): Document {
  const domain  = getDomain(report.url)
  const date    = new Date(report.analyzedAt).toLocaleDateString('en-NZ', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const perf    = report.scores?.performance ?? null
  const cwvSrc  = report.coreWebVitals?.source === 'field' ? 'Field Data (CrUX)' : 'Lab Data (Lighthouse)'

  // Cover page children
  const coverChildren: Paragraph[] = [
    new Paragraph({ spacing: { before: 1200 } }),
    new Paragraph({
      children: [new TextRun({
        text: 'Web Performance Report',
        bold: true,
        size: 56,
        color: C.black,
      })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({
        text: domain,
        size: 32,
        color: C.muted,
        underline: { type: UnderlineType.SINGLE },
      })],
      spacing: { after: 480 },
    }),
    divider(),
    new Paragraph({
      children: [
        new TextRun({ text: 'Analyzed:  ', bold: true, size: 22 }),
        new TextRun({ text: date, size: 22 }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Data source:  ', bold: true, size: 22 }),
        new TextRun({ text: cwvSrc, size: 22 }),
      ],
      spacing: { after: 80 },
    }),
    ...(perf !== null ? [new Paragraph({
      children: [
        new TextRun({ text: 'Performance score:  ', bold: true, size: 22 }),
        new TextRun({
          text: `${perf} / 100 — ${scoreLabel(perf)}`,
          size: 22,
          color: scoreColor(perf),
          bold: true,
        }),
      ],
      spacing: { after: 80 },
    })] : []),
    new Paragraph({
      children: [
        new TextRun({ text: 'URL:  ', bold: true, size: 22 }),
        new TextRun({ text: report.url, size: 22, color: C.muted }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({ pageBreakBefore: true }),
  ]

  // Summary paragraph
  const summaryChildren: Paragraph[] = [
    h1('Executive Summary'),
    body(
      `This report analyzes the web performance of ${report.url} as measured on ${date}. ` +
      `The site scored ${perf ?? 'N/A'}/100 on Lighthouse Performance, with ` +
      `${report.recommendations.length} actionable recommendations identified.`,
    ),
  ]

  if (report.coreWebVitals) {
    const cwv = report.coreWebVitals
    const bullets: string[] = []
    if (cwv.lcp !== null)  bullets.push(`LCP: ${fmtMs(cwv.lcp)} (${cwvRating(cwv.lcp, 2500, 4000)})`)
    if (cwv.inp !== null)  bullets.push(`INP: ${cwv.inp}ms (${cwvRating(cwv.inp, 200, 500)})`)
    if (cwv.cls !== null)  bullets.push(`CLS: ${cwv.cls.toFixed(3)} (${cwvRating(cwv.cls, 0.1, 0.25)})`)
    if (cwv.fcp !== null)  bullets.push(`FCP: ${fmtMs(cwv.fcp)} (${cwvRating(cwv.fcp, 1800, 3000)})`)
    if (cwv.ttfb !== null) bullets.push(`TTFB: ${cwv.ttfb}ms (${cwvRating(cwv.ttfb, 800, 1800)})`)

    summaryChildren.push(label('Core Web Vitals at a glance'))
    summaryChildren.push(...bullets.map(b => new Paragraph({
      children: [new TextRun({ text: `•  ${b}`, size: 22 })],
      spacing: { after: 60 },
    })))
  }

  // LCP savings top-3 callout
  const topRecs = report.recommendations
    .filter(r => (r.estimatedImpact.lcp ?? 0) > 0)
    .sort((a, b) => (b.estimatedImpact.lcp ?? 0) - (a.estimatedImpact.lcp ?? 0))
    .slice(0, 3)

  if (topRecs.length > 0) {
    summaryChildren.push(label('Top 3 LCP improvements'))
    topRecs.forEach((rec, i) => {
      summaryChildren.push(new Paragraph({
        children: [
          new TextRun({ text: `${i + 1}.  `, bold: true, size: 22 }),
          new TextRun({ text: rec.issue, bold: true, size: 22 }),
          new TextRun({ text: `  (−${rec.estimatedImpact.lcp}ms LCP)`, size: 22, color: C.warn }),
        ],
        spacing: { after: 60 },
      }))
    })
  }

  summaryChildren.push(new Paragraph({ pageBreakBefore: true }))

  return new Document({
    creator: 'Performance Engineer MCP',
    title: `Performance Report — ${domain}`,
    description: `Web performance analysis for ${report.url}`,
    styles: {
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { bold: true, size: 40, color: C.black },
          paragraph: { spacing: { before: 480, after: 160 } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { bold: true, size: 30, color: C.darkGray },
          paragraph: { spacing: { before: 360, after: 120 } },
        },
      ],
    },
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph({
              children: [
                new TextRun({ text: `Performance Report — ${domain}`, size: 18, color: C.muted }),
              ],
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.midGray } },
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              children: [
                new TextRun({ text: `Generated ${date} by Performance Engineer MCP   ·   Page `, size: 18, color: C.muted }),
                new TextRun({ children: [PageNumber.CURRENT], size: 18, color: C.muted }),
                new TextRun({ text: ' of ', size: 18, color: C.muted }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: C.muted }),
              ],
              alignment: AlignmentType.RIGHT,
            })],
          }),
        },
        children: [
          ...coverChildren,
          ...summaryChildren,
          ...buildScoreTable(report),
          new Paragraph({ spacing: { before: 200 } }),
          ...buildCwvTable(report),
          new Paragraph({ spacing: { before: 200 } }),
          ...buildLcpSavingsTable(report),
          new Paragraph({ pageBreakBefore: true }),
          ...buildRecommendations(report),
          ...(report.errors.length > 0 ? [
            h2('Analysis Errors'),
            ...report.errors.map(e => body(`${e.tool}: ${e.message}`)),
          ] : []),
        ],
      },
    ],
  })
}
