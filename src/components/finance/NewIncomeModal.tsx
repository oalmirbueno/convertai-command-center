import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useClients, useTeamMembers } from "@/hooks/useSupabaseData";
import { projectTemplates } from "@/lib/projectTemplates";
import { format, addDays } from "date-fns";
import { Loader2, Sparkles, FolderPlus } from "lucide-react";
import {
  buildPaymentInstallments,
  buildPlanoComEntrada,
  lerValorBR,
  normalizeMoney,
  percentualDaEntrada,
  splitAmount,
} from "@/lib/paymentInstallments";
import { somarMeses } from "@/lib/extrasDoCliente";
import { compensateNewIncome } from "@/lib/newIncomeCompensation";
import { CampoDeFormulario, GrupoDeCampos, SeletorCompacto, botao, campo, campoTexto, juntar, superficie, texto } from "@/components/sistema";

const PROJECT_TYPES = [
  { value: "site", label: "Site", desc: "Desenvolvimento de site institucional/landing · design, código, SEO básico, deploy." },
  { value: "landing_page", label: "Landing Page", desc: "Landing page focada em conversão · design, copy, formulário e tracking." },
  { value: "automation", label: "Automação", desc: "Automação de processos / integrações via APIs e webhooks." },
  { value: "social_media", label: "Social Media", desc: "Pacote avulso de social media · conteúdo, criativos e publicação." },
  { value: "trafego", label: "Tráfego pago", desc: "Setup e gestão de campanhas de tráfego pago." },
  { value: "video", label: "Vídeo", desc: "Produção audiovisual · pré-produção, captação, edição e entrega." },
  { value: "video_ai", label: "Vídeo IA", desc: "Vídeo gerado com IA · roteiro, prompts, geração, edição e entrega." },
  { value: "event", label: "Evento", desc: "Cobertura e divulgação de evento · pré, durante e pós." },
  { value: "other", label: "Outro", desc: "Projeto avulso personalizado." },
];

const typeMeta = (v: string) => PROJECT_TYPES.find(t => t.value === v) || PROJECT_TYPES[PROJECT_TYPES.length - 1];

interface Props {
  open: boolean;
  onClose: () => void;
  existingProjects: any[]; // already-loaded project_payments OR projects list
}

export default function NewIncomeModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: clients } = useClients();
  const { data: teamMembers } = useTeamMembers();

  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState("");
  const [projectMode, setProjectMode] = useState<"existing" | "new">("new");
  const [existingProjectId, setExistingProjectId] = useState("");
  const [projectType, setProjectType] = useState("site");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState<"aceleriq" | "sitebolt" | "">("sitebolt");
  const [generateTasks, setGenerateTasks] = useState(true);
  const [totalValue, setTotalValue] = useState("");
  const [paymentMode, setPaymentMode] = useState<"a_vista" | "parcelado">("a_vista");
  const [installmentsCount, setInstallmentsCount] = useState("2");
  const [firstDueDate, setFirstDueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [paidInstallments, setPaidInstallments] = useState("0");
  // Parcelado (16/11): entrada de qualquer valor + o restante em N parcelas.
  const [entrada, setEntrada] = useState("");
  const [entradaPaga, setEntradaPaga] = useState(true);
  const [primeiraParcela, setPrimeiraParcela] = useState(() => somarMeses(format(new Date(), "yyyy-MM-dd"), 1));
  // Suporte mensal que entra junto (vira um extra mensal do cliente) e a indicação sobre ele.
  const [temSuporte, setTemSuporte] = useState(false);
  const [suporteValor, setSuporteValor] = useState("");
  const [suporteDepoisDaEntrega, setSuporteDepoisDaEntrega] = useState(true);
  const [suporteInicio, setSuporteInicio] = useState(() => somarMeses(format(new Date(), "yyyy-MM-dd"), 1));
  const [temAfiliado, setTemAfiliado] = useState(false);
  const [afiliadoNome, setAfiliadoNome] = useState("");
  const [afiliadoPct, setAfiliadoPct] = useState("");

  const selectedClient = useMemo(
    () => (clients || []).find((c: any) => c.id === clientId),
    [clients, clientId]
  );
  const normalizedPreviewTotal = useMemo(() => {
    try {
      return normalizeMoney(Number(totalValue));
    } catch {
      return null;
    }
  }, [totalValue]);

  // Auto-fill name + description when type/client changes (only in 'new' mode)
  useEffect(() => {
    if (projectMode !== "new") return;
    const meta = typeMeta(projectType);
    const cName = selectedClient?.company_name || selectedClient?.full_name || "";
    setName(cName ? `${meta.label} · ${cName}` : meta.label);
    setDescription(meta.desc);
  }, [projectType, clientId, projectMode]);

  // Load existing one_off projects for selected client
  const [existingProjects, setExistingProjects] = useState<any[]>([]);
  useEffect(() => {
    // Trocar rápido de cliente A para B: a resposta de A podia chegar depois da de B e a lista mostrava
    // os projetos de A com B selecionado (e a entrada era vinculada ao projeto de outro cliente). A flag
    // descarta a resposta de um cliente que já não é o escolhido, e a lista do anterior some na hora.
    let cancelado = false;
    setExistingProjects([]);
    if (!clientId) return;
    (async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, project_type, billing_mode")
        .eq("client_id", clientId)
        .eq("billing_mode", "one_off")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (cancelado) return;
      if (error) { toast.error("Não consegui carregar os projetos deste cliente."); return; }
      setExistingProjects(data || []);
    })();
    return () => { cancelado = true; };
  }, [clientId]);

  const reset = () => {
    setClientId(""); setProjectMode("new"); setExistingProjectId("");
    setProjectType("site"); setName(""); setDescription(""); setBrand("sitebolt");
    setGenerateTasks(true); setTotalValue(""); setPaymentMode("a_vista");
    setInstallmentsCount("2"); setFirstDueDate(format(new Date(), "yyyy-MM-dd"));
    setAlreadyPaid(false); setPaidInstallments("0");
    setEntrada(""); setEntradaPaga(true); setPrimeiraParcela(somarMeses(format(new Date(), "yyyy-MM-dd"), 1));
    setTemSuporte(false); setSuporteValor(""); setSuporteDepoisDaEntrega(true);
    setSuporteInicio(somarMeses(format(new Date(), "yyyy-MM-dd"), 1));
    setTemAfiliado(false); setAfiliadoNome(""); setAfiliadoPct("");
  };
  const numeroBR = lerValorBR;

  const handleSave = async () => {
    if (!clientId) return toast.error("Selecione o cliente");
    let total: number;
    try {
      total = normalizeMoney(Number(totalValue));
    } catch (error) {
      return toast.error(error instanceof Error ? error.message : "Informe o valor total");
    }
    if (projectMode === "existing" && !existingProjectId) return toast.error("Selecione o projeto");
    if (projectMode === "new" && !name.trim()) return toast.error("Informe o nome do projeto");
    const valorDaEntrada = paymentMode === "parcelado" ? numeroBR(entrada) : 0;
    if (valorDaEntrada > total) return toast.error("A entrada é maior que o valor total");
    if (temSuporte && !(numeroBR(suporteValor) > 0)) return toast.error("Informe o valor do suporte por mês");
    if (temSuporte && !suporteDepoisDaEntrega && !suporteInicio) return toast.error("Informe quando o suporte começa");
    if (temSuporte && temAfiliado && (afiliadoNome.trim().length < 2 || !(numeroBR(afiliadoPct) > 0) || numeroBR(afiliadoPct) > 100)) {
      return toast.error("Informe o nome de quem indicou e o percentual (até 100%)");
    }

    setSaving(true);
    let createdProjectId: string | null = null;
    let createdPaymentId: string | null = null;

    try {
      let projectId = existingProjectId;

      // 1. Create project if needed
      if (projectMode === "new") {
        const startDate = new Date();
        const deadline = addDays(startDate, 30);
        const { data: newProject, error } = await supabase
          .from("projects")
          .insert({
            client_id: clientId,
            name: name.trim(),
            description: description.trim() || null,
            project_type: projectType,
            billing_mode: "one_off",
            brand: brand || null,
            total_value: total,
            start_date: format(startDate, "yyyy-MM-dd"),
            deadline: format(deadline, "yyyy-MM-dd"),
            status: "planning",
            progress: 0,
            created_by: user?.id,
          } as any)
          .select()
          .single();
        if (error) throw error;
        projectId = newProject.id;
        createdProjectId = newProject.id;

        // Auto-generate milestones + tasks from template
        if (generateTasks && projectTemplates[projectType]) {
          const roleMap: Record<string, string | null> = {};
          for (const m of (teamMembers || [])) {
            if (!roleMap[m.role]) roleMap[m.role] = m.id;
          }
          if (!roleMap["admin"]) roleMap["admin"] = user!.id;

          const tmpls = projectTemplates[projectType];
          for (let mIdx = 0; mIdx < tmpls.length; mIdx++) {
            const tmpl = tmpls[mIdx];
            const targetDate = format(addDays(startDate, tmpl.offsetDays), "yyyy-MM-dd");
            const { data: milestone, error: milestoneError } = await supabase
              .from("milestones")
              .insert({
                project_id: projectId,
                title: tmpl.title,
                target_date: targetDate,
                status: "pending",
                milestone_order: mIdx + 1,
              })
              .select()
              .single();
            if (milestoneError) throw milestoneError;

            const taskRows = tmpl.tasks.map((t, tIdx) => ({
              project_id: projectId,
              milestone_id: milestone.id,
              title: t.title,
              description: t.description || null,
              priority: t.priority,
              assigned_to: roleMap[t.role] || null,
              status: "backlog",
              task_order: tIdx + 1,
            }));
            const { error: taskError } = await supabase.from("tasks").insert(taskRows);
            if (taskError) throw taskError;
          }
        }

        // System update
        const { error: updateError } = await supabase.from("updates").insert({
          project_id: projectId,
          author_id: user!.id,
          message: `Projeto avulso "${name.trim()}" criado via Fluxo de Caixa`,
          update_type: "system",
        });
        if (updateError) throw updateError;
      }

      // 2. Create payment plan (à vista = 1 parcela; parcelado = N parcelas)
      const iCount = paymentMode === "a_vista" ? 1 : Math.max(parseInt(installmentsCount) || 1, 1);
      const paidCount = alreadyPaid
        ? (paymentMode === "a_vista" ? iCount : Math.min(parseInt(paidInstallments) || 0, iCount))
        : 0;
      const entradaV = paymentMode === "parcelado" ? Math.min(numeroBR(entrada), total) : 0;

      const { data: paymentData, error: payErr } = await supabase
        .from("project_payments")
        .insert({
          project_id: projectId,
          client_id: clientId,
          total_value: total,
          entry_percentage: percentualDaEntrada(total, entradaV),
          entry_amount: entradaV,
          installments_count: iCount,
          created_by: user?.id,
        } as any)
        .select()
        .single();
      if (payErr) throw payErr;
      createdPaymentId = paymentData.id;

      const instRows = paymentMode === "parcelado"
        ? buildPlanoComEntrada({
          paymentId: paymentData.id,
          total,
          entrada: entradaV,
          entradaEm: firstDueDate,
          entradaPaga: entradaV > 0 && entradaPaga,
          parcelas: iCount,
          primeiraEm: entradaV > 0 ? primeiraParcela : firstDueDate,
          parcelasPagas: paidCount,
        })
        : buildPaymentInstallments({
          paymentId: paymentData.id,
          total,
          installmentsCount: iCount,
          firstDueDate,
          paidInstallments: paidCount,
        });
      const { error: installmentError } = await supabase
        .from("payment_installments")
        .insert(instRows);
      if (installmentError) throw installmentError;

      // 3. Auto-upgrade client to "hybrid" if previously recurring
      if (selectedClient?.client_type === "recurring") {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({ client_type: "hybrid" })
          .eq("id", clientId);
        if (profileError) throw profileError;
        toast.success(`${selectedClient.company_name || selectedClient.full_name} agora é cliente híbrido`);
      }

      // Notificação é posterior ao núcleo financeiro. Uma indisponibilidade
      // pontual não desfaz o lançamento que já foi salvo com consistência.
      if (projectMode === "new") {
        const { error: notificationError } = await supabase.from("notifications").insert({
          user_id: clientId,
          message: `Novo projeto criado: ${name.trim()}`,
          notification_type: "project",
          link: "/dashboard",
        });
        if (notificationError) {
          console.warn("Falha ao notificar cliente sobre novo projeto", notificationError);
          toast.warning("Entrada salva, mas a notificação do cliente não foi enviada");
        }
      }

      // Suporte mensal: vira um extra do cliente (Extras e produtos), com a cobrança de cada mês pelo banco.
      if (temSuporte) {
        const nomeDoProjeto = projectMode === "new" ? name.trim() : (existingProjects.find((p) => p.id === existingProjectId)?.name || "projeto");
        const { data: extra, error: extraError } = await (supabase as any).rpc("extra_salvar", {
          _dados: {
            client_id: clientId,
            nome: `Suporte e manutenção · ${nomeDoProjeto}`.slice(0, 120),
            categoria: "suporte",
            cobranca: "mensal",
            valor: numeroBR(suporteValor),
            inicio: suporteDepoisDaEntrega ? null : suporteInicio,
          },
        });
        if (extraError) {
          console.warn("Falha ao criar o suporte mensal", extraError);
          toast.warning("Entrada salva, mas o suporte mensal não. Adicione na ficha do cliente, em Extras e produtos.");
        } else if (temAfiliado && extra?.id) {
          const { error: afError } = await (supabase as any).from("client_extras")
            .update({ afiliado_nome: afiliadoNome.trim(), afiliado_percentual: numeroBR(afiliadoPct) })
            .eq("id", extra.id);
          if (afError) toast.warning("Suporte criado, mas a indicação não. Edite o suporte na ficha do cliente.");
        }
      }

      toast.success("Entrada avulsa registrada");
      await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ["all-project-payments-finance"] }),
        qc.invalidateQueries({ queryKey: ["project_payments"] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["clients"] }),
        qc.invalidateQueries({ queryKey: ["expenses"] }),
        qc.invalidateQueries({ queryKey: ["billing"] }),
        qc.invalidateQueries({ queryKey: ["extras-do-cliente", clientId] }),
        qc.invalidateQueries({ queryKey: ["extras-mensais-ativos"] }),
        qc.refetchQueries({ queryKey: ["all-project-payments-finance"] }),
      ]);
      reset();
      onClose();
    } catch (e: any) {
      console.error(e);
      try {
        await compensateNewIncome(
          { createdProjectId, createdPaymentId },
          async (table, id) => {
            const { data, error } = await supabase
              .from(table)
              .delete()
              .eq("id", id)
              .select("id");
            return { error, deletedCount: data?.length ?? 0 };
          },
        );
        toast.error(e.message || "Erro ao registrar entrada; nenhuma alteração foi mantida");
      } catch (cleanupError: any) {
        console.error("Falha ao desfazer entrada incompleta", cleanupError);
        toast.error("O lançamento ficou incompleto. Não tente novamente; revise o financeiro antes de continuar.");
      }
    } finally {
      setSaving(false);
    }
  };

  const willBecomeHybrid = selectedClient?.client_type === "recurring" && projectMode === "new";

  const resumoDoPagamento = normalizedPreviewTotal === null
    ? null
    : paymentMode === "a_vista"
      ? <>Total <span className="tabular-nums text-foreground">R$ {normalizedPreviewTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></>
      : (() => {
          const ent = Math.min(numeroBR(entrada), normalizedPreviewTotal);
          const resto = Math.round((normalizedPreviewTotal - ent) * 100) / 100;
          if (resto <= 0) return <>Tudo na entrada · <span className="tabular-nums text-foreground">R$ {ent.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></>;
          const amounts = splitAmount(
            resto,
            Math.max(parseInt(installmentsCount) || 1, 1),
          );
          const regular = amounts[0];
          const last = amounts[amounts.length - 1];
          return <>
            {ent > 0 && <>Entrada <span className="tabular-nums text-foreground">R$ {ent.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span> · restante </>}
            {amounts.length}× · primeiras <span className="tabular-nums text-foreground">R$ {regular.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
            {last !== regular && <> · última <span className="tabular-nums text-foreground">R$ {last.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></>}
          </>;
        })();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center text-foreground">
            <Sparkles className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Nova entrada avulsa
          </DialogTitle>
          <DialogDescription>Pagamento único, sem renovação.</DialogDescription>
        </DialogHeader>

        <fieldset disabled={saving} className="min-w-0 space-y-5 border-0 p-0">
          <GrupoDeCampos titulo="Projeto">
            <CampoDeFormulario
              rotulo="Cliente"
              obrigatorio
              largo
              apoio={willBecomeHybrid ? "Cliente recorrente: com um projeto avulso ele vira híbrido." : undefined}
            >
              <select value={clientId} onChange={(e) => { setClientId(e.target.value); setExistingProjectId(""); }} className={campo}>
                <option value="">Selecionar cliente...</option>
                {(clients || []).map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name || c.full_name} {c.client_type ? `· ${c.client_type === "recurring" ? "Recorrente" : c.client_type === "one_off" ? "Avulso" : "Híbrido"}` : ""}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>

            {clientId && (
              <div className="min-w-0 sm:col-span-full">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Vínculo</p>
                <SeletorCompacto
                  opcoes={[
                    { valor: "new", rotulo: "Criar novo", icone: <FolderPlus className="h-3.5 w-3.5" /> },
                    { valor: "existing", rotulo: `Vincular existente (${existingProjects.length})`, desativada: existingProjects.length === 0 },
                  ]}
                  valor={projectMode}
                  onEscolher={(v) => setProjectMode(v === "existing" ? "existing" : "new")}
                  rotulo="Projeto novo ou existente"
                  larguraTotal
                />
              </div>
            )}

            {clientId && projectMode === "existing" && (
              <CampoDeFormulario rotulo="Projeto avulso" obrigatorio largo>
                <select value={existingProjectId} onChange={(e) => setExistingProjectId(e.target.value)} className={campo}>
                  <option value="">Selecionar projeto avulso...</option>
                  {existingProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </CampoDeFormulario>
            )}

            {clientId && projectMode === "new" && (
              <>
                <CampoDeFormulario rotulo="Tipo">
                  <select value={projectType} onChange={(e) => setProjectType(e.target.value)} className={campo}>
                    {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Marca">
                  <select value={brand} onChange={(e) => setBrand(e.target.value as any)} className={campo}>
                    <option value="">-</option>
                    <option value="aceleriq">AcelerIQ</option>
                    <option value="sitebolt">SiteBolt</option>
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Nome do projeto" obrigatorio largo>
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Descrição" largo>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={juntar(campoTexto, "min-h-[64px] resize-none")} />
                </CampoDeFormulario>
                {projectTemplates[projectType] && (
                  <label className="flex min-w-0 cursor-pointer items-center sm:col-span-full">
                    <input type="checkbox" checked={generateTasks} onChange={(e) => setGenerateTasks(e.target.checked)} className="mr-2.5 h-4 w-4 shrink-0 accent-primary" />
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block font-medium")}>Gerar tarefas automaticamente</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>
                        {projectTemplates[projectType].length} milestones · {projectTemplates[projectType].reduce((s, m) => s + m.tasks.length, 0)} tarefas
                      </span>
                    </span>
                  </label>
                )}
              </>
            )}
          </GrupoDeCampos>

          <GrupoDeCampos titulo="Pagamento" className="border-t border-border pt-4">
            <CampoDeFormulario rotulo="Valor total" obrigatorio>
              <Input type="number" inputMode="decimal" step="0.01" value={totalValue} onChange={(e) => setTotalValue(e.target.value)} className="h-9" placeholder="0,00" />
            </CampoDeFormulario>
            <div className="min-w-0">
              <p className={juntar(texto.rotulo, "mb-1.5")}>Forma de pagamento</p>
              <SeletorCompacto
                opcoes={[{ valor: "a_vista", rotulo: "À vista" }, { valor: "parcelado", rotulo: "Parcelado" }]}
                valor={paymentMode}
                onEscolher={(v) => setPaymentMode(v === "parcelado" ? "parcelado" : "a_vista")}
                rotulo="Forma de pagamento"
                larguraTotal
              />
            </div>

            {paymentMode === "parcelado" ? (
              <>
                <CampoDeFormulario rotulo="Entrada (R$)" apoio="Qualquer valor. Vazio = sem entrada.">
                  <Input inputMode="decimal" value={entrada} onChange={(e) => setEntrada(e.target.value)} className="h-9" placeholder="0,00" data-entrada-livre="" />
                </CampoDeFormulario>
                {numeroBR(entrada) > 0 && (
                  <>
                    <CampoDeFormulario rotulo="Data da entrada">
                      <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} className="h-9" />
                    </CampoDeFormulario>
                    <div className="min-w-0">
                      <p className={juntar(texto.rotulo, "mb-1.5")}>A entrada</p>
                      <SeletorCompacto opcoes={[{ valor: "sim", rotulo: "Já pagou" }, { valor: "nao", rotulo: "Vai pagar" }]} valor={entradaPaga ? "sim" : "nao"} onEscolher={(v) => setEntradaPaga(v === "sim")} rotulo="A entrada" larguraTotal />
                    </div>
                  </>
                )}
                <CampoDeFormulario rotulo={numeroBR(entrada) > 0 ? "Restante em quantas parcelas" : "Nº de parcelas"}>
                  <Input type="number" inputMode="numeric" step="1" min="1" value={installmentsCount} onChange={(e) => setInstallmentsCount(e.target.value)} className="h-9" />
                </CampoDeFormulario>
                {numeroBR(entrada) > 0 ? (
                  <CampoDeFormulario rotulo="1ª parcela em">
                    <Input type="date" value={primeiraParcela} onChange={(e) => setPrimeiraParcela(e.target.value)} className="h-9" />
                  </CampoDeFormulario>
                ) : (
                  <CampoDeFormulario rotulo="1ª data">
                    <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} className="h-9" />
                  </CampoDeFormulario>
                )}
              </>
            ) : (
              <CampoDeFormulario rotulo="Data do pagamento">
                <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} className="h-9" />
              </CampoDeFormulario>
            )}

            <label className="flex min-w-0 cursor-pointer items-center sm:col-span-full">
              <input type="checkbox" checked={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.checked)} className="mr-2.5 h-4 w-4 shrink-0 accent-primary" />
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block font-medium")}>{paymentMode === "parcelado" ? "Parcelas já pagas" : "Já foi pago"}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{paymentMode === "parcelado" ? "Para lançar um plano que já está andando." : "Marca a entrada como recebida no fluxo de caixa."}</span>
              </span>
            </label>

            {alreadyPaid && paymentMode === "parcelado" && (
              <CampoDeFormulario rotulo="Quantas já foram pagas" apoio={`de ${installmentsCount}`}>
                <Input type="number" inputMode="numeric" step="1" min="0" max={installmentsCount} value={paidInstallments} onChange={(e) => setPaidInstallments(e.target.value)} className="h-9" />
              </CampoDeFormulario>
            )}
          </GrupoDeCampos>

          <GrupoDeCampos titulo="Depois da entrega" className="border-t border-border pt-4">
            <label className="flex min-w-0 cursor-pointer items-center sm:col-span-full">
              <input type="checkbox" checked={temSuporte} onChange={(e) => setTemSuporte(e.target.checked)} className="mr-2.5 h-4 w-4 shrink-0 accent-primary" data-tem-suporte="" />
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block font-medium")}>Tem suporte mensal</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>Vira uma mensalidade do cliente, em Extras e produtos.</span>
              </span>
            </label>
            {temSuporte && (
              <>
                <CampoDeFormulario rotulo="Valor por mês (R$)" obrigatorio>
                  <Input inputMode="decimal" value={suporteValor} onChange={(e) => setSuporteValor(e.target.value)} className="h-9" placeholder="0,00" />
                </CampoDeFormulario>
                <div className="min-w-0">
                  <p className={juntar(texto.rotulo, "mb-1.5")}>Começa</p>
                  <SeletorCompacto opcoes={[{ valor: "entrega", rotulo: "Depois da entrega" }, { valor: "data", rotulo: "Numa data" }]} valor={suporteDepoisDaEntrega ? "entrega" : "data"} onEscolher={(v) => setSuporteDepoisDaEntrega(v === "entrega")} rotulo="Quando o suporte começa" larguraTotal />
                </div>
                {!suporteDepoisDaEntrega && (
                  <CampoDeFormulario rotulo="Primeira mensalidade em">
                    <Input type="date" value={suporteInicio} onChange={(e) => setSuporteInicio(e.target.value)} className="h-9" />
                  </CampoDeFormulario>
                )}
                <label className="flex min-w-0 cursor-pointer items-center sm:col-span-full">
                  <input type="checkbox" checked={temAfiliado} onChange={(e) => setTemAfiliado(e.target.checked)} className="mr-2.5 h-4 w-4 shrink-0 accent-primary" data-tem-afiliado="" />
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block font-medium")}>Veio por indicação</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>Cada mensalidade paga gera o repasse em Despesas.</span>
                  </span>
                </label>
                {temAfiliado && (
                  <>
                    <CampoDeFormulario rotulo="Quem indicou" obrigatorio>
                      <Input value={afiliadoNome} onChange={(e) => setAfiliadoNome(e.target.value)} className="h-9" placeholder="Nome" />
                    </CampoDeFormulario>
                    <CampoDeFormulario rotulo="Repasse (%)" obrigatorio apoio={numeroBR(afiliadoPct) > 0 && numeroBR(suporteValor) > 0 ? `R$ ${(Math.round(numeroBR(suporteValor) * numeroBR(afiliadoPct)) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} por mês` : undefined}>
                      <Input inputMode="decimal" value={afiliadoPct} onChange={(e) => setAfiliadoPct(e.target.value)} className="h-9" placeholder="Ex.: 10" />
                    </CampoDeFormulario>
                  </>
                )}
              </>
            )}
          </GrupoDeCampos>

          {resumoDoPagamento && (
            <p className={juntar(superficie.poco, texto.auxiliar, "px-3 py-2")}>{resumoDoPagamento}</p>
          )}

          <div className="flex min-w-0 items-center justify-end border-t border-border pt-4 [&>*+*]:ml-2">
            <button type="button" onClick={onClose} className={botao.secundario}>
              Cancelar
            </button>
            <button type="button" onClick={handleSave} className={botao.primario}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {saving ? "Registrando..." : "Registrar entrada"}
            </button>
          </div>
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}
