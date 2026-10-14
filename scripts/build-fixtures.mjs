// Bundel aplikasi fixture framework (fixtures/<nama>/main.js → fixtures/<nama>/dist/main.js). `@plasgos/webchat`
// diarahkan ke HASIL BUILD paket (dist) — yang diuji adalah yang diterima pengguna npm, bukan sumbernya.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'packages/webchat/dist');

/** Fixture `react-18-*` memakai salinan React 18 (`react18`, `react-dom18`); lainnya React 19. */
function reactAlias(name) {
    if (!name.startsWith('react-18')) return {};
    return {
        react: join(ROOT, 'node_modules/react18'),
        'react-dom': join(ROOT, 'node_modules/react-dom18'),
    };
}

for (const name of readdirSync(join(ROOT, 'fixtures'))) {
    const entry = ['main.jsx', 'main.js'].map((file) => join(ROOT, 'fixtures', name, file)).find((file) => existsSync(file));
    if (!entry) continue;
    await build({
        entryPoints: [entry],
        outfile: join(ROOT, 'fixtures', name, 'dist', 'main.js'),
        bundle: true,
        format: 'esm',
        target: 'es2020',
        jsx: 'automatic',
        // Flag build Vue (esm-bundler) & mode produksi pustaka.
        define: {
            __VUE_OPTIONS_API__: 'true',
            __VUE_PROD_DEVTOOLS__: 'false',
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
            'process.env.NODE_ENV': '"production"',
        },
        alias: {
            '@plasgos/webchat/element': join(DIST, 'element.js'),
            '@plasgos/webchat': join(DIST, 'index.js'),
            '@plasgos/webchat-react': join(ROOT, 'packages/react/dist/index.js'),
            '@plasgos/webchat-vue': join(ROOT, 'packages/vue/dist/index.js'),
            ...reactAlias(name),
        },
        logLevel: 'warning',
    });
    console.info(`fixture ${name} dibundel`);
}
