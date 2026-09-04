'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './TabBar.module.css';

const TABS = [
  { href: '/', label: '홈', icon: '⌂' },
  { href: '/?tab=market', label: '지수', icon: '◈' },
  { href: '/?tab=news', label: '뉴스', icon: '☰' },
  { href: '/?tab=my', label: '내 정보', icon: '☺' },
];

/** 토스 앱처럼 하단 고정 탭바. MVP에서는 홈만 실제 화면이 있다. */
export function TabBar() {
  const pathname = usePathname();
  const onHome = pathname === '/';

  return (
    <nav className={styles.bar} aria-label="주요 메뉴">
      <div className={styles.inner}>
        {TABS.map((t, i) => (
          <Link
            key={t.label}
            href={t.href}
            className={`${styles.tab} ${onHome && i === 0 ? styles.on : ''}`}
          >
            <span className={styles.icon} aria-hidden>
              {t.icon}
            </span>
            <span>{t.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
