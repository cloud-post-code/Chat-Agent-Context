import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The new-source builder lives inside the dashboard's Content section as the
 * "+ New ingestion source" sub-tab (NewSourcePanel). This route survives only
 * so old links keep working — it forwards straight there, carrying a create
 * error through when one is being echoed back.
 */
export default async function NewIngestionSourcePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const error = Array.isArray(query.error) ? query.error[0] : query.error;
  redirect(
    `/admin/dashboard?tab=new-source${error ? `&error=${encodeURIComponent(error)}` : ""}`,
  );
}
