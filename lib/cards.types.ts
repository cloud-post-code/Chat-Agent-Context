/**
 * The item shapes A2UI cards carry. Owned here, prisma-free, so the server
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

/**
 * One element of a custom-designed card. A closed vocabulary rather than
 * markup: the card builder's model output becomes visitor-facing UI, and a
 * fixed set of typed elements is what keeps that safe and on-theme.
 */
export type CustomElement =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "badges"; items: string[] }
  | { kind: "stats"; items: { label: string; value: string }[] }
  | { kind: "buttons"; items: { label: string; url: string }[] }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "quote"; text: string; by?: string }
  | { kind: "divider" };

export type SocialItem = { platform: string; url: string };
