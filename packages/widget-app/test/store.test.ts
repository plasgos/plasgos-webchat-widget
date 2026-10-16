import { describe, expect, it } from 'vitest';

import { applyInboundStatus, lastServerTimestamp, upsertMessages } from '../src/store';
import type { ChatMessage } from '../src/types';

function visitorMessage(patch: Partial<ChatMessage> = {}): ChatMessage {
    return {
        id: null,
        client_message_id: 'c-1',
        direction: 'inbound',
        sender: { kind: 'customer', name: null },
        type: 'text',
        text: 'Halo',
        status: 'pending',
        timestamp: '2026-10-14T10:00:00.000Z',
        ...patch,
    };
}

describe('penggabungan pesan', () => {
    it('pesan optimistis & versi server (client_message_id sama) menjadi SATU pesan berwaktu SERVER', () => {
        const merged = upsertMessages([visitorMessage({ local: true })], [visitorMessage({ id: 'wcm_1', status: 'accepted', timestamp: '2026-10-14T10:00:01.000Z' })]);

        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({ id: 'wcm_1', status: 'accepted', timestamp: '2026-10-14T10:00:01.000Z', local: false });
    });


    it('jam perangkat yang maju tak menimpa waktu server & tak jadi kursor `after` (balasan tak terlewati)', () => {
        const server = visitorMessage({ id: 'wcm_1', status: 'accepted', timestamp: '2026-10-14T10:00:01.000Z' });
        const fromOtherTab = visitorMessage({ id: 'wcm_1', status: 'accepted', timestamp: '2026-10-14T10:07:00.000Z', local: true });
        const merged = upsertMessages([server], [fromOtherTab]);
        expect(merged[0]?.timestamp).toBe('2026-10-14T10:00:01.000Z');

        const optimistic = visitorMessage({ id: 'wcm_2', client_message_id: 'c-2', status: 'accepted', timestamp: '2026-10-14T10:09:00.000Z', local: true });
        expect(lastServerTimestamp([server, optimistic])).toBe('2026-10-14T10:00:01.000Z');
    });


    it('status tak pernah mundur; pesan gagal boleh dikirim ulang', () => {
        const read = upsertMessages([visitorMessage({ id: 'wcm_1', status: 'read' })], [visitorMessage({ id: 'wcm_1', status: 'delivered' })]);
        expect(read[0]?.status).toBe('read');

        const retried = upsertMessages([visitorMessage({ status: 'failed' })], [visitorMessage({ status: 'pending' })]);
        expect(retried[0]?.status).toBe('pending');
    });


    it('urut waktu; balasan tim dikenali lewat id', () => {
        const reply: ChatMessage = { ...visitorMessage(), id: 'wco_1', client_message_id: null, direction: 'outbound', timestamp: '2026-10-14T09:59:00.000Z' };
        const list = upsertMessages([visitorMessage()], [reply, reply]);

        expect(list.map((message) => message.id ?? message.client_message_id)).toEqual(['wco_1', 'c-1']);
    });


    it('status pesan pengunjung per pesan (id/client id) atau watermark waktu', () => {
        const list = [
            visitorMessage({ id: 'wcm_1', client_message_id: 'a', status: 'accepted', timestamp: '2026-10-14T10:00:00.000Z' }),
            visitorMessage({ id: 'wcm_2', client_message_id: 'b', status: 'accepted', timestamp: '2026-10-14T10:05:00.000Z' }),
        ];

        const delivered = applyInboundStatus(list, { messageId: null, clientMessageId: 'a', status: 'delivered', upToAt: null });
        expect(delivered.map((message) => message.status)).toEqual(['delivered', 'accepted']);

        const read = applyInboundStatus(delivered, { messageId: null, clientMessageId: null, status: 'read', upToAt: '2026-10-14T10:01:00.000Z' });
        expect(read.map((message) => message.status)).toEqual(['read', 'accepted']);
    });


    it('kursor sambung ulang = pesan terakhir yang sudah tersimpan di server', () => {
        const list = [visitorMessage({ id: 'wcm_1', status: 'delivered', timestamp: 'T1' }), visitorMessage({ client_message_id: 'x', timestamp: 'T2' })];

        expect(lastServerTimestamp(list)).toBe('T1');
    });
});
