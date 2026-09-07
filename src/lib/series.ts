import type { Bar, Quote, Timeframe } from './types';

/**
  * 일봉 → 주봉/월봉 집계.
  * 시가 = 구간 첫 시가, 종가 = 구간 마지막 종가, 고저 = 구간 극값, 거래량 = 합.
  */
export function aggregate(daily: Bar[], tf: Timeframe): Bar[] {
    if (tf === 'D') return daily;

    const keyOf = (t: number): number => {
        const d = new Date(t);
        if (tf === 'M') return d.getFullYear() * 100 + d.getMonth();
        const mon = new Date(d);
        mon.setHours(0, 0, 0, 0);
        mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7)); // 그 주의 월요일
        return mon.getTime();
    };

    const out: Bar[] = [];
    let cur: Bar | null = null;
    let curKey: number | null = null;

    for (const b of daily) {
        const k = keyOf(b.t);
        if (k !== curKey) {
            if (cur) out.push(cur);
            cur = { ...b };
            curKey = k;
        } else if (cur) {
            cur.h = Math.max(cur.h, b.h);
            cur.l = Math.min(cur.l, b.l);
            cur.c = b.c;
            cur.v += b.v;
        }
    }
    if (cur) out.push(cur);
    return out;
}

export function quoteOf(bars: Bar[]): Quote {
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2] ?? last;
    const diff = last.c - prev.c;
    return { last, prev, diff, pct: prev.c ? (diff / prev.c) * 100 : 0 };
}

/** 52주(=252영업일) 최고/최저와 연초 대비 수익률 */
export function stats(daily: Bar[]) {
    const yr = daily.slice(-252);
    const high52 = Math.max(...yr.map((b) => b.h));
    const low52 = Math.min(...yr.map((b) => b.l));
    const thisYear = new Date().getFullYear();
    const first = daily.find((b) => new Date(b.t).getFullYear() === thisYear);
    const last = daily[daily.length - 1];
    const ytd = first ? ((last.c - first.o) / first.o) * 100 : 0;
    return { high52, low52, ytd };
}
