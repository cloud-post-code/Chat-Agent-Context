/**
 * Primary proof for brand-identity-fields (see PROOF.md).
 * Run: npx tsx docs/features/brand-identity-fields/proof.ts
 *
 * Local dev Postgres only. ZERO Anthropic calls — the model extract function
 * is injected. Seeded rows use a throwaway proof-brand-<uuid> user, deleted
 * in a finally.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
// The prompt-injection assertions must not depend on a hosted embedder.
delete process.env.VOYAGE_API_KEY;
delete process.env.OPENAI_API_KEY;

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const fakePages = [] as never[]; // extract is injected; pages are unused by the fake

const extractReturning = (raw: Record<string, unknown>) => {
  const calls: { system: string; text: string }[] = [];
  const fn = async (system: string, text: string) => {
    calls.push({ system, text });
    return raw;
  };
  return { fn, calls };
};

async function main() {
  const { extractBrandIdentity, BRAND_SYSTEM_PROMPT } = await import("@/lib/onboarding/brand");
  const { savePersonaBrand } = await import("@/lib/brand");
  const { prisma } = await import("@/lib/db");
  const { buildSystemPrompt } = await import("@/lib/knowledge");

  // ── extraction sanitization ──

  {
    const { fn, calls } = extractReturning({
      tagline: "  Fresh bread, daily.  ",
      tagline_source: "extracted",
      values: ["Local first", "Honest baking", "Community"],
      tone: "Warm and plainspoken; short sentences; no jargon.",
    });
    const b = await extractBrandIdentity(fakePages, () => {}, fn);
    check("extracted tagline passes through verbatim (trimmed)", b.tagline === "Fresh bread, daily.");
    check("extracted flag preserved", b.taglineSource === "extracted");
    check("values preserved", b.values.length === 3 && b.values[0] === "Local first");
    check("tone preserved", b.tone.startsWith("Warm and plainspoken"));
    check("extract called once with the brand prompt", calls.length === 1 && calls[0].system === BRAND_SYSTEM_PROMPT);
  }

  {
    const { fn } = extractReturning({
      tagline: "Bread worth the walk",
      tagline_source: "suggested",
      values: [],
      tone: "",
    });
    const b = await extractBrandIdentity(fakePages, () => {}, fn);
    check("suggested tagline flagged suggested", b.taglineSource === "suggested");
  }

  {
    // A tagline with an invalid/missing source flag must NEVER be presented
    // as extracted — it coerces to "suggested".
    const { fn } = extractReturning({ tagline: "Something", tagline_source: "definitely", values: [], tone: "" });
    const b = await extractBrandIdentity(fakePages, () => {}, fn);
    check("invalid source flag coerces to suggested", b.taglineSource === "suggested");
    const { fn: fn2 } = extractReturning({ tagline: "Something", values: [], tone: "" });
    const b2 = await extractBrandIdentity(fakePages, () => {}, fn2);
    check("missing source flag coerces to suggested", b2.taglineSource === "suggested");
  }

  {
    const { fn } = extractReturning({ tagline: "", tagline_source: "extracted", values: [], tone: "" });
    const b = await extractBrandIdentity(fakePages, () => {}, fn);
    check("empty tagline forces empty source flag", b.taglineSource === "");
  }

  {
    const { fn } = extractReturning({
      tagline: "",
      tagline_source: "",
      values: ["  One  ", 42, "", "Two", "Three", "Four", "Five", "Six", { junk: true }],
      tone: 7,
    });
    const b = await extractBrandIdentity(fakePages, () => {}, fn);
    check("values clamp to 5 trimmed strings, junk dropped",
      b.values.length === 5 && b.values[0] === "One" && b.values[4] === "Five",
      JSON.stringify(b.values));
    check("non-string tone becomes empty", b.tone === "");
  }

  {
    const { fn } = extractReturning({});
    const b = await extractBrandIdentity(fakePages, () => {}, fn);
    check("absent everything stays empty",
      b.tagline === "" && b.taglineSource === "" && b.values.length === 0 && b.tone === "");
  }

  // ── persistence + prompt injection (local Postgres) ──

  const userId = `proof-brand-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, email: `${userId}@proof.local`, name: "Proof Brand", passwordHash: "x", slug: userId },
  });
  try {
    await savePersonaBrand(userId, {
      tagline: "Bread worth the walk",
      taglineSource: "suggested",
      values: ["Local first", "Honest baking"],
      tone: "Warm, plainspoken, a little playful.",
    });
    const row1 = await prisma.personaConfig.findUnique({ where: { userId } });
    check("create path persists tagline + flag", row1?.tagline === "Bread worth the walk" && row1?.taglineSource === "suggested");
    check("create path persists values as JSON", JSON.parse(row1?.brandValues ?? "[]").length === 2);
    check("create path persists tone", (row1?.toneOfVoice ?? "").startsWith("Warm"));

    await savePersonaBrand(userId, {
      tagline: "Fresh bread, daily.",
      taglineSource: "extracted",
      values: ["Community"],
      tone: "Direct and warm.",
    });
    const row2 = await prisma.personaConfig.findUnique({ where: { userId } });
    check("update path overwrites all four fields",
      row2?.tagline === "Fresh bread, daily." && row2?.taglineSource === "extracted" &&
      JSON.parse(row2?.brandValues ?? "[]")[0] === "Community" && row2?.toneOfVoice === "Direct and warm.");

    const prompt = await buildSystemPrompt(userId);
    check("system prompt carries brand values", prompt.includes("Community"));
    check("system prompt carries tone of voice", prompt.includes("Direct and warm."));

    await savePersonaBrand(userId, { tagline: "", taglineSource: "", values: [], tone: "" });
    const emptyPrompt = await buildSystemPrompt(userId);
    check("empty brand fields render no brand blocks",
      !emptyPrompt.includes("BRAND VALUES") && !emptyPrompt.includes("TONE OF VOICE"));
  } finally {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  }

  // ── wire shape: the job payload carries stepBrand; the save route accepts brand ──
  {
    const jobsSrc = readFileSync(path.join(root, "lib/onboarding/jobs.ts"), "utf8");
    check("theme stage populates stepBrand", jobsSrc.includes("stepBrand"));
    const routeSrc = readFileSync(path.join(root, "app/api/admin/onboarding/save/route.ts"), "utf8");
    check("save route handles a brand key", routeSrc.includes("body.brand"));
    const flowSrc = readFileSync(path.join(root, "app/admin/onboarding/OnboardingFlow.tsx"), "utf8");
    check("onboarding theme card renders the brand fields", flowSrc.includes("stepBrand") && /suggested/i.test(flowSrc));
    const dashSrc = readFileSync(path.join(root, "app/admin/dashboard/page.tsx"), "utf8");
    check("dashboard Theme tab renders the brand fields",
      dashSrc.includes("toneOfVoice") && dashSrc.includes("brandValues"));
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL GREEN");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("PROOF ERROR:", err);
  process.exit(1);
});
