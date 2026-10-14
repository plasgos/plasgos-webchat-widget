<!-- Aplikasi Svelte 5 dengan @plasgos/webchat-svelte: navigasi dilaporkan lewat prop pathname, tombol bantuan &
     lencana belum dibaca lewat webchat & $webchatState. -->
<script>
    import { PlasgosWebchat, webchat, webchatState } from '@plasgos/webchat-svelte';

    let pathname = $state(window.location.pathname);

    function goToProduct() {
        history.pushState({}, '', '/fixtures/svelte5/produk');
        document.title = 'Svelte — produk';
        pathname = window.location.pathname;
    }
</script>

<main>
    <h1>Toko Svelte</h1>
    <button id="ke-produk" type="button" onclick={goToProduct}>Lihat produk</button>
    <button id="bantuan" type="button" onclick={() => webchat.open()}>Butuh bantuan? ({$webchatState.unread})</button>
    <PlasgosWebchat
        widgetId="wgt_0123456789abcdef01234567"
        loaderUrl="/packages/loader/dist/loader.js"
        widgetOrigin="http://127.0.0.1:4400"
        load="eager"
        {pathname} />
</main>
