export type ColorScheme = 'light' | 'dark';
export type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending';
export type ShareResult = 'sent' | 'cancelled' | 'unsupported';
export type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type NotifyType = 'error' | 'success' | 'warning';
export interface ChromeColors {
  light: string;
  dark: string;
}

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: { start_param?: string; user?: { id?: number; language_code?: string } };
  version?: string;
  platform?: string;
  colorScheme?: ColorScheme;
  themeParams?: Record<string, string>;
  isFullscreen?: boolean;
  safeAreaInset?: Insets;
  contentSafeAreaInset?: Insets;
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  requestFullscreen?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
  openInvoice?: (url: string, cb?: (status: InvoiceStatus) => void) => void;
  openTelegramLink?: (url: string) => void;
  isVersionAtLeast?: (v: string) => boolean;
  shareMessage?: (id: string, cb?: (sent: boolean) => void) => void;
  downloadFile?: (params: { url: string; file_name: string }, cb?: (ok: boolean) => void) => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  BackButton?: {
    show?: () => void;
    hide?: () => void;
    onClick?: (cb: () => void) => void;
    offClick?: (cb: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred?: (style: ImpactStyle) => void;
    notificationOccurred?: (type: NotifyType) => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

let chrome: ChromeColors | undefined;

function wa(): TelegramWebApp | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.Telegram?.WebApp;
  } catch {
    return undefined;
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    return;
  }
}

function initDataRaw(): string {
  return wa()?.initData ?? '';
}

function startParam(): string | undefined {
  try {
    const fromTg = wa()?.initDataUnsafe?.start_param;
    if (fromTg) return fromTg;
    if (typeof window === 'undefined') return undefined;
    return new URLSearchParams(window.location.search).get('tgWebAppStartParam') || undefined;
  } catch {
    return undefined;
  }
}

function languageCode(): string | undefined {
  return wa()?.initDataUnsafe?.user?.language_code;
}

function userId(): number | undefined {
  const id = wa()?.initDataUnsafe?.user?.id;
  return typeof id === 'number' ? id : undefined;
}

function platform(): string {
  return wa()?.platform ?? 'unknown';
}

function isVersionAtLeast(v: string): boolean {
  try {
    return !!wa()?.isVersionAtLeast?.(v);
  } catch {
    return false;
  }
}

function colorScheme(): ColorScheme {
  const s = wa()?.colorScheme;
  if (s === 'light' || s === 'dark') return s;
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    return 'light';
  }
  return 'light';
}

function subscribe(events: readonly string[], cb: () => void): () => void {
  const app = wa();
  if (!app) return () => {};
  for (const e of events) safe(() => app.onEvent?.(e, cb));
  return () => {
    for (const e of events) safe(() => app.offEvent?.(e, cb));
  };
}

function onThemeChanged(cb: () => void): () => void {
  return subscribe(['themeChanged'], cb);
}

const SAFE_AREA_EVENTS = ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged'];
// Telegram for Android reports a zero bottom inset under gesture navigation, though the gesture bar overlays the page.
const ANDROID_MIN_BOTTOM_INSET = 24;

function writeInsets(prefix: string, insets: Insets | undefined, minBottom = 0): void {
  if (!insets) return;
  const style = document.documentElement.style;
  style.setProperty(`${prefix}-top`, `${insets.top ?? 0}px`);
  style.setProperty(`${prefix}-bottom`, `${Math.max(insets.bottom ?? 0, minBottom)}px`);
  style.setProperty(`${prefix}-left`, `${insets.left ?? 0}px`);
  style.setProperty(`${prefix}-right`, `${insets.right ?? 0}px`);
}

function syncSafeArea(): () => void {
  const app = wa();
  if (!app) return () => {};
  const sync = () =>
    safe(() => {
      const android = !!app.isFullscreen && (app.platform ?? '').startsWith('android');
      writeInsets('--tg-safe-area-inset', app.safeAreaInset, android ? ANDROID_MIN_BOTTOM_INSET : 0);
      writeInsets('--tg-content-safe-area-inset', app.contentSafeAreaInset);
    });
  sync();
  return subscribe(SAFE_AREA_EVENTS, sync);
}

function applyChrome(scheme?: ColorScheme): void {
  const app = wa();
  if (!app || !chrome) return;
  const bg = chrome[scheme ?? colorScheme()];
  safe(() => app.setHeaderColor?.(bg));
  safe(() => app.setBackgroundColor?.(bg));
}

function init(opts: { chrome?: ChromeColors } = {}): void {
  if (opts.chrome) chrome = opts.chrome;
  const app = wa();
  if (!app) return;
  safe(() => app.ready?.());
  safe(() => app.expand?.());
  safe(() => app.disableVerticalSwipes?.());
  applyChrome();
}

function enterFullscreen(): void {
  const app = wa();
  if (!app?.requestFullscreen || !isVersionAtLeast('8.0')) return;
  safe(() => app.requestFullscreen!());
}

const haptic = {
  impact(style: ImpactStyle): void {
    safe(() => wa()?.HapticFeedback?.impactOccurred?.(style));
  },
  notify(type: NotifyType): void {
    safe(() => wa()?.HapticFeedback?.notificationOccurred?.(type));
  },
};

function openInvoice(url: string): Promise<InvoiceStatus> {
  const app = wa();
  if (!app?.openInvoice) return Promise.resolve('failed');
  return new Promise((resolve) => {
    try {
      app.openInvoice!(url, (status) => resolve(status));
    } catch {
      resolve('failed');
    }
  });
}

function canShareMessage(): boolean {
  try {
    const app = wa();
    return !!app?.shareMessage && !!app.isVersionAtLeast?.('8.0');
  } catch {
    return false;
  }
}

function openTelegramLink(url: string): void {
  const app = wa();
  if (app?.openTelegramLink) {
    safe(() => app.openTelegramLink!(url));
    return;
  }
  safe(() => void window.open(url, '_blank', 'noopener'));
}

function shareMessage(id: string): Promise<ShareResult> {
  const app = wa();
  if (!app?.shareMessage) return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    try {
      app.shareMessage!(id, (sent) => resolve(sent === true ? 'sent' : 'cancelled'));
    } catch {
      resolve('unsupported');
    }
  });
}

function downloadFile(url: string, name: string): Promise<boolean> {
  try {
    const abs = new URL(url, window.location.origin).toString();
    const app = wa();
    if (app?.downloadFile) {
      return new Promise((resolve) => {
        try {
          app.downloadFile!({ url: abs, file_name: name }, (ok) => resolve(!!ok));
        } catch {
          resolve(false);
        }
      });
    }
    const a = document.createElement('a');
    a.href = abs;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

function closingConfirmation(on: boolean): void {
  const app = wa();
  safe(() => (on ? app?.enableClosingConfirmation?.() : app?.disableClosingConfirmation?.()));
}

const backButton = {
  show(onClick: () => void): () => void {
    const btn = wa()?.BackButton;
    if (!btn) return () => {};
    safe(() => btn.onClick?.(onClick));
    safe(() => btn.show?.());
    return () => {
      safe(() => btn.offClick?.(onClick));
      safe(() => btn.hide?.());
    };
  },
};

function themeParams(): Record<string, string> {
  return { ...(wa()?.themeParams ?? {}) };
}

export const tg = {
  init,
  initDataRaw,
  startParam,
  languageCode,
  userId,
  platform,
  isVersionAtLeast,
  colorScheme,
  onThemeChanged,
  themeParams,
  syncSafeArea,
  applyChrome,
  openInvoice,
  openTelegramLink,
  shareMessage,
  canShareMessage,
  downloadFile,
  enterFullscreen,
  haptic,
  closingConfirmation,
  backButton,
};
