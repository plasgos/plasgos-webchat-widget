// `element.js` untuk CDN (`loader/v1/element.js`): satu berkas modul ES tanpa dependensi, didaftarkan saat dimuat:
//   <script type="module" src="https://cdn.plasgoschat.my.id/loader/v1/element.js"></script>
import { build } from 'esbuild';

await build({
    entryPoints: ['src/element.ts'],
    outfile: 'dist/cdn/element.js',
    bundle: true,
    format: 'esm',
    target: ['es2020', 'chrome100', 'edge100', 'firefox100', 'safari15', 'ios15'],
    minify: true,
    legalComments: 'none',
    logLevel: 'info',
});
