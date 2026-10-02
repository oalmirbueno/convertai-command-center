/**
 * Tratar um vídeo do acervo (Mesa Edição, 02/10/2026): TIRAR A LEGENDA que já
 * veio gravada e MELHORAR A QUALIDADE (pele de cera, rosto mais real sem mudar
 * o rosto, nitidez). Os dois pedidos do dono:
 * - "reconhecer a legenda no vídeo e tirar, se o vídeo já veio com legenda,
 *   sem mudar mais nada do vídeo";
 * - "melhorar a qualidade: tirar o aspecto de cera do rosto, deixar mais real
 *   sem mudar o rosto".
 *
 * Caminho (o mesmo da troca de cenário: sem laço, sem segurar a função):
 *   AMOSTRA (alguns segundos, custo antes) -> comparar antes e depois ->
 *   FINAL (o vídeo inteiro, custo antes) -> vídeo novo no acervo, na pasta
 *   "Antes e depois", com o original intacto.
 * Cada fase: preparar (worker: corta em partes do tamanho que o modelo aceita
 * e, para tirar a legenda, faz a máscara da faixa) -> envios ao provedor (um
 * por parte) -> compor (worker: junta as partes e, para tirar a legenda, cola
 * SÓ a faixa da legenda tratada sobre o vídeo original, com borda suave; o
 * resto do quadro fica pixel a pixel o original; o ÁUDIO é sempre o original).
 *
 * Motores (preços conferidos nas páginas do fal e na API da Runway em 02/10/2026):
 * - Tirar legenda, padrão: Wan VACE 14B Inpainting (fal-ai/wan-vace-14b/inpainting),
 *   com a máscara da faixa. US$ 0,08 por "segundo de vídeo" em 720p, e o fal
 *   conta o segundo a 16 quadros: a 30 qps sai US$ 0,15 por segundo real.
 *   Até 241 quadros por pedido: partes de até 8 s.
 * - Tirar legenda, alternativa: Runway Aleph 2 (POST /v1/video_to_video, model
 *   "aleph2") com a instrução "remova as legendas"; US$ 0,28/s, até 30 s por
 *   parte, mínimo 2 s. Sem máscara no provedor: a faixa é colada do mesmo jeito.
 * - Melhorar, padrão: Topaz Video Upscale, modelo Proteus (fiel; fal-ai/topaz/upscale/video):
 *   sem suavizar (ruído 0), recuperar detalhe e um grão fino de filme contra a
 *   pele de cera. US$ 0,01/s até 720p, 0,02/s até 1080p, 0,08/s acima (60 qps: o dobro).
 * - Melhorar, alternativa: SeedVR2 (fal-ai/seedvr/upscale/video), restauração de
 *   um passo, US$ 0,001 por megapixel de saída (largura x altura x quadros).
 *
 * Puro: sem Deno, sem banco, sem rede. A função, a tela e os testes usam o mesmo.
 */

export type AcaoDoTratamento = "tirar_legenda" | "melhorar";
export type FaseDoTratamento = "amostra" | "final";
export type EstadoDoTratamento = "preparando" | "gerando" | "compondo" | "amostra" | "pronto" | "erro" | "descartado";
export type PerfilDoPreparo = "padrao" | "aleph" | "fiel";
export type NivelDaMelhora = "mesmo_tamanho" | "dobro";

export const ACOES_DO_TRATAMENTO: AcaoDoTratamento[] = ["tirar_legenda", "melhorar"];
export const ESTADOS_EM_ANDAMENTO: EstadoDoTratamento[] = ["preparando", "gerando", "compondo"];
export const NIVEIS_DA_MELHORA: NivelDaMelhora[] = ["mesmo_tamanho", "dobro"];

export const ROTULO_DA_ACAO: Record<AcaoDoTratamento, string> = {
  tirar_legenda: "Tirar legenda",
  melhorar: "Melhorar qualidade",
};

/** Sufixo do nome do vídeo novo ("Gravação (sem legenda).mp4"). */
export const SUFIXO_DA_ACAO: Record<AcaoDoTratamento, string> = {
  tirar_legenda: "sem legenda",
  melhorar: "melhorado",
};

export interface MotorDoTratamento {
  id: string;
  acao: AcaoDoTratamento;
  rotulo: string;
  provedor: "fal" | "runway";
  endpoint: string;
  chave_env: string;
  /** Preço base (US$ por segundo; para o SeedVR2, US$ por megapixel). */
  preco: number;
  unidade: "segundo" | "megapixel" | "segundo_por_resolucao";
  /** Segundos mínimos cobrados por parte. */
  minimo_s: number;
  /** Maior parte que o modelo aceita (s). */
  parte_max_s: number;
  perfil: PerfilDoPreparo;
  /** O provedor recebe a máscara da faixa (vídeo preto e branco). */
  mascara: boolean;
  prazo_min: number;
  nota: string;
  fonte: string;
  conferido_em: string;
}

const HOJE = "2026-10-02";

export const MOTORES_DO_TRATAMENTO: MotorDoTratamento[] = [
  {
    id: "wan-vace-inpainting",
    acao: "tirar_legenda",
    rotulo: "Wan VACE (máscara)",
    provedor: "fal",
    endpoint: "fal-ai/wan-vace-14b/inpainting",
    chave_env: "FAL_KEY",
    preco: 0.15,
    unidade: "segundo",
    minimo_s: 1,
    parte_max_s: 8,
    perfil: "padrao",
    mascara: true,
    prazo_min: 40,
    nota: "Refaz só a faixa da legenda (máscara). US$ 0,08 por segundo de 16 quadros em 720p: a 30 qps, US$ 0,15 por segundo.",
    fonte: "https://fal.ai/models/fal-ai/wan-vace-14b/inpainting",
    conferido_em: HOJE,
  },
  {
    id: "runway-aleph-2-legenda",
    acao: "tirar_legenda",
    rotulo: "Runway Aleph 2",
    provedor: "runway",
    endpoint: "video_to_video",
    chave_env: "RUNWAYML_API_SECRET",
    preco: 0.28,
    unidade: "segundo",
    minimo_s: 2,
    parte_max_s: 30,
    perfil: "aleph",
    mascara: false,
    prazo_min: 40,
    nota: "Edição por instrução (\"remova as legendas\"). Mais cara; só com a chave da Runway.",
    fonte: "https://docs.dev.runwayml.com/api/#tag/Start-generating/paths/~1v1~1video_to_video/post",
    conferido_em: HOJE,
  },
  {
    id: "topaz-proteus",
    acao: "melhorar",
    rotulo: "Topaz Proteus (fiel)",
    provedor: "fal",
    endpoint: "fal-ai/topaz/upscale/video",
    chave_env: "FAL_KEY",
    preco: 0.02,
    unidade: "segundo_por_resolucao",
    minimo_s: 1,
    parte_max_s: 600,
    perfil: "fiel",
    mascara: false,
    prazo_min: 60,
    nota: "Não inventa rosto: nitidez e detalhe sem suavizar, grão fino de filme contra a pele de cera. US$ 0,01/s até 720p, 0,02/s até 1080p, 0,08/s acima.",
    fonte: "https://fal.ai/models/fal-ai/topaz/upscale/video",
    conferido_em: HOJE,
  },
  {
    id: "seedvr2-video",
    acao: "melhorar",
    rotulo: "SeedVR2",
    provedor: "fal",
    endpoint: "fal-ai/seedvr/upscale/video",
    chave_env: "FAL_KEY",
    preco: 0.001,
    unidade: "megapixel",
    minimo_s: 1,
    parte_max_s: 120,
    perfil: "fiel",
    mascara: false,
    prazo_min: 60,
    nota: "Restauração de um passo, mais textura. US$ 0,001 por megapixel de saída (largura x altura x quadros).",
    fonte: "https://fal.ai/models/fal-ai/seedvr/upscale/video",
    conferido_em: HOJE,
  },
];

export const MOTOR_PADRAO: Record<AcaoDoTratamento, string> = {
  tirar_legenda: "wan-vace-inpainting",
  melhorar: "topaz-proteus",
};

export function motorDoTratamento(acao: AcaoDoTratamento, id?: string | null): MotorDoTratamento {
  const pedido = id ? MOTORES_DO_TRATAMENTO.find((m) => m.id === id && m.acao === acao) : null;
  return pedido || (MOTORES_DO_TRATAMENTO.find((m) => m.id === MOTOR_PADRAO[acao]) as MotorDoTratamento);
}

export const motoresDaAcao = (acao: AcaoDoTratamento) => MOTORES_DO_TRATAMENTO.filter((m) => m.acao === acao);

// ------------------------------------------------------------------ trecho, amostra e partes

export const AMOSTRA_PADRAO_S = 5;
export const AMOSTRA_MIN_S = 3;
export const AMOSTRA_MAX_S = 8;
/** Teto do vídeo inteiro por pedido (10 min): acima disso, em partes pela edição. */
export const MAX_FINAL_S = 600;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const arred4 = (n: number) => Math.round(n * 10000) / 10000;

/** Janela da amostra: começa onde a pessoa pediu (ou no zero), de 3 a 8 s, dentro do vídeo. */
export function janelaDaAmostra(duracao_s: number, inicio?: number | null, tamanho = AMOSTRA_PADRAO_S): { inicio_s: number; fim_s: number } {
  const d = Math.max(0, Number(duracao_s) || 0);
  const t = Math.max(AMOSTRA_MIN_S, Math.min(AMOSTRA_MAX_S, Number(tamanho) || AMOSTRA_PADRAO_S));
  if (d <= t) return { inicio_s: 0, fim_s: r3(d) };
  const i = Math.max(0, Math.min(d - t, Number(inicio) || 0));
  return { inicio_s: r3(i), fim_s: r3(i + t) };
}

/** Divide [inicio, fim] em partes iguais de até `max_s` (nada de parte pequena sobrando no fim). */
export function partesDoTrecho(inicio_s: number, fim_s: number, max_s: number): { inicio_s: number; fim_s: number }[] {
  const d = Math.max(0, fim_s - inicio_s);
  if (d <= 0) return [];
  const n = Math.max(1, Math.ceil(d / Math.max(0.5, max_s) - 1e-9));
  const passo = d / n;
  return Array.from({ length: n }, (_, k) => ({ inicio_s: r3(inicio_s + k * passo), fim_s: r3(k === n - 1 ? fim_s : inicio_s + (k + 1) * passo) }));
}

export function faltaNoTrecho(fase: FaseDoTratamento, inicio_s: number, fim_s: number): string | null {
  if (!isFinite(inicio_s) || !isFinite(fim_s) || inicio_s < 0 || fim_s <= inicio_s) return "Escolha o trecho do vídeo.";
  const d = fim_s - inicio_s;
  if (d < 1) return "O trecho precisa de pelo menos 1 s.";
  if (fase === "amostra" && d > AMOSTRA_MAX_S + 0.05) return `A amostra vai até ${AMOSTRA_MAX_S} s.`;
  if (fase === "final" && d > MAX_FINAL_S + 0.05) return `Até ${MAX_FINAL_S / 60} min por vez. Trate o vídeo em partes pela edição.`;
  return null;
}

// ------------------------------------------------------------------ região da legenda

/** Faixa da legenda no quadro, em fração (0 a 1) da largura e da altura. */
export interface RegiaoDaLegenda {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Região conferida: dentro do quadro, de 3% a 60% da altura; folga de 2% para o contorno das letras. */
export function regiaoValida(v: unknown, folga = 0.02): RegiaoDaLegenda | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const n = (k: string) => Number(o[k]);
  let x = n("x");
  let y = n("y");
  let w = n("w");
  let h = n("h");
  if (![x, y, w, h].every((z) => isFinite(z))) return null;
  x = Math.max(0, x - folga);
  y = Math.max(0, y - folga);
  w = Math.min(1 - x, w + 2 * folga);
  h = Math.min(1 - y, h + 2 * folga);
  if (w < 0.1 || h < 0.03 || h > 0.6) return null;
  const q = (z: number) => Math.round(z * 10000) / 10000;
  return { x: q(x), y: q(y), w: q(w), h: q(h) };
}

/** A região em pixels pares de um quadro W x H (para o ffmpeg). */
export function regiaoEmPixels(r: RegiaoDaLegenda, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const par = (z: number) => Math.max(2, Math.floor(z / 2) * 2);
  const x = Math.max(0, Math.floor((r.x * W) / 2) * 2);
  const y = Math.max(0, Math.floor((r.y * H) / 2) * 2);
  return { x, y, w: Math.min(par(r.w * W), W - x), h: Math.min(par(r.h * H), H - y) };
}

// ------------------------------------------------------------------ custo

export interface MedidasDoVideo {
  largura: number | null;
  altura: number | null;
  fps?: number | null;
}

/** Fator de ampliação do nível: mesmo tamanho (1x, só limpa e dá detalhe) ou dobro (até 4K no lado maior). */
export function fatorDoNivel(nivel: NivelDaMelhora, m: MedidasDoVideo): number {
  if (nivel === "mesmo_tamanho") return 1;
  const maior = Math.max(Number(m.largura) || 0, Number(m.altura) || 0);
  if (!maior) return 2;
  return Math.max(1, Math.min(2, Math.floor((3840 / maior) * 100) / 100));
}

/** Preço por segundo do Topaz pela resolução de SAÍDA (lado menor) e qps. */
export function precoDoTopaz(m: MedidasDoVideo, fator: number): number {
  const menor = Math.min(Number(m.largura) || 1080, Number(m.altura) || 1920) * Math.max(1, fator);
  const base = menor <= 720 ? 0.01 : menor <= 1080 ? 0.02 : 0.08;
  return (Number(m.fps) || 30) > 30 ? base * 2 : base;
}

export interface CustoDoTratamento {
  usd: number;
  detalhe: string;
  partes: number;
}

/**
 * Custo de UMA fase (amostra ou final): soma das partes, cada uma cobrada
 * pelo segundo começado e pelo mínimo do motor.
 */
export function custoDoTratamento(motor: MotorDoTratamento, inicio_s: number, fim_s: number, m: MedidasDoVideo = { largura: null, altura: null }, fator = 1): CustoDoTratamento {
  const partes = partesDoTrecho(inicio_s, fim_s, motor.parte_max_s);
  const segundos = partes.reduce((s, p) => s + Math.max(motor.minimo_s, Math.ceil(p.fim_s - p.inicio_s - 1e-6)), 0);
  if (motor.unidade === "megapixel") {
    const fps = Number(m.fps) || 30;
    const mp = ((Number(m.largura) || 1080) * fator * (Number(m.altura) || 1920) * fator * fps) / 1e6;
    const usd = arred4(motor.preco * mp * segundos);
    return { usd, detalhe: `${motor.rotulo}: US$ ${motor.preco}/MP x ${Math.round(mp)} MP/s x ${segundos} s`, partes: partes.length };
  }
  const porSegundo = motor.unidade === "segundo_por_resolucao" ? precoDoTopaz(m, fator) : motor.preco;
  return { usd: arred4(porSegundo * segundos), detalhe: `${motor.rotulo}: US$ ${porSegundo}/s x ${segundos} s${partes.length > 1 ? ` em ${partes.length} partes` : ""}`, partes: partes.length };
}

// ------------------------------------------------------------------ pedidos aos modelos

export const PROMPT_DE_TIRAR_LEGENDA =
  "Remove all burned-in subtitles, captions and on-screen text inside the masked area. Rebuild the background that was behind the letters so it continues the surrounding pixels, light, texture and motion naturally. Do not add any text, logos or new objects.";

export const PROMPT_DO_ALEPH_SEM_LEGENDA =
  "Remove all burned-in subtitles and caption text from the video. Keep everything else exactly the same: people, faces, lip movements, clothing, colors, light, framing and camera motion.";

export interface EntradaDoEnvioDoTratamento {
  parte_url: string;
  mascara_url?: string | null;
  fator?: number;
  seed?: number | null;
}

/** Corpo do pedido de cada motor. Nada de chave aqui. */
export function corpoDoTratamento(motor: MotorDoTratamento, e: EntradaDoEnvioDoTratamento): Record<string, unknown> {
  if (motor.id === "wan-vace-inpainting") {
    if (!e.mascara_url) throw new Error("Falta a máscara da faixa da legenda.");
    return {
      prompt: PROMPT_DE_TIRAR_LEGENDA,
      negative_prompt: "text, letters, subtitles, captions, watermark, logo, blur, distortion",
      video_url: e.parte_url,
      mask_video_url: e.mascara_url,
      match_input_num_frames: true,
      match_input_frames_per_second: true,
      resolution: "auto",
      preprocess: false,
    };
  }
  if (motor.id === "runway-aleph-2-legenda") {
    const corpo: Record<string, unknown> = { model: "aleph2", videoUri: e.parte_url, promptText: PROMPT_DO_ALEPH_SEM_LEGENDA, contentModeration: { publicFigureThreshold: "auto" } };
    if (typeof e.seed === "number" && isFinite(e.seed)) corpo.seed = Math.max(0, Math.min(4294967295, Math.floor(e.seed)));
    return corpo;
  }
  const fator = Math.max(1, Math.min(4, Number(e.fator) || 1));
  if (motor.id === "topaz-proteus") {
    // Fiel contra a pele de cera: sem tirar ruído (o "noise" alto alisa a pele), detalhe de volta e grão fino de filme.
    return { video_url: e.parte_url, model: "Proteus", upscale_factor: fator, noise: 0, recover_detail: 0.6, compression: 0.2, halo: 0.1, grain: 0.02, H264_output: true };
  }
  if (motor.id === "seedvr2-video") {
    return { video_url: e.parte_url, upscale_mode: "factor", upscale_factor: fator, noise_scale: 0.1, output_format: "X264 (.mp4)", output_quality: "high", output_write_mode: "balanced" };
  }
  throw new Error("Motor desconhecido.");
}

// ------------------------------------------------------------------ caminhos

export const pastaDoTratamento = (clientId: string, id: string) => `${clientId}/video/tratamentos/${id}`;
export const caminhoNoTratamento = (clientId: string, id: string, fase: FaseDoTratamento, nome: string) => `${pastaDoTratamento(clientId, id)}/${fase}/${nome}`;

/** Nome do vídeo novo: o nome do antes com o sufixo ("Gravação (sem legenda).mp4"). */
export function nomeDoTratado(nomeDoAntes: string, acao: AcaoDoTratamento): string {
  const base = String(nomeDoAntes || "Vídeo").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/\s*\((?:sem legenda|melhorado)\)\s*$/i, "").trim() || "Vídeo";
  return `${base.slice(0, 100)} (${SUFIXO_DA_ACAO[acao]}).mp4`;
}

// ------------------------------------------------------------------ máquina de estados (decisão pura)

export interface EnvioDoTratamento {
  parte: number;
  motor: string;
  provedor: "fal" | "runway";
  endpoint: string;
  request_id: string;
  status_url: string;
  response_url: string;
  estado: "enviado" | "gerando" | "baixando" | "pronto" | "erro";
  enviado_em: string;
  consultado_em: string | null;
  posicao: number | null;
  erro: string | null;
  custo_previsto_usd: number;
  custo_usd: number | null;
  uso_id: string | null;
  storage_path: string | null;
  tentativas_de_baixar?: number;
}

export interface PartePreparadaDoTratamento {
  inicio_s: number;
  fim_s: number;
  path: string;
  mascara_path: string | null;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
}

export interface PassosDaFase {
  chave?: string | null;
  inicio_s: number;
  fim_s: number;
  motor: string;
  fator?: number;
  custo_previsto_usd?: number;
  preparo?: { render_id: string; estado?: string; partes?: PartePreparadaDoTratamento[] } | null;
  envios?: EnvioDoTratamento[];
  composicao?: { render_id: string; estado?: string } | null;
  /** O que saiu: antes e depois (amostra) ou o vídeo novo (final). */
  antes_path?: string | null;
  depois_path?: string | null;
  arquivo_id?: string | null;
  resumo?: string | null;
}

export type ProximoPassoDoTratamento =
  | { passo: "esperar_preparo" }
  | { passo: "enviar" }
  | { passo: "consultar" }
  | { passo: "compor" }
  | { passo: "esperar_composicao" }
  | { passo: "concluir" }
  | { passo: "erro"; motivo: string }
  | { passo: "nada" };

/**
 * O que fazer agora, a partir do estado gravado e do pedido do worker (preparo
 * ou composição). Nunca manda refazer: erro do provedor ou do worker encerra
 * com o motivo (o que foi cobrado fica registrado).
 */
export function proximoPassoDoTratamento(estado: EstadoDoTratamento, passos: PassosDaFase | null, render: { estado: string; erro?: string | null } | null): ProximoPassoDoTratamento {
  if (!passos) return { passo: "nada" };
  if (estado === "preparando") {
    if (!render) return { passo: "esperar_preparo" };
    if (render.estado === "pronto") return { passo: "enviar" };
    if (render.estado === "erro" || render.estado === "cancelado") return { passo: "erro", motivo: `A máquina de render não preparou o vídeo${render.erro ? `: ${render.erro}` : ""}. Nada foi gerado no provedor.` };
    return { passo: "esperar_preparo" };
  }
  if (estado === "gerando") {
    const envios = passos.envios || [];
    if (!envios.length) return { passo: "enviar" };
    const comErro = envios.find((e) => e.estado === "erro");
    if (comErro) return { passo: "erro", motivo: comErro.erro || "O provedor não gerou." };
    if (envios.every((e) => e.estado === "pronto")) return { passo: "compor" };
    return { passo: "consultar" };
  }
  if (estado === "compondo") {
    if (!render) return { passo: "esperar_composicao" };
    if (render.estado === "pronto") return { passo: "concluir" };
    if (render.estado === "erro" || render.estado === "cancelado") return { passo: "erro", motivo: `A montagem na máquina de render falhou${render.erro ? `: ${render.erro}` : ""}. O que o provedor gerou está guardado; peça de novo para montar.` };
    return { passo: "esperar_composicao" };
  }
  return { passo: "nada" };
}

/** Estado depois de concluir a fase: a amostra espera o "Fazer o vídeo inteiro"; a final fica pronta. */
export const estadoDepoisDe = (fase: FaseDoTratamento): EstadoDoTratamento => (fase === "amostra" ? "amostra" : "pronto");

/** O que pode começar agora: a amostra a qualquer hora fora do andamento; a final só depois de uma amostra pronta. */
export function podeComecar(fase: FaseDoTratamento, estado: EstadoDoTratamento | null, temAmostra: boolean): string | null {
  if (estado && ESTADOS_EM_ANDAMENTO.indexOf(estado) >= 0) return "Este tratamento ainda está andando.";
  if (estado === "descartado") return "Este tratamento foi tirado da lista.";
  if (fase === "final" && !temAmostra) return "Veja a amostra antes de fazer o vídeo inteiro.";
  if (fase === "final" && estado === "pronto") return "O vídeo inteiro já está pronto.";
  return null;
}

/** Custo já cobrado (só os envios com uso registrado). */
export function custoCobrado(fases: Array<PassosDaFase | null | undefined>): number {
  return arred4(fases.reduce((s, f) => s + ((f && f.envios) || []).reduce((x, e) => x + (e.uso_id ? Number(e.custo_usd) || 0 : 0), 0), 0));
}

export function textoDoEstadoDoTratamento(estado: EstadoDoTratamento, fase: FaseDoTratamento, passos: PassosDaFase | null): string {
  const qual = fase === "amostra" ? "a amostra" : "o vídeo inteiro";
  if (estado === "preparando") return `Preparando ${qual} na máquina`;
  if (estado === "gerando") {
    const e = (passos && passos.envios) || [];
    const prontos = e.filter((x) => x.estado === "pronto").length;
    return e.length > 1 ? `Tratando (${prontos} de ${e.length} partes)` : "Tratando no provedor";
  }
  if (estado === "compondo") return "Montando com o áudio original";
  if (estado === "amostra") return "Amostra pronta: compare";
  if (estado === "pronto") return "Pronto";
  if (estado === "descartado") return "Tirado da lista";
  return "Não deu";
}

/**
 * Pasta do vídeo tratado: "Antes e depois" ao lado da pasta do antes
 * ("Ana / Brutos" -> "Ana / Antes e depois"; sem pasta -> "Antes e depois").
 */
export function pastaDoTratado(grupoDoAntes: string | null | undefined): string {
  const partes = String(grupoDoAntes || "")
    .split(" / ")
    .map((p) => p.trim())
    .filter(Boolean);
  const casa = ["Brutos", "Extras", "Antes e depois", "Gerados", "Exportados", "Amostras", "Cenas do Motion", "Áudio", "Imagens"];
  const k = partes.findIndex((p) => casa.indexOf(p) >= 0 || /^Cena \d+$/.test(p));
  const prefixo = k >= 0 ? partes.slice(0, k) : partes;
  return prefixo.concat(["Antes e depois"]).join(" / ").slice(0, 80);
}
