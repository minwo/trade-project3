'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PALETTE } from '@/lib/chart/theme';
import { dirOf, fmtPct, fmtPrice, fmtSigned } from '@/lib/format';
import { quoteOf } from '@/lib/series';
import { CATEGORY_LABEL, SYMBOLS } from '@/lib/symbols';
import type { Bar } from '@/lib/types';

import { Sparkline } from './Sparkline';
import styles from './HomeScreen.module.css';

export interface HomeItem {
  id: string;
  source: 'yahoo' | 'binance' | 'mock';
  bars: Bar[];
}

const FILTERS = ['all', 'overseas', 'domestic', 'crypto'] as const;
type Filter = (typeof FILTERS)[number];

export function HomeScreen({ items }: { items: HomeItem[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(
    () =>
      SYMBOLS.flatMap((sym) => {
        const item = items.find((i) => i.id === sym.id);
        if (!item || item.bars.length < 2) return [];
        return [{ sym, item, quote: quoteOf(item.bars) }];
      }),
    [items],
  );

  const visible = rows.filter((r) => filter === 'all' || r.sym.cat === filter);
  const ups = rows.filter((r) => r.quote.pct > 0).length;
  const downs = rows.filter((r) => r.quote.pct < 0).length;
  const best = rows.reduce((a, b) => (b.quote.pct > a.quote.pct ? b : a), rows[0]);
  const live = rows.some((r) => r.item.source !== 'mock');

  return (
    <>
      <header className={styles.topbar}>
        <h1 className={styles.brand}>지수</h1>
        <span className={styles.badge}>
          <i className={`${styles.dot} ${live ? styles.dotLive : ''}`} />
          {live ? '실시세' : '모의 시세'}
        </span>
      </header>

      <section className={styles.summary}>
        <p className={styles.summaryCap}>오늘의 시장</p>
        <p className={styles.summaryLine}>
          <span className="up">상승 {ups}</span>
          <span className={styles.divider}>·</span>
          <span className="down">하락 {downs}</span>
          <span className={styles.divider}>·</span>
          <span className="flat">보합 {rows.length - ups - downs}</span>
        </p>
        {best && (
          <p className={styles.summarySub}>
            가장 많이 오른 지수는 {best.sym.name} ({fmtPct(best.quote.pct)})
          </p>
        )}
      </section>

      {/* 가로 스크롤 지수 카드 */}
      <div className={styles.cardRow}>
        {rows.map(({ sym, item, quote }) => {
          const color = quote.diff >= 0 ? PALETTE.up : PALETTE.down;
          return (
            <Link key={sym.id} href={`/quote/${sym.id}`} className={styles.card}>
              <p className={styles.cardName}>{sym.name}</p>
              <p className={`${styles.cardValue} num`}>{fmtPrice(sym, quote.last.c)}</p>
              <p className={`${styles.cardChange} num ${dirOf(quote.diff)}`}>
                {fmtSigned(sym, quote.diff)} · {fmtPct(quote.pct)}
              </p>
              <Sparkline
                values={item.bars.slice(-60).map((b) => b.c)}
                color={color}
                className={styles.spark}
              />
            </Link>
          );
        })}
      </div>

      <nav className={styles.seg}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.segBtn} ${filter === f ? styles.segOn : ''}`}
            onClick={() => setFilter(f)}
          >
            {CATEGORY_LABEL[f]}
          </button>
        ))}
      </nav>

      <ul className={styles.list}>
        {visible.map(({ sym, quote }, i) => (
          <li key={sym.id}>
            <Link href={`/quote/${sym.id}`} className={styles.row}>
              <span className={styles.rank}>{i + 1}</span>
              <span className={styles.avatar} aria-hidden>
                {sym.badge}
              </span>
              <span className={styles.rowMain}>
                <span className={styles.rowName}>{sym.name}</span>
                <span className={styles.rowTag}>{sym.tag}</span>
              </span>
              <span className={styles.rowRight}>
                <span className={`${styles.rowPrice} num`}>{fmtPrice(sym, quote.last.c)}</span>
                <span className={`${styles.rowPct} num ${dirOf(quote.pct)}`}>
                  {fmtPct(quote.pct)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className={`${styles.foot} muted`}>
        {live
          ? '무료 공개 API에서 받아온 지연 시세입니다. 실제 투자 판단에 사용하지 마세요.'
          : '표시되는 시세는 데모용 모의 데이터입니다. 실제 투자 판단에 사용하지 마세요.'}
      </p>
    </>
  );
}
