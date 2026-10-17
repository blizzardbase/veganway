// Services: profile, create, owner edit and claims.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { meKey } from '../../api/session';
import type {
  ClaimResponse, CreateServiceBody, ServiceContact, ServiceCreated, ServiceProfile, UpdateServiceBody,
} from '../../../shared/types/services';

export const serviceKey = (slug: string) => ['service', slug] as const;

export function useService(slug: string | undefined) {
  return useQuery({
    queryKey: serviceKey(slug ?? ''),
    queryFn: () => api.get<ServiceProfile>(`/api/services/${encodeURIComponent(slug ?? '')}`),
    enabled: Boolean(slug),
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateServiceBody) => api.post<ServiceCreated>('/api/services', body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: meKey });
      await qc.invalidateQueries({ queryKey: ['me-area'] });
    },
  });
}

export function useUpdateService(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateServiceBody }) => api.patch<{ ok: true }>(`/api/services/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: serviceKey(slug) }),
  });
}

export function useClaim(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ClaimResponse>(`/api/services/${id}/claim`),
    onSuccess: () => qc.invalidateQueries({ queryKey: serviceKey(slug) }),
  });
}

/** https://wa.me/<digits>, https://www.instagram.com/<handle>/ and the website, from stored contact fields. */
export function contactLinks(contact: ServiceContact | null): { kind: 'whatsapp' | 'instagram' | 'website'; label: string; href: string }[] {
  if (!contact) return [];
  const out: { kind: 'whatsapp' | 'instagram' | 'website'; label: string; href: string }[] = [];
  if (contact.whatsapp && /^[0-9]{8,15}$/.test(contact.whatsapp)) out.push({ kind: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${contact.whatsapp}` });
  if (contact.instagram && /^[A-Za-z0-9._]{1,30}$/.test(contact.instagram)) {
    out.push({ kind: 'instagram', label: 'Instagram', href: `https://www.instagram.com/${contact.instagram}/` });
  }
  if (contact.website?.startsWith('https://')) out.push({ kind: 'website', label: 'Website', href: contact.website });
  return out;
}
