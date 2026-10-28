// Bundel loader untuk CDN: satu berkas IIFE, ES2018, tanpa dependensi.
// Origin aplikasi widget ditanam per lingkungan: PLASGOS_WIDGET_ORIGIN (bawaan produksi).
import { build } from 'esbuild';

const widgetOrigin = process.env.PLASGOS_WIDGET_ORIGIN || 'https://widget.plasgoschat.my.id';
if (!/^https?:\/\/[^/]+$/.test(widgetOrigin)) {
    throw new Error(`PLASGOS_WIDGET_ORIGIN harus origin tanpa path, mis. https://widget.plasgoschat.my.id — dapat "${widgetOrigin}"`);
}

await build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/loader.js',
    bundle: true,
    format: 'iife',
    target: 'es2018',
    minify: true,
    legalComments: 'none',
    sourcemap: 'linked',
    define: { __WIDGET_ORIGIN__: JSON.stringify(widgetOrigin) },
    logLevel: 'info',
});
