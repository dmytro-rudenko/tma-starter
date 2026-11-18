import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from '../api.js';
import { tmaKeys } from './keys.js';
import { useTma } from './provider.js';

export function useMe() {
  const { api, applyPrefs } = useTma();
  const query = useQuery({ queryKey: tmaKeys.me, queryFn: () => api.me() });
  const me = query.data;
  useEffect(() => {
    if (me) applyPrefs({ theme: me.theme, language: me.language });
  }, [me?.theme, me?.language]);
  const blocked = query.error instanceof ApiError && query.error.code === 'USER_BLOCKED';
  return { ...query, blocked };
}
