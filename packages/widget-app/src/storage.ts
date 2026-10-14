/**
 * Storage iframe widget (terpartisi per website induk oleh peramban). Bisa dilarang (mode privat, kebijakan
 * cookie pihak ketiga) → jatuh ke memori: widget tetap berjalan, hanya sesi tak bertahan setelah muat ulang.
 */
export interface KeyValueStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
}

class MemoryStore implements KeyValueStore {
    private readonly values = new Map<string, string>();


    public get(key: string): string | null {
        return this.values.get(key) ?? null;
    }


    public set(key: string, value: string): void {
        this.values.set(key, value);
    }


    public remove(key: string): void {
        this.values.delete(key);
    }
}

class BrowserStore implements KeyValueStore {
    public constructor(private readonly storage: Storage, private readonly fallback: MemoryStore) {}


    public get(key: string): string | null {
        try {
            return this.storage.getItem(key);
        } catch {
            return this.fallback.get(key);
        }
    }


    public set(key: string, value: string): void {
        try {
            this.storage.setItem(key, value);
        } catch {
            this.fallback.set(key, value);
        }
    }


    public remove(key: string): void {
        try {
            this.storage.removeItem(key);
        } catch {
            this.fallback.remove(key);
        }
    }
}

export function createStore(win: Window): KeyValueStore {
    const fallback = new MemoryStore();
    try {
        const storage = win.localStorage;
        const probe = '__plasgos_probe__';
        storage.setItem(probe, '1');
        storage.removeItem(probe);
        return new BrowserStore(storage, fallback);
    } catch {
        return fallback;
    }
}

/** Kunci storage per widget — satu website bisa memasang lebih dari satu widget. */
export function storageKeys(widgetId: string): { readonly refresh: string; readonly sound: string } {
    return { refresh: `plasgos_webchat:${widgetId}:refresh`, sound: `plasgos_webchat:${widgetId}:sound` };
}
