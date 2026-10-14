// Bundel aplikasi fixture framework (fixtures/<nama>/main.js → fixtures/<nama>/dist/main.js). `@plasgos/webchat`
// diarahkan ke HASIL BUILD paket (dist) — yang diuji adalah yang diterima pengguna npm, bukan sumbernya.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'packages/webchat/dist');

for (const name of readdirSync(join(ROOT, 'fixtures'))) {
    const entry = join(ROOT, 'fixtures', name, 'main.js');
    if (!existsSync(entry)) continue;
    await build({
        entryPoints: [entry],
        outfile: join(ROOT, 'fixtures', name, 'dist', 'main.js'),
        bundle: true,
        format: 'esm',
        target: 'es2020',
        alias: { '@plasgos/webchat/element': join(DIST, 'element.js'), '@plasgos/webchat': join(DIST, 'index.js') },
        logLevel: 'warning',
    });
    console.info(`fixture ${name} dibundel`);
}
