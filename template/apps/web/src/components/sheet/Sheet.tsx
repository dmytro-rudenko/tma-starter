import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { tg } from 'tma-starter/web';
import { useTranslation } from 'react-i18next';
import { FULLSCREEN_KINDS, useLayer, useStack } from '../../state/stack';
import s from './Sheet.module.css';

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.55; // px/ms
const MIN_FLICK_DISTANCE = 45;
const SLOP = 8;
const CLOSE_MS = 230;
const NO_SWIPE = 'input, textarea, select, [data-no-swipe]';

export function useSwipeDismiss(
  ref: RefObject<HTMLElement>,
  onDismiss: () => void,
  enabled = true,
  scrollerRef: RefObject<HTMLElement> = ref,
): { animateOut: () => void } {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  const closing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const animateOut = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const el = ref.current;
    if (el) {
      el.dataset.closing = '1';
      el.style.transform = 'translateY(110%)';
    }
    timer.current = setTimeout(() => {
      closing.current = false;
      cb.current();
    }, CLOSE_MS);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let y0: number | null = null;
    let x0 = 0;
    let dy = 0;
    let t0 = 0;
    let dragging = false;
    let suppressClick = false;
    let fromScroller = true;

    const start = (x: number, y: number, target: EventTarget | null) => {
      if (closing.current) return;
      if (target instanceof Element && target.closest(NO_SWIPE)) return;
      const scroller = scrollerRef.current;
      fromScroller = !!scroller && target instanceof Node && scroller.contains(target);
      y0 = y;
      x0 = x;
      dy = 0;
      t0 = performance.now();
      dragging = false;
    };
    const move = (x: number, y: number, e: Event) => {
      if (y0 == null) return;
      const d = y - y0;
      if (!dragging) {
        if (
          d > SLOP &&
          (!fromScroller || (scrollerRef.current?.scrollTop ?? 0) <= 0) &&
          Math.abs(x - x0) < d
        ) {
          dragging = true;
          el.dataset.dragging = '1';
        } else if (Math.abs(d) > SLOP || Math.abs(x - x0) > SLOP) {
          y0 = null;
          return;
        } else return;
      }
      dy = Math.max(0, d);
      el.style.transform = `translateY(${dy}px)`;
      if (e.cancelable) e.preventDefault();
    };
    const end = () => {
      if (y0 == null) return;
      y0 = null;
      if (!dragging) return;
      dragging = false;
      delete el.dataset.dragging;
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 60);
      const v = dy / Math.max(1, performance.now() - t0);
      if (dy > DISMISS_DISTANCE || (dy > MIN_FLICK_DISTANCE && v > DISMISS_VELOCITY)) {
        tg.haptic.impact('light');
        animateOut();
      } else {
        el.style.transform = '';
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) start(t.clientX, t.clientY, e.target);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY, e);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      start(e.clientX, e.clientY, e.target);
    };
    const onPointerMove = (e: PointerEvent) => {
      const wasDragging = dragging;
      move(e.clientX, e.clientY, e);
      // Capture only after the drag starts: Chromium retargets `click` to the capturing element,
      // so capturing on pointerdown would swallow clicks on buttons inside the sheet.
      if (!wasDragging && dragging && e.pointerType === 'mouse') {
        try {
          el.setPointerCapture?.(e.pointerId);
        } catch {
          return;
        }
      }
    };
    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', end);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, [ref, scrollerRef, enabled, animateOut]);

  return { animateOut };
}

const escapeStack: symbol[] = [];

export function useEscape(onEscape: () => void, enabled = true): void {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    if (!enabled) return;
    const id = Symbol('layer');
    escapeStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escapeStack[escapeStack.length - 1] === id) cb.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = escapeStack.indexOf(id);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [enabled]);
}

function windowMaxHeight(): number {
  return Math.round(window.innerHeight * 0.7);
}

function useWindowMaxHeight(): number {
  const [h, setH] = useState(windowMaxHeight);
  useEffect(() => {
    const onResize = () => setH(windowMaxHeight());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return h;
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Sheet({ open, ...rest }: SheetProps) {
  if (!open) return null;
  return <OpenSheet {...rest} />;
}

function OpenSheet({ onClose, title, footer, children }: Omit<SheetProps, 'open'>) {
  const { t } = useTranslation();
  const { index, isTop } = useLayer();
  const stack = useStack();
  const nested = index > 0 && !!stack[index - 1] && !FULLSCREEN_KINDS.has(stack[index - 1]!.kind);
  const ref = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const maxHeight = useWindowMaxHeight();
  const [closing, setClosing] = useState(false);
  const { animateOut } = useSwipeDismiss(ref, onClose, isTop, scrollerRef);
  const requestClose = useCallback(() => {
    setClosing(true);
    animateOut();
  }, [animateOut]);
  useEscape(requestClose, isTop);

  const z = 40 + index * 2;
  return (
    <>
      {isTop && (
        <div
          data-testid="sheet-scrim"
          className={`${s.scrim} ${closing ? s.scrimOut : ''}`}
          style={{ zIndex: z }}
          onClick={requestClose}
        />
      )}
      <div
        ref={ref}
        data-testid="sheet"
        role="dialog"
        aria-modal="true"
        className={`${s.sheet} ${isTop ? '' : s.under}`}
        style={{ maxHeight: `${maxHeight}px`, zIndex: z + 1 }}
      >
        <div data-testid="sheet-panel" className={s.panel} data-scrolled={scrolled || undefined}>
          <div className={s.grab} aria-hidden="true" />
          {nested ? (
            <button
              type="button"
              className={s.ctl}
              aria-label={t('common.back')}
              onClick={requestClose}
            >
              <span aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M10 3 5 8l5 5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          ) : (
            <button
              type="button"
              className={s.ctl}
              aria-label={t('common.close')}
              onClick={requestClose}
            >
              <span aria-hidden="true">✕</span>
            </button>
          )}
          {title != null && <h2 className={s.title}>{title}</h2>}
        </div>
        <div
          ref={scrollerRef}
          data-testid="sheet-body"
          className={s.scroller}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        >
          <div className={s.body}>{children}</div>
        </div>
        {footer != null && (
          <div data-testid="sheet-footer" className={s.footer}>
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
