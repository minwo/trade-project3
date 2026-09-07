import { notFound } from 'next/navigation';

import { QuoteScreen } from '@/components/QuoteScreen';
import { loadDaily } from '@/lib/sources';
import { SYMBOLS, getSymbol } from '@/lib/symbols';

export const revalidate = 300;

export function generateStaticParams() {
    return SYMBOLS.map((s) => ({ id: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const sym = getSymbol(id);
    return { title: sym ? `${sym.name} · 지수` : '지수' };
}

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const sym = getSymbol(id);
    if (!sym) notFound();

    const { bars, source } = await loadDaily(sym);
    return <QuoteScreen sym={sym} bars={bars} source={source} />;
}
