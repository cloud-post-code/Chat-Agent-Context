import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CardBuilder } from "../../CardBuilder";

export const dynamic = "force-dynamic";

/** The same builder, opened on an existing card: feedback revises the stored
 *  draft, and Save writes back to the same row (same key, same anchor). */
export default async function EditCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/admin");
  const { id } = await params;
  const row = await prisma.uiCard.findFirst({ where: { id, userId: user.id } });
  if (!row) notFound();
  return (
    <CardBuilder
      slug={user.slug}
      id={row.id}
      cardKey={row.key}
      initial={{
        label: row.label,
        tool: row.tool,
        description: row.description,
        reason: row.reason,
        note: row.note,
        sampleBlock: row.sampleBlock,
      }}
    />
  );
}
