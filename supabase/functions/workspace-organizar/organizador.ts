/**
 * Organizador inteligente do Workspace do cliente (frente OR, 29/09/2026).
 *
 * Pedido do dono: "quando eu clico em Organizar, tem que ser inteligente:
 * entender a foto, entender o que é antes e depois, nomear, deixar essa foto
 * combinando com essa, tudo bem organizado... criar uma pasta de carrosséis e,
 * dentro, uma pasta por carrossel com o tema e todas as artes desse tema.
 * Fotos de antes e depois juntas numa pasta com a ideia."
 *
 * Este módulo recebe os arquivos já LIDOS (a leitura por visão acontece em
 * index.ts, em lotes e com cópia leve) e monta a PRÉVIA: as pastas, a ordem,
 * os nomes novos, o que ficou em dúvida e o que fica onde está. Nada é movido
 * aqui. Quem decide o que o código não sabe é o Jev (TypeSafe), por perguntas
 * pequenas e tipadas:
 * - Choice do tipo quando a visão ficou em dúvida (confiança baixa);
 * - Noul "mesmo carrossel?" para os pares de lâminas que o código achou
 *   parecidos, mas não o bastante;
 * - Choice "qual depois é o par deste antes?" quando há mais de um candidato;
 * - Score da posição da lâmina na sequência quando a arte não traz número.
 *
 * Regras fixas continuam no código: duplicata exata (mesmo conteúdo), versões
 * pelo nome (v1, v2, final), distância de paleta, numeração visível, extensão.
 *
 * Puro: sem Deno, sem banco, sem provedor. O Jev entra por `perguntar`
 * (injetado), e o teste (vitest) usa um Jev de mentira.
 */

/**
 * Perguntas e respostas do Jev no mesmo formato de _shared/jev.ts (declaradas
 * aqui para a tela poder ler os tipos deste arquivo sem puxar o Deno).
 */
export type PerguntaJev =
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: string[] }
  | { type: "noul"; instructions: unknown; criteria?: { true: unknown; false: unknown } };
export type RespostaJev = { choice?: string; confidence?: number; probabilities?: Record<string, number>; score?: number; noul?: number };

// ------------------------------------------------------------------ tipos

export const TIPOS = [
  "carrossel",
  "post",
  "story",
  "reel",
  "video",
  "foto",
  "antes",
  "depois",
  "antes_depois",
  "logo",
  "referencia",
  "documento",
  "outro",
] as const;
export type Tipo = (typeof TIPOS)[number];

/** O que cada tipo quer dizer (vai para o leitor e para o Jev). */
export const SIGNIFICADO_DO_TIPO: Record<Tipo, string> = {
  carrossel: "lâmina de um carrossel do Instagram (uma parte de uma sequência de artes do mesmo card: numeração, seta, 'arrasta', texto que continua, capa ou fechamento de sequência)",
  post: "arte única de feed (card com texto e/ou foto, promoção, frase, anúncio), sem sinal de ser parte de uma sequência",
  story: "arte vertical de story (9:16), com enquete, caixa de pergunta, figurinha, 'arrasta pra cima' ou elementos típicos de story",
  reel: "capa de reel ou quadro de vídeo vertical curto com texto de gancho, feito para o feed de vídeos",
  video: "vídeo bruto ou gravação sem arte de design (take, bastidor, filmagem crua)",
  foto: "foto real de produto, serviço, ambiente, equipe ou cliente, sem arte de design por cima",
  antes: "foto do estado ANTES de um serviço (sujo, quebrado, velho, vazio, sem tratamento)",
  depois: "foto do resultado DEPOIS de um serviço (limpo, consertado, pronto, transformado)",
  antes_depois: "uma imagem só com o antes e o depois juntos (lado a lado ou em cima e embaixo)",
  logo: "logotipo, símbolo, variação da marca ou página de manual de marca",
  referencia: "referência ou print: captura de tela, inspiração de outra marca ou perfil, post de terceiros, moodboard",
  documento: "documento, planilha, contrato, orçamento, texto corrido ou nota",
  outro: "nada disso",
};

/** Pastas de primeiro nível que o organizador cria (no nível onde a pessoa está). */
export const PASTAS = {
  carrosseis: "Carrosséis",
  antes_depois: "Antes e depois",
  posts: "Posts",
  stories: "Stories",
  reels: "Reels",
  videos: "Vídeos",
  fotos: "Fotos",
  logos: "Logos e marca",
  referencias: "Referências",
  documentos: "Documentos",
  artes: "Artes editáveis",
  audios: "Áudios",
  duplicadas: "Duplicadas",
} as const;
export type Categoria = keyof typeof PASTAS;

export const ORDEM_DAS_CATEGORIAS: Categoria[] = [
  "carrosseis",
  "antes_depois",
  "posts",
  "stories",
  "reels",
  "videos",
  "fotos",
  "logos",
  "referencias",
  "documentos",
  "artes",
  "audios",
  "duplicadas",
];

const CATEGORIA_DO_TIPO: Partial<Record<Tipo, Categoria>> = {
  post: "posts",
  story: "stories",
  reel: "reels",
  video: "videos",
  foto: "fotos",
  logo: "logos",
  referencia: "referencias",
  documento: "documentos",
};

/** Leitura de uma imagem (ou do quadro de um vídeo) pela visão. */
export type Leitura = {
  tipo: Tipo;
  /** 0 a 1: quanto o leitor tem certeza do tipo. */
  confianca: number;
  /** Assunto em poucas palavras ("limpeza de sofá"). */
  tema: string;
  /** Texto que aparece na imagem (exato, curto). */
  texto: string;
  /** Uma frase do que se vê. */
  descricao: string;
  /** Identidade visual em poucas palavras (cores, letra, layout): igual nas artes da mesma série. */
  identidade: string;
  /**
   * Assunto do card INTEIRO a que a lâmina pertence (igual em todas as lâminas
   * do mesmo carrossel); vazio quando não é sequência.
   */
  serie: string;
  /** Textos fixos que se repetem na série (cabeçalho, rodapé, @ do perfil, nome da série), exatos. */
  fixos: string;
  /** Até 4 cores dominantes (#rrggbb). */
  paleta: string[];
  /** Número da lâmina visível na arte (2 de "2/5"). */
  numero: number | null;
  /** Total visível (5 de "2/5"). */
  total: number | null;
  capa: boolean;
  fechamento: boolean;
  /** Objeto ou lugar exato (fotos, antes e depois). */
  objeto: string;
};

export type Situacao = "publicado" | "aprovado" | "em_aprovacao" | null;

/** Um arquivo que pode ser organizado. */
export type Candidato = {
  id: string;
  nome: string;
  mime: string | null;
  tamanho: number | null;
  duracao: number | null;
  largura: number | null;
  altura: number | null;
  /** Pastas entre o nível organizado e o arquivo ([] = solto no nível). */
  caminho: string[];
  /** Conteúdo (SHA-256) quando lido; duplicata exata. */
  hash: string | null;
  criado_em: string;
  storage_path: string | null;
  leitura: Leitura | null;
  /** Motivo em português quando não deu para ler (arquivo quebrado, recusado...). */
  falha: string | null;
  situacao: Situacao;
};

export type ItemDaPrevia = {
  id: string;
  nome_atual: string;
  nome_novo: string;
  tipo: Tipo | "arquivo";
  /** Posição dentro do grupo (lâminas do carrossel, versões). */
  ordem: number | null;
  /** Por que está aqui, em português ("lâmina 2 de 5 pela numeração na arte"). */
  motivo: string;
  /** Preenchido quando a decisão não é firme: a pessoa confere. */
  duvida: string | null;
  situacao: Situacao;
  storage_path: string | null;
  mime: string | null;
  /** O arquivo já está nesta pasta (só muda o nome). */
  ja_esta_aqui: boolean;
};

export type GrupoDaPrevia = {
  chave: string;
  categoria: Categoria;
  /** Pastas a partir do nível organizado (["Carrosséis", "Limpeza de sofá"]). */
  caminho: string[];
  /** A ideia do grupo numa linha ("5 lâminas, ordem pela numeração"). */
  ideia: string;
  itens: ItemDaPrevia[];
};

export type ItemQueFica = { id: string; nome: string; motivo: string; storage_path: string | null; mime: string | null };

export type Previa = {
  grupos: GrupoDaPrevia[];
  /** Não sai do lugar, com o motivo (quebrado, não lido, tipo desconhecido). */
  ficam: ItemQueFica[];
  /** Quantos itens estão marcados com dúvida. */
  duvidas: number;
  /** Já estavam no lugar certo com o nome certo. */
  ja_organizados: number;
  duplicadas: number;
  resumo: string;
  /** Perguntas feitas ao Jev (para o custo e a transparência). */
  decisoes_do_jev: number;
};

export type Perguntar = (state: unknown, questions: Record<string, PerguntaJev>) => Promise<Record<string, RespostaJev>>;

// ------------------------------------------------------------------ texto

export const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const normal = (t: string) => semAcento(t).toLowerCase().replace(/\s+/g, " ").trim();

const PALAVRAS_VAZIAS = new Set(
  "a o as os de da do das dos e em no na nos nas um uma uns umas para pra por com sem que se ao aos the and of to in on for with".split(" "),
);

export function palavras(t: string): string[] {
  return normal(t)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((p) => p.length > 1 && !PALAVRAS_VAZIAS.has(p));
}

export function jaccard(a: string, b: string): number {
  const A = new Set(palavras(a));
  const B = new Set(palavras(b));
  if (!A.size || !B.size) return 0;
  let comum = 0;
  A.forEach((p) => {
    if (B.has(p)) comum++;
  });
  return comum / (A.size + B.size - comum);
}

/** Uma linha limpa, sem barra e sem caractere de controle (nome de arquivo ou pasta). */
export function limparNome(v: unknown, max = 80): string {
  const semControle = Array.from(String(v ?? ""))
    .map((ch) => (ch.charCodeAt(0) < 32 ? " " : ch))
    .join("");
  return semControle
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s*[–—]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[\s.-]+$/g, "")
    .trim();
}

/** "limpeza de sofá" -> "Limpeza de sofá". */
export function frase(t: string): string {
  const s = limparNome(t, 60);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/** Poucas palavras de um texto, para nome de lâmina ("Três erros que..."). */
export function curto(t: string, maxPalavras = 5, maxLetras = 40): string {
  const s = limparNome(t, 200)
    .replace(/[#@“”"‘’'«»]+/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, maxPalavras)
    .join(" ");
  return semGritar(limparNome(s, maxLetras));
}

/** Texto de arte em caixa alta ("VOCÊ NÃO PERCEBE") vira frase normal no nome ("Você não percebe"). */
export function semGritar(t: string): string {
  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letras.length < 4) return t;
  const maiusculas = letras.replace(/[^A-ZÀ-Þ]/g, "").length;
  if (maiusculas / letras.length < 0.6) return t;
  const minusculo = t.toLocaleLowerCase("pt-BR");
  return minusculo.charAt(0).toLocaleUpperCase("pt-BR") + minusculo.slice(1);
}

export function extensao(nome: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(nome || "").trim());
  return m ? m[1].toLowerCase() : "";
}

export function semExtensao(nome: string): string {
  const e = extensao(nome);
  return e ? nome.slice(0, nome.length - e.length - 1) : nome;
}

/** O nome novo nunca perde a extensão do arquivo. */
export function comExtensao(novo: string, original: string): string {
  const ext = extensao(original);
  const base = limparNome(semExtensao(novo) || semExtensao(original), 100) || "arquivo";
  return ext ? `${base}.${ext}` : base;
}

/**
 * Nome que não diz nada (câmera, celular, print, número, id): pode trocar.
 * Nome escrito pela pessoa ("Logo principal.png") fica.
 */
export function nomeGenerico(nome: string): boolean {
  const s = normal(semExtensao(nome).replace(/_+/g, " "));
  if (!s) return true;
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}/.test(s)) return true;
  if (/^[0-9a-f]{16,}$/.test(s.replace(/[\s._-]/g, ""))) return true;
  const semSeparador = s.replace(/[\s._()-]/g, "");
  if (!semSeparador || /^\d+$/.test(semSeparador)) return true;
  const digitos = (semSeparador.match(/\d/g) || []).length;
  if (digitos / semSeparador.length >= 0.6) return true;
  return /^(img|image|imagem|dsc|dscn|dcim|pxl|mvimg|photo|foto|picture|screenshot|screen shot|captura de tela|captura|print|whatsapp image|whatsapp video|whatsapp|wa|design sem nome|sem titulo|untitled|download|arquivo|file|video|vid|mov|reel|story|stories|post|canva|snapchat|telegram|ig|insta|instagram|received|copia de|copy of)\b[\s._()\d-]*(de|at|as|em)?[\s._()\d:hms-]*$/.test(s);
}

/** Número que o NOME traz no fim ("dicas-3.png" -> 3), para série de lâminas. */
export function numeroDoNome(nome: string): number | null {
  const m = /(?:^|[^0-9])0*(\d{1,2})(?:\s*\)|\s*)$/.exec(normal(semExtensao(nome)));
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 40 ? n : null;
}

/** Raiz do nome sem número, versão e cópia ("Dicas de sofá - 02" -> "dicas de sofa"). */
export function raizDoNome(nome: string): string {
  return normal(semExtensao(nome))
    .replace(/[\s._-]*(\(\d+\)|copia( \d+)?|copy( \d+)?)$/g, "")
    .replace(/[\s._-]*(v|ver|versao|version|rev)\s*\d+$/g, "")
    .replace(/[\s._-]*(final|finalizado|ok|aprovado|corrigido)$/g, "")
    .replace(/[\s._-]*\d{1,3}$/g, "")
    .replace(/[\s._-]+/g, " ")
    .trim();
}

/** Versão pelo nome: "arte v2", "arte_final", "arte (1)" -> número da versão ou null. */
export function versaoDoNome(nome: string): number | null {
  const s = normal(semExtensao(nome));
  const v = /(?:^|[\s._-])(?:v|ver|versao|version|rev)\s*0*(\d{1,2})$/.exec(s);
  if (v) return Number(v[1]);
  if (/(?:^|[\s._-])(final|finalizado|aprovado|corrigido)$/.test(s)) return 99;
  const copia = /\((\d{1,2})\)$/.exec(s);
  if (copia) return Number(copia[1]) + 1;
  return null;
}

// ------------------------------------------------------------------ leitura

const numeroOuNulo = (v: unknown, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

const HEX = /^#?[0-9a-f]{6}$/i;

/** Leitura que veio do modelo (ou da tela) conferida campo a campo. Null quando não serve. */
export function normalizarLeitura(bruta: unknown): Leitura | null {
  if (!bruta || typeof bruta !== "object") return null;
  const b = bruta as Record<string, unknown>;
  const tipo = String(b.tipo || "").toLowerCase().trim() as Tipo;
  if (TIPOS.indexOf(tipo) < 0) return null;
  const confianca = Math.max(0, Math.min(1, Number(b.confianca)));
  const paleta = (Array.isArray(b.paleta) ? b.paleta : [])
    .map((c) => String(c || "").trim())
    .filter((c) => HEX.test(c))
    .map((c) => (c.charAt(0) === "#" ? c : `#${c}`).toLowerCase())
    .slice(0, 4);
  const numero = numeroOuNulo(b.numero, 40);
  let total = numeroOuNulo(b.total, 40);
  if (total !== null && numero !== null && numero > total) total = null;
  return {
    tipo,
    confianca: Number.isFinite(confianca) ? confianca : 0.5,
    tema: limparNome(b.tema, 60),
    texto: String(b.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    descricao: String(b.descricao ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
    identidade: String(b.identidade ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
    serie: limparNome(b.serie, 80),
    fixos: String(b.fixos ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
    paleta,
    numero,
    total,
    capa: b.capa === true,
    fechamento: b.fechamento === true,
    objeto: String(b.objeto ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
  };
}

/** Tipo pelo que se sabe sem visão (nome, extensão, mime, duração). */
export function tipoSemLeitura(c: Pick<Candidato, "nome" | "mime" | "duracao" | "largura" | "altura">): { categoria: Categoria | null; tipo: Tipo | "arquivo"; duvida: string | null } {
  const ext = extensao(c.nome);
  const mime = String(c.mime || "").toLowerCase();
  const nome = normal(c.nome);
  if (/^(pdf|docx?|odt|rtf|txt|md|xlsx?|csv|ods|pptx?|key|odp)$/.test(ext)) return { categoria: "documentos", tipo: "documento", duvida: null };
  if (/^(svg|ai|eps|psd|fig|indd|cdr|xd|sketch)$/.test(ext)) {
    if (/(logo|marca|brand|simbolo|identidade)/.test(nome)) return { categoria: "logos", tipo: "logo", duvida: null };
    return { categoria: "artes", tipo: "arquivo", duvida: null };
  }
  if (/^(mp3|wav|m4a|ogg|aac|flac)$/.test(ext) || mime.indexOf("audio/") === 0) return { categoria: "audios", tipo: "arquivo", duvida: null };
  if (mime.indexOf("video/") === 0 || /^(mp4|mov|m4v|webm|mkv|avi)$/.test(ext)) {
    const vertical = !!c.largura && !!c.altura && c.altura > c.largura;
    const curtoVideo = !!c.duracao && c.duracao <= 90;
    if (/(reel|reels)/.test(nome) || (vertical && curtoVideo)) return { categoria: "reels", tipo: "reel", duvida: "vídeo sem quadro lido: tipo pelo nome e pelo formato" };
    if (/(story|stories)/.test(nome)) return { categoria: "stories", tipo: "story", duvida: "vídeo sem quadro lido: tipo pelo nome" };
    return { categoria: "videos", tipo: "video", duvida: c.duracao ? null : "vídeo sem quadro lido: tipo pelo nome" };
  }
  return { categoria: null, tipo: "arquivo", duvida: null };
}

// ------------------------------------------------------------------ cores

function rgb(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** 0 a 1: quanto as duas paletas se parecem (média da cor mais próxima, nos dois sentidos). */
export function paletaParecida(a: string[], b: string[]): number {
  const A = a.map(rgb).filter(Boolean) as Array<[number, number, number]>;
  const B = b.map(rgb).filter(Boolean) as Array<[number, number, number]>;
  if (!A.length || !B.length) return 0;
  const maxDist = Math.sqrt(3 * 255 * 255);
  const lado = (X: typeof A, Y: typeof A) =>
    X.reduce((s, x) => s + Math.min(...Y.map((y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]))), 0) / X.length;
  const d = (lado(A, B) + lado(B, A)) / 2;
  return Math.max(0, 1 - d / (maxDist * 0.35));
}

// ------------------------------------------------------------------ carrosséis

/** Semelhança entre duas lâminas (0 a 1) pelo que o código sabe comparar. */
export function semelhancaDeLaminas(a: Candidato, b: Candidato, mesmaRajada = false): number {
  const la = a.leitura!;
  const lb = b.leitura!;
  const assunto = Math.max(jaccard(la.tema, lb.tema), jaccard(la.serie, lb.serie));
  let s = 0.25 * paletaParecida(la.paleta, lb.paleta) + 0.2 * jaccard(la.identidade, lb.identidade) + 0.3 * assunto;
  // Os mesmos textos fixos (cabeçalho, rodapé, nome da série) são a marca mais forte da mesma sequência.
  if (la.fixos && lb.fixos) s += 0.25 * jaccard(la.fixos, lb.fixos);
  if (mesmaRajada) s += 0.1;
  if (la.total && lb.total) s += la.total === lb.total ? 0.15 : -0.4;
  if (la.numero && lb.numero && la.numero === lb.numero) s -= 0.3;
  const ra = raizDoNome(a.nome);
  const rb = raizDoNome(b.nome);
  if (ra && ra === rb && !nomeGenerico(a.nome) && !nomeGenerico(b.nome)) s += 0.3;
  // Enviadas uma atrás da outra (colar lâmina por lâmina) contam; o mesmo segundo é envio em lote e não diz nada.
  const intervalo = intervaloDeEnvio(a, b);
  if (intervalo !== null && intervalo >= 1 && intervalo <= 3 * 60) s += 0.15;
  else if (intervalo !== null && intervalo > 3 * 60 && intervalo <= 10 * 60) s += 0.05;
  return Math.max(0, Math.min(1, s));
}

/**
 * Rajadas de envio: arquivos enviados um a um (de 1 s a 3 min entre um e o
 * seguinte, na ordem de envio) formam uma rajada; quem cola as lâminas de um
 * carrossel costuma colar em sequência. Envio em lote (o mesmo segundo) não
 * forma rajada: não diz nada sobre a sequência.
 */
export function rajadasDeEnvio(cands: Candidato[]): Map<string, number> {
  const ordem = cands.filter((c) => Number.isFinite(Date.parse(c.criado_em))).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  const rajada = new Map<string, number>();
  let atual = 0;
  for (let i = 0; i < ordem.length; i++) {
    const gap = i ? (Date.parse(ordem[i].criado_em) - Date.parse(ordem[i - 1].criado_em)) / 1000 : Infinity;
    if (!(gap >= 1 && gap <= 180)) atual++;
    rajada.set(ordem[i].id, atual);
  }
  // Rajada de um só não conta.
  const tamanho = new Map<number, number>();
  rajada.forEach((r) => tamanho.set(r, (tamanho.get(r) || 0) + 1));
  rajada.forEach((r, id) => {
    if ((tamanho.get(r) || 0) < 2) rajada.delete(id);
  });
  return rajada;
}

/** Segundos entre os envios de dois arquivos (null quando não dá para saber). */
export function intervaloDeEnvio(a: Candidato, b: Candidato): number | null {
  const ta = Date.parse(a.criado_em);
  const tb = Date.parse(b.criado_em);
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.abs(ta - tb) / 1000 : null;
}

/** Assunto em comum entre duas lâminas: tema parecido ou a mesma série no nome do arquivo. */
export function mesmoAssunto(a: Candidato, b: Candidato, mesmaRajada = false): boolean {
  if (jaccard(a.leitura!.tema, b.leitura!.tema) >= 0.34 || jaccard(a.leitura!.serie, b.leitura!.serie) >= 0.5) return true;
  if (mesmaRajada && a.leitura!.fixos && jaccard(a.leitura!.fixos, b.leitura!.fixos) >= 0.5) return true;
  const ra = raizDoNome(a.nome);
  return !!ra && ra === raizDoNome(b.nome) && !nomeGenerico(a.nome) && !nomeGenerico(b.nome);
}

export const LIMIAR_MESMO_CARROSSEL = 0.72;
export const LIMIAR_PERGUNTAR_CARROSSEL = 0.3;
/** Probabilidade de sim do Jev para juntar duas lâminas. */
export const SIM_DO_JEV = 0.6;
const MAX_PARES_NO_JEV = 90;
const PERGUNTAS_POR_PEDIDO = 20;

class Conjuntos {
  pai = new Map<string, string>();
  achar(x: string): string {
    let r = x;
    while (this.pai.has(r) && this.pai.get(r) !== r) r = this.pai.get(r)!;
    this.pai.set(x, r);
    return r;
  }
  unir(a: string, b: string) {
    const ra = this.achar(a);
    const rb = this.achar(b);
    if (ra !== rb) this.pai.set(rb, ra);
  }
}

const resumoDaLamina = (c: Candidato) => ({
  arquivo: c.nome,
  tema: c.leitura?.tema || "",
  texto: c.leitura?.texto || "",
  assunto_do_card_inteiro: c.leitura?.serie || "",
  textos_fixos: c.leitura?.fixos || "",
  tipo_que_a_visao_leu: c.leitura?.tipo || "",
  identidade_visual: c.leitura?.identidade || "",
  enviado_em: c.criado_em,
  cores: (c.leitura?.paleta || []).join(" "),
  numero_na_arte: c.leitura?.numero ?? null,
  total_na_arte: c.leitura?.total ?? null,
  eh_capa: !!c.leitura?.capa,
  eh_fechamento: !!c.leitura?.fechamento,
});

async function emPedidos<T>(itens: T[], tamanho: number, fazer: (parte: T[], inicio: number) => Promise<void>) {
  for (let i = 0; i < itens.length; i += tamanho) await fazer(itens.slice(i, i + tamanho), i);
}

// ------------------------------------------------------------------ montagem

export type OpcoesDaPrevia = {
  perguntar?: Perguntar | null;
  /** Aviso de falha do Jev (a prévia segue só com as regras). */
  aoFalharOJev?: (etapa: string, e: unknown) => void;
};

type Destino = {
  categoria: Categoria;
  caminho: string[];
  item: ItemDaPrevia;
};

const doisDigitos = (n: number) => (n < 10 ? `0${n}` : String(n));

function item(c: Candidato, nomeNovo: string, tipo: Tipo | "arquivo", motivo: string, extra: Partial<ItemDaPrevia> = {}): ItemDaPrevia {
  return {
    id: c.id,
    nome_atual: c.nome,
    nome_novo: comExtensao(nomeNovo, c.nome),
    tipo,
    ordem: null,
    motivo,
    duvida: null,
    situacao: c.situacao,
    storage_path: c.storage_path,
    mime: c.mime,
    ja_esta_aqui: false,
    ...extra,
  };
}

/** Nome para arquivo solto: fica o da pessoa; troca o genérico pelo tema (ou texto) lido. */
function nomePeloTema(c: Candidato, detalhe?: string): string {
  if (!nomeGenerico(c.nome)) return c.nome;
  const l = c.leitura;
  const base = frase(l?.tema || "") || frase(curto(l?.texto || "")) || frase(curto(l?.descricao || "")) || semExtensao(c.nome);
  const extra = detalhe ? limparNome(detalhe, 40) : "";
  return extra && normal(extra) !== normal(base) ? `${base} - ${extra}` : base;
}

/** Pasta pelo tema: nome curto e legível ("Limpeza de sofá"). */
function pastaDoTema(t: string, reserva: string): string {
  return frase(curto(t, 6, 48)) || reserva;
}

/**
 * Monta a prévia. Nunca lança por causa do Jev: se ele falhar, as decisões
 * difíceis viram "dúvida" e a prévia segue com as regras.
 */
export async function montarPrevia(candidatos: Candidato[], opcoes: OpcoesDaPrevia = {}): Promise<Previa> {
  const perguntar = opcoes.perguntar ?? null;
  const avisar = opcoes.aoFalharOJev ?? (() => {});
  let decisoes = 0;
  /** A ideia de cada pasta numa linha ("5 lâminas de ..."), por categoria e nome da pasta. */
  const ideiasDosGrupos = new Map<string, string>();
  const destinos: Destino[] = [];
  const ficam: ItemQueFica[] = [];
  const ficar = (c: Candidato, motivo: string) => ficam.push({ id: c.id, nome: c.nome, motivo, storage_path: c.storage_path, mime: c.mime });

  // Tipo efetivo de cada lido (pode mudar com o Jev).
  const tipoDe = new Map<string, Tipo>();
  const duvidaDoTipo = new Map<string, string>();

  // 1. Quem não tem leitura: quebrado fica; documento, vídeo sem quadro e afins vão pelo nome.
  const lidos: Candidato[] = [];
  for (const c of candidatos) {
    if (c.leitura) {
      lidos.push(c);
      tipoDe.set(c.id, c.leitura.tipo);
      continue;
    }
    const pelo = tipoSemLeitura(c);
    if (c.falha && !pelo.categoria) {
      ficar(c, c.falha);
      continue;
    }
    if (!pelo.categoria) {
      ficar(c, c.falha || "não foi lido (a leitura parou ou o arquivo não abriu)");
      continue;
    }
    destinos.push({
      categoria: pelo.categoria,
      caminho: [PASTAS[pelo.categoria]],
      item: item(c, c.nome, pelo.tipo, `tipo pelo nome e pela extensão (.${extensao(c.nome) || "?"})`, { duvida: pelo.duvida }),
    });
  }

  // 2. Duplicatas exatas: a primeira enviada segue; as outras vão para Duplicadas.
  const porHash = new Map<string, Candidato[]>();
  for (const c of lidos) if (c.hash) porHash.set(c.hash, [...(porHash.get(c.hash) || []), c]);
  const duplicadas = new Set<string>();
  let totalDuplicadas = 0;
  porHash.forEach((grupo) => {
    if (grupo.length < 2) return;
    const ordem = grupo.slice().sort((a, b) => a.criado_em.localeCompare(b.criado_em) || a.nome.localeCompare(b.nome));
    const original = ordem[0];
    ordem.slice(1).forEach((c, i) => {
      duplicadas.add(c.id);
      totalDuplicadas++;
      const base = nomeGenerico(original.nome) ? nomePeloTema(original) : semExtensao(original.nome);
      destinos.push({
        categoria: "duplicadas",
        caminho: [PASTAS.duplicadas],
        item: item(c, `${base} (cópia ${i + 1})`, c.leitura!.tipo, `mesma imagem que "${original.nome}" (conteúdo idêntico); nada foi apagado`),
      });
    });
  });
  const ativos = lidos.filter((c) => !duplicadas.has(c.id));

  // 3. Tipo em dúvida: o Jev escolhe pelo que a visão descreveu (sem ver a imagem de novo).
  const emDuvida = ativos.filter((c) => c.leitura!.confianca < 0.6 && c.leitura!.tipo !== "outro");
  const semTipo = ativos.filter((c) => c.leitura!.tipo === "outro");
  const paraOJev = [...emDuvida, ...semTipo];
  if (perguntar && paraOJev.length) {
    await emPedidos(paraOJev, PERGUNTAS_POR_PEDIDO, async (parte) => {
      const state = {
        arquivos: parte.map((c) => ({
          arquivo: c.nome,
          formato: c.largura && c.altura ? `${c.largura}x${c.altura}${c.altura > c.largura * 1.5 ? " (vertical de story/reel)" : c.altura > c.largura ? " (vertical de feed)" : c.altura === c.largura ? " (quadrado)" : " (horizontal)"}` : "desconhecido",
          duracao_s: c.duracao,
          palpite_da_visao: c.leitura!.tipo,
          tema: c.leitura!.tema,
          texto_na_imagem: c.leitura!.texto,
          o_que_se_ve: c.leitura!.descricao,
          numero_na_arte: c.leitura!.numero,
          objeto: c.leitura!.objeto,
        })),
      };
      const questions: Record<string, PerguntaJev> = {};
      parte.forEach((_, i) => {
        questions[`t${i}`] = {
          type: "choice",
          instructions: `Pelo arquivo \`arquivos[${i}]\` (nome, formato, o que se vê e o texto na imagem), qual é o tipo desta peça para arquivar no workspace de uma agência de redes sociais?`,
          criteria: SIGNIFICADO_DO_TIPO,
        };
      });
      try {
        const r = await perguntar(state, questions);
        decisoes += parte.length;
        parte.forEach((c, i) => {
          const a = r[`t${i}`];
          const escolha = String(a?.choice || "") as Tipo;
          const conf = Number(a?.confidence ?? 0);
          if (TIPOS.indexOf(escolha) < 0) return;
          if (conf >= 0.5 && escolha !== "outro") {
            tipoDe.set(c.id, escolha);
            if (conf < 0.7) duvidaDoTipo.set(c.id, `tipo decidido com pouca certeza (${Math.round(conf * 100)}%)`);
          } else {
            duvidaDoTipo.set(c.id, "a visão e o Jev ficaram em dúvida sobre o tipo");
          }
        });
      } catch (e) {
        avisar("tipo", e);
        parte.forEach((c) => duvidaDoTipo.set(c.id, "tipo em dúvida (o Jev não respondeu)"));
      }
    });
  } else {
    for (const c of emDuvida) duvidaDoTipo.set(c.id, "tipo em dúvida");
  }

  const doTipo = (t: Tipo) => ativos.filter((c) => tipoDe.get(c.id) === t);
  const usados = new Set<string>();

  // 4. Carrosséis: pares certos pelo código; os do meio vão ao Jev ("mesmo carrossel?").
  const laminas = doTipo("carrossel");
  const rajada = rajadasDeEnvio(ativos);
  const naMesmaRajada = (a: Candidato, b: Candidato) => rajada.has(a.id) && rajada.get(a.id) === rajada.get(b.id);
  const conj = new Conjuntos();
  laminas.forEach((c) => conj.achar(c.id));
  const duvidosos: Array<{ a: Candidato; b: Candidato; s: number; extra: boolean }> = [];
  for (let i = 0; i < laminas.length; i++) {
    for (let j = i + 1; j < laminas.length; j++) {
      const junto = naMesmaRajada(laminas[i], laminas[j]);
      const s = semelhancaDeLaminas(laminas[i], laminas[j], junto);
      // Certeza só com assunto em comum (tema, série, nome ou textos fixos na mesma rajada): cores e identidade iguais são da marca, não do card.
      if (s >= LIMIAR_MESMO_CARROSSEL && mesmoAssunto(laminas[i], laminas[j], junto)) conj.unir(laminas[i].id, laminas[j].id);
      else if (s >= LIMIAR_PERGUNTAR_CARROSSEL) duvidosos.push({ a: laminas[i], b: laminas[j], s, extra: false });
    }
  }
  // Arte lida como post, story ou capa de reel que pode ser lâmina de um carrossel daqui (a última lâmina com
  // a foto da pessoa, por exemplo): só entra com o "sim" do Jev na etapa dos conjuntos, nunca pela regra.
  const extras = ativos.filter((c) => ["post", "story", "reel"].indexOf(tipoDe.get(c.id) || "") >= 0 && String(c.mime || "").indexOf("video/") !== 0);
  const extrasPossiveis = new Set<string>();
  const juntadosPeloJev = new Map<string, number>();
  if (perguntar && duvidosos.length) {
    const pares = duvidosos.sort((x, y) => Number(x.extra) - Number(y.extra) || y.s - x.s).slice(0, MAX_PARES_NO_JEV);
    await emPedidos(pares, PERGUNTAS_POR_PEDIDO, async (parte) => {
      const state = {
        pares: parte.map((p) => {
          const seg = intervaloDeEnvio(p.a, p.b);
          return {
            lamina_a: resumoDaLamina(p.a),
            lamina_b: resumoDaLamina(p.b),
            intervalo_entre_os_envios: seg === null ? "desconhecido" : seg < 1 ? "no mesmo envio em lote" : seg < 120 ? `${Math.round(seg)} segundos` : `${Math.round(seg / 60)} minutos`,
          };
        }),
      };
      const questions: Record<string, PerguntaJev> = {};
      parte.forEach((_, k) => {
        questions[`p${k}`] = {
          type: "noul",
          instructions: `As lâminas \`pares[${k}].lamina_a\` e \`pares[${k}].lamina_b\` são partes do MESMO carrossel (o mesmo card do Instagram, publicado junto), e não de dois carrosséis diferentes da mesma marca?`,
          criteria: {
            true: "Mesma sequência: o assunto do card inteiro é o mesmo (cada lâmina pode tratar de um ponto diferente dele), o layout, os elementos fixos e a identidade são os mesmos, e a numeração combina.",
            false: "Cards diferentes: o assunto do card inteiro é outro, mesmo com a marca e as cores iguais; ou as duas ocupam a mesma posição na sequência.",
          },
        };
      });
      try {
        const r = await perguntar(state, questions);
        decisoes += parte.length;
        parte.forEach((p, k) => {
          const sim = Number(r[`p${k}`]?.noul ?? 0);
          if (sim >= SIM_DO_JEV) {
            conj.unir(p.a.id, p.b.id);
            juntadosPeloJev.set(p.a.id, sim);
            juntadosPeloJev.set(p.b.id, sim);
          }
        });
      } catch (e) {
        avisar("mesmo_carrossel", e);
      }
    });
  }
  // Etapa dos conjuntos: carrossel contra carrossel (e arte solta contra carrossel) com a sequência
  // inteira à vista do Jev. Resolve o card que a leitura partiu em dois (lâminas lidas em lotes
  // diferentes ganham assuntos diferentes) e a última lâmina lida como post.
  if (perguntar && laminas.length) {
    const grupos = new Map<string, Candidato[]>();
    for (const l of laminas) {
      const r = conj.achar(l.id);
      grupos.set(r, [...(grupos.get(r) || []), l]);
    }
    const lista = Array.from(grupos.values()).map((g) => g.slice().sort((a, b) => a.criado_em.localeCompare(b.criado_em)));
    const vizinhos = (A: Candidato[], B: Candidato[]) =>
      A.some((a) => B.some((b) => naMesmaRajada(a, b) && (intervaloDeEnvio(a, b) ?? Infinity) <= 180));
    const maiorSemelhanca = (A: Candidato[], B: Candidato[]) => {
      let m = 0;
      for (const a of A) for (const b of B) m = Math.max(m, semelhancaDeLaminas(a, b, naMesmaRajada(a, b)));
      return m;
    };
    const pedidos: Array<{ A: Candidato[]; B: Candidato[]; nota: number }> = [];
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const viz = vizinhos(lista[i], lista[j]);
        const s = maiorSemelhanca(lista[i], lista[j]);
        if (viz || s >= LIMIAR_PERGUNTAR_CARROSSEL + 0.1) pedidos.push({ A: lista[i], B: lista[j], nota: s + (viz ? 1 : 0) });
      }
    }
    for (const e of extras) {
      for (const A of lista) {
        const viz = vizinhos(A, [e]);
        const s = maiorSemelhanca(A, [e]);
        if (viz || s >= LIMIAR_PERGUNTAR_CARROSSEL + 0.15) {
          pedidos.push({ A, B: [e], nota: s + (viz ? 1 : 0) - 0.05 });
          extrasPossiveis.add(e.id);
        }
      }
    }
    extrasPossiveis.forEach((id) => conj.achar(id));
    const escolhidos = pedidos.sort((x, y) => y.nota - x.nota).slice(0, 40);
    const conjunto = (g: Candidato[]) => g.map((c) => resumoDaLamina(c));
    await emPedidos(escolhidos, PERGUNTAS_POR_PEDIDO, async (parte) => {
      const state = {
        conjuntos: parte.map((p) => {
          let menor = Infinity;
          for (const a of p.A) for (const b of p.B) menor = Math.min(menor, intervaloDeEnvio(a, b) ?? Infinity);
          return {
            carrossel_a: conjunto(p.A),
            artes_b: conjunto(p.B),
            menor_intervalo_entre_os_envios: !Number.isFinite(menor) ? "desconhecido" : menor < 1 ? "no mesmo envio em lote" : menor < 120 ? `${Math.round(menor)} segundos` : `${Math.round(menor / 60)} minutos`,
          };
        }),
      };
      const questions: Record<string, PerguntaJev> = {};
      parte.forEach((_, k) => {
        questions[`g${k}`] = {
          type: "noul",
          instructions: `As artes de \`conjuntos[${k}].artes_b\` fazem parte do MESMO carrossel que as lâminas de \`conjuntos[${k}].carrossel_a\` (a mesma sequência, publicada junta no mesmo card), lendo a sequência inteira: o texto de uma continua a outra, a identidade e os textos fixos são os mesmos e foram enviadas em sequência?`,
          criteria: {
            true: "É a mesma sequência: as artes de b continuam, completam ou fecham (apresentação, chamada para ação) o assunto do carrossel a, com o mesmo layout e os mesmos elementos fixos.",
            false: "É outro card: outro assunto, outro layout ou outra série, mesmo que seja a mesma marca.",
          },
        };
      });
      try {
        const r = await perguntar(state, questions);
        decisoes += parte.length;
        parte.forEach((p, k) => {
          const sim = Number(r[`g${k}`]?.noul ?? 0);
          if (sim < SIM_DO_JEV) return;
          conj.unir(p.A[0].id, p.B[0].id);
          for (const c of p.B) juntadosPeloJev.set(c.id, Math.max(juntadosPeloJev.get(c.id) || 0, sim));
        });
      } catch (e) {
        avisar("mesmo_carrossel_conjuntos", e);
      }
    });
  }
  // Extra que o Jev juntou a um carrossel vira lâmina; o que não juntou segue o tipo lido.
  const extrasJuntados = new Set<string>();
  extrasPossiveis.forEach((id) => {
    const raiz = conj.achar(id);
    if (laminas.some((l) => conj.achar(l.id) === raiz)) extrasJuntados.add(id);
  });
  const todasAsLaminas = [...laminas, ...extras.filter((e) => extrasJuntados.has(e.id))];
  todasAsLaminas.forEach((c) => {
    if (extrasJuntados.has(c.id)) {
      duvidaDoTipo.set(c.id, `a leitura viu ${tipoDe.get(c.id)}; o Jev juntou ao carrossel pela série`);
      tipoDe.set(c.id, "carrossel");
    }
  });
  const porCarrossel = new Map<string, Candidato[]>();
  todasAsLaminas.forEach((c) => {
    const r = conj.achar(c.id);
    porCarrossel.set(r, [...(porCarrossel.get(r) || []), c]);
  });

  const carrosseis: Candidato[][] = [];
  const soltas: Candidato[] = [];
  porCarrossel.forEach((g) => (g.length >= 2 ? carrosseis.push(g) : soltas.push(g[0])));

  // Ordem das lâminas: numeração na arte, depois número no nome, depois a ordem em que foram
  // enviadas (lâmina por lâmina, com segundos entre uma e outra); sem nada disso, o Jev dá a
  // posição pelo texto (abertura, meio, fechamento).
  const posicao = new Map<string, number>();
  const origemDaPosicao = new Map<string, string>();
  const semNumero: Array<{ c: Candidato; g: number }> = [];
  carrosseis.forEach((g, gi) => {
    const nomesNumerados = g.filter((c) => numeroDoNome(c.nome) !== null && !nomeGenerico(c.nome)).length === g.length;
    const porEnvio = g.slice().sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    const envioUmAUm = porEnvio.every((c, i) => i === 0 || (intervaloDeEnvio(porEnvio[i - 1], c) ?? 0) >= 1);
    for (const c of g) {
      const l = c.leitura!;
      if (l.numero) {
        posicao.set(c.id, l.numero);
        origemDaPosicao.set(c.id, `número ${l.numero} na arte`);
      } else if (nomesNumerados) {
        posicao.set(c.id, numeroDoNome(c.nome)!);
        origemDaPosicao.set(c.id, "número no nome do arquivo");
      } else if (envioUmAUm) {
        // Capa vista na arte vai para o começo mesmo se foi enviada depois (com duas "capas", vale o envio).
        const capaUnica = l.capa && g.filter((x) => x.leitura!.capa).length === 1;
        posicao.set(c.id, capaUnica ? 0 : porEnvio.indexOf(c) + 1);
        origemDaPosicao.set(c.id, capaUnica ? "capa na leitura" : "ordem em que foi enviada");
      } else semNumero.push({ c, g: gi });
    }
  });
  const posicaoRelativa = new Map<string, number>();
  if (perguntar && semNumero.length) {
    await emPedidos(semNumero, PERGUNTAS_POR_PEDIDO, async (parte) => {
      const state = { laminas: parte.map((p) => ({ carrossel: `c${p.g + 1}`, ...resumoDaLamina(p.c) })) };
      const questions: Record<string, PerguntaJev> = {};
      parte.forEach((_, k) => {
        questions[`o${k}`] = {
          type: "score",
          instructions: `Em que ponto da sequência do carrossel fica a lâmina \`laminas[${k}]\`, pelo texto e pelo papel dela?`,
          criteria: [
            "Abertura: capa com título grande, promessa ou pergunta, chama para arrastar.",
            "Começo: apresenta o problema ou o primeiro ponto.",
            "Meio: desenvolve um ponto, dica ou passo intermediário.",
            "Final do conteúdo: último ponto, resumo ou resultado.",
            "Fechamento: chamada para ação (salve, compartilhe, siga, comente, link na bio, fale conosco).",
          ],
        };
      });
      try {
        const r = await perguntar(state, questions);
        decisoes += parte.length;
        parte.forEach((p, k) => {
          const s = Number(r[`o${k}`]?.score);
          if (Number.isFinite(s)) posicaoRelativa.set(p.c.id, Math.max(0, Math.min(4, s)) / 4);
        });
      } catch (e) {
        avisar("ordem", e);
      }
    });
  }

  const nomesDePasta = new Map<string, number>();
  const pastaUnica = (categoria: Categoria, nome: string) => {
    const chave = `${categoria}|${normal(nome)}`;
    const n = (nomesDePasta.get(chave) || 0) + 1;
    nomesDePasta.set(chave, n);
    return n === 1 ? nome : `${nome} ${n}`;
  };

  carrosseis.forEach((g) => {
    const n = g.length;
    const chaveDe = (c: Candidato) => {
      const l = c.leitura!;
      if (posicao.has(c.id)) return posicao.get(c.id)!;
      if (l.capa) return 0;
      if (l.fechamento) return n + 1;
      const rel = posicaoRelativa.get(c.id);
      return rel !== undefined ? 1 + rel * (n - 1) : n / 2 + 0.5;
    };
    const ordem = g.slice().sort((a, b) => chaveDe(a) - chaveDe(b) || (numeroDoNome(a.nome) ?? 99) - (numeroDoNome(b.nome) ?? 99) || a.criado_em.localeCompare(b.criado_em) || a.nome.localeCompare(b.nome));
    const capa = ordem.find((c) => c.leitura!.capa) || ordem[0];
    const temas = new Map<string, number>();
    g.forEach((c) => {
      const t = normal(c.leitura!.tema);
      if (t) temas.set(t, (temas.get(t) || 0) + 1);
    });
    const maisComum = Array.from(temas.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const series = new Map<string, number>();
    g.forEach((c) => {
      const t = normal(c.leitura!.serie);
      if (t) series.set(t, (series.get(t) || 0) + 1);
    });
    const serieComum = Array.from(series.entries()).sort((a, b) => b[1] - a[1])[0];
    const serieDaCapa = capa.leitura!.serie;
    const tema = serieDaCapa || (serieComum && serieComum[1] >= 2 ? g.find((c) => normal(c.leitura!.serie) === serieComum[0])!.leitura!.serie : "") || capa.leitura!.tema || maisComum || curto(capa.leitura!.texto) || "Carrossel";
    const pasta = pastaUnica("carrosseis", pastaDoTema(tema, "Carrossel"));
    const numerados = g.filter((c) => c.leitura!.numero).length;
    const repetidos = new Set(g.map((c) => c.leitura!.numero).filter((x, i, arr) => x && arr.indexOf(x) !== i));
    const semOrdemFirme = g.filter((c) => !posicao.has(c.id) && !c.leitura!.capa && !c.leitura!.fechamento && !posicaoRelativa.has(c.id)).length;
    const porEnvio = g.every((c) => origemDaPosicao.get(c.id) === "ordem em que foi enviada" || origemDaPosicao.get(c.id) === "capa na leitura");
    const ideia = `${n} lâminas de "${frase(tema)}", ${numerados === n ? "na ordem da numeração da arte" : numerados ? "ordem pela numeração e pelo texto" : porEnvio ? "na ordem em que foram enviadas" : "ordem pelo texto (capa, meio, fechamento)"}`;
    ordem.forEach((c, i) => {
      const l = c.leitura!;
      const rotulo = i === 0 ? "capa" : l.fechamento && i === n - 1 ? "fechamento" : curto(l.texto) || curto(l.tema) || "lâmina";
      const origem = posicao.has(c.id) ? origemDaPosicao.get(c.id) || "numeração" : l.capa ? "capa na leitura" : l.fechamento ? "fechamento na leitura" : posicaoRelativa.has(c.id) ? "posição pelo texto (Jev)" : "sem pista de ordem";
      const jev = juntadosPeloJev.get(c.id);
      destinos.push({
        categoria: "carrosseis",
        caminho: [PASTAS.carrosseis, pasta],
        item: item(c, `${doisDigitos(i + 1)} - ${rotulo}`, "carrossel", `lâmina ${i + 1} de ${n} (${origem})${jev ? `; juntada pelo Jev (${Math.round(jev * 100)}%)` : ""}`, {
          ordem: i + 1,
          duvida: duvidaDoTipo.get(c.id) || (l.numero && repetidos.has(l.numero) ? `número ${l.numero} aparece em mais de uma lâmina: podem ser dois carrosséis` : null) || (semOrdemFirme && !posicao.has(c.id) && !posicaoRelativa.has(c.id) && !l.capa && !l.fechamento ? "posição na sequência sem pista firme" : null),
        }),
      });
      usados.add(c.id);
    });
    // A ideia sai junto no grupo (o primeiro destino guarda).
    ideiasDosGrupos.set(`carrosseis|${pasta}`, ideia);
  });

  // Lâmina sozinha: com número na arte vai para Carrosséis (sem o resto); sem número, é post.
  for (const c of soltas) {
    const l = c.leitura!;
    if (l.numero || l.total) {
      usados.add(c.id);
      const pasta = pastaUnica("carrosseis", pastaDoTema(l.tema, "Carrossel"));
      destinos.push({
        categoria: "carrosseis",
        caminho: [PASTAS.carrosseis, pasta],
        item: item(c, `${doisDigitos(l.numero || 1)} - ${l.capa ? "capa" : curto(l.texto) || "lâmina"}`, "carrossel", `lâmina ${l.numero || "?"}${l.total ? ` de ${l.total}` : ""}; as outras lâminas não estão aqui`, {
          ordem: l.numero || 1,
          duvida: "lâmina sem o resto do carrossel",
        }),
      });
    } else {
      tipoDe.set(c.id, "post");
      duvidaDoTipo.set(c.id, duvidaDoTipo.get(c.id) || "parecia lâmina de carrossel, mas está sozinha: foi para Posts");
    }
  }

  // 5. Antes e depois: pares pelo objeto; o Jev escolhe quando há mais de um candidato.
  const antes = doTipo("antes");
  const depois = doTipo("depois");
  const parDe = new Map<string, { depois: Candidato; conf: number | null }>();
  const livres = new Set(depois.map((d) => d.id));
  const semelhancaDoPar = (a: Candidato, d: Candidato) => {
    let s = 0.6 * jaccard(a.leitura!.objeto, d.leitura!.objeto) + 0.25 * jaccard(a.leitura!.tema, d.leitura!.tema);
    const ra = raizDoNome(a.nome.replace(/antes/gi, ""));
    const rd = raizDoNome(d.nome.replace(/depois/gi, ""));
    if (ra && ra === rd && !nomeGenerico(a.nome)) s += 0.3;
    const na = numeroDoNome(a.nome);
    if (na !== null && na === numeroDoNome(d.nome) && /antes/i.test(a.nome) && /depois/i.test(d.nome)) s += 0.3;
    return Math.min(1, s);
  };
  const perguntasDePar: Array<{ a: Candidato; opcoes: Candidato[] }> = [];
  if (antes.length === 1 && depois.length === 1) {
    parDe.set(antes[0].id, { depois: depois[0], conf: null });
    livres.delete(depois[0].id);
  } else {
    for (const a of antes) {
      const notas = depois.map((d) => ({ d, s: semelhancaDoPar(a, d) })).sort((x, y) => y.s - x.s);
      if (!notas.length) continue;
      const [melhor, segundo] = notas;
      if (melhor.s >= 0.6 && (!segundo || segundo.s <= melhor.s - 0.25)) continue; // decide abaixo, sem Jev
      perguntasDePar.push({ a, opcoes: notas.slice(0, 12).map((n) => n.d) });
    }
    const certos = antes
      .filter((a) => !perguntasDePar.some((p) => p.a.id === a.id))
      .map((a) => {
        const notas = depois.map((d) => ({ d, s: semelhancaDoPar(a, d) })).sort((x, y) => y.s - x.s);
        return { a, melhor: notas[0] };
      })
      .filter((x) => x.melhor)
      .sort((x, y) => y.melhor.s - x.melhor.s);
    for (const x of certos) {
      if (!livres.has(x.melhor.d.id)) continue;
      parDe.set(x.a.id, { depois: x.melhor.d, conf: null });
      livres.delete(x.melhor.d.id);
    }
    if (perguntar && perguntasDePar.length) {
      const respostas: Array<{ a: Candidato; d: Candidato; conf: number }> = [];
      await emPedidos(perguntasDePar, PERGUNTAS_POR_PEDIDO, async (parte) => {
        const state = {
          fotos_antes: parte.map((p) => ({ arquivo: p.a.nome, objeto: p.a.leitura!.objeto, o_que_se_ve: p.a.leitura!.descricao, tema: p.a.leitura!.tema })),
          fotos_depois: depois.map((d, i) => ({ id: `d${i + 1}`, arquivo: d.nome, objeto: d.leitura!.objeto, o_que_se_ve: d.leitura!.descricao, tema: d.leitura!.tema })),
        };
        const questions: Record<string, PerguntaJev> = {};
        parte.forEach((p, k) => {
          const criteria: Record<string, string> = {};
          for (const d of p.opcoes) {
            const i = depois.indexOf(d);
            criteria[`d${i + 1}`] = `A foto depois \`fotos_depois[${i}]\` mostra o MESMO objeto ou lugar da foto antes, depois do serviço.`;
          }
          criteria.nenhuma = "Nenhuma das fotos depois mostra o mesmo objeto ou lugar desta foto antes.";
          questions[`a${k}`] = {
            type: "choice",
            instructions: `Qual foto depois forma o par de antes e depois com a foto \`fotos_antes[${k}]\` (o mesmo objeto ou lugar, antes e depois do serviço)?`,
            criteria,
          };
        });
        try {
          const r = await perguntar(state, questions);
          decisoes += parte.length;
          parte.forEach((p, k) => {
            const a = r[`a${k}`];
            const escolha = String(a?.choice || "");
            const conf = Number(a?.confidence ?? 0);
            const m = /^d(\d+)$/.exec(escolha);
            if (!m || conf < 0.45) return;
            const d = depois[Number(m[1]) - 1];
            if (d) respostas.push({ a: p.a, d, conf });
          });
        } catch (e) {
          avisar("antes_depois", e);
        }
      });
      respostas.sort((x, y) => y.conf - x.conf);
      for (const r of respostas) {
        if (parDe.has(r.a.id) || !livres.has(r.d.id)) continue;
        parDe.set(r.a.id, { depois: r.d, conf: r.conf });
        livres.delete(r.d.id);
      }
    }
  }
  const ideiasDosPares = new Map<string, number>();
  const pastaDoPar = (a: Candidato, d?: Candidato) => {
    const t = a.leitura!.objeto || d?.leitura?.objeto || a.leitura!.tema || d?.leitura?.tema || "Antes e depois";
    return pastaDoTema(t, "Antes e depois");
  };
  for (const a of antes) {
    const par = parDe.get(a.id);
    if (!par) continue;
    const ideia = pastaDoPar(a, par.depois);
    const n = (ideiasDosPares.get(normal(ideia)) || 0) + 1;
    ideiasDosPares.set(normal(ideia), n);
    const pasta = n === 1 ? ideia : `${ideia} ${n}`;
    const rotulo = curto(a.leitura!.objeto || par.depois.leitura!.objeto || a.leitura!.tema, 5, 36) || "foto";
    const motivo = par.conf === null ? `mesmo objeto nas duas fotos (${rotulo})` : `par escolhido pelo Jev (${Math.round(par.conf * 100)}%)`;
    const duvida = par.conf !== null && par.conf < 0.65 ? "par com pouca certeza: confira as duas fotos" : null;
    destinos.push({ categoria: "antes_depois", caminho: [PASTAS.antes_depois, pasta], item: item(a, `antes - ${rotulo}`, "antes", motivo, { ordem: 1, duvida: duvida || duvidaDoTipo.get(a.id) || null }) });
    destinos.push({ categoria: "antes_depois", caminho: [PASTAS.antes_depois, pasta], item: item(par.depois, `depois - ${rotulo}`, "depois", motivo, { ordem: 2, duvida: duvida || duvidaDoTipo.get(par.depois.id) || null }) });
    ideiasDosGrupos.set(`antes_depois|${pasta}`, `antes e depois: ${frase(rotulo)}`);
    usados.add(a.id);
    usados.add(par.depois.id);
  }
  for (const c of doTipo("antes_depois")) {
    const ideia = pastaDoTema(c.leitura!.objeto || c.leitura!.tema, "Antes e depois");
    const rotulo = curto(c.leitura!.objeto || c.leitura!.tema, 5, 36) || "comparativo";
    destinos.push({ categoria: "antes_depois", caminho: [PASTAS.antes_depois, ideia], item: item(c, `comparativo - ${rotulo}`, "antes_depois", "antes e depois na mesma imagem", { ordem: 3, duvida: duvidaDoTipo.get(c.id) || null }) });
    usados.add(c.id);
  }
  for (const c of [...antes, ...depois]) {
    if (usados.has(c.id)) continue;
    const t = tipoDe.get(c.id) as Tipo;
    const rotulo = curto(c.leitura!.objeto || c.leitura!.tema, 5, 36) || "foto";
    destinos.push({
      categoria: "antes_depois",
      caminho: [PASTAS.antes_depois],
      item: item(c, `${t} - ${rotulo}`, t, `foto ${t}; o par não foi encontrado entre os arquivos`, { duvida: "sem par: a outra foto não está aqui ou não foi reconhecida" }),
    });
    usados.add(c.id);
  }

  // 6. O resto por tipo, com versões juntas e fotos por tema quando há 3 ou mais.
  const resto = ativos.filter((c) => !usados.has(c.id));
  const versoes = new Map<string, Candidato[]>();
  for (const c of resto) {
    const t = tipoDe.get(c.id)!;
    if (t === "foto" || t === "outro") continue;
    const raiz = raizDoNome(c.nome);
    const porNome = versaoDoNome(c.nome) !== null && raiz && !nomeGenerico(c.nome);
    const texto = normal(c.leitura!.texto);
    const chave = porNome ? `n|${t}|${raiz}` : texto.length >= 12 ? `t|${t}|${texto}|${normal(c.leitura!.tema)}` : "";
    if (!chave) continue;
    versoes.set(chave, [...(versoes.get(chave) || []), c]);
  }
  // Mesmo texto: a do nome sem versão entra junto com as numeradas.
  for (const c of resto) {
    const t = tipoDe.get(c.id)!;
    const raiz = raizDoNome(c.nome);
    const chave = `n|${t}|${raiz}`;
    if (versaoDoNome(c.nome) === null && versoes.has(chave) && !versoes.get(chave)!.includes(c)) versoes.get(chave)!.push(c);
  }
  const emVersao = new Set<string>();
  versoes.forEach((g) => {
    const unicos = g.filter((c) => !emVersao.has(c.id));
    if (unicos.length < 2) return;
    const t = tipoDe.get(unicos[0].id)!;
    const categoria = CATEGORIA_DO_TIPO[t];
    if (!categoria) return;
    const ordem = unicos.slice().sort((a, b) => (versaoDoNome(a.nome) ?? 0) - (versaoDoNome(b.nome) ?? 0) || a.criado_em.localeCompare(b.criado_em));
    const base = frase(unicos[0].leitura!.tema) || frase(raizDoNome(unicos[0].nome)) || "Arte";
    const pasta = pastaUnica(categoria, `${pastaDoTema(base, "Arte")} (versões)`);
    ordem.forEach((c, i) => {
      emVersao.add(c.id);
      usados.add(c.id);
      destinos.push({
        categoria,
        caminho: [PASTAS[categoria], pasta],
        item: item(c, `${base} - v${i + 1}`, t, `versão ${i + 1} de ${ordem.length} da mesma arte${versaoDoNome(c.nome) !== null ? " (pelo nome)" : " (mesmo texto)"}`, {
          ordem: i + 1,
          duvida: duvidaDoTipo.get(c.id) || null,
        }),
      });
    });
    ideiasDosGrupos.set(`${categoria}|${pasta}`, `${ordem.length} versões da mesma arte, da mais antiga para a mais nova`);
  });

  // Fotos por tema: 3 ou mais com o mesmo tema ganham subpasta.
  const fotos = resto.filter((c) => !usados.has(c.id) && tipoDe.get(c.id) === "foto");
  const temasDasFotos: Array<{ tema: string; fotos: Candidato[] }> = [];
  for (const f of fotos) {
    const alvo = temasDasFotos.find((g) => jaccard(g.tema, f.leitura!.tema) >= 0.5 || (normal(g.tema) && normal(g.tema) === normal(f.leitura!.tema)));
    if (alvo) alvo.fotos.push(f);
    else temasDasFotos.push({ tema: f.leitura!.tema, fotos: [f] });
  }
  for (const g of temasDasFotos) {
    const sub = g.fotos.length >= 3 && g.tema ? pastaUnica("fotos", pastaDoTema(g.tema, "Fotos")) : null;
    const nomes = new Map<string, number>();
    for (const f of g.fotos) {
      let nome = nomePeloTema(f, sub ? f.leitura!.objeto && curto(f.leitura!.objeto, 4, 30) : undefined);
      const k = normal(nome);
      const n = (nomes.get(k) || 0) + 1;
      nomes.set(k, n);
      if (n > 1 && nomeGenerico(f.nome)) nome = `${nome} ${n}`;
      destinos.push({
        categoria: "fotos",
        caminho: sub ? [PASTAS.fotos, sub] : [PASTAS.fotos],
        item: item(f, nome, "foto", sub ? `foto de "${frase(g.tema)}" (${g.fotos.length} fotos do mesmo tema)` : `foto real${f.leitura!.objeto ? `: ${curto(f.leitura!.objeto, 8, 60)}` : ""}`, { duvida: duvidaDoTipo.get(f.id) || null }),
      });
      usados.add(f.id);
    }
    if (sub) ideiasDosGrupos.set(`fotos|${sub}`, `${g.fotos.length} fotos de ${frase(g.tema).toLowerCase()}`);
  }

  for (const c of resto) {
    if (usados.has(c.id)) continue;
    const t = tipoDe.get(c.id)!;
    const categoria = CATEGORIA_DO_TIPO[t];
    if (!categoria) {
      ficar(c, duvidaDoTipo.get(c.id) || "não deu para saber o que é: fica onde está");
      continue;
    }
    destinos.push({
      categoria,
      caminho: [PASTAS[categoria]],
      item: item(c, nomePeloTema(c), t, motivoDoTipo(t, c), { duvida: duvidaDoTipo.get(c.id) || null }),
    });
    usados.add(c.id);
  }

  // 7. Grupos por caminho, nomes únicos dentro de cada pasta, já organizados fora.
  const grupos = new Map<string, GrupoDaPrevia>();
  let jaOrganizados = 0;
  const porId = new Map(candidatos.map((c) => [c.id, c]));
  for (const d of destinos) {
    const chave = d.caminho.map(normal).join("/");
    const c = porId.get(d.item.id);
    if (c && c.caminho.map(normal).join("/") === chave) {
      if (normal(c.nome) === normal(d.item.nome_novo)) {
        jaOrganizados++;
        continue;
      }
      d.item.ja_esta_aqui = true;
    }
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave,
        categoria: d.categoria,
        caminho: d.caminho,
        ideia: ideiasDosGrupos.get(`${d.categoria}|${d.caminho[d.caminho.length - 1]}`) || ideiaPadrao(d.categoria),
        itens: [],
      });
    }
    grupos.get(chave)!.itens.push(d.item);
  }
  const lista = Array.from(grupos.values());
  for (const g of lista) {
    g.itens.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome_novo.localeCompare(b.nome_novo));
    const vistos = new Map<string, number>();
    for (const it of g.itens) {
      const k = normal(it.nome_novo);
      const n = (vistos.get(k) || 0) + 1;
      vistos.set(k, n);
      if (n > 1) it.nome_novo = comExtensao(`${semExtensao(it.nome_novo)} ${n}`, it.nome_atual);
    }
  }
  lista.sort((a, b) => ORDEM_DAS_CATEGORIAS.indexOf(a.categoria) - ORDEM_DAS_CATEGORIAS.indexOf(b.categoria) || a.caminho.join("/").localeCompare(b.caminho.join("/")));

  const duvidas = lista.reduce((s, g) => s + g.itens.filter((i) => i.duvida).length, 0);
  const movidos = lista.reduce((s, g) => s + g.itens.length, 0);
  const nCarrosseis = lista.filter((g) => g.categoria === "carrosseis" && g.caminho.length === 2).length;
  const nPares = lista.filter((g) => g.categoria === "antes_depois" && g.caminho.length === 2).length;
  const partes: string[] = [];
  if (movidos) partes.push(`${movidos} ${movidos === 1 ? "arquivo organizado" : "arquivos organizados"} em ${lista.length} ${lista.length === 1 ? "pasta" : "pastas"}`);
  if (nCarrosseis) partes.push(`${nCarrosseis} ${nCarrosseis === 1 ? "carrossel" : "carrosséis"}`);
  if (nPares) partes.push(`${nPares} ${nPares === 1 ? "antes e depois" : "antes e depois"}`);
  if (totalDuplicadas) partes.push(`${totalDuplicadas} ${totalDuplicadas === 1 ? "duplicada" : "duplicadas"}`);
  if (duvidas) partes.push(`${duvidas} em dúvida`);
  if (ficam.length) partes.push(`${ficam.length} ${ficam.length === 1 ? "fica" : "ficam"} onde está`);
  return {
    grupos: lista,
    ficam,
    duvidas,
    ja_organizados: jaOrganizados,
    duplicadas: totalDuplicadas,
    resumo: partes.length ? `${partes.join(", ")}.` : "Nada para organizar aqui.",
    decisoes_do_jev: decisoes,
  };
}

function ideiaPadrao(c: Categoria): string {
  switch (c) {
    case "posts":
      return "artes únicas de feed";
    case "stories":
      return "artes de story";
    case "reels":
      return "reels e capas de reels";
    case "videos":
      return "vídeos brutos e gravações";
    case "fotos":
      return "fotos reais";
    case "logos":
      return "logos e peças da marca";
    case "referencias":
      return "referências e prints";
    case "documentos":
      return "documentos, planilhas e PDFs";
    case "artes":
      return "arquivos editáveis de design";
    case "audios":
      return "áudios";
    case "duplicadas":
      return "cópias idênticas de outro arquivo (nada apagado)";
    case "antes_depois":
      return "fotos de antes e depois";
    default:
      return "lâminas de carrossel";
  }
}

function motivoDoTipo(t: Tipo, c: Candidato): string {
  const l = c.leitura!;
  const tema = l.tema ? `: ${frase(l.tema).toLowerCase()}` : "";
  switch (t) {
    case "post":
      return `arte única de feed${tema}`;
    case "story":
      return `arte de story${tema}`;
    case "reel":
      return c.mime && c.mime.indexOf("video/") === 0 ? `reel${c.duracao ? ` de ${Math.round(c.duracao)} s` : ""}${tema}` : `capa de reel${tema}`;
    case "video":
      return `vídeo${c.duracao ? ` de ${Math.round(c.duracao)} s` : ""}${tema}`;
    case "logo":
      return "logo ou peça da marca";
    case "referencia":
      return `referência ou print${tema}`;
    case "documento":
      return `documento${tema}`;
    default:
      return `${t}${tema}`;
  }
}

// ------------------------------------------------------------------ edição da prévia

export type GrupoConfirmado = { caminho: string[]; itens: Array<{ id: string; nome: string; ordem?: number | null }> };

/**
 * O que a pessoa confirmou, conferido: pasta com nome limpo (sem barra), item
 * que aparece uma vez só, nome sempre com a extensão original (quem traz o
 * nome original é o servidor, na hora de aplicar).
 */
export function normalizarConfirmacao(bruto: unknown, max = 600): GrupoConfirmado[] {
  const grupos = Array.isArray(bruto) ? bruto : [];
  const vistos = new Set<string>();
  const saida: GrupoConfirmado[] = [];
  let total = 0;
  for (const g of grupos) {
    if (!g || typeof g !== "object") continue;
    const caminho = (Array.isArray((g as GrupoConfirmado).caminho) ? (g as GrupoConfirmado).caminho : [])
      .map((p) => limparNome(p, 80))
      .filter(Boolean)
      .slice(0, 4);
    if (!caminho.length) continue;
    const itens: GrupoConfirmado["itens"] = [];
    for (const it of Array.isArray((g as GrupoConfirmado).itens) ? (g as GrupoConfirmado).itens : []) {
      const id = String(it?.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id) || vistos.has(id) || total >= max) continue;
      vistos.add(id);
      total++;
      const ordem = Number(it?.ordem);
      itens.push({ id, nome: limparNome(it?.nome, 120), ordem: Number.isFinite(ordem) && ordem > 0 ? Math.round(ordem) : null });
    }
    if (itens.length) saida.push({ caminho, itens });
  }
  return saida;
}
