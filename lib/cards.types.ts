/**
 * The item shapes the chat's cards carry. Owned here, prisma-free, so the server
 * (lib/cards.ts hydrates them) and the client (app/cards/Cards.tsx renders
 * them) share one definition instead of two that drift.
 */
export type ProjectCard = {
  id: string;
  name: string;
  blurb: string;
  detail: string | null;
  githubUrl: string | null;
  liveUrl: string | null;
  imageUrl: string | null;
  tags: string[];
};

export type PhotoCard = {
  id: string;
  src: string;
  description: string;
  caption: string | null;
  tags?: string[];
};

export type ServiceCard = {
  id: string;
  name: string;
  description: string;
  /** Present when the service comes from the live booking flow (a Service
   *  row) rather than the plain knowledge catalog. */
  imageUrl?: string | null;
  priceLabel?: string;
  duration?: string;
  category?: string;
};

export type SocialItem = { platform: string; url: string };
