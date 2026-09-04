import type { SymbolDef, Timeframe } from './types';

const cache = new Map<number, Intl.NumberFormat>();

export function nf(digits: number): Intl.NumberFormat {
  let f = cache.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('ko-KR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    cache.set(digits, f);
  }
  return f;
}

export function fmtPrice(sym: SymbolDef, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return (sym.prefix ?? '') + nf(sym.digits).format(v);
}

export function fmtSigned(sym: SymbolDef, v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return sign + nf(sym.digits).format(Math.abs(v));
}

export function fmtPct(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

export function fmtVolume(v: number | null | undefined): string {
  if (v == null) return '–';
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}만`;
  if (v >= 1e3) return Math.round(v).toLocaleString('ko-KR');
  return v.toFixed(v < 10 ? 2 : 0);
}

export function fmtDate(t: number, tf: Timeframe): string {
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  if (tf === 'M') return `${d.getFullYear()}.${mm}`;
  return `${String(d.getFullYear()).slice(2)}.${mm}.${String(d.getDate()).padStart(2, '0')}`;
}

/** x축 라벨 — 해가 바뀌면 연도를, 아니면 월/일을 보여준다 */
export function fmtAxisDate(t: number, tf: Timeframe, prev: number | null): string {
  const d = new Date(t);
  if (tf === 'M') return d.getMonth() === 0 || prev == null ? `${d.getFullYear()}` : `${d.getMonth() + 1}월`;
  const p = prev != null ? new Date(prev) : null;
  if (!p || p.getFullYear() !== d.getFullYear()) {
    return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}`;
  }
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

export type Dir = 'up' | 'down' | 'flat';
export const dirOf = (v: number): Dir => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
