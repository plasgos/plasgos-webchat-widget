<!-- Widget sekali di layout akar; navigasi dari `page.url.pathname` ($app/state). -->
<script lang="ts">
    import type { Snippet } from 'svelte';
    import { page } from '$app/state';
    import { PlasgosWebchat } from '@plasgos/webchat-svelte';

    const { children }: { children: Snippet } = $props();
</script>

{@render children()}

<PlasgosWebchat
    widgetId="wgt_0123456789abcdef01234567"
    loaderUrl="http://localhost:4400/packages/loader/dist/loader.js"
    widgetOrigin="http://127.0.0.1:4400"
    load="eager"
    pathname={page.url.pathname}
/>
