import type { Bar } from './types';

/** 단순이동평균 — 구간이 모자라는 앞부분은 null */
export function sma(bars: Bar[], period: number, key: keyof Bar = 'c'): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i][key] as number;
    if (i >= period) sum -= bars[i - period][key] as number;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 지수이동평균 — 첫 값은 SMA로 시드 */
export function ema(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  let seen = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed += v;
      seen++;
      if (seen === period) {
        prev = seed / period;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

const closes = (bars: Bar[]) => bars.map((b) => b.c as number | null);

/**
 * RSI (Wilder) — 0~100. 통상 70 이상 과매수, 30 이하 과매도로 읽는다.
 */
export function rsi(bars: Bar[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].c - bars[i - 1].c;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let ag = gain / period;
  let al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].c - bars[i - 1].c;
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

/** MACD(12, 26, 9) — 히스토그램이 0선을 넘는 지점이 추세 전환 신호로 쓰인다. */
export function macd(bars: Bar[], fast = 12, slow = 26, sig = 9): MacdResult {
  const c = closes(bars);
  const ef = ema(c, fast);
  const es = ema(c, slow);
  const line = c.map((_, i) => (ef[i] != null && es[i] != null ? ef[i]! - es[i]! : null));
  const signal = ema(line, sig);
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i]! : null));
  return { macd: line, signal, hist };
}

export interface BollingerResult {
  mid: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

/** 볼린저 밴드(20, 2σ) — 밴드 폭이 좁아지면 변동성 수축(스퀴즈). */
export function bollinger(bars: Bar[], period = 20, mult = 2): BollingerResult {
  const mid = sma(bars, period);
  const upper: (number | null)[] = new Array(bars.length).fill(null);
  const lower: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    const m = mid[i];
    if (m == null) continue;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (bars[j].c - m) ** 2;
    const sd = Math.sqrt(sq / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

/** 스토캐스틱 %K/%D (Slow) */
export function stochastic(bars: Bar[], k = 14, d = 3) {
  const raw: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = k - 1; i < bars.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - k + 1; j <= i; j++) {
      hi = Math.max(hi, bars[j].h);
      lo = Math.min(lo, bars[j].l);
    }
    raw[i] = hi === lo ? 50 : ((bars[i].c - lo) / (hi - lo)) * 100;
  }
  return { k: raw, d: smaOf(raw, d) };
}

/** ATR (Wilder) — 변동성 크기. 손절 폭 산정에 쓴다. */
export function atr(bars: Bar[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr = bars.map((b, i) =>
    i === 0
      ? b.h - b.l
      : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)),
  );
  let acc = 0;
  for (let i = 1; i <= period; i++) acc += tr[i];
  let prev = acc / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** OBV — 거래량 누적으로 본 수급 방향 */
export function obv(bars: Bar[]): number[] {
  const out = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const dir = bars[i].c > bars[i - 1].c ? 1 : bars[i].c < bars[i - 1].c ? -1 : 0;
    out[i] = out[i - 1] + dir * bars[i].v;
  }
  return out;
}

/** 배열용 SMA (지표 위에 다시 평균을 낼 때) */
export function smaOf(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const buf: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      buf.length = 0;
      continue;
    }
    buf.push(v);
    if (buf.length > period) buf.shift();
    if (buf.length === period) out[i] = buf.reduce((a, b) => a + b, 0) / period;
  }
  return out;
}
