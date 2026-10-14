// Angular 22 SSR (zoneless bawaan) + hidrasi: provider widget sama seperti aplikasi tanpa SSR — boot hanya di
// peramban, setelah render pertama.
import type { ApplicationConfig } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { providePlasgosWebchat } from '@plasgos/webchat-angular';

import { HomePage, ProductPage } from './app';

export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter([
            { path: '', component: HomePage, title: 'Toko Angular SSR' },
            { path: 'produk', component: ProductPage, title: 'Toko Angular SSR — produk' },
        ]),
        provideClientHydration(withEventReplay()),
        providePlasgosWebchat({
            widgetId: 'wgt_0123456789abcdef01234567',
            loaderUrl: 'http://localhost:4400/packages/loader/dist/loader.js',
            widgetOrigin: 'http://127.0.0.1:4400',
            load: 'eager',
        }),
    ],
};
