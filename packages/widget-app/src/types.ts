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

/**
 * Saat tim tidak `open` (W5b): `form` = tinggalkan pesan + email; `hidden` = launcher disembunyikan bagi pengunjung
 * tanpa percakapan; `ai` = AI melayani (W6a — sampai itu diperlakukan `form`).
 */
export interface OfflineSettings {
    readonly mode: 'form' | 'ai' | 'hidden';
    /** Teks tenant untuk keadaan offline; null = teks bawaan widget. */
    readonly message: string | null;
}

/** Jam kerja saat konfigurasi dibaca (W5b). `next_open_at` hanya bila sedang tutup. */
export interface BusinessHours {
    readonly source: 'chatroom_setting' | 'custom';
    readonly open: boolean;
    readonly next_open_at: string | null;
    readonly timezone: string | null;
    readonly always_open: boolean;
}

export type AvailabilityStatus = 'open' | 'away' | 'closed';

export interface Availability {
    readonly status: AvailabilityStatus;
    /** Target balasan pertama kebijakan SLA (menit); hanya saat `open`. */
    readonly reply_estimate_minutes: number | null;
}

export interface WidgetConfig {
    readonly widget_id: string;
    readonly appearance: Appearance;
    readonly identity?: IdentitySettings;
    readonly prechat?: PrechatSettings;
    readonly privacy?: PrivacySettings;
    /** Status tim saat konfigurasi dibaca (W5a); perubahan berikutnya lewat socket `team.presence`. */
    readonly team?: { readonly online: boolean | null } | null;
    readonly offline?: OfflineSettings;
    /** Server lama tak mengirimnya → dianggap selalu buka. */
    readonly business_hours?: BusinessHours | null;
    readonly availability?: Availability | null;
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
    /** Alamat balasan pengunjung sudah diketahui (W5b) — formulir offline tak menanyakan email lagi. */
    readonly email_on_file?: boolean;
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

/**
 * Penanda pesan survei kepuasan (W5c): `rating` = pesan survei (widget menampilkan tombol skor), `comment_prompt` =
 * permintaan komentar setelah skor rendah, `thanks` = ucapan terima kasih. Pesan lain `null`.
 */
export type SurveyMarker =
    | { readonly kind: 'rating'; readonly scale: 3 | 5 }
    | { readonly kind: 'comment_prompt' }
    | { readonly kind: 'thanks' };

/** Survei terakhir percakapan (bentuk `survey` di `GET /conversation` & socket `csat.updated`). */
export interface CustomerSurvey {
    readonly status: 'sent' | 'answered' | 'expired';
    readonly scale: number;
    readonly score: number | null;
    readonly satisfied: boolean | null;
    readonly comment: string | null;
    readonly comment_allowed: boolean;
    readonly sent_at: string | null;
    readonly expires_at: string | null;
    readonly answered_at: string | null;
}

/** `open` | `resolved` — tim menandai urusan pengunjung selesai (W5c). */
export type ConversationStatus = 'open' | 'resolved';

export interface ConversationRef {
    readonly id: string;
    /** Server lama tak mengirimnya → dianggap `open`. */
    readonly status?: ConversationStatus;
    readonly resolved_at?: string | null;
}

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
    /** W5c; server lama tak mengirimnya. */
    readonly survey?: SurveyMarker | null;
}

export interface SendResult {
    readonly message_id: string;
    readonly client_message_id: string;
    readonly status: string;
    readonly duplicate: boolean;
}

/** `POST /offline-messages` (W5b): pesan diterima seperti pesan biasa + alamat balasan tersimpan. */
export interface OfflineMessageResult extends SendResult {
    readonly email_on_file: boolean;
}

export interface ConversationPage {
    readonly conversation: ConversationRef | null;
    /** W5c; server lama tak mengirimnya. */
    readonly survey?: CustomerSurvey | null;
    readonly messages: readonly ChatMessage[];
}

export interface TranscriptResult {
    readonly sent: boolean;
    readonly email_on_file: boolean;
}

export interface PageInfo {
    readonly url: string;
    readonly title: string;
}
