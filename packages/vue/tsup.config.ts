import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2018',
    clean: true,
    sourcemap: true,
    external: ['vue', '@plasgos/webchat'],
});
