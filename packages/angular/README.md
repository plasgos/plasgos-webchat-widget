# @plasgos/webchat-angular

Provider dan service Angular 17+ untuk widget webchat Plasgos CRM. Standalone maupun
NgModule, SSR (`@angular/ssr`), zoneless.

## Pasang

```bash
npm install @plasgos/webchat-angular
```

## Pakai

`src/app/app.config.ts`:

```ts
import { providePlasgosWebchat } from '@plasgos/webchat-angular';

export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter(routes),
        providePlasgosWebchat({ widgetId: 'wgt_…', loaderUrl: 'https://cdn…/loader/v1/loader.js' }),
    ],
};
```

Widget ID dan kode siap salin ada di dashboard Plasgos CRM → **Webchat → Pemasangan**.

Di komponen:

```ts
import { PlasgosWebchatService } from '@plasgos/webchat-angular';

private readonly webchat = inject(PlasgosWebchatService);

this.webchat.open();
this.webchat.state().unread;          // signal
this.webchat.setIdentityToken(token); // login: pengunjung terverifikasi; kosong = logout
```

- Widget dinyalakan setelah render pertama, di luar zona Angular, sehingga event widget tidak memicu change
  detection.
- Ada Router: navigasi dilaporkan dari `NavigationEnd`.
- Token identitas dibuat di server dengan `Webchat.signIdentity` dari
  [`plasgos-crm-sdk`](https://www.npmjs.com/package/plasgos-crm-sdk).
- Opsi lain sama dengan [`@plasgos/webchat`](https://www.npmjs.com/package/@plasgos/webchat).

## Lisensi

Hanya untuk pelanggan Plasgos CRM. Lihat [LICENSE](./LICENSE).
