# @plasgos/webchat-svelte

Komponen Svelte 5 untuk widget webchat Plasgos CRM. SvelteKit dan Vite. Aman SSR.

## Pasang

```bash
npm install @plasgos/webchat-svelte
```

## Pakai

SvelteKit (`src/routes/+layout.svelte`):

```svelte
<script lang="ts">
    import { page } from '$app/state';
    import { PlasgosWebchat } from '@plasgos/webchat-svelte';
    let { children } = $props();
</script>

{@render children()}
<PlasgosWebchat widgetId="wgt_…" loaderUrl="https://cdn…/loader/v1/loader.js" pathname={page.url.pathname} />
```

Widget ID dan kode siap salin ada di dashboard Plasgos CRM → **Webchat → Pemasangan**.

- `identityToken={data.webchatToken}`: pengunjung yang login menjadi terverifikasi. Token dibuat di server dengan
  `Webchat.signIdentity` dari [`plasgos-crm-sdk`](https://www.npmjs.com/package/plasgos-crm-sdk). Dikosongkan
  (logout) = sesi anonim baru.
- `pathname`: navigasi dilaporkan saat berubah.
- Opsi lain sama dengan [`@plasgos/webchat`](https://www.npmjs.com/package/@plasgos/webchat).

```svelte
<script lang="ts">
    import { webchat, webchatState } from '@plasgos/webchat-svelte';
</script>

<button onclick={() => webchat.open()}>Bantuan ({$webchatState.unread})</button>
```

## Lisensi

Hanya untuk pelanggan Plasgos CRM. Lihat [LICENSE](./LICENSE).
