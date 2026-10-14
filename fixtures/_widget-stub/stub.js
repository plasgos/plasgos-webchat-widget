// STUB aplikasi widget — HANYA untuk uji loader (W3b) sampai aplikasi widget asli (W3c) ada. Dilayani di
// `/w/:widget_id` dari origin lain dengan halaman fixture. Menjalankan sisi iframe protokol v1 & mencatat pesan
// yang diterimanya di `window.__received` (dibaca Playwright).
//   wgt_000000000000000000000000 → tak pernah mengirim widget.ready (meniru ditolak frame-ancestors)
(function () {
    var widgetId = location.pathname.split('/').pop();
    var parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || new URL(document.referrer).origin;
    var viewport = { width: 1280, height: 800 };
    var open = false;
    window.__received = [];

    function send(type, payload) {
        window.parent.postMessage({ v: 1, type: type, payload: payload }, parentOrigin);
    }
    function layout() {
        var mobile = viewport.width < 640;
        send('widget.frame', open
            ? { state: 'open', width: 380, height: 600, fullscreen: mobile, position: 'right', offsetX: 20, offsetY: 20, zIndex: null }
            : { state: 'launcher', width: 72, height: 72, fullscreen: false, position: 'right', offsetX: 20, offsetY: 20, zIndex: null });
        send('widget.state', { booted: true, open: open, unread: 0, trustLevel: 'anonymous' });
        send('widget.event', { name: open ? 'open' : 'close', data: {} });
    }

    window.addEventListener('message', function (event) {
        if (event.origin !== parentOrigin || event.source !== window.parent) return;
        var message = event.data;
        if (!message || message.v !== 1) return;
        window.__received.push(message);
        if (message.type === 'host.init') { send('widget.event', { name: 'ready', data: {} }); layout(); }
        if (message.type === 'host.viewport') { viewport = message.payload; layout(); }
        if (message.type === 'host.command') {
            var name = message.payload.name;
            if (name === 'open') open = true;
            if (name === 'close') open = false;
            if (name === 'toggle') open = !open;
            if (name === 'open' || name === 'close' || name === 'toggle') layout();
        }
    });

    // Tombol tutup DI DALAM iframe — seperti widget asli: pengunjung menutup chat dari jendela chat (aktivasi
    // pengguna diteruskan ke halaman induk, syarat peramban untuk memindahkan fokus kembali ke pemicu).
    var closeButton = document.createElement('button');
    closeButton.id = 'tutup';
    closeButton.type = 'button';
    closeButton.textContent = 'Tutup';
    closeButton.addEventListener('click', function () { open = false; layout(); });
    document.body.appendChild(closeButton);

    if (widgetId !== 'wgt_000000000000000000000000') send('widget.ready', {});
})();
