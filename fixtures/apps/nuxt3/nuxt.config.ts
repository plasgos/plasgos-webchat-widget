/** Fixture Nuxt 3: SSR + hidrasi, widget lewat plugin `.client` (hanya peramban). */
export default defineNuxtConfig({
    compatibilityDate: '2026-10-01',
    telemetry: false,
    devtools: { enabled: false },
    app: { head: { htmlAttrs: { lang: 'id' }, title: 'Toko Nuxt' } },
});
