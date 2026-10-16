<!--
  `<PlasgosWebchat>` — widget webchat Plasgos CRM untuk Svelte 5 / SvelteKit (WEBCHAT_EMBED_COMPATIBILITY.md §6.8).
  Tak merender DOM (widget = iframe yang dipasang loader). Aman SSR: efek hanya berjalan di peramban.

    <PlasgosWebchat widgetId="wgt_…" identityToken={data.webchatToken} pathname={page.url.pathname} />

  identityToken diisi = identify; dikosongkan (logout) = shutdown lalu sesi anonim baru. pathname berubah = navigasi
  dilaporkan (SvelteKit: `page` dari `$app/state`); dengan pathname, deteksi otomatis loader dimatikan.
-->
<script lang="ts">
    import { untrack } from 'svelte';

    import { getWebchat, loadWebchat } from '@plasgos/webchat';
    import type { WebchatOptions } from '@plasgos/webchat';

    /** `undefined` eksplisit diterima: di template, `identityToken={sesi?.token}` adalah pola yang umum. */
    interface Props extends Omit<WebchatOptions, 'identityToken'> {
        /** `null` = tak ada yang login (halaman pertama setelah logout lewat redirect). */
        readonly identityToken?: string | null | undefined;
        readonly pathname?: string | null | undefined;
    }

    const { identityToken, pathname: rawPathname, ...widget }: Props = $props();
    const pathname = $derived(rawPathname ?? undefined);

    let previousToken: string | null | undefined = undefined;
    // Nilai AWAL sengaja (pembanding navigasi berikutnya).
    let previousPath: string | undefined = untrack(() => pathname);

    /** Opsi boot — hanya bergantung pada opsi widget; `pathname` dibaca tanpa dilacak (navigasi ≠ boot ulang). */
    function bootOptions(): WebchatOptions {
        const options: WebchatOptions = { ...widget };
        return untrack(() => pathname) === undefined ? options : { autoPageTracking: false, ...options };
    }

    $effect(() => {
        void loadWebchat(bootOptions());
    });

    $effect(() => {
        const token = identityToken;
        const client = getWebchat();
        if (token && token !== previousToken) {
            client.identify(token);
        } else if (!token && previousToken) {
            client.shutdown();
            void loadWebchat(bootOptions());
        } else if (token === null && previousToken === undefined) {
            // Halaman pertama tanpa pengguna (logout lewat redirect/SSR): sesi hasil login sebelumnya diakhiri.
            client.identify(null);
        }
        previousToken = token;
    });

    $effect(() => {
        const path = pathname;
        if (path !== undefined && path !== previousPath) {
            getWebchat().page({ url: window.location.href, title: document.title });
        }
        previousPath = path;
    });
</script>
