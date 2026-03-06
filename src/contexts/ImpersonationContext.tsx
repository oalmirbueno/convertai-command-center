import React, { createContext, useContext, ReactNode } from "react";
import type { UserProfile } from "@/contexts/AuthContext";

interface ImpersonationContextType {
  isImpersonating: boolean;
  impersonatedProfile: UserProfile | null;
  impersonatedId: string | null;
}

const ImpersonationContext = createContext<ImpersonationContextType>({
  isImpersonating: false,
  impersonatedProfile: null,
  impersonatedId: null,
});

export function ImpersonationProvider({
  children,
  profile,
  clientId,
}: {
  children: ReactNode;
  profile: UserProfile | null;
  clientId: string | null;
}) {
  return (
    <ImpersonationContext.Provider
      value={{
        isImpersonating: !!clientId,
        impersonatedProfile: profile,
        impersonatedId: clientId,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
