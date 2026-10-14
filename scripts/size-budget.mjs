// Periksa anggaran ukuran gzip berkas yang dimuat website tenant (size-budget.json).
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const config = JSON.parse(await readFile(new URL('../size-budget.json', import.meta.url), 'utf8'));
let failed = false;
for (const budget of config.budgets) {
    let size;
    try {
        size = gzipSync(await readFile(new URL(`../${budget.file}`, import.meta.url)), { level: 9 }).length;
    } catch {
        console.error(`✗ ${budget.label}: ${budget.file} belum dibangun (jalankan pnpm build)`);
        failed = true;
        continue;
    }
    const ok = size <= budget.maxGzipBytes;
    failed ||= !ok;
    console.info(`${ok ? '✓' : '✗'} ${budget.label}: ${size} B gzip / batas ${budget.maxGzipBytes} B (${Math.round((size / budget.maxGzipBytes) * 100)}%)`);
}
process.exit(failed ? 1 : 0);
