import { useQuery } from '@tanstack/react-query';
import type { TargetId } from '../tma-api.js';
import { tmaKeys } from './keys.js';
import { useTma } from './provider.js';

export function useProducts(opts: { targetId?: TargetId } = {}) {
  const { api } = useTma();
  const { targetId } = opts;
  return useQuery({
    queryKey: targetId === undefined ? tmaKeys.products : [...tmaKeys.products, String(targetId)],
    queryFn: () => api.products(targetId === undefined ? {} : { targetId }),
  });
}
