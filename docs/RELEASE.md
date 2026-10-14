# Rilis CDN widget webchat

Loader, Web Component, dan aplikasi widget terbit ke CDN berversi (keputusan K5,
`api-crm/server/modules/webchat/docs/WEBCHAT_DESIGN.md` §13.5). Paket npm (`@plasgos/webchat*`) terbit terpisah.

## Susunan CDN

| Path | Isi | Cache-Control |
|---|---|---|
| `loader/<x.y.z>/loader.js`, `loader/<x.y.z>/element.js` | versi terkunci, **tak pernah ditimpa** | `public, max-age=31536000, immutable` |
| `widget-app/<x.y.z>/app.js` | aplikasi widget (dimuat dokumen iframe `/w/:widget_id`) | sama |
| `loader/v1/*`, `widget-app/v1/*` | alias: salinan versi yang sedang ditunjuk; dipakai snippet & dokumen iframe | `public, max-age=300` |
| `releases/<x.y.z>.json` | manifest rilis: path, ukuran, SRI tiap berkas | `no-cache` |
| `releases/v1.json` | versi yang ditunjuk alias `v1` | `no-cache` |

- Versi = `version` di `package.json` akar (semver, mulai `1.0.0`; alias = `v<major>`). Perubahan yang merusak
  kontrak snippet/protokol = major baru (`v2`) — `v1` tetap hidup untuk website yang sudah memasangnya.
- Peta sumber (`*.map`) tidak diterbitkan.
- SRI hanya mungkin untuk versi terkunci (isi alias berpindah). Website yang mewajibkan SRI memakai snippet dari
  catatan rilis (`<script … integrity="sha384-…" crossorigin="anonymous">`) dan memperbaruinya sendiri.

## Membangun untuk satu lingkungan

Loader membawa origin aplikasi widget yang ditanam saat build. Deploy menolak loader yang dibangun untuk origin
lain:

```bash
PLASGOS_WIDGET_ORIGIN=https://widget.plasgoschat.com pnpm build
pnpm size
pnpm cdn plan            # cetak path & SRI yang akan terbit
```

## Deploy

```bash
PLASGOS_WIDGET_ORIGIN=https://widget.plasgoschat.com PLASGOS_CDN_ORIGIN=https://cdn.plasgoschat.com \
  pnpm cdn deploy --target s3://<bucket> --distribution <cloudfront-id> --notes release-notes/1.0.0.md
```

Urutan: berkas versi ditulis **bersyarat** (`--if-none-match *` — versi yang sudah ada dengan isi lain = deploy
berhenti, naikkan versi) → manifest → alias `v1` disalin dari versi (header alias) → `releases/v1.json` →
invalidasi CloudFront **hanya** `/loader/v1/*`, `/widget-app/v1/*`, `/releases/v1.json`. Deploy ulang versi yang
sama dengan isi sama aman (idempoten).

**Canary:** `--no-alias` menerbitkan versi tanpa memindah alias — uji dulu lewat snippet versi terkunci, lalu
`pnpm cdn alias --to <x.y.z>`.

## Rollback

```bash
pnpm cdn alias --target s3://<bucket> --distribution <cloudfront-id> --to <versi-sebelumnya>
pnpm cdn status --target s3://<bucket>          # → { "alias": "v1", "version": "…" }
```

Alias disalin ulang dari berkas versi yang SUDAH terbit (diperiksa terhadap SRI manifest) lalu diinvalidasi.
Website kembali ke versi lama paling lambat 5 menit (cache peramban alias) setelah invalidasi selesai. Versi baru
tetap ada untuk maju lagi.

## Penyiapan AWS (sekali per lingkungan)

Menunggu domain widget dibeli (K1, nama kerja `plasgoschat.com`).

1. **S3** — bucket privat (Block Public Access menyala, tanpa website hosting, versioning menyala sebagai jaring
   pengaman), hanya CloudFront yang membaca lewat **Origin Access Control**.
2. **CloudFront `cdn.<domain>`** — origin = bucket (OAC), HTTP→HTTPS, HTTP/2+3, kompresi gzip/brotli,
   *cache policy* yang menghormati `Cache-Control` objek (`CachingOptimized` tanpa override TTL tetap), sertifikat
   ACM `us-east-1`.
   *Response headers policy*: `Access-Control-Allow-Origin: *` (WAJIB — tanpa CORS, SRI lintas origin ditolak
   peramban), `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=63072000; includeSubDomains;
   preload`, `Cross-Origin-Resource-Policy: cross-origin`.
3. **CloudFront `widget.<domain>`** — origin = api-crm (`/w/*`, `/m/*`, `/webchat/v1/*`, socket `/webchat`), cache
   dimatikan kecuali `GET /webchat/v1/widgets/*/config` (menghormati `Cache-Control: max-age=60` dari server),
   WebSocket diteruskan, header `X-Forwarded-For` diteruskan (api-crm membaca IP lewat
   `WEBCHAT_TRUSTED_PROXY_HOPS`).
4. **IAM** — peran deploy untuk CI (OIDC GitHub, tanpa kunci statis) dengan izin minimum: `s3:GetObject`,
   `s3:PutObject`, `s3:ListBucket` pada bucket ini dan `cloudfront:CreateInvalidation` pada distribusi `cdn`.
5. **api-crm** — `WEBCHAT_CDN_ORIGIN=https://cdn.<domain>`, `WEBCHAT_PUBLIC_ORIGIN=https://widget.<domain>`.

## CI

`.github/workflows/release.yml` (manual, per *environment* GitHub `staging`/`production`): build untuk origin
lingkungan → anggaran ukuran → deploy (atau pindah alias) → catatan rilis di ringkasan job. Variabel environment:
`PLASGOS_WIDGET_ORIGIN`, `PLASGOS_CDN_ORIGIN`, `CDN_BUCKET`, `CDN_DISTRIBUTION_ID`, `AWS_DEPLOY_ROLE_ARN`,
`AWS_REGION`. Produksi sebaiknya memakai *required reviewers* pada environment.

## Uji

- `scripts/cdn/test/cdn.test.mjs` — versi immutable, deploy idempoten, rollback, `--no-alias`, perintah AWS CLI.
- `e2e/cdn.spec.ts` — bucket lokal (`file://.cdn-local`, disiapkan `e2e/global-setup.ts`: terbit 1.0.0 & 1.1.0
  lalu rollback ke 1.0.0) dilayani server fixture berperan CloudFront: SRI cocok → widget tampil; SRI dirusak →
  peramban menolak; alias = isi versi 1.0.0 dengan header alias.
