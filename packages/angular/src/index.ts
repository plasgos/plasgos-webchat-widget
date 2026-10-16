/**
 * `@plasgos/webchat-angular` — provider & service Angular 17+ (WEBCHAT_EMBED_COMPATIBILITY.md §6.7).
 *
 *   // app.config.ts
 *   export const appConfig = { providers: [provideRouter(routes), providePlasgosWebchat({ widgetId: 'wgt_…' })] };
 *   // komponen
 *   private readonly webchat = inject(PlasgosWebchatService);   this.webchat.open();   this.webchat.state().unread
 *
 *   - Boot hanya di peramban (aman SSR), setelah render pertama, di LUAR zona Angular → event widget tak memicu
 *     change detection aplikasi; pendengar tenant (`on`) dijalankan kembali di dalam zona.
 *   - Router ada → navigasi dari `NavigationEnd` (hanya URL yang berubah), deteksi otomatis loader dimatikan.
 *   - Tanpa decorator: berfungsi di aplikasi standalone, NgModule (`importProvidersFrom` tak perlu), dan zoneless.
 */
import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, ENVIRONMENT_INITIALIZER, Injector, inject, makeEnvironmentProviders, NgZone, PLATFORM_ID, signal } from '@angular/core';
import type { EnvironmentProviders, Signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';

import { getWebchat, loadWebchat } from '@plasgos/webchat';
import type { WebchatClient, WebchatEventName, WebchatOptions, WebchatState } from '@plasgos/webchat';

export type { WebchatClient, WebchatOptions, WebchatState } from '@plasgos/webchat';

const EMPTY_STATE: WebchatState = { booted: false, open: false, unread: 0, trustLevel: null };
const STATE_EVENTS: readonly WebchatEventName[] = ['ready', 'open', 'close', 'unread_changed', 'error'];

/** Bentuk zona yang dipakai — NgZone sungguhan maupun aplikasi zoneless (NoopNgZone). */
export interface ZoneLike {
    run<T>(fn: () => T): T;
    runOutsideAngular<T>(fn: () => T): T;
}

/** Klien widget untuk komponen Angular. Instans tunggal per aplikasi (`providePlasgosWebchat`). */
export class PlasgosWebchatService implements WebchatClient {
    private readonly client = getWebchat();

    private readonly stateSignal = signal<WebchatState>({ ...EMPTY_STATE });

    private identity: string | null;

    private signedOutDeclared: boolean;

    /** Keadaan widget (terbuka, belum dibaca, …) sebagai signal. */
    public readonly state: Signal<WebchatState> = this.stateSignal.asReadonly();


    public constructor(private readonly zone: ZoneLike, private readonly options: WebchatOptions) {
        this.identity = options.identityToken ?? null;
        this.signedOutDeclared = options.identityToken === null;
    }


    /** Dipanggil sekali saat widget dinyalakan: keadaan mengikuti event widget. */
    public listen(): void {
        for (const event of STATE_EVENTS) {
            this.client.on(event, () => {
                this.zone.run(() => {
                    this.stateSignal.set({ ...this.client.getState() });
                });
            });
        }
    }


    public open(): void {
        this.client.open();
    }


    public close(): void {
        this.client.close();
    }


    public toggle(): void {
        this.client.toggle();
    }


    public shutdown(): void {
        this.client.shutdown();
    }


    public identify(token: string): void {
        this.client.identify(token);
    }


    public page(info?: { readonly url?: string; readonly title?: string }): void {
        this.client.page(info);
    }


    public track(name: string, props?: Readonly<Record<string, unknown>>): void {
        this.client.track(name, props);
    }


    public consent(consent: { readonly analytics?: boolean; readonly chat?: boolean }): void {
        this.client.consent(consent);
    }


    public setLocale(locale: 'id' | 'en'): void {
        this.client.setLocale(locale);
    }


    /** Pendengar tenant dijalankan DI DALAM zona → tampilan aplikasi diperbarui. Kembalian = pelepas. */
    public on(event: WebchatEventName, handler: (data: unknown) => void): () => void {
        return this.client.on(event, (data) => {
            this.zone.run(() => {
                handler(data);
            });
        });
    }


    public getState(): WebchatState {
        return this.client.getState();
    }


    /** Login: token dari server tenant → identify. Logout: `null` → shutdown lalu sesi anonim baru. */
    public setIdentityToken(token: string | null): void {
        if (token && token !== this.identity) {
            this.client.identify(token);
        } else if (!token && this.identity) {
            this.client.shutdown();
            const anonymous: { -readonly [K in keyof WebchatOptions]: WebchatOptions[K] } = { ...this.options };
            delete anonymous.identityToken;
            this.zone.runOutsideAngular(() => void loadWebchat(anonymous));
        } else if (token === null && !this.signedOutDeclared) {
            // Halaman pertama tanpa pengguna (logout lewat redirect/SSR): sesi hasil login sebelumnya diakhiri.
            this.client.identify(null);
        }
        this.signedOutDeclared = token === null;
        this.identity = token;
    }
}

function startWebchat(options: WebchatOptions): void {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) {
        return;
    }
    const zone = inject(NgZone);
    const injector = inject(Injector);
    const service = inject(PlasgosWebchatService);
    const router = inject(Router, { optional: true });
    const bootOptions: WebchatOptions = router ? { autoPageTracking: false, ...options } : options;

    afterNextRender(() => {
        zone.runOutsideAngular(() => {
            service.listen();
            void loadWebchat(bootOptions);
        });
    }, { injector });

    if (router) {
        let reportedUrl = window.location.href;
        router.events.subscribe((event) => {
            if (!(event instanceof NavigationEnd) || window.location.href === reportedUrl) {
                return;
            }
            reportedUrl = window.location.href;
            zone.runOutsideAngular(() => {
                service.page({ url: reportedUrl, title: document.title });
            });
        });
    }
}

/** Provider widget webchat untuk `bootstrapApplication` / `ApplicationConfig.providers`. */
export function providePlasgosWebchat(options: WebchatOptions): EnvironmentProviders {
    return makeEnvironmentProviders([
        {
            provide: PlasgosWebchatService,
            useFactory: (): PlasgosWebchatService => new PlasgosWebchatService(inject(NgZone), options),
        },
        // Sengaja ENVIRONMENT_INITIALIZER: penggantinya (provideEnvironmentInitializer) baru ada sejak Angular 19,
        // sedangkan paket ini mendukung Angular 17–22.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        { provide: ENVIRONMENT_INITIALIZER, multi: true, useValue: () => { startWebchat(options); } },
    ]);
}
