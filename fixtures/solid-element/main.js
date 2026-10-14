// Aplikasi Solid (tanpa compiler — solid-js/html) yang merender <plasgos-webchat>; login/logout mengubah atribut
// identity-token seperti aplikasi tenant sungguhan.
import '@plasgos/webchat/element';
import { createSignal } from 'solid-js';
import html from 'solid-js/html';
import { render } from 'solid-js/web';

function App() {
    const [token, setToken] = createSignal(undefined);
    return html`<main>
        <h1>Toko Solid</h1>
        <button id="login" type="button" onClick=${() => setToken('jwt-pelanggan-solid')}>Masuk</button>
        <button id="logout" type="button" onClick=${() => setToken(undefined)}>Keluar</button>
        <plasgos-webchat
            widget-id="wgt_0123456789abcdef01234567"
            loader-url="/packages/loader/dist/loader.js"
            widget-origin="http://127.0.0.1:4400"
            load="eager"
            identity-token=${token}></plasgos-webchat>
    </main>`;
}

render(App, document.getElementById('app'));
