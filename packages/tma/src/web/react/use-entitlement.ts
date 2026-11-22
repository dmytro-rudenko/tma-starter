import { useQuery } from '@tanstack/react-query';
import { tmaKeys } from './keys.js';
import { useTma } from './provider.js';

export function useEntitlement(productId: string) {
  const { api } = useTma();
  const query = useQuery({ queryKey: tmaKeys.entitlements, queryFn: () => api.entitlements() });
  const e = query.data?.find((x) => x.productId === productId);
  return {
    active: !!e,
    expiresAt: e?.expiresAt ?? null,
    canceled: e?.canceled ?? false,
    isLoading: query.isLoading,
  };
}
