import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport as ViewportDoQuadro,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Clapperboard,
  ClipboardList,
  Copy,
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  ImagePlus,
  Layers,
  LayoutList,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ampliar } from "@/components/mesa/Ampliar";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { ErroDaMesa, padraoPara, textoDoErro } from "@/lib/mesa/api";
import { useModoFoco } from "@/lib/modoFoco";
import { useBiblioteca, useFotos, useKits } from "./fotoApi";
import { lerPedidoAoCanvas, motoresDaRodada, rotuloDoMotor, useAncoras, useAndamentos, usePersonas } from "./modelosApi";
import {
  aplicarModeloPronto,
  apagarRascunho,
  baixarImagem,
  bloqueiosDoGerar,
  canvasVazio,
  chaveDosCanvases,
  conversarNoCanvas,
  desligar,
  entradasDoGerar,
  faltaNoCartao,
  guardarRascunho,
  juntarResultados,
  lerRascunho,
  ligar,
  MODELOS_EM_DESTAQUE,
  MODELOS_PRONTOS,
  montarPelaResposta,
  mudarDados,
  mudarLigacao,
  nomeDoResultado,
  novoId,
  novoNo,
  ORDEM_DAS_ENTRADAS,
  papelDaAlca,
  partesDaSerie,
  partesDoResultado,
  podeLigar,
  porCartao,
  removerNo,
  resultadoAlvo,
  resumoDoResultado,
  rotuloDaAcao,
  rotuloDaPose,
  rotuloDoPapel,
  ROTULOS_DAS_ENTRADAS,
  salvarCanvas,
  TAMANHO_DA_SAIDA,
  TAMANHO_DO_AGENTE,
  TAMANHO_DO_CARTAO,
  tamanhoDoNo,
  TIPOS_DE_NO,
  TIPOS_FUTUROS,
  useCanvases,
  useProdutosDeFora,
  VARIACOES_POR_VEZ,
  type Canvas,
  type DadosDoNo,
  type NoDoCanvas,
  type PersonagemCriada,
  type ProdutoDaEsteira,
  type ResultadoDoCanvas,
  type TipoDeNo,
} from "./canvasApi";
import { ChatDoAgente } from "./canvas/Agente";
import { EditorDaLigacaoDeResultado } from "./canvas/Cena";
import { HistoriaDoCanvas, type AcoesDaHistoria } from "./canvas/FaixaDaHistoria";
import { cenaNova, cenasDaHistoria, duplicarCena, marcarComoCena, proximaCena } from "./canvas/historia";
import { BOTAO, descrever, FLUTUANTE, Gaveta, ICONE_DO_VIDEO, ICONES, kitsUsaveis, MiniaturaGrande, PAINEL, useRodaPresa, type Descricao, type Fontes } from "./canvas/comum";
import { AjustesDoResultado, CustoDoResultado, EditorDoCartao, useUsoDoResultado } from "./canvas/Editores";
import { EscolherCartao, type AbaDaEscolha, type PedidoDeEscolha } from "./canvas/Escolher";
import { EsteiraDeProdutos, TIPO_ARRASTADO_DA_ESTEIRA } from "./canvas/Esteira";
import { ComoFunciona, GaleriaDeModelos } from "./canvas/Galeria";
import { andamentoDoResultado, gerarNoResultado, gerarVariacoes, tirarPendentes, usePendentes } from "./canvas/geracao";
import { ModoLista } from "./canvas/ModoLista";

/**
 * Canvas v3 (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 7 e 9.2; pedidos do
 * dono em 25/09). O Canvas é de composição: Produto (deste ou de outro
 * cliente, pela esteira do topo), Pessoa (modelo sintética ou foto real com
 * autorização), Ambiente (descrever, foto usada ou complementada, contexto),
 * Estilo, Pedido e o Agente (bolinha de conversa que escreve o pedido). Tudo
 * se liga sozinho ao Resultado, que tem a ação (na mão de, segurando, olhando
 * para, no ambiente, trocar fundo), a pose (apresentando, UGC selfie, uso
 * real, close da mão) e o carrossel (3 a 6). Na foto: aprovar, Usar na Mesa
 * e Finalizar em 1 clique, Variações desta (mesma identidade, outro ângulo).
 *
 * Visual: quadro claro com cartões pretos e compactos; painéis pretos e
 * menores. Modo foco: com o Canvas aberto, a barra de cima e os botões
 * flutuantes do painel somem (src/lib/modoFoco.ts); a tela cheia sai por um
 * portal no body (antes ficava presa no contexto de empilhamento da página e
 * a barra do painel aparecia por cima).
 *
 * React Flow (@xyflow/react) só neste arquivo, carregado quando a aba abre
 * (as peças sem React Flow ficam em ./canvas/). Piso do painel (Safari 11 /
 * Chrome 64): caixa de seleção desligada (usa Pointer Events), conexão por
 * toque (tocar uma alça e depois a outra), cartões de tamanho fixo com as
 * alças declaradas no próprio nó, miniaturas com altura fixa em px. Em tela
 * menor que 768 px abre o modo lista, com o mesmo grafo em formulário.
 *
 * Uso (dono, 26/09: "está cobrindo demais o quadro" e "quando eu rolo, ele
 * fica mexendo todo o canvas"): o que abre sobre o quadro é estreito, tem
 * altura máxima e rolagem própria, e fica encostado na lateral (a escolha e
 * os modelos prontos numa gaveta ao lado da paleta, os ajustes à direita; em
 * tela pequena, folha no pé do quadro). Rolar no fundo do quadro move o
 * quadro; Ctrl (ou Cmd) + rolar e a pinça dão zoom. Rolar num painel rola só
 * o painel: classes nowheel/nopan/nodrag e a roda presa (./canvas/comum).
 *
 * Cenas (dono, 25/09 à noite): o Resultado tem uma alça de saída à direita; a
 * linha que sai dele e chega noutro Resultado leva a foto como personagem,
 * produto, cenário ou estilo (a alça onde chega escolhe o papel; troca no
 * painel da ligação). Resultado marcado como cena entra na História (faixa
 * no pé do quadro, ./canvas/Historia.tsx). A pessoa da foto vira personagem
 * nos ajustes do Resultado (./canvas/Personagem.tsx).
 */

const ALCA = 12;
const PASSO_DAS_ENTRADAS = 20;
const TOPO_DAS_ENTRADAS = Math.round(TAMANHO_DA_SAIDA.altura / 2 - 2.5 * PASSO_DAS_ENTRADAS);
const ALTURA_DA_FOTO = 206;
const ATRASO_DO_SALVAR_MS = 1500;
const DURACAO_DA_LINHA_NOVA_MS = 1800;
const CHAVE_DO_COMO_FUNCIONA = "mesa-foto:canvas:como-funciona-visto";
const CHAVE_DO_FOCO = "mesa-foto:canvas:foco-desligado";
const TIPOS_DA_BARRA: Exclude<TipoDeNo, "gerar">[] = ["produto", "modelo", "ambiente", "estilo", "texto", "agente"];

// ------------------------------------------------------------------ contexto do quadro (os nós chamam a tela)

interface ValorDoQuadro {
  fontes: Fontes;
  /** Gera no Resultado (salva antes; em segundo plano). */
  gerar: (gerarId: string) => Promise<Record<string, never>>;
  /** Variações da foto (mesma identidade, ângulos diferentes). */
  variacoes: (gerarId: string, r: ResultadoDoCanvas) => Promise<unknown>;
  /** Abre a escolha com miniatura para trocar o conteúdo do cartão. */
  abrirEscolha: (tipo: TipoDeNo, trocarId: string | null) => void;
  /** Seleciona o cartão e abre os ajustes. */
  abrir: (noId: string) => void;
  tirar: (noId: string) => void;
  aplicarModelo: (chave: string) => void;
}

const ContextoDoQuadro = createContext<ValorDoQuadro | null>(null);

// ------------------------------------------------------------------ nós do quadro

interface DadosDoCartao extends Record<string, unknown> {
  no: NoDoCanvas;
  descricao: Descricao;
  numero: number | null;
  ligado: boolean;
}

interface DadosDoResultado extends Record<string, unknown> {
  no: NoDoCanvas;
  junta: string;
  bloqueios: string[];
  entradas: number;
  /** Posição na história (null = não é cena) e o título da cena. */
  cena: { numero: number; titulo: string } | null;
}

type NoDeCartao = Node<DadosDoCartao>;
type NoDeResultado = Node<DadosDoResultado>;

/** Barrinha que aparece em cima do cartão selecionado: ajustar e apagar. */
function FerramentasDoNo({ noId, tipo }: { noId: string; tipo: TipoDeNo }) {
  const ctx = useContext(ContextoDoQuadro);
  if (!ctx) return null;
  return (
    <div className="nodrag absolute -top-9 right-0 flex items-center rounded-lg border border-white/10 bg-zinc-950 p-0.5 shadow-xl" data-ferramentas-do-no={noId}>
      <button type="button" className="flex h-7 items-center rounded-md px-1.5 text-[11px] text-zinc-200 hover:bg-white/10" onClick={() => ctx.abrir(noId)} aria-label="Ajustar o cartão">
        <SlidersHorizontal className="mr-1 h-3 w-3" /> Ajustar
      </button>
      <button type="button" className="flex h-7 items-center rounded-md px-1.5 text-[11px] text-red-300 hover:bg-red-500/15" onClick={() => ctx.tirar(noId)} aria-label={tipo === "gerar" ? "Apagar o Resultado" : "Apagar o cartão"}>
        <Trash2 className="mr-1 h-3 w-3" /> Apagar
      </button>
    </div>
  );
}

function NoCartao({ data, selected }: NodeProps<NoDeCartao>) {
  const ctx = useContext(ContextoDoQuadro);
  const { no, descricao, numero, ligado } = data;
  const tipo = TIPOS_DE_NO[no.tipo];
  const Icone = ICONES[no.tipo];
  const falta = faltaNoCartao(no);
  const texto = (no.dados.texto || "").trim();
  const semMiniatura = !descricao.miniatura;
  return (
    <div
      style={{ width: TAMANHO_DO_CARTAO.largura, height: TAMANHO_DO_CARTAO.altura }}
      className={`relative overflow-visible rounded-xl border bg-zinc-950 text-left text-zinc-100 shadow-lg shadow-black/30 ${selected ? "border-white/60 ring-2 ring-emerald-400/70" : "border-white/10"}`}
      data-no-do-canvas={no.id}
      data-tipo={no.tipo}
    >
      <span className="pointer-events-none absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full" style={{ background: tipo.cor }} />
      <div className="flex h-6 items-center pl-3 pr-2 pt-1">
        <Icone className={`mr-1 h-3 w-3 shrink-0 ${tipo.texto}`} />
        <span className={`min-w-0 flex-1 truncate text-[9.5px] font-semibold uppercase tracking-wider ${tipo.texto}`}>{tipo.rotulo}</span>
        {numero !== null && (
          <span className="rounded-full bg-white/10 px-1.5 text-[9.5px] font-semibold text-white" title="Ordem em que vai ao gerador">
            {numero}
          </span>
        )}
        {!ligado && <span className="ml-1 rounded-full bg-white/10 px-1.5 text-[9px] text-zinc-400">solto</span>}
      </div>
      <div className="flex items-center px-2 pb-2 pl-3 pt-1">
        {no.tipo === "texto" ? null : semMiniatura && !(no.tipo === "ambiente" && (texto || no.dados.modo === "contexto")) && !(no.tipo === "modelo" && no.dados.imagem_id) ? (
          <button
            type="button"
            className="nodrag mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/20 text-zinc-400 hover:border-emerald-400/60 hover:text-white"
            onClick={() => ctx && ctx.abrirEscolha(no.tipo, no.id)}
            data-escolher-no-cartao={no.id}
            aria-label={`Escolher ${tipo.rotulo.toLowerCase()}`}
          >
            <ImagePlus className="h-4 w-4" />
          </button>
        ) : semMiniatura ? (
          <span className={`mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tipo.fundo}`}>
            <Icone className={`h-4 w-4 ${tipo.texto}`} />
          </span>
        ) : (
          <span className="relative mr-2 block h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
            <MiniaturaGrande m={descricao.miniatura} alt={descricao.titulo} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {no.tipo === "texto" ? (
            <p className={`h-11 overflow-hidden text-[11px] leading-snug [overflow-wrap:anywhere] ${texto ? "text-zinc-100" : "text-zinc-500"}`}>{texto ? `"${texto.slice(0, 110)}"` : "Escreva o que você quer na foto."}</p>
          ) : (
            <>
              <p className="truncate text-[12px] font-semibold leading-snug">{descricao.titulo}</p>
              <p className={`truncate text-[10.5px] ${falta ? "text-amber-300" : "text-zinc-400"}`}>{descricao.subtitulo}</p>
            </>
          )}
        </div>
      </div>
      {selected && <FerramentasDoNo noId={no.id} tipo={no.tipo} />}
      <Handle type="source" position={Position.Right} id="saida" style={{ width: ALCA, height: ALCA, background: tipo.cor, border: "2px solid #09090b" }} />
    </div>
  );
}

/** O Agente: uma bolinha. Tocar abre a conversa no painel. */
function NoAgente({ data, selected }: NodeProps<NoDeCartao>) {
  const { no, ligado } = data;
  const tipo = TIPOS_DE_NO.agente;
  const Icone = ICONES.agente;
  const temPedido = !!(no.dados.pedido || "").trim();
  return (
    <div style={{ width: TAMANHO_DO_AGENTE.largura, height: TAMANHO_DO_AGENTE.altura }} className="relative flex flex-col items-center" data-no-do-canvas={no.id} data-tipo="agente">
      <span
        className={`relative flex h-[60px] w-[60px] items-center justify-center rounded-full border bg-zinc-950 shadow-lg shadow-violet-500/20 ${selected ? "border-violet-300 ring-2 ring-violet-400/70" : "border-violet-400/50"}`}
        title={tipo.dica}
      >
        <Icone className="h-6 w-6 text-violet-300" />
        {temPedido && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-emerald-400" title="Já escreveu o pedido" />}
      </span>
      <span className="mt-1 max-w-full truncate rounded-full bg-zinc-950 px-2 text-[10.5px] font-semibold text-violet-200">{ligado ? "Agente" : "Agente (solto)"}</span>
      {selected && <FerramentasDoNo noId={no.id} tipo="agente" />}
      <Handle type="source" position={Position.Right} id="saida" style={{ top: 30, width: ALCA, height: ALCA, background: tipo.cor, border: "2px solid #09090b" }} />
    </div>
  );
}

function useSegundos(ativo: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!ativo) {
      setS(0);
      return;
    }
    const inicio = Date.now();
    const id = window.setInterval(() => setS(Math.round((Date.now() - inicio) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [ativo]);
  return s;
}

const ICONE = "nodrag inline-flex h-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-1.5 text-[11px] text-zinc-100 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50";

function NoResultado({ data, selected }: NodeProps<NoDeResultado>) {
  const ctx = useContext(ContextoDoQuadro);
  const { no, junta, bloqueios, entradas, cena } = data;
  const { catalogo } = useMesa();
  const andamentos = useAndamentos();
  const avisarErro = useAvisarErro();
  const [mostrando, setMostrando] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const motores = no.dados.motores || [];
  const carrossel = no.dados.carrossel || 0;
  const prontos = (no.dados.resultados || []).filter((r) => r.status === "gerada" && !!(r.storage_path || r.url));
  useEffect(() => setMostrando(null), [prontos.length]);
  const atual = prontos.find((r) => r.geracao_id === mostrando) || (prontos.length ? prontos[prontos.length - 1] : null);
  const fotos = ctx ? ctx.fontes.fotos : [];
  const foto = atual && atual.imagem_id ? fotos.find((f) => f.id === atual.imagem_id) || null : null;
  const uso = useUsoDoResultado(fotos);
  const { gerando, falhas } = andamentoDoResultado(andamentos, no.id);
  const segundos = useSegundos(gerando.length > 0);
  const caminho = atual ? atual.storage_path || atual.url : "";
  const detalhes = [no.dados.acao && no.dados.acao !== "livre" ? rotuloDaAcao(no.dados.acao) : "", no.dados.pose && no.dados.pose !== "nenhuma" ? rotuloDaPose(no.dados.pose) : "", carrossel ? `carrossel ${carrossel}` : ""].filter(Boolean);

  const baixar = async () => {
    if (!atual || baixando) return;
    setBaixando(true);
    try {
      await baixarImagem(atual.storage_bucket, atual.storage_path || atual.url, foto ? foto.nome : `canvas-${rotuloDoMotor(catalogo, atual.motor_id)}`);
    } catch (e) {
      avisarErro(e, "Foto não baixada");
    } finally {
      setBaixando(false);
    }
  };

  const rotuloDoGerar = carrossel ? `Gerar carrossel de ${carrossel}` : motores.length > 1 ? `Gerar em ${motores.length} motores` : prontos.length ? "Gerar de novo" : "Gerar foto";
  const destaque = MODELOS_PRONTOS.filter((m) => MODELOS_EM_DESTAQUE.indexOf(m.chave) >= 0);

  return (
    <div
      style={{ width: TAMANHO_DA_SAIDA.largura, height: TAMANHO_DA_SAIDA.altura }}
      className={`relative flex flex-col overflow-visible rounded-2xl border bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/40 ${selected ? "border-white/60 ring-2 ring-emerald-400/70" : "border-white/15"}`}
      data-no-do-canvas={no.id}
      data-tipo="gerar"
    >
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="mr-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20">
          <Sparkles className="h-3 w-3 text-emerald-300" />
        </span>
        {cena ? (
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" data-cena-no-quadro={cena.numero} title="Cena da história">
            <span className="mr-1 rounded-full bg-emerald-400 px-1.5 text-[10px] font-bold text-black">Cena {cena.numero}</span>
            {cena.titulo}
          </span>
        ) : (
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider">Resultado</span>
        )}
        {gerando.length > 0 ? (
          <Loader2 className="h-4 w-4 animate-spin text-emerald-300" aria-label="Gerando" />
        ) : (
          <span className="text-[10px] text-zinc-400">
            {prontos.length} {prontos.length === 1 ? "foto" : "fotos"}
          </span>
        )}
      </div>
      <p className="h-8 shrink-0 overflow-hidden px-3 text-[10.5px] leading-snug text-zinc-400 [overflow-wrap:anywhere]" data-junta="" title={junta || undefined}>
        {junta ? <span className="text-zinc-100">{junta}</span> : "Junta o que você puser no quadro. Comece por um produto ou uma pessoa."}
      </p>
      <div className="relative mx-2.5 mt-0.5 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-900" style={{ height: ALTURA_DA_FOTO }} data-foto-do-resultado={atual ? atual.geracao_id : ""}>
        {atual ? (
          <button type="button" className="nodrag block h-full w-full cursor-zoom-in" onClick={() => setAmpliada(true)} aria-label="Ver a foto grande">
            <ImagemDaMesa caminho={caminho} bucket={atual.storage_bucket} alt="Foto gerada no Canvas" className="h-full w-full !object-contain" />
            <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex items-center rounded-full border border-emerald-400/40 bg-zinc-950/85 px-1.5 py-px text-[9px] font-semibold text-emerald-300" data-selo="gerada">
              <Sparkles className="mr-0.5 h-2.5 w-2.5" /> gerada
            </span>
            {foto && foto.aprovada && (
              <span className="pointer-events-none absolute right-1.5 top-1.5 inline-flex items-center rounded-full border border-emerald-400/40 bg-zinc-950/85 px-1.5 py-px text-[9px] font-semibold text-emerald-300">
                <Check className="mr-0.5 h-2.5 w-2.5" /> aprovada
              </span>
            )}
          </button>
        ) : gerando.length > 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            <Loader2 className="mb-2 h-6 w-6 animate-spin text-emerald-300" />
            <p className="text-[12px] font-medium">Gerando {gerando.length > 1 ? `${gerando.length} fotos` : "a foto"}</p>
            <p className="mt-0.5 text-[10.5px] text-zinc-400">De 30 s a 2 min por foto. Pode sair da aba: fica salvo.</p>
          </div>
        ) : entradas === 0 && ctx ? (
          <div className="flex h-full flex-col justify-center px-2.5 text-left" data-comece-rapido="">
            <p className="mb-1.5 text-center text-[10.5px] text-zinc-400">A foto aparece aqui. Comece por um modelo pronto:</p>
            {destaque.map((m) => (
              <button
                key={m.chave}
                type="button"
                className="nodrag mb-1 flex w-full items-center rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-left text-[11.5px] font-medium transition-colors hover:border-emerald-400/60"
                onClick={() => ctx.aplicarModelo(m.chave)}
                data-modelo-pronto={m.chave}
                title={m.dica}
              >
                <Wand2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <span className="min-w-0 flex-1 truncate">{m.rotulo}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center text-zinc-400">
            <Sparkles className="mb-1.5 h-5 w-5 text-emerald-300/70" />
            <p className="text-[11.5px]">A foto aparece aqui.</p>
          </div>
        )}
      </div>
      <div className="mx-2.5 mt-1.5 h-8 shrink-0" data-andamento-do-resultado="">
        {gerando.length > 0 ? (
          <div className="min-w-0">
            <div className="mb-1 flex items-center text-[10.5px]">
              <span className="min-w-0 flex-1 truncate text-zinc-100">{gerando.length > 1 ? `Gerando ${gerando.length} fotos` : `Gerando no ${rotuloDoMotor(catalogo, gerando[0].motor)}`}</span>
              <span className="text-zinc-400">{segundos} s</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full animate-pulse rounded-full bg-emerald-400" style={{ width: `${Math.min(92, 8 + segundos * 1.2)}%` }} />
            </div>
          </div>
        ) : prontos.length > 1 ? (
          <div className="flex min-w-0 items-center overflow-hidden" aria-label="Fotos deste Resultado">
            {prontos
              .slice(-7)
              .reverse()
              .map((r) => (
                <button
                  key={r.geracao_id}
                  type="button"
                  className={`nodrag mr-1 block shrink-0 overflow-hidden rounded-md border ${atual && atual.geracao_id === r.geracao_id ? "border-emerald-400" : "border-white/10"}`}
                  style={{ width: 30, height: 30 }}
                  onClick={() => setMostrando(r.geracao_id)}
                  aria-label={`Ver a foto do ${rotuloDoMotor(catalogo, r.motor_id)}`}
                  title={`${rotuloDoMotor(catalogo, r.motor_id)}${r.tipo === "carrossel" ? `, carrossel ${r.quadro || ""}` : r.tipo === "variacao" ? ", variação" : ""}`}
                >
                  <MiniaturaDoStorage bucket={r.storage_bucket} caminho={r.storage_path || r.url} alt="" largura={96} className="h-full w-full" />
                </button>
              ))}
          </div>
        ) : falhas.length > 0 ? (
          <p className="truncate pt-1.5 text-[10.5px] text-red-400" role="alert" title={falhas.map((f) => `${rotuloDoMotor(catalogo, f.motor)}: ${f.a.erro}`).join("\n")}>
            {rotuloDoMotor(catalogo, falhas[0].motor)} falhou: {falhas[0].a.erro}
          </p>
        ) : (
          <p className="truncate pt-1.5 text-[10.5px] text-zinc-400">
            {motores.length} {motores.length === 1 ? "motor" : "motores"} · {String(no.dados.formato || "4:5")} · {entradas} {entradas === 1 ? "cartão" : "cartões"}
            {detalhes.length ? ` · ${detalhes.join(" · ")}` : ""}
          </p>
        )}
      </div>
      <div className="mx-2.5 flex h-8 shrink-0 items-center" data-acoes-do-resultado="">
        {atual ? (
          <>
            <button
              type="button"
              className={`${ICONE} mr-1`}
              disabled={!!uso.ocupado || !atual.imagem_id}
              onClick={() => void uso.usarNaMesa(atual)}
              aria-label="Usar na Mesa"
              title="Aprova (se precisar) e abre o Estúdio da Mesa com esta foto"
            >
              {uso.ocupado === "usar" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowUpRight className="mr-1 h-3 w-3" />} Mesa
            </button>
            <button type="button" className={`${ICONE} mr-1`} disabled={!!uso.ocupado || !atual.imagem_id} onClick={() => void uso.finalizar(atual)} aria-label="Finalizar" title="Aprova (se precisar) e abre o Usar da Mesa Foto">
              {uso.ocupado === "finalizar" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCheck className="mr-1 h-3 w-3" />} Finalizar
            </button>
            {ctx && atual.imagem_id && (
              <BotaoComCusto
                rotulo={<Copy className="h-3 w-3" />}
                titulo="Variações desta foto"
                descricao={`Variações desta: ${VARIACOES_POR_VEZ} fotos com a mesma pessoa, o mesmo produto e o mesmo estilo, em ângulos diferentes.`}
                variant="outline"
                className="nodrag mr-1 h-7 border-white/10 bg-white/5 px-1.5 text-[10.5px] text-zinc-100 hover:bg-white/15"
                fecharAoConfirmar
                disabled={gerando.length > 0}
                partes={() => partesDaSerie(atual.motor_id, no.dados.qualidade || "alta", entradas, VARIACOES_POR_VEZ, true)}
                executar={() => ctx.variacoes(no.id, atual)}
              />
            )}
            <button type="button" className={ICONE} disabled={baixando} onClick={() => void baixar()} aria-label="Baixar" title="Baixar a foto (com gerada no nome)">
              {baixando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            </button>
          </>
        ) : (
          <p className={`truncate text-[10.5px] ${bloqueios.length ? "text-amber-300" : "text-zinc-400"}`} title={bloqueios.join("\n") || undefined}>
            {bloqueios.length ? bloqueios[0] : "Tudo pronto para gerar."}
          </p>
        )}
      </div>
      <div className="mx-2.5 mb-2.5 mt-auto">
        <BotaoComCusto
          rotulo={
            <>
              {carrossel ? <Layers className="mr-1.5 h-4 w-4" /> : <Sparkles className="mr-1.5 h-4 w-4" />} {rotuloDoGerar}
            </>
          }
          titulo="Geração do Canvas"
          descricao={carrossel ? "Fotos coerentes no primeiro motor, uma de cada vez a partir da capa. Tudo entra no acervo, marcado como gerado." : "Uma foto por motor ligado. O que sair entra no acervo, marcado como gerado, e aparece aqui."}
          className="nodrag h-9 w-full rounded-xl bg-emerald-400 text-[12.5px] font-semibold text-black hover:bg-emerald-300"
          disabled={!ctx || bloqueios.length > 0 || gerando.length > 0}
          fecharAoConfirmar
          partes={() => partesDoResultado(no, entradas)}
          executar={() => (ctx ? ctx.gerar(no.id) : Promise.resolve({}))}
        />
      </div>
      {selected && <FerramentasDoNo noId={no.id} tipo="gerar" />}
      {/* Saída do Resultado: a foto entra noutro Resultado (personagem, produto, cenário ou estilo). */}
      <Handle type="source" position={Position.Right} id="saida" title="Ligar esta foto noutro Resultado" style={{ width: ALCA, height: ALCA, background: COR_DA_CENA, border: "2px solid #09090b" }} />
      {ORDEM_DAS_ENTRADAS.map((e, i) => (
        <Handle
          key={e}
          type="target"
          position={Position.Left}
          id={e}
          title={ROTULOS_DAS_ENTRADAS[e]}
          style={{ top: TOPO_DAS_ENTRADAS + i * PASSO_DAS_ENTRADAS, width: ALCA, height: ALCA, background: TIPOS_DE_NO[e === "pessoa" ? "modelo" : (e as TipoDeNo)].cor, border: "2px solid #09090b" }}
        />
      ))}
      {atual && (
        <Ampliar
          imagens={[{ caminho, bucket: atual.storage_bucket, titulo: `Resultado do Canvas, ${rotuloDoMotor(catalogo, atual.motor_id)} (gerada)`, legenda: "Imagem gerada por IA" }]}
          indice={ampliada ? 0 : null}
          onFechar={() => setAmpliada(false)}
        />
      )}
    </div>
  );
}

const TIPOS_NO_QUADRO = { produto: NoCartao, modelo: NoCartao, ambiente: NoCartao, estilo: NoCartao, texto: NoCartao, agente: NoAgente, gerar: NoResultado };

/** Cor da linha e da alça de Resultado para Resultado (cena anterior). */
const COR_DA_CENA = "#34d399";

/** Alças declaradas no próprio nó: as linhas não dependem de medir o cartão depois de montar. */
function alcasDoNo(tipo: TipoDeNo) {
  if (tipo === "gerar") {
    const entradas = ORDEM_DAS_ENTRADAS.map((e, i) => ({ id: e, type: "target" as const, position: Position.Left, x: -ALCA / 2, y: TOPO_DAS_ENTRADAS + i * PASSO_DAS_ENTRADAS - ALCA / 2, width: ALCA, height: ALCA }));
    return [
      ...entradas,
      { id: "saida", type: "source" as const, position: Position.Right, x: TAMANHO_DA_SAIDA.largura - ALCA / 2, y: TAMANHO_DA_SAIDA.altura / 2 - ALCA / 2, width: ALCA, height: ALCA },
    ];
  }
  const t = tamanhoDoNo(tipo);
  const y = tipo === "agente" ? 30 : t.altura / 2;
  return [{ id: "saida", type: "source" as const, position: Position.Right, x: t.largura - ALCA / 2, y: y - ALCA / 2, width: ALCA, height: ALCA }];
}

// ------------------------------------------------------------------ peças que flutuam sobre o quadro

function Paleta({ onTipo, onAdicionar, onResultado }: { onTipo: (t: TipoDeNo) => void; onAdicionar: () => void; onResultado: () => void }) {
  const roda = useRodaPresa<HTMLElement>();
  return (
    <nav
      ref={roda}
      aria-label="Cartões para o quadro"
      className={`${PAINEL} ${FLUTUANTE} absolute left-3 top-3 z-10 max-h-[calc(100%-24px)] w-[56px] overflow-y-auto rounded-2xl p-1`}
      data-paleta-lateral=""
      data-rolagem-propria=""
    >
      {TIPOS_DA_BARRA.map((t) => {
        const tipo = TIPOS_DE_NO[t];
        const Icone = ICONES[t];
        return (
          <button
            key={t}
            type="button"
            draggable
            onDragStart={(e) => {
              try {
                e.dataTransfer.setData("application/mesa-foto-no", t);
                e.dataTransfer.effectAllowed = "move";
              } catch {
                /* navegador sem arrastar: o toque adiciona */
              }
            }}
            onClick={() => onTipo(t)}
            title={`${tipo.dica} Toque para pôr no quadro (ou arraste).`}
            data-paleta={t}
            className="mb-0.5 flex w-full flex-col items-center rounded-xl px-0.5 py-1 text-center transition-colors hover:bg-white/10"
          >
            <span className={`flex h-7 w-7 items-center justify-center ${t === "agente" ? "rounded-full" : "rounded-lg"} border ${tipo.borda} ${tipo.fundo}`}>
              <Icone className={`h-3.5 w-3.5 ${tipo.texto}`} />
            </span>
            <span className="mt-0.5 text-[10px] font-medium leading-none text-zinc-200">{tipo.rotulo}</span>
          </button>
        );
      })}
      {TIPOS_FUTUROS.map((t) => (
        <button key={t.chave} type="button" disabled title={t.dica} data-paleta={t.chave} aria-label={`${t.rotulo} (em breve)`} className="mb-0.5 flex w-full cursor-not-allowed flex-col items-center rounded-xl px-0.5 py-1 text-center opacity-50">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-dashed border-white/20">
            <ICONE_DO_VIDEO className="h-3.5 w-3.5 text-zinc-400" />
          </span>
          <span className="mt-0.5 text-[10px] leading-none text-zinc-400">{t.rotulo}</span>
          <span className="text-[8.5px] leading-none text-zinc-500">em breve</span>
        </button>
      ))}
      <span className="mx-1 my-1 block h-px bg-white/10" />
      <button type="button" onClick={onAdicionar} data-paleta="adicionar" className="mb-0.5 flex w-full flex-col items-center rounded-xl px-0.5 py-1 text-center hover:bg-white/10" title="Escolher do acervo, dos produtos ou das pessoas, pela foto">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400 text-black">
          <Plus className="h-4 w-4" />
        </span>
        <span className="mt-0.5 text-[10px] font-medium leading-none text-zinc-200">Adicionar</span>
      </button>
      <button type="button" onClick={onResultado} data-paleta="gerar" className="flex w-full items-center justify-center rounded-lg px-0.5 py-1 text-[9.5px] text-zinc-400 hover:bg-white/10 hover:text-white" title="Outro Resultado, para outra combinação no mesmo quadro">
        <Plus className="mr-0.5 h-3 w-3" /> Result.
      </button>
    </nav>
  );
}

/**
 * Ajustes à direita, recolhíveis. Aberta: estreita e só da altura do conteúdo
 * (no máximo a do quadro), com rolagem própria; em tela pequena, folha no pé
 * do quadro. Antes ia de cima a baixo e cobria o Resultado.
 */
function BarraLateral({ recolhida, onRecolher, titulo, custo, custoCurto, children }: { recolhida: boolean; onRecolher: (v: boolean) => void; titulo: ReactNode; custo: ReactNode; custoCurto: ReactNode; children: ReactNode }) {
  const roda = useRodaPresa<HTMLElement>();
  if (recolhida) {
    return (
      <div ref={roda} className={`${PAINEL} ${FLUTUANTE} absolute right-3 top-3 z-10 flex w-[56px] flex-col items-center rounded-2xl px-1 py-1.5`} data-ajustes="recolhidos">
        <button type="button" onClick={() => onRecolher(false)} aria-label="Abrir os ajustes" className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-white/10" title="Ajustes do cartão ou do Resultado">
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <span className="mt-0.5 text-center text-[9.5px] leading-tight text-zinc-400">Ajustes</span>
        <span className="mt-1.5 text-center text-[10px] font-semibold leading-tight">{custoCurto}</span>
      </div>
    );
  }
  return (
    <aside
      ref={roda}
      aria-label="Ajustes"
      className={`${PAINEL} ${FLUTUANTE} absolute inset-x-2 bottom-2 z-20 flex max-h-[60%] min-w-0 flex-col rounded-2xl sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:z-10 sm:max-h-[calc(100%-24px)] sm:w-[272px] xl:w-[296px]`}
      data-ajustes="abertos"
    >
      <div className="flex shrink-0 items-center border-b border-white/10 px-3 py-2">
        <SlidersHorizontal className="mr-2 h-3.5 w-3.5 text-zinc-400" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12px] font-semibold">{titulo}</h3>
          <p className="truncate text-[10.5px] text-zinc-400">{custo}</p>
        </div>
        <button type="button" onClick={() => onRecolher(true)} aria-label="Recolher os ajustes" className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-3" data-rolagem-propria="">
        {children}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ quadro

type Selecao = { tipo: "no" | "ligacao"; id: string } | null;

function Quadro({
  canvas,
  fontes,
  selecionado,
  onSelecionar,
  onAbrir,
  onMudarCanvas,
  onViewport,
  onSoltar,
  onSoltarProduto,
  cheia,
  onCheia,
  folgaDireita,
  onFundo,
}: {
  /** Largura (px) que os ajustes abertos cobrem à direita: o enquadrar deixa os cartões fora dela. */
  folgaDireita: number;
  /** Toque no fundo do quadro (fecha as gavetas). */
  onFundo: () => void;
  canvas: Canvas;
  fontes: Fontes;
  selecionado: Selecao;
  onSelecionar: (s: Selecao) => void;
  onAbrir: (id: string) => void;
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void;
  onViewport: (v: ViewportDoQuadro) => void;
  onSoltar: (t: TipoDeNo, pos: { x: number; y: number }) => void;
  onSoltarProduto: (kitId: string, pos: { x: number; y: number }) => void;
  cheia: boolean;
  onCheia: () => void;
}) {
  const rf = useReactFlow();
  const andamentos = useAndamentos();

  // Linha nova (ligação automática ou à mão) anda por um instante: dá para ver o cartão se juntando ao Resultado.
  const conhecidas = useRef<string[] | null>(null);
  const relogios = useRef<number[]>([]);
  const [recentes, setRecentes] = useState<string[]>([]);
  useEffect(() => {
    const ids = canvas.ligacoes.map((l) => l.id);
    if (conhecidas.current === null) {
      conhecidas.current = ids;
      return;
    }
    const antes = conhecidas.current;
    const novas = ids.filter((id) => antes.indexOf(id) < 0);
    conhecidas.current = ids;
    if (!novas.length) return;
    setRecentes((r) => r.concat(novas));
    relogios.current.push(window.setTimeout(() => setRecentes((r) => r.filter((id) => novas.indexOf(id) < 0)), DURACAO_DA_LINHA_NOVA_MS));
  }, [canvas.ligacoes]);
  useEffect(() => () => relogios.current.forEach((t) => window.clearTimeout(t)), []);

  // Cartão novo: a vista acompanha, para ele não nascer fora da tela (nem debaixo da paleta ou dos ajustes).
  const contagem = useRef(canvas.nos.length);
  const folga = useRef(folgaDireita);
  folga.current = folgaDireita;
  useEffect(() => {
    const antes = contagem.current;
    contagem.current = canvas.nos.length;
    if (canvas.nos.length <= antes) return;
    const id = window.setTimeout(() => {
      try {
        void rf.fitView({ padding: margensDoQuadro(folga.current), maxZoom: 1, duration: 350 });
      } catch {
        /* quadro ainda sem tamanho */
      }
    }, 60);
    return () => window.clearTimeout(id);
  }, [canvas.nos.length, rf]);

  const nodes = useMemo((): Node[] => {
    const historia = cenasDaHistoria(canvas);
    const nome = (x: NoDoCanvas) => (x.tipo === "gerar" ? nomeDoResultado(canvas, x) : descrever(x, fontes).titulo);
    return canvas.nos.map((n) => {
      const tamanho = tamanhoDoNo(n.tipo);
      const base = {
        id: n.id,
        type: n.tipo,
        position: { x: n.x, y: n.y },
        width: tamanho.largura,
        height: tamanho.altura,
        measured: { width: tamanho.largura, height: tamanho.altura },
        handles: alcasDoNo(n.tipo),
        selected: !!selecionado && selecionado.tipo === "no" && selecionado.id === n.id,
      };
      if (n.tipo === "gerar") {
        const entradas = entradasDoGerar(canvas, n.id);
        const h = historia.find((x) => x.no.id === n.id);
        return {
          ...base,
          data: {
            no: n,
            junta: resumoDoResultado(entradas, nome),
            bloqueios: bloqueiosDoGerar(canvas, n.id, fontes.personas),
            entradas: entradas.length,
            cena: h ? { numero: h.numero, titulo: h.cena.titulo.trim() } : null,
          } as DadosDoResultado,
        };
      }
      const ligacao = canvas.ligacoes.find((l) => l.de === n.id);
      const numero = ligacao ? (entradasDoGerar(canvas, ligacao.para).find((e) => e.ligacao.id === ligacao.id) || { numero: null }).numero : null;
      return { ...base, data: { no: n, descricao: descrever(n, fontes), numero, ligado: !!ligacao } as DadosDoCartao };
    });
  }, [canvas, fontes, selecionado]);

  const edges = useMemo(
    (): Edge[] =>
      canvas.ligacoes.map((l) => {
        const origem = canvas.nos.find((n) => n.id === l.de);
        const cor = l.papel ? COR_DA_CENA : origem ? TIPOS_DE_NO[origem.tipo].cor : "#71717a";
        const ativa = !!selecionado && selecionado.tipo === "ligacao" && selecionado.id === l.id;
        const gerando = andamentoDoResultado(andamentos, l.para).gerando.length > 0;
        const aresta: Edge = {
          id: l.id,
          source: l.de,
          target: l.para,
          sourceHandle: "saida",
          targetHandle: l.entrada,
          selected: ativa,
          reconnectable: true,
          style: { stroke: cor, strokeWidth: ativa ? 3.5 : 2.5, strokeDasharray: l.papel ? "6 4" : undefined },
          animated: gerando || recentes.indexOf(l.id) >= 0,
        };
        // Resultado para Resultado: a linha diz o papel (personagem, produto, cenário, estilo).
        if (l.papel) {
          aresta.label = rotuloDoPapel(l.papel);
          aresta.labelStyle = { fill: "#f4f4f5", fontSize: 11, fontWeight: 600 };
          aresta.labelBgStyle = { fill: "#09090b" };
          aresta.labelBgPadding = [6, 3];
          aresta.labelBgBorderRadius = 8;
        }
        return aresta;
      }),
    [canvas, selecionado, andamentos, recentes],
  );

  const aoMudarNos = useCallback(
    (mudancas: NodeChange[]) => {
      const posicoes: Record<string, { x: number; y: number }> = {};
      const remover: string[] = [];
      mudancas.forEach((m) => {
        if (m.type === "position" && m.position) posicoes[m.id] = m.position;
        if (m.type === "remove") remover.push(m.id);
        if (m.type === "select" && m.selected) onSelecionar({ tipo: "no", id: m.id });
      });
      if (Object.keys(posicoes).length || remover.length) {
        onMudarCanvas((c) => {
          let novo: Canvas = Object.keys(posicoes).length ? { ...c, nos: c.nos.map((n) => (posicoes[n.id] ? { ...n, x: Math.round(posicoes[n.id].x), y: Math.round(posicoes[n.id].y) } : n)) } : c;
          remover.forEach((id) => {
            novo = removerNo(novo, id);
          });
          return novo;
        });
        if (remover.length) onSelecionar(null);
      }
    },
    [onMudarCanvas, onSelecionar],
  );

  const aoMudarLigacoes = useCallback(
    (mudancas: EdgeChange[]) => {
      const remover = mudancas.filter((m) => m.type === "remove").map((m) => m.id);
      mudancas.forEach((m) => {
        if (m.type === "select" && m.selected) onSelecionar({ tipo: "ligacao", id: m.id });
      });
      if (remover.length) {
        onMudarCanvas((c) => remover.reduce((acc, id) => desligar(acc, id), c));
        onSelecionar(null);
      }
    },
    [onMudarCanvas, onSelecionar],
  );

  // Trocar a ligação arrastando a ponta: solta noutro Resultado (ou noutro cartão) liga lá; solta no vazio desliga.
  const religou = useRef(false);

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const posicao = { x: p.x - TAMANHO_DO_CARTAO.largura / 2, y: p.y - 24 };
    const kit = e.dataTransfer.getData(TIPO_ARRASTADO_DA_ESTEIRA);
    if (kit) {
      e.preventDefault();
      try {
        const v = JSON.parse(kit);
        if (v && typeof v.kit_id === "string") onSoltarProduto(v.kit_id, posicao);
      } catch {
        /* arrasto de outro lugar: ignora */
      }
      return;
    }
    const t = e.dataTransfer.getData("application/mesa-foto-no") as TipoDeNo;
    if (!t || !TIPOS_DE_NO[t]) return;
    e.preventDefault();
    onSoltar(t, posicao);
  };

  const estilo = {
    "--xy-background-color": "#eef0f3",
    "--xy-controls-button-background-color": "#09090b",
    "--xy-controls-button-background-color-hover": "#27272a",
    "--xy-controls-button-color": "#f4f4f5",
    "--xy-controls-button-color-hover": "#ffffff",
    "--xy-controls-button-border-color": "#27272a",
    "--xy-controls-box-shadow": "0 4px 16px rgba(0,0,0,0.25)",
    "--xy-edge-stroke-default": "#71717a",
    "--xy-connectionline-stroke-default": "#10b981",
    "--xy-connectionline-stroke-width-default": 2.5,
    "--xy-handle-border-color": "#09090b",
  } as CSSProperties;

  return (
    <div
      className="h-full w-full min-w-0"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={soltar}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={TIPOS_NO_QUADRO}
        onNodesChange={aoMudarNos}
        onEdgesChange={aoMudarLigacoes}
        onNodeClick={(e, n) => {
          // Botão de dentro do cartão (escolher, gerar, aprovar) faz só o que diz.
          const alvo = e && e.target ? (e.target as HTMLElement) : null;
          if (alvo && typeof alvo.closest === "function" && alvo.closest("button")) return;
          onAbrir(n.id);
        }}
        onConnect={(c: Connection) => {
          // De Resultado para Resultado, a alça onde a linha chega escolhe o papel (pessoa = personagem).
          if (c.source && c.target) onMudarCanvas((atual) => ligar(atual, c.source, c.target, papelDaAlca(c.targetHandle)));
        }}
        isValidConnection={(c) => !!podeLigar(canvas, String(c.source), String(c.target), papelDaAlca(c.targetHandle))}
        edgesReconnectable
        onReconnectStart={() => {
          religou.current = false;
        }}
        onReconnect={(velha, nova) => {
          religou.current = true;
          if (!nova.source || !nova.target) return;
          onMudarCanvas((c) => {
            const sem = desligar(c, velha.id);
            const papel = papelDaAlca(nova.targetHandle);
            return podeLigar(sem, nova.source, nova.target, papel) ? ligar(sem, nova.source, nova.target, papel) : c;
          });
        }}
        onReconnectEnd={(_e, velha) => {
          if (!religou.current) onMudarCanvas((c) => desligar(c, velha.id));
          religou.current = false;
        }}
        onPaneClick={() => {
          onSelecionar(null);
          onFundo();
        }}
        onMoveEnd={(_e, v) => onViewport(v)}
        defaultViewport={canvas.viewport}
        fitView={!canvas.id && canvas.nos.length > 0}
        fitViewOptions={{ padding: margensDoQuadro(folgaDireita), maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.6}
        // Piso Safari 11 / Chrome 64: a caixa de seleção usa Pointer Events (desligada); conexão por toque ligada.
        selectionOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        connectOnClick
        panOnDrag
        // Rolagem (dono, 26/09): rolar no fundo move o quadro; zoom só com Ctrl/Cmd + rolar ou pinça.
        // Painéis, listas e gavetas levam nowheel/nopan/nodrag e a roda presa: rolar ali não mexe no quadro.
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        preventScrolling
        noWheelClassName="nowheel"
        noPanClassName="nopan"
        noDragClassName="nodrag"
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        style={estilo}
      >
        <Background id="fina" variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#c4c7ce" />
        {/* Os controles ficam ao lado da paleta, não debaixo dela. */}
        <Controls showInteractive={false} position="bottom-left" style={{ left: 60 }}>
          <ControlButton onClick={onCheia} title={cheia ? "Sair da tela cheia" : "Tela cheia"} aria-label={cheia ? "Sair da tela cheia" : "Tela cheia"}>
            {/* O CSS do quadro pinta o ícone por dentro; ícone de traço fica sem preenchimento. */}
            {cheia ? <Minimize2 style={{ fill: "none" }} /> : <Maximize2 style={{ fill: "none" }} />}
          </ControlButton>
        </Controls>
      </ReactFlow>
      <p className="pointer-events-none absolute bottom-2 left-1/2 z-[4] hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-zinc-500 md:block" data-ajuda-do-quadro="">
        Rolar move o quadro. Ctrl (ou Cmd) + rolar, ou pinça: zoom. Nos painéis, rola só o painel.
      </p>
    </div>
  );
}

/** Margens do enquadrar: a paleta à esquerda e os ajustes abertos à direita não escondem cartão. */
function margensDoQuadro(folgaDireita: number) {
  return { top: "24px", bottom: "40px", left: "84px", right: `${Math.max(24, folgaDireita)}px` } as const;
}

// ------------------------------------------------------------------ etapa

type EstadoDoSalvar = { estado: "salvo" | "salvando" | "pendente" | "erro" | "conflito"; erro: string };

function lerMarca(chave: string): boolean {
  try {
    return window.localStorage.getItem(chave) === "1";
  } catch {
    return false;
  }
}

function gravarMarca(chave: string, v: boolean) {
  try {
    if (v) window.localStorage.setItem(chave, "1");
    else window.localStorage.removeItem(chave);
  } catch {
    /* sem armazenamento: volta ao padrão na próxima vez */
  }
}

function CanvasAberto({ inicial, onTrocar, seletor }: { inicial: Canvas; onTrocar: (c: Canvas) => void; seletor: ReactNode }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [canvas, setCanvas] = useState<Canvas>(inicial);
  const [selecionado, setSelecionado] = useState<Selecao>(null);
  const [salvar, setSalvar] = useState<EstadoDoSalvar>({ estado: inicial.id ? "salvo" : "pendente", erro: "" });
  const [lista, setLista] = useState<boolean>(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [recolhida, setRecolhida] = useState<boolean>(() => typeof window !== "undefined" && window.innerWidth < 1100);
  const [escolha, setEscolha] = useState<(PedidoDeEscolha & { gerarId: string | null }) | null>(null);
  const [comoFunciona, setComoFunciona] = useState<boolean>(() => !lerMarca(CHAVE_DO_COMO_FUNCIONA));
  const [prontosAbertos, setProntosAbertos] = useState(false);
  const [cheia, setCheia] = useState(false);
  const [foco, setFoco] = useState<boolean>(() => !lerMarca(CHAVE_DO_FOCO));
  const [resultadoAtivo, setResultadoAtivo] = useState<string | null>(null);
  const [historiaAberta, setHistoriaAberta] = useState(false);
  const mexeu = useRef(false);
  const salvando = useRef<Promise<Canvas | null> | null>(null);
  const atual = useRef(canvas);
  atual.current = canvas;

  // Modo foco: sem a barra de cima e sem os botões flutuantes do painel enquanto o Canvas está aberto (e sempre em tela cheia).
  useModoFoco("canvas", foco || cheia);

  const kits = useKits(clientId);
  const fotos = useFotos(clientId);
  const personasQ = usePersonas(clientId);
  const personas = useMemo(() => personasQ.data || [], [personasQ.data]);
  const ancoras = useAncoras(personas.map((p) => p.ancora_imagem_id || ""));
  const biblioteca = useBiblioteca(clientId, !!escolha || canvas.nos.some((n) => n.tipo === "estilo" || n.tipo === "ambiente"));
  const idsDeFora = useMemo(() => {
    const doCliente = (kits.data || []).map((k) => String(k.id));
    return canvas.nos.filter((n) => n.tipo === "produto" && !!n.dados.kit_id && doCliente.indexOf(String(n.dados.kit_id)) < 0).map((n) => String(n.dados.kit_id));
  }, [canvas.nos, kits.data]);
  const deFora = useProdutosDeFora(kits.isSuccess ? idsDeFora : []);
  const fontes: Fontes = useMemo(
    () => ({ kits: kits.data || [], fotos: fotos.data || [], personas, ancoras: ancoras.data || [], biblioteca: biblioteca.data || [], produtosDeFora: deFora.data || [] }),
    [kits.data, fotos.data, personas, ancoras.data, biblioteca.data, deFora.data],
  );
  const { opcoes } = useMemo(() => motoresDaRodada(catalogo), [catalogo]);
  const padraoDaSaida = (opcoes.find((o) => o.padrao) || opcoes[0] || { id: (padraoPara(catalogo, "imagem") || { id: "" }).id }).id || null;

  const mudar = useCallback((fn: (c: Canvas) => Canvas) => {
    mexeu.current = true;
    setCanvas((c) => fn(c));
    setSalvar((s) => (s.estado === "conflito" ? s : { estado: "pendente", erro: "" }));
  }, []);

  // Rascunho local a cada mudança (JSON, com try/catch): nada se perde se a aba fechar.
  useEffect(() => {
    if (mexeu.current) guardarRascunho(canvas);
  }, [canvas]);

  const salvarAgora = useCallback(async (): Promise<Canvas | null> => {
    if (salvando.current) return salvando.current;
    const enviar = atual.current;
    setSalvar({ estado: "salvando", erro: "" });
    const p = (async () => {
      try {
        const salvo = await salvarCanvas(enviar);
        // Só id, versão e data vêm do servidor: o grafo da tela pode ter mudado enquanto salvava.
        const mudouDurante = atual.current !== enviar;
        const junto: Canvas = { ...atual.current, id: salvo.id, versao: salvo.versao, atualizado_em: salvo.atualizado_em };
        setCanvas(junto);
        atual.current = junto;
        if (!enviar.id && salvo.id) apagarRascunho(clientId, null);
        if (salvo.id) guardarRascunho(junto);
        void queryClient.invalidateQueries({ queryKey: chaveDosCanvases(clientId) });
        setSalvar({ estado: mudouDurante ? "pendente" : "salvo", erro: "" });
        return junto;
      } catch (e) {
        if (e instanceof ErroDaMesa && e.codigo === "canvas_mudou") setSalvar({ estado: "conflito", erro: "O canvas mudou em outra aba." });
        else setSalvar({ estado: "erro", erro: textoDoErro(e) });
        throw e;
      } finally {
        salvando.current = null;
      }
    })();
    salvando.current = p;
    return p;
  }, [clientId, queryClient]);

  // Salvar automático 1,5 s depois da última mudança (sem aviso: o estado fica no topo).
  useEffect(() => {
    if (!mexeu.current || salvar.estado !== "pendente") return;
    const id = window.setTimeout(() => {
      salvarAgora().catch(() => undefined);
    }, ATRASO_DO_SALVAR_MS);
    return () => window.clearTimeout(id);
  }, [canvas, salvar.estado, salvarAgora]);

  // Resultados que chegaram enquanto a tela estava fora (ou agora mesmo).
  const pend = usePendentes();
  useEffect(() => {
    if (!canvas.id) return;
    const porGerar = tirarPendentes(canvas.id);
    if (Object.keys(porGerar).length) mudar((c) => juntarResultados(c, porGerar));
  }, [pend, canvas.id, mudar]);

  // Esc sai da tela cheia (com uma gaveta aberta, o Esc fecha só a gaveta).
  useEffect(() => {
    if (!cheia) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-gaveta]")) setCheia(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cheia]);

  const garantirSalvo = async () => {
    if (atual.current.id && salvar.estado === "salvo") return atual.current;
    return salvarAgora();
  };

  const gerar = async (gerarId: string): Promise<Record<string, never>> => {
    const salvo = await garantirSalvo();
    if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de gerar.");
    const g = salvo.nos.find((n) => n.id === gerarId) || atual.current.nos.find((n) => n.id === gerarId);
    if (!g) throw new Error("Resultado não encontrado no canvas.");
    void gerarNoResultado({ queryClient, clientId, canvasId: salvo.id, gerarId, motores: g.dados.motores || [], carrossel: g.dados.carrossel || 0, qualidade: g.dados.qualidade || "alta", atualizar: atualizarCusto });
    return {};
  };

  const variacoes = async (gerarId: string, r: ResultadoDoCanvas): Promise<Record<string, never>> => {
    const salvo = await garantirSalvo();
    if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de gerar.");
    const g = salvo.nos.find((n) => n.id === gerarId) || atual.current.nos.find((n) => n.id === gerarId);
    void gerarVariacoes({ queryClient, clientId, canvasId: salvo.id, gerarId, base: r, qualidade: (g && g.dados.qualidade) || "alta", atualizar: atualizarCusto });
    return {};
  };

  /**
   * Põe um cartão no quadro, já ligado ao Resultado aberto (ou ao primeiro;
   * sem nenhum, nasce um). Ids criados fora da atualização do estado.
   */
  const porNoQuadro = (tipo: TipoDeNo, dados: DadosDoNo = {}, o: { posicao?: { x: number; y: number } | null; selecionar?: boolean; gerarId?: string | null } = {}) => {
    const motoresPadrao = { motores: padraoDaSaida ? [padraoDaSaida] : [] };
    const no = novoNo(tipo, 0, 0, tipo === "gerar" ? { ...motoresPadrao, ...dados } : dados);
    const reserva = tipo === "gerar" ? null : novoNo("gerar", 0, 0, motoresPadrao);
    const alvo = o.gerarId || resultadoAtivo;
    mudar((c) => porCartao(c, no, { gerarId: alvo, resultadoReserva: reserva, posicao: o.posicao || null }));
    if (tipo === "gerar") setResultadoAtivo(no.id);
    if (o.selecionar || tipo === "gerar") setSelecionado({ tipo: "no", id: no.id });
    return no.id;
  };

  // "Usar no Canvas" da aba Modelos: abre com a modelo já no quadro, ligada ao Resultado.
  useEffect(() => {
    const modeloId = lerPedidoAoCanvas(clientId);
    if (!modeloId) return;
    porNoQuadro("modelo", { modelo_id: modeloId }, { selecionar: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrirNo = (id: string) => {
    setSelecionado({ tipo: "no", id });
    const n = atual.current.nos.find((x) => x.id === id);
    if (n && n.tipo === "gerar") setResultadoAtivo(id);
    setRecolhida(false);
  };

  const abrirEscolha = (tipo: TipoDeNo, trocarId: string | null, gerarId: string | null = null) => {
    if (tipo === "texto" || tipo === "gerar" || tipo === "agente") {
      if (trocarId) abrirNo(trocarId);
      return;
    }
    setProntosAbertos(false);
    setEscolha({ tipo: tipo as AbaDaEscolha, trocarId, gerarId });
  };

  const aoEscolher = (tipo: AbaDaEscolha, dados: DadosDoNo, trocarId: string | null) => {
    if (trocarId) {
      mudar((c) => mudarDados(c, trocarId, dados));
      return;
    }
    porNoQuadro(tipo, dados, { gerarId: escolha ? escolha.gerarId : null });
  };

  const aoTocarNaPaleta = (t: TipoDeNo) => {
    if (t === "texto" || t === "agente") {
      porNoQuadro(t, t === "texto" ? { papel: "pedido" } : {}, { selecionar: true });
      setRecolhida(false);
      return;
    }
    if (t === "gerar") {
      porNoQuadro("gerar");
      return;
    }
    abrirEscolha(t, null);
  };

  const aoSoltar = (t: TipoDeNo, posicao: { x: number; y: number }) => {
    const id = porNoQuadro(t, t === "texto" ? { papel: "pedido" } : {}, { posicao, selecionar: t !== "gerar" });
    if (t !== "texto" && t !== "gerar" && t !== "agente") {
      setProntosAbertos(false);
      setEscolha({ tipo: t as AbaDaEscolha, trocarId: id, gerarId: null });
    }
  };

  const porProduto = (p: Pick<ProdutoDaEsteira, "kit_id" | "nome">, posicao: { x: number; y: number } | null = null) => {
    porNoQuadro("produto", { kit_id: p.kit_id, titulo: p.nome }, { posicao });
    if (p.nome) toast.success(`${p.nome} no quadro`, { description: "Já ligado ao Resultado." });
  };

  const tirar = (id: string) => {
    mudar((c) => removerNo(c, id));
    setSelecionado(null);
  };

  const preencherPadrao = () => {
    const kitsDoCliente = kitsUsaveis(fontes.kits);
    const prontas = fontes.personas.filter((p) => p.status === "ancora" || p.status === "folha" || p.status === "pronta");
    return {
      kit_id: kitsDoCliente.length === 1 ? String(kitsDoCliente[0].id) : null,
      modelo_id: prontas.length === 1 ? prontas[0].id : null,
      versao: prontas.length === 1 ? prontas[0].versao : null,
    };
  };

  const depoisDeMontar = (antes: Canvas, novo: Canvas, titulo: string) => {
    const novos = novo.nos.filter((n) => !antes.nos.some((x) => x.id === n.id));
    mudar(() => novo);
    setProntosAbertos(false);
    const g = novo.nos.find((n) => n.tipo === "gerar" && novo.ligacoes.some((l) => l.para === n.id && novos.some((x) => x.id === l.de)));
    if (g) setResultadoAtivo(g.id);
    const incompleto = novos.find((n) => n.tipo !== "gerar" && !!faltaNoCartao(n));
    if (incompleto) {
      setSelecionado({ tipo: "no", id: incompleto.id });
      setRecolhida(false);
    } else if (g) setSelecionado({ tipo: "no", id: g.id });
    toast.success(titulo, { description: incompleto ? "Os cartões já estão ligados ao Resultado. Falta escolher o que está em amarelo." : "Tudo ligado. Confira e toque em Gerar." });
  };

  const aplicarModelo = (chave: string) => {
    const antes = atual.current;
    const novo = aplicarModeloPronto(antes, chave, padraoDaSaida, preencherPadrao());
    const modelo = MODELOS_PRONTOS.find((m) => m.chave === chave);
    depoisDeMontar(antes, novo, modelo ? modelo.rotulo : "Modelo pronto no quadro");
  };

  /** "Montar pelo contexto" (auto paint): o agente escolhe o modelo e preenche o quadro. */
  const montarPeloContexto = async () => {
    const salvo = await garantirSalvo();
    if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de montar pelo contexto.");
    const r = await conversarNoCanvas({ canvasId: salvo.id, tarefa: "montar", gerarId: resultadoAlvo(salvo, resultadoAtivo) });
    const antes = atual.current;
    depoisDeMontar(antes, montarPelaResposta(antes, r, padraoDaSaida, preencherPadrao()), "Quadro montado pelo contexto");
    if (r.resposta) toast.info("O agente explicou", { description: r.resposta.slice(0, 300) });
    return { custo_usd: r.custo_usd };
  };

  /** Ambiente pelo contexto com o agente: ele escreve a descrição no cartão. */
  const ambienteComAgente = async (noId: string, gerarId: string | null = null) => {
    const salvo = await garantirSalvo();
    if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de chamar o agente.");
    const ligacao = atual.current.ligacoes.find((l) => l.de === noId);
    const r = await conversarNoCanvas({ canvasId: salvo.id, tarefa: "ambiente", gerarId: gerarId || (ligacao ? ligacao.para : null) });
    if (r.ambiente) mudar((c) => mudarDados(c, noId, { texto: r.ambiente || "", modo: "contexto" }));
    else toast.info("O agente não descreveu um lugar", { description: r.resposta.slice(0, 200) });
    return { custo_usd: r.custo_usd };
  };

  // ---------------------------------------------------------------- cenas e história

  /** A pessoa virou personagem: o cartão Pessoa dela entra no quadro, perto do Resultado (solto, para ligar nas cenas). */
  const aoPersonagem = (p: PersonagemCriada, r: ResultadoDoCanvas) => {
    if (!p.modelo_id) return;
    const g = atual.current.nos.find((n) => n.tipo === "gerar" && (n.dados.resultados || []).some((x) => x.geracao_id === r.geracao_id)) || null;
    const no = novoNo("modelo", 0, 0, { modelo_id: p.modelo_id, titulo: p.nome });
    const x = g ? g.x - TAMANHO_DO_CARTAO.largura - 70 : 0;
    const y = g ? g.y + TAMANHO_DA_SAIDA.altura + 40 : 0;
    mudar((c) => ({ ...c, nos: c.nos.concat([{ ...no, x: Math.round(x), y: Math.round(y) }]) }));
    toast.info("O cartão da personagem está no quadro", { description: "Ligue ele nas próximas cenas: o rosto vem da âncora e da folha." });
  };

  const abrirCena = (id: string) => {
    abrirNo(id);
    if (typeof window !== "undefined" && window.innerWidth < 640) setHistoriaAberta(false);
  };

  const acoesDaHistoria: AcoesDaHistoria = {
    onAbrir: abrirCena,
    onGerar: gerar,
    onVariacoes: variacoes,
    onDuplicar: (gerarId) => {
      const id = novoId("gerar");
      mudar((c) => duplicarCena(c, gerarId, id));
      setResultadoAtivo(id);
      setSelecionado({ tipo: "no", id });
      toast.success("Cena duplicada", { description: "Mesmas entradas, sem as fotos. Mude a ação ou o lugar e gere." });
    },
    onProxima: (gerarId) => {
      const id = novoId("gerar");
      mudar((c) => proximaCena(c, gerarId, id));
      setResultadoAtivo(id);
      setSelecionado({ tipo: "no", id });
      setRecolhida(false);
      toast.success("Próxima cena no quadro", { description: "A pessoa desta foto já entra como personagem. Escreva a ação e gere." });
    },
    onNovaCena: () => {
      const alvo = resultadoAlvo(atual.current, resultadoAtivo);
      const n = atual.current.nos.find((x) => x.id === alvo) || null;
      if (n && !n.dados.cena) {
        mudar((c) => marcarComoCena(c, n.id));
        abrirNo(n.id);
        return;
      }
      porNoQuadro("gerar", { cena: cenaNova(cenasDaHistoria(atual.current).length + 1) });
    },
  };

  const alternarHistoria = () => {
    const abrir = !historiaAberta;
    setHistoriaAberta(abrir);
    if (abrir) {
      setEscolha(null);
      setProntosAbertos(false);
      if (typeof window !== "undefined" && window.innerWidth < 640) setRecolhida(true);
    }
  };

  const fecharComoFunciona = () => {
    gravarMarca(CHAVE_DO_COMO_FUNCIONA, true);
    setComoFunciona(false);
  };

  const alternarFoco = () => {
    gravarMarca(CHAVE_DO_FOCO, foco);
    setFoco(!foco);
  };

  const alternarProntos = () => {
    if (!prontosAbertos) setEscolha(null);
    setProntosAbertos(!prontosAbertos);
  };

  /** Toque no fundo do quadro: as gavetas fecham (os ajustes ficam como estão). */
  const fecharGavetas = () => {
    setEscolha(null);
    setProntosAbertos(false);
  };

  const alternarCheia = () => {
    setCheia((v) => !v);
    window.setTimeout(() => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {
        /* sem evento: o quadro mede no próximo movimento */
      }
    }, 30);
  };

  const noAberto = selecionado && selecionado.tipo === "no" ? canvas.nos.find((n) => n.id === selecionado.id) || null : null;
  const ligacaoAberta = selecionado && selecionado.tipo === "ligacao" ? canvas.ligacoes.find((l) => l.id === selecionado.id) || null : null;
  const idDoResultado = noAberto && noAberto.tipo === "gerar" ? noAberto.id : resultadoAlvo(canvas, resultadoAtivo);
  const resultadoDoPainel = idDoResultado ? canvas.nos.find((n) => n.id === idDoResultado) || null : null;
  const cartaoDoPainel = noAberto && noAberto.tipo !== "gerar" ? noAberto : null;
  const semEntradas = !canvas.ligacoes.length && canvas.nos.every((n) => n.tipo === "gerar");

  const totalDeCenas = cenasDaHistoria(canvas).length;

  const rotuloDoSalvar =
    salvar.estado === "salvo" ? "Salvo" : salvar.estado === "salvando" ? "Salvando" : salvar.estado === "pendente" ? "Alterações não salvas" : salvar.estado === "conflito" ? "Mudou em outra aba" : "Não salvou";

  const valorDoQuadro: ValorDoQuadro = {
    fontes,
    gerar,
    variacoes,
    abrirEscolha: (t, id) => abrirEscolha(t, id),
    abrir: abrirNo,
    tirar,
    aplicarModelo,
  };

  let conteudoDoPainel: ReactNode = null;
  let tituloDoPainel: ReactNode = "Ajustes";
  if (ligacaoAberta && ligacaoAberta.papel) {
    tituloDoPainel = "Foto de outra cena";
    conteudoDoPainel = (
      <EditorDaLigacaoDeResultado
        canvas={canvas}
        ligacao={ligacaoAberta}
        fontes={fontes}
        onPapel={(p) => mudar((c) => mudarLigacao(c, ligacaoAberta.id, { papel: p }))}
        onFoto={(id) => mudar((c) => mudarLigacao(c, ligacaoAberta.id, { imagem_id: id }))}
        onDesligar={() => {
          mudar((c) => desligar(c, ligacaoAberta.id));
          setSelecionado(null);
        }}
      />
    );
  } else if (ligacaoAberta) {
    tituloDoPainel = "Ligação";
    conteudoDoPainel = (
      <div className="min-w-0 space-y-2">
        <p className="text-[11.5px] text-zinc-400">{ROTULOS_DAS_ENTRADAS[ligacaoAberta.entrada]} ligado ao Resultado. Arraste a ponta da linha para outro Resultado; solte no vazio para desligar.</p>
        <button type="button" className={BOTAO} onClick={() => { mudar((c) => desligar(c, ligacaoAberta.id)); setSelecionado(null); }}>
          <X className="mr-1 h-3.5 w-3.5" /> Desligar
        </button>
      </div>
    );
  } else if (cartaoDoPainel && cartaoDoPainel.tipo === "agente") {
    tituloDoPainel = "Agente";
    conteudoDoPainel = (
      <div className="min-w-0 space-y-3">
        <ChatDoAgente key={cartaoDoPainel.id} canvas={canvas} no={cartaoDoPainel} fontes={fontes} onMudarCanvas={mudar} garantirSalvo={garantirSalvo} onGerar={gerar} />
        <div className="flex min-w-0 flex-wrap items-center border-t border-white/10 pt-2.5">
          <button type="button" className={`${BOTAO} mb-1 mr-1.5`} onClick={() => setSelecionado(null)}>
            Voltar aos ajustes
          </button>
          <button type="button" className={`${BOTAO} mb-1 text-red-300`} onClick={() => tirar(cartaoDoPainel.id)} aria-label="Tirar o cartão do quadro">
            <Trash2 className="mr-1 h-3 w-3" /> Apagar
          </button>
        </div>
      </div>
    );
  } else if (cartaoDoPainel) {
    const ligado = canvas.ligacoes.some((l) => l.de === cartaoDoPainel.id);
    tituloDoPainel = `Cartão: ${TIPOS_DE_NO[cartaoDoPainel.tipo].rotulo}`;
    conteudoDoPainel = (
      <div className="min-w-0 space-y-3" data-painel-do-cartao={cartaoDoPainel.id}>
        <EditorDoCartao
          key={cartaoDoPainel.id}
          no={cartaoDoPainel}
          fontes={fontes}
          onMudar={(dados) => mudar((c) => mudarDados(c, cartaoDoPainel.id, dados))}
          onEscolher={() => abrirEscolha(cartaoDoPainel.tipo, cartaoDoPainel.id)}
          onAgente={cartaoDoPainel.tipo === "ambiente" ? () => ambienteComAgente(cartaoDoPainel.id) : undefined}
        />
        {!ligado && (
          <button
            type="button"
            className={BOTAO}
            onClick={() => {
              const alvo = resultadoAlvo(atual.current, resultadoAtivo);
              if (alvo) mudar((c) => ligar(c, cartaoDoPainel.id, alvo));
            }}
          >
            <Workflow className="mr-1.5 h-3.5 w-3.5" /> Ligar ao Resultado
          </button>
        )}
        <div className="flex min-w-0 flex-wrap items-center border-t border-white/10 pt-2.5">
          <button type="button" className={`${BOTAO} mb-1 mr-1.5`} onClick={() => setSelecionado(null)}>
            Voltar aos ajustes
          </button>
          <button type="button" className={`${BOTAO} mb-1 text-red-300`} onClick={() => tirar(cartaoDoPainel.id)} aria-label="Tirar o cartão do quadro">
            <Trash2 className="mr-1 h-3 w-3" /> Apagar
          </button>
        </div>
      </div>
    );
  } else if (resultadoDoPainel) {
    const resultados = canvas.nos.filter((n) => n.tipo === "gerar");
    tituloDoPainel = resultadoDoPainel.dados.cena ? `Ajustes: ${nomeDoResultado(canvas, resultadoDoPainel)}` : resultados.length > 1 ? `Ajustes do Resultado ${resultados.indexOf(resultadoDoPainel) + 1}` : "Ajustes do Resultado";
    conteudoDoPainel = (
      <div className="min-w-0 space-y-3">
        <AjustesDoResultado
          canvas={canvas}
          no={resultadoDoPainel}
          fontes={fontes}
          onMudar={(dados) => mudar((c) => mudarDados(c, resultadoDoPainel.id, dados))}
          garantirSalvo={garantirSalvo}
          comGerar={false}
          onGerar={gerar}
          onVariacoes={variacoes}
          onPersonagemCriada={aoPersonagem}
        />
        {resultados.length > 1 && (
          <button type="button" className={`${BOTAO} text-red-300`} onClick={() => tirar(resultadoDoPainel.id)}>
            <Trash2 className="mr-1 h-3 w-3" /> Apagar este Resultado
          </button>
        )}
      </div>
    );
  } else {
    conteudoDoPainel = (
      <div className="min-w-0 space-y-2">
        <p className="text-[11.5px] text-zinc-400">O quadro está sem Resultado. Ele junta os cartões e gera a foto.</p>
        <button type="button" className={BOTAO} onClick={() => porNoQuadro("gerar")}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Pôr um Resultado
        </button>
      </div>
    );
  }

  const barra = (
    <div className="flex min-w-0 flex-wrap items-center" data-barra-do-canvas="">
      {seletor}
      <Input value={canvas.nome} onChange={(e) => mudar((c) => ({ ...c, nome: e.target.value }))} aria-label="Nome do canvas" className="mb-1.5 mr-2 h-8 w-full min-w-0 text-[12.5px] font-semibold sm:w-52" />
      <span className={`mb-1.5 mr-2 inline-flex items-center text-[11px] ${salvar.estado === "erro" || salvar.estado === "conflito" ? "text-warning" : "text-muted-foreground"}`} role="status" data-estado-do-salvar={salvar.estado} title={salvar.erro || undefined}>
        {salvar.estado === "salvando" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : salvar.estado === "salvo" ? <Check className="mr-1 h-3 w-3" /> : null}
        {rotuloDoSalvar}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="mb-1.5 mr-1 h-8 text-[12px]"
        disabled={salvar.estado === "salvando"}
        onClick={() =>
          salvarAgora()
            .then(() => toast.success("Canvas salvo"))
            .catch((e) => avisarErro(e, "Canvas não salvo"))
        }
      >
        <Save className="mr-1.5 h-3.5 w-3.5" /> Salvar
      </Button>
      {salvar.estado === "conflito" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mb-1.5 mr-1.5 h-8 text-[12px]"
          onClick={async () => {
            if (canvas.id) apagarRascunho(clientId, canvas.id);
            await queryClient.refetchQueries({ queryKey: chaveDosCanvases(clientId) }).catch(() => undefined);
            const r = queryClient.getQueryData<Canvas[]>(chaveDosCanvases(clientId)) || [];
            const doServidor = r.find((x) => x.id === canvas.id) || null;
            if (doServidor) onTrocar(doServidor);
            else toast.info("Abra o canvas de novo na lista", { description: "A versão da outra aba já está salva." });
          }}
        >
          Recarregar
        </Button>
      )}
      <span className="hidden flex-1 sm:block" />
      <Button type="button" size="sm" variant={historiaAberta ? "default" : "outline"} className="mb-1.5 mr-1 h-8 text-[12px]" aria-pressed={historiaAberta} onClick={alternarHistoria} data-botao-historia="">
        <Clapperboard className="mr-1.5 h-3.5 w-3.5" /> História{totalDeCenas ? ` (${totalDeCenas})` : ""}
      </Button>
      <Button type="button" size="sm" variant={prontosAbertos ? "default" : "outline"} className="mb-1.5 mr-1 h-8 text-[12px]" aria-pressed={prontosAbertos} onClick={alternarProntos}>
        <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Modelos prontos
      </Button>
      <Button type="button" size="sm" variant={comoFunciona ? "default" : "outline"} className="mb-1.5 mr-1 h-8 text-[12px]" aria-pressed={comoFunciona} onClick={() => (comoFunciona ? fecharComoFunciona() : setComoFunciona(true))}>
        <HelpCircle className="mr-1.5 h-3.5 w-3.5" /> Como funciona
      </Button>
      <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1 h-8 text-[12px]" aria-pressed={!foco} onClick={alternarFoco} title={foco ? "Mostrar a barra do painel e os botões flutuantes" : "Esconder a barra do painel e os botões flutuantes"}>
        {foco ? <Eye className="mr-1.5 h-3.5 w-3.5" /> : <EyeOff className="mr-1.5 h-3.5 w-3.5" />}
        {foco ? "Mostrar menu" : "Só o canvas"}
      </Button>
      <Button type="button" size="sm" variant={lista ? "default" : "outline"} className="mb-1.5 h-8 text-[12px]" aria-pressed={lista} onClick={() => setLista(!lista)}>
        {lista ? <Workflow className="mr-1.5 h-3.5 w-3.5" /> : <LayoutList className="mr-1.5 h-3.5 w-3.5" />}
        {lista ? "Ver o quadro" : "Modo lista"}
      </Button>
    </div>
  );

  // Quanto os ajustes abertos cobrem à direita (em tela pequena viram folha no pé e não contam).
  const larguraDaJanela = typeof window !== "undefined" ? window.innerWidth : 1280;
  const folgaDireita = !recolhida && larguraDaJanela >= 640 ? (larguraDaJanela >= 1280 ? 296 : 272) + 24 : 72;
  const gavetaAberta = !!escolha || prontosAbertos;

  const quadro = (
    <div
      className={`flex min-w-0 flex-col overflow-hidden ${cheia ? "dark fixed inset-0 z-[120] bg-zinc-950 p-2 text-foreground" : "relative w-full rounded-2xl border border-border"}`}
      style={cheia ? undefined : { height: "calc(100vh - 150px)", minHeight: 560 }}
      data-quadro=""
      data-tela-cheia={cheia ? "sim" : "nao"}
    >
      {cheia && <div className="shrink-0 px-1 pt-1">{barra}</div>}
      <div className="shrink-0 p-2 pb-0" style={{ background: "#eef0f3" }}>
        <EsteiraDeProdutos onPor={(p) => porProduto(p)} />
      </div>
      <div className="relative min-h-0 flex-1" style={{ background: "#eef0f3" }}>
        <ContextoDoQuadro.Provider value={valorDoQuadro}>
          <Quadro
            canvas={canvas}
            fontes={fontes}
            selecionado={selecionado}
            onSelecionar={setSelecionado}
            onAbrir={abrirNo}
            onMudarCanvas={mudar}
            onViewport={(v) => setCanvas((c) => ({ ...c, viewport: { x: v.x, y: v.y, zoom: v.zoom } }))}
            onSoltar={aoSoltar}
            onSoltarProduto={(kitId, posicao) => porProduto({ kit_id: kitId, nome: "" }, posicao)}
            cheia={cheia}
            onCheia={alternarCheia}
            folgaDireita={folgaDireita}
            onFundo={fecharGavetas}
          />
        </ContextoDoQuadro.Provider>
        <Paleta onTipo={aoTocarNaPaleta} onAdicionar={() => abrirEscolha("produto", null)} onResultado={() => porNoQuadro("gerar")} />
        <BarraLateral
          recolhida={recolhida}
          onRecolher={setRecolhida}
          titulo={tituloDoPainel}
          custo={<CustoDoResultado canvas={canvas} no={resultadoDoPainel} />}
          custoCurto={<CustoDoResultado canvas={canvas} no={resultadoDoPainel} curto />}
        >
          {conteudoDoPainel}
        </BarraLateral>
        {comoFunciona && !gavetaAberta && <ComoFunciona onFechar={fecharComoFunciona} />}
        {prontosAbertos && (
          <Gaveta
            lugar="quadro"
            rotulo="Modelos prontos"
            rotuloDoFechar="Fechar os modelos prontos"
            onFechar={() => setProntosAbertos(false)}
            cabeca={
              <h3 className="flex items-center truncate text-[13px] font-semibold">
                <Wand2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /> Modelos prontos
              </h3>
            }
          >
            <GaleriaDeModelos compacta onAplicar={aplicarModelo} onMontarPeloContexto={montarPeloContexto} />
          </Gaveta>
        )}
        <EscolherCartao lugar="quadro" pedido={escolha} fontes={fontes} onFechar={() => setEscolha(null)} onEscolher={aoEscolher} />
        {historiaAberta && !gavetaAberta && <HistoriaDoCanvas canvas={canvas} fontes={fontes} onMudarCanvas={mudar} acoes={acoesDaHistoria} lugar="quadro" onFechar={() => setHistoriaAberta(false)} />}
      </div>
    </div>
  );

  return (
    <div className="min-w-0 space-y-2" data-canvas-aberto={canvas.id || "novo"}>
      {!cheia && barra}
      {salvar.estado === "erro" && <AvisoDeErro erro={new Error(`O canvas não foi salvo: ${salvar.erro}`)} />}

      {lista ? (
        <div className="min-w-0 space-y-3">
          {comoFunciona && <ComoFunciona onFechar={fecharComoFunciona} noQuadro={false} />}
          {(prontosAbertos || semEntradas) && <GaleriaDeModelos onAplicar={aplicarModelo} onFechar={prontosAbertos ? () => setProntosAbertos(false) : undefined} onMontarPeloContexto={montarPeloContexto} />}
          {(historiaAberta || totalDeCenas > 0) && <HistoriaDoCanvas canvas={canvas} fontes={fontes} onMudarCanvas={mudar} acoes={acoesDaHistoria} lugar="pagina" onFechar={historiaAberta ? () => setHistoriaAberta(false) : undefined} />}
          <ModoLista
            canvas={canvas}
            fontes={fontes}
            onMudarCanvas={mudar}
            garantirSalvo={garantirSalvo}
            onGerar={gerar}
            onVariacoes={variacoes}
            onPor={(t, gerarId) => {
              porNoQuadro(t, t === "texto" ? { papel: "pedido" } : {}, { gerarId });
            }}
            onEscolher={(t, trocarId, gerarId) => abrirEscolha(t, trocarId, gerarId)}
            onAgenteDoAmbiente={(noId, gerarId) => ambienteComAgente(noId, gerarId)}
            onPersonagemCriada={aoPersonagem}
          />
        </div>
      ) : cheia ? (
        // Tela cheia num portal no body: escapa do contexto de empilhamento da página (a barra do painel não fica por cima).
        createPortal(quadro, document.body)
      ) : (
        quadro
      )}
      <p className="flex items-start text-[11px] leading-snug text-muted-foreground">
        <ClipboardList className="mr-1 mt-0.5 h-3 w-3 shrink-0" /> Tudo o que o Canvas gera vai para o acervo como gerado. Usar na Mesa e Finalizar aprovam a foto no mesmo clique.
      </p>
      {lista && <EscolherCartao lugar="pagina" pedido={escolha} fontes={fontes} onFechar={() => setEscolha(null)} onEscolher={aoEscolher} />}
    </div>
  );
}

/** Canvas novo: o Resultado já nasce no centro, com o motor padrão ligado. */
function comResultado(c: Canvas, motorPadrao: string | null): Canvas {
  if (c.nos.some((n) => n.tipo === "gerar")) return c;
  return porCartao(c, novoNo("gerar", 0, 0, { motores: motorPadrao ? [motorPadrao] : [] }), { posicao: c.nos.length ? null : { x: 420, y: 0 } });
}

export default function EtapaCanvas() {
  const { clientId, catalogo } = useMesa();
  const canvases = useCanvases(clientId);
  const lista = canvases.data || [];
  const [aberto, setAberto] = useState<Canvas | null>(null);
  const [chave, setChave] = useState(0);
  const { opcoes } = useMemo(() => motoresDaRodada(catalogo), [catalogo]);
  const padrao = (opcoes.find((o) => o.padrao) || opcoes[0] || { id: "" }).id || null;

  const novo = useCallback((): Canvas => {
    const rascunho = lerRascunho(clientId, null);
    if (rascunho && rascunho.nos.length) return comResultado(rascunho, padrao);
    return comResultado(canvasVazio(clientId), padrao);
  }, [clientId, padrao]);

  // Abre o mais recente (ou um novo) quando a lista chega.
  useEffect(() => {
    if (aberto) return;
    if (canvases.isSuccess) setAberto(lista.length ? comResultado(abrirComRascunho(clientId, lista[0]), padrao) : novo());
    else if (canvases.isError) setAberto(novo());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvases.isSuccess, canvases.isError]);

  const trocar = (c: Canvas) => {
    setAberto(comResultado(c, padrao));
    setChave((k) => k + 1);
  };

  const seletor = (
    <>
      <Select
        value={aberto && aberto.id ? aberto.id : ""}
        onValueChange={(id) => {
          const c = lista.find((x) => x.id === id);
          if (c) trocar(abrirComRascunho(clientId, c));
        }}
      >
        <SelectTrigger className="mb-1.5 mr-1.5 h-8 w-full min-w-0 text-[12px] sm:w-52" aria-label="Canvas aberto">
          <SelectValue placeholder={lista.length ? "Abrir um canvas" : "Nenhum canvas salvo ainda"} />
        </SelectTrigger>
        <SelectContent className="dark">
          {lista.map((c) => (
            <SelectItem key={String(c.id)} value={String(c.id)}>
              {c.nome} · {c.nos.length} {c.nos.length === 1 ? "cartão" : "cartões"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-2 h-8 text-[12px]" onClick={() => trocar(canvasVazio(clientId))}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Novo canvas
      </Button>
    </>
  );

  return (
    <ReactFlowProvider>
      <div className="dark min-w-0 rounded-2xl border border-border bg-background p-2 pb-10 text-foreground sm:p-3 sm:pb-10" data-canvas-escuro="">
        {canvases.isError && <AvisoDeErro erro={canvases.error} className="mb-2" />}
        {aberto ? (
          <CanvasAberto key={`${aberto.id || "novo"}-${chave}`} inicial={aberto} onTrocar={trocar} seletor={seletor} />
        ) : (
          <div className="h-[60vh] animate-pulse rounded-2xl bg-muted/60" aria-busy="true" aria-label="Abrindo o canvas" />
        )}
      </div>
    </ReactFlowProvider>
  );
}

/** O rascunho local vence só quando parte da mesma versão do servidor (mudança não salva por cima dela). */
function abrirComRascunho(clientId: string, doServidor: Canvas): Canvas {
  const r = lerRascunho(clientId, doServidor.id);
  return r && r.versao === doServidor.versao ? { ...r, id: doServidor.id } : doServidor;
}
