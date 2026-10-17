// The signed in member, through React Query. useMe() is the one source of truth for "who am I".
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, setCsrf } from './client';
import type { AccountWithCodeResponse, AuthResponse, Me, MeResponse, RecoveryCodeResponse } from '../../shared/types';

export const meKey = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      const res = await api.get<MeResponse>('/api/me');
      setCsrf(res.csrf);
      return res;
    },
    staleTime: 60_000,
  });
}

/** The signed in member or null. Undefined while loading. */
export function useUser(): Me | null | undefined {
  const { data } = useMe();
  return data === undefined ? undefined : data.user;
}

function store(qc: QueryClient, res: { user: Me; csrf: string }) {
  setCsrf(res.csrf);
  qc.setQueryData<MeResponse>(meKey, { user: res.user, csrf: res.csrf });
}

export function useSignUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<AccountWithCodeResponse>('/api/auth/signup', body),
    onSuccess: (res) => store(qc, res),
  });
}

export function useShuffle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<AuthResponse>('/api/auth/shuffle'),
    onSuccess: (res) => store(qc, res),
  });
}

export function useConfirmPseudonym() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<AuthResponse>('/api/auth/confirm-pseudonym'),
    onSuccess: (res) => store(qc, res),
  });
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<AuthResponse>('/api/auth/login', body),
    onSuccess: async (res) => {
      store(qc, res);
      // Everything cached while signed out may now look different (saved, my votes).
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] });
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/api/auth/logout'),
    onSettled: () => {
      setCsrf(null);
      qc.clear();
      qc.setQueryData<MeResponse>(meKey, { user: null, csrf: null });
    },
  });
}

export function useResetWithCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; recoveryCode: string; newPassword: string }) =>
      api.post<AccountWithCodeResponse>('/api/auth/reset', body),
    onSuccess: (res) => store(qc, res),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post<AuthResponse>('/api/auth/password', body),
  });
}

export function useNewRecoveryCode() {
  return useMutation({
    mutationFn: (body: { password: string }) => api.post<RecoveryCodeResponse>('/api/auth/recovery-code', body),
  });
}
