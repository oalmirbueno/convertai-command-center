import { useState } from "react";
import { Pencil } from "lucide-react";
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
import { useFinanceDashboard } from "./api/useFinanceV2";
import { ClientFinancialForm } from "./components/ClientFinancialForm";
import {
  Failed,
  Loading,
  statusBadge,
} from "./components/FinanceUi";
import {
  clientHealth,
  formatCurrency,
  formatDate,
} from "./lib/finance";
import type { FinanceClient } from "./types";

export function ClientsFinanceSection() {
  const query = useFinanceDashboard();
  const [selected, setSelected] = useState<FinanceClient | null>(null);

  if (query.isLoading) return <Loading />;
  if (query.isError) {
    return <Failed message={query.error.message} retry={() => query.refetch()} />;
  }
  if (!query.data) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">
          Saúde financeira dos clientes
        </h2>
        <p className="text-sm text-muted-foreground">
          Plano, mensalidade, recebimento e pendências no mês.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {query.data.clients.map((client) => {
          const health = clientHealth(client);
          const subscription = client.subscription;
          return (
            <Card key={client.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {client.name || client.brand || "Cliente"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {subscription ? subscription.plan.name : "Sem plano"}
                      {client.brand ? " · " + client.brand : ""}
                    </p>
                  </div>
                  <Badge variant={statusBadge(health)}>{health}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Mensalidade</p>
                    <p className="font-semibold">
                      {formatCurrency(
                        subscription?.amount ?? 0,
                        subscription?.currency ?? "BRL",
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Em aberto</p>
                    <p
                      className={
                        client.billing.open > 0
                          ? "font-semibold text-amber-600"
                          : "font-semibold"
                      }
                    >
                      {formatCurrency(client.billing.open)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Recebido</p>
                    <p className="font-medium text-emerald-600">
                      {formatCurrency(client.billing.received)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Próxima</p>
                    <p className="font-medium">
                      {formatDate(subscription?.next_billing_date ?? null)}
                    </p>
                  </div>
                </div>
                <Button
                  className="mt-4 w-full"
                  variant="outline"
                  onClick={() => setSelected(client)}
                >
                  <Pencil className="mr-2 size-4" />
                  Configurar financeiro
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Financeiro · {selected?.name || selected?.brand || "Cliente"}
            </DialogTitle>
            <DialogDescription>
              O histórico anterior será mantido.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <ClientFinancialForm
              clientId={selected.id}
              current={
                selected.subscription
                  ? { ...selected.subscription, client_id: selected.id }
                  : null
              }
              plans={query.data.plans}
              onDone={() => setSelected(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
