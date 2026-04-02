import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useProjectPayments, usePaymentInstallments } from "@/hooks/usePayments";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
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
  const isAdmin = profile?.role === "admin";
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
          due_date: new Date().toISOString().split("T")[0],
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
          due_date: dueDate.toISOString().split("T")[0],
          status: "pending",
          description: count === 1 ? "Pagamento na entrega" : `Parcela ${i}/${count}`,
          paid_amount: 0,
        });
      }

      const { error: instError } = await supabase.from("payment_installments").insert(installmentRows);
      if (instError) throw instError;

      queryClient.invalidateQueries({ queryKey: ["project-payments"] });
      queryClient.invalidateQueries({ queryKey: ["payment-installments"] });
      toast({ title: "Plano de pagamento criado!" });
      setCreateOpen(false);
      resetForm();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const handleEdit = async () => {
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
          due_date: new Date().toISOString().split("T")[0],
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
          due_date: dueDate.toISOString().split("T")[0],
          status: "pending",
          description: count === 1 ? "Pagamento na entrega" : `Parcela ${i}/${count}`,
          paid_amount: 0,
        });
      }

      const { error: instError } = await supabase.from("payment_installments").insert(installmentRows);
      if (instError) throw instError;

      queryClient.invalidateQueries({ queryKey: ["project-payments"] });
      queryClient.invalidateQueries({ queryKey: ["payment-installments"] });
      toast({ title: "Plano de pagamento atualizado!" });
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
    setEditInstPaidDate(inst.paid_date || new Date().toISOString().split("T")[0]);
    setEditInstOpen(true);
  };

  const handleEditInstallment = async () => {
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
        updateData.paid_date = editInstPaidDate || new Date().toISOString().split("T")[0];
      } else {
        updateData.paid_date = null;
      }

      await supabase
        .from("payment_installments")
        .update(updateData)
        .eq("id", editingInst.id);

      queryClient.invalidateQueries({ queryKey: ["payment-installments"] });
      toast({ title: "Parcela atualizada!" });
      setEditInstOpen(false);
      setEditingInst(null);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const openEditDialog = () => {
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

  if (loadingPayment) return <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>;

  if (!payment) {
    return (
      <div className="text-center py-12 space-y-4">
        <DollarSign className="w-8 h-8 text-muted-foreground/50 mx-auto" />
        <p className="text-sm text-muted-foreground">Nenhum plano de pagamento configurado.</p>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="w-3.5 h-3.5" /> Criar Plano de Pagamento
          </Button>
        )}
        {renderCreateDialog()}
      </div>
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
    <div className="space-y-6">
      {/* Project link */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2 text-xs text-primary">
        <span className="font-medium">Projeto:</span> {projectName}
      </div>

      {/* Summary card */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor Total</p>
            <p className="text-xl font-semibold text-foreground">{formatCurrency(payment.total_value)}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Pago</p>
              <p className="text-xl font-semibold text-success">{formatCurrency(paidTotal)}</p>
            </div>
            {isAdmin && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={openEditDialog}>
                <Pencil className="w-3.5 h-3.5" /> Editar
              </Button>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>Progresso</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-success transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span>Entrada: {payment.entry_percentage}% ({formatCurrency(payment.entry_amount)})</span>
          <span>•</span>
          <span>{payment.installments_count}x restante</span>
          <span>•</span>
          <span className="text-foreground font-medium">Falta: {formatCurrency(payment.total_value - paidTotal)}</span>
        </div>
        {payment.notes && <p className="text-xs text-muted-foreground italic">{payment.notes}</p>}
      </div>

      {/* Installments */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Parcelas</p>
        {loadingInstallments ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : (
          (installments || []).map((inst: any) => {
            const status = getInstallmentStatus(inst);
            const config = statusConfig[status];
            const Icon = config.icon;
            const paidAmt = Number(inst.paid_amount || 0);
            const isPartial = inst.status === "partial" || (paidAmt > 0 && paidAmt < inst.amount);
            return (
              <div key={inst.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${config.className}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{inst.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Vencimento: {formatDate(inst.due_date)}
                    {inst.paid_date && ` • Pago em ${formatDate(inst.paid_date)}`}
                  </p>
                  {isPartial && paidAmt > 0 && (
                    <p className="text-xs text-primary">
                      Pago parcial: {formatCurrency(paidAmt)} de {formatCurrency(inst.amount)}
                    </p>
                  )}
                </div>
                <p className="text-sm font-semibold text-foreground whitespace-nowrap">{formatCurrency(inst.amount)}</p>
                <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${config.className}`}>{config.label}</span>
                {isAdmin && (
                  <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => openEditInstallment(inst)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Edit installment dialog */}
      <Dialog open={editInstOpen} onOpenChange={setEditInstOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Editar Parcela</DialogTitle></DialogHeader>
          {editingInst && (
            <div className="space-y-4">
              <div className="bg-secondary/50 rounded-lg p-3 text-xs space-y-1">
                <p><strong>{editingInst.description}</strong></p>
                <p>Valor: {formatCurrency(editingInst.amount)}</p>
                <p>Vencimento: {formatDate(editingInst.due_date)}</p>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
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
                <Label className="text-xs">Valor Pago (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder={String(editingInst.amount)}
                  value={editInstPaidAmount}
                  onChange={e => setEditInstPaidAmount(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Deixe menor que {formatCurrency(editingInst.amount)} para pagamento parcial
                </p>
              </div>
              {(editInstStatus === "paid" || editInstStatus === "partial") && (
                <div>
                  <Label className="text-xs">Data do Pagamento</Label>
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
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>Criar Plano de Pagamento</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Valor Total do Projeto (R$)</Label>
              <Input type="number" placeholder="5000" value={totalValue} onChange={e => setTotalValue(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Percentual de Entrada (%)</Label>
              <Input type="number" min="0" max="100" placeholder="50" value={entryPercentage} onChange={e => setEntryPercentage(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Número de Parcelas (restante)</Label>
              <Input type="number" min="1" max="24" placeholder="1" value={installmentsCount} onChange={e => setInstallmentsCount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea placeholder="Ex: Pagamento na entrega do projeto" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
            {total > 0 && (
              <div className="bg-secondary/50 rounded-lg p-3 space-y-1 text-xs">
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
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>Editar Plano de Pagamento</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">⚠️ Ao salvar, as parcelas serão recriadas e o status de pagamento anterior será resetado.</p>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Valor Total do Projeto (R$)</Label>
              <Input type="number" placeholder="5000" value={totalValue} onChange={e => setTotalValue(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Percentual de Entrada (%)</Label>
              <Input type="number" min="0" max="100" placeholder="50" value={entryPercentage} onChange={e => setEntryPercentage(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Número de Parcelas (restante)</Label>
              <Input type="number" min="1" max="24" placeholder="1" value={installmentsCount} onChange={e => setInstallmentsCount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea placeholder="Ex: Pagamento na entrega do projeto" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
            {total > 0 && (
              <div className="bg-secondary/50 rounded-lg p-3 space-y-1 text-xs">
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
