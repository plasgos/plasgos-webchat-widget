# plasgos-webchat-widget

Widget webchat Plasgos CRM yang dipasang di website tenant: **loader**, **aplikasi widget** (iframe), **paket npm**,
dan **wrapper framework**. Backend-nya modul `webchat` di api-crm (API publik `/webchat/v1`, socket `/webchat`,
dokumen iframe `/w/:widget_id`).

Kontrak & rancangan tinggal di api-crm, `server/modules/webchat/docs/`:
- `WEBCHAT_EMBED_COMPATIBILITY.md` — cara pasang di semua framework, aturan teknis loader (§5), matriks uji (§7).
- `WEBCHAT_DESIGN.md` — API publik, socket, keamanan.
- `WEBCHAT_IMPLEMENTATION_PLAN.md` — fase W3a–W3g (repo ini).

## Isi repo

| Paket | Diterbitkan | Isi |
|---|---|---|
| `packages/protocol` (`@plasgos/webchat-protocol`) | tidak (internal) | Kontrak postMessage v1 `{ v: 1, type, payload }` antara loader dan iframe; validasi pesan masuk & pemeriksaan origin/source |
| `packages/loader` | CDN `loader/<versi>/loader.js` & `loader/v1/` | Loader JavaScript murni tanpa dependensi, ES2018, ≤5 KB gzip, berjalan di halaman tenant |
| `packages/widget-app` | CDN `widget-app/v1/app.js` | Aplikasi chat di dalam iframe; satu-satunya bagian yang berbicara dengan API & menyimpan sesi |
| `packages/webchat` (`@plasgos/webchat`) | npm | Paket inti untuk aplikasi berbundler; ESM + CJS + tipe; aman SSR |
| wrapper React / Vue / Angular / Svelte | npm (W3e) | Pola idiomatis per framework, memanggil paket inti |
| `fixtures/*` | — | Website uji per kasus (CSP ketat, framework) untuk e2e & Lighthouse |
| `fixtures/apps/*` | — | Aplikasi meta-framework build produksi (Next 14/15, React Router, Nuxt 3, Angular SSR, SvelteKit, Astro) |

Widget yang sebenarnya selalu sama (aplikasi di iframe); yang berbeda per framework hanya cara memanggil loader.

## Pengembangan

Prasyarat: Node ≥ 20, pnpm (versi dipin di `packageManager`, aktifkan dengan `corepack enable`).

```bash
pnpm install
pnpm lint          # ESLint: TypeScript strict tanpa any, 4 spasi, kutip tunggal, titik koma, ≤120 kolom
pnpm typecheck
pnpm test          # vitest (jsdom; uji SSR memakai lingkungan node)
pnpm build         # loader & aplikasi widget (esbuild), paket npm (tsup)
pnpm size          # anggaran ukuran gzip — size-budget.json
pnpm e2e           # Playwright terhadap fixtures/ (server statis scripts/serve-fixtures.mjs)
pnpm perf          # Lighthouse: halaman dengan vs tanpa widget — perf-budget.json
pnpm ci            # lint → typecheck → test → build → size → e2e
```

Di mesin tanpa browser Playwright, pakai Chrome terpasang: `PW_CHROMIUM_CHANNEL=chrome pnpm e2e --project=chromium`.
Firefox: `pnpm exec playwright install firefox`. WebKit/iPhone butuh dependensi sistem (`--with-deps`, dijalankan CI).
Lighthouse mencari Chrome lewat `chrome-launcher` (`CHROME_PATH` bila perlu).

### Origin aplikasi widget per lingkungan

Loader TIDAK memanggil API; ia hanya membuat iframe `${origin widget}/w/${widgetId}`. Origin itu ditanam saat build:

```bash
PLASGOS_WIDGET_ORIGIN=https://widget.plasgoschat.com pnpm build   # bawaan (produksi)
PLASGOS_WIDGET_ORIGIN=https://widget.staging.example pnpm build   # lingkungan lain
```

Atribut `data-widget-origin` pada tag loader menimpanya (staging/uji).

### Fixture & stub

`fixtures/<nama>/index.html` = website tenant uji; `headers.json` di sampingnya = header yang dikirim server fixture
(mis. CSP ketat). `fixtures/_widget-stub/` menjawab `/w/:widget_id` dari origin lain (`127.0.0.1`) dengan sisi iframe
protokol v1 sampai aplikasi widget asli (W3c) dipakai di e2e.

## Aplikasi widget (`packages/widget-app`)

TypeScript murni tanpa framework (anggaran 60 KB gzip; saat ini ±26 KB termasuk klien socket.io), target build =
peramban yang didukung (Safari/iOS 15, Chrome/Edge/Firefox 100) supaya sintaks yang tak tersedia ditolak saat build.

| Modul | Tanggung jawab |
|---|---|
| `bridge` | protokol v1 ke loader; pesan masuk dicek origin + jendela induk |
| `api` | REST `/webchat/v1` (tanpa cookie), galat berkode stabil |
| `session` | token akses + refresh token berotasi; refresh/boot antar-tab di bawah satu kunci (Web Locks), token dibagikan lewat BroadcastChannel |
| `realtime` | socket.io `/webchat`, `auth` berupa fungsi (token terbaru tiap sambung) |
| `store`, `app` | keadaan, pesan optimistis + antrean coba ulang, sampai/dibaca, belum dibaca, mengetik, perintah loader |
| `ui/*`, `markdown`, `i18n`, `colors`, `layout` | tampilan tanpa `innerHTML` untuk isi pesan, markdown subset aman, id/en, kontras WCAG, tata letak bingkai |
| `captcha`, `sound` | Turnstile dimuat hanya bila diminta server; nada notifikasi Web Audio |

## Paket npm `@plasgos/webchat` & Web Component

```ts
import { loadWebchat, getWebchat } from '@plasgos/webchat';      // aman SSR: di server semua no-op
await loadWebchat({ widgetId: 'wgt_…', identityToken, locale: 'id' });
getWebchat().open();
const off = getWebchat().on('unread_changed', ({ count }) => …);
```

- Stub antrean & loader yang SAMA dengan snippet: snippet + paket bersamaan = satu widget.
- Loader disuntik setelah event `load` (kecuali `load: 'eager'`). Trusted Types: kebijakan `plasgos-webchat`.
- `@plasgos/webchat/element` mendaftarkan `<plasgos-webchat widget-id identity-token locale hide-launcher>`;
  atribut juga tersedia sebagai properti tercermin (`widgetId`, `identityToken`, `locale`) untuk Solid/React 19.
  Versi CDN satu berkas: `dist/cdn/element.js` → `loader/v1/element.js`.
- `pnpm --filter @plasgos/webchat smoke` mengimpor hasil build sebagai ESM & CJS di Node.

## Wrapper framework

| Paket | Pakai |
|---|---|
| `@plasgos/webchat-react` | `<PlasgosWebchat widgetId identityToken pathname />` + `usePlasgosWebchat()` (klien + `state` terbuka/belum dibaca). Tanpa DOM, aman StrictMode & SSR, keluaran berdirektif `"use client"` (Next App Router). Logout (token → kosong) = `shutdown` lalu sesi anonim baru. |
| `@plasgos/webchat-vue` | `app.use(PlasgosWebchatPlugin, { widgetId, router })` + `usePlasgosWebchat()` (klien + `state` reaktif + `setIdentityToken`). Navigasi dari `router.afterEach` (hanya URL yang berubah); Nuxt 3 lewat plugin `.client`. |
| `@plasgos/webchat-angular` | `providePlasgosWebchat({ widgetId })` di `bootstrapApplication` + `inject(PlasgosWebchatService)` (`state` signal, `setIdentityToken`). Boot setelah render pertama di luar zona (aman SSR & zoneless), navigasi dari `NavigationEnd`. Angular 17–22, tanpa decorator (tsup biasa). |
| `@plasgos/webchat-svelte` | `<PlasgosWebchat widgetId identityToken pathname />` (Svelte 5, runes) + `webchat` & store `webchatState`. SvelteKit: `pathname={page.url.pathname}`. Dikemas `svelte-package` (sumber `.svelte`). |

## Matriks meta-framework (SSR)

`fixtures/apps/*` = aplikasi sungguhan dengan perangkatnya sendiri, dibangun produksi dan dijalankan servernya
(`e2e-apps/`). Paket dipasang dari tarball `pnpm pack` (isi yang dipublikasikan) di luar workspace, seperti website
tenant memasang dari registry — satu salinan React/Vue/… milik aplikasi.

```bash
pnpm build
pnpm apps:build                 # kemas paket → instal & build tiap aplikasi (APPS=next15,astro membatasi)
pnpm lint:apps
PW_CHROMIUM_CHANNEL=chrome pnpm e2e:apps
```

Setiap aplikasi diuji: render server + hidrasi tanpa galat/peringatan console, tepat satu iframe, navigasi klien
(Link/NuxtLink/routerLink/View Transitions) dilaporkan SEKALI dengan URL tujuan, dan iframe yang SAMA bertahan
lintas navigasi (tanpa handshake ulang).

| Aplikasi | Port | Cara pasang yang diuji |
|---|---|---|
| `next15` | 4511 | `@plasgos/webchat-react` — App Router (komponen klien, `usePathname`) & Pages Router (`_app`, `router.asPath`) |
| `next14` | 4512 | sama, React 18 |
| `react-router` | 4513 | React Router 8 mode framework (penerus Remix), `useLocation` di root |
| `nuxt3` | 4514 | `@plasgos/webchat-vue` lewat `plugins/*.client.ts` + router Nuxt |
| `angular-ssr` | 4515 | `providePlasgosWebchat` + `@angular/ssr` (express), hidrasi, zoneless |
| `sveltekit` | 4516 | `@plasgos/webchat-svelte` di layout akar, `page` dari `$app/state` (SvelteKit 3: konfigurasi lewat plugin Vite) |
| `astro` | 4517 | `loadWebchat` dalam `<script>` layout + View Transitions (`ClientRouter`) |

## Uji live terhadap api-crm

`e2e-live/` menjalankan loader + aplikasi widget asli terhadap api-crm dev (REST, socket, inbox sungguhan) — tidak di
CI. Server fixture berperan sebagai CDN:

```bash
# 1. api-crm dev memuat aplikasi widget dari server fixture (env proses pm2, tanpa ubah berkas):
docker exec dev-api-crm-app-dev sh -c 'cd /app && WEBCHAT_CDN_ORIGIN=http://localhost:4400 WEBCHAT_PUBLIC_ORIGIN=http://127.0.0.1:3001 pm2 restart api-crm --update-env'
# 2. jalankan (token tenant; di api-crm lokal berbentuk terenkripsi iv:cipher):
pnpm build
API_CRM_TOKEN=<token> PW_CHROMIUM_CHANNEL=chrome pnpm e2e:live --project=chromium
API_CRM_TOKEN=<token> pnpm e2e:live --project=firefox
```

Skenario: tanya-jawab realtime dengan status sampai/dibaca dua arah, muat ulang memulihkan sesi & riwayat, antrean
saat offline, dua tab pengunjung yang sama, audit aksesibilitas axe (WCAG 2.1 A/AA tanpa pelanggaran serius/kritis).

## Anggaran yang dijaga CI

| Apa | Batas | Berkas |
|---|---|---|
| Loader | ≤ 5 KB gzip | `size-budget.json` |
| Aplikasi widget (muatan awal) | ≤ 60 KB gzip; sisanya dimuat malas | `size-budget.json` |
| Skor performa Lighthouse fixture | ≥ 0,95 | `perf-budget.json` |
| Selisih dengan vs tanpa widget | LCP ≤ +100 ms, CLS ≤ +0,01, TBT ≤ +50 ms — throttling diterapkan (`devtools`), pemanasan dibuang, median 5 | `perf-budget.json` |

## Versi & rilis

Semver per paket. Loader: `loader/<x.y.z>/loader.js` immutable (SRI di catatan rilis) dan `loader/v1/` mengikuti
rilis minor/patch terbaru major 1. Perubahan protokol postMessage yang tidak kompatibel = versi protokol baru;
loader & iframe mengabaikan versi yang tak dikenalnya. Rilis CDN dan rollback dibahas di fase W3g.

## Lisensi

Proprietary — lihat [LICENSE](LICENSE).
