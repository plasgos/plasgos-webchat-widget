import { createHmac } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { FrameLocator, Page } from '@playwright/test';

/**
 * Alur W2 lewat widget SUNGGUHAN terhadap api-crm dev (W3c): loader → iframe `/w/:widget_id` api-crm → aplikasi
 * widget → REST `/webchat/v1` & socket `/webchat`; agen memakai API inbox tenant.
 *
 *   API_CRM_URL            api-crm untuk API tenant (bawaan http://localhost:3001)
 *   API_CRM_WIDGET_ORIGIN  origin dokumen iframe/API publik (bawaan http://127.0.0.1:3001 — origin LAIN dari website)
 *   API_CRM_TOKEN          token tenant (Bearer); tanpa ini suite dilewati
 * api-crm dev wajib berjalan dengan WEBCHAT_CDN_ORIGIN=http://localhost:4400 (server fixture = CDN).
 */

const API = process.env['API_CRM_URL'] ?? 'http://localhost:3001';
const WIDGET_ORIGIN = process.env['API_CRM_WIDGET_ORIGIN'] ?? 'http://127.0.0.1:3001';
const TOKEN = process.env['API_CRM_TOKEN'] ?? '';
const STORE_ORIGIN = 'http://localhost:4400';
const NAME_PREFIX = 'E2E Widget';

test.skip(!TOKEN, 'API_CRM_TOKEN tidak dipasang — uji live dilewati');
test.describe.configure({ mode: 'serial' });

interface Envelope<T> {
    readonly success: boolean;
    readonly data: T;
    readonly message?: string;
}

async function tenant<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = await response.json() as Envelope<T>;
    if (!response.ok) {
        throw new Error(`${method} ${path} → ${String(response.status)} ${envelope.message ?? ''}`);
    }
    return envelope.data;
}

interface Widget {
    readonly widget_id: string;
    readonly name: string;
}

interface InboxConversation {
    readonly id: string;
    readonly customer: { readonly identity: { readonly external_id: string } | null };
}

interface InboxMessage {
    readonly id: string;
    readonly direction: string;
    readonly status: string;
    readonly content: { readonly text?: { readonly body: string } };
}

let widgetId = '';
let identitySecret = '';
let agentId = '';
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function heartbeat(status: 'online' | 'offline'): Promise<void> {
    if (!agentId) return;
    await fetch(`${API}/v2/inbox/presence`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-crm-agent-id': agentId },
        body: JSON.stringify({ status }),
    });
}

test.beforeAll(async () => {
    for (const widget of await tenant<Widget[]>('GET', '/v2/webchat/widgets')) {
        if (widget.name.startsWith(NAME_PREFIX)) {
            await tenant('DELETE', `/v2/webchat/widgets/${widget.widget_id}`);
        }
    }
    const created = await tenant<{ widget: Widget; identity_secret: string }>('POST', '/v2/webchat/widgets', {
        name: `${NAME_PREFIX} ${new Date().toISOString()}`,
        allowed_origins: [STORE_ORIGIN],
        appearance: { primary_color: '#1d4ed8', team_title: 'Tim Toko E2E', greeting: 'Halo dari Toko E2E' },
        security: { captcha: 'off' },
        // Buka 24 jam (jadwal khusus kosong) — uji tak bergantung jam kerja pengaturan chatroom tenant dev.
        business_hours: { source: 'custom', schedule: {} },
    });
    widgetId = created.widget.widget_id;
    // Tim harus daring, kalau tidak widget menggantikan kolom tulis dengan formulir "tinggalkan pesan" (W5b). Pemilik
    // bertindak sebagai agen pertamanya (`x-crm-agent-id`, seperti agen yang membuka inbox) dengan detak berkala.
    const presence = await tenant<{ items: { agent: { id: string } }[] }>('GET', '/v2/inbox/presence');
    agentId = presence.items[0]?.agent.id ?? '';
    await heartbeat('online');
    heartbeatTimer = setInterval(() => {
        void heartbeat('online');
    }, 20_000);
    identitySecret = created.identity_secret;
});

test.afterAll(async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await heartbeat('offline');
    if (widgetId) {
        await tenant('DELETE', `/v2/webchat/widgets/${widgetId}`);
    }
});

function widget(page: Page): FrameLocator {
    return page.frameLocator(`iframe[src="${WIDGET_ORIGIN}/w/${widgetId}"]`);
}

async function openStore(page: Page): Promise<FrameLocator> {
    await page.goto(`/fixtures/live-api-crm/?widget=${widgetId}&origin=${encodeURIComponent(WIDGET_ORIGIN)}`);
    const frame = widget(page);
    // Tanpa pesan belum dibaca lencana TIDAK tampil (dulu "0" karena `.pw-badge{display:grid}` menimpa `hidden`).
    await expect(frame.locator('.pw-badge')).toBeHidden();
    await frame.getByRole('button', { name: /Buka chat/ }).click();
    await expect(frame.getByRole('dialog')).toBeVisible();
    return frame;
}

async function send(frame: FrameLocator, text: string): Promise<void> {
    const input = frame.getByRole('textbox', { name: 'Pesan', exact: true });
    await input.fill(text);
    await input.press('Enter');
}

function visitorBubble(frame: FrameLocator, text: string) {
    return frame.locator('.pw-msg[data-side="visitor"]').filter({ hasText: text });
}

async function conversationOf(visitorText: string): Promise<InboxConversation> {
    let found: InboxConversation | undefined;
    await expect.poll(async () => {
        const page = await tenant<{ items: InboxConversation[] }>('GET', `/v2/inbox/conversations?channel=webchat&endpoint_id=${widgetId}&limit=10`);
        for (const conversation of page.items) {
            const messages = await tenant<{ items: InboxMessage[] }>('GET', `/v2/inbox/conversations/${conversation.id}/messages?limit=20`);
            if (messages.items.some((message) => message.content.text?.body === visitorText)) {
                found = conversation;
            }
        }
        return Boolean(found);
    }, { timeout: 20_000 }).toBe(true);
    if (!found) throw new Error('percakapan tak ditemukan');
    return found;
}

test('pengunjung bertanya → agen membalas realtime; status sampai & dibaca di kedua sisi', async ({ page }) => {
    const frame = await openStore(page);
    await expect(frame.getByRole('heading', { name: 'Tim Toko E2E' })).toBeVisible();
    const question = `Ukuran M masih ada? ${String(Date.now())}`;

    await send(frame, question);

    await expect(visitorBubble(frame, question)).toBeVisible();
    await expect(visitorBubble(frame, question).locator('.pw-meta')).toContainText('Sampai', { timeout: 20_000 });

    const conversation = await conversationOf(question);
    const reply = 'Masih kak, mau **warna** apa?';
    const sent = await tenant<{ messages: InboxMessage[] }>('POST', `/v2/inbox/conversations/${conversation.id}/messages`, {
        content: { type: 'text', text: { body: reply } },
        client_message_id: crypto.randomUUID(),
    });

    const teamBubble = frame.locator('.pw-msg[data-side="team"]').filter({ hasText: 'Masih kak' });
    await expect(teamBubble).toBeVisible({ timeout: 15_000 });
    await expect(teamBubble.locator('strong')).toHaveText('warna');
    const replyId = sent.messages[0]?.id ?? '';
    await expect.poll(async () => {
        const messages = await tenant<{ items: InboxMessage[] }>('GET', `/v2/inbox/conversations/${conversation.id}/messages?limit=20`);
        return messages.items.find((message) => message.id === replyId)?.status;
    }, { timeout: 15_000 }).toBe('read');

    await tenant('POST', `/v2/inbox/conversations/${conversation.id}/read`);
    await expect(visitorBubble(frame, question).locator('.pw-meta')).toContainText('Dibaca', { timeout: 15_000 });
});

test('muat ulang halaman → sesi & riwayat pulih (refresh token berotasi di storage iframe)', async ({ page }) => {
    const frame = await openStore(page);
    const text = `Pesan sebelum muat ulang ${String(Date.now())}`;
    await send(frame, text);
    await expect(visitorBubble(frame, text).locator('.pw-meta')).toContainText(/Terkirim|Sampai/, { timeout: 20_000 });

    await page.reload();
    const reloaded = widget(page);
    await reloaded.getByRole('button', { name: /Buka chat/ }).click();

    await expect(visitorBubble(reloaded, text)).toBeVisible({ timeout: 15_000 });
});

test('koneksi putus → pesan menunggu di antrean, terkirim otomatis saat kembali online', async ({ page, context }) => {
    const frame = await openStore(page);
    await send(frame, `Pesan pembuka ${String(Date.now())}`);
    await expect(frame.locator('.pw-msg[data-side="visitor"] .pw-meta').first()).toContainText(/Terkirim|Sampai/, { timeout: 20_000 });
    const text = `Pesan saat offline ${String(Date.now())}`;

    await context.setOffline(true);
    await send(frame, text);
    await expect(visitorBubble(frame, text).locator('.pw-meta')).toContainText('Mengirim');

    await context.setOffline(false);

    await expect(visitorBubble(frame, text).locator('.pw-meta')).toContainText(/Terkirim|Sampai/, { timeout: 45_000 });
});

test('dua tab pengunjung yang sama dibuka bersamaan → sesi tetap hidup; kiriman & balasan sinkron di kedua tab', async ({ context }) => {
    const first = await context.newPage();
    const firstFrame = await openStore(first);
    const opener = `Pembuka multi-tab ${String(Date.now())}`;
    await send(firstFrame, opener);
    await expect(visitorBubble(firstFrame, opener).locator('.pw-meta')).toContainText('Sampai', { timeout: 20_000 });

    // Dua tab memuat ulang BERSAMAAN: keduanya memulihkan sesi dengan refresh token yang sama di storage. Tanpa
    // kunci lintas tab, server melihat pemakaian ulang token dan mencabut sesi.
    const second = await context.newPage();
    const [, secondFrame] = await Promise.all([first.reload().then(() => widget(first)), openStore(second)]);
    const reopened = widget(first);
    await reopened.getByRole('button', { name: /Buka chat/ }).click();
    await expect(visitorBubble(reopened, opener)).toBeVisible({ timeout: 15_000 });
    await expect(visitorBubble(secondFrame, opener)).toBeVisible({ timeout: 15_000 });

    const fromFirst = `Dari tab pertama ${String(Date.now())}`;
    await send(reopened, fromFirst);
    await expect(visitorBubble(secondFrame, fromFirst)).toBeVisible({ timeout: 15_000 });

    const conversation = await conversationOf(fromFirst);
    await tenant('POST', `/v2/inbox/conversations/${conversation.id}/messages`, {
        content: { type: 'text', text: { body: 'Balasan untuk semua tab' } },
        client_message_id: crypto.randomUUID(),
    });
    for (const frame of [reopened, secondFrame]) {
        await expect(frame.locator('.pw-msg[data-side="team"]').filter({ hasText: 'Balasan untuk semua tab' })).toBeVisible({ timeout: 15_000 });
        await expect(frame.locator('.pw-notice')).toBeHidden();
    }
});

/** Identity token HS256 seperti dibuat server website tenant (W4a). */
function identityToken(sub: string): string {
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    const iat = Math.floor(Date.now() / 1000);
    const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, email: `${sub}@contoh.co.id`, iat, exp: iat + 3600, jti: crypto.randomUUID() })}`;
    return `${body}.${createHmac('sha256', identitySecret).update(body).digest('base64url')}`;
}

test('pelanggan login di website: Plasgos("identify") → sesi widget terverifikasi', async ({ page }) => {
    await openStore(page);

    await page.evaluate((token) => {
        (window as unknown as { Plasgos: (...args: unknown[]) => void }).Plasgos('identify', { token });
    }, identityToken(`pelanggan-${String(Date.now())}`));

    await expect.poll(() => page.evaluate(() => {
        const state = (window as unknown as { Plasgos: (name: string) => { trustLevel: string | null } }).Plasgos('getState');
        return state.trustLevel;
    }), { timeout: 15_000 }).toBe('verified');
});

test('halaman chat penuh /m (WebView & tautan langsung): jendela terbuka, pesan sampai inbox; token dari aplikasi lewat Plasgos("identify"), token di URL diabaikan', async ({ page }) => {
    const sub = `aplikasi-${String(Date.now())}`;
    // Tautan berisi token (pola login CSRF) → diabaikan & dihapus dari alamat.
    await page.goto(`${WIDGET_ORIGIN}/m/${widgetId}?utm_source=instagram#identity_token=${identityToken(`penyerang-${sub}`)}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
    expect(page.url()).toBe(`${WIDGET_ORIGIN}/m/${widgetId}?utm_source=instagram`);

    // Aplikasi mobile menyuntikkan JavaScript ke WebView.
    await page.evaluate((token) => {
        (window as unknown as { Plasgos: (...args: unknown[]) => void }).Plasgos('identify', { token });
    }, identityToken(sub));

    const question = `Dari aplikasi ${String(Date.now())}`;
    const input = page.getByRole('textbox', { name: 'Pesan', exact: true });
    await input.fill(question);
    await input.press('Enter');
    const conversation = await conversationOf(question);
    const visitorId = conversation.customer.identity?.external_id ?? '';
    const visitor = await tenant<{ trust_level: string; attribution_first: { utm_source: string | null } | null }>('GET', `/v2/webchat/visitors/${visitorId}`);
    expect(visitor.trust_level).toBe('verified');
    expect(visitor.attribution_first?.utm_source).toBe('instagram');
});

test('pre-chat wajib: pengunjung mengisi formulir perkenalan + persetujuan lalu bisa bertanya', async ({ page }) => {
    await tenant('PATCH', `/v2/webchat/widgets/${widgetId}`, {
        prechat: {
            mode: 'required',
            fields: [
                { key: 'name', type: 'text', label: 'Nama', required: true },
                { key: 'email', type: 'email', label: 'Email', required: false },
                { key: 'topic', type: 'select', label: 'Perlu bantuan soal', required: true, options: [{ value: 'sales', label: 'Pembelian' }] },
                { key: 'consent', type: 'consent', label: 'Setuju', required: true },
            ],
        },
        privacy: { consent_text: 'Saya setuju data saya dipakai untuk menjawab pertanyaan.', consent_version: 'e2e-1' },
    });
    const frame = await openStore(page);
    await expect(frame.getByRole('textbox', { name: 'Pesan', exact: true })).toBeDisabled();

    const prechatForm = frame.locator('form.pw-prechat:not(.pw-offline)');
    await prechatForm.getByLabel('Nama *').fill('Sari E2E');
    await prechatForm.getByLabel('Email').fill(`sari.${String(Date.now())}@contoh.co.id`);
    await prechatForm.getByLabel('Perlu bantuan soal *').selectOption('sales');
    await prechatForm.getByLabel('Saya setuju data saya dipakai untuk menjawab pertanyaan.').check();
    await prechatForm.getByRole('button', { name: 'Mulai chat' }).click();

    await expect(frame.locator('form.pw-prechat:not(.pw-offline)')).toBeHidden();
    const question = `Setelah pre-chat ${String(Date.now())}`;
    await send(frame, question);
    await expect(visitorBubble(frame, question).locator('.pw-meta')).toContainText('Sampai', { timeout: 20_000 });
});

test('aksesibilitas: jendela chat tanpa pelanggaran axe serius/kritis (WCAG 2.1 A/AA)', async ({ page }) => {
    await openStore(page);

    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const serious = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');

    expect(serious.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});
