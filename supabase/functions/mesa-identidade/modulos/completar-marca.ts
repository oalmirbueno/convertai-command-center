/**
 * "Completar marca existente" (frente IDV3, 30/09/2026): o plano, o
 * checklist de completude e as contas que fecham a marca a partir da logo e
 * do nome. Pedido do dono: "criar o material completo usando tudo para marcas
 * existentes que só têm logo e nome, e deixar completa e profissional".
 *
 * O plano é uma lista de passos, cada um com o que preenche e o custo antes
 * (tokens por papel; a tela e a função põem o preço do modelo escolhido).
 * Cada passo usa o "Preencher com IA" ou a ação que já existe na mesa, só
 * preenche o que está vazio e fica editável depois. O que não tem base vira
 * pergunta, nunca invenção. A logo nunca é redesenhada.
 *
 * Puro: sem Deno, sem banco. Tela, função e testes usam o mesmo arquivo.
 */

import { CAMPOS_DO_BRIEFING } from "./briefing-da-identidade.ts";
import { type CorDaPaleta, avisosDeContraste, completarPaleta, escalaDaCor, hexParaHsl, nomeDaCor } from "./paleta-da-marca.ts";
import { luminanciaRelativa, normalizarHex, type PapelDaCor } from "../../_shared/cores-da-marca.ts";
import { faltaNaEstrategia, normalizarEstrategia } from "../../_shared/estrategia-de-marca.ts";
import { estilosDaPersonalidade, fonteDoCatalogo, PARES_DE_FONTES, paresParaEstilos } from "../../_shared/tipografia-da-marca.ts";
import { PECAS_DA_MARCA } from "./aplicacoes-da-marca.ts";
import { camposDasFalas, roteiroDaApresentacao } from "./apresentacao-da-marca.ts";
import { type FonteDoPreenchimento, tokensDaEstimativa, type CampoParaPreencher } from "../../_shared/preencher-com-ia.ts";
import { type LeituraPorVisao, ROTULO_DA_VERSAO, type VersaoDaLogo } from "./leitura-da-logo.ts";

// ------------------------------------------------------------------ passos

export const PASSOS_DO_COMPLETAR = [
  { id: "leitura", rotulo: "Ler a logo", detalhe: "Cores por código; forma, estilo e fonte parecida por visão" },
  { id: "versoes", rotulo: "Versões da logo", detalhe: "Monocromática, negativa, sem fundo e símbolo, por código" },
  { id: "briefing", rotulo: "Briefing", detalhe: "Do que o painel já sabe; o que faltar vira pergunta" },
  { id: "estrategia", rotulo: "Estratégia e tom de voz", detalhe: "Plataforma, arquétipo, posicionamento, persona e tom" },
  { id: "paleta", rotulo: "Paleta completa", detalhe: "As cores da logo, apoio, neutras e contraste WCAG" },
  { id: "tipografia", rotulo: "Tipografia", detalhe: "Par de fontes e hierarquia (sugestão parecida com a logo)" },
  { id: "grafismos", rotulo: "Grafismos e padrões", detalhe: "Padrões em SVG com as formas e as cores da logo" },
  { id: "textos", rotulo: "Conceito e fotografia", detalhe: "Significado da logo e regras de foto, só com base" },
  { id: "aplicacoes", rotulo: "Aplicações", detalhe: "Avatar, post, story, destaque, capa, cartão, timbrado, envelope e assinatura de e-mail" },
  { id: "mockups", rotulo: "Mockups do estúdio", detalhe: "Logo e cores nos mockups sugeridos pelo Jev" },
  { id: "guideline", rotulo: "Brandbook", detalhe: "Guideline no modelo escolhido, PDF e página web" },
  { id: "apresentacao", rotulo: "Apresentação", detalhe: "As falas dos slides para o encontro com o cliente" },
  { id: "video", rotulo: "Vídeo da marca", detalhe: "Apresentação em motion (e o filme, se pedir) na Mesa Motion" },
] as const;

export type PassoId = (typeof PASSOS_DO_COMPLETAR)[number]["id"];
export const IDS_DOS_PASSOS: PassoId[] = PASSOS_DO_COMPLETAR.map((p) => p.id);
export const ehPasso = (v: unknown): v is PassoId => typeof v === "string" && IDS_DOS_PASSOS.indexOf(v as PassoId) >= 0;
export const rotuloDoPasso = (id: PassoId) => (PASSOS_DO_COMPLETAR.filter((p) => p.id === id)[0] || { rotulo: id }).rotulo;

/** Passos que a função roda sozinha (o agente); os outros rodam na mesa, no navegador (canvas). */
export const PASSOS_DO_SERVIDOR: PassoId[] = ["leitura", "estrategia"];

/** Custo de um passo: tokens por papel (o preço sai do modelo escolhido para o papel). */
export type CustoDoPasso = { papel: "identidade" | "visao" | "motion"; entrada: number; saida: number; buscas?: number; imagens?: number; jev?: number };

/** Tamanhos das chamadas (a mesma conta na tela e na função). */
export const TAMANHOS_DO_COMPLETAR = {
  leitura: { entrada: 2_600, saida: 1_600, imagens: 1 },
  estrategia: { entrada: 8_000, saida: 5_000 },
} as const;

/**
 * Storyboards do filme cinematográfico (Mesa Motion): os mesmos tokens de
 * TAMANHOS_DO_MOTION.storyboards (_shared/motion-metodo.ts; o teste confere).
 * Copiado para a Mesa Identidade não carregar o método do motion inteiro.
 */
export const STORYBOARDS_DO_MOTION = { entrada: 7_500, saida: 7_000 } as const;

/** Custo aproximado de uma pergunta ao Jev (centavos de centavo). */
export const JEV_POR_CHAMADA_USD = 0.002;

export type OpcoesDoCompletar = {
  /** Passos escolhidos (padrão: todos os que ainda faltam). */
  passos?: PassoId[];
  /** Web como fonte (site e Instagram) no Preencher e na estratégia. */
  usarWeb?: boolean;
  modeloDoBrandbook?: "paginado" | "prancha";
  tema?: string;
  /** Vídeo: a apresentação em motion (sem IA) e, se pedir, o filme cinematográfico (storyboards com IA). */
  video?: { apresentacao: boolean; filme: boolean };
  /** Refazer o que já foi feito (padrão: só o que falta). */
  refazer?: boolean;
};

export type PassoDoPlano = {
  id: PassoId;
  rotulo: string;
  detalhe: string;
  /** Vai rodar? Pulado quando já está feito ou falta o que ele precisa. */
  roda: boolean;
  motivo: string | null;
  custos: CustoDoPasso[];
  /** Onde roda: na função (o agente consegue) ou na mesa (canvas no navegador). */
  onde: "servidor" | "mesa";
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const tem = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(tem);
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).some((k) => tem((v as Record<string, unknown>)[k]));
  return true;
};

// ------------------------------------------------------------------ campos dos passos que usam o "Preencher com IA"

export const FONTES_DO_COMPLETAR: FonteDoPreenchimento[] = ["contexto", "briefing", "dossie", "arquivos"];
export function fontesDoCompletar(usarWeb?: boolean): FonteDoPreenchimento[] {
  return usarWeb ? FONTES_DO_COMPLETAR.concat(["web"]) : FONTES_DO_COMPLETAR.slice();
}

const REGRA = "Só com o que está nas fontes; sem base, deixe vazio.";

/** Briefing: os campos vazios (depois do que o painel já montou). */
export function camposDoBriefing(dados: unknown): CampoParaPreencher[] {
  const b = obj(obj(dados).briefing);
  return CAMPOS_DO_BRIEFING.filter((c) => c.campo !== "palavras_do_nome" && !tem(b[c.campo])).map((c) => ({
    chave: c.campo,
    rotulo: c.rotulo,
    tipo: c.lista ? ("lista" as const) : c.campo === "negocio" || c.campo === "publico" || c.campo === "proposito" ? ("texto_longo" as const) : ("texto" as const),
    valorAtual: c.lista ? [] : "",
    dica: `${c.pergunta} ${REGRA}`,
    maximo: c.lista ? 8 : 600,
  }));
}

/** Conceito da logo e fotografia (Sistema): só o que está vazio. */
export function camposDosTextos(dados: unknown, leitura?: LeituraPorVisao | null): CampoParaPreencher[] {
  const s = obj(obj(dados).sistema);
  const f = obj(s.fotografia);
  const base = leitura && (leitura.forma || leitura.estilo) ? ` A leitura da logo diz: ${[leitura.forma, leitura.estilo].filter(Boolean).join(" ")}` : "";
  const campos: CampoParaPreencher[] = [];
  if (!tem(s.significado_do_logo)) campos.push({ chave: "significado_do_logo", rotulo: "Significado do logo", tipo: "texto_longo", valorAtual: "", dica: `O que a logo comunica, ligado à estratégia.${base} Não invente história de criação: sem base, deixe vazio.`, maximo: 1200 });
  if (!tem(f.coloracao)) campos.push({ chave: "fotografia.coloracao", rotulo: "Fotografia: coloração e composição", tipo: "texto_longo", valorAtual: "", dica: `Regra de cor e composição das fotos da marca, coerente com a paleta e o tom. ${REGRA}`, maximo: 600 });
  if (!tem(f.evitar)) campos.push({ chave: "fotografia.evitar", rotulo: "Fotografia: o que evitar", tipo: "texto", valorAtual: "", maximo: 400 });
  if (!tem(f.ia)) campos.push({ chave: "fotografia.ia", rotulo: "Imagem gerada por IA", tipo: "texto", valorAtual: "", dica: "Regra de uso de imagem de IA na marca (nunca no lugar do produto ou da pessoa real).", maximo: 400 });
  return campos;
}

/** Contato da assinatura e da papelaria: só o que está nas fontes (telefone e e-mail nunca inventados). */
export function camposDosContatos(dados: unknown): CampoParaPreencher[] {
  const a = obj(obj(obj(dados).aplicacoes).assinatura);
  const lista: Array<{ chave: string; rotulo: string }> = [
    { chave: "telefone", rotulo: "Telefone" },
    { chave: "email", rotulo: "E-mail" },
    { chave: "site", rotulo: "Site" },
    { chave: "instagram", rotulo: "Instagram" },
  ];
  return lista.filter((c) => !tem(a[c.chave])).map((c) => ({ chave: c.chave, rotulo: c.rotulo, tipo: "texto" as const, valorAtual: "", dica: "Copie exatamente o que está nas fontes do cliente; nunca invente telefone, e-mail ou endereço.", maximo: 120 }));
}

/** As falas vazias da apresentação (depois dos passos anteriores, o roteiro pode crescer). */
export function camposDasFalasVazias(dados: unknown, comNaming: boolean, semCaminhos: boolean): CampoParaPreencher[] {
  return camposDasFalas(roteiroDaApresentacao(dados, { comNaming, semCaminhos })).filter((c) => !tem(c.valorAtual));
}

function custoDoPreencher(campos: CampoParaPreencher[], fontes: FonteDoPreenchimento[]): CustoDoPasso[] {
  if (!campos.length) return [];
  const t = tokensDaEstimativa(campos, fontes);
  return [{ papel: "identidade", entrada: t.pedido + t.fontes.reduce((s, f) => s + f.tokens, 0), saida: t.saida, buscas: t.buscasWeb }];
}

// ------------------------------------------------------------------ plano

export type EstadoParaOPlano = {
  /** A logo principal (arquivo real) está no Sistema? */
  temLogo: boolean;
  modo: string;
  comNaming?: boolean;
};

/**
 * O plano: cada passo com o que vai fazer, o custo antes e o motivo quando
 * é pulado. Por padrão só roda o que falta (a equipe pode pedir "refazer").
 */
export function planoDeCompletar(dadosBrutos: unknown, estado: EstadoParaOPlano, opcoes: OpcoesDoCompletar = {}): PassoDoPlano[] {
  const d = obj(dadosBrutos);
  const s = obj(d.sistema);
  const leitura = obj(d.leitura_da_logo);
  const escolhidos = opcoes.passos && opcoes.passos.length ? opcoes.passos : IDS_DOS_PASSOS;
  const fontes = fontesDoCompletar(opcoes.usarWeb);
  const refazer = opcoes.refazer === true;
  const semCaminhos = estado.modo === "completar";
  const comNaming = estado.comNaming === true;
  const video = opcoes.video || { apresentacao: true, filme: false };
  const cores = arr(s.cores).filter((c) => !!normalizarHex(obj(c).hex));
  const tipos = arr(s.tipografia).map(obj);
  const itens = arr(obj(d.aplicacoes).itens);
  const videos = arr(d.videos).map(obj);
  return PASSOS_DO_COMPLETAR.map((p) => {
    let motivo: string | null = null;
    let custos: CustoDoPasso[] = [];
    const precisaDaLogo = p.id !== "briefing" && p.id !== "estrategia";
    const feito = (): boolean => {
      switch (p.id) {
        case "leitura":
          return tem(obj(leitura.visao).em) && arr(leitura.cores).length > 0;
        case "versoes":
          return arr(obj(leitura.versoes).geradas).length > 0;
        case "briefing":
          return camposDoBriefing(d).filter((c) => ["negocio", "publico", "personalidade"].indexOf(c.chave) >= 0).length === 0;
        case "estrategia":
          return faltaNaEstrategia(d.estrategia).length === 0;
        case "paleta":
          return cores.length >= 4;
        case "tipografia":
          return tipos.some((t) => t.uso === "titulo" && tem(t.familia)) && tipos.some((t) => t.uso === "texto" && tem(t.familia));
        case "grafismos":
          return arr(s.grafismos).length >= 2;
        case "textos":
          return camposDosTextos(d).length === 0;
        case "aplicacoes":
          return itens.length >= PECAS_DA_MARCA.length;
        case "mockups":
          return arr(d.mockups).length >= 3;
        case "guideline":
          return false;
        case "apresentacao":
          return camposDasFalasVazias(d, comNaming, semCaminhos).length === 0;
        case "video":
          return (!video.apresentacao || videos.some((v) => v.tipo === "apresentacao")) && (!video.filme || videos.some((v) => v.tipo === "filme_marca"));
      }
      return false;
    };
    if (escolhidos.indexOf(p.id) < 0) motivo = "Fora desta rodada";
    else if (precisaDaLogo && !estado.temLogo) motivo = "Falta a logo principal (arquivo real)";
    else if (!refazer && feito()) motivo = "Já está feito";
    else if (p.id === "video" && !video.apresentacao && !video.filme) motivo = "Nenhum vídeo pedido";
    if (!motivo) {
      switch (p.id) {
        case "leitura":
          // A leitura por visão já feita (ex.: pelo agente) não se paga de novo: falta só a parte por código.
          custos = tem(obj(leitura.visao).em) && !refazer ? [] : [{ papel: "visao", entrada: TAMANHOS_DO_COMPLETAR.leitura.entrada, saida: TAMANHOS_DO_COMPLETAR.leitura.saida, imagens: 1 }];
          break;
        case "briefing":
          custos = custoDoPreencher(camposDoBriefing(d), fontes);
          break;
        case "estrategia":
          custos = [{ papel: "identidade", entrada: TAMANHOS_DO_COMPLETAR.estrategia.entrada, saida: TAMANHOS_DO_COMPLETAR.estrategia.saida, buscas: opcoes.usarWeb ? 3 : 0 }];
          break;
        case "textos":
          custos = custoDoPreencher(camposDosTextos(d), fontes);
          break;
        case "aplicacoes":
          custos = custoDoPreencher(camposDosContatos(d), fontes);
          break;
        case "mockups":
          custos = [{ papel: "identidade", entrada: 0, saida: 0, jev: 1 }];
          break;
        case "apresentacao": {
          // O roteiro cresce com os passos de antes: conta os slides que sempre entram.
          const n = Math.max(camposDasFalasVazias(d, comNaming, semCaminhos).length, 13);
          const campos: CampoParaPreencher[] = [];
          for (let i = 0; i < n; i++) campos.push({ chave: `falas.s${i}`, rotulo: "Fala", tipo: "texto_longo", maximo: 700 });
          custos = custoDoPreencher(campos, fontes);
          break;
        }
        case "video":
          custos = video.filme ? [{ papel: "motion", entrada: STORYBOARDS_DO_MOTION.entrada, saida: STORYBOARDS_DO_MOTION.saida }] : [];
          break;
      }
    }
    return { id: p.id, rotulo: p.rotulo, detalhe: p.detalhe, roda: !motivo, motivo, custos, onde: PASSOS_DO_SERVIDOR.indexOf(p.id) >= 0 ? "servidor" : "mesa" };
  });
}

/** Soma do plano com um preço por custo (a tela usa o catálogo; a função, o motor). */
export function totalDoPlano(passos: PassoDoPlano[], preco: (c: CustoDoPasso) => number | null): { total: number; semPreco: number } {
  let total = 0;
  let semPreco = 0;
  for (const p of passos) {
    if (!p.roda) continue;
    for (const c of p.custos) {
      const v = c.jev ? c.jev * JEV_POR_CHAMADA_USD : preco(c);
      if (v == null) semPreco += 1;
      else total += v;
    }
  }
  return { total: Math.round(total * 1e6) / 1e6, semPreco };
}

// ------------------------------------------------------------------ paleta a partir da logo

const croma = (hex: string) => {
  const c = hexParaHsl(hex);
  return c.s >= 14 && c.l > 8 && c.l < 94;
};

function perto(a: string, b: string): boolean {
  const x = hexParaHsl(a);
  const y = hexParaHsl(b);
  const dh = Math.min(Math.abs(x.h - y.h), 360 - Math.abs(x.h - y.h));
  return dh < 12 && Math.abs(x.s - y.s) < 14 && Math.abs(x.l - y.l) < 10;
}

/**
 * A paleta completa por código: as cores reais (kit da marca e pixels da
 * logo), com papéis; tons de apoio da primária quando a marca tem poucas
 * cores; neutras tingidas que faltam; e os avisos de contraste (WCAG). Logo
 * só em preto e branco vira PERGUNTA (qual é a cor da marca?), nunca cor inventada.
 */
export function paletaCompleta(e: { doKit?: Array<{ nome?: unknown; papel?: unknown; hex?: unknown }> | null; daLogo?: Array<{ hex: string; parte: number }> | null }): { cores: CorDaPaleta[]; avisos: string[]; perguntas: string[]; fontes: string[] } {
  const fontes: string[] = [];
  const reais: Array<{ nome: string; hex: string; papel: PapelDaCor | null; parte: number }> = [];
  for (const c of e.doKit || []) {
    const hex = normalizarHex(c.hex);
    if (!hex || reais.some((r) => r.hex === hex || perto(r.hex, hex))) continue;
    const papel = ["primaria", "secundaria", "destaque", "neutra"].indexOf(String(c.papel)) >= 0 ? (c.papel as PapelDaCor) : null;
    reais.push({ nome: String(c.nome == null ? "" : c.nome).trim().slice(0, 40), hex, papel, parte: 1 });
  }
  if (reais.length) fontes.push("kit da marca");
  let daLogo = 0;
  for (const c of e.daLogo || []) {
    const hex = normalizarHex(c.hex);
    if (!hex || reais.some((r) => r.hex === hex || perto(r.hex, hex))) continue;
    reais.push({ nome: "", hex, papel: null, parte: c.parte });
    daLogo += 1;
  }
  if (daLogo) fontes.push("pixels da logo");
  const perguntas: string[] = [];
  if (!reais.length) return { cores: [], avisos: [], perguntas: ["A logo não trouxe cor legível e o kit não tem paleta: quais são as cores da marca?"], fontes };
  const cromaticas = reais.filter((r) => croma(r.hex));
  const lista: CorDaPaleta[] = [];
  const primaria = reais.filter((r) => r.papel === "primaria")[0] || cromaticas[0] || reais[0];
  lista.push({ nome: primaria.nome || nomeDaCor(primaria.hex), papel: "primaria", hex: primaria.hex });
  const resto = reais.filter((r) => r !== primaria);
  // Destaque: a mais saturada entre as cromáticas que sobram, quando aparece pouco na logo.
  const candidatasADestaque = resto.filter((r) => croma(r.hex) && r.papel !== "neutra").sort((a, b) => hexParaHsl(b.hex).s - hexParaHsl(a.hex).s);
  const destaque = resto.filter((r) => r.papel === "destaque")[0] || (candidatasADestaque.length >= 2 ? candidatasADestaque[0] : null);
  for (const r of resto) {
    const papel: PapelDaCor = r === destaque ? "destaque" : r.papel && r.papel !== "primaria" ? r.papel : croma(r.hex) ? "secundaria" : "neutra";
    lista.push({ nome: r.nome || nomeDaCor(r.hex), papel, hex: r.hex });
  }
  if (!cromaticas.length) perguntas.push("A logo é só preto e branco: a marca usa alguma cor de destaque? Sem essa resposta, a paleta fica nas neutras.");
  // Apoio: com menos de 3 cores de marca, dois tons da primária (a mesma cor, mais clara e mais funda).
  const deMarca = lista.filter((c) => c.papel !== "neutra").length;
  if (croma(primaria.hex) && deMarca < 3) {
    const escala = escalaDaCor(primaria.hex);
    const clara = escala.filter((x) => x.passo === 100)[0];
    const funda = escala.filter((x) => x.passo === 800)[0];
    const base = lista[0].nome;
    if (clara && !lista.some((c) => perto(c.hex, clara.hex))) lista.push({ nome: `${base} claro`, papel: "secundaria", hex: clara.hex });
    if (funda && !lista.some((c) => perto(c.hex, funda.hex))) lista.push({ nome: `${base} profundo`, papel: "secundaria", hex: funda.hex });
  }
  const cores = completarPaleta(lista);
  const avisos = avisosDeContraste(cores);
  return { cores, avisos, perguntas, fontes };
}

// ------------------------------------------------------------------ tipografia a partir da leitura

export type TipoDoCompletar = { familia: string; uso: "titulo" | "texto" | "apoio"; pesos: string[]; licenca: string; alternativa: string };

/**
 * Par e hierarquia por regra: a fonte do kit (quando existe) vale mais; senão
 * a família parecida com a da logo (sugestão da leitura por visão, conferida no
 * catálogo); senão o par da personalidade da estratégia. O texto corrido sai do
 * par conhecido do título ou de uma sem serifa legível. Sempre com o aviso de
 * que é equivalente, não a fonte original.
 */
export function tipografiaCompleta(e: { doKit?: { titulo?: string | null; texto?: string | null } | null; leitura?: LeituraPorVisao | null; estrategia?: unknown }): { tipografia: TipoDoCompletar[]; avisos: string[]; perguntas: string[] } {
  const avisos: string[] = [];
  const perguntas: string[] = [];
  const lic = (f: string) => (fonteDoCatalogo(f) ? "Google Fonts (OFL)" : "Confirmar a licença");
  const kitTitulo = e.doKit && e.doKit.titulo ? String(e.doKit.titulo).trim().slice(0, 60) : "";
  const kitTexto = e.doKit && e.doKit.texto ? String(e.doKit.texto).trim().slice(0, 60) : "";
  let titulo = kitTitulo;
  let origem = kitTitulo ? "kit" : "";
  const leitura = e.leitura || null;
  if (!titulo && leitura && leitura.fonte.tem_texto) {
    const conferida = leitura.fonte.parecidas.filter((p) => p.conferida)[0];
    if (conferida) {
      titulo = conferida.familia;
      origem = "leitura";
      avisos.push(`${conferida.familia} é parecida com a letra da logo (sugestão, não a fonte original). Confirme com o cliente.`);
    }
  }
  if (!titulo) {
    const est = normalizarEstrategia(e.estrategia);
    const pares = paresParaEstilos(estilosDaPersonalidade({ arquetipo: est.arquetipo.principal, eixos: est.personalidade.eixos }), 3);
    if (pares.length) {
      titulo = pares[0].titulo;
      origem = "personalidade";
      avisos.push(`Par "${pares[0].nome}" escolhido pela personalidade da estratégia: a logo não deu base para a fonte.`);
    }
    perguntas.push("Qual é a fonte usada na logo (ou nos materiais atuais)? A tipografia ficou com um par sugerido.");
  }
  if (!titulo) return { tipografia: [], avisos, perguntas };
  let texto = kitTexto;
  if (!texto) {
    const par = PARES_DE_FONTES.filter((p) => p.titulo === titulo)[0];
    const doCatalogo = fonteDoCatalogo(titulo);
    texto = par ? par.texto : doCatalogo && doCatalogo.categoria === "sem_serifa" && doCatalogo.pesos.indexOf(400) >= 0 ? titulo : "Inter";
    if (!par && texto === "Inter") avisos.push("Texto corrido em Inter por regra (sem serifa legível em tela e papel).");
  }
  const pesoTitulo = (() => {
    const f = fonteDoCatalogo(titulo);
    if (!f) return ["700"];
    const p = f.pesos.indexOf(700) >= 0 ? 700 : f.pesos[f.pesos.length - 1];
    return [String(p)];
  })();
  const tipografia: TipoDoCompletar[] = [{ familia: titulo, uso: "titulo", pesos: pesoTitulo, licenca: lic(titulo), alternativa: origem === "leitura" ? "Parecida com a letra da logo" : "" }];
  if (texto && texto !== titulo) tipografia.push({ familia: texto, uso: "texto", pesos: ["400", "600"], licenca: lic(texto), alternativa: "Helvetica, Arial" });
  else tipografia.push({ familia: titulo, uso: "texto", pesos: ["400", "600"], licenca: lic(titulo), alternativa: "Helvetica, Arial" });
  return { tipografia, avisos, perguntas };
}

// ------------------------------------------------------------------ checklist de completude

export type ItemDoChecklist = { id: string; rotulo: string; tem: boolean; detalhe: string; passo: PassoId | null };

export type ExtrasDoChecklist = {
  brandbook?: { versao: number; enviado: boolean; aprovado: boolean } | null;
  kitAplicado?: boolean;
};

/** O que a marca tem e o que falta, item a item, com o passo que completa cada um. */
export function checklistDaMarca(dadosBrutos: unknown, extras: ExtrasDoChecklist = {}, opcoes: { comNaming?: boolean; semCaminhos?: boolean } = {}): ItemDoChecklist[] {
  const d = obj(dadosBrutos);
  const s = obj(d.sistema);
  const logos = obj(s.logos);
  const leitura = obj(d.leitura_da_logo);
  const est = normalizarEstrategia(d.estrategia);
  const cores = arr(s.cores).map(obj).filter((c) => !!normalizarHex(c.hex));
  const tipos = arr(s.tipografia).map(obj);
  const itens = arr(obj(d.aplicacoes).itens);
  const assinatura = obj(obj(d.aplicacoes).assinatura);
  const videos = arr(d.videos).map(obj);
  const alternativas = arr(logos.alternativas).length;
  const icones = arr(logos.icone).length;
  const designer = arr(obj(leitura.versoes).designer).map(obj);
  const temEscura = cores.some((c) => luminanciaRelativa(String(c.hex)) < 0.05);
  const temClara = cores.some((c) => luminanciaRelativa(String(c.hex)) > 0.8);
  const faltaEst = faltaNaEstrategia(d.estrategia);
  const falasVazias = camposDasFalasVazias(d, opcoes.comNaming === true, opcoes.semCaminhos === true).length;
  const lista: ItemDoChecklist[] = [
    { id: "logo", rotulo: "Logo principal", tem: tem(obj(logos.principal).caminho), detalhe: tem(obj(logos.principal).caminho) ? (/svg/i.test(String(obj(logos.principal).mime || "")) ? "Arquivo em vetor (SVG)" : "Arquivo em PNG") : "Envie o arquivo real", passo: null },
    { id: "leitura", rotulo: "Leitura da logo", tem: tem(obj(leitura.visao).em) && arr(leitura.cores).length > 0, detalhe: tem(obj(leitura.visao).em) ? String(obj(leitura.visao).estilo || "Forma, estilo e fonte lidos") : "Cores, forma, estilo e fonte parecida", passo: "leitura" },
    { id: "versoes", rotulo: "Versões da logo", tem: alternativas + icones >= 2, detalhe: `${alternativas + icones} versões${designer.length ? `; designer: ${designer.map((x) => ROTULO_DA_VERSAO[x.versao as VersaoDaLogo] || String(x.versao)).join(", ").toLowerCase()}` : ""}`, passo: "versoes" },
    { id: "briefing", rotulo: "Briefing", tem: camposDoBriefing(d).filter((c) => ["negocio", "publico", "personalidade"].indexOf(c.chave) >= 0).length === 0, detalhe: "Negócio, público e personalidade", passo: "briefing" },
    { id: "estrategia", rotulo: "Estratégia", tem: faltaEst.filter((f) => !/tom/i.test(f)).length === 0, detalhe: faltaEst.length ? `Falta: ${faltaEst[0].toLowerCase()}` : "Plataforma, arquétipo e posicionamento", passo: "estrategia" },
    { id: "tom", rotulo: "Tom de voz", tem: est.tom.fala_assim.length > 0, detalhe: est.tom.atributos.length ? est.tom.atributos.slice(0, 3).join(", ") : "Como a marca fala e como não fala", passo: "estrategia" },
    { id: "paleta", rotulo: "Paleta completa", tem: cores.length >= 4 && temEscura && temClara, detalhe: `${cores.length} cores${cores.length && (!temEscura || !temClara) ? "; falta neutra para texto ou fundo" : ""}`, passo: "paleta" },
    { id: "tipografia", rotulo: "Tipografia", tem: tipos.some((t) => t.uso === "titulo" && tem(t.familia)) && tipos.some((t) => t.uso === "texto" && tem(t.familia)), detalhe: tipos.length ? tipos.map((t) => String(t.familia)).filter(Boolean).join(" + ") : "Par e hierarquia", passo: "tipografia" },
    { id: "grafismos", rotulo: "Grafismos e padrões", tem: arr(s.grafismos).length >= 2, detalhe: `${arr(s.grafismos).length} ativos`, passo: "grafismos" },
    { id: "conceito", rotulo: "Conceito e fotografia", tem: camposDosTextos(d).length === 0, detalhe: "Significado da logo e regras de foto", passo: "textos" },
    { id: "aplicacoes", rotulo: "Peças da marca", tem: itens.length >= PECAS_DA_MARCA.length, detalhe: `${itens.length} de ${PECAS_DA_MARCA.length}`, passo: "aplicacoes" },
    { id: "assinatura", rotulo: "Assinatura de e-mail", tem: tem(assinatura.email) || tem(assinatura.telefone), detalhe: tem(assinatura.email) || tem(assinatura.telefone) ? "Contato preenchido" : "Contato da marca", passo: "aplicacoes" },
    { id: "mockups", rotulo: "Mockups", tem: arr(d.mockups).length >= 3, detalhe: `${arr(d.mockups).length} no brandbook`, passo: "mockups" },
    { id: "brandbook", rotulo: "Brandbook", tem: !!extras.brandbook || tem(obj(d.guideline).brandbook_id), detalhe: extras.brandbook ? `Versão ${extras.brandbook.versao}` : "PDF e página web", passo: "guideline" },
    { id: "apresentacao", rotulo: "Apresentação", tem: falasVazias === 0, detalhe: falasVazias ? `${falasVazias} falas vazias` : "Falas prontas", passo: "apresentacao" },
    { id: "video", rotulo: "Vídeo da marca", tem: videos.length > 0, detalhe: videos.length ? `${videos.length} na Mesa Motion` : "Apresentação em motion", passo: "video" },
    { id: "aprovacao", rotulo: "Aprovação do cliente", tem: !!(extras.brandbook && extras.brandbook.aprovado), detalhe: extras.brandbook ? (extras.brandbook.aprovado ? "Aprovado" : extras.brandbook.enviado ? "Enviado, esperando" : "Ainda não enviado") : "Depois do brandbook", passo: null },
    { id: "kit", rotulo: "Kit da marca", tem: extras.kitAplicado === true || tem(obj(d.completar).kit_em), detalhe: "O aprovado vira kit, com Confirmar", passo: null },
  ];
  return lista;
}

export function resumoDoChecklist(itens: ItemDoChecklist[]): { feitos: number; total: number; faltam: PassoId[] } {
  const faltam: PassoId[] = [];
  for (const i of itens) if (!i.tem && i.passo && faltam.indexOf(i.passo) < 0) faltam.push(i.passo);
  return { feitos: itens.filter((i) => i.tem).length, total: itens.length, faltam };
}

// ------------------------------------------------------------------ execução (o que fica guardado)

export type EstadoDoPasso = "pendente" | "rodando" | "feito" | "pulado" | "falhou" | "parado";

export type PassoExecutado = {
  id: PassoId;
  estado: EstadoDoPasso;
  resumo: string;
  custo_usd: number;
  em: string | null;
  /** O que o Desfazer precisa (partes do projeto antes do passo). */
  antes?: Record<string, unknown> | null;
};

export type ExecucaoDoCompletar = {
  id: string;
  iniciada_em: string;
  terminada_em: string | null;
  parada_em: string | null;
  origem: "mesa" | "agente";
  opcoes: OpcoesDoCompletar;
  passos: PassoExecutado[];
  custo_usd: number;
};

const ESTADOS: EstadoDoPasso[] = ["pendente", "rodando", "feito", "pulado", "falhou", "parado"];

export function normalizarExecucao(v: unknown): ExecucaoDoCompletar | null {
  const o = obj(v);
  if (typeof o.id !== "string" || !o.id) return null;
  const passos = arr(o.passos)
    .map(obj)
    .filter((p) => ehPasso(p.id))
    .map((p) => ({
      id: p.id as PassoId,
      estado: ESTADOS.indexOf(p.estado as EstadoDoPasso) >= 0 ? (p.estado as EstadoDoPasso) : "pendente",
      resumo: String(p.resumo == null ? "" : p.resumo).slice(0, 400),
      custo_usd: Number(p.custo_usd) || 0,
      em: typeof p.em === "string" ? p.em : null,
      antes: p.antes && typeof p.antes === "object" ? (p.antes as Record<string, unknown>) : null,
    }));
  return {
    id: o.id,
    iniciada_em: String(o.iniciada_em || ""),
    terminada_em: typeof o.terminada_em === "string" ? o.terminada_em : null,
    parada_em: typeof o.parada_em === "string" ? o.parada_em : null,
    origem: o.origem === "agente" ? "agente" : "mesa",
    opcoes: obj(o.opcoes) as OpcoesDoCompletar,
    passos,
    custo_usd: Number(o.custo_usd) || 0,
  };
}

/** Nova execução com os passos que rodam (os outros ficam de fora). */
export function novaExecucao(id: string, plano: PassoDoPlano[], opcoes: OpcoesDoCompletar, origem: "mesa" | "agente", agora = new Date().toISOString()): ExecucaoDoCompletar {
  return { id, iniciada_em: agora, terminada_em: null, parada_em: null, origem, opcoes, custo_usd: 0, passos: plano.filter((p) => p.roda).map((p) => ({ id: p.id, estado: "pendente", resumo: "", custo_usd: 0, em: null, antes: null })) };
}

/** O próximo passo a rodar (o primeiro pendente) e se a execução terminou. */
export function proximoPasso(e: ExecucaoDoCompletar): PassoId | null {
  const p = e.passos.filter((x) => x.estado === "pendente" || x.estado === "parado")[0];
  return p ? p.id : null;
}

/** Junta as perguntas (sem repetir, até 20): o que não tem base volta para a equipe. */
export function juntarPerguntas(antes: unknown, novas: Array<{ texto: string; passo: PassoId }>): Array<{ texto: string; passo: PassoId }> {
  const lista = arr(antes)
    .map(obj)
    .filter((x) => typeof x.texto === "string" && ehPasso(x.passo))
    .map((x) => ({ texto: String(x.texto).slice(0, 300), passo: x.passo as PassoId }));
  for (const n of novas) {
    const t = String(n.texto || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (t && !lista.some((x) => x.texto === t)) lista.push({ texto: t, passo: n.passo });
  }
  return lista.slice(-20);
}

// ------------------------------------------------------------------ pacote

/**
 * O índice do pacote da marca (LEIA-PRIMEIRO.txt): o que tem em cada pasta e o
 * que ainda precisa de designer. Puro: a tela monta o .zip e põe este texto.
 */
export function manifestoDoPacote(e: {
  marca: string;
  logos: Array<{ rotulo: string; formato: string }>;
  cores: number;
  fontes: string[];
  grafismos: number;
  pecas: number;
  mockups: number;
  videos: string[];
  pdf: boolean;
  paginaWeb: boolean;
  designer: Array<{ versao: string; motivo: string }>;
  perguntas: string[];
}): { texto: string; pastas: string[] } {
  const pastas: string[] = [];
  const l: string[] = [`Pacote da marca ${e.marca || ""}`.trim(), "Feito na Mesa Identidade da Aceleriq.", ""];
  const bloco = (pasta: string, titulo: string, linhas: string[]) => {
    if (!linhas.length) return;
    pastas.push(pasta);
    l.push(`${titulo} (${pasta})`);
    linhas.forEach((x) => l.push(`  ${x}`));
    l.push("");
  };
  bloco("logos/", "Logos", e.logos.map((x) => `${x.rotulo}: ${x.formato}`));
  bloco("cores/", "Cores", e.cores ? [`${e.cores} cores em HEX, RGB e CMYK (JSON, CSS, TXT e paleta do GIMP)`] : []);
  bloco("fontes/", "Fontes", e.fontes.length ? e.fontes.concat(["Veja fontes/LEIA.txt para a licença e onde baixar."]) : []);
  bloco("grafismos/", "Grafismos", e.grafismos ? [`${e.grafismos} padrões e ativos (PNG e SVG)`] : []);
  bloco("aplicacoes/", "Peças", e.pecas ? [`${e.pecas} peças (redes e papelaria) em PNG`] : []);
  bloco("mockups/", "Mockups", e.mockups ? [`${e.mockups} mockups com a marca aplicada`] : []);
  bloco("videos/", "Vídeos", e.videos);
  const docs: string[] = [];
  if (e.pdf) docs.push("Brandbook em PDF");
  if (e.paginaWeb) docs.push("brandbook.html: abre em qualquer navegador, sem o painel");
  docs.push("brandbook.json: os dados do manual");
  bloco("./", "Manual", docs);
  if (e.designer.length) {
    l.push("Precisa de designer (não sai por código sem redesenhar a logo)");
    e.designer.forEach((d) => l.push(`  ${d.versao}: ${d.motivo}`));
    l.push("");
  }
  if (e.perguntas.length) {
    l.push("Perguntas em aberto (o que não tinha base)");
    e.perguntas.forEach((p) => l.push(`  ${p}`));
    l.push("");
  }
  return { texto: l.join("\n"), pastas };
}
