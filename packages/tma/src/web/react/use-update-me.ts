import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateMeDto } from '../tma-api.js';
import { tmaKeys } from './keys.js';
import { useTma } from './provider.js';

export function useUpdateMe() {
  const { api, applyPrefs } = useTma();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateMeDto) => api.updateMe(dto),
    onSuccess: (me) => {
      qc.setQueryData(tmaKeys.me, me);
      applyPrefs({ theme: me.theme, language: me.language });
    },
  });
}
