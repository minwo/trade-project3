'use client';

import { useEffect, useRef } from 'react';

import { hexA } from '@/lib/chart/CandleChart';

interface Props {
  values: number[];
  color: string;
  className?: string;
}

/** 카드용 미니 라인 차트 (축·라벨 없음) */
export function Sparkline({ values, color, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || values.length < 2) return;

    const paint = () => {
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const range = hi - lo || 1;
      const x = (i: number) => (i / (values.length - 1)) * w;
      const y = (v: number) => 3 + (1 - (v - lo) / range) * (h - 6);

      ctx.beginPath();
      values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, hexA(color, 0.26));
      g.addColorStop(1, hexA(color, 0));
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    };

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [values, color]);

  return <canvas ref={ref} className={className} />;
}
