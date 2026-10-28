# @plasgos/webchat-vue

Plugin dan composable Vue 3 untuk widget webchat Plasgos CRM. Vue Router, Nuxt 3. Aman
SSR.

## Pasang

```bash
npm install @plasgos/webchat-vue
```

## Pakai

Vue 3 (`src/main.ts`):

```ts
import { PlasgosWebchatPlugin } from '@plasgos/webchat-vue';

app.use(PlasgosWebchatPlugin, { widgetId: 'wgt_…', loaderUrl: 'https://cdn…/loader/v1/loader.js', router });
```

Nuxt 3 (`plugins/plasgos-webchat.client.ts`):

```ts
import { PlasgosWebchatPlugin } from '@plasgos/webchat-vue';

export default defineNuxtPlugin((nuxtApp) => {
    nuxtApp.vueApp.use(PlasgosWebchatPlugin, {
        widgetId: 'wgt_…',
        loaderUrl: 'https://cdn…/loader/v1/loader.js',
        router: useRouter(),
    });
});
```

Widget ID dan kode siap salin ada di dashboard Plasgos CRM → **Webchat → Pemasangan**.

- `router`: navigasi dilaporkan dari `router.afterEach` (hanya bila URL berubah).
- Opsi lain sama dengan [`@plasgos/webchat`](https://www.npmjs.com/package/@plasgos/webchat).

```ts
import { usePlasgosWebchat } from '@plasgos/webchat-vue';

const webchat = usePlasgosWebchat();
webchat.open();
webchat.state.unread;                 // reaktif
webchat.setIdentityToken(token);      // login: pengunjung terverifikasi; kosong = logout
```

Token identitas dibuat di server dengan `Webchat.signIdentity` dari
[`plasgos-crm-sdk`](https://www.npmjs.com/package/plasgos-crm-sdk).

## Lisensi

Hanya untuk pelanggan Plasgos CRM. Lihat [LICENSE](./LICENSE).
