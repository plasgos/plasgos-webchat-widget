import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Komponen & rune Svelte (`.svelte`, `.svelte.ts`) dikompilasi plugin resmi; berkas lain tak tersentuh.
    plugins: [svelte({ compilerOptions: { css: 'injected' } })],
    resolve: { conditions: ['browser'] },
    test: {
        include: ['packages/*/test/**/*.test.{ts,tsx}', 'packages/*/test/**/*.test.svelte.ts', 'scripts/**/test/*.test.mjs'],
        environment: 'jsdom',
        // Wrapper framework diuji terhadap SUMBER paket inti (tak bergantung urutan build).
        alias: { '@plasgos/webchat': new URL('./packages/webchat/src/index.ts', import.meta.url).pathname },
    },
});
