/**
 * Trilha e efeitos da campanha: as regras puras (22/10/2026). Sem banco, sem
 * fetch, sem Deno: o servidor (trilha-da-campanha.ts) e os testes usam as
 * mesmas. Pedido do dono: "um seletor de músicas para usar ... sem voz, e sim
 * os sons com base no tema; isso dentro da campanha".
 *
 * - O tema sai do nome, pedido, conceito e objetivo da campanha (palavras fixas
 *   de data e estação; regra fixa, sem IA) e, sem data reconhecida, do tipo.
 * - O tom sai do tom da campanha (comercial direto, criativo, institucional) e
 *   do tom escrito no briefing.
 * - Toda trilha é instrumental: o pedido sempre leva a frase de "sem voz" e o
 *   cliente da ElevenLabs manda force_instrumental.
 * - Provedores: a ElevenLabs Music é a ligada. O "suno" fica DESLIGADO: o Suno
 *   não tem API oficial pública (só programa fechado de parceiros) e as "APIs
 *   do Suno" vendidas são de terceiros não afiliados. Só liga quando houver API
 *   oficial e chave no servidor; até lá nada de terceiros é chamado.
 * Sem travessão.
 */

import { estimarEfeito, estimarMusica } from "../../mesa-motion/modulos/narracao.ts";

// ------------------------------------------------------------------ provedores

export type IdDoProvedor = "elevenlabs" | "suno";

export interface ProvedorDeTrilha {
  id: IdDoProvedor;
  nome: string;
  /** Só o provedor ligado gera. */
  ligado: boolean;
  /** Por que está desligado (a tela mostra no title). */
  motivo: string | null;
  faz_musica: boolean;
  faz_efeitos: boolean;
}

export const PROVEDORES_DE_TRILHA: Record<IdDoProvedor, ProvedorDeTrilha> = {
  elevenlabs: { id: "elevenlabs", nome: "ElevenLabs Music", ligado: true, motivo: null, faz_musica: true, faz_efeitos: true },
  // DESLIGADO de propósito: só liga quando o Suno abrir API oficial e houver chave no servidor.
  // Não trocar por API de terceiros (não afiliadas ao Suno): nada sai daqui para elas.
  suno: { id: "suno", nome: "Suno", ligado: false, motivo: "O Suno ainda não tem API oficial pública. Liga quando houver API oficial e chave.", faz_musica: true, faz_efeitos: false },
};

/** O provedor que gera agora (o pedido de um desligado cai no erro, nunca em outro lugar). */
export function provedorParaGerar(id: unknown): ProvedorDeTrilha {
  const p = PROVEDORES_DE_TRILHA[(typeof id === "string" && id in PROVEDORES_DE_TRILHA ? id : "elevenlabs") as IdDoProvedor];
  return p;
}

// ------------------------------------------------------------------ temas

export interface EfeitoDoTema {
  id: string;
  rotulo: string;
  /** Pedido para a ElevenLabs Sound Effects (inglês rende melhor). */
  prompt: string;
  duracao_s: number;
}

export interface TemaSonoro {
  id: string;
  rotulo: string;
  /** Palavras (minúsculas, sem acento) que reconhecem o tema no nome ou no pedido. */
  palavras: string[];
  /** Clima da música, em inglês. */
  musica: string;
  efeitos: EfeitoDoTema[];
}

const ef = (id: string, rotulo: string, prompt: string, duracao_s = 2): EfeitoDoTema => ({ id, rotulo, prompt, duracao_s });

export const TEMAS_SONOROS: TemaSonoro[] = [
  {
    id: "black_friday",
    rotulo: "Black Friday",
    palavras: ["black friday", "blackfriday", "black week", "black november", "cyber monday", "esquenta black"],
    musica: "high-energy electronic retail hype track, punchy four-on-the-floor drums, bright synth stabs, rising risers, urgent and exciting",
    efeitos: [ef("caixa", "Caixa registradora", "cash register ka-ching, bright and clean", 1.5), ef("swoosh", "Swoosh", "fast whoosh swoosh transition", 1), ef("alerta", "Alerta de oferta", "short upbeat notification alert chime for a flash sale", 1.5)],
  },
  {
    id: "natal",
    rotulo: "Natal",
    palavras: ["natal", "natalino", "natalina", "papai noel", "christmas", "xmas", "noite feliz"],
    musica: "warm cozy Christmas track, sleigh bells, celesta, soft pizzicato strings and gentle piano, heartfelt and welcoming",
    efeitos: [ef("sinos", "Sininhos", "gentle sleigh bells jingle", 2), ef("magia", "Brilho mágico", "magical sparkle chime shimmer", 1.5), ef("presente", "Presente abrindo", "gift wrapping paper tearing and box opening", 2)],
  },
  {
    id: "halloween",
    rotulo: "Halloween",
    palavras: ["halloween", "dia das bruxas", "bruxa", "abobora", "terror", "assombr"],
    musica: "mysterious playful Halloween track with a wink of humor, pizzicato strings, harpsichord, theremin-like lead and light spooky percussion, not scary",
    efeitos: [ef("rangido", "Rangido de porta", "old wooden door creaking slowly", 2.5), ef("risada", "Risada leve", "light playful witch cackle, short and funny, not scary", 2), ef("trovao", "Trovão", "distant thunder rumble", 3)],
  },
  {
    id: "dia_das_maes",
    rotulo: "Dia das Mães",
    palavras: ["dia das maes", "maes", "mamae"],
    musica: "tender emotional track, soft piano and warm strings, gentle and grateful",
    efeitos: [ef("brilho", "Brilho suave", "soft warm sparkle chime", 1.5), ef("coracao", "Batida de coração", "gentle heartbeat thump, warm", 2), ef("swoosh", "Swoosh suave", "soft airy whoosh transition", 1)],
  },
  {
    id: "dia_dos_pais",
    rotulo: "Dia dos Pais",
    palavras: ["dia dos pais", "papai"],
    musica: "warm confident acoustic track, acoustic guitar, light drums and bass, proud and friendly",
    efeitos: [ef("brinde", "Brinde", "two glasses clinking cheers", 1.5), ef("swoosh", "Swoosh", "fast whoosh swoosh transition", 1), ef("aplauso", "Aplauso curto", "short warm applause", 2)],
  },
  {
    id: "namorados",
    rotulo: "Dia dos Namorados",
    palavras: ["namorados", "dia dos namorados", "valentine", "casal", "romant"],
    musica: "romantic warm track, soft electric piano, light groove and lush pads, intimate and charming",
    efeitos: [ef("beijo", "Beijinho", "light cute kiss sound", 1), ef("brilho", "Brilho", "soft sparkle chime", 1.5), ef("coracao", "Batida de coração", "gentle heartbeat thump", 2)],
  },
  {
    id: "pascoa",
    rotulo: "Páscoa",
    palavras: ["pascoa", "coelho", "ovo de chocolate", "ovos de chocolate"],
    musica: "light cheerful spring track, marimba, pizzicato and glockenspiel, sweet and playful",
    efeitos: [ef("pop", "Pop doce", "cute bubbly pop", 1), ef("quebra", "Ovo quebrando", "chocolate egg cracking crisp", 1.5), ef("brilho", "Brilho", "magical sparkle chime", 1.5)],
  },
  {
    id: "carnaval",
    rotulo: "Carnaval",
    palavras: ["carnaval", "folia", "bloco", "samba"],
    musica: "festive Brazilian carnival batucada groove, surdo, tamborim and agogo, brass stabs, joyful and loud",
    efeitos: [ef("apito", "Apito de samba", "samba whistle short pattern", 1.5), ef("confete", "Confete", "party popper confetti burst", 1.5), ef("multidao", "Multidão animada", "excited crowd cheering short", 2.5)],
  },
  {
    id: "festa_junina",
    rotulo: "Festa Junina",
    palavras: ["festa junina", "junina", "julina", "sao joao", "arraia", "arraial", "quadrilha"],
    musica: "festive Brazilian forro track, accordion, zabumba and triangle, warm and danceable",
    efeitos: [ef("fogos", "Fogos", "small firework crackle and pop", 2), ef("fogueira", "Fogueira", "crackling bonfire", 3), ef("sanfona", "Sanfona", "short accordion flourish", 2)],
  },
  {
    id: "dia_das_criancas",
    rotulo: "Dia das Crianças",
    palavras: ["dia das criancas", "criancas", "crianca", "infantil", "brinquedo"],
    musica: "playful bouncy kids track, ukulele, glockenspiel, claps and whistles, fun and bright",
    efeitos: [ef("boing", "Boing", "cartoon boing spring", 1), ef("pop", "Pop", "cute bubbly pop", 1), ef("risadas", "Risadas", "kids laughing happily short", 2)],
  },
  {
    id: "ano_novo",
    rotulo: "Ano Novo",
    palavras: ["ano novo", "reveillon", "virada", "new year"],
    musica: "celebratory uplifting track, shimmering synths, claps and a big build, hopeful and festive",
    efeitos: [ef("fogos", "Fogos", "fireworks bursting in the sky", 3), ef("champanhe", "Champanhe", "champagne cork pop and fizz", 2), ef("contagem", "Brinde", "glasses clinking cheers", 1.5)],
  },
  {
    id: "outubro_rosa",
    rotulo: "Outubro Rosa",
    palavras: ["outubro rosa", "novembro azul", "prevencao", "conscientiza"],
    musica: "hopeful gentle track, soft piano, warm strings and light pulse, caring and respectful",
    efeitos: [ef("brilho", "Brilho suave", "soft warm sparkle chime", 1.5), ef("coracao", "Batida de coração", "gentle heartbeat thump", 2), ef("swoosh", "Swoosh suave", "soft airy whoosh", 1)],
  },
  {
    id: "aniversario",
    rotulo: "Aniversário",
    palavras: ["aniversario", "anos de", "parabens"],
    musica: "joyful celebration track, upbeat pop groove, claps and bright brass, festive",
    efeitos: [ef("confete", "Confete", "party popper confetti burst", 1.5), ef("aplauso", "Aplausos", "short cheerful applause", 2), ef("buzina", "Língua de sogra", "party horn blow", 1.5)],
  },
  {
    id: "verao",
    rotulo: "Verão",
    palavras: ["verao", "praia", "ferias", "summer"],
    musica: "sunny tropical house track, marimba, light guitar and breezy groove, carefree",
    efeitos: [ef("ondas", "Ondas", "gentle ocean waves", 3), ef("gelo", "Gelo no copo", "ice cubes clinking in a glass", 1.5), ef("splash", "Mergulho", "water splash", 1.5)],
  },
  {
    id: "inverno",
    rotulo: "Inverno",
    palavras: ["inverno", "friozinho", "winter"],
    musica: "cozy winter lo-fi track, soft keys, warm bass and brushed drums, comforting",
    efeitos: [ef("vento", "Vento frio", "cold winter wind gust", 2.5), ef("xicara", "Xícara", "ceramic mug placed on table with steam", 1.5), ef("lareira", "Lareira", "fireplace crackle", 3)],
  },
  {
    id: "lancamento",
    rotulo: "Lançamento",
    palavras: ["lancamento", "novidade", "chegou", "nova colecao", "launch"],
    musica: "modern product launch track, cinematic build, tight drums and bold synth bass, confident reveal",
    efeitos: [ef("revelar", "Revelação", "cinematic reveal whoosh with impact", 2), ef("impacto", "Impacto", "deep cinematic boom impact", 2), ef("brilho", "Brilho", "shiny sparkle glint", 1)],
  },
  {
    id: "promocao",
    rotulo: "Promoção",
    palavras: ["promocao", "promo", "liquida", "queima", "desconto", "oferta"],
    musica: "upbeat energetic retail track, bouncy bass, claps and bright synths, exciting and positive",
    efeitos: [ef("caixa", "Caixa registradora", "cash register ka-ching", 1.5), ef("swoosh", "Swoosh", "fast whoosh swoosh transition", 1), ef("alerta", "Alerta de oferta", "short upbeat notification alert chime", 1.5)],
  },
  {
    id: "institucional",
    rotulo: "Institucional",
    palavras: [],
    musica: "elegant modern corporate track, soft piano, light strings and subtle pulse, trustworthy and calm",
    efeitos: [ef("swoosh", "Swoosh suave", "soft airy whoosh transition", 1), ef("brilho", "Brilho", "subtle shiny glint", 1), ef("clique", "Clique", "clean soft UI click", 0.5)],
  },
];

const TEMA_POR_TIPO: Record<string, string> = {
  promocao: "promocao",
  lancamento: "lancamento",
  institucional: "institucional",
  prova_social: "institucional",
  evento: "aniversario",
  data_comemorativa: "institucional",
  sazonal: "institucional",
};

/** Minúsculas e sem acento (normalize existe no Safari 11; sem \p{}). */
export function semAcento(v: unknown): string {
  return String(v == null ? "" : v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface CampanhaParaOSom {
  nome?: string | null;
  pedido?: string | null;
  conceito?: string | null;
  objetivo?: string | null;
  /** identidade.tipo */
  tipo?: string | null;
  /** briefing.tom_da_campanha */
  tom_da_campanha?: string | null;
  /** briefing.tom (texto da equipe) */
  tom?: string | null;
}

export function temaPorId(id: unknown): TemaSonoro | null {
  return TEMAS_SONOROS.find((t) => t.id === id) || null;
}

/**
 * O tema da campanha: a primeira data ou estação citada no nome (o nome manda),
 * depois no pedido, conceito e objetivo; sem nenhuma, o tipo da campanha; sem
 * tipo, institucional.
 */
export function temaDaCampanha(c: CampanhaParaOSom): TemaSonoro {
  const fontes = [c.nome, c.pedido, c.conceito, c.objetivo].map(semAcento);
  for (const f of fontes) {
    if (!f) continue;
    // Palavra mais longa primeiro: "dia dos pais" antes de "pais".
    let melhor: { tema: TemaSonoro; tam: number } | null = null;
    for (const t of TEMAS_SONOROS) {
      for (const p of t.palavras) {
        if (f.indexOf(p) >= 0 && (!melhor || p.length > melhor.tam)) melhor = { tema: t, tam: p.length };
      }
    }
    if (melhor) return melhor.tema;
  }
  return temaPorId(TEMA_POR_TIPO[String(c.tipo || "")] || "institucional") as TemaSonoro;
}

const TOM_EM_MUSICA: Record<string, string> = {
  comercial_direto: "punchy and direct, energetic, made for a sales message",
  comercial_criativo: "playful and inventive, with a surprising twist",
  institucional: "understated and elegant, never pushy",
};

// ------------------------------------------------------------------ pedido da trilha

export const DURACOES_DA_TRILHA = [15, 30, 60] as const;
export type DuracaoDaTrilha = (typeof DURACOES_DA_TRILHA)[number];
export const MIN_OPCOES = 2;
export const MAX_OPCOES = 3;

export function duracaoValida(v: unknown): DuracaoDaTrilha {
  const n = Number(v);
  return (DURACOES_DA_TRILHA as readonly number[]).indexOf(n) >= 0 ? (n as DuracaoDaTrilha) : 30;
}

export function opcoesValidas(v: unknown): number {
  const n = Math.round(Number(v));
  return isFinite(n) ? Math.max(MIN_OPCOES, Math.min(MAX_OPCOES, n)) : MAX_OPCOES;
}

/** A frase que vai em TODO pedido de música: sem voz. */
export const SEM_VOZ = "Instrumental only: no vocals, no singing, no humming, no choir, no spoken words, no lyrics.";

/** Cada opção do pedido puxa para um lado, para o dono ter escolha de verdade. */
export const VARIACOES = [
  { id: "a", rotulo: "Opção A", arranjo: "full arrangement with a clear hook" },
  { id: "b", rotulo: "Opção B", arranjo: "minimal and airy arrangement, leaves room for text on screen" },
  { id: "c", rotulo: "Opção C", arranjo: "cinematic build with a bigger ending" },
] as const;

export interface PedidoDaTrilha {
  tema: string;
  variacao: string;
  rotulo: string;
  titulo: string;
  duracao_s: DuracaoDaTrilha;
  loop: boolean;
  prompt: string;
  /** Sempre true: a ElevenLabs recebe force_instrumental. */
  instrumental: true;
}

const limpar = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[–—]/g, ",").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Os pedidos de uma rodada (2 ou 3 opções), montados pelo tema e pelo tom da campanha. */
export function pedidosDaTrilha(c: CampanhaParaOSom, o: { duracao?: unknown; loop?: unknown; opcoes?: unknown; extra?: unknown; tema?: unknown }): PedidoDaTrilha[] {
  const tema = temaPorId(o.tema) || temaDaCampanha(c);
  const duracao = duracaoValida(o.duracao);
  const loop = o.loop === true;
  const tom = TOM_EM_MUSICA[String(c.tom_da_campanha || "")] || "";
  const tomEscrito = limpar(c.tom, 140);
  const extra = limpar(o.extra, 300);
  const quantas = opcoesValidas(o.opcoes);
  const forma = loop
    ? `Seamless loop for Instagram Stories and Reels: ${duracao} seconds, no intro and no ending, the last bar flows back into the first.`
    : `${duracao} seconds with a quick intro, a lift in the middle and a clean ending.`;
  return VARIACOES.slice(0, quantas).map((v) => {
    const partes = [
      `${tema.musica}.`,
      tom ? `Mood: ${tom}.` : "",
      tomEscrito ? `Brand tone (Portuguese): ${tomEscrito}.` : "",
      `${v.arranjo.charAt(0).toUpperCase()}${v.arranjo.slice(1)}.`,
      extra ? `Extra direction (Portuguese): ${extra}.` : "",
      forma,
      SEM_VOZ,
    ].filter(Boolean);
    return {
      tema: tema.id,
      variacao: v.id,
      rotulo: v.rotulo,
      titulo: `${tema.rotulo} · ${v.rotulo}${loop ? " · loop" : ""} · ${duracao} s`,
      duracao_s: duracao,
      loop,
      prompt: partes.join(" ").slice(0, 900),
      instrumental: true as const,
    };
  });
}

// ------------------------------------------------------------------ efeitos

export const MAX_EFEITO_LIVRE = 300;

/** O pacote curto do tema (3 efeitos sugeridos). */
export function pacoteDeEfeitos(c: CampanhaParaOSom, temaId?: unknown): { tema: TemaSonoro; efeitos: EfeitoDoTema[] } {
  const tema = temaPorId(temaId) || temaDaCampanha(c);
  return { tema, efeitos: tema.efeitos.slice() };
}

/** Um efeito pedido livre pela equipe (2 s, até 10 s). */
export function efeitoLivre(texto: unknown, duracao?: unknown): EfeitoDoTema | null {
  const t = limpar(texto, MAX_EFEITO_LIVRE);
  if (t.length < 3) return null;
  const d = Math.max(0.5, Math.min(10, Number(duracao) || 2));
  return { id: "livre", rotulo: t.slice(0, 60), prompt: t, duracao_s: d };
}

// ------------------------------------------------------------------ custo

const arred = (n: number) => Math.round(n * 1e6) / 1e6;

export function custoDaTrilha(duracao: unknown, opcoes: unknown): number {
  return arred(estimarMusica(duracaoValida(duracao)) * opcoesValidas(opcoes));
}

export function custoDosEfeitos(efeitos: EfeitoDoTema[]): number {
  return arred(efeitos.reduce((s, e) => s + estimarEfeito(e.duracao_s), 0));
}

export function tabelaDeCustos(): { trilha: Record<string, number>; efeito: number } {
  const trilha: Record<string, number> = {};
  for (const d of DURACOES_DA_TRILHA) trilha[String(d)] = arred(estimarMusica(d));
  return { trilha, efeito: arred(estimarEfeito(2)) };
}

// ------------------------------------------------------------------ escolha no briefing

export interface TrilhaDoBriefing {
  /** Caminho no Storage (bucket mesa) do MP3 escolhido. */
  arquivo: string;
  titulo: string;
  duracao: number;
  /** Provedor que gerou (elevenlabs) ou "enviada". */
  origem: string;
  /** Registro na Mídia (video_arquivos) e em Arquivos do cliente (files), quando houver. */
  som_id?: string;
  file_id?: string;
  loop?: boolean;
  escolhida_em?: string;
}

/** A trilha escolhida guardada em briefing.trilha (ou null quando não é válida). */
export function trilhaDoBriefing(v: unknown): TrilhaDoBriefing | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const arquivo = typeof o.arquivo === "string" && o.arquivo.indexOf("..") < 0 ? o.arquivo.slice(0, 400) : "";
  if (!arquivo) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    arquivo,
    titulo: limpar(o.titulo, 120) || "Trilha da campanha",
    duracao: Math.max(0, Math.min(600, Math.round((Number(o.duracao) || 0) * 10) / 10)),
    origem: limpar(o.origem, 30) || "elevenlabs",
    ...(typeof o.som_id === "string" && uuid.test(o.som_id) ? { som_id: o.som_id } : {}),
    ...(typeof o.file_id === "string" && uuid.test(o.file_id) ? { file_id: o.file_id } : {}),
    ...(o.loop === true ? { loop: true } : {}),
    ...(limpar(o.escolhida_em, 40) ? { escolhida_em: limpar(o.escolhida_em, 40) } : {}),
  };
}

/** O briefing com a trilha escolhida (o resto do briefing fica intacto; null tira a trilha). */
export function briefingComTrilha(briefing: unknown, trilha: TrilhaDoBriefing | null): Record<string, unknown> {
  const base = briefing && typeof briefing === "object" ? { ...(briefing as Record<string, unknown>) } : {};
  if (trilha) base.trilha = trilha;
  else delete base.trilha;
  return base;
}
