# @plasgos/webchat

Widget webchat Plasgos CRM untuk aplikasi berbundler: Vite, webpack, Next.js, Nuxt, Angular,
SvelteKit, Astro, Remix. Aman SSR: di server semua fungsi no-op.

Memakai React, Vue, Angular, atau Svelte? Wrapper resminya lebih ringkas:
[`@plasgos/webchat-react`](https://www.npmjs.com/package/@plasgos/webchat-react),
[`-vue`](https://www.npmjs.com/package/@plasgos/webchat-vue),
[`-angular`](https://www.npmjs.com/package/@plasgos/webchat-angular),
[`-svelte`](https://www.npmjs.com/package/@plasgos/webchat-svelte).

## Pasang

```bash
npm install @plasgos/webchat
```

## Pakai

```ts
import { getWebchat, loadWebchat } from '@plasgos/webchat';

loadWebchat({ widgetId: 'wgt_…', loaderUrl: 'https://cdn…/loader/v1/loader.js' });

getWebchat().open();
const off = getWebchat().on('unread_changed', (data) => console.log(data));
```

Widget ID dan kode siap salin, lengkap dengan `loaderUrl` lingkungan Anda, ada di dashboard Plasgos CRM →
**Webchat → Pemasangan**.

| Opsi | Isi |
|---|---|
| `widgetId` | Wajib. ID widget `wgt_…` |
| `loaderUrl` | URL loader dari dashboard |
| `identityToken` | Token identitas dari server Anda (`Webchat.signIdentity` di [`plasgos-crm-sdk`](https://www.npmjs.com/package/plasgos-crm-sdk)); pengunjung yang login menjadi terverifikasi |
| `locale` | `'id'` atau `'en'` |
| `hideLauncher` | Sembunyikan tombol chat; buka lewat `getWebchat().open()` |
| `load` | `'eager'` memuat widget segera; bawaan menunggu halaman selesai dimuat |
| `position`, `offset`, `zIndex` | Letak tombol chat |

Daftar lengkap ada di tipe `WebchatOptions` (ikut terpasang).

- Snippet HTML dan paket ini boleh terpasang bersamaan: tetap satu widget.
- Website dengan Trusted Types: izinkan kebijakan `plasgos-webchat` di direktif CSP `trusted-types`.

## Web Component

```ts
import '@plasgos/webchat/element';
```

```html
<plasgos-webchat widget-id="wgt_…" loader-url="https://cdn…/loader/v1/loader.js"></plasgos-webchat>
```

Untuk Solid, Qwik, Preact, Lit, Ember, dan framework lain yang bisa merender elemen HTML. `identity-token` diisi =
pengunjung terverifikasi; dihapus = logout.

## Lisensi

Hanya untuk pelanggan Plasgos CRM. Lihat [LICENSE](./LICENSE).
