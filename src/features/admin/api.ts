// Reports (any member) and the admin queue.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type {
  AdminListings, AuditPage, ClaimQueue, HiddenList, MergeBody, MergeResult, ModerateBody, ReportBody, ReportCreated, ReportQueue,
} from '../../../shared/types/admin';

export function useReport() {
  return useMutation({ mutationFn: (body: ReportBody) => api.post<ReportCreated>('/api/reports', body) });
}

const adminKey = ['admin'] as const;

export function useReportQueue(enabled: boolean) {
  return useQuery({ queryKey: [...adminKey, 'reports'], queryFn: () => api.get<ReportQueue>('/api/admin/reports'), enabled });
}

export function useClaimQueue(enabled: boolean, all: boolean) {
  return useQuery({
    queryKey: [...adminKey, 'claims', all],
    queryFn: () => api.get<ClaimQueue>(`/api/admin/claims${all ? '?status=all' : ''}`),
    enabled,
  });
}

export function useAdminListings(enabled: boolean, q: string) {
  return useQuery({
    queryKey: [...adminKey, 'listings', q],
    queryFn: () => api.get<AdminListings>(`/api/admin/listings?q=${encodeURIComponent(q)}`),
    enabled,
  });
}

export function useHiddenList(enabled: boolean) {
  return useQuery({ queryKey: [...adminKey, 'hidden'], queryFn: () => api.get<HiddenList>('/api/admin/hidden'), enabled });
}

export function useAuditLog(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...adminKey, 'audit'],
    queryFn: ({ pageParam }) => api.get<AuditPage>(`/api/admin/audit${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    enabled,
  });
}

/** Every admin action refreshes the whole admin area: queues, listings and the audit log. */
function useAdminAction<T, R = { ok: true }>(fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: adminKey }) });
}

export const useModerate = () => useAdminAction((body: ModerateBody) => api.post('/api/admin/moderate', body));
export const useBan = () => useAdminAction((userId: string) => api.post(`/api/admin/users/${userId}/ban`));
export const useUnban = () => useAdminAction((userId: string) => api.post(`/api/admin/users/${userId}/unban`));
export const useClaimDecision = () =>
  useAdminAction(({ id, decision }: { id: string; decision: 'approve' | 'reject' | 'revoke' }) => api.post(`/api/admin/claims/${id}/${decision}`));
export const useRevokeOwner = () => useAdminAction((listingId: string) => api.post(`/api/admin/listings/${listingId}/revoke-owner`));
export const useMerge = () => useAdminAction((body: MergeBody) => api.post<MergeResult>('/api/admin/listings/merge', body));
export const usePin = () => useAdminAction(({ id, pinned }: { id: string; pinned: boolean }) => api.post(`/api/talk/topics/${id}/pin`, { pinned }));
