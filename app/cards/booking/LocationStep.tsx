"use client";

import { useState } from "react";
import type { BookingFlow, BookingSelection, LocationRow, ServiceRow } from "@/lib/booking/types";
import { formatMoney } from "@/lib/booking/types";
import { zonedParts } from "@/lib/booking/time";
import { inputStyle, linkBtn, liveBtn, sectionLabel, Tile } from "./ui";
import { stepFrame } from "./ServiceStep";

import { offeringLocations } from "@/lib/booking/flowSteps";
export { offeringLocations, locationChoiceReal } from "@/lib/booking/flowSteps";

function todaysHours(loc: LocationRow, flow: BookingFlow): string {
  const hours = loc.hours ?? flow.rules.hours;
  const weekday = zonedParts(new Date(), loc.timezone || flow.business.timezone).weekday;
  const ranges = hours[weekday] ?? [];
  if (ranges.length === 0) return "Closed today";
  return ranges.map((r) => `${r.start}–${r.end}`).join(", ");
}

export function LocationStep({
  flow,
  service,
  selection,
  setSelection,
  onNext,
  onBack,
  nextLabel,
  locked = false,
}: {
  flow: BookingFlow;
  service: ServiceRow | null;
  selection: BookingSelection;
  setSelection: (s: BookingSelection) => void;
  onNext: () => void;
  /** Left out when earlier steps stay editable in the thread: no Back button. */
  onBack?: () => void;
  /** "Next" by default; a step already answered reads "Update". */
  nextLabel?: string;
  /** The booking is done (or abandoned): controls disabled, no button. */
  locked?: boolean;
}) {
  const businesses = offeringLocations(flow, service).filter((l) => l.kind === "business");
  const modes = service?.modes ?? [];
  const virtual = flow.locations.find((l) => l.enabled && l.kind === "virtual") ?? null;
  const mobileLoc = flow.locations.find((l) => l.enabled && l.kind === "mobile") ?? null;
  const [postal, setPostal] = useState(selection.postalCode);
  const [address, setAddress] = useState(selection.customerAddress);
  const [postalError, setPostalError] = useState("");

  function pickBusiness(loc: LocationRow) {
    setSelection({ ...selection, mode: "in_person", locationId: loc.id, customerAddress: "", postalCode: "" });
  }
  function pickOnline() {
    setSelection({ ...selection, mode: "online", locationId: virtual?.id ?? null, customerAddress: "", postalCode: "" });
  }
  function applyMobile() {
    const codes = mobileLoc?.serviceArea.postalCodes ?? [];
    const norm = postal.toUpperCase().replace(/\s+/g, "");
    if (codes.length > 0 && !codes.includes(norm)) {
      setPostalError("We don't serve that postal code yet.");
      return;
    }
    setPostalError("");
    setSelection({ ...selection, mode: "mobile", locationId: mobileLoc?.id ?? null, customerAddress: address, postalCode: norm });
  }

  const canNext = selection.mode === "online" || selection.mode === "mobile" || !!selection.locationId || businesses.length === 0;

  return (
    <fieldset disabled={locked} style={stepFrame}>
      {businesses.length > 0 && (
        <div role="radiogroup" aria-label="Locations" style={{ marginBottom: 12 }}>
          {businesses.map((loc) => (
            <div key={loc.id} style={{ marginBottom: 8 }}>
              <Tile selected={selection.mode === "in_person" && selection.locationId === loc.id} onClick={() => pickBusiness(loc)} ariaLabel={loc.name}>
                <div style={{ padding: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{loc.name}</div>
                  {loc.address && <div style={{ fontSize: 12, opacity: 0.8 }}>{loc.address}</div>}
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{todaysHours(loc, flow)}</div>
                </div>
              </Tile>
            </div>
          ))}
        </div>
      )}
      {modes.includes("online") && (
        <div style={{ marginBottom: 12 }}>
          <Tile selected={selection.mode === "online"} onClick={pickOnline} ariaLabel="Online">
            <div style={{ padding: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Online</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>A meeting link is sent after booking.</div>
            </div>
          </Tile>
        </div>
      )}
      {modes.includes("mobile") && (
        <div style={{ marginBottom: 12 }}>
          <div style={sectionLabel}>My address</div>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" style={inputStyle} aria-label="Your address" />
          <input value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="Postal code" style={inputStyle} aria-label="Postal code" />
          {mobileLoc?.serviceArea.travelFee !== undefined && (
            <p style={{ fontSize: 12 }}>Travel fee: {formatMoney(mobileLoc.serviceArea.travelFee, flow.business.currency)}</p>
          )}
          {mobileLoc?.serviceArea.description && <p style={{ fontSize: 12, opacity: 0.8 }}>{mobileLoc.serviceArea.description}</p>}
          {postalError && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13 }}>{postalError}</p>}
          <button
            type="button"
            onClick={applyMobile}
            disabled={!address.trim() || !postal.trim()}
            style={{ ...linkBtn, opacity: !address.trim() || !postal.trim() ? 0.55 : 1 }}
          >
            Use this address
          </button>
        </div>
      )}
      {!locked && (
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {onBack && (
            <button type="button" onClick={onBack} style={linkBtn}>
              Back
            </button>
          )}
          <button type="button" onClick={onNext} disabled={!canNext} style={{ ...linkBtn, ...liveBtn, opacity: canNext ? 1 : 0.55 }}>
            {nextLabel ?? "Next"}
          </button>
        </div>
      )}
    </fieldset>
  );
}
