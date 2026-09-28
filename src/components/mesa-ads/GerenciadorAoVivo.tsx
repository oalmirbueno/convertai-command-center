import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, ExternalLink, FileSearch, Loader2, MoreHorizontal, Pause, Play, PlayCircle, RefreshCw, Sparkles, Undo2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { botao, campo, foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { brl, decimal, inteiro, porcento, type AnuncioAoVivo } from "./adsApi";
import { Diagnostico, Foto, SeloDoSinal } from "./Comuns";
import { chavesRotina, desfazerAcaoFeita } from "./rotinaApi";
import { type PeriodoDaConsulta } from "./periodoDaConta";
import {
  acharNo,
  agirNoGerenciador,
  chaveDoAnuncioAberto,
  chaveDoGerenciador,
  diagnosticoCurto,
  faixaDaVerba,
  filtrarArvore,
  horaDeBrasilia,
  lerAnuncioAberto,
  lerGerenciador,
  nosDoNivel,
  totalDaLista,
  type AcaoDoGerenciador,
  type ContaNaTela,
  type EstadoDaEntrega,
  type FiltroDoGerenciador,
  type ItemDoDiagnostico,
  type LeituraDoGerenciador,
  type NivelNoGerenciador,
  type NoNoGerenciador,
  type ResultadoDaAcaoNaTela,
} from "./gerenciadorApi";

/**
 * Gerenciador ao vivo (frente AD, 28/09; refeito na frente AD3 no mesmo dia).
 *
 * Pedido do dono (AD): "abrir a telinha do gerenciador de anúncios dentro do painel, o real da Meta,
 * para fazer tudo por um lugar só". A Meta não deixa embutir o Gerenciador dela; esta tela é fiel a ele.
 *
 * AD3: "tem que ser igual ao formato do Gerenciador de Anúncios da Meta, organizadinho; quando vou
 * abrindo já fica confuso; abrir com cores diferentes (campanha, conjunto, anúncio), sem muito texto;
 * clicar e abrir, já ver o criativo, avaliar e analisar; na linha, Pausar, Retomar e Otimizar".
 * - Abas Campanhas | Conjuntos | Anúncios, cada nível com a sua cor (faixa à esquerda e ponto na aba).
 * - Tabela com colunas alinhadas (Entrega, Orçamento, Resultados, Custo por resultado, Gasto, Alcance,
 *   Impressões, CTR, CPM, Frequência) e a linha de total, como a da Meta. Rola para o lado por dentro.
 * - Clicar no nome desce um nível (campanha abre os conjuntos dela; conjunto, os anúncios); a seta abre
 *   por baixo, sem sair da aba. Clicar no anúncio abre o painel ao lado com o criativo, os números, o
 *   diagnóstico curto (qualidade, fadiga, aprendizado) e as ações.
 * - Pausar e Retomar na linha abrem a confirmação (relê antes, faz, relê depois, com a prova e o
 *   Desfazer); Otimizar leva o item ao agente sênior, sem criar do zero.
 *
 * `SituacaoDaConta` (o topo da aba) usa a mesma leitura.
 */

/** Relê sozinho enquanto a aba está aberta (a função guarda 45 s; "Atualizar agora" relê na hora). */
export const RELEITURA_DO_GERENCIADOR_MS = 2 * 60_000;

export function useGerenciador(clientId: string, periodo: PeriodoDaConsulta) {
  return useQuery({
    queryKey: chaveDoGerenciador(clientId, periodo),
    queryFn: () => lerGerenciador(clientId, periodo),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: RELEITURA_DO_GERENCIADOR_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

const TOM_DA_ENTREGA: Record<EstadoDaEntrega, string> = {
  entregando: "text-success",
  ativo: "text-success",
  ativo_sem_entrega: "text-warning",
  conta_travada: "text-destructive",
  reprovado: "text-destructive",
  com_problema: "text-destructive",
  em_analise: "text-primary",
  pausado: "text-muted-foreground",
  encerrado: "text-muted-foreground",
};
const PONTO_DA_ENTREGA: Record<EstadoDaEntrega, string> = {
  entregando: "bg-success",
  ativo: "bg-success/60",
  ativo_sem_entrega: "bg-warning",
  conta_travada: "bg-destructive",
  reprovado: "bg-destructive",
  com_problema: "bg-destructive",
  em_analise: "bg-primary",
  pausado: "bg-muted-foreground/40",
  encerrado: "bg-muted-foreground/25",
};

/** Entrega como a Meta mostra: um ponto e a palavra (o motivo fica no título). */
export function SeloDaEntrega({ n }: { n: NoNoGerenciador }) {
  return (
    <span className={juntar("inline-flex min-w-0 shrink-0 items-center text-[12px] font-medium", TOM_DA_ENTREGA[n.entrega.estado])} data-entrega={n.entrega.estado} title={n.entrega.motivo || undefined}>
      <span className={juntar("mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full", PONTO_DA_ENTREGA[n.entrega.estado])} aria-hidden="true" />
      <span className="truncate">{n.entrega.rotulo}</span>
    </span>
  );
}

/** A cor de cada nível (discreta): faixa à esquerda da linha, ponto na aba e fundo leve de quem abre por baixo. */
export const COR_DO_NIVEL: Record<NivelNoGerenciador, { faixa: string; ponto: string; fundo: string; texto: string }> = {
  campanha: { faixa: "bg-sky-500", ponto: "bg-sky-500", fundo: "", texto: "text-sky-600 dark:text-sky-400" },
  conjunto: { faixa: "bg-violet-500", ponto: "bg-violet-500", fundo: "bg-violet-500/[0.04]", texto: "text-violet-600 dark:text-violet-400" },
  anuncio: { faixa: "bg-amber-500", ponto: "bg-amber-500", fundo: "bg-amber-500/[0.05]", texto: "text-amber-600 dark:text-amber-400" },
};

const QUEM: Record<string, string> = { agente: "pelo agente", rotina: "pela rotina", equipe: "por você" };

/** "Pausado pelo agente às 10:32" com o Desfazer, ou a tentativa que não deu. */
function MarcaDaAcao({ n, fazendo, onDesfazer }: { n: NoNoGerenciador; fazendo: boolean; onDesfazer: () => void }) {
  const m = n.marca;
  if (!m) return null;
  const hora = horaDeBrasilia(m.quando);
  if (m.estado === "falhou") {
    return (
      <p className="mt-0.5 truncate text-[11.5px] leading-snug text-destructive" data-marca="falhou" title={m.resumo}>
        {hora ? `${hora}: ` : ""}
        {m.resumo}
      </p>
    );
  }
  return (
    <p className="mt-0.5 flex min-w-0 items-center text-[11.5px] leading-snug text-primary" data-marca={m.estado}>
      <span className="mr-1.5 min-w-0 truncate" title={m.resumo}>
        {m.estado === "desfeita" ? "Desfeito: " : ""}
        {m.resumo.replace(/\.$/, "")} {QUEM[m.origem] || ""}
        {hora ? ` às ${hora}` : ""}
      </span>
      {m.pode_desfazer && (
        <button type="button" className={juntar("inline-flex shrink-0 items-center rounded font-medium underline-offset-2 hover:underline", foco)} disabled={fazendo} onClick={onDesfazer} aria-label={`Desfazer: ${m.resumo}`}>
          {fazendo ? <Loader2 className="mr-0.5 h-3 w-3 animate-spin" /> : <Undo2 className="mr-0.5 h-3 w-3" />}
          Desfazer
        </button>
      )}
    </p>
  );
}

const statusTexto = (s: string | null | undefined) => (s === "PAUSED" ? "pausado" : s === "ACTIVE" ? "ativo" : s ? s.toLowerCase() : "sem leitura");

/** A prova da ação: o que foi lido antes, o que a Meta respondeu e o que foi relido depois, com a hora. */
export function ProvaDaAcao({ r, tipo }: { r: ResultadoDaAcaoNaTela; tipo: AcaoDoGerenciador }) {
  const valor = (e: ResultadoDaAcaoNaTela["antes"]) =>
    !e ? "sem leitura" : tipo === "renomear" ? `"${e.nome || ""}"` : tipo === "orcamento" ? `${brl(e.orcamento_diario_brl)} por dia` : statusTexto(e.status);
  if (!r.ok) {
    return (
      <div className="mt-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-[12px] leading-snug" data-prova-da-acao="nao-feito" role="status">
        <p className="flex items-start font-medium text-destructive">
          <X className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">Não fiz: {r.motivo || "a Meta recusou."}</span>
        </p>
        <p className="mt-0.5 text-muted-foreground">Nada mudou na conta.</p>
      </div>
    );
  }
  return (
    <div className="mt-1.5 rounded-md bg-success/10 px-2.5 py-2 text-[12px] leading-snug" data-prova-da-acao="feito" role="status">
      <p className="flex items-center font-medium text-success">
        <Check className="mr-1 h-3.5 w-3.5 shrink-0" />
        Feito e conferido na Meta{r.relido_em ? ` às ${horaDeBrasilia(r.relido_em)}` : ""}
      </p>
      <p className="mt-0.5 [overflow-wrap:anywhere]">
        Antes: {valor(r.antes)} · Depois (relido na Meta): {valor(r.depois)}
        {r.resposta && typeof r.resposta.success === "boolean" ? ` · A Meta respondeu: ${r.resposta.success ? "sucesso" : "sem sucesso"}` : ""}
      </p>
    </div>
  );
}

const NIVEL_ROTULO: Record<NivelNoGerenciador, string> = { campanha: "Campanha", conjunto: "Conjunto", anuncio: "Anúncio" };
const artigo = (nivel: string) => (nivel === "campanha" ? "a campanha" : nivel === "conjunto" ? "o conjunto" : "o anúncio");
const ehAtivo = (n: NoNoGerenciador) => (n.status || n.efetivo || "").toUpperCase() === "ACTIVE";
const encerrado = (n: NoNoGerenciador) => n.entrega.estado === "encerrado";

function PainelDaAcao({
  n,
  gestao,
  tipoInicial = null,
  onFechar,
  onFeito,
}: {
  n: NoNoGerenciador;
  gestao: LeituraDoGerenciador["gestao"];
  tipoInicial?: AcaoDoGerenciador | null;
  onFechar: () => void;
  onFeito: (r: ResultadoDaAcaoNaTela) => void;
}) {
  const { clientId } = useMesa();
  const avisarErro = useAvisarErro();
  const ativo = ehAtivo(n);
  const temVerba = n.nivel !== "anuncio" && n.orcamento_diario_brl !== null;
  const [tipo, setTipo] = useState<AcaoDoGerenciador | null>(tipoInicial);
  const [nome, setNome] = useState(n.nome);
  const faixa = faixaDaVerba(n.orcamento_diario_brl);
  const [verba, setVerba] = useState(n.orcamento_diario_brl !== null ? String(n.orcamento_diario_brl).replace(".", ",") : "");
  const [fazendo, setFazendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDaAcaoNaTela | null>(null);
  useEffect(() => {
    if (tipoInicial) {
      setTipo(tipoInicial);
      setResultado(null);
    }
  }, [tipoInicial]);

  const verbaNumero = Number(verba.replace(/\./g, "").replace(",", "."));
  const verbaValida = faixa !== null && isFinite(verbaNumero) && verbaNumero >= faixa.min && verbaNumero <= faixa.max && Math.abs(verbaNumero - (n.orcamento_diario_brl || 0)) >= 0.01;

  const fazer = async (ev?: FormEvent) => {
    if (ev) ev.preventDefault();
    if (!tipo) return;
    setFazendo(true);
    setResultado(null);
    try {
      const r = await agirNoGerenciador(clientId, n, tipo, tipo === "renomear" ? { nome: nome.trim() } : tipo === "orcamento" ? { orcamento_diario_brl: Math.round(verbaNumero * 100) / 100 } : undefined);
      setResultado(r);
      onFeito(r);
      if (r.ok) toast.success("Feito e conferido na Meta", { description: r.resumo || undefined });
      else toast.warning("Não foi feito", { description: r.motivo || undefined });
    } catch (e) {
      avisarErro(e, "Não foi possível fazer na Meta");
    } finally {
      setFazendo(false);
    }
  };

  const escolha = (t: AcaoDoGerenciador, rotulo: ReactNode, icone: ReactNode, desabilitado = false) => (
    <button type="button" className={juntar(tipo === t ? botao.primario : botao.secundario, "mb-1.5 mr-1.5 h-8 text-[12px]")} disabled={desabilitado || fazendo} onClick={() => { setTipo(t); setResultado(null); }} aria-pressed={tipo === t}>
      {icone}
      {rotulo}
    </button>
  );

  return (
    <div className="min-w-0 rounded-md border border-border bg-background p-2.5" aria-label={`Ações em ${n.nome}`} role="group">
      {gestao && !gestao.disponivel && (
        <p className="mb-2 flex items-start rounded bg-warning/10 px-2 py-1.5 text-[11.5px] leading-snug">
          <AlertTriangle className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 [overflow-wrap:anywhere]">Agora a Meta não deixa mexer: {gestao.motivo || "sem permissão de gestão."} Se tentar, o painel confere de novo e diz o motivo.</span>
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center">
        {ativo ? escolha("pausar", "Pausar", <Pause className="mr-1 h-3.5 w-3.5" />) : escolha("ativar", "Retomar", <Play className="mr-1 h-3.5 w-3.5" />)}
        {temVerba && escolha("orcamento", "Mudar verba diária", null)}
        {escolha("renomear", "Renomear", null)}
        {n.link_meta && (
          <a href={n.link_meta} target="_blank" rel="noopener noreferrer" className={juntar(botao.discreto, "mb-1.5 mr-1.5 h-8 text-[12px]")}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Abrir na Meta
          </a>
        )}
        <button type="button" className={juntar(botao.icone, "mb-1.5 ml-auto")} onClick={onFechar} aria-label="Fechar as ações">
          <X className="h-4 w-4" />
        </button>
      </div>
      {tipo && !resultado && (
        <form onSubmit={fazer} className="mt-1 min-w-0 text-[12px]">
          {tipo === "renomear" && (
            <label className="block min-w-0">
              <span className="mb-1 block text-muted-foreground">Nome novo</span>
              <input className={juntar(campo, "h-8 text-[12.5px]")} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={250} aria-label="Nome novo" />
            </label>
          )}
          {tipo === "orcamento" && (
            <label className="block min-w-0">
              <span className="mb-1 block text-muted-foreground">
                Verba diária em reais (hoje {brl(n.orcamento_diario_brl)}; pelo painel, de {brl(faixa ? faixa.min : null)} a {brl(faixa ? faixa.max : null)}, 30% por vez)
              </span>
              <input className={juntar(campo, "h-8 w-40 text-[12.5px] tabular-nums")} inputMode="decimal" value={verba} onChange={(e) => setVerba(e.target.value)} aria-label="Verba diária nova" />
            </label>
          )}
          <p className="mt-1.5 leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            {tipo === "pausar" && `Pausar ${artigo(n.nivel)} ${n.nome}. `}
            {tipo === "ativar" && `Retomar ${artigo(n.nivel)} ${n.nome}: volta a gastar a verba. `}
            O painel relê na Meta antes, faz, relê de novo e mostra a prova. Dá para desfazer.
          </p>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
            <button
              type="submit"
              className={juntar(tipo === "ativar" ? botao.primario : botao.secundario, "mb-1 mr-1.5 h-8 text-[12px]")}
              disabled={fazendo || (tipo === "renomear" && (!nome.trim() || nome.trim() === n.nome)) || (tipo === "orcamento" && !verbaValida)}
            >
              {fazendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
              {fazendo ? "Relendo na Meta, fazendo e conferindo" : "Confirmar"}
            </button>
            <button type="button" className={juntar(botao.discreto, "mb-1 h-8 text-[12px]")} disabled={fazendo} onClick={() => setTipo(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {resultado && tipo && <ProvaDaAcao r={resultado} tipo={tipo} />}
    </div>
  );
}

// ------------------------------------------------------------------ a tabela

/** Colunas da tabela, na ordem da Meta. Larguras fixas: as linhas alinham entre si. */
const COLUNAS = "minmax(260px,2.2fr) 150px 116px 116px 112px 104px 96px 104px 76px 92px 84px";
const LARGURA_MINIMA = "min-w-[1330px]";

const CABECALHO: { rotulo: string; dica?: string }[] = [
  { rotulo: "Entrega", dica: "O que a Meta está fazendo agora com o item (lido na hora)." },
  { rotulo: "Orçamento", dica: "Verba diária ou total. Conjunto sem verba própria usa a da campanha." },
  { rotulo: "Resultados", dica: "O resultado certo para o objetivo de cada campanha, no período." },
  { rotulo: "Custo por resultado" },
  { rotulo: "Gasto", dica: "Valor usado no período; embaixo, o de hoje lido na Meta." },
  { rotulo: "Alcance", dica: "Aproximado: impressões divididas pela frequência média (a Meta não soma alcance entre dias)." },
  { rotulo: "Impressões" },
  { rotulo: "CTR", dica: "Cliques no link divididos pelas impressões." },
  { rotulo: "CPM", dica: "Custo por mil impressões." },
  { rotulo: "Frequência", dica: "Quantas vezes, em média, cada pessoa viu." },
];

const ROTULO_DAS_ABAS: Record<NivelNoGerenciador, string> = { campanha: "Campanhas", conjunto: "Conjuntos", anuncio: "Anúncios" };
const NIVEIS: NivelNoGerenciador[] = ["campanha", "conjunto", "anuncio"];

function Celula({ children, className = "", titulo }: { children?: ReactNode; className?: string; titulo?: string }) {
  return (
    <div role="cell" className={juntar("min-w-0 px-2.5 py-2 text-right text-[12.5px] tabular-nums", className)} title={titulo}>
      {children}
    </div>
  );
}

const semDado = <span className="text-muted-foreground/60">sem dado</span>;

function orcamentoDe(n: NoNoGerenciador): ReactNode {
  if (n.orcamento_diario_brl !== null) return <>{brl(n.orcamento_diario_brl)}<span className="block text-[11px] text-muted-foreground">por dia</span></>;
  if (n.orcamento_total_brl !== null) return <>{brl(n.orcamento_total_brl)}<span className="block text-[11px] text-muted-foreground">total</span></>;
  if (n.nivel === "conjunto") return <span className="text-[11.5px] text-muted-foreground">Na campanha</span>;
  if (n.nivel === "campanha") return <span className="text-[11.5px] text-muted-foreground">Nos conjuntos</span>;
  return null;
}

/** As colunas de números de uma linha (as mesmas da linha de total). */
function Numeros({ n }: { n: NoNoGerenciador }) {
  const m = n.metricas;
  return (
    <>
      <Celula className="text-left">
        <SeloDaEntrega n={n} />
      </Celula>
      <Celula>{orcamentoDe(n)}</Celula>
      <Celula>
        {m ? (
          <>
            {inteiro(m.resultados)}
            <span className="block truncate text-[11px] text-muted-foreground" title={m.resultado_rotulo}>{m.resultado_rotulo}</span>
          </>
        ) : semDado}
      </Celula>
      <Celula>{m && m.custo_por_resultado !== null ? brl(m.custo_por_resultado) : semDado}</Celula>
      <Celula>
        {m ? brl(m.gasto) : brl(0)}
        {n.hoje && n.hoje.gasto > 0 ? <span className="block text-[11px] text-muted-foreground">hoje {brl(n.hoje.gasto)}</span> : null}
      </Celula>
      <Celula>{m && m.alcance !== null ? inteiro(m.alcance) : semDado}</Celula>
      <Celula>{m ? inteiro(m.impressoes) : semDado}</Celula>
      <Celula>{m && m.ctr_link !== null ? porcento(m.ctr_link) : semDado}</Celula>
      <Celula>{m && m.cpm !== null ? brl(m.cpm) : semDado}</Celula>
      <Celula>{m && m.frequencia !== null ? decimal(m.frequencia) : semDado}</Celula>
    </>
  );
}

type Miniaturas = Record<string, AnuncioAoVivo & { formato?: string | null }>;

interface LinhaProps {
  n: NoNoGerenciador;
  profundidade: number;
  abertos: Record<string, boolean>;
  onAlternar: (id: string) => void;
  acoesDe: { id: string; tipo: AcaoDoGerenciador | null } | null;
  onAcoes: (v: { id: string; tipo: AcaoDoGerenciador | null } | null) => void;
  gestao: LeituraDoGerenciador["gestao"];
  desfazendo: string | null;
  onDesfazer: (acaoId: string) => void;
  onFeito: () => void;
  onDescer: (n: NoNoGerenciador) => void;
  onOtimizar?: (n: NoNoGerenciador) => void;
  miniaturas: Miniaturas;
  aberto: string | null;
}

function Linha(p: LinhaProps) {
  const { n, profundidade } = p;
  const aberto = !!p.abertos[n.id];
  const cor = COR_DO_NIVEL[n.nivel];
  const mostrarMotivo = profundidade === 0 && n.entrega.motivo && n.entrega.estado !== "entregando" && n.entrega.estado !== "pausado" && n.entrega.estado !== "encerrado";
  const semGestao = !!p.gestao && !p.gestao.disponivel;
  const mini = n.nivel === "anuncio" ? p.miniaturas[n.id] : undefined;
  const acoesAqui = p.acoesDe && p.acoesDe.id === n.id;
  const recuo = profundidade === 0 ? "pl-3" : profundidade === 1 ? "pl-7" : "pl-11";
  const linkPequeno = juntar("toque-compacto inline-flex h-6 items-center rounded px-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50", foco);
  return (
    <>
      <div
        role="row"
        className={juntar("grid min-w-0 border-t border-border", profundidade ? cor.fundo : "", p.aberto === n.id ? "bg-primary/5" : "hover:bg-muted/30")}
        style={{ gridTemplateColumns: COLUNAS }}
        data-no={n.id}
        data-nivel={n.nivel}
      >
        <div role="cell" className={juntar("sticky left-0 z-[1] min-w-0 bg-card py-2 pr-2", recuo)}>
          <span className={juntar("absolute bottom-0 left-0 top-0 w-[3px]", cor.faixa)} aria-hidden="true" />
          <div className="flex min-w-0 items-start">
            {n.filhos.length ? (
              <button type="button" className={juntar(botao.icone, "-ml-1 mr-0.5 h-6 w-6")} onClick={() => p.onAlternar(n.id)} aria-expanded={aberto} aria-label={`${aberto ? "Fechar" : "Abrir"} ${NIVEL_ROTULO[n.nivel].toLowerCase()} ${n.nome}`}>
                <ChevronRight className={juntar("h-4 w-4 transition-transform", aberto ? "rotate-90" : "")} />
              </button>
            ) : n.nivel !== "anuncio" ? (
              <span className="-ml-1 mr-0.5 inline-block h-6 w-6 shrink-0" aria-hidden="true" />
            ) : null}
            {n.nivel === "anuncio" && (
              <button type="button" className="mr-2 block h-9 w-9 shrink-0 overflow-hidden rounded border border-border bg-secondary/40" onClick={() => p.onDescer(n)} aria-label={`Ver o criativo de ${n.nome}`} tabIndex={-1}>
                <Foto src={mini ? mini.imagem_url : null} alt="" className="h-full w-full text-[0px]" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className={juntar("block max-w-full truncate rounded text-left text-[13px] font-semibold leading-5 text-foreground hover:text-primary hover:underline", foco)}
                onClick={() => p.onDescer(n)}
                title={n.nivel === "campanha" ? "Ver os conjuntos desta campanha" : n.nivel === "conjunto" ? "Ver os anúncios deste conjunto" : "Abrir o anúncio: criativo, números e diagnóstico"}
              >
                {n.nome}
              </button>
              {mostrarMotivo && <p className="truncate text-[11.5px] leading-snug text-muted-foreground" title={n.entrega.motivo || undefined}>{n.entrega.motivo}</p>}
              <MarcaDaAcao n={n} fazendo={!!n.marca && p.desfazendo === n.marca.acao_id} onDesfazer={() => n.marca && p.onDesfazer(n.marca.acao_id)} />
              {/* Na linha, como pediu o dono: Pausar ou Retomar, Otimizar e o resto no "...". */}
              <div className="-ml-1.5 mt-0.5 flex min-w-0 items-center">
                {!encerrado(n) && (
                  ehAtivo(n) ? (
                    <button type="button" className={linkPequeno} disabled={semGestao} title={semGestao ? (p.gestao && p.gestao.motivo) || "Só leitura agora" : undefined} onClick={() => p.onAcoes({ id: n.id, tipo: "pausar" })} aria-label={`Pausar ${n.nome}`}>
                      <Pause className="mr-1 h-3 w-3" />
                      Pausar
                    </button>
                  ) : (
                    <button type="button" className={linkPequeno} disabled={semGestao} title={semGestao ? (p.gestao && p.gestao.motivo) || "Só leitura agora" : undefined} onClick={() => p.onAcoes({ id: n.id, tipo: "ativar" })} aria-label={`Retomar ${n.nome}`}>
                      <Play className="mr-1 h-3 w-3" />
                      Retomar
                    </button>
                  )
                )}
                {p.onOtimizar && n.nivel !== "anuncio" && (
                  <button type="button" className={linkPequeno} onClick={() => p.onOtimizar && p.onOtimizar(n)} aria-label={`Otimizar ${n.nome}`} title="Leva ao agente sênior com a base deste item: reforçar e experimentar, sem criar do zero">
                    <Sparkles className="mr-1 h-3 w-3" />
                    Otimizar
                  </button>
                )}
                <button type="button" className={juntar(linkPequeno, "w-6 justify-center px-0")} onClick={() => p.onAcoes(acoesAqui ? null : { id: n.id, tipo: null })} aria-expanded={!!acoesAqui} aria-label={`Ações: ${n.nome}`}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <Numeros n={n} />
      </div>
      {acoesAqui && p.acoesDe && (
        <div className="sticky left-0 w-full max-w-[640px] border-t border-border px-3 py-2">
          <PainelDaAcao n={n} gestao={p.gestao} tipoInicial={p.acoesDe.tipo} onFechar={() => p.onAcoes(null)} onFeito={p.onFeito} />
        </div>
      )}
      {aberto && n.filhos.map((f) => <Linha key={f.id} {...p} n={f} profundidade={profundidade + 1} />)}
    </>
  );
}

function LinhaDeTotal({ nos, nivel }: { nos: NoNoGerenciador[]; nivel: NivelNoGerenciador }) {
  const t = totalDaLista(nos);
  const nome = nivel === "campanha" ? (t.quantos === 1 ? "campanha" : "campanhas") : nivel === "conjunto" ? (t.quantos === 1 ? "conjunto" : "conjuntos") : t.quantos === 1 ? "anúncio" : "anúncios";
  return (
    <div role="row" className="grid min-w-0 border-t-2 border-border bg-muted/40 font-medium" style={{ gridTemplateColumns: COLUNAS }} data-total="">
      <div role="cell" className="sticky left-0 z-[1] min-w-0 bg-muted py-2 pl-3 pr-2 text-[12.5px]">
        Total de {t.quantos} {nome}
      </div>
      <Celula />
      <Celula>{t.verba_diaria !== null ? <>{brl(t.verba_diaria)}<span className="block text-[11px] font-normal text-muted-foreground">por dia, ativos</span></> : null}</Celula>
      <Celula>
        {t.resultados === null ? <span className="text-[11.5px] font-normal text-muted-foreground">Vários tipos</span> : inteiro(t.resultados)}
        {t.resultado_rotulo ? <span className="block truncate text-[11px] font-normal text-muted-foreground">{t.resultado_rotulo}</span> : null}
      </Celula>
      <Celula>{t.custo_por_resultado !== null ? brl(t.custo_por_resultado) : null}</Celula>
      <Celula>
        {brl(t.gasto)}
        {t.hoje !== null && t.hoje > 0 ? <span className="block text-[11px] font-normal text-muted-foreground">hoje {brl(t.hoje)}</span> : null}
      </Celula>
      <Celula titulo="Alcance não soma: a mesma pessoa aparece em vários itens." />
      <Celula>{inteiro(t.impressoes)}</Celula>
      <Celula>{t.ctr_link !== null ? porcento(t.ctr_link) : null}</Celula>
      <Celula>{t.cpm !== null ? brl(t.cpm) : null}</Celula>
      <Celula />
    </div>
  );
}

// ------------------------------------------------------------------ o anúncio aberto (painel ao lado)

const TOM_DO_DIAGNOSTICO: Record<ItemDoDiagnostico["tom"], string> = {
  bom: "bg-success",
  medio: "bg-warning",
  ruim: "bg-destructive",
  neutro: "bg-muted-foreground/40",
};

function Numero({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-[13px] font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}

function PainelDoAnuncio({
  n,
  periodo,
  mini,
  gestao,
  onFechar,
  onFeito,
  onOtimizar,
  onVariar,
  onFicha,
  desfazendo,
  onDesfazer,
}: {
  n: NoNoGerenciador;
  periodo: PeriodoDaConsulta;
  mini: (AnuncioAoVivo & { formato?: string | null }) | undefined;
  gestao: LeituraDoGerenciador["gestao"];
  onFechar: () => void;
  onFeito: () => void;
  onOtimizar?: (n: NoNoGerenciador) => void;
  onVariar?: (adId: string) => void;
  onFicha?: (adId: string) => void;
  desfazendo: string | null;
  onDesfazer: (acaoId: string) => void;
}) {
  const { clientId } = useMesa();
  const q = useQuery({ queryKey: chaveDoAnuncioAberto(clientId, n.id, periodo), queryFn: () => lerAnuncioAberto(clientId, n.id, periodo), staleTime: 60_000, retry: false });
  const [acao, setAcao] = useState<{ tipo: AcaoDoGerenciador | null } | null>(null);
  const [textoTodo, setTextoTodo] = useState(false);
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (fechar.current) fechar.current.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id]);

  const a = q.data || null;
  const m = n.metricas;
  const cr = a ? a.criativo : null;
  const titulo = (cr && cr.titulo) || (mini && mini.titulo) || null;
  const corpo = (cr && cr.corpo) || (mini && mini.corpo) || null;
  const cta = (cr && cr.cta) || (mini && mini.cta) || null;
  const destino = (cr && cr.destino) || (mini && mini.destino) || null;
  const imagem = (mini && mini.imagem_url) || (cr && cr.imagem_url) || null;
  const video = cr && cr.video && cr.video.fonte ? cr.video : null;
  const diag = diagnosticoCurto({
    qualidade: a ? a.qualidade : null,
    aprendizado: a ? a.aprendizado : null,
    frequencia: m && m.frequencia !== null ? m.frequencia : mini && mini.tendencia ? mini.tendencia.frequencia : null,
    ctr_var_pct: mini && mini.tendencia ? mini.tendencia.ctr_var_pct : null,
    impressoes: m ? m.impressoes : 0,
  });
  const links = a ? a.links : null;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`Anúncio ${n.nome}`}
      className="fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-2xl sm:w-[440px]"
      data-painel-do-anuncio={n.id}
    >
      <div className="flex min-w-0 items-start border-b border-border px-4 py-3">
        <span className={juntar("mr-2 mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full", COR_DO_NIVEL.anuncio.ponto)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={juntar("text-[11px] font-medium", COR_DO_NIVEL.anuncio.texto)}>Anúncio</p>
          <h3 className="line-clamp-2 text-[14px] font-semibold leading-5 [overflow-wrap:anywhere]">{n.nome}</h3>
          <div className="mt-1 flex min-w-0 flex-wrap items-center">
            <span className="mr-2">
              <SeloDaEntrega n={n} />
            </span>
            {mini && <SeloDoSinal sinal={mini.sinal} />}
          </div>
        </div>
        <button ref={fechar} type="button" className={juntar(botao.icone, "-mr-1 ml-2")} onClick={onFechar} aria-label="Fechar o anúncio">
          <X className="h-4 w-4" />
        </button>
      </div>
      <RegiaoRolavel modo="sempre" rotulo="Detalhes do anúncio" className="min-h-0 flex-1 overflow-y-auto">
        <div className="min-w-0 space-y-4 px-4 py-4">
          {/* O criativo: vídeo quando a Meta dá a fonte; senão a imagem (a da ficha, em boa resolução, primeiro). */}
          <section aria-label="Criativo" className="min-w-0">
            <div className="flex min-h-[180px] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
              {video ? (
                <video src={video.fonte || undefined} poster={video.capa || undefined} controls playsInline preload="metadata" className="max-h-[420px] w-full bg-black object-contain" aria-label={`Vídeo de ${n.nome}`} />
              ) : imagem ? (
                <Foto src={imagem} alt={`Criativo de ${n.nome}`} contain className="max-h-[420px] w-full" />
              ) : q.isLoading ? (
                <div className="h-[260px] w-full animate-pulse bg-muted" aria-busy="true" aria-label="Lendo o criativo na Meta" />
              ) : (
                <p className="px-4 py-10 text-center text-[12px] text-muted-foreground">Sem prévia do criativo. Abra a prévia na Meta.</p>
              )}
            </div>
            {cr && cr.video && !cr.video.fonte && (
              <p className="mt-1.5 flex items-center text-[11.5px] text-muted-foreground">
                <PlayCircle className="mr-1 h-3.5 w-3.5" />
                Vídeo: a Meta não liberou o arquivo por aqui; veja na prévia.
              </p>
            )}
            <div className="-ml-1.5 mt-1.5 flex min-w-0 flex-wrap items-center">
              {links && links.previa && (
                <a href={links.previa} target="_blank" rel="noopener noreferrer" className={juntar(botao.barra, "text-primary")}>
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                  Prévia na Meta
                </a>
              )}
              {links && links.instagram && (
                <a href={links.instagram} target="_blank" rel="noopener noreferrer" className={botao.barra}>
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                  No Instagram
                </a>
              )}
              {n.link_meta && (
                <a href={n.link_meta} target="_blank" rel="noopener noreferrer" className={botao.barra}>
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                  No Gerenciador da Meta
                </a>
              )}
            </div>
            {(titulo || corpo) && (
              <div className="mt-2 min-w-0 text-[13px] leading-relaxed">
                {titulo && <p className="font-semibold [overflow-wrap:anywhere]">{titulo}</p>}
                {corpo && (
                  <>
                    <p className={juntar("whitespace-pre-wrap text-foreground/90 [overflow-wrap:anywhere]", textoTodo ? "" : "line-clamp-5")}>{corpo}</p>
                    {corpo.length > 240 && (
                      <button type="button" className={juntar("mt-0.5 text-[12px] font-medium text-primary hover:underline", foco)} onClick={() => setTextoTodo(!textoTodo)}>
                        {textoTodo ? "Mostrar menos" : "Ver o texto todo"}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {(cta || destino) && (
              <p className="mt-1.5 flex min-w-0 flex-wrap items-center text-[11.5px] text-muted-foreground">
                {cta && <span className="mr-2 rounded-full border border-border px-2 py-0.5 font-medium text-foreground">{cta}</span>}
                {destino && <span className="min-w-0 truncate">{destino}</span>}
              </p>
            )}
            {a && a.aviso && <p className="mt-1.5 text-[11.5px] leading-snug text-warning [overflow-wrap:anywhere]">{a.aviso}</p>}
            {q.isError && <p className="mt-1.5 text-[11.5px] text-muted-foreground">A leitura na Meta não veio agora; os números abaixo são da coleta.</p>}
          </section>

          <section aria-label="Números do período" className="min-w-0 border-t border-border pt-3">
            <dl className="grid min-w-0 grid-cols-3 gap-x-3 gap-y-2.5">
              <Numero rotulo="Gasto" valor={m ? brl(m.gasto) : brl(0)} />
              <Numero rotulo={m ? m.resultado_rotulo : "Resultados"} valor={m ? inteiro(m.resultados) : "0"} />
              <Numero rotulo="Custo por resultado" valor={m && m.custo_por_resultado !== null ? brl(m.custo_por_resultado) : "sem dado"} />
              <Numero rotulo="Impressões" valor={m ? inteiro(m.impressoes) : "sem dado"} />
              <Numero rotulo="Alcance" valor={m && m.alcance !== null ? inteiro(m.alcance) : "sem dado"} />
              <Numero rotulo="Frequência" valor={m && m.frequencia !== null ? decimal(m.frequencia) : "sem dado"} />
              <Numero rotulo="CTR" valor={m && m.ctr_link !== null ? porcento(m.ctr_link) : "sem dado"} />
              <Numero rotulo="CPM" valor={m && m.cpm !== null ? brl(m.cpm) : "sem dado"} />
              <Numero rotulo="Hoje" valor={n.hoje ? brl(n.hoje.gasto) : "sem leitura"} />
            </dl>
          </section>

          <section aria-label="Diagnóstico" className="min-w-0 border-t border-border pt-3">
            <ul className="min-w-0 space-y-2">
              {diag.map((d) => (
                <li key={d.chave} className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-x-2 text-[12.5px]" data-diagnostico-curto={d.chave}>
                  <span className="text-muted-foreground">{d.rotulo}</span>
                  <span className="min-w-0">
                    <span className="flex items-center font-medium">
                      <span className={juntar("mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full", TOM_DO_DIAGNOSTICO[d.tom])} aria-hidden="true" />
                      {q.isLoading && d.chave !== "fadiga" ? "Lendo na Meta" : d.valor}
                    </span>
                    {d.dica && !q.isLoading && <span className="block text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{d.dica}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {mini && mini.diagnostico && (
              <div className="mt-2.5 rounded-md bg-muted/50 px-2.5 py-2">
                <Diagnostico valor={mini.diagnostico} />
              </div>
            )}
          </section>

          <section aria-label="Ações do anúncio" className="min-w-0 border-t border-border pt-3">
            <MarcaDaAcao n={n} fazendo={!!n.marca && desfazendo === n.marca.acao_id} onDesfazer={() => n.marca && onDesfazer(n.marca.acao_id)} />
            <div className="-m-0.5 mt-1 flex min-w-0 flex-wrap items-center [&>*]:m-0.5">
              {!encerrado(n) && (
                <button type="button" className={juntar(botao.secundario, "h-8 text-[12px]")} onClick={() => setAcao({ tipo: ehAtivo(n) ? "pausar" : "ativar" })}>
                  {ehAtivo(n) ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                  {ehAtivo(n) ? "Pausar" : "Retomar"}
                </button>
              )}
              {onOtimizar && (
                <button type="button" className={juntar(botao.primario, "h-8 text-[12px]")} onClick={() => onOtimizar(n)} title="Leva ao agente sênior com a base deste anúncio">
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Otimizar
                </button>
              )}
              {onVariar && (
                <button type="button" className={juntar(botao.secundario, "h-8 text-[12px]")} onClick={() => onVariar(n.id)}>
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                  Criar variações
                </button>
              )}
              {onFicha && (
                <button type="button" className={juntar(botao.discreto, "h-8 text-[12px]")} onClick={() => onFicha(n.id)}>
                  <FileSearch className="mr-1 h-3.5 w-3.5" />
                  Abrir ficha
                </button>
              )}
              <button type="button" className={juntar(botao.discreto, "h-8 w-8 px-0")} onClick={() => setAcao(acao ? null : { tipo: null })} aria-label={`Ações: ${n.nome}`} aria-expanded={!!acao}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>
            {acao && (
              <div className="mt-2">
                <PainelDaAcao n={n} gestao={gestao} tipoInicial={acao.tipo} onFechar={() => setAcao(null)} onFeito={onFeito} />
              </div>
            )}
          </section>
        </div>
      </RegiaoRolavel>
    </aside>
  );
}

// ------------------------------------------------------------------ topo e conta

const FILTROS: { valor: FiltroDoGerenciador; rotulo: string }[] = [
  { valor: "entregando", rotulo: "Entregando agora" },
  { valor: "ativos", rotulo: "Ativos" },
  { valor: "todos", rotulo: "Todos" },
];

/** "Atualizar agora": relê na Meta na hora (o servidor segura uma leitura forçada a cada 15 s). */
export function useAtualizarGerenciador(clientId: string, periodo: PeriodoDaConsulta) {
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [atualizando, setAtualizando] = useState(false);
  const atualizar = async () => {
    setAtualizando(true);
    try {
      const l = await lerGerenciador(clientId, periodo, true);
      queryClient.setQueryData(chaveDoGerenciador(clientId, periodo), l);
    } catch (e) {
      avisarErro(e, "Não foi possível ler a Meta agora");
    } finally {
      setAtualizando(false);
    }
  };
  return { atualizando, atualizar };
}

export function BotaoAtualizarAgora({ atualizando, onAtualizar }: { atualizando: boolean; onAtualizar: () => void }) {
  return (
    <button type="button" className={juntar(botao.secundario, "h-9")} disabled={atualizando} onClick={onAtualizar} title="Lê a Meta agora: status, entrega, verba e gasto de hoje (grátis)">
      {atualizando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
      Atualizar agora
    </button>
  );
}

function Fato({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={juntar("min-w-0", className)}>
      <dt className="truncate text-[11px] leading-4 text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 min-w-0 truncate text-[13px] font-medium leading-5">{children}</dd>
    </div>
  );
}

/** Uma conta numa linha só, alinhada: conta, situação, a pagar, gestão e de onde veio a leitura. */
function LinhaDaConta({ c, gestao }: { c: ContaNaTela; gestao: LeituraDoGerenciador["gestao"] }) {
  const travada = c.situacao.travada;
  return (
    <div className="min-w-0 px-3 py-2.5" data-conta={c.id} data-travada={travada ? "sim" : "nao"}>
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
        <Fato rotulo="Conta" className="col-span-2 sm:col-span-1">
          <span className="flex min-w-0 items-center">
            <span className={juntar("mr-2 inline-block h-2 w-2 shrink-0 rounded-full", travada ? "bg-destructive" : c.situacao.codigo === 1 ? "bg-success" : "bg-warning")} aria-hidden="true" />
            <span className="truncate" title={c.nome}>{c.nome}</span>
          </span>
        </Fato>
        <Fato rotulo="Situação">
          <span className={travada ? "text-destructive" : c.situacao.codigo === 1 ? "text-success" : "text-warning"}>{c.situacao.rotulo}</span>
        </Fato>
        <Fato rotulo="A pagar">
          <span className="tabular-nums">{c.saldo_a_pagar_brl !== null ? brl(c.saldo_a_pagar_brl) : "sem leitura"}</span>
        </Fato>
        <Fato rotulo="Gestão">
          {gestao ? (
            <span className={gestao.disponivel ? "text-success" : "text-warning"} title={gestao.motivo || undefined} data-gestao={gestao.disponivel ? "sim" : "nao"}>
              {gestao.disponivel ? "Ativa" : "Só leitura"}
            </span>
          ) : (
            <span className="text-muted-foreground">sem leitura</span>
          )}
        </Fato>
        <Fato rotulo="Leitura">
          <span className="text-muted-foreground" title={c.aviso || undefined}>
            {c.fonte === "meta_ao_vivo" ? `Meta às ${horaDeBrasilia(c.lido_em)}` : `Coleta${c.lido_em ? ` das ${horaDeBrasilia(c.lido_em)}` : ""}`}
          </span>
        </Fato>
      </dl>
      {(c.situacao.motivo || travada) && (
        <p className={juntar("mt-2 flex min-w-0 flex-wrap items-center rounded-md px-2.5 py-1.5 text-[12px] leading-snug", travada ? "bg-destructive/5" : "bg-warning/10")}>
          {c.situacao.motivo && <span className="mr-2 min-w-0 [overflow-wrap:anywhere]">{c.situacao.motivo}</span>}
          {c.situacao.o_que_fazer && <span className="mr-2 min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{c.situacao.o_que_fazer}</span>}
          {c.link_cobranca && (
            <a href={c.link_cobranca} target="_blank" rel="noopener noreferrer" className={juntar("inline-flex items-center rounded font-medium text-primary hover:underline", foco)}>
              <ExternalLink className="mr-1 h-3 w-3" />
              Cobrança e pagamentos na Meta
            </a>
          )}
        </p>
      )}
      {c.aviso && <p className="mt-1 truncate text-[11.5px] leading-snug text-warning" title={c.aviso}>{c.aviso}</p>}
    </div>
  );
}

/**
 * O topo da aba Conta (AD3, "está tipo um card gigante; deixar bonitinho, organizado, minimalista,
 * alinhado"): um cartão só, uma linha por conta com os fatos alinhados (conta, situação, a pagar,
 * gestão, leitura). O motivo aparece só quando a conta trava; as plataformas não conectadas numa nota.
 */
export function SituacaoDaConta({ leitura, carregando, erro }: { leitura: LeituraDoGerenciador | null; carregando: boolean; erro: string | null }) {
  if (carregando && !leitura) return <div className="h-14 w-full animate-pulse rounded-lg bg-muted/70" aria-busy="true" aria-label="Lendo a situação da conta" />;
  if (!leitura) return erro ? <p className="text-[12px] text-muted-foreground">A situação da conta não veio agora: {erro}</p> : null;
  const semMeta = leitura.plataformas.filter((p) => p.id !== "meta" && !p.lida);
  const algumaTravada = leitura.contas.some((c) => c.situacao.travada);
  const g = leitura.gestao;
  return (
    <section className="min-w-0 divide-y divide-border rounded-lg border border-border bg-card" aria-label="Situação da conta">
      {leitura.contas.map((c) => <LinhaDaConta key={c.id} c={c} gestao={g} />)}
      {((g && !g.disponivel && !algumaTravada) || semMeta.length > 0) && (
        <p className="flex min-w-0 flex-wrap items-center px-3 py-1.5 text-[11.5px] leading-snug text-muted-foreground">
          {g && !g.disponivel && !algumaTravada && <span className="mr-3 min-w-0 [overflow-wrap:anywhere]">Só leitura agora: {g.motivo || "sem permissão de gestão."}</span>}
          {semMeta.length > 0 && <span className="min-w-0">{semMeta.map((p) => `${p.nome}: ${p.conectada ? "ligado, leitura ainda não feita" : "não conectado"}`).join(" · ")}</span>}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ o gerenciador

export default function GerenciadorAoVivo({
  dias,
  onVerCriativos,
  semTopo = false,
  anuncios,
  rotuloDoPeriodo,
  onOtimizar,
  onVariar,
  onFicha,
}: {
  /** O período da aba (número de dias ou o período resolvido). */
  dias: PeriodoDaConsulta;
  onVerCriativos?: (campanhaId: string) => void;
  /** Fora da aba Conta (sem o topo com Atualizar agora), o botão vem aqui. */
  semTopo?: boolean;
  /** Os anúncios da conta no período (miniatura, copy, sinal e tendência para a linha e o painel). */
  anuncios?: (AnuncioAoVivo & { formato?: string | null })[];
  rotuloDoPeriodo?: string;
  onOtimizar?: (n: NoNoGerenciador) => void;
  onVariar?: (adId: string) => void;
  onFicha?: (adId: string) => void;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const q = useGerenciador(clientId, dias);
  const { atualizando, atualizar } = useAtualizarGerenciador(clientId, dias);
  const [filtro, setFiltro] = useEstadoDaTela<FiltroDoGerenciador>(`mesa-ads:gerenciador:filtro:${clientId}`, "ativos", {
    validar: (v) => v === "entregando" || v === "ativos" || v === "todos",
    esperaMs: 0,
  });
  const [nivel, setNivel] = useEstadoDaTela<NivelNoGerenciador>(`mesa-ads:gerenciador:nivel:${clientId}`, "campanha", {
    validar: (v) => v === "campanha" || v === "conjunto" || v === "anuncio",
    esperaMs: 0,
  });
  const [dentroDe, setDentroDe] = useState<{ id: string; nome: string; nivel: NivelNoGerenciador } | null>(null);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [acoesDe, setAcoesDe] = useState<{ id: string; tipo: AcaoDoGerenciador | null } | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [anuncioAberto, setAnuncioAberto] = useState<string | null>(null);

  const l = q.data || null;
  const campanhas = l ? l.campanhas : [];
  const visiveis = filtrarArvore(campanhas, filtro);
  const escolhido = dentroDe && acharNo(campanhas, dentroDe.id) ? dentroDe : null;
  const daAba = nosDoNivel(visiveis, nivel, escolhido ? escolhido.id : null);
  const contagem = (nv: NivelNoGerenciador) => nosDoNivel(visiveis, nv, escolhido ? escolhido.id : null).length;
  const miniaturas: Miniaturas = {};
  for (const a of anuncios || []) miniaturas[a.ad_id] = a;
  const noAberto = anuncioAberto ? acharNo(campanhas, anuncioAberto) : null;

  const reler = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "ads", "gerenciador", clientId] });
    void queryClient.invalidateQueries({ queryKey: chavesRotina.rotina(clientId) });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "urls", "ads-conta", clientId] });
  };

  const desfazer = async (acaoId: string) => {
    setDesfazendo(acaoId);
    try {
      await desfazerAcaoFeita(acaoId);
      toast.success("Desfeito", { description: "Relido na Meta: voltou como estava." });
      reler();
    } catch (e) {
      avisarErro(e, "Não foi possível desfazer");
    } finally {
      setDesfazendo(null);
    }
  };

  // Como na Meta: o nome da campanha abre os conjuntos dela; o do conjunto, os anúncios; o do anúncio, o painel.
  const descer = (n: NoNoGerenciador) => {
    if (n.nivel === "anuncio") {
      setAnuncioAberto(n.id);
      return;
    }
    setDentroDe({ id: n.id, nome: n.nome, nivel: n.nivel });
    setNivel(n.nivel === "campanha" ? "conjunto" : "anuncio");
    setAcoesDe(null);
  };

  const r = l ? l.resumo : null;
  const linhaProps = {
    profundidade: 0,
    abertos,
    onAlternar: (id: string) => setAbertos((a) => ({ ...a, [id]: !a[id] })),
    acoesDe,
    onAcoes: setAcoesDe,
    gestao: l ? l.gestao : null,
    desfazendo,
    onDesfazer: (id: string) => void desfazer(id),
    onFeito: reler,
    onDescer: descer,
    onOtimizar,
    miniaturas,
    aberto: anuncioAberto,
  };

  return (
    <section className="min-w-0" aria-label="Gerenciador de anúncios">
      <div className="mb-2 flex min-w-0 flex-wrap items-end">
        <div className="mb-1 mr-3 min-w-0 flex-1">
          {r && (
            <p className="text-[13px] leading-snug" data-resumo-do-gerenciador="">
              <span className="font-semibold">{r.campanhas_entregando}</span> de {r.campanhas_ativas} {r.campanhas_ativas === 1 ? "campanha ativa entregando" : "campanhas ativas entregando"}
              {` · ${r.anuncios_entregando} de ${r.anuncios_ativos} anúncios`}
              {r.gasto_hoje !== null ? ` · hoje ${brl(r.gasto_hoje)}` : ""}
            </p>
          )}
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            {l && l.lido_em
              ? `${l.fonte === "coleta" ? "Da última coleta do painel" : "Lido na Meta"} às ${horaDeBrasilia(l.lido_em)}${rotuloDoPeriodo ? ` · ${rotuloDoPeriodo}` : l.periodo ? ` · números de ${l.periodo.inicio.split("-").reverse().slice(0, 2).join("/")} a ${l.periodo.fim.split("-").reverse().slice(0, 2).join("/")}` : ""}${l.sincronizado_em ? ` (coleta das ${horaDeBrasilia(l.sincronizado_em)})` : ""}`
              : q.isLoading
              ? "Lendo a Meta"
              : ""}
            {q.isFetching && !q.isLoading ? " · relendo" : ""}
          </p>
        </div>
        <div className="-m-0.5 mb-1 flex min-w-0 flex-wrap items-center [&>*]:m-0.5">
          <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Filtro do gerenciador">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={juntar("toque-compacto h-8 rounded px-2.5 text-[12px] font-medium", foco, filtro === f.valor ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}
                aria-pressed={filtro === f.valor}
                onClick={() => setFiltro(f.valor)}
              >
                {f.rotulo} ({filtrarArvore(campanhas, f.valor).length})
              </button>
            ))}
          </div>
          {/* "Atualizar agora" e o link do Gerenciador da Meta ficam no topo da aba (um lugar só). */}
          {semTopo && <BotaoAtualizarAgora atualizando={atualizando} onAtualizar={() => void atualizar()} />}
        </div>
      </div>

      {r && r.alertas.length > 0 && (
        <ul className="mb-2 min-w-0 space-y-1" aria-label="Alertas do gerenciador">
          {r.alertas.filter((a) => !l || !l.contas.some((c) => c.situacao.motivo && a.indexOf(c.situacao.motivo) >= 0)).map((a, k) => (
            <li key={k} className="flex items-start rounded-md bg-warning/10 px-2.5 py-1.5 text-[12px] leading-snug">
              <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{a}</span>
            </li>
          ))}
        </ul>
      )}
      {l && l.avisos.length > 0 && (
        <ul className="mb-2 min-w-0 space-y-0.5">
          {l.avisos.map((a, k) => <li key={k} className="text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{a}</li>)}
        </ul>
      )}

      {q.isError && !l && <p className="text-[12.5px] text-muted-foreground">O gerenciador não abriu agora. Tente Atualizar agora.</p>}
      {q.isLoading && <div className="h-24 w-full animate-pulse rounded-lg bg-muted/70" aria-busy="true" aria-label="Lendo o gerenciador" />}
      {l && !campanhas.length && (
        <p className="rounded-md bg-muted/40 px-3 py-3 text-[12.5px] text-muted-foreground">
          {l.contas.length ? "Nenhuma campanha nesta conta de anúncios." : l.plataformas.length && l.plataformas[0].motivo ? l.plataformas[0].motivo : "Nenhuma conta de anúncios ligada."}
        </p>
      )}

      {l && campanhas.length > 0 && (
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
          {/* Abas por nível, cada uma com a cor do nível; o escolhido ao descer aparece ao lado, com o x para sair. */}
          <div className="flex min-w-0 flex-wrap items-center border-b border-border px-2 pt-1.5">
            <div className="-mb-px flex min-w-0 items-center" role="tablist" aria-label="Nível do gerenciador">
              {NIVEIS.map((nv) => (
                <button
                  key={nv}
                  type="button"
                  role="tab"
                  aria-selected={nivel === nv}
                  className={juntar(
                    "toque-compacto mr-1 inline-flex h-9 items-center border-b-2 px-2.5 text-[12.5px] font-medium",
                    foco,
                    nivel === nv ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => {
                    setNivel(nv);
                    setAcoesDe(null);
                  }}
                >
                  <span className={juntar("mr-1.5 inline-block h-2 w-2 rounded-full", COR_DO_NIVEL[nv].ponto)} aria-hidden="true" />
                  {ROTULO_DAS_ABAS[nv]}
                  <span className="ml-1 tabular-nums text-muted-foreground">{contagem(nv)}</span>
                </button>
              ))}
            </div>
            {escolhido && (
              <span className="mb-1 ml-auto inline-flex min-w-0 max-w-full items-center rounded-full border border-border bg-muted/50 py-0.5 pl-2.5 pr-1 text-[11.5px]" data-dentro-de={escolhido.id}>
                <span className={juntar("mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full", COR_DO_NIVEL[escolhido.nivel].ponto)} aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {NIVEL_ROTULO[escolhido.nivel]}: {escolhido.nome}
                </span>
                <button type="button" className={juntar(botao.icone, "ml-1 h-5 w-5")} onClick={() => setDentroDe(null)} aria-label={`Ver todos, sem ${escolhido.nome}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {escolhido && escolhido.nivel === "campanha" && onVerCriativos && (
              <button type="button" className={juntar("mb-1 ml-2 text-[11.5px] font-medium text-primary hover:underline", foco)} onClick={() => onVerCriativos(escolhido.id)}>
                Ver os criativos desta campanha
              </button>
            )}
          </div>

          {!daAba.length ? (
            <p className="px-3 py-3 text-[12.5px] text-muted-foreground">
              {filtro === "entregando" ? "Nada está entregando agora." : filtro === "ativos" ? "Nada ativo agora." : "Nada neste nível."}{" "}
              {filtro !== "todos" && (
                <button type="button" className={juntar("font-medium text-primary hover:underline", foco)} onClick={() => setFiltro("todos")}>
                  Ver todas
                </button>
              )}
            </p>
          ) : (
            <div className="min-w-0 overflow-x-auto overscroll-x-contain">
              <div role="table" aria-label={`${ROTULO_DAS_ABAS[nivel]} no gerenciador`} className={juntar("relative", LARGURA_MINIMA)}>
                <div role="row" className="grid min-w-0 bg-muted/30 text-[11.5px] font-medium text-muted-foreground" style={{ gridTemplateColumns: COLUNAS }}>
                  <div role="columnheader" className="sticky left-0 z-[1] bg-muted py-2 pl-3 pr-2">
                    {NIVEL_ROTULO[nivel]}
                  </div>
                  {CABECALHO.map((c, k) => (
                    <div key={c.rotulo} role="columnheader" className={juntar("min-w-0 truncate px-2.5 py-2", k === 0 ? "text-left" : "text-right")} title={c.dica}>
                      {c.rotulo}
                    </div>
                  ))}
                </div>
                {daAba.map((n) => <Linha key={n.id} {...linhaProps} n={n} />)}
                <LinhaDeTotal nos={daAba} nivel={nivel} />
              </div>
            </div>
          )}
        </div>
      )}

      {noAberto && (
        <PainelDoAnuncio
          key={noAberto.id}
          n={noAberto}
          periodo={dias}
          mini={miniaturas[noAberto.id]}
          gestao={l ? l.gestao : null}
          onFechar={() => setAnuncioAberto(null)}
          onFeito={reler}
          onOtimizar={onOtimizar}
          onVariar={onVariar}
          onFicha={onFicha}
          desfazendo={desfazendo}
          onDesfazer={(id) => void desfazer(id)}
        />
      )}
    </section>
  );
}
