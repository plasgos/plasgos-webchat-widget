/**
 * Pemicu pesan proaktif (W8b) — widget hanya menentukan KAPAN meminta tampil; server yang memutuskan BOLEH atau
 * tidak (syarat aturan, satu pesan per 24 jam, percakapan terbuka) lewat `POST /webchat/v1/proactive`.
 *
 * Pemicu per aturan, dinilai ulang setiap halaman (navigasi SPA = halaman baru):
 *   - `page_load`     : halaman dibuka;
 *   - `time_on_page`  : `seconds` detik di halaman ini (penghitung diulang tiap halaman);
 *   - `scroll_depth`  : gulir ≥ `percent` % (sinyal loader, kelipatan 10);
 *   - `exit_intent`   : kursor keluar lewat tepi atas (desktop, sinyal loader);
 *   - `event`         : `Plasgos('track', event)`.
 * Satu aturan diminta paling banyak sekali per halaman. Begitu satu pesan tampil — atau pengunjung sudah bercakap —
 * mesin berhenti meminta (server tetap penjaga terakhir).
 */

export type ProactiveTrigger =
    | { readonly type: 'page_load' }
    | { readonly type: 'time_on_page'; readonly seconds: number }
    | { readonly type: 'scroll_depth'; readonly percent: number }
    | { readonly type: 'exit_intent' }
    | { readonly type: 'event'; readonly event: string };

export interface ProactiveRule {
    readonly rule_id: string;
    readonly trigger: ProactiveTrigger;
}

export interface ProactiveEngineOptions {
    /** Minta tampil untuk aturan ini. `true` = pesan tampil (mesin berhenti). */
    readonly claim: (ruleId: string) => Promise<boolean>;
    readonly schedule?: (callback: () => void, ms: number) => unknown;
    readonly cancel?: (handle: unknown) => void;
}

export class ProactiveEngine {
    private rules: readonly ProactiveRule[] = [];
    private requested = new Set<string>();
    private timers: unknown[] = [];
    private active = false;
    private done = false;
    private inFlight = false;
    private readonly schedule: (callback: () => void, ms: number) => unknown;
    private readonly cancel: (handle: unknown) => void;


    public constructor(private readonly options: ProactiveEngineOptions) {
        this.schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
        this.cancel = options.cancel ?? ((handle) => {
            clearTimeout(handle as ReturnType<typeof setTimeout>);
        });
    }


    /** Aturan dari konfigurasi publik (hanya pemicu). Diganti saat konfigurasi dibaca ulang. */
    public setRules(rules: readonly ProactiveRule[]): void {
        this.rules = rules.filter(isRule);
        if (this.active) {
            this.page();
        }
    }


    /** Sesi siap & pengunjung belum bercakap → mulai menilai pemicu halaman ini. */
    public start(): void {
        if (this.active || this.done) {
            return;
        }
        this.active = true;
        this.page();
    }


    /** Berhenti selamanya (pesan sudah tampil / pengunjung bercakap / sesi berakhir). */
    public stop(): void {
        this.done = true;
        this.active = false;
        this.clearTimers();
    }


    /** Halaman baru (pendaratan atau navigasi SPA): pemicu halaman dinilai ulang dari awal. */
    public page(): void {
        if (!this.active) {
            return;
        }
        this.clearTimers();
        this.requested = new Set();
        for (const rule of this.rules) {
            if (rule.trigger.type === 'page_load') {
                this.fire(rule);
            } else if (rule.trigger.type === 'time_on_page') {
                this.timers.push(this.schedule(() => {
                    this.fire(rule);
                }, rule.trigger.seconds * 1000));
            }
        }
    }


    public scroll(percent: number): void {
        this.fireWhere((trigger) => trigger.type === 'scroll_depth' && percent >= trigger.percent);
    }


    public exitIntent(): void {
        this.fireWhere((trigger) => trigger.type === 'exit_intent');
    }


    public event(name: string): void {
        this.fireWhere((trigger) => trigger.type === 'event' && trigger.event === name);
    }


    private fireWhere(matches: (trigger: ProactiveTrigger) => boolean): void {
        for (const rule of this.rules) {
            if (matches(rule.trigger)) {
                this.fire(rule);
            }
        }
    }


    private fire(rule: ProactiveRule): void {
        // Satu permintaan pada satu waktu: pemicu yang terpenuhi bersamaan tak membuat klaim beruntun.
        if (!this.active || this.inFlight || this.requested.has(rule.rule_id)) {
            return;
        }
        this.requested.add(rule.rule_id);
        this.inFlight = true;
        this.options.claim(rule.rule_id)
            .then((shown) => {
                if (shown) {
                    this.stop();
                }
            })
            .catch(() => undefined)
            .finally(() => {
                this.inFlight = false;
            });
    }


    private clearTimers(): void {
        for (const handle of this.timers) {
            this.cancel(handle);
        }
        this.timers = [];
    }
}

function isRule(value: ProactiveRule): boolean {
    type LooseTrigger = { type?: unknown; seconds?: unknown; percent?: unknown; event?: unknown };
    const trigger = value.trigger as LooseTrigger | undefined;
    if (typeof value.rule_id !== 'string' || !trigger) {
        return false;
    }
    switch (trigger.type) {
        case 'page_load':
        case 'exit_intent':
            return true;
        case 'time_on_page':
            return typeof trigger.seconds === 'number' && trigger.seconds > 0;
        case 'scroll_depth':
            return typeof trigger.percent === 'number';
        case 'event':
            return typeof trigger.event === 'string';
        default:
            return false;
    }
}
