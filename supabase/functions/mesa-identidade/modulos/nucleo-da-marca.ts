/**
 * Núcleo da marca (19/10/2026). Dono: "melhore a inteligência da área de
 * identidade". Um contexto só, montado do que o projeto JÁ decidiu
 * (estratégia, nome, conceito escolhido, paleta, fontes, tom, tagline, logo)
 * e das referências (o que o cliente gosta e evita, o moodboard e a leitura
 * pública do site e do Instagram). Ele vai junto em toda geração da mesa
 * (naming, slogans, conceito, paletas, fontes, logo e brandbook) e aparece no
 * alto de cada etapa.
 *
 * Nada aqui é inventado: o que não foi decidido fica fora (e entra em
 * `faltam`). Puro: sem Deno, sem banco; a tela, a função e os testes usam o
 * mesmo arquivo. Regex só na sintaxe antiga (Safari 11). Sem travessão.
 */

import { DIRECAO_DO_ARQUETIPO, fioDaMarca } from "./coerencia-da-marca.ts";
import { normalizarEstrategia } from "../../_shared/estrategia-de-marca.ts";
import { type LeituraWeb, resumoDaLeitura } from "./leitura-web.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown, max = 240) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const lista = (v: unknown, max = 6, tam = 120): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]+/) : [])
    .map((x) => (x && typeof x === "object" ? txt(obj(x).nome || obj(x).titulo || obj(x).texto || obj(x).link, tam) : txt(x, tam)))
    .filter(Boolean)
    .slice(0, max);

export type LogoDoNucleo = { caminho: string | null; origem: "enviada" | "gerada" | null; estilo: string };

export type NucleoDaMarca = {
  nome: string;
  tagline: string;
  arquetipo: string;
  posicionamento: string;
  publico: string;
  proposito: string;
  valores: string[];
  tom: string[];
  tracos: string[];
  conceito: { nome: string; ideia: string; palavras: string[] } | null;
  paleta: Array<{ hex: string; nome: string; papel: string }>;
  /** A paleta veio do caminho do conceito (ainda não decidida no Sistema). */
  paleta_do_caminho: boolean;
  fontes: Array<{ familia: string; uso: string }>;
  fontes_do_caminho: boolean;
  segmento: string;
  gosta: string[];
  evita: string[];
  referencias: string[];
  web: { site: string; instagram: string; bio: string } | null;
  logo: LogoDoNucleo;
  faltam: string[];
};

/** O núcleo do projeto. `nomeDeReserva` é o nome do cliente ou da marca (quando o naming ainda não decidiu). */
export function nucleoDaMarca(dados: Record<string, unknown>, nomeDeReserva = ""): NucleoDaMarca {
  const d = obj(dados);
  const f = fioDaMarca(d);
  const est = normalizarEstrategia(d.estrategia);
  const briefing = obj(d.briefing);
  const pesquisa = obj(d.pesquisa);
  const conceito = obj(d.conceito);
  const caminho = arr(conceito.caminhos).map(obj).filter((c) => c.id && c.id === conceito.escolhido)[0] || null;
  const sistema = obj(d.sistema);
  const nucleoSalvo = obj(d.nucleo);
  const web = obj(nucleoSalvo.web) as Partial<LeituraWeb>;

  const paletaDoCaminho = caminho
    ? arr(caminho.paleta).map(obj).map((c) => ({ hex: txt(c.hex, 9).toUpperCase(), nome: txt(c.nome, 40), papel: txt(c.papel, 20) || "secundaria" })).filter((c) => /^#[0-9A-F]{6}$/.test(c.hex))
    : [];
  const paleta = f.cores.length ? f.cores.map((c) => ({ hex: c.hex, nome: c.nome, papel: c.papel })) : paletaDoCaminho;
  const tipoDoCaminho = obj(caminho ? caminho.tipografia : null);
  const fontesDoCaminho = [txt(tipoDoCaminho.titulo, 60) ? { familia: txt(tipoDoCaminho.titulo, 60), uso: "titulo" } : null, txt(tipoDoCaminho.texto, 60) ? { familia: txt(tipoDoCaminho.texto, 60), uso: "texto" } : null].filter((x): x is { familia: string; uso: string } => !!x);
  const fontes = f.fontes.length ? f.fontes.map((t) => ({ familia: t.familia, uso: t.uso })) : fontesDoCaminho;

  const tom = f.tom.length ? f.tom : caminho ? lista(caminho.tom, 6, 40) : lista(briefing.personalidade, 6, 40);
  const moodboard = arr(pesquisa.moodboard).map(obj).map((m) => txt(m.nota || m.titulo, 120)).filter(Boolean).slice(0, 6);
  const site = resumoDaLeitura(web.site || null);
  const insta = resumoDaLeitura(web.instagram || null);
  const bio = txt(web.bio, 300);

  const logos = obj(sistema.logos);
  const principal = obj(logos.principal);
  const gerada = obj(obj(sistema.logo_gerada).escolhida);
  const visao = obj(obj(d.leitura_da_logo).visao);
  const caminhoPrincipal = txt(principal.caminho, 400);
  const caminhoGerado = txt(gerada.caminho, 400);
  const caminhoDaLogo = txt(principal.previa_png, 400) || caminhoPrincipal || caminhoGerado || null;
  const logo: LogoDoNucleo = {
    caminho: caminhoDaLogo,
    // A gerada escolhida entra como a principal do Sistema (mesmo caminho); outra principal é a enviada pela equipe.
    origem: !caminhoDaLogo ? null : caminhoPrincipal ? (caminhoGerado && caminhoGerado === caminhoPrincipal ? "gerada" : "enviada") : "gerada",
    estilo: [txt(visao.forma, 120), txt(visao.estilo, 120), txt(gerada.estilo, 120)].filter(Boolean).join(" ").slice(0, 240),
  };

  const n: NucleoDaMarca = {
    nome: f.nome || txt(nomeDeReserva, 80),
    tagline: f.tagline,
    arquetipo: f.arquetipo ? f.arquetipo.rotulo : "",
    posicionamento: f.posicionamento,
    publico: f.publico || txt(briefing.publico, 300),
    proposito: f.proposito || txt(briefing.proposito, 300),
    valores: est.valores.map((v) => v.nome).filter(Boolean).slice(0, 5),
    tom,
    tracos: f.tracos,
    conceito: caminho ? { nome: txt(caminho.nome, 80), ideia: txt(caminho.ideia, 400), palavras: lista(caminho.palavras, 6, 40) } : null,
    paleta,
    paleta_do_caminho: !f.cores.length && paletaDoCaminho.length > 0,
    fontes,
    fontes_do_caminho: !f.fontes.length && fontesDoCaminho.length > 0,
    segmento: txt(briefing.segmento || briefing.negocio, 200),
    gosta: lista(briefing.gosta, 6),
    evita: lista(briefing.evita, 6),
    referencias: moodboard,
    web: site || insta || bio ? { site, instagram: insta, bio } : null,
    logo,
    faltam: [],
  };
  if (!n.arquetipo && !n.posicionamento) n.faltam.push("estratégia");
  if (!f.nome) n.faltam.push("nome");
  if (!n.conceito) n.faltam.push("conceito");
  if (!f.cores.length) n.faltam.push("paleta");
  if (!f.fontes.length) n.faltam.push("fontes");
  if (!n.tom.length) n.faltam.push("tom");
  return n;
}

/**
 * O núcleo como vai para a IA (dentro de DADOS): só o que existe, curto.
 * Cabe em ~2.500 letras; o que passa disso é cortado no fim das listas.
 */
export function nucleoParaPrompt(n: NucleoDaMarca): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  const por = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return;
    if (Array.isArray(v) && !v.length) return;
    saida[k] = v;
  };
  por("nome", n.nome);
  por("tagline", n.tagline);
  por("arquetipo", n.arquetipo);
  por("posicionamento", n.posicionamento);
  por("publico", n.publico);
  por("proposito", n.proposito);
  por("valores", n.valores);
  por("tom", n.tom);
  por("tracos", n.tracos);
  if (n.conceito) por("conceito_escolhido", `${n.conceito.nome}: ${n.conceito.ideia}${n.conceito.palavras.length ? ` (${n.conceito.palavras.join(", ")})` : ""}`);
  por(n.paleta_do_caminho ? "paleta_do_conceito" : "paleta", n.paleta.map((c) => `${c.hex} ${c.papel}${c.nome ? ` ${c.nome}` : ""}`));
  por(n.fontes_do_caminho ? "fontes_do_conceito" : "fontes", n.fontes.map((t) => `${t.familia} (${t.uso})`));
  por("segmento", n.segmento);
  por("cliente_gosta", n.gosta);
  por("evitar", n.evita);
  por("moodboard", n.referencias);
  if (n.web) por("o_que_a_marca_diz_de_si", [n.web.site ? `site: ${n.web.site}` : "", n.web.instagram ? `instagram: ${n.web.instagram}` : "", n.web.bio ? `bio: ${n.web.bio}` : ""].filter(Boolean));
  if (n.logo.caminho) por("logo", n.logo.estilo ? `já existe (${n.logo.estilo})` : "já existe");
  por("ainda_nao_decidido", n.faltam);
  return saida;
}

/** O pedido de DADOS das ações com o núcleo junto (uma regra só para todas as gerações). */
export function comNucleo<T extends Record<string, unknown>>(dados: T, nucleo: Record<string, unknown> | null | undefined): T & { nucleo_da_marca?: Record<string, unknown> } {
  return nucleo && Object.keys(nucleo).length ? { ...dados, nucleo_da_marca: nucleo } : dados;
}

/** Regra que entra no sistema de cada geração. */
export const REGRA_DO_NUCLEO = "nucleo_da_marca é o que a marca já decidiu (e o que ela diz de si no site e no Instagram): siga o que está decidido, nunca contradiga, e use o resto só como referência.";

// ------------------------------------------------------------------ logo (Laboratório)

export const ESTILOS_DE_LOGO = [
  { valor: "minimalista", rotulo: "Minimalista", explica: "símbolo simples, poucas formas, muito respiro" },
  { valor: "geometrico", rotulo: "Geométrico", explica: "formas geométricas precisas, construção em grade" },
  { valor: "organico", rotulo: "Orgânico", explica: "curvas naturais, traço humano e acolhedor" },
  { valor: "tipografico", rotulo: "Tipográfico", explica: "o nome desenhado como logotipo, com um detalhe próprio na letra" },
  { valor: "emblema", rotulo: "Emblema", explica: "símbolo e nome dentro de um selo ou brasão" },
] as const;
export type EstiloDeLogo = (typeof ESTILOS_DE_LOGO)[number]["valor"];

export const LIMITES_DA_LOGO = { minimo: 2, maximo: 8, padrao: 4 } as const;

export type PedidoDaLogo = {
  client_id: string;
  nome: string;
  conceito: string;
  paleta: string[];
  estilo: string;
  n: number;
  /** Extras do núcleo (o Laboratório usa o que conhece; o resto vai no conceito). */
  fontes: string[];
  nucleo: Record<string, unknown>;
  referencias?: string[];
};

/**
 * O pedido do `laboratorio` › `logo_gerar` a partir do núcleo: símbolo +
 * logotipo, fundo liso, com o nome, o conceito, a paleta e o estilo que a
 * marca já decidiu. `aPartirDe` (url de uma variação) pede variações dela.
 */
export function pedidoDaLogo(n: NucleoDaMarca, e: { clientId: string; estilo?: EstiloDeLogo | ""; quantas?: number; pedido?: string; aPartirDe?: string | null; arquetipoId?: string | null }): PedidoDaLogo {
  const estilo = ESTILOS_DE_LOGO.filter((x) => x.valor === e.estilo)[0] || null;
  const dir = e.arquetipoId && Object.prototype.hasOwnProperty.call(DIRECAO_DO_ARQUETIPO, e.arquetipoId) ? DIRECAO_DO_ARQUETIPO[e.arquetipoId as keyof typeof DIRECAO_DO_ARQUETIPO] : null;
  const partes: string[] = [];
  if (n.conceito) partes.push(`Conceito: ${n.conceito.nome}. ${n.conceito.ideia}`);
  if (n.posicionamento) partes.push(`Posicionamento: ${n.posicionamento}`);
  if (n.arquetipo) partes.push(`Arquétipo: ${n.arquetipo}${n.tracos.length ? ` (${n.tracos.join(", ")})` : ""}`);
  if (n.tom.length) partes.push(`Tom: ${n.tom.join(", ")}`);
  if (n.segmento) partes.push(`Segmento: ${n.segmento}`);
  if (n.tagline) partes.push(`Tagline (não entra na logo): ${n.tagline}`);
  if (n.evita.length) partes.push(`Evitar: ${n.evita.join(", ")}`);
  if (e.pedido) partes.push(`Pedido da equipe: ${e.pedido}`);
  if (e.aPartirDe) partes.push("Variações próximas da logo de referência anexada: mesmo caminho, outras soluções de símbolo e de letra.");
  const titulo = n.fontes.filter((t) => t.uso === "titulo")[0] || n.fontes[0];
  const estiloTexto = [
    "símbolo + logotipo, fundo liso, sem mockup, sem sombra, vetor limpo",
    estilo ? `${estilo.rotulo.toLowerCase()}: ${estilo.explica}` : "",
    titulo ? `letra do logotipo na linha de ${titulo.familia}` : dir ? `letra: ${dir.letra.ideia}` : "",
    n.logo.estilo && n.logo.origem === "enviada" ? `conversa com a logo atual (${n.logo.estilo})` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const quantas = Math.max(LIMITES_DA_LOGO.minimo, Math.min(LIMITES_DA_LOGO.maximo, Math.round(Number(e.quantas) || LIMITES_DA_LOGO.padrao)));
  const pedido: PedidoDaLogo = {
    client_id: e.clientId,
    nome: n.nome,
    conceito: partes.join("\n").slice(0, 2000),
    paleta: n.paleta.map((c) => c.hex).slice(0, 6),
    estilo: estiloTexto.slice(0, 600),
    n: quantas,
    fontes: n.fontes.map((t) => `${t.familia} (${t.uso})`),
    nucleo: nucleoParaPrompt(n),
  };
  if (e.aPartirDe) pedido.referencias = [e.aPartirDe];
  return pedido;
}

// ------------------------------------------------------------------ resposta do Laboratório

export type VariacaoDeLogo = { id: string; url: string; path: string | null };
export type RodadaDeLogo = { id: string; em: string; estilo: string; quantas: number; a_partir_de: string | null; imagens: VariacaoDeLogo[]; jev: { id: string | null; motivo: string | null }; custo_usd: number };

const numero = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() && isFinite(Number(v)) ? Number(v) : null);

/**
 * A resposta do `logo_gerar` em forma segura. Aceita `imagens` (ou `logos`,
 * ou `saida.imagens`) como lista de { url, path } ou de url, e a escolha do
 * Jev em `escolha`/`escolhida`/`jev` com indice, id ou path e o motivo.
 */
export function normalizarRespostaDaLogo(bruto: unknown, agora = new Date().toISOString(), pedido?: { estilo?: string; quantas?: number; aPartirDe?: string | null }): RodadaDeLogo {
  const r = obj(bruto);
  const saida = obj(r.saida);
  const brutas = arr(r.imagens).length ? arr(r.imagens) : arr(r.logos).length ? arr(r.logos) : arr(saida.imagens);
  const imagens: VariacaoDeLogo[] = [];
  brutas.forEach((b, i) => {
    const o = typeof b === "string" ? { url: b } : obj(b);
    const url = txt(o.url || o.signed_url || o.link, 2000);
    if (!/^https:\/\//i.test(url) && !/^data:image\//i.test(url)) return;
    imagens.push({ id: txt(o.id, 60) || `v${i + 1}`, url, path: txt(o.path || o.caminho, 400) || null });
  });
  const e = obj(r.escolha || r.escolhida || r.jev || saida.escolha);
  const motivo = txt(e.motivo || e.porque || e.razao || r.motivo || saida.motivo, 300) || null;
  let escolhida: VariacaoDeLogo | null = null;
  const indice = numero(e.indice !== undefined ? e.indice : e.index !== undefined ? e.index : r.escolhida_indice);
  if (indice !== null && imagens[indice]) escolhida = imagens[indice];
  if (!escolhida && (e.id || e.path || e.url)) escolhida = imagens.filter((x) => (e.id && x.id === e.id) || (e.path && x.path === e.path) || (e.url && x.url === e.url))[0] || null;
  return {
    id: txt(r.rodada_id || r.id, 60) || `lg${Date.parse(agora) || Date.now()}`,
    em: agora,
    estilo: txt(pedido && pedido.estilo, 40),
    quantas: (pedido && pedido.quantas) || imagens.length,
    a_partir_de: (pedido && pedido.aPartirDe) || null,
    imagens,
    jev: { id: escolhida ? escolhida.id : null, motivo: escolhida ? motivo : null },
    custo_usd: numero(r.custo_usd) || 0,
  };
}
