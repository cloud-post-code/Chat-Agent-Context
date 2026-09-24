"use client";

import { useState } from "react";
import { saveServiceAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, Label } from "../ui";
import {
  PRICING_KINDS,
  MODE_LABELS,
  SERVICE_MODES,
  pricingLabel,
  type ServiceRow,
  type StaffRow,
  type LocationRow,
  type PricingKind,
} from "@/lib/booking/types";
import { RowsEditor, SelectField, minuteOptions, type RowColumn } from "./RowsEditor";

/**
 * One service's editor — also the "Add service" form when `service` is left
 * out. A client component because what the form shows depends on what is
 * picked: the pricing kind decides which amounts make sense, "only certain
 * people" reveals the provider list, a new category needs a box to type it
 * in. Everything with a known set of answers is a dropdown; variants and
 * add-ons are rows, not a textarea. It still posts to the same server action
 * as a plain form.
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

const BUFFER_MINUTES = [0, 5, 10, 15, 20, 30, 45, 60];
const bufferOptions = (current: number | undefined) =>
  [...new Set([...BUFFER_MINUTES, current ?? 0])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: m ? `${m} min` : "None" }));

const NEW_CATEGORY = "__new__";

const VARIANT_COLUMNS: RowColumn[] = [
  { key: "name", label: "Option", placeholder: "Long hair", required: true },
  { key: "price", label: "Price", placeholder: "$55 or from $55", width: 130 },
  { key: "minutes", label: "Length", kind: "minutes", placeholder: "Same as service" },
  { key: "description", label: "Note", placeholder: "Optional" },
];

const ADDON_COLUMNS: RowColumn[] = [
  { key: "name", label: "Add-on", placeholder: "Deep condition", required: true },
  { key: "price", label: "Price", kind: "money", placeholder: "15" },
  { key: "minutes", label: "Adds", kind: "minutes", placeholder: "No extra time" },
  { key: "description", label: "Note", placeholder: "Optional" },
];

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
  const [categoryPick, setCategoryPick] = useState(service?.category ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [whoMode, setWhoMode] = useState<"anyone" | "some">(service?.staffIds.length ? "some" : "anyone");
  const [whereMode, setWhereMode] = useState<"all" | "some">(service?.locationIds.length ? "some" : "all");
  const small: React.CSSProperties = { ...fieldStyle, width: 130 };
  const category = categoryPick === NEW_CATEGORY ? newCategory : categoryPick;
  const priced = kind !== "free" && kind !== "quote" && kind !== "variable";
  const countable = kind === "per_person" || kind === "per_unit" || kind === "hourly";

  return (
    <form action={saveServiceAction}>
      {service ? <input type="hidden" name="id" value={service.id} /> : null}
      <input type="hidden" name="category" value={category} readOnly />

      <div style={grid2}>
        <div>
          <Label>Name</Label>
          <input name="name" defaultValue={service?.name} required placeholder="Gel manicure" style={fieldStyle} />
        </div>
        <div>
          <SelectField
            label="Category"
            value={categoryPick}
            onChange={setCategoryPick}
            options={[
              { value: "", label: "No category" },
              ...categories.map((c) => ({ value: c, label: c })),
              { value: NEW_CATEGORY, label: "New category…" },
            ]}
          />
          {categoryPick === NEW_CATEGORY ? (
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Type the new category"
              aria-label="New category"
              style={fieldStyle}
            />
          ) : null}
        </div>
      </div>

      <Label>Description</Label>
      <textarea
        name="description"
        defaultValue={service?.description}
        rows={3}
        placeholder="What's included, who it's for."
        style={{ ...fieldStyle, resize: "vertical" }}
      />

      <Label>Photo</Label>
      {service?.imageUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={service.imageUrl}
            alt=""
            style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover" }}
          />
          <label style={checkboxLabel}>
            <input type="checkbox" name="removeImage" /> Remove photo
          </label>
        </div>
      ) : null}
      <input type="file" name="image" accept="image/*" style={fieldStyle} />

      <div style={box}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <SelectField
            name="pricingKind"
            label="Pricing"
            value={kind}
            onChange={(v) => setKind(v as PricingKind)}
            options={PRICING_KINDS.map((k) => ({ value: k, label: PRICING_LABELS[k] }))}
            width={180}
          />
          {priced ? (
            <div>
              <Label>{kind === "range" ? "From" : "Amount"}</Label>
              <input name="pricingAmount" type="number" step="0.01" min="0" defaultValue={service?.pricing.amount} style={small} />
            </div>
          ) : null}
          {kind === "range" ? (
            <div>
              <Label>To</Label>
              <input name="pricingMaxAmount" type="number" step="0.01" min="0" defaultValue={service?.pricing.maxAmount} style={small} />
            </div>
          ) : null}
          {kind === "per_unit" ? (
            <div>
              <Label>Per</Label>
              <input name="pricingUnitLabel" defaultValue={service?.pricing.unitLabel} placeholder="room, window, pet" style={small} />
            </div>
          ) : null}
        </div>
        <Label>Note shown beside the price (optional)</Label>
        <input
          name="pricingNote"
          defaultValue={service?.pricing.note}
          placeholder={kind === "quote" ? "Call for a quote" : "Varies by length"}
          style={{ ...fieldStyle, marginBottom: 0 }}
        />
      </div>

      <div style={grid3}>
        <SelectField name="durationMinutes" label="Length" defaultValue={String(service?.durationMinutes ?? 30)} options={minuteOptions(service?.durationMinutes ?? 30)} />
        <SelectField name="bufferBeforeMinutes" label="Gap before" defaultValue={String(service?.bufferBeforeMinutes ?? 0)} options={bufferOptions(service?.bufferBeforeMinutes)} />
        <SelectField name="bufferAfterMinutes" label="Gap after" defaultValue={String(service?.bufferAfterMinutes ?? 0)} options={bufferOptions(service?.bufferAfterMinutes)} />
      </div>

      <div style={grid3}>
        <SelectField
          name="depositKind"
          label="Deposit"
          defaultValue={service?.deposit.kind ?? "none"}
          options={[
            { value: "none", label: "No deposit" },
            { value: "fixed", label: "Fixed amount" },
            { value: "percent", label: "Percent of total" },
          ]}
        />
        <div>
          <Label>Deposit amount</Label>
          <input name="depositAmount" type="number" step="0.01" min="0" defaultValue={service?.deposit.amount} placeholder="20" style={fieldStyle} />
        </div>
        {countable ? (
          <SelectField
            name="maxQuantity"
            label={kind === "hourly" ? "Most hours bookable" : kind === "per_person" ? "Largest party" : "Most units"}
            defaultValue={String(service?.maxQuantity ?? 10)}
            options={[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 50].map((n) => ({ value: String(n), label: String(n) }))}
          />
        ) : null}
      </div>

      <Label>Where it can happen</Label>
      <div style={{ display: "flex", gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
        {SERVICE_MODES.map((m) => (
          <label key={m} style={checkboxLabel}>
            <input type="checkbox" name="modes" value={m} defaultChecked={service ? service.modes.includes(m) : m === "in_person"} />
            {MODE_LABELS[m]}
          </label>
        ))}
      </div>

      <div style={grid2}>
        <div>
          <SelectField
            label="Who can perform it"
            value={whoMode}
            onChange={(v) => setWhoMode(v as "anyone" | "some")}
            options={[
              { value: "anyone", label: staff.length ? "Anyone on the team" : "Anyone (no providers yet)" },
              ...(staff.length ? [{ value: "some", label: "Only certain people" }] : []),
            ]}
          />
          {whoMode === "some" && staff.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              {staff.map((s) => (
                <label key={s.id} style={checkboxLabel}>
                  <input type="checkbox" name="staffIds" value={s.id} defaultChecked={service?.staffIds.includes(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <SelectField
            label="Offered at"
            value={whereMode}
            onChange={(v) => setWhereMode(v as "all" | "some")}
            options={[
              { value: "all", label: locations.length ? "Every location" : "Every location (none yet)" },
              ...(locations.length ? [{ value: "some", label: "Only certain locations" }] : []),
            ]}
          />
          {whereMode === "some" && locations.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              {locations.map((l) => (
                <label key={l.id} style={checkboxLabel}>
                  <input type="checkbox" name="locationIds" value={l.id} defaultChecked={service?.locationIds.includes(l.id)} />
                  {l.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <RowsEditor
        name="variants"
        label="Options the visitor picks one of (e.g. short hair / long hair)"
        columns={VARIANT_COLUMNS}
        initial={(service?.variants ?? []).map((v) => ({
          name: v.name,
          price: v.pricing ? pricingLabel(v.pricing) : "",
          minutes: v.durationMinutes ? String(v.durationMinutes) : "",
          description: v.description ?? "",
        }))}
        addLabel="+ Add an option"
      />

      <RowsEditor
        name="addons"
        label="Add-ons the visitor can tick"
        columns={ADDON_COLUMNS}
        initial={(service?.addons ?? []).map((a) => ({
          name: a.name,
          price: a.price !== undefined ? String(a.price) : "",
          minutes: a.durationMinutes ? String(a.durationMinutes) : "",
          description: a.description ?? "",
        }))}
        addLabel="+ Add an add-on"
      />

      <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontStyle: "italic" }}>Fine print — eligibility, preparation, cancellation</summary>
        <div style={{ marginTop: 10 }}>
          <Label>Eligibility</Label>
          <textarea name="eligibility" defaultValue={service?.eligibility} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />
          <Label>Preparation</Label>
          <textarea name="preparation" defaultValue={service?.preparation} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />
          <Label>Cancellation policy (overrides the business-wide policy)</Label>
          <textarea name="cancellationPolicy" defaultValue={service?.cancellationPolicy} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />
        </div>
      </details>

      <SelectField
        name="enabled"
        label="Shown to visitors"
        defaultValue={(service?.enabled ?? true) ? "on" : "off"}
        options={[
          { value: "on", label: "Yes — bookable" },
          { value: "off", label: "No — hidden for now" },
        ]}
        width={220}
      />

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
