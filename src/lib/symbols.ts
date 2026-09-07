import type { SymbolDef } from './types';

export const SYMBOLS: SymbolDef[] = [
    {
        id: 'IXIC', name: '나스닥 종합', tag: '미국 · NASDAQ Composite', badge: 'NAS',
        cat: 'overseas', yahoo: '^IXIC', digits: 2,
        mock: { base: 26580, vol: 0.0118, drift: 0.00042, seed: 1101, weekend: false },
    },
    {
        id: 'SPX', name: 'S&P 500', tag: '미국 · Standard & Poor’s 500', badge: 'S&P',
        cat: 'overseas', yahoo: '^GSPC', digits: 2,
        mock: { base: 7750, vol: 0.0091, drift: 0.00038, seed: 2202, weekend: false },
    },
    {
        id: 'BTC', name: '비트코인', tag: '코인 · BTC/USD', badge: 'BTC',
        cat: 'crypto', yahoo: 'BTC-USD', binance: 'BTCUSDT', digits: 0, prefix: '$',
        mock: { base: 80800, vol: 0.0285, drift: 0.00085, seed: 3303, weekend: true },
    },
    {
        id: 'KS11', name: '코스피', tag: '한국 · KOSPI', badge: 'KP',
        cat: 'domestic', yahoo: '^KS11', digits: 2,
        mock: { base: 6640, vol: 0.0104, drift: 0.0003, seed: 4404, weekend: false },
    },
    {
        id: 'KQ11', name: '코스닥', tag: '한국 · KOSDAQ', badge: 'KQ',
        cat: 'domestic', yahoo: '^KQ11', digits: 2,
        mock: { base: 802, vol: 0.0138, drift: 0.00018, seed: 5505, weekend: false },
    },
];

export const getSymbol = (id: string): SymbolDef | undefined =>
    SYMBOLS.find((s) => s.id === id);

export const CATEGORY_LABEL: Record<string, string> = {
    all: '전체',
    overseas: '해외',
    domestic: '국내',
    crypto: '코인',
};
