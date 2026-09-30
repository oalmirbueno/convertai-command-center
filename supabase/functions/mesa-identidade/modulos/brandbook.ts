/**
 * Brandbook como dado (frente IDV, 30/09/2026). Pedido do dono: "arquivos
 * para exportar completo o modelo do brandbook padrão, bonito e completo, e
 * todo o conceito da marca"; "selecionar o modelo que eu quiser".
 *
 * Dois modelos (plano p1, seção 5):
 * - prancha: a prancha-resumo vertical (a estrutura do modelo recebido:
 *   logos, paleta, ativos, tipografia, mockups e assinatura), boa para o
 *   WhatsApp e para a tela;
 * - paginado: o brandbook de 24 páginas em A4 deitado (conceito, logo, grid,
 *   área de proteção, redução mínima, usos incorretos, cores com HEX, RGB e
 *   CMYK calculados por código, tipografia, grafismos, aplicações e mockups,
 *   tom de voz, lista de arquivos).
 *
 * Os dados ficam num JSON versionado (idv_brandbooks, uma linha por versão).
 * RGB e CMYK nunca são guardados: saem do HEX na hora (cores-da-marca.ts).
 * A logo é sempre o arquivo real enviado pela equipe (regra "logo pelo
 * código"): o brandbook guarda o caminho, nunca uma imagem gerada.
 *
 * Puro: sem Deno, sem banco. Tela, função, PDF e testes usam o mesmo arquivo.
 */

import { type FichaDaCor, fichaDaCor, normalizarHex, type PapelDaCor } from "../../_shared/cores-da-marca.ts";
import { estrategiaParaBrandbook } from "../../_shared/estrategia-de-marca.ts";

/** 2 (IDV2, 30/09): tema visual, posicionamento, promessa, justificativa do arquétipo e o SVG do grafismo. */
export const VERSAO_DO_ESQUEMA = 2;

export type ModeloDoBrandbook = "prancha" | "paginado";

/**
 * Modelos visuais (IDV2): a mesma estrutura (prancha ou 24 páginas) com
 * outra cara. Guardado no JSON (dados.tema), sem mexer no banco.
 */
export const TEMAS_DO_BRANDBOOK = [
  { valor: "classico", rotulo: "Clássico", descricao: "Capa escura, acento da marca e páginas claras. O padrão." },
  { valor: "editorial", rotulo: "Editorial", descricao: "Muito branco, serifa nos títulos e acento discreto, como revista." },
  { valor: "escuro", rotulo: "Escuro", descricao: "Tudo em fundo escuro, cores da marca acesas. Bom para tecnologia e noite." },
  { valor: "minimal", rotulo: "Minimal", descricao: "Preto e branco com a cor da marca só nas amostras. Sóbrio." },
  { valor: "vibrante", rotulo: "Vibrante", descricao: "Blocos da cor primária nas aberturas. Para marcas jovens e ousadas." },
] as const;

export type TemaDoBrandbook = (typeof TEMAS_DO_BRANDBOOK)[number]["valor"];

export function ehTema(v: unknown): v is TemaDoBrandbook {
  return typeof v === "string" && TEMAS_DO_BRANDBOOK.some((t) => t.valor === v);
}

export type LogoDoBrandbook = {
  /** Caminho no bucket mesa (arquivo original, SVG ou PNG). */
  caminho: string;
  mime: string;
  rotulo: string;
  /**
   * Prévia PNG com transparência (até 800 px), feita no navegador ao enviar:
   * o PDF, a página e o kit usam a prévia; o SVG original vai no pacote.
   */
  previa_png?: string | null;
  largura?: number | null;
  altura?: number | null;
};

export type SlotDeLogo = "principal" | "secundario" | "alternativas" | "icone";

export const SLOTS_DE_LOGO: Array<{ valor: SlotDeLogo; rotulo: string; varios: boolean; uso: string }> = [
  { valor: "principal", rotulo: "Logotipo principal", varios: false, uso: "Uso primário, para o reconhecimento da marca e as comunicações oficiais." },
  { valor: "secundario", rotulo: "Logotipo secundário", varios: false, uso: "Versão vertical ou compacta, para espaços estreitos ou quadrados." },
  { valor: "alternativas", rotulo: "Versões alternativas", varios: true, uso: "Monocromática, negativa e sobre cor, para quando as cores não podem ser reproduzidas." },
  { valor: "icone", rotulo: "Ícone", varios: true, uso: "Versão reduzida para avatar, favicon e aplicativo." },
];

export type TipografiaDoBrandbook = { familia: string; pesos: string[]; uso: "titulo" | "texto" | "apoio"; licenca: string; alternativa: string };
export type GrafismoDoBrandbook = { tipo: "pattern" | "ilustracao" | "fotografia" | "composicao" | "icones" | "outro"; descricao: string; imagem: string | null; svg?: string | null };
export type MockupDoBrandbook = { titulo: string; imagem: string | null };
export type AplicacaoDoBrandbook = { tipo: string; descricao: string; imagem: string | null };

export type DadosDoBrandbook = {
  versao_do_esquema: number;
  tema: TemaDoBrandbook;
  marca: { nome: string; slogan: string; assinatura: string };
  conceito: { resumo: string; significado_do_logo: string; palavras: string[] };
  plataforma: { proposito: string; missao: string; visao: string; valores: string[]; personalidade: string[]; arquetipo: string; arquetipo_justificativa: string; publico: string; posicionamento: string; promessa: string };
  tom: { como_fala: string[]; como_nao_fala: string[]; exemplos: Array<{ certo: string; errado: string }> };
  logos: { principal: LogoDoBrandbook | null; secundario: LogoDoBrandbook | null; alternativas: LogoDoBrandbook[]; icone: LogoDoBrandbook[] };
  regras: { protecao_fator: number; reducao_minima_px: number; reducao_minima_mm: number; usos_incorretos: string[] };
  cores: Array<{ nome: string; papel: PapelDaCor; hex: string }>;
  perfil_cmyk: "revestido" | "nao_revestido";
  tipografia: TipografiaDoBrandbook[];
  grafismos: GrafismoDoBrandbook[];
  fotografia: { coloracao: string; composicao: string; evitar: string; ia: string };
  aplicacoes: AplicacaoDoBrandbook[];
  mockups: MockupDoBrandbook[];
  arquivos: Array<{ nome: string; formato: string; onde: string }>;
  creditos: { feito_por: string; contato: string };
};

export const USOS_INCORRETOS_PADRAO = [
  "Distorcer ou esticar a logo",
  "Trocar as cores fora da paleta",
  "Aplicar sombra, brilho ou contorno",
  "Girar ou inclinar a logo",
  "Usar sobre fundo sem contraste",
  "Mudar a fonte do logotipo",
  "Reorganizar símbolo e nome",
  "Usar a logo menor que a redução mínima",
];

// ------------------------------------------------------------------ normalizar

const str = (v: unknown, max = 600) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const txt = (v: unknown, max = 3000) => String(v == null ? "" : v).trim().slice(0, max);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown, max = 12, tam = 160) => arr(v).map((x) => str(x, tam)).filter(Boolean).slice(0, max);
const num = (v: unknown, padrao: number, min: number, max: number) => {
  const n = Number(v);
  return isFinite(n) && n >= min && n <= max ? n : padrao;
};

/** Caminho do bucket mesa que pode entrar no brandbook: do cliente, sem "..", na pasta da marca. */
export function caminhoSeguro(v: unknown, clientId?: string | null): string | null {
  const s = String(v == null ? "" : v).trim();
  if (!s || s.length > 400 || s.indexOf("..") >= 0 || s.charAt(0) === "/") return null;
  if (!/^[0-9a-f-]{36}\/marca\//i.test(s)) return null;
  if (clientId && s.indexOf(`${clientId}/`) !== 0) return null;
  return s;
}

function logo(v: unknown, clientId?: string | null): LogoDoBrandbook | null {
  const o = obj(v);
  const caminho = caminhoSeguro(o.caminho, clientId);
  if (!caminho) return null;
  const mime = str(o.mime, 60) || (/\.svg$/i.test(caminho) ? "image/svg+xml" : "image/png");
  return {
    caminho,
    mime,
    rotulo: str(o.rotulo, 60),
    previa_png: caminhoSeguro(o.previa_png, clientId),
    largura: typeof o.largura === "number" && isFinite(o.largura) ? Math.round(o.largura) : null,
    altura: typeof o.altura === "number" && isFinite(o.altura) ? Math.round(o.altura) : null,
  };
}

const PAPEIS: PapelDaCor[] = ["primaria", "secundaria", "destaque", "neutra"];
const USOS_TIPO = ["titulo", "texto", "apoio"];
const TIPOS_GRAFISMO = ["pattern", "ilustracao", "fotografia", "composicao", "icones", "outro"];

/** Qualquer JSON vira um brandbook seguro (o que não serve some, nunca quebra). */
export function normalizarBrandbook(bruto: unknown, clientId?: string | null): DadosDoBrandbook {
  const o = obj(bruto);
  const marca = obj(o.marca);
  const conceito = obj(o.conceito);
  const plataforma = obj(o.plataforma);
  const tom = obj(o.tom);
  const logos = obj(o.logos);
  const regras = obj(o.regras);
  const foto = obj(o.fotografia);
  const creditos = obj(o.creditos);
  const vistos = new Set<string>();
  const cores = arr(o.cores)
    .map((c) => {
      const x = obj(c);
      const hex = normalizarHex(x.hex);
      if (!hex || vistos.has(hex)) return null;
      vistos.add(hex);
      return { nome: str(x.nome, 40) || hex, papel: (PAPEIS.indexOf(x.papel as PapelDaCor) >= 0 ? x.papel : "secundaria") as PapelDaCor, hex };
    })
    .filter((c): c is { nome: string; papel: PapelDaCor; hex: string } => !!c)
    .slice(0, 8);
  return {
    versao_do_esquema: VERSAO_DO_ESQUEMA,
    tema: ehTema(o.tema) ? o.tema : "classico",
    marca: { nome: str(marca.nome, 80), slogan: str(marca.slogan, 160), assinatura: str(marca.assinatura, 160) },
    conceito: { resumo: txt(conceito.resumo, 1500), significado_do_logo: txt(conceito.significado_do_logo, 1500), palavras: strs(conceito.palavras, 8, 40) },
    plataforma: {
      proposito: txt(plataforma.proposito, 600),
      missao: txt(plataforma.missao, 600),
      visao: txt(plataforma.visao, 600),
      valores: strs(plataforma.valores, 8, 80),
      personalidade: strs(plataforma.personalidade, 8, 40),
      arquetipo: str(plataforma.arquetipo, 60),
      arquetipo_justificativa: txt(plataforma.arquetipo_justificativa, 900),
      publico: txt(plataforma.publico, 800),
      posicionamento: txt(plataforma.posicionamento, 600),
      promessa: txt(plataforma.promessa, 400),
    },
    tom: {
      como_fala: strs(tom.como_fala, 8),
      como_nao_fala: strs(tom.como_nao_fala, 8),
      exemplos: arr(tom.exemplos)
        .map((e) => ({ certo: str(obj(e).certo, 200), errado: str(obj(e).errado, 200) }))
        .filter((e) => e.certo || e.errado)
        .slice(0, 4),
    },
    logos: {
      principal: logo(logos.principal, clientId),
      secundario: logo(logos.secundario, clientId),
      alternativas: arr(logos.alternativas).map((l) => logo(l, clientId)).filter((l): l is LogoDoBrandbook => !!l).slice(0, 4),
      icone: arr(logos.icone).map((l) => logo(l, clientId)).filter((l): l is LogoDoBrandbook => !!l).slice(0, 3),
    },
    regras: {
      protecao_fator: num(regras.protecao_fator, 0.25, 0.05, 1),
      reducao_minima_px: Math.round(num(regras.reducao_minima_px, 120, 16, 2000)),
      reducao_minima_mm: Math.round(num(regras.reducao_minima_mm, 25, 5, 500)),
      usos_incorretos: strs(regras.usos_incorretos, 8, 80).length ? strs(regras.usos_incorretos, 8, 80) : USOS_INCORRETOS_PADRAO.slice(),
    },
    cores,
    perfil_cmyk: o.perfil_cmyk === "nao_revestido" ? "nao_revestido" : "revestido",
    tipografia: arr(o.tipografia)
      .map((t) => {
        const x = obj(t);
        const familia = str(x.familia, 60);
        if (!familia) return null;
        return {
          familia,
          pesos: strs(x.pesos, 6, 20),
          uso: (USOS_TIPO.indexOf(String(x.uso)) >= 0 ? x.uso : "texto") as TipografiaDoBrandbook["uso"],
          licenca: str(x.licenca, 120),
          alternativa: str(x.alternativa, 60),
        };
      })
      .filter((t): t is TipografiaDoBrandbook => !!t)
      .slice(0, 4),
    grafismos: arr(o.grafismos)
      .map((g) => {
        const x = obj(g);
        const descricao = str(x.descricao, 300);
        const imagem = caminhoSeguro(x.imagem, clientId);
        if (!descricao && !imagem) return null;
        const svg = caminhoSeguro(x.svg, clientId);
        const saida: GrafismoDoBrandbook = { tipo: (TIPOS_GRAFISMO.indexOf(String(x.tipo)) >= 0 ? x.tipo : "outro") as GrafismoDoBrandbook["tipo"], descricao, imagem };
        if (svg && /\.svg$/i.test(svg)) saida.svg = svg;
        return saida;
      })
      .filter((g): g is GrafismoDoBrandbook => !!g)
      .slice(0, 6),
    fotografia: { coloracao: txt(foto.coloracao, 600), composicao: txt(foto.composicao, 600), evitar: txt(foto.evitar, 600), ia: txt(foto.ia, 600) },
    aplicacoes: arr(o.aplicacoes)
      .map((a) => {
        const x = obj(a);
        const tipo = str(x.tipo, 60);
        if (!tipo) return null;
        return { tipo, descricao: str(x.descricao, 300), imagem: caminhoSeguro(x.imagem, clientId) };
      })
      .filter((a): a is AplicacaoDoBrandbook => !!a)
      .slice(0, 8),
    mockups: arr(o.mockups)
      .map((m) => {
        const x = obj(m);
        const imagem = caminhoSeguro(x.imagem, clientId);
        const titulo = str(x.titulo, 80);
        if (!imagem && !titulo) return null;
        return { titulo, imagem };
      })
      .filter((m): m is MockupDoBrandbook => !!m)
      .slice(0, 6),
    arquivos: arr(o.arquivos)
      .map((a) => ({ nome: str(obj(a).nome, 120), formato: str(obj(a).formato, 20), onde: str(obj(a).onde, 160) }))
      .filter((a) => a.nome)
      .slice(0, 30),
    creditos: { feito_por: str(creditos.feito_por, 80) || "Aceleriq", contato: str(creditos.contato, 160) },
  };
}

/** As fichas de cor do brandbook, com RGB e CMYK calculados agora. */
export function coresDoBrandbook(d: Pick<DadosDoBrandbook, "cores" | "perfil_cmyk">): FichaDaCor[] {
  return d.cores.map((c) => fichaDaCor(c, d.perfil_cmyk)).filter((c): c is FichaDaCor => !!c);
}

/** Todas as logos, na ordem do manual. */
export function logosDoBrandbook(d: Pick<DadosDoBrandbook, "logos">): Array<{ slot: SlotDeLogo; logo: LogoDoBrandbook }> {
  const saida: Array<{ slot: SlotDeLogo; logo: LogoDoBrandbook }> = [];
  if (d.logos.principal) saida.push({ slot: "principal", logo: d.logos.principal });
  if (d.logos.secundario) saida.push({ slot: "secundario", logo: d.logos.secundario });
  d.logos.alternativas.forEach((l) => saida.push({ slot: "alternativas", logo: l }));
  d.logos.icone.forEach((l) => saida.push({ slot: "icone", logo: l }));
  return saida;
}

/** A lista de arquivos entregues, montada do que existe (a equipe pode acrescentar). */
export function arquivosEntregues(d: DadosDoBrandbook): Array<{ nome: string; formato: string; onde: string }> {
  const lista: Array<{ nome: string; formato: string; onde: string }> = [];
  for (const { slot, logo: l } of logosDoBrandbook(d)) {
    const nome = SLOTS_DE_LOGO.filter((s) => s.valor === slot)[0].rotulo;
    lista.push({ nome: l.rotulo ? `${nome}: ${l.rotulo}` : nome, formato: /svg/i.test(l.mime) ? "SVG" : "PNG", onde: "Pacote da marca, pasta logos" });
  }
  if (d.cores.length) lista.push({ nome: "Paleta de cores (HEX, RGB e CMYK)", formato: "JSON, CSS e TXT", onde: "Pacote da marca, pasta cores" });
  for (const t of d.tipografia) lista.push({ nome: `Fonte ${t.familia}`, formato: "Referência", onde: t.licenca || "Licença a confirmar" });
  lista.push({ nome: "Brandbook", formato: "PDF", onde: "Arquivos do cliente e pacote da marca" });
  const extras = d.arquivos.filter((a) => !lista.some((x) => x.nome === a.nome));
  return lista.concat(extras).slice(0, 30);
}

// ------------------------------------------------------------------ modelos

export type PaginaDoModelo = {
  n: number;
  id: string;
  titulo: string;
  /** O que a página precisa ter; lista vazia = pronta. */
  falta: (d: DadosDoBrandbook) => string[];
};

const precisa = (cond: boolean, texto: string) => (cond ? [] : [texto]);

export const PAGINAS_DO_BRANDBOOK: PaginaDoModelo[] = [
  { n: 1, id: "capa", titulo: "Capa", falta: (d) => precisa(!!d.marca.nome, "nome da marca").concat(precisa(!!d.logos.principal, "logo principal")) },
  { n: 2, id: "sumario", titulo: "Sumário", falta: () => [] },
  { n: 3, id: "apresentacao", titulo: "Apresentação", falta: (d) => precisa(!!(d.plataforma.proposito || d.conceito.resumo), "propósito ou resumo do conceito") },
  { n: 4, id: "plataforma", titulo: "Plataforma da marca", falta: (d) => precisa(!!(d.plataforma.missao || d.plataforma.valores.length), "missão ou valores").concat(precisa(d.plataforma.personalidade.length > 0, "personalidade")) },
  { n: 5, id: "tom", titulo: "Tom de voz", falta: (d) => precisa(d.tom.como_fala.length > 0, "como a marca fala") },
  { n: 6, id: "conceito", titulo: "Conceito do logo", falta: (d) => precisa(!!d.conceito.significado_do_logo, "significado do logo") },
  { n: 7, id: "logo_principal", titulo: "Logotipo principal", falta: (d) => precisa(!!d.logos.principal, "logo principal") },
  { n: 8, id: "grid", titulo: "Construção e grid", falta: (d) => precisa(!!d.logos.principal, "logo principal") },
  { n: 9, id: "protecao", titulo: "Área de proteção e redução mínima", falta: (d) => precisa(!!d.logos.principal, "logo principal") },
  { n: 10, id: "versoes", titulo: "Versões", falta: (d) => precisa(!!(d.logos.secundario || d.logos.alternativas.length), "logo secundário ou versões") },
  { n: 11, id: "cromaticas", titulo: "Versões cromáticas", falta: (d) => precisa(!!d.logos.principal, "logo principal").concat(precisa(d.cores.length > 0, "cores")) },
  { n: 12, id: "incorretos", titulo: "Usos incorretos", falta: (d) => precisa(!!d.logos.principal, "logo principal") },
  { n: 13, id: "icone", titulo: "Ícone, favicon e avatar", falta: (d) => precisa(d.logos.icone.length > 0 || !!d.logos.principal, "ícone") },
  { n: 14, id: "cores", titulo: "Paleta de cores", falta: (d) => precisa(d.cores.length >= 2, "ao menos 2 cores") },
  { n: 15, id: "proporcao", titulo: "Proporção e combinações", falta: (d) => precisa(d.cores.length >= 2, "ao menos 2 cores") },
  { n: 16, id: "tipografia", titulo: "Tipografia", falta: (d) => precisa(d.tipografia.length > 0, "família tipográfica") },
  { n: 17, id: "grafismos", titulo: "Elementos gráficos", falta: (d) => precisa(d.grafismos.length > 0, "grafismos ou pattern") },
  { n: 18, id: "fotografia", titulo: "Fotografia e imagem", falta: (d) => precisa(!!(d.fotografia.coloracao || d.fotografia.composicao), "regras de foto") },
  { n: 19, id: "ilustracao", titulo: "Ilustração e ícones", falta: () => [] },
  { n: 20, id: "redes", titulo: "Aplicações em redes sociais", falta: (d) => precisa(d.aplicacoes.length > 0 || d.mockups.length > 0, "aplicação ou mockup") },
  { n: 21, id: "papelaria", titulo: "Papelaria", falta: () => [] },
  { n: 22, id: "mockups", titulo: "Mockups de aplicação", falta: (d) => precisa(d.mockups.length > 0, "mockups (etapa Mockups)") },
  { n: 23, id: "arquivos", titulo: "Arquivos entregues", falta: () => [] },
  { n: 24, id: "creditos", titulo: "Contato e créditos", falta: () => [] },
];

export const SECOES_DA_PRANCHA: PaginaDoModelo[] = [
  { n: 1, id: "titulo", titulo: "Manual da marca", falta: (d) => precisa(!!d.marca.nome, "nome da marca") },
  { n: 2, id: "logos", titulo: "Logotipos e ícone", falta: (d) => precisa(!!d.logos.principal, "logo principal") },
  { n: 3, id: "cores", titulo: "Paleta de cores", falta: (d) => precisa(d.cores.length >= 2, "ao menos 2 cores") },
  { n: 4, id: "ativos", titulo: "Ativos da marca", falta: (d) => precisa(d.grafismos.length > 0, "grafismos ou pattern") },
  { n: 5, id: "tipografia", titulo: "Tipografia", falta: (d) => precisa(d.tipografia.length > 0, "família tipográfica") },
  { n: 6, id: "mockups", titulo: "Mockups", falta: (d) => precisa(d.mockups.length > 0, "mockups (etapa Mockups)") },
  { n: 7, id: "assinatura", titulo: "Assinatura", falta: () => [] },
];

export const MODELOS_DE_BRANDBOOK: Array<{ valor: ModeloDoBrandbook; rotulo: string; descricao: string; secoes: PaginaDoModelo[] }> = [
  { valor: "prancha", rotulo: "Prancha-resumo vertical", descricao: "Uma prancha longa com logos, cores, ativos, tipografia e mockups. Boa para o grupo e para a tela.", secoes: SECOES_DA_PRANCHA },
  { valor: "paginado", rotulo: "Brandbook de 24 páginas", descricao: "Manual completo em A4 deitado, do conceito aos arquivos entregues.", secoes: PAGINAS_DO_BRANDBOOK },
];

export function ehModelo(v: unknown): v is ModeloDoBrandbook {
  return v === "prancha" || v === "paginado";
}

export function secoesDoModelo(modelo: ModeloDoBrandbook): PaginaDoModelo[] {
  return modelo === "prancha" ? SECOES_DA_PRANCHA : PAGINAS_DO_BRANDBOOK;
}

/** Estado de cada página (ou seção) do modelo com estes dados. */
export function estadoDoModelo(modelo: ModeloDoBrandbook, d: DadosDoBrandbook): Array<{ n: number; id: string; titulo: string; pronta: boolean; falta: string[] }> {
  return secoesDoModelo(modelo).map((p) => {
    const falta = p.falta(d);
    return { n: p.n, id: p.id, titulo: p.titulo, pronta: falta.length === 0, falta };
  });
}

/** Tudo o que falta no modelo, sem repetir (a tela mostra antes de exportar). */
export function lacunasDoBrandbook(modelo: ModeloDoBrandbook, d: DadosDoBrandbook): string[] {
  const vistos: string[] = [];
  for (const p of estadoDoModelo(modelo, d)) for (const f of p.falta) if (vistos.indexOf(f) < 0) vistos.push(f);
  return vistos;
}

// ------------------------------------------------------------------ do projeto ao brandbook

/**
 * O primeiro rascunho do brandbook sai do que o projeto já tem (briefing,
 * conceito escolhido, sistema, naming, mockups) e do kit da marca. Nada é
 * inventado: campo sem dado fica vazio e aparece como lacuna.
 */
export function brandbookDoProjeto(e: {
  nomeDaMarca: string;
  dados: Record<string, unknown>;
  clientId?: string | null;
  kit?: { paleta?: unknown; tom?: unknown } | null;
  mockups?: Array<{ titulo: string; imagem: string }>;
}): DadosDoBrandbook {
  const d = obj(e.dados);
  const briefing = obj(d.briefing);
  const conceito = obj(d.conceito);
  const caminhos = arr(conceito.caminhos).map(obj);
  const escolhido = caminhos.filter((c) => c.id === conceito.escolhido)[0] || null;
  const sistema = obj(d.sistema);
  const naming = obj(d.naming);
  const coresDoSistema = arr(sistema.cores);
  const coresDoKit = arr(obj(e.kit).paleta).map((c) => ({ nome: obj(c).nome, papel: obj(c).papel === "primaria" || obj(c).papel === "secundaria" || obj(c).papel === "destaque" ? obj(c).papel : "secundaria", hex: obj(c).hex }));
  const personalidade = Array.isArray(briefing.personalidade) ? briefing.personalidade : str(briefing.personalidade, 300).split(/[,;]+/);
  const nomeDaMarca = str(naming.nome, 80) || e.nomeDaMarca;
  // A estratégia (etapa nova da IDV2) vale mais que o briefing: é a versão trabalhada pela equipe.
  const est = estrategiaParaBrandbook(d.estrategia, nomeDaMarca);
  const aplicacoes = arr(obj(d.aplicacoes).itens);
  const primeiro = (a: unknown, b: unknown) => (Array.isArray(a) ? (a.length ? a : b) : str(a, 2000) ? a : b);
  const bruto = {
    tema: obj(d.guideline).tema,
    marca: { nome: nomeDaMarca, slogan: str(naming.slogan, 160) || str(briefing.slogan, 160), assinatura: "" },
    conceito: {
      resumo: escolhido ? txt(escolhido.ideia, 1500) : "",
      significado_do_logo: txt(sistema.significado_do_logo, 1500),
      palavras: escolhido ? arr(escolhido.palavras) : [],
    },
    plataforma: {
      proposito: primeiro(est && est.proposito, txt(briefing.proposito, 600)),
      missao: primeiro(est && est.missao, txt(briefing.missao, 600)),
      visao: primeiro(est && est.visao, txt(briefing.visao, 600)),
      valores: primeiro(est && est.valores, arr(briefing.valores)),
      personalidade: primeiro(est && est.personalidade, personalidade),
      arquetipo: primeiro(est && est.arquetipo, escolhido ? str(escolhido.arquetipo, 60) : ""),
      arquetipo_justificativa: est ? est.arquetipo_justificativa : "",
      publico: primeiro(est && est.publico, txt(briefing.publico, 800)),
      posicionamento: est ? est.posicionamento : "",
      promessa: est ? est.promessa : "",
    },
    tom: {
      como_fala: primeiro(est && est.como_fala, escolhido ? arr(escolhido.tom) : []),
      como_nao_fala: primeiro(est && est.como_nao_fala, arr(briefing.evita)),
      exemplos: est ? est.exemplos : [],
    },
    logos: obj(sistema.logos),
    regras: obj(sistema.regras),
    cores: coresDoSistema.length ? coresDoSistema : coresDoKit,
    perfil_cmyk: "revestido",
    tipografia: arr(sistema.tipografia),
    grafismos: arr(sistema.grafismos),
    fotografia: obj(sistema.fotografia),
    aplicacoes,
    mockups: e.mockups || [],
    arquivos: [],
    creditos: { feito_por: "Aceleriq", contato: "" },
  };
  return normalizarBrandbook(bruto, e.clientId);
}

// ------------------------------------------------------------------ página pública

/**
 * O que vai para a página pública do brandbook (link): só o manual, sem
 * caminho de arquivo, sem cliente, sem custo. As imagens entram como data URL
 * (a página abre sem login); quem monta passa o mapa caminho -> data URL.
 */
export function brandbookPublico(d: DadosDoBrandbook, imagens: Record<string, string>): Record<string, unknown> {
  const img = (c: string | null | undefined) => (c && imagens[c] ? imagens[c] : null);
  const semCaminho = (l: LogoDoBrandbook | null) =>
    l ? { rotulo: l.rotulo, imagem: img(l.previa_png) || img(l.caminho) } : null;
  return {
    versao_do_esquema: d.versao_do_esquema,
    tema: d.tema,
    marca: d.marca,
    conceito: d.conceito,
    plataforma: d.plataforma,
    tom: d.tom,
    logos: {
      principal: semCaminho(d.logos.principal),
      secundario: semCaminho(d.logos.secundario),
      alternativas: d.logos.alternativas.map(semCaminho),
      icone: d.logos.icone.map(semCaminho),
    },
    regras: d.regras,
    cores: coresDoBrandbook(d),
    perfil_cmyk: d.perfil_cmyk,
    tipografia: d.tipografia,
    grafismos: d.grafismos.map((g) => ({ tipo: g.tipo, descricao: g.descricao, imagem: img(g.imagem) })),
    fotografia: d.fotografia,
    aplicacoes: d.aplicacoes.map((a) => ({ tipo: a.tipo, descricao: a.descricao, imagem: img(a.imagem) })),
    mockups: d.mockups.map((m) => ({ titulo: m.titulo, imagem: img(m.imagem) })),
    arquivos: arquivosEntregues(d).map((a) => ({ nome: a.nome, formato: a.formato })),
    creditos: d.creditos,
  };
}

/** Os caminhos de imagem que a página pública precisa (para virar data URL). */
export function imagensDoBrandbook(d: DadosDoBrandbook): string[] {
  const lista: string[] = [];
  const por = (c: string | null | undefined) => {
    if (c && lista.indexOf(c) < 0) lista.push(c);
  };
  for (const { logo: l } of logosDoBrandbook(d)) {
    // Para a página, a prévia PNG (leve) vale mais que o original; SVG entra como está.
    por(l.previa_png || l.caminho);
  }
  d.grafismos.forEach((g) => por(g.imagem));
  d.aplicacoes.forEach((a) => por(a.imagem));
  d.mockups.forEach((m) => por(m.imagem));
  return lista.slice(0, 24);
}

/** Token do link público: 32 caracteres base64url, um por byte aleatório (192 bits). Menos de 32 bytes é recusado. */
export function tokenPublico(bytes: Uint8Array): string {
  if (!bytes || bytes.length < 32) throw new Error("O token precisa de 32 bytes aleatórios.");
  const tabela = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "";
  for (let i = 0; i < 32; i++) s += tabela.charAt(bytes[i] & 63);
  return s;
}
