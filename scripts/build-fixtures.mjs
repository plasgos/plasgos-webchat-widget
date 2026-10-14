// Bundel aplikasi fixture framework (fixtures/<nama>/main.js → fixtures/<nama>/dist/main.js). `@plasgos/webchat`
// diarahkan ke HASIL BUILD paket (dist) — yang diuji adalah yang diterima pengguna npm, bukan sumbernya.
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { compile } from 'svelte/compiler';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'packages/webchat/dist');

/** Komponen `.svelte` (fixture & paket @plasgos/webchat-svelte) dikompilasi compiler Svelte resmi. */
const sveltePlugin = {
    name: 'svelte',
    setup(builder) {
        builder.onLoad({ filter: /\.svelte$/ }, async (args) => {
            const source = await readFile(args.path, 'utf8');
            const { js } = compile(source, { filename: args.path, generate: 'client', css: 'injected' });
            return { contents: js.code, loader: 'js', resolveDir: dirname(args.path) };
        });
    },
};

/** Fixture `react-18-*` memakai salinan React 18 (`react18`, `react-dom18`); lainnya React 19. */
function reactAlias(name) {
    if (!name.startsWith('react-18')) return {};
    return {
        react: join(ROOT, 'node_modules/react18'),
        'react-dom': join(ROOT, 'node_modules/react-dom18'),
    };
}

for (const name of readdirSync(join(ROOT, 'fixtures'))) {
    const entry = ['main.ts', 'main.jsx', 'main.js'].map((file) => join(ROOT, 'fixtures', name, file)).find((file) => existsSync(file));
    if (!entry) continue;
    await build({
        entryPoints: [entry],
        outfile: join(ROOT, 'fixtures', name, 'dist', 'main.js'),
        bundle: true,
        format: 'esm',
        target: 'es2020',
        jsx: 'automatic',
        plugins: [sveltePlugin],
        conditions: ['svelte', 'browser'],
        // Fixture Angular (JIT): decorator gaya TypeScript seperti proyek Angular CLI.
        tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
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
            '@plasgos/webchat-angular': join(ROOT, 'packages/angular/dist/index.js'),
            '@plasgos/webchat-svelte': join(ROOT, 'packages/svelte/dist/index.js'),
            ...reactAlias(name),
        },
        logLevel: 'warning',
    });
    console.info(`fixture ${name} dibundel`);
}
