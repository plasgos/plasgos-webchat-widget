// Bundel loader untuk CDN: satu berkas IIFE, ES2018, tanpa komentar lisensi pihak ketiga (tak ada dependensi).
import { build } from 'esbuild';

await build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/loader.js',
    bundle: true,
    format: 'iife',
    target: 'es2018',
    minify: true,
    legalComments: 'none',
    sourcemap: 'linked',
    logLevel: 'info',
});
