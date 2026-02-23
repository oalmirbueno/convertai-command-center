import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Database } from "lucide-react";
import { Navigate } from "react-router-dom";

export default function SeedPage() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);

  if (profile?.role !== "admin") return <Navigate to="/dashboard" replace />;

  const seed = async () => {
    setLoading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Não autenticado");

      const adminId = authUser.id;

      // Get or find client user
      const { data: clientProfiles } = await supabase
        .from("profiles")
        .select("id, email")
        .neq("id", adminId);

      let clientId = clientProfiles?.[0]?.id;

      if (!clientId) {
        toast.error("Faça login como Cliente primeiro para criar o perfil, depois volte como Admin.");
        setLoading(false);
        return;
      }

      // Check if projects already exist
      const { data: existingProjects } = await supabase.from("projects").select("id").limit(1);
      if (existingProjects && existingProjects.length > 0) {
        toast.info("Dados demo já existem!");
        setLoading(false);
        return;
      }

      // Create projects
      const projectsData = [
        { client_id: clientId, name: "Presença Digital Acerbi 2026", description: "Gestão completa de redes sociais com conteúdo semanal.", project_type: "social_media", status: "active", progress: 35, start_date: "2026-01-15", deadline: "2026-06-30", created_by: adminId },
        { client_id: clientId, name: "Rodada de Negócios Cogecon", description: "Planejamento e execução do evento anual.", project_type: "event", status: "active", progress: 15, start_date: "2026-02-01", deadline: "2026-03-26", created_by: adminId },
        { client_id: clientId, name: "Automação CRM Cresol", description: "Fluxos de automação de email e CRM integrado.", project_type: "automation", status: "planning", progress: 5, start_date: "2026-03-01", deadline: "2026-05-30", created_by: adminId },
        { client_id: clientId, name: "Landing Page Cogecon", description: "Landing page responsiva para captação.", project_type: "site", status: "review", progress: 80, start_date: "2026-01-10", deadline: "2026-03-01", created_by: adminId },
      ];

      const { data: projects, error: projErr } = await supabase.from("projects").insert(projectsData).select();
      if (projErr) throw projErr;

      const p = projects!;

      // Create tasks
      const tasksData = [
        { project_id: p[0].id, title: "Captação fotos comerciantes", status: "doing", priority: "high", assigned_to: adminId, due_date: "2026-03-05", task_order: 1 },
        { project_id: p[0].id, title: "Carrossel Pilar 1", status: "review", priority: "medium", assigned_to: adminId, due_date: "2026-03-08", task_order: 2 },
        { project_id: p[0].id, title: "Copy posts março", status: "done", priority: "medium", assigned_to: adminId, due_date: "2026-02-28", task_order: 3 },
        { project_id: p[1].id, title: "Receber materiais Cogecon", status: "backlog", priority: "high", assigned_to: adminId, due_date: "2026-03-10", task_order: 1 },
        { project_id: p[1].id, title: "Criar artes campanha", status: "backlog", priority: "high", assigned_to: adminId, due_date: "2026-03-12", task_order: 2 },
        { project_id: p[3].id, title: "Revisar landing page", status: "review", priority: "urgent", assigned_to: adminId, due_date: "2026-02-25", task_order: 1 },
        { project_id: p[2].id, title: "Mapear fluxos automação", status: "doing", priority: "medium", assigned_to: adminId, due_date: "2026-03-15", task_order: 1 },
        { project_id: p[2].id, title: "Configurar Meta Business", status: "doing", priority: "high", assigned_to: adminId, due_date: "2026-03-10", task_order: 2 },
      ];

      await supabase.from("tasks").insert(tasksData);

      // Create milestones
      await supabase.from("milestones").insert([
        { project_id: p[0].id, title: "Kick-off", target_date: "2026-02-26", status: "completed", milestone_order: 1 },
        { project_id: p[0].id, title: "Início Divulgação", target_date: "2026-03-06", status: "in_progress", milestone_order: 2 },
        { project_id: p[0].id, title: "Rodada de Negócios", target_date: "2026-03-26", status: "pending", milestone_order: 3 },
      ]);

      // Create updates
      await supabase.from("updates").insert([
        { project_id: p[0].id, author_id: adminId, message: "Carrossel Padaria do Zé enviado para aprovação", update_type: "creative" },
        { project_id: p[0].id, author_id: adminId, message: "Copy posts março finalizado", update_type: "task" },
        { project_id: p[1].id, author_id: adminId, message: "Aguardando materiais Cogecon", update_type: "alert" },
        { project_id: p[3].id, author_id: adminId, message: "Landing page 80% concluída", update_type: "milestone" },
        { project_id: p[0].id, author_id: adminId, message: "Bem-vindo ao ConvertAI ClientOS", update_type: "system" },
      ]);

      // Create notifications
      await supabase.from("notifications").insert([
        { user_id: clientId, message: "Novo criativo aguardando aprovação", notification_type: "approval" },
        { user_id: clientId, message: "Relatório semanal disponível", notification_type: "report" },
        { user_id: clientId, message: "Recarga de anúncios necessária", notification_type: "billing" },
        { user_id: adminId, message: "Acerbi aprovou criativo", notification_type: "approval" },
        { user_id: adminId, message: "Novo pedido do cliente", notification_type: "request" },
      ]);

      toast.success("Dados demo populados com sucesso!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao popular dados");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
      <Database className="w-12 h-12 text-muted-foreground/20 mb-4" />
      <p className="text-sm text-foreground font-medium mb-1">Popular Dados Demo</p>
      <p className="text-xs text-muted-foreground mb-6 text-center max-w-sm">
        Insere projetos, tarefas, milestones, atualizações e notificações de exemplo no banco de dados.
      </p>
      <button
        onClick={seed}
        disabled={loading}
        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
        Popular Dados Demo
      </button>
    </div>
  );
}
