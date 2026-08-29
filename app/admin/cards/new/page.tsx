import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { CardBuilder } from "../../CardBuilder";

export const dynamic = "force-dynamic";

/** The AI card builder, on its own page: describe → draft → feedback → save. */
export default async function NewCardPage() {
  const user = await currentUser();
  if (!user) redirect("/admin");
  return <CardBuilder slug={user.slug} />;
}
