"use client";

import { useState } from "react";
import { field, btnGhost } from "../ui";

/**
 * The gallery review's card: extracted photos three at a time, a
 * "page / pages" counter, and arrows to move between sets. Captions are
 * editable in place; a photo the user doesn't want is removed with its ×.
 */

/** tags is carried through review (extraction -> save) but not edited here —
 *  the card only lets the owner tweak captions and drop unwanted photos. */
export type GalleryItem = { src: string; caption: string; tags?: string[] };

const PAGE_SIZE = 3;

export function GalleryCard({
  images,
  onCaption,
  onRemove,
  busy = false,
}: {
  images: GalleryItem[];
  onCaption: (index: number, caption: string) => void;
  onRemove: (index: number) => void;
  busy?: boolean;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(images.length / PAGE_SIZE));
  const p = Math.min(page, pages - 1); // clamp after removals shrink the list
  const start = p * PAGE_SIZE;
  const visible = images.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <div style={{ display: "flex", gap: 12 }}>
        {visible.map((img, i) => {
          const idx = start + i;
          return (
            <div key={img.src} style={{ flex: 1, minWidth: 0 }}>
              <div style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- data-dir upload, unoptimized preview */}
                <img
                  src={img.src}
                  alt={img.caption || `Photo ${idx + 1}`}
                  style={{
                    // Natural aspect ratio, never cropped: contain inside a
                    // bounded box instead of cover-cropping to a fixed tile.
                    width: "100%", maxHeight: 160, objectFit: "contain",
                    borderRadius: "var(--radius-sm)", display: "block",
                  }}
                />
                <button
                  aria-label={`Remove photo ${idx + 1}`}
                  style={{
                    ...btnGhost, position: "absolute", top: 4, right: 4,
                    padding: "2px 8px", lineHeight: 1.4,
                  }}
                  disabled={busy}
                  onClick={() => onRemove(idx)}
                >
                  ×
                </button>
              </div>
              <input
                style={{ ...field, marginTop: 8, fontSize: 13 }}
                placeholder="Caption"
                value={img.caption}
                disabled={busy}
                onChange={(e) => onCaption(idx, e.target.value)}
              />
            </div>
          );
        })}
      </div>
      {pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 4 }}>
          <button
            aria-label="Previous photos"
            style={btnGhost}
            disabled={p === 0}
            onClick={() => setPage(p - 1)}
          >
            ‹
          </button>
          <span style={{ fontSize: 13, opacity: 0.75 }}>{p + 1} / {pages}</span>
          <button
            aria-label="Next photos"
            style={btnGhost}
            disabled={p >= pages - 1}
            onClick={() => setPage(p + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
