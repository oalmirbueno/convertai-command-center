/**
 * O vídeo da marca a partir da Mesa Identidade (frente IDV3, 30/09/2026).
 * Adendo do dono: "o Motion também se complementa no final da identidade
 * visual, onde ele também gera os vídeos da marca e a apresentação".
 *
 * A Mesa Identidade cria o filme na Mesa Motion (ações que já existem:
 * filme_criar e filme_salvar) já com os insumos do projeto:
 * - a entrevista respondida pela estratégia (pula a etapa Entrevista);
 * - o BRAND.md montado por código da estratégia (sem IA: nada inventado,
 *   provas vazias porque a identidade não tem prova com fonte);
 * - as cenas do kit a partir dos slides da apresentação: logo sting,
 *   abertura, plataforma, paleta, tipografia, aplicações e cartão final;
 * - `insumos.identidade`: paleta, tipografia e a logo do projeto. A Mesa
 *   Motion usa esses insumos no lugar do kit da marca (o kit só muda depois
 *   da aprovação, com Confirmar), via `kitDaIdentidade`.
 *
 * Puro: sem Deno, sem banco. A tela, a mesa-motion e os testes usam o mesmo arquivo.
 */

import { contraste, luminanciaRelativa, normalizarHex } from "./cores-da-marca.ts";
import { normalizarEstrategia } from "./estrategia-de-marca.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const linha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/[–—]/g, ",").replace(/\s+/g, " ").trim().slice(0, max);

/** Caminho do bucket mesa que pode ir para a cena (só da pasta da marca do cliente, imagem). */
export function caminhoDaIdentidade(v: unknown, clientId: string): string | null {
  const s = String(v == null ? "" : v).trim();
  if (!s || s.indexOf("..") >= 0 || s.indexOf(`${clientId}/marca/`) !== 0) return null;
  return /^[0-9a-f-]{36}\/[A-Za-z0-9/_. -]{1,200}\.(png|jpe?g|webp)$/i.test(s) ? s : null;
}

// ------------------------------------------------------------------ entrevista pela estratégia

const CLIMA_DO_ARQUETIPO: Record<string, string> = {
  inocente: "calma",
  explorador: "epica",
  sabio: "calma",
  heroi: "epica",
  fora_da_lei: "epica",
  mago: "tech",
  cara_comum: "animada",
  amante: "luxo",
  bobo_da_corte: "animada",
  cuidador: "calma",
  criador: "tech",
  governante: "luxo",
};

/**
 * As respostas da entrevista do filme, tiradas da estratégia (regra fixa):
 * clima pelo arquétipo, ritmo pela energia, fundo pela cor primária. Prova:
 * "sem_prova" (a identidade não tem número nem depoimento com fonte).
 */
export function entrevistaDaEstrategia(estrategiaBruta: unknown, cores: Array<{ hex?: unknown; papel?: unknown }>, cenas: number, tipo: "apresentacao" | "filme_marca" = "apresentacao"): Record<string, string | string[]> {
  const e = normalizarEstrategia(estrategiaBruta);
  const energia = Number(e.personalidade.eixos.energia) || 0;
  const humor = Number(e.personalidade.eixos.humor) || 0;
  const primaria = cores.map((c) => ({ hex: normalizarHex(c.hex), papel: String(c.papel || "") })).filter((c) => c.hex).sort((a, b) => Number(b.papel === "primaria") - Number(a.papel === "primaria"))[0];
  // Primária quase preta some no fundo escuro da marca: aí o fundo é o claro.
  const quasePreta = primaria && primaria.hex ? luminanciaRelativa(primaria.hex) < 0.03 : false;
  const duracao = tipo === "filme_marca" ? "45" : cenas <= 4 ? "15" : cenas <= 7 ? "30" : "45";
  return {
    objetivo: "apresentar",
    duracao,
    logo: "sting",
    abertura: "titulo",
    prova: ["sem_prova"],
    punchlines: humor > 0 || energia > 0 ? "curtas" : "poucas",
    transicao: energia >= 1 ? "corte_na_batida" : energia <= -1 ? "fade" : "empurrao",
    ritmo: energia >= 1 ? "rapido" : energia <= -1 ? "calmo" : "medio",
    clima: CLIMA_DO_ARQUETIPO[e.arquetipo.principal] || "calma",
    fundo: quasePreta ? "claro" : "escuro",
    observacoes: "Respostas tiradas da estratégia da marca na Mesa Identidade (a entrevista foi pulada).",
  };
}

/** O BRAND.md do filme, por código, da estratégia (a equipe edita na Mesa Motion). */
export function brandDaEstrategia(estrategiaBruta: unknown, slogan: string): Record<string, unknown> {
  const e = normalizarEstrategia(estrategiaBruta);
  return {
    essencia: linha(e.proposito || e.missao || e.posicionamento.declaracao, 600),
    publico: linha(e.publico.resumo || e.posicionamento.publico, 600),
    promessa: linha(e.proposta_de_valor.promessa || e.posicionamento.diferencial || slogan, 600),
    tom: linha(e.tom.atributos.join(", "), 300),
    provas: [],
    evitar: linha(e.tom.nao_fala_assim.join("; "), 600),
    movimento: "",
    regras: "Logo e cores do projeto de identidade; a logo entra pelo código, nunca redesenhada.",
    beats: [],
  };
}

// ------------------------------------------------------------------ cenas pelos slides

export type CenaDaIdentidade = { titulo: string; duracao_s: number; modo: "kit"; peca: string; params: Record<string, unknown>; fundo: "marca"; tema: "escuro" | "claro"; ideia: string; movimento: string; tipo_plano: "hf" };

/**
 * Os slides da apresentação viram cenas do kit do motion (sem IA):
 * logo sting, abertura, plataforma (valores), paleta, tipografia, aplicações
 * e cartão final. Só entra a cena que tem o que mostrar.
 */
export function cenasDaApresentacao(dadosBrutos: unknown, e: { nome: string; clientId: string }): CenaDaIdentidade[] {
  const d = obj(dadosBrutos);
  const s = obj(d.sistema);
  const est = normalizarEstrategia(d.estrategia);
  const naming = obj(d.naming);
  const slogan = linha(naming.slogan, 60);
  const nome = linha(naming.nome || e.nome, 70) || "A marca";
  const cenas: CenaDaIdentidade[] = [];
  const cena = (titulo: string, peca: string, params: Record<string, unknown>, ideia: string, duracao = 4) => cenas.push({ titulo, duracao_s: duracao, modo: "kit", peca, params, fundo: "marca", tema: "escuro", ideia, movimento: "", tipo_plano: "hf" });
  const temLogo = !!obj(obj(s.logos).principal).caminho;
  if (temLogo) cena("Logo", "logo_sting", slogan ? { tagline: slogan } : {}, "A marca entra com a assinatura.");
  const sub = linha(est.posicionamento.declaracao || est.proposito || est.missao, 120);
  cena("Abertura", "abertura", { selo: "Manual da marca", titulo: nome, ...(sub ? { subtitulo: sub } : {}) }, "O nome e a frase que resume a marca.");
  const valores = est.valores.map((v) => linha(v.nome, 40)).filter(Boolean).slice(0, 4);
  if (valores.length >= 2) cena("No que acreditamos", "passos", { titulo: "No que acreditamos", itens: valores }, "Os valores da plataforma.", 5);
  const cores = arr(s.cores)
    .map(obj)
    .map((c) => ({ nome: linha(c.nome, 24), hex: normalizarHex(c.hex) }))
    .filter((c) => c.hex);
  if (cores.length >= 3) cena("Paleta", "diagrama", { centro: "Paleta", ramos: cores.slice(0, 6).map((c) => `${c.nome || c.hex} ${c.hex}`.slice(0, 30)) }, "As cores da marca com o HEX.", 5);
  else if (cores.length === 2) cena("Paleta", "passos", { titulo: "Paleta", itens: cores.map((c) => `${c.nome || c.hex} ${c.hex}`.slice(0, 40)) }, "As cores da marca com o HEX.", 5);
  const tipos = arr(s.tipografia).map(obj);
  const titulo = tipos.filter((t) => t.uso === "titulo")[0] || tipos[0];
  const texto = tipos.filter((t) => t.uso === "texto")[0];
  if (titulo && titulo.familia) cena("Tipografia", "abertura", { selo: "Tipografia", titulo: linha(titulo.familia, 60), subtitulo: texto && texto.familia && texto.familia !== titulo.familia ? `${linha(texto.familia, 60)} no texto corrido` : "Aa Bb Cc 0123456789" }, "As famílias da marca.");
  const imagens = arr(obj(d.aplicacoes).itens)
    .map((a) => caminhoDaIdentidade(obj(a).imagem, e.clientId))
    .concat(arr(d.mockups).map((m) => caminhoDaIdentidade(obj(m).imagem, e.clientId)))
    .filter((x): x is string => !!x)
    .slice(0, 6);
  if (imagens.length) cena("A marca no mundo", "carrossel_provas", { titulo: "A marca no mundo", imagens }, "Peças e mockups girando.", 6);
  const a = obj(obj(d.aplicacoes).assinatura);
  const contato = linha([a.site, a.instagram ? `@${String(a.instagram).replace(/^@/, "")}` : ""].filter(Boolean).join("  "), 60);
  cena("Cartão final", "cartao_final", { chamada: slogan || nome, ...(contato ? { contato } : {}) }, "Fechamento com a logo.");
  return cenas;
}

// ------------------------------------------------------------------ insumos e o kit do filme

export type InsumosDaIdentidade = {
  projeto_id: string;
  paleta: Array<{ nome: string; papel: string; hex: string }>;
  fontes: Array<{ nome: string; papel: "titulo" | "texto" }>;
  logo_path: string | null;
  grafismos: string[];
  aplicacoes: string[];
  tagline: string;
  tom: string;
  estrategia: string;
};

/** O que o filme leva do projeto de identidade (vai em motion_filmes.insumos.identidade). */
export function insumosDaIdentidade(dadosBrutos: unknown, e: { projetoId: string; clientId: string }): InsumosDaIdentidade {
  const d = obj(dadosBrutos);
  const s = obj(d.sistema);
  const est = normalizarEstrategia(d.estrategia);
  const logo = obj(obj(s.logos).principal);
  const tipos = arr(s.tipografia).map(obj);
  const titulo = tipos.filter((t) => t.uso === "titulo")[0] || tipos[0];
  const texto = tipos.filter((t) => t.uso === "texto")[0];
  const fontes: InsumosDaIdentidade["fontes"] = [];
  if (titulo && titulo.familia) fontes.push({ nome: linha(titulo.familia, 60), papel: "titulo" });
  if (texto && texto.familia) fontes.push({ nome: linha(texto.familia, 60), papel: "texto" });
  return {
    projeto_id: e.projetoId,
    paleta: arr(s.cores)
      .map(obj)
      .map((c) => ({ nome: linha(c.nome, 40), papel: linha(c.papel, 20), hex: normalizarHex(c.hex) || "" }))
      .filter((c) => c.hex)
      .slice(0, 8),
    fontes,
    logo_path: caminhoDaIdentidade(logo.previa_png || logo.caminho, e.clientId),
    grafismos: arr(s.grafismos).map((g) => caminhoDaIdentidade(obj(g).imagem, e.clientId)).filter((x): x is string => !!x).slice(0, 6),
    aplicacoes: arr(obj(d.aplicacoes).itens).map((a) => caminhoDaIdentidade(obj(a).imagem, e.clientId)).filter((x): x is string => !!x).slice(0, 8),
    tagline: linha(obj(d.naming).slogan, 120),
    tom: linha(est.tom.atributos.join(", "), 200),
    estrategia: linha(est.posicionamento.declaracao || est.proposito, 400),
  };
}

/**
 * O kit que a Mesa Motion usa quando o filme veio da Mesa Identidade: a
 * paleta, as fontes e a logo do projeto (conferidos: hex válido e caminho só
 * da pasta da marca do cliente). null = o filme não veio da identidade (fica
 * o kit da marca, como antes).
 */
export function kitDaIdentidade(insumos: unknown, clientId: string): { paleta: Array<{ hex: string; nome: string; papel: string }>; fontes: Array<{ nome: string; papel: string }>; logo_path: string | null } | null {
  const id = obj(obj(insumos).identidade);
  if (!Object.keys(id).length) return null;
  const paleta = arr(id.paleta)
    .map(obj)
    .map((c) => ({ hex: normalizarHex(c.hex) || "", nome: linha(c.nome, 40), papel: linha(c.papel, 20) }))
    .filter((c) => c.hex)
    .slice(0, 8);
  const fontes = arr(id.fontes)
    .map(obj)
    .map((f) => ({ nome: linha(f.nome, 60), papel: f.papel === "texto" ? "texto" : "titulo" }))
    .filter((f) => f.nome)
    .slice(0, 2);
  const logo_path = caminhoDaIdentidade(id.logo_path, clientId);
  if (!paleta.length && !fontes.length && !logo_path) return null;
  return { paleta, fontes, logo_path };
}

/** Tema de fundo que dá leitura à logo e ao texto (a primária escura pede fundo escuro da marca). */
export function temaDoFilme(cores: Array<{ hex?: unknown; papel?: unknown }>): "escuro" | "claro" {
  const primaria = cores.map((c) => normalizarHex(c.hex)).filter((h): h is string => !!h)[0];
  if (!primaria) return "escuro";
  return contraste(primaria, "#FFFFFF") >= 3 ? "escuro" : "claro";
}
