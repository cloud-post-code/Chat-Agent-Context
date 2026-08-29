import { themeOverrideCss, type ThemeColors } from "@/lib/theme";
import { headingFamily, bodyFamily } from "@/lib/fonts";
import { safeJson } from "@/lib/util";

/** The ThemeConfig columns the override needs — a row or nothing. */
export type TenantTheme = {
  themeFont: string;
  themeBodyFont: string;
  themeColors: string;
  themeRadius: string;
  themeFontSize: string;
  themeHeadingWeight: string;
} | null;

/**
 * One tenant's theme override as an inline <style>. The root layout renders
 * the default brand; the surfaces that belong to a single tenant — their
 * public agent page and their admin dashboard — drop this in to re-skin
 * everything below it from that tenant's ThemeConfig.
 */
export function TenantThemeStyle({ theme }: { theme: TenantTheme }) {
  if (!theme) return null;
  const colors = safeJson<ThemeColors>(theme.themeColors ?? "{}", {});
  const override = themeOverrideCss({
    headingFamily: headingFamily(theme.themeFont ?? "space-grotesk"),
    bodyFamily: bodyFamily(theme.themeBodyFont ?? "inter"),
    radius: theme.themeRadius ?? "rounded",
    fontSize: theme.themeFontSize ?? "",
    headingWeight: theme.themeHeadingWeight ?? "",
    colors,
  });
  return <style dangerouslySetInnerHTML={{ __html: override }} />;
}
