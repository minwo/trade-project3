import type { Bar, SymbolDef } from './types';

/** mulberry32 — 시드 고정 난수 (새로고침해도 같은 차트) */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 정규분포 근사 (Box–Muller) */
export function gauss(r: () => number): number {
    const u = Math.max(r(), 1e-9);
    const v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
  * 모의 일봉 생성.
  * GBM + 변동성 레짐 + 갭으로 캔들을 만들고, 마지막 종가가 mock.base 가 되도록 스케일링한다.
  */
export function mockDaily(sym: SymbolDef, days?: number): Bar[] {
    const { base, vol, drift, seed, weekend } = sym.mock;
    const n = days ?? (weekend ? 2100 : 1500);
    const r = rng(seed);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dates: Date[] = [];
    for (let d = new Date(today), guard = 0; dates.length < n && guard < n * 2; guard++) {
        const wd = d.getDay();
        if (weekend || (wd !== 0 && wd !== 6)) dates.push(new Date(d));
        d.setDate(d.getDate() - 1);
    }
    dates.reverse();

    const bars: Bar[] = [];
    let price = 100;
    let regime = 1;

    for (const date of dates) {
        if (r() < 0.02) regime = 0.6 + r() * 1.9; // 가끔 변동성 레짐 전환
        regime += (1 - regime) * 0.03;

        const sd = vol * regime;
        const ret = drift - (sd * sd) / 2 + sd * gauss(r);
        const prevClose = price;
        const open = prevClose * (1 + sd * 0.25 * gauss(r)); // 갭
        const close = prevClose * Math.exp(ret);
        const wick = sd * (0.5 + r() * 1.1);
        const high = Math.max(open, close) * (1 + wick * r());
        const low = Math.min(open, close) * (1 - wick * r());
        const swing = Math.abs(close / prevClose - 1) / sd;

        bars.push({
            t: date.getTime(),
            o: open,
            h: high,
            l: low,
            c: close,
            v: 0.6 + r() * 0.8 + swing * 0.7,
        });
        price = close;
    }

    const k = base / bars[bars.length - 1].c;
    const vScale =
        sym.id === 'BTC' ? 4.2e4 : sym.id === 'KQ11' ? 9.5e8 : sym.id === 'KS11' ? 4.8e8 : 5.2e9;

    return bars.map((b) => ({
        t: b.t,
        o: b.o * k,
        h: b.h * k,
        l: b.l * k,
        c: b.c * k,
        v: Math.round(b.v * vScale),
    }));
}
