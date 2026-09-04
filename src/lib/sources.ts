import { mockDaily } from './mock';
import type { Bar, CandlesResponse, SymbolDef } from './types';

/**
 * 데이터 소스 어댑터 (서버 전용).
 *
 * DATA_SOURCE 환경변수로 고른다.
 *   auto   (기본) 코인=Binance, 지수=Yahoo, 실패 시 모의 데이터로 폴백
 *   yahoo  전부 Yahoo Finance
 *   mock   전부 모의 데이터 (네트워크 불필요)
 *
 * 브라우저가 아니라 Next 서버(Route Handler)에서 호출하므로 CORS 프록시가 필요 없고,
 * API 키를 쓰는 소스(KIS·공공데이터포털 등)를 붙일 때도 키가 노출되지 않는다.
 */
export type SourceMode = 'auto' | 'yahoo' | 'mock';

const MODE = (process.env.DATA_SOURCE as SourceMode) || 'auto';
const TIMEOUT_MS = 6000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; index-quote-app/0.1)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: 300 }, // 5분 캐시
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

interface YahooChart {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators: {
        quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[];
      };
    }[];
  };
}

/**
 * Yahoo Finance — 무료·키 불필요. ^IXIC ^GSPC ^KS11 ^KQ11 BTC-USD 전부 커버.
 * 비공식 API이므로 상용 서비스에서는 KIS / 공공데이터포털 / 유료 벤더로 교체할 것.
 */
async function fromYahoo(sym: SymbolDef): Promise<Bar[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.yahoo)}` +
    `?interval=1d&range=10y`;
  const json = (await getJson(url)) as YahooChart;
  const rs = json.chart?.result?.[0];
  const q = rs?.indicators?.quote?.[0];
  if (!rs?.timestamp || !q) throw new Error('yahoo: empty result');

  const bars: Bar[] = [];
  rs.timestamp.forEach((ts, i) => {
    const c = q.close[i];
    if (c == null) return; // 휴장일 구멍 제거
    bars.push({
      t: ts * 1000,
      o: q.open[i] ?? c,
      h: q.high[i] ?? c,
      l: q.low[i] ?? c,
      c,
      v: q.volume[i] ?? 0,
    });
  });
  if (!bars.length) throw new Error('yahoo: no bars');
  return bars;
}

/** Binance — 무료·키 불필요. 코인 전용. (브라우저에서도 CORS 허용되는 소스) */
async function fromBinance(sym: SymbolDef): Promise<Bar[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${sym.binance}&interval=1d&limit=1000`;
  const rows = (await getJson(url)) as (string | number)[][];
  if (!Array.isArray(rows) || !rows.length) throw new Error('binance: no bars');
  return rows.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }));
}

export async function loadDaily(sym: SymbolDef): Promise<CandlesResponse> {
  if (MODE !== 'mock') {
    const useBinance = MODE === 'auto' && !!sym.binance;
    try {
      const bars = useBinance ? await fromBinance(sym) : await fromYahoo(sym);
      return { id: sym.id, source: useBinance ? 'binance' : 'yahoo', bars };
    } catch (err) {
      console.warn(`[${sym.id}] 실시세 로드 실패 → 모의 데이터로 폴백:`, (err as Error).message);
    }
  }
  return { id: sym.id, source: 'mock', bars: mockDaily(sym) };
}
