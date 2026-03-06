/**
 * Brand mapping for project types:
 * - SiteBolt (filha): site, landing_page, event, other individual projects
 * - AcelerIQ (mãe): social_media, trafego, monthly plans
 * - AcelerIQ + SiteBolt: automation (envolve IA e processos)
 */

const SITEBOLT_TYPES = ["site", "landing_page", "event", "other"];
const JOINT_TYPES = ["automation"];
// AcelerIQ types: social_media, trafego — recurring/monthly

export type BrandFilter = "all" | "aceleriq" | "sitebolt";

export const BRAND_FILTERS: { value: BrandFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "aceleriq", label: "AcelerIQ" },
  { value: "sitebolt", label: "SiteBolt" },
];

export function getProjectBrand(projectType?: string): string {
  if (!projectType) return "SiteBolt";
  if (JOINT_TYPES.includes(projectType)) return "AcelerIQ + SiteBolt";
  if (SITEBOLT_TYPES.includes(projectType)) return "SiteBolt";
  return "AcelerIQ";
}

export function getProjectBrandColor(projectType?: string): string {
  if (!projectType) return "text-primary";
  if (JOINT_TYPES.includes(projectType)) return "text-info";
  if (SITEBOLT_TYPES.includes(projectType)) return "text-primary";
  return "text-success";
}

/** Check if a project type belongs to a brand filter */
export function matchesBrandFilter(projectType: string | undefined, filter: BrandFilter): boolean {
  if (filter === "all") return true;
  if (filter === "sitebolt") {
    return SITEBOLT_TYPES.includes(projectType || "") || JOINT_TYPES.includes(projectType || "");
  }
  if (filter === "aceleriq") {
    // AcelerIQ = monthly types (social_media, trafego) + automation (joint)
    return !SITEBOLT_TYPES.includes(projectType || "");
  }
  return true;
}

/** Check if a billing type is monthly (AcelerIQ) */
export function isBillingAceleriq(billingType: string): boolean {
  return billingType === "renewal" || billingType === "plan_renewal";
}
