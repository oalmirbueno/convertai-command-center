import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useClients } from "@/hooks/useSupabaseData";
import { isInternalClient } from "@/lib/clientFlags";
import { Carregando, EstadoDeErro, EstadoVazio, FaixaDeNumeros, SeletorCompacto, botao, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import {
  nomeDoMes,
  resumoDoCrescimento,
  serieDoCrescimento,
  type ClienteDaCarteira,
  type Grao,
  type Periodo,
  type Recebimento,
  type TipoDoFiltro,
} from "@/lib/crescimentoDaCarteira";

/**
 * Crescimento da carteira (12/11/2026, pedido do dono): "quantos clientes entraram no mês, na semana,
 * com filtro; o histórico total; em qual mês entrou mais, em qual entrou menos e qual teve o maior
 * faturamento. Bem visual."
 *
 * Abre de Clientes e do Financeiro, no mesmo botão. Não tem tabela nem rotina nova: lê os clientes que
 * a tela já carrega e as cobranças e parcelas pagas. As contas ficam em src/lib/crescimentoDaCarteira.ts.
 */

const dinheiro = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: "tudo", rotulo: "Tudo" },
  { valor: "12m", rotulo: "12 meses" },
  { valor: "ano", rotulo: "Este ano" },
  { valor: "6m", rotulo: "6 meses" },
  { valor: "3m", rotulo: "3 meses" },
];
const GRAOS: { valor: Grao; rotulo: string }[] = [{ valor: "mes", rotulo: "Por mês" }, { valor: "semana", rotulo: "Por semana" }];
const TIPOS: { valor: TipoDoFiltro; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos os tipos" },
  { valor: "recurring", rotulo: "Mensalistas" },
  { valor: "hybrid", rotulo: "Híbridos" },
  { valor: "one_off", rotulo: "Avulsos" },
];
const NOME_DO_TIPO: Record<string, string> = { recurring: "Mensalista", hybrid: "Híbrido", one_off: "Avulso" };

function variacao(agora: number, antes: number, formato: (n: number) => string = String): string {
  if (antes === 0 && agora === 0) return "igual ao mês passado";
  if (antes === 0) return "nada no mês passado";
  const d = agora - antes;
  if (d === 0) return "igual ao mês passado";
  return `${d > 0 ? "+" : "-"}${formato(Math.abs(d))} que no mês passado`;
}

/** Os pagamentos que entraram: cobranças pagas e parcelas de projeto pagas, em reais. */
function useRecebimentos(ativo: boolean) {
  return useQuery({
    queryKey: ["crescimento-recebimentos"],
    enabled: ativo,
    staleTime: 60_000,
    queryFn: async (): Promise<Recebimento[]> => {
      const [cobrancas, parcelas] = await Promise.all([
        (supabase as any).from("billing").select("client_id, amount, paid_amount, paid_date, currency").eq("status", "paid").not("paid_date", "is", null).limit(5000),
        (supabase as any).from("payment_installments").select("amount, paid_amount, paid_date, pagamento:project_payments!inner(client_id)").eq("status", "paid").not("paid_date", "is", null).limit(5000),
      ]);
      if (cobrancas.error) throw cobrancas.error;
      if (parcelas.error) throw parcelas.error;
      const saida: Recebimento[] = [];
      for (const c of (cobrancas.data ?? []) as any[]) {
        if (c.currency && c.currency !== "BRL") continue;
        saida.push({ data: String(c.paid_date), valor: Number(c.paid_amount ?? c.amount) || 0, clienteId: c.client_id ?? null });
      }
      for (const p of (parcelas.data ?? []) as any[]) {
        saida.push({ data: String(p.paid_date), valor: Number(p.paid_amount ?? p.amount) || 0, clienteId: p.pagamento?.client_id ?? null });
      }
      return saida;
    },
  });
}

export function ConteudoDoCrescimento() {
  const clientesQuery = useClients();
  const recebimentosQuery = useRecebimentos(true);
  const [periodo, setPeriodo] = useEstadoDaTela<Periodo>("crescimento:periodo", "tudo", { validar: (v) => PERIODOS.some((p) => p.valor === v) });
  const [grao, setGrao] = useEstadoDaTela<Grao>("crescimento:grao", "mes", { validar: (v) => v === "mes" || v === "semana" });
  const [tipo, setTipo] = useEstadoDaTela<TipoDoFiltro>("crescimento:tipo", "todos", { validar: (v) => TIPOS.some((t) => t.valor === v) });
  const [aberto, setAberto] = useState<string | null>(null);

  const clientes: ClienteDaCarteira[] = useMemo(
    () => ((clientesQuery.data ?? []) as any[])
      .filter((c) => !isInternalClient(c) && c.created_at)
      .map((c) => ({
        id: String(c.id),
        nome: c.company_name || c.full_name || "Cliente",
        entrou: String(c.created_at),
        tipo: (["recurring", "hybrid", "one_off"].includes(c.client_type) ? c.client_type : "recurring") as ClienteDaCarteira["tipo"],
        ativo: (c.plan_status || "active") === "active",
      })),
    [clientesQuery.data],
  );
  const recebimentos = recebimentosQuery.data ?? [];
  const resumo = useMemo(() => resumoDoCrescimento(clientes, recebimentos, tipo), [clientes, recebimentos, tipo]);
  const serie = useMemo(() => serieDoCrescimento(clientes, recebimentos, { periodo, grao, tipo }), [clientes, recebimentos, periodo, grao, tipo]);
  const entraramNoPeriodo = serie.reduce((s, b) => s + b.entraram, 0);
  const recebidoNoPeriodo = serie.reduce((s, b) => s + b.recebido, 0);
  const tipoPorNome = useMemo(() => new Map(clientes.map((c) => [c.nome, c.tipo] as const)), [clientes]);

  if (clientesQuery.isLoading) return <Carregando linhas={5} rotulo="Carregando o crescimento da carteira" />;
  if (clientesQuery.isError) return <EstadoDeErro titulo="Não foi possível ler os clientes." acao={<button type="button" className={botao.secundario} onClick={() => void clientesQuery.refetch()}>Tentar de novo</button>} />;
  if (clientes.length === 0) return <EstadoVazio compacto titulo="Ainda não há cliente cadastrado para contar." />;

  const destaque = (rotulo: string, b: { chave: string; entraram: number; recebido: number } | null, valor: (x: { entraram: number; recebido: number }) => string) => (
    <div className="min-w-0" data-destaque={rotulo}>
      <p className={texto.rotulo}>{rotulo}</p>
      <p className="mt-0.5 truncate text-[14px] font-semibold text-foreground">{b ? nomeDoMes(b.chave) : "Sem dado ainda"}</p>
      {b && <p className={texto.auxiliar}>{valor(b)}</p>}
    </div>
  );
  const baldeAberto = aberto ? serie.find((b) => b.chave === aberto) ?? null : null;

  return (
    <div className="min-w-0 space-y-5" data-crescimento="">
      <FaixaDeNumeros
        rotulo="Números do crescimento"
        colunas={4}
        itens={[
          { rotulo: "Clientes ativos hoje", valor: resumo.ativos, apoio: `${resumo.total} já passaram pela Aceleriq` },
          { rotulo: "Entraram neste mês", valor: resumo.entraramNoMes, corDoValor: resumo.entraramNoMes > 0 ? "text-success" : undefined, apoio: variacao(resumo.entraramNoMes, resumo.entraramNoMesPassado) },
          { rotulo: "Entraram nesta semana", valor: resumo.entraramNaSemana, corDoValor: resumo.entraramNaSemana > 0 ? "text-success" : undefined, apoio: `média de ${String(resumo.mediaPorMes).replace(".", ",")} por mês` },
          { rotulo: "Recebido neste mês", valor: recebimentosQuery.isLoading ? "…" : dinheiro(resumo.recebidoNoMes), apoio: recebimentosQuery.isError ? "não foi possível ler os recebimentos" : variacao(resumo.recebidoNoMes, resumo.recebidoNoMesPassado, dinheiro) },
        ]}
      />

      <div className="grid min-w-0 gap-4 sm:grid-cols-3" aria-label="Destaques do histórico">
        {destaque("Mês com mais entradas", resumo.mesComMaisEntradas, (b) => `${b.entraram} ${b.entraram === 1 ? "cliente" : "clientes"}`)}
        {destaque("Mês com menos entradas", resumo.mesComMenosEntradas, (b) => `${b.entraram} ${b.entraram === 1 ? "cliente" : "clientes"}`)}
        {destaque("Maior faturamento", resumo.mesComMaiorRecebido, (b) => `${dinheiro(b.recebido)} recebidos`)}
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-1.5" role="toolbar" aria-label="Filtros do crescimento">
          <SeletorCompacto rotulo="Período" modo="lista" opcoes={PERIODOS} valor={periodo} onEscolher={(v) => setPeriodo(v as Periodo)} />
          <SeletorCompacto rotulo="Agrupar" modo="segmentado" opcoes={GRAOS} valor={grao} onEscolher={(v) => { setGrao(v as Grao); setAberto(null); }} />
          <SeletorCompacto rotulo="Tipo de cliente" modo="lista" opcoes={TIPOS} valor={tipo} onEscolher={(v) => setTipo(v as TipoDoFiltro)} />
          <span className={juntar(texto.auxiliar, "ml-auto tabular-nums")} data-total-do-periodo="">
            {entraramNoPeriodo} {entraramNoPeriodo === 1 ? "entrada" : "entradas"} · {dinheiro(recebidoNoPeriodo)} recebidos no período
          </span>
        </div>

        <div className="h-[260px] w-full min-w-0" role="img" aria-label={`Clientes que entraram e valor recebido, ${grao === "mes" ? "por mês" : "por semana"}`}>
          <ResponsiveContainer>
            <ComposedChart data={serie} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} onClick={(e: any) => { const k = e?.activePayload?.[0]?.payload?.chave; if (k) setAberto((a) => (a === k ? null : k)); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={12} />
              <YAxis yAxisId="clientes" allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="dinheiro" orientation="right" hide />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
                formatter={(v: any, nome: any) => (nome === "Recebido" ? [dinheiro(Number(v)), nome] : [`${v} ${Number(v) === 1 ? "cliente" : "clientes"}`, nome])}
                labelFormatter={(r: any, itens: any) => (grao === "mes" && itens?.[0]?.payload?.chave ? nomeDoMes(itens[0].payload.chave) : `semana de ${r}`)}
              />
              <Bar yAxisId="clientes" dataKey="entraram" name="Entraram" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={38} isAnimationActive={false} />
              <Line yAxisId="dinheiro" type="monotone" dataKey="recebido" name="Recebido" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className={juntar(texto.auxiliar, "mt-1 flex flex-wrap items-center [&>*]:mr-3")}>
          <span className="inline-flex items-center"><span className="mr-1.5 h-2 w-2 rounded-sm bg-primary" aria-hidden />clientes que entraram</span>
          <span className="inline-flex items-center"><span className="mr-1.5 h-0.5 w-3 bg-success" aria-hidden />valor recebido</span>
          <span>Toque numa barra para ver quem entrou.</span>
        </p>
      </div>

      {/* A mesma leitura em linhas: quem não enxerga o gráfico (ou está no celular) tem o número exato. */}
      <div className="min-w-0" data-linhas-do-crescimento="">
        <ul className="divide-y divide-border border-y border-border">
          {[...serie].reverse().filter((b) => b.entraram > 0 || b.recebido > 0 || b.chave === aberto).map((b) => (
            <li key={b.chave} className="min-w-0">
              <button type="button" aria-expanded={aberto === b.chave} onClick={() => setAberto((a) => (a === b.chave ? null : b.chave))} className="flex w-full min-w-0 items-center px-1 py-2 text-left text-[13px] transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="w-32 shrink-0 truncate font-medium text-foreground">{grao === "mes" ? nomeDoMes(b.chave) : `semana de ${b.rotulo}`}</span>
                <span className={juntar("w-24 shrink-0 tabular-nums", b.entraram > 0 ? "text-foreground" : "text-muted-foreground")}>{b.entraram} {b.entraram === 1 ? "entrou" : "entraram"}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{b.nomes.join(", ")}</span>
                <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">{b.recebido > 0 ? dinheiro(b.recebido) : ""}</span>
              </button>
            </li>
          ))}
        </ul>
        {baldeAberto && (
          <p className={juntar(texto.auxiliar, "mt-2")} data-quem-entrou="">
            <strong className="font-medium text-foreground">{grao === "mes" ? nomeDoMes(baldeAberto.chave) : `Semana de ${baldeAberto.rotulo}`}: </strong>
            {baldeAberto.nomes.length
              ? baldeAberto.nomes.map((n) => `${n} (${NOME_DO_TIPO[tipoPorNome.get(n) || "recurring"]})`).join(" · ")
              : "ninguém entrou."}
          </p>
        )}
      </div>
    </div>
  );
}

export default ConteudoDoCrescimento;
