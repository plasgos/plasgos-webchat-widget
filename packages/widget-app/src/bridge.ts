import { isFromPeer, parseHostMessage, PROTOCOL_VERSION } from '@plasgos/webchat-protocol';
import type { FrameLayout, HostMessages, WidgetEventName, WidgetMessages } from '@plasgos/webchat-protocol';

export interface BridgeHandlers {
    readonly onInit: (payload: HostMessages['host.init']) => void;
    readonly onCommand: (payload: HostMessages['host.command']) => void;
    readonly onViewport: (payload: HostMessages['host.viewport']) => void;
    /** Sinyal halaman untuk pemicu proaktif (W8b); loader lama tak mengirimnya. */
    readonly onActivity?: (payload: HostMessages['host.activity']) => void;
}

/**
 * Origin website induk. Hanya website yang lolos `frame-ancestors` dokumen ini yang bisa menyematkannya, jadi
 * nilai ini tepercaya untuk `targetOrigin` — bukan untuk otorisasi (token pengunjung yang mengotorisasi).
 */
export function parentOriginOf(win: Window, doc: Document): string | null {
    const ancestors = win.location.ancestorOrigins as DOMStringList | undefined;
    if (ancestors && ancestors.length > 0) {
        return ancestors.item(0);
    }

    try {
        return doc.referrer ? new URL(doc.referrer).origin : null;
    } catch {
        return null;
    }
}

/** Saluran postMessage ke loader: keluar selalu dengan `targetOrigin` eksplisit, masuk dicek origin + jendela. */
export class HostBridge {
    private readonly onMessage = (event: MessageEvent): void => {
        if (!isFromPeer(event, { origin: this.parentOrigin, source: this.win.parent })) {
            return;
        }

        const message = parseHostMessage(event.data);
        if (!message) {
            return;
        }

        switch (message.type) {
            case 'host.init':
                this.handlers.onInit(message.payload as HostMessages['host.init']);
                break;
            case 'host.command':
                this.handlers.onCommand(message.payload as HostMessages['host.command']);
                break;
            case 'host.viewport':
                this.handlers.onViewport(message.payload as HostMessages['host.viewport']);
                break;
            case 'host.activity':
                this.handlers.onActivity?.(message.payload as HostMessages['host.activity']);
                break;
        }
    };


    public constructor(
        private readonly win: Window,
        private readonly parentOrigin: string,
        private readonly handlers: BridgeHandlers,
    ) {}


    public start(): void {
        this.win.addEventListener('message', this.onMessage);
        this.send('widget.ready', {});
    }


    public frame(layout: FrameLayout): void {
        this.send('widget.frame', layout);
    }


    public state(state: WidgetMessages['widget.state']): void {
        this.send('widget.state', state);
    }


    public event(name: WidgetEventName, data: unknown = {}): void {
        this.send('widget.event', { name, data });
    }


    private send<T extends keyof WidgetMessages>(type: T, payload: WidgetMessages[T]): void {
        this.win.parent.postMessage({ v: PROTOCOL_VERSION, type, payload }, this.parentOrigin);
    }
}
