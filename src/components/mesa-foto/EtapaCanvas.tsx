import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
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
import { toast } from "sonner";
import {
  Box,
  Check,
  ClipboardList,
  Eye,
  LayoutList,
  Loader2,
  MapPin,
  Palette,
  Plus,
  Save,
  ScanSearch,
  Sparkles,
  Trash2,
  Type,
  UserRound,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeQualidade } from "@/components/mesa/Seletores";
import { ErroDaMesa, padraoPara, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { AprovarFoto, BotoesDeUso } from "./AcoesDeUso";
import { Cartao, Moldura, Pilulas, useMesaFoto } from "./Comuns";
import { ImagemDaBiblioteca } from "./EtapaBiblioteca";
import SeletorDeFotos from "./SeletorDeFotos";
import { acrescentarFotos, FORMATOS, invalidarFotos, partesDaConferencia, rotuloDoTipo, useBiblioteca, useFotos, useKits, type FotoDoAcervo, type ItemDaBiblioteca, type KitDeFoto } from "./fotoApi";
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
} from "./modelosApi";
import {
  aplicarModeloPronto,
  apagarRascunho,
  avisosDoGerar,
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
  removerNo,
  ROTULOS_DAS_ENTRADAS,
  salvarCanvas,
  TAMANHO_DA_SAIDA,
  TAMANHO_DO_CARTAO,
  TIPOS_DA_PALETA,
  TIPOS_DE_NO,
  useCanvases,
  type Canvas,
  type Entrada,
  type Montagem,
  type NoDoCanvas,
  type ResultadoDoCanvas,
  type TipoDeNo,
} from "./canvasApi";

/**
 * Canvas (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 7 e 9.2): o dono põe
 * cartões no quadro (Produto do kit, Modelo, Ambiente, Estilo, Prompt e a
 * Saída), liga com as linhas e gera tudo junto. "Montar" mostra o pedido
 * exatamente como vai ao gerador (prompt e referências na ordem) e o custo;
 * "Gerar" dispara uma chamada por motor ligado. Os resultados aparecem na
 * Saída e seguem a revisão e o uso normais (acervo, aprovar, Usar).
 *
 * React Flow (@xyflow/react) só neste arquivo, carregado quando a aba abre.
 * Piso do painel (Safari 11 / Chrome 64): caixa de seleção desligada (usa
 * Pointer Events), conexão por toque (tocar uma alça e depois a outra),
 * cartões de tamanho fixo com as alças declaradas no próprio nó (nada
 * depende de medir depois de montar), miniaturas com altura fixa em px. No
 * celular há o modo lista, com o mesmo grafo em formulário.
 */

const ALCA = 14;
const TOPO_DAS_ENTRADAS = 46;
const PASSO_DAS_ENTRADAS = 28;
const ATRASO_DO_SALVAR_MS = 1500;
const FORMATOS_DO_CANVAS = FORMATOS.filter((f) => ["1:1", "4:5", "9:16", "16:9"].indexOf(f.valor) >= 0).map((f) => ({ valor: f.valor, rotulo: f.valor }));

const ICONES: Record<TipoDeNo, typeof Box> = { produto: Box, modelo: UserRound, ambiente: MapPin, estilo: Palette, texto: Type, gerar: Sparkles };

// ------------------------------------------------------------------ resultados que chegam fora da tela

/**
 * Resultado que chegou depois de a tela sair (trocou de aba no meio da
 * geração): fica aqui até o canvas abrir de novo e juntar na Saída.
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

async function gerarNaSaida(p: {
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
      // O formato vai na Saída salva (a função lê de lá); aqui só o motor desta chamada e a qualidade.
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
  if (feitas) toast.success(`${feitas} ${feitas === 1 ? "imagem pronta" : "imagens prontas"} na Saída`, { description: `Custo real: ${usd(custo)}. Elas já estão no acervo, marcadas como geradas.` });
  if (falhas) toast.error(`${falhas} ${falhas === 1 ? "motor falhou" : "motores falharam"}`, { description: "O erro está na Saída, ao lado do motor." });
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

function descrever(no: NoDoCanvas, f: Fontes): Descricao {
  const d = no.dados;
  const foto = (id?: string | null) => (id ? f.fotos.find((x) => x.id === id) || null : null);
  const daFoto = (x: FotoDoAcervo | null): Miniatura | null => (x ? { caminho: x.storage_path, bucket: x.storage_bucket || "mesa" } : null);
  const falta = faltaNoCartao(no);
  if (no.tipo === "produto") {
    const k = f.kits.find((x) => x.id === d.kit_id) || null;
    const capa = k ? foto(k.frente_imagem_id || (k.refs[0] && k.refs[0].imagem_id)) : null;
    return { titulo: k ? k.nome : "Produto", subtitulo: k ? `${rotuloDoTipo(k.tipo)}${k.variante ? ` · ${k.variante}` : ""}` : falta, miniatura: daFoto(capa) };
  }
  if (no.tipo === "modelo") {
    const p = f.personas.find((x) => x.id === d.modelo_id) || null;
    const a = p && p.ancora_imagem_id ? f.ancoras.find((x) => x.id === p.ancora_imagem_id) || null : null;
    return {
      titulo: p ? p.nome : "Modelo",
      subtitulo: p ? STATUS_DA_PERSONA[p.status].rotulo : falta,
      miniatura: a ? { caminho: a.storage_path || a.url, bucket: a.storage_bucket || "mesa" } : null,
    };
  }
  if (no.tipo === "ambiente" || no.tipo === "estilo") {
    const x = foto(d.imagem_id);
    const item = d.biblioteca_id ? f.biblioteca.find((i) => i.id === d.biblioteca_id) || null : null;
    const t = (d.texto || "").trim();
    return {
      titulo: item ? item.titulo : x ? x.nome : t ? t.slice(0, 40) : TIPOS_DE_NO[no.tipo].rotulo,
      subtitulo: falta || (no.tipo === "estilo" ? "só paleta, luz e enquadramento" : "lugar, luz e clima"),
      miniatura: item ? { caminho: "", bucket: "mesa", item } : daFoto(x),
    };
  }
  if (no.tipo === "texto") {
    const t = (d.texto || "").trim();
    return { titulo: t ? t.slice(0, 60) : "Prompt", subtitulo: falta || (d.papel === "restricao" ? "restrição" : "pedido"), miniatura: null };
  }
  return { titulo: "Saída", subtitulo: "", miniatura: null };
}

// ------------------------------------------------------------------ nós do quadro

interface DadosDoCartao extends Record<string, unknown> {
  no: NoDoCanvas;
  descricao: Descricao;
  numero: number | null;
}

interface DadosDaSaida extends Record<string, unknown> {
  no: NoDoCanvas;
  contagem: Record<Entrada, number>;
  resultados: ResultadoDoCanvas[];
  gerando: number;
  motores: string[];
}

type NoDeCartao = Node<DadosDoCartao>;
type NoDeSaida = Node<DadosDaSaida>;

function MiniaturaDoCartao({ m, tamanho }: { m: Miniatura | null; tamanho: number }) {
  const caixa: CSSProperties = { width: tamanho, height: tamanho };
  if (!m) return <span className="block shrink-0 rounded-lg bg-muted" style={caixa} />;
  return (
    <span className="relative block shrink-0 overflow-hidden rounded-lg bg-muted" style={caixa}>
      {m.item ? <ImagemDaBiblioteca item={m.item} /> : <MiniaturaDoStorage bucket={m.bucket} caminho={m.caminho} alt="" largura={160} className="h-full w-full" />}
    </span>
  );
}

function NoCartao({ data, selected }: NodeProps<NoDeCartao>) {
  const { no, descricao, numero } = data;
  const tipo = TIPOS_DE_NO[no.tipo];
  const Icone = ICONES[no.tipo];
  const falta = faltaNoCartao(no);
  return (
    <div
      style={{ width: TAMANHO_DO_CARTAO.largura, height: TAMANHO_DO_CARTAO.altura }}
      className={`relative overflow-visible rounded-xl border bg-card text-left shadow-sm ${tipo.borda} ${selected ? "ring-2 ring-primary" : ""}`}
      data-no-do-canvas={no.id}
      data-tipo={no.tipo}
    >
      <div className={`flex items-center rounded-t-xl px-2.5 py-1.5 ${tipo.fundo}`}>
        <Icone className={`mr-1.5 h-3.5 w-3.5 ${tipo.texto}`} />
        <span className={`flex-1 text-[10.5px] font-semibold uppercase tracking-wider ${tipo.texto}`}>{tipo.rotulo}</span>
        {numero !== null && <span className="rounded-full bg-card px-1.5 text-[10px] font-semibold text-foreground">{numero}</span>}
      </div>
      <div className="flex p-2.5">
        {no.tipo !== "texto" && <MiniaturaDoCartao m={descricao.miniatura} tamanho={64} />}
        <div className={`min-w-0 flex-1 ${no.tipo !== "texto" ? "ml-2.5" : ""}`}>
          <p className="line-clamp-2 text-[12px] font-semibold leading-snug [overflow-wrap:anywhere]">{descricao.titulo}</p>
          <p className={`mt-0.5 truncate text-[10.5px] ${falta ? "text-warning" : "text-muted-foreground"}`}>{descricao.subtitulo}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="saida" style={{ width: ALCA, height: ALCA, background: tipo.cor, border: "2px solid hsl(var(--card))" }} />
    </div>
  );
}

function NoSaida({ data, selected }: NodeProps<NoDeSaida>) {
  const { no, contagem, resultados, gerando, motores } = data;
  const prontos = resultados.filter((r) => r.status === "gerada" && (r.storage_path || r.url));
  return (
    <div
      style={{ width: TAMANHO_DA_SAIDA.largura, height: TAMANHO_DA_SAIDA.altura }}
      className={`relative overflow-visible rounded-xl border-2 border-foreground/30 bg-card shadow-md ${selected ? "ring-2 ring-primary" : ""}`}
      data-no-do-canvas={no.id}
      data-tipo="gerar"
    >
      <div className="flex items-center rounded-t-xl border-b border-border px-2.5 py-1.5">
        <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />
        <span className="flex-1 text-[10.5px] font-semibold uppercase tracking-wider">Saída</span>
        {gerando > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-label="Gerando" />}
      </div>
      {ORDEM_DAS_ENTRADAS.map((e, i) => {
        const y = TOPO_DAS_ENTRADAS + i * PASSO_DAS_ENTRADAS;
        const cor = TIPOS_DE_NO[e === "pessoa" ? "modelo" : (e as TipoDeNo)].cor;
        return (
          <div key={e}>
            <Handle type="target" position={Position.Left} id={e} style={{ top: y, width: ALCA, height: ALCA, background: cor, border: "2px solid hsl(var(--card))" }} />
            <span className="absolute left-3 text-[10.5px] text-muted-foreground" style={{ top: y - 8 }}>
              {ROTULOS_DAS_ENTRADAS[e]}
              {contagem[e] ? <b className="ml-1 text-foreground">{contagem[e]}</b> : null}
            </span>
          </div>
        );
      })}
      <div className="absolute right-2.5 top-10" style={{ width: 116 }}>
        <div className="flex flex-wrap">
          {prontos.slice(-4).map((r) => (
            <span key={r.geracao_id} className="relative mb-1 mr-1 block overflow-hidden rounded-md bg-muted" style={{ width: 54, height: 54 }}>
              <MiniaturaDoStorage bucket={r.storage_bucket} caminho={r.storage_path || r.url} alt="Resultado" largura={160} className="h-full w-full" />
            </span>
          ))}
          {!prontos.length && <span className="block rounded-md border border-dashed border-border px-1.5 py-3 text-center text-[10px] text-muted-foreground" style={{ width: 112 }}>Os resultados aparecem aqui</span>}
        </div>
      </div>
      <p className="absolute bottom-2 left-3 right-3 truncate text-[10.5px] text-muted-foreground">
        {motores.length} {motores.length === 1 ? "motor" : "motores"} · {String(no.dados.formato || "4:5")} · {prontos.length} {prontos.length === 1 ? "resultado" : "resultados"}
      </p>
    </div>
  );
}

const TIPOS_NO_QUADRO = { produto: NoCartao, modelo: NoCartao, ambiente: NoCartao, estilo: NoCartao, texto: NoCartao, gerar: NoSaida };

/** Alças declaradas no próprio nó: as linhas não dependem de medir o cartão depois de montar. */
function alcasDoNo(tipo: TipoDeNo) {
  if (tipo === "gerar") {
    return ORDEM_DAS_ENTRADAS.map((e, i) => ({ id: e, type: "target" as const, position: Position.Left, x: -ALCA / 2, y: TOPO_DAS_ENTRADAS + i * PASSO_DAS_ENTRADAS - ALCA / 2, width: ALCA, height: ALCA }));
  }
  return [{ id: "saida", type: "source" as const, position: Position.Right, x: TAMANHO_DO_CARTAO.largura - ALCA / 2, y: TAMANHO_DO_CARTAO.altura / 2 - ALCA / 2, width: ALCA, height: ALCA }];
}

// ------------------------------------------------------------------ editores (quadro e modo lista)

function EditorDoCartao({ no, fontes, onMudar }: { no: NoDoCanvas; fontes: Fontes; onMudar: (dados: Partial<NoDoCanvas["dados"]>) => void }) {
  const [escolhendoFoto, setEscolhendoFoto] = useState(false);
  const d = no.dados;
  if (no.tipo === "produto") {
    return (
      <div className="min-w-0">
        <Select value={d.kit_id || ""} onValueChange={(v) => onMudar({ kit_id: v })}>
          <SelectTrigger className="h-9 min-w-0 text-[12.5px]" aria-label="Produto do cartão">
            <SelectValue placeholder={fontes.kits.length ? "Escolha o produto" : "Nenhum produto (kit) ainda"} />
          </SelectTrigger>
          <SelectContent>
            {fontes.kits.map((k) => (
              <SelectItem key={String(k.id)} value={String(k.id)}>
                {k.nome} · {rotuloDoTipo(k.tipo)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Vão as fotos de identidade do kit, na ordem de prioridade. O produto não muda.</p>
      </div>
    );
  }
  if (no.tipo === "modelo") {
    const usaveis = fontes.personas.filter((p) => p.status !== "arquivada");
    return (
      <div className="min-w-0">
        <Select value={d.modelo_id || ""} onValueChange={(v) => onMudar({ modelo_id: v, versao: (fontes.personas.find((p) => p.id === v) || { versao: 1 }).versao })}>
          <SelectTrigger className="h-9 min-w-0 text-[12.5px]" aria-label="Persona do cartão">
            <SelectValue placeholder={usaveis.length ? "Escolha a persona" : "Nenhuma persona ainda (aba Modelos)"} />
          </SelectTrigger>
          <SelectContent>
            {usaveis.map((p) => (
              <SelectItem key={p.id} value={p.id} disabled={p.status === "rascunho" || p.status === "candidatos"}>
                {p.nome} · {STATUS_DA_PERSONA[p.status].rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Só persona com âncora escolhida. Vão a âncora e as vistas mais próximas do ângulo.</p>
      </div>
    );
  }
  if (no.tipo === "ambiente" || no.tipo === "estilo") {
    const foto = d.imagem_id ? fontes.fotos.find((x) => x.id === d.imagem_id) || null : null;
    const referencias = fontes.biblioteca.filter((i) => i.tipo === "referencia");
    return (
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center">
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8 text-[12px]" onClick={() => setEscolhendoFoto(true)}>
            {foto ? "Trocar foto do acervo" : "Foto do acervo"}
          </Button>
          {(d.imagem_id || d.biblioteca_id) && (
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" onClick={() => onMudar({ imagem_id: null, biblioteca_id: null })}>
              Tirar a imagem
            </Button>
          )}
        </div>
        {escolhendoFoto && (
          <SeletorDeFotos
            fotos={fontes.fotos}
            multiplas={false}
            titulo={no.tipo === "ambiente" ? "Foto do ambiente" : "Referência de estilo"}
            onUsar={(ids) => {
              onMudar({ imagem_id: ids[0] || null, biblioteca_id: null });
              setEscolhendoFoto(false);
            }}
            onFechar={() => setEscolhendoFoto(false)}
          />
        )}
        {no.tipo === "estilo" && referencias.length > 0 && (
          <div className="grid max-h-44 min-w-0 grid-cols-4 gap-1.5 overflow-y-auto" aria-label="Referências da biblioteca">
            {referencias.slice(0, 40).map((i) => (
              <button
                key={i.id}
                type="button"
                aria-pressed={d.biblioteca_id === i.id}
                aria-label={`Referência ${i.titulo}`}
                onClick={() => onMudar({ biblioteca_id: i.id, imagem_id: null })}
                className={`relative min-w-0 rounded-lg border p-0.5 ${d.biblioteca_id === i.id ? "border-primary" : "border-transparent hover:border-border"}`}
              >
                <Moldura proporcao={1}>
                  <ImagemDaBiblioteca item={i} />
                </Moldura>
              </button>
            ))}
          </div>
        )}
        <Textarea
          value={d.texto || ""}
          onChange={(e) => onMudar({ texto: e.target.value })}
          rows={2}
          placeholder={no.tipo === "ambiente" ? "Ou descreva: praia no fim de tarde, mesa de madeira clara..." : "Ou descreva a pegada: céu azul, luz de estúdio fria..."}
          aria-label={no.tipo === "ambiente" ? "Descrição do ambiente" : "Descrição do estilo"}
          className="text-[12.5px]"
        />
        <p className="text-[11px] text-muted-foreground">{no.tipo === "ambiente" ? "O gerador usa lugar, luz e clima; pessoas da foto não são copiadas." : "Só paleta, luz e enquadramento. Nunca vira identidade."}</p>
      </div>
    );
  }
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
        <Textarea value={d.texto || ""} onChange={(e) => onMudar({ texto: e.target.value })} rows={4} placeholder="Ex.: ela usando o óculos, sorrindo de leve, luz de fim de tarde" aria-label="Texto do prompt" className="text-[12.5px]" />
      </div>
    );
  }
  return null;
}

function Resultado({ r, foto, onConferencia }: { r: ResultadoDoCanvas; foto: FotoDoAcervo | null; onConferencia: (c: ConferenciaDaPersona | null) => void }) {
  const { catalogo } = useMesa();
  const { irPara } = useMesaFoto();
  const [ampliada, setAmpliada] = useState(false);
  const caminho = r.storage_path || r.url;
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background p-2.5" data-resultado={r.geracao_id}>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" className="block min-w-0 cursor-zoom-in" onClick={() => setAmpliada(true)} aria-label="Ver grande">
          <Moldura proporcao={foto && foto.largura && foto.altura ? foto.largura / foto.altura : 0.8} className="border border-border">
            <ImagemDaMesa caminho={caminho} bucket={r.storage_bucket} alt="Resultado do Canvas" className="h-full w-full !object-contain" />
            <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary" data-selo="gerada">
              <Sparkles className="mr-0.5 h-2.5 w-2.5" /> gerada
            </span>
          </Moldura>
        </button>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold">{rotuloDoMotor(catalogo, r.motor_id)}</p>
          <p className="text-[11px] text-muted-foreground">{r.custo_usd ? `${usd(r.custo_usd)} · ` : ""}no acervo, marcada como gerada</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            {foto && <AprovarFoto foto={foto} />}
            <BotaoComCusto
              rotulo={
                <>
                  <ScanSearch className="mr-1 h-3.5 w-3.5" /> Conferir
                </>
              }
              titulo="Conferência pronta"
              descricao="A visão compara com o produto (formato, cor, logo) e com a âncora da persona. Só aviso."
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
          {foto && <BotoesDeUso fotos={[foto]} compacto />}
          {r.conferencia && (
            <div className="mt-2 rounded-md border border-border p-2 text-[11px] leading-snug" data-conferencia="">
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
        </div>
      </div>
      <Ampliar imagens={[{ caminho, bucket: r.storage_bucket, titulo: "Resultado do Canvas (gerada)", legenda: "Imagem gerada por IA" }]} indice={ampliada ? 0 : null} onFechar={() => setAmpliada(false)} />
    </div>
  );
}

function PedidoMontado({ m, fotos, onFechar }: { m: Montagem; fotos: FotoDoAcervo[]; onFechar: () => void }) {
  return (
    <div className="min-w-0 rounded-xl border border-primary/40 bg-card p-3" data-pedido-montado="">
      <div className="mb-2 flex min-w-0 items-center">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold">O que vai para o gerador</p>
        {m.estimativa_usd !== null && <span className="mr-2 text-[11.5px] text-muted-foreground">~{usd(m.estimativa_usd)} por motor</span>}
        <button type="button" onClick={onFechar} aria-label="Fechar o pedido" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      {m.referencias.length > 0 && (
        <ol className="mb-2 flex min-w-0 flex-wrap" aria-label="Referências na ordem">
          {m.referencias.map((r) => {
            const f = r.imagem_id ? fotos.find((x) => x.id === r.imagem_id) || null : null;
            const caminho = r.storage_path || (f ? f.storage_path : "") || r.url;
            return (
              <li key={`${r.ordem}-${r.imagem_id || r.origem_id}`} className="mb-1.5 mr-1.5 w-16" title={r.legenda || r.papel}>
                <span className="relative block overflow-hidden rounded-lg bg-muted" style={{ width: 64, height: 64 }}>
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
      <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-[11.5px] leading-relaxed [overflow-wrap:anywhere]">{m.prompt || "A função não devolveu o prompt."}</pre>
    </div>
  );
}

function EditorDaSaida({
  canvas,
  no,
  fontes,
  onMudar,
  garantirSalvo,
}: {
  canvas: Canvas;
  no: NoDoCanvas;
  fontes: Fontes;
  onMudar: (dados: Partial<NoDoCanvas["dados"]>) => void;
  garantirSalvo: () => Promise<Canvas | null>;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
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
      if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de montar o pedido.");
      setMontagem(await montarCanvas({ canvasId: salvo.id, gerarId: no.id, motorId: motores[0], qualidade }));
    } catch (e) {
      avisarErro(e, "Pedido não montado");
    } finally {
      setMontando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-3" data-editor-da-saida={no.id}>
      <div className="min-w-0">
        <p className="mb-1 text-[11.5px] text-muted-foreground">Entradas na ordem em que vão ao gerador</p>
        {entradas.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nenhum cartão ligado. Ligue um produto ou uma persona a esta Saída.</p>
        ) : (
          <ol className="min-w-0 space-y-1" aria-label="Entradas da Saída">
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
      <div className="min-w-0">
        <p className="mb-1 text-[11.5px] text-muted-foreground">Motores (uma imagem por motor)</p>
        <div className="flex min-w-0 flex-wrap" role="group" aria-label="Motores da Saída">
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
                className={`mb-1.5 mr-1.5 inline-flex h-7 max-w-full items-center truncate rounded-full border px-2.5 text-[12px] ${ligado ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground"}`}
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
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] text-muted-foreground">Formato</p>
          <Pilulas rotulo="Formato da Saída" opcoes={FORMATOS_DO_CANVAS} valor={formato} onEscolher={(v) => onMudar({ formato: v })} />
        </div>
        <SeletorDeQualidade valor={qualidade} onChange={(q) => onMudar({ qualidade: q })} />
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
        <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-9 text-[12.5px]" disabled={montando || !motores.length || entradas.length === 0} onClick={() => void montar()}>
          {montando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />} Montar
        </Button>
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {motores.length > 1 ? `em ${motores.length} motores` : ""}
            </>
          }
          titulo="Geração do Canvas"
          descricao="Uma imagem por motor ligado. O que sair entra no acervo, marcado como gerado, e aparece na Saída."
          className="mb-1.5 h-9 text-[12.5px]"
          disabled={bloqueios.length > 0 || gerando}
          fecharAoConfirmar
          partes={() => partesDoGerar(motores, qualidade, entradas.length)}
          executar={async () => {
            const salvo = await garantirSalvo();
            if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de gerar.");
            void gerarNaSaida({ queryClient, clientId, canvasId: salvo.id, gerarId: no.id, motores, qualidade, atualizar: atualizarCusto });
            return {};
          }}
        />
      </div>
      {montagem && <PedidoMontado m={montagem} fotos={fontes.fotos} onFechar={() => setMontagem(null)} />}
      {resultados.length > 0 && (
        <div className="min-w-0 space-y-2">
          <p className="text-[11.5px] text-muted-foreground">Resultados ({resultados.length})</p>
          {resultados.slice(0, 8).map((r) =>
            r.status === "falhou" ? (
              <p key={r.geracao_id} className="text-[11.5px] text-destructive">
                {rotuloDoMotor(catalogo, r.motor_id)}: {r.erro || "falhou"}
              </p>
            ) : (
              <Resultado
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

// ------------------------------------------------------------------ paleta

function Paleta({ onAdicionar, horizontal }: { onAdicionar: (t: TipoDeNo) => void; horizontal: boolean }) {
  return (
    <ul className={horizontal ? "flex min-w-0 flex-wrap" : "min-w-0 space-y-1.5"} aria-label="Cartões para o quadro">
      {TIPOS_DA_PALETA.map((t) => {
        const tipo = TIPOS_DE_NO[t];
        const Icone = ICONES[t];
        return (
          <li key={t} className={horizontal ? "mb-1.5 mr-1.5" : ""}>
            <button
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
              onClick={() => onAdicionar(t)}
              title={`${tipo.dica} Toque para pôr no quadro${horizontal ? "" : " ou arraste"}.`}
              data-paleta={t}
              className={`flex min-w-0 items-center rounded-lg border bg-card text-left transition-colors hover:border-primary/50 ${tipo.borda} ${horizontal ? "h-8 px-2.5" : "w-full px-2.5 py-2"}`}
            >
              <span className={`mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tipo.fundo}`}>
                <Icone className={`h-3.5 w-3.5 ${tipo.texto}`} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium">{tipo.rotulo}</span>
                {!horizontal && <span className="block truncate text-[10.5px] text-muted-foreground">{t === "gerar" ? "junta e gera" : t === "texto" ? "o pedido em palavras" : "arraste ou toque"}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ quadro

function Quadro({
  canvas,
  fontes,
  selecionado,
  onSelecionar,
  onMudarCanvas,
  onViewport,
  adicionarRef,
}: {
  canvas: Canvas;
  fontes: Fontes;
  selecionado: { tipo: "no" | "ligacao"; id: string } | null;
  onSelecionar: (s: { tipo: "no" | "ligacao"; id: string } | null) => void;
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void;
  onViewport: (v: ViewportDoQuadro) => void;
  adicionarRef: { current: ((t: TipoDeNo, pos?: { x: number; y: number }) => void) | null };
}) {
  const rf = useReactFlow();
  const caixa = useRef<HTMLDivElement>(null);
  const andamentos = useAndamentos();
  const deslocamento = useRef(0);

  // Adicionar (toque na paleta): no centro da vista, com um passo para não empilhar.
  adicionarRef.current = (t, pos) => {
    let p = pos;
    if (!p) {
      const r = caixa.current ? caixa.current.getBoundingClientRect() : null;
      const centro = r && r.width ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
      deslocamento.current = (deslocamento.current + 1) % 6;
      p = { x: centro.x - TAMANHO_DO_CARTAO.largura / 2 + deslocamento.current * 18, y: centro.y - TAMANHO_DO_CARTAO.altura / 2 + deslocamento.current * 18 };
    }
    adicionarNo(onMudarCanvas, onSelecionar, t, p);
  };

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
        const contagem = { produto: 0, pessoa: 0, ambiente: 0, estilo: 0, texto: 0 } as Record<Entrada, number>;
        canvas.ligacoes.forEach((l) => {
          if (l.para === n.id) contagem[l.entrada]++;
        });
        const motores = n.dados.motores || [];
        const gerando = motores.filter((m) => {
          const a = andamentos[chaveDoAndamento("canvas", n.id, m)];
          return !!a && a.estado === "gerando";
        }).length;
        return { ...base, data: { no: n, contagem, resultados: n.dados.resultados || [], gerando, motores } as DadosDaSaida };
      }
      const ligacao = canvas.ligacoes.find((l) => l.de === n.id);
      const numero = ligacao ? (entradasDoGerar(canvas, ligacao.para).find((e) => e.ligacao.id === ligacao.id) || { numero: null }).numero : null;
      return { ...base, data: { no: n, descricao: descrever(n, fontes), numero } as DadosDoCartao };
    });
  }, [canvas, fontes, selecionado, andamentos]);

  const edges = useMemo(
    (): Edge[] =>
      canvas.ligacoes.map((l) => {
        const origem = canvas.nos.find((n) => n.id === l.de);
        const cor = origem ? TIPOS_DE_NO[origem.tipo].cor : "hsl(var(--border))";
        const ativa = !!selecionado && selecionado.tipo === "ligacao" && selecionado.id === l.id;
        return {
          id: l.id,
          source: l.de,
          target: l.para,
          sourceHandle: "saida",
          targetHandle: l.entrada,
          selected: ativa,
          style: { stroke: cor, strokeWidth: ativa ? 3.5 : 2.25 },
          animated: false,
        };
      }),
    [canvas, selecionado],
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
    if (adicionarRef.current) adicionarRef.current(t, { x: p.x - TAMANHO_DO_CARTAO.largura / 2, y: p.y - 24 });
  };

  const estilo = {
    "--xy-background-color": "transparent",
    "--xy-background-pattern-dots-color-default": "hsl(var(--border))",
    "--xy-controls-button-background-color": "hsl(var(--card))",
    "--xy-controls-button-background-color-hover": "hsl(var(--muted))",
    "--xy-controls-button-color": "hsl(var(--foreground))",
    "--xy-controls-button-border-color": "hsl(var(--border))",
    "--xy-edge-stroke-default": "hsl(var(--border))",
    "--xy-connectionline-stroke-default": "hsl(var(--primary))",
  } as CSSProperties;

  return (
    <div
      ref={caixa}
      className="relative h-[62vh] min-h-[420px] w-full min-w-0 overflow-hidden rounded-xl border border-border bg-background"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={soltar}
      data-quadro=""
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={TIPOS_NO_QUADRO}
        onNodesChange={aoMudarNos}
        onEdgesChange={aoMudarLigacoes}
        onConnect={(c: Connection) => {
          if (c.source && c.target) onMudarCanvas((atual) => ligar(atual, c.source, c.target));
        }}
        isValidConnection={(c) => !!podeLigar(canvas, String(c.source), String(c.target))}
        onPaneClick={() => onSelecionar(null)}
        onMoveEnd={(_e, v) => onViewport(v)}
        defaultViewport={canvas.viewport}
        fitView={!canvas.id && canvas.nos.length > 0}
        minZoom={0.3}
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
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      {canvas.nos.length <= 1 && (
        <p className="pointer-events-none absolute left-1/2 top-3 w-[88%] -translate-x-1/2 rounded-full border border-border bg-card px-3 py-1 text-center text-[11.5px] text-muted-foreground">
          Toque num cartão da paleta para pôr no quadro. Para ligar, toque na bolinha do cartão e depois na entrada da Saída.
        </p>
      )}
    </div>
  );
}

/** Cria o cartão; se só existe uma Saída, já liga a ela (dá para desligar). */
function adicionarNo(
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void,
  onSelecionar: (s: { tipo: "no" | "ligacao"; id: string } | null) => void,
  t: TipoDeNo,
  p: { x: number; y: number },
  dados: NoDoCanvas["dados"] = {},
  motorPadrao: string | null = null,
) {
  const no = novoNo(t, p.x, p.y, t === "gerar" && !dados.motores ? { ...dados, motores: motorPadrao ? [motorPadrao] : [] } : dados);
  onMudarCanvas((c) => {
    let novo: Canvas = { ...c, nos: c.nos.concat([no]) };
    const saidas = c.nos.filter((n) => n.tipo === "gerar");
    if (t !== "gerar" && saidas.length === 1) novo = ligar(novo, no.id, saidas[0].id);
    return novo;
  });
  onSelecionar({ tipo: "no", id: no.id });
}

// ------------------------------------------------------------------ modo lista (celular)

function ModoLista({
  canvas,
  fontes,
  onMudarCanvas,
  garantirSalvo,
  motorPadrao,
}: {
  canvas: Canvas;
  fontes: Fontes;
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void;
  garantirSalvo: () => Promise<Canvas | null>;
  motorPadrao: string | null;
}) {
  const saidas = canvas.nos.filter((n) => n.tipo === "gerar");
  const [saidaId, setSaidaId] = useState<string | null>(saidas.length ? saidas[0].id : null);
  const saida = saidas.find((s) => s.id === saidaId) || saidas[0] || null;
  const entradas = saida ? entradasDoGerar(canvas, saida.id) : [];
  const soltos = canvas.nos.filter((n) => n.tipo !== "gerar" && !canvas.ligacoes.some((l) => l.de === n.id));

  const adicionar = (t: TipoDeNo) => {
    const no = novoNo(t, 0, (canvas.nos.length + 1) * (TAMANHO_DO_CARTAO.altura + 20));
    onMudarCanvas((c) => {
      let novo: Canvas = { ...c, nos: c.nos.concat([no]) };
      if (saida) novo = ligar(novo, no.id, saida.id);
      return novo;
    });
  };

  if (!saida) {
    return (
      <Cartao titulo="Modo lista">
        <p className="mb-2 text-[12px] text-muted-foreground">O canvas não tem Saída. Ela junta os cartões e gera.</p>
        <Button
          type="button"
          size="sm"
          className="h-8 text-[12px]"
          onClick={() => {
            const no = novoNo("gerar", 360, 40, { motores: motorPadrao ? [motorPadrao] : [] });
            onMudarCanvas((c) => ({ ...c, nos: c.nos.concat([no]) }));
            setSaidaId(no.id);
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Pôr uma Saída
        </Button>
      </Cartao>
    );
  }

  return (
    <div className="min-w-0 space-y-3" data-modo-lista="">
      {saidas.length > 1 && (
        <Pilulas rotulo="Saída aberta" opcoes={saidas.map((s, i) => ({ valor: s.id, rotulo: `Saída ${i + 1}` }))} valor={saida.id} onEscolher={setSaidaId} />
      )}
      <Cartao titulo="Entradas, na ordem" dica="Produto, pessoa, ambiente, estilo e o texto: é a ordem em que vão ao gerador.">
        {entradas.length === 0 && <p className="mb-2 text-[12px] text-muted-foreground">Nada ligado ainda.</p>}
        <ol className="min-w-0 space-y-3">
          {entradas.map((e) => (
            <li key={e.ligacao.id} className="min-w-0 rounded-lg border border-border p-2.5" data-entrada-da-lista={e.no.id}>
              <div className="mb-2 flex min-w-0 items-center">
                <span className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10.5px] font-semibold">{e.numero}</span>
                <span className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${TIPOS_DE_NO[e.no.tipo].texto}`}>{TIPOS_DE_NO[e.no.tipo].rotulo}</span>
                <button type="button" aria-label="Tirar o cartão" onClick={() => onMudarCanvas((c) => removerNo(c, e.no.id))} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <EditorDoCartao no={e.no} fontes={fontes} onMudar={(dados) => onMudarCanvas((c) => mudarDados(c, e.no.id, dados))} />
            </li>
          ))}
        </ol>
        {soltos.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{soltos.length} {soltos.length === 1 ? "cartão solto" : "cartões soltos"} no quadro, sem ligação.</p>}
        <div className="mt-3 flex min-w-0 flex-wrap items-center" aria-label="Adicionar entrada">
          {TIPOS_DA_PALETA.filter((t) => t !== "gerar").map((t) => (
            <Button key={t} type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={() => adicionar(t)}>
              <Plus className="mr-1 h-3 w-3" /> {TIPOS_DE_NO[t].rotulo}
            </Button>
          ))}
        </div>
      </Cartao>
      <Cartao titulo="Saída">
        <EditorDaSaida canvas={canvas} no={saida} fontes={fontes} onMudar={(dados) => onMudarCanvas((c) => mudarDados(c, saida.id, dados))} garantirSalvo={garantirSalvo} />
      </Cartao>
    </div>
  );
}

// ------------------------------------------------------------------ etapa

type EstadoDoSalvar = { estado: "salvo" | "salvando" | "pendente" | "erro" | "conflito"; erro: string };

function Painel({ titulo, children, acao }: { titulo: ReactNode; children: ReactNode; acao?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-3" data-painel-do-cartao="">
      <div className="mb-2 flex min-w-0 items-center">
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

function CanvasAberto({ inicial, onTrocar }: { inicial: Canvas; onTrocar: (c: Canvas) => void }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [canvas, setCanvas] = useState<Canvas>(inicial);
  const [selecionado, setSelecionado] = useState<{ tipo: "no" | "ligacao"; id: string } | null>(null);
  const [salvar, setSalvar] = useState<EstadoDoSalvar>({ estado: inicial.id ? "salvo" : "pendente", erro: "" });
  const [lista, setLista] = useState<boolean>(() => typeof window !== "undefined" && window.innerWidth < 768);
  const mexeu = useRef(false);
  const salvando = useRef<Promise<Canvas | null> | null>(null);
  const atual = useRef(canvas);
  atual.current = canvas;
  const adicionarRef = useRef<((t: TipoDeNo, pos?: { x: number; y: number }) => void) | null>(null);

  const kits = useKits(clientId);
  const fotos = useFotos(clientId);
  const personasQ = usePersonas(clientId);
  const personas = useMemo(() => personasQ.data || [], [personasQ.data]);
  const ancoras = useAncoras(personas.map((p) => p.ancora_imagem_id || ""));
  const biblioteca = useBiblioteca(clientId, canvas.nos.some((n) => n.tipo === "estilo"));
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

  // "Usar no Canvas" da aba Modelos: abre com a persona já no quadro.
  useEffect(() => {
    const modeloId = lerPedidoAoCanvas(clientId);
    if (!modeloId) return;
    const saida = atual.current.nos.find((n) => n.tipo === "gerar");
    adicionarNo(mudar, setSelecionado, "modelo", { x: saida ? saida.x - 300 : 0, y: saida ? saida.y + 60 : 0 }, { modelo_id: modeloId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const garantirSalvo = async () => {
    if (atual.current.id && salvar.estado === "salvo") return atual.current;
    return salvarAgora();
  };

  const adicionar = (t: TipoDeNo) => {
    if (adicionarRef.current && !lista) adicionarRef.current(t);
    else adicionarNo(mudar, setSelecionado, t, { x: 0, y: canvas.nos.length * 150 }, {}, padraoDaSaida);
  };
  // A Saída nasce com o motor padrão ligado.
  const adicionarComMotor = (t: TipoDeNo) => {
    if (t === "gerar") {
      const saida = novoNo("gerar", 380, 40, { motores: padraoDaSaida ? [padraoDaSaida] : [] });
      mudar((c) => ({ ...c, nos: c.nos.concat([saida]) }));
      setSelecionado({ tipo: "no", id: saida.id });
      return;
    }
    adicionar(t);
  };

  const noAberto = selecionado && selecionado.tipo === "no" ? canvas.nos.find((n) => n.id === selecionado.id) || null : null;
  const ligacaoAberta = selecionado && selecionado.tipo === "ligacao" ? canvas.ligacoes.find((l) => l.id === selecionado.id) || null : null;
  const saidaUnica = canvas.nos.filter((n) => n.tipo === "gerar");
  const noDoPainel = noAberto || (saidaUnica.length === 1 && !ligacaoAberta ? saidaUnica[0] : null);

  const rotuloDoSalvar =
    salvar.estado === "salvo" ? "Salvo" : salvar.estado === "salvando" ? "Salvando" : salvar.estado === "pendente" ? "Alterações não salvas" : salvar.estado === "conflito" ? "Mudou em outra aba" : "Não salvou";

  return (
    <div className="min-w-0 space-y-3" data-canvas-aberto={canvas.id || "novo"}>
      <div className="flex min-w-0 flex-wrap items-center">
        <Input value={canvas.nome} onChange={(e) => mudar((c) => ({ ...c, nome: e.target.value }))} aria-label="Nome do canvas" className="mb-1.5 mr-2 h-9 w-full min-w-0 text-[13px] font-semibold sm:w-64" />
        <span className={`mb-1.5 mr-2 inline-flex items-center text-[11.5px] ${salvar.estado === "erro" || salvar.estado === "conflito" ? "text-warning" : "text-muted-foreground"}`} role="status" data-estado-do-salvar={salvar.estado} title={salvar.erro || undefined}>
          {salvar.estado === "salvando" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : salvar.estado === "salvo" ? <Check className="mr-1 h-3 w-3" /> : null}
          {rotuloDoSalvar}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
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
        <Select
          value=""
          onValueChange={(chave) => {
            mudar((c) => aplicarModeloPronto(c, chave, padraoDaSaida, { x: 0, y: (c.nos.length ? Math.max.apply(null, c.nos.map((n) => n.y)) + 300 : 0) }));
          }}
        >
          <SelectTrigger className="mb-1.5 mr-1.5 h-8 w-auto min-w-0 text-[12px]" aria-label="Modelos prontos">
            <SelectValue placeholder="Modelos prontos" />
          </SelectTrigger>
          <SelectContent>
            {MODELOS_PRONTOS.map((m) => (
              <SelectItem key={m.chave} value={m.chave}>
                {m.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant={lista ? "default" : "outline"} className="mb-1.5 h-8 text-[12px]" aria-pressed={lista} onClick={() => setLista(!lista)}>
          {lista ? <Workflow className="mr-1.5 h-3.5 w-3.5" /> : <LayoutList className="mr-1.5 h-3.5 w-3.5" />}
          {lista ? "Ver o quadro" : "Modo lista"}
        </Button>
      </div>
      {salvar.estado === "erro" && <AvisoDeErro erro={new Error(`O canvas não foi salvo: ${salvar.erro}`)} />}

      {lista ? (
        <ModoLista canvas={canvas} fontes={fontes} onMudarCanvas={mudar} garantirSalvo={garantirSalvo} motorPadrao={padraoDaSaida} />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-2">
            <div className="lg:hidden">
              <Paleta onAdicionar={adicionarComMotor} horizontal />
            </div>
            <div className="hidden lg:block">
              <Paleta onAdicionar={adicionarComMotor} horizontal={false} />
            </div>
          </div>
          <div className="min-w-0 lg:col-span-6">
            <Quadro
              canvas={canvas}
              fontes={fontes}
              selecionado={selecionado}
              onSelecionar={setSelecionado}
              onMudarCanvas={mudar}
              onViewport={(v) => setCanvas((c) => ({ ...c, viewport: { x: v.x, y: v.y, zoom: v.zoom } }))}
              adicionarRef={adicionarRef}
            />
          </div>
          <div className="min-w-0 lg:col-span-4">
            {ligacaoAberta ? (
              <Painel
                titulo="Ligação"
                acao={
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={() => mudar((c) => desligar(c, ligacaoAberta.id))}>
                    <X className="mr-1 h-3 w-3" /> Desligar
                  </Button>
                }
              >
                <p className="text-[12px] text-muted-foreground">
                  {ROTULOS_DAS_ENTRADAS[ligacaoAberta.entrada]} ligado à Saída. A ordem dentro da mesma entrada é a prioridade.
                </p>
              </Painel>
            ) : noDoPainel ? (
              <Painel
                titulo={noDoPainel.tipo === "gerar" ? "Saída" : `Cartão: ${TIPOS_DE_NO[noDoPainel.tipo].rotulo}`}
                acao={
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={() => {
                    mudar((c) => removerNo(c, noDoPainel.id));
                    setSelecionado(null);
                  }} aria-label="Tirar o cartão do quadro">
                    <Trash2 className="mr-1 h-3 w-3" /> Tirar
                  </Button>
                }
              >
                {noDoPainel.tipo === "gerar" ? (
                  <EditorDaSaida canvas={canvas} no={noDoPainel} fontes={fontes} onMudar={(dados) => mudar((c) => mudarDados(c, noDoPainel.id, dados))} garantirSalvo={garantirSalvo} />
                ) : (
                  <EditorDoCartao key={noDoPainel.id} no={noDoPainel} fontes={fontes} onMudar={(dados) => mudar((c) => mudarDados(c, noDoPainel.id, dados))} />
                )}
              </Painel>
            ) : (
              <Painel titulo="Como usar">
                <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-snug text-muted-foreground">
                  <li>Ponha os cartões: produto, modelo, ambiente, estilo, prompt.</li>
                  <li>Ligue cada um à Saída (toque na bolinha e depois na entrada).</li>
                  <li>Toque num cartão para escolher o que ele leva.</li>
                  <li>Na Saída: Montar mostra o pedido; Gerar cria a imagem.</li>
                </ol>
              </Painel>
            )}
          </div>
        </div>
      )}
      <p className="flex items-start text-[11px] leading-snug text-muted-foreground">
        <ClipboardList className="mr-1 mt-0.5 h-3 w-3 shrink-0" /> Tudo o que o Canvas gera vai para o acervo como gerado, passa por aprovar e segue para Usar como as outras fotos.
      </p>
    </div>
  );
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
    if (rascunho && rascunho.nos.length) return rascunho;
    const c = canvasVazio(clientId);
    return { ...c, nos: [novoNo("gerar", 380, 60, { motores: padrao ? [padrao] : [] })] };
  }, [clientId, padrao]);

  // Abre o mais recente (ou um novo) quando a lista chega.
  useEffect(() => {
    if (aberto) return;
    if (canvases.isSuccess) setAberto(lista.length ? abrirComRascunho(clientId, lista[0]) : novo());
    else if (canvases.isError) setAberto(novo());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvases.isSuccess, canvases.isError]);

  const trocar = (c: Canvas) => {
    setAberto(c);
    setChave((k) => k + 1);
  };

  return (
    <ReactFlowProvider>
      <div className="min-w-0 space-y-3 pb-24">
        <div className="flex min-w-0 flex-wrap items-center">
          <Select value={aberto && aberto.id ? aberto.id : ""} onValueChange={(id) => {
            const c = lista.find((x) => x.id === id);
            if (c) trocar(abrirComRascunho(clientId, c));
          }}>
            <SelectTrigger className="mb-1.5 mr-2 h-9 w-full min-w-0 text-[12.5px] sm:w-72" aria-label="Canvas aberto">
              <SelectValue placeholder={lista.length ? "Abrir um canvas" : "Nenhum canvas salvo ainda"} />
            </SelectTrigger>
            <SelectContent>
              {lista.map((c) => (
                <SelectItem key={String(c.id)} value={String(c.id)}>
                  {c.nome} · {c.nos.length} {c.nos.length === 1 ? "cartão" : "cartões"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" className="mb-1.5 h-9 text-[12.5px]" onClick={() => trocar({ ...canvasVazio(clientId), nos: [novoNo("gerar", 380, 60, { motores: padrao ? [padrao] : [] })] })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Novo canvas
          </Button>
        </div>
        {canvases.isError && <AvisoDeErro erro={canvases.error} />}
        {aberto ? <CanvasAberto key={`${aberto.id || "novo"}-${chave}`} inicial={aberto} onTrocar={trocar} /> : <div className="h-[50vh] animate-pulse rounded-xl bg-muted/60" aria-busy="true" aria-label="Abrindo o canvas" />}
      </div>
    </ReactFlowProvider>
  );
}

/** O rascunho local vence só quando parte da mesma versão do servidor (mudança não salva por cima dela). */
function abrirComRascunho(clientId: string, doServidor: Canvas): Canvas {
  const r = lerRascunho(clientId, doServidor.id);
  return r && r.versao === doServidor.versao ? { ...r, id: doServidor.id } : doServidor;
}
