import Link from "next/link";
import type { User } from "@prisma/client";
import { getThemeConfig } from "@/lib/db";
import { safeTags } from "@/lib/knowledge";
import { addProject, uploadPhoto, updatePhoto } from "@/app/admin/actions/content";
import { ingestCustomTextAction, ingestCustomImageAction, ingestCustomUrlAction, ingestCustomFileAction, deleteIngestedItemAction } from "@/app/admin/actions/ingestion";
import { updateAccountAction, setAccountDisabledAction, issuePasswordAction, createAccountAction, deleteAccountAction, impersonateAction } from "@/app/admin/actions/accounts";
import { cancelBookingAction, confirmBookingAction, deleteOrderAction } from "@/app/admin/actions/booking";
import { AppointmentsPanel } from "../AppointmentsPanel";
import { buildElementNodes, type ElementNodes } from "../elements";
import { fallbackTimeZone, toCalendarAppointment, toCalendarOrder } from "@/lib/adminElements";
import { OrdersPanel } from "../OrdersPanel";
import { BookingSettings } from "../BookingSettingsPanel";
import { HomePanel } from "../HomePanel";
import { attentionItems, checklistItems } from "../homeItems";
import { siteUrlFor } from "@/lib/onboarding/refreshServices";
import { ServicesPanel } from "../booking/ServicesPanel";
import { ProvidersPanel } from "../booking/ProvidersPanel";
import { LocationsPanel } from "../booking/LocationsPanel";
import { HoursPanel } from "../booking/HoursPanel";
import { FormPanel } from "../booking/FormPanel";
import { PricingPanel } from "../booking/PricingPanel";
import { UsersPanel } from "../UsersPanel";
import { BulkBuilderPanel } from "../BulkBuilderPanel";
import { listBulkBuilds, bulkBuildPayload } from "@/lib/bulkBuild";
import { KnowledgePanel, isDocSource } from "../KnowledgePanel";
import { GithubImport } from "../GithubImport";
import { GraphPanel } from "../GraphPanel";
import { AnswersPanel } from "../AnswersPanel";
import { A2uiPanel } from "../A2uiPanel";
import { DirectivesPanel } from "../DirectivesPanel";
import { ContactsPanel } from "../ContactsPanel";
import { cannedStats } from "@/lib/canned";
import { ProjectRow } from "../ProjectRow";
import { contentTabsFromSources, labelsFromNav, NEW_SOURCE_TAB_KEY } from "../contentTabs";
import { NewSourcePanel } from "../NewSourcePanel";
import { listIngestedItemsClassified } from "@/lib/ingestedItems";
import { GenericIngestPanel } from "../GenericIngestPanel";
import { PendingButton } from "../PendingButton";
import { panel, field, btn, btnGhost, SectionTitle, Label, Stamp, stamp } from "../ui";
import { ProfilePanel } from "./ProfilePanel";
import { PersonaPanel } from "./PersonaPanel";
import { ThemePanel } from "./ThemePanel";
import { ActivityPanel } from "./ActivityPanel";
import { FormDelete, Empty, grid2 } from "./shared";
import { loadAdminData } from "./queries";

export type AdminPanelSet = {
  /** Every panel keyed flat: fixed sections + live content tab keys. */
  flat: Record<string, React.ReactNode>;
  /** Display label per key, matching the dashboard strips. */
  labels: Record<string, string>;
  /** One pre-rendered node per element, `elements[panel][id]` (lib/adminElements.ts). */
  elements: ElementNodes;
  /** Ordered enabled Knowledge source keys (sources first, then new-source). */
  contentKeys: string[];
  /** Disabled sources, for the dashboard's "hidden sources" strip. */
  hiddenSources: { id: string; label: string }[];
  /** Operators additionally get the Users panel. */
  operator: boolean;
  themeConfig: Awaited<ReturnType<typeof getThemeConfig>>;
  slug: string;
};

export async function buildAdminPanels(
  user: User,
  query: { error?: string; gmail?: string; booking?: string } = {},
): Promise<AdminPanelSet> {
  const data = await loadAdminData(user, query);
  const { profile, personaConfig, themeConfig, projects, sources, photos, chatSessions, gStats, gEntities, gEdges, gSuggestions, gOverviews, canned, uiCards, ingestionSources, goalRows, ruleRows, addressBook, gmail, bookingConfig, orders, metrics, services, staffList, locationList, bookingSettings, bookings, operator, accounts, colors, personaSections } = data;

  const profileTab = <ProfilePanel data={data} />;

  const personaTab = <PersonaPanel data={data} />;

  const themeTab = <ThemePanel data={data} />;

  // ── PROJECTS TAB ──
  const projectsTab = (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Projects (GitHub + Live links)</SectionTitle>

      {/* ── Import all repos from a GitHub profile link. ── */}
      <div style={{ border: "1px solid var(--primary)", borderRadius: "var(--radius-md)", padding: 16, marginBottom: 18 }}>
        <strong style={{ fontSize: 14, color: "var(--on-surface)", display: "block", marginBottom: 6 }}>
          Import from GitHub
        </strong>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 10 }}>
          Paste your GitHub profile link — your top public repos become project cards, each
          enriched by Claude with a blurb, a &ldquo;Learn more&rdquo; write-up, and tags. Cards
          stream in one by one as they finish. Re-running refreshes projects whose repos have
          changed on GitHub since the last import and skips the rest.
        </p>
        <GithubImport />
      </div>

      <form action={addProject}>
        <div style={grid2}>
          <input name="name" placeholder="Project name" style={field} />
          <input name="order" type="number" placeholder="Order (0 = first)" style={field} />
        </div>
        <textarea
          name="blurb"
          placeholder="Short description — LEAVE BLANK to auto-generate from the link"
          rows={2}
          style={{ ...field, resize: "vertical" }}
        />
        <div style={grid2}>
          <input name="githubUrl" placeholder="GitHub URL (optional)" style={field} />
          <input name="liveUrl" placeholder="Live URL (optional)" style={field} />
        </div>
        <Label>Cover image (optional)</Label>
        <input type="file" name="image" accept="image/*" style={field} />
        <PendingButton pendingLabel="Adding…" style={btn}>
          Add project
        </PendingButton>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 12, marginTop: 8 }}>
          Leave the description blank and add a GitHub or Live link — Claude writes the short
          description automatically from that page.
        </p>
      </form>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {projects.length === 0 && <Empty>No projects yet.</Empty>}
        {projects.map((p) => (
          <ProjectRow
            key={p.id}
            project={{
              id: p.id,
              name: p.name,
              blurb: p.blurb,
              detail: p.detail,
              tags: safeTags(p.tags),
              githubUrl: p.githubUrl,
              liveUrl: p.liveUrl,
              order: p.order,
              ingestedAt: stamp(p.createdAt),
            }}
          />
        ))}
      </div>
    </section>
  );

  // ── KNOWLEDGE TABS — one per kind: links, PDFs/docs, pasted text ──
  // Links is the catch-all so a source with an unexpected type stays visible
  // (and deletable) rather than dropping out of the dashboard entirely.
  // Custom sources' rows (any type) carry an `ingest:` mark and belong to
  // their own tabs, never the built-in Knowledge ones.
  const owned = (s: { kind: string | null }) => (s.kind ?? "").startsWith("ingest:");
  const docSources = sources.filter((s) => isDocSource(s.type) && !owned(s));
  const textSources = sources.filter((s) => s.type === "text" && !owned(s));
  const linkSources = sources.filter(
    (s) => !isDocSource(s.type) && s.type !== "text" && !owned(s),
  );

  const linksTab = (
    <KnowledgePanel
      mode="link"
      title="Links"
      blurb="Paste a URL and it gets fetched, then Claude writes a summary + tags the chatbot can cite. LinkedIn often blocks bots — if a scan comes back thin, edit the summary below it."
      rows={linkSources}
      empty="No links yet. Add one above."
    />
  );

  const pdfsTab = (
    <KnowledgePanel
      mode="pdf"
      title="PDFs & documents"
      blurb="Upload a PDF or Word document — a résumé, a deck, a writeup. The text is parsed out and Claude summarises it into knowledge the chatbot can cite."
      rows={docSources}
      empty="No documents yet. Upload one above."
    />
  );

  const textTab = (
    <KnowledgePanel
      mode="text"
      title="Text"
      blurb="Paste text or markdown straight in — notes, an essay, an opinion, a bit of your story. Claude summarises it the same way it does a scanned link."
      rows={textSources}
      empty="No pasted text yet. Add some above."
    />
  );

  // ── PHOTOS (its own tab in the Content section) ──
  const photosSection = (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Photos (auto-described by Claude vision)</SectionTitle>
      <form action={uploadPhoto} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="file" name="file" accept="image/*" required style={{ ...field, marginBottom: 0, maxWidth: 260 }} />
        <input name="caption" placeholder="Short caption (optional)" style={{ ...field, marginBottom: 0, flex: 1 }} />
        <select name="kind" style={{ ...field, marginBottom: 0, maxWidth: 140 }}>
          <option value="gallery">Gallery</option>
          <option value="project">Project</option>
          <option value="profile">Profile</option>
        </select>
        <PendingButton pendingLabel="Uploading…" style={btn}>
          Upload
        </PendingButton>
      </form>
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {photos.length === 0 && <Empty>No photos yet.</Empty>}
        {photos.map((ph) => (
          <div key={ph.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/uploads/${ph.filename}`} alt={ph.description || "photo"} style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block", marginBottom: 8 }} />
            <div style={{ marginBottom: 6 }}>
              <Stamp date={ph.createdAt} prefix="ingested" />
            </div>
            <form action={updatePhoto}>
              <input type="hidden" name="id" value={ph.id} />
              <textarea name="description" defaultValue={ph.description} rows={3} placeholder="One-paragraph description…" style={{ ...field, marginBottom: 6, fontSize: 13, resize: "vertical" }} />
              <input name="caption" defaultValue={ph.caption ?? ""} placeholder="Caption" style={{ ...field, marginBottom: 8, fontSize: 13 }} />
              <div style={{ display: "flex", gap: 6 }}>
                <PendingButton pendingLabel="Saving…" style={btnGhost as React.CSSProperties}>
                  Save
                </PendingButton>
                <FormDelete id={ph.id} />
              </div>
            </form>
          </div>
        ))}
      </div>
    </section>
  );

  const activityTab = <ActivityPanel data={data} />;

  // ── AGENT BEHAVIOR TAB — how the chatbot answers and acts ──
  const goalsTab = <DirectivesPanel kind="goal" rows={goalRows} />;
  const rulesTab = <DirectivesPanel kind="rule" rows={ruleRows} />;

  // Which Content tabs exist, their labels, and their order all come from the
  // IngestionSource rows; built-in keys dispatch to their bespoke panels.
  const builtinPanels: Record<string, React.ReactNode> = {
    projects: projectsTab,
    links: linksTab,
    pdfs: pdfsTab,
    text: textTab,
    photos: photosSection,
    persona: personaTab,
  };
  // Custom sources render the generic panel over their own marked rows.
  const customRows = ingestionSources.filter((s) => !s.builtin && !builtinPanels[s.key]);
  const customItems = await Promise.all(
    customRows.map((s) => listIngestedItemsClassified(user.id, s.key)),
  );
  const contentPanels: Record<string, React.ReactNode> = { ...builtinPanels };
  customRows.forEach((s, i) => {
    contentPanels[s.key] = (
      <GenericIngestPanel
        row={s}
        items={customItems[i]}
        textAction={ingestCustomTextAction}
        imageAction={ingestCustomImageAction}
        urlAction={ingestCustomUrlAction}
        fileAction={ingestCustomFileAction}
        deleteItemAction={deleteIngestedItemAction}
      />
    );
  });
  // Every ingestion page gets its edit button — config (including hiding the
  // tab) lives at /admin/sources/<key>, behind the local edit password.
  const contentTabs = contentTabsFromSources(ingestionSources, contentPanels).map((t) => ({
    ...t,
    content: (
      <>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 14,
            marginBottom: 8,
          }}
        >
          <Link
            href={`/admin/sources/${t.key}`}
            style={{ fontSize: 13, textDecoration: "underline" }}
          >
            Edit ingestion
          </Link>
        </div>
        {t.content}
      </>
    ),
  }));

  // Fixed labels come from the nav config; source tabs add their own.
  const labels: Record<string, string> = labelsFromNav();
  for (const t of contentTabs) labels[t.key] = t.label;

  // Items per enabled source, for the Home checklist — all already loaded.
  const sourceCounts: Record<string, number> = {
    projects: projects.length,
    links: linkSources.length,
    pdfs: docSources.length,
    text: textSources.length,
    photos: photos.length,
    persona: Object.values(personaSections).filter((v) => v.trim()).length,
  };
  customRows.forEach((s, i) => {
    sourceCounts[s.key] = customItems[i].length;
  });

  const flat: Record<string, React.ReactNode> = {
    profile: profileTab,
    theme: themeTab,
    graph: (
      <GraphPanel
        stats={gStats}
        entities={gEntities}
        edges={gEdges}
        suggestions={gSuggestions}
        overviews={gOverviews}
      />
    ),
    activity: activityTab,
    answers: <AnswersPanel rows={canned} />,
    goals: goalsTab,
    rules: rulesTab,
    contacts: <ContactsPanel rows={addressBook} gmail={gmail} message={query.gmail} />,
    a2ui: <A2uiPanel rows={uiCards} slug={user.slug} />,
    [NEW_SOURCE_TAB_KEY]: <NewSourcePanel error={query.error} />,
  };
  for (const t of contentTabs) flat[t.key] = t.content;

  // Rows for Appointments/Home come from the richer booking store
  // (service/staff/location/customer/pricing/status) rather than the old
  // intake-only listAppointments.
  const appointmentRows = bookings.map(toCalendarAppointment);

  const fieldLabels = Object.fromEntries(bookingConfig.fields.map((f) => [f.key, f.label]));
  flat.appointments = (
    <AppointmentsPanel
      rows={appointmentRows}
      fieldLabels={fieldLabels}
      cancelAction={cancelBookingAction}
      confirmAction={confirmBookingAction}
      bookingEnabled={bookingConfig.enabled}
    />
  );
  flat.orders = (
    <OrdersPanel
      orders={orders.map(toCalendarOrder)}
      deleteAction={deleteOrderAction}
    />
  );
  // Always present, on or off: Settings › Booking holds the only switch that
  // turns booking back on.
  flat.booking = <BookingSettings config={bookingConfig} />;
  flat.home = (
    <HomePanel
      attention={attentionItems({
        flaggedDown: metrics.flaggedDown,
        unreviewed: cannedStats(canned).unreviewed,
        appointments: appointmentRows.map((a) => ({
          id: a.id,
          startsAt: new Date(a.startsAt),
          answers: a.answers,
        })),
        orders,
        topQuestions: metrics.topQuestions,
      })}
      checklist={checklistItems({
        profile,
        taglineSource: personaConfig.taglineSource,
        cardCount: uiCards.length,
        bookingEnabled: bookingConfig.enabled,
        sources: contentTabs.map((t) => ({
          key: t.key,
          label: t.label,
          count: sourceCounts[t.key] ?? 0,
        })),
      })}
    />
  );

  // ── Booking section (app/admin/booking/) ──
  flat["booking-services"] = (
    <ServicesPanel
      services={services}
      staff={staffList}
      locations={locationList}
      currency={bookingSettings.currency}
      bookingEnabled={bookingConfig.enabled}
      siteUrl={await siteUrlFor(user.id).catch(() => null)}
      notice={query.booking}
    />
  );
  flat["booking-providers"] = <ProvidersPanel staff={staffList} services={services} />;
  flat["booking-locations"] = <LocationsPanel locations={locationList} services={services} />;
  flat["booking-hours"] = <HoursPanel settings={bookingSettings} />;
  // Keyed "booking-questions" still, so `?tab=`, show_panel and the copilot's
  // links keep working; the tab reads "Form".
  flat["booking-questions"] = (
    <FormPanel
      config={bookingConfig}
      settings={bookingSettings}
      services={services}
      staff={staffList}
      locations={locationList}
    />
  );
  flat["booking-pricing"] = <PricingPanel settings={bookingSettings} />;
  if (operator) {
    flat.users = (
      <UsersPanel
        rows={accounts}
        selfId={user.id}
        updateAction={updateAccountAction}
        disableAction={setAccountDisabledAction}
        passwordAction={issuePasswordAction}
        createAction={createAccountAction}
        deleteAction={deleteAccountAction}
        impersonateAction={impersonateAction}
      />
    );
    flat.bulk = <BulkBuilderPanel builds={listBulkBuilds(user.id).map(bulkBuildPayload)} />;
  }

  // The element registry: the same rows, one node per row, for the copilot's
  // show_elements (lib/adminElements.ts decides ids and facets).
  const { nodes: elements } = buildElementNodes(
    {
      timeZone: bookingSettings.timezone || fallbackTimeZone(),
      currency: bookingSettings.currency,
      appointments: bookings,
      orders,
      goals: goalRows,
      rules: ruleRows,
      canned,
      services,
      staff: staffList,
      locations: locationList,
      fieldLabels,
    },
    { cancelAction: cancelBookingAction, confirmAction: confirmBookingAction, deleteOrderAction },
  );

  return {
    flat,
    labels,
    elements,
    contentKeys: [...contentTabs.map((t) => t.key), NEW_SOURCE_TAB_KEY],
    hiddenSources: ingestionSources
      .filter((s) => !s.enabled)
      .map((s) => ({ id: s.id, label: s.label })),
    operator,
    themeConfig,
    slug: user.slug,
  };
}
