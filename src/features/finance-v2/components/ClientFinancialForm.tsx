import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSetClientSubscription } from "../api/useFinanceV2";
import { clampBillingDay, parseCurrencyInput } from "../lib/finance";
import type {
  ClientSubscription,
  PlanCatalogItem,
} from "../types";

const addUtcDays = (value: string, days: number) => {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export function ClientFinancialForm({
  clientId,
  current,
  plans,
  onDone,
}: {
  clientId: string;
  current?: ClientSubscription | null;
  plans: PlanCatalogItem[];
  onDone: () => void;
}) {
  const available = useMemo(
    () => plans.filter((plan) => plan.active && plan.current_version),
    [plans],
  );
  const [plan, setPlan] = useState(current?.plan.version_id ?? "");
  const [amount, setAmount] = useState(String(current?.amount ?? ""));
  const [day, setDay] = useState(current?.billing_day ?? 10);
  const [next, setNext] = useState(current?.next_billing_date ?? "");
  const [notes, setNotes] = useState("");
  const save = useSetClientSubscription();

  const effectiveOn = () => {
    const today = new Date().toISOString().slice(0, 10);
    return current && current.starts_on >= today
      ? addUtcDays(current.starts_on, 1)
      : today;
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!plan) return;
        save.mutate(
          {
            p_client_id: clientId,
            p_plan_version_id: plan,
            p_effective_on: effectiveOn(),
            p_agreed_monthly_amount: amount
              ? parseCurrencyInput(amount)
              : null,
            p_billing_day: clampBillingDay(day),
            p_next_billing_date: next || null,
            p_notes: notes || null,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <div className="space-y-1">
        <Label>Plano</Label>
        <Select value={plan} onValueChange={setPlan}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {available.map((item) => (
              <SelectItem
                key={item.current_version!.id}
                value={item.current_version!.id}
              >
                {item.name} · v{item.current_version!.version}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="finance-client-amount">Valor acordado</Label>
          <Input
            id="finance-client-amount"
            inputMode="decimal"
            placeholder="Ex.: 1.497,00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="finance-client-day">Dia de cobrança</Label>
          <Input
            id="finance-client-day"
            type="number"
            min={1}
            max={28}
            value={day}
            onChange={(event) => setDay(Number(event.target.value))}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="finance-client-next">Próxima cobrança</Label>
        <Input
          id="finance-client-next"
          type="date"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="finance-client-notes">Observação</Label>
        <Textarea
          id="finance-client-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Motivo do ajuste, condição comercial..."
        />
      </div>
      <p className="text-xs text-muted-foreground">
        A alteração cria uma nova vigência e mantém o histórico anterior.
      </p>
      {save.isError && (
        <p className="text-sm text-destructive">{save.error.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button disabled={!plan || save.isPending}>
          {save.isPending ? "Salvando..." : "Salvar financeiro"}
        </Button>
      </div>
    </form>
  );
}
