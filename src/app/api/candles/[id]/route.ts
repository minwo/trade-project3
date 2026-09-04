import { NextResponse } from 'next/server';

import { loadDaily } from '@/lib/sources';
import { getSymbol } from '@/lib/symbols';

/**
 * GET /api/candles/:id  →  { id, source, bars: Bar[] }
 * 일봉만 내려주고 주봉·월봉은 클라이언트에서 aggregate() 로 만든다.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sym = getSymbol(id);
  if (!sym) return NextResponse.json({ error: 'unknown symbol' }, { status: 404 });

  const data = await loadDaily(sym);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
  });
}
