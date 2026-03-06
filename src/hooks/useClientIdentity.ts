import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";

/**
 * Returns the effective client identity.
 * When admin is impersonating a client, returns the impersonated client's data.
 * Otherwise returns the logged-in user's data.
 */
export function useClientIdentity() {
  const { user, profile } = useAuth();
  const { isImpersonating, impersonatedProfile, impersonatedId } = useImpersonation();

  if (isImpersonating && impersonatedId) {
    return {
      clientId: impersonatedId,
      profile: impersonatedProfile,
      user, // keep real user for auth purposes
      isImpersonating: true,
    };
  }

  return {
    clientId: user?.id || null,
    profile,
    user,
    isImpersonating: false,
  };
}
