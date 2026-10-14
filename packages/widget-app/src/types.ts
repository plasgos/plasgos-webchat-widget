/** Bentuk data API publik `/webchat/v1` (api-crm `modules/webchat/http/public.*`) yang dipakai aplikasi widget. */

export type Locale = 'id' | 'en';

export interface Appearance {
    readonly theme?: 'light' | 'dark' | 'auto';
    readonly primary_color?: string;
    readonly position?: 'left' | 'right';
    readonly offset?: { readonly x: number; readonly y: number };
    readonly launcher_label?: string | null;
    readonly logo_url?: string | null;
    readonly team_title?: string | null;
    readonly greeting?: string | null;
    readonly locale_default?: Locale;
    readonly hide_launcher?: boolean;
    readonly z_index?: number;
}

export type PrechatFieldType = 'text' | 'email' | 'phone' | 'select' | 'consent';

export interface PrechatField {
    readonly key: string;
    readonly type: PrechatFieldType;
    readonly label: string;
    readonly required: boolean;
    readonly options?: readonly { readonly value: string; readonly label: string }[];
}

/** Formulir perkenalan sebelum chat (W4b). `off` = tanpa formulir; `optional` = bisa dilewati. */
export interface PrechatSettings {
    readonly mode: 'off' | 'optional' | 'required';
    readonly fields: readonly PrechatField[];
}

export interface PrivacySettings {
    readonly consent_text: string | null;
    readonly consent_version: string | null;
}

/** `required` = pengunjung wajib terverifikasi (identity token dari website) sebelum bisa mengirim pesan. */
export interface IdentitySettings {
    readonly verification: 'off' | 'optional' | 'required';
    /** Pengunjung boleh membuktikan email lewat kode sekali pakai (W4c). */
    readonly otp_email?: boolean;
}

export interface WidgetConfig {
    readonly widget_id: string;
    readonly appearance: Appearance;
    readonly identity?: IdentitySettings;
    readonly prechat?: PrechatSettings;
    readonly privacy?: PrivacySettings;
    readonly captcha: { readonly mode: string; readonly provider: 'turnstile' | null; readonly site_key: string | null };
}

export interface Session {
    readonly access_token: string;
    readonly expires_in: number;
    readonly refresh_token: string;
    readonly visitor_id: string;
    readonly trust_level: string;
    readonly conversation: { readonly id: string } | null;
    /** Formulir pre-chat sudah dikirim pengunjung ini (W4b). Server lama tak mengirimnya → dianggap belum. */
    readonly prechat_completed?: boolean;
}

export interface OtpRequestResult {
    readonly sent: boolean;
    readonly expires_in: number;
}

export interface PrechatResult {
    readonly trust_level: string;
    readonly prechat_completed: boolean;
}

export type MessageStatus = 'pending' | 'failed' | 'accepted' | 'sent' | 'delivered' | 'read' | 'unread';

export interface ChatMessage {
    readonly id: string | null;
    readonly client_message_id: string | null;
    readonly direction: 'inbound' | 'outbound';
    readonly sender: { readonly kind: string; readonly name: string | null };
    readonly type: string;
    readonly text: string | null;
    /** Nilai `MessageStatus`; server bisa menambah status baru — disimpan apa adanya. */
    readonly status: string | null;
    readonly timestamp: string;
}

export interface SendResult {
    readonly message_id: string;
    readonly client_message_id: string;
    readonly status: string;
    readonly duplicate: boolean;
}

export interface ConversationPage {
    readonly conversation: { readonly id: string } | null;
    readonly messages: readonly ChatMessage[];
}

export interface PageInfo {
    readonly url: string;
    readonly title: string;
}
