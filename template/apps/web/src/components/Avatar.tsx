import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import s from './Avatar.module.css';

const AV_HUES = [18, 200, 280, 140, 330, 45, 250];

function hash(v: string): number {
  let h = 2166136261;
  for (const c of v) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarHue(userId: number): number {
  return AV_HUES[hash(String(userId)) % AV_HUES.length];
}

export interface AvatarProps {
  userId: number;
  name: string;
  photoUrl: string | null;
  isMe?: boolean;
  size?: number;
  className?: string;
}

export function Avatar({ userId, name, photoUrl, isMe = false, size, className }: AvatarProps) {
  const { t } = useTranslation();
  const ini = isMe
    ? t('common.you')
    : name
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w[0])
        .slice(0, 2)
        .join('');
  const src = photoUrl?.startsWith('https://') ? photoUrl : null;
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={`avatar ${s.avatar}${className ? ` ${className}` : ''}`}
      style={{
        background: `hsl(${avatarHue(userId)} 45% 42%)`,
        ...(size != null
          ? { width: size, height: size, fontSize: Math.round(size * 0.38) }
          : undefined),
      }}
      aria-hidden="true"
    >
      {ini}
      {src && failed !== src ? (
        <img
          className={s.avatarImg}
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(src)}
        />
      ) : null}
    </span>
  );
}
