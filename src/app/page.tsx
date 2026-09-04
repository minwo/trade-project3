import { HomeScreen, type HomeItem } from '@/components/HomeScreen';
import { loadDaily } from '@/lib/sources';
import { SYMBOLS } from '@/lib/symbols';

// 5분마다 다시 생성 (무료 소스 호출량을 아끼기 위해)
export const revalidate = 300;

export default async function HomePage() {
  const items: HomeItem[] = await Promise.all(
    SYMBOLS.map(async (sym) => {
      const { source, bars } = await loadDaily(sym);
      // 홈에서는 스파크라인·등락률만 쓰므로 최근 90봉만 내려보낸다.
      return { id: sym.id, source, bars: bars.slice(-90) };
    }),
  );

  return <HomeScreen items={items} />;
}
