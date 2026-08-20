import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * As cobranças do cliente, editáveis onde o dono já está.
 *
 * O cadastro registrava valores que às vezes nasciam errados — entrada com
 * valor diferente, mensalidade marcada como paga sem ter caído — e não havia
 * ONDE corrigir: o painel só sabia criar cobrança e marcar parcela como
 * paga. O erro ficava no financeiro até alguém caçar a linha no banco.
 *
 * Aqui cada linha edita valor e vencimento, e o pago/pendente é reversível:
 * marcar de novo como pendente existe porque marcar como pago por engano
 * acontece — e sem o caminho de volta, o engano virava registro definitivo.
 */

interface Cobranca {
  id: string;
  type: string | null;
  amount: number;
  due_date: string | null;
  paid_date: string | null;
  paid_amount: number | null;
  description: string | null;
  status: string;
}

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function CobrancasDoCliente({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<Record<string, { amount: string; due: string }>>({});

  const chave = ["cobrancas-cliente", clientId];
  const { data: linhas = [], isLoading } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing")
        .select("id, type, amount, due_date, paid_date, paid_amount, description, status")
        .eq("client_id", clientId)
        .order("due_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as Cobranca[];
    },
    enabled: Boolean(clientId),
  });

  const invalidar = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: chave }),
      queryClient.invalidateQueries({ queryKey: ["billing"] }),
      queryClient.invalidateQueries({ queryKey: ["client-exec-billing"] }),
    ]);

  const aplicar = async (linha: Cobranca, mudancas: Record<string, unknown>, aviso: string) => {
    setSalvando(linha.id);
    try {
      const { error } = await supabase.from("billing").update(mudancas).eq("id", linha.id);
      if (error) throw error;
      await invalidar();
      setEdicao((atual) => {
        const { [linha.id]: _, ...resto } = atual;
        return resto;
      });
      toast.success(aviso);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar a cobrança.");
    } finally {
      setSalvando(null);
    }
  };

  const salvarEdicao = (linha: Cobranca) => {
    const rascunho = edicao[linha.id];
    if (!rascunho) return;
    const valor = parseFloat(rascunho.amount);
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    void aplicar(
      linha,
      {
        amount: +valor.toFixed(2),
        due_date: rascunho.due || linha.due_date,
        // Cobrança PAGA com valor corrigido: o recebido acompanha, senão o
        // financeiro somaria o valor antigo para sempre.
        ...(linha.status === "paid" ? { paid_amount: +valor.toFixed(2) } : {}),
      },
      "Cobrança atualizada.",
    );
  };

  if (isLoading || linhas.length === 0) return null;

  return (
    <div className="bg-secondary/40 border border-border rounded-xl p-3 space-y-2">
      <p className="text-[11px] font-semibold text-foreground/80">
        Cobranças · valores e vencimentos editáveis
      </p>
      {linhas.map((linha) => {
        const rascunho = edicao[linha.id];
        const mudou =
          rascunho &&
          (parseFloat(rascunho.amount) !== linha.amount ||
            (rascunho.due || linha.due_date) !== linha.due_date);
        const paga = linha.status === "paid";
        return (
          <div
            key={linha.id}
            className="rounded-[10px] border border-border bg-background px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
                {linha.description || (linha.type === "renewal" ? "Mensalidade" : "Cobrança")}
              </p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${
                  paga ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                }`}
              >
                {paga ? `paga${linha.paid_date ? ` · ${linha.paid_date.slice(8, 10)}/${linha.paid_date.slice(5, 7)}` : ""}` : "pendente"}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={rascunho?.amount ?? String(linha.amount)}
                onChange={(e) =>
                  setEdicao((atual) => ({
                    ...atual,
                    [linha.id]: {
                      amount: e.target.value,
                      due: atual[linha.id]?.due ?? (linha.due_date || ""),
                    },
                  }))
                }
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12px] text-foreground focus:border-primary/50 focus:outline-none"
                aria-label="Valor da cobrança"
              />
              <input
                type="date"
                value={rascunho?.due ?? (linha.due_date || "")}
                onChange={(e) =>
                  setEdicao((atual) => ({
                    ...atual,
                    [linha.id]: {
                      amount: atual[linha.id]?.amount ?? String(linha.amount),
                      due: e.target.value,
                    },
                  }))
                }
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12px] text-foreground focus:border-primary/50 focus:outline-none"
                aria-label="Vencimento da cobrança"
              />
              <div className="flex items-center gap-1">
                {mudou && (
                  <button
                    type="button"
                    disabled={salvando === linha.id}
                    onClick={() => salvarEdicao(linha)}
                    title="Salvar valor e vencimento"
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                  >
                    {salvando === linha.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                {paga ? (
                  <button
                    type="button"
                    disabled={salvando === linha.id}
                    onClick={() =>
                      void aplicar(
                        linha,
                        { status: "pending", paid_date: null, paid_amount: null },
                        "Cobrança voltou a pendente.",
                      )
                    }
                    title="Marcar como pendente (foi pago por engano)"
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={salvando === linha.id}
                    onClick={() =>
                      void aplicar(
                        linha,
                        {
                          status: "paid",
                          paid_date: new Date().toISOString().slice(0, 10),
                          paid_amount: linha.amount,
                        },
                        "Pagamento registrado.",
                      )
                    }
                    title="Marcar como paga hoje"
                    className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-success/40 bg-success/10 px-2 text-[10.5px] font-semibold text-success hover:bg-success/20 disabled:opacity-50"
                  >
                    Recebi
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
              {dinheiro(linha.amount)}
              {paga && linha.paid_amount != null && linha.paid_amount !== linha.amount
                ? ` · recebido ${dinheiro(linha.paid_amount)}`
                : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
