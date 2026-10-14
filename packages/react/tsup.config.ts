import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2018',
    clean: true,
    sourcemap: true,
    external: ['react', '@plasgos/webchat'],
    // Next.js App Router: komponen klien. esbuild membuang direktif tingkat modul saat bundling → dipasang di keluaran.
    banner: { js: '"use client";' },
});
