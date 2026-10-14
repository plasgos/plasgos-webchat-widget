/**
 * Kontrak postMessage v1 antara LOADER (berjalan di halaman website tenant) dan APLIKASI WIDGET (iframe dari origin
 * Plasgos). Aturan yang dijaga di sini (WEBCHAT_EMBED_COMPATIBILITY.md §5):
 *
 *   - Bentuk pesan selalu `{ v: 1, type, payload }`; versi lain & tipe tak dikenal DIABAIKAN, bukan dilempar —
 *     loader lama dan aplikasi widget baru (atau sebaliknya) tetap hidup berdampingan.
 *   - Pesan masuk hanya dipercaya bila `event.origin` DAN `event.source` sama dengan lawan bicara yang diharapkan.
 *   - Token sesi pengunjung TIDAK PERNAH lewat postMessage; tak ada tipe pesan yang membawanya.
 */

export const PROTOCOL_VERSION = 1;

/** Perintah publik `Plasgos(name, ...)` yang diteruskan loader ke iframe. */
export const HOST_COMMANDS = [
    'open',
    'close',
    'toggle',
    'identify',
    'shutdown',
    'page',
    'track',
    'consent',
    'setLocale',
] as const;

export type HostCommand = (typeof HOST_COMMANDS)[number];

/** Event publik yang bisa didengar tenant lewat `Plasgos('on', name, handler)`. */
export const WIDGET_EVENTS = [
    'ready',
    'open',
    'close',
    'message',
    'unread_changed',
    'conversation_started',
    'lead_captured',
    'error',
] as const;

export type WidgetEventName = (typeof WIDGET_EVENTS)[number];

/** Keadaan tampilan iframe yang diminta aplikasi widget; loader yang mengatur ukuran & posisi elemen iframe. */
export const FRAME_STATES = ['hidden', 'launcher', 'open'] as const;

export type FrameState = (typeof FRAME_STATES)[number];

export interface PageInfo {
    readonly url: string;
    readonly title: string;
    readonly referrer: string;
}

export interface BootOptions {
    readonly widgetId: string;
    readonly locale?: 'id' | 'en';
    readonly hideLauncher?: boolean;
    readonly consentRequired?: boolean;
}

/** Pesan halaman tenant → iframe. */
export interface HostMessages {
    'host.init': { readonly options: BootOptions; readonly page: PageInfo; readonly hostOrigin: string };
    'host.command': { readonly name: HostCommand; readonly args: readonly unknown[] };
    'host.viewport': { readonly width: number; readonly height: number };
}

/** Pesan iframe → halaman tenant. */
export interface WidgetMessages {
    'widget.ready': Record<string, never>;
    'widget.frame': { readonly state: FrameState; readonly width: number; readonly height: number; readonly fullscreen: boolean };
    'widget.event': { readonly name: WidgetEventName; readonly data: unknown };
    'widget.state': { readonly booted: boolean; readonly open: boolean; readonly unread: number; readonly trustLevel: string | null };
}

export type HostMessageType = keyof HostMessages;
export type WidgetMessageType = keyof WidgetMessages;
type AllMessages = HostMessages & WidgetMessages;
export type MessageType = keyof AllMessages;

export interface ProtocolMessage<T extends MessageType = MessageType> {
    readonly v: typeof PROTOCOL_VERSION;
    readonly type: T;
    readonly payload: AllMessages[T];
}

const HOST_MESSAGE_TYPES: readonly HostMessageType[] = ['host.init', 'host.command', 'host.viewport'];
const WIDGET_MESSAGE_TYPES: readonly WidgetMessageType[] = ['widget.ready', 'widget.frame', 'widget.event', 'widget.state'];

export function createMessage<T extends MessageType>(type: T, payload: AllMessages[T]): ProtocolMessage<T> {
    return { v: PROTOCOL_VERSION, type, payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseWith<T extends MessageType>(data: unknown, allowed: readonly T[]): ProtocolMessage<T> | null {
    if (!isRecord(data) || data['v'] !== PROTOCOL_VERSION || !isRecord(data['payload'])) {
        return null;
    }

    const type = data['type'];
    if (typeof type !== 'string' || !(allowed as readonly string[]).includes(type)) {
        return null;
    }

    return data as unknown as ProtocolMessage<T>;
}

/** Pesan dari halaman tenant yang dikenali iframe, atau null (diabaikan). */
export function parseHostMessage(data: unknown): ProtocolMessage<HostMessageType> | null {
    return parseWith(data, HOST_MESSAGE_TYPES);
}

/** Pesan dari iframe yang dikenali loader, atau null (diabaikan). */
export function parseWidgetMessage(data: unknown): ProtocolMessage<WidgetMessageType> | null {
    return parseWith(data, WIDGET_MESSAGE_TYPES);
}

export interface TrustedPeer {
    readonly origin: string;
    readonly source: unknown;
}

/** Event postMessage berasal dari lawan bicara yang diharapkan: origin DAN jendela pengirim sama. */
export function isFromPeer(event: Pick<MessageEvent, 'origin' | 'source'>, peer: TrustedPeer): boolean {
    return event.origin === peer.origin && event.source === peer.source;
}

export function isHostCommand(value: unknown): value is HostCommand {
    return typeof value === 'string' && (HOST_COMMANDS as readonly string[]).includes(value);
}
