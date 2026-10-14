import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** Fixture SvelteKit 3: SSR + hidrasi, server Node (konfigurasi lewat plugin, tanpa svelte.config.js). */
export default defineConfig({ plugins: [sveltekit({ adapter: adapter() })] });
