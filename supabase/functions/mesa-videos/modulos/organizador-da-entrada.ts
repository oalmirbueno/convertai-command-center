/**
 * Organizador inteligente da Entrada da Mesa Edição (02/10/2026).
 *
 * Pedido do dono: "entender quando é UM vídeo e quando são VÁRIOS. Um vídeo:
 * nomear com o nome do vídeo e separar em pastas. Clipes picados: entender com
 * inteligência (juntar as tomadas da mesma cena, pôr na ordem). Organizar o
 * antes e depois (bruto e as versões editadas e exportadas)."
 *
 * O que este módulo faz (puro: sem Deno, sem banco, sem rede; a tela, a função
 * e os testes usam o mesmo):
 * - `categoriaDoArquivo`: bruto, áudio, cena do Motion, amostra, exportado,
 *   gerado, tratado (antes e depois) ou imagem, pelo tipo, pela origem e pelo nome.
 * - `modoDaEntrada`: um vídeo (uma gravação longa, com ou sem extras curtos),
 *   vários clipes ou só material feito no painel.
 * - `agruparVariantes`: a mesma cena do Motion (cena, amostra 5 s, still, 16:9 e
 *   9:16) e o mesmo render (amostra e final por formato) viram UMA linha com o
 *   selo de variantes.
 * - `cenasDosClipes`: clipes picados juntos por cena: cena do roteiro, cena e
 *   take no nome, fala parecida (tomadas do mesmo texto) e, no meio do caminho,
 *   a decisão do Jev (`decisoes`, montada pela função; aqui só se aplica).
 * - `proporOrganizacaoDaEntrada`: pastas (grupo "Pasta / Subpasta"), nomes e
 *   melhor take sugerido, e o ruído (amostras velhas e stills) para arquivar só
 *   quando pedido. Sai no formato do contrato comum (`ItemProposto` do
 *   organizador de takes): Confirmar, Cancelar e Desfazer. Nada é apagado e o
 *   arquivo no Storage nunca muda.
 */

import {
  extensaoDoNome,
  type ItemProposto,
  lerNomeDoTake,
  limparGrupo,
  limparNome,
  MAX_GRUPO,
  nomeNormalizado,
  type RoteiroParaOrganizar,
  semAcento,
  type TakeParaOrganizar,
} from "./organizador-de-takes.ts";

// ------------------------------------------------------------------ tipos

/** O mínimo de um arquivo do acervo de vídeo (video_arquivos) que o organizador lê. */
export interface ArquivoDaEntrada extends TakeParaOrganizar {
  mime?: string | null;
  bytes?: number | null;
  duracao_s?: number | null;
  largura?: number | null;
  altura?: number | null;
  origem?: Record<string, unknown> | null;
  edicao_desde?: string | null;
}

export const CATEGORIAS = ["bruto", "audio", "cena_motion", "amostra", "exportado", "gerado", "tratado", "imagem"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** Pasta de cada categoria (o dono pediu Brutos, Cenas do Motion, Amostras, Exportados e Antes e depois). */
export const PASTA_DA_CATEGORIA: Record<Categoria, string> = {
  bruto: "Brutos",
  audio: "Áudio",
  cena_motion: "Cenas do Motion",
  amostra: "Amostras",
  exportado: "Exportados",
  gerado: "Gerados",
  tratado: "Antes e depois",
  imagem: "Imagens",
};

/** Ordem das pastas na tela (o bruto primeiro, o que sai do painel por último). */
export const ORDEM_DAS_PASTAS: string[] = ["Brutos", "Antes e depois", "Cenas do Motion", "Gerados", "Exportados", "Amostras", "Áudio", "Imagens"];

export const ROTULO_DA_CATEGORIA: Record<Categoria, string> = {
  bruto: "Bruto",
  audio: "Áudio",
  cena_motion: "Cena do Motion",
  amostra: "Amostra",
  exportado: "Exportado",
  gerado: "Gerado",
  tratado: "Tratado",
  imagem: "Imagem",
};

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const origemDe = (a: Pick<ArquivoDaEntrada, "origem">): Record<string, unknown> => (a.origem && typeof a.origem === "object" ? a.origem : {});
const ehAudio = (a: Pick<ArquivoDaEntrada, "tipo" | "mime">) => a.tipo === "audio" || texto(a.mime).indexOf("audio/") === 0;

/** Sufixo de variante que o worker põe no nome: "(cena 9:16)", "(amostra 5 s 16:9)", "(still 1:1)", "(render 9:16)". */
const SUFIXO_DE_VARIANTE = /\s*\((?:cena|amostra(?:\s+\d+\s*s)?|still|render|sem legenda|melhorad[ao]|antes e depois|3 faixas)(?:\s+(?:\d{1,2}:\d{1,2}))?\)\s*$/i;

/** Nome sem a extensão e sem o sufixo de variante ("Abertura (amostra 5 s 9:16)" -> "Abertura"). */
export function baseDoNome(nome: string): string {
  let s = texto(nome).trim().replace(/\.[a-z0-9]{2,5}$/i, "");
  for (let i = 0; i < 3 && SUFIXO_DE_VARIANTE.test(s); i++) s = s.replace(SUFIXO_DE_VARIANTE, "");
  return s.trim();
}

/** Formato que o nome ou a origem traz ("9:16"), ou null. */
export function formatoDoArquivo(a: Pick<ArquivoDaEntrada, "nome" | "origem" | "largura" | "altura">): string | null {
  const o = origemDe(a);
  if (typeof o.formato === "string" && /^\d{1,2}:\d{1,2}$/.test(o.formato)) return o.formato;
  const m = /\((?:[^)]*\s)?(\d{1,2}:\d{1,2})\)\s*(?:\.[a-z0-9]{2,5})?$/i.exec(texto(a.nome));
  if (m) return m[1];
  if (a.largura && a.altura) {
    const r = a.largura / a.altura;
    if (Math.abs(r - 9 / 16) < 0.03) return "9:16";
    if (Math.abs(r - 16 / 9) < 0.05) return "16:9";
    if (Math.abs(r - 1) < 0.03) return "1:1";
    if (Math.abs(r - 4 / 5) < 0.03) return "4:5";
  }
  return null;
}

/** Categoria do arquivo: tipo + origem gravada pelo worker e pela função + nome. */
export function categoriaDoArquivo(a: ArquivoDaEntrada): Categoria {
  const o = origemDe(a);
  const tipo = texto(a.tipo);
  if (ehAudio(a)) return "audio";
  if (o.tipo === "tratamento") return "tratado";
  if (tipo === "quadro" || tipo === "elemento" || tipo === "angulo") return "imagem";
  if (tipo === "still") return o.motion_id || o.cena_id ? "cena_motion" : "imagem";
  if (tipo === "cena") return "cena_motion";
  if (tipo === "amostra") return "amostra";
  if (tipo === "render" || tipo === "entrega") return "exportado";
  if (tipo === "gerado") return "gerado";
  if (/\((?:cena|still)\s+\d{1,2}:\d{1,2}\)/i.test(texto(a.nome))) return "cena_motion";
  if (/\(amostra[^)]*\)/i.test(texto(a.nome))) return "amostra";
  return "bruto";
}

// ------------------------------------------------------------------ variantes

export interface GrupoDeVariantes<T extends ArquivoDaEntrada = ArquivoDaEntrada> {
  chave: string;
  base: string;
  principal: T;
  /** Todas, com a principal primeiro. */
  variantes: T[];
}

/** Chave da variante: a mesma cena do Motion, o mesmo render (versão) ou o mesmo nome base na mesma família. */
export function chaveDaVariante(a: ArquivoDaEntrada): string {
  const o = origemDe(a);
  const cat = categoriaDoArquivo(a);
  if (cat === "bruto" || cat === "audio" || cat === "gerado" || cat === "tratado") return `arquivo:${a.id}`;
  if (o.cena_id) return `cena:${texto(o.cena_id)}`;
  if (o.versao_id) return `versao:${texto(o.versao_id)}`;
  const familia = cat === "imagem" && a.tipo !== "still" ? `imagem:${a.id}` : "painel";
  if (familia !== "painel") return familia;
  return `nome:${semAcento(baseDoNome(a.nome)).toLowerCase().replace(/\s+/g, " ")}`;
}

/** Peso de quem representa o grupo: o vídeo final da cena antes da amostra e do still. */
function pesoDaPrincipal(a: ArquivoDaEntrada): number {
  const t = texto(a.tipo);
  if (t === "render" || t === "entrega") return 0;
  if (t === "cena") return 1;
  if (t === "amostra") return 3;
  if (t === "still") return 4;
  return 2;
}

const comparar = (x: string | null | undefined, y: string | null | undefined) => {
  const a = x || "";
  const b = y || "";
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Junta as variantes (mesma cena do Motion, mesmo render) numa linha só. A
 * principal é o vídeo final mais novo; a ordem dos grupos segue a da lista.
 */
export function agruparVariantes<T extends ArquivoDaEntrada>(lista: T[]): GrupoDeVariantes<T>[] {
  const porChave: Record<string, T[]> = {};
  const ordem: string[] = [];
  lista.forEach((a) => {
    const k = chaveDaVariante(a);
    if (!porChave[k]) {
      porChave[k] = [];
      ordem.push(k);
    }
    porChave[k].push(a);
  });
  return ordem.map((k) => {
    const variantes = porChave[k].slice().sort((a, b) => pesoDaPrincipal(a) - pesoDaPrincipal(b) || comparar(b.criado_em, a.criado_em) || comparar(a.id, b.id));
    return { chave: k, base: baseDoNome(variantes[0].nome) || variantes[0].nome, principal: variantes[0], variantes };
  });
}

/** Rótulo curto de uma variante na lista ("Amostra 9:16", "Still 16:9", "Final 9:16"). */
export function rotuloDaVariante(a: ArquivoDaEntrada): string {
  const f = formatoDoArquivo(a);
  const t = texto(a.tipo);
  const nome = t === "amostra" ? "Amostra" : t === "still" ? "Still" : t === "cena" ? "Cena" : t === "render" || t === "entrega" ? "Final" : ROTULO_DA_CATEGORIA[categoriaDoArquivo(a)];
  return f ? `${nome} ${f}` : nome;
}

// ------------------------------------------------------------------ um vídeo ou vários

export type ModoDaEntrada = "um_video" | "varios_clipes" | "sem_gravacao";

export interface LeituraDaEntrada {
  modo: ModoDaEntrada;
  /** A gravação principal (modo um_video). */
  principal: string | null;
  brutos: number;
  /** Uma frase para a tela. */
  resumo: string;
}

const duracao = (a: ArquivoDaEntrada) => (typeof a.duracao_s === "number" && isFinite(a.duracao_s) && a.duracao_s > 0 ? a.duracao_s : 0);
const ativos = <T extends ArquivoDaEntrada>(l: T[]) => l.filter((a) => a.estado !== "arquivado");

/** Brutos de vídeo (gravação de fora), na ordem de gravação. */
export function brutosDe<T extends ArquivoDaEntrada>(lista: T[]): T[] {
  return ativos(lista)
    .filter((a) => categoriaDoArquivo(a) === "bruto")
    .sort((a, b) => comparar(a.gravado_em, b.gravado_em) || comparar(a.criado_em, b.criado_em) || comparar(a.nome_original, b.nome_original));
}

/**
 * Um vídeo ou vários clipes. Um bruto: um vídeo. Vários: é um vídeo quando a
 * gravação mais longa tem 1 min ou mais e pelo menos 70% de todo o tempo (os
 * outros são extras curtos); senão são clipes picados.
 */
export function modoDaEntrada(lista: ArquivoDaEntrada[]): LeituraDaEntrada {
  const brutos = brutosDe(lista);
  if (!brutos.length) return { modo: "sem_gravacao", principal: null, brutos: 0, resumo: "Só material feito no painel" };
  if (brutos.length === 1) return { modo: "um_video", principal: brutos[0].id, brutos: 1, resumo: "Um vídeo" };
  const total = brutos.reduce((s, a) => s + duracao(a), 0);
  const maior = brutos.reduce((m, a) => (duracao(a) > duracao(m) ? a : m), brutos[0]);
  if (duracao(maior) >= 60 && total > 0 && duracao(maior) >= 0.7 * total) {
    return { modo: "um_video", principal: maior.id, brutos: brutos.length, resumo: `Um vídeo e ${brutos.length - 1} ${brutos.length - 1 === 1 ? "extra" : "extras"}` };
  }
  return { modo: "varios_clipes", principal: null, brutos: brutos.length, resumo: `${brutos.length} clipes` };
}

// ------------------------------------------------------------------ nome do vídeo

/** Nome de câmera ou celular que não diz nada (IMG_1234, C0012, DJI_0001, VID-2026..., hash). */
export function nomeDeCamera(nome: string): boolean {
  const s = semAcento(texto(nome).replace(/\.[a-z0-9]{2,5}$/i, "")).toLowerCase().replace(/[\s_-]+/g, "_");
  if (!s) return true;
  if (/^(img|vid|mov|mvi|dsc|dji|gopr|gh\d|gx\d|pxl|c|clip|video|record|screen_recording|whatsapp_video)_?\d/.test(s)) return true;
  if (/^\d[\d_]*$/.test(s)) return true;
  if (/^[0-9a-f]{8}_?[0-9a-f]{4}/.test(s)) return true;
  return false;
}

/** "02-10" a partir da data de gravação (ou do envio). */
function diaCurto(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!isFinite(t)) return "";
  const d = new Date(t);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}`;
}

/** Nome do vídeo: o roteiro ligado, o nome que a pessoa deu ou "Vídeo de 02-10". */
export function nomeDoVideo(principal: ArquivoDaEntrada, roteiros: RoteiroParaOrganizar[] = []): string {
  const r = principal.roteiro_id ? roteiros.find((x) => x.id === principal.roteiro_id) : null;
  if (r && r.titulo.trim()) return limparNome(r.titulo).slice(0, 40).trim();
  const original = baseDoNome(principal.nome_original || principal.nome);
  if (original && !nomeDeCamera(original)) return limparNome(original.replace(/[_]+/g, " ")).slice(0, 40).trim();
  const atual = baseDoNome(principal.nome);
  if (atual && !nomeDeCamera(atual) && !/_c\d{2}_t\d{2}$/.test(atual)) return limparNome(atual.replace(/[_]+/g, " ")).slice(0, 40).trim();
  const dia = diaCurto(principal.gravado_em || principal.criado_em);
  return dia ? `Vídeo de ${dia}` : "Vídeo";
}

// ------------------------------------------------------------------ clipes por cena

/** Palavras com 3 letras ou mais, sem acento (para comparar falas). */
export function palavrasDaFala(t: string): string[] {
  return semAcento(texto(t))
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((p) => p.length >= 3);
}

/**
 * Quanto duas falas se parecem (0 a 1): pares de palavras seguidas em comum
 * sobre a menor das duas (tomadas do mesmo texto passam de 0,5 mesmo com um
 * tropeço; falas diferentes ficam perto de 0). Só o começo de cada fala (80
 * palavras): é onde as tomadas se repetem.
 */
export function semelhancaDaFala(a: string, b: string): number {
  const pares = (t: string) => {
    const p = palavrasDaFala(t).slice(0, 80);
    const s = new Set<string>();
    for (let i = 0; i + 1 < p.length; i++) s.add(`${p[i]} ${p[i + 1]}`);
    if (p.length === 1) s.add(p[0]);
    return s;
  };
  const x = pares(a);
  const y = pares(b);
  if (!x.size || !y.size) return 0;
  let comum = 0;
  x.forEach((k) => {
    if (y.has(k)) comum++;
  });
  return Math.round((comum / Math.min(x.size, y.size)) * 1000) / 1000;
}

export const MESMA_CENA = 0.5;
export const CENAS_DIFERENTES = 0.15;
/** Pares na faixa do meio (nem claramente iguais, nem claramente diferentes): o Jev decide. */
export const MAX_PARES_PARA_O_JEV = 20;

export interface ParDeClipes {
  a: string;
  b: string;
  semelhanca: number;
}

/** Pares de clipes com fala na faixa da dúvida (vão para o Jev). */
export function paresEmDuvida(clipes: ArquivoDaEntrada[], falas: Record<string, string>): ParDeClipes[] {
  const comFala = clipes.filter((c) => palavrasDaFala(falas[c.id] || "").length >= 4);
  const saida: ParDeClipes[] = [];
  for (let i = 0; i < comFala.length; i++) {
    for (let j = i + 1; j < comFala.length; j++) {
      const s = semelhancaDaFala(falas[comFala[i].id], falas[comFala[j].id]);
      if (s > CENAS_DIFERENTES && s < MESMA_CENA) saida.push({ a: comFala[i].id, b: comFala[j].id, semelhanca: s });
    }
  }
  return saida.sort((x, y) => y.semelhanca - x.semelhanca).slice(0, MAX_PARES_PARA_O_JEV);
}

export const chaveDoPar = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface CenaDosClipes<T extends ArquivoDaEntrada = ArquivoDaEntrada> {
  numero: number;
  /** Tomadas na ordem (a primeira gravada primeiro). */
  clipes: T[];
  /** De onde veio o agrupamento (para a tela explicar). */
  por: "roteiro" | "nome" | "fala" | "jev" | "sozinho";
}

/**
 * Clipes picados juntos por cena. Ordem de força: cena do roteiro > cena no
 * nome > fala parecida (ou o Jev, nos pares em dúvida) > cada clipe sozinho.
 * Cenas numeradas pela ordem do roteiro ou pela primeira tomada gravada.
 * `decisoes`: chaveDoPar -> true (mesma cena) ou false (cenas diferentes).
 */
export function cenasDosClipes<T extends ArquivoDaEntrada>(
  clipes: T[],
  o: { falas?: Record<string, string>; decisoes?: Record<string, boolean>; roteiros?: RoteiroParaOrganizar[] } = {},
): CenaDosClipes<T>[] {
  const falas = o.falas || {};
  const decisoes = o.decisoes || {};
  const roteiros = o.roteiros || [];
  const lista = clipes.slice().sort((a, b) => comparar(a.gravado_em, b.gravado_em) || comparar(a.criado_em, b.criado_em) || comparar(a.nome_original, b.nome_original) || comparar(a.id, b.id));
  const pai: Record<string, string> = {};
  const por: Record<string, CenaDosClipes["por"]> = {};
  const achar = (x: string): string => (pai[x] === x ? x : (pai[x] = achar(pai[x])));
  const unir = (a: string, b: string, motivo: CenaDosClipes["por"]) => {
    const ra = achar(a);
    const rb = achar(b);
    if (ra === rb) return;
    pai[rb] = ra;
    por[ra] = por[ra] && por[ra] !== "sozinho" ? por[ra] : motivo;
  };
  lista.forEach((c) => {
    pai[c.id] = c.id;
    por[c.id] = "sozinho";
  });
  // 1) Cena do roteiro e 2) cena no nome: chave fixa.
  const porChave: Record<string, string> = {};
  const ordemDoRoteiro: Record<string, number> = {};
  lista.forEach((c) => {
    let chave = "";
    let motivo: CenaDosClipes["por"] = "nome";
    if (c.roteiro_id && c.cena_ref) {
      chave = `r:${c.roteiro_id}:${c.cena_ref}`;
      motivo = "roteiro";
      const r = roteiros.find((x) => x.id === c.roteiro_id);
      const cena = r ? r.cenas.find((x) => x.ref === c.cena_ref) : null;
      if (cena) ordemDoRoteiro[c.id] = cena.ordem;
    } else {
      const n = lerNomeDoTake(c.nome_original || c.nome).cena;
      if (n) chave = `n:${n}`;
    }
    if (!chave) return;
    if (porChave[chave]) unir(porChave[chave], c.id, motivo);
    else {
      porChave[chave] = c.id;
      por[c.id] = motivo;
    }
  });
  // 3) Fala parecida e decisões do Jev (só entre quem ainda não tem cena por roteiro ou nome).
  const semChave = lista.filter((c) => por[achar(c.id)] === "sozinho" || por[achar(c.id)] === "fala" || por[achar(c.id)] === "jev");
  for (let i = 0; i < semChave.length; i++) {
    for (let j = i + 1; j < semChave.length; j++) {
      const a = semChave[i].id;
      const b = semChave[j].id;
      const k = chaveDoPar(a, b);
      if (decisoes[k] === true) {
        unir(a, b, "jev");
        continue;
      }
      if (decisoes[k] === false) continue;
      const fa = falas[a] || "";
      const fb = falas[b] || "";
      if (palavrasDaFala(fa).length < 4 || palavrasDaFala(fb).length < 4) continue;
      if (semelhancaDaFala(fa, fb) >= MESMA_CENA) unir(a, b, "fala");
    }
  }
  const grupos: Record<string, T[]> = {};
  const ordem: string[] = [];
  lista.forEach((c) => {
    const r = achar(c.id);
    if (!grupos[r]) {
      grupos[r] = [];
      ordem.push(r);
    }
    grupos[r].push(c);
  });
  const ordemDe = (r: string) => {
    const doRoteiro = grupos[r].map((c) => ordemDoRoteiro[c.id]).filter((n) => typeof n === "number") as number[];
    const doNome = grupos[r].map((c) => lerNomeDoTake(c.nome_original || c.nome).cena).filter((n): n is number => !!n);
    return doRoteiro.length ? Math.min.apply(null, doRoteiro) : doNome.length ? Math.min.apply(null, doNome) : null;
  };
  const posicao: Record<string, number> = {};
  ordem.forEach((r, i) => (posicao[r] = i));
  ordem.sort((x, y) => {
    const ox = ordemDe(x);
    const oy = ordemDe(y);
    if (ox !== null && oy !== null && ox !== oy) return ox - oy;
    return posicao[x] - posicao[y];
  });
  return ordem.map((r, i) => {
    const tomadas = grupos[r].slice().sort((a, b) => (lerNomeDoTake(a.nome_original || a.nome).take || 999) - (lerNomeDoTake(b.nome_original || b.nome).take || 999) || comparar(a.gravado_em, b.gravado_em) || comparar(a.criado_em, b.criado_em));
    return { numero: i + 1, clipes: tomadas, por: tomadas.length > 1 ? por[r] : por[r] === "roteiro" || por[r] === "nome" ? por[r] : "sozinho" };
  });
}

// ------------------------------------------------------------------ proposta

export interface OpcoesDaOrganizacao {
  roteiros?: RoteiroParaOrganizar[];
  /** Fala de cada bruto (texto; a tela manda o que transcreveu). */
  falas?: Record<string, string>;
  /** chaveDoPar -> mesma cena (decisão do Jev nos pares em dúvida). */
  decisoes?: Record<string, boolean>;
  /** Arquivar o ruído (amostras com final pronto, stills de cena com vídeo, renders velhos do mesmo formato). */
  arquivarRuido?: boolean;
  /** Sugerir o melhor take (a última tomada) nas cenas sem melhor marcado. */
  melhores?: boolean;
}

export interface PropostaDaEntrada {
  leitura: LeituraDaEntrada;
  /** Prefixo das pastas (o nome do vídeo no modo um_video; o roteiro único nos clipes). */
  prefixo: string | null;
  itens: ItemProposto[];
  /** Grupo final de cada arquivo (depois de confirmar). */
  pastas: Record<string, string>;
  cenas: { numero: number; ids: string[]; por: CenaDosClipes["por"] }[];
  ruido: string[];
  resumo: string;
}

const juntarPasta = (...partes: Array<string | null | undefined>) => limparGrupo(partes.filter((p) => !!p && String(p).trim()).join(" / ")).slice(0, MAX_GRUPO);
const doisDigitos = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Pasta de quem não é bruto: a da categoria, com o prefixo do vídeo. */
export function pastaDoArquivo(a: ArquivoDaEntrada, prefixo: string | null): string {
  return juntarPasta(prefixo, PASTA_DA_CATEGORIA[categoriaDoArquivo(a)]);
}

/** O que é ruído (só arquiva quando pedido): amostra com final, still de cena com vídeo, render velho do mesmo formato. */
export function ruidoDaEntrada(lista: ArquivoDaEntrada[], emVersaoAprovada: (id: string) => boolean = () => false): string[] {
  const saida: string[] = [];
  agruparVariantes(ativos(lista)).forEach((g) => {
    if (g.variantes.length < 2) return;
    const temVideoFinal = g.variantes.some((v) => v.tipo === "cena" || v.tipo === "render" || v.tipo === "entrega");
    const vistosPorFormato: Record<string, boolean> = {};
    g.variantes.forEach((v) => {
      if (v.melhor || emVersaoAprovada(v.id)) return;
      if ((v.tipo === "amostra" || v.tipo === "still") && temVideoFinal) {
        saida.push(v.id);
        return;
      }
      if (v.tipo === "render" || v.tipo === "cena") {
        // A lista vem com a mais nova primeiro (agruparVariantes): a segunda do mesmo formato é velha.
        const f = formatoDoArquivo(v) || "?";
        if (vistosPorFormato[f]) saida.push(v.id);
        vistosPorFormato[f] = true;
      }
    });
  });
  return saida;
}

/**
 * A proposta: pasta de cada arquivo, nome dos brutos, melhor take e (se pedido)
 * o ruído para arquivar. Só entra o que muda.
 */
export function proporOrganizacaoDaEntrada(lista: ArquivoDaEntrada[], o: OpcoesDaOrganizacao = {}, emVersaoAprovada: (id: string) => boolean = () => false): PropostaDaEntrada {
  const roteiros = o.roteiros || [];
  const todos = ativos(lista);
  const leitura = modoDaEntrada(todos);
  const brutos = brutosDe(todos);
  const itens: ItemProposto[] = [];
  const pastas: Record<string, string> = {};
  const nomes: Record<string, string> = {};
  let prefixo: string | null = null;
  let cenas: PropostaDaEntrada["cenas"] = [];

  if (leitura.modo === "um_video") {
    const principal = brutos.find((b) => b.id === leitura.principal) || brutos[0];
    prefixo = nomeDoVideo(principal, roteiros);
    const ext = extensaoDoNome(principal.nome_original || principal.nome);
    nomes[principal.id] = limparNome(`${prefixo}${ext ? `.${ext}` : ""}`);
    pastas[principal.id] = juntarPasta(prefixo, "Brutos");
    let n = 2;
    brutos.forEach((b) => {
      if (b.id === principal.id) return;
      const e = extensaoDoNome(b.nome_original || b.nome);
      nomes[b.id] = limparNome(`${prefixo} extra ${n++}${e ? `.${e}` : ""}`);
      pastas[b.id] = juntarPasta(prefixo, "Brutos", "Extras");
    });
  } else if (leitura.modo === "varios_clipes") {
    const doRoteiro = brutos.map((b) => b.roteiro_id).filter((x): x is string => !!x);
    const unico = doRoteiro.length === brutos.length && doRoteiro.every((x) => x === doRoteiro[0]) ? roteiros.find((r) => r.id === doRoteiro[0]) || null : null;
    prefixo = unico ? limparNome(unico.titulo).slice(0, 40).trim() || null : null;
    const base = prefixo || "clipe";
    const achadas = cenasDosClipes(brutos, { falas: o.falas, decisoes: o.decisoes, roteiros });
    cenas = achadas.map((c) => ({ numero: c.numero, ids: c.clipes.map((x) => x.id), por: c.por }));
    achadas.forEach((c) => {
      c.clipes.forEach((clipe, i) => {
        nomes[clipe.id] = nomeNormalizado({ base, cena: c.numero, take: i + 1, ext: extensaoDoNome(clipe.nome_original || clipe.nome) });
        pastas[clipe.id] = juntarPasta(prefixo, "Brutos", `Cena ${doisDigitos(c.numero)}`);
      });
      if (o.melhores && c.clipes.length > 1 && !c.clipes.some((x) => x.melhor)) {
        itens.push({ arquivo_id: c.clipes[c.clipes.length - 1].id, operacao: "marcar_melhor", para: "" });
      }
    });
  }

  // O que não é bruto: pasta da categoria. Tratado vai para "Antes e depois" com o nome do antes.
  todos.forEach((a) => {
    if (pastas[a.id]) return;
    pastas[a.id] = pastaDoArquivo(a, prefixo);
  });

  const ruido = o.arquivarRuido ? ruidoDaEntrada(todos, emVersaoAprovada) : [];
  todos.forEach((a) => {
    if (ruido.indexOf(a.id) >= 0) {
      itens.push({ arquivo_id: a.id, operacao: "arquivar", para: "" });
      return;
    }
    if ((a.grupo || "") !== pastas[a.id]) itens.push({ arquivo_id: a.id, operacao: "agrupar", para: pastas[a.id] });
    if (nomes[a.id] && nomes[a.id] !== a.nome) itens.push({ arquivo_id: a.id, operacao: "renomear", para: nomes[a.id] });
  });

  const mexidos = new Set(itens.map((i) => i.arquivo_id)).size;
  const partes: string[] = [];
  partes.push(leitura.modo === "um_video" ? `Um vídeo: "${prefixo}"` : leitura.modo === "varios_clipes" ? `${brutos.length} clipes em ${cenas.length} ${cenas.length === 1 ? "cena" : "cenas"}` : "Material do painel");
  if (mexidos) partes.push(`${mexidos} ${mexidos === 1 ? "arquivo muda" : "arquivos mudam"} de pasta ou nome`);
  if (ruido.length) partes.push(`${ruido.length} para arquivar`);
  return { leitura, prefixo, itens, pastas, cenas, ruido, resumo: `${partes.join(". ")}. O arquivo original não muda.` };
}

// ------------------------------------------------------------------ pastas na tela

export interface PastaNaTela<T extends ArquivoDaEntrada = ArquivoDaEntrada> {
  caminho: string;
  grupos: GrupoDeVariantes<T>[];
  total: number;
}

const posicaoDaPasta = (caminho: string) => {
  const partes = caminho.split(" / ");
  for (let i = 0; i < partes.length; i++) {
    const k = ORDEM_DAS_PASTAS.indexOf(partes[i]);
    if (k >= 0) return k;
  }
  return ORDEM_DAS_PASTAS.length;
};

/** Arquivos por pasta (grupo), com as variantes juntas; pastas na ordem da casa e "Sem pasta" no fim. */
export function pastasNaTela<T extends ArquivoDaEntrada>(lista: T[]): PastaNaTela<T>[] {
  const porPasta: Record<string, T[]> = {};
  ativos(lista).forEach((a) => {
    const p = a.grupo && a.grupo.trim() ? a.grupo.trim() : "Sem pasta";
    (porPasta[p] = porPasta[p] || []).push(a);
  });
  return Object.keys(porPasta)
    .sort((x, y) => (x === "Sem pasta" ? 1 : y === "Sem pasta" ? -1 : posicaoDaPasta(x) - posicaoDaPasta(y) || x.localeCompare(y, "pt-BR", { numeric: true })))
    .map((caminho) => {
      const itens = porPasta[caminho].slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
      return { caminho, grupos: agruparVariantes(itens), total: itens.length };
    });
}

/** O antes de um tratado (origem.de_arquivo_id), quando ainda está na lista. */
export function antesDoTratado<T extends ArquivoDaEntrada>(tratado: ArquivoDaEntrada, lista: T[]): T | null {
  const de = texto(origemDe(tratado).de_arquivo_id);
  return de ? lista.find((a) => a.id === de) || null : null;
}

// ------------------------------------------------------------------ Jev (pares em dúvida)

/** Confiança mínima para o Jev juntar ou separar dois clipes. */
export const CONFIANCA_DO_JEV = 0.6;

/**
 * As perguntas ao Jev (Choice) sobre os pares em dúvida: "estes dois clipes
 * são tomadas da mesma cena?". O estado leva o nome, a duração e o começo da
 * fala de cada clipe; uma pergunta por par (p1, p2...).
 */
export function perguntaDosPares(pares: ParDeClipes[], clipes: ArquivoDaEntrada[], falas: Record<string, string>) {
  const porId: Record<string, ArquivoDaEntrada> = {};
  clipes.forEach((c) => (porId[c.id] = c));
  const resumo = (id: string) => {
    const c = porId[id];
    return { nome: c ? c.nome_original || c.nome : id, duracao_s: c && typeof c.duracao_s === "number" ? Math.round(c.duracao_s) : null, fala: String(falas[id] || "").replace(/\s+/g, " ").trim().slice(0, 500) };
  };
  const state: Record<string, unknown> = { contexto: "Clipes gravados para um vídeo curto (Reels). A mesma fala gravada de novo é outra tomada da mesma cena.", pares: {} };
  const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> = {};
  pares.forEach((p, k) => {
    const id = `p${k + 1}`;
    (state.pares as Record<string, unknown>)[id] = { clipe_a: resumo(p.a), clipe_b: resumo(p.b) };
    questions[id] = {
      type: "choice",
      instructions: `Olhe o par \`pares.${id}\`. Os dois clipes são tomadas da mesma cena (a mesma fala repetida, com pequenas diferenças) ou são partes diferentes do vídeo?`,
      criteria: {
        mesma_cena: "São tomadas da mesma cena: repetem a mesma fala ou o mesmo momento, mesmo com palavras trocadas ou tropeços.",
        cenas_diferentes: "São partes diferentes do vídeo: falam de assuntos ou momentos diferentes.",
      },
    };
  });
  return { state, questions };
}

/** Decisões do Jev por par (só as com confiança suficiente). */
export function decisoesDoJev(pares: ParDeClipes[], respostas: Record<string, { choice?: string; confidence?: number }>, minimo = CONFIANCA_DO_JEV): Record<string, boolean> {
  const saida: Record<string, boolean> = {};
  pares.forEach((p, k) => {
    const r = respostas[`p${k + 1}`];
    if (!r || (typeof r.confidence === "number" && r.confidence < minimo)) return;
    if (r.choice === "mesma_cena") saida[chaveDoPar(p.a, p.b)] = true;
    else if (r.choice === "cenas_diferentes") saida[chaveDoPar(p.a, p.b)] = false;
  });
  return saida;
}
