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

      // Clean existing data before seeding
      setProgress("Limpando dados antigos...");
      await supabase.from("recharge_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("billing").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("ads_wallet").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("files").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("updates").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("tasks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("milestones").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("briefings").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("projects").delete().neq("id", "00000000-0000-0000-0000-000000000000");

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
        { project_id: p[0].id, author_id: adminId, message: "Projeto Presença Digital criado", update_type: "system" },
        { project_id: p[0].id, author_id: adminId, message: "Carrossel Padaria do Zé enviado para aprovação", update_type: "creative" },
        { project_id: p[0].id, author_id: clientId, message: "Carrossel Fevereiro aprovado pelo cliente", update_type: "creative" },
        { project_id: p[0].id, author_id: adminId, message: "Relatório Semanal publicado", update_type: "report" },
        { project_id: p[0].id, author_id: designId, message: "Task 'Design banner' concluída", update_type: "task" },
        { project_id: p[0].id, author_id: adminId, message: "Copy posts março finalizado e aprovado", update_type: "task" },
        { project_id: p[0].id, author_id: designId, message: "Captação de fotos em andamento", update_type: "task" },
        { project_id: p[1].id, author_id: adminId, message: "Aguardando materiais Cogecon para iniciar artes", update_type: "alert" },
        { project_id: p[3].id, author_id: adminId, message: "Landing page 80% concluída — revisão final pendente", update_type: "milestone" },
      ]);

      // Create notifications
      setProgress("Criando notificações...");
      await supabase.from("notifications").insert([
        { user_id: clientId, message: "Novo criativo para aprovação: Carrossel Março", notification_type: "approval", link: "/aprovacoes", read: false },
        { user_id: clientId, message: "Relatório Semanal publicado - Presença Digital", notification_type: "report", link: "/relatorios", read: false },
        { user_id: clientId, message: "Seu plano renova em 15/03/2026. Garanta a continuidade! 🚀", notification_type: "billing", link: "/financeiro", read: true },
        { user_id: clientId, message: "Landing page pronta para revisão final", notification_type: "project", link: "/aprovacoes", read: false },
        { user_id: clientId, message: "Tarefa 'Design banner' concluída", notification_type: "task", link: "/dashboard", read: true },
        { user_id: adminId, message: "Acerbi aprovou o criativo Carrossel Fevereiro", notification_type: "approval", link: "/aprovacoes", read: true },
        { user_id: adminId, message: "Novo pedido de Acerbi: Ajuste na bio do Instagram", notification_type: "request", link: "/pedidos", read: false },
        { user_id: adminId, message: "Briefing recebido de novo lead", notification_type: "request", link: "/briefings", read: false },
        { user_id: adminId, message: "Task 'Design carrossel' movida para Done", notification_type: "task", link: "/kanban", read: true },
      ]);

      // Create files
      setProgress("Criando arquivos...");
      await supabase.from("files").insert([
        { project_id: p[0].id, client_id: clientId, uploaded_by: designId, file_name: "carrossel-padaria.pdf", file_url: "#", file_type: "creative", folder: "criativos", approval_status: "pending" },
        { project_id: p[3].id, client_id: clientId, uploaded_by: adminId, file_name: "landing-page-preview.png", file_url: "#", file_type: "preview", folder: "entregas", approval_status: "pending" },
      ]);

      // Create financial data
      setProgress("Criando dados financeiros...");
      // Clean old financial data first
      await supabase.from("recharge_requests").delete().eq("client_id", clientId);
      await supabase.from("billing").delete().eq("client_id", clientId);
      await supabase.from("ads_wallet").delete().eq("client_id", clientId);

      await supabase.from("profiles").update({ plan_renewal_date: "2026-03-15", plan_status: "active" }).eq("id", clientId);

      await supabase.from("billing").insert([
        { client_id: clientId, type: "renewal", amount: 2500, due_date: "2026-02-15", description: "Gestão de Redes Sociais", status: "paid", paid_date: "2026-02-14" },
        { client_id: clientId, type: "renewal", amount: 2500, due_date: "2026-03-15", description: "Gestão de Redes Sociais", status: "pending" },
        { client_id: clientId, type: "extra_service", amount: 800, due_date: "2026-02-01", description: "Landing Page Cogecon", status: "pending" },
      ]);

      await supabase.from("ads_wallet").insert([
        { client_id: clientId, platform: "meta", balance: 1200, last_recharge_date: "2026-02-10T00:00:00Z" },
        { client_id: clientId, platform: "google", balance: 800, last_recharge_date: "2026-02-05T00:00:00Z" },
      ]);

      await supabase.from("recharge_requests").insert([
        { client_id: clientId, platform: "meta", amount: 500, reason: "Campanha Rodada de Negócios precisa de mais budget", status: "pending", requested_by: trafficId },
      ]);

      // Reports
      setProgress("Criando relatórios...");
      await supabase.from("reports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("reports").insert([
        {
          project_id: p[0].id,
          client_id: clientId,
          title: "Relatório Semanal — Redes Sociais",
          period_start: "2026-02-17",
          period_end: "2026-02-23",
          metrics: { reach: 12400, impressions: 28700, engagement: 3.2, clicks: 847, ctr: 2.9, conversions: 23, followers_gained: 220, ad_spend: 1200, cpa: 52, custom: [{ label: "Vídeos publicados", value: 8 }, { label: "Stories", value: 35 }] },
          summary: "Semana com crescimento de 15% no alcance orgânico. Posts com vídeos curtos tiveram 3x mais engajamento. Campanha de tráfego pago manteve CTR acima da média do setor.",
          highlights: "🏆 Post com mais engajamento: Carrossel '10 dicas para seu negócio'\n📈 Melhor dia: Quinta-feira (3.8K alcance)\n🎯 Meta de engajamento: Superada (3.2% > 2.5%)",
          next_steps: "→ Aumentar frequência de Reels para 3x/semana\n→ Testar horários alternativos de publicação\n→ Iniciar campanha de remarketing\n→ Produzir conteúdo com clientes (depoimentos)",
          internal_notes: "Cliente muito satisfeito com resultados. Considerar upsell de pacote premium.",
          status: "published",
          created_by: adminId,
        },
        {
          project_id: p[0].id,
          client_id: clientId,
          title: "Relatório Mensal — Janeiro 2026",
          period_start: "2026-01-01",
          period_end: "2026-01-31",
          metrics: { reach: 45200, impressions: 98400, engagement: 2.8, clicks: 3120, ctr: 3.2, conversions: 87, followers_gained: 580, ad_spend: 3500, cpa: 40 },
          summary: "Mês de lançamento do projeto com foco em construção de audiência. Base de seguidores cresceu 22%. Próximo mês foco em conversão.",
          highlights: "📈 Crescimento de 22% na base de seguidores\n🎯 CTR acima da média do setor (3.2% vs 2.1%)\n🏆 87 conversões no primeiro mês",
          next_steps: "→ Focar em conteúdo de conversão\n→ Ampliar investimento em Google Ads\n→ Criar landing page dedicada",
          status: "published",
          created_by: adminId,
        },
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
