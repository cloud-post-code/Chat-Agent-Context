"use client";

import { useMemo, useState } from "react";
import type { BookingFlow, BookingSelection, ServiceRow } from "@/lib/booking/types";
import { effectivePricing, formatDuration, formatMoney, MODE_LABELS, pricingLabel } from "@/lib/booking/types";
import { Badge, inputStyle, linkBtn, liveBtn, optionRow, picked, sectionLabel, stepBtn, Tile, tileGrid } from "./ui";

/** Past this many services, a search box appears above the grid. */
const SEARCH_OVER = 8;

/**
 * Photos are drawn only when every service on offer has one of its own, so a
 * picture always points at exactly one service. A menu where some services
 * have photos and others don't gets none: a half-illustrated grid (or a
 * placeholder standing in) reads as if the pictured ones were the real
 * offer, and a photo beside a gap draws a connection that isn't there.
 */
function showServiceImages(services: ServiceRow[]): boolean {
  return services.length > 0 && services.every((s) => !!s.imageUrl);
}

/**
 * A step's controls all sit in one fieldset: `locked` disables every input,
 * tile and chip at once (a disabled fieldset disables its form controls),
 * with the fieldset's own chrome reset so the card looks as before.
 */
export const stepFrame: React.CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0 };

export function ServiceStep({
  flow,
  selection,
  onPick,
  locked = false,
}: {
  flow: BookingFlow;
  selection: BookingSelection;
  /** Picking a service finishes the step; picking again (unless locked) changes it. */
  onPick: (serviceId: string) => void;
  /** The booking is done (or abandoned): tiles disabled, no button. */
  locked?: boolean;
}) {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const enabledServices = useMemo(() => flow.services.filter((s) => s.enabled), [flow.services]);
  const withImages = showServiceImages(enabledServices);
  // The categories come from the services themselves (the menu headings the
  // business's own site lists them under), so a categorised site is a
  // categorised menu here with nothing for the owner to set up.
  const categories = flow.categories.filter((c) => enabledServices.some((s) => s.category === c));
  const filtered = enabledServices.filter((s) => {
    if (category !== "All" && s.category !== category) return false;
    if (query.trim() && !s.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });

  const detail = detailId ? (enabledServices.find((s) => s.id === detailId) ?? null) : null;
  if (detail) {
    return (
      <fieldset disabled={locked} style={stepFrame}>
        <ServiceDetail
          service={detail}
          flow={flow}
          withImage={withImages}
          onBack={() => setDetailId(null)}
          locked={locked}
          onChoose={() => {
            setDetailId(null);
            onPick(detail.id);
          }}
        />
      </fieldset>
    );
  }

  return (
    <fieldset disabled={locked} style={stepFrame}>
      {flow.business.phone && (
        // The other way to book, always in view: some visitors would rather
        // call, and a phone-only business needs its number where the menu is.
        <p style={{ fontSize: 13, margin: "0 0 10px" }}>
          Prefer to call? Book by phone:{" "}
          <a href={`tel:${flow.business.phone.replace(/[^\d+]/g, "")}`} style={{ color: "inherit", fontWeight: 600 }}>
            {flow.business.phone}
          </a>
        </p>
      )}
      {categories.length > 0 && (
        // One dropdown rather than a row of chips: a long menu's categories
        // would wrap to several lines and push the services below the fold.
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
          style={{ ...inputStyle, marginBottom: 10 }}
        >
          <option value="All">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
      {enabledServices.length > SEARCH_OVER && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search services"
          aria-label="Search services"
          style={inputStyle}
        />
      )}
      <div style={tileGrid}>
        {filtered.map((s) => (
          <ServiceTile
            disabled={locked}
            key={s.id}
            service={s}
            currency={flow.business.currency}
            withImage={withImages}
            selected={selection.serviceId === s.id}
            onClick={() => setDetailId(s.id)}
          />
        ))}
      </div>
      {filtered.length === 0 && <p style={{ fontSize: 13, marginTop: 8 }}>No services match.</p>}
    </fieldset>
  );
}

function ServiceTile({
  service,
  currency,
  withImage,
  selected,
  onClick,
  disabled = false,
}: {
  service: ServiceRow;
  currency: string;
  /** True only when every service in the grid has a photo (showServiceImages). */
  withImage: boolean;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const pricing = effectivePricing(service, null);
  const modesToShow = service.modes.filter((m) => m !== "in_person");
  return (
    <Tile selected={selected} onClick={onClick} ariaLabel={service.name} role="button" disabled={disabled}>
      {withImage && service.imageUrl && (
        <div style={{ aspectRatio: "4 / 3", overflow: "hidden", borderRadius: "var(--radius-sm) var(--radius-sm) 0 0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={service.imageUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      )}
      <div style={{ padding: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-heading)" }}>{service.name}</div>
        <div style={{ fontSize: 12, marginTop: 2 }}>{pricingLabel(pricing, currency)}</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{formatDuration(service.durationMinutes)}</div>
        {(modesToShow.length > 0 || service.deposit.kind !== "none") && (
          <div style={{ marginTop: 6 }}>
            {modesToShow.map((m) => (
              <Badge key={m}>{MODE_LABELS[m]}</Badge>
            ))}
            {service.deposit.kind !== "none" && <Badge tone="accent">Deposit</Badge>}
          </div>
        )}
      </div>
    </Tile>
  );
}

function ServiceDetail({
  service,
  flow,
  withImage,
  onBack,
  nextLabel,
  locked = false,
  onChoose,
}: {
  service: ServiceRow;
  flow: BookingFlow;
  /** Same rule as the grid: a photo only when every service has one. */
  withImage: boolean;
  /** Left out when earlier steps stay editable in the thread: no Back button. */
  onBack?: () => void;
  /** "Next" by default; a step already answered reads "Update". */
  nextLabel?: string;
  /** The booking is done (or abandoned): controls disabled, no button. */
  locked?: boolean;
  onChoose: () => void;
}) {
  const providers = flow.staff.filter((p) => p.enabled && (service.staffIds.length === 0 || service.staffIds.includes(p.id)));
  const policy = service.cancellationPolicy || flow.rules.cancellationPolicy;
  return (
    <div>
      {onBack && (
        <button type="button" onClick={onBack} style={{ ...linkBtn, marginBottom: 10 }}>
          Back to services
        </button>
      )}
      {withImage && service.imageUrl && (
        <div style={{ aspectRatio: "16 / 9", overflow: "hidden", borderRadius: "var(--radius-sm)", margin: "0 0 10px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={service.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      )}
      <strong style={{ fontSize: 16, fontFamily: "var(--font-heading)" }}>{service.name}</strong>
      <p style={{ fontSize: 13, marginTop: 4 }}>
        {pricingLabel(effectivePricing(service, null), flow.business.currency)} · {formatDuration(service.durationMinutes)}
      </p>
      {service.description && <p style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>{service.description}</p>}
      {service.addons.length > 0 && (
        <>
          <div style={sectionLabel}>Add-ons</div>
          {service.addons.map((a) => (
            <p key={a.id} style={{ fontSize: 13, margin: "2px 0" }}>
              {a.name}
              {a.price !== undefined ? ` — ${formatMoney(a.price, flow.business.currency)}` : ""}
            </p>
          ))}
        </>
      )}
      {service.variants.length > 0 && (
        <>
          <div style={sectionLabel}>Options</div>
          {service.variants.map((v) => (
            <p key={v.id} style={{ fontSize: 13, margin: "2px 0" }}>
              {v.name}
              {v.pricing ? ` — ${pricingLabel(v.pricing, flow.business.currency)}` : ""}
            </p>
          ))}
        </>
      )}
      {providers.length > 0 && (
        <>
          <div style={sectionLabel}>Who performs it</div>
          <p style={{ fontSize: 13 }}>{providers.map((p) => p.name).join(", ")}</p>
        </>
      )}
      {service.eligibility && (
        <>
          <div style={sectionLabel}>Eligibility</div>
          <p style={{ fontSize: 13 }}>{service.eligibility}</p>
        </>
      )}
      {service.preparation && (
        <>
          <div style={sectionLabel}>Preparation</div>
          <p style={{ fontSize: 13 }}>{service.preparation}</p>
        </>
      )}
      {policy && (
        <>
          <div style={sectionLabel}>Cancellation policy</div>
          <p style={{ fontSize: 13 }}>{policy}</p>
        </>
      )}
      {!locked && (
        <button
          type="button"
          onClick={onChoose}
          style={{ ...linkBtn, ...liveBtn, width: "100%", marginTop: 14, padding: "12px 18px", fontSize: 15, fontWeight: 600 }}
        >
          {nextLabel ?? `Choose ${service.name}`}
        </button>
      )}
    </div>
  );
}

/**
 * Variant / add-ons / quantity — shown only when the chosen service has any
 * of the three (BookingFlowCard decides that; this file just draws it).
 */
export function OptionsStep({
  service,
  selection,
  setSelection,
  onNext,
  onBack,
  nextLabel,
  locked = false,
  currency,
}: {
  service: ServiceRow;
  selection: BookingSelection;
  setSelection: (s: BookingSelection) => void;
  onNext: () => void;
  /** Left out when earlier steps stay editable in the thread: no Back button. */
  onBack?: () => void;
  /** "Next" by default; a step already answered reads "Update". */
  nextLabel?: string;
  /** The booking is done (or abandoned): controls disabled, no button. */
  locked?: boolean;
  currency: string;
}) {
  const variant = service.variants.find((v) => v.id === selection.variantId) ?? null;
  const pricing = effectivePricing(service, variant);
  const needsQuantity = pricing.kind === "hourly" || pricing.kind === "per_person" || pricing.kind === "per_unit";
  const qtyLabel =
    pricing.kind === "hourly"
      ? "How many hours?"
      : pricing.kind === "per_person"
        ? "How many people?"
        : `How many ${pricing.unitLabel || "unit"}s?`;
  const max = service.maxQuantity ?? 20;
  const addonsTotal = service.addons
    .filter((a) => selection.addonIds.includes(a.id))
    .reduce((sum, a) => sum + (a.price ?? 0), 0);

  return (
    <fieldset disabled={locked} style={stepFrame}>
      {service.variants.length > 0 && (
        <div role="radiogroup" aria-label="Options" style={{ marginBottom: 12 }}>
          <div style={sectionLabel}>Choose an option</div>
          {service.variants.map((v) => {
            const checked = selection.variantId === v.id;
            return (
              <label key={v.id} style={{ ...optionRow, ...(checked ? picked : {}) }}>
                <input
                  type="radio"
                  name="variant"
                  checked={checked}
                  onChange={() => setSelection({ ...selection, variantId: v.id })}
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13 }}>
                    <span>{v.name}</span>
                    {v.pricing && <span>{pricingLabel(v.pricing, currency)}</span>}
                  </span>
                  {v.description && <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>{v.description}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {service.addons.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={sectionLabel}>Add-ons</div>
          {service.addons.map((a) => {
            const checked = selection.addonIds.includes(a.id);
            return (
              <label key={a.id} style={{ ...optionRow, ...(checked ? picked : {}) }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setSelection({
                      ...selection,
                      addonIds: checked ? selection.addonIds.filter((id) => id !== a.id) : [...selection.addonIds, a.id],
                    })
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13 }}>
                    <span>{a.name}</span>
                    {a.price !== undefined && <span>{formatMoney(a.price, currency)}</span>}
                  </span>
                  {a.description && <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>{a.description}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {needsQuantity && (
        <div style={{ marginBottom: 12 }}>
          <div style={sectionLabel}>{qtyLabel}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setSelection({ ...selection, quantity: Math.max(1, selection.quantity - 1) })}
              aria-label="Fewer"
              style={stepBtn}
            >
              −
            </button>
            <span style={{ minWidth: 24, textAlign: "center", fontSize: 14 }}>{selection.quantity}</span>
            <button
              type="button"
              onClick={() => setSelection({ ...selection, quantity: Math.min(max, selection.quantity + 1) })}
              aria-label="More"
              style={stepBtn}
            >
              +
            </button>
          </div>
        </div>
      )}
      {addonsTotal > 0 && <p style={{ fontSize: 13, fontWeight: 600 }}>Add-ons total: {formatMoney(addonsTotal, currency)}</p>}
      {!locked && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {onBack && (
            <button type="button" onClick={onBack} style={linkBtn}>
              Back
            </button>
          )}
          <button type="button" onClick={onNext} style={{ ...linkBtn, ...liveBtn }}>
            {nextLabel ?? "Next"}
          </button>
        </div>
      )}
    </fieldset>
  );
}
