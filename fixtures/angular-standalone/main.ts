// Aplikasi Angular standalone (JIT) dengan @plasgos/webchat-angular: provider di bootstrapApplication, navigasi
// dari Router, tombol bantuan & lencana belum dibaca lewat PlasgosWebchatService (signal).
import '@angular/compiler';
import 'zone.js';
import { Component, inject, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, RouterLink, RouterOutlet } from '@angular/router';
import { PlasgosWebchatService, providePlasgosWebchat } from '@plasgos/webchat-angular';

@Component({ selector: 'halaman-beranda', standalone: true, template: '<h2>Beranda</h2>' })
class HomePage {}

@Component({ selector: 'halaman-produk', standalone: true, template: '<h2>Produk</h2>' })
class ProductPage {}

@Component({
    selector: 'toko-angular',
    standalone: true,
    imports: [RouterLink, RouterOutlet],
    template: `<main>
        <h1>Toko Angular</h1>
        <a id="ke-produk" routerLink="/produk">Lihat produk</a>
        <button id="bantuan" type="button" (click)="webchat.open()">Butuh bantuan? ({{ webchat.state().unread }})</button>
        <router-outlet />
    </main>`,
})
class AppComponent {
    readonly webchat = inject(PlasgosWebchatService);
}

bootstrapApplication(AppComponent, {
    providers: [
        provideZoneChangeDetection(),
        provideRouter([{ path: '', component: HomePage }, { path: 'produk', component: ProductPage }]),
        providePlasgosWebchat({
            widgetId: 'wgt_0123456789abcdef01234567',
            loaderUrl: '/packages/loader/dist/loader.js',
            widgetOrigin: 'http://127.0.0.1:4400',
            load: 'eager',
        }),
    ],
}).catch((error: unknown) => {
    console.error(error);
});
