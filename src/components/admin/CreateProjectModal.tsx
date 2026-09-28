import { useState, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate, notifyOpsProject } from "@/lib/opsSync";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useClients, useTeamMembers } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AjudaRecolhida, CampoDeEscolha, CampoDeFormulario, SeletorCompacto, botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import { projectTemplates } from "@/lib/projectTemplates";

const PROJECT_TYPES = [
  { value: "social_media", label: "Social Media" },
  { value: "trafego", label: "Tráfego" },
  { value: "automation", label: "Automação" },
  { value: "site", label: "Site" },
  { value: "landing_page", label: "Landing Page" },
  { value: "event", label: "Evento" },
  { value: "other", label: "Outro" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  editProject?: any;
  /** Abrir já com o cliente escolhido (ex.: "Novo projeto" de dentro do cadastro). */
  defaultClientId?: string;
}

export default function CreateProjectModal({ open, onClose, editProject, defaultClientId }: Props) {
  const { user } = useAuth();
  const { data: clients } = useClients();
  const { data: teamMembers } = useTeamMembers();

  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [useTemplates, setUseTemplates] = useState(true);

  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState("other");
  const [billingMode, setBillingMode] = useState<"included" | "one_off">("included");
  const [brand, setBrand] = useState<"aceleriq" | "sitebolt" | "">("");
  const [totalValue, setTotalValue] = useState("");
  const [entryPct, setEntryPct] = useState("50");
  const [installmentsCount, setInstallmentsCount] = useState("1");
  // "create" = gerar plano agora | "already" = já cobrado/lançado fora | "none" = sem cobrança neste projeto
  const [financialMode, setFinancialMode] = useState<"create" | "already" | "none">("create");
  const [startDate, setStartDate] = useState<Date | undefined>(new Date());
  const [deadline, setDeadline] = useState<Date | undefined>(undefined);
  const [scope, setScope] = useState("");
  const [objectives, setObjectives] = useState("");

  // Resolve dados do cliente selecionado para enriquecer o context do Ops
  const selectedClient = useMemo(
    () => (clients || []).find((c: any) => c.id === clientId),
    [clients, clientId]
  );

  const buildOpsContext = () => ({
    client_email: selectedClient?.email ?? null,
    client_full_name: selectedClient?.full_name ?? null,
    client_company: selectedClient?.company_name ?? null,
    client_phone: selectedClient?.phone ?? null,
    client_plan: selectedClient?.plan_name ?? null,
  });

  // De dentro do cadastro do cliente, o projeto nasce dele: sem escolher
  // cliente numa lista de trinta.
  useEffect(() => {
    if (open && !editProject && defaultClientId) setClientId(defaultClientId);
  }, [open, editProject, defaultClientId]);

  useEffect(() => {
    if (editProject) {
      setClientId(editProject.client_id || "");
      setName(editProject.name || "");
      setDescription(editProject.description || "");
      setProjectType(editProject.project_type || "other");
      setBillingMode(editProject.billing_mode || "included");
      setBrand(editProject.brand || "");
      setTotalValue(editProject.total_value != null ? String(editProject.total_value) : "");
      setStartDate(editProject.start_date ? new Date(editProject.start_date) : new Date());
      setDeadline(editProject.deadline ? new Date(editProject.deadline) : undefined);
      setScope(editProject.scope || "");
      setObjectives(editProject.objectives || "");
      // Detecta modo financeiro atual pelo plano existente
      (async () => {
        const { data: existing } = await supabase
          .from("project_payments")
          .select("id, entry_percentage, installments_count")
          .eq("project_id", editProject.id)
          .maybeSingle();
        if (existing) {
          setFinancialMode("create");
          setEntryPct(String(existing.entry_percentage ?? "50"));
          setInstallmentsCount(String(existing.installments_count ?? "1"));
        } else {
          setFinancialMode(editProject.total_value ? "already" : "none");
        }
      })();
    } else {
      setClientId("");
      setName("");
      setDescription("");
      setProjectType("other");
      setBillingMode("included");
      setBrand("");
      setTotalValue("");
      setEntryPct("50");
      setInstallmentsCount("1");
      setFinancialMode("create");
      setStartDate(new Date());
      setDeadline(undefined);
      setScope("");
      setObjectives("");
    }
  }, [editProject]);


  if (!open) return null;

  const isEdit = !!editProject;

  const handleSave = async () => {
    if (!clientId || !name.trim()) {
      toast.error("Selecione o cliente e informe o nome do projeto");
      return;
    }
    if (!startDate || !deadline) {
      toast.error("Informe as datas de início e prazo");
      return;
    }

    if (billingMode === "one_off" && financialMode !== "none") {
      const total = parseFloat(totalValue);
      if (!total || total <= 0) {
        toast.error("Informe o valor total do projeto avulso");
        return;
      }
    }

    setSaving(true);
    try {
      const payload: any = {
        client_id: clientId,
        name: name.trim(),
        description: description.trim() || null,
        project_type: projectType,
        billing_mode: billingMode,
        brand: brand || null,
        total_value: billingMode === "one_off" && financialMode !== "none" ? parseFloat(totalValue) : null,
        start_date: format(startDate, "yyyy-MM-dd"),
        deadline: format(deadline, "yyyy-MM-dd"),
        scope: scope.trim() || null,
        objectives: objectives.trim() || null,
        ...(isEdit ? {} : { created_by: user?.id, status: "planning", progress: 0 }),
      };

      if (isEdit) {
        const { error } = await supabase.from("projects").update(payload).eq("id", editProject.id);
        if (error) throw error;

        // Sincroniza plano financeiro do projeto para evitar duplicidade
        try {
          const { data: existingPlans } = await supabase
            .from("project_payments")
            .select("id")
            .eq("project_id", editProject.id);
          const planIds = (existingPlans || []).map((p: any) => p.id);

          const wipePlans = async () => {
            if (!planIds.length) return;
            await supabase.from("payment_installments").delete().in("payment_id", planIds);
            await supabase.from("project_payments").delete().in("id", planIds);
          };

          if (billingMode !== "one_off" || financialMode !== "create") {
            // "Já cobrado" ou "Sem cobrança" (ou virou recorrente): remove qualquer fatura gerada antes
            await wipePlans();
          } else {
            // "Gerar plano" no edit: recria plano só se valores mudaram ou não existe
            const total = parseFloat(totalValue);
            const ePct = parseFloat(entryPct) || 0;
            const iCount = parseInt(installmentsCount) || 1;
            await wipePlans();
            const entryAmount = (total * ePct) / 100;
            const remaining = total - entryAmount;
            const perInstallment = iCount > 0 ? remaining / iCount : 0;
            const { data: paymentData, error: payErr } = await supabase
              .from("project_payments")
              .insert({
                project_id: editProject.id,
                client_id: clientId,
                total_value: total,
                entry_percentage: ePct,
                entry_amount: entryAmount,
                installments_count: iCount,
                created_by: user?.id,
              } as any)
              .select().single();
            if (payErr) throw payErr;
            const today = format(new Date(), "yyyy-MM-dd");
            const instRows: any[] = [{
              payment_id: paymentData.id, installment_number: 0, amount: entryAmount,
              due_date: today, status: "pending", description: `Entrada (${ePct}%)`,
            }];
            for (let i = 1; i <= iCount; i++) {
              const d = new Date(); d.setMonth(d.getMonth() + i);
              instRows.push({
                payment_id: paymentData.id, installment_number: i, amount: perInstallment,
                due_date: format(d, "yyyy-MM-dd"), status: "pending",
                description: iCount === 1 ? "Pagamento na entrega" : `Parcela ${i}/${iCount}`,
              });
            }
            await supabase.from("payment_installments").insert(instRows);
          }
        } catch (e: any) {
          console.error("plan sync failed", e);
          toast.warning("Projeto salvo, mas falhou ao ajustar o plano financeiro.");
        }

        toast.success("Projeto atualizado!");

        // Notifica Ops via proxy server-to-server
        notifyOpsProject(
          { id: editProject.id, client_id: clientId, ...payload },
          buildOpsContext()
        );

      } else {
        const { data: newProject, error } = await supabase.from("projects").insert(payload).select().single();
        if (error) throw error;

        // ── Auto-create payment plan for one_off projects ──
        if (billingMode === "one_off" && financialMode === "create" && newProject) {
          try {
            const total = parseFloat(totalValue);
            const ePct = parseFloat(entryPct) || 0;
            const iCount = parseInt(installmentsCount) || 1;
            const entryAmount = (total * ePct) / 100;
            const remaining = total - entryAmount;
            const perInstallment = iCount > 0 ? remaining / iCount : 0;

            const { data: paymentData, error: payErr } = await supabase
              .from("project_payments")
              .insert({
                project_id: newProject.id,
                client_id: clientId,
                total_value: total,
                entry_percentage: ePct,
                entry_amount: entryAmount,
                installments_count: iCount,
                created_by: user?.id,
              } as any)
              .select().single();
            if (payErr) throw payErr;

            const today = format(new Date(), "yyyy-MM-dd");
            const instRows: any[] = [{
              payment_id: paymentData.id,
              installment_number: 0,
              amount: entryAmount,
              due_date: today,
              status: "pending",
              description: `Entrada (${ePct}%)`,
            }];
            for (let i = 1; i <= iCount; i++) {
              const d = new Date(); d.setMonth(d.getMonth() + i);
              instRows.push({
                payment_id: paymentData.id,
                installment_number: i,
                amount: perInstallment,
                due_date: format(d, "yyyy-MM-dd"),
                status: "pending",
                description: iCount === 1 ? "Pagamento na entrega" : `Parcela ${i}/${iCount}`,
              });
            }
            await supabase.from("payment_installments").insert(instRows);
            toast.success(`Plano de pagamento criado (entrada + ${iCount}x)`);
          } catch (e: any) {
            console.error("payment auto-create failed", e);
            toast.warning("Projeto criado, mas o plano de pagamento falhou. Configure manualmente.");
          }
        }



        // Create notification for client
        await supabase.from("notifications").insert({
          user_id: clientId,
          message: `Novo projeto criado: ${name.trim()}`,
          notification_type: "project",
          link: "/dashboard",
        });

        // Create system update
        if (newProject) {
          await supabase.from("updates").insert({
            project_id: newProject.id,
            author_id: user!.id,
            message: `Projeto "${name.trim()}" criado`,
            update_type: "system",
          });

          // Notifica o Ops via proxy server-to-server (evita CORS/CSP)
          notifyOpsProject(
            {
              id: newProject.id,
              client_id: clientId,
              name: name.trim(),
              description: description || null,
              project_type: projectType,
              status: "planning",
              progress: 0,
              start_date: startDate?.toISOString() ?? null,
              deadline: deadline?.toISOString() ?? null,
            },
            buildOpsContext()
          );

          // Auto-generate milestones & tasks from templates
          if (useTemplates && projectTemplates[projectType]) {
            const templates = projectTemplates[projectType];
            const projectStartDate = startDate || new Date();

            // Find team members by role for auto-assignment
            const roleMap: Record<string, string | null> = {};
            for (const member of (teamMembers || [])) {
              if (!roleMap[member.role]) {
                roleMap[member.role] = member.id;
              }
            }
            // Admin is the current user as fallback
            if (!roleMap["admin"]) roleMap["admin"] = user!.id;

            const maxMilestones = templates.length;
            for (let mIdx = 0; mIdx < maxMilestones; mIdx++) {
              const tmpl = templates[mIdx];
              const targetDate = format(addDays(projectStartDate, tmpl.offsetDays), "yyyy-MM-dd");

              const { data: milestone } = await supabase.from("milestones").insert({
                project_id: newProject.id,
                title: tmpl.title,
                target_date: targetDate,
                status: "pending",
                milestone_order: mIdx + 1,
              }).select().single();
              notifyOpsMilestone(milestone);

              if (milestone) {
                const taskInserts = tmpl.tasks.map((t, tIdx) => ({
                  project_id: newProject.id,
                  milestone_id: milestone.id,
                  title: t.title,
                  description: t.description || null,
                  priority: t.priority,
                  assigned_to: roleMap[t.role] || null,
                  status: "backlog" as string,
                  task_order: tIdx + 1,
                }));
                await supabase.from("tasks").insert(taskInserts);
              }
            }
          }
        }

        toast.success("Projeto criado com sucesso!");
      }

      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["updates"] });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar projeto");
    } finally {
      setSaving(false);
    }
  };

  const valorTotal = parseFloat(totalValue);
  const entrada = parseFloat(entryPct || "0");
  const parcelas = Math.max(parseInt(installmentsCount) || 1, 1);
  const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  const botaoDeData = (vazio: boolean) => juntar(campo, "flex items-center text-left hover:border-primary/50", vazio && "text-muted-foreground");

  return (
    // Janela do sistema (Dialog): foco preso, Esc fecha, rola por dentro e as
    // ações ficam presas no pé. Explicações no "?" (SISTEMA.md seção 5).
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-[520px] flex-col overflow-hidden border-border bg-card p-0">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className={juntar(texto.tituloSecao, "truncate pr-8")}>{isEdit ? "Editar Projeto" : "Novo Projeto"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
          <CampoDeFormulario rotulo="Cliente" obrigatorio>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={campo}>
              <option value="">Selecionar cliente...</option>
              {(clients || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
              ))}
            </select>
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Nome do projeto" obrigatorio>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Social Media 2026" className={campo} />
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Descrição">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Descrição breve do projeto" className={juntar(campoTexto, "resize-none")} />
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Tipo">
            <select value={projectType} onChange={(e) => setProjectType(e.target.value)} className={campo}>
              {PROJECT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </CampoDeFormulario>

          {/* Cobrança + Brand */}
          <div className="grid grid-cols-2 gap-4">
            <CampoDeEscolha rotulo="Cobrança">
              <SeletorCompacto
                rotulo="Cobrança"
                modo="segmentado"
                larguraTotal
                opcoes={[
                  { valor: "included", rotulo: "Plano" },
                  { valor: "one_off", rotulo: "Avulso" },
                ]}
                valor={billingMode}
                onEscolher={(v) => setBillingMode(v as "included" | "one_off")}
              />
            </CampoDeEscolha>
            <CampoDeFormulario rotulo="Brand">
              <select value={brand} onChange={(e) => setBrand(e.target.value as any)} className={campo}>
                <option value="">- Definir depois -</option>
                <option value="aceleriq">AcelerIQ</option>
                <option value="sitebolt">SiteBolt</option>
              </select>
            </CampoDeFormulario>
          </div>

          {/* Financeiro do projeto avulso: grupo aberto (sem caixa), separado por uma linha fina. */}
          {billingMode === "one_off" && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex min-w-0 items-center">
                <p className={juntar(texto.rotulo, "min-w-0 truncate text-foreground")}>Financeiro do projeto</p>
                <AjudaRecolhida className="ml-1.5" rotulo="Sobre o financeiro do projeto">
                  Evita duplicar lançamento. Gerar plano cria a entrada e as parcelas. Já cobrado guarda o valor só como
                  referência, sem fatura nova: use quando a cobrança já foi lançada no cadastro do cliente ou fora do
                  sistema. Sem cobrança é para cortesia, bônus ou trabalho interno.
                </AjudaRecolhida>
              </div>

              <SeletorCompacto
                rotulo="Modo financeiro"
                modo="segmentado"
                larguraTotal
                opcoes={[
                  { valor: "create", rotulo: "Gerar plano" },
                  { valor: "already", rotulo: "Já cobrado" },
                  { valor: "none", rotulo: "Sem cobrança" },
                ]}
                valor={financialMode}
                onEscolher={(v) => setFinancialMode(v as "create" | "already" | "none")}
              />

              {financialMode !== "none" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <CampoDeFormulario rotulo="Valor total" obrigatorio>
                    <input value={totalValue} onChange={(e) => setTotalValue(e.target.value)} type="number" step="0.01" placeholder="0,00" className={campo} />
                  </CampoDeFormulario>
                  {financialMode === "create" && (
                    <>
                      <CampoDeFormulario rotulo="Entrada %">
                        <input value={entryPct} onChange={(e) => setEntryPct(e.target.value)} type="number" step="1" min="0" max="100" className={campo} />
                      </CampoDeFormulario>
                      <CampoDeFormulario rotulo="Parcelas">
                        <input value={installmentsCount} onChange={(e) => setInstallmentsCount(e.target.value)} type="number" step="1" min="1" className={campo} />
                      </CampoDeFormulario>
                    </>
                  )}
                </div>
              )}

              {financialMode === "create" && totalValue && valorTotal > 0 && (
                <p className={juntar(texto.auxiliar, "truncate tabular-nums")}>
                  Entrada: <span className="text-foreground">R$ {reais((valorTotal * entrada) / 100)}</span>
                  {" · "}
                  {installmentsCount}× de <span className="text-foreground">R$ {reais((valorTotal * (100 - entrada)) / 100 / parcelas)}</span>
                </p>
              )}
            </div>
          )}

          {!isEdit && projectTemplates[projectType] && (
            <label className="flex min-w-0 cursor-pointer items-start">
              <input type="checkbox" checked={useTemplates} onChange={(e) => setUseTemplates(e.target.checked)} className="mr-2.5 mt-0.5 h-4 w-4 shrink-0 accent-primary" />
              <span className="min-w-0">
                <span className={juntar(texto.corpo, "block font-medium")}>Gerar milestones e tarefas automaticamente</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {projectTemplates[projectType].length} milestones · {projectTemplates[projectType].reduce((sum, m) => sum + m.tasks.length, 0)} tarefas, atribuídas por função
                </span>
              </span>
            </label>
          )}

          <div className="grid grid-cols-2 gap-4">
            <CampoDeEscolha rotulo="Data início">
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className={botaoDeData(!startDate)}>
                    <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {startDate ? format(startDate, "dd/MM/yyyy") : "Selecionar"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={startDate} onSelect={setStartDate} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </CampoDeEscolha>
            <CampoDeEscolha rotulo="Prazo final">
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className={botaoDeData(!deadline)}>
                    <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {deadline ? format(deadline, "dd/MM/yyyy") : "Selecionar"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={deadline} onSelect={setDeadline} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </CampoDeEscolha>
          </div>

          <CampoDeFormulario rotulo="Escopo">
            <textarea value={scope} onChange={(e) => setScope(e.target.value)} rows={2} placeholder="Detalhes do escopo..." className={juntar(campoTexto, "resize-none")} />
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Objetivos" apoio="Um por linha">
            <textarea value={objectives} onChange={(e) => setObjectives(e.target.value)} rows={3} placeholder={"Objetivo 1\nObjetivo 2"} className={juntar(campoTexto, "resize-none")} />
          </CampoDeFormulario>
        </div>

        <div className="flex shrink-0 items-center justify-end border-t border-border px-5 py-3 [&>*+*]:ml-2">
          <button type="button" onClick={onClose} disabled={saving} className={botao.secundario}>
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className={botao.primario}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {saving ? "Salvando..." : isEdit ? "Salvar" : "Criar Projeto"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
