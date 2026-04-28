import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import ClientVault from "@/components/vault/ClientVault";
import { KeyRound } from "lucide-react";

export default function ClientVaultPage() {
  const { profile } = useAuth();
  const { impersonatedId } = useImpersonation();
  const role = profile?.role || "client";
  const isAdminOrTeam = role === "admin" || ["design", "traffic", "manager"].includes(role);
  const clientId = impersonatedId || profile?.id;

  if (!clientId) return null;

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <header className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
          <KeyRound className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cofre de Acessos</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Senhas, links úteis e sistemas organizados em um só lugar.
          </p>
        </div>
      </header>

      <ClientVault clientId={clientId} canManage={isAdminOrTeam} />
    </div>
  );
}
