import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma, getProfile, getPersonaConfig, getThemeConfig } from "@/lib/db";
import { safeTags } from "@/lib/knowledge";
import { parseSocialLinks } from "@/lib/socialLinks";
import { safeJson } from "@/lib/util";
import { PERSONA_BLURB, PERSONA_SECTIONS, safePersonaSections } from "@/lib/persona";
import { FONT_OPTIONS, BODY_FONT_OPTIONS } from "@/lib/fonts";
import { RADIUS_OPTIONS } from "@/lib/theme";
import {
  saveProfile,
  restartOnboarding,
  savePersona,
  saveTheme,
  uploadLogo,
  addProject,
  uploadPhoto,
  updatePhoto,
  deletePhoto,
  deleteChatSession,
  saveChatFeedback,
  ingestCustomTextAction,
  ingestCustomImageAction,
  ingestCustomUrlAction,
  ingestCustomFileAction,
  deleteIngestedItemAction,
  updateAccountAction,
  setAccountDisabledAction,
  issuePasswordAction,
  createAccountAction,
  deleteAccountAction,
  impersonateAction,
  cancelAppointmentAction,
} from "./actions";
import { CalendarPanel } from "./CalendarPanel";
import { getBookingConfig, listAppointments } from "@/lib/appointments";
import { isOperator, listAccounts } from "@/lib/accountAdmin";
import { UsersPanel } from "./UsersPanel";
import { KnowledgePanel, isDocSource } from "./KnowledgePanel";
import { GithubImport } from "./GithubImport";
import { GraphPanel } from "./GraphPanel";
import { AnswersPanel } from "./AnswersPanel";
import { A2uiPanel } from "./A2uiPanel";
import { DirectivesPanel } from "./DirectivesPanel";
import { listDirectives } from "@/lib/directives";
import { ContactsPanel } from "./ContactsPanel";
import { listAddressBook } from "@/lib/addressBook";
import { gmailStatus } from "@/lib/gmail/client";
import { listUiCards } from "@/lib/uiCards";
import { PersonaPrompt } from "./PersonaPrompt";
import { personaExtractionPrompt } from "@/lib/personaPrompt";
import { graphStats, listEntities, listEdges, suggestedMerges } from "@/lib/retrieval/graph";
import { listCannedAnswers } from "@/lib/canned";
import { draftBlankAnswers } from "@/lib/answerDrafts";
import { ProjectRow } from "./ProjectRow";
import { contentTabsFromSources, NEW_SOURCE_TAB_KEY } from "./contentTabs";
import { NewSourcePanel } from "./NewSourcePanel";
import { listIngestionSources } from "@/lib/ingestionSources";
import { listIngestedItemsClassified } from "@/lib/ingestedItems";
import { GenericIngestPanel } from "./GenericIngestPanel";
import { PendingButton } from "./PendingButton";
import { SaveButton } from "./SaveButton";
import { AutoUploadFile } from "./AutoUploadFile";
import { ThemePicker } from "./ThemePicker";
import type { ThemeColors } from "@/lib/theme";
import { panel, field, btn, btnGhost, btnDanger, SectionTitle, Label, Stamp, stamp } from "./ui";
import { chatMetrics } from "@/lib/activity";

/**
 * Every admin panel, built once and rendered by two surfaces: the classic
 * dashboard (Tabs/SubTabs strips) and the chat-first page (panels revealed
 * inline in the conversation). One source of truth — the chat must show the
 * exact panel the dashboard shows, so the construction lives here and the
 * pages only lay panels out.
 */

export type AdminPanelSet = {
  /** Every panel keyed flat: fixed sections + live content tab keys. */
  flat: Record<string, React.ReactNode>;
  /** Display label per key, matching the dashboard strips. */
  labels: Record<string, string>;
  /** Ordered enabled Content tab keys (sources first, then new-source). */
  contentKeys: string[];
  /** Disabled sources, for the dashboard's "hidden sources" strip. */
  hiddenSources: { id: string; label: string }[];
  /** Whether the Calendar tab/panel exists (the Appointments toggle). */
  operator: boolean;
  themeConfig: Awaited<ReturnType<typeof getThemeConfig>>;
  slug: string;
};

export async function buildAdminPanels(
  user: User,
  query: { error?: string; gmail?: string } = {},
): Promise<AdminPanelSet> {
  const [
    profile,
    personaConfig,
    themeConfig,
    projects,
    sources,
    photos,
    chatSessions,
    gStats,
    gEntities,
    gEdges,
    gSuggestions,
    gOverviews,
    canned,
    uiCards,
    ingestionSources,
    goalRows,
    ruleRows,
    addressBook,
    gmail,
    bookingConfig,
    appointments,
  ] = await Promise.all([
      getProfile(user.id),
      getPersonaConfig(user.id),
      getThemeConfig(user.id),
      prisma.project.findMany({ where: { userId: user.id }, orderBy: { order: "asc" } }),
      prisma.source.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
      // Custom ingestion sources own their `ingest:*`-marked photos; the
      // built-in Photos tab shows only its own.
      prisma.photo.findMany({
        where: { userId: user.id, NOT: { kind: { startsWith: "ingest:" } } },
        orderBy: { order: "asc" },
      }),
      prisma.chatSession.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: { messages: { orderBy: { createdAt: "asc" } } },
      }),
      graphStats(user.id),
      listEntities(user.id),
      listEdges(user.id),
      suggestedMerges(user.id),
      prisma.chunk.findMany({
        where: { userId: user.id, originKind: "cluster" },
        orderBy: { originLabel: "asc" },
        select: { id: true, originLabel: true, text: true },
      }),
      // Starters are seeded at signup (lib/users.ts) and re-checked at boot;
      // the dashboard just reads. Any blank answer row still gets a first
      // draft here — that calls the model, which belongs in an admin visit,
      // not in boot. Best-effort: a provider outage must not take down the
      // admin.
      draftBlankAnswers(user.id)
        .catch(() => 0)
        .then(() => listCannedAnswers(user.id)),
      listUiCards(user.id),
      listIngestionSources(user.id),
      listDirectives(user.id, "goal"),
      listDirectives(user.id, "rule"),
      listAddressBook(user.id),
      gmailStatus(user.id),
      getBookingConfig(user.id),
      listAppointments(user.id),
    ]);
  const metrics = chatMetrics(chatSessions);
  // Operator-only: account rows are fetched (and the Users tab rendered) for
  // operators alone; the actions re-check the gate on every call.
  const operator = await isOperator(user);
  const accounts = operator ? (await listAccounts({ pageSize: 100 })).rows : [];
  const colors = safeJson<ThemeColors>(themeConfig.themeColors, {});
  const personaSections = safePersonaSections(personaConfig.personaSections);

  // ── PROFILE TAB — business identity ──
  const profileTab = (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Profile</SectionTitle>

      <form action={saveProfile}>
        <div style={grid2}>
          <div>
            <Label>Company name</Label>
            <input name="company_name" defaultValue={profile.company_name} style={field} />
          </div>
          <div>
            <Label>Owner name</Label>
            <input name="owner_name" defaultValue={profile.owner_name} style={field} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Company address</Label>
          <input name="company_address" defaultValue={profile.company_address} placeholder="Street, City, State" style={field} />
        </div>
        <div style={grid2}>
          <div>
            <Label>Company phone number</Label>
            <input name="company_phone_number" defaultValue={profile.company_phone_number} style={field} />
          </div>
          <div>
            <Label>Company email</Label>
            <input name="company_email" defaultValue={profile.company_email} style={field} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Company hours</Label>
          <input name="company_hours" defaultValue={profile.company_hours} placeholder="Mon-Fri 9am-5pm" style={field} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Social media (one per line, &quot;platform: link&quot;)</Label>
          <textarea
            name="social_links"
            rows={3}
            defaultValue={parseSocialLinks(profile.social_links)
              .map((s) => (s.platform ? `${s.platform}: ${s.url}` : s.url))
              .join("\n")}
            placeholder={"instagram: https://instagram.com/yourbusiness"}
            style={{ ...field, resize: "vertical" }}
          />
        </div>

        <SaveButton>Save profile</SaveButton>
      </form>

      <form action={restartOnboarding} style={{ marginTop: 26, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <PendingButton pendingLabel="Clearing…" style={btnDanger}>
          Restart onboarding — clears all account data
        </PendingButton>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 12, marginTop: 6 }}>
          Deletes everything on this account — profile, knowledge, photos, chats, persona, and theme — and walks you through setup again.
        </p>
      </form>
    </section>
  );

  // ── PERSONA TAB — the tagline, plus one free-prose field ──
  const personaTab = (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Persona</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 18 }}>
        {PERSONA_BLURB}
      </p>

      {/* Company logo — auto-uploads the moment a file is chosen. */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
        {personaConfig.company_logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={personaConfig.company_logo} alt="company logo" style={{ width: 72, height: 72, borderRadius: "var(--radius-md)", objectFit: "cover", border: "1px solid var(--border)" }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: "var(--radius-md)", background: "var(--bg-soft)", border: "1px solid var(--border)" }} />
        )}
        <form action={uploadLogo}>
          <Label>Company logo</Label>
          <AutoUploadFile name="file" accept="image/*" hint="Pick an image — it uploads automatically." />
        </form>
      </div>

      <PersonaPrompt prompt={personaExtractionPrompt()} />

      <form action={savePersona}>
        <Label>Tagline (shown under the company name on the live site)</Label>
        <input name="tagline" defaultValue={personaConfig.tagline} style={field} />

        <div style={{ borderTop: "1px solid var(--border)", margin: "18px 0", paddingTop: 16 }}>
          {PERSONA_SECTIONS.map((s) => (
            <div key={s.key} style={{ marginBottom: 4 }}>
              <Label>{s.label}</Label>
              <textarea
                name={`section_${s.key}`}
                defaultValue={personaSections[s.key]}
                rows={s.rows}
                placeholder={s.hint}
                style={{ ...field, resize: "vertical", lineHeight: 1.5 }}
              />
            </div>
          ))}
        </div>

        <SaveButton>Save persona</SaveButton>
      </form>
    </section>
  );

  // ── THEME TAB ──
  const themeTab = (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Theme</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 18 }}>
        Everything here restyles the live site.
      </p>

      <form action={saveTheme}>
        <Label>Aesthetic (describe the visual feeling you want)</Label>
        <textarea name="aesthetic" defaultValue={themeConfig.aesthetic} rows={2} style={{ ...field, resize: "vertical" }} />

        {/* ── Brand voice: tagline (with provenance), values, tone. ── */}
        <div style={{ borderTop: "1px solid var(--border)", margin: "16px 0", paddingTop: 16 }}>
          <Label>
            Tagline
            {personaConfig.tagline && personaConfig.taglineSource === "suggested" && (
              <span
                style={{
                  marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: 999,
                  background: "var(--bg-soft)", border: "1px solid var(--border)",
                  fontStyle: "italic", fontWeight: 400,
                }}
                title="Your site doesn't state a tagline, so this one was written from your site's own copy during onboarding."
              >
                suggested — not from your site
              </span>
            )}
          </Label>
          <input name="tagline" defaultValue={personaConfig.tagline} style={field} />
          <input type="hidden" name="taglineSource" defaultValue={personaConfig.taglineSource} />

          <Label>Brand values (one per line — what the business stands for)</Label>
          <textarea
            name="brandValues"
            defaultValue={safeJson<string[]>(personaConfig.brandValues, []).join("\n")}
            rows={3}
            style={{ ...field, resize: "vertical" }}
          />

          <Label>Tone of voice (how your agent writes — used as a style instruction)</Label>
          <textarea
            name="toneOfVoice"
            defaultValue={personaConfig.toneOfVoice}
            rows={2}
            style={{ ...field, resize: "vertical" }}
          />
        </div>

        <div style={{ borderTop: "1px solid var(--border)", margin: "16px 0", paddingTop: 16 }}>
          <ThemePicker
            fontOptions={FONT_OPTIONS}
            bodyFontOptions={BODY_FONT_OPTIONS}
            radiusOptions={RADIUS_OPTIONS}
            initial={{
              themeFont: themeConfig.themeFont,
              themeBodyFont: themeConfig.themeBodyFont,
              themeRadius: themeConfig.themeRadius,
              themeFontSize: themeConfig.themeFontSize,
              themeHeadingWeight: themeConfig.themeHeadingWeight,
              colors,
            }}
          />
        </div>

        <SaveButton>Save theme</SaveButton>
      </form>
    </section>
  );

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

  // ── ACTIVITY TAB — what visitors are asking the chatbot ──
  const activityTab = (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Activity — visitor conversations</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 14 }}>
        Every conversation people have with your chatbot is recorded here — their
        questions and the answers they got. Click any chat to read the full transcript.
      </p>

      {chatSessions.length === 0 ? (
        <Empty>No conversations yet. They&apos;ll appear here as visitors chat.</Empty>
      ) : (
        <>
          {/* ── Metrics overview ── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <Stat label="Chats" value={metrics.totalChats} />
            <Stat label="This week" value={metrics.chatsThisWeek} />
            <Stat label="Questions" value={metrics.totalQuestions} />
            <Stat label="Messages" value={metrics.totalMessages} />
            <Stat label="Avg / chat" value={metrics.avgQuestions} />
            <Stat label="Flagged 👎" value={metrics.flaggedDown} />
          </div>

          {/* ── Most-asked questions ── */}
          {metrics.topQuestions.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <Label>Most asked</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {metrics.topQuestions.map((q) => (
                  <div
                    key={q.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "7px 12px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {q.label}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--accent-on-bg-soft)",
                        background: "var(--bg-soft)",
                        borderRadius: "var(--radius-pill)",
                        padding: "1px 9px",
                      }}
                    >
                      {q.count}×
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Label>All conversations</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {chatSessions.map((s) => (
          <details key={s.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
            <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", listStyle: "none" }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.firstQuery || "(no question)"}
                </strong>
                <span style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 11 }}>
                  {s.messages.length} messages · {s.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
              </span>
              <form action={deleteChatSession}>
                <input type="hidden" name="id" value={s.id} />
                <PendingButton pendingLabel="Deleting…" style={btnDanger as React.CSSProperties}>
                  Delete
                </PendingButton>
              </form>
            </summary>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {s.messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
            </div>
          </details>
        ))}
          </div>
        </>
      )}
    </section>
  );

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

  const labels: Record<string, string> = {
    profile: "Profile",
    theme: "Theme",
    graph: "Knowledge",
    activity: "Activity",
    answers: "Presets",
    goals: "Goals",
    rules: "Rules",
    contacts: "Contacts",
    a2ui: "A2UI",
    booking: "Calendar",
    calendar: "Calendar",
    [NEW_SOURCE_TAB_KEY]: "+ New ingestion source",
    users: "Users",
  };
  for (const t of contentTabs) labels[t.key] = t.label;

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
  // Always present: the Calendar now carries the Appointments settings, so it
  // is where booking gets turned back on after it has been turned off.
  flat.calendar = (
    <CalendarPanel
      rows={appointments.map((a) => ({
        id: a.id,
        startsAt: a.startsAt.toISOString(),
        answers: a.answers,
      }))}
      fieldLabels={Object.fromEntries(bookingConfig.fields.map((f) => [f.key, f.label]))}
      cancelAction={cancelAppointmentAction}
      config={bookingConfig}
    />
  );
  // The retired standalone Appointments panel: anything still naming "booking"
  // (a canned answer, a saved chat request) lands on the Calendar instead.
  flat.booking = flat.calendar;
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
  }

  return {
    flat,
    labels,
    contentKeys: [...contentTabs.map((t) => t.key), NEW_SOURCE_TAB_KEY],
    hiddenSources: ingestionSources
      .filter((s) => !s.enabled)
      .map((s) => ({ id: s.id, label: s.label })),
    operator,
    themeConfig,
    slug: user.slug,
  };
}

function FormDelete({ id }: { id: string }) {
  return (
    <form action={deletePhoto}>
      <input type="hidden" name="id" value={id} />
      <PendingButton pendingLabel="Deleting…" style={btnDanger as React.CSSProperties}>
        Delete
      </PendingButton>
    </form>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>{children}</p>;
}

/** One message in a transcript: the bubble, plus feedback controls on bot answers. */
function MessageRow({
  message,
}: {
  message: { id: string; role: string; content: string; rating: string | null; note: string | null };
}) {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", gap: 4 }}>
      <div
        style={{
          maxWidth: "85%",
          background: isUser ? "var(--primary)" : "var(--bg-soft)",
          color: isUser ? "var(--on-primary)" : "var(--on-bg-soft)",
          border: isUser ? "1px solid transparent" : "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: "8px 12px",
          fontSize: 13,
          whiteSpace: "pre-wrap",
        }}
      >
        {message.content}
      </div>
      {!isUser && <FeedbackControls id={message.id} rating={message.rating} note={message.note} />}
    </div>
  );
}

/**
 * Admin feedback on a bot answer. 👍/👎 buttons submit immediately; the note
 * (a correction the bot should follow next time) submits with its own Save.
 * Each is its own form so a rating click doesn't require typing a note.
 */
function FeedbackControls({
  id,
  rating,
  note,
}: {
  id: string;
  rating: string | null;
  note: string | null;
}) {
  const pill = (active: boolean): React.CSSProperties => ({
    ...(btnGhost as React.CSSProperties),
    padding: "4px 10px",
    fontSize: 13,
    ...(active ? { borderColor: "var(--primary)", color: "var(--accent-on-bg-soft)", background: "var(--bg-soft)" } : {}),
  });
  return (
    <div style={{ maxWidth: "85%", width: "100%" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <form action={saveChatFeedback} style={{ display: "flex", gap: 6 }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="note" value={note ?? ""} />
          {/* Icon-width buttons: an hourglass keeps the pill from resizing mid-save. */}
          <PendingButton pendingLabel="⏳" name="rating" value="up" style={pill(rating === "up")} title="Good answer">
            👍
          </PendingButton>
          <PendingButton pendingLabel="⏳" name="rating" value="down" style={pill(rating === "down")} title="Bad answer">
            👎
          </PendingButton>
        </form>
        {rating && (
          <form action={saveChatFeedback}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="rating" value="" />
            <input type="hidden" name="note" value="" />
            <PendingButton pendingLabel="Clearing…" style={{ ...(btnGhost as React.CSSProperties), padding: "4px 10px", fontSize: 12 }} title="Clear feedback">
              Clear
            </PendingButton>
          </form>
        )}
        {rating === "up" && <span style={{ fontSize: 11, color: "var(--success-on-surface)" }}>Marked good</span>}
      </div>

      {/* Correction note — steers future answers when the rating is 👎. */}
      <form action={saveChatFeedback} style={{ marginTop: 6 }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="rating" value={rating ?? ""} />
        <textarea
          name="note"
          defaultValue={note ?? ""}
          rows={2}
          placeholder="What should it have done instead? Saved as a correction the bot follows on future chats."
          style={{ ...field, marginBottom: 6, fontSize: 12, resize: "vertical" }}
        />
        <PendingButton pendingLabel="Saving…" style={{ ...(btnGhost as React.CSSProperties), padding: "5px 12px", fontSize: 12 }}>
          Save correction
        </PendingButton>
      </form>
    </div>
  );
}

/** A single metric tile: big number over a small label. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      data-fill="bg-soft"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "12px 14px",
        background: "var(--bg-soft)",
        color: "var(--on-bg-soft)",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-heading)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--on-bg-soft)", fontStyle: "italic", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
