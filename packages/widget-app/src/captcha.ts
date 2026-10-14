/**
 * CAPTCHA adaptif Cloudflare Turnstile — dimuat HANYA saat server menjawab `captcha_required` (pengunjung normal tak
 * pernah memuat skrip pihak ketiga). Dokumen iframe api-crm mengizinkan skrip & frame `challenges.cloudflare.com`
 * bila `WEBCHAT_TURNSTILE_SITE_KEY` terpasang.
 */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
    render(container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        'error-callback'?: () => void;
        'expired-callback'?: () => void;
    }): string;
    remove(widgetId: string): void;
}

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(win: TurnstileWindow): Promise<TurnstileApi> {
    if (win.turnstile) {
        return Promise.resolve(win.turnstile);
    }

    loading ??= new Promise<TurnstileApi>((resolve, reject) => {
        const script = win.document.createElement('script');
        script.src = SCRIPT_URL;
        script.async = true;
        script.addEventListener('load', () => {
            if (win.turnstile) {
                resolve(win.turnstile);
            } else {
                reject(new Error('turnstile tak tersedia'));
            }
        });
        script.addEventListener('error', () => {
            loading = null;
            reject(new Error('skrip turnstile gagal dimuat'));
        });
        win.document.head.appendChild(script);
    });
    return loading;
}

/** Tampilkan tantangan; `onToken` dipanggil dengan token sekali pakai untuk `captcha_token` boot sesi. */
export async function showCaptcha(
    win: Window,
    container: HTMLElement,
    siteKey: string,
    onToken: (token: string) => void,
): Promise<void> {
    const api = await loadTurnstile(win);
    container.replaceChildren();
    const widgetId = api.render(container, {
        sitekey: siteKey,
        callback: (token) => {
            api.remove(widgetId);
            onToken(token);
        },
    });
}
