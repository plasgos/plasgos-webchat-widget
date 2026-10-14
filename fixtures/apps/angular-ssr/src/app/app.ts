import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { PlasgosWebchatService } from '@plasgos/webchat-angular';

@Component({ selector: 'halaman-beranda', template: '<h2>Beranda</h2>' })
export class HomePage {}

@Component({ selector: 'halaman-produk', template: '<h2>Produk</h2>' })
export class ProductPage {}

@Component({
    selector: 'toko-angular',
    imports: [RouterLink, RouterOutlet],
    template: `<main>
        <h1>Toko Angular SSR</h1>
        <a id="ke-produk" routerLink="/produk">Lihat produk</a>
        <button id="bantuan" type="button" (click)="webchat.open()">Butuh bantuan? ({{ webchat.state().unread }})</button>
        <router-outlet />
    </main>`,
})
export class App {
    protected readonly webchat = inject(PlasgosWebchatService);
}
