/* =============================================================================
   지수 웹앱 — 데이터 소스 + 차트 엔진 + 화면 로직 (의존성 없음)
   ---------------------------------------------------------------------------
   데이터 소스는 CONFIG.source 로 교체한다.
     'mock'   : 결정론적 모의 시세 (기본, 네트워크 불필요)
     'yahoo'  : Yahoo Finance chart API (CORS 때문에 CONFIG.proxy 필요)
     'hybrid' : 코인은 Binance(브라우저 직접 호출 가능), 나머지는 yahoo
   자세한 소스 비교는 README.md 참고.
============================================================================= */

const CONFIG = {
  source: 'mock',          // 'mock' | 'yahoo' | 'hybrid'
  proxy: '',               // 예: 'https://my-worker.workers.dev/?url=' (뒤에 인코딩된 URL을 붙임)
  liveTick: true,          // mock 모드에서 마지막 봉을 실시간처럼 흔들기
};

/* ── 종목 정의 ─────────────────────────────────────────────────────────── */
const SYMBOLS = [
  { id:'IXIC', name:'나스닥 종합', tag:'미국 · NASDAQ', cat:'overseas',
    yahoo:'%5EIXIC', digits:2, base:21850, vol:0.0118, drift:0.00042, seed:1101, weekend:false },
  { id:'SPX',  name:'S&P 500',   tag:'미국 · S&P',     cat:'overseas',
    yahoo:'%5EGSPC', digits:2, base:6710,  vol:0.0091, drift:0.00038, seed:2202, weekend:false },
  { id:'BTC',  name:'비트코인',   tag:'코인 · BTC/USD', cat:'crypto',
    yahoo:'BTC-USD', binance:'BTCUSDT', digits:0, prefix:'$',
    base:112400, vol:0.0285, drift:0.00085, seed:3303, weekend:true },
  { id:'KS11', name:'코스피',     tag:'한국 · KOSPI',   cat:'domestic',
    yahoo:'%5EKS11', digits:2, base:3186, vol:0.0104, drift:0.00030, seed:4404, weekend:false },
  { id:'KQ11', name:'코스닥',     tag:'한국 · KOSDAQ',  cat:'domestic',
    yahoo:'%5EKQ11', digits:2, base:812,  vol:0.0138, drift:0.00018, seed:5505, weekend:false },
];

const MA_DEFS = [
  { p:5,   color:'#FFB020', on:true  },
  { p:20,  color:'#7C8DFF', on:true  },
  { p:60,  color:'#4CC9A0', on:true  },
  { p:120, color:'#E27DFF', on:false },
];

/* =============================================================================
   1. 데이터 소스
============================================================================= */

/* mulberry32 — 시드 고정 난수 (새로고침해도 같은 차트가 나오도록) */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 정규분포 근사 (Box–Muller) */
function gauss(r) {
  const u = Math.max(r(), 1e-9), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 모의 일봉 생성. GBM + 변동성 레짐 + 갭으로 그럴듯한 캔들을 만들고,
 * 마지막 종가가 sym.base 가 되도록 전체 경로를 스케일링한다.
 */
function mockDaily(sym, days = sym.weekend ? 2100 : 1500) {
  const r = rng(sym.seed);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 거래일 캘린더 (지수는 주말 제외)
  const dates = [];
  for (let d = new Date(today), n = 0; n < days * 1.5 && dates.length < days; d = addDays(d, -1), n++) {
    const wd = d.getDay();
    if (!sym.weekend && (wd === 0 || wd === 6)) continue;
    dates.push(new Date(d));
  }
  dates.reverse();

  const bars = [];
  let price = 100, regime = 1;
  for (let i = 0; i < dates.length; i++) {
    if (r() < 0.02) regime = 0.6 + r() * 1.9;                 // 가끔 변동성 레짐 전환
    regime += (1 - regime) * 0.03;
    const sd = sym.vol * regime;
    const ret = sym.drift - sd * sd / 2 + sd * gauss(r);

    const prevClose = price;
    const open  = prevClose * (1 + sd * 0.25 * gauss(r));      // 갭
    const close = prevClose * Math.exp(ret);
    const wick  = sd * (0.5 + r() * 1.1);
    const high  = Math.max(open, close) * (1 + wick * r());
    const low   = Math.min(open, close) * (1 - wick * r());
    const swing = Math.abs(close / prevClose - 1) / sd;
    const vol   = (0.6 + r() * 0.8 + swing * 0.7);

    bars.push({ t: dates[i].getTime(), o: open, h: high, l: low, c: close, v: vol });
    price = close;
  }

  // 마지막 종가를 base 에 맞추고, 거래량도 종목별 스케일로
  const k = sym.base / bars[bars.length - 1].c;
  const vScale = sym.id === 'BTC' ? 4.2e4 : sym.id === 'KQ11' ? 9.5e8 : sym.id === 'KS11' ? 4.8e8 : 5.2e9;
  for (const b of bars) {
    b.o *= k; b.h *= k; b.l *= k; b.c *= k;
    b.v = Math.round(b.v * vScale);
  }
  return bars;
}

/* --- Yahoo Finance ---------------------------------------------------------
   GET https://query1.finance.yahoo.com/v8/finance/chart/^IXIC?interval=1d&range=10y
   무료 · 키 불필요 · 5개 지수(^IXIC ^GSPC ^KS11 ^KQ11 BTC-USD) 전부 커버.
   단, CORS 헤더를 주지 않으므로 브라우저에서 직접 호출 불가 → 프록시 필요.       */
async function yahooDaily(sym) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.yahoo}?interval=1d&range=10y`;
  const url = CONFIG.proxy ? CONFIG.proxy + encodeURIComponent(target) : target;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const json = await res.json();
  const rs = json.chart?.result?.[0];
  if (!rs) throw new Error('yahoo: empty result');
  const q = rs.indicators.quote[0];
  const out = [];
  rs.timestamp.forEach((ts, i) => {
    if (q.close[i] == null) return;                      // 휴장일 구멍 제거
    out.push({
      t: ts * 1000,
      o: q.open[i] ?? q.close[i], h: q.high[i] ?? q.close[i],
      l: q.low[i] ?? q.close[i],  c: q.close[i], v: q.volume[i] ?? 0,
    });
  });
  return out;
}

/* --- Binance ---------------------------------------------------------------
   GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000
   무료 · 키 불필요 · CORS 허용 → 브라우저에서 그대로 호출 가능 (코인 한정).     */
async function binanceDaily(sym) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${sym.binance}&interval=1d&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const rows = await res.json();
  return rows.map(k => ({
    t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
  }));
}

async function loadDaily(sym) {
  try {
    if (CONFIG.source === 'yahoo') return await yahooDaily(sym);
    if (CONFIG.source === 'hybrid') {
      return sym.binance ? await binanceDaily(sym) : await yahooDaily(sym);
    }
  } catch (e) {
    console.warn(`[${sym.id}] 실시세 로드 실패 → 모의 데이터로 대체`, e);
  }
  return mockDaily(sym);
}

/* =============================================================================
   2. 시계열 유틸
============================================================================= */

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** 일봉 → 주봉/월봉 집계. 시가=구간 첫 시가, 종가=마지막 종가, 고저=구간 극값. */
function aggregate(daily, tf) {
  if (tf === 'D') return daily;
  const keyOf = (t) => {
    const d = new Date(t);
    if (tf === 'M') return d.getFullYear() * 100 + d.getMonth();
    const mon = new Date(d); mon.setHours(0, 0, 0, 0);
    mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));   // 그 주의 월요일
    return mon.getTime();
  };
  const out = [];
  let cur = null, curKey = null;
  for (const b of daily) {
    const k = keyOf(b.t);
    if (k !== curKey) {
      if (cur) out.push(cur);
      cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      curKey = k;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 단순이동평균. 구간이 모자라는 앞부분은 null. */
function sma(bars, period) {
  const out = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= period) sum -= bars[i - period].c;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/* =============================================================================
   3. 포맷터
============================================================================= */

const nf = (d) => new Intl.NumberFormat('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });

function fmtPrice(sym, v) {
  if (v == null || !isFinite(v)) return '–';
  return (sym.prefix || '') + nf(sym.digits).format(v);
}
function fmtSigned(sym, v) {
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return s + nf(sym.digits).format(Math.abs(v));
}
function fmtPct(v) {
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return s + Math.abs(v).toFixed(2) + '%';
}
function fmtVol(v) {
  if (v == null) return '–';
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '억';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '만';
  if (v >= 1e3) return Math.round(v).toLocaleString('ko-KR');
  return v.toFixed(v < 10 ? 2 : 0);
}
function fmtDate(t, tf) {
  const d = new Date(t);
  const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
  if (tf === 'M') return `${y}.${String(m).padStart(2, '0')}`;
  return `${String(y).slice(2)}.${String(m).padStart(2, '0')}.${String(dd).padStart(2, '0')}`;
}
function fmtAxisDate(t, tf, prevT) {
  const d = new Date(t);
  if (tf === 'M') return d.getMonth() === 0 || !prevT ? `${d.getFullYear()}` : `${d.getMonth() + 1}월`;
  const p = prevT ? new Date(prevT) : null;
  if (!p || p.getFullYear() !== d.getFullYear()) return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}`;
  return `${d.getMonth() + 1}.${d.getDate()}`;
}
const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const CSSVAR = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* =============================================================================
   4. 캔들 차트 엔진 (canvas 2D)
============================================================================= */

class CandleChart {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.bars = [];
    this.mas = [];              // [{p, color, on, data:[]}]
    this.type = 'candle';
    this.tf = 'D';
    this.sym = SYMBOLS[0];
    this.count = 120;           // 화면에 보이는 봉 개수
    this.end = 0;               // 오른쪽 끝 인덱스 (exclusive)
    this.cross = null;          // 크로스헤어 인덱스
    this.onCross = null;

    this.pad = { l: 8, r: 58, t: 10, b: 22 };
    this.volRatio = 0.20;

    this._pointers = new Map();
    this._pinch = null;
    this._drag = null;
    this._bindEvents();

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas);
    this.resize();
  }

  setData(sym, daily, tf) {
    this.sym = sym;
    this.tf = tf;
    this.daily = daily;
    this.bars = aggregate(daily, tf);
    this.mas = MA_DEFS.map(d => ({ ...d, data: sma(this.bars, d.p) }));
    this.cross = null;
    this.count = Math.min(this.bars.length, tf === 'D' ? 120 : tf === 'W' ? 100 : 84);
    this.end = this.bars.length;
    this.draw();
  }

  setMaOn(p, on) {
    const m = this.mas.find(x => x.p === p);
    if (m) { m.on = on; this.draw(); }
  }

  setType(t) { this.type = t; this.draw(); }

  /** 최근 n개 봉만 보이도록 (기간 칩) */
  setWindow(n) {
    this.count = Math.max(15, Math.min(this.bars.length, n));
    this.end = this.bars.length;
    this.draw();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.draw();
  }

  /* ── 좌표 헬퍼 ── */
  get i0() { return Math.max(0, this.end - this.count); }
  get plot() {
    const { l, r, t, b } = this.pad;
    const innerH = this.h - t - b;
    const volH = innerH * this.volRatio;
    const gap = 12;
    return { x: l, y: t, w: this.w - l - r, h: innerH, priceH: innerH - volH - gap, volY: t + innerH - volH, volH };
  }
  cw() { return this.plot.w / this.count; }
  xAt(i) { return this.plot.x + (i - this.i0 + 0.5) * this.cw(); }
  iAtX(x) {
    const i = Math.floor((x - this.plot.x) / this.cw()) + this.i0;
    return Math.max(this.i0, Math.min(this.end - 1, i));
  }

  scale() {
    const bars = this.bars;
    let lo = Infinity, hi = -Infinity;
    for (let i = this.i0; i < this.end; i++) {
      if (bars[i].l < lo) lo = bars[i].l;
      if (bars[i].h > hi) hi = bars[i].h;
      for (const m of this.mas) {
        if (!m.on) continue;
        const v = m.data[i];
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }

  yAt(v, s) {
    const p = this.plot;
    return p.y + (1 - (v - s.lo) / (s.hi - s.lo)) * p.priceH;
  }

  maxVol() {
    let m = 0;
    for (let i = this.i0; i < this.end; i++) m = Math.max(m, this.bars[i].v);
    return m || 1;
  }

  /* ── 그리기 ── */
  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.w || !this.bars.length) return;
    const p = this.plot, s = this.scale();
    const up = CSSVAR('--up'), down = CSSVAR('--down');
    const t3 = CSSVAR('--t3'), line = CSSVAR('--line-soft');

    ctx.clearRect(0, 0, this.w, this.h);
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif';
    ctx.textBaseline = 'middle';

    /* 가격 그리드 + 우측 라벨 */
    const ticks = niceTicks(s.lo, s.hi, 5);
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.fillStyle = t3; ctx.textAlign = 'left';
    for (const v of ticks) {
      const y = Math.round(this.yAt(v, s)) + 0.5;
      if (y < p.y || y > p.y + p.priceH) continue;
      ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
      ctx.fillText(nf(this.sym.digits).format(v), p.x + p.w + 6, y);
    }

    /* 거래량 */
    const mv = this.maxVol(), cw = this.cw(), bw = Math.max(1, Math.min(cw * 0.62, 12));
    for (let i = this.i0; i < this.end; i++) {
      const b = this.bars[i], prev = this.bars[i - 1];
      const rising = prev ? b.c >= prev.c : b.c >= b.o;
      const hgt = (b.v / mv) * p.volH;
      ctx.fillStyle = rising ? up : down;
      ctx.globalAlpha = 0.30;
      ctx.fillRect(this.xAt(i) - bw / 2, p.volY + p.volH - hgt, bw, hgt);
    }
    ctx.globalAlpha = 1;

    /* 가격 본체 */
    if (this.type === 'candle') this._drawCandles(s, bw, up, down);
    else this._drawLine(s);

    /* 이동평균선 */
    for (const m of this.mas) {
      if (!m.on) continue;
      ctx.strokeStyle = m.color; ctx.lineWidth = 1.3;
      ctx.beginPath();
      let started = false;
      for (let i = this.i0; i < this.end; i++) {
        const v = m.data[i];
        if (v == null) { started = false; continue; }
        const x = this.xAt(i), y = this.yAt(v, s);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    /* 날짜 축 */
    ctx.fillStyle = t3; ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(this.count / 4));
    let prevT = null;
    for (let i = this.i0 + step - 1; i < this.end; i += step) {
      const x = this.xAt(i);
      if (x < p.x + 18 || x > p.x + p.w - 18) continue;
      ctx.fillText(fmtAxisDate(this.bars[i].t, this.tf, prevT), x, this.h - this.pad.b / 2 - 1);
      prevT = this.bars[i].t;
    }

    /* 마지막 가격 라벨 */
    const last = this.bars[this.end - 1];
    const prevLast = this.bars[this.end - 2];
    const lastRising = prevLast ? last.c >= prevLast.c : last.c >= last.o;
    const ly = this.yAt(last.c, s);
    if (ly > p.y && ly < p.y + p.priceH) {
      ctx.strokeStyle = lastRising ? up : down;
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, ly); ctx.lineTo(p.x + p.w, ly); ctx.stroke();
      ctx.setLineDash([]);
      const label = nf(this.sym.digits).format(last.c);
      ctx.fillStyle = lastRising ? up : down;
      const tw = ctx.measureText(label).width;
      roundRect(ctx, p.x + p.w + 3, ly - 8, tw + 8, 16, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(label, p.x + p.w + 7, ly);
    }

    /* 크로스헤어 */
    if (this.cross != null) this._drawCross(s);
    if (this.onCross) this.onCross(this.cross == null ? this.end - 1 : this.cross, this.cross != null);
  }

  _drawCandles(s, bw, up, down) {
    const ctx = this.ctx;
    for (let i = this.i0; i < this.end; i++) {
      const b = this.bars[i];
      const rising = b.c >= b.o;
      const color = rising ? up : down;
      const x = Math.round(this.xAt(i)) + (bw % 2 ? 0.5 : 0);
      const yO = this.yAt(b.o, s), yC = this.yAt(b.c, s);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, this.yAt(b.h, s)); ctx.lineTo(x, this.yAt(b.l, s));
      ctx.stroke();
      const top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yC - yO));
      ctx.fillRect(x - bw / 2, top, bw, hgt);
    }
  }

  _drawLine(s) {
    const ctx = this.ctx, p = this.plot;
    const first = this.bars[this.i0].c, last = this.bars[this.end - 1].c;
    const color = last >= first ? CSSVAR('--up') : CSSVAR('--down');
    ctx.beginPath();
    for (let i = this.i0; i < this.end; i++) {
      const x = this.xAt(i), y = this.yAt(this.bars[i].c, s);
      i === this.i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();

    const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.priceH);
    g.addColorStop(0, hexA(color, 0.28));
    g.addColorStop(1, hexA(color, 0));
    ctx.lineTo(this.xAt(this.end - 1), p.y + p.priceH);
    ctx.lineTo(this.xAt(this.i0), p.y + p.priceH);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
  }

  _drawCross(s) {
    const ctx = this.ctx, p = this.plot;
    const i = Math.max(this.i0, Math.min(this.end - 1, this.cross));
    const b = this.bars[i];
    const x = Math.round(this.xAt(i)) + 0.5, y = Math.round(this.yAt(b.c, s)) + 0.5;

    ctx.strokeStyle = 'rgba(237,239,243,.45)';
    ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
    ctx.setLineDash([]);

    /* 가격 라벨 */
    const price = nf(this.sym.digits).format(b.c);
    ctx.font = '10px -apple-system, sans-serif';
    const tw = ctx.measureText(price).width;
    ctx.fillStyle = CSSVAR('--t1');
    roundRect(ctx, p.x + p.w + 3, y - 8, tw + 8, 16, 4); ctx.fill();
    ctx.fillStyle = '#0F1012'; ctx.textAlign = 'left'; ctx.fillText(price, p.x + p.w + 7, y);

    /* 날짜 라벨 */
    const ds = fmtDate(b.t, this.tf);
    const dw = ctx.measureText(ds).width + 10;
    const dx = Math.max(p.x, Math.min(p.x + p.w - dw, x - dw / 2));
    ctx.fillStyle = CSSVAR('--bg-elev2');
    roundRect(ctx, dx, this.h - this.pad.b, dw, 15, 4); ctx.fill();
    ctx.fillStyle = CSSVAR('--t1'); ctx.textAlign = 'center';
    ctx.fillText(ds, dx + dw / 2, this.h - this.pad.b + 7.5);
  }

  /* ── 입력 ── */
  _bindEvents() {
    const cv = this.cv;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, pos(e));
      if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        this._pinch = { dist: Math.abs(a.x - b.x) || 1, count: this.count, end: this.end };
        this._drag = null;
        this.cross = null; this.draw();
      } else {
        this._drag = { x: pos(e).x, end: this.end, moved: 0, touch: e.pointerType !== 'mouse' };
        if (e.pointerType !== 'mouse') { this.cross = this.iAtX(pos(e).x); this.draw(); }
      }
    });

    cv.addEventListener('pointermove', (e) => {
      const pt = pos(e);
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, pt);

      if (this._pinch && this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        const d = Math.abs(a.x - b.x) || 1;
        const ratio = d / this._pinch.dist;
        this.count = clamp(Math.round(this._pinch.count / ratio), 15, this.bars.length);
        this.end = clamp(this._pinch.end, this.count, this.bars.length);
        this.draw();
        return;
      }

      if (this._drag) {
        const dx = pt.x - this._drag.x;
        this._drag.moved = Math.max(this._drag.moved, Math.abs(dx));
        if (this._drag.touch) {
          this.cross = this.iAtX(pt.x);            // 터치: 드래그로 시세 스크럽
        } else {
          const shift = Math.round(dx / this.cw());
          this.end = clamp(this._drag.end - shift, this.count, this.bars.length);
          this.cross = null;                       // 마우스: 드래그로 이동
        }
        this.draw();
      } else if (e.pointerType === 'mouse') {
        this.cross = this.iAtX(pt.x);
        this.draw();
      }
    });

    const end = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = null;
      if (this._drag && this._drag.touch) { this.cross = null; this.draw(); }
      this._drag = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this._drag) { this.cross = null; this.draw(); }
    });

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const anchor = this.iAtX(pos(e).x);
      const prevCount = this.count;
      const next = clamp(Math.round(prevCount * (e.deltaY > 0 ? 1.15 : 1 / 1.15)), 15, this.bars.length);
      const rightGap = this.end - anchor;          // 커서 아래 봉이 제자리에 남도록
      this.count = next;
      this.end = clamp(anchor + Math.round(rightGap * next / prevCount), this.count, this.bars.length);
      this.draw();
    }, { passive: false });
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 눈금값을 1/2/5 배수로 예쁘게 */
function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/* =============================================================================
   5. 스파크라인 (홈 카드)
============================================================================= */

function drawSpark(canvas, closes, color) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const lo = Math.min(...closes), hi = Math.max(...closes), rg = hi - lo || 1;
  const x = (i) => (i / (closes.length - 1)) * w;
  const y = (v) => 3 + (1 - (v - lo) / rg) * (h - 6);

  ctx.beginPath();
  closes.forEach((c, i) => (i ? ctx.lineTo(x(i), y(c)) : ctx.moveTo(x(i), y(c))));
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, hexA(color, 0.25));
  g.addColorStop(1, hexA(color, 0));
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
}

/* =============================================================================
   6. 화면 로직
============================================================================= */

const $ = (s) => document.querySelector(s);
const store = new Map();      // id -> { sym, daily }
let chart = null;
let current = null;           // 상세에 열린 sym
let tf = 'D', chartType = 'candle';
let filter = 'all';

const RANGES = {
  D: [{ l: '3개월', n: 66 }, { l: '6개월', n: 130 }, { l: '1년', n: 252 }, { l: '3년', n: 756 }, { l: '전체', n: 1e9 }],
  W: [{ l: '1년', n: 52 }, { l: '2년', n: 104 }, { l: '3년', n: 156 }, { l: '5년', n: 260 }, { l: '전체', n: 1e9 }],
  M: [{ l: '1년', n: 12 }, { l: '3년', n: 36 }, { l: '5년', n: 60 }, { l: '10년', n: 120 }, { l: '전체', n: 1e9 }],
};

function quote(daily) {
  const last = daily[daily.length - 1], prev = daily[daily.length - 2];
  const diff = last.c - prev.c;
  return { last, prev, diff, pct: (diff / prev.c) * 100 };
}

/* ── 홈 ── */
function renderHome() {
  const grid = $('#grid'), cmp = $('#cmp');
  grid.innerHTML = ''; cmp.innerHTML = '';

  const list = SYMBOLS.filter(s => filter === 'all' || s.cat === filter);
  for (const sym of list) {
    const st = store.get(sym.id);
    if (!st) continue;
    const q = quote(st.daily);
    const cls = dirClass(q.diff);
    const color = q.diff >= 0 ? CSSVAR('--up') : CSSVAR('--down');

    const card = document.createElement('button');
    card.className = 'card';
    card.innerHTML = `
      <div class="nm">${sym.name}</div>
      <div class="tag">${sym.tag}</div>
      <div class="val num">${fmtPrice(sym, q.last.c)}</div>
      <div class="chg num ${cls}">${fmtSigned(sym, q.diff)} · ${fmtPct(q.pct)}</div>
      <canvas></canvas>`;
    card.addEventListener('click', () => openDetail(sym));
    grid.appendChild(card);
    requestAnimationFrame(() =>
      drawSpark(card.querySelector('canvas'), st.daily.slice(-60).map(b => b.c), color));
  }

  /* 등락률 비교 바 */
  const quotes = SYMBOLS.map(s => ({ sym: s, q: quote(store.get(s.id).daily) }));
  const max = Math.max(0.5, ...quotes.map(x => Math.abs(x.q.pct)));
  for (const { sym, q } of quotes) {
    const w = (Math.abs(q.pct) / max) * 50;
    const rise = q.pct >= 0;
    const row = document.createElement('div');
    row.className = 'cmp-row';
    row.innerHTML = `
      <div class="nm">${sym.name}</div>
      <div class="cmp-bar">
        <span class="zero"></span>
        <i style="${rise ? 'left:50%' : `right:50%`};width:${w}%;background:${rise ? CSSVAR('--up') : CSSVAR('--down')}"></i>
      </div>
      <div class="pc num ${dirClass(q.pct)}">${fmtPct(q.pct)}</div>`;
    row.addEventListener('click', () => openDetail(sym));
    cmp.appendChild(row);
  }

  /* 요약 문구 */
  const ups = quotes.filter(x => x.q.pct > 0).length;
  const downs = quotes.filter(x => x.q.pct < 0).length;
  const best = quotes.reduce((a, b) => (b.q.pct > a.q.pct ? b : a));
  $('#sumLine').innerHTML =
    `<span class="up">상승 ${ups}</span> · <span class="down">하락 ${downs}</span> · 보합 ${quotes.length - ups - downs}`;
  $('#sumSub').textContent =
    `가장 많이 오른 지수는 ${best.sym.name} (${fmtPct(best.q.pct)})`;
}

/* ── 상세 ── */
function openDetail(sym) {
  current = sym;
  const st = store.get(sym.id);
  $('#dTitle').textContent = sym.name;
  $('#dSub').textContent = sym.tag;

  const detail = $('#detail');
  detail.classList.add('open');
  detail.setAttribute('aria-hidden', 'false');
  detail.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  location.hash = sym.id;

  if (!chart) initChart();
  chart.setData(sym, st.daily, tf);
  renderRanges();
  renderHead();
  renderStats();
}

function closeDetail() {
  const detail = $('#detail');
  detail.classList.remove('open');
  detail.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  current = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

function renderHead() {
  const sym = current, st = store.get(sym.id);
  const q = quote(st.daily);
  $('#dVal').textContent = fmtPrice(sym, q.last.c);
  const el = $('#dChg');
  el.className = 'chg num ' + dirClass(q.diff);
  el.textContent = `${fmtSigned(sym, q.diff)} (${fmtPct(q.pct)}) · 전일 대비`;
}

function renderOhlc(i, hovering) {
  const b = chart.bars[i], prev = chart.bars[i - 1];
  const sym = current;
  const diff = prev ? b.c - prev.c : b.c - b.o;
  const pct = prev ? (diff / prev.c) * 100 : (diff / b.o) * 100;
  const cls = dirClass(diff);
  const maTxt = chart.mas.filter(m => m.on && m.data[i] != null)
    .map(m => `<span style="color:${m.color}">MA${m.p} ${nf(sym.digits).format(m.data[i])}</span>`)
    .join('');
  $('#ohlc').innerHTML = `
    <span>${fmtDate(b.t, chart.tf)}${hovering ? '' : ' (최근)'}</span>
    <span>시<b class="${cls}">${nf(sym.digits).format(b.o)}</b></span>
    <span>고<b class="${cls}">${nf(sym.digits).format(b.h)}</b></span>
    <span>저<b class="${cls}">${nf(sym.digits).format(b.l)}</b></span>
    <span>종<b class="${cls}">${nf(sym.digits).format(b.c)}</b></span>
    <span class="${cls}">${fmtPct(pct)}</span>
    <span>거래량<b>${fmtVol(b.v)}</b></span>
    ${maTxt}`;
}

function renderStats() {
  const sym = current, st = store.get(sym.id);
  const d = st.daily, q = quote(d);
  const yr = d.slice(-252);
  const hi52 = Math.max(...yr.map(b => b.h)), lo52 = Math.min(...yr.map(b => b.l));
  const jan = d.find(b => new Date(b.t).getFullYear() === new Date().getFullYear());
  const ytd = jan ? ((q.last.c - jan.o) / jan.o) * 100 : 0;

  const rows = [
    ['전일 종가', fmtPrice(sym, q.prev.c)],
    ['시가', fmtPrice(sym, q.last.o)],
    ['고가 / 저가', `${fmtPrice(sym, q.last.h)} / ${fmtPrice(sym, q.last.l)}`],
    ['거래량', fmtVol(q.last.v)],
    ['52주 최고', fmtPrice(sym, hi52)],
    ['52주 최저', fmtPrice(sym, lo52)],
    ['연초 대비', `<span class="${dirClass(ytd)}">${fmtPct(ytd)}</span>`],
  ];
  $('#stats').innerHTML = rows
    .map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v num">${v}</span></div>`)
    .join('');
}

function renderRanges() {
  const box = $('#ranges');
  box.innerHTML = '';
  RANGES[tf].forEach((r, idx) => {
    const b = document.createElement('button');
    b.textContent = r.l;
    if (idx === (tf === 'D' ? 1 : 2)) b.classList.add('on');
    b.addEventListener('click', () => {
      [...box.children].forEach(c => c.classList.remove('on'));
      b.classList.add('on');
      chart.setWindow(r.n);
    });
    box.appendChild(b);
  });
  const def = RANGES[tf][tf === 'D' ? 1 : 2];
  chart.setWindow(def.n);
}

function renderMaLegend() {
  const box = $('#maLegend');
  box.innerHTML = '';
  MA_DEFS.forEach(d => {
    const b = document.createElement('button');
    b.style.setProperty('--maColor', d.color);
    b.style.color = d.on ? d.color : '';
    b.className = d.on ? 'on' : '';
    b.innerHTML = `<span class="sw"></span>MA${d.p}`;
    b.addEventListener('click', () => {
      d.on = !d.on;
      b.classList.toggle('on', d.on);
      b.style.color = d.on ? d.color : '';
      if (chart) chart.setMaOn(d.p, d.on);
    });
    box.appendChild(b);
  });
}

function initChart() {
  chart = new CandleChart($('#chart'));
  chart.onCross = (i, hovering) => renderOhlc(i, hovering);
  renderMaLegend();
}

/* ── 이벤트 배선 ── */
function bindUI() {
  $('#seg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...e.currentTarget.children].forEach(c => c.classList.remove('on'));
    b.classList.add('on');
    filter = b.dataset.cat;
    renderHome();
  });

  $('#tfTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...e.currentTarget.children].forEach(c => c.classList.remove('on'));
    b.classList.add('on');
    tf = b.dataset.tf;
    chart.setData(current, store.get(current.id).daily, tf);
    renderRanges();
  });

  $('#typeTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...e.currentTarget.children].forEach(c => c.classList.remove('on'));
    b.classList.add('on');
    chartType = b.dataset.type;
    chart.setType(chartType);
  });

  $('#back').addEventListener('click', closeDetail);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) closeDetail(); });
  window.addEventListener('popstate', () => { if (current) closeDetail(); });

  setInterval(() => {
    $('#clock').textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  }, 1000);
}

/* ── 모의 실시간 틱: 마지막 봉의 종가/고저/거래량을 조금씩 갱신 ── */
function startTicker() {
  if (!CONFIG.liveTick || CONFIG.source !== 'mock') return;
  const r = rng(Date.now() & 0xffff);
  setInterval(() => {
    for (const sym of SYMBOLS) {
      const d = store.get(sym.id).daily;
      const b = d[d.length - 1];
      const step = sym.vol * 0.16 * gauss(r);
      b.c = Math.max(b.l * 0.98, b.c * (1 + step));
      b.h = Math.max(b.h, b.c);
      b.l = Math.min(b.l, b.c);
      b.v = Math.round(b.v * (1 + Math.abs(step) * 0.6));
    }
    renderHome();
    if (current) {
      const d = store.get(current.id).daily;
      chart.bars = aggregate(d, tf);
      chart.mas = MA_DEFS.map(x => {
        const prev = chart.mas.find(m => m.p === x.p);
        return { ...x, on: prev ? prev.on : x.on, data: sma(chart.bars, x.p) };
      });
      chart.draw();
      renderHead();
      renderStats();
    }
  }, 2500);
}

/* ── 부팅 ── */
(async function boot() {
  const results = await Promise.all(SYMBOLS.map(async (sym) => ({ sym, daily: await loadDaily(sym) })));
  results.forEach(r => store.set(r.sym.id, r));
  bindUI();
  renderHome();
  startTicker();

  const hash = location.hash.slice(1);
  const target = SYMBOLS.find(s => s.id === hash);
  if (target) openDetail(target);
})();
