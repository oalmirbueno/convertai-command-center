/**
 * Mesa Roteiros (Frente R2, 26/09/2026): o roteiro estruturado, as versões,
 * os comentários, o status e os modelos (templates). É a fonte da verdade do
 * roteiro: o PDF (pdf-roteiro.ts) só exporta uma versão, sem reescrever.
 *
 * Base: kit do Estúdio Audiovisual V2 (MESA-ROTEIROS.md, MEMORIA-E-TEMPLATES.md,
 * agentes/roteirista.md, roteiro-camera.md, roteiro-cinema.md, ugc.md,
 * ganchos-retencao.md e produtor-pdf.md), conferido contra o código real.
 *
 * Regras que moram aqui:
 * - Saída estruturada sempre com 3 ganchos de mecanismos diferentes, blocos
 *   de fala com tempo, direção de gravação, texto na tela, B-roll, CTA e
 *   legenda do post. O que o modelo esquecer vira campo vazio, nunca invenção.
 * - Versão aprovada é imutável: corrigir cria versão nova (novaVersao).
 * - Duração estimada pela fala (2,5 palavras por segundo), mostrada em faixa.
 * - Modelo da agência sai sem fala, nome, contato, número ou oferta do
 *   cliente de origem (modeloDaAgencia).
 *
 * Puro: sem Deno, sem banco, sem npm. A tela (src/) e o Vitest leem o mesmo
 * arquivo. Compatível com Safari 11 (sem lookbehind, classe Unicode, grupo nomeado,
 * nem método novo de lista ou de objeto). Sem travessão.
 */

// ------------------------------------------------------------------ tipos

export type TipoDeRoteiro = "fala_camera" | "tutorial" | "ugc" | "cinema";
export type StatusDoRoteiro = "rascunho" | "aprovado" | "gravado";
export type OrigemDaVersao = "ia" | "edicao" | "agente" | "modelo";

export type Gancho = {
  texto: string;
  /** Mecanismo do gancho (pergunta concreta, resultado primeiro, contraste...). */
  mecanismo: string;
  /** O que o gancho promete e o vídeo precisa cumprir. */
  promessa: string;
  /** Por que funciona para este público, em uma frase. */
  motivo: string;
};

export type BlocoDoRoteiro = {
  id: string;
  ordem: number;
  /** Função do bloco (Abertura, Resposta, Explicação, Exemplo, Orientação, Fechamento...). */
  funcao: string;
  /** Fala limpa, como a pessoa diz. */
  fala: string;
  /** Tempo estimado do bloco em segundos. */
  segundos: number;
  /** O que a câmera mostra (plano, ação, gesto). */
  visual: string;
  texto_na_tela: string;
  broll: string;
};

export type DirecaoDeGravacao = {
  enquadramento: string;
  ambiente: string;
  figurino: string;
  objetos: string;
  luz: string;
  camera: string;
  /** Orientações curtas de atuação e captação (uma por item). */
  orientacoes: string[];
};

export type Roteiro = {
  titulo: string;
  /** Pergunta ou ideia central que aparece sob o título. */
  subtitulo: string;
  tipo: TipoDeRoteiro;
  objetivo: string;
  formato: string;
  duracao_alvo_s: number;
  ganchos: Gancho[];
  gancho_escolhido: number;
  blocos: BlocoDoRoteiro[];
  direcao: DirecaoDeGravacao;
  /** B-roll geral (imagens de apoio), além do que cada bloco pede. */
  broll: string[];
  cta: string;
  legenda: string;
  hashtags: string[];
  /** Fatos a confirmar antes de gravar (o que falta de evidência). */
  pendencias: string[];
  /** De onde vieram as afirmações (contexto, cérebro, campanha, roteiro da agenda). */
  fontes: string[];
  /** Cinema: premissa em uma frase. Vazio nos outros tipos. */
  logline: string;
};

export type AvisoDoJev = {
  /** Notas de 1 a 5 (ou null quando o Jev não respondeu). */
  retencao: number | null;
  clareza: number | null;
  /** Probabilidade de a promessa do gancho ser cumprida e casar com a oferta. */
  promessa_cumprida: number | null;
  /** Frases curtas para a tela. Aviso, nunca bloqueio nem correção automática. */
  frases: string[];
};

export type VersaoDoRoteiro = {
  numero: number;
  criado_em: string;
  criado_por: string | null;
  origem: OrigemDaVersao;
  nota: string;
  conteudo: Roteiro;
  hash: string;
  custo_usd: number;
  modelo_id: string | null;
  aviso: AvisoDoJev | null;
};

export type ComentarioDoRoteiro = {
  id: string;
  autor_id: string | null;
  autor_nome: string;
  texto: string;
  criado_em: string;
  versao: number;
  bloco_id: string | null;
  resolvido: boolean;
};

export type LinhaDoRoteiro = {
  id: string;
  client_id: string;
  task_id: string | null;
  proposta_id: string | null;
  campanha_id: string | null;
  titulo: string;
  tipo: TipoDeRoteiro;
  status: StatusDoRoteiro;
  versao_atual: number;
  versao_aprovada: number | null;
  versoes: VersaoDoRoteiro[];
  comentarios: ComentarioDoRoteiro[];
  aprovado_por: string | null;
  aprovado_em: string | null;
  gravado_em: string | null;
  arquivado_em: string | null;
  arquivo_pdf_id: string | null;
  custo_usd: number;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

// ------------------------------------------------------------------ tipos de roteiro (modos do kit)

export type ModoDoRoteiro = {
  valor: TipoDeRoteiro;
  rotulo: string;
  /** Estrutura inicial (MESA-ROTEIROS.md, "Modos"), não um molde obrigatório. */
  estrutura: string[];
  cuidados: string;
  /** Papéis do kit que este modo chama (AGENTES-V2.md), sem duplicar chamadas. */
  papeis: string[];
  duracao_padrao_s: number;
};

export const MODOS_DE_ROTEIRO: ModoDoRoteiro[] = [
  {
    valor: "fala_camera",
    rotulo: "Fala para câmera",
    estrutura: ["Abertura", "Resposta", "Explicação", "Exemplo", "Orientação", "Fechamento"],
    cuidados: "Fala natural e respirável, uma ideia por bloco, olhar na lente.",
    papeis: ["roteirista", "ganchos_retencao", "camera"],
    duracao_padrao_s: 55,
  },
  {
    valor: "tutorial",
    rotulo: "Tutorial",
    estrutura: ["Resultado", "O que precisa", "Passo 1", "Passo 2", "Passo 3", "Conferência"],
    cuidados: "Ação visível e verificável; o resultado mostrado no começo é o que os passos entregam.",
    papeis: ["roteirista", "ganchos_retencao", "camera"],
    duracao_padrao_s: 45,
  },
  {
    valor: "ugc",
    rotulo: "UGC",
    estrutura: ["Dor ou desejo", "Demonstração", "Prova", "Chamada"],
    cuidados: "Sem experiência pessoal, resultado ou escassez inventados; persona sintética é escolha explícita.",
    papeis: ["roteirista", "ganchos_retencao", "ugc"],
    duracao_padrao_s: 30,
  },
  {
    valor: "cinema",
    rotulo: "História cinematográfica",
    estrutura: ["Premissa", "Desejo", "Obstáculo", "Mudança", "Resolução"],
    cuidados: "Cada cena muda a situação; continuidade de personagem, figurino, luz, local e objeto.",
    papeis: ["roteirista", "ganchos_retencao", "cinema"],
    duracao_padrao_s: 60,
  },
];

export const TIPOS_DE_ROTEIRO: TipoDeRoteiro[] = ["fala_camera", "tutorial", "ugc", "cinema"];

export function modoDoTipo(tipo: unknown): ModoDoRoteiro {
  const achado = MODOS_DE_ROTEIRO.filter((m) => m.valor === tipo)[0];
  return achado || MODOS_DE_ROTEIRO[0];
}

export const ehTipoDeRoteiro = (v: unknown): v is TipoDeRoteiro => TIPOS_DE_ROTEIRO.indexOf(v as TipoDeRoteiro) >= 0;

/** Formatos da agenda que viram peça de vídeo (tasks.delivery_type). */
export const FORMATOS_DE_VIDEO = ["reel", "video", "short", "story"];

export const ehPecaDeVideo = (tipo?: string | null) => FORMATOS_DE_VIDEO.indexOf(String(tipo || "").toLowerCase()) >= 0;

export const ROTULO_DO_FORMATO: Record<string, string> = { reel: "Reels", video: "Vídeo", short: "Short", story: "Story" };

export const STATUS_DO_ROTEIRO: StatusDoRoteiro[] = ["rascunho", "aprovado", "gravado"];

export const ROTULO_DO_STATUS: Record<StatusDoRoteiro, string> = { rascunho: "Rascunho", aprovado: "Aprovado", gravado: "Gravado" };

// ------------------------------------------------------------------ texto

const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "");
const umaLinha = (v: unknown, max: number): string => texto(v, max * 2).replace(/\s+/g, " ").trim().slice(0, max);

function listaDeTextos(v: unknown, maxItens: number, maxTexto: number): string[] {
  const bruto = Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.split(/\n+/) : [];
  const saida: string[] = [];
  for (const item of bruto) {
    const t = umaLinha(item, maxTexto);
    if (t && saida.indexOf(t) < 0) saida.push(t);
    if (saida.length >= maxItens) break;
  }
  return saida;
}

const numeroEntre = (v: unknown, min: number, max: number, padrao: number): number => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  if (!isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** Palavras faladas (números contam como uma palavra). */
export function contarPalavras(t: string): number {
  const limpo = String(t || "").replace(/[^0-9A-Za-zÀ-ÿ]+/g, " ").trim();
  return limpo ? limpo.split(/\s+/).length : 0;
}

/** Velocidade de fala natural (conhecimento-marketing.ts, ROTEIRO_DE_VIDEO). */
export const PALAVRAS_POR_SEGUNDO = 2.5;

export const segundosDaFala = (fala: string, pps = PALAVRAS_POR_SEGUNDO) => Math.max(1, Math.round(contarPalavras(fala) / pps));

// ------------------------------------------------------------------ normalização

const vazioDeDirecao = (): DirecaoDeGravacao => ({ enquadramento: "", ambiente: "", figurino: "", objetos: "", luz: "", camera: "", orientacoes: [] });

function normalizarDirecao(v: unknown): DirecaoDeGravacao {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    enquadramento: umaLinha(o.enquadramento, 240),
    ambiente: umaLinha(o.ambiente, 240),
    figurino: umaLinha(o.figurino, 240),
    objetos: umaLinha(o.objetos, 240),
    luz: umaLinha(o.luz, 240),
    camera: umaLinha(o.camera, 240),
    orientacoes: listaDeTextos(o.orientacoes, 8, 280),
  };
}

function normalizarGanchos(v: unknown, blocos: BlocoDoRoteiro[]): Gancho[] {
  const saida: Gancho[] = [];
  for (const g of Array.isArray(v) ? v : []) {
    const o = (g && typeof g === "object" ? g : { texto: g }) as Record<string, unknown>;
    const t = umaLinha(o.texto, 400);
    if (!t || saida.some((x) => x.texto === t)) continue;
    saida.push({ texto: t, mecanismo: umaLinha(o.mecanismo, 80), promessa: umaLinha(o.promessa, 240), motivo: umaLinha(o.motivo, 240) });
    if (saida.length >= 3) break;
  }
  // Sem gancho do modelo: a fala de abertura vira o primeiro, sem inventar os outros dois.
  if (!saida.length && blocos.length && blocos[0].fala) {
    saida.push({ texto: umaLinha(blocos[0].fala, 400), mecanismo: "", promessa: "", motivo: "" });
  }
  return saida;
}

function normalizarBlocos(v: unknown): BlocoDoRoteiro[] {
  const saida: BlocoDoRoteiro[] = [];
  const ids: Record<string, true> = {};
  const lista = Array.isArray(v) ? v : [];
  for (let i = 0; i < lista.length && saida.length < 14; i++) {
    const o = (lista[i] && typeof lista[i] === "object" ? lista[i] : { fala: lista[i] }) as Record<string, unknown>;
    const fala = texto(o.fala, 4000);
    const visual = umaLinha(o.visual, 400);
    if (!fala && !visual) continue;
    let id = umaLinha(o.id, 12).toLowerCase();
    if (!/^b\d{1,3}$/.test(id) || ids[id]) id = "";
    saida.push({
      id,
      ordem: 0,
      funcao: umaLinha(o.funcao, 60) || "Bloco",
      fala,
      segundos: numeroEntre(o.segundos, 1, 180, fala ? segundosDaFala(fala) : 3),
      visual,
      texto_na_tela: umaLinha(o.texto_na_tela, 240),
      broll: umaLinha(o.broll, 280),
    });
    if (id) ids[id] = true;
  }
  // Ids estáveis: quem veio sem id ganha o próximo livre (b1, b2...).
  let proximo = 1;
  for (const b of saida) {
    if (b.id) continue;
    while (ids[`b${proximo}`]) proximo++;
    b.id = `b${proximo}`;
    ids[b.id] = true;
  }
  saida.forEach((b, i) => {
    b.ordem = i + 1;
  });
  return saida;
}

/**
 * Lê qualquer forma (resposta do modelo, versão antiga, edição da tela) e
 * devolve um Roteiro completo. `padrao` preenche o que a peça já sabe
 * (título da agenda, tipo e duração pedidos).
 */
export function normalizarRoteiro(bruto: unknown, padrao: { titulo?: string; tipo?: TipoDeRoteiro; duracao_s?: number; formato?: string } = {}): Roteiro {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const tipo: TipoDeRoteiro = ehTipoDeRoteiro(o.tipo) ? o.tipo : padrao.tipo || "fala_camera";
  const blocos = normalizarBlocos(o.blocos);
  const ganchos = normalizarGanchos(o.ganchos, blocos);
  const escolhido = numeroEntre(o.gancho_escolhido, 0, Math.max(0, ganchos.length - 1), 0);
  return {
    titulo: umaLinha(o.titulo, 140) || umaLinha(padrao.titulo, 140) || "Roteiro sem título",
    subtitulo: umaLinha(o.subtitulo, 200),
    tipo,
    objetivo: umaLinha(o.objetivo, 200),
    formato: umaLinha(o.formato, 20) || padrao.formato || "9:16",
    duracao_alvo_s: numeroEntre(o.duracao_alvo_s, 5, 600, padrao.duracao_s || modoDoTipo(tipo).duracao_padrao_s),
    ganchos,
    gancho_escolhido: escolhido,
    blocos,
    direcao: o.direcao ? normalizarDirecao(o.direcao) : vazioDeDirecao(),
    broll: listaDeTextos(o.broll, 10, 240),
    cta: umaLinha(o.cta, 280),
    legenda: texto(o.legenda, 2200),
    hashtags: listaDeTextos(o.hashtags, 12, 40).map((h) => (h.charAt(0) === "#" ? h : `#${h}`).replace(/\s+/g, "")),
    pendencias: listaDeTextos(o.pendencias, 12, 280),
    fontes: listaDeTextos(o.fontes, 12, 200),
    logline: tipo === "cinema" ? umaLinha(o.logline, 300) : "",
  };
}

/** O roteiro tem o mínimo para gravar? Lista o que falta, em frases curtas. */
export function faltasDoRoteiro(r: Roteiro): string[] {
  const faltas: string[] = [];
  if (r.ganchos.length < 3) faltas.push(`Só ${r.ganchos.length} ${r.ganchos.length === 1 ? "gancho" : "ganchos"}; o padrão é 3.`);
  if (!r.blocos.length) faltas.push("Sem blocos de fala.");
  if (r.blocos.some((b) => !b.fala)) faltas.push("Há bloco sem fala.");
  if (!r.cta) faltas.push("Sem CTA.");
  if (!r.legenda) faltas.push("Sem legenda do post.");
  if (!r.direcao.enquadramento && !r.direcao.ambiente) faltas.push("Sem direção de gravação.");
  return faltas;
}

// ------------------------------------------------------------------ gancho e duração

/** Troca o gancho escolhido; a fala de abertura acompanha quando era o gancho anterior. */
export function escolherGancho(r: Roteiro, indice: number): Roteiro {
  if (indice < 0 || indice >= r.ganchos.length || indice === r.gancho_escolhido) return r;
  const anterior = r.ganchos[r.gancho_escolhido];
  const novo = r.ganchos[indice];
  const blocos = r.blocos.map((b, i) => {
    if (i !== 0) return b;
    const eraOGancho = !b.fala || (anterior && umaLinha(b.fala, 400) === anterior.texto);
    return eraOGancho ? { ...b, fala: novo.texto, segundos: segundosDaFala(novo.texto) } : b;
  });
  return { ...r, gancho_escolhido: indice, blocos };
}

export type Duracao = { palavras: number; pela_fala_s: number; declarada_s: number; min_s: number; max_s: number };

/**
 * Duração pela contagem de palavras (2,5 por segundo, premissa declarada) e a
 * soma dos tempos dos blocos. A faixa vai de 10% abaixo a 10% acima do maior
 * dos dois: estimativa, nunca promessa.
 */
export function duracaoEstimada(r: Roteiro, pps = PALAVRAS_POR_SEGUNDO): Duracao {
  const palavras = r.blocos.reduce((s, b) => s + contarPalavras(b.fala), 0);
  const pelaFala = Math.round(palavras / pps);
  const declarada = r.blocos.reduce((s, b) => s + (Number(b.segundos) || 0), 0);
  const base = Math.max(pelaFala, declarada, 1);
  const arred5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
  const min = arred5(base * 0.9);
  const max = Math.max(min + 5, arred5(base * 1.1));
  return { palavras, pela_fala_s: pelaFala, declarada_s: declarada, min_s: min, max_s: max };
}

export function faixaDeDuracao(r: Roteiro): string {
  const d = duracaoEstimada(r);
  return `${d.min_s} a ${d.max_s}s`;
}

/** Faixa comum a vários roteiros (capa do PDF). */
export function faixaDeVarios(roteiros: Roteiro[]): string {
  if (!roteiros.length) return "";
  let min = Infinity;
  let max = 0;
  for (const r of roteiros) {
    const d = duracaoEstimada(r);
    min = Math.min(min, d.min_s);
    max = Math.max(max, d.max_s);
  }
  return `${min} a ${max}s`;
}

// ------------------------------------------------------------------ hash

/** JSON com chaves em ordem: o mesmo roteiro dá sempre o mesmo texto. */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  const chaves = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`).join(",")}}`;
}

/** FNV-1a de 32 bits em hexadecimal: identifica a revisão exportada (não é segurança). */
export function hashDoRoteiro(r: Roteiro): string {
  const s = jsonCanonico(r);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

// ------------------------------------------------------------------ versões

export const MAX_VERSOES = 40;

function normalizarAviso(v: unknown): AvisoDoJev | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const nota = (x: unknown) => (typeof x === "number" && isFinite(x) ? Math.round(x * 10) / 10 : null);
  const prob = (x: unknown) => (typeof x === "number" && isFinite(x) ? Math.max(0, Math.min(1, x)) : null);
  return { retencao: nota(o.retencao), clareza: nota(o.clareza), promessa_cumprida: prob(o.promessa_cumprida), frases: listaDeTextos(o.frases, 6, 240) };
}

export function normalizarVersoes(bruto: unknown): VersaoDoRoteiro[] {
  const saida: VersaoDoRoteiro[] = [];
  const vistos: Record<number, true> = {};
  for (const v of Array.isArray(bruto) ? bruto : []) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const numero = numeroEntre(o.numero, 1, 100000, 0);
    if (!numero || vistos[numero]) continue;
    vistos[numero] = true;
    const conteudo = normalizarRoteiro(o.conteudo);
    const origem = ["ia", "edicao", "agente", "modelo"].indexOf(String(o.origem)) >= 0 ? (o.origem as OrigemDaVersao) : "edicao";
    saida.push({
      numero,
      criado_em: umaLinha(o.criado_em, 40) || new Date(0).toISOString(),
      criado_por: o.criado_por ? umaLinha(o.criado_por, 60) : null,
      origem,
      nota: umaLinha(o.nota, 300),
      conteudo,
      hash: umaLinha(o.hash, 16) || hashDoRoteiro(conteudo),
      custo_usd: typeof o.custo_usd === "number" && isFinite(o.custo_usd) ? o.custo_usd : Number(o.custo_usd) || 0,
      modelo_id: o.modelo_id ? umaLinha(o.modelo_id, 120) : null,
      aviso: normalizarAviso(o.aviso),
    });
  }
  return saida.sort((a, b) => a.numero - b.numero);
}

/**
 * Acrescenta uma versão. As anteriores ficam como estão (aprovada é
 * imutável). Passando do teto, some a mais antiga que não é a aprovada.
 */
export function novaVersao(
  versoes: VersaoDoRoteiro[],
  conteudo: Roteiro,
  meta: { criado_por?: string | null; origem: OrigemDaVersao; nota?: string; custo_usd?: number; modelo_id?: string | null; aviso?: AvisoDoJev | null; agora?: string; aprovada?: number | null },
): { versoes: VersaoDoRoteiro[]; versao: VersaoDoRoteiro } {
  const numero = versoes.reduce((m, v) => Math.max(m, v.numero), 0) + 1;
  const limpo = normalizarRoteiro(conteudo);
  const versao: VersaoDoRoteiro = {
    numero,
    criado_em: meta.agora || new Date().toISOString(),
    criado_por: meta.criado_por || null,
    origem: meta.origem,
    nota: umaLinha(meta.nota, 300),
    conteudo: limpo,
    hash: hashDoRoteiro(limpo),
    custo_usd: Number(meta.custo_usd) || 0,
    modelo_id: meta.modelo_id || null,
    aviso: meta.aviso || null,
  };
  let lista = versoes.concat([versao]);
  while (lista.length > MAX_VERSOES) {
    const i = lista.findIndex((v) => v.numero !== meta.aprovada && v.numero !== numero);
    if (i < 0) break;
    lista = lista.slice(0, i).concat(lista.slice(i + 1));
  }
  return { versoes: lista, versao };
}

export function versaoPorNumero(versoes: VersaoDoRoteiro[], numero: number | null | undefined): VersaoDoRoteiro | null {
  if (!versoes.length) return null;
  const achada = versoes.filter((v) => v.numero === numero)[0];
  return achada || versoes[versoes.length - 1];
}

/** A edição mudou alguma coisa? (hash igual: não cria versão nova). */
export const mudouDe = (anterior: VersaoDoRoteiro | null, conteudo: Roteiro) => !anterior || anterior.hash !== hashDoRoteiro(normalizarRoteiro(conteudo));

// ------------------------------------------------------------------ status

/**
 * Pode mudar de status? Devolve o motivo quando não pode.
 * rascunho -> aprovado; aprovado -> gravado ou rascunho; gravado -> aprovado.
 * Arquivado não muda de status (desarquive antes).
 */
export function motivoParaNaoMudar(atual: StatusDoRoteiro, novo: StatusDoRoteiro, arquivado: boolean): string | null {
  if (arquivado) return "Roteiro arquivado. Desarquive antes.";
  if (atual === novo) return null;
  if (novo === "aprovado" && (atual === "rascunho" || atual === "gravado")) return null;
  if (novo === "gravado" && atual === "aprovado") return null;
  if (novo === "rascunho" && atual === "aprovado") return null;
  if (novo === "gravado") return "Só roteiro aprovado vai para gravado.";
  return "Roteiro gravado volta primeiro para aprovado.";
}

/** Editar o texto cria versão nova; gravado não se edita (volte para aprovado antes). */
export function motivoParaNaoEditar(status: StatusDoRoteiro, arquivado: boolean): string | null {
  if (arquivado) return "Roteiro arquivado. Desarquive para editar.";
  if (status === "gravado") return "Roteiro já gravado. Volte para aprovado se precisar corrigir.";
  return null;
}

/** Status depois de salvar uma versão nova: aprovado vira rascunho (a aprovada fica guardada). */
export const statusDepoisDeEditar = (status: StatusDoRoteiro): StatusDoRoteiro => (status === "aprovado" ? "rascunho" : status);

// ------------------------------------------------------------------ comentários

export const MAX_COMENTARIOS = 200;

export function normalizarComentarios(bruto: unknown): ComentarioDoRoteiro[] {
  const saida: ComentarioDoRoteiro[] = [];
  for (const c of Array.isArray(bruto) ? bruto : []) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const t = texto(o.texto, 2000);
    if (!t) continue;
    saida.push({
      id: umaLinha(o.id, 40) || `c${saida.length + 1}`,
      autor_id: o.autor_id ? umaLinha(o.autor_id, 60) : null,
      autor_nome: umaLinha(o.autor_nome, 80) || "Equipe",
      texto: t,
      criado_em: umaLinha(o.criado_em, 40),
      versao: numeroEntre(o.versao, 0, 100000, 0),
      bloco_id: o.bloco_id ? umaLinha(o.bloco_id, 12) : null,
      resolvido: o.resolvido === true,
    });
  }
  return saida.slice(-MAX_COMENTARIOS);
}

export function novoComentario(
  lista: ComentarioDoRoteiro[],
  c: { texto: string; autor_id?: string | null; autor_nome?: string; versao: number; bloco_id?: string | null; agora?: string; id?: string },
): ComentarioDoRoteiro[] {
  const t = texto(c.texto, 2000);
  if (!t) return lista;
  const novo: ComentarioDoRoteiro = {
    id: c.id || `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    autor_id: c.autor_id || null,
    autor_nome: umaLinha(c.autor_nome, 80) || "Equipe",
    texto: t,
    criado_em: c.agora || new Date().toISOString(),
    versao: c.versao,
    bloco_id: c.bloco_id || null,
    resolvido: false,
  };
  return lista.concat([novo]).slice(-MAX_COMENTARIOS);
}

// ------------------------------------------------------------------ linha do banco

export function normalizarLinhaDoRoteiro(bruto: unknown): LinhaDoRoteiro | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const id = umaLinha(o.id, 40);
  const clientId = umaLinha(o.client_id, 40);
  if (!id || !clientId) return null;
  const versoes = normalizarVersoes(o.versoes);
  const status = STATUS_DO_ROTEIRO.indexOf(o.status as StatusDoRoteiro) >= 0 ? (o.status as StatusDoRoteiro) : "rascunho";
  const atual = numeroEntre(o.versao_atual, 0, 100000, versoes.length ? versoes[versoes.length - 1].numero : 0);
  const aprovada = o.versao_aprovada == null ? null : numeroEntre(o.versao_aprovada, 1, 100000, 0) || null;
  const ultima = versaoPorNumero(versoes, atual);
  return {
    id,
    client_id: clientId,
    task_id: o.task_id ? umaLinha(o.task_id, 40) : null,
    proposta_id: o.proposta_id ? umaLinha(o.proposta_id, 40) : null,
    campanha_id: o.campanha_id ? umaLinha(o.campanha_id, 40) : null,
    titulo: umaLinha(o.titulo, 160) || (ultima ? ultima.conteudo.titulo : "Roteiro"),
    tipo: ehTipoDeRoteiro(o.tipo) ? o.tipo : ultima ? ultima.conteudo.tipo : "fala_camera",
    status,
    versao_atual: atual,
    versao_aprovada: aprovada,
    versoes,
    comentarios: normalizarComentarios(o.comentarios),
    aprovado_por: o.aprovado_por ? umaLinha(o.aprovado_por, 60) : null,
    aprovado_em: o.aprovado_em ? umaLinha(o.aprovado_em, 40) : null,
    gravado_em: o.gravado_em ? umaLinha(o.gravado_em, 40) : null,
    arquivado_em: o.arquivado_em ? umaLinha(o.arquivado_em, 40) : null,
    arquivo_pdf_id: o.arquivo_pdf_id ? umaLinha(o.arquivo_pdf_id, 40) : null,
    custo_usd: Number(o.custo_usd) || 0,
    criado_por: o.criado_por ? umaLinha(o.criado_por, 60) : null,
    criado_em: umaLinha(o.criado_em, 40),
    atualizado_em: umaLinha(o.atualizado_em, 40),
  };
}

// ------------------------------------------------------------------ modelos (templates)

export type EscopoDoModelo = "cliente" | "agencia";

export type EstruturaDoModelo = {
  tipo: TipoDeRoteiro;
  duracao_alvo_s: number;
  formato: string;
  /** Mecanismos dos ganchos, sem o texto do cliente. */
  mecanismos_de_gancho: string[];
  blocos: { funcao: string; segundos: number; orientacao: string; exemplo: string }[];
  direcao: DirecaoDeGravacao;
  cta_tipo: string;
  /** Slots que o cliente de destino preenche (contratos-v2.json, template.slots). */
  slots: string[];
};

export const SLOTS_DO_MODELO = ["marca", "pessoa_que_fala", "produto_ou_servico", "gancho", "prova", "cta"];

/**
 * Tira do texto o que identifica o cliente de origem: os termos privados
 * (nome, marca, pessoa), @perfil, site, e-mail, telefone, registro (OAB,
 * CRM, CNPJ, CPF), valores em R$ e porcentagens. Sem lookbehind.
 */
export function sanitizarTexto(t: string, termosPrivados: string[] = []): string {
  let s = String(t || "");
  const termos = termosPrivados
    .map((x) => String(x || "").trim())
    .filter((x) => x.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const termo of termos) {
    const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(escapado, "gi"), "[marca]");
  }
  s = s
    .replace(/https?:\/\/\S+/gi, "[site]")
    .replace(/\bwww\.\S+/gi, "[site]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[contato]")
    .replace(/@[A-Za-z0-9_.]{2,}/g, "[perfil]")
    .replace(/\b[A-Za-z0-9-]+\.(com|com\.br|net|org|br|io|app)(\/\S*)?\b/gi, "[site]")
    .replace(/\b(OAB|CRM|CRO|CREA|CRP|CRN|CNPJ|CPF)\s*[/:]?\s*[A-Z]{0,2}\s*[\d./-]{3,}/gi, "[registro]")
    .replace(/R\$\s*[\d.,]+/g, "[valor]")
    .replace(/\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g, "[contato]")
    .replace(/\b\d+([.,]\d+)?\s?%/g, "[número]");
  return s.replace(/\s+/g, " ").trim();
}

/** Modelo do cliente: guarda a estrutura e as falas como exemplo (fica só com o cliente). */
export function modeloDoCliente(r: Roteiro): EstruturaDoModelo {
  return {
    tipo: r.tipo,
    duracao_alvo_s: r.duracao_alvo_s,
    formato: r.formato,
    mecanismos_de_gancho: r.ganchos.map((g) => g.mecanismo).filter(Boolean),
    blocos: r.blocos.map((b) => ({ funcao: b.funcao, segundos: b.segundos, orientacao: b.visual, exemplo: b.fala })),
    direcao: r.direcao,
    cta_tipo: r.cta,
    slots: SLOTS_DO_MODELO.slice(),
  };
}

/**
 * Modelo da agência: só o reaproveitável (função, ritmo, plano, direção
 * genérica e mecanismos). Sem fala, legenda, texto na tela, oferta, nome,
 * contato ou número do cliente de origem.
 */
export function modeloDaAgencia(r: Roteiro, termosPrivados: string[] = []): EstruturaDoModelo {
  const limpo = (t: string) => sanitizarTexto(t, termosPrivados);
  return {
    tipo: r.tipo,
    duracao_alvo_s: r.duracao_alvo_s,
    formato: r.formato,
    mecanismos_de_gancho: r.ganchos.map((g) => limpo(g.mecanismo)).filter(Boolean),
    blocos: r.blocos.map((b) => ({ funcao: limpo(b.funcao), segundos: b.segundos, orientacao: limpo(b.visual), exemplo: "" })),
    direcao: {
      enquadramento: limpo(r.direcao.enquadramento),
      ambiente: limpo(r.direcao.ambiente),
      figurino: "",
      objetos: "",
      luz: limpo(r.direcao.luz),
      camera: limpo(r.direcao.camera),
      orientacoes: r.direcao.orientacoes.map(limpo).filter(Boolean),
    },
    cta_tipo: "",
    slots: SLOTS_DO_MODELO.slice(),
  };
}

export function normalizarEstruturaDoModelo(bruto: unknown): EstruturaDoModelo {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const tipo: TipoDeRoteiro = ehTipoDeRoteiro(o.tipo) ? o.tipo : "fala_camera";
  const blocos: EstruturaDoModelo["blocos"] = [];
  for (const b of Array.isArray(o.blocos) ? o.blocos : []) {
    if (!b || typeof b !== "object") continue;
    const x = b as Record<string, unknown>;
    blocos.push({ funcao: umaLinha(x.funcao, 60) || "Bloco", segundos: numeroEntre(x.segundos, 1, 180, 5), orientacao: umaLinha(x.orientacao, 300), exemplo: texto(x.exemplo, 800) });
    if (blocos.length >= 14) break;
  }
  return {
    tipo,
    duracao_alvo_s: numeroEntre(o.duracao_alvo_s, 5, 600, modoDoTipo(tipo).duracao_padrao_s),
    formato: umaLinha(o.formato, 20) || "9:16",
    mecanismos_de_gancho: listaDeTextos(o.mecanismos_de_gancho, 6, 80),
    blocos,
    direcao: normalizarDirecao(o.direcao),
    cta_tipo: umaLinha(o.cta_tipo, 280),
    slots: listaDeTextos(o.slots, 10, 40),
  };
}

/** Texto curto do modelo para o prompt do roteirista (base, não molde). */
export function modeloParaPrompt(m: EstruturaDoModelo, nome: string): string {
  const blocos = m.blocos.map((b, i) => `${i + 1}. ${b.funcao} (${b.segundos}s)${b.orientacao ? `: ${b.orientacao}` : ""}${b.exemplo ? ` | exemplo aprovado: ${b.exemplo.slice(0, 240)}` : ""}`).join("\n");
  const direcao = [m.direcao.enquadramento, m.direcao.ambiente, m.direcao.luz].filter(Boolean).join("; ");
  return `MODELO APROVADO "${nome}" (${modoDoTipo(m.tipo).rotulo}, ${m.duracao_alvo_s}s). Use o ritmo e a estrutura como base; o conteúdo é desta peça.\n${blocos}${direcao ? `\nDireção: ${direcao}` : ""}${m.mecanismos_de_gancho.length ? `\nMecanismos de gancho que funcionaram: ${m.mecanismos_de_gancho.join(", ")}` : ""}`;
}

// ------------------------------------------------------------------ aviso do Jev (só aviso, sem laço de correção)

/** Níveis das perguntas de Score, do pior para o melhor (o Jev devolve 0 a 4). */
export const NIVEIS_RETENCAO = [
  "a abertura não prende e o meio se arrasta",
  "prende pouco ou tem trecho que só atrasa a ideia",
  "razoável, com um ponto de queda",
  "boa abertura e progressão sem trecho morto",
  "abertura forte e cada bloco puxa o próximo",
];
export const NIVEIS_CLAREZA = [
  "confuso ou com termo sem explicação",
  "dá para entender com esforço",
  "claro na maior parte",
  "claro, uma ideia por bloco",
  "muito claro para leigo, cada termo explicado",
];

/**
 * Converte as respostas brutas do Jev (Score de 0 a 4 e Noul de 0 a 1) no
 * aviso da tela, com nota de 1 a 5. Frases só quando algo merece atenção.
 */
export function avisoDasRespostasDoJev(retencaoBruta: number | null, clarezaBruta: number | null, promessa: number | null): AvisoDoJev {
  const nota = (x: number | null) => (x == null || !isFinite(x) ? null : Math.round((Math.max(0, Math.min(4, x)) + 1) * 10) / 10);
  const retencao = nota(retencaoBruta);
  const clareza = nota(clarezaBruta);
  const prob = promessa == null || !isFinite(promessa) ? null : Math.max(0, Math.min(1, promessa));
  const frases: string[] = [];
  if (retencao != null && retencao < 3) frases.push("Retenção: a abertura ou o meio podem perder quem assiste. Confira o gancho e corte o que atrasa a ideia.");
  if (clareza != null && clareza < 3) frases.push("Clareza: há trecho difícil de entender. Troque termo técnico por palavra do público.");
  if (prob != null && prob < 0.5) frases.push("Promessa: o gancho promete mais do que o vídeo entrega, ou não casa com a oferta e o CTA.");
  return { retencao, clareza, promessa_cumprida: prob, frases };
}

// ------------------------------------------------------------------ esquema para o modelo de IA

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const lista = (items: unknown) => ({ type: "array", items });

/** Esquema JSON da saída do roteirista (o motor pede json_schema ao provedor). */
export const ESQUEMA_DO_ROTEIRO = {
  nome: "roteiro_de_video",
  schema: obj({
    titulo: S("string"),
    subtitulo: S("string"),
    objetivo: S("string"),
    logline: S("string"),
    ganchos: lista(obj({ texto: S("string"), mecanismo: S("string"), promessa: S("string"), motivo: S("string") })),
    gancho_escolhido: S("integer"),
    blocos: lista(obj({ funcao: S("string"), fala: S("string"), segundos: S("integer"), visual: S("string"), texto_na_tela: S("string"), broll: S("string") })),
    direcao: obj({
      enquadramento: S("string"),
      ambiente: S("string"),
      figurino: S("string"),
      objetos: S("string"),
      luz: S("string"),
      camera: S("string"),
      orientacoes: lista(S("string")),
    }),
    broll: lista(S("string")),
    cta: S("string"),
    legenda: S("string"),
    hashtags: lista(S("string")),
    pendencias: lista(S("string")),
    fontes: lista(S("string")),
  }),
};

/** Esquema de "refaça o gancho": só os três ganchos novos e o escolhido. */
export const ESQUEMA_DOS_GANCHOS = {
  nome: "ganchos_do_roteiro",
  schema: obj({
    ganchos: lista(obj({ texto: S("string"), mecanismo: S("string"), promessa: S("string"), motivo: S("string") })),
    gancho_escolhido: S("integer"),
  }),
};

/**
 * Troca os ganchos de um roteiro pelos novos. A fala de abertura acompanha o
 * escolhido quando era o gancho anterior (ou o bloco é de abertura).
 */
export function comGanchosNovos(r: Roteiro, brutos: unknown, escolhidoBruto: unknown): Roteiro {
  const novos = normalizarGanchos(brutos, []);
  if (!novos.length) return r;
  const escolhido = numeroEntre(escolhidoBruto, 0, novos.length - 1, 0);
  const anterior = r.ganchos[r.gancho_escolhido];
  const blocos = r.blocos.map((b, i) => {
    if (i !== 0) return b;
    const eraOGancho = !b.fala || (anterior && umaLinha(b.fala, 400) === anterior.texto) || /abertura|gancho/i.test(b.funcao);
    return eraOGancho ? { ...b, fala: novos[escolhido].texto, segundos: segundosDaFala(novos[escolhido].texto) } : b;
  });
  return { ...r, ganchos: novos, gancho_escolhido: escolhido, blocos };
}

/** Rascunho em branco na estrutura do modo (ou do modelo escolhido), sem IA. */
export function roteiroEmBranco(titulo: string, tipo: TipoDeRoteiro, modelo?: EstruturaDoModelo | null): Roteiro {
  const modo = modoDoTipo(tipo);
  const blocos = modelo && modelo.blocos.length
    ? modelo.blocos.map((b) => ({ funcao: b.funcao, fala: b.exemplo, segundos: b.segundos, visual: b.orientacao }))
    : modo.estrutura.map((funcao) => ({ funcao, fala: "", segundos: Math.max(3, Math.round(modo.duracao_padrao_s / modo.estrutura.length)), visual: "a definir" }));
  return normalizarRoteiro(
    {
      titulo,
      tipo,
      duracao_alvo_s: modelo ? modelo.duracao_alvo_s : modo.duracao_padrao_s,
      formato: modelo ? modelo.formato : "9:16",
      blocos,
      direcao: modelo ? modelo.direcao : undefined,
      cta: modelo ? modelo.cta_tipo : "",
    },
    { titulo, tipo },
  );
}

// ------------------------------------------------------------------ custo (tamanhos declarados)

/** Tamanho típico de uma geração de roteiro (estimativa antes de gastar; o custo real vem da resposta). */
export const TAMANHO_DA_GERACAO = { entrada: 14_000, saida: 5_000 };
/** Conversa com o agente da mesa (sem gerar roteiro). */
export const TAMANHO_DA_CONVERSA = { entrada: 9_000, saida: 1_500 };
