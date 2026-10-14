/**
 * `@plasgos/webchat-react` — pola React untuk widget webchat (WEBCHAT_EMBED_COMPATIBILITY.md §6.2–6.4).
 *
 *   <PlasgosWebchat widgetId="wgt_…" identityToken={session?.webchatToken} pathname={pathname} />
 *   const webchat = usePlasgosWebchat(); webchat.open();
 *
 * Komponen tak merender DOM apa pun (widget = iframe yang dipasang loader). Boot idempoten → aman di React
 * StrictMode & HMR. Aman SSR (Next/Remix/Gatsby): efek hanya berjalan di peramban, paket inti no-op di server.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { getWebchat, loadWebchat } from '@plasgos/webchat';
import type { WebchatClient, WebchatOptions, WebchatState } from '@plasgos/webchat';

export type { WebchatClient, WebchatOptions, WebchatState } from '@plasgos/webchat';

export interface PlasgosWebchatProps extends WebchatOptions {
    /**
     * Path halaman saat ini (Next `usePathname()`, React Router `useLocation().pathname`) — dilaporkan sebagai
     * navigasi bila berubah. Opsional: loader juga mendeteksi navigasi SPA sendiri.
     */
    /** `null` diterima (Next `usePathname()` bertipe `string | null`) dan diperlakukan seperti tidak diberikan. */
    readonly pathname?: string | null;
}

const EMPTY_STATE: WebchatState = { booted: false, open: false, unread: 0, trustLevel: null };
const STATE_EVENTS = ['ready', 'open', 'close', 'unread_changed', 'error'] as const;

/** Nyalakan widget. Logout (identityToken dari ada → tak ada) = shutdown lalu sesi anonim baru. */
export function PlasgosWebchat(props: PlasgosWebchatProps): null {
    const { identityToken, pathname: rawPathname, ...widget } = props;
    const pathname = rawPathname ?? undefined;
    // `pathname` = aplikasi yang melaporkan navigasi → deteksi otomatis loader dimatikan (tanpa laporan ganda).
    const options: WebchatOptions = pathname === undefined ? widget : { autoPageTracking: false, ...widget };
    const optionsKey = JSON.stringify(options);
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const previousToken = useRef<string | undefined>(undefined);
    const previousPath = useRef<string | undefined>(pathname);

    useEffect(() => {
        void loadWebchat(optionsRef.current);
    }, [optionsKey]);

    useEffect(() => {
        const client = getWebchat();
        if (identityToken && identityToken !== previousToken.current) {
            client.identify(identityToken);
        } else if (!identityToken && previousToken.current) {
            client.shutdown();
            void loadWebchat(optionsRef.current);
        }
        previousToken.current = identityToken;
    }, [identityToken]);

    useEffect(() => {
        if (pathname !== undefined && pathname !== previousPath.current) {
            getWebchat().page({ url: window.location.href, title: document.title });
        }
        previousPath.current = pathname;
    }, [pathname]);

    return null;
}

let snapshot: WebchatState = EMPTY_STATE;

function readState(): WebchatState {
    const next = getWebchat().getState();
    // Objek yang sama selama isinya sama — syarat useSyncExternalStore (tanpa render berulang tanpa akhir).
    const changed = next.booted !== snapshot.booted
        || next.open !== snapshot.open
        || next.unread !== snapshot.unread
        || next.trustLevel !== snapshot.trustLevel;
    if (changed) {
        snapshot = { ...next };
    }
    return snapshot;
}

function subscribe(onChange: () => void): () => void {
    const client = getWebchat();
    const stops = STATE_EVENTS.map((event) => client.on(event, onChange));
    return () => {
        for (const stop of stops) {
            stop();
        }
    };
}

/** Klien widget + keadaannya (terbuka, belum dibaca, …) yang memicu render ulang saat berubah. */
export function usePlasgosWebchat(): WebchatClient & { readonly state: WebchatState } {
    const state = useSyncExternalStore(subscribe, readState, () => EMPTY_STATE);
    return { ...getWebchat(), state };
}
