import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CircleDollarSign, Plus, Receipt, Repeat, Scale, Trash2 } from "lucide-react";
import { casa, fraseDoErro, lerFaturamento, reais, ROTULO_DO_ESTADO, type FaturamentoDoProduto as Faturamento } from "@/lib/produto/api";
import { Avatar, CardSurface, CellIdentity, ChartLegend, Collapsible, DataTable, HelpTooltip, SegmentBar, Sparkline, StatCard, StatGrid, StatusPill, type DataColumn } from "@/components/ds";
import { CampoDeFormulario, EstadoDeErro, EstadoVazio, GrupoDeCampos, JanelaCentral, Secao, botao, campo, juntar, lista, texto } from "@/components/sistema";
import { TOM_DO_ESTADO } from "./estadoDaConta";

const ROTULO_DO_CUSTO: Record<string, string> = {
  taxa_asaas: "Taxas do Asaas",
  maquina_de_leads: "Máquina de leads",
  conferencia: "Conferências de IA",
  email: "E-mail",
  fixo: "Fixo",
  outro: "Outro",
};
const TIPOS_PARA_LANCAR = ["email", "maquina_de_leads", "conferencia", "fixo", "outro"];
const AJUDA = "Receita recorrente é a soma das mensalidades das empresas ativas e em atraso. Recebido é o que o Asaas confirmou no mês. O custo soma as taxas do Asaas, o imposto estimado, o custo fixo, o e-mail e o que foi lançado.";
const AJUDA_DOS_CUSTOS = "As taxas do Asaas entram sozinhas a cada pagamento, e o Google Maps da Máquina de leads entra como estimativa a cada busca. O custo fixo, o imposto e o custo por caixa de e-mail vêm dos Preços. O resto você lança aqui.";

/** O primeiro dia do mês de hoje, em São Paulo. */
export const mesDeHoje = () => `${new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7)}-01`;

export function somarMeses(mes: string, passo: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(ano, m - 1 + passo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function nomeDoMes(mes: string, curto = false): string {
  const [ano, m] = mes.split("-").map(Number);
  const nome = new Date(ano, m - 1, 1).toLocaleDateString("pt-BR", { month: curto ? "short" : "long" }).replace(".", "");
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}${curto ? "" : ` de ${ano}`}`;
}

/** O que sobra do mês: recebido menos taxas, imposto e os custos da casa. */
export const resultadoDoMes = (f: Pick<Faturamento, "recebido" | "custo_total">) => Math.round((f.recebido - f.custo_total) * 100) / 100;

type LinhaDaConta = Faturamento["por_conta"][number];

const COLUNAS: DataColumn<LinhaDaConta>[] = [
  {
    key: "empresa",
    header: "Empresa",
    cell: (c) => <CellIdentity className="max-w-[190px] sm:max-w-[360px]" leading={<Avatar name={c.nome} size="sm" square />} title={c.nome} subtitle={`${c.plano_id} · ${c.usuarios} ${c.usuarios === 1 ? "usuário" : "usuários"}`} />,
  },
  { key: "situacao", header: "Situação", hideOnMobile: true, cell: (c) => <StatusPill tone={TOM_DO_ESTADO[c.estado]} plain>{ROTULO_DO_ESTADO[c.estado]}</StatusPill> },
  { key: "mensal", header: "Mensal", numeric: true, hideOnMobile: true, cell: (c) => reais(c.mensal) },
  { key: "recebido", header: "Recebido", numeric: true, cell: (c) => reais(c.recebido) },
  { key: "aberto", header: "Em aberto", numeric: true, hideOnMobile: true, cell: (c) => (c.aberto > 0 ? <span className="text-warning">{reais(c.aberto)}</span> : <span className="text-muted-foreground">{reais(0)}</span>) },
  { key: "custo", header: "Custo", numeric: true, hideOnMobile: true, cell: (c) => (c.custo > 0 ? reais(c.custo) : <span className="text-muted-foreground">{reais(0)}</span>) },
];

/**
 * Faturamento e custo do produto CRM e E-mail (13/11/2026): quanto entra por mês, de quem, o que
 * está atrasado e quanto a casa gasta para entregar. Mora no Financeiro e na administração do
 * produto, lendo a mesma função.
 *
 * 19/11/2026 (dono: "está legal, só organizar melhor: tudo muito empilhado, muito em lista"): os
 * números viraram cartões, a série um gráfico ao lado da situação das empresas, o por empresa uma
 * tabela compacta e os custos ficam recolhidos (o total à vista).
 */
export default function FaturamentoDoProduto({ compacto = false }: { compacto?: boolean }) {
  const qc = useQueryClient();
  const [mes, setMes] = useState(mesDeHoje);
  const [lancando, setLancando] = useState(false);
  const fat = useQuery({ queryKey: ["produto", "faturamento", mes], queryFn: () => lerFaturamento(mes), placeholderData: (antes) => antes });
  const custos = useQuery({ queryKey: ["produto", "custos", mes], queryFn: () => casa.listarCustos(mes), enabled: !compacto });
  const reler = () => {
    void qc.invalidateQueries({ queryKey: ["produto", "faturamento"] });
    void qc.invalidateQueries({ queryKey: ["produto", "custos"] });
  };

  const f = fat.data;
  const resultado = f ? resultadoDoMes(f) : 0;
  const margem = f && f.recebido > 0 ? Math.round((resultado / f.recebido) * 100) : null;
  const maior = f ? Math.max(1, ...f.serie.map((s) => Math.max(s.recebido, s.custos))) : 1;
  const ou = (v: string) => (f ? v : "…");

  return (
    <div className="min-w-0 space-y-6" data-faturamento-do-produto="">
      <div className="flex min-w-0 flex-wrap items-center">
        <div className="flex h-9 items-center rounded-full bg-muted p-0.5" role="group" aria-label="Mês">
          <button type="button" className={botao.icone} onClick={() => setMes(somarMeses(mes, -1))} aria-label="Mês anterior" title="Mês anterior">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[128px] px-1 text-center text-[13px] font-medium tabular-nums text-foreground" aria-live="polite">{nomeDoMes(mes)}</span>
          <button type="button" className={botao.icone} onClick={() => setMes(somarMeses(mes, 1))} disabled={mes >= mesDeHoje()} aria-label="Próximo mês" title="Próximo mês">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate")}>
          {f ? `${f.contas.ativas} ${f.contas.ativas === 1 ? "empresa ativa" : "empresas ativas"} · ${f.contas.usuarios_pagos} ${f.contas.usuarios_pagos === 1 ? "usuário pago" : "usuários pagos"}` : ""}
        </span>
        <HelpTooltip className="ml-1" title="Faturamento do produto">{AJUDA}</HelpTooltip>
        {!compacto && (
          <button type="button" className={juntar(botao.secundario, "ml-2 h-8")} onClick={() => setLancando(true)} disabled={!f} aria-label="Lançar custo" title="Lançar custo" data-lancar-custo="">
            <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Custo</span>
          </button>
        )}
      </div>

      {fat.isError && !f ? (
        <EstadoDeErro titulo="Não foi possível carregar o faturamento do produto." acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void fat.refetch()}>Tentar de novo</button>} />
      ) : (
        <>
          <StatGrid label="Faturamento do produto">
            <StatCard size="md" variant="ink" icon={<Repeat className="h-4 w-4" />} label="Receita recorrente" value={ou(reais(f ? f.mrr : 0))} hint="por mês" />
            <StatCard
              size="md"
              icon={<CircleDollarSign className="h-4 w-4" />}
              label="Recebido no mês"
              value={ou(reais(f ? f.recebido : 0))}
              hint={f ? [f.a_receber > 0 ? `${reais(f.a_receber)} a receber` : "", f.atrasado > 0 ? `${reais(f.atrasado)} em atraso` : ""].filter(Boolean).join(" · ") || "confirmado no Asaas" : " "}
              chart={f && f.serie.length > 1 ? <Sparkline values={f.serie.map((s) => s.recebido)} height={32} label="Recebido nos últimos meses" /> : undefined}
            />
            <StatCard size="md" icon={<Receipt className="h-4 w-4" />} label="Custo do mês" value={ou(reais(f ? f.custo_total : 0))} hint={f ? `taxas ${reais(f.taxas)} · imposto ${reais(f.imposto)}` : " "} />
            <StatCard
              size="md"
              icon={<Scale className="h-4 w-4" />}
              label="Resultado"
              value={ou(reais(resultado))}
              delta={margem == null ? undefined : margem}
              deltaLabel={margem == null ? undefined : `${margem}% de margem`}
              hint={f && margem == null ? "sem recebimento no mês" : undefined}
            />
          </StatGrid>

          {!compacto && (
            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <CardSurface className="min-w-0 p-5 sm:p-6" data-serie-do-produto="">
                <span className="flex min-w-0 items-center">
                  <span className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>Últimos 6 meses</span>
                  <span className={juntar(texto.auxiliar, "ml-2 flex shrink-0 items-center")}>
                    <span className="mr-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                    recebido
                    <span className="ml-3 mr-1.5 h-2 w-2 rounded-full bg-muted-foreground/40" aria-hidden="true" />
                    custos
                  </span>
                </span>
                {!f ? (
                  <div className="mt-5 h-[200px] animate-pulse rounded-md bg-muted" aria-busy="true" aria-label="Carregando a série" />
                ) : (
                  <div className="mt-5 grid min-w-0 grid-cols-6 items-end gap-2 sm:gap-4" role="img" aria-label={`Recebido e custos por mês: ${f.serie.map((s) => `${nomeDoMes(s.mes)} recebido ${reais(s.recebido)}, custos ${reais(s.custos)}`).join("; ")}`}>
                    {f.serie.map((s) => {
                      const atual = s.mes === mes;
                      return (
                        <div key={s.mes} className="min-w-0 text-center" title={`${nomeDoMes(s.mes)}: recebido ${reais(s.recebido)}, custos lançados ${reais(s.custos)}`}>
                          <div className="mx-auto flex h-[180px] w-full max-w-[64px] items-end justify-center">
                            <span className={juntar("mr-1 block w-1/2 rounded-t-md bg-primary", !atual && "opacity-60")} style={{ height: `${Math.max(2, Math.round((s.recebido / maior) * 100))}%` }} />
                            <span className="block w-1/2 rounded-t-md bg-muted-foreground/35" style={{ height: `${Math.max(2, Math.round((s.custos / maior) * 100))}%` }} />
                          </div>
                          <span className={juntar(texto.etiqueta, "mt-2 block truncate", atual ? "text-foreground" : "text-muted-foreground")}>{nomeDoMes(s.mes, true)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardSurface>

              <CardSurface className="min-w-0 p-5 sm:p-6" data-situacao-das-empresas="">
                <span className={juntar(texto.tituloSecao, "block truncate")}>Empresas</span>
                {!f ? (
                  <div className="mt-5 h-[150px] animate-pulse rounded-md bg-muted" aria-busy="true" aria-label="Carregando as empresas" />
                ) : (
                  <>
                    <SegmentBar
                      className="mt-5"
                      height={28}
                      showLabels={false}
                      label="Empresas por situação"
                      segments={[
                        { value: f.contas.ativas, label: "Ativas", tone: 1 },
                        { value: f.contas.teste, label: "Em teste", tone: 2 },
                        { value: f.contas.atrasadas, label: "Em atraso", tone: 4 },
                        { value: f.contas.cortesia, label: "Cortesia", tone: 3 },
                      ]}
                    />
                    <ChartLegend
                      className="mt-3"
                      items={[
                        { label: "Ativas", value: f.contas.ativas, tone: 1 },
                        { label: "Em teste", value: f.contas.teste, tone: 2 },
                        { label: "Em atraso", value: f.contas.atrasadas, tone: 4 },
                        { label: "Cortesia", value: f.contas.cortesia, tone: 3 },
                        { label: "Com e-mail", value: f.contas.com_email, tone: "muted" },
                      ]}
                    />
                  </>
                )}
              </CardSurface>
            </div>
          )}

          <Secao titulo="Por empresa" descricao={f ? `${f.por_conta.length}` : undefined} recolher="produto:faturamento:contas">
            {!f ? (
              <div className="h-[180px] animate-pulse rounded-lg bg-muted" aria-busy="true" aria-label="Carregando as empresas" />
            ) : (
              <div className="min-w-0" data-faturamento-por-conta="">
                <DataTable
                  caption="Faturamento por empresa"
                  columns={COLUNAS}
                  rows={f.por_conta}
                  rowKey={(c) => c.conta_id}
                  dense
                  empty={<EstadoVazio compacto titulo="Nenhuma empresa no produto ainda." />}
                />
              </div>
            )}
          </Secao>

          {!compacto && f && (
            <Collapsible
              title="Custos do mês"
              summary={reais(f.custo_total)}
              help={AJUDA_DOS_CUSTOS}
              defaultOpen={false}
              storageKey="produto:faturamento:custos"
              card
              actions={
                <button type="button" className={botao.icone} onClick={() => setLancando(true)} aria-label="Lançar custo" title="Lançar custo">
                  <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
                </button>
              }
            >
              <ul className={juntar(lista.aberta, lista.divisoria)} data-custos-do-produto="">
                <li className={lista.linha}>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Imposto estimado sobre o recebido</span>
                  <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(f.imposto)}</span>
                </li>
                <li className={lista.linha}>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Custo fixo do produto</span>
                  <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(f.custo_fixo)}</span>
                </li>
                {f.custo_email > 0 && (
                  <li className={lista.linha}>
                    <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Caixas de e-mail além do plano gratuito</span>
                    <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(f.custo_email)}</span>
                  </li>
                )}
                {(custos.data || []).map((c) => (
                  <li key={c.id} className={lista.linha}>
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate")}>{c.descricao || ROTULO_DO_CUSTO[c.tipo] || c.tipo}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>
                        {ROTULO_DO_CUSTO[c.tipo] || c.tipo}
                        {c.estimado ? " · estimado" : ""}
                      </span>
                    </span>
                    <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(c.valor)}</span>
                    <button
                      type="button"
                      className={juntar(botao.icone, "ml-1")}
                      aria-label={`Apagar o custo ${c.descricao || c.tipo}`}
                      title="Apagar"
                      onClick={() => void casa.apagarCusto(c.id).then(reler).catch((e) => toast.error(fraseDoErro(e)))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
        </>
      )}

      {lancando && f && <LancarCusto mes={mes} contas={f.por_conta} onFechar={() => setLancando(false)} onSalvo={reler} />}
    </div>
  );
}

function LancarCusto({ mes, contas, onFechar, onSalvo }: { mes: string; contas: Faturamento["por_conta"]; onFechar: () => void; onSalvo: () => void }) {
  const [tipo, setTipo] = useState("outro");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [conta, setConta] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const v = parseFloat(valor.replace(/\./g, "").replace(",", "."));
    if (!(v > 0)) return void toast.error("Informe um valor maior que zero.");
    setSalvando(true);
    try {
      await casa.lancarCusto({ conta_id: conta || null, competencia: mes, tipo, valor: Math.round(v * 100) / 100, descricao: descricao.trim() });
      onSalvo();
      onFechar();
      toast.success("Custo lançado.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível lançar."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="sm"
      titulo="Lançar custo"
      descricao={nomeDoMes(mes)}
      rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando..." : "Lançar"}</button>}
    >
      <GrupoDeCampos colunas={1}>
        <CampoDeFormulario rotulo="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>
            {TIPOS_PARA_LANCAR.map((t) => <option key={t} value={t}>{ROTULO_DO_CUSTO[t]}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Valor (R$)" obrigatorio>
          <input value={valor} onChange={(e) => setValor(e.target.value)} className={campo} inputMode="decimal" placeholder="0,00" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="O que é">
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} maxLength={160} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Empresa" apoio="Vazio quando o custo é do produto todo">
          <select value={conta} onChange={(e) => setConta(e.target.value)} className={campo}>
            <option value="">Produto todo</option>
            {contas.map((c) => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
          </select>
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
