export const day = (iso: string) => new Date(iso).toLocaleDateString();

export const dateTime = (iso: string) => new Date(iso).toLocaleString();

export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
