// Services and claims. Shared by server/routes/services.ts and the client.

export const SERVICE_CATEGORIES = ['Home baker', 'Caterer', 'Meal prep', 'Cooking class', 'Shop', 'Other'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/** The area value for a service that delivers anywhere in Dubai. */
export const DELIVERS_ACROSS_DUBAI = 'Delivers across Dubai';

export const SERVICE_AREAS = [
  DELIVERS_ACROSS_DUBAI,
  'Downtown', 'Business Bay', 'Dubai Marina', 'JLT', 'JBR', 'Jumeirah', 'Al Barsha', 'Al Quoz', 'Deira',
  'Bur Dubai', 'Karama', 'Al Wasl', 'Mirdif', 'Dubai Hills', 'Arabian Ranches', 'JVC', 'Motor City',
  'Silicon Oasis', 'Palm Jumeirah', 'Satwa',
] as const;

/** What a service says about itself. A product's 'vegan_product' never applies to a service. */
export const SERVICE_VEGAN_STATUSES = ['fully_vegan', 'vegan_options'] as const;
export type ServiceVeganStatus = (typeof SERVICE_VEGAN_STATUSES)[number];

export const SERVICE_NAME_MAX = 80;
export const SERVICE_SUMMARY_MAX = 600;
export const BIO_MAX = 300;

/** Contact details a service owner chose to show. Stored in listings.contact; shown only while the listing has an owner. */
// A type alias, not an interface, so it can be passed straight to a jsonb query parameter.
export type ServiceContact = {
  /** Digits only, international format without a plus, e.g. 971501234567. Opens https://wa.me/<digits>. */
  whatsapp?: string;
  /** Handle without the @. Opens https://www.instagram.com/<handle>/. */
  instagram?: string;
  /** An https URL. */
  website?: string;
};

/** What a member sends for each contact field. Empty strings clear a field. */
export interface ServiceContactInput {
  whatsapp?: string;
  instagram?: string;
  website?: string;
}

/** POST /api/services */
export interface CreateServiceBody {
  name: string;
  /** What you offer. */
  summary: string;
  category: ServiceCategory;
  area: string;
  /** Left out: stored as 'vegan_options', never as a Fully vegan claim. */
  veganStatus?: ServiceVeganStatus;
  photoId?: string | null;
  contact?: ServiceContactInput;
}

/** PATCH /api/services/:id. Owner or admin. Owners never edit member recommendations, replies or opinions. */
export interface UpdateServiceBody {
  summary?: string;
  category?: ServiceCategory;
  area?: string;
  veganStatus?: ServiceVeganStatus;
  photoId?: string | null;
  contact?: ServiceContactInput;
}

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export interface MyClaim {
  id: string;
  code: string;
  status: ClaimStatus;
  createdAt: string;
}

/** A recommendation as the service profile shows it when the Listings components are not available. */
export interface ServiceRecommendation {
  id: string;
  body: string;
  offer: string | null;
  offerExpiresAt: string | null;
  author: string;
  upvotes: number;
  createdAt: string;
}

/** GET /api/services/:slug */
export interface ServiceProfile {
  id: string;
  kind: 'place' | 'product' | 'service';
  name: string;
  slug: string;
  category: string;
  area: string | null;
  /** A place or product claimed as a business keeps its own status, so this is wider than ServiceVeganStatus. */
  veganStatus: 'fully_vegan' | 'vegan_options' | 'vegan_product';
  summary: string;
  photoUrl: string | null;
  photoId: string | null;
  /** True when a member runs this listing (created it as a service, or an admin approved a claim). */
  ownerRun: boolean;
  /** Only present while the listing has an owner. */
  contact: ServiceContact | null;
  createdAt: string;
  counts: { recommend: number; notForMe: number; recommendations: number };
  /** Signed in viewer only. */
  viewer: {
    isOwner: boolean;
    opinion: 'recommend' | 'not_for_me' | null;
    saved: boolean;
    claim: MyClaim | null;
  } | null;
  recommendations: ServiceRecommendation[];
}

export interface ServiceCreated {
  id: string;
  slug: string;
}

/** POST /api/services/:id/claim */
export interface ClaimResponse {
  claim: MyClaim;
}
