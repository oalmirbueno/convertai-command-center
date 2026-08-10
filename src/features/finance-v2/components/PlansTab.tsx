import { useState } from "react";
import { GitBranch, Plus, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import {
  usePublishPlanVersion,
  useUpsertPlan,
} from "../api/useFinanceV2";
import {
  formatCurrency,
  grossUp,
  netAfterTax,
  parseCurrencyInput,
  subtractMoney,
} from "../lib/finance";
import type {
  FinanceSettings,
  PlanCatalogItem,
} from "../types";
import { Empty, Metric } from "./FinanceUi";

function PlanEditor({ close }: { close: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const save = useUpsertPlan();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            p_code: code.trim().toLowerCase().replace(/\s+/g, "-"),
            p_display_name: name,
            p_description: description || null,
            p_active: true,
          },
          { onSuccess: close },
        );
      }}
    >
      <div className="space-y-1">
        <Label>Código</Label>
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="crescimento"
          required
        />
      </div>
      <div className="space-y-1">
        <Label>Nome</Label>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label>Descrição</Label>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      {save.isError && (
        <p className="text-sm text-destructive">{save.error.message}</p>
      )}
      <Button
        className="w-full"
        disabled={!code || !name || save.isPending}
      >
        {save.isPending ? "Criando..." : "Criar plano"}
      </Button>
    </form>
  );
}

function VersionEditor({
  plan,
  close,
}: {
  plan: PlanCatalogItem;
  close: () => void;
}) {
  const [price, setPrice] = useState(
    String(plan.current_version?.monthly_price ?? ""),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const save = usePublishPlanVersion();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            p_plan_id: plan.id,
            p_monthly_price: parseCurrencyInput(price),
            p_effective_from: effectiveFrom,
            p_currency: "BRL",
            p_billing_cycle: "monthly",
          },
          { onSuccess: close },
        );
      }}
    >
      <div className="space-y-1">
        <Label>Preço mensal cobrado</Label>
        <Input
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label>Válida a partir de</Label>
        <Input
          type="date"
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
          required
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Será criada uma nova versão. Clientes atuais não têm o contrato
        reescrito automaticamente.
      </p>
      {save.isError && (
        <p className="text-sm text-destructive">{save.error.message}</p>
      )}
      <Button className="w-full" disabled={!price || save.isPending}>
        {save.isPending ? "Publicando..." : "Publicar nova versão"}
      </Button>
    </form>
  );
}

export function PlansTab({
  items,
  settings,
}: {
  items: PlanCatalogItem[];
  settings: FinanceSettings;
}) {
  const [create, setCreate] = useState(false);
  const [version, setVersion] = useState<PlanCatalogItem | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-3">
          <Metric
            label="Planos ativos"
            value={String(items.filter((item) => item.active).length)}
            icon={Tags}
          />
          <Metric
            label="Com preço publicado"
            value={String(
              items.filter((item) => item.current_version).length,
            )}
            icon={GitBranch}
            tone="good"
          />
        </div>
        <Button onClick={() => setCreate(true)}>
          <Plus className="mr-2 size-4" />
          Novo plano
        </Button>
      </div>

      {!items.length ? (
        <Empty
          title="Catálogo vazio"
          description="Crie o primeiro plano e publique sua versão comercial."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((plan) => {
            const price = plan.current_version?.monthly_price ?? 0;
            const tax = subtractMoney(
              price,
              netAfterTax(price, settings.tax_rate_percent),
            );
            const grossSuggestion = grossUp(
              price,
              settings.tax_rate_percent,
            );
            return (
              <Card key={plan.id} className={!plan.active ? "opacity-60" : ""}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex gap-2">
                        <p className="font-semibold">{plan.name}</p>
                        <Badge variant={plan.active ? "default" : "secondary"}>
                          {plan.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {plan.code}
                      </p>
                    </div>
                    {plan.current_version && (
                      <Badge variant="outline">
                        v{plan.current_version.version}
                      </Badge>
                    )}
                  </div>

                  <p className="mt-4 text-2xl font-semibold">
                    {plan.current_version
                      ? formatCurrency(
                          price,
                          plan.current_version.currency,
                        )
                      : "Sem preço"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {plan.current_version?.billing_cycle ??
                      "Publique uma versão"}
                  </p>

                  {plan.current_version && (
                    <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Imposto</p>
                        <p className="font-semibold">
                          {formatCurrency(
                            tax,
                            plan.current_version.currency,
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">
                          Líquido pós-imposto
                        </p>
                        <p className="font-semibold">
                          {formatCurrency(
                            netAfterTax(
                              price,
                              settings.tax_rate_percent,
                            ),
                            plan.current_version.currency,
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">
                          Gross-up sugerido
                        </p>
                        <p className="font-semibold text-primary">
                          {formatCurrency(
                            grossSuggestion,
                            plan.current_version.currency,
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Imposto configurado: {settings.tax_rate_percent}%.
                    Sugestões não alteram contratos.
                  </p>

                  <Button
                    className="mt-4 w-full"
                    variant="outline"
                    onClick={() => setVersion(plan)}
                  >
                    <GitBranch className="mr-2 size-4" />
                    Nova versão
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo plano</DialogTitle>
            <DialogDescription>
              Crie a identidade do plano. O preço entra numa versão publicada
              separada.
            </DialogDescription>
          </DialogHeader>
          <PlanEditor close={() => setCreate(false)} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!version}
        onOpenChange={(open) => !open && setVersion(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova versão · {version?.name}</DialogTitle>
            <DialogDescription>
              O histórico comercial anterior será preservado.
            </DialogDescription>
          </DialogHeader>
          {version && (
            <VersionEditor plan={version} close={() => setVersion(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
