import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarPlus,
  CalendarRange,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { filtrarPrioridades, normalizarBusca, useRevisoesDoDossie } from "@/lib/mesa/prioridadesConhecimento";
import { rotuloDoMes, textoDoErro } from "@/lib/mesa/api";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";
import { botao, juntar, lista, superficie } from "@/components/sistema/estilos";
import { Avatar, ProgressBar, StatusPill, type Tone } from "@/components/ds";
import { NumerosOusados } from "./ousado";
import {
  mensagemDeCobranca,
  montarFila,
  useFeitoDaFila,
  useFilaDePrioridades,
  type AbaDaMesa,
  type AcaoDaFila,
  type FeitoDaFila,
  type GrupoDaFila,
  type MarcadoDaFila,
  type Nivel,
  type TipoDeAcao,
} from "@/lib/mesa/fila";

/**
 * Fila de prioridades da Mesa: uma lista curta, do mais urgente para o menos,
 * agrupada por cliente, com o porquê em uma frase e o botão que leva direto
 * para a aba certa. Regras de ordem em src/lib/mesa/fila.ts (acoesDoCliente).
 * Só clientes dentro da Mesa. Cada ação tem "Feito" para quando o sistema não
 * reconhece sozinho: some até chegar coisa nova, com "Desfazer" no aviso e na
 * lista dos marcados, no pé.
 */

const ICONE: Record<TipoDeAcao, typeof Send> = {
  resolver: AlertTriangle,
  gerar_mes: CalendarPlus,
  gerar_artes: ImagePlus,
  cobrar: BellRing,
  ajustar: Wrench,
  entregar: Send,
  revisar: Eye,
  completar_mes: CalendarRange,
};

const NIVEL: Record<Nivel, { rotulo: string; barra: string; selo: string; ponto: string; tom: Tone }> = {
  agora: { rotulo: "Agora", barra: "bg-destructive", selo: "bg-danger-soft text-destructive", ponto: "bg-destructive", tom: "danger" },
  semana: { rotulo: "Esta semana", barra: "bg-warning", selo: "bg-warning/15 text-foreground", ponto: "bg-warning", tom: "warning" },
  depois: { rotulo: "Depois", barra: "bg-border", selo: "bg-muted text-muted-foreground", ponto: "bg-muted-foreground/60", tom: "neutral" },
};

type Filtro = "tudo" | "cobrar" | "mes" | "artes" | "entrega";

const FILTROS: { chave: Filtro; rotulo: string; tipos: TipoDeAcao[] }[] = [
  { chave: "tudo", rotulo: "Tudo", tipos: [] },
  { chave: "cobrar", rotulo: "Cobrar aprovação", tipos: ["cobrar"] },
  { chave: "mes", rotulo: "Gerar mês", tipos: ["gerar_mes", "completar_mes"] },
  { chave: "artes", rotulo: "Gerar artes", tipos: ["gerar_artes", "ajustar"] },
  { chave: "entrega", rotulo: "Entregar", tipos: ["entregar", "revisar", "resolver"] },
];

const noFiltro = (f: Filtro, a: AcaoDaFila) => f === "tudo" || (FILTROS.find((x) => x.chave === f) || FILTROS[0]).tipos.indexOf(a.tipo) >= 0;

async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* tenta o jeito antigo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

const dataCurtinha = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/** "Gerar artes (outubro)" quando a ação é de um mês; senão só o título. */
const tituloComMes = (a: AcaoDaFila) => (a.mes ? `${a.titulo} (${rotuloDoMes(a.mes).split(" de ")[0]})` : a.titulo);

function LinhaDaAcao({
  acao,
  grupo,
  onAbrir,
  onFeito,
  gravando,
}: {
  acao: AcaoDaFila;
  grupo: GrupoDaFila;
  onAbrir: (clientId: string, aba: AbaDaMesa, mes: string | null) => void;
  onFeito: (grupo: GrupoDaFila, acao: AcaoDaFila) => void;
  gravando: boolean;
}) {
  const Icone = ICONE[acao.tipo];
  const nivel = NIVEL[acao.nivel];
  const cobrar = async () => {
    const link = typeof window !== "undefined" ? `${window.location.origin}/aprovacoes` : "/aprovacoes";
    const ok = await copiar(mensagemDeCobranca(grupo.nome, acao.quantidade, acao.diasEsperando || 0, link));
    if (ok) toast.success("Mensagem copiada", { description: "Cole no WhatsApp do cliente." });
    else toast.error("Não consegui copiar", { description: "Copie o texto à mão pela tela de aprovações." });
  };
  return (
    <li className="flex min-w-0 flex-wrap items-center py-3.5 sm:flex-nowrap">
      <span className={`mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${acao.nivel === "agora" ? "bg-danger-soft text-destructive" : "bg-muted text-foreground"}`}>
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center text-[13px] font-semibold leading-5">
          <span className="truncate">{acao.titulo}</span>
          <span className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${nivel.ponto}`} aria-label={nivel.rotulo} />
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{acao.motivo}</p>
      </div>
      <div className="mt-2 flex w-full shrink-0 items-center justify-end sm:ml-3 sm:mt-0 sm:w-auto">
        {acao.tipo === "cobrar" && (
          <button
            type="button"
            onClick={() => void cobrar()}
            // 16/10/2026 (dono: "texto + ícone vira só o ícone, sem bordas"): o nome fica no title e no leitor de tela.
            className={juntar(botao.icone, "mr-1.5")}
            aria-label={`Copiar mensagem de cobrança para ${grupo.nome}`}
            title="Copiar mensagem"
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          disabled={gravando}
          onClick={() => onFeito(grupo, acao)}
          className={juntar(botao.icone, "mr-1.5")}
          aria-label={`Marcar como feito: ${acao.titulo} de ${grupo.nome}`}
          title="Feito: some da fila até chegar coisa nova"
        >
          {gravando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => onAbrir(grupo.client_id, acao.aba, acao.mes)}
          // Um primário por área (28/09): cada linha tem o seu Abrir, então ele é secundário.
          className={botao.icone}
          aria-label={`${acao.titulo}: abrir ${grupo.nome}`}
          title="Abrir"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export default function FilaDePrioridades({
  clientes,
  clientesProntos,
  onAbrir,
}: {
  clientes: { id: string; nome: string }[];
  /** A lista de clientes chegou (só a leitura direta precisa dela). */
  clientesProntos: boolean;
  onAbrir: (clientId: string, aba: AbaDaMesa, mes: string | null) => void;
}) {
  const consulta = useFilaDePrioridades(clientes, clientesProntos);
  const revisoes = useRevisoesDoDossie(clientes, clientesProntos);
  const [busca, setBusca] = useState("");
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const [verEmDia, setVerEmDia] = useState(false);
  const [verMarcados, setVerMarcados] = useState(false);
  const [gravando, setGravando] = useState<string | null>(null);
  const fila = useMemo(() => (consulta.data ? montarFila(consulta.data) : null), [consulta.data]);
  const { marcar, desfazer } = useFeitoDaFila();

  const desfazerFeito = async (clientId: string, nome: string, titulo: string, feito: FeitoDaFila) => {
    setGravando(feito.id);
    try {
      await desfazer(clientId, feito);
      toast.success("Voltou para a fila", { description: `${titulo}, ${nome}.` });
    } catch (e) {
      toast.error("Não consegui desfazer", { description: textoDoErro(e) });
    } finally {
      setGravando(null);
    }
  };

  const marcarFeito = async (g: GrupoDaFila, a: AcaoDaFila) => {
    setGravando(`${g.client_id}-${a.tipo}-${a.periodo}`);
    try {
      const feito = await marcar(g.client_id, a);
      toast.success("Marcado como feito", {
        description: `${a.titulo}, ${g.nome}. Volta se chegar coisa nova.`,
        action: { label: "Desfazer", onClick: () => void desfazerFeito(g.client_id, g.nome, a.titulo, feito) },
      });
    } catch (e) {
      toast.error("Não consegui marcar como feito", { description: textoDoErro(e) });
    } finally {
      setGravando(null);
    }
  };

  const contagem = (f: Filtro) => (fila ? fila.grupos.filter(g => normalizarBusca(g.nome).includes(normalizarBusca(busca))).reduce((s, g) => s + g.acoes.filter((a) => noFiltro(f, a)).length, 0) : 0);
  const grupos = fila ? filtrarPrioridades(fila.grupos, busca, FILTROS.find(f => f.chave === filtro)?.tipos) : [];
  const primeiro = grupos[0];
  const emDia = (fila?.emDia || []).filter(c => normalizarBusca(c.nome).includes(normalizarBusca(busca)));
  const marcados = (fila?.marcados || []).filter(c => normalizarBusca(c.nome).includes(normalizarBusca(busca)));
  const revisoesVisiveis = (revisoes.data || []).filter(c => normalizarBusca(c.nome).includes(normalizarBusca(busca)));

  return (
    <section aria-label="Prioridades" className="min-w-0 space-y-5 sm:space-y-6">
      {/* Cabeçalho do sistema: título, o "?" com a explicação e o resumo à direita. */}
      <CabecalhoDePagina
        nivel={2}
        titulo="O que fazer agora"
        ajuda="Cada cliente com a próxima ação, do mais urgente para o menos."
        acoes={
        <div className="flex items-center">
          {fila && (
            <ul className="mr-2 flex items-center text-[12px] sm:hidden" aria-label="Resumo">
              {(["agora", "semana", "depois"] as Nivel[]).map((n) => (
                <li key={n} className="mr-3 inline-flex items-center last:mr-0 max-sm:mr-2" title={`${fila.resumo[n]} ${NIVEL[n].rotulo.toLowerCase()}`}>
                  <span className={`mr-1.5 h-2 w-2 rounded-full ${NIVEL[n].ponto}`} />
                  <strong className="mr-1 font-semibold tabular-nums">{fila.resumo[n]}</strong>
                  <span className="text-muted-foreground max-sm:sr-only">{NIVEL[n].rotulo.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => { void consulta.refetch(); void revisoes.refetch(); }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Atualizar prioridades"
            title="Atualizar"
          >
            {consulta.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Buscar cliente nas prioridades" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente" className="h-9 max-w-xs" />
        {consulta.dataUpdatedAt > 0 && <span className="ml-auto text-[11px] text-muted-foreground max-sm:hidden">Conferido às {new Date(consulta.dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
      {primeiro && !consulta.isError && <div className={juntar(superficie.painel, superficie.destaque, "flex flex-wrap items-center p-5 sm:p-6")} data-card="accent" aria-label="Próxima ação recomendada">
        <div className="mb-3 mr-4 min-w-0 flex-1 sm:mb-0"><p className="text-[12px] font-medium leading-4 text-muted-foreground">Comece por aqui · {primeiro.nome}</p><p className="mt-2 text-[20px] font-semibold leading-7 tracking-[-0.02em] text-foreground sm:text-[24px] sm:leading-8">{tituloComMes(primeiro.acoes[0])}</p><p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{primeiro.acoes[0].motivo}</p></div>
        <button type="button" className={juntar(botao.primario, "h-11 bg-foreground px-5 text-[13px] text-background hover:bg-foreground/90")} onClick={() => onAbrir(primeiro.client_id, primeiro.acoes[0].aba, primeiro.acoes[0].mes)}>Começar <ArrowRight className="ml-2 h-4 w-4" /></button>
      </div>}

      {/* Rodada ousada (15/11/2026): os três níveis em número grande (a contagem que a fila já traz). */}
      {fila && fila.grupos.length > 0 && (
        <NumerosOusados
          rotulo="Ações por urgência"
          colunas={3}
          destaque={-1}
          tinta={0}
          data-resumo-da-fila=""
          itens={(["agora", "semana", "depois"] as Nivel[]).map((n) => ({
            rotulo: NIVEL[n].rotulo,
            valor: fila.resumo[n],
            grafico: <ProgressBar value={fila.resumo[n]} max={Math.max(1, fila.resumo.agora + fila.resumo.semana + fila.resumo.depois)} tone={n === "agora" ? 4 : n === "semana" ? 2 : "muted"} label={`${fila.resumo[n]} de ${fila.resumo.agora + fila.resumo.semana + fila.resumo.depois} ações`} />,
          }))}
        />
      )}

      {fila && fila.grupos.length > 0 && (
        <div role="group" aria-label="Filtrar por ação" className="flex flex-wrap">
          {FILTROS.map((f) => {
            const n = f.chave === "tudo" ? null : contagem(f.chave);
            if (n === 0) return null;
            return (
              <button
                key={f.chave}
                type="button"
                aria-pressed={filtro === f.chave}
                onClick={() => setFiltro(f.chave)}
                className={`mb-2 mr-2 inline-flex h-9 items-center rounded-full border px-4 text-[13px] font-medium transition-colors ${
                  filtro === f.chave ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.rotulo}
                {n !== null && <span className="ml-1.5 tabular-nums opacity-70">{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      {(consulta.isLoading || (!consulta.data && !consulta.isError)) && (
        <div aria-busy="true" aria-label="Carregando prioridades" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {consulta.isError && (
        <p className="rounded-md bg-destructive/10 p-3 text-[13px] text-destructive">
          Não consegui montar a fila. {textoDoErro(consulta.error)}
        </p>
      )}

      {fila && fila.grupos.length === 0 && (
        <div className="flex items-center py-3">
          <CheckCircle2 className="mr-3 h-5 w-5 shrink-0 text-success" />
          <p className="text-[13px]">Tudo em dia. Nenhum cliente precisa de ação agora.</p>
        </div>
      )}

      {grupos.length > 0 && (
        <ol className="space-y-3 sm:space-y-4">
          {grupos.map((g, i) => {
            const nivel = NIVEL[g.acoes[0].nivel];
            return (
              // Cada cliente é uma coisa só (grupo de ações): o cartão sólido do sistema, com a faixa do nível.
              <li key={g.client_id} className={juntar(superficie.painel, "relative overflow-hidden")} data-nivel={g.acoes[0].nivel}>
                <div className="px-5 pb-2 pt-5 sm:px-6">
                  <div className="flex min-w-0 items-center">
                    <span className="relative mr-3 shrink-0">
                      <Avatar name={g.nome} tone={i === 0 ? "ink" : "neutral"} />
                      <span className="absolute -bottom-1 -right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-muted px-1 text-[11px] font-semibold leading-none tabular-nums text-muted-foreground">{i + 1}</span>
                    </span>
                    <h3 className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-6 tracking-[-0.02em]">{g.nome}</h3>
                    <button type="button" className="ml-2 text-[12px] leading-4 text-muted-foreground hover:text-primary" aria-label={`Abrir conhecimento de ${g.nome}`} onClick={() => onAbrir(g.client_id, "contexto", null)}>Contexto</button>
                    <StatusPill className="ml-2" tone={nivel.tom}>{nivel.rotulo}</StatusPill>
                  </div>
                  {g.pronto && (
                    <p className="ml-[52px] mt-0.5 flex min-w-0 items-center text-[12px] text-muted-foreground">
                      <CheckCircle2 className="mr-1 h-3 w-3 shrink-0 text-success" />
                      <span className="truncate">{g.pronto}</span>
                    </p>
                  )}
                  <ul className="mt-2 divide-y divide-border/70">
                    {(expandidos[g.client_id] ? g.acoes : g.acoes.slice(0, 1)).map((a) => (
                      <LinhaDaAcao
                        key={`${a.tipo}-${a.mes || ""}`}
                        acao={a}
                        grupo={g}
                        onAbrir={onAbrir}
                        onFeito={(gg, aa) => void marcarFeito(gg, aa)}
                        gravando={gravando === `${g.client_id}-${a.tipo}-${a.periodo}`}
                      />
                    ))}
                  </ul>
                  {g.acoes.length > 1 && <button type="button" aria-expanded={!!expandidos[g.client_id]} className="mb-3 ml-[52px] text-[12px] leading-4 text-muted-foreground hover:text-foreground" onClick={() => setExpandidos(v => ({ ...v, [g.client_id]: !v[g.client_id] }))}>{expandidos[g.client_id] ? "Recolher outras ações" : `Mais ${g.acoes.length - 1} ${g.acoes.length === 2 ? "ação" : "ações"} deste cliente`}</button>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {fila && fila.grupos.length > 0 && grupos.length === 0 && (
        <p className="rounded-lg bg-muted/50 p-5 text-center text-[13px] text-muted-foreground">Nada com esse filtro.</p>
      )}

      {fila && emDia.length > 0 && (
        <div className="text-[12px] text-muted-foreground">
          <button type="button" onClick={() => setVerEmDia((v) => !v)} className="inline-flex items-center hover:text-foreground" aria-expanded={verEmDia}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-success" />
            {emDia.length === 1 ? "1 cliente em dia" : `${emDia.length} clientes em dia`}
          </button>
          {verEmDia && (
            <ul className="mt-2 flex flex-wrap">
              {emDia.map((c) => (
                <li key={c.client_id} className="mb-1.5 mr-1.5">
                  <button
                    type="button"
                    onClick={() => onAbrir(c.client_id, "mes", null)}
                    title={c.pronto || undefined}
                    className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] text-foreground transition-colors hover:bg-muted"
                  >
                    {c.nome}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {revisoes.isError && <p className="text-[12px] leading-4 text-muted-foreground">A revisão dos dossiês não pôde ser consultada. Atualize para tentar novamente.</p>}
      {revisoesVisiveis.length > 0 && <details className="rounded-lg border border-border p-5">
        <summary className="cursor-pointer text-[13px] leading-5 font-medium">Contextos a conferir <span className="text-muted-foreground">({revisoesVisiveis.length})</span></summary>
        <p className="mt-2 text-[12px] leading-4 text-muted-foreground">A data sinaliza uma revisão; não significa que as informações estejam erradas.</p>
        <ul className="mt-2 divide-y divide-border">{revisoesVisiveis.map(c => <li key={c.id} className="flex items-center gap-3 py-2"><div className="min-w-0 flex-1"><p className="truncate text-[13px] leading-5">{c.nome}</p><p className="text-[12px] leading-4 text-muted-foreground">{c.motivo}</p></div><button className={juntar(botao.secundario, "h-8 px-3 text-[12px] leading-4")} onClick={() => onAbrir(c.id, "contexto", null)}>Revisar</button></li>)}</ul>
      </details>}

      {fila && marcados.length > 0 && (
        <div className="text-[12px] text-muted-foreground">
          <button type="button" onClick={() => setVerMarcados((v) => !v)} className="inline-flex items-center hover:text-foreground" aria-expanded={verMarcados}>
            <Check className="mr-1.5 h-3.5 w-3.5 text-success" />
            {marcados.length === 1 ? "1 marcado como feito" : `${marcados.length} marcados como feito`}
          </button>
          {verMarcados && (
            <ul className={juntar(lista.aberta, lista.divisoria, "mt-2")} aria-label="Marcados como feito">
              {marcados.map((m: MarcadoDaFila) => (
                <li key={m.feito.id} className={lista.linha}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground">
                      <strong className="font-semibold">{m.nome}</strong>: {tituloComMes(m.acao)}
                    </p>
                    <p className="truncate text-[12px]">
                      Feito{m.feito.marcado_por_nome ? ` por ${m.feito.marcado_por_nome}` : ""}
                      {m.feito.marcado_em ? ` em ${dataCurtinha(m.feito.marcado_em)}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={gravando === m.feito.id}
                    onClick={() => void desfazerFeito(m.client_id, m.nome, m.acao.titulo, m.feito)}
                    className={juntar(botao.icone, "ml-3 disabled:opacity-60")}
                    aria-label={`Desfazer feito: ${m.acao.titulo} de ${m.nome}`}
                    title="Desfazer"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {consulta.data && consulta.data.origem === "direto" && (
        <p className="flex items-center text-[12px] text-muted-foreground">
          Lido direto das tabelas
          <AjudaRecolhida className="ml-1" rotulo="Por que direto das tabelas">
            A função da fila ainda não foi aplicada no banco, então o último acesso de cada cliente não aparece.
          </AjudaRecolhida>
        </p>
      )}
    </section>
  );
}
