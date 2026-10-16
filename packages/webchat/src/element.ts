/**
 * Web Component `<plasgos-webchat>` (WEBCHAT_EMBED_COMPATIBILITY.md §6.10) — untuk framework apa pun yang bisa
 * merender elemen HTML (Solid, Qwik, Preact, Lit, Ember, React 19, Angular dgn CUSTOM_ELEMENTS_SCHEMA, Vue dgn
 * isCustomElement). Elemen tak merender apa pun; widget tetap aplikasi di iframe yang dipasang loader.
 *
 *   <plasgos-webchat widget-id="wgt_…" identity-token="…" locale="id" hide-launcher></plasgos-webchat>
 *
 * `identity-token` dipantau: diisi/diganti = identify; dihapus = shutdown (logout). Atribut juga tersedia sebagai
 * PROPERTI yang dicerminkan (`widgetId`, `identityToken`, `locale`) — Solid & React 19 mengisi properti elemen kustom,
 * bukan atribut. Mengimpor modul ini mendaftarkan elemen (aman SSR: di server tak berbuat apa-apa).
 */
import { client, isBrowser, isTrustedPlasgosUrl, loadWebchat } from './index';
import type { WebchatOptions } from './index';

export const ELEMENT_NAME = 'plasgos-webchat';

function optionsOf(element: HTMLElement): WebchatOptions | null {
    const widgetId = element.getAttribute('widget-id');
    if (!widgetId) {
        return null;
    }
    const attribute = (name: string): string | null => element.getAttribute(name);
    const locale = attribute('locale');
    const load = attribute('load');
    return {
        widgetId,
        ...(locale === 'id' || locale === 'en' ? { locale } : {}),
        ...(element.hasAttribute('hide-launcher') ? { hideLauncher: true } : {}),
        ...(load === 'idle' || load === 'interaction' || load === 'eager' ? { load } : {}),
        ...(attribute('identity-token') ? { identityToken: attribute('identity-token') ?? '' } : {}),
        // Atribut bisa datang dari HTML yang disisipkan penyerang — hanya host Plasgos / origin halaman / loopback
        // yang diterima (`isTrustedPlasgosUrl`, ditegakkan lagi saat loader dipasang).
        ...(trusted(attribute('loader-url')) ? { loaderUrl: attribute('loader-url') ?? '' } : {}),
        ...(trusted(attribute('widget-origin')) ? { widgetOrigin: attribute('widget-origin') ?? '' } : {}),
    };
}

function trusted(value: string | null): boolean {
    if (!value) {
        return false;
    }
    if (!isTrustedPlasgosUrl(value, window.location.origin)) {
        console.warn(`[Plasgos Webchat] <${ELEMENT_NAME}> mengabaikan URL di luar Plasgos: ${value}`);
        return false;
    }
    return true;
}

/** Daftarkan `<plasgos-webchat>` sekali; dipanggil otomatis saat modul diimpor di peramban. */
export function defineWebchatElement(): void {
    if (!isBrowser() || typeof customElements === 'undefined' || customElements.get(ELEMENT_NAME)) {
        return;
    }

    class PlasgosWebchatElement extends HTMLElement {
        public static readonly observedAttributes = ['identity-token', 'locale'];

        private started = false;


        public get widgetId(): string | null {
            return this.getAttribute('widget-id');
        }


        public set widgetId(value: string | null) {
            this.reflect('widget-id', value);
        }


        public get identityToken(): string | null {
            return this.getAttribute('identity-token');
        }


        public set identityToken(value: string | null) {
            this.reflect('identity-token', value);
        }


        public get locale(): string | null {
            return this.getAttribute('locale');
        }


        public set locale(value: string | null) {
            this.reflect('locale', value);
        }


        public connectedCallback(): void {
            this.style.display = 'none';
            const options = optionsOf(this);
            if (!options || this.started) {
                return;
            }
            this.started = true;
            void loadWebchat(options);
        }


        public attributeChangedCallback(name: string, previous: string | null, value: string | null): void {
            if (!this.started || previous === value) {
                return;
            }
            if (name === 'identity-token') {
                if (value) {
                    client.identify(value);
                } else {
                    client.shutdown();
                }
            } else if (value === 'id' || value === 'en') {
                client.setLocale(value);
            }
        }


        /** Properti → atribut (null/undefined/'' = atribut dihapus), lalu `attributeChangedCallback` yang bekerja. */
        private reflect(name: string, value: string | null | undefined): void {
            if (value === null || value === undefined || value === '') {
                this.removeAttribute(name);
            } else {
                this.setAttribute(name, value);
            }
        }
    }

    customElements.define(ELEMENT_NAME, PlasgosWebchatElement);
}

defineWebchatElement();
