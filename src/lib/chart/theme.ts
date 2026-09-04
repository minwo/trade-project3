/** 캔버스는 CSS 변수를 못 읽으므로 팔레트를 여기서 단일 관리한다. globals.css 와 값을 맞출 것. */
export const PALETTE = {
  up: '#F04452',
  down: '#3485FA',
  grid: '#212329',
  text: '#EDEFF3',
  dim: '#6B7280',
  sub: '#9BA1AC',
  bg: '#101114',
  chip: '#232630',
} as const;

export interface MaDef {
  period: number;
  color: string;
}

export const MA_DEFS: MaDef[] = [
  { period: 5, color: '#FFB020' },
  { period: 20, color: '#7C8DFF' },
  { period: 60, color: '#4CC9A0' },
  { period: 120, color: '#E27DFF' },
];

export type SubPane = 'volume' | 'rsi' | 'macd' | 'none';

export const SUB_PANE_LABEL: Record<SubPane, string> = {
  volume: '거래량',
  rsi: 'RSI(14)',
  macd: 'MACD',
  none: '없음',
};
