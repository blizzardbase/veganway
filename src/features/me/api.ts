// The member's own area.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCsrf } from '../../api/client';
import { meKey } from '../../api/session';
import type { MeResponse } from '../../../shared/types';
import type { MyPosts, MyService, Profile, UpdateProfileBody } from '../../../shared/types/me';

const areaKey = ['me-area'] as const;

export function useProfile(enabled: boolean) {
  return useQuery({ queryKey: [...areaKey, 'profile'], queryFn: () => api.get<Profile>('/api/me/profile'), enabled });
}

export function useMyPosts(enabled: boolean) {
  return useQuery({ queryKey: [...areaKey, 'posts'], queryFn: () => api.get<MyPosts>('/api/me/posts'), enabled });
}

export function useMyService(enabled: boolean) {
  return useQuery({ queryKey: [...areaKey, 'service'], queryFn: () => api.get<MyService>('/api/me/service'), enabled });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileBody) => api.patch<{ profile: Profile } & MeResponse>('/api/me/profile', body),
    onSuccess: (res) => {
      qc.setQueryData([...areaKey, 'profile'], res.profile);
      qc.setQueryData<MeResponse>(meKey, { user: res.user, csrf: res.csrf });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { password: string }) => api.post<{ ok: true }>('/api/me/delete', body),
    onSuccess: () => {
      setCsrf(null);
      qc.clear();
      qc.setQueryData<MeResponse>(meKey, { user: null, csrf: null });
    },
  });
}
