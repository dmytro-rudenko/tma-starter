import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { setTab, useTab, type Tab } from '../../state/tabs';
import s from './TabBar.module.css';

const svg = (children: ReactNode) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const TABS: readonly { tab: Tab; label: string; icon: ReactNode }[] = [
  {
    tab: 'home',
    label: 'nav.home',
    icon: svg(
      <>
        <path d="M4 11.5 12 5l8 6.5" />
        <path d="M6 10.5V19h12v-8.5" />
      </>,
    ),
  },
  // tma:shop:start
  {
    tab: 'shop',
    label: 'shop.tab',
    icon: svg(
      <>
        <path d="M5 8h14l-1 12H6L5 8z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>,
    ),
  },
  // tma:shop:end
  {
    tab: 'settings',
    label: 'nav.settings',
    icon: svg(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
      </>,
    ),
  },
];

export function TabBar({
  hidden = false,
  collapsed = false,
  onReveal,
}: {
  hidden?: boolean;
  collapsed?: boolean;
  onReveal?: () => void;
}) {
  const { t } = useTranslation();
  const current = useTab();
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, tab: Tab) => {
    const i = TABS.findIndex((x) => x.tab === tab);
    const n = TABS.length;
    const target: Record<string, number> = {
      ArrowRight: (i + 1) % n,
      ArrowLeft: (i - 1 + n) % n,
      Home: 0,
      End: n - 1,
    };
    const next = target[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const nextTab = TABS[next]!.tab;
    setTab(nextTab);
    refs.current[nextTab]?.focus();
  };

  return (
    <div
      className={`${s.dock} ${hidden ? s.hidden : ''} ${collapsed ? s.collapsed : ''}`}
      data-collapsed={collapsed || undefined}
      aria-hidden={hidden || undefined}
      onFocus={collapsed ? onReveal : undefined}
    >
      <nav role="tablist" aria-label={t('app.title')} className={`${s.bar} ${s.glass}`}>
        {TABS.map(({ tab, label, icon }) => (
          <button
            key={tab}
            type="button"
            role="tab"
            ref={(el) => {
              refs.current[tab] = el;
            }}
            aria-selected={current === tab}
            tabIndex={!hidden && current === tab ? 0 : -1}
            className={s.tab}
            onClick={() => setTab(tab)}
            onKeyDown={(e) => onKeyDown(e, tab)}
          >
            {icon}
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
