import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useClients } from "@/hooks/useSupabaseData";
import { isInternalClient } from "@/lib/clientFlags";
import { Carregando, EstadoDeErro, EstadoVazio, FaixaDeNumeros, SeletorCompacto, botao, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import { SERVICE_LABELS } from "@/lib/cycleDefs";
import {
  chaveDaData,
  dataCurta,
  doTipo,
  entradasPorDiaDaSemana,
  resumoDasSaidas,
  valorDeQuemEntrou,
  servicosDeQuemEntrou,
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
  { valor: "mensal", rotulo: "Com mensalidade" },
  { valor: "avulso", rotulo: "Com avulso" },
];
const dinheiroExato = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const virgula = (n: number) => String(n).replace(".", ",");
/** "2026-08-11" vira "2026-09-11" (o fim do mês pago). */
export function umMesDepois(data: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  if (!m) return data;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]), Number(m[3])));
  // Dia que não existe no mês seguinte (31 de janeiro) cai no último dia dele.
  if (t.getUTCMonth() !== Number(m[2]) % 12) t.setUTCDate(0);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`;
}
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

/** O valor de avulso de cada cliente e o último pagamento (a data de saída que o cadastro permite saber). */
function useValores() {
  return useQuery({
    queryKey: ["crescimento-valores"],
    staleTime: 60_000,
    queryFn: async (): Promise<{ avulso: Record<string, number>; ultimoPago: Record<string, string> }> => {
      const [cobrancas, projetos] = await Promise.all([
        (supabase as any).from("billing").select("client_id, amount, paid_date, status, type, currency").limit(5000),
        (supabase as any).from("project_payments").select("client_id, total_value").limit(2000),
      ]);
      const cobrado: Record<string, number> = {};
      const emProjeto: Record<string, number> = {};
      const ultimoPago: Record<string, string> = {};
      for (const c of ((cobrancas.data ?? []) as any[])) {
        const id = String(c.client_id || "");
        if (!id || (c.currency && c.currency !== "BRL")) continue;
        if (c.type === "one_off") cobrado[id] = (cobrado[id] ?? 0) + (Number(c.amount) || 0);
        if (c.status === "paid" && c.paid_date && String(c.paid_date) > (ultimoPago[id] ?? "")) ultimoPago[id] = String(c.paid_date);
      }
      for (const pr of ((projetos.data ?? []) as any[])) {
        const id = String(pr.client_id || "");
        if (id) emProjeto[id] = (emProjeto[id] ?? 0) + (Number(pr.total_value) || 0);
      }
      // O mesmo avulso pode estar nas duas tabelas (projeto e cobrança): vale o maior, para não somar duas vezes.
      const avulso: Record<string, number> = {};
      for (const id of Object.keys(cobrado).concat(Object.keys(emProjeto))) avulso[id] = Math.max(cobrado[id] ?? 0, emProjeto[id] ?? 0);
      return { avulso, ultimoPago };
    },
  });
}

export function ConteudoDoCrescimento() {
  const clientesQuery = useClients();
  const recebimentosQuery = useRecebimentos(true);
  const valoresQuery = useValores();
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
        servicos: Object.keys(SERVICE_LABELS).filter((k) => c.services_config?.[k] === true).map((k) => SERVICE_LABELS[k]),
        plano: c.plan_name || null,
        mensal: Number(c.plan_value) > 0 ? Number(c.plan_value) : 0,
        avulso: valoresQuery.data?.avulso[String(c.id)] ?? 0,
        // Saiu no fim do último mês pago (quem pagou um mês ficou um mês). Sem pagamento, vale a última mudança do cadastro.
        saiuEm: c.plan_status === "inactive" ? (valoresQuery.data?.ultimoPago[String(c.id)] ? umMesDepois(valoresQuery.data.ultimoPago[String(c.id)]) : c.updated_at ? String(c.updated_at) : null) : null,
      })),
    [clientesQuery.data, valoresQuery.data],
  );
  const recebimentos = recebimentosQuery.data ?? [];
  const resumo = useMemo(() => resumoDoCrescimento(clientes, recebimentos, tipo), [clientes, recebimentos, tipo]);
  const serie = useMemo(() => serieDoCrescimento(clientes, recebimentos, { periodo, grao, tipo }), [clientes, recebimentos, periodo, grao, tipo]);
  const entraramNoPeriodo = serie.reduce((s, b) => s + b.entraram, 0);
  const recebidoNoPeriodo = serie.reduce((s, b) => s + b.recebido, 0);
  // Quem entrou no período à vista (com o filtro de tipo), do mais recente para o mais antigo.
  const entrantes = useMemo(() => {
    const chaves = new Set(serie.map((b) => b.chave));
    return clientes
      .filter((c) => doTipo(c, tipo) && chaves.has(chaveDaData(c.entrou, grao) || ""))
      .sort((a, b) => (a.entrou < b.entrou ? 1 : -1));
  }, [clientes, serie, tipo, grao]);
  const servicosDoPeriodo = useMemo(() => servicosDeQuemEntrou(entrantes), [entrantes]);
  const valorDoPeriodo = useMemo(() => valorDeQuemEntrou(entrantes), [entrantes]);
  const diasDaSemana = useMemo(() => entradasPorDiaDaSemana(clientes.filter((c) => doTipo(c, tipo))), [clientes, tipo]);
  const saidas = useMemo(() => resumoDasSaidas(clientes), [clientes]);
  const mediaDeEntradasDeMensalista = useMemo(() => resumoDoCrescimento(clientes, [], "mensal").mediaPorMes, [clientes]);
  const [verConcluidos, setVerConcluidos] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const linhaDoCliente = (c: ClienteDaCarteira) => (
    <li key={c.id} className="flex min-w-0 flex-wrap items-baseline py-1.5 text-[13px]" data-entrante={c.id}>
      <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{dataCurta(c.entrou)}</span>
      <span className="mr-2 min-w-0 font-medium text-foreground">{c.nome}</span>
      <span className="mr-2 shrink-0 text-muted-foreground">{NOME_DO_TIPO[c.tipo]}</span>
      {/* Mensalidade e avulso sempre separados, mesmo no cliente que tem os dois. */}
      {(c.mensal ?? 0) > 0 && <span className="mr-2 shrink-0 text-foreground" data-valor-mensal="">Mensalidade {dinheiroExato(c.mensal!)}{c.plano ? ` (${c.plano})` : ""}</span>}
      {(c.avulso ?? 0) > 0 && <span className="mr-2 shrink-0 text-foreground" data-valor-avulso="">Avulso {dinheiroExato(c.avulso!)}</span>}
      {(c.mensal ?? 0) === 0 && (c.avulso ?? 0) === 0 && <span className="mr-2 shrink-0 text-muted-foreground">sem valor no cadastro</span>}
      <span className="w-full min-w-0 text-muted-foreground sm:pl-24">{c.servicos?.length ? c.servicos.join(", ") : "sem serviço marcado no cadastro"}</span>
    </li>
  );

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

  return (
    <div className="min-w-0 space-y-5" data-crescimento="">
      <FaixaDeNumeros
        rotulo="Números do crescimento"
        colunas={4}
        itens={[
          { rotulo: "Clientes ativos hoje", valor: resumo.ativos, apoio: `${resumo.total} já passaram pela Aceleriq` },
          { rotulo: "Entraram neste mês", valor: resumo.entraramNoMes, corDoValor: resumo.entraramNoMes > 0 ? "text-success" : undefined, apoio: variacao(resumo.entraramNoMes, resumo.entraramNoMesPassado) },
          { rotulo: "Entraram nesta semana", valor: resumo.entraramNaSemana, corDoValor: resumo.entraramNaSemana > 0 ? "text-success" : undefined, apoio: "de segunda a domingo" },
          { rotulo: "Recebido neste mês", valor: recebimentosQuery.isLoading ? "…" : dinheiro(resumo.recebidoNoMes), apoio: recebimentosQuery.isError ? "não foi possível ler os recebimentos" : variacao(resumo.recebidoNoMes, resumo.recebidoNoMesPassado, dinheiro) },
        ]}
      />

      <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-5" aria-label="Destaques do histórico">
        <div className="min-w-0" data-destaque="Melhor dia da semana">
          <p className={texto.rotulo}>Melhor dia da semana</p>
          <p className="mt-0.5 truncate text-[14px] font-semibold text-foreground">{diasDaSemana.melhor ? diasDaSemana.melhor.dia : "Sem dado ainda"}</p>
          {diasDaSemana.melhor && <p className={texto.auxiliar}>{diasDaSemana.melhor.quantos} {diasDaSemana.melhor.quantos === 1 ? "entrada" : "entradas"} ({diasDaSemana.melhor.parte}% do total)</p>}
        </div>
        <div className="min-w-0" data-destaque="Média mensal de entradas">
          <p className={texto.rotulo}>Média mensal de entradas</p>
          <p className="mt-0.5 truncate text-[14px] font-semibold text-foreground">{String(resumo.mediaPorMes).replace(".", ",")} {resumo.mediaPorMes === 1 ? "cliente" : "clientes"} por mês</p>
          <p className={texto.auxiliar}>{resumo.mesesNaMedia > 0 ? `em ${resumo.mesesNaMedia} ${resumo.mesesNaMedia === 1 ? "mês fechado" : "meses fechados"}` : "ainda sem mês fechado"}</p>
        </div>
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
              <Line yAxisId="dinheiro" type="linear" dataKey="recebido" name="Recebido" stroke="hsl(var(--info))" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className={juntar(texto.auxiliar, "mt-1 flex flex-wrap items-center [&>*]:mr-3")}>
          <span className="inline-flex items-center"><span className="mr-1.5 h-2 w-2 rounded-sm bg-primary" aria-hidden />clientes que entraram</span>
          <span className="inline-flex items-center"><span className="mr-1.5 h-0.5 w-3 bg-info" aria-hidden />valor recebido</span>
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
              {aberto === b.chave && (
                <ul className="mb-2 ml-1 min-w-0 border-l border-border pl-3" data-quem-entrou={b.chave}>
                  {entrantes.filter((c) => chaveDaData(c.entrou, grao) === b.chave).map(linhaDoCliente)}
                  {b.entraram === 0 && <li className={juntar(texto.auxiliar, "py-1.5")}>Ninguém entrou.</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 min-w-0" data-valor-do-periodo="">
          <p className={texto.rotulo}>Quanto entrou em contrato no período</p>
          <p className="mt-1 flex min-w-0 flex-wrap text-[13px] [&>*]:mb-1 [&>*]:mr-4">
            <span className="text-foreground">Mensalidades novas: <strong className="font-semibold tabular-nums">{valorDoPeriodo.mensalidades}</strong> · {dinheiroExato(valorDoPeriodo.mensalPorMes)} por mês</span>
            <span className="text-foreground">Avulsos: <strong className="font-semibold tabular-nums">{valorDoPeriodo.avulsos}</strong> · {dinheiroExato(valorDoPeriodo.avulsoTotal)}</span>
          </p>
          <p className={texto.auxiliar} data-dias-da-semana="">Entradas por dia da semana: {diasDaSemana.dias.map((d) => `${d.dia.slice(0, 3)} ${d.quantos}`).join(" · ")}</p>
        </div>

        <div className="mt-4 min-w-0" data-servicos-do-periodo="">
          <p className={texto.rotulo}>O que quem entrou contratou</p>
          {servicosDoPeriodo.length ? (
            <p className="mt-1 flex min-w-0 flex-wrap text-[13px] [&>*]:mb-1 [&>*]:mr-3">
              {servicosDoPeriodo.map((s) => (
                <span key={s.servico} className="whitespace-nowrap text-foreground">{s.servico} <span className="tabular-nums text-muted-foreground">{s.quantos}</span></span>
              ))}
            </p>
          ) : (
            <p className={juntar(texto.auxiliar, "mt-1")}>Nenhum serviço marcado no cadastro de quem entrou neste período.</p>
          )}
        </div>

        <div className="mt-4 min-w-0" data-todos-que-entraram="">
          <button type="button" aria-expanded={verTodos} onClick={() => setVerTodos((v) => !v)} className={juntar(botao.discreto, "h-8 px-2 text-[13px]")}>
            {verTodos ? "Recolher a lista" : `Ver todos que entraram no período (${entrantes.length})`}
          </button>
          {verTodos && <ul className="mt-1 min-w-0 divide-y divide-border">{entrantes.map(linhaDoCliente)}</ul>}
        </div>
      </div>

      {/* Quem saiu: só mensalista conta como perda. Avulso concluído é projeto que terminou. */}
      <div className="min-w-0 border-t border-border pt-4" data-saidas="">
        <p className="text-[15px] font-semibold text-foreground">Saídas e churn</p>
        <p className={juntar(texto.auxiliar, "mb-3")}>Só mensalista com plano inativo. A data é o fim do último mês pago.</p>
        <FaixaDeNumeros
          rotulo="Números das saídas"
          colunas={4}
          itens={[
            { rotulo: "Mensalistas que saíram", valor: saidas.quemSaiu.length, corDoValor: saidas.quemSaiu.length > 0 ? "text-destructive" : undefined, apoio: `de ${saidas.mensalistasQueJaPassaram} que já tiveram mensalidade` },
            { rotulo: "Média de saídas por mês", valor: virgula(saidas.mediaDeSaidasPorMes), apoio: `contra ${virgula(mediaDeEntradasDeMensalista)} entradas de mensalista por mês` },
            { rotulo: "Churn médio por mês", valor: `${virgula(saidas.churnMedio)}%`, apoio: "saídas do mês sobre a base do mês" },
            { rotulo: "Mensalidade perdida", valor: dinheiro(saidas.mensalidadePerdida), apoio: saidas.quemSaiu.length ? `ficaram em média ${virgula(saidas.permanenciaMedia)} ${saidas.permanenciaMedia === 1 ? "mês" : "meses"}` : "por mês" },
          ]}
        />
        {saidas.quemSaiu.length > 0 ? (
          <ul className="mt-3 min-w-0 divide-y divide-border border-y border-border" data-quem-saiu="">
            {saidas.quemSaiu.map((c) => (
              <li key={c.id} className="flex min-w-0 flex-wrap items-baseline px-1 py-2 text-[13px]">
                <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{dataCurta(String(c.saiuEm))}</span>
                <span className="mr-2 min-w-0 font-medium text-foreground">{c.nome}</span>
                {(c.mensal ?? 0) > 0 && <span className="mr-2 shrink-0 text-foreground">Mensalidade {dinheiroExato(c.mensal!)}</span>}
                <span className="min-w-0 text-muted-foreground">entrou em {dataCurta(c.entrou)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={juntar(texto.auxiliar, "mt-3")}>Nenhum mensalista saiu até hoje.</p>
        )}
        {saidas.avulsosConcluidos.length > 0 && (
          <div className="mt-2 min-w-0" data-avulsos-concluidos="">
            <button type="button" aria-expanded={verConcluidos} onClick={() => setVerConcluidos((v) => !v)} className={juntar(botao.discreto, "h-8 px-2 text-[13px]")}>
              {verConcluidos ? "Recolher" : `Avulsos concluídos (${saidas.avulsosConcluidos.length}): não contam como saída`}
            </button>
            {verConcluidos && <ul className="mt-1 min-w-0 divide-y divide-border">{saidas.avulsosConcluidos.map(linhaDoCliente)}</ul>}
          </div>
        )}
      </div>
    </div>
  );
}

export default ConteudoDoCrescimento;
