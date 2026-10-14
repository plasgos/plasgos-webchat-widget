/** Jeda sebelum melapor: router SPA umumnya memperbarui `document.title` sesaat SETELAH URL berubah. */
const SETTLE_MS = 250;

const WRAPPED = '__plasgosWebchatWrapped';

type HistoryMethod = 'pushState' | 'replaceState';
type Wrappable = History[HistoryMethod] & { [WRAPPED]?: true };
type NavigationLike = { addEventListener: EventTarget['addEventListener']; removeEventListener: EventTarget['removeEventListener'] };

function navigationApiOf(win: Window): NavigationLike | null {
    const candidate: unknown = (win as Window & { navigation?: unknown }).navigation;
    if (typeof candidate !== 'object' || candidate === null) {
        return null;
    }

    return typeof (candidate as Partial<NavigationLike>).addEventListener === 'function' ? candidate as NavigationLike : null;
}

/**
 * Laporkan navigasi SPA (React Router, Next, Vue Router, Angular Router, SvelteKit, Astro, …) tanpa reload:
 * Navigation API bila ada; selain itu `history.pushState/replaceState` dibungkus BERANTAI (fungsi asli tetap
 * dipanggil, pembungkus lain tetap bekerja) + `popstate` + `hashchange`. Hanya URL yang benar-benar berubah
 * yang dilaporkan. Mengembalikan fungsi berhenti.
 */
export function watchNavigation(win: Window, onChange: () => void): () => void {
    let lastHref = win.location.href;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            const href = win.location.href;
            if (active && href !== lastHref) {
                lastHref = href;
                onChange();
            }
        }, SETTLE_MS);
    };

    const navigation = navigationApiOf(win);
    if (navigation) {
        navigation.addEventListener('navigatesuccess', check);
    } else {
        for (const method of ['pushState', 'replaceState'] as const) {
            wrapHistory(win.history, method, () => {
                if (active) {
                    check();
                }
            });
        }
    }
    win.addEventListener('popstate', check);
    win.addEventListener('hashchange', check);

    return () => {
        active = false;
        if (timer !== null) {
            clearTimeout(timer);
        }
        navigation?.removeEventListener('navigatesuccess', check);
        win.removeEventListener('popstate', check);
        win.removeEventListener('hashchange', check);
        // Pembungkus history TIDAK dilepas: pustaka lain bisa sudah membungkus di atasnya; `active` mematikannya.
    };
}

function wrapHistory(history: History, method: HistoryMethod, after: () => void): void {
    // Diambil sebagai fungsi lepas untuk dibungkus berantai; dipanggil kembali dengan `this` = history.
    const original = Reflect.get(history, method) as Wrappable;
    if (original[WRAPPED]) {
        return;
    }

    const wrapped: Wrappable = function (this: History, ...args: Parameters<History[HistoryMethod]>): void {
        original.apply(this, args);
        after();
    };
    wrapped[WRAPPED] = true;
    history[method] = wrapped;
}
