import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLayer } from '../../state/stack';
import { useEscape, useSwipeDismiss } from './Sheet';

export interface FullscreenLayerProps {
  onClose?: () => void;
  swipeToClose?: boolean;
  closeSide?: 'left' | 'right';
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const TRANSITION = 'transform .3s cubic-bezier(.2,.8,.2,1)';

const base: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#000',
  color: '#fff',
  overflowY: 'auto',
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  transition: TRANSITION,
  animation: 'none',
};

const closeBtn: CSSProperties = {
  position: 'absolute',
  top: 'max(6px, var(--safe-top))',
  width: 44,
  height: 44,
  display: 'grid',
  placeItems: 'center',
  color: 'rgba(255,255,255,.85)',
  zIndex: 5,
};

const closeFace: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: 'rgba(0,0,0,.42)',
  color: '#fff',
  display: 'grid',
  placeItems: 'center',
  fontSize: 13,
  fontWeight: 600,
};

export function FullscreenLayer({
  onClose,
  swipeToClose = false,
  closeSide = 'right',
  children,
  className,
  style,
}: FullscreenLayerProps) {
  const { t } = useTranslation();
  const { index, isTop } = useLayer();
  const ref = useRef<HTMLDivElement>(null);
  const noop = () => {};
  const { animateOut } = useSwipeDismiss(ref, onClose ?? noop, isTop && swipeToClose && !!onClose);
  useEscape(() => onClose?.(), isTop && !!onClose);
  const transition = style?.transition ?? TRANSITION;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      el.style.transition = el.dataset.dragging ? 'none' : transition;
    };
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ['data-dragging'] });
    return () => mo.disconnect();
  }, [transition]);

  return (
    <div
      ref={ref}
      data-testid="fullscreen-layer"
      role="dialog"
      aria-modal="true"
      className={className}
      style={{ ...base, zIndex: 40 + index * 2, ...style }}
    >
      {onClose && (
        <button
          type="button"
          style={{ ...closeBtn, [closeSide]: 6 }}
          aria-label={t('common.close')}
          onClick={animateOut}
        >
          <span aria-hidden="true" style={closeFace}>
            ✕
          </span>
        </button>
      )}
      {children}
    </div>
  );
}
