"use client";

import { useMemo, useState } from "react";
import type { BookingFlow, BookingSelection, ServiceRow } from "@/lib/booking/types";
import { effectivePricing, formatDuration, formatMoney, MODE_LABELS, pricingLabel } from "@/lib/booking/types";
import { Badge, Chip, chipRow, inputStyle, linkBtn, liveBtn, optionRow, picked, PlaceholderImage, sectionLabel, stepBtn, Tile, tileGrid } from "./ui";

/** Past this many services, a search box appears above the grid. */
const SEARCH_OVER = 8;

export function ServiceStep({
  flow,
  selection,
  onPick,
}: {
  flow: BookingFlow;
  selection: BookingSelection;
  onPick: (serviceId: string) => void;
}) {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const enabledServices = useMemo(() => flow.services.filter((s) => s.enabled), [flow.services]);
  const categories = ["All", ...flow.categories];
  const filtered = enabledServices.filter((s) => {
    if (category !== "All" && s.category !== category) return false;
    if (query.trim() && !s.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });

  const detail = detailId ? (enabledServices.find((s) => s.id === detailId) ?? null) : null;
  if (detail) {
    return (
      <ServiceDetail
        service={detail}
        flow={flow}
        onBack={() => setDetailId(null)}
        onChoose={() => onPick(detail.id)}
      />
    );
  }

  return (
    <div>
      {categories.length > 1 && (
        <div aria-label="Categories" style={chipRow}>
          {categories.map((c) => (
            <Chip key={c} selected={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
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
            key={s.id}
            service={s}
            currency={flow.business.currency}
            selected={selection.serviceId === s.id}
            onClick={() => setDetailId(s.id)}
          />
        ))}
      </div>
      {filtered.length === 0 && <p style={{ fontSize: 13, marginTop: 8 }}>No services match.</p>}
    </div>
  );
}

function ServiceTile({
  service,
  currency,
  selected,
  onClick,
}: {
  service: ServiceRow;
  currency: string;
  selected: boolean;
  onClick: () => void;
}) {
  const pricing = effectivePricing(service, null);
  const modesToShow = service.modes.filter((m) => m !== "in_person");
  const letter = (service.name[0] || "?").toUpperCase();
  return (
    <Tile selected={selected} onClick={onClick} ariaLabel={service.name} role="button">
      <div
        style={{
          aspectRatio: "4 / 3",
          overflow: "hidden",
          borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
          background: "var(--bg)",
        }}
      >
        {service.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={service.imageUrl}
            alt=""
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <PlaceholderImage letter={letter} radius="0" />
        )}
      </div>
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
  onBack,
  onChoose,
}: {
  service: ServiceRow;
  flow: BookingFlow;
  onBack: () => void;
  onChoose: () => void;
}) {
  const providers = flow.staff.filter((p) => p.enabled && (service.staffIds.length === 0 || service.staffIds.includes(p.id)));
  const letter = (service.name[0] || "?").toUpperCase();
  const policy = service.cancellationPolicy || flow.rules.cancellationPolicy;
  return (
    <div>
      <button type="button" onClick={onBack} style={linkBtn}>
        Back to services
      </button>
      <div
        style={{
          aspectRatio: "16 / 9",
          overflow: "hidden",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg)",
          margin: "10px 0",
        }}
      >
        {service.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={service.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <PlaceholderImage letter={letter} radius="var(--radius-sm)" />
        )}
      </div>
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
      <button
        type="button"
        onClick={onChoose}
        style={{ ...linkBtn, ...liveBtn, width: "100%", marginTop: 14, padding: "12px 18px", fontSize: 15, fontWeight: 600 }}
      >
        Choose {service.name}
      </button>
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
  currency,
}: {
  service: ServiceRow;
  selection: BookingSelection;
  setSelection: (s: BookingSelection) => void;
  onNext: () => void;
  onBack: () => void;
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
    <div>
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
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={onBack} style={linkBtn}>
          Back
        </button>
        <button type="button" onClick={onNext} style={{ ...linkBtn, ...liveBtn }}>
          Next
        </button>
      </div>
    </div>
  );
}
