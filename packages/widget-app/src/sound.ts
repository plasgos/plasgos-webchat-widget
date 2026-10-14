/**
 * Nada notifikasi pesan baru (Web Audio, tanpa berkas audio). Peramban hanya mengizinkan suara setelah interaksi
 * pengguna di dalam iframe — sebelum itu diam tanpa galat. Bisa dimatikan pengunjung (disimpan per widget).
 */
type AudioContextConstructor = new () => AudioContext;

export class NotificationSound {
    private context: AudioContext | null = null;


    public constructor(private readonly win: Window) {}


    /** Dipanggil saat pengunjung berinteraksi dengan widget (klik/ketik). */
    public unlock(): void {
        if (this.context) {
            return;
        }
        const Constructor = (this.win as Window & { AudioContext?: AudioContextConstructor }).AudioContext;
        if (typeof Constructor !== 'function') {
            return;
        }
        try {
            this.context = new Constructor();
        } catch {
            this.context = null;
        }
    }


    public play(): void {
        const context = this.context;
        if (!context || context.state !== 'running') {
            return;
        }
        try {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, context.currentTime);
            gain.gain.setValueAtTime(0.0001, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
            oscillator.connect(gain).connect(context.destination);
            oscillator.start();
            oscillator.stop(context.currentTime + 0.26);
        } catch {
            // Suara hanya kesopanan — gagal diam-diam.
        }
    }
}
