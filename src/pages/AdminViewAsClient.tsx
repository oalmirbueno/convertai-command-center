import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import ProjectView from "@/components/client/ProjectView";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminViewAsClient() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = searchParams.get("project");
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) {
      navigate("/projetos");
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, client:profiles!projects_client_id_fkey(full_name, company_name)")
        .eq("id", projectId)
        .maybeSingle();
      if (error || !data) {
        navigate("/projetos");
        return;
      }
      setProject(data);
      setLoading(false);
    })();
  }, [projectId]);

  if (loading) return <div className="space-y-4 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full rounded-xl" /></div>;

  return (
    <div className="space-y-4">
      <div className="bg-info/10 border border-info/20 rounded-lg px-4 py-2 text-xs text-info flex items-center gap-2">
        👁️ Visualizando como cliente — Esta é a visão que o cliente terá do projeto.
      </div>
      <ProjectView project={project} onBack={() => navigate("/projetos")} />
    </div>
  );
}
