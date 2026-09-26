/**
 * Projeto de edição da Mesa Edição (frente E2, 26/09/2026).
 *
 * UM modelo de dados para a edição de um vídeo, versionado junto das versões
 * que já existem (video_versoes.projeto, SQL E2-01). É a base onde o editor
 * completo (preview com Remotion Player, linha do tempo com trilhas,
 * ferramentas manuais e agentes que editam o mesmo projeto) vai encaixar.
 *
 * Formato: parecido com uma EDL / props de composição Remotion.
 * - fontes: os arquivos do acervo (video_arquivos) por uma chave curta;
 * - trilhas: vídeo, texto, legenda, áudio e sobreposição, cada uma com clipes;
 * - clipe: onde começa na linha do tempo (inicio_s), o trecho da fonte
 *   (entrada_s e saida_s), velocidade, volume, texto, transições e zoom.
 * - revisao: sobe a cada gravação (trava otimista: quem salva manda a revisão
 *   que leu; revisão diferente é recusada, nada se perde calado).
 *
 * O pacote para editar (pacote-de-edicao.ts) sai DESTE projeto: o edl.json
 * dos projetos Remotion locais do dono vem de edlDoProjeto.
 *
 * Puro: sem Deno, sem banco. A tela, a função mesa-videos e os testes usam o mesmo.
 *
 * Formato 2 (frente V-B, 26/09, editor de vídeo completo). Tudo que entrou é
 * opcional e tem padrão, então projeto do formato 1 abre igual
 * (migrarProjeto / normalizarProjeto):
 * - fontes ganham `midia` (video, audio ou imagem; imagem vem da troca de câmera);
 * - clipe ganha `comparar` (antes e depois: segunda fonte, modo e rótulos) e
 *   `origem` (manual, skill, ângulo, continuar, transição, cena gerada);
 * - projeto ganha `transcricoes` (fala por fonte, tempo DA FONTE: a legenda e o
 *   corte de silêncio saem dela pelo código), `marcadores`, `continuidade`
 *   (personagem e cenário que a IA precisa manter) e `skills_aplicadas`
 *   (histórico curto do que o editor aplicou) e `visoes` (o que o agente viu em
 *   cada trecho, por fonte, para não reprocessar). Transcrição é versionada.
 */

export const VERSAO_DO_FORMATO_DO_PROJETO = 2;

export const TIPOS_DE_TRILHA = ["video", "texto", "legenda", "audio", "sobreposicao"] as const;
export type TipoDeTrilha = (typeof TIPOS_DE_TRILHA)[number];

export const ROTULO_DA_TRILHA: Record<TipoDeTrilha, string> = {
  video: "Vídeo",
  texto: "Texto",
  legenda: "Legenda",
  audio: "Áudio",
  sobreposicao: "Sobreposição",
};

export const TIPOS_DE_TRANSICAO = ["corte", "fade", "dissolver", "deslizar", "zoom"] as const;
export type TipoDeTransicao = (typeof TIPOS_DE_TRANSICAO)[number];

export const FORMATOS_DO_PROJETO: Record<string, { largura: number; altura: number }> = {
  "9:16": { largura: 1080, altura: 1920 },
  "4:5": { largura: 1080, altura: 1350 },
  "1:1": { largura: 1080, altura: 1080 },
  "16:9": { largura: 1920, altura: 1080 },
};

export const FPS_PADRAO = 25;
export const MAX_TRILHAS = 12;
export const MAX_CLIPES_POR_TRILHA = 500;
export const MAX_FONTES = 400;
export const MAX_TEXTO_DO_CLIPE = 500;
/** Duração máxima da linha do tempo (1 hora). */
export const MAX_DURACAO_S = 3600;
/** Trechos de fala guardados no projeto (todas as fontes somadas). */
export const MAX_SEGMENTOS_DE_FALA = 12000;
export const MAX_MARCADORES = 200;
export const MAX_SKILLS_NO_HISTORICO = 40;

export const MIDIAS_DA_FONTE = ["video", "audio", "imagem"] as const;
export type MidiaDaFonte = (typeof MIDIAS_DA_FONTE)[number];

export const MODOS_DE_COMPARAR = ["cortina", "lado_a_lado_h", "lado_a_lado_v", "divisao", "alternar"] as const;
export type ModoDeComparar = (typeof MODOS_DE_COMPARAR)[number];

export const ROTULO_DO_MODO_DE_COMPARAR: Record<ModoDeComparar, string> = {
  cortina: "Cortina",
  lado_a_lado_h: "Lado a lado",
  lado_a_lado_v: "Um em cima do outro",
  divisao: "Divisão com rótulos",
  alternar: "Alternar",
};

export const ORIGENS_DO_CLIPE = ["manual", "skill", "angulo", "continuar", "transicao", "cena"] as const;
export type OrigemDoClipeTipo = (typeof ORIGENS_DO_CLIPE)[number];

export interface TransicaoDoClipe {
  tipo: TipoDeTransicao;
  duracao_s: number;
}

export interface FonteDoProjeto {
  /** Chave curta usada nos clipes e no edl.json (slug do nome). */
  chave: string;
  arquivo_id: string | null;
  nome: string;
  tipo: string;
  storage_bucket: string | null;
  storage_path: string | null;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  /** Formato 2: o que a fonte é (video, audio ou imagem). */
  midia: MidiaDaFonte;
}

/** Antes e depois no mesmo clipe: o clipe é o "antes"; a fonte_b é o "depois". */
export interface CompararDoClipe {
  fonte_b: string;
  entrada_b_s: number;
  modo: ModoDeComparar;
  rotulos: boolean;
  rotulo_a: string;
  rotulo_b: string;
}

export interface OrigemDoClipe {
  tipo: OrigemDoClipeTipo;
  /** Pedido, skill ou clipe de onde veio (texto curto). */
  ref: string | null;
}

/** Um trecho de fala com tempo DA FONTE (s). Curto de propósito: t = texto, i = início, f = fim. */
export interface SegmentoDaFala {
  t: string;
  i: number;
  f: number;
}

export interface TranscricaoDaFonte {
  segmentos: SegmentoDaFala[];
  /** true: cada segmento é uma palavra com tempo medido. false: frases (tempo por palavra é estimado). */
  por_palavra: boolean;
  origem: string | null;
  /** Sobe a cada nova marcação da mesma fonte (transcrição versionada). */
  versao: number;
  em: string | null;
}

/** O que aparece num trecho da fonte, visto por um modelo com imagem (tempo DA FONTE). */
export interface TrechoVisto {
  de_s: number;
  ate_s: number;
  descricao: string;
  quem: string | null;
  plano: string | null;
  qualidade: string | null;
}

export interface VisaoDaFonte {
  trechos: TrechoVisto[];
  modelo: string | null;
  em: string | null;
  /** Quantos quadros o modelo viu. */
  amostras: number;
}

export interface MarcadorDoProjeto {
  id: string;
  tempo_s: number;
  rotulo: string;
}

/** O que a geração (troca de câmera, continuar, transição) precisa manter igual. */
export interface ContinuidadeDoProjeto {
  personagem: string | null;
  cenario: string | null;
  /** Chaves de fontes de referência (rosto, roupa, lugar). */
  referencias: string[];
}

/**
 * Vídeo de referência de edição (a receita é medida e normalizada por
 * editor-video/receita.ts; aqui fica como JSON limitado). Link de rede social
 * fica só como link: nunca é baixado.
 */
export interface ReferenciaDeEdicao {
  id: string;
  nome: string;
  origem: "arquivo" | "link";
  storage_bucket: string | null;
  storage_path: string | null;
  url: string | null;
  rede: "instagram" | "tiktok" | "youtube" | null;
  miniatura: string | null;
  receita: Record<string, unknown> | null;
  fidelidade: "identica" | "proxima" | "inspirada" | "criativa";
  template_id: string | null;
  em: string | null;
}

export const MAX_REFERENCIAS = 12;
const MAX_CHARS_DA_RECEITA = 40000;

export interface SkillAplicada {
  skill: string;
  em: string;
  resumo: string;
}

export interface ClipeDoProjeto {
  id: string;
  /** Chave da fonte (vídeo e áudio); texto e legenda não têm fonte. */
  fonte: string | null;
  /** Onde começa na linha do tempo (s). */
  inicio_s: number;
  /** Trecho da fonte: entrada e saída (s). Sem fonte: a duração é saida_s - entrada_s. */
  entrada_s: number;
  saida_s: number;
  velocidade: number;
  /** 0 a 2 (1 = original). */
  volume: number;
  texto: string | null;
  /** Estilo livre do texto (fonte, cor, posição): quem desenha é a composição. */
  estilo: Record<string, unknown> | null;
  transicao_entrada: TransicaoDoClipe | null;
  transicao_saida: TransicaoDoClipe | null;
  /** Zoom de câmera no clipe (1 = sem zoom). */
  zoom: { de: number; para: number } | null;
  cena_ref: string | null;
  nota: string | null;
  /** Formato 2. */
  comparar: CompararDoClipe | null;
  origem: OrigemDoClipe | null;
}

export interface TrilhaDoProjeto {
  id: string;
  tipo: TipoDeTrilha;
  nome: string;
  muda: boolean;
  oculta: boolean;
  clipes: ClipeDoProjeto[];
}

export interface ProjetoDeEdicao {
  formato_versao: number;
  titulo: string;
  formato: string;
  largura: number;
  altura: number;
  fps: number;
  /** FPS veio do arquivo ou da equipe (false = padrão 25 provisório). */
  fps_informado: boolean;
  duracao_s: number;
  revisao: number;
  roteiro_id: string | null;
  direcao: string | null;
  grade: string;
  fontes: Record<string, FonteDoProjeto>;
  trilhas: TrilhaDoProjeto[];
  atualizado_em: string | null;
  /** Formato 2 (padrões vazios em projeto antigo). */
  transcricoes: Record<string, TranscricaoDaFonte>;
  /** O que o agente "assistiu" por fonte (não reprocessa). */
  visoes: Record<string, VisaoDaFonte>;
  marcadores: MarcadorDoProjeto[];
  continuidade: ContinuidadeDoProjeto;
  skills_aplicadas: SkillAplicada[];
  /** Vídeos de referência de edição com a receita de cada um. */
  referencias: ReferenciaDeEdicao[];
}

// ------------------------------------------------------------------ utilidades

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export const chaveDaFonte = (nome: string) =>
  semAcento(String(nome || "").replace(/\.[a-z0-9]{2,5}$/i, ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "fonte";

const num = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !isFinite(n)) return padrao;
  return Math.max(min, Math.min(max, n));
};
const seg = (n: number) => Math.round(n * 1000) / 1000;
const textoCurto = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

export const duracaoDoClipe = (c: Pick<ClipeDoProjeto, "entrada_s" | "saida_s" | "velocidade">) =>
  seg(Math.max(0, c.saida_s - c.entrada_s) / (c.velocidade > 0 ? c.velocidade : 1));

export function duracaoDoProjeto(trilhas: TrilhaDoProjeto[]): number {
  let fim = 0;
  trilhas.forEach((t) => t.clipes.forEach((c) => (fim = Math.max(fim, c.inicio_s + duracaoDoClipe(c)))));
  return seg(Math.min(MAX_DURACAO_S, fim));
}

export function trilhaVazia(tipo: TipoDeTrilha, n = 1): TrilhaDoProjeto {
  return { id: `${tipo}-${n}`, tipo, nome: `${ROTULO_DA_TRILHA[tipo]}${n > 1 ? ` ${n}` : ""}`, muda: false, oculta: false, clipes: [] };
}

export function clipeNovo(p: Partial<ClipeDoProjeto> & { id: string; inicio_s: number; entrada_s: number; saida_s: number }): ClipeDoProjeto {
  return {
    fonte: null,
    velocidade: 1,
    volume: 1,
    texto: null,
    estilo: null,
    transicao_entrada: null,
    transicao_saida: null,
    zoom: null,
    cena_ref: null,
    nota: null,
    comparar: null,
    origem: null,
    ...p,
  };
}

/** Mídia da fonte pelo tipo do arquivo e pela extensão (projeto antigo não tinha o campo). */
export function midiaDaFonte(tipo: unknown, nome: unknown, caminho?: unknown): MidiaDaFonte {
  const t = String(tipo || "").toLowerCase();
  if (t === "imagem" || t === "quadro") return "imagem";
  if (t === "audio") return "audio";
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(caminho || "")) || /\.([a-z0-9]{2,5})$/i.exec(String(nome || ""));
  const e = m ? m[1].toLowerCase() : "";
  if (["jpg", "jpeg", "png", "webp", "gif", "avif"].indexOf(e) >= 0) return "imagem";
  if (["wav", "mp3", "m4a", "aac", "ogg", "flac"].indexOf(e) >= 0) return "audio";
  return "video";
}

export const continuidadeVazia = (): ContinuidadeDoProjeto => ({ personagem: null, cenario: null, referencias: [] });

// ------------------------------------------------------------------ montar a partir dos takes

export interface TakeParaProjeto {
  id: string;
  nome: string;
  tipo: string;
  storage_bucket: string;
  storage_path: string;
  cena_ref: string | null;
  melhor: boolean;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
}

/**
 * Primeira montagem: os takes escolhidos (já na ordem de montar), inteiros e
 * em sequência na trilha de vídeo. As outras trilhas nascem vazias para o
 * editor. Take sem duração lida entra nas fontes, mas não na linha do tempo.
 */
export function projetoDosTakes(e: {
  titulo: string;
  formato?: string | null;
  fps?: number | null;
  roteiro_id?: string | null;
  direcao?: string | null;
  takes: TakeParaProjeto[];
  agora?: string | null;
}): ProjetoDeEdicao {
  const formato = e.formato && FORMATOS_DO_PROJETO[e.formato] ? e.formato : "9:16";
  const tam = FORMATOS_DO_PROJETO[formato];
  const fpsInformado = typeof e.fps === "number" && e.fps > 0;
  const fontes: Record<string, FonteDoProjeto> = {};
  const video = trilhaVazia("video");
  let cursor = 0;
  e.takes.slice(0, MAX_FONTES).forEach((t, i) => {
    let chave = chaveDaFonte(t.nome);
    if (fontes[chave] && fontes[chave].arquivo_id !== t.id) chave = `${chave}-${i + 1}`;
    fontes[chave] = {
      chave,
      arquivo_id: t.id,
      nome: t.nome,
      tipo: t.tipo,
      storage_bucket: t.storage_bucket,
      storage_path: t.storage_path,
      duracao_s: typeof t.duracao_s === "number" && t.duracao_s > 0 ? seg(t.duracao_s) : null,
      largura: t.largura,
      altura: t.altura,
      midia: midiaDaFonte(t.tipo, t.nome, t.storage_path),
    };
    const d = fontes[chave].duracao_s;
    if (d === null || video.clipes.length >= MAX_CLIPES_POR_TRILHA) return;
    video.clipes.push(clipeNovo({ id: `v${video.clipes.length + 1}`, fonte: chave, inicio_s: seg(cursor), entrada_s: 0, saida_s: Math.round(d * 100) / 100, cena_ref: t.cena_ref }));
    cursor += Math.round(d * 100) / 100;
  });
  const trilhas = [video, trilhaVazia("texto"), trilhaVazia("legenda"), trilhaVazia("audio"), trilhaVazia("sobreposicao")];
  return {
    formato_versao: VERSAO_DO_FORMATO_DO_PROJETO,
    titulo: String(e.titulo || "Vídeo").slice(0, 120),
    formato,
    largura: tam.largura,
    altura: tam.altura,
    fps: fpsInformado ? (e.fps as number) : FPS_PADRAO,
    fps_informado: fpsInformado,
    duracao_s: duracaoDoProjeto(trilhas),
    revisao: 0,
    roteiro_id: e.roteiro_id || null,
    direcao: e.direcao ? String(e.direcao).slice(0, 2000) : null,
    grade: "none",
    fontes,
    trilhas,
    atualizado_em: e.agora || null,
    transcricoes: {},
    visoes: {},
    marcadores: [],
    continuidade: continuidadeVazia(),
    skills_aplicadas: [],
    referencias: [],
  };
}

// ------------------------------------------------------------------ edl.json (projetos Remotion do dono)

export interface EdlDoProjeto {
  version: number;
  sources: Record<string, string>;
  fps: number;
  ranges: { source: string; start: number; end: number }[];
  grade: string;
  overlays: { tipo: string; start: number; end: number; texto: string | null; source: string | null }[];
  total_duration_s: number;
  note: string;
}

/**
 * edl.json no formato dos projetos em Videos/ (version, sources, fps, ranges,
 * grade, overlays, total_duration_s, note): ranges = clipes da primeira trilha
 * de vídeo na ordem da linha do tempo; overlays = texto e sobreposição.
 */
export function edlDoProjeto(p: ProjetoDeEdicao, nota?: string): EdlDoProjeto {
  const sources: Record<string, string> = {};
  Object.keys(p.fontes).forEach((k) => {
    sources[k] = p.fontes[k].nome;
  });
  const video = p.trilhas.find((t) => t.tipo === "video" && !t.oculta) || null;
  const clipes = video ? video.clipes.filter((c) => c.fonte).slice().sort((a, b) => a.inicio_s - b.inicio_s) : [];
  const ranges = clipes.map((c) => ({ source: String(c.fonte), start: c.entrada_s, end: c.saida_s }));
  const overlays: EdlDoProjeto["overlays"] = [];
  p.trilhas
    .filter((t) => (t.tipo === "texto" || t.tipo === "sobreposicao") && !t.oculta)
    .forEach((t) => t.clipes.forEach((c) => overlays.push({ tipo: t.tipo, start: c.inicio_s, end: seg(c.inicio_s + duracaoDoClipe(c)), texto: c.texto, source: c.fonte })));
  const total = clipes.reduce((s, c) => s + duracaoDoClipe(c), 0);
  return {
    version: 1,
    sources,
    fps: p.fps,
    ranges,
    grade: p.grade || "none",
    overlays,
    total_duration_s: Math.round(total * 100) / 100,
    note: nota || `Montagem do projeto de edição (revisão ${p.revisao}).${p.fps_informado ? "" : ` FPS ${FPS_PADRAO} provisório: confira no arquivo.`}`,
  };
}

// ------------------------------------------------------------------ validar (o que vem da tela ou do agente)

function transicao(v: unknown): TransicaoDoClipe | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const tipo = String(o.tipo || "");
  if ((TIPOS_DE_TRANSICAO as readonly string[]).indexOf(tipo) < 0) return null;
  return { tipo: tipo as TipoDeTransicao, duracao_s: seg(num(o.duracao_s, 0, 5, 0.3)) };
}

function clipe(v: unknown, fontes: Record<string, FonteDoProjeto>, i: number): ClipeDoProjeto | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const fonte = o.fonte && fontes[String(o.fonte)] ? String(o.fonte) : null;
  const entrada = seg(num(o.entrada_s, 0, MAX_DURACAO_S, 0));
  const saida = seg(num(o.saida_s, 0, MAX_DURACAO_S, entrada));
  if (saida <= entrada) return null;
  const zoom = o.zoom && typeof o.zoom === "object" ? (o.zoom as Record<string, unknown>) : null;
  return {
    id: textoCurto(o.id, 40) || `c${i + 1}`,
    fonte,
    inicio_s: seg(num(o.inicio_s, 0, MAX_DURACAO_S, 0)),
    entrada_s: entrada,
    saida_s: saida,
    velocidade: num(o.velocidade, 0.25, 4, 1),
    volume: num(o.volume, 0, 2, 1),
    texto: textoCurto(o.texto, MAX_TEXTO_DO_CLIPE),
    estilo: o.estilo && typeof o.estilo === "object" && !Array.isArray(o.estilo) ? (JSON.parse(JSON.stringify(o.estilo)) as Record<string, unknown>) : null,
    transicao_entrada: transicao(o.transicao_entrada),
    transicao_saida: transicao(o.transicao_saida),
    zoom: zoom ? { de: num(zoom.de, 0.5, 4, 1), para: num(zoom.para, 0.5, 4, 1) } : null,
    cena_ref: textoCurto(o.cena_ref, 40),
    nota: textoCurto(o.nota, 300),
    comparar: comparar(o.comparar, fontes),
    origem: origem(o.origem),
  };
}

function comparar(v: unknown, fontes: Record<string, FonteDoProjeto>): CompararDoClipe | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const fonte = o.fonte_b ? String(o.fonte_b) : "";
  if (!fonte || !fontes[fonte]) return null;
  const modo = (MODOS_DE_COMPARAR as readonly string[]).indexOf(String(o.modo)) >= 0 ? (String(o.modo) as ModoDeComparar) : "cortina";
  return {
    fonte_b: fonte,
    entrada_b_s: seg(num(o.entrada_b_s, 0, MAX_DURACAO_S, 0)),
    modo,
    rotulos: o.rotulos !== false,
    rotulo_a: textoCurto(o.rotulo_a, 30) || "Antes",
    rotulo_b: textoCurto(o.rotulo_b, 30) || "Depois",
  };
}

function origem(v: unknown): OrigemDoClipe | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const tipo = (ORIGENS_DO_CLIPE as readonly string[]).indexOf(String(o.tipo)) >= 0 ? (String(o.tipo) as OrigemDoClipeTipo) : null;
  return tipo ? { tipo, ref: textoCurto(o.ref, 80) } : null;
}

function transcricoes(v: unknown, fontes: Record<string, FonteDoProjeto>): Record<string, TranscricaoDaFonte> {
  const saida: Record<string, TranscricaoDaFonte> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return saida;
  const o = v as Record<string, unknown>;
  let total = 0;
  Object.keys(o).forEach((k) => {
    const chave = chaveDaFonte(k);
    if (!fontes[chave]) return;
    const x = o[k] && typeof o[k] === "object" ? (o[k] as Record<string, unknown>) : null;
    if (!x || !Array.isArray(x.segmentos)) return;
    const segmentos: SegmentoDaFala[] = [];
    (x.segmentos as unknown[]).forEach((s) => {
      if (total >= MAX_SEGMENTOS_DE_FALA || !s || typeof s !== "object") return;
      const y = s as Record<string, unknown>;
      const t = textoCurto(y.t, 120);
      const i = seg(num(y.i, 0, MAX_DURACAO_S, -1));
      const f = seg(num(y.f, 0, MAX_DURACAO_S, -1));
      if (!t || i < 0 || f <= i) return;
      segmentos.push({ t, i, f });
      total++;
    });
    segmentos.sort((a, b) => a.i - b.i);
    saida[chave] = {
      segmentos,
      por_palavra: x.por_palavra === true,
      origem: textoCurto(x.origem, 60),
      versao: Math.max(1, Math.floor(num(x.versao, 1, 1e6, 1))),
      em: textoCurto(x.em, 40),
    };
  });
  return saida;
}

export const MAX_TRECHOS_VISTOS = 120;

function visoes(v: unknown, fontes: Record<string, FonteDoProjeto>): Record<string, VisaoDaFonte> {
  const saida: Record<string, VisaoDaFonte> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return saida;
  const o = v as Record<string, unknown>;
  Object.keys(o).forEach((k) => {
    const chave = chaveDaFonte(k);
    if (!fontes[chave]) return;
    const x = o[k] && typeof o[k] === "object" ? (o[k] as Record<string, unknown>) : null;
    if (!x || !Array.isArray(x.trechos)) return;
    const trechos: TrechoVisto[] = [];
    (x.trechos as unknown[]).slice(0, MAX_TRECHOS_VISTOS).forEach((t) => {
      const y = t && typeof t === "object" ? (t as Record<string, unknown>) : null;
      if (!y) return;
      const de = seg(num(y.de_s, 0, MAX_DURACAO_S, -1));
      const ate = seg(num(y.ate_s, 0, MAX_DURACAO_S, -1));
      const descricao = textoCurto(y.descricao, 300);
      if (de < 0 || ate < de || !descricao) return;
      trechos.push({ de_s: de, ate_s: ate, descricao, quem: textoCurto(y.quem, 120), plano: textoCurto(y.plano, 60), qualidade: textoCurto(y.qualidade, 120) });
    });
    trechos.sort((a, b) => a.de_s - b.de_s);
    saida[chave] = { trechos, modelo: textoCurto(x.modelo, 80), em: textoCurto(x.em, 40), amostras: Math.max(0, Math.floor(num(x.amostras, 0, 10000, 0))) };
  });
  return saida;
}

function marcadores(v: unknown): MarcadorDoProjeto[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_MARCADORES)
    .map((m, i) => {
      const o = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
      if (!o) return null;
      return { id: textoCurto(o.id, 40) || `m${i + 1}`, tempo_s: seg(num(o.tempo_s, 0, MAX_DURACAO_S, 0)), rotulo: textoCurto(o.rotulo, 80) || "Marcador" };
    })
    .filter((m): m is MarcadorDoProjeto => !!m);
}

function continuidade(v: unknown, fontes: Record<string, FonteDoProjeto>): ContinuidadeDoProjeto {
  if (!v || typeof v !== "object") return continuidadeVazia();
  const o = v as Record<string, unknown>;
  const refs = Array.isArray(o.referencias) ? o.referencias.map((r) => String(r)).filter((r) => !!fontes[r]).slice(0, 8) : [];
  return { personagem: textoCurto(o.personagem, 400), cenario: textoCurto(o.cenario, 400), referencias: refs };
}

function skillsAplicadas(v: unknown): SkillAplicada[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
      const skill = o ? textoCurto(o.skill, 40) : null;
      return o && skill ? { skill, em: textoCurto(o.em, 40) || "", resumo: textoCurto(o.resumo, 200) || "" } : null;
    })
    .filter((x): x is SkillAplicada => !!x)
    .slice(-MAX_SKILLS_NO_HISTORICO);
}

/** Projeto em forma segura (limites, tipos, fontes conhecidas). Null quando não é um projeto. */
export function normalizarProjeto(v: unknown): ProjetoDeEdicao | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.trilhas)) return null;
  const fontes: Record<string, FonteDoProjeto> = {};
  const brutas = o.fontes && typeof o.fontes === "object" ? (o.fontes as Record<string, unknown>) : {};
  Object.keys(brutas)
    .slice(0, MAX_FONTES)
    .forEach((k) => {
      const f = brutas[k] && typeof brutas[k] === "object" ? (brutas[k] as Record<string, unknown>) : null;
      if (!f) return;
      const chave = chaveDaFonte(k);
      const d = Number(f.duracao_s);
      fontes[chave] = {
        chave,
        arquivo_id: textoCurto(f.arquivo_id, 40),
        nome: textoCurto(f.nome, 255) || chave,
        tipo: textoCurto(f.tipo, 20) || "bruto",
        storage_bucket: textoCurto(f.storage_bucket, 60),
        storage_path: textoCurto(f.storage_path, 400),
        duracao_s: isFinite(d) && d > 0 ? seg(d) : null,
        largura: Number(f.largura) > 0 ? Math.round(Number(f.largura)) : null,
        altura: Number(f.altura) > 0 ? Math.round(Number(f.altura)) : null,
        midia: (MIDIAS_DA_FONTE as readonly string[]).indexOf(String(f.midia)) >= 0 ? (String(f.midia) as MidiaDaFonte) : midiaDaFonte(f.tipo, f.nome, f.storage_path),
      };
    });
  const trilhas: TrilhaDoProjeto[] = (o.trilhas as unknown[])
    .slice(0, MAX_TRILHAS)
    .map((t, i) => {
      const x = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
      const tipo = (TIPOS_DE_TRILHA as readonly string[]).indexOf(String(x.tipo)) >= 0 ? (String(x.tipo) as TipoDeTrilha) : null;
      if (!tipo) return null;
      return {
        id: textoCurto(x.id, 40) || `${tipo}-${i + 1}`,
        tipo,
        nome: textoCurto(x.nome, 60) || ROTULO_DA_TRILHA[tipo],
        muda: x.muda === true,
        oculta: x.oculta === true,
        clipes: (Array.isArray(x.clipes) ? x.clipes : [])
          .slice(0, MAX_CLIPES_POR_TRILHA)
          .map((c, j) => clipe(c, fontes, j))
          .filter((c): c is ClipeDoProjeto => !!c),
      };
    })
    .filter((t): t is TrilhaDoProjeto => !!t);
  const formato = FORMATOS_DO_PROJETO[String(o.formato)] ? String(o.formato) : "9:16";
  const tam = FORMATOS_DO_PROJETO[formato];
  const fps = num(o.fps, 1, 120, FPS_PADRAO);
  return {
    formato_versao: VERSAO_DO_FORMATO_DO_PROJETO,
    titulo: textoCurto(o.titulo, 120) || "Vídeo",
    formato,
    largura: Number(o.largura) > 0 ? Math.round(num(o.largura, 16, 8192, tam.largura)) : tam.largura,
    altura: Number(o.altura) > 0 ? Math.round(num(o.altura, 16, 8192, tam.altura)) : tam.altura,
    fps,
    fps_informado: o.fps_informado === true,
    duracao_s: duracaoDoProjeto(trilhas),
    revisao: Math.max(0, Math.floor(num(o.revisao, 0, 1e9, 0))),
    roteiro_id: textoCurto(o.roteiro_id, 40),
    direcao: textoCurto(o.direcao, 2000),
    grade: textoCurto(o.grade, 40) || "none",
    fontes,
    trilhas,
    atualizado_em: textoCurto(o.atualizado_em, 40),
    transcricoes: transcricoes(o.transcricoes, fontes),
    visoes: visoes(o.visoes, fontes),
    marcadores: marcadores(o.marcadores),
    continuidade: continuidade(o.continuidade, fontes),
    skills_aplicadas: skillsAplicadas(o.skills_aplicadas),
    referencias: referencias(o.referencias),
  };
}

function referencias(v: unknown): ReferenciaDeEdicao[] {
  if (!Array.isArray(v)) return [];
  const saida: ReferenciaDeEdicao[] = [];
  v.slice(0, MAX_REFERENCIAS).forEach((x, i) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    if (!o) return;
    const url = textoCurto(o.url, 600);
    const caminho = textoCurto(o.storage_path, 400);
    if (!url && !caminho) return;
    let receita: Record<string, unknown> | null = null;
    if (o.receita && typeof o.receita === "object" && !Array.isArray(o.receita)) {
      const s = JSON.stringify(o.receita);
      if (s.length <= MAX_CHARS_DA_RECEITA) receita = JSON.parse(s) as Record<string, unknown>;
    }
    const rede = o.rede === "instagram" || o.rede === "tiktok" || o.rede === "youtube" ? o.rede : null;
    const fid = o.fidelidade === "proxima" || o.fidelidade === "inspirada" || o.fidelidade === "criativa" ? o.fidelidade : "identica";
    const mini = textoCurto(o.miniatura, 600);
    saida.push({
      id: textoCurto(o.id, 40) || `r${i + 1}`,
      nome: textoCurto(o.nome, 120) || "Referência",
      origem: caminho ? "arquivo" : "link",
      storage_bucket: caminho ? textoCurto(o.storage_bucket, 60) || "mesa" : null,
      storage_path: caminho,
      url,
      rede,
      miniatura: mini && /^https:\/\//.test(mini) ? mini : null,
      receita,
      fidelidade: fid,
      template_id: textoCurto(o.template_id, 40),
      em: textoCurto(o.em, 40),
    });
  });
  return saida;
}

/** Formato em que o projeto foi gravado (sem o campo: 1). */
export function versaoDoFormato(v: unknown): number {
  if (!v || typeof v !== "object") return 0;
  const n = Number((v as Record<string, unknown>).formato_versao);
  return isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * Abre projeto de qualquer formato já gravado no formato atual. Formato 1 (E2):
 * ganha midia nas fontes, comparar/origem nos clipes e as listas novas vazias,
 * sem mexer em tempo nenhum. Formato mais novo que este código: abre o que
 * entende e avisa (quem salvar perde o que não entende).
 */
export function migrarProjeto(v: unknown): { projeto: ProjetoDeEdicao | null; de: number; aviso: string | null } {
  const de = versaoDoFormato(v);
  const projeto = normalizarProjeto(v);
  const aviso = de > VERSAO_DO_FORMATO_DO_PROJETO ? "Este projeto foi salvo por um editor mais novo. Recarregue a página antes de editar." : null;
  return { projeto, de, aviso };
}

/**
 * Próxima revisão para gravar: confere a revisão que quem salva leu (trava
 * otimista). Revisão diferente = alguém salvou antes: recusa com o motivo.
 */
export function proximaRevisao(atual: ProjetoDeEdicao | null, novo: ProjetoDeEdicao, revisaoLida: number | null, agora: string): ProjetoDeEdicao {
  const base = atual ? atual.revisao : 0;
  if (atual && revisaoLida !== null && revisaoLida !== base) {
    throw new Error(`O projeto mudou desde que você abriu (revisão ${base}). Abra de novo antes de salvar.`);
  }
  return { ...novo, revisao: base + 1, atualizado_em: agora };
}

/** Tamanho do projeto gravado (o banco guarda até ~1 MB). */
export const tamanhoDoProjeto = (p: ProjetoDeEdicao) => JSON.stringify(p).length;
export const MAX_BYTES_DO_PROJETO = 1000000;
