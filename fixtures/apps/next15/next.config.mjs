import { fileURLToPath } from 'node:url';

/** Fixture Next.js 15: App Router + Pages Router dalam satu aplikasi, build produksi. */
export default {
    reactStrictMode: true,
    eslint: { ignoreDuringBuilds: true },
    // Akar = aplikasi ini, bukan workspace widget di atasnya.
    outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
};
