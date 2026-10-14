// Nuxt: plugin `.client` = hanya di peramban; router Nuxt melaporkan navigasi <NuxtLink>.
import { PlasgosWebchatPlugin } from '@plasgos/webchat-vue';

export default defineNuxtPlugin((nuxtApp) => {
    nuxtApp.vueApp.use(PlasgosWebchatPlugin, {
        widgetId: 'wgt_0123456789abcdef01234567',
        loaderUrl: 'http://localhost:4400/packages/loader/dist/loader.js',
        widgetOrigin: 'http://127.0.0.1:4400',
        load: 'eager',
        router: useRouter(),
    });
});
