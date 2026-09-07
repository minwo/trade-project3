export interface Bar {
    /** epoch ms (봉 시작 시각) */
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    /** 거래량 */
    v: number;
}

export type Timeframe = 'D' | 'W' | 'M';

export type Category = 'overseas' | 'domestic' | 'crypto';

export interface SymbolDef {
    id: string;
    name: string;
    /** 카드 아래 보조 설명 */
    tag: string;
    /** 리스트 좌측 아바타에 쓰는 짧은 라벨 */
    badge: string;
    cat: Category;
    /** Yahoo Finance 티커 (URL 인코딩 전) */
    yahoo: string;
    /** Binance 심볼 (코인만) */
    binance?: string;
    digits: number;
    prefix?: string;
    /** 모의 데이터 생성 파라미터 */
    mock: { base: number; vol: number; drift: number; seed: number; weekend: boolean };
}

export interface Quote {
    last: Bar;
    prev: Bar;
    diff: number;
    pct: number;
}

/** /api/candles 응답 */
export interface CandlesResponse {
    id: string;
    source: 'yahoo' | 'binance' | 'mock';
    bars: Bar[];
}
