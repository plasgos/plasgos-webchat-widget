import { describe, expect, it } from 'vitest';

import { ProactiveEngine } from '../src/proactive';
import type { ProactiveRule } from '../src/proactive';

function engine(reply: (ruleId: string) => boolean = () => false) {
    const claims: string[] = [];
    const timers: { cb: () => void; ms: number }[] = [];
    const instance = new ProactiveEngine({
        claim: (ruleId) => {
            claims.push(ruleId);
            return Promise.resolve(reply(ruleId));
        },
        schedule: (cb, ms) => {
            const timer = { cb, ms };
            timers.push(timer);
            return timer;
        },
        cancel: (handle) => {
            const index = timers.indexOf(handle as { cb: () => void; ms: number });
            if (index !== -1) {
                timers.splice(index, 1);
            }
        },
    });
    return { instance, claims, timers };
}

const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
    }
};

const rule = (id: string, trigger: ProactiveRule['trigger']): ProactiveRule => ({ rule_id: id, trigger });

describe('pemicu pesan proaktif (W8b)', () => {
    it('waktu di halaman: penghitung diulang tiap halaman; belum mulai = tak menilai', async () => {
        const { instance, claims, timers } = engine();
        instance.setRules([rule('prr_a', { type: 'time_on_page', seconds: 30 })]);
        expect(timers).toHaveLength(0);
        instance.start();
        expect(timers.map((t) => t.ms)).toEqual([30_000]);
        instance.page();
        expect(timers).toHaveLength(1);
        timers[0]?.cb();
        await flush();
        expect(claims).toEqual(['prr_a']);
    });


    it('satu aturan diminta sekali per halaman; berhenti setelah tampil', async () => {
        const { instance, claims } = engine((id) => id === 'prr_b');
        instance.setRules([rule('prr_a', { type: 'exit_intent' }), rule('prr_b', { type: 'event', event: 'beli' })]);
        instance.start();
        instance.exitIntent();
        await flush();
        instance.exitIntent();
        await flush();
        expect(claims).toEqual(['prr_a']);
        instance.event('beli');
        await flush();
        instance.page();
        instance.exitIntent();
        await flush();
        expect(claims).toEqual(['prr_a', 'prr_b']);
    });


    it('aturan cacat dari server diabaikan', () => {
        const { instance, timers } = engine();
        instance.setRules([
            rule('prr_a', { type: 'time_on_page', seconds: 0 }),
            { rule_id: 'prr_b', trigger: { type: 'magic' } } as unknown as ProactiveRule,
        ]);
        instance.start();
        expect(timers).toHaveLength(0);
    });
});
