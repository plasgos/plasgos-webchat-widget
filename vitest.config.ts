import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['packages/*/test/**/*.test.{ts,tsx}'],
        environment: 'jsdom',
        // Wrapper framework diuji terhadap SUMBER paket inti (tak bergantung urutan build).
        alias: { '@plasgos/webchat': new URL('./packages/webchat/src/index.ts', import.meta.url).pathname },
    },
});
