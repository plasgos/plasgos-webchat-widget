// Bundel aplikasi widget: skrip KLASIK (bukan modul) — dokumen iframe api-crm memuat
// `<script src="${WEBCHAT_CDN_ORIGIN}/widget-app/v1/app.js" data-widget-id="…" defer>`.
import { build } from 'esbuild';

await build({
    entryPoints: ['src/main.ts'],
    outfile: 'dist/app.js',
    bundle: true,
    format: 'iife',
    // Daftar peramban yang didukung (WEBCHAT_EMBED_COMPATIBILITY.md §5.2) — esbuild MENOLAK sintaks yang tak ada di
    // sana (mis. lookbehind regex belum ada di iOS Safari 15), bukan diam-diam lolos lalu mati di ponsel pengunjung.
    target: ['es2020', 'chrome100', 'edge100', 'firefox100', 'safari15', 'ios15'],
    minify: true,
    legalComments: 'none',
    sourcemap: 'linked',
    logLevel: 'info',
});
