import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, EstadoDeErro, EstadoVazio, Secao, SeletorCompacto, botao, campo, etiqueta, juntar, texto } from "@/components/sistema";
import { registrarPagamento, valorRecebido } from "@/lib/financeiro/pagamentoParcial";

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
  // 23/11 (dono): "Recebi" pergunta se entrou tudo ou só uma parte.
  const [recebendo, setRecebendo] = useState<{ id: string; tipo: "total" | "parte"; valor: string } | null>(null);

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

  const confirmarRecebimento = async (linha: Cobranca) => {
    if (!recebendo) return;
    const valor = recebendo.tipo === "total" ? linha.amount : valorRecebido(recebendo.valor);
    if (!valor) {
      toast.error("Diga quanto entrou.");
      return;
    }
    if (recebendo.tipo === "parte" && valor >= linha.amount) {
      toast.error("O valor é o total da cobrança: use Pago total.");
      return;
    }
    setSalvando(linha.id);
    try {
      const r = await registrarPagamento(linha.id, valor, new Date().toISOString().slice(0, 10));
      await invalidar();
      setRecebendo(null);
      toast.success(r.tipo === "total" ? "Pagamento registrado." : `Recebido ${dinheiro(r.recebido)}. O saldo de ${dinheiro(r.restante)} ficou pendente.`);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível registrar o pagamento.");
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

  const pendentes = linhas.filter((l) => l.status === "pending").length;
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
      ajuda="Valor e vencimento se corrigem na própria linha. Recebi pergunta se entrou o total ou só uma parte: parte registra o que entrou e cria o saldo restante como pendente. A seta volta para pendente uma cobrança marcada paga por engano. Mostra as 10 mais recentes."
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
            const parcial = linha.status === "partial";
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
                    <span className={juntar(etiqueta, "ml-2", paga ? "bg-muted text-success" : parcial ? "bg-info/10 text-info" : "bg-warning/10 text-warning")}>
                      {paga ? `Paga${linha.paid_date ? ` ${linha.paid_date.slice(8, 10)}/${linha.paid_date.slice(5, 7)}` : ""}` : parcial ? "Paga em parte" : "Pendente"}
                    </span>
                  </div>
                  <p className={juntar(texto.auxiliar, "mt-0.5 truncate tabular-nums")}>
                    {dinheiro(linha.amount)}
                    {(paga || parcial) && linha.paid_amount != null && linha.paid_amount !== linha.amount
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
                      parcial ? null : (
                        <button
                          type="button"
                          disabled={ocupada}
                          onClick={() => setRecebendo({ id: linha.id, tipo: "total", valor: "" })}
                          title="Registrar o pagamento de hoje"
                          className={juntar(botao.secundario, "h-8 px-2.5 text-success")}
                        >
                          Recebi
                        </button>
                      )
                    )}
                </div>
                {recebendo && recebendo.id === linha.id && (
                  <div className="order-4 mt-3 flex w-full min-w-0 flex-wrap items-center [&>*]:mb-2" data-recebendo={linha.id}>
                    <SeletorCompacto
                      opcoes={[{ valor: "total", rotulo: `Pago total (${dinheiro(linha.amount)})` }, { valor: "parte", rotulo: "Pagou parte" }]}
                      valor={recebendo.tipo}
                      onEscolher={(v) => setRecebendo({ ...recebendo, tipo: v === "parte" ? "parte" : "total" })}
                      rotulo="Quanto entrou"
                      className="mr-3"
                    />
                    {recebendo.tipo === "parte" && (
                      <input
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        placeholder="Valor recebido"
                        value={recebendo.valor}
                        onChange={(e) => setRecebendo({ ...recebendo, valor: e.target.value })}
                        className={juntar(campo, "mr-3 h-8 w-36 tabular-nums")}
                        aria-label="Valor recebido"
                      />
                    )}
                    <button type="button" disabled={ocupada} onClick={() => void confirmarRecebimento(linha)} className={juntar(botao.primario, "mr-2 h-8")}>
                      {ocupada ? "Salvando..." : "Confirmar"}
                    </button>
                    <button type="button" onClick={() => setRecebendo(null)} className={juntar(botao.discreto, "h-8")}>
                      Cancelar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}
