import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Database, CheckCircle2 } from "lucide-react";
import { Navigate } from "react-router-dom";

export default function SeedPage() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");

  if (profile?.role !== "admin") return <Navigate to="/dashboard" replace />;

  const seed = async () => {
    setLoading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Não autenticado");
      const adminId = authUser.id;

      // Check existing data
      const { data: existingProjects } = await supabase.from("projects").select("id").limit(1);
      if (existingProjects && existingProjects.length > 0) {
        toast.info("Dados demo já existem! Exclua os dados antigos antes de popular novamente.");
        setLoading(false);
        return;
      }

      // Get or create client
      setProgress("Buscando clientes...");
      const { data: clientRoles } = await supabase.from("user_roles").select("user_id").eq("role", "client");
      let clientId = clientRoles?.[0]?.user_id;

      if (!clientId) {
        toast.error("Faça login como Cliente primeiro para criar o perfil, depois volte como Admin.");
        setLoading(false);
        return;
      }

      // Create team members (design + traffic) if they don't exist
      setProgress("Criando equipe...");
      const teamData = [
        { email: "design@convertai.com", password: "design123456", name: "Ana Costa", role: "design" },
        { email: "traffic@convertai.com", password: "traffic123456", name: "Pedro Santos", role: "traffic" },
      ];

      const teamIds: string[] = [];
      const currentSession = await supabase.auth.getSession();

      for (const member of teamData) {
        const { data: existingProfile } = await supabase.from("profiles").select("id").eq("email", member.email).maybeSingle();
        if (existingProfile) {
          teamIds.push(existingProfile.id);
          continue;
        }

        const { data: signup } = await supabase.auth.signUp({
          email: member.email,
          password: member.password,
          options: { data: { full_name: member.name, role: member.role } },
        });
        if (signup?.user) teamIds.push(signup.user.id);
      }

      // Restore admin session
      if (currentSession?.data?.session) {
        await supabase.auth.setSession({
          access_token: currentSession.data.session.access_token,
          refresh_token: currentSession.data.session.refresh_token,
        });
      }

      const designId = teamIds[0] || adminId;
      const trafficId = teamIds[1] || adminId;

      // Create projects
      setProgress("Criando projetos...");
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
      setProgress("Criando tarefas...");
      const tasksData = [
        { project_id: p[0].id, title: "Captação fotos comerciantes", status: "doing", priority: "high", assigned_to: designId, due_date: "2026-03-05", task_order: 1 },
        { project_id: p[0].id, title: "Carrossel Padaria do Zé", status: "review", priority: "medium", assigned_to: designId, due_date: "2026-03-08", task_order: 2 },
        { project_id: p[0].id, title: "Copy posts março", status: "done", priority: "medium", assigned_to: adminId, due_date: "2026-02-28", task_order: 3 },
        { project_id: p[0].id, title: "Configurar campanha Meta Ads", status: "doing", priority: "high", assigned_to: trafficId, due_date: "2026-03-10", task_order: 4 },
        { project_id: p[1].id, title: "Receber materiais Cogecon", status: "backlog", priority: "high", assigned_to: adminId, due_date: "2026-03-10", task_order: 1 },
        { project_id: p[1].id, title: "Criar artes campanha", status: "backlog", priority: "high", assigned_to: designId, due_date: "2026-03-12", task_order: 2 },
        { project_id: p[1].id, title: "Subir anúncios evento", status: "backlog", priority: "urgent", assigned_to: trafficId, due_date: "2026-03-15", task_order: 3 },
        { project_id: p[3].id, title: "Revisar landing page final", status: "review", priority: "urgent", assigned_to: adminId, due_date: "2026-02-25", task_order: 1 },
        { project_id: p[2].id, title: "Mapear fluxos automação", status: "doing", priority: "medium", assigned_to: adminId, due_date: "2026-03-15", task_order: 1 },
        { project_id: p[2].id, title: "Configurar Meta Business", status: "doing", priority: "high", assigned_to: trafficId, due_date: "2026-03-10", task_order: 2 },
      ];
      await supabase.from("tasks").insert(tasksData);

      // Create milestones
      setProgress("Criando milestones...");
      await supabase.from("milestones").insert([
        { project_id: p[0].id, title: "Kick-off", target_date: "2026-01-15", status: "completed", milestone_order: 1 },
        { project_id: p[0].id, title: "Primeiro relatório mensal", target_date: "2026-02-15", status: "completed", milestone_order: 2 },
        { project_id: p[0].id, title: "Início Divulgação", target_date: "2026-03-06", status: "in_progress", milestone_order: 3 },
        { project_id: p[1].id, title: "Rodada de Negócios", target_date: "2026-03-26", status: "pending", milestone_order: 1 },
      ]);

      // Create updates
      setProgress("Criando atualizações...");
      await supabase.from("updates").insert([
        { project_id: p[0].id, author_id: adminId, message: "Carrossel Padaria do Zé enviado para aprovação", update_type: "creative" },
        { project_id: p[0].id, author_id: adminId, message: "Copy posts março finalizado e aprovado", update_type: "task" },
        { project_id: p[0].id, author_id: designId, message: "Captação de fotos em andamento", update_type: "task" },
        { project_id: p[1].id, author_id: adminId, message: "Aguardando materiais Cogecon para iniciar artes", update_type: "alert" },
        { project_id: p[3].id, author_id: adminId, message: "Landing page 80% concluída — revisão final pendente", update_type: "milestone" },
      ]);

      // Create notifications
      setProgress("Criando notificações...");
      await supabase.from("notifications").insert([
        { user_id: clientId, message: "Novo criativo aguardando aprovação: Carrossel Padaria do Zé", notification_type: "approval" },
        { user_id: clientId, message: "Relatório semanal de redes sociais disponível", notification_type: "report" },
        { user_id: clientId, message: "Landing page pronta para revisão final", notification_type: "project" },
        { user_id: adminId, message: "Acerbi aprovou criativo do mês anterior", notification_type: "approval" },
        { user_id: adminId, message: "Novo pedido do cliente: Ajuste na bio do Instagram", notification_type: "request" },
      ]);

      // Create files
      setProgress("Criando arquivos...");
      await supabase.from("files").insert([
        { project_id: p[0].id, client_id: clientId, uploaded_by: designId, file_name: "carrossel-padaria.pdf", file_url: "#", file_type: "creative", folder: "criativos", approval_status: "pending" },
        { project_id: p[3].id, client_id: clientId, uploaded_by: adminId, file_name: "landing-page-preview.png", file_url: "#", file_type: "preview", folder: "entregas", approval_status: "pending" },
      ]);

      setProgress("Pronto!");
      toast.success("Dados demo populados com sucesso!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao popular dados");
      console.error(err);
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
      <Database className="w-12 h-12 text-muted-foreground/20 mb-4" />
      <p className="text-sm text-foreground font-medium mb-1">Popular Dados Demo</p>
      <p className="text-xs text-muted-foreground mb-6 text-center max-w-sm">
        Insere projetos, tarefas, milestones, atualizações, notificações e arquivos de exemplo. Também cria membros de equipe (design + tráfego).
      </p>
      {progress && (
        <p className="text-xs text-primary mb-4 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          {progress}
        </p>
      )}
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
