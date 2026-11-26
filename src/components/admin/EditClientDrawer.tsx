import { lazy, Suspense, useState, useEffect, useRef } from "react";
import AutomacoesDoCliente, { useAutomacoesDoCliente } from "@/components/automacoes/AutomacoesDoCliente";
import { saldoDaCobranca, saldoDaParcela } from "@/lib/clientes/situacaoDaCobranca";
import DiaPrioritarioNoCadastro from "@/components/dia-prioritario/DiaPrioritarioNoCadastro";
import ModoDeAprovacaoNoCadastro from "@/components/admin/ModoDeAprovacaoNoCadastro";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useConfirm } from "@/components/shared/confirmDialog";
import { X, Loader2, Trash2, FileText, Camera, CheckCircle2, Clock, AlertCircle, Plus, ChevronDown, ChevronUp, PackageCheck, FolderOpen, Briefcase, Pause, Play, Mail, Phone, ArrowUpRight } from "lucide-react";
import { Avatar, List, ListRow, PillTabs, ProgressBar, StatCard, StatusPill, type PillTab, type Tone } from "@/components/ds";
import {
  AjudaRecolhida,
  CampoDeFormulario,
  EstadoVazio,
  GrupoDeCampos,
  RegiaoRolavel,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import ClientVault from "@/components/vault/ClientVault";
import { supabase } from "@/integrations/supabase/client";
import CobrancasDoCliente from "@/components/admin/CobrancasDoCliente";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";
import ExcluirClienteModal from "@/components/admin/ExcluirClienteModal";
import { Switch } from "@/components/ui/switch";
import { notifyUser } from "@/lib/notifyHelpers";
import MudarPlano from "@/components/admin/MudarPlano";
import ExtrasDoCliente from "@/components/clientes/ExtrasDoCliente";
import GerarLinkDoBriefing from "@/components/briefing/GerarLinkDoBriefing";
import { estadoDoLink, modeloDeFabrica } from "../../../supabase/functions/_shared/briefing-modelos";
import CreateProjectModal from "@/components/admin/CreateProjectModal";
import { buildPlanoComEntrada, lerValorBR, percentualDaEntrada } from "@/lib/paymentInstallments";
import { somarMeses } from "@/lib/extrasDoCliente";
import ClientOnboardingPanel from "@/components/admin/ClientOnboardingPanel";
import ClientConnectionsPanel from "@/components/admin/ClientConnectionsPanel";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import type { FotoDoCliente as Foto } from "@/lib/fotoDoCliente";
import { todayBR, toBRDateKey } from "@/lib/dateBR";
import { useFinancePlans } from "@/hooks/useFinanceV2";
import PropostasDoCliente from "@/components/clientes-propostas/PropostasDoCliente";
// Frente CON2 (30/09): ficha fiscal do cliente (CNPJ pela Receita), reaproveitada nos contratos.
const DadosFiscaisDoCliente = lazy(() => import("@/components/contratos/DadosFiscaisDoCliente"));




const SERVICES = [
  { key: "trafego", label: "Tráfego Pago" },
  { key: "social", label: "Social Media" },
  { key: "videos_ia", label: "Vídeos com IA" },
  { key: "edicao_video", label: "Edição de Vídeo" },
  { key: "design", label: "Design / Branding" },
  { key: "copywriting", label: "Copywriting" },
  { key: "seo", label: "SEO" },
  { key: "email_marketing", label: "E-mail Marketing" },
  { key: "automacao", label: "Automação" },
  { key: "site", label: "Site / Landing Page" },
  { key: "relatorios", label: "Relatórios" },
  { key: "cobranca", label: "Cobrança" },
];

const NON_RECURRING_TYPES = ["automation", "site", "landing_page", "event", "other"];
const NON_RECURRING_SERVICE_KEYS = ["automacao", "site"];

/** Partes da ficha (abas). A aberta fica lembrada ao sair e voltar. */
type AbaDaFicha = "resumo" | "cadastro" | "plano" | "acesso" | "contas" | "onboarding" | "automacoes";
const ABAS_DA_FICHA: AbaDaFicha[] = ["resumo", "cadastro", "plano", "acesso", "contas", "onboarding", "automacoes"];

const STATUS_DO_PROJETO: Record<string, string> = {
  todo: "A fazer",
  in_progress: "Em andamento",
  review: "Em revisão",
  paused: "Pausado",
  done: "Concluído",
  cancelled: "Cancelado",
};

const CLIENT_STATUS_OPTIONS: Array<{ value: string; label: string; tom: Tone }> = [
  { value: "onboarding", label: "Em Andamento", tom: "warning" },
  { value: "active", label: "Ativo", tom: "success" },
  { value: "standby", label: "Standby", tom: "info" },
  { value: "inactive", label: "Inativo", tom: "neutral" },
];

const TOM_DO_PROJETO: Record<string, Tone> = {
  todo: "neutral",
  in_progress: "info",
  review: "warning",
  paused: "neutral",
  done: "success",
  cancelled: "danger",
};

/** Bloco da ficha: cartão de 24 px com respiro; a seção de dentro perde a divisória (o cartão já separa). */
const BLOCO = juntar(superficie.painel, "min-w-0 p-5 empty:hidden sm:p-6 [&>section]:border-t-0 [&>section]:pt-0 [&>fieldset]:border-t-0 [&>fieldset]:pt-0");

/** Azulejo de ação (Operação): ícone num círculo grande, nome embaixo e a seta no canto. */
const AZULEJO = juntar(
  "toque-compacto group relative flex min-w-0 flex-col items-start rounded-lg border border-border bg-card p-4 text-left shadow-card transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 sm:p-5",
  foco,
);

const dinheiroDaFicha = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

interface Props {
  open: boolean;
  onClose: () => void;
  client: any;
  initialSection?: "accounts" | null;
  initialProjectId?: string | null;
  /** Foto de reserva (Instagram ou logo dos arquivos) quando o cadastro nao tem. */
  fotoFallback?: Foto | null;
}

export default function EditClientDrawer({
  open,
  onClose,
  client,
  initialSection = null,
  initialProjectId = null,
  fotoFallback = null,
}: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [planName, setPlanName] = useState("");
  const [planValue, setPlanValue] = useState("");
  const [planStatus, setPlanStatus] = useState("active");
  const { data: catalogPlans } = useFinancePlans();
  const matchedCatalogPlan =
    (catalogPlans || []).find((p) => p.name.trim().toLowerCase() === planName.trim().toLowerCase()) || null;
  const matchedCatalogVersion = matchedCatalogPlan
    ? matchedCatalogPlan.currentVersion || matchedCatalogPlan.versions[0] || null
    : null;
  const catalogPlanValue = matchedCatalogVersion
    ? matchedCatalogVersion.finalAmount || matchedCatalogVersion.amount
    : null;
  const [clientPassword, setClientPassword] = useState("");
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [clientType, setClientType] = useState<"recurring" | "one_off" | "hybrid">("recurring");
  const [brand, setBrand] = useState<"aceleriq" | "sitebolt" | "">("");
  const [renewalDate, setRenewalDate] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resendingInvite, setResendingInvite] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [firstAccessLink, setFirstAccessLink] = useState("");
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const accountsSectionRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [aba, setAba] = useEstadoDaTela<AbaDaFicha>("ficha:aba", "resumo", {
    validar: (v) => typeof v === "string" && (ABAS_DA_FICHA as string[]).indexOf(v) >= 0,
  });
  // Link com ?section=accounts abre direto na parte de contas.
  useEffect(() => {
    if (open && initialSection === "accounts") setAba("contas");
  }, [client?.id, initialSection, open, setAba]);

  // Celular: a ficha ocupa a tela toda por cima da barra do topo e da de baixo
  // (mesmo combinado da gaveta do agente em src/index.css), e o painel por baixo não rola.
  useEffect(() => {
    if (!open) return;
    let celular = false;
    try {
      celular = window.innerWidth < 640;
      if (celular) document.body.setAttribute("data-gaveta-aberta", "");
    } catch {
      /* sem documento */
    }
    return () => {
      if (!celular) return;
      try {
        document.body.removeAttribute("data-gaveta-aberta");
      } catch {
        /* sem documento */
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || initialSection !== "accounts") return;
    const frame = window.requestAnimationFrame(() => {
      accountsSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [client?.id, initialSection, open]);

  // Payment management state
  const [payCreateForProject, setPayCreateForProject] = useState<string | null>(null);
  const [payTotal, setPayTotal] = useState("");
  const [payEntryPct, setPayEntryPct] = useState(""); // entrada em R$ (16/11: valor livre, não mais %)
  const [payInstCount, setPayInstCount] = useState("1");
  const [payNotes, setPayNotes] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);

  // Briefings do cliente (frente BRF): os últimos links, de qualquer modelo e estado.
  const { data: clientBriefings } = useQuery({
    queryKey: ["client-briefings", client?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefings")
        .select("id, modelo, titulo, submitted, expira_em, enviado_em, reabertura_pedida_em, created_at")
        .eq("client_id", client.id)
        .is("arquivado_em" as any, null)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data as unknown as Array<{ id: string; modelo: string | null; titulo: string | null; submitted: boolean | null; expira_em: string | null; enviado_em: string | null; reabertura_pedida_em: string | null; created_at: string }>) || [];
    },
    enabled: !!client?.id,
  });

  // Fetch non-recurring projects with payments (always query, regardless of services_config)
  const { data: nonRecurringProjects } = useQuery({
    queryKey: ["client-nonrecurring-projects", client?.id],
    queryFn: async () => {
      const { data: projects } = await supabase
        .from("projects")
        .select("id, name, project_type")
        .eq("client_id", client.id)
        .is("deleted_at", null)
        .in("project_type", NON_RECURRING_TYPES);
      if (!projects?.length) return [];

      const { data: payments } = await supabase
        .from("project_payments")
        .select("*, installments:payment_installments(*)")
        .in("project_id", projects.map(p => p.id));

      return projects.map(p => ({
        ...p,
        payment: (payments || []).find((pay: any) => pay.project_id === p.id) || null,
      }));
    },
    enabled: !!client?.id,
  });

  // Executive summary queries
  const { data: clientProjects } = useQuery({
    queryKey: ["client-exec-projects", client?.id],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, status, progress, project_type, deadline")
        .eq("client_id", client.id).is("deleted_at", null).order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!client?.id,
  });

  const clientProjectIds = (clientProjects || []).map((p: any) => p.id);

  // Projetos DESTE cadastro: criar um novo já ligado ao cliente, ou puxar
  // para cá um projeto que ficou solto/em outro cadastro. Sem isto, projeto
  // criado no lugar errado só se consertava editando um por um em Projetos.
  const [novoProjetoAberto, setNovoProjetoAberto] = useState(false);
  const [vincularAberto, setVincularAberto] = useState(false);
  const [projetoParaVincular, setProjetoParaVincular] = useState("");
  const [vinculando, setVinculando] = useState(false);
  const { data: projetosDeOutros = [] } = useQuery({
    queryKey: ["projetos-de-outros", client?.id],
    enabled: !!client?.id && vincularAberto,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("projects")
        .select("id, name, status, client_id, client:profiles!projects_client_id_fkey(company_name, full_name)")
        .neq("client_id", client.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(300);
      return (data || []) as any[];
    },
  });
  const vincularProjeto = async () => {
    if (!projetoParaVincular) return;
    setVinculando(true);
    try {
      const alvo = projetosDeOutros.find((p: any) => p.id === projetoParaVincular);
      const { error } = await (supabase as any)
        .from("projects").update({ client_id: client.id }).eq("id", projetoParaVincular);
      if (error) throw error;
      // Fica na história dos dois lados: de onde saiu e para onde foi.
      await (supabase as any).from("project_memory").insert({
        client_id: client.id,
        kind: "nota",
        title: `Projeto vinculado: ${alvo?.name ?? ""}`,
        content: `O projeto "${alvo?.name ?? ""}" passou a pertencer a este cliente${alvo?.client ? ` (antes estava em ${alvo.client.company_name || alvo.client.full_name})` : ""}.`,
        source: "cadastro",
        tags: ["projeto", "vinculo"],
        metadata: { project_id: projetoParaVincular, from_client_id: alvo?.client_id ?? null, client_visible: false },
      }).then(() => undefined, () => undefined);
      toast.success(`"${alvo?.name ?? "Projeto"}" agora é deste cliente.`);
      setProjetoParaVincular("");
      setVincularAberto(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-exec-projects"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["clients"] }),
        queryClient.invalidateQueries({ queryKey: ["projetos-de-outros"] }),
      ]);
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível vincular o projeto.");
    } finally {
      setVinculando(false);
    }
  };

  const { data: clientTasks } = useQuery({
    queryKey: ["client-exec-tasks", client?.id, clientProjectIds.join(",")],
    queryFn: async () => {
      if (!clientProjectIds.length) return [];
      const { data } = await supabase.from("tasks").select("id, status, priority")
        .in("project_id", clientProjectIds).is("deleted_at", null);
      return data || [];
    },
    enabled: !!client?.id && clientProjectIds.length > 0,
  });

  const { data: clientPendingFiles } = useQuery({
    queryKey: ["client-pending-approvals", client?.id],
    queryFn: async () => {
      const { data } = await supabase.from("files").select("id")
        .eq("client_id", client.id)
        .eq("approval_status", "pending")
        .is("parent_file_id", null);
      return data || [];
    },
    enabled: !!client?.id,
    refetchInterval: 15_000,
  });

  const { data: clientReports } = useQuery({
    queryKey: ["client-exec-reports", client?.id],
    queryFn: async () => {
      if (!clientProjectIds.length) return [];
      const { data } = await supabase.from("reports").select("id, status")
        .in("project_id", clientProjectIds);
      return data || [];
    },
    enabled: !!client?.id && clientProjectIds.length > 0,
  });

  const { data: clientBilling } = useQuery({
    queryKey: ["client-exec-billing", client?.id],
    queryFn: async () => {
      const { data } = await supabase.from("billing").select("id, type, status, amount, paid_amount, due_date")
        .eq("client_id", client.id);
      return data || [];
    },
    enabled: !!client?.id,
  });

  // Compute executive metrics
  const execActiveProjects = (clientProjects || []).filter((p: any) => p.status !== "done").length;
  const execOpenTasks = (clientTasks || []).filter((t: any) => t.status !== "done").length;
  const execUrgentTasks = (clientTasks || []).filter((t: any) => (t.priority === "urgent" || t.priority === "high") && t.status !== "done").length;
  const execPendingFiles = (clientPendingFiles || []).length;
  const execPublishedReports = (clientReports || []).filter((r: any) => r.status === "published").length;
  const execPendingBills = (clientBilling || []).filter((b: any) => b.status === "pending").length;
  // 26/10/2026 (dono): atrasado é só o que venceu e ainda tem saldo a pagar (a mesma regra da lista de Clientes).
  const hojeDaFicha = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const execOverdueBills = (clientBilling || []).filter((b: any) => b.type !== "ads_recharge" && saldoDaCobranca(b) > 0 && String(b.due_date || "").slice(0, 10) < hojeDaFicha).length;

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmDelete && !briefingOpen) onClose();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, confirmDelete, briefingOpen]);

  useEffect(() => {
    if (client) {
      setFullName(client.full_name || "");
      setCompany(client.company_name || "");
      setEmail(client.email || "");
      setPhone(client.phone || "");
      setPlanName((client as any).plan_name || "");
      setPlanValue((client as any).plan_value != null ? String((client as any).plan_value) : "");
      setPlanStatus(client.plan_status || "active");
      setRenewalDate(client.plan_renewal_date || "");
      setServices(client.services_config || {});
      setClientType((client as any).client_type || "recurring");
      setBrand((client as any).brand || "");
      setClientPassword("");
      setAvatarUrl(client.avatar_url || "");
      setFirstAccessLink("");
    }
  }, [client]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !client) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Arquivo deve ter no máximo 5MB"); return; }
    setUploadingAvatar(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${client.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${publicUrl}?t=${Date.now()}`;
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", client.id);
      setAvatarUrl(url);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Logo atualizada!");
    } catch (err: any) { toast.error(err.message || "Erro ao enviar logo"); }
    setUploadingAvatar(false);
  };

  // Antes do retorno cedo: hook sempre na mesma ordem. Só lê com a ficha aberta.
  const automacoesDoCliente = useAutomacoesDoCliente(open ? client?.id ?? null : null);
  if (!open || !client) return null;

  const hasUnsavedChanges =
    fullName !== (client.full_name || "") ||
    company !== (client.company_name || "") ||
    phone !== (client.phone || "") ||
    planName !== (client.plan_name || "") ||
    planValue !== (client.plan_value != null ? String(client.plan_value) : "") ||
    planStatus !== (client.plan_status || "active") ||
    renewalDate !== (client.plan_renewal_date || "") ||
    JSON.stringify(services) !== JSON.stringify(client.services_config || {}) ||
    clientType !== (client.client_type || "recurring") ||
    brand !== (client.brand || "") ||
    clientPassword.length > 0;

  const openClientOperation = async (path: string) => {
    if (hasUnsavedChanges) {
      const proceed = await confirmDialog({
        title: "Sair sem salvar?",
        description: "Você alterou o cadastro e ainda não salvou. As mudanças serão descartadas.",
        confirmLabel: "Sair sem salvar",
        cancelLabel: "Continuar editando",
        destructive: true,
      });
      if (!proceed) return;
    }
    onClose();
    navigate(path);
  };

  const toggleService = (key: string) => {
    setServices((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    if (!fullName.trim() || !company.trim()) {
      toast.error("Preencha nome e empresa");
      return;
    }
    const novoEmail = email.trim().toLowerCase();
    const emailMudou = isAdmin && novoEmail !== String(client?.email || "").trim().toLowerCase();
    if (emailMudou && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail) || novoEmail.length > 254)) {
      toast.error("Confira o e-mail: ele é o login do cliente");
      return;
    }
    if (clientPassword && !(clientPassword.length >= 12 && /[a-z]/.test(clientPassword) && /[A-Z]/.test(clientPassword) && /[0-9]/.test(clientPassword) && /[^A-Za-z0-9]/.test(clientPassword))) {
      toast.error("Senha deve ter no mínimo 12 caracteres, com maiúscula, minúscula, número e símbolo");
      return;
    }
    setSaving(true);
    try {
      const planChanged = (planName.trim() || "") !== (client.plan_name || "");
      const oldServices = client.services_config || {};
      const servicesChanged = JSON.stringify(services) !== JSON.stringify(oldServices);

      const updatePayload: any = {
        full_name: fullName.trim(),
        company_name: company.trim(),
        phone: phone.trim() || null,
        plan_status: planStatus,
        services_config: services,
        client_type: clientType,
        brand: brand || null,
      };

      // Only admin can change plan name and renewal date
      if (isAdmin) {
        updatePayload.plan_name = planName.trim() || null;
        updatePayload.plan_value = planValue ? parseFloat(planValue) : null;
        updatePayload.plan_renewal_date = renewalDate || null;
      }

      // O e-mail é o login: troca primeiro no Auth e no perfil (manage-team, só admin). Se falhar,
      // nada mais é salvo e o cliente continua entrando com o e-mail anterior.
      if (emailMudou) {
        const res = await supabase.functions.invoke("manage-team", {
          body: { action: "update_email", user_id: client.id, email: novoEmail },
        });
        if (res.data?.error) throw new Error(res.data.error);
        if (res.error) throw new Error(await getSupabaseFunctionErrorMessage(res.error, "Não foi possível trocar o e-mail de login"));
        toast.success(`Login trocado: o cliente agora entra com ${novoEmail}. A senha continua a mesma.`);
      }

      const { error } = await supabase.from("profiles").update(updatePayload).eq("id", client.id);
      if (error) throw error;

      // Notify client about plan/service changes
      if (isAdmin && planChanged && planName.trim()) {
        await notifyUser(client.id, `Seu plano foi atualizado para "${planName.trim()}"`, "project", "/dashboard");
      }
      if (servicesChanged) {
        const LABELS: Record<string, string> = { trafego: "Tráfego Pago", social: "Social Media", videos_ia: "Vídeos com IA", edicao_video: "Edição de Vídeo", design: "Design / Branding", copywriting: "Copywriting", seo: "SEO", email_marketing: "E-mail Marketing", automacao: "Automação", site: "Site / Landing Page", relatorios: "Relatórios", cobranca: "Cobrança" };
        const added = Object.keys(services).filter(k => services[k] && !oldServices[k]).map(k => LABELS[k] || k);
        const removed = Object.keys(oldServices).filter(k => oldServices[k] && !services[k]).map(k => LABELS[k] || k);
        if (added.length) await notifyUser(client.id, `Serviços ativados: ${added.join(", ")}`, "project", "/dashboard");
        if (removed.length) await notifyUser(client.id, `Serviços desativados: ${removed.join(", ")}`, "project", "/dashboard");
      }

      // Update password if provided (admin only)
      if (isAdmin && clientPassword) {
        const res = await supabase.functions.invoke("manage-team", {
          body: { action: "update_password", user_id: client.id, password: clientPassword },
        });
        if (res.error) throw new Error(res.error.message || "Erro ao alterar senha");
        if (res.data?.error) throw new Error(res.data.error);
        toast.success("Senha do cliente alterada!");
      }

      toast.success("Cliente atualizado!");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      setClientPassword("");
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePayment = async (projectId: string) => {
    const total = lerValorBR(payTotal);
    const entryAmount = Math.min(lerValorBR(payEntryPct), total);
    const entryPct = percentualDaEntrada(total, entryAmount);
    const count = Math.max(parseInt(payInstCount) || 1, 1);
    if (!(total > 0)) return;
    setPaySubmitting(true);
    try {
      const { data: paymentData, error: paymentError } = await supabase
        .from("project_payments")
        .insert({ project_id: projectId, client_id: client.id, total_value: total, entry_percentage: entryPct, entry_amount: entryAmount, installments_count: count, notes: payNotes.trim() || null, created_by: profile?.id })
        .select().single();
      if (paymentError) throw paymentError;
      const hoje = todayBR();
      const rows = buildPlanoComEntrada({ paymentId: paymentData.id, total, entrada: entryAmount, entradaEm: hoje, entradaPaga: false, parcelas: count, primeiraEm: entryAmount > 0 ? somarMeses(hoje, 1) : hoje });

      const { error: instErr } = await supabase.from("payment_installments").insert(rows);
      if (instErr) throw instErr;
      queryClient.invalidateQueries({ queryKey: ["client-nonrecurring-projects"] });
      queryClient.invalidateQueries({ queryKey: ["project-payments"] });
      toast.success("Plano de pagamento criado!");
      setPayCreateForProject(null); setPayTotal(""); setPayEntryPct(""); setPayInstCount("1"); setPayNotes("");
    } catch (err: any) { toast.error(err.message || "Erro ao criar plano"); }
    setPaySubmitting(false);
  };

  const handleMarkInstallmentPaid = async (installmentId: string) => {
    setPaySubmitting(true);
    try {
      await supabase.from("payment_installments").update({ status: "paid", paid_date: todayBR() }).eq("id", installmentId);
      queryClient.invalidateQueries({ queryKey: ["client-nonrecurring-projects"] });
      toast.success("Pagamento registrado!");
    } catch { toast.error("Erro ao registrar pagamento"); }
    setPaySubmitting(false);
  };

  // Travar (Standby) e Retornar: mesmas regras de antes, só saíram do meio do JSX.
  const retornarCliente = async () => {
    setSaving(true);
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const nextDate = new Date();
      nextDate.setMonth(nextDate.getMonth() + 1);
      const nextStr = nextDate.toISOString().slice(0, 10);
      const planValNum = Number(client.plan_value) || 0;

      const { error } = await supabase.from("profiles").update({
        plan_status: "active",
        plan_renewal_date: planValNum > 0 ? nextStr : (client.plan_renewal_date || null),
      }).eq("id", client.id);
      if (error) throw error;

      // Retomada = ciclo atual JÁ pago + próxima renovação pendente
      if (planValNum > 0) {
        await supabase.from("billing").insert([
          {
            client_id: client.id,
            type: "renewal",
            amount: planValNum,
            due_date: todayStr,
            paid_date: todayStr,
            paid_amount: planValNum,
            description: "Mensalidade · Retomada de Standby (pago)",
            status: "paid",
          },
          {
            client_id: client.id,
            type: "renewal",
            amount: planValNum,
            due_date: nextStr,
            description: "Mensalidade",
            status: "pending",
          },
        ] as any);
      }

      setPlanStatus("active");
      await notifyUser(client.id, "Seu plano foi reativado. Bem-vindo de volta!", "project", "/dashboard");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.success(planValNum > 0 ? "Cliente reativado. Pagamento do ciclo registrado e próxima renovação agendada." : "Cliente reativado.");
    } catch (e: any) { toast.error(e.message || "Erro ao reativar"); }
    setSaving(false);
  };

  const travarCliente = async () => {
    const proceed = await confirmDialog({
      title: "Colocar em Standby?",
      description: "A cobrança recorrente fica pausada até você reativar o cliente.",
      confirmLabel: "Colocar em Standby",
    });
    if (!proceed) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({ plan_status: "standby" }).eq("id", client.id);
      if (error) throw error;
      setPlanStatus("standby");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      toast.success("Cliente em Standby. Cobrança recorrente pausada.");
    } catch (e: any) { toast.error(e.message || "Erro ao travar"); }
    setSaving(false);
  };

  const reenviarConvite = async () => {
    if (!client?.id || !client?.email) { toast.error("Cliente sem e-mail cadastrado"); return; }
    setResendingInvite(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-client-access", {
        body: {
          profile_id: client.id,
          new_email: String(client.email).trim().toLowerCase(),
          new_full_name: (fullName || client.full_name || "").trim(),
        },
      });
      const result = (Array.isArray(data) ? data[0] : data) as any;
      if (error || result?.error) throw new Error(result?.error || error?.message);
      const delivery = result?.delivery;
      if (delivery?.status === "sent") {
        toast.success(`E-mail ENTREGUE ao provedor com sucesso para ${client.email}. Peça para conferir a caixa de entrada e o spam.`);
      } else if (["failed", "dlq", "bounced", "suppressed"].includes(delivery?.status)) {
        toast.error(`O envio FALHOU no provedor: ${delivery?.error || delivery.status}. Verifique a chave do Resend e o domínio de envio.`);
      } else {
        toast.info(`Convite enfileirado para ${client.email}. A entrega será confirmada pelo despachante em instantes.`);
      }
    } catch (err: any) {
      toast.error("Não foi possível reenviar agora. Tente novamente em instantes.");
    } finally {
      setResendingInvite(false);
    }
  };

  const gerarLinkDeAcesso = async () => {
    if (!client?.id || !client?.email) { toast.error("Cliente sem e-mail cadastrado"); return; }
    setGeneratingLink(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-client-access", {
        body: {
          profile_id: client.id,
          new_email: String(client.email).trim().toLowerCase(),
          new_full_name: (fullName || client.full_name || "").trim(),
          send_email: false,
        },
      });
      const result = (Array.isArray(data) ? data[0] : data) as any;
      if (error || result?.error || !result?.firstAccessUrl) throw new Error(result?.error || error?.message);
      setFirstAccessLink(String(result.firstAccessUrl));
      try {
        await navigator.clipboard.writeText(String(result.firstAccessUrl));
        toast.success("Link gerado e copiado. Cole no WhatsApp do cliente.");
      } catch {
        toast.success("Link gerado. Copie no campo abaixo.");
      }
    } catch {
      toast.error("Não foi possível gerar o link agora. Tente novamente em instantes.");
    } finally {
      setGeneratingLink(false);
    }
  };

  const nomeDoCliente = client.company_name || client.full_name;
  const abas: PillTab<AbaDaFicha>[] = [
    { value: "resumo", label: "Resumo", count: execPendingFiles || undefined },
    { value: "cadastro", label: "Cadastro" },
    ...(isAdmin ? [{ value: "plano" as AbaDaFicha, label: "Plano e cobrança", count: execOverdueBills || undefined }] : []),
    ...(isAdmin ? [{ value: "acesso" as AbaDaFicha, label: "Acesso" }] : []),
    { value: "contas", label: "Contas e cofre" },
    { value: "onboarding", label: "Onboarding" },
    { value: "automacoes", label: "Automações", count: automacoesDoCliente.fluxos.length || undefined },
  ];
  const abaAberta: AbaDaFicha = abas.some((a) => a.value === aba) ? aba : "resumo";
  const painelDaAba = (valor: AbaDaFicha) => juntar("space-y-5", abaAberta !== valor && "hidden");
  const statusAtual = CLIENT_STATUS_OPTIONS.find((s) => s.value === planStatus);
  // Andamento com o que a ficha já buscou: projetos concluídos e tarefas feitas sobre o total.
  const totalDeProjetos = (clientProjects || []).length;
  const projetosConcluidos = totalDeProjetos - execActiveProjects;
  const totalDeTarefas = (clientTasks || []).length;
  const tarefasFeitas = totalDeTarefas - execOpenTasks;

  // Portal no body: dentro do conteúdo do painel (camada fixa própria no celular) a ficha ficava por baixo das barras.
  return createPortal(
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] sm:p-6">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="client-drawer-title"
          className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden border-border bg-background sm:h-[90vh] sm:max-h-[940px] sm:rounded-lg sm:border sm:shadow-pop"
        >
          {/* Cabeçalho da ficha (rodada ousada, 15/11/2026): logo grande (troca ao tocar), nome, estado em pílula, contato, o plano no cartão sólido e as abas em pílula */}
          <div className="min-w-0 border-b border-border bg-card px-4 pb-4 pt-4 sm:px-8 sm:pb-5 sm:pt-7">
            <div className="flex min-w-0 items-start">
              <div className="group relative shrink-0">
                {avatarUrl ? (
                  <div className="h-14 w-14 overflow-hidden rounded-full bg-muted ring-1 ring-border sm:h-16 sm:w-16">
                    <img src={avatarUrl} alt={client.full_name} className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <FotoDoCliente nome={nomeDoCliente || ""} foto={fotoFallback} lado={56} />
                )}
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  aria-label={avatarUrl ? "Trocar a logo do cliente" : "Subir a logo do cliente"}
                  title={avatarUrl ? "Trocar a logo" : fotoFallback?.tipo === "instagram" ? "Foto do Instagram. Toque para subir a logo." : "Subir a logo"}
                  className={juntar(
                    "toque-compacto absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-foreground text-background transition-transform hover:scale-105",
                    foco,
                  )}
                >
                  {uploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Camera className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </div>
              <div className="ml-4 min-w-0 flex-1">
                <h2 id="client-drawer-title" className="truncate text-[24px] font-semibold leading-8 tracking-[-0.03em] text-foreground sm:text-[28px] sm:leading-9">
                  {nomeDoCliente}
                </h2>
                <div className="-mx-1 mt-1.5 flex min-w-0 flex-wrap items-center [&>*]:mx-1 [&>*]:my-0.5">
                  <StatusPill tone={statusAtual?.tom || "neutral"}>{statusAtual?.label || "Sem status"}</StatusPill>
                  {client.full_name && client.company_name && <span className={juntar(texto.auxiliar, "min-w-0 truncate")}>{client.full_name}</span>}
                  {client.email && (
                    <span className={juntar(texto.auxiliar, "hidden min-w-0 items-center sm:inline-flex")}>
                      <Mail className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">{client.email}</span>
                    </span>
                  )}
                  {client.phone && (
                    <span className={juntar(texto.auxiliar, "hidden min-w-0 items-center tabular-nums sm:inline-flex")}>
                      <Phone className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">{client.phone}</span>
                    </span>
                  )}
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Fechar dados do cliente"
                onClick={onClose}
                className={juntar("toque-compacto ml-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-foreground hover:text-background", foco)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {isAdmin && <MudarPlano key={client.id} client={client as never} onSalvo={(p) => { setPlanName(p.nome); setPlanValue(String(p.valor)); setPlanStatus("active"); }} />}
            <div className="mt-4 min-w-0">
              <PillTabs tabs={abas} value={abaAberta} onChange={(v) => setAba(v)} label="Partes da ficha do cliente" />
            </div>
          </div>

          <RegiaoRolavel modo="sempre" sobre="fundo" memoria={`ficha:${client.id}:${abaAberta}`} className="px-4 py-5 sm:px-8 sm:py-6">
            {/* ── Resumo: números, operação, projetos e briefing ── */}
            <div className={painelDaAba("resumo")}>
              {isAdmin && (
                <div role="group" aria-label="Resumo executivo" className="grid min-w-0 grid-cols-3 gap-3 sm:gap-4">
                  {/* 16/10/2026 (celular, menos números): abaixo de 640 px ficam Projetos, Tarefas e
                      Atrasados numa linha; Aprovações já é o contador da aba Resumo. */}
                  <StatCard
                    variant="ink"
                    label="Projetos"
                    value={execActiveProjects}
                    hint={totalDeProjetos > 0 ? `${projetosConcluidos} de ${totalDeProjetos} concluídos` : "Nenhum ainda"}
                    chart={totalDeProjetos > 0 ? <ProgressBar value={projetosConcluidos} max={totalDeProjetos} height={6} label={`${projetosConcluidos} de ${totalDeProjetos} projetos concluídos`} /> : undefined}
                    className="max-sm:p-3.5"
                  />
                  <StatCard
                    label="Tarefas"
                    value={execOpenTasks}
                    hint={execUrgentTasks > 0 ? <span className="font-medium text-destructive">{execUrgentTasks} urgentes</span> : totalDeTarefas > 0 ? `${tarefasFeitas} de ${totalDeTarefas} feitas` : "Em aberto"}
                    chart={totalDeTarefas > 0 ? <ProgressBar value={tarefasFeitas} max={totalDeTarefas} height={6} label={`${tarefasFeitas} de ${totalDeTarefas} tarefas feitas`} /> : undefined}
                    className="max-sm:p-3.5"
                  />
                  <StatCard
                    variant={execPendingFiles > 0 ? "accent" : "default"}
                    label="Aprovações"
                    value={execPendingFiles}
                    hint="Aguardando o cliente"
                    className="max-sm:hidden"
                  />
                  <StatCard label="Relatórios" value={execPublishedReports} hint="Publicados" className="max-sm:hidden" />
                  <StatCard
                    label="Pendências"
                    value={execPendingBills}
                    hint={execPendingBills > 0 ? <span className="font-medium text-warning">Cobranças em aberto</span> : "Cobranças em aberto"}
                    className="max-sm:hidden"
                  />
                  <StatCard
                    label="Atrasados"
                    value={execOverdueBills}
                    hint={execOverdueBills > 0 ? <span className="font-medium text-destructive">Vencidas com saldo</span> : "Nada vencido"}
                    className="max-sm:p-3.5"
                  />
                </div>
              )}

              <Secao
                titulo="Operação"
                descricao={execPendingFiles > 0 ? `${execPendingFiles} aguardando cliente` : undefined}
                ajuda="Crie uma entrega ou acompanhe o que já foi enviado para este cliente."
              >
                <div className="grid min-w-0 grid-cols-3 gap-3 sm:gap-4">
                  <button type="button" onClick={() => openClientOperation(`/arquivos?client=${encodeURIComponent(client.id)}&folder=materiais&novo=1`)} className={AZULEJO}>
                    <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background"><Plus className="h-5 w-5" /></span>
                    <span className="mt-3 text-[13px] font-medium leading-5 text-foreground">Novo conteúdo</span>
                    <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground max-sm:hidden" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => openClientOperation(`/arquivos?client=${encodeURIComponent(client.id)}&folder=materiais`)} className={AZULEJO}>
                    <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><FolderOpen className="h-5 w-5" /></span>
                    <span className="mt-3 text-[13px] font-medium leading-5 text-foreground">Ver entregas</span>
                    <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground max-sm:hidden" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => openClientOperation(`/aprovacoes?client=${encodeURIComponent(client.id)}`)} className={AZULEJO}>
                    <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-warning-soft text-warning"><PackageCheck className="h-5 w-5" /></span>
                    <span className="mt-3 text-[13px] font-medium leading-5 text-foreground">Aprovações</span>
                    <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground max-sm:hidden" aria-hidden="true" />
                  </button>
                </div>
              </Secao>

              {/* Frente PRO3 (30/09): as propostas do cliente (histórico, nova, upsell e conselho), só admin e gestor. */}
              {(isAdmin || profile?.role === "manager") && (
                <div className={BLOCO}>
                  <PropostasDoCliente
                    cliente={{ id: String(client.id), nome: nomeDoCliente || "Cliente", services_config: client.services_config, plan_name: client.plan_name, client_type: client.client_type }}
                    onAbrir={(caminho) => openClientOperation(caminho)}
                  />
                </div>
              )}

              {/* Projetos do cliente: criar aqui ou puxar um que ficou solto */}
              <div className={BLOCO}>
                <Secao
                  titulo="Projetos"
                  descricao={(clientProjects || []).length === 0 ? "Nenhum projeto ainda" : `${(clientProjects || []).length} neste cadastro`}
                  acao={
                    <>
                      <button type="button" onClick={() => setVincularAberto((v) => !v)} aria-expanded={vincularAberto} className={botao.secundario} aria-label="Vincular projeto existente">
                        <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <span className="ml-1.5 hidden sm:inline">Vincular existente</span>
                      </button>
                      <button type="button" onClick={() => setNovoProjetoAberto(true)} className={botao.primario} aria-label="Novo projeto">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        <span className="ml-1.5 hidden sm:inline">Novo projeto</span>
                      </button>
                    </>
                  }
                >
                  {vincularAberto && (
                    <div className={juntar(superficie.poco, "mb-3 p-4")}>
                      <CampoDeFormulario
                        rotulo="Projeto que vem para este cliente"
                        ajuda="O projeto sai do cadastro atual e passa para cá com tarefas, marcos e arquivos. Fica registrado no diário dos dois."
                      >
                        <select value={projetoParaVincular} onChange={(e) => setProjetoParaVincular(e.target.value)} className={campo}>
                          <option value="">Escolha o projeto</option>
                          {projetosDeOutros.map((p: any) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · hoje em {p.client?.company_name || p.client?.full_name || "sem cliente"} ({p.status})
                            </option>
                          ))}
                        </select>
                      </CampoDeFormulario>
                      <div className="mt-3 flex justify-end [&>*+*]:ml-2">
                        <button type="button" onClick={() => setVincularAberto(false)} className={botao.discreto}>
                          Cancelar
                        </button>
                        <button type="button" disabled={!projetoParaVincular || vinculando} onClick={() => void vincularProjeto()} className={botao.primario}>
                          {vinculando ? "Vinculando…" : "Vincular a este cliente"}
                        </button>
                      </div>
                    </div>
                  )}
                  {(clientProjects || []).length > 0 ? (
                    <List label="Projetos deste cliente">
                      {(clientProjects || []).map((p: any) => {
                        const andamento = Math.max(0, Math.min(100, Number(p.progress) || 0));
                        return (
                          <ListRow
                            key={p.id}
                            leading={<Avatar icon={<Briefcase className="h-4 w-4" />} tone={p.status === "done" ? "solid" : p.status === "in_progress" ? "ink" : "neutral"} />}
                            title={p.name}
                            subtitle={p.deadline ? `Prazo ${String(p.deadline).slice(0, 10).split("-").reverse().join("/")}` : undefined}
                            status={<StatusPill tone={TOM_DO_PROJETO[p.status] || "neutral"}>{STATUS_DO_PROJETO[p.status] || p.status}</StatusPill>}
                            value={`${andamento}%`}
                            valueHint={<span className="mt-1 block w-16"><ProgressBar value={andamento} max={100} height={4} label={`${andamento}% do projeto`} /></span>}
                          />
                        );
                      })}
                    </List>
                  ) : (
                    <EstadoVazio compacto titulo="Sem projeto." descricao="Crie um ou vincule um que já existe." />
                  )}
                </Secao>
              </div>

              <div className={BLOCO}>
                <Secao
                  titulo="Briefing"
                  acao={
                    <button type="button" onClick={() => setBriefingOpen(true)} className={botao.secundario}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      <span className="ml-1.5">Novo link</span>
                    </button>
                  }
                >
                  {clientBriefings && clientBriefings.length > 0 ? (
                    <List label="Briefings deste cliente">
                      {clientBriefings.map((b) => {
                        const estado = b.submitted && b.reabertura_pedida_em ? "reabertura pedida" : estadoDoLink(b) === "enviado" ? "recebido" : estadoDoLink(b) === "expirado" ? "expirado" : "aguardando";
                        const tomDoEstado: Tone = estado === "recebido" ? "success" : estado === "expirado" ? "danger" : estado === "aguardando" ? "warning" : "info";
                        const quando = b.submitted ? b.enviado_em || b.created_at : b.created_at;
                        return (
                          <ListRow
                            key={b.id}
                            leading={<Avatar icon={<FileText className="h-4 w-4" />} tone="accent" />}
                            title={b.titulo || modeloDeFabrica(b.modelo).nome}
                            subtitle={new Date(quando).toLocaleDateString("pt-BR")}
                            status={<StatusPill tone={tomDoEstado}>{estado}</StatusPill>}
                            onClick={() => void openClientOperation(`/briefings?briefing=${b.id}`)}
                          />
                        );
                      })}
                    </List>
                  ) : (
                    <EstadoVazio compacto titulo="Sem briefing." descricao="Gere o link no modelo do serviço." />
                  )}
                </Secao>
              </div>

            </div>

            {/* ── Cadastro: dados, status, tipo, marca e serviços ── */}
            <div className={painelDaAba("cadastro")}>
              <div className={BLOCO}>
              <GrupoDeCampos titulo="Dados">
                <CampoDeFormulario rotulo="Nome completo" obrigatorio>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Empresa" obrigatorio>
                  <input value={company} onChange={(e) => setCompany(e.target.value)} className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario
                  rotulo="E-mail"
                  apoio={isAdmin && email.trim().toLowerCase() !== String(client?.email || "").trim().toLowerCase()
                    ? "Ao salvar, o cliente passa a entrar com este e-mail. A senha continua a mesma."
                    : "É o login do cliente."}
                >
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!isAdmin}
                    autoComplete="off"
                    inputMode="email"
                    className={juntar(campo, !isAdmin && "text-muted-foreground")}
                  />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Telefone">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className={campo} inputMode="tel" />
                </CampoDeFormulario>
              </GrupoDeCampos>
              </div>

              <div className={juntar(BLOCO, "space-y-5")}>
              <GrupoDeCampos titulo="Situação" colunas={1}>
                <CampoDeFormulario rotulo="Status do cliente">
                  <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
                    <SeletorCompacto
                      rotulo="Status do cliente"
                      modo="segmentado"
                      opcoes={CLIENT_STATUS_OPTIONS.map((s) => ({ valor: s.value, rotulo: s.label }))}
                      valor={planStatus}
                      onEscolher={setPlanStatus}
                    />
                    {/* Ação rápida: Travar / Retornar (recorrentes e híbridos) */}
                    {isAdmin && (clientType === "recurring" || clientType === "hybrid") && (
                      planStatus === "standby" ? (
                        <button type="button" onClick={retornarCliente} disabled={saving} className={juntar(botao.secundario, "text-success")}>
                          <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Retornar cliente
                        </button>
                      ) : (
                        <button type="button" onClick={travarCliente} disabled={saving} className={botao.secundario}>
                          <Pause className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Travar (Standby)
                        </button>
                      )
                    )}
                  </div>
                </CampoDeFormulario>
              </GrupoDeCampos>

              <GrupoDeCampos>
                <CampoDeFormulario rotulo="Tipo de cliente">
                  <SeletorCompacto
                    rotulo="Tipo de cliente"
                    larguraTotal
                    opcoes={[
                      { valor: "recurring", rotulo: "Recorrente" },
                      { valor: "one_off", rotulo: "Avulso" },
                      { valor: "hybrid", rotulo: "Híbrido" },
                    ]}
                    valor={clientType}
                    onEscolher={(v) => setClientType(v as any)}
                  />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Marca">
                  <SeletorCompacto
                    rotulo="Marca"
                    larguraTotal
                    opcoes={[
                      { valor: "", rotulo: "Nenhuma" },
                      { valor: "aceleriq", rotulo: "AcelerIQ" },
                      { valor: "sitebolt", rotulo: "SiteBolt" },
                    ]}
                    valor={brand}
                    onEscolher={(v) => setBrand(v as any)}
                  />
                </CampoDeFormulario>
              </GrupoDeCampos>
              </div>

              {/* 12/10/2026: Dia Prioritário (salva sozinho, pela RPC; só admin muda) */}
              <div className={BLOCO}>
                <DiaPrioritarioNoCadastro client={{ ...client, id: String(client.id) }} admin={isAdmin} />
              </div>

              {/* 14/11/2026: como o cliente aprova as peças (só o registro da regra; só admin muda) */}
              <div className={BLOCO}>
                <ModoDeAprovacaoNoCadastro clientId={String(client.id)} admin={isAdmin} />
              </div>

              <div className={BLOCO}>
                <Secao titulo="Serviços ativos" descricao={`${SERVICES.filter((s) => !!services[s.key]).length} de ${SERVICES.length}`}>
                  <div className="mb-4">
                    <ProgressBar value={SERVICES.filter((s) => !!services[s.key]).length} max={SERVICES.length} height={6} label={`${SERVICES.filter((s) => !!services[s.key]).length} de ${SERVICES.length} serviços ativos`} />
                  </div>
                  <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {SERVICES.map((s) => (
                      <li key={s.key} className={juntar("flex min-w-0 items-center justify-between rounded-md px-4 py-3 transition-colors", services[s.key] ? "bg-accent-soft" : "bg-muted/60")}>
                        <span className={juntar(texto.corpo, "min-w-0 truncate font-medium")} id={`servico-${s.key}`}>
                          {s.label}
                        </span>
                        <Switch aria-labelledby={`servico-${s.key}`} checked={!!services[s.key]} onCheckedChange={() => toggleService(s.key)} />
                      </li>
                    ))}
                  </ul>
                </Secao>
              </div>
              {(isAdmin || profile?.role === "manager") && abaAberta === "cadastro" && (
                <div className={BLOCO}>
                  <Secao titulo="Dados fiscais" ajuda="CNPJ ou CPF, razão social, endereço, representante e e-mails de contrato e cobrança. Todo contrato do cliente usa estes dados.">
                    <Suspense fallback={<div className="h-24 animate-pulse rounded-md bg-muted" aria-busy="true" aria-label="Abrindo a ficha fiscal" />}>
                      <DadosFiscaisDoCliente clientId={client.id} />
                    </Suspense>
                  </Secao>
                </div>
              )}
            </div>

            {/* ── Plano e cobrança (admin) ── */}
            {isAdmin && (
              <div className={painelDaAba("plano")}>
                {/* 14/11/2026: o que o cliente comprou além da mensalidade (order bumps e upsells), com o financeiro junto. */}
                {abaAberta === "plano" && (
                  <div className={BLOCO}>
                    <ExtrasDoCliente clientId={client.id} nomeDoCliente={client.company_name || client.full_name || undefined} mensalidade={Number(planValue) || 0} />
                  </div>
                )}
                <div className={BLOCO}>
                <GrupoDeCampos titulo="Plano">
                  <CampoDeFormulario rotulo="Plano do catálogo" apoio="Preenche nome e valor. O valor segue editável.">
                    <select
                      value={matchedCatalogPlan?.id || ""}
                      onChange={(e) => {
                        const plan = (catalogPlans || []).find((p) => p.id === e.target.value);
                        if (!plan) return;
                        const version = plan.currentVersion || plan.versions[0] || null;
                        setPlanName(plan.name);
                        if (version) setPlanValue(String(version.finalAmount || version.amount));
                      }}
                      className={campo}
                    >
                      <option value="">Manual / fora do catálogo</option>
                      {(catalogPlans || []).filter((p) => p.isActive).map((p) => {
                        const v = p.currentVersion || p.versions[0] || null;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name}{v ? ` · R$ ${(v.finalAmount || v.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Nome do plano">
                    <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Ex.: Básico, Pro, Premium" className={campo} />
                  </CampoDeFormulario>
                  <CampoDeFormulario
                    rotulo="Valor do plano (R$)"
                    apoio={
                      matchedCatalogPlan && catalogPlanValue !== null && planValue && Math.abs(parseFloat(planValue) - catalogPlanValue) > 0.009
                        ? `Tabela: R$ ${catalogPlanValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}. Valor ajustado para este cliente.`
                        : undefined
                    }
                  >
                    <input type="number" step="0.01" value={planValue} onChange={(e) => setPlanValue(e.target.value)} placeholder="Ex.: 1500.00" className={juntar(campo, "tabular-nums")} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Data de vencimento">
                    <input type="date" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} className={campo} />
                  </CampoDeFormulario>
                  <div className={juntar(superficie.poco, "flex min-w-0 items-center justify-between px-4 py-3 sm:col-span-full")}>
                    <div className="mr-3 flex min-w-0 items-center">
                      <span className={juntar(texto.corpo, "font-medium")} id="empresa-do-grupo">
                        Empresa do grupo (interna)
                      </span>
                      <AjudaRecolhida className="ml-1.5">Cadastro só para organização. Fica fora de cobranças, alertas de atraso, "sem plano" e MRR.</AjudaRecolhida>
                    </div>
                    <Switch
                      aria-labelledby="empresa-do-grupo"
                      checked={Boolean(services.internal_company)}
                      onCheckedChange={(v) => setServices((prev) => ({ ...prev, internal_company: v }))}
                    />
                  </div>
                </GrupoDeCampos>
                </div>

                {/* Cobranças editáveis: valor, vencimento e pago/pendente. É o
                    caminho de corrigir o financeiro sem caçar linha no banco. */}
                {client?.id && <div className={BLOCO}><CobrancasDoCliente clientId={client.id} /></div>}

                {/* Pagamentos de projetos não recorrentes */}
                {nonRecurringProjects && nonRecurringProjects.length > 0 && (
                  <div className={BLOCO}>
                  <Secao titulo="Pagamentos de projetos" descricao={`${nonRecurringProjects.length} projeto(s) avulso(s)`}>
                    <ul className="divide-y divide-border/70">
                      {nonRecurringProjects.map((proj: any) => {
                        const pay = proj.payment;
                        const isExpanded = expandedProject === proj.id;

                        if (!pay) {
                          return (
                            <li key={proj.id} className="py-3">
                              <div className="flex min-w-0 items-center justify-between">
                                <p className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{proj.name}</p>
                                {payCreateForProject !== proj.id && (
                                  <button
                                    type="button"
                                    onClick={() => { setPayCreateForProject(proj.id); setPayTotal(""); setPayEntryPct(""); setPayInstCount("1"); setPayNotes(""); }}
                                    className={juntar(botao.discreto, "ml-3 h-8 text-primary")}
                                  >
                                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Criar plano de pagamento
                                  </button>
                                )}
                              </div>
                              {payCreateForProject === proj.id && (
                                <div className={juntar(superficie.poco, "mt-3 p-4")}>
                                  <GrupoDeCampos colunas={3}>
                                    <CampoDeFormulario rotulo="Valor total (R$)" obrigatorio>
                                      <input inputMode="decimal" placeholder="5000" value={payTotal} onChange={(e) => setPayTotal(e.target.value)} className={juntar(campo, "tabular-nums")} />
                                    </CampoDeFormulario>
                                    <CampoDeFormulario rotulo="Entrada (R$)">
                                      <input inputMode="decimal" placeholder="0,00" value={payEntryPct} onChange={(e) => setPayEntryPct(e.target.value)} className={juntar(campo, "tabular-nums")} />
                                    </CampoDeFormulario>
                                    <CampoDeFormulario rotulo={lerValorBR(payEntryPct) > 0 ? "Restante em" : "Parcelas"}>
                                      <input type="number" min="1" max="24" value={payInstCount} onChange={(e) => setPayInstCount(e.target.value)} className={juntar(campo, "tabular-nums")} />
                                    </CampoDeFormulario>
                                    <CampoDeFormulario rotulo="Observações" largo>
                                      <input placeholder="Opcional" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} className={campo} />
                                    </CampoDeFormulario>
                                  </GrupoDeCampos>
                                  <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between">
                                    <p className={juntar(texto.auxiliar, "mr-3 min-w-0 tabular-nums")}>
                                      {lerValorBR(payTotal) > 0
                                        ? `${lerValorBR(payEntryPct) > 0 ? `Entrada R$ ${Math.min(lerValorBR(payEntryPct), lerValorBR(payTotal)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · restante ` : ""}${Math.max(parseInt(payInstCount) || 1, 1)}x de R$ ${(Math.max(lerValorBR(payTotal) - lerValorBR(payEntryPct), 0) / Math.max(parseInt(payInstCount) || 1, 1)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                        : ""}
                                    </p>
                                    <div className="flex [&>*+*]:ml-2">
                                      <button
                                        type="button"
                                        onClick={() => { setPayCreateForProject(null); setPayTotal(""); setPayEntryPct(""); setPayInstCount("1"); setPayNotes(""); }}
                                        className={botao.discreto}
                                      >
                                        Cancelar
                                      </button>
                                      <button type="button" onClick={() => handleCreatePayment(proj.id)} disabled={paySubmitting || !(lerValorBR(payTotal) > 0) || lerValorBR(payEntryPct) > lerValorBR(payTotal)} className={botao.primario}>
                                        {paySubmitting ? "Criando..." : "Criar plano"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        }

                        const installments = pay.installments || [];
                        const paidTotal = installments.filter((i: any) => i.status === "paid").reduce((sum: number, i: any) => sum + Number(i.amount), 0);
                        const remaining = pay.total_value - paidTotal;
                        const paidCount = installments.filter((i: any) => i.status === "paid").length;
                        const totalCount = installments.length;
                        const hasOverdue = installments.some((i: any) => saldoDaParcela(i) > 0 && String(i.due_date || "").slice(0, 10) < new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));

                        return (
                          <li key={proj.id} className="py-1">
                            <button
                              type="button"
                              onClick={() => setExpandedProject(isExpanded ? null : proj.id)}
                              aria-expanded={isExpanded}
                              className={juntar("-mx-2 flex w-[calc(100%+16px)] min-w-0 items-center rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/60", foco)}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center">
                                  <p className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{proj.name}</p>
                                  {hasOverdue && <StatusPill tone="danger" className="ml-2">Atrasado</StatusPill>}
                                </div>
                                <p className="mt-1 truncate text-[20px] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-foreground">
                                  {dinheiroDaFicha(paidTotal)}
                                  <span className="ml-1.5 text-[12px] font-normal tracking-normal text-muted-foreground">de {dinheiroDaFicha(Number(pay.total_value))}</span>
                                </p>
                                <div className="mt-2">
                                  <ProgressBar value={paidTotal} max={Number(pay.total_value) || 0} height={6} label={`Recebido ${dinheiroDaFicha(paidTotal)} de ${dinheiroDaFicha(Number(pay.total_value))}`} />
                                </div>
                                <p className={juntar(texto.auxiliar, "mt-1.5 truncate tabular-nums")}>
                                  {paidCount}/{totalCount} parcelas
                                  {remaining > 0 && <span className="text-warning"> · falta {dinheiroDaFicha(remaining)}</span>}
                                </p>
                              </div>
                              {isExpanded ? <ChevronUp className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronDown className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                            </button>

                            {isExpanded && (
                              <div className="pb-2 pl-1">
                                <p className={juntar(texto.auxiliar, "mb-1 tabular-nums")}>{paidCount}/{totalCount} parcelas · entrada {pay.entry_percentage}%</p>
                                <ul className="divide-y divide-border/70">
                                  {installments
                                    .sort((a: any, b: any) => a.installment_number - b.installment_number)
                                    .map((inst: any) => {
                                      const isPaid = inst.status === "paid";
                                      const isOverdue = !isPaid && new Date(inst.due_date) < new Date();
                                      return (
                                        <li key={inst.id} className="flex min-w-0 items-center py-2.5">
                                          <span className={`mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isPaid ? "bg-muted text-success" : isOverdue ? "bg-danger-soft text-destructive" : "bg-warning-soft text-warning"}`} aria-hidden="true">
                                            {isPaid ? <CheckCircle2 className="h-4 w-4" /> : isOverdue ? <AlertCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                                          </span>
                                          <div className="min-w-0 flex-1">
                                            <p className={juntar(texto.corpo, "truncate")}>{inst.description}</p>
                                            <p className={juntar(texto.auxiliar, "tabular-nums")}>
                                              {new Date(inst.due_date).toLocaleDateString("pt-BR")}
                                              {inst.paid_date && ` · pago ${new Date(inst.paid_date).toLocaleDateString("pt-BR")}`}
                                            </p>
                                          </div>
                                          <span className="ml-3 whitespace-nowrap text-[13px] font-semibold tabular-nums text-foreground">R$ {Number(inst.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                                          {!isPaid && (
                                            <button
                                              type="button"
                                              onClick={(e) => { e.stopPropagation(); handleMarkInstallmentPaid(inst.id); }}
                                              disabled={paySubmitting}
                                              className={juntar(botao.discreto, "ml-2 h-8 text-success")}
                                            >
                                              Pago
                                            </button>
                                          )}
                                        </li>
                                      );
                                    })}
                                </ul>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </Secao>
                  </div>
                )}
              </div>
            )}

            {/* ── Acesso ao portal (admin) ── */}
            {isAdmin && (
              <div className={painelDaAba("acesso")}>
                <div className={BLOCO}>
                <Secao
                  titulo="Convite de primeiro acesso"
                  ajuda="Cliente não recebeu o e-mail para criar a senha? Reenvie o convite: um novo link seguro é gerado e enviado para o e-mail cadastrado."
                  descricao={client.email ? <span className="break-words">{client.email}</span> : "Sem e-mail cadastrado"}
                  acao={
                    <button type="button" disabled={resendingInvite} onClick={reenviarConvite} className={botao.secundario}>
                      {resendingInvite ? "Reenviando…" : "Reenviar convite"}
                    </button>
                  }
                />
                </div>
                {!client?.first_access_used_at && (
                  <div className={BLOCO}>
                  <Secao
                    titulo="Link de primeiro acesso"
                    ajuda="Gera o link para você enviar na mão (WhatsApp) sem disparar e-mail. Cada novo link invalida o anterior, então envie sempre o último gerado."
                    acao={
                      <button type="button" disabled={generatingLink} onClick={gerarLinkDeAcesso} className={botao.secundario}>
                        {generatingLink ? "Gerando link…" : firstAccessLink ? "Gerar novo link" : "Gerar link"}
                      </button>
                    }
                  >
                    {firstAccessLink && (
                      <div className="flex min-w-0 items-center">
                        <input
                          readOnly
                          aria-label="Link de primeiro acesso"
                          value={firstAccessLink}
                          onFocus={(e) => e.currentTarget.select()}
                          className={juntar(campo, "min-w-0 flex-1 font-mono text-[12px]")}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(firstAccessLink);
                              toast.success("Link copiado.");
                            } catch {
                              toast.error("Copie manualmente selecionando o texto.");
                            }
                          }}
                          className={juntar(botao.secundario, "ml-2")}
                        >
                          Copiar
                        </button>
                      </div>
                    )}
                  </Secao>
                  </div>
                )}
                <div className={BLOCO}>
                <GrupoDeCampos titulo="Senha">
                  <CampoDeFormulario
                    rotulo="Definir ou alterar senha"
                    apoio="Deixe vazio para manter a atual."
                    ajuda="A senha fica protegida pelo sistema de autenticação e não pode ser visualizada. Para trocar, defina uma nova aqui (mínimo 12 caracteres, com maiúscula, minúscula, número e símbolo)."
                  >
                    <input
                      value={clientPassword}
                      onChange={(e) => setClientPassword(e.target.value)}
                      type="password"
                      autoComplete="new-password"
                      placeholder="Nova senha"
                      className={juntar(campo, "font-mono placeholder:font-sans")}
                    />
                  </CampoDeFormulario>
                </GrupoDeCampos>
                </div>
              </div>
            )}

            {/* ── Contas e canais (sem credenciais) + cofre de acessos ── */}
            <div className={painelDaAba("contas")}>
              <div ref={accountsSectionRef} className={juntar(BLOCO, "scroll-mt-4")}>
                <ClientConnectionsPanel key={client.id} clientId={client.id} clientName={client.company_name || client.full_name || "Cliente"} initialProjectId={initialProjectId} />
              </div>
              <div className={BLOCO}>
                <Secao titulo="Cofre de acessos">
                  <ClientVault clientId={client.id} canManage={isAdmin || ["design", "traffic", "manager"].includes(profile?.role || "")} />
                </Secao>
              </div>
            </div>

            {/* ── Esteira de onboarding ── */}
            <div className={painelDaAba("onboarding")}>
              <div className={BLOCO}>
                <Secao titulo="Esteira de onboarding">
                  <ClientOnboardingPanel clientId={client.id} servicesConfig={services} />
                </Secao>
              </div>
            </div>

            {/* ── Automações do cliente (19/11/2026): os fluxos do n8n feitos para ele ── */}
            <div className={painelDaAba("automacoes")}>
              <div className={BLOCO}>
                <Secao titulo="Automações" recolher={false}>
                  {abaAberta === "automacoes" && <AutomacoesDoCliente clientId={client.id} />}
                </Secao>
              </div>
            </div>
          </RegiaoRolavel>

          <div className="flex min-w-0 items-center justify-between border-t border-border bg-card px-4 py-3 sm:px-8 sm:py-4">
            {isAdmin ? (
              <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} className={juntar(botao.discreto, "text-destructive hover:text-destructive")}>
                <Trash2 className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Excluir</span>
                <span className="sr-only sm:hidden">Excluir cliente</span>
              </button>
            ) : <div />}
            <div className="flex items-center [&>*+*]:ml-2">
              {hasUnsavedChanges && <span className={juntar(texto.auxiliar, "hidden sm:inline")}>Alterações não salvas</span>}
              <button type="button" onClick={onClose} disabled={saving} className={botao.secundario}>
                Cancelar
              </button>
              <button type="button" onClick={handleSave} disabled={saving} className={botao.primario}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isAdmin && (
        <ExcluirClienteModal
          cliente={confirmDelete ? { id: client.id, nome: String(client.company_name || client.full_name || "Cliente").trim() || "Cliente", plan_status: client.plan_status ?? null } : null}
          aoFechar={() => setConfirmDelete(false)}
          aoExcluir={onClose}
        />
      )}

      <GerarLinkDoBriefing
        open={briefingOpen}
        onClose={() => setBriefingOpen(false)}
        clientId={client.id}
        aoGerar={() => void queryClient.invalidateQueries({ queryKey: ["client-briefings", client.id] })}
      />
      <CreateProjectModal
        open={novoProjetoAberto}
        defaultClientId={client.id}
        onClose={() => {
          setNovoProjetoAberto(false);
          queryClient.invalidateQueries({ queryKey: ["client-exec-projects"] });
          queryClient.invalidateQueries({ queryKey: ["projects"] });
        }}
      />
    </>,
    document.body,
  );
}
