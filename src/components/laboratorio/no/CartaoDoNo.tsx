import { memo, useState, type CSSProperties } from "react";
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, CheckCircle2, Clock, Copy, Hourglass, Loader2, Lock, Maximize2, Minimize2, PanelRightOpen, PauseCircle, Play, Plus, RefreshCw, Trash2, WandSparkles } from "lucide-react";
import { botao, juntar, superficie, texto } from "@/components/sistema";
import { TIPOS_DE_NO, type NoDoLab } from "@/lib/laboratorio/nos";
import { noMotorDaCasa, type ExecucaoDoLab, type StatusDaExecucao } from "@/lib/laboratorio/api";
import ResultadoDoNo, { ESTADOS, emAndamento } from "../ResultadoDoNo";
import CamposDoNo, { CAMPOS_TRATADOS } from "../CamposDoNo";
import type { EstadoDoAuto } from "@/lib/laboratorio/auto";
import CorpoEspecial, { RodapeDoCorpo } from "./CorpoEspecial";
import GerarComIA from "./GerarComIA";
import MidiaDoNo from "./MidiaDoNo";
import RodapeDoNo from "./RodapeDoNo";
import ImagensDoResultado, { TIPOS_CRIATIVOS } from "./ImagensDoResultado";
import { ComplementoDoNo, PacoteDoFluxo } from "./ComplementoDoNo";
import type { ItemUsado, PecaDoPacote } from "@/lib/laboratorio/complemento";
import type { TipoDeNo } from "@/lib/laboratorio/nos";
import { IconeDoNo } from "../icones";
import { useAcoesDoQuadro } from "./contexto";
import IntegracaoDeVendas from "./IntegracaoDeVendas";
import { LARGURA_DO_NO, LARGURA_EXPANDIDA } from "./montar";

/**
 * O nó do quadro do Laboratório: cartão arredondado com sombra suave, chip do
 * ícone na cor do tipo, pílula de estado, os campos principais no próprio nó
 * (todos quando expandido) e o resultado (imagens em grade, miniatura da
 * landing). Selecionado ganha brilho na cor do tipo e a barra de ações
 * (Rodar, Duplicar, Sincronizar, Abrir detalhes, Apagar). Arrasta-se pelo
 * cabeçalho; o corpo é nodrag/nowheel para digitar e rolar à vontade.
 */

export interface DadosDoCartao extends Record<string, unknown> {
  no: NoDoLab;
  execucao: ExecucaoDoLab | undefined;
  rodando: boolean;
  /** Animação de construção: atraso de entrada (ms); undefined = já estava no quadro. */
  atraso: number | undefined;
  escolhendo: number | null;
  /** Pôr no ar travado por bloco sem fonte: o motivo (null = livre). */
  trava: string | null;
  expandido: boolean;
  /** Automático: aguardando entradas, pronto, em dia... ("desligado" sem dados.auto). */
  auto?: EstadoDoAuto;
  /** Configuração e Base comum: os nós que recebem (para o resumo). */
  destinos?: string[];
  /** Complemento: o que o nó usa das entradas, o que falta ligar e (Pôr no ar) o pacote do fluxo. */
  usando?: ItemUsado[];
  sugestoes?: TipoDeNo[];
  pacote?: PecaDoPacote[];
  /** O planejar deixou este nó solto: o motivo (null = ligado). */
  solto?: string | null;
}

/** Tipos sem "Gerar com IA" no cabeçalho (a mídia não se escreve; o vídeo vem de fora). */
const SEM_GERAR = ["midia", "video"];

/** Alça redonda, colorida, que cresce no hover (width/height: o translate do xyflow segue centrado). */
const ALCA = "!h-3.5 !w-3.5 !rounded-full !border-2 transition-[width,height] duration-150 hover:!h-[18px] hover:!w-[18px]";

function PilulaDeEstado({ status }: { status: StatusDaExecucao }) {
  const e = ESTADOS[status];
  const I = status === "pronto" ? CheckCircle2 : status === "erro" ? AlertTriangle : status === "rodando" ? Loader2 : status === "aguardando" ? PauseCircle : Clock;
  return (
    <span className={juntar("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium leading-none", e.classe)} data-estado-do-no={status}>
      <I className={juntar("mr-1 h-3 w-3", status === "rodando" && "animate-spin")} aria-hidden="true" />
      {e.rotulo}
    </span>
  );
}

function BarraDoNo({ no, ocupado, trava }: { no: NoDoLab; ocupado: boolean; trava: string | null }) {
  const a = useAcoesDoQuadro();
  const def = TIPOS_DE_NO[no.tipo];
  const noAr = no.tipo === "por_no_ar";
  const acao = juntar(botao.icone, "h-8 w-8 rounded-full");
  return (
    <div
      role="toolbar"
      aria-label={`Ações de ${def.rotulo}`}
      className="nodrag nopan inline-flex items-center rounded-full border border-border bg-popover p-1"
      style={{ boxShadow: "0 6px 20px -8px rgba(0,0,0,0.35)" }}
      data-barra-do-no={no.id}
    >
      {def.roda ? (
        <button
          type="button"
          className={juntar(acao, "text-primary hover:text-primary")}
          onClick={() => a.rodar(no.id)}
          disabled={ocupado || !!trava}
          aria-label={noAr ? "Pedir aprovação do Pôr no ar" : `Rodar ${def.rotulo}`}
          title={trava || (noAr ? "Pedir aprovação (mostra o custo antes)" : "Rodar (mostra o custo antes)")}
          data-rodar-do-no={no.id}
        >
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </button>
      ) : null}
      <button type="button" className={acao} onClick={() => a.duplicar(no.id)} aria-label="Duplicar o nó" title="Duplicar o nó">
        <Copy className="h-4 w-4" aria-hidden="true" />
      </button>
      {def.roda && a.sincronizar ? (
        <button
          type="button"
          className={acao}
          onClick={() => a.sincronizar && a.sincronizar(no.id)}
          disabled={ocupado || !!trava}
          aria-label="Sincronizar"
          title="Sincronizar: roda de novo este nó com o que vem antes dele (mostra o custo antes)"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      {a.abrirDetalhes ? (
        <button type="button" className={acao} onClick={() => a.abrirDetalhes && a.abrirDetalhes(no.id)} aria-label="Abrir detalhes" title="Abrir detalhes (ligações e tudo do nó)">
          <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
      <button type="button" className={juntar(acao, "hover:text-destructive")} onClick={() => a.apagar(no.id)} aria-label="Apagar o nó" title="Apagar o nó">
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

const CartaoDoNo = memo(function CartaoDoNo({ data, selected }: NodeProps<Node<DadosDoCartao>>) {
  const a = useAcoesDoQuadro();
  const { no, execucao, expandido } = data;
  const def = TIPOS_DE_NO[no.tipo];
  const status = execucao ? execucao.status : null;
  const ocupado = data.rodando || emAndamento(status);
  const largura = expandido ? LARGURA_EXPANDIDA : LARGURA_DO_NO;
  const construindo = typeof data.atraso === "number";
  const titulo = typeof no.dados.titulo === "string" && no.dados.titulo.trim() ? no.dados.titulo.trim() : def.rotulo;
  const [gerar, setGerar] = useState(false);
  const midia = no.tipo === "midia";
  const podeGerarIA = SEM_GERAR.indexOf(no.tipo) < 0 && !(no.tipo === "area_membros" && (no.dados.plataforma || "painel") === "painel");

  const sombra = selected
    ? `0 0 0 2px ${def.cor}, 0 0 0 6px ${def.cor}26, 0 14px 34px -12px ${def.cor}99`
    : status === "erro"
      ? "0 0 0 1px hsl(var(--destructive) / 0.55), 0 8px 24px -14px rgba(0,0,0,0.35)"
      : "0 1px 2px rgba(0,0,0,0.06), 0 8px 24px -14px rgba(0,0,0,0.35)";
  const estilo: CSSProperties = { width: largura, boxShadow: sombra };
  if (construindo) estilo.animationDelay = `${data.atraso}ms`;

  return (
    <div
      className={juntar(
        superficie.painel,
        "group/no relative rounded-xl text-left transition-shadow duration-200",
        construindo && "duration-300 animate-in fade-in-0 zoom-in-90 slide-in-from-left-3 fill-mode-both motion-reduce:animate-none",
      )}
      style={estilo}
      data-no-do-quadro={no.id}
      data-tipo-do-no={no.tipo}
      data-construindo={construindo ? String(data.atraso) : undefined}
      data-expandido={expandido ? "" : undefined}
    >
      <NodeToolbar isVisible={selected} position={Position.Top} offset={12}>
        <BarraDoNo no={no} ocupado={ocupado} trava={data.trava} />
      </NodeToolbar>
      {def.entradas.length > 0 ? (
        <Handle type="target" position={Position.Left} id="entrada" className={ALCA} style={{ background: "hsl(var(--card))", borderColor: def.cor }} isConnectable={!a.travado} />
      ) : null}
      <span className="pointer-events-none absolute inset-x-4 top-0 h-[3px] rounded-b-full" style={{ background: def.cor }} aria-hidden="true" />

      <div className={juntar("flex min-w-0 items-center px-3 pb-2 pt-3", !a.travado && "cursor-grab active:cursor-grabbing")}>
        <span className="mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${def.cor}1f`, color: def.cor }}>
          <IconeDoNo tipo={no.tipo} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-snug" title={`${def.rotulo}: ${def.dica}`}>
          {titulo}
        </span>
        {data.auto === "aguardando" && !ocupado ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-amber-500/15 px-2 text-[11px] font-medium leading-none text-amber-700 dark:text-amber-300" title="Automático: roda sozinho quando as entradas ficarem prontas" data-aguardando-entradas="">
            <Hourglass className="mr-1 h-3 w-3" aria-hidden="true" />
            Aguardando entradas
          </span>
        ) : noMotorDaCasa(no.tipo, execucao) ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-primary/10 px-2 text-[11px] font-medium leading-none text-primary" title="O motor da casa está gerando: as imagens aparecem conforme chegam" data-estado-do-no="no_motor">
            <WandSparkles className="mr-1 h-3 w-3 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
            No motor
          </span>
        ) : status ? (
          <PilulaDeEstado status={status} />
        ) : def.roda ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-muted px-2 text-[11px] font-medium leading-none text-muted-foreground">Não rodou</span>
        ) : null}
        {data.trava ? (
          <span className="ml-1 inline-flex shrink-0 text-warning" title={data.trava} aria-label={data.trava} role="img" data-trava-no-quadro="">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        ) : null}
        {podeGerarIA ? (
          <button
            type="button"
            className={juntar(botao.icone, "nodrag ml-1 h-7 w-7 text-primary", gerar && "bg-primary/10")}
            onClick={(e) => {
              e.stopPropagation();
              setGerar(!gerar);
            }}
            aria-label="Gerar com IA"
            title="Gerar com IA: preenche o nó (mostra o custo antes)"
            aria-pressed={gerar}
            data-varinha-do-no={no.id}
          >
            <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className={juntar(botao.icone, "nodrag ml-0.5 h-7 w-7")}
          onClick={(e) => {
            e.stopPropagation();
            a.alternarExpandido(no.id);
          }}
          aria-label={expandido ? "Recolher o nó" : "Expandir o nó"}
          title={expandido ? "Recolher o nó" : "Expandir o nó (todos os campos e o resultado)"}
          aria-expanded={expandido}
          data-expandir-no={no.id}
        >
          {expandido ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </div>

      <div className={juntar("nodrag nowheel nopan min-w-0 cursor-auto px-3", midia ? "pb-0" : "pb-3")} data-corpo-do-no="" tabIndex={0} aria-label={`Conteúdo de ${titulo}`}>
        {podeGerarIA ? <GerarComIA no={no} aberto={gerar} onFechar={() => setGerar(false)} /> : null}
        {data.solto ? (
          <p className={juntar(texto.auxiliar, "mb-2 flex items-center text-warning")} title={data.solto} data-no-solto="">
            <AlertTriangle className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">Solto no fluxo</span>
          </p>
        ) : null}
        {/* O motor pediu a marca (cliente com duas): diz onde escolher e liga a Marca, se faltar. */}
        {execucao && execucao.status === "erro" && /escolha_a_marca|escolha a marca|mais de uma marca/i.test(execucao.erro) ? (
          <div className="mb-2 flex min-w-0 flex-wrap items-center rounded-md bg-warning/10 px-2 py-1.5" data-escolha-a-marca="">
            <span className={juntar(texto.auxiliar, "min-w-0 flex-1 text-foreground")}>Escolha a marca no nó Marca</span>
            {!(data.usando || []).some((u) => /marca/i.test(u.rotulo)) && !a.travado ? (
              <button type="button" className="ml-1 inline-flex h-5 items-center rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground" onClick={() => a.ligarNovo(no.id, "marca")} data-ligar-marca="">
                <Plus className="mr-0.5 h-3 w-3" aria-hidden="true" />
                Ligar Marca
              </button>
            ) : null}
          </div>
        ) : null}
        {/* Com o aviso da marca na tela, o "+ Ligar Marca" fica só nele (sem repetir nas sugestões). */}
        <ComplementoDoNo noId={no.id} usando={data.usando || []} sugestoes={(data.sugestoes || []).filter((t) => !(t === "marca" && execucao && execucao.status === "erro" && /escolha_a_marca|escolha a marca|mais de uma marca/i.test(execucao.erro)))} />
        {no.tipo === "por_no_ar" ? <PacoteDoFluxo pecas={data.pacote || []} /> : null}
        <CorpoEspecial no={no} />
        <CamposDoNo no={no} projetoId={a.projetoId} clienteId={a.clienteId} onMudarDados={(d) => a.mudarDados(no.id, d)} lugar="no" todos={expandido} grande={expandido} pular={CAMPOS_TRATADOS[no.tipo]} />
        <RodapeDoCorpo no={no} destinos={data.destinos || []} />
        {/* v4: o endereço do webhook de vendas do gateway, no checkout expandido. */}
        {expandido && no.tipo === "checkout" ? <div className="nodrag nowheel"><IntegracaoDeVendas clienteId={a.clienteId || null} gateway={String(no.dados.gateway || "")} /></div> : null}
        {/* Nós criativos: as imagens com as funções da Mesa Foto (principal, ajustar, variar, referência, salvar, baixar, comparar). */}
        {TIPOS_CRIATIVOS.indexOf(no.tipo) >= 0 ? <ImagensDoResultado no={no} execucao={execucao} /> : null}
        <ResultadoDoNo execucao={execucao} tipo={no.tipo} compacto={!expandido} largura={largura - 24} escolhendo={data.escolhendo} onEscolherStoryboard={(i) => a.escolherStoryboard(no.id, i)} semImagens={TIPOS_CRIATIVOS.indexOf(no.tipo) >= 0} />
      </div>
      {/* Mídia: a foto ou o vídeo de ponta a ponta, com os cantos do cartão. */}
      {midia ? (
        <div className="nodrag nowheel nopan min-w-0 cursor-auto">
          <MidiaDoNo no={no} expandido={expandido} />
        </div>
      ) : null}
      <div className="nodrag nopan">
        <RodapeDoNo no={no} execucao={execucao} selecionado={!!selected} ocupado={ocupado} trava={data.trava} />
      </div>

      <Handle type="source" position={Position.Right} id="saida" className={ALCA} style={{ background: def.cor, borderColor: "hsl(var(--card))" }} isConnectable={!a.travado} />
      {!a.travado ? (
        <button
          type="button"
          className={juntar(
            "nodrag nopan absolute -right-8 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground transition-opacity hover:text-foreground",
            selected ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover/no:opacity-100",
          )}
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            a.abrirMenu({ no: no.id, lado: "saida" }, { x: r.right + 8, y: r.top + r.height / 2 });
          }}
          aria-label="Ligar a um nó novo"
          title="Ligar a um nó novo"
          data-mais-do-no={no.id}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});

export default CartaoDoNo;
