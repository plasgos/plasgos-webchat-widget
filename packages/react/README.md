# @plasgos/webchat-react

Komponen dan hook React untuk widget webchat Plasgos CRM. React 17–19, Next.js (App &
Pages Router), Remix / React Router, Gatsby. Aman SSR dan StrictMode.

## Pasang

```bash
npm install @plasgos/webchat-react
```

## Pakai

```tsx
import { PlasgosWebchat } from '@plasgos/webchat-react';

export function Webchat() {
    return <PlasgosWebchat widgetId="wgt_…" loaderUrl="https://cdn…/loader/v1/loader.js" />;
}
```

Next.js App Router (`components/webchat.tsx`, pasang `<Webchat />` di `app/layout.tsx`):

```tsx
'use client';
import { usePathname } from 'next/navigation';
import { PlasgosWebchat } from '@plasgos/webchat-react';

export function Webchat() {
    const pathname = usePathname();
    return <PlasgosWebchat widgetId="wgt_…" loaderUrl="https://cdn…/loader/v1/loader.js" pathname={pathname} />;
}
```

Widget ID dan kode siap salin ada di dashboard Plasgos CRM → **Webchat → Pemasangan**.

- `identityToken={session?.webchatToken}`: pengunjung yang login menjadi terverifikasi. Token dibuat di server
  dengan `Webchat.signIdentity` dari [`plasgos-crm-sdk`](https://www.npmjs.com/package/plasgos-crm-sdk). Token
  dikosongkan (logout) = sesi anonim baru.
- `pathname`: navigasi dilaporkan saat berubah. Opsional, karena loader juga mendeteksi navigasi SPA.
- Opsi lain sama dengan [`@plasgos/webchat`](https://www.npmjs.com/package/@plasgos/webchat).

```tsx
import { usePlasgosWebchat } from '@plasgos/webchat-react';

const webchat = usePlasgosWebchat();
<button onClick={() => webchat.open()}>Bantuan ({webchat.state.unread})</button>;
```

## Lisensi

Hanya untuk pelanggan Plasgos CRM. Lihat [LICENSE](./LICENSE).
