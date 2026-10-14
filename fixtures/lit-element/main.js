// Aplikasi Lit yang merender <plasgos-webchat>; properti `token` → atribut identity-token (ifDefined menghapusnya).
import '@plasgos/webchat/element';
import { html, LitElement } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

class TokoLit extends LitElement {
    static properties = { token: { state: true } };

    createRenderRoot() {
        return this;
    }

    render() {
        return html`<main>
            <h1>Toko Lit</h1>
            <button id="login" type="button" @click=${() => { this.token = 'jwt-pelanggan-lit'; }}>Masuk</button>
            <button id="logout" type="button" @click=${() => { this.token = undefined; }}>Keluar</button>
            <plasgos-webchat
                widget-id="wgt_0123456789abcdef01234567"
                loader-url="/packages/loader/dist/loader.js"
                widget-origin="http://127.0.0.1:4400"
                load="eager"
                identity-token=${ifDefined(this.token)}></plasgos-webchat>
        </main>`;
    }
}

customElements.define('toko-lit', TokoLit);
