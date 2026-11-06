export type BotLang = 'uk' | 'en';

export function langOf(code: string | null | undefined): BotLang {
  return code === 'uk' ? 'uk' : 'en';
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
