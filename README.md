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
Lighthouse mencari Chrome lewat `chrome-launcher` (`CHROME_PATH` bila perlu).

## Anggaran yang dijaga CI

| Apa | Batas | Berkas |
|---|---|---|
| Loader | ≤ 5 KB gzip | `size-budget.json` |
| Aplikasi widget (muatan awal) | ≤ 60 KB gzip; sisanya dimuat malas | `size-budget.json` |
| Skor performa Lighthouse fixture | ≥ 0,95 | `perf-budget.json` |
| Selisih dengan vs tanpa widget | LCP ≤ +100 ms, CLS ≤ +0,01, TBT ≤ +50 ms (median 3 pengukuran) | `perf-budget.json` |

## Versi & rilis

Semver per paket. Loader: `loader/<x.y.z>/loader.js` immutable (SRI di catatan rilis) dan `loader/v1/` mengikuti
rilis minor/patch terbaru major 1. Perubahan protokol postMessage yang tidak kompatibel = versi protokol baru;
loader & iframe mengabaikan versi yang tak dikenalnya. Rilis CDN dan rollback dibahas di fase W3g.

## Lisensi

Proprietary — lihat [LICENSE](LICENSE).
