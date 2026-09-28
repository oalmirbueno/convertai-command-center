import { useState, type FormEvent, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, ExternalLink, Loader2, MoreHorizontal, Pause, Play, RefreshCw, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { botao, campo, foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { brl, decimal, inteiro, porcento } from "./adsApi";
import { chavesRotina, desfazerAcaoFeita } from "./rotinaApi";
import {
  agirNoGerenciador,
  chaveDoGerenciador,
  faixaDaVerba,
  filtrarArvore,
  horaDeBrasilia,
  lerGerenciador,
  type AcaoDoGerenciador,
  type ContaNaTela,
  type EstadoDaEntrega,
  type FiltroDoGerenciador,
  type LeituraDoGerenciador,
  type NoNoGerenciador,
  type ResultadoDaAcaoNaTela,
} from "./gerenciadorApi";

/**
 * Gerenciador ao vivo (frente AD, 28/09). Pedido do dono: "abrir a telinha do
 * gerenciador de anúncios dentro do painel, o real da Meta, para fazer tudo
 * por um lugar só; ver o que está ativo, o que está rodando, monitorar em
 * tempo real". A Meta não deixa embutir o Gerenciador dela; esta tela é fiel
 * a ele: campanha, conjunto e anúncio em árvore, a entrega de verdade (com o
 * motivo quando não entrega), verba, gasto de hoje e os números do período,
 * lidos na Meta na hora ("Atualizar agora"), com o link para o mesmo item na
 * Meta. Pausar, ativar, verba e nome saem daqui pelo mesmo caminho do agente
 * (relê antes, faz, relê depois), com a prova e o Desfazer.
 *
 * `SituacaoDaConta` (o topo da aba) usa a mesma leitura.
 */

/** Relê sozinho enquanto a aba está aberta (a função guarda 45 s; "Atualizar agora" relê na hora). */
export const RELEITURA_DO_GERENCIADOR_MS = 2 * 60_000;

export function useGerenciador(clientId: string, dias: number) {
  return useQuery({
    queryKey: chaveDoGerenciador(clientId, dias),
    queryFn: () => lerGerenciador(clientId, dias),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: RELEITURA_DO_GERENCIADOR_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

const TOM_DA_ENTREGA: Record<EstadoDaEntrega, string> = {
  entregando: "bg-success/15 text-success",
  ativo: "bg-success/10 text-success",
  ativo_sem_entrega: "bg-warning/15 text-warning",
  conta_travada: "bg-destructive/10 text-destructive",
  reprovado: "bg-destructive/10 text-destructive",
  com_problema: "bg-destructive/10 text-destructive",
  em_analise: "bg-primary/10 text-primary",
  pausado: "bg-muted text-muted-foreground",
  encerrado: "bg-muted text-muted-foreground",
};

export function SeloDaEntrega({ n }: { n: NoNoGerenciador }) {
  return (
    <span className={juntar("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium", TOM_DA_ENTREGA[n.entrega.estado])} data-entrega={n.entrega.estado} title={n.entrega.motivo || undefined}>
      {n.entrega.estado === "entregando" && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />}
      {n.entrega.rotulo}
    </span>
  );
}

const QUEM: Record<string, string> = { agente: "pelo agente", rotina: "pela rotina", equipe: "por você" };

/** "Pausado pelo agente às 10:32" com o Desfazer, ou a tentativa que não deu. */
function MarcaDaAcao({ n, fazendo, onDesfazer }: { n: NoNoGerenciador; fazendo: boolean; onDesfazer: () => void }) {
  const m = n.marca;
  if (!m) return null;
  const hora = horaDeBrasilia(m.quando);
  if (m.estado === "falhou") {
    return (
      <p className="mt-0.5 text-[11.5px] leading-snug text-destructive [overflow-wrap:anywhere]" data-marca="falhou">
        {hora ? `${hora}: ` : ""}
        {m.resumo}
      </p>
    );
  }
  return (
    <p className="mt-0.5 flex min-w-0 flex-wrap items-center text-[11.5px] leading-snug text-primary" data-marca={m.estado}>
      <span className="mr-1.5 min-w-0 [overflow-wrap:anywhere]">
        {m.estado === "desfeita" ? "Desfeito: " : ""}
        {m.resumo.replace(/\.$/, "")} {QUEM[m.origem] || ""}
        {hora ? ` às ${hora}` : ""}
      </span>
      {m.pode_desfazer && (
        <button type="button" className={juntar("inline-flex items-center rounded font-medium underline-offset-2 hover:underline", foco)} disabled={fazendo} onClick={onDesfazer} aria-label={`Desfazer: ${m.resumo}`}>
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

const NIVEL_ROTULO: Record<string, string> = { campanha: "Campanha", conjunto: "Conjunto", anuncio: "Anúncio" };
const artigo = (nivel: string) => (nivel === "campanha" ? "a campanha" : nivel === "conjunto" ? "o conjunto" : "o anúncio");

type Pedido = { n: NoNoGerenciador; tipo: AcaoDoGerenciador };

function PainelDaAcao({
  n,
  gestao,
  onFechar,
  onFeito,
}: {
  n: NoNoGerenciador;
  gestao: LeituraDoGerenciador["gestao"];
  onFechar: () => void;
  onFeito: (r: ResultadoDaAcaoNaTela) => void;
}) {
  const { clientId } = useMesa();
  const avisarErro = useAvisarErro();
  const ativo = (n.status || n.efetivo || "").toUpperCase() === "ACTIVE";
  const temVerba = n.nivel !== "anuncio" && n.orcamento_diario_brl !== null;
  const [tipo, setTipo] = useState<AcaoDoGerenciador | null>(null);
  const [nome, setNome] = useState(n.nome);
  const faixa = faixaDaVerba(n.orcamento_diario_brl);
  const [verba, setVerba] = useState(n.orcamento_diario_brl !== null ? String(n.orcamento_diario_brl).replace(".", ",") : "");
  const [fazendo, setFazendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDaAcaoNaTela | null>(null);

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
    <div className="mt-2 min-w-0 rounded-md border border-border bg-background p-2.5" aria-label={`Ações em ${n.nome}`} role="group">
      {gestao && !gestao.disponivel && (
        <p className="mb-2 flex items-start rounded bg-warning/10 px-2 py-1.5 text-[11.5px] leading-snug">
          <AlertTriangle className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 [overflow-wrap:anywhere]">Agora a Meta não deixa mexer: {gestao.motivo || "sem permissão de gestão."} Se tentar, o painel confere de novo e diz o motivo.</span>
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center">
        {ativo ? escolha("pausar", "Pausar", <Pause className="mr-1 h-3.5 w-3.5" />) : escolha("ativar", "Ativar", <Play className="mr-1 h-3.5 w-3.5" />)}
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
            {tipo === "ativar" && `Ativar ${artigo(n.nivel)} ${n.nome}: volta a gastar a verba. `}
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

function Numero({ rotulo, valor, className = "" }: { rotulo: string; valor: ReactNode; className?: string }) {
  return (
    <div className={juntar("min-w-0", className)}>
      <dt className="truncate text-[10.5px] text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-[12px] font-medium tabular-nums">{valor}</dd>
    </div>
  );
}

function Linha({
  n,
  nivel,
  abertos,
  onAlternar,
  acoesDe,
  onAcoes,
  gestao,
  desfazendo,
  onDesfazer,
  onFeito,
  onVerCriativos,
}: {
  n: NoNoGerenciador;
  nivel: number;
  abertos: Record<string, boolean>;
  onAlternar: (id: string) => void;
  acoesDe: string | null;
  onAcoes: (id: string | null) => void;
  gestao: LeituraDoGerenciador["gestao"];
  desfazendo: string | null;
  onDesfazer: (acaoId: string) => void;
  onFeito: () => void;
  onVerCriativos?: (campanhaId: string) => void;
}) {
  const aberto = !!abertos[n.id];
  const m = n.metricas;
  const recuo = nivel === 0 ? "" : nivel === 1 ? "pl-4 sm:pl-6" : "pl-8 sm:pl-12";
  return (
    <li className="min-w-0" data-no={n.id} data-nivel={n.nivel}>
      <div className={juntar("min-w-0 border-t border-border py-2", recuo, nivel === 0 ? "" : "bg-muted/20")}>
        <div className="flex min-w-0 items-start">
          {n.filhos.length ? (
            <button type="button" className={juntar(botao.icone, "mr-1 h-7 w-7")} onClick={() => onAlternar(n.id)} aria-expanded={aberto} aria-label={`${aberto ? "Fechar" : "Abrir"} ${NIVEL_ROTULO[n.nivel].toLowerCase()} ${n.nome}`}>
              <ChevronRight className={juntar("h-4 w-4 transition-transform", aberto ? "rotate-90" : "")} />
            </button>
          ) : (
            <span className="mr-1 inline-block h-7 w-7 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center">
              <span className="mr-2 min-w-0 text-[13px] font-semibold leading-5 [overflow-wrap:anywhere]">{n.nome}</span>
              <SeloDaEntrega n={n} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {NIVEL_ROTULO[n.nivel]}
              {n.orcamento_diario_brl !== null ? ` · verba ${brl(n.orcamento_diario_brl)} por dia` : n.orcamento_total_brl !== null ? ` · verba total ${brl(n.orcamento_total_brl)}` : ""}
              {n.filhos.length ? ` · ${n.filhos.length} ${n.nivel === "campanha" ? (n.filhos.length === 1 ? "conjunto" : "conjuntos") : n.filhos.length === 1 ? "anúncio" : "anúncios"}` : ""}
            </p>
            {n.entrega.motivo && n.entrega.estado !== "entregando" && n.entrega.estado !== "pausado" && (
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{n.entrega.motivo}</p>
            )}
            <MarcaDaAcao n={n} fazendo={!!n.marca && desfazendo === n.marca.acao_id} onDesfazer={() => n.marca && onDesfazer(n.marca.acao_id)} />
          </div>
          <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => onAcoes(acoesDe === n.id ? null : n.id)} aria-expanded={acoesDe === n.id} aria-label={`Ações: ${n.nome}`}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
        <dl className="mt-1.5 grid min-w-0 grid-cols-3 gap-x-3 gap-y-1 pl-8 sm:grid-cols-6 lg:grid-cols-7">
          <Numero rotulo="Hoje" valor={n.hoje ? brl(n.hoje.gasto) : "sem leitura"} />
          <Numero rotulo="Gasto no período" valor={m ? brl(m.gasto) : brl(0)} />
          <Numero rotulo={m ? m.resultado_rotulo : "Resultados"} valor={m ? inteiro(m.resultados) : "0"} />
          <Numero rotulo="Custo por resultado" valor={m ? brl(m.custo_por_resultado) : "sem dado"} />
          <Numero rotulo="CTR (link)" valor={m ? porcento(m.ctr_link) : "sem dado"} className="hidden sm:block" />
          <Numero rotulo="CPM" valor={m ? brl(m.cpm) : "sem dado"} className="hidden sm:block" />
          <Numero rotulo="Frequência" valor={m ? decimal(m.frequencia) : "sem dado"} className="hidden lg:block" />
        </dl>
        {acoesDe === n.id && (
          <div className="pl-8">
            <PainelDaAcao n={n} gestao={gestao} onFechar={() => onAcoes(null)} onFeito={onFeito} />
            {n.nivel === "campanha" && onVerCriativos && (
              <button type="button" className={juntar("mt-1 text-[12px] text-primary hover:underline", foco)} onClick={() => onVerCriativos(n.id)}>
                Ver os criativos desta campanha
              </button>
            )}
          </div>
        )}
      </div>
      {aberto && n.filhos.length > 0 && (
        <ul className="min-w-0">
          {n.filhos.map((f) => (
            <Linha key={f.id} n={f} nivel={nivel + 1} abertos={abertos} onAlternar={onAlternar} acoesDe={acoesDe} onAcoes={onAcoes} gestao={gestao} desfazendo={desfazendo} onDesfazer={onDesfazer} onFeito={onFeito} />
          ))}
        </ul>
      )}
    </li>
  );
}

const FILTROS: { valor: FiltroDoGerenciador; rotulo: string }[] = [
  { valor: "entregando", rotulo: "Entregando agora" },
  { valor: "ativos", rotulo: "Ativos" },
  { valor: "todos", rotulo: "Todos" },
];

/** "Atualizar agora": relê na Meta na hora (o servidor segura uma leitura forçada a cada 15 s). */
export function useAtualizarGerenciador(clientId: string, dias: number) {
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [atualizando, setAtualizando] = useState(false);
  const atualizar = async () => {
    setAtualizando(true);
    try {
      const l = await lerGerenciador(clientId, dias, true);
      queryClient.setQueryData(chaveDoGerenciador(clientId, dias), l);
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

/** Uma linha por conta: situação real (com o motivo e o que fazer), saldo, de onde veio a leitura. */
function LinhaDaConta({ c }: { c: ContaNaTela }) {
  const travada = c.situacao.travada;
  return (
    <div className={juntar("min-w-0 rounded-lg border px-3 py-2.5", travada ? "border-destructive/40 bg-destructive/5" : "border-border bg-card")} data-conta={c.id} data-travada={travada ? "sim" : "nao"}>
      <div className="flex min-w-0 flex-wrap items-center">
        <span className={juntar("mr-2 inline-block h-2 w-2 shrink-0 rounded-full", travada ? "bg-destructive" : c.situacao.codigo === 1 ? "bg-success" : "bg-warning")} aria-hidden="true" />
        <span className="mr-2 min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]">{c.nome}</span>
        <span className={juntar("mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium", travada ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>{c.situacao.rotulo}</span>
        {c.saldo_a_pagar_brl !== null && c.saldo_a_pagar_brl > 0 && <span className="mr-2 text-[12px] tabular-nums text-muted-foreground">A pagar: {brl(c.saldo_a_pagar_brl)}</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">{c.fonte === "meta_ao_vivo" ? `Lida na Meta às ${horaDeBrasilia(c.lido_em)}` : `Da coleta${c.lido_em ? ` das ${horaDeBrasilia(c.lido_em)}` : ""}`}</span>
      </div>
      {c.situacao.motivo && <p className="mt-1 text-[12px] leading-snug [overflow-wrap:anywhere]">{c.situacao.motivo}</p>}
      {(c.situacao.o_que_fazer || travada) && (
        <p className="mt-1 flex min-w-0 flex-wrap items-center text-[12px] leading-snug">
          {c.situacao.o_que_fazer && <span className="mr-2 min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{c.situacao.o_que_fazer}</span>}
          {c.link_cobranca && (
            <a href={c.link_cobranca} target="_blank" rel="noopener noreferrer" className={juntar("inline-flex items-center rounded font-medium text-primary hover:underline", foco)}>
              <ExternalLink className="mr-1 h-3 w-3" />
              Cobrança e pagamentos na Meta
            </a>
          )}
        </p>
      )}
      {c.aviso && <p className="mt-1 text-[11.5px] leading-snug text-warning [overflow-wrap:anywhere]">{c.aviso}</p>}
    </div>
  );
}

/**
 * O topo da aba Conta, enxuto: a situação de cada conta (ativa ou travada, com o motivo e o que
 * fazer), o que o agente pode fazer agora e as plataformas que ainda não estão conectadas.
 */
export function SituacaoDaConta({ leitura, carregando, erro }: { leitura: LeituraDoGerenciador | null; carregando: boolean; erro: string | null }) {
  if (carregando && !leitura) return <div className="h-14 w-full animate-pulse rounded-lg bg-muted/70" aria-busy="true" aria-label="Lendo a situação da conta" />;
  if (!leitura) return erro ? <p className="text-[12px] text-muted-foreground">A situação da conta não veio agora: {erro}</p> : null;
  const semMeta = leitura.plataformas.filter((p) => p.id !== "meta" && !p.lida);
  return (
    <section className="min-w-0 space-y-2" aria-label="Situação da conta">
      {leitura.contas.map((c) => <LinhaDaConta key={c.id} c={c} />)}
      <p className="flex min-w-0 flex-wrap items-center text-[11.5px] leading-snug text-muted-foreground">
        {leitura.gestao ? (
          <span className="mr-3 min-w-0 [overflow-wrap:anywhere]" data-gestao={leitura.gestao.disponivel ? "sim" : "nao"}>
            {leitura.gestao.disponivel ? "O agente e você podem mexer nas campanhas por aqui." : `Só leitura agora: ${leitura.gestao.motivo || "sem permissão de gestão."}`}
          </span>
        ) : null}
        {semMeta.length > 0 && <span className="min-w-0">{semMeta.map((p) => `${p.nome}: ${p.conectada ? "ligado, leitura ainda não feita" : "não conectado"}`).join(" · ")}</span>}
      </p>
    </section>
  );
}

export default function GerenciadorAoVivo({ dias, onVerCriativos, semTopo = false }: { dias: number; onVerCriativos?: (campanhaId: string) => void; /** Fora da aba Conta (sem o topo com Atualizar agora), o botão vem aqui. */ semTopo?: boolean }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const q = useGerenciador(clientId, dias);
  const { atualizando, atualizar } = useAtualizarGerenciador(clientId, dias);
  const [filtro, setFiltro] = useEstadoDaTela<FiltroDoGerenciador>(`mesa-ads:gerenciador:filtro:${clientId}`, "ativos", {
    validar: (v) => v === "entregando" || v === "ativos" || v === "todos",
    esperaMs: 0,
  });
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [acoesDe, setAcoesDe] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);

  const l = q.data || null;
  const campanhas = l ? l.campanhas : [];
  const visiveis = filtrarArvore(campanhas, filtro);

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

  const r = l ? l.resumo : null;
  return (
    <section className="min-w-0" aria-label="Gerenciador de anúncios">
      <div className="mb-2 flex min-w-0 flex-wrap items-center">
        <div className="mb-1 mr-3 min-w-0 flex-1">
          <p className="text-[12px] leading-snug text-muted-foreground">
            {l && l.lido_em
              ? `${l.fonte === "coleta" ? "Da última coleta do painel" : "Lido na Meta"} às ${horaDeBrasilia(l.lido_em)}${l.periodo ? ` · números de ${l.periodo.inicio.split("-").reverse().slice(0, 2).join("/")} a ${l.periodo.fim.split("-").reverse().slice(0, 2).join("/")}` : ""}${l.sincronizado_em ? ` (coleta das ${horaDeBrasilia(l.sincronizado_em)})` : ""}`
              : q.isLoading
              ? "Lendo a Meta"
              : ""}
            {q.isFetching && !q.isLoading ? " · relendo" : ""}
          </p>
          {r && (
            <p className="text-[12.5px] leading-snug" data-resumo-do-gerenciador="">
              <span className="font-semibold">{r.campanhas_entregando}</span> de {r.campanhas_ativas} {r.campanhas_ativas === 1 ? "campanha ativa entregando" : "campanhas ativas entregando"}
              {` · ${r.anuncios_entregando} de ${r.anuncios_ativos} anúncios`}
              {r.gasto_hoje !== null ? ` · hoje ${brl(r.gasto_hoje)}` : ""}
            </p>
          )}
        </div>
        <div className="-m-0.5 mb-1 flex min-w-0 flex-wrap items-center [&>*]:m-0.5">
          <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Filtro do gerenciador">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={juntar("toque-compacto h-8 rounded px-2.5 text-[12px] font-medium", foco, filtro === f.valor ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
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
      {l && campanhas.length > 0 && !visiveis.length && (
        <p className="rounded-md bg-muted/40 px-3 py-3 text-[12.5px] text-muted-foreground">
          {filtro === "entregando" ? "Nada está entregando agora." : "Nada ativo agora."}{" "}
          <button type="button" className={juntar("font-medium text-primary hover:underline", foco)} onClick={() => setFiltro("todos")}>
            Ver todas
          </button>
        </p>
      )}
      {visiveis.length > 0 && (
        <ul className="min-w-0 border-b border-border" aria-label="Campanhas no gerenciador">
          {visiveis.map((c) => (
            <Linha
              key={c.id}
              n={c}
              nivel={0}
              abertos={abertos}
              onAlternar={(id) => setAbertos((a) => ({ ...a, [id]: !a[id] }))}
              acoesDe={acoesDe}
              onAcoes={setAcoesDe}
              gestao={l ? l.gestao : null}
              desfazendo={desfazendo}
              onDesfazer={(id) => void desfazer(id)}
              onFeito={reler}
              onVerCriativos={onVerCriativos}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
