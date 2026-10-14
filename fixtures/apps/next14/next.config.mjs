import { fileURLToPath } from 'node:url';

/** Fixture Next.js 14 (React 18): App Router + Pages Router dalam satu aplikasi, build produksi. */
export default {
    reactStrictMode: true,
    eslint: { ignoreDuringBuilds: true },
    // Akar = aplikasi ini, bukan workspace widget di atasnya.
    experimental: { outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)) },
};
