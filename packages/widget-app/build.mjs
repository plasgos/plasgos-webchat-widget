// Bundel aplikasi widget: skrip KLASIK (bukan modul) — dokumen iframe api-crm memuat
// `<script src="${WEBCHAT_CDN_ORIGIN}/widget-app/v1/app.js" data-widget-id="…" defer>`.
import { build } from 'esbuild';

await build({
    entryPoints: ['src/main.ts'],
    outfile: 'dist/app.js',
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    sourcemap: 'linked',
    logLevel: 'info',
});
