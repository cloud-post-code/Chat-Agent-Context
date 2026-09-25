"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookingFlow, BookingSelection, ServiceRow, StaffRow } from "@/lib/booking/types";
import { formatMoney } from "@/lib/booking/types";
import { formatInZone } from "@/lib/booking/time";
import { getAvailabilityMonth } from "./api";
import { Badge, Chip, chipRow, linkBtn, liveBtn, PlaceholderImage, textBtn, Tile } from "./ui";

import { providerCandidates } from "@/lib/booking/flowSteps";
export { providerCandidates };

export function ProviderStep({
  flow,
  service,
  selection,
  setSelection,
  slug,
  onNext,
  onBack,
}: {
  flow: BookingFlow;
  service: ServiceRow | null;
  selection: BookingSelection;
  setSelection: (s: BookingSelection) => void;
  slug: string;
  onNext: () => void;
  /** Left out when earlier steps stay editable in the thread: no Back button. */
  onBack?: () => void;
  /** "Next" by default; a step already answered reads "Update". */
  nextLabel?: string;
  /** The booking is done (or abandoned): controls disabled, no button. */
  locked?: boolean;
}) {
  const all = useMemo(() => providerCandidates(flow, service), [flow, service]);
  const genders = useMemo(() => [...new Set(all.map((p) => p.genderLabel).filter(Boolean))], [all]);
  const [genderFilter, setGenderFilter] = useState("");
  const candidates = genderFilter ? all.filter((p) => p.genderLabel === genderFilter) : all;
  const [next, setNext] = useState<Record<string, string | null>>({});
  const [bioOpen, setBioOpen] = useState<string | null>(null);
  const ids = candidates.map((p) => p.id).join(",");

  // Lazy, sequential per-provider "next available" — one request at a time,
  // cached by provider id, so opening this step never fires a request storm.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const month = new Date().toISOString().slice(0, 7);
      for (const p of candidates) {
        if (cancelled) return;
        if (next[p.id] !== undefined) continue;
        const res = await getAvailabilityMonth({
          slug,
          serviceId: service?.id ?? null,
          variantId: selection.variantId,
          addonIds: selection.addonIds,
          staffId: p.id,
          locationId: selection.locationId,
          month,
        });
        if (cancelled) return;
        setNext((prev) => ({ ...prev, [p.id]: res.ok ? (res.earliest?.startsAt ?? null) : null }));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, slug, service?.id, selection.variantId, selection.locationId]);

  const anyoneSelected = selection.staffId === null;
  const canNext = flow.rules.staffSelection !== "required" || !!selection.staffId;

  return (
    <div>
      {flow.rules.genderPreference && genders.length > 0 && (
        <div style={chipRow}>
          <Chip selected={!genderFilter} onClick={() => setGenderFilter("")}>
            All
          </Chip>
          {genders.map((g) => (
            <Chip key={g} selected={genderFilter === g} onClick={() => setGenderFilter(g)}>
              {g}
            </Chip>
          ))}
        </div>
      )}
      <div role="radiogroup" aria-label="Provider">
        {flow.rules.staffSelection === "optional" && (
          <div style={{ marginBottom: 8 }}>
            <Tile selected={anyoneSelected} onClick={() => setSelection({ ...selection, staffId: null })} ariaLabel="Anyone available">
              <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 10 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", overflow: "hidden", flex: "0 0 auto" }}>
                  <PlaceholderImage letter="?" radius="50%" />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Anyone available</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>We&apos;ll assign the first available provider</div>
                </div>
              </div>
            </Tile>
          </div>
        )}
        {candidates.map((p) => (
          <ProviderTile
            key={p.id}
            provider={p}
            service={service}
            currency={flow.business.currency}
            selected={selection.staffId === p.id}
            nextAvailable={next[p.id]}
            bioOpen={bioOpen === p.id}
            onToggleBio={() => setBioOpen(bioOpen === p.id ? null : p.id)}
            onClick={() => setSelection({ ...selection, staffId: p.id })}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" onClick={onBack} style={linkBtn}>
          Back
        </button>
        <button type="button" onClick={onNext} disabled={!canNext} style={{ ...linkBtn, ...liveBtn, opacity: canNext ? 1 : 0.55 }}>
          Next
        </button>
      </div>
    </div>
  );
}

function ProviderTile({
  provider,
  service,
  currency,
  selected,
  nextAvailable,
  bioOpen,
  onToggleBio,
  onClick,
}: {
  provider: StaffRow;
  service: ServiceRow | null;
  currency: string;
  selected: boolean;
  nextAvailable: string | null | undefined;
  bioOpen: boolean;
  onToggleBio: () => void;
  onClick: () => void;
}) {
  const price = service ? provider.priceOverrides[service.id] : undefined;
  const letter = (provider.name[0] || "?").toUpperCase();
  return (
    <div style={{ marginBottom: 8 }}>
      <Tile selected={selected} onClick={onClick} ariaLabel={provider.name}>
        <div style={{ display: "flex", gap: 10, padding: 10 }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", overflow: "hidden", flex: "0 0 auto" }}>
            {provider.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={provider.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <PlaceholderImage letter={letter} radius="50%" />
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{provider.name}</div>
            {provider.role && <div style={{ fontSize: 12, opacity: 0.8 }}>{provider.role}</div>}
            {provider.specialties.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {provider.specialties.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            )}
            {provider.languages.length > 0 && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{provider.languages.join(", ")}</div>}
            {provider.credentials.length > 0 && <div style={{ fontSize: 12, opacity: 0.8 }}>{provider.credentials.join(", ")}</div>}
            {price !== undefined && <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{formatMoney(price, currency)}</div>}
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
              {nextAvailable === undefined
                ? "Checking availability…"
                : nextAvailable
                  ? `Next available: ${formatInZone(new Date(nextAvailable), flowVisitorZone())}`
                  : "No upcoming availability"}
            </div>
          </div>
        </div>
      </Tile>
      {provider.bio && (
        <div style={{ padding: "4px 10px" }}>
          <button type="button" onClick={onToggleBio} style={textBtn}>
            {bioOpen ? "Less" : "More"}
          </button>
          {bioOpen && <p style={{ fontSize: 12, marginTop: 4 }}>{provider.bio}</p>}
        </div>
      )}
    </div>
  );
}

function flowVisitorZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
