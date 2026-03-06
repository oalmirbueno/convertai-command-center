/**
 * Brand mapping for project types:
 * - SiteBolt (filha): site, landing_page, event, other individual projects
 * - AcelerIQ (mãe): social_media, trafego, monthly plans
 * - AcelerIQ + SiteBolt: automation (envolve IA e processos)
 */

const SITEBOLT_TYPES = ["site", "landing_page", "event", "other"];
const JOINT_TYPES = ["automation"];
// AcelerIQ types: social_media, trafego — but those are recurring/monthly

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
