import { spawn } from 'child_process'
import { chromium } from 'playwright'
import type { LighthouseResult, Strategy } from '../types.js'

export async function runLighthouse(url: string, strategy: Strategy = 'mobile'): Promise<LighthouseResult> {
  const chromiumPath = chromium.executablePath()
  const { default: lighthouse } = await import('lighthouse')

  // Use a random port to avoid collisions with other Lighthouse runs
  const port = 9222 + Math.floor(Math.random() * 1000)

  // spawn() avoids the cmd.exe intermediary on Windows, handles paths with spaces,
  // and gives us the real Chromium PID for reliable cleanup
  const chromeProcess = spawn(chromiumPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], {
    stdio: 'ignore',
    detached: false,
  })

  // Catch spawn errors (ENOENT if binary missing) before they become unhandled
  // events that crash the entire MCP server process
  await new Promise<void>((resolve, reject) => {
    chromeProcess.once('error', reject)
    chromeProcess.once('spawn', () => {
      chromeProcess.removeListener('error', reject)
      resolve()
    })
    // Fallback: if neither event fires quickly, proceed anyway
    setTimeout(() => { chromeProcess.removeListener('error', reject); resolve() }, 500)
  })

  // Give Chrome time to open the remote debugging port
  await new Promise((resolve) => setTimeout(resolve, 1500))

  try {
    const runnerResult = await lighthouse(url, {
      port,
      output: 'json',
      logLevel: 'error',
      formFactor: strategy,
      screenEmulation: strategy === 'mobile'
        ? {
            mobile: true,
            width: 412,
            height: 823,
            deviceScaleFactor: 1.75,
            disabled: false,
          }
        : {
            mobile: false,
            width: 1350,
            height: 940,
            deviceScaleFactor: 1,
            disabled: false,
          },
      throttlingMethod: 'simulate',
      throttling: strategy === 'mobile'
        ? {
            rttMs: 150,
            throughputKbps: 1638.4,
            cpuSlowdownMultiplier: 4,
            requestLatencyMs: 562.5,
            downloadThroughputKbps: 1474.56,
            uploadThroughputKbps: 675,
          }
        : {
            rttMs: 40,
            throughputKbps: 10240,
            cpuSlowdownMultiplier: 1,
            requestLatencyMs: 0,
            downloadThroughputKbps: 0,
            uploadThroughputKbps: 0,
          },
    })

    if (!runnerResult?.lhr) {
      throw new Error('Lighthouse returned no result')
    }

    const lhr = runnerResult.lhr
    const cats = lhr.categories

    const opportunities = Object.values(lhr.audits)
      .filter((a) => {
        const d = a.details as Record<string, unknown> | undefined
        return d?.type === 'opportunity' && ((d?.overallSavingsMs as number) ?? 0) > 0
      })
      .map((a) => {
        const d = a.details as Record<string, unknown> | undefined
        return {
          id: a.id,
          title: a.title,
          description: a.description,
          savingsMs: d?.overallSavingsMs as number | undefined,
          savingsBytes: d?.overallSavingsBytes as number | undefined,
        }
      })
      .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))

    return {
      url,
      strategy,
      scores: {
        performance: Math.round((cats.performance?.score ?? 0) * 100),
        accessibility: Math.round((cats.accessibility?.score ?? 0) * 100),
        bestPractices: Math.round((cats['best-practices']?.score ?? 0) * 100),
        seo: Math.round((cats.seo?.score ?? 0) * 100),
      },
      coreWebVitals: {
        lcp: lhr.audits['largest-contentful-paint']?.numericValue ?? null,
        cls: lhr.audits['cumulative-layout-shift']?.numericValue ?? null,
        inp: lhr.audits['interaction-to-next-paint']?.numericValue ?? null,
        fcp: lhr.audits['first-contentful-paint']?.numericValue ?? null,
        ttfb: lhr.audits['server-response-time']?.numericValue ?? null,
        source: 'lab',
      },
      opportunities,
    }
  } finally {
    try {
      // On Windows, taskkill /T ensures child processes (Chrome's sub-processes) are also killed
      if (process.platform === 'win32') {
        spawn('taskkill', ['/F', '/T', '/PID', String(chromeProcess.pid)], { stdio: 'ignore' })
      } else {
        chromeProcess.kill()
      }
    } catch {
      // Already exited — safe to ignore
    }
  }
}
