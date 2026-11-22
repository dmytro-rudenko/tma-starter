import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import { useTab } from '../../state/tabs';
import { HomeScreen } from '../home/HomeScreen';
import { SettingsTab } from '../settings/SettingsTab';
// tma:shop:start
import { ShopTab } from '../shop/ShopTab';
// tma:shop:end
import s from './MainScreen.module.css';
import { TabBar } from './TabBar';

const DOCK_SCROLL_THRESHOLD_PX = 8;

export function MainScreen({ under = false }: { under?: boolean }) {
  const tab = useTab();
  const mainRef = useRef<HTMLElement>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const lastScrollY = useRef(0);

  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
    lastScrollY.current = 0;
    setDockCollapsed(false);
  }, [tab]);

  const onScroll = useCallback((e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    // iOS rubber-band overscroll reports offsets outside the scroll range.
    const y = Math.min(Math.max(el.scrollTop, 0), Math.max(el.scrollHeight - el.clientHeight, 0));
    if (y <= DOCK_SCROLL_THRESHOLD_PX) {
      lastScrollY.current = y;
      setDockCollapsed(false);
      return;
    }
    const dy = y - lastScrollY.current;
    if (Math.abs(dy) < DOCK_SCROLL_THRESHOLD_PX) return;
    lastScrollY.current = y;
    setDockCollapsed(dy > 0);
  }, []);
  const revealDock = useCallback(() => setDockCollapsed(false), []);

  return (
    <>
      <main
        ref={mainRef}
        className={`${s.screen} ${under ? s.under : ''}`}
        aria-hidden={under || undefined}
        onScroll={onScroll}
      >
        {tab === 'home' && <HomeScreen />}
        {/* tma:shop:start */}
        {tab === 'shop' && <ShopTab />}
        {/* tma:shop:end */}
        {tab === 'settings' && <SettingsTab />}
        <div className={s.bottomSpace} />
      </main>
      <TabBar hidden={under} collapsed={dockCollapsed && !under} onReveal={revealDock} />
    </>
  );
}
