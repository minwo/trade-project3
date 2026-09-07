import type { Metadata, Viewport } from 'next';

import { TabBar } from '@/components/TabBar';

import './globals.css';

export const metadata: Metadata = {
    title: '지수 · 투자',
    description: '나스닥 · S&P 500 · 비트코인 · 코스피 · 코스닥 지수와 일봉/주봉/월봉 차트',
};

export const viewport: Viewport = {
    themeColor: '#101114',
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ko">
            <body>
                <div className="shell">{children}</div>
                <TabBar />
            </body>
        </html>
    );
}
