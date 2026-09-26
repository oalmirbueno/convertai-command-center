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
  normalizeMoney,
  splitAmount,
} from "@/lib/paymentInstallments";
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
    if (!clientId) { setExistingProjects([]); return; }
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name, project_type, billing_mode")
        .eq("client_id", clientId)
        .eq("billing_mode", "one_off")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      setExistingProjects(data || []);
    })();
  }, [clientId]);

  const reset = () => {
    setClientId(""); setProjectMode("new"); setExistingProjectId("");
    setProjectType("site"); setName(""); setDescription(""); setBrand("sitebolt");
    setGenerateTasks(true); setTotalValue(""); setPaymentMode("a_vista");
    setInstallmentsCount("2"); setFirstDueDate(format(new Date(), "yyyy-MM-dd"));
    setAlreadyPaid(false); setPaidInstallments("0");
  };

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

      const { data: paymentData, error: payErr } = await supabase
        .from("project_payments")
        .insert({
          project_id: projectId,
          client_id: clientId,
          total_value: total,
          entry_percentage: 0,
          entry_amount: 0,
          installments_count: iCount,
          created_by: user?.id,
        } as any)
        .select()
        .single();
      if (payErr) throw payErr;
      createdPaymentId = paymentData.id;

      const instRows = buildPaymentInstallments({
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

      toast.success("Entrada avulsa registrada");
      await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ["all-project-payments-finance"] }),
        qc.invalidateQueries({ queryKey: ["project_payments"] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["clients"] }),
        qc.invalidateQueries({ queryKey: ["expenses"] }),
        qc.invalidateQueries({ queryKey: ["billing"] }),
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
          const amounts = splitAmount(
            normalizedPreviewTotal,
            Math.max(parseInt(installmentsCount) || 1, 1),
          );
          const regular = amounts[0];
          const last = amounts[amounts.length - 1];
          return <>
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
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={campo}>
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
                <CampoDeFormulario rotulo="Nº de parcelas">
                  <Input type="number" inputMode="numeric" step="1" min="2" value={installmentsCount} onChange={(e) => setInstallmentsCount(e.target.value)} className="h-9" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="1ª data">
                  <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} className="h-9" />
                </CampoDeFormulario>
              </>
            ) : (
              <CampoDeFormulario rotulo="Data do pagamento">
                <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} className="h-9" />
              </CampoDeFormulario>
            )}

            <label className="flex min-w-0 cursor-pointer items-center sm:col-span-full">
              <input type="checkbox" checked={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.checked)} className="mr-2.5 h-4 w-4 shrink-0 accent-primary" />
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block font-medium")}>Já foi pago</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>Marca a entrada como recebida no fluxo de caixa.</span>
              </span>
            </label>

            {alreadyPaid && paymentMode === "parcelado" && (
              <CampoDeFormulario rotulo="Parcelas já pagas" apoio={`de ${installmentsCount}`}>
                <Input type="number" inputMode="numeric" step="1" min="0" max={installmentsCount} value={paidInstallments} onChange={(e) => setPaidInstallments(e.target.value)} className="h-9" />
              </CampoDeFormulario>
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
