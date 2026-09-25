import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type ReactNode } from "react";
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
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  HelpCircle,
  ImagePlus,
  LayoutList,
  Loader2,
  MapPin,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Palette,
  Plus,
  Save,
  ScanSearch,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Wand2,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { AvisoDeErro, BotaoComCusto, useAvisarErro, useEstimativa } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { ErroDaMesa, padraoPara, QUALIDADES, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { AprovarFoto, BotoesDeUso } from "./AcoesDeUso";
import { Cartao, Moldura, Pilulas, useMesaFoto } from "./Comuns";
import { ImagemDaBiblioteca } from "./EtapaBiblioteca";
import {
  acrescentarFotos,
  decidirFoto,
  FORMATOS,
  invalidarFotos,
  partesDaConferencia,
  rotuloDoTipo,
  useBiblioteca,
  useFotos,
  useKits,
  type FotoDoAcervo,
  type ItemDaBiblioteca,
  type KitDeFoto,
} from "./fotoApi";
import {
  chaveDoAndamento,
  emParalelo,
  lerPedidoAoCanvas,
  marcarAndamento,
  motoresDaRodada,
  rotuloDoMotor,
  STATUS_DA_PERSONA,
  useAncoras,
  useAndamentos,
  usePersonas,
  type ConferenciaDaPersona,
  type ImagemDaPersona,
  type Persona,
  type Resolucao,
} from "./modelosApi";
import {
  aplicarModeloPronto,
  apagarRascunho,
  avisosDoGerar,
  baixarImagem,
  bloqueiosDoGerar,
  canvasVazio,
  chaveDosCanvases,
  conferirGeracao,
  desligar,
  entradasDoGerar,
  faltaNoCartao,
  gerarNoCanvas,
  guardarRascunho,
  juntarResultados,
  lerRascunho,
  ligar,
  MODELOS_PRONTOS,
  montarCanvas,
  mudarDados,
  novoNo,
  ORDEM_DAS_ENTRADAS,
  partesDoGerar,
  podeLigar,
  porCartao,
  removerNo,
  resultadoAlvo,
  resumoDoResultado,
  ROTULOS_DAS_ENTRADAS,
  salvarCanvas,
  TAMANHO_DA_SAIDA,
  TAMANHO_DO_CARTAO,
  TIPOS_DE_NO,
  useCanvases,
  type Canvas,
  type DadosDoNo,
  type Montagem,
  type NoDoCanvas,
  type ResultadoDoCanvas,
  type TipoDeNo,
} from "./canvasApi";

/**
 * Canvas (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 7 e 9.2): o dono põe no
 * quadro o que vai na foto (Produto do kit, Modelo, Ambiente, Estilo e o
 * Pedido em palavras) e cada cartão já se liga sozinho ao Resultado, que fica
 * no centro. No Resultado aparece "Junta: produto X + modelo Y", o botão
 * "Gerar foto" com o custo, o andamento e a foto que saiu, com aprovar, usar
 * na Mesa e baixar. Ligar à mão continua possível (vários Resultados).
 *
 * Visual: quadro escuro com os tokens do painel (a aba inteira fica em modo
 * escuro), grade discreta, cartões com a miniatura grande do que representam
 * e cor por papel. Motores, formato, qualidade e resolução ficam numa barra
 * lateral recolhível, com o custo sempre à vista.
 *
 * React Flow (@xyflow/react) só neste arquivo, carregado quando a aba abre.
 * Piso do painel (Safari 11 / Chrome 64): caixa de seleção desligada (usa
 * Pointer Events), conexão por toque (tocar uma alça e depois a outra),
 * cartões de tamanho fixo com as alças declaradas no próprio nó (nada
 * depende de medir depois de montar), miniaturas com altura fixa em px. Em
 * tela menor que 768 px abre o modo lista, com o mesmo grafo em formulário.
 */

const ALCA = 14;
const PASSO_DAS_ENTRADAS = 22;
const TOPO_DAS_ENTRADAS = Math.round(TAMANHO_DA_SAIDA.altura / 2 - 2 * PASSO_DAS_ENTRADAS);
const ALTURA_DA_MINIATURA = 112;
const ALTURA_DA_FOTO = 232;
const ATRASO_DO_SALVAR_MS = 1500;
const DURACAO_DA_LINHA_NOVA_MS = 1800;
const CHAVE_DO_COMO_FUNCIONA = "mesa-foto:canvas:como-funciona-visto";
const FORMATOS_DO_CANVAS = FORMATOS.filter((f) => ["1:1", "4:5", "9:16", "16:9"].indexOf(f.valor) >= 0).map((f) => ({ valor: f.valor, rotulo: f.valor }));
const RESOLUCOES_DO_CANVAS: { valor: string; rotulo: string }[] = [
  { valor: "auto", rotulo: "Automática" },
  { valor: "1K", rotulo: "1K" },
  { valor: "2K", rotulo: "2K" },
  { valor: "4K", rotulo: "4K" },
];
const TIPOS_DE_ENTRADA: Exclude<TipoDeNo, "gerar">[] = ["produto", "modelo", "ambiente", "estilo", "texto"];

const ICONES: Record<TipoDeNo, typeof Box> = { produto: Box, modelo: UserRound, ambiente: MapPin, estilo: Palette, texto: MessageSquareText, gerar: Sparkles };

type AbaDaEscolha = "produto" | "modelo" | "ambiente" | "estilo";
const ABAS_DA_ESCOLHA: AbaDaEscolha[] = ["produto", "modelo", "ambiente", "estilo"];

// ------------------------------------------------------------------ resultados que chegam fora da tela

/**
 * Resultado que chegou depois de a tela sair (trocou de aba no meio da
 * geração): fica aqui até o canvas abrir de novo e juntar no Resultado.
 */
let pendentes: Record<string, ResultadoDoCanvas[]> = {};
const ouvintesDosPendentes: (() => void)[] = [];
const chaveDoPendente = (canvasId: string, gerarId: string) => `${canvasId}|${gerarId}`;
function anotarPendente(canvasId: string, gerarId: string, r: ResultadoDoCanvas) {
  const k = chaveDoPendente(canvasId, gerarId);
  const copia: Record<string, ResultadoDoCanvas[]> = { ...pendentes };
  copia[k] = (copia[k] || []).filter((x) => x.geracao_id !== r.geracao_id).concat([r]);
  pendentes = copia;
  ouvintesDosPendentes.slice().forEach((f) => f());
}
function tirarPendentes(canvasId: string): Record<string, ResultadoDoCanvas[]> {
  const saida: Record<string, ResultadoDoCanvas[]> = {};
  const resto: Record<string, ResultadoDoCanvas[]> = {};
  Object.keys(pendentes).forEach((k) => {
    if (k.indexOf(`${canvasId}|`) === 0) saida[k.slice(canvasId.length + 1)] = pendentes[k];
    else resto[k] = pendentes[k];
  });
  if (Object.keys(saida).length) {
    pendentes = resto;
    ouvintesDosPendentes.slice().forEach((f) => f());
  }
  return saida;
}
function usePendentes() {
  return useSyncExternalStore(
    (f) => {
      ouvintesDosPendentes.push(f);
      return () => {
        const i = ouvintesDosPendentes.indexOf(f);
        if (i >= 0) ouvintesDosPendentes.splice(i, 1);
      };
    },
    () => pendentes,
    () => pendentes,
  );
}

async function gerarNoResultado(p: {
  queryClient: QueryClient;
  clientId: string;
  canvasId: string;
  gerarId: string;
  motores: string[];
  qualidade: Qualidade;
  atualizar: () => void;
}) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  p.motores.forEach((m) => marcarAndamento(chaveDoAndamento("canvas", p.gerarId, m), { estado: "gerando", erro: "" }));
  await emParalelo(p.motores, 4, async (motorId) => {
    const chave = chaveDoAndamento("canvas", p.gerarId, motorId);
    try {
      // Formato e resolução vão no Resultado salvo (a função lê de lá); aqui só o motor desta chamada e a qualidade.
      const r = await gerarNoCanvas({ canvasId: p.canvasId, gerarId: p.gerarId, motorId, qualidade: p.qualidade });
      if (r.imagem) acrescentarFotos(p.queryClient, p.clientId, [r.imagem]);
      anotarPendente(p.canvasId, p.gerarId, r.resultado);
      custo += Number(r.custo_usd || 0);
      feitas++;
      marcarAndamento(chave, null);
    } catch (e) {
      falhas++;
      marcarAndamento(chave, { estado: "falhou", erro: textoDoErro(e) });
    }
  });
  invalidarFotos(p.queryClient, p.clientId);
  p.atualizar();
  if (feitas) toast.success(`${feitas} ${feitas === 1 ? "foto pronta" : "fotos prontas"} no Resultado`, { description: `Custo real: ${usd(custo)}. Elas já estão no acervo, marcadas como geradas.` });
  if (falhas) toast.error(`${falhas} ${falhas === 1 ? "motor falhou" : "motores falharam"}`, { description: "O erro aparece no Resultado, ao lado do motor." });
}

// ------------------------------------------------------------------ o que cada cartão mostra

interface Miniatura {
  caminho: string;
  bucket: string;
  item?: ItemDaBiblioteca | null;
}

interface Descricao {
  titulo: string;
  subtitulo: string;
  miniatura: Miniatura | null;
}

interface Fontes {
  kits: KitDeFoto[];
  fotos: FotoDoAcervo[];
  personas: Persona[];
  ancoras: ImagemDaPersona[];
  biblioteca: ItemDaBiblioteca[];
}

const daFoto = (x: FotoDoAcervo | null): Miniatura | null => (x ? { caminho: x.storage_path, bucket: x.storage_bucket || "mesa" } : null);

function capaDoKit(k: KitDeFoto, fotos: FotoDoAcervo[]): Miniatura | null {
  const id = k.frente_imagem_id || (k.refs[0] && k.refs[0].imagem_id) || null;
  return daFoto(id ? fotos.find((x) => x.id === id) || null : null);
}

function rostoDaPersona(p: Persona, ancoras: ImagemDaPersona[]): Miniatura | null {
  const a = p.ancora_imagem_id ? ancoras.find((x) => x.id === p.ancora_imagem_id) || null : null;
  return a ? { caminho: a.storage_path || a.url, bucket: a.storage_bucket || "mesa" } : null;
}

const kitsUsaveis = (kits: KitDeFoto[]) => kits.filter((k) => !!k.id && k.tipo !== "pessoa" && k.status !== "arquivado");
const personaSemAncora = (p: Persona) => p.status === "rascunho" || p.status === "candidatos";

function descrever(no: NoDoCanvas, f: Fontes): Descricao {
  const d = no.dados;
  const foto = (id?: string | null) => (id ? f.fotos.find((x) => x.id === id) || null : null);
  const falta = faltaNoCartao(no);
  if (no.tipo === "produto") {
    const k = f.kits.find((x) => x.id === d.kit_id) || null;
    return { titulo: k ? k.nome : "Produto", subtitulo: k ? `${rotuloDoTipo(k.tipo)}${k.variante ? ` · ${k.variante}` : ""}` : falta, miniatura: k ? capaDoKit(k, f.fotos) : null };
  }
  if (no.tipo === "modelo") {
    const p = f.personas.find((x) => x.id === d.modelo_id) || null;
    return { titulo: p ? p.nome : "Modelo", subtitulo: p ? STATUS_DA_PERSONA[p.status].rotulo : falta, miniatura: p ? rostoDaPersona(p, f.ancoras) : null };
  }
  if (no.tipo === "ambiente" || no.tipo === "estilo") {
    const x = foto(d.imagem_id);
    const item = d.biblioteca_id ? f.biblioteca.find((i) => i.id === d.biblioteca_id) || null : null;
    const t = (d.texto || "").trim();
    return {
      titulo: item ? item.titulo : t ? t.slice(0, 48) : x ? x.nome : TIPOS_DE_NO[no.tipo].rotulo,
      subtitulo: falta || (no.tipo === "estilo" ? "só paleta, luz e enquadramento" : "lugar, luz e clima"),
      miniatura: item ? { caminho: "", bucket: "mesa", item } : daFoto(x),
    };
  }
  if (no.tipo === "texto") {
    const t = (d.texto || "").trim();
    return { titulo: t ? t.slice(0, 60) : "Pedido", subtitulo: falta || (d.papel === "restricao" ? "restrição" : "pedido"), miniatura: null };
  }
  return { titulo: "Resultado", subtitulo: "", miniatura: null };
}

function MiniaturaGrande({ m, alt }: { m: Miniatura | null; alt: string }) {
  if (!m) return null;
  return m.item ? <ImagemDaBiblioteca item={m.item} /> : <MiniaturaDoStorage bucket={m.bucket} caminho={m.caminho} alt={alt} largura={420} className="h-full w-full" />;
}

// ------------------------------------------------------------------ contexto do quadro (os nós chamam a tela)

interface ValorDoQuadro {
  fontes: Fontes;
  /** Gera no Resultado (salva antes; uma chamada por motor, em segundo plano). */
  gerar: (gerarId: string) => Promise<Record<string, never>>;
  /** Abre a escolha com miniatura (acervo, kits, modelos) para trocar o conteúdo do cartão. */
  abrirEscolha: (tipo: TipoDeNo, trocarId: string | null) => void;
  /** Seleciona o cartão e abre os ajustes. */
  abrir: (noId: string) => void;
  tirar: (noId: string) => void;
  /** Monta um modelo pronto no Resultado vazio. */
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
}

type NoDeCartao = Node<DadosDoCartao>;
type NoDeResultado = Node<DadosDoResultado>;

function NoCartao({ data, selected }: NodeProps<NoDeCartao>) {
  const ctx = useContext(ContextoDoQuadro);
  const { no, descricao, numero, ligado } = data;
  const tipo = TIPOS_DE_NO[no.tipo];
  const Icone = ICONES[no.tipo];
  const falta = faltaNoCartao(no);
  const texto = (no.dados.texto || "").trim();
  return (
    <div
      style={{ width: TAMANHO_DO_CARTAO.largura, height: TAMANHO_DO_CARTAO.altura }}
      className={`relative overflow-visible rounded-2xl border bg-card text-left shadow-lg transition-shadow ${tipo.borda} ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
      data-no-do-canvas={no.id}
      data-tipo={no.tipo}
    >
      <span className="pointer-events-none absolute left-3 right-3 top-0 h-[3px] rounded-b-full" style={{ background: tipo.cor }} />
      <div className="flex h-8 items-center px-3">
        <Icone className={`mr-1.5 h-3.5 w-3.5 shrink-0 ${tipo.texto}`} />
        <span className={`min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-wider ${tipo.texto}`}>{tipo.rotulo}</span>
        {numero !== null && (
          <span className="rounded-full border border-border bg-background px-1.5 text-[10px] font-semibold text-foreground" title="Ordem em que vai ao gerador">
            {numero}
          </span>
        )}
        {!ligado && <span className="ml-1 rounded-full bg-muted px-1.5 text-[9.5px] text-muted-foreground">solto</span>}
      </div>
      <div className="relative mx-2 overflow-hidden rounded-xl bg-muted" style={{ height: ALTURA_DA_MINIATURA }}>
        {no.tipo === "texto" ? (
          <p className={`h-full overflow-hidden p-2.5 text-[12px] leading-snug [overflow-wrap:anywhere] ${texto ? "text-foreground" : "text-muted-foreground"}`}>
            {texto ? `"${texto.slice(0, 180)}"` : "Escreva o que você quer na foto."}
          </p>
        ) : descricao.miniatura ? (
          <MiniaturaGrande m={descricao.miniatura} alt={descricao.titulo} />
        ) : (no.tipo === "ambiente" || no.tipo === "estilo") && texto ? (
          <p className="h-full overflow-hidden p-2.5 text-[12px] leading-snug text-foreground [overflow-wrap:anywhere]">{texto.slice(0, 180)}</p>
        ) : (
          <button
            type="button"
            className="nodrag flex h-full w-full flex-col items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/60 hover:text-foreground"
            onClick={() => ctx && ctx.abrirEscolha(no.tipo, no.id)}
            data-escolher-no-cartao={no.id}
          >
            <ImagePlus className="mb-1 h-5 w-5" />
            <span className="text-[11.5px] font-medium">Escolher {tipo.rotulo.toLowerCase()}</span>
          </button>
        )}
      </div>
      <div className="px-3 pt-2">
        <p className="truncate text-[12.5px] font-semibold leading-snug">{descricao.titulo}</p>
        <p className={`truncate text-[10.5px] ${falta ? "text-warning" : "text-muted-foreground"}`}>{descricao.subtitulo}</p>
      </div>
      {selected && ctx && (
        <button
          type="button"
          className="nodrag absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow hover:text-destructive"
          aria-label="Tirar o cartão do quadro"
          onClick={() => ctx.tirar(no.id)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <Handle type="source" position={Position.Right} id="saida" style={{ width: ALCA, height: ALCA, background: tipo.cor, border: "2px solid hsl(var(--card))" }} />
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

function NoResultado({ data, selected }: NodeProps<NoDeResultado>) {
  const ctx = useContext(ContextoDoQuadro);
  const { no, junta, bloqueios, entradas } = data;
  const { clientId, catalogo } = useMesa();
  const andamentos = useAndamentos();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [mostrando, setMostrando] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState(false);
  const [ocupado, setOcupado] = useState<"" | "aprovar" | "baixar">("");
  const motores = no.dados.motores || [];
  const qualidade: Qualidade = no.dados.qualidade || "alta";
  const prontos = (no.dados.resultados || []).filter((r) => r.status === "gerada" && !!(r.storage_path || r.url));
  useEffect(() => setMostrando(null), [prontos.length]);
  const atual = prontos.find((r) => r.geracao_id === mostrando) || (prontos.length ? prontos[prontos.length - 1] : null);
  const foto = atual && atual.imagem_id && ctx ? ctx.fontes.fotos.find((f) => f.id === atual.imagem_id) || null : null;
  const estados = motores.map((m) => ({ motor: m, a: andamentos[chaveDoAndamento("canvas", no.id, m)] }));
  const gerando = estados.filter((e) => !!e.a && e.a.estado === "gerando");
  const falhas = estados.filter((e) => !!e.a && e.a.estado === "falhou");
  const segundos = useSegundos(gerando.length > 0);
  const caminho = atual ? atual.storage_path || atual.url : "";

  const aprovar = async () => {
    if (!foto || ocupado) return;
    setOcupado("aprovar");
    try {
      const nova = await decidirFoto(clientId, foto.id, "aprovar");
      if (nova) acrescentarFotos(queryClient, clientId, [nova]);
      invalidarFotos(queryClient, clientId);
      toast.success("Foto aprovada pela equipe", { description: "Agora ela pode ir para a Mesa e para a aprovação do cliente." });
    } catch (e) {
      avisarErro(e, "Não aprovada");
    } finally {
      setOcupado("");
    }
  };

  const baixar = async () => {
    if (!atual || ocupado) return;
    setOcupado("baixar");
    try {
      await baixarImagem(atual.storage_bucket, atual.storage_path || atual.url, foto ? foto.nome : `canvas-${rotuloDoMotor(catalogo, atual.motor_id)}`);
    } catch (e) {
      avisarErro(e, "Foto não baixada");
    } finally {
      setOcupado("");
    }
  };

  const usarNaMesa = () => {
    if (!foto) return;
    navigate(`/mesa?client=${clientId}&aba=estudio&fotos=${foto.id}`);
  };

  const rotuloDoGerar = motores.length > 1 ? `Gerar em ${motores.length} motores` : prontos.length ? "Gerar de novo" : "Gerar foto";

  return (
    <div
      style={{ width: TAMANHO_DA_SAIDA.largura, height: TAMANHO_DA_SAIDA.altura }}
      className={`relative flex flex-col overflow-visible rounded-3xl border border-primary/40 bg-card shadow-2xl ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
      data-no-do-canvas={no.id}
      data-tipo="gerar"
    >
      <div className="flex h-10 shrink-0 items-center px-4">
        <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary/15">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="flex-1 text-[12px] font-semibold uppercase tracking-wider">Resultado</span>
        {gerando.length > 0 ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Gerando" />
        ) : (
          <span className="text-[10.5px] text-muted-foreground">
            {prontos.length} {prontos.length === 1 ? "foto" : "fotos"}
          </span>
        )}
      </div>
      <p className="h-9 shrink-0 overflow-hidden px-4 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]" data-junta="" title={junta || undefined}>
        {junta ? <span className="text-foreground">{junta}</span> : "Junta o que você puser no quadro. Comece por um produto ou uma modelo na barra à esquerda."}
      </p>
      <div className="relative mx-3 mt-1 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted" style={{ height: ALTURA_DA_FOTO }} data-foto-do-resultado={atual ? atual.geracao_id : ""}>
        {atual ? (
          <button type="button" className="nodrag block h-full w-full cursor-zoom-in" onClick={() => setAmpliada(true)} aria-label="Ver a foto grande">
            <ImagemDaMesa caminho={caminho} bucket={atual.storage_bucket} alt="Foto gerada no Canvas" className="h-full w-full !object-contain" />
            <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center rounded-full border border-primary/40 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary" data-selo="gerada">
              <Sparkles className="mr-0.5 h-2.5 w-2.5" /> gerada
            </span>
            {foto && foto.aprovada && (
              <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center rounded-full border border-success/40 bg-card px-1.5 py-px text-[9.5px] font-semibold text-success">
                <Check className="mr-0.5 h-2.5 w-2.5" /> aprovada
              </span>
            )}
          </button>
        ) : gerando.length > 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <Loader2 className="mb-2 h-7 w-7 animate-spin text-primary" />
            <p className="text-[12.5px] font-medium">Gerando a foto</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Costuma levar de 30 s a 2 min. Pode sair da aba: a foto fica salva.</p>
          </div>
        ) : entradas === 0 && ctx ? (
          <div className="flex h-full flex-col justify-center px-3 text-left" data-comece-rapido="">
            <p className="mb-2 text-center text-[11.5px] text-muted-foreground">A foto aparece aqui. Comece por um modelo pronto:</p>
            {MODELOS_PRONTOS.map((m) => (
              <button
                key={m.chave}
                type="button"
                className="nodrag mb-1.5 flex w-full items-center rounded-xl border border-border bg-card px-2.5 py-2 text-left text-[12px] font-medium transition-colors hover:border-primary/60"
                onClick={() => ctx.aplicarModelo(m.chave)}
                data-modelo-pronto={m.chave}
                title={m.dica}
              >
                <Wand2 className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{m.rotulo}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
            <Sparkles className="mb-2 h-6 w-6 text-primary/70" />
            <p className="text-[12px]">A foto aparece aqui.</p>
          </div>
        )}
      </div>
      <div className="mx-3 mt-2 h-9 shrink-0" data-andamento-do-resultado="">
        {gerando.length > 0 ? (
          <div className="min-w-0">
            <div className="mb-1 flex items-center text-[11px]">
              <span className="min-w-0 flex-1 truncate text-foreground">
                Gerando {gerando.length > 1 ? `em ${gerando.length} motores` : `no ${rotuloDoMotor(catalogo, gerando[0].motor)}`}
              </span>
              <span className="text-muted-foreground">{segundos} s</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full animate-pulse rounded-full bg-primary" style={{ width: `${Math.min(92, 8 + segundos * 1.2)}%` }} />
            </div>
          </div>
        ) : prontos.length > 1 ? (
          <div className="flex min-w-0 items-center overflow-hidden" aria-label="Fotos deste Resultado">
            {prontos
              .slice(-6)
              .reverse()
              .map((r) => (
                <button
                  key={r.geracao_id}
                  type="button"
                  className={`nodrag mr-1 block shrink-0 overflow-hidden rounded-md border ${atual && atual.geracao_id === r.geracao_id ? "border-primary" : "border-border"}`}
                  style={{ width: 34, height: 34 }}
                  onClick={() => setMostrando(r.geracao_id)}
                  aria-label={`Ver a foto do ${rotuloDoMotor(catalogo, r.motor_id)}`}
                  title={rotuloDoMotor(catalogo, r.motor_id)}
                >
                  <MiniaturaDoStorage bucket={r.storage_bucket} caminho={r.storage_path || r.url} alt="" largura={96} className="h-full w-full" />
                </button>
              ))}
          </div>
        ) : falhas.length > 0 ? (
          <p className="truncate text-[11px] text-destructive" role="alert" title={falhas.map((f) => `${rotuloDoMotor(catalogo, f.motor)}: ${f.a ? f.a.erro : ""}`).join("\n")}>
            {rotuloDoMotor(catalogo, falhas[0].motor)} falhou: {falhas[0].a ? falhas[0].a.erro : ""}
          </p>
        ) : (
          <p className="truncate pt-2 text-[11px] text-muted-foreground">
            {motores.length} {motores.length === 1 ? "motor" : "motores"} · {String(no.dados.formato || "4:5")} · {entradas} {entradas === 1 ? "cartão" : "cartões"}
          </p>
        )}
      </div>
      <div className="mx-3 flex h-8 shrink-0 items-center" data-acoes-do-resultado="">
        {atual ? (
          <>
            {foto && foto.aprovada ? (
              <span className="mr-1.5 inline-flex h-7 items-center rounded-lg px-1.5 text-[11.5px] font-medium text-success">
                <Check className="mr-1 h-3.5 w-3.5" /> Aprovada
              </span>
            ) : (
              <button type="button" className="nodrag mr-1.5 inline-flex h-7 items-center rounded-lg border border-border px-2 text-[11.5px] hover:border-success/60 hover:text-success disabled:opacity-60" disabled={!foto || !!ocupado} onClick={() => void aprovar()}>
                {ocupado === "aprovar" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />} Aprovar
              </button>
            )}
            <button
              type="button"
              className="nodrag mr-1.5 inline-flex h-7 items-center rounded-lg border border-border px-2 text-[11.5px] hover:border-primary/60 disabled:cursor-not-allowed disabled:text-muted-foreground"
              disabled={!foto || !foto.aprovada}
              title={foto && foto.aprovada ? "Abre o Estúdio da Mesa com esta foto" : "Aprove a foto para usar na Mesa"}
              onClick={usarNaMesa}
            >
              <ArrowUpRight className="mr-1 h-3 w-3" /> Usar na Mesa
            </button>
            <button type="button" className="nodrag inline-flex h-7 items-center rounded-lg border border-border px-2 text-[11.5px] hover:border-primary/60 disabled:opacity-60" disabled={!!ocupado} onClick={() => void baixar()}>
              {ocupado === "baixar" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />} Baixar
            </button>
          </>
        ) : (
          <p className={`truncate text-[11px] ${bloqueios.length ? "text-warning" : "text-muted-foreground"}`} title={bloqueios.join("\n") || undefined}>
            {bloqueios.length ? bloqueios[0] : "Tudo pronto para gerar."}
          </p>
        )}
      </div>
      <div className="mx-3 mb-3 mt-auto">
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-4 w-4" /> {rotuloDoGerar}
            </>
          }
          titulo="Geração do Canvas"
          descricao="Uma foto por motor ligado. O que sair entra no acervo, marcado como gerado, e aparece aqui."
          className="nodrag h-10 w-full rounded-xl text-[13px] font-semibold"
          disabled={!ctx || bloqueios.length > 0 || gerando.length > 0}
          fecharAoConfirmar
          partes={() => partesDoGerar(motores, qualidade, entradas)}
          executar={() => (ctx ? ctx.gerar(no.id) : Promise.resolve({}))}
        />
      </div>
      {ORDEM_DAS_ENTRADAS.map((e, i) => (
        <Handle
          key={e}
          type="target"
          position={Position.Left}
          id={e}
          style={{ top: TOPO_DAS_ENTRADAS + i * PASSO_DAS_ENTRADAS, width: ALCA, height: ALCA, background: TIPOS_DE_NO[e === "pessoa" ? "modelo" : (e as TipoDeNo)].cor, border: "2px solid hsl(var(--card))" }}
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

const TIPOS_NO_QUADRO = { produto: NoCartao, modelo: NoCartao, ambiente: NoCartao, estilo: NoCartao, texto: NoCartao, gerar: NoResultado };

/** Alças declaradas no próprio nó: as linhas não dependem de medir o cartão depois de montar. */
function alcasDoNo(tipo: TipoDeNo) {
  if (tipo === "gerar") {
    return ORDEM_DAS_ENTRADAS.map((e, i) => ({ id: e, type: "target" as const, position: Position.Left, x: -ALCA / 2, y: TOPO_DAS_ENTRADAS + i * PASSO_DAS_ENTRADAS - ALCA / 2, width: ALCA, height: ALCA }));
  }
  return [{ id: "saida", type: "source" as const, position: Position.Right, x: TAMANHO_DO_CARTAO.largura - ALCA / 2, y: TAMANHO_DO_CARTAO.altura / 2 - ALCA / 2, width: ALCA, height: ALCA }];
}

// ------------------------------------------------------------------ escolher com miniatura (acervo, kits, modelos, biblioteca)

function OpcaoComFoto({
  miniatura,
  titulo,
  subtitulo,
  aviso,
  desligada,
  onEscolher,
  atributo,
}: {
  miniatura: Miniatura | null;
  titulo: string;
  subtitulo?: string;
  aviso?: string;
  desligada?: boolean;
  onEscolher: () => void;
  atributo: string;
}) {
  return (
    <button
      type="button"
      disabled={desligada}
      onClick={onEscolher}
      data-opcao-da-escolha={atributo}
      className={`min-w-0 rounded-xl border bg-card p-1.5 text-left transition-colors ${desligada ? "cursor-not-allowed border-dashed border-border" : "border-border hover:border-primary/60"}`}
    >
      <Moldura proporcao={1}>
        {miniatura ? <MiniaturaGrande m={miniatura} alt={titulo} /> : <span className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">sem foto</span>}
      </Moldura>
      <p className="mt-1.5 truncate text-[12px] font-medium">{titulo}</p>
      {subtitulo && <p className="truncate text-[10.5px] text-muted-foreground">{subtitulo}</p>}
      {aviso && <p className="truncate text-[10.5px] text-warning">{aviso}</p>}
    </button>
  );
}

interface PedidoDeEscolha {
  tipo: AbaDaEscolha;
  /** Cartão a trocar; null põe um cartão novo no quadro. */
  trocarId: string | null;
}

function EscolherCartao({
  pedido,
  fontes,
  onFechar,
  onEscolher,
}: {
  pedido: PedidoDeEscolha | null;
  fontes: Fontes;
  onFechar: () => void;
  onEscolher: (tipo: AbaDaEscolha, dados: DadosDoNo, trocarId: string | null) => void;
}) {
  const { irPara } = useMesaFoto();
  const [aba, setAba] = useState<AbaDaEscolha>("produto");
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  useEffect(() => {
    if (!pedido) return;
    setAba(pedido.tipo);
    setTexto("");
    setBusca("");
  }, [pedido]);
  const trocando = !!(pedido && pedido.trocarId);
  const escolher = (dados: DadosDoNo) => {
    if (!pedido) return;
    onEscolher(aba, dados, pedido.trocarId);
    onFechar();
  };
  const kits = kitsUsaveis(fontes.kits);
  const personas = fontes.personas.filter((p) => p.status !== "arquivada");
  const referencias = fontes.biblioteca.filter((i) => i.tipo === "referencia");
  const termo = busca.trim().toLowerCase();
  const fotos = fontes.fotos.filter((f) => !termo || String(f.nome || "").toLowerCase().indexOf(termo) >= 0).slice(0, 48);
  const tipo = TIPOS_DE_NO[aba];

  return (
    <Dialog open={!!pedido} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="dark max-h-[88vh] max-w-3xl overflow-y-auto border-border bg-background text-foreground" data-escolher-cartao={aba}>
        <DialogHeader>
          <DialogTitle className="text-[15px]">{trocando ? `Trocar ${tipo.rotulo.toLowerCase()}` : "Pôr no quadro"}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {trocando ? tipo.dica : "Escolha pela foto. O cartão entra no quadro já ligado ao Resultado."}
          </DialogDescription>
        </DialogHeader>
        {!trocando && (
          <div className="flex min-w-0 flex-wrap items-center" role="tablist" aria-label="O que pôr no quadro">
            {ABAS_DA_ESCOLHA.map((a) => {
              const t = TIPOS_DE_NO[a];
              const Icone = ICONES[a];
              return (
                <button
                  key={a}
                  type="button"
                  role="tab"
                  aria-selected={aba === a}
                  onClick={() => setAba(a)}
                  className={`mb-1.5 mr-1.5 inline-flex h-9 items-center rounded-full border px-3 text-[12.5px] ${aba === a ? `${t.borda} ${t.fundo} text-foreground` : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  <Icone className={`mr-1.5 h-3.5 w-3.5 ${t.texto}`} /> {t.rotulo}
                </button>
              );
            })}
          </div>
        )}

        {aba === "produto" &&
          (kits.length ? (
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Produtos do cliente">
              {kits.map((k) => (
                <OpcaoComFoto
                  key={String(k.id)}
                  atributo={String(k.id)}
                  miniatura={capaDoKit(k, fontes.fotos)}
                  titulo={k.nome}
                  subtitulo={`${rotuloDoTipo(k.tipo)}${k.variante ? ` · ${k.variante}` : ""}`}
                  onEscolher={() => escolher({ kit_id: String(k.id) })}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-5 text-center">
              <p className="text-[13px] font-medium">Nenhum produto confirmado ainda.</p>
              <p className="mt-1 text-[12px] text-muted-foreground">O produto nasce no passo 2 (Produto), a partir das fotos.</p>
              <Button type="button" size="sm" variant="outline" className="mt-3 h-8 text-[12px]" onClick={() => { onFechar(); irPara("kits"); }}>
                Ir para Produto
              </Button>
            </div>
          ))}

        {aba === "modelo" &&
          (personas.length ? (
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Modelos">
              {personas.map((p) => (
                <OpcaoComFoto
                  key={p.id}
                  atributo={p.id}
                  miniatura={rostoDaPersona(p, fontes.ancoras)}
                  titulo={p.nome}
                  subtitulo={STATUS_DA_PERSONA[p.status].rotulo}
                  aviso={personaSemAncora(p) ? "sem âncora: escolha na aba Modelos" : undefined}
                  desligada={personaSemAncora(p)}
                  onEscolher={() => escolher({ modelo_id: p.id, versao: p.versao })}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-5 text-center">
              <p className="text-[13px] font-medium">Nenhuma modelo ainda.</p>
              <p className="mt-1 text-[12px] text-muted-foreground">Crie a modelo sintética na aba Modelos e escolha a âncora.</p>
              <Button type="button" size="sm" variant="outline" className="mt-3 h-8 text-[12px]" onClick={() => { onFechar(); irPara("modelos"); }}>
                Ir para Modelos
              </Button>
            </div>
          ))}

        {(aba === "ambiente" || aba === "estilo") && (
          <div className="min-w-0 space-y-4">
            <div className="min-w-0 rounded-xl border border-border bg-card p-3">
              <p className="mb-1.5 text-[12px] font-medium">{aba === "ambiente" ? "Descreva o lugar" : "Descreva a pegada"}</p>
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={2}
                placeholder={aba === "ambiente" ? "Ex.: praia no fim de tarde, mesa de madeira clara, rua com fachadas antigas" : "Ex.: luz de estúdio fria, céu azul limpo, cores quentes"}
                aria-label={aba === "ambiente" ? "Descrição do ambiente" : "Descrição do estilo"}
                className="text-[12.5px]"
              />
              <Button type="button" size="sm" className="mt-2 h-8 text-[12px]" disabled={!texto.trim()} onClick={() => escolher(trocando ? { texto: texto.trim() } : { texto: texto.trim() })}>
                <Check className="mr-1 h-3.5 w-3.5" /> {trocando ? "Usar esta descrição" : "Pôr no quadro"}
              </Button>
            </div>
            {referencias.length > 0 && (
              <div className="min-w-0">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Referências da biblioteca</p>
                <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Referências da biblioteca">
                  {referencias.slice(0, 36).map((i) => (
                    <OpcaoComFoto key={i.id} atributo={i.id} miniatura={{ caminho: "", bucket: "mesa", item: i }} titulo={i.titulo} onEscolher={() => escolher({ biblioteca_id: i.id, imagem_id: null })} />
                  ))}
                </div>
              </div>
            )}
            <div className="min-w-0">
              <div className="mb-1.5 flex min-w-0 flex-wrap items-center">
                <p className="mr-2 min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Fotos do acervo</p>
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome" aria-label="Buscar foto do acervo" className="h-8 w-full min-w-0 text-[12px] sm:w-56" />
              </div>
              {fotos.length ? (
                <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Fotos do acervo">
                  {fotos.map((f) => (
                    <OpcaoComFoto key={f.id} atributo={f.id} miniatura={daFoto(f)} titulo={f.nome} onEscolher={() => escolher({ imagem_id: f.id, biblioteca_id: null })} />
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">Nenhuma foto no acervo{termo ? " com esse nome" : ""}.</p>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{aba === "ambiente" ? "O gerador usa lugar, luz e clima; pessoas da foto não são copiadas." : "Só paleta, luz e enquadramento. Estilo nunca vira identidade."}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ editores (barra lateral e modo lista)

function EditorDoCartao({ no, fontes, onMudar, onEscolher }: { no: NoDoCanvas; fontes: Fontes; onMudar: (dados: Partial<DadosDoNo>) => void; onEscolher: () => void }) {
  const d = no.dados;
  const desc = descrever(no, fontes);
  const tipo = TIPOS_DE_NO[no.tipo];
  if (no.tipo === "texto") {
    return (
      <div className="min-w-0 space-y-2">
        <Pilulas
          rotulo="Papel do texto"
          opcoes={[
            { valor: "pedido", rotulo: "Pedido" },
            { valor: "restricao", rotulo: "Restrição" },
          ]}
          valor={d.papel || "pedido"}
          onEscolher={(v) => onMudar({ papel: v as "pedido" | "restricao" })}
        />
        <Textarea value={d.texto || ""} onChange={(e) => onMudar({ texto: e.target.value })} rows={5} placeholder="Ex.: ela usando o óculos, sorrindo de leve, luz de fim de tarde" aria-label="Texto do pedido" className="text-[12.5px]" />
        <p className="text-[11px] text-muted-foreground">{d.papel === "restricao" ? "Restrição: o que não pode aparecer ou mudar." : "Pedido: a cena em palavras, do jeito que você falaria."}</p>
      </div>
    );
  }
  const temImagem = !!(d.imagem_id || d.biblioteca_id);
  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex min-w-0 items-center rounded-xl border border-border bg-background p-2">
        <span className="relative block shrink-0 overflow-hidden rounded-lg bg-muted" style={{ width: 64, height: 64 }}>
          <MiniaturaGrande m={desc.miniatura} alt={desc.titulo} />
        </span>
        <div className="ml-2.5 min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold">{desc.titulo}</p>
          <p className={`truncate text-[11px] ${faltaNoCartao(no) ? "text-warning" : "text-muted-foreground"}`}>{desc.subtitulo}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center">
        <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8 text-[12px]" onClick={onEscolher} data-trocar-cartao={no.id}>
          <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
          {(no.tipo === "produto" && d.kit_id) || (no.tipo === "modelo" && d.modelo_id) || temImagem ? `Trocar ${tipo.rotulo.toLowerCase()}` : `Escolher ${tipo.rotulo.toLowerCase()}`}
        </Button>
        {(no.tipo === "ambiente" || no.tipo === "estilo") && temImagem && (
          <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" onClick={() => onMudar({ imagem_id: null, biblioteca_id: null })}>
            Tirar a imagem
          </Button>
        )}
      </div>
      {(no.tipo === "ambiente" || no.tipo === "estilo") && (
        <Textarea
          value={d.texto || ""}
          onChange={(e) => onMudar({ texto: e.target.value })}
          rows={2}
          placeholder={no.tipo === "ambiente" ? "Descreva o lugar: praia no fim de tarde, mesa de madeira clara..." : "Descreva a pegada: céu azul, luz de estúdio fria..."}
          aria-label={no.tipo === "ambiente" ? "Descrição do ambiente" : "Descrição do estilo"}
          className="text-[12.5px]"
        />
      )}
      <p className="text-[11px] leading-snug text-muted-foreground">
        {no.tipo === "produto"
          ? "Vão as fotos de identidade do kit, na ordem de prioridade. O produto não muda."
          : no.tipo === "modelo"
            ? "Só modelo com âncora escolhida. Vão a âncora e as vistas mais próximas do ângulo."
            : no.tipo === "ambiente"
              ? "O gerador usa lugar, luz e clima; pessoas da foto não são copiadas."
              : "Só paleta, luz e enquadramento. Nunca vira identidade."}
      </p>
    </div>
  );
}

function FotoDoResultado({ r, foto, onConferencia }: { r: ResultadoDoCanvas; foto: FotoDoAcervo | null; onConferencia: (c: ConferenciaDaPersona | null) => void }) {
  const { catalogo } = useMesa();
  const { irPara } = useMesaFoto();
  const [ampliada, setAmpliada] = useState(false);
  const caminho = r.storage_path || r.url;
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background p-2.5" data-resultado={r.geracao_id}>
      <div className="flex min-w-0 items-start">
        <button type="button" className="block shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted" style={{ width: 72, height: 90 }} onClick={() => setAmpliada(true)} aria-label="Ver grande">
          <MiniaturaDoStorage bucket={r.storage_bucket} caminho={caminho} alt="Foto do Canvas" largura={200} className="h-full w-full" />
        </button>
        <div className="ml-2.5 min-w-0 flex-1">
          <p className="flex items-center text-[12.5px] font-semibold">
            <span className="min-w-0 truncate">{rotuloDoMotor(catalogo, r.motor_id)}</span>
            <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-primary/30 px-1.5 py-px text-[9.5px] font-semibold text-primary" data-selo="gerada">
              gerada
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">{r.custo_usd ? `${usd(r.custo_usd)} · ` : ""}no acervo</p>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
            {foto && <AprovarFoto foto={foto} />}
            <BotaoComCusto
              rotulo={
                <>
                  <ScanSearch className="mr-1 h-3.5 w-3.5" /> Conferir
                </>
              }
              titulo="Conferência pronta"
              descricao="A visão compara com o produto (formato, cor, logo) e com a âncora da modelo. Só aviso."
              variant="outline"
              className="mb-1.5 mr-1.5 h-8 text-[12px]"
              partes={() => partesDaConferencia(catalogo)}
              executar={() => conferirGeracao(r.geracao_id)}
              aoConcluir={(data) => onConferencia(data ? data.conferencia : null)}
            />
            {r.imagem_id && (
              <Button type="button" size="sm" variant="ghost" className="mb-1.5 h-8 text-[12px]" onClick={() => irPara("usar", { imagem: r.imagem_id })}>
                Revisar e usar
              </Button>
            )}
          </div>
        </div>
      </div>
      {foto && (
        <div className="mt-1">
          <BotoesDeUso fotos={[foto]} compacto />
        </div>
      )}
      {r.conferencia && (
        <div className="mt-1 rounded-md border border-border p-2 text-[11px] leading-snug" data-conferencia="">
          <p className="mb-0.5 font-medium text-muted-foreground">Conferência (aviso, você decide)</p>
          {r.conferencia.alertas.map((a) => (
            <p key={a} className="text-warning [overflow-wrap:anywhere]">
              {a}
            </p>
          ))}
          {r.conferencia.pontos.map((p) => (
            <p key={p.criterio} className={p.ok === false ? "text-warning" : "text-muted-foreground"}>
              {p.ok === false ? "Atenção" : "Ok"}: {p.criterio}
              {p.nota ? `, ${p.nota}` : ""}
            </p>
          ))}
        </div>
      )}
      <Ampliar imagens={[{ caminho, bucket: r.storage_bucket, titulo: "Resultado do Canvas (gerada)", legenda: "Imagem gerada por IA" }]} indice={ampliada ? 0 : null} onFechar={() => setAmpliada(false)} />
    </div>
  );
}

function PedidoMontado({ m, fotos, onFechar }: { m: Montagem; fotos: FotoDoAcervo[]; onFechar: () => void }) {
  return (
    <div className="min-w-0 rounded-xl border border-primary/40 bg-background p-3" data-pedido-montado="">
      <div className="mb-2 flex min-w-0 items-center">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold">O que vai para o gerador</p>
        {m.estimativa_usd !== null && <span className="mr-2 text-[11.5px] text-muted-foreground">~{usd(m.estimativa_usd)} por motor</span>}
        <button type="button" onClick={onFechar} aria-label="Fechar o que vai ao gerador" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      {m.referencias.length > 0 && (
        <ol className="mb-2 flex min-w-0 flex-wrap" aria-label="Referências na ordem">
          {m.referencias.map((r) => {
            const f = r.imagem_id ? fotos.find((x) => x.id === r.imagem_id) || null : null;
            const caminho = r.storage_path || (f ? f.storage_path : "") || r.url;
            return (
              <li key={`${r.ordem}-${r.imagem_id || r.origem_id}`} className="mb-1.5 mr-1.5 w-14" title={r.legenda || r.papel}>
                <span className="relative block overflow-hidden rounded-lg bg-muted" style={{ width: 56, height: 56 }}>
                  {caminho ? <MiniaturaDoStorage bucket={r.storage_bucket || (f ? f.storage_bucket : "mesa")} caminho={caminho} alt={r.legenda || r.papel} largura={160} className="h-full w-full" /> : null}
                  <span className="absolute left-0.5 top-0.5 rounded-full bg-card px-1 text-[9.5px] font-semibold">{r.ordem}</span>
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{r.papel || r.origem_tipo}</span>
              </li>
            );
          })}
        </ol>
      )}
      {m.cortadas > 0 && <p className="mb-1 text-[11px] text-warning">{m.cortadas} {m.cortadas === 1 ? "referência ficou" : "referências ficaram"} de fora pelo limite do motor.</p>}
      {m.avisos.map((a) => (
        <p key={a} className="mb-1 text-[11px] text-warning [overflow-wrap:anywhere]">
          {a}
        </p>
      ))}
      <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-[11.5px] leading-relaxed [overflow-wrap:anywhere]">{m.prompt || "A função não devolveu o texto do pedido."}</pre>
    </div>
  );
}

/** Custo de uma geração do Resultado (uma foto por motor ligado), sempre à vista. */
function CustoDoResultado({ canvas, no, curto = false }: { canvas: Canvas; no: NoDoCanvas | null; curto?: boolean }) {
  const motores = no ? no.dados.motores || [] : [];
  const partes = no && motores.length ? partesDoGerar(motores, no.dados.qualidade || "alta", entradasDoGerar(canvas, no.id).length) : null;
  const { data, isLoading } = useEstimativa(partes);
  if (!no) return null;
  if (!motores.length) return <span className="text-warning">sem motor</span>;
  if (isLoading || data === undefined) return <span className="text-muted-foreground">estimando</span>;
  return curto ? (
    <span data-custo-do-resultado="">~{usd(data)}</span>
  ) : (
    <span data-custo-do-resultado="">
      ~{usd(data)} por geração{motores.length > 1 ? ` (${motores.length} fotos)` : ""}
    </span>
  );
}

function AjustesDoResultado({
  canvas,
  no,
  fontes,
  onMudar,
  garantirSalvo,
  comGerar,
  onGerar,
}: {
  canvas: Canvas;
  no: NoDoCanvas;
  fontes: Fontes;
  onMudar: (dados: Partial<DadosDoNo>) => void;
  garantirSalvo: () => Promise<Canvas | null>;
  comGerar: boolean;
  onGerar: (gerarId: string) => Promise<Record<string, never>>;
}) {
  const { catalogo } = useMesa();
  const avisarErro = useAvisarErro();
  const andamentos = useAndamentos();
  const { opcoes } = useMemo(() => motoresDaRodada(catalogo), [catalogo]);
  const [montagem, setMontagem] = useState<Montagem | null>(null);
  const [montando, setMontando] = useState(false);
  const [conferencias, setConferencias] = useState<Record<string, ConferenciaDaPersona | null>>({});
  const d = no.dados;
  const motores = d.motores || [];
  const qualidade: Qualidade = d.qualidade || "alta";
  const formato = d.formato || "4:5";
  const entradas = entradasDoGerar(canvas, no.id);
  const bloqueios = bloqueiosDoGerar(canvas, no.id, fontes.personas);
  const avisos = avisosDoGerar(canvas, no.id, fontes.personas);
  const resultados = (d.resultados || []).slice().reverse();
  const gerando = motores.some((m) => {
    const a = andamentos[chaveDoAndamento("canvas", no.id, m)];
    return !!a && a.estado === "gerando";
  });
  const alternar = (id: string) => onMudar({ motores: motores.indexOf(id) >= 0 ? motores.filter((x) => x !== id) : motores.concat([id]) });

  const montar = async () => {
    if (montando || !motores.length) return;
    setMontando(true);
    try {
      const salvo = await garantirSalvo();
      if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de ver o que vai ao gerador.");
      setMontagem(await montarCanvas({ canvasId: salvo.id, gerarId: no.id, motorId: motores[0], qualidade }));
    } catch (e) {
      avisarErro(e, "Não deu para montar o que vai ao gerador");
    } finally {
      setMontando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4" data-ajustes-do-resultado={no.id}>
      <div className="min-w-0">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Motores (uma foto por motor)</p>
        <div className="flex min-w-0 flex-wrap" role="group" aria-label="Motores do Resultado">
          {opcoes.map((o) => {
            const ligado = motores.indexOf(o.id) >= 0;
            const a = andamentos[chaveDoAndamento("canvas", no.id, o.id)];
            return (
              <button
                key={o.id}
                type="button"
                role="switch"
                aria-checked={ligado}
                onClick={() => alternar(o.id)}
                className={`mb-1.5 mr-1.5 inline-flex h-7 max-w-full items-center truncate rounded-full border px-2.5 text-[11.5px] ${ligado ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                title={a && a.estado === "falhou" ? a.erro : undefined}
              >
                {ligado && <Check className="mr-1 h-3 w-3 text-primary" />}
                {o.rotulo}
                {a && a.estado === "gerando" && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
                {a && a.estado === "falhou" && <span className="ml-1 text-destructive">falhou</span>}
              </button>
            );
          })}
        </div>
        {motores.map((m) => {
          const a = andamentos[chaveDoAndamento("canvas", no.id, m)];
          return a && a.estado === "falhou" ? (
            <p key={m} className="text-[11px] text-destructive [overflow-wrap:anywhere]" role="alert">
              {rotuloDoMotor(catalogo, m)}: {a.erro}
            </p>
          ) : null;
        })}
      </div>
      <div className="min-w-0">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Formato</p>
        <Pilulas rotulo="Formato do Resultado" opcoes={FORMATOS_DO_CANVAS} valor={formato} onEscolher={(v) => onMudar({ formato: v })} />
      </div>
      <div className="min-w-0">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Qualidade</p>
        <Pilulas rotulo="Qualidade do Resultado" opcoes={QUALIDADES.map((q) => ({ valor: q.valor, rotulo: q.rotulo }))} valor={qualidade} onEscolher={(v) => onMudar({ qualidade: v as Qualidade })} />
      </div>
      <div className="min-w-0">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Resolução</p>
        <Pilulas rotulo="Resolução do Resultado" opcoes={RESOLUCOES_DO_CANVAS} valor={d.resolucao || "auto"} onEscolher={(v) => onMudar({ resolucao: v === "auto" ? null : (v as Resolucao) })} />
        <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">Automática usa a do motor. Motor que não aceita a pedida ajusta e avisa.</p>
      </div>
      <div className="flex min-w-0 items-center rounded-xl border border-border bg-background px-3 py-2 text-[12px]">
        <span className="min-w-0 flex-1 text-muted-foreground">Custo</span>
        <span className="font-semibold">
          <CustoDoResultado canvas={canvas} no={no} />
        </span>
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">O que o Resultado junta, na ordem</p>
        {entradas.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nada ainda. Ponha um produto ou uma modelo pela barra à esquerda.</p>
        ) : (
          <ol className="min-w-0 space-y-1" aria-label="Entradas do Resultado">
            {entradas.map((e) => (
              <li key={e.ligacao.id} className="flex min-w-0 items-center text-[12px]">
                <span className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10.5px] font-semibold">{e.numero}</span>
                <span className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TIPOS_DE_NO[e.no.tipo].cor }} />
                <span className="min-w-0 flex-1 truncate">
                  {ROTULOS_DAS_ENTRADAS[e.entrada]}: {descrever(e.no, fontes).titulo}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {bloqueios.length > 0 && (
        <ul className="space-y-0.5" aria-label="O que falta para gerar">
          {bloqueios.map((b) => (
            <li key={b} className="text-[11.5px] text-warning">
              {b}
            </li>
          ))}
        </ul>
      )}
      {avisos.map((a) => (
        <p key={a} className="text-[11.5px] text-muted-foreground">
          {a}
        </p>
      ))}
      <div className="flex min-w-0 flex-wrap items-center">
        <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-9 text-[12px]" disabled={montando || !motores.length || entradas.length === 0} onClick={() => void montar()}>
          {montando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />} Ver o que vai ao gerador
        </Button>
        {comGerar && (
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {motores.length > 1 ? `Gerar em ${motores.length} motores` : "Gerar foto"}
              </>
            }
            titulo="Geração do Canvas"
            descricao="Uma foto por motor ligado. O que sair entra no acervo, marcado como gerado, e aparece no Resultado."
            className="mb-1.5 h-9 text-[12.5px]"
            disabled={bloqueios.length > 0 || gerando}
            fecharAoConfirmar
            partes={() => partesDoGerar(motores, qualidade, entradas.length)}
            executar={() => onGerar(no.id)}
          />
        )}
      </div>
      {montagem && <PedidoMontado m={montagem} fotos={fontes.fotos} onFechar={() => setMontagem(null)} />}
      {resultados.length > 0 && (
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Fotos deste Resultado ({resultados.length})</p>
          {resultados.slice(0, 8).map((r) =>
            r.status === "falhou" ? (
              <p key={r.geracao_id} className="text-[11.5px] text-destructive">
                {rotuloDoMotor(catalogo, r.motor_id)}: {r.erro || "falhou"}
              </p>
            ) : (
              <FotoDoResultado
                key={r.geracao_id}
                r={conferencias[r.geracao_id] !== undefined ? { ...r, conferencia: conferencias[r.geracao_id] } : r}
                foto={r.imagem_id ? fontes.fotos.find((f) => f.id === r.imagem_id) || null : null}
                onConferencia={(c) => {
                  setConferencias({ ...conferencias, [r.geracao_id]: c });
                  onMudar({ resultados: (d.resultados || []).map((x) => (x.geracao_id === r.geracao_id ? { ...x, conferencia: c } : x)) });
                }}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ peças que flutuam sobre o quadro

function Paleta({ onTipo, onAdicionar, onResultado }: { onTipo: (t: TipoDeNo) => void; onAdicionar: () => void; onResultado: () => void }) {
  return (
    <nav aria-label="Cartões para o quadro" className="absolute left-3 top-3 z-10 w-[88px] rounded-2xl border border-border bg-card p-1.5 shadow-2xl" data-paleta-lateral="">
      {TIPOS_DE_ENTRADA.map((t) => {
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
            className="mb-1 flex w-full flex-col items-center rounded-xl px-1 py-2 text-center transition-colors hover:bg-muted"
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${tipo.borda} ${tipo.fundo}`}>
              <Icone className={`h-4 w-4 ${tipo.texto}`} />
            </span>
            <span className="mt-1 text-[11.5px] font-medium leading-none">{tipo.rotulo}</span>
          </button>
        );
      })}
      <span className="mx-1 my-1 block h-px bg-border" />
      <button type="button" onClick={onAdicionar} data-paleta="adicionar" className="mb-1 flex w-full flex-col items-center rounded-xl px-1 py-2 text-center hover:bg-muted" title="Escolher do acervo, dos produtos ou das modelos, pela foto">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Plus className="h-4 w-4" />
        </span>
        <span className="mt-1 text-[11.5px] font-medium leading-none">Adicionar</span>
      </button>
      <button type="button" onClick={onResultado} data-paleta="gerar" className="flex w-full items-center justify-center rounded-lg px-1 py-1.5 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground" title="Outro Resultado, para gerar outra combinação no mesmo quadro">
        <Plus className="mr-0.5 h-3 w-3" /> Resultado
      </button>
    </nav>
  );
}

function BarraLateral({ recolhida, onRecolher, titulo, custo, custoCurto, children }: { recolhida: boolean; onRecolher: (v: boolean) => void; titulo: ReactNode; custo: ReactNode; custoCurto: ReactNode; children: ReactNode }) {
  if (recolhida) {
    return (
      <div className="absolute right-3 top-3 z-10 flex w-[64px] flex-col items-center rounded-2xl border border-border bg-card px-1 py-2 shadow-2xl" data-ajustes="recolhidos">
        <button type="button" onClick={() => onRecolher(false)} aria-label="Abrir os ajustes" className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-muted" title="Motores, formato, qualidade e resolução">
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <span className="mt-1 text-center text-[10px] leading-tight text-muted-foreground">Ajustes</span>
        <span className="mt-2 text-center text-[10.5px] font-semibold leading-tight">{custoCurto}</span>
      </div>
    );
  }
  return (
    <aside aria-label="Ajustes" className="absolute bottom-3 right-3 top-3 z-10 flex w-[300px] max-w-[46%] flex-col rounded-2xl border border-border bg-card shadow-2xl" data-ajustes="abertos">
      <div className="flex shrink-0 items-center border-b border-border px-3 py-2.5">
        <SlidersHorizontal className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12px] font-semibold">{titulo}</h3>
          <p className="truncate text-[11px] text-muted-foreground">{custo}</p>
        </div>
        <button type="button" onClick={() => onRecolher(true)} aria-label="Recolher os ajustes" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  );
}

function ComoFunciona({ onFechar }: { onFechar: () => void }) {
  return (
    <div className="absolute left-1/2 top-3 z-10 w-[420px] max-w-[60%] -translate-x-1/2 rounded-2xl border border-border bg-card p-3 shadow-2xl" data-como-funciona="">
      <div className="mb-1.5 flex items-center">
        <HelpCircle className="mr-1.5 h-3.5 w-3.5 text-primary" />
        <p className="flex-1 text-[12px] font-semibold">Como funciona</p>
        <button type="button" onClick={onFechar} aria-label="Fechar o como funciona" className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ol className="space-y-1 text-[12px] leading-snug text-muted-foreground">
        <li>
          <b className="text-foreground">1.</b> Ponha o que vai na foto pela barra à esquerda: produto, modelo, ambiente, estilo ou um pedido em palavras.
        </li>
        <li>
          <b className="text-foreground">2.</b> Cada cartão já se liga sozinho ao Resultado. Toque num cartão para trocar o que ele leva.
        </li>
        <li>
          <b className="text-foreground">3.</b> No Resultado, toque em Gerar foto. A foto aparece nele e vai para o acervo.
        </li>
      </ol>
    </div>
  );
}

function ModelosProntos({ onAplicar, onFechar, flutuante }: { onAplicar: (chave: string) => void; onFechar?: () => void; flutuante: boolean }) {
  return (
    <div
      className={flutuante ? "absolute bottom-4 left-1/2 z-10 w-[640px] max-w-[70%] -translate-x-1/2 rounded-2xl border border-border bg-card p-3 shadow-2xl" : "min-w-0 rounded-2xl border border-border bg-card p-3"}
      data-modelos-prontos=""
    >
      <div className="mb-2 flex items-center">
        <Wand2 className="mr-1.5 h-3.5 w-3.5 text-primary" />
        <p className="flex-1 text-[12px] font-semibold">Modelos prontos: montam o quadro em 1 clique</p>
        {onFechar && (
          <button type="button" onClick={onFechar} aria-label="Fechar os modelos prontos" className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        {MODELOS_PRONTOS.map((m) => (
          <button key={m.chave} type="button" onClick={() => onAplicar(m.chave)} data-modelo-pronto={m.chave} className="min-w-0 rounded-xl border border-border bg-background p-2.5 text-left transition-colors hover:border-primary/60">
            <span className="mb-1.5 flex items-center">
              {m.cartoes.map((c, i) => {
                const Icone = ICONES[c.tipo];
                return (
                  <span key={`${c.tipo}-${i}`} className={`mr-1 flex h-6 w-6 items-center justify-center rounded-md ${TIPOS_DE_NO[c.tipo].fundo}`}>
                    <Icone className={`h-3 w-3 ${TIPOS_DE_NO[c.tipo].texto}`} />
                  </span>
                );
              })}
            </span>
            <span className="block text-[12.5px] font-semibold leading-snug">{m.rotulo}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{m.dica}</span>
          </button>
        ))}
      </div>
    </div>
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
  cheia,
  onCheia,
}: {
  canvas: Canvas;
  fontes: Fontes;
  selecionado: Selecao;
  onSelecionar: (s: Selecao) => void;
  onAbrir: (id: string) => void;
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void;
  onViewport: (v: ViewportDoQuadro) => void;
  onSoltar: (t: TipoDeNo, pos: { x: number; y: number }) => void;
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

  // Cartão novo: a vista acompanha, para ele não nascer fora da tela.
  const contagem = useRef(canvas.nos.length);
  useEffect(() => {
    const antes = contagem.current;
    contagem.current = canvas.nos.length;
    if (canvas.nos.length <= antes) return;
    const id = window.setTimeout(() => {
      try {
        void rf.fitView({ padding: 0.28, maxZoom: 1, duration: 350 });
      } catch {
        /* quadro ainda sem tamanho */
      }
    }, 60);
    return () => window.clearTimeout(id);
  }, [canvas.nos.length, rf]);

  const nodes = useMemo((): Node[] => {
    return canvas.nos.map((n) => {
      const tamanho = n.tipo === "gerar" ? TAMANHO_DA_SAIDA : TAMANHO_DO_CARTAO;
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
        return {
          ...base,
          data: {
            no: n,
            junta: resumoDoResultado(entradas, (x) => descrever(x, fontes).titulo),
            bloqueios: bloqueiosDoGerar(canvas, n.id, fontes.personas),
            entradas: entradas.length,
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
        const destino = canvas.nos.find((n) => n.id === l.para);
        const cor = origem ? TIPOS_DE_NO[origem.tipo].cor : "hsl(var(--border))";
        const ativa = !!selecionado && selecionado.tipo === "ligacao" && selecionado.id === l.id;
        const gerando = !!destino && (destino.dados.motores || []).some((m) => {
          const a = andamentos[chaveDoAndamento("canvas", destino.id, m)];
          return !!a && a.estado === "gerando";
        });
        return {
          id: l.id,
          source: l.de,
          target: l.para,
          sourceHandle: "saida",
          targetHandle: l.entrada,
          selected: ativa,
          style: { stroke: cor, strokeWidth: ativa ? 3.5 : 2.5 },
          animated: gerando || recentes.indexOf(l.id) >= 0,
        };
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

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    const t = e.dataTransfer ? (e.dataTransfer.getData("application/mesa-foto-no") as TipoDeNo) : ("" as TipoDeNo);
    if (!t || !TIPOS_DE_NO[t]) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onSoltar(t, { x: p.x - TAMANHO_DO_CARTAO.largura / 2, y: p.y - 24 });
  };

  const estilo = {
    "--xy-background-color": "hsl(var(--background))",
    "--xy-controls-button-background-color": "hsl(var(--card))",
    "--xy-controls-button-background-color-hover": "hsl(var(--muted))",
    "--xy-controls-button-color": "hsl(var(--foreground))",
    "--xy-controls-button-color-hover": "hsl(var(--foreground))",
    "--xy-controls-button-border-color": "hsl(var(--border))",
    "--xy-controls-box-shadow": "none",
    "--xy-edge-stroke-default": "hsl(var(--border))",
    "--xy-connectionline-stroke-default": "hsl(var(--primary))",
    "--xy-connectionline-stroke-width-default": 2.5,
    "--xy-handle-border-color": "hsl(var(--card))",
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
          if (c.source && c.target) onMudarCanvas((atual) => ligar(atual, c.source, c.target));
        }}
        isValidConnection={(c) => !!podeLigar(canvas, String(c.source), String(c.target))}
        onPaneClick={() => onSelecionar(null)}
        onMoveEnd={(_e, v) => onViewport(v)}
        defaultViewport={canvas.viewport}
        fitView={!canvas.id && canvas.nos.length > 0}
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.6}
        // Piso Safari 11 / Chrome 64: a caixa de seleção usa Pointer Events (desligada); conexão por toque ligada.
        selectionOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        connectOnClick
        panOnDrag
        zoomOnPinch
        zoomOnScroll
        preventScrolling
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        style={estilo}
      >
        <Background id="fina" variant={BackgroundVariant.Dots} gap={24} size={1.2} color="hsl(var(--border))" />
        <Background id="grossa" variant={BackgroundVariant.Lines} gap={144} lineWidth={1} color="hsl(var(--border) / 0.45)" />
        <Controls showInteractive={false} position="bottom-left">
          <ControlButton onClick={onCheia} title={cheia ? "Sair da tela cheia" : "Tela cheia"} aria-label={cheia ? "Sair da tela cheia" : "Tela cheia"}>
            {/* O CSS do quadro pinta o ícone por dentro; ícone de traço fica sem preenchimento. */}
            {cheia ? <Minimize2 style={{ fill: "none" }} /> : <Maximize2 style={{ fill: "none" }} />}
          </ControlButton>
        </Controls>
      </ReactFlow>
    </div>
  );
}

// ------------------------------------------------------------------ modo lista (celular)

function ModoLista({
  canvas,
  fontes,
  onMudarCanvas,
  garantirSalvo,
  onGerar,
  onPor,
  onEscolher,
}: {
  canvas: Canvas;
  fontes: Fontes;
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void;
  garantirSalvo: () => Promise<Canvas | null>;
  onGerar: (gerarId: string) => Promise<Record<string, never>>;
  onPor: (t: TipoDeNo, gerarId: string | null) => void;
  onEscolher: (t: TipoDeNo, trocarId: string | null, gerarId: string | null) => void;
}) {
  const resultados = canvas.nos.filter((n) => n.tipo === "gerar");
  const [resultadoId, setResultadoId] = useState<string | null>(resultados.length ? resultados[0].id : null);
  const resultado = resultados.find((s) => s.id === resultadoId) || resultados[0] || null;
  const entradas = resultado ? entradasDoGerar(canvas, resultado.id) : [];
  const soltos = canvas.nos.filter((n) => n.tipo !== "gerar" && !canvas.ligacoes.some((l) => l.de === n.id));

  if (!resultado) {
    return (
      <Cartao titulo="Modo lista">
        <p className="mb-2 text-[12px] text-muted-foreground">O canvas não tem Resultado. Ele junta os cartões e gera a foto.</p>
        <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => onPor("gerar", null)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Pôr um Resultado
        </Button>
      </Cartao>
    );
  }

  return (
    <div className="min-w-0 space-y-3" data-modo-lista="">
      {resultados.length > 1 && (
        <Pilulas rotulo="Resultado aberto" opcoes={resultados.map((s, i) => ({ valor: s.id, rotulo: `Resultado ${i + 1}` }))} valor={resultado.id} onEscolher={setResultadoId} />
      )}
      <Cartao titulo="O que vai na foto" dica="Na ordem em que vai ao gerador: produto, modelo, ambiente, estilo e o pedido.">
        {entradas.length === 0 && <p className="mb-2 text-[12px] text-muted-foreground">Nada ainda. Toque num botão abaixo.</p>}
        <ol className="min-w-0 space-y-3">
          {entradas.map((e) => (
            <li key={e.ligacao.id} className="min-w-0 rounded-xl border border-border p-2.5" data-entrada-da-lista={e.no.id}>
              <div className="mb-2 flex min-w-0 items-center">
                <span className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10.5px] font-semibold">{e.numero}</span>
                <span className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${TIPOS_DE_NO[e.no.tipo].texto}`}>{TIPOS_DE_NO[e.no.tipo].rotulo}</span>
                <button type="button" aria-label="Tirar o cartão" onClick={() => onMudarCanvas((c) => removerNo(c, e.no.id))} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <EditorDoCartao no={e.no} fontes={fontes} onMudar={(dados) => onMudarCanvas((c) => mudarDados(c, e.no.id, dados))} onEscolher={() => onEscolher(e.no.tipo, e.no.id, resultado.id)} />
            </li>
          ))}
        </ol>
        {soltos.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{soltos.length} {soltos.length === 1 ? "cartão solto" : "cartões soltos"} no quadro, sem ligação.</p>}
        <div className="mt-3 flex min-w-0 flex-wrap items-center" aria-label="Pôr na foto">
          {TIPOS_DE_ENTRADA.map((t) => {
            const Icone = ICONES[t];
            return (
              <Button key={t} type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-9 text-[12px]" onClick={() => (t === "texto" ? onPor(t, resultado.id) : onEscolher(t, null, resultado.id))}>
                <Icone className={`mr-1 h-3.5 w-3.5 ${TIPOS_DE_NO[t].texto}`} /> {TIPOS_DE_NO[t].rotulo}
              </Button>
            );
          })}
        </div>
      </Cartao>
      <Cartao titulo="Resultado" acao={<span className="text-[11.5px] font-semibold"><CustoDoResultado canvas={canvas} no={resultado} /></span>}>
        <p className="mb-3 text-[12px] leading-snug [overflow-wrap:anywhere]" data-junta="">
          {resumoDoResultado(entradas, (x) => descrever(x, fontes).titulo) || "Junta o que você puser acima. Comece por um produto ou uma modelo."}
        </p>
        <AjustesDoResultado canvas={canvas} no={resultado} fontes={fontes} onMudar={(dados) => onMudarCanvas((c) => mudarDados(c, resultado.id, dados))} garantirSalvo={garantirSalvo} comGerar onGerar={onGerar} />
      </Cartao>
    </div>
  );
}

// ------------------------------------------------------------------ etapa

type EstadoDoSalvar = { estado: "salvo" | "salvando" | "pendente" | "erro" | "conflito"; erro: string };

function lerVisto(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DO_COMO_FUNCIONA) === "1";
  } catch {
    return false;
  }
}

function marcarVisto() {
  try {
    window.localStorage.setItem(CHAVE_DO_COMO_FUNCIONA, "1");
  } catch {
    /* sem armazenamento: volta a aparecer na próxima vez */
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
  const [comoFunciona, setComoFunciona] = useState<boolean>(() => !lerVisto());
  const [prontosAbertos, setProntosAbertos] = useState(false);
  const [cheia, setCheia] = useState(false);
  const [resultadoAtivo, setResultadoAtivo] = useState<string | null>(null);
  const mexeu = useRef(false);
  const salvando = useRef<Promise<Canvas | null> | null>(null);
  const atual = useRef(canvas);
  atual.current = canvas;

  const kits = useKits(clientId);
  const fotos = useFotos(clientId);
  const personasQ = usePersonas(clientId);
  const personas = useMemo(() => personasQ.data || [], [personasQ.data]);
  const ancoras = useAncoras(personas.map((p) => p.ancora_imagem_id || ""));
  const biblioteca = useBiblioteca(clientId, !!escolha || canvas.nos.some((n) => n.tipo === "estilo" || n.tipo === "ambiente"));
  const fontes: Fontes = useMemo(
    () => ({ kits: kits.data || [], fotos: fotos.data || [], personas, ancoras: ancoras.data || [], biblioteca: biblioteca.data || [] }),
    [kits.data, fotos.data, personas, ancoras.data, biblioteca.data],
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

  const garantirSalvo = async () => {
    if (atual.current.id && salvar.estado === "salvo") return atual.current;
    return salvarAgora();
  };

  const gerar = async (gerarId: string): Promise<Record<string, never>> => {
    const salvo = await garantirSalvo();
    if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de gerar.");
    const g = salvo.nos.find((n) => n.id === gerarId) || atual.current.nos.find((n) => n.id === gerarId);
    if (!g) throw new Error("Resultado não encontrado no canvas.");
    void gerarNoResultado({ queryClient, clientId, canvasId: salvo.id, gerarId, motores: g.dados.motores || [], qualidade: g.dados.qualidade || "alta", atualizar: atualizarCusto });
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
    if (tipo === "texto" || tipo === "gerar") {
      if (trocarId) abrirNo(trocarId);
      return;
    }
    setEscolha({ tipo, trocarId, gerarId });
  };

  const aoEscolher = (tipo: AbaDaEscolha, dados: DadosDoNo, trocarId: string | null) => {
    if (trocarId) {
      mudar((c) => mudarDados(c, trocarId, dados));
      return;
    }
    porNoQuadro(tipo, dados, { gerarId: escolha ? escolha.gerarId : null });
  };

  const aoTocarNaPaleta = (t: TipoDeNo) => {
    if (t === "texto") {
      porNoQuadro("texto", { papel: "pedido" }, { selecionar: true });
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
    if (t !== "texto" && t !== "gerar") setEscolha({ tipo: t as AbaDaEscolha, trocarId: id, gerarId: null });
  };

  const tirar = (id: string) => {
    mudar((c) => removerNo(c, id));
    setSelecionado(null);
  };

  const aplicarModelo = (chave: string) => {
    const kitsDoCliente = kitsUsaveis(fontes.kits);
    const prontas = fontes.personas.filter((p) => p.status === "ancora" || p.status === "folha" || p.status === "pronta");
    const preencher = {
      kit_id: kitsDoCliente.length === 1 ? String(kitsDoCliente[0].id) : null,
      modelo_id: prontas.length === 1 ? prontas[0].id : null,
      versao: prontas.length === 1 ? prontas[0].versao : null,
    };
    const antes = atual.current;
    const novo = aplicarModeloPronto(antes, chave, padraoDaSaida, preencher);
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
    const modelo = MODELOS_PRONTOS.find((m) => m.chave === chave);
    toast.success(modelo ? modelo.rotulo : "Modelo pronto no quadro", { description: incompleto ? "Os cartões já estão ligados ao Resultado. Falta escolher o que está em amarelo." : "Tudo ligado. Confira e toque em Gerar foto." });
  };

  const fecharComoFunciona = () => {
    marcarVisto();
    setComoFunciona(false);
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

  const rotuloDoSalvar =
    salvar.estado === "salvo" ? "Salvo" : salvar.estado === "salvando" ? "Salvando" : salvar.estado === "pendente" ? "Alterações não salvas" : salvar.estado === "conflito" ? "Mudou em outra aba" : "Não salvou";

  const valorDoQuadro: ValorDoQuadro = {
    fontes,
    gerar,
    abrirEscolha: (t, id) => abrirEscolha(t, id),
    abrir: abrirNo,
    tirar,
    aplicarModelo,
  };

  let conteudoDoPainel: ReactNode = null;
  let tituloDoPainel: ReactNode = "Ajustes";
  if (ligacaoAberta) {
    tituloDoPainel = "Ligação";
    conteudoDoPainel = (
      <div className="min-w-0 space-y-2">
        <p className="text-[12px] text-muted-foreground">{ROTULOS_DAS_ENTRADAS[ligacaoAberta.entrada]} ligado ao Resultado. Na mesma entrada, a ordem das ligações é a prioridade.</p>
        <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => { mudar((c) => desligar(c, ligacaoAberta.id)); setSelecionado(null); }}>
          <X className="mr-1 h-3.5 w-3.5" /> Desligar
        </Button>
      </div>
    );
  } else if (cartaoDoPainel) {
    const ligado = canvas.ligacoes.some((l) => l.de === cartaoDoPainel.id);
    tituloDoPainel = `Cartão: ${TIPOS_DE_NO[cartaoDoPainel.tipo].rotulo}`;
    conteudoDoPainel = (
      <div className="min-w-0 space-y-3" data-painel-do-cartao={cartaoDoPainel.id}>
        <EditorDoCartao key={cartaoDoPainel.id} no={cartaoDoPainel} fontes={fontes} onMudar={(dados) => mudar((c) => mudarDados(c, cartaoDoPainel.id, dados))} onEscolher={() => abrirEscolha(cartaoDoPainel.tipo, cartaoDoPainel.id)} />
        {!ligado && (
          <Button
            type="button"
            size="sm"
            className="h-8 text-[12px]"
            onClick={() => {
              const alvo = resultadoAlvo(atual.current, resultadoAtivo);
              if (alvo) mudar((c) => ligar(c, cartaoDoPainel.id, alvo));
            }}
          >
            <Workflow className="mr-1.5 h-3.5 w-3.5" /> Ligar ao Resultado
          </Button>
        )}
        <div className="flex min-w-0 flex-wrap items-center border-t border-border pt-3">
          <Button type="button" size="sm" variant="ghost" className="mb-1 mr-1.5 h-8 text-[12px]" onClick={() => setSelecionado(null)}>
            Voltar aos ajustes
          </Button>
          <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px] text-destructive hover:text-destructive" onClick={() => tirar(cartaoDoPainel.id)} aria-label="Tirar o cartão do quadro">
            <Trash2 className="mr-1 h-3 w-3" /> Tirar do quadro
          </Button>
        </div>
      </div>
    );
  } else if (resultadoDoPainel) {
    const resultados = canvas.nos.filter((n) => n.tipo === "gerar");
    tituloDoPainel = resultados.length > 1 ? `Ajustes do Resultado ${resultados.indexOf(resultadoDoPainel) + 1}` : "Ajustes do Resultado";
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
        />
        {resultados.length > 1 && (
          <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px] text-destructive hover:text-destructive" onClick={() => tirar(resultadoDoPainel.id)}>
            <Trash2 className="mr-1 h-3 w-3" /> Tirar este Resultado
          </Button>
        )}
      </div>
    );
  } else {
    conteudoDoPainel = (
      <div className="min-w-0 space-y-2">
        <p className="text-[12px] text-muted-foreground">O quadro está sem Resultado. Ele junta os cartões e gera a foto.</p>
        <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => porNoQuadro("gerar")}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Pôr um Resultado
        </Button>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2" data-canvas-aberto={canvas.id || "novo"}>
      <div className="flex min-w-0 flex-wrap items-center" data-barra-do-canvas="">
        {seletor}
        <Input value={canvas.nome} onChange={(e) => mudar((c) => ({ ...c, nome: e.target.value }))} aria-label="Nome do canvas" className="mb-1.5 mr-2 h-9 w-full min-w-0 text-[13px] font-semibold sm:w-56" />
        <span className={`mb-1.5 mr-2 inline-flex items-center text-[11.5px] ${salvar.estado === "erro" || salvar.estado === "conflito" ? "text-warning" : "text-muted-foreground"}`} role="status" data-estado-do-salvar={salvar.estado} title={salvar.erro || undefined}>
          {salvar.estado === "salvando" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : salvar.estado === "salvo" ? <Check className="mr-1 h-3 w-3" /> : null}
          {rotuloDoSalvar}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mb-1.5 mr-1.5 h-8 text-[12px]"
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
        <Button type="button" size="sm" variant={prontosAbertos ? "default" : "outline"} className="mb-1.5 mr-1.5 h-8 text-[12px]" aria-pressed={prontosAbertos} onClick={() => setProntosAbertos(!prontosAbertos)}>
          <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Modelos prontos
        </Button>
        <Button type="button" size="sm" variant={comoFunciona ? "default" : "outline"} className="mb-1.5 mr-1.5 h-8 text-[12px]" aria-pressed={comoFunciona} onClick={() => (comoFunciona ? fecharComoFunciona() : setComoFunciona(true))}>
          <HelpCircle className="mr-1.5 h-3.5 w-3.5" /> Como funciona
        </Button>
        <Button type="button" size="sm" variant={lista ? "default" : "outline"} className="mb-1.5 h-8 text-[12px]" aria-pressed={lista} onClick={() => setLista(!lista)}>
          {lista ? <Workflow className="mr-1.5 h-3.5 w-3.5" /> : <LayoutList className="mr-1.5 h-3.5 w-3.5" />}
          {lista ? "Ver o quadro" : "Modo lista"}
        </Button>
      </div>
      {salvar.estado === "erro" && <AvisoDeErro erro={new Error(`O canvas não foi salvo: ${salvar.erro}`)} />}

      {lista ? (
        <div className="min-w-0 space-y-3">
          {comoFunciona && (
            <div className="relative min-w-0" style={{ minHeight: 132 }}>
              <ComoFunciona onFechar={fecharComoFunciona} />
            </div>
          )}
          {(prontosAbertos || semEntradas) && <ModelosProntos onAplicar={aplicarModelo} onFechar={prontosAbertos ? () => setProntosAbertos(false) : undefined} flutuante={false} />}
          <ModoLista
            canvas={canvas}
            fontes={fontes}
            onMudarCanvas={mudar}
            garantirSalvo={garantirSalvo}
            onGerar={gerar}
            onPor={(t, gerarId) => {
              porNoQuadro(t, t === "texto" ? { papel: "pedido" } : {}, { gerarId });
            }}
            onEscolher={(t, trocarId, gerarId) => abrirEscolha(t, trocarId, gerarId)}
          />
        </div>
      ) : (
        <div
          className={`min-w-0 overflow-hidden rounded-2xl border border-border bg-background ${cheia ? "fixed bottom-2 left-2 right-2 top-2 z-50" : "relative w-full"}`}
          style={cheia ? undefined : { height: "calc(100vh - 150px)", minHeight: 560 }}
          data-quadro=""
          data-tela-cheia={cheia ? "sim" : "nao"}
        >
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
              cheia={cheia}
              onCheia={alternarCheia}
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
          {comoFunciona && <ComoFunciona onFechar={fecharComoFunciona} />}
          {prontosAbertos && <ModelosProntos onAplicar={aplicarModelo} onFechar={() => setProntosAbertos(false)} flutuante />}
        </div>
      )}
      <p className="flex items-start text-[11px] leading-snug text-muted-foreground">
        <ClipboardList className="mr-1 mt-0.5 h-3 w-3 shrink-0" /> Tudo o que o Canvas gera vai para o acervo como gerado, passa por aprovar e segue para a Mesa e para Usar como as outras fotos.
      </p>
      <EscolherCartao pedido={escolha} fontes={fontes} onFechar={() => setEscolha(null)} onEscolher={aoEscolher} />
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
        <SelectTrigger className="mb-1.5 mr-1.5 h-9 w-full min-w-0 text-[12.5px] sm:w-56" aria-label="Canvas aberto">
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
      <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-2 h-9 text-[12.5px]" onClick={() => trocar(canvasVazio(clientId))}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Novo canvas
      </Button>
    </>
  );

  return (
    <ReactFlowProvider>
      <div className="dark min-w-0 rounded-2xl border border-border bg-background p-2 pb-16 text-foreground sm:p-3 sm:pb-16" data-canvas-escuro="">
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
