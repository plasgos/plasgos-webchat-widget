// Aplikasi Vue 3 + Vue Router (fungsi render, tanpa compiler SFC) dengan @plasgos/webchat-vue: navigasi dilaporkan
// dari router.afterEach; tombol bantuan membuka chat lewat composable.
import { createApp, h } from 'vue';
import { createRouter, createWebHistory, RouterLink, RouterView } from 'vue-router';
import { PlasgosWebchatPlugin, usePlasgosWebchat } from '@plasgos/webchat-vue';

const Home = { render: () => h('h2', 'Beranda') };
const Product = { render: () => h('h2', 'Produk') };
const router = createRouter({
    history: createWebHistory('/fixtures/vue3-router/'),
    routes: [{ path: '/', component: Home }, { path: '/produk', component: Product }],
});
router.afterEach((to) => {
    document.title = to.path === '/produk' ? 'Vue — produk' : 'Vue — beranda';
});

const App = {
    setup() {
        const webchat = usePlasgosWebchat();
        return () => h('main', [
            h('h1', 'Toko Vue'),
            h(RouterLink, { to: '/produk', id: 'ke-produk' }, () => 'Lihat produk'),
            h('button', { id: 'bantuan', type: 'button', onClick: () => webchat.open() }, `Butuh bantuan? (${webchat.state.value.unread})`),
            h(RouterView),
        ]);
    },
};

createApp(App)
    .use(router)
    .use(PlasgosWebchatPlugin, {
        widgetId: 'wgt_0123456789abcdef01234567',
        loaderUrl: '/packages/loader/dist/loader.js',
        widgetOrigin: 'http://127.0.0.1:4400',
        load: 'eager',
        router,
    })
    .mount('#app');
