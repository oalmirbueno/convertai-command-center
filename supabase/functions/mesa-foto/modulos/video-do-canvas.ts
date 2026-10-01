/**
 * Cartão "Vídeo" do Canvas (frente CNV, 30/09/2026).
 *
 * O dono pediu "funcionar o canvas nos vídeos". Até aqui o Canvas só
 * reservava o lugar ("Vídeo, em breve"). Agora o cartão Vídeo recebe a foto
 * de um Resultado (1º quadro), opcionalmente a foto de outro Resultado como
 * último quadro (emenda entre cenas) ou o vídeo de outro cartão Vídeo
 * (continuar), e gera o clipe pelo MESMO motor da Mesa Vídeos (função
 * mesa-videos, ações cena_gerar e continuar_video, com o custo confirmado
 * antes). O cartão guarda só os ids dos pedidos e dos arquivos gerados: o
 * vídeo mora em video_arquivos e aparece também na Mesa Vídeos e na Edição.
 *
 * Puro (sem Deno, sem banco, sem React): a função mesa-foto usa para validar
 * o canvas ao salvar e a tela usa para montar o pedido. Sem travessão.
 */

// ------------------------------------------------------------------ listas fixas

export const FORMATOS_DO_VIDEO = ["9:16", "4:5", "1:1", "16:9"] as const;
export type FormatoDoVideo = (typeof FORMATOS_DO_VIDEO)[number];

/** Movimento de câmera do cartão: vai em palavras no pedido ao motor (qualquer motor entende). */
export const MOVIMENTOS_DE_CAMERA: { valor: string; rotulo: string; frase: string }[] = [
  { valor: "sutil", rotulo: "Sutil (quase parado)", frase: "câmera quase parada, só um respiro leve e natural" },
  { valor: "aproximar", rotulo: "Aproximar devagar", frase: "a câmera se aproxima devagar do assunto (dolly in suave)" },
  { valor: "afastar", rotulo: "Afastar devagar", frase: "a câmera se afasta devagar e revela o lugar (dolly out suave)" },
  { valor: "orbitar", rotulo: "Orbitar", frase: "a câmera gira devagar em volta do assunto, em meia órbita" },
  { valor: "lateral", rotulo: "Travelling lateral", frase: "a câmera desliza de lado, paralela ao assunto" },
  { valor: "pan", rotulo: "Panorâmica", frase: "a câmera gira no próprio eixo da esquerda para a direita" },
  { valor: "subir", rotulo: "Subir (grua)", frase: "a câmera sobe devagar, como uma grua, e mostra mais do cenário" },
  { valor: "na_mao", rotulo: "Câmera na mão", frase: "câmera na mão, com leve balanço natural de quem filma com o celular" },
  { valor: "zoom", rotulo: "Zoom lento", frase: "zoom óptico lento em direção ao produto" },
  { valor: "seguir", rotulo: "Seguir a pessoa", frase: "a câmera acompanha a pessoa enquanto ela se move" },
];

/** Durações que o cartão oferece (o servidor prende ao que o motor aceita). */
export const DURACOES_DO_VIDEO = [4, 5, 6, 8, 10, 12, 15];

/** Quantos pedidos o cartão guarda (os mais novos). */
export const MAX_PEDIDOS_NO_VIDEO = 12;
export const MAX_VIDEOS_POR_PEDIDO = 4;

/** Estados do pedido na Mesa Vídeos (video_pedidos.estado). */
export const ESTADOS_DO_PEDIDO = ["enviado", "gerando", "baixando", "pronto", "parcial", "erro", "cancelado"] as const;
export type EstadoDoPedidoDoVideo = (typeof ESTADOS_DO_PEDIDO)[number];
export const EM_ANDAMENTO: EstadoDoPedidoDoVideo[] = ["enviado", "gerando", "baixando", "parcial"];

// ------------------------------------------------------------------ tipos

export interface VideoGerado {
  n: number;
  arquivo_id: string | null;
  storage_path: string;
}

export interface PedidoDoVideoNoCanvas {
  pedido_id: string;
  uid: string;
  motor: string;
  modo: "primeiro_quadro" | "primeiro_ultimo" | "continuar";
  criado_em: string;
  estado: EstadoDoPedidoDoVideo;
  erro: string | null;
  custo_usd: number | null;
  /** Foto (1º quadro) que foi ao motor: caminho no bucket mesa do cliente. */
  quadro_path: string | null;
  videos: VideoGerado[];
}

export interface DadosDoVideo {
  titulo: string | null;
  /** Motor da Mesa Vídeos (id do catálogo em mesa-videos/modulos/modelos-de-video.ts). */
  motor: string | null;
  duracao_s: number;
  formato: FormatoDoVideo;
  resolucao: string | null;
  audio: boolean;
  movimento: string;
  /** Movimento pronto da Higgsfield (só motor com câmera pronta). */
  camera: string | null;
  prompt: string;
  negativo: string;
  variacoes: number;
  pedidos: PedidoDoVideoNoCanvas[];
}

/** De onde vem a imagem que a ligação leva ao cartão Vídeo. */
export type QuadroDaLigacao = "inicio" | "final" | "continuar";

// ------------------------------------------------------------------ leitura (mesma na tela e na função)

const TEXTO = (v: unknown, max: number): string => {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
};
const TEXTO_OU_NULO = (v: unknown, max: number): string | null => TEXTO(v, max) || null;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMINHO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^\u0000-\u001f]{1,400}$/i;

/** Caminho do Storage do cliente (começa pelo id de um cliente e não sobe pasta). */
export function caminhoValido(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t || t.indexOf("..") >= 0 || !CAMINHO.test(t)) return null;
  return t;
}

export const idValido = (v: unknown): string | null => (typeof v === "string" && ID.test(v.trim()) ? v.trim() : null);

function numeroEntre(v: unknown, padrao: number, min: number, max: number): number {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

export function lerPedidoDoVideo(v: unknown): PedidoDoVideoNoCanvas | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const pedido = idValido(o.pedido_id);
  if (!pedido) return null;
  const estado = (ESTADOS_DO_PEDIDO as readonly string[]).indexOf(String(o.estado)) >= 0 ? (String(o.estado) as EstadoDoPedidoDoVideo) : "enviado";
  const modo = o.modo === "primeiro_ultimo" || o.modo === "continuar" ? o.modo : "primeiro_quadro";
  const videos: VideoGerado[] = [];
  (Array.isArray(o.videos) ? o.videos : []).forEach((x, i) => {
    if (!x || typeof x !== "object" || videos.length >= MAX_VIDEOS_POR_PEDIDO) return;
    const y = x as Record<string, unknown>;
    const caminho = caminhoValido(y.storage_path);
    if (!caminho) return;
    videos.push({ n: Math.round(numeroEntre(y.n, i + 1, 1, 8)), arquivo_id: idValido(y.arquivo_id), storage_path: caminho });
  });
  const custo = Number(o.custo_usd);
  return {
    pedido_id: pedido,
    uid: TEXTO(o.uid, 64),
    motor: TEXTO(o.motor, 60),
    modo,
    criado_em: TEXTO(o.criado_em, 40),
    estado,
    erro: TEXTO_OU_NULO(o.erro, 400),
    custo_usd: o.custo_usd === null || o.custo_usd === undefined || !isFinite(custo) ? null : Math.max(0, custo),
    quadro_path: caminhoValido(o.quadro_path),
    videos,
  };
}

/** Dados do cartão Vídeo só com os campos conhecidos (a função grava sempre esta forma). */
export function lerDadosDoVideo(bruto: unknown): DadosDoVideo {
  const d = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const formato = (FORMATOS_DO_VIDEO as readonly string[]).indexOf(String(d.formato)) >= 0 ? (String(d.formato) as FormatoDoVideo) : "9:16";
  const movimento = MOVIMENTOS_DE_CAMERA.some((m) => m.valor === d.movimento) ? String(d.movimento) : "sutil";
  const pedidos: PedidoDoVideoNoCanvas[] = [];
  (Array.isArray(d.pedidos) ? d.pedidos : []).forEach((x) => {
    const p = lerPedidoDoVideo(x);
    if (p && !pedidos.some((y) => y.pedido_id === p.pedido_id)) pedidos.push(p);
  });
  return {
    titulo: TEXTO_OU_NULO(d.titulo, 120),
    motor: TEXTO_OU_NULO(d.motor, 60),
    duracao_s: Math.round(numeroEntre(d.duracao_s, 5, 2, 15)),
    formato,
    resolucao: TEXTO_OU_NULO(d.resolucao, 12),
    audio: d.audio === true,
    movimento,
    camera: TEXTO_OU_NULO(d.camera, 60),
    prompt: typeof d.prompt === "string" ? d.prompt.slice(0, 2000) : "",
    negativo: typeof d.negativo === "string" ? d.negativo.slice(0, 600) : "",
    variacoes: Math.round(numeroEntre(d.variacoes, 1, 1, 2)),
    pedidos: pedidos.slice(-MAX_PEDIDOS_NO_VIDEO),
  };
}

export const lerQuadroDaLigacao = (v: unknown): QuadroDaLigacao => (v === "final" || v === "continuar" ? v : "inicio");

// ------------------------------------------------------------------ pedido ao motor

export interface CenaParaOVideo {
  numero: number | null;
  titulo: string;
  acao: string;
  narrativa: string;
  cenario: string;
  enquadramento: string;
}

/** Frase do movimento (sem movimento conhecido: sutil). */
export const fraseDoMovimento = (valor: string | null | undefined) => (MOVIMENTOS_DE_CAMERA.find((m) => m.valor === valor) || MOVIMENTOS_DE_CAMERA[0]).frase;

/**
 * Pedido do clipe escrito pelo código (sem IA, sem custo): o que acontece na
 * cena, o movimento de câmera, a fala (com áudio) e a regra de continuidade.
 * O motor recebe a foto como 1º quadro: o texto descreve MOVIMENTO, não a foto.
 */
export function pedidoDoVideo(e: { cena: CenaParaOVideo | null; movimento: string; audio: boolean; extra?: string | null; final?: boolean; continuar?: boolean }): string {
  const partes: string[] = [];
  const c = e.cena;
  if (e.continuar) partes.push("Continue o vídeo anterior do ponto exato em que ele terminou, com a mesma pessoa, a mesma roupa, o mesmo produto e o mesmo lugar.");
  if (c && c.acao.trim()) partes.push(`${c.acao.trim().replace(/[.\s]+$/, "")}.`);
  else if (!e.continuar) partes.push("A cena da foto ganha vida com um movimento natural e realista, sem mudar o que está nela.");
  if (c && c.cenario.trim()) partes.push(`Lugar: ${c.cenario.trim().replace(/[.\s]+$/, "")}.`);
  partes.push(`Câmera: ${fraseDoMovimento(e.movimento)}.`);
  if (e.final) partes.push("Termine exatamente no quadro final dado, numa passagem contínua e sem corte.");
  if (e.audio && c && c.narrativa.trim()) partes.push(`Fala em português do Brasil, natural e sem sotaque forçado: "${c.narrativa.trim().replace(/"/g, "'").slice(0, 280)}".`);
  if (e.extra && e.extra.trim()) partes.push(e.extra.trim());
  partes.push("Mantenha a pessoa, o rosto, a roupa, o produto (forma, cor, rótulo e logo) e o cenário exatamente como no primeiro quadro. Movimento físico real, sem deformar mãos nem texto.");
  return partes.join(" ").replace(/\s+/g, " ").slice(0, 1900);
}

/** Referência curta do plano (plano_ref, até 8 caracteres): c<número> quando a foto é de uma cena. */
export const refDoPlano = (numero: number | null | undefined) => (numero && numero > 0 ? `c${Math.round(numero)}`.slice(0, 8) : null);

/** Resumo do estado de um pedido para o cartão. */
export function rotuloDoEstado(e: EstadoDoPedidoDoVideo): string {
  switch (e) {
    case "enviado":
      return "Na fila do motor";
    case "gerando":
      return "Gerando";
    case "baixando":
      return "Guardando o vídeo";
    case "parcial":
      return "Parte pronta";
    case "pronto":
      return "Pronto";
    case "cancelado":
      return "Cancelado";
    default:
      return "Falhou";
  }
}

/** Pedido da Mesa Vídeos (video_pedidos) na forma do cartão, preservando o que o cartão já sabia. */
export function pedidoAtualizado(anterior: PedidoDoVideoNoCanvas, linha: unknown): PedidoDoVideoNoCanvas {
  if (!linha || typeof linha !== "object") return anterior;
  const l = linha as Record<string, unknown>;
  const estado = (ESTADOS_DO_PEDIDO as readonly string[]).indexOf(String(l.estado)) >= 0 ? (String(l.estado) as EstadoDoPedidoDoVideo) : anterior.estado;
  const resultado = (l.resultado && typeof l.resultado === "object" ? l.resultado : {}) as Record<string, unknown>;
  const envios = Array.isArray(resultado.envios) ? (resultado.envios as Record<string, unknown>[]) : [];
  const videos: VideoGerado[] = [];
  const erros: string[] = [];
  let custo = 0;
  let temCusto = false;
  envios.forEach((e, i) => {
    const caminho = caminhoValido(e.storage_path);
    if (e.estado === "pronto" && caminho && videos.length < MAX_VIDEOS_POR_PEDIDO) videos.push({ n: Math.round(numeroEntre(e.n, i + 1, 1, 8)), arquivo_id: idValido(e.arquivo_id), storage_path: caminho });
    if (e.estado === "erro" && typeof e.erro === "string" && e.erro) erros.push(e.erro);
    const c = Number(e.custo_usd);
    if (e.custo_usd !== null && e.custo_usd !== undefined && isFinite(c)) {
      custo += c;
      temCusto = true;
    }
  });
  const erro = typeof l.erro === "string" && l.erro ? l.erro : erros.length ? erros[0] : null;
  return {
    ...anterior,
    estado,
    erro: estado === "erro" || estado === "parcial" ? TEXTO_OU_NULO(erro, 400) : null,
    custo_usd: temCusto ? Math.round(custo * 1e6) / 1e6 : anterior.custo_usd,
    videos: videos.length ? videos : anterior.videos,
  };
}

/** O vídeo mais novo pronto do cartão (para a miniatura e para continuar). */
export function ultimoVideo(d: Pick<DadosDoVideo, "pedidos">): (VideoGerado & { pedido_id: string; quadro_path: string | null }) | null {
  for (let i = d.pedidos.length - 1; i >= 0; i--) {
    const p = d.pedidos[i];
    if (p.videos.length) {
      const v = p.videos[p.videos.length - 1];
      return { ...v, pedido_id: p.pedido_id, quadro_path: p.quadro_path };
    }
  }
  return null;
}

export const pedidosEmAndamento = (d: Pick<DadosDoVideo, "pedidos">) => d.pedidos.filter((p) => EM_ANDAMENTO.indexOf(p.estado) >= 0);
