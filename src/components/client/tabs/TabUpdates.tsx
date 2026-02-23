import { useProjectUpdates } from "@/hooks/useSupabaseData";
import { Skeleton } from "@/components/ui/skeleton";

const typeDotColors: Record<string, string> = {
  creative: "bg-primary",
  task: "bg-success",
  alert: "bg-warning",
  milestone: "bg-info",
  system: "bg-muted-foreground",
  report: "bg-accent",
};

function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 60) return `há ${diffMinutes}min`;
  if (diffHours < 24) return `há ${diffHours}h`;
  if (diffDays < 7) return `há ${diffDays}d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function TabUpdates({ projectId }: { projectId: string }) {
  const { data: updates, isLoading } = useProjectUpdates(projectId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (!updates?.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">As atualizações do projeto aparecerão aqui</p>;
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[5px] top-2 bottom-2 w-[1px] bg-border" />

      <div className="space-y-0">
        {updates.map((u: any) => (
          <div key={u.id} className="flex gap-3 py-3 relative">
            <div className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 z-10 ${typeDotColors[u.update_type] || "bg-muted-foreground"}`} />
            <div>
              <p className="text-[13px] text-foreground/90">{u.message}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {u.author?.full_name || "Sistema"} • {relativeTime(u.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
