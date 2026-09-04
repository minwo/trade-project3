import { fmtAxisDate, fmtDate, nf } from '../format';
import { bollinger, macd, rsi, sma } from '../indicators';
import type { Bar, SymbolDef, Timeframe } from '../types';
import { MA_DEFS, PALETTE, type SubPane } from './theme';

export interface ChartOptions {
  type: 'candle' | 'line';
  /** 켜져 있는 이동평균 기간 */
  ma: number[];
  bollinger: boolean;
  sub: SubPane;
}

export interface CrosshairInfo {
  index: number;
  bar: Bar;
  /** 사용자가 실제로 짚고 있는 중인지 (false = 최신 봉 자동 표시) */
  active: boolean;
  ma: { period: number; color: string; value: number }[];
}

const DEFAULT_COUNT: Record<Timeframe, number> = { D: 120, W: 100, M: 84 };

/** 의존성 없는 캔버스 캔들 차트. 가격 + 이평선 + 볼린저 + 보조지표 서브패널. */
export class CandleChart {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;

  private sym!: SymbolDef;
  private tf: Timeframe = 'D';
  bars: Bar[] = [];

  private maData = new Map<number, (number | null)[]>();
  private bb: ReturnType<typeof bollinger> | null = null;
  private rsiData: (number | null)[] = [];
  private macdData: ReturnType<typeof macd> | null = null;

  private opts: ChartOptions = { type: 'candle', ma: [5, 20, 60], bollinger: false, sub: 'volume' };

  private count = 120;
  private end = 0;
  private cross: number | null = null;

  private w = 0;
  private h = 0;
  private pad = { l: 8, r: 56, t: 10, b: 20 };

  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; count: number; end: number } | null = null;
  private drag: { x: number; end: number; touch: boolean } | null = null;

  onCrosshair?: (info: CrosshairInfo) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context를 얻지 못했습니다');
    this.ctx = ctx;

    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  destroy() {
    this.ro.disconnect();
  }

  /* ── 데이터 ───────────────────────────────────────── */

  setData(sym: SymbolDef, bars: Bar[], tf: Timeframe, keepView = false) {
    this.sym = sym;
    this.tf = tf;
    this.bars = bars;
    this.recompute();
    if (!keepView) {
      this.count = Math.min(bars.length, DEFAULT_COUNT[tf]);
      this.end = bars.length;
      this.cross = null;
    } else {
      this.end = Math.min(this.end || bars.length, bars.length);
      this.count = Math.min(this.count, bars.length);
    }
    this.draw();
  }

  setOptions(patch: Partial<ChartOptions>) {
    this.opts = { ...this.opts, ...patch };
    this.recompute();
    this.draw();
  }

  /** 보이는 봉 개수 지정 (기간 칩) */
  setWindow(n: number) {
    this.count = Math.max(15, Math.min(n, this.bars.length));
    this.end = this.bars.length;
    this.draw();
  }

  private recompute() {
    if (!this.bars.length) return;
    this.maData.clear();
    for (const def of MA_DEFS) {
      if (this.opts.ma.includes(def.period)) this.maData.set(def.period, sma(this.bars, def.period));
    }
    this.bb = this.opts.bollinger ? bollinger(this.bars) : null;
    this.rsiData = this.opts.sub === 'rsi' ? rsi(this.bars) : [];
    this.macdData = this.opts.sub === 'macd' ? macd(this.bars) : null;
  }

  /* ── 레이아웃 ─────────────────────────────────────── */

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.cv.clientWidth;
    const h = this.cv.clientHeight;
    if (!w || !h) return;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.draw();
  }

  private get i0() {
    return Math.max(0, this.end - this.count);
  }

  private get plot() {
    const { l, r, t, b } = this.pad;
    const innerH = this.h - t - b;
    const hasSub = this.opts.sub !== 'none';
    const subH = hasSub ? innerH * (this.opts.sub === 'volume' ? 0.2 : 0.26) : 0;
    const gap = hasSub ? 14 : 0;
    return {
      x: l,
      y: t,
      w: this.w - l - r,
      h: innerH,
      priceH: innerH - subH - gap,
      subY: t + innerH - subH,
      subH,
    };
  }

  private cw() {
    return this.plot.w / this.count;
  }

  private xAt(i: number) {
    return this.plot.x + (i - this.i0 + 0.5) * this.cw();
  }

  private indexAtX(x: number) {
    const i = Math.floor((x - this.plot.x) / this.cw()) + this.i0;
    return Math.max(this.i0, Math.min(this.end - 1, i));
  }

  private priceScale() {
    let lo = Infinity;
    let hi = -Infinity;
    const touch = (v: number | null | undefined) => {
      if (v == null || !Number.isFinite(v)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    };
    for (let i = this.i0; i < this.end; i++) {
      touch(this.bars[i].l);
      touch(this.bars[i].h);
      for (const arr of this.maData.values()) touch(arr[i]);
      if (this.bb) {
        touch(this.bb.upper[i]);
        touch(this.bb.lower[i]);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 };
    const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }

  private yPrice(v: number, s: { lo: number; hi: number }) {
    const p = this.plot;
    return p.y + (1 - (v - s.lo) / (s.hi - s.lo)) * p.priceH;
  }

  /* ── 그리기 ───────────────────────────────────────── */

  draw() {
    const ctx = this.ctx;
    if (!this.w || !this.bars.length) return;

    const p = this.plot;
    const s = this.priceScale();

    ctx.clearRect(0, 0, this.w, this.h);
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif';
    ctx.textBaseline = 'middle';

    // 가격 그리드 + 우측 라벨
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = PALETTE.dim;
    ctx.textAlign = 'left';
    for (const v of niceTicks(s.lo, s.hi, 4)) {
      const y = Math.round(this.yPrice(v, s)) + 0.5;
      if (y < p.y || y > p.y + p.priceH) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
      ctx.stroke();
      ctx.fillText(nf(this.sym.digits).format(v), p.x + p.w + 6, y);
    }

    if (this.bb) this.drawBollinger(s);
    if (this.opts.type === 'candle') this.drawCandles(s);
    else this.drawLine(s);
    this.drawMa(s);
    this.drawSubPane();
    this.drawDateAxis();
    this.drawLastPrice(s);
    if (this.cross != null) this.drawCrosshair(s);

    this.emitCrosshair();
  }

  private candleWidth() {
    return Math.max(1, Math.min(this.cw() * 0.62, 12));
  }

  private drawCandles(s: { lo: number; hi: number }) {
    const ctx = this.ctx;
    const bw = this.candleWidth();
    for (let i = this.i0; i < this.end; i++) {
      const b = this.bars[i];
      const color = b.c >= b.o ? PALETTE.up : PALETTE.down;
      const x = Math.round(this.xAt(i)) + 0.5;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, this.yPrice(b.h, s));
      ctx.lineTo(x, this.yPrice(b.l, s));
      ctx.stroke();
      const yO = this.yPrice(b.o, s);
      const yC = this.yPrice(b.c, s);
      ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.max(1, Math.abs(yC - yO)));
    }
  }

  private drawLine(s: { lo: number; hi: number }) {
    const ctx = this.ctx;
    const p = this.plot;
    const first = this.bars[this.i0].c;
    const last = this.bars[this.end - 1].c;
    const color = last >= first ? PALETTE.up : PALETTE.down;

    ctx.beginPath();
    for (let i = this.i0; i < this.end; i++) {
      const x = this.xAt(i);
      const y = this.yPrice(this.bars[i].c, s);
      if (i === this.i0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.priceH);
    g.addColorStop(0, hexA(color, 0.28));
    g.addColorStop(1, hexA(color, 0));
    ctx.lineTo(this.xAt(this.end - 1), p.y + p.priceH);
    ctx.lineTo(this.xAt(this.i0), p.y + p.priceH);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  }

  private drawMa(s: { lo: number; hi: number }) {
    const ctx = this.ctx;
    for (const def of MA_DEFS) {
      const arr = this.maData.get(def.period);
      if (!arr) continue;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      let started = false;
      for (let i = this.i0; i < this.end; i++) {
        const v = arr[i];
        if (v == null) {
          started = false;
          continue;
        }
        const x = this.xAt(i);
        const y = this.yPrice(v, s);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawBollinger(s: { lo: number; hi: number }) {
    if (!this.bb) return;
    const ctx = this.ctx;
    const band = (arr: (number | null)[], dash: boolean) => {
      ctx.beginPath();
      let started = false;
      for (let i = this.i0; i < this.end; i++) {
        const v = arr[i];
        if (v == null) {
          started = false;
          continue;
        }
        const x = this.xAt(i);
        const y = this.yPrice(v, s);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.setLineDash(dash ? [3, 3] : []);
      ctx.strokeStyle = 'rgba(155,161,172,.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    };
    band(this.bb.upper, false);
    band(this.bb.lower, false);
    band(this.bb.mid, true);
  }

  private drawSubPane() {
    const { sub } = this.opts;
    if (sub === 'none') return;
    if (sub === 'volume') return this.drawVolume();
    if (sub === 'rsi') return this.drawRsi();
    return this.drawMacd();
  }

  private drawVolume() {
    const ctx = this.ctx;
    const p = this.plot;
    let max = 0;
    for (let i = this.i0; i < this.end; i++) max = Math.max(max, this.bars[i].v);
    if (!max) return;
    const bw = this.candleWidth();
    ctx.globalAlpha = 0.32;
    for (let i = this.i0; i < this.end; i++) {
      const b = this.bars[i];
      const prev = this.bars[i - 1];
      const rising = prev ? b.c >= prev.c : b.c >= b.o;
      const hgt = (b.v / max) * p.subH;
      ctx.fillStyle = rising ? PALETTE.up : PALETTE.down;
      ctx.fillRect(this.xAt(i) - bw / 2, p.subY + p.subH - hgt, bw, hgt);
    }
    ctx.globalAlpha = 1;
  }

  private drawRsi() {
    const ctx = this.ctx;
    const p = this.plot;
    const y = (v: number) => p.subY + (1 - v / 100) * p.subH;

    // 과매수 70 / 과매도 30 기준선
    ctx.strokeStyle = PALETTE.grid;
    ctx.setLineDash([3, 3]);
    for (const lv of [30, 70]) {
      const yy = Math.round(y(lv)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x, yy);
      ctx.lineTo(p.x + p.w, yy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.beginPath();
    let started = false;
    for (let i = this.i0; i < this.end; i++) {
      const v = this.rsiData[i];
      if (v == null) {
        started = false;
        continue;
      }
      const x = this.xAt(i);
      if (!started) {
        ctx.moveTo(x, y(v));
        started = true;
      } else ctx.lineTo(x, y(v));
    }
    ctx.strokeStyle = '#7C8DFF';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.fillStyle = PALETTE.dim;
    ctx.textAlign = 'left';
    ctx.fillText('70', p.x + p.w + 6, y(70));
    ctx.fillText('30', p.x + p.w + 6, y(30));
  }

  private drawMacd() {
    if (!this.macdData) return;
    const ctx = this.ctx;
    const p = this.plot;
    const { macd: line, signal, hist } = this.macdData;

    let max = 0;
    for (let i = this.i0; i < this.end; i++) {
      for (const arr of [line, signal, hist]) {
        const v = arr[i];
        if (v != null) max = Math.max(max, Math.abs(v));
      }
    }
    if (!max) return;
    const y = (v: number) => p.subY + p.subH / 2 - (v / max) * (p.subH / 2) * 0.9;

    const bw = Math.max(1, Math.min(this.cw() * 0.5, 8));
    for (let i = this.i0; i < this.end; i++) {
      const v = hist[i];
      if (v == null) continue;
      ctx.fillStyle = v >= 0 ? hexA(PALETTE.up, 0.55) : hexA(PALETTE.down, 0.55);
      const y0 = y(0);
      const y1 = y(v);
      ctx.fillRect(this.xAt(i) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
    }

    const drawSeries = (arr: (number | null)[], color: string) => {
      ctx.beginPath();
      let started = false;
      for (let i = this.i0; i < this.end; i++) {
        const v = arr[i];
        if (v == null) {
          started = false;
          continue;
        }
        const x = this.xAt(i);
        if (!started) {
          ctx.moveTo(x, y(v));
          started = true;
        } else ctx.lineTo(x, y(v));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };
    drawSeries(line, '#4CC9A0');
    drawSeries(signal, '#FFB020');
  }

  private drawDateAxis() {
    const ctx = this.ctx;
    const p = this.plot;
    ctx.fillStyle = PALETTE.dim;
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(this.count / 4));
    let prev: number | null = null;
    for (let i = this.i0 + step - 1; i < this.end; i += step) {
      const x = this.xAt(i);
      if (x < p.x + 20 || x > p.x + p.w - 20) continue;
      ctx.fillText(fmtAxisDate(this.bars[i].t, this.tf, prev), x, this.h - this.pad.b / 2);
      prev = this.bars[i].t;
    }
  }

  private drawLastPrice(s: { lo: number; hi: number }) {
    const ctx = this.ctx;
    const p = this.plot;
    const last = this.bars[this.end - 1];
    const prev = this.bars[this.end - 2];
    const rising = prev ? last.c >= prev.c : last.c >= last.o;
    const y = this.yPrice(last.c, s);
    if (y < p.y || y > p.y + p.priceH) return;

    const color = rising ? PALETTE.up : PALETTE.down;
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, y);
    ctx.lineTo(p.x + p.w, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const label = nf(this.sym.digits).format(last.c);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = color;
    roundRect(ctx, p.x + p.w + 3, y - 8, tw + 8, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(label, p.x + p.w + 7, y);
  }

  private drawCrosshair(s: { lo: number; hi: number }) {
    const ctx = this.ctx;
    const p = this.plot;
    const i = Math.max(this.i0, Math.min(this.end - 1, this.cross!));
    const b = this.bars[i];
    const x = Math.round(this.xAt(i)) + 0.5;
    const y = Math.round(this.yPrice(b.c, s)) + 0.5;

    ctx.strokeStyle = 'rgba(237,239,243,.4)';
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, p.y);
    ctx.lineTo(x, p.y + p.h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x, y);
    ctx.lineTo(p.x + p.w, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const price = nf(this.sym.digits).format(b.c);
    const tw = ctx.measureText(price).width;
    ctx.fillStyle = PALETTE.text;
    roundRect(ctx, p.x + p.w + 3, y - 8, tw + 8, 16, 4);
    ctx.fill();
    ctx.fillStyle = PALETTE.bg;
    ctx.textAlign = 'left';
    ctx.fillText(price, p.x + p.w + 7, y);

    const ds = fmtDate(b.t, this.tf);
    const dw = ctx.measureText(ds).width + 12;
    const dx = Math.max(p.x, Math.min(p.x + p.w - dw, x - dw / 2));
    ctx.fillStyle = PALETTE.chip;
    roundRect(ctx, dx, this.h - this.pad.b - 1, dw, 16, 4);
    ctx.fill();
    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = 'center';
    ctx.fillText(ds, dx + dw / 2, this.h - this.pad.b + 7);
  }

  private emitCrosshair() {
    if (!this.onCrosshair) return;
    const active = this.cross != null;
    const index = Math.max(this.i0, Math.min(this.end - 1, this.cross ?? this.end - 1));
    const ma = MA_DEFS.flatMap((def) => {
      const v = this.maData.get(def.period)?.[index];
      return v == null ? [] : [{ period: def.period, color: def.color, value: v }];
    });
    this.onCrosshair({ index, bar: this.bars[index], active, ma });
  }

  /* ── 입력 ─────────────────────────────────────────── */

  private bindEvents() {
    const cv = this.cv;
    const pos = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const pt = pos(e);
      this.pointers.set(e.pointerId, pt);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.abs(a.x - b.x) || 1, count: this.count, end: this.end };
        this.drag = null;
        this.cross = null;
        this.draw();
        return;
      }
      this.drag = { x: pt.x, end: this.end, touch: e.pointerType !== 'mouse' };
      if (this.drag.touch) {
        this.cross = this.indexAtX(pt.x);
        this.draw();
      }
    });

    cv.addEventListener('pointermove', (e) => {
      const pt = pos(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, pt);

      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const ratio = (Math.abs(a.x - b.x) || 1) / this.pinch.dist;
        this.count = clamp(Math.round(this.pinch.count / ratio), 15, this.bars.length);
        this.end = clamp(this.pinch.end, this.count, this.bars.length);
        this.draw();
        return;
      }

      if (this.drag) {
        if (this.drag.touch) {
          this.cross = this.indexAtX(pt.x); // 터치: 드래그로 시세 스크럽
        } else {
          const shift = Math.round((pt.x - this.drag.x) / this.cw());
          this.end = clamp(this.drag.end - shift, this.count, this.bars.length);
          this.cross = null; // 마우스: 드래그로 이동
        }
        this.draw();
      } else if (e.pointerType === 'mouse') {
        this.cross = this.indexAtX(pt.x);
        this.draw();
      }
    });

    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.drag?.touch) {
        this.cross = null;
        this.draw();
      }
      this.drag = null;
    };
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', release);
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.drag) {
        this.cross = null;
        this.draw();
      }
    });

    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const anchor = this.indexAtX(pos(e).x);
        const prevCount = this.count;
        const next = clamp(Math.round(prevCount * (e.deltaY > 0 ? 1.15 : 1 / 1.15)), 15, this.bars.length);
        const rightGap = this.end - anchor; // 커서 아래 봉을 제자리에 유지
        this.count = next;
        this.end = clamp(anchor + Math.round((rightGap * next) / prevCount), next, this.bars.length);
        this.draw();
      },
      { passive: false },
    );
  }
}

/* ── 유틸 ─────────────────────────────────────────── */

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 눈금값을 1/2/5 배수로 */
export function niceTicks(lo: number, hi: number, n: number): number[] {
  const raw = (hi - lo) / n;
  if (!Number.isFinite(raw) || raw <= 0) return [];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}
