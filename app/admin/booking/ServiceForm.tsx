"use client";

import { useState } from "react";
import { saveServiceAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, Label } from "../ui";
import {
  PRICING_KINDS,
  MODE_LABELS,
  SERVICE_MODES,
  type ServiceRow,
  type StaffRow,
  type LocationRow,
  type PricingKind,
} from "@/lib/booking/types";
import { formatVariantLines, formatAddonLines } from "./lines";

/**
 * One service's editor — also the "Add service" form when `service` is left
 * out. A client component for the same reason BookingFieldForm is one: which
 * pricing inputs make sense depends on the chosen kind, and that has to
 * change the moment the admin picks it, not after a save round-trip.
 */

const PRICING_LABELS: Record<PricingKind, string> = {
  free: "Free",
  fixed: "Fixed price",
  starting_at: "Starting at",
  range: "Price range",
  hourly: "Hourly",
  per_person: "Per person",
  per_unit: "Per unit",
  quote: "Quote required",
  variable: "Varies",
};

export function ServiceForm({
  service,
  staff,
  locations,
  categories,
}: {
  service?: ServiceRow;
  staff: StaffRow[];
  locations: LocationRow[];
  categories: string[];
}) {
  const [kind, setKind] = useState<PricingKind>(service?.pricing.kind ?? "fixed");
  const small: React.CSSProperties = { ...fieldStyle, width: 130 };

  return (
    <form action={saveServiceAction}>
      {service ? <input type="hidden" name="id" value={service.id} /> : null}

      <div style={grid2}>
        <div>
          <Label>Name</Label>
          <input name="name" defaultValue={service?.name} required style={fieldStyle} />
        </div>
        <div>
          <Label>Category</Label>
          <input name="category" defaultValue={service?.category} list="service-categories" style={fieldStyle} />
          <datalist id="service-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <Label>Description</Label>
      <textarea
        name="description"
        defaultValue={service?.description}
        rows={3}
        style={{ ...fieldStyle, resize: "vertical" }}
      />

      <Label>Image</Label>
      {service?.imageUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={service.imageUrl}
            alt=""
            style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover" }}
          />
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" name="removeImage" /> Remove image
          </label>
        </div>
      ) : null}
      <input type="file" name="image" accept="image/*" style={fieldStyle} />

      <div style={box}>
        <Label>Pricing</Label>
        <select
          name="pricingKind"
          value={kind}
          onChange={(e) => setKind(e.target.value as PricingKind)}
          style={{ ...fieldStyle, width: "auto" }}
        >
          {PRICING_KINDS.map((k) => (
            <option key={k} value={k}>
              {PRICING_LABELS[k]}
            </option>
          ))}
        </select>
        {kind !== "free" && kind !== "quote" ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div>
              <Label>{kind === "range" ? "From" : "Amount"}</Label>
              <input
                name="pricingAmount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={service?.pricing.amount}
                style={small}
              />
            </div>
            {kind === "range" ? (
              <div>
                <Label>To</Label>
                <input
                  name="pricingMaxAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={service?.pricing.maxAmount}
                  style={small}
                />
              </div>
            ) : null}
            {kind === "per_unit" ? (
              <div>
                <Label>Unit label</Label>
                <input
                  name="pricingUnitLabel"
                  defaultValue={service?.pricing.unitLabel}
                  placeholder="room, window, pet"
                  style={small}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <Label>Note (optional — the business&apos;s own words)</Label>
        <input
          name="pricingNote"
          defaultValue={service?.pricing.note}
          placeholder={kind === "quote" ? "Call for a quote" : "Varies by length"}
          style={fieldStyle}
        />
      </div>

      <div style={grid3}>
        <div>
          <Label>Duration (minutes)</Label>
          <input name="durationMinutes" type="number" min="5" defaultValue={service?.durationMinutes ?? 30} style={fieldStyle} />
        </div>
        <div>
          <Label>Buffer before (minutes)</Label>
          <input name="bufferBeforeMinutes" type="number" min="0" defaultValue={service?.bufferBeforeMinutes ?? 0} style={fieldStyle} />
        </div>
        <div>
          <Label>Buffer after (minutes)</Label>
          <input name="bufferAfterMinutes" type="number" min="0" defaultValue={service?.bufferAfterMinutes ?? 0} style={fieldStyle} />
        </div>
      </div>

      <div style={box}>
        <Label>Deposit</Label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select name="depositKind" defaultValue={service?.deposit.kind ?? "none"} style={{ ...fieldStyle, width: "auto", marginBottom: 0 }}>
            <option value="none">No deposit</option>
            <option value="fixed">Fixed amount</option>
            <option value="percent">Percent of total</option>
          </select>
          <input
            name="depositAmount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={service?.deposit.amount}
            placeholder="Amount"
            style={{ ...small, marginBottom: 0 }}
          />
        </div>
      </div>

      <Label>Where it can happen</Label>
      <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
        {SERVICE_MODES.map((m) => (
          <label key={m} style={checkboxLabel}>
            <input type="checkbox" name="modes" value={m} defaultChecked={service ? service.modes.includes(m) : m === "in_person"} />
            {MODE_LABELS[m]}
          </label>
        ))}
      </div>

      {staff.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <Label>Who can perform it (none checked = anyone)</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {staff.map((s) => (
              <label key={s.id} style={checkboxLabel}>
                <input type="checkbox" name="staffIds" value={s.id} defaultChecked={service?.staffIds.includes(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {locations.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <Label>Where (none checked = every location)</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {locations.map((l) => (
              <label key={l.id} style={checkboxLabel}>
                <input type="checkbox" name="locationIds" value={l.id} defaultChecked={service?.locationIds.includes(l.id)} />
                {l.name}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <Label>Max quantity (per_person / per_unit services — the largest party bookable)</Label>
      <input name="maxQuantity" type="number" min="1" defaultValue={service?.maxQuantity} style={{ ...fieldStyle, width: 130 }} />

      <Label>Variants — one per line: Name | price | minutes | description</Label>
      <textarea
        name="variants"
        defaultValue={formatVariantLines(service?.variants)}
        rows={3}
        placeholder={"Short hair | $35 | 30\nLong hair | from $55 | 45"}
        style={{ ...fieldStyle, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
      />

      <Label>Add-ons — one per line: Name | price | minutes | description</Label>
      <textarea
        name="addons"
        defaultValue={formatAddonLines(service?.addons)}
        rows={3}
        placeholder={"Deep condition | 15 | 10"}
        style={{ ...fieldStyle, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
      />

      <Label>Eligibility</Label>
      <textarea name="eligibility" defaultValue={service?.eligibility} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />
      <Label>Preparation</Label>
      <textarea name="preparation" defaultValue={service?.preparation} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />
      <Label>Cancellation policy (overrides the business-wide policy)</Label>
      <textarea name="cancellationPolicy" defaultValue={service?.cancellationPolicy} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />

      <label style={{ ...checkboxLabel, marginBottom: 12 }}>
        <input type="checkbox" name="enabled" defaultChecked={service?.enabled ?? true} /> Enabled
      </label>

      <PendingButton pendingLabel={service ? "Saving…" : "Adding…"} style={btn as React.CSSProperties}>
        {service ? "Save" : "Add service"}
      </PendingButton>
    </form>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const grid3: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 };
const checkboxLabel: React.CSSProperties = { fontSize: 13, display: "flex", alignItems: "center", gap: 6 };
const box: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 12,
  marginBottom: 12,
};
