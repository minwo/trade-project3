'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CandleChart, type ChartOptions, type CrosshairInfo } from '@/lib/chart/CandleChart';
import { MA_DEFS, SUB_PANE_LABEL, type SubPane } from '@/lib/chart/theme';
import { dirOf, fmtDate, fmtPct, fmtPrice, fmtSigned, fmtVolume, nf } from '@/lib/format';
import { aggregate, quoteOf, stats } from '@/lib/series';
import type { Bar, CandlesResponse, SymbolDef, Timeframe } from '@/lib/types';

import styles from './QuoteScreen.module.css';

interface Props {
  sym: SymbolDef;
  bars: Bar[];
  source: CandlesResponse['source'];
}

const TF_LABEL: Record<Timeframe, string> = { D: '일봉', W: '주봉', M: '월봉' };

const RANGES: Record<Timeframe, { label: string; count: number }[]> = {
  D: [
    { label: '3개월', count: 66 },
    { label: '6개월', count: 130 },
    { label: '1년', count: 252 },
    { label: '3년', count: 756 },
    { label: '전체', count: Number.MAX_SAFE_INTEGER },
  ],
  W: [
    { label: '1년', count: 52 },
    { label: '2년', count: 104 },
    { label: '3년', count: 156 },
    { label: '5년', count: 260 },
    { label: '전체', count: Number.MAX_SAFE_INTEGER },
  ],
  M: [
    { label: '1년', count: 12 },
    { label: '3년', count: 36 },
    { label: '5년', count: 60 },
    { label: '10년', count: 120 },
    { label: '전체', count: Number.MAX_SAFE_INTEGER },
  ],
};

const DEFAULT_RANGE: Record<Timeframe, number> = { D: 1, W: 2, M: 2 };

export function QuoteScreen({ sym, bars: initialBars, source }: Props) {
  const [bars, setBars] = useState(initialBars);
  const [tf, setTf] = useState<Timeframe>('D');
  const [rangeIdx, setRangeIdx] = useState(DEFAULT_RANGE.D);
  const [opts, setOpts] = useState<ChartOptions>({
    type: 'candle',
    ma: [5, 20, 60],
    bollinger: false,
    sub: 'volume',
  });
  const [info, setInfo] = useState<CrosshairInfo | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<CandleChart | null>(null);
  const lastKey = useRef('');
  const prevTf = useRef<Timeframe>(tf);

  const view = useMemo(() => aggregate(bars, tf), [bars, tf]);
  const quote = useMemo(() => quoteOf(bars), [bars]);
  const summary = useMemo(() => stats(bars), [bars]);

  /* 차트 인스턴스 생성 / 정리 */
  useEffect(() => {
    if (!canvasRef.current) return;
    const chart = new CandleChart(canvasRef.current);
    chart.onCrosshair = (next) => {
      const key = `${next.index}:${next.active}`;
      if (key === lastKey.current) return; // 같은 봉이면 리렌더 생략
      lastKey.current = key;
      setInfo(next);
    };
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  /* 데이터 / 봉 종류 변경 */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !view.length) return;
    const tfChanged = prevTf.current !== tf;
    prevTf.current = tf;
    chart.setData(sym, view, tf, !tfChanged); // 폴링 갱신 때는 보던 구간 유지
    if (tfChanged) {
      const idx = DEFAULT_RANGE[tf];
      setRangeIdx(idx);
      chart.setWindow(RANGES[tf][idx].count);
    }
  }, [sym, view, tf]);

  /* 지표 옵션 변경 */
  useEffect(() => {
    chartRef.current?.setOptions(opts);
  }, [opts]);

  /* 실시세일 때만 60초 폴링 */
  useEffect(() => {
    if (source === 'mock') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/candles/${sym.id}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as CandlesResponse;
        if (data.bars?.length) setBars(data.bars);
      } catch {
        /* 네트워크 오류는 조용히 무시하고 다음 주기에 재시도 */
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [sym.id, source]);

  const shown = info?.bar ?? view[view.length - 1];
  const shownPrev = info ? view[info.index - 1] : view[view.length - 2];
  const shownDiff = shown && shownPrev ? shown.c - shownPrev.c : 0;

  const toggleMa = (period: number) =>
    setOpts((o) => ({
      ...o,
      ma: o.ma.includes(period) ? o.ma.filter((p) => p !== period) : [...o.ma, period],
    }));

  return (
    <>
      <header className={styles.topbar}>
        <Link href="/" className={styles.back} aria-label="뒤로">
          ‹
        </Link>
        <span className={styles.topTitle}>{sym.name}</span>
        <span className={styles.sourceTag}>
          {source === 'mock' ? '모의' : source === 'binance' ? 'Binance' : 'Yahoo'}
        </span>
      </header>

      <section className={styles.head}>
        <p className={styles.headTag}>{sym.tag}</p>
        <p className={`${styles.headPrice} num`}>{fmtPrice(sym, quote.last.c)}</p>
        <p className={`${styles.headChange} num ${dirOf(quote.diff)}`}>
          {fmtSigned(sym, quote.diff)} ({fmtPct(quote.pct)}) · 전일 대비
        </p>
      </section>

      {/* 봉 종류 · 차트 유형 */}
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {(['D', 'W', 'M'] as Timeframe[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.tab} ${tf === t ? styles.tabOn : ''}`}
              onClick={() => setTf(t)}
            >
              {TF_LABEL[t]}
            </button>
          ))}
        </div>
        <div className={styles.tabs}>
          {(['candle', 'line'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.tab} ${opts.type === t ? styles.tabOn : ''}`}
              onClick={() => setOpts((o) => ({ ...o, type: t }))}
            >
              {t === 'candle' ? '캔들' : '라인'}
            </button>
          ))}
        </div>
      </div>

      {/* 크로스헤어 정보 */}
      <div className={`${styles.ohlc} num`}>
        {shown && (
          <>
            <span>
              {fmtDate(shown.t, tf)}
              {info?.active ? '' : ' (최근)'}
            </span>
            <span>
              시<b className={dirOf(shownDiff)}>{nf(sym.digits).format(shown.o)}</b>
            </span>
            <span>
              고<b className={dirOf(shownDiff)}>{nf(sym.digits).format(shown.h)}</b>
            </span>
            <span>
              저<b className={dirOf(shownDiff)}>{nf(sym.digits).format(shown.l)}</b>
            </span>
            <span>
              종<b className={dirOf(shownDiff)}>{nf(sym.digits).format(shown.c)}</b>
            </span>
            <span>
              거래량<b>{fmtVolume(shown.v)}</b>
            </span>
            {info?.ma.map((m) => (
              <span key={m.period} style={{ color: m.color }}>
                MA{m.period} {nf(sym.digits).format(m.value)}
              </span>
            ))}
          </>
        )}
      </div>

      <div className={styles.chartWrap}>
        <canvas ref={canvasRef} className={styles.chart} />
        <span className={styles.hint}>드래그로 시세 확인 · 휠 / 두 손가락으로 확대</span>
      </div>

      <div className={styles.ranges}>
        {RANGES[tf].map((r, i) => (
          <button
            key={r.label}
            type="button"
            className={`${styles.rangeBtn} ${rangeIdx === i ? styles.rangeOn : ''}`}
            onClick={() => {
              setRangeIdx(i);
              chartRef.current?.setWindow(r.count);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* 이동평균선 */}
      <div className={styles.indicatorBlock}>
        <p className={styles.indicatorLabel}>이동평균선</p>
        <div className={styles.chips}>
          {MA_DEFS.map((d) => {
            const on = opts.ma.includes(d.period);
            return (
              <button
                key={d.period}
                type="button"
                className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                style={on ? { color: d.color, borderColor: d.color } : undefined}
                onClick={() => toggleMa(d.period)}
              >
                <i className={styles.swatch} style={{ background: d.color, opacity: on ? 1 : 0.35 }} />
                MA{d.period}
              </button>
            );
          })}
          <button
            type="button"
            className={`${styles.chip} ${opts.bollinger ? styles.chipOn : ''}`}
            onClick={() => setOpts((o) => ({ ...o, bollinger: !o.bollinger }))}
          >
            볼린저밴드
          </button>
        </div>
      </div>

      {/* 보조지표 */}
      <div className={styles.indicatorBlock}>
        <p className={styles.indicatorLabel}>보조지표</p>
        <div className={styles.chips}>
          {(['volume', 'rsi', 'macd', 'none'] as SubPane[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.chip} ${opts.sub === s ? styles.chipOn : ''}`}
              onClick={() => setOpts((o) => ({ ...o, sub: s }))}
            >
              {SUB_PANE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* 시세 요약 */}
      <section className={styles.stats}>
        <Stat k="전일 종가" v={fmtPrice(sym, quote.prev.c)} />
        <Stat k="시가" v={fmtPrice(sym, quote.last.o)} />
        <Stat k="고가 / 저가" v={`${fmtPrice(sym, quote.last.h)} / ${fmtPrice(sym, quote.last.l)}`} />
        <Stat k="거래량" v={fmtVolume(quote.last.v)} />
        <Stat k="52주 최고" v={fmtPrice(sym, summary.high52)} />
        <Stat k="52주 최저" v={fmtPrice(sym, summary.low52)} />
        <Stat
          k="연초 대비"
          v={<span className={dirOf(summary.ytd)}>{fmtPct(summary.ytd)}</span>}
        />
      </section>

      <section className={styles.guide}>
        <p className={styles.guideTitle}>지표 읽는 법</p>
        <dl className={styles.guideList}>
          <div>
            <dt>이동평균선(MA)</dt>
            <dd>기간 평균 종가. 단기선이 장기선을 위로 뚫으면 골든크로스, 반대는 데드크로스.</dd>
          </div>
          <div>
            <dt>볼린저밴드</dt>
            <dd>20일 평균 ±2σ. 밴드 폭이 좁아지면 변동성 수축, 넓어지면 확장 국면.</dd>
          </div>
          <div>
            <dt>RSI(14)</dt>
            <dd>상승/하락 강도. 통상 70 이상 과매수, 30 이하 과매도로 본다.</dd>
          </div>
          <div>
            <dt>MACD(12,26,9)</dt>
            <dd>단기·장기 EMA 차이. 히스토그램이 0선을 넘는 지점을 추세 전환 신호로 읽는다.</dd>
          </div>
        </dl>
      </section>

      <p className={`${styles.foot} muted`}>
        이동평균선은 선택한 봉 기준으로 계산됩니다. (주봉 MA20 = 최근 20주 종가 평균)
        <br />
        {source === 'mock'
          ? '모의 데이터 기반 데모 화면입니다.'
          : '무료 공개 API의 지연 시세이며 투자 판단 근거로 쓸 수 없습니다.'}
      </p>
    </>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statKey}>{k}</span>
      <span className={`${styles.statVal} num`}>{v}</span>
    </div>
  );
}
