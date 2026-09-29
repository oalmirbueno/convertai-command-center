import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import { useProjectPayments, usePaymentInstallments } from "@/hooks/usePayments";
import { supabase } from "@/integrations/supabase/client";
import { todayBR, toBRDateKey } from "@/lib/dateBR";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Carregando, EstadoVazio, Painel, Secao, botao, etiqueta, juntar, lista, superficie, texto } from "@/components/sistema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DollarSign, CheckCircle2, Clock, AlertCircle, Plus, Pencil } from "lucide-react";

const statusConfig: Record<string, { icon: any; className: string; label: string }> = {
  paid: { icon: CheckCircle2, className: "text-success bg-success/10", label: "Pago" },
  partial: { icon: Clock, className: "text-primary bg-primary/10", label: "Parcial" },
  pending: { icon: Clock, className: "text-warning bg-warning/10", label: "Pendente" },
  overdue: { icon: AlertCircle, className: "text-destructive bg-destructive/10", label: "Atrasado" },
};

interface TabPaymentsProps {
  projectId: string;
  clientId: string;
  projectName: string;
}

export default function TabPayments({ projectId, clientId, projectName }: TabPaymentsProps) {
  const { profile } = useAuth();
  const { isImpersonating } = useClientIdentity();
  const isAdmin = profile?.role === "admin" && !isImpersonating;
  const { data: payment, isLoading: loadingPayment } = useProjectPayments(projectId);
  const { data: installments, isLoading: loadingInstallments } = usePaymentInstallments(payment?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Plan create/edit state
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [totalValue, setTotalValue] = useState("");
  const [entryPercentage, setEntryPercentage] = useState("50");
  const [installmentsCount, setInstallmentsCount] = useState("1");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Installment edit state
  const [editInstOpen, setEditInstOpen] = useState(false);
  const [editingInst, setEditingInst] = useState<any>(null);
  const [editInstStatus, setEditInstStatus] = useState("pending");
  const [editInstPaidAmount, setEditInstPaidAmount] = useState("");
  const [editInstPaidDate, setEditInstPaidDate] = useState("");

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

  const getInstallmentStatus = (inst: any) => {
    if (inst.status === "paid") return "paid";
    if (inst.status === "partial") return "partial";
    if (inst.due_date && new Date(inst.due_date) < new Date()) return "overdue";
    return "pending";
  };

  const handleCreate = async () => {
    if (!isAdmin) {
      toast({ title: "Somente leitura", description: "Nenhuma alteração pode ser feita neste modo.", variant: "destructive" });
      return;
    }
    const total = parseFloat(totalValue);
    const entryPct = parseFloat(entryPercentage);
    const count = parseInt(installmentsCount);
    if (!total || isNaN(entryPct) || !count) return;

    setSubmitting(true);
    try {
      const entryAmount = (total * entryPct) / 100;
      const remaining = total - entryAmount;
      const perInstallment = count > 0 ? remaining / count : 0;

      const { data: paymentData, error: paymentError } = await supabase
        .from("project_payments")
        .insert({
          project_id: projectId,
          client_id: clientId,
          total_value: total,
          entry_percentage: entryPct,
          entry_amount: entryAmount,
          installments_count: count,
          notes: notes.trim() || null,
          created_by: profile?.id,
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      const installmentRows: any[] = [
        {
          payment_id: paymentData.id,
          installment_number: 0,
          amount: entryAmount,
          due_date: todayBR(),
          status: "pending",
          description: `Entrada (${entryPct}%)`,
          paid_amount: 0,
        },
      ];

      for (let i = 1; i <= count; i++) {
        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() + i);
        installmentRows.push({
          payment_id: paymentData.id,
          installment_number: i,
          amount: perInstallment,
          due_date: toBRDateKey(dueDate),
          status: "pending",
          description: count === 1 ? "Pagamento na entrega" : `Parcela ${i}/${count}`,
          paid_amount: 0,
        });
      }

      const { error: instError } = await supabase.from("payment_installments").insert(installmentRows);
      if (instError) throw instError;

      queryClient.invalidateQueries({ queryKey: ["project-payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
      queryClient.invalidateQueries({ queryKey: ["payment-installments"] });
      toast({ title: "Plano de pagamento criado" });
      setCreateOpen(false);
      resetForm();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const handleEdit = async () => {
    if (!isAdmin) {
      toast({ title: "Somente leitura", description: "Nenhuma alteração pode ser feita neste modo.", variant: "destructive" });
      return;
    }
    const total = parseFloat(totalValue);
    const entryPct = parseFloat(entryPercentage);
    const count = parseInt(installmentsCount);
    if (!total || isNaN(entryPct) || !count || !payment) return;

    setSubmitting(true);
    try {
      const entryAmount = (total * entryPct) / 100;
      const remaining = total - entryAmount;
      const perInstallment = count > 0 ? remaining / count : 0;

      const { error: paymentError } = await supabase
        .from("project_payments")
        .update({
          total_value: total,
          entry_percentage: entryPct,
          entry_amount: entryAmount,
          installments_count: count,
          notes: notes.trim() || null,
        })
        .eq("id", payment.id);

      if (paymentError) throw paymentError;

      await supabase.from("payment_installments").delete().eq("payment_id", payment.id);

      const installmentRows: any[] = [
        {
          payment_id: payment.id,
          installment_number: 0,
          amount: entryAmount,
          due_date: todayBR(),
          status: "pending",
          description: `Entrada (${entryPct}%)`,
          paid_amount: 0,
        },
      ];

      for (let i = 1; i <= count; i++) {
        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() + i);
        installmentRows.push({
          payment_id: payment.id,
          installment_number: i,
          amount: perInstallment,
          due_date: toBRDateKey(dueDate),
          status: "pending",
          description: count === 1 ? "Pagamento na entrega" : `Parcela ${i}/${count}`,
          paid_amount: 0,
        });
      }

      const { error: instError } = await supabase.from("payment_installments").insert(installmentRows);
      if (instError) throw instError;

      queryClient.invalidateQueries({ queryKey: ["project-payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
      queryClient.invalidateQueries({ queryKey: ["payment-installments"] });
      toast({ title: "Plano de pagamento atualizado" });
      setEditOpen(false);
      resetForm();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const openEditInstallment = (inst: any) => {
    setEditingInst(inst);
    setEditInstStatus(inst.status);
    setEditInstPaidAmount(String(inst.paid_amount || 0));
    setEditInstPaidDate(inst.paid_date || todayBR());
    setEditInstOpen(true);
  };

  const handleEditInstallment = async () => {
    if (!isAdmin) {
      toast({ title: "Somente leitura", description: "Nenhuma alteração pode ser feita neste modo.", variant: "destructive" });
      return;
    }
    if (!editingInst) return;
    setSubmitting(true);
    try {
      const paidAmt = parseFloat(editInstPaidAmount) || 0;
      let newStatus = editInstStatus;

      // Auto-detect status based on paid amount
      if (newStatus === "paid" && paidAmt < editingInst.amount && paidAmt > 0) {
        newStatus = "partial";
      } else if (paidAmt >= editingInst.amount) {
        newStatus = "paid";
      } else if (paidAmt === 0 && newStatus !== "pending") {
        newStatus = "pending";
      }

      const updateData: any = {
        status: newStatus,
        paid_amount: paidAmt,
      };

      if (newStatus === "paid" || newStatus === "partial") {
        updateData.paid_date = editInstPaidDate || todayBR();
      } else {
        updateData.paid_date = null;
      }

      await supabase
        .from("payment_installments")
        .update(updateData)
        .eq("id", editingInst.id);

      queryClient.invalidateQueries({ queryKey: ["payment-installments"] });
      queryClient.invalidateQueries({ queryKey: ["project-payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-project-payments-finance"] });
      queryClient.invalidateQueries({ queryKey: ["payment-audit-log"] });
      toast({ title: "Parcela atualizada" });
      setEditInstOpen(false);
      setEditingInst(null);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const openEditDialog = () => {
    if (!isAdmin) return;
    if (payment) {
      setTotalValue(String(payment.total_value));
      setEntryPercentage(String(payment.entry_percentage));
      setInstallmentsCount(String(payment.installments_count));
      setNotes(payment.notes || "");
    }
    setEditOpen(true);
  };

  const resetForm = () => {
    setTotalValue("");
    setEntryPercentage("50");
    setInstallmentsCount("1");
    setNotes("");
  };

  if (loadingPayment) return <Carregando linhas={3} rotulo="Carregando pagamentos" />;

  if (!payment) {
    return (
      <>
        <EstadoVazio
          icone={<DollarSign className="h-5 w-5" />}
          titulo="Nenhum plano de pagamento configurado."
          acao={isAdmin && (
            <button type="button" onClick={() => setCreateOpen(true)} className={botao.primario}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Criar plano de pagamento
            </button>
          )}
        />
        {renderCreateDialog()}
      </>
    );
  }

  // Calculate paid total using paid_amount when available
  const paidTotal = (installments || []).reduce((sum: number, i: any) => {
    if (i.status === "paid") return sum + Number(i.amount);
    if (i.status === "partial") return sum + Number(i.paid_amount || 0);
    return sum;
  }, 0);
  const progressPct = payment.total_value > 0 ? Math.round((paidTotal / payment.total_value) * 100) : 0;

  return (
    <div className="min-w-0 space-y-6">
      {/* Resumo do plano: o valor é o assunto da aba, então fica em destaque */}
      <Painel
        titulo={`Plano de pagamento · ${projectName}`}
        acao={isAdmin && (
          <button type="button" className={botao.secundario} onClick={openEditDialog} aria-label="Editar plano">
            <Pencil className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Editar</span>
          </button>
        )}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <p className={texto.rotulo}>Valor total</p>
            <p className="text-[20px] font-semibold leading-7 tabular-nums text-foreground">{formatCurrency(payment.total_value)}</p>
          </div>
          <div className="min-w-0 text-right">
            <p className={texto.rotulo}>Pago</p>
            <p className="text-[20px] font-semibold leading-7 tabular-nums text-success">{formatCurrency(paidTotal)}</p>
          </div>
        </div>
        <div className="mt-4">
          <div className={juntar(texto.auxiliar, "mb-1.5 flex items-center justify-between")}>
            <span>Progresso</span>
            <span className="tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Pago do total">
            <div className="h-full rounded-full bg-success" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        <p className={juntar(texto.auxiliar, "mt-3 leading-5")}>
          Entrada: {payment.entry_percentage}% ({formatCurrency(payment.entry_amount)})
          <span className="mx-1.5" aria-hidden="true">·</span>
          {payment.installments_count}x restante
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span className="font-medium text-foreground">Falta: {formatCurrency(payment.total_value - paidTotal)}</span>
        </p>
        {payment.notes && <p className={juntar(texto.auxiliar, "mt-1 italic leading-5")}>{payment.notes}</p>}
      </Painel>

      {/* Parcelas: lista com divisória, valor e situação à direita */}
      <Secao titulo="Parcelas" descricao={installments && installments.length ? `${installments.length} no total` : undefined}>
        {loadingInstallments ? (
          <Carregando linhas={2} rotulo="Carregando parcelas" />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)}>
          {(installments || []).map((inst: any) => {
            const status = getInstallmentStatus(inst);
            const config = statusConfig[status];
            const Icon = config.icon;
            const paidAmt = Number(inst.paid_amount || 0);
            const isPartial = inst.status === "partial" || (paidAmt > 0 && paidAmt < inst.amount);
            return (
              <li key={inst.id} className="flex min-w-0 items-center px-2 py-3">
                <span className={`mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${config.className}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium leading-5 text-foreground">{inst.description}</p>
                  <p className={juntar(texto.auxiliar, "truncate")}>
                    Vencimento: {formatDate(inst.due_date)}
                    {inst.paid_date && ` · Pago em ${formatDate(inst.paid_date)}`}
                  </p>
                  {isPartial && paidAmt > 0 && (
                    <p className="text-[12px] text-primary">
                      Pago parcial: {formatCurrency(paidAmt)} de {formatCurrency(inst.amount)}
                    </p>
                  )}
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <p className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-foreground">{formatCurrency(inst.amount)}</p>
                  <span className={juntar(etiqueta, "mt-0.5", config.className)}>{config.label}</span>
                </div>
                {isAdmin && (
                  <button type="button" className={juntar(botao.icone, "ml-2")} onClick={() => openEditInstallment(inst)} aria-label={`Editar ${inst.description}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
          </ul>
        )}
      </Secao>

      {/* Edit installment dialog */}
      <Dialog open={isAdmin && editInstOpen} onOpenChange={setEditInstOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Editar Parcela</DialogTitle></DialogHeader>
          {editingInst && (
            <div className="space-y-4">
              <div className={juntar(superficie.poco, "space-y-1 p-3 text-[12px]")}>
                <p><strong>{editingInst.description}</strong></p>
                <p>Valor: {formatCurrency(editingInst.amount)}</p>
                <p>Vencimento: {formatDate(editingInst.due_date)}</p>
              </div>
              <div>
                <Label className="text-[12px]">Status</Label>
                <Select value={editInstStatus} onValueChange={setEditInstStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="partial">Parcial</SelectItem>
                    <SelectItem value="paid">Pago (total)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[12px]">Valor Pago (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder={String(editingInst.amount)}
                  value={editInstPaidAmount}
                  onChange={e => setEditInstPaidAmount(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Deixe menor que {formatCurrency(editingInst.amount)} para pagamento parcial
                </p>
              </div>
              {(editInstStatus === "paid" || editInstStatus === "partial") && (
                <div>
                  <Label className="text-[12px]">Data do Pagamento</Label>
                  <Input
                    type="date"
                    value={editInstPaidDate}
                    onChange={e => setEditInstPaidDate(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditInstOpen(false)}>Cancelar</Button>
            <Button onClick={handleEditInstallment} disabled={submitting}>
              {submitting ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {renderCreateDialog()}
      {renderEditDialog()}
    </div>
  );

  function renderCreateDialog() {
    const total = parseFloat(totalValue) || 0;
    const entryPct = parseFloat(entryPercentage) || 0;
    const count = parseInt(installmentsCount) || 1;
    const entryAmount = (total * entryPct) / 100;
    const remaining = total - entryAmount;
    const perInstallment = count > 0 ? remaining / count : 0;

    return (
      <Dialog open={isAdmin && createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>Criar Plano de Pagamento</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-[12px]">Valor Total do Projeto (R$)</Label>
              <Input type="number" placeholder="5000" value={totalValue} onChange={e => setTotalValue(e.target.value)} />
            </div>
            <div>
              <Label className="text-[12px]">Percentual de Entrada (%)</Label>
              <Input type="number" min="0" max="100" placeholder="50" value={entryPercentage} onChange={e => setEntryPercentage(e.target.value)} />
            </div>
            <div>
              <Label className="text-[12px]">Número de Parcelas (restante)</Label>
              <Input type="number" min="1" max="24" placeholder="1" value={installmentsCount} onChange={e => setInstallmentsCount(e.target.value)} />
            </div>
            <div>
              <Label className="text-[12px]">Observações</Label>
              <Textarea placeholder="Ex: Pagamento na entrega do projeto" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
            {total > 0 && (
              <div className={juntar(superficie.poco, "space-y-1 p-3 text-[12px]")}>
                <p><strong>Entrada:</strong> {formatCurrency(entryAmount)} ({entryPct}%)</p>
                <p><strong>Restante:</strong> {formatCurrency(remaining)} em {count}x de {formatCurrency(perInstallment)}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={submitting || !total}>
              {submitting ? "Criando..." : "Criar Plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  function renderEditDialog() {
    const total = parseFloat(totalValue) || 0;
    const entryPct = parseFloat(entryPercentage) || 0;
    const count = parseInt(installmentsCount) || 1;
    const entryAmount = (total * entryPct) / 100;
    const remaining = total - entryAmount;
    const perInstallment = count > 0 ? remaining / count : 0;

    return (
      <Dialog open={isAdmin && editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>Editar Plano de Pagamento</DialogTitle></DialogHeader>
          <p className="text-[12px] text-muted-foreground">⚠️ Ao salvar, as parcelas serão recriadas e o status de pagamento anterior será resetado.</p>
          <div className="space-y-4">
            <div>
              <Label className="text-[12px]">Valor Total do Projeto (R$)</Label>
              <Input type="number" placeholder="5000" value={totalValue} onChange={e => setTotalValue(e.target.value)} />
            </div>
            <div>
              <Label className="text-[12px]">Percentual de Entrada (%)</Label>
              <Input type="number" min="0" max="100" placeholder="50" value={entryPercentage} onChange={e => setEntryPercentage(e.target.value)} />
            </div>
            <div>
              <Label className="text-[12px]">Número de Parcelas (restante)</Label>
              <Input type="number" min="1" max="24" placeholder="1" value={installmentsCount} onChange={e => setInstallmentsCount(e.target.value)} />
            </div>
            <div>
              <Label className="text-[12px]">Observações</Label>
              <Textarea placeholder="Ex: Pagamento na entrega do projeto" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
            {total > 0 && (
              <div className={juntar(superficie.poco, "space-y-1 p-3 text-[12px]")}>
                <p><strong>Entrada:</strong> {formatCurrency(entryAmount)} ({entryPct}%)</p>
                <p><strong>Restante:</strong> {formatCurrency(remaining)} em {count}x de {formatCurrency(perInstallment)}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleEdit} disabled={submitting || !total || !entryPct}>
              {submitting ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
}
