// Keep browser profile queries explicit. Authentication and first-access
// credentials must never be selected into React Query caches or UI state.
export const PROFILE_SAFE_SELECT = "id, full_name, email, company_name, avatar_url, plan_renewal_date, plan_status, services_config, onboarding_done, created_at, updated_at, phone, plan_name, plan_value, client_type, brand, first_access_used_at, overdue_since, deleted_at" as const;
