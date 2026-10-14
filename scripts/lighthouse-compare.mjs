// Bandingkan Lighthouse halaman fixture TANPA widget (baseline) dan DENGAN widget (candidate) — perf-budget.json.
// Chrome dicari chrome-launcher (CHROME_PATH bila perlu). Hasil mentah disimpan di .lighthouse/.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const PORT = Number(process.env.FIXTURE_PORT || 4401);
const budget = JSON.parse(await readFile(new URL('../perf-budget.json', import.meta.url), 'utf8'));
const t = budget.thresholds;

const server = spawn(process.execPath, ['scripts/serve-fixtures.mjs'], { env: { ...process.env, FIXTURE_PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 800));
const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function measure(path) {
    const samples = [];
    for (let i = 0; i < budget.runs; i += 1) {
        const result = await lighthouse(`http://localhost:${PORT}${path}`, { port: chrome.port, onlyCategories: ['performance'], logLevel: 'error', output: 'json' });
        const audits = result.lhr.audits;
        samples.push({
            score: result.lhr.categories.performance.score,
            lcp: audits['largest-contentful-paint'].numericValue,
            cls: audits['cumulative-layout-shift'].numericValue,
            tbt: audits['total-blocking-time'].numericValue,
        });
    }
    return Object.fromEntries(['score', 'lcp', 'cls', 'tbt'].map((key) => [key, median(samples.map((s) => s[key]))]));
}

let failed = false;
const report = [];
try {
    for (const pair of budget.pairs) {
        const base = await measure(pair.baseline);
        const cand = await measure(pair.candidate);
        const checks = [
            ['skor performa', cand.score >= t.minPerformanceScore, `${cand.score} ≥ ${t.minPerformanceScore}`],
            ['Δ LCP', cand.lcp - base.lcp <= t.maxLcpDeltaMs, `${Math.round(cand.lcp - base.lcp)} ms ≤ ${t.maxLcpDeltaMs}`],
            ['Δ CLS', cand.cls - base.cls <= t.maxClsDelta, `${(cand.cls - base.cls).toFixed(3)} ≤ ${t.maxClsDelta}`],
            ['Δ TBT', cand.tbt - base.tbt <= t.maxTbtDeltaMs, `${Math.round(cand.tbt - base.tbt)} ms ≤ ${t.maxTbtDeltaMs}`],
        ];
        console.info(`• ${pair.label}`);
        for (const [name, ok, detail] of checks) {
            failed ||= !ok;
            console.info(`  ${ok ? '✓' : '✗'} ${name}: ${detail}`);
        }
        report.push({ ...pair, baseline_metrics: base, candidate_metrics: cand });
    }
} finally {
    await chrome.kill();
    server.kill();
}
await mkdir(new URL('../.lighthouse/', import.meta.url), { recursive: true });
await writeFile(new URL('../.lighthouse/compare.json', import.meta.url), JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
