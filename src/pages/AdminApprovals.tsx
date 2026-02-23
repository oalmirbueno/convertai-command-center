import { useState } from "react";
import { useAllFiles, useProjects } from "@/hooks/useSupabaseData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FileImage, FileText, Film, Archive, RefreshCw, Upload } from "lucide-react";

const approvalBadge: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-warning/10 text-warning border-warning/20", label: "⏳ Pendente" },
  approved: { cls: "bg-success/10 text-success border-success/20", label: "✓ Aprovado" },
  rejected: { cls: "bg-destructive/10 text-destructive border-destructive/20", label: "Rejeitado" },
};

const TABS = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Pendentes" },
  { id: "approved", label: "Aprovados" },
  { id: "rejected", label: "Rejeitados" },
];

const fileIcon = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp"].includes(ext)) return FileImage;
  if (["mp4"].includes(ext)) return Film;
  if (["zip"].includes(ext)) return Archive;
  return FileText;
};

const isImage = (name: string) => {
  const ext = name?.split(".").pop()?.toLowerCase() || "";
  return ["jpg","jpeg","png","gif","webp"].includes(ext);
};

export default function AdminApprovals() {
  const { user } = useAuth();
  const { data: allFiles, isLoading } = useAllFiles();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");

  // Only files with approval status != none
  const approvalFiles = (allFiles || []).filter((f: any) => f.approval_status !== "none");
  const filtered = activeTab === "all" ? approvalFiles : approvalFiles.filter((f: any) => f.approval_status === activeTab);

  const pendingCount = approvalFiles.filter((f: any) => f.approval_status === "pending").length;

  const handleResend = async (fileId: string) => {
    try {
      await supabase.from("files").update({ approval_status: "pending", feedback: null }).eq("id", fileId);
      queryClient.invalidateQueries({ queryKey: ["all-files"] });
      toast({ title: "Reenviado para aprovação" });
    } catch {
      toast({ title: "Erro", variant: "destructive" });
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="heading-page">Aprovações</p>
          {pendingCount > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning/10 text-warning">
              {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-xs uppercase tracking-wide rounded-lg whitespace-nowrap transition-colors ${
              activeTab === t.id
                ? "text-foreground border-b-2 border-primary bg-secondary/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Nenhuma aprovação encontrada</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {filtered.map((f: any) => {
            const Icon = fileIcon(f.file_name);
            const badge = approvalBadge[f.approval_status] || approvalBadge.pending;
            return (
              <div key={f.id} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Preview */}
                <div className="h-32 bg-secondary flex items-center justify-center">
                  {isImage(f.file_name) ? (
                    <img src={f.file_url} alt={f.file_name} className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="w-12 h-12 text-muted-foreground/30" />
                  )}
                </div>

                <div className="p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground truncate">{f.file_name}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{f.project?.name || "—"}</span>
                    <span>•</span>
                    <span>{f.client?.company_name || f.client?.full_name || "—"}</span>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground">{formatDate(f.created_at)}</p>

                  <span className={`inline-block text-[11px] px-2.5 py-1 rounded-full border ${badge.cls}`}>
                    {badge.label}
                  </span>

                  {f.approval_status === "rejected" && f.feedback && (
                    <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 mt-2">
                      <p className="text-[11px] text-muted-foreground mb-0.5">Feedback do cliente:</p>
                      <p className="text-xs text-foreground">{f.feedback}</p>
                    </div>
                  )}

                  {f.approval_status === "rejected" && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="text-[12px] h-7 rounded-lg gap-1"
                        onClick={() => handleResend(f.id)}>
                        <RefreshCw className="w-3 h-3" /> Reenviar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
