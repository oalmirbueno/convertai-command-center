import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, EstadoDeErro, EstadoVazio, Secao, botao, campo, etiqueta, juntar, texto } from "@/components/sistema";

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
  const { data: linhas = [], isLoading, isError, refetch } = useQuery({
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

  const pendentes = linhas.filter((l) => l.status !== "paid").length;
  const pagas = linhas.length - pendentes;
  const estado =
    linhas.length === 0
      ? undefined
      : [
          pendentes ? `${pendentes} ${pendentes === 1 ? "pendente" : "pendentes"}` : "",
          pagas ? `${pagas} ${pagas === 1 ? "paga" : "pagas"}` : "",
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <Secao
      titulo="Cobranças"
      divisoria
      descricao={estado}
      ajuda="Valor e vencimento se corrigem na própria linha. Recebi marca como paga hoje; a seta volta a cobrança para pendente se ela foi marcada por engano. Mostra as 10 mais recentes."
    >
      {isLoading ? (
        <Carregando linhas={2} rotulo="Carregando cobranças" />
      ) : isError ? (
        <EstadoDeErro
          titulo="Não foi possível carregar as cobranças."
          acao={
            <button type="button" onClick={() => void refetch()} className={juntar(botao.secundario, "h-8")}>
              Tentar de novo
            </button>
          }
        />
      ) : linhas.length === 0 ? (
        <EstadoVazio compacto titulo="Sem cobrança." descricao="Mensalidades e parcelas aparecem aqui." />
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {linhas.map((linha) => {
            const rascunho = edicao[linha.id];
            const mudou =
              rascunho &&
              (parseFloat(rascunho.amount) !== linha.amount ||
                (rascunho.due || linha.due_date) !== linha.due_date);
            const paga = linha.status === "paid";
            const ocupada = salvando === linha.id;
            return (
              // Celular: descrição e ação na mesma linha, campos embaixo.
              // Computador: tudo numa linha, colunas alinhadas entre as linhas.
              <li key={linha.id} className="flex min-w-0 flex-wrap items-center py-3 sm:flex-nowrap">
                <div className="order-1 min-w-0 flex-1">
                  <div className="flex min-w-0 items-center">
                    <p className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>
                      {linha.description || (linha.type === "renewal" ? "Mensalidade" : "Cobrança")}
                    </p>
                    <span className={juntar(etiqueta, "ml-2", paga ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                      {paga ? `Paga${linha.paid_date ? ` ${linha.paid_date.slice(8, 10)}/${linha.paid_date.slice(5, 7)}` : ""}` : "Pendente"}
                    </span>
                  </div>
                  <p className={juntar(texto.auxiliar, "mt-0.5 truncate tabular-nums")}>
                    {dinheiro(linha.amount)}
                    {paga && linha.paid_amount != null && linha.paid_amount !== linha.amount
                      ? ` · recebido ${dinheiro(linha.paid_amount)}`
                      : ""}
                  </p>
                </div>
                <div className="order-3 mt-2 grid w-full min-w-0 grid-cols-2 gap-2 sm:order-2 sm:ml-4 sm:mt-0 sm:w-[320px] sm:shrink-0">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
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
                    className={juntar(campo, "tabular-nums")}
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
                    className={juntar(campo, "tabular-nums")}
                    aria-label="Vencimento da cobrança"
                  />
                </div>
                <div className="order-2 ml-2 flex shrink-0 items-center justify-end sm:order-3 sm:w-[112px] [&>*+*]:ml-1">
                    {mudou && (
                      <button
                        type="button"
                        disabled={ocupada}
                        onClick={() => salvarEdicao(linha)}
                        title="Salvar valor e vencimento"
                        aria-label="Salvar valor e vencimento"
                        className={juntar(botao.icone, "text-primary hover:text-primary disabled:opacity-50")}
                      >
                        {ocupada ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    )}
                    {paga ? (
                      <button
                        type="button"
                        disabled={ocupada}
                        onClick={() =>
                          void aplicar(
                            linha,
                            { status: "pending", paid_date: null, paid_amount: null },
                            "Cobrança voltou a pendente.",
                          )
                        }
                        title="Marcar como pendente (foi pago por engano)"
                        aria-label="Voltar para pendente"
                        className={juntar(botao.icone, "disabled:opacity-50")}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={ocupada}
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
                        className={juntar(botao.secundario, "h-8 px-2.5 text-success")}
                      >
                        Recebi
                      </button>
                    )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}
