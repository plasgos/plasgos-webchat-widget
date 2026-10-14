import type { ChatMessage } from './types';

/** Pesan antar-tab pengunjung yang sama (BroadcastChannel per widget). Tiap tab punya socket sendiri. */
export type TabMessage =
    | { readonly type: 'session'; readonly accessToken: string; readonly expiresAt: number }
    | { readonly type: 'sent'; readonly message: ChatMessage }
    | { readonly type: 'read' }
    | { readonly type: 'shutdown' };

export interface TabChannel {
    post(message: TabMessage): void;
    onMessage(handler: (message: TabMessage) => void): void;
    close(): void;
}

/** Peramban tanpa BroadcastChannel: tab tetap berjalan sendiri-sendiri (tanpa sinkron), tak pernah galat. */
export function createTabChannel(win: Window, widgetId: string): TabChannel {
    const Channel = (win as Window & { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    if (typeof Channel !== 'function') {
        return { post: () => undefined, onMessage: () => undefined, close: () => undefined };
    }

    const channel = new Channel(`plasgos-webchat:${widgetId}`);
    return {
        post: (message) => {
            channel.postMessage(message);
        },
        onMessage: (handler) => {
            channel.addEventListener('message', (event: MessageEvent<TabMessage>) => {
                handler(event.data);
            });
        },
        close: () => {
            channel.close();
        },
    };
}
