import { useState } from "react";
import { Pencil, Plus, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useUpsertFixedCost } from "../api/useFinanceV2";
import {
  addMoney,
  formatCurrency,
  monthlyEquivalent,
  parseCurrencyInput,
} from "../lib/finance";
import type { FixedCost } from "../types";
import { Empty, Metric } from "./FinanceUi";

function Editor({
  item,
  close,
}: {
  item: FixedCost | null;
  close: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [amount, setAmount] = useState(String(item?.amount ?? ""));
  const [category, setCategory] = useState(item?.category ?? "Operacional");
  const [dueDay, setDueDay] = useState(item?.due_day ?? 10);
  const [frequency, setFrequency] = useState<FixedCost["frequency"]>(
    item?.frequency ?? "monthly",
  );
  const [active, setActive] = useState(item?.active ?? true);
  const save = useUpsertFixedCost();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            p_id: item?.id ?? null,
            p_name: name,
            p_amount: parseCurrencyInput(amount),
            p_category: category,
            p_due_day: Math.min(28, Math.max(1, dueDay)),
            p_frequency: frequency,
            p_active: active,
            p_currency: item?.currency ?? "BRL",
            p_starts_on:
              item?.starts_on ?? new Date().toISOString().slice(0, 10),
          },
          { onSuccess: close },
        );
      }}
    >
      <div className="space-y-1">
        <Label>Nome</Label>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Valor</Label>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Vencimento</Label>
          <Input
            type="number"
            min={1}
            max={28}
            value={dueDay}
            onChange={(event) => setDueDay(Number(event.target.value))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Categoria</Label>
          <Input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Frequência</Label>
          <Select
            value={frequency}
            onValueChange={(value) =>
              setFrequency(value as FixedCost["frequency"])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Mensal</SelectItem>
              <SelectItem value="quarterly">Trimestral</SelectItem>
              <SelectItem value="semiannual">Semestral</SelectItem>
              <SelectItem value="annual">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <Label>Ativo</Label>
        <Switch checked={active} onCheckedChange={setActive} />
      </div>
      <p className="text-xs text-muted-foreground">
        O template não gera saída de caixa; pagamentos continuam registrados
        separadamente.
      </p>
      {save.isError && (
        <p className="text-sm text-destructive">{save.error.message}</p>
      )}
      <Button className="w-full" disabled={!name || save.isPending}>
        {save.isPending ? "Salvando..." : "Salvar custo"}
      </Button>
    </form>
  );
}

export function FixedCostsTab({ items }: { items: FixedCost[] }) {
  const [editor, setEditor] = useState<
    FixedCost | null | undefined
  >(undefined);
  const active = items.filter((item) => item.active);
  const monthly = addMoney(...active.map(monthlyEquivalent));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-3">
          <Metric
            label="Custo mensal"
            value={formatCurrency(monthly)}
            icon={ReceiptText}
            tone="bad"
          />
          <Metric
            label="Itens ativos"
            value={String(active.length)}
            icon={ReceiptText}
          />
        </div>
        <Button onClick={() => setEditor(null)}>
          <Plus className="mr-2 size-4" />
          Novo custo
        </Button>
      </div>

      {!items.length ? (
        <Empty
          title="Nenhum custo fixo"
          description="Cadastre sistemas, equipe, aluguel e demais recorrências."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className={!item.active ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex justify-between">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.category} · dia {item.due_day}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditor(item)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
                <p className="mt-4 text-xl font-semibold">
                  {formatCurrency(item.amount, item.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.frequency} · equivalente{" "}
                  {formatCurrency(monthlyEquivalent(item))}/mês
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={editor !== undefined}
        onOpenChange={(open) => !open && setEditor(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor ? "Editar custo fixo" : "Novo custo fixo"}
            </DialogTitle>
            <DialogDescription>
              Custos não geram caixa automaticamente; o pagamento continua
              controlado no fluxo.
            </DialogDescription>
          </DialogHeader>
          {editor !== undefined && (
            <Editor item={editor} close={() => setEditor(undefined)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
