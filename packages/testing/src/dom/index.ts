export interface TgCall {
  name: string;
  args: unknown[];
}

export interface SafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

type FakeWindow = { Telegram?: unknown; __tgCalls?: TgCall[] };

function parseInitData(initData: string): { user?: unknown; start_param?: string } {
  const data = new URLSearchParams(initData);
  let user: unknown;
  try {
    user = JSON.parse(data.get('user') ?? 'null') ?? undefined;
  } catch {
    user = undefined;
  }
  return { user, start_param: data.get('start_param') ?? undefined };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function installFakeWebApp(
  win: object,
  overrides: Record<string, unknown> = {},
): Record<string, any> {
  const target = win as FakeWindow;
  const calls: TgCall[] = (target.__tgCalls = target.__tgCalls ?? []);
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const zero: SafeAreaInset = { top: 0, bottom: 0, left: 0, right: 0 };
  const initData = typeof overrides.initData === 'string' ? overrides.initData : '';

  const webApp: Record<string, any> = {
    initData,
    initDataUnsafe: parseInitData(initData),
    version: '8.0',
    platform: 'tdesktop',
    colorScheme: 'light',
    themeParams: {},
    isExpanded: true,
    isFullscreen: false,
    viewportHeight: 800,
    viewportStableHeight: 800,
    safeAreaInset: { ...zero },
    contentSafeAreaInset: { ...zero },
    isVersionAtLeast(version: string) {
      return compareVersions(String(webApp.version), version) >= 0;
    },
    ready: rec('ready'),
    expand: rec('expand'),
    close: rec('close'),
    requestFullscreen: rec('requestFullscreen'),
    exitFullscreen: rec('exitFullscreen'),
    disableVerticalSwipes: rec('disableVerticalSwipes'),
    enableVerticalSwipes: rec('enableVerticalSwipes'),
    setHeaderColor: rec('setHeaderColor'),
    setBackgroundColor: rec('setBackgroundColor'),
    setBottomBarColor: rec('setBottomBarColor'),
    enableClosingConfirmation: rec('enableClosingConfirmation'),
    disableClosingConfirmation: rec('disableClosingConfirmation'),
    onEvent: rec('onEvent'),
    offEvent: rec('offEvent'),
    openTelegramLink: rec('openTelegramLink'),
    openLink: rec('openLink'),
    shareMessage: rec('shareMessage'),
    downloadFile: rec('downloadFile'),
    showPopup: rec('showPopup'),
    showAlert: rec('showAlert'),
    openInvoice(url: string, cb?: (status: string) => void) {
      calls.push({ name: 'openInvoice', args: [url] });
      setTimeout(() => cb?.('paid'), 0);
    },
    BackButton: {
      isVisible: false,
      show: rec('BackButton.show'),
      hide: rec('BackButton.hide'),
      onClick: rec('BackButton.onClick'),
      offClick: rec('BackButton.offClick'),
    },
    MainButton: {
      isVisible: false,
      show: rec('MainButton.show'),
      hide: rec('MainButton.hide'),
      onClick: rec('MainButton.onClick'),
      offClick: rec('MainButton.offClick'),
    },
    HapticFeedback: {
      impactOccurred: rec('HapticFeedback.impactOccurred'),
      notificationOccurred: rec('HapticFeedback.notificationOccurred'),
      selectionChanged: rec('HapticFeedback.selectionChanged'),
    },
  };
  Object.assign(webApp, overrides);
  target.Telegram = { WebApp: webApp };
  return webApp;
}
