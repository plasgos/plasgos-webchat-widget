import { defineConfig } from 'tsup';

// Tanpa decorator & tanpa komponen → cukup modul ES biasa (tak butuh kompilasi Ivy / ng-packagr).
export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2020',
    clean: true,
    sourcemap: true,
    external: [/^@angular\//, '@plasgos/webchat', 'rxjs'],
});
