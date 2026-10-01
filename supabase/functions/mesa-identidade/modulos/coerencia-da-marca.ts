/**
 * Coerência da marca (frente IDR, 30/09/2026). Dono: "deixe mais inteligente
 * o motor e mais organizado ali da identidade visual, mas curti o fluxo".
 *
 * Um fio só liga estratégia, nome, paleta, tipografia, tagline e logo:
 * - direção por arquétipo (cor e letra que cada um costuma pedir): entra nos
 *   pedidos de paleta, fontes e nomes, para as propostas nascerem coerentes;
 * - conferência por código (regras fixas: contraste, legibilidade, cor da
 *   logo na paleta, tamanho do nome, cor e letra contra a direção);
 * - conferência pelo Jev (Score por dimensão: o quanto cada peça expressa a
 *   estratégia; o código junta com pesos). É aviso: nada é trocado sozinho.
 *
 * Puro (sem Deno, sem banco): a função e a tela usam o mesmo arquivo.
 * Sem lookbehind, \p{} ou grupo nomeado (Safari 11). Sem travessão.
 */

import { ARQUETIPOS, type ArquetipoId, normalizarEstrategia } from "../../_shared/estrategia-de-marca.ts";
import { hexParaRgb, normalizarHex, rgbParaLab, deltaE } from "../../_shared/cores-da-marca.ts";
import { hexParaHsl } from "../../_shared/escala-da-cor.ts";
import { type CategoriaDaFonte, fonteDoCatalogo, ROTULO_DA_CATEGORIA } from "../../_shared/tipografia-da-marca.ts";
import { avisosDeContraste, nomeDaCor } from "./paleta-da-marca.ts";

/** O formato do Jev (o mesmo de _shared/jev.ts, que usa Deno e não entra na tela). */
type PerguntaJev = { type: "score"; instructions: string; criteria: string[] };
type RespostaJev = { score?: number; legend?: Record<string, unknown>; probabilities?: Record<string, number> };

// ------------------------------------------------------------------ direção por arquétipo

type Temperatura = "quente" | "fria" | "livre";
type Nivel = "alta" | "media" | "baixa" | "livre";
type Luz = "clara" | "escura" | "livre";

export type DirecaoDoArquetipo = {
  cor: { temperatura: Temperatura; saturacao: Nivel; luz: Luz; ideia: string };
  letra: { preferidas: CategoriaDaFonte[]; evitar: CategoriaDaFonte[]; ideia: string };
  nome: string;
};

/** O que cada arquétipo costuma pedir (ponto de partida da direção de arte, não regra dura). */
export const DIRECAO_DO_ARQUETIPO: Record<ArquetipoId, DirecaoDoArquetipo> = {
  inocente: { cor: { temperatura: "livre", saturacao: "baixa", luz: "clara", ideia: "tons claros e limpos, pastéis, muito respiro" }, letra: { preferidas: ["sem_serifa"], evitar: ["mono", "display"], ideia: "sem serifa arredondada e leve" }, nome: "simples, suave, fácil de dizer" },
  explorador: { cor: { temperatura: "quente", saturacao: "media", luz: "livre", ideia: "terrosos e naturais, verdes de mata, laranja de trilha" }, letra: { preferidas: ["sem_serifa", "display"], evitar: ["manuscrita"], ideia: "sem serifa robusta ou condensada, com peso" }, nome: "curto, com movimento e horizonte" },
  sabio: { cor: { temperatura: "fria", saturacao: "baixa", luz: "livre", ideia: "azuis e neutros sóbrios, poucos acentos" }, letra: { preferidas: ["serifada", "sem_serifa"], evitar: ["manuscrita", "display"], ideia: "serifada de leitura ou sem serifa racional" }, nome: "claro, com credibilidade, sem gíria" },
  heroi: { cor: { temperatura: "livre", saturacao: "alta", luz: "escura", ideia: "contraste forte, vermelho ou azul intenso sobre escuro" }, letra: { preferidas: ["sem_serifa", "display"], evitar: ["manuscrita"], ideia: "sem serifa pesada, maiúsculas firmes" }, nome: "forte, curto, de ação" },
  fora_da_lei: { cor: { temperatura: "livre", saturacao: "alta", luz: "escura", ideia: "preto com um acento agressivo" }, letra: { preferidas: ["display", "sem_serifa", "mono"], evitar: [], ideia: "condensada, crua, com atitude" }, nome: "provocador, quebra a regra da categoria" },
  mago: { cor: { temperatura: "fria", saturacao: "alta", luz: "escura", ideia: "roxos, azuis profundos, brilho pontual" }, letra: { preferidas: ["display", "serifada"], evitar: ["mono"], ideia: "elegante e com um detalhe de encanto" }, nome: "evocativo, com mistério" },
  cara_comum: { cor: { temperatura: "quente", saturacao: "media", luz: "clara", ideia: "cores do dia a dia, sem luxo, amigáveis" }, letra: { preferidas: ["sem_serifa"], evitar: ["manuscrita", "display"], ideia: "sem serifa aberta e honesta" }, nome: "direto, sem pose, do bairro" },
  amante: { cor: { temperatura: "quente", saturacao: "media", luz: "escura", ideia: "vinhos, rosas, dourado, tons de pele" }, letra: { preferidas: ["serifada", "manuscrita"], evitar: ["mono"], ideia: "serifada de alto contraste ou script elegante" }, nome: "sensorial, com som bonito" },
  bobo_da_corte: { cor: { temperatura: "quente", saturacao: "alta", luz: "clara", ideia: "cores vivas e alegres, combinações inesperadas" }, letra: { preferidas: ["display", "sem_serifa"], evitar: ["serifada"], ideia: "arredondada, gorda, divertida" }, nome: "brincalhão, com ritmo" },
  cuidador: { cor: { temperatura: "livre", saturacao: "baixa", luz: "clara", ideia: "verdes e azuis suaves, tons quentes calmos" }, letra: { preferidas: ["sem_serifa", "serifada"], evitar: ["display", "mono"], ideia: "humanista, macia, legível" }, nome: "acolhedor, que soa como cuidado" },
  criador: { cor: { temperatura: "livre", saturacao: "alta", luz: "livre", ideia: "paleta autoral, com um contraste que surpreende" }, letra: { preferidas: ["display", "serifada", "sem_serifa"], evitar: [], ideia: "editorial ou com um desenho próprio" }, nome: "inventivo, com assinatura" },
  governante: { cor: { temperatura: "fria", saturacao: "baixa", luz: "escura", ideia: "azul-marinho, preto, grafite e um dourado contido" }, letra: { preferidas: ["serifada", "sem_serifa"], evitar: ["manuscrita", "display"], ideia: "serifada clássica ou sem serifa geométrica sóbria" }, nome: "sóbrio, com peso de instituição" },
};

export function direcaoDoArquetipo(arquetipo: unknown): DirecaoDoArquetipo | null {
  return typeof arquetipo === "string" && Object.prototype.hasOwnProperty.call(DIRECAO_DO_ARQUETIPO, arquetipo) ? DIRECAO_DO_ARQUETIPO[arquetipo as ArquetipoId] : null;
}

// ------------------------------------------------------------------ o que o projeto tem

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown, max = 240) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

export type CorDoSistema = { nome: string; hex: string; papel: string };
export type FonteDoSistema = { familia: string; uso: string; categoria: CategoriaDaFonte | null };

/** A marca como ela está no projeto, num formato só (a tela, a função e o Jev leem daqui). */
export function fioDaMarca(dados: Record<string, unknown>) {
  const est = normalizarEstrategia(dados.estrategia);
  const naming = obj(dados.naming);
  const sistema = obj(dados.sistema);
  const leitura = obj(dados.leitura_da_logo);
  const visao = obj(leitura.visao);
  const cores: CorDoSistema[] = arr(sistema.cores)
    .map(obj)
    .map((c) => ({ nome: txt(c.nome, 40), hex: normalizarHex(c.hex) || "", papel: txt(c.papel, 20) || "secundaria" }))
    .filter((c) => c.hex);
  const fontes: FonteDoSistema[] = arr(sistema.tipografia)
    .map(obj)
    .filter((t) => txt(t.familia))
    .map((t) => {
      const cat = fonteDoCatalogo(txt(t.familia, 60));
      return { familia: txt(t.familia, 60), uso: txt(t.uso, 20) || "titulo", categoria: cat ? cat.categoria : null };
    });
  const arq = ARQUETIPOS.filter((a) => a.valor === est.arquetipo.principal)[0] || null;
  return {
    nome: txt(naming.nome, 80),
    tagline: txt(naming.slogan, 160),
    arquetipo: arq ? { id: arq.valor, rotulo: arq.rotulo, desejo: arq.desejo, voz: arq.voz } : null,
    secundario: est.arquetipo.secundario || "",
    tracos: est.personalidade.tracos.slice(0, 6),
    tom: est.tom.atributos.slice(0, 6),
    posicionamento: est.posicionamento.declaracao || est.posicionamento.diferencial || "",
    publico: est.publico.resumo || est.posicionamento.publico || "",
    proposito: est.proposito,
    cores,
    fontes,
    logo: {
      cores: arr(leitura.cores).map(obj).map((c) => normalizarHex(c.hex)).filter((h): h is string => !!h).slice(0, 4),
      estilo: txt(visao.estilo, 200),
      forma: txt(visao.forma, 200),
    },
  };
}
export type FioDaMarca = ReturnType<typeof fioDaMarca>;

// ------------------------------------------------------------------ perfil da paleta

export type PerfilDaPaleta = { temperatura: "quente" | "fria" | "neutra"; saturacao: "alta" | "media" | "baixa"; luz: "clara" | "escura" | "media"; texto: string };

/** Temperatura, saturação e luz das cores com cor (as neutras não contam). Null sem cor. */
export function perfilDaPaleta(cores: Array<{ hex: string; papel?: string }>): PerfilDaPaleta | null {
  const hsl = cores.filter((c) => c.papel !== "neutra" && normalizarHex(c.hex)).map((c) => hexParaHsl(c.hex)).filter((c) => c.s >= 12);
  if (!hsl.length) return null;
  const quentes = hsl.filter((c) => c.h < 70 || c.h >= 330).length;
  const frias = hsl.filter((c) => c.h >= 160 && c.h < 300).length;
  const sat = hsl.reduce((s, c) => s + c.s, 0) / hsl.length;
  const luz = hsl.reduce((s, c) => s + c.l, 0) / hsl.length;
  const temperatura = quentes >= hsl.length * 0.6 ? "quente" : frias >= hsl.length * 0.6 ? "fria" : "neutra";
  const saturacao = sat >= 65 ? "alta" : sat >= 35 ? "media" : "baixa";
  const l = luz >= 62 ? "clara" : luz <= 38 ? "escura" : "media";
  return { temperatura, saturacao, luz: l, texto: `cores ${temperatura === "neutra" ? "entre quentes e frias" : temperatura + "s"}, saturação ${saturacao}, ${l === "media" ? "luz média" : l + "s"}` };
}

// ------------------------------------------------------------------ conferência por código

export type Dimensao = "estrategia" | "nome" | "paleta" | "tipografia" | "tagline" | "conjunto";
export type Situacao = "ok" | "atencao" | "falta";
export type ItemDaCoerencia = { dimensao: Dimensao; rotulo: string; situacao: Situacao; motivos: string[]; etapa: "estrategia" | "naming" | "sistema"; nota_jev: number | null };
export type Coerencia = { nota: number | null; itens: ItemDaCoerencia[]; jev: boolean; aviso: string | null; em: string };

export const ROTULO_DA_DIMENSAO: Record<Dimensao, string> = { estrategia: "Estratégia", nome: "Nome", paleta: "Paleta", tipografia: "Tipografia", tagline: "Tagline", conjunto: "Conjunto" };
const ETAPA_DA_DIMENSAO: Record<Dimensao, ItemDaCoerencia["etapa"]> = { estrategia: "estrategia", nome: "naming", paleta: "sistema", tipografia: "sistema", tagline: "naming", conjunto: "sistema" };

function item(dimensao: Dimensao, motivos: string[], falta = false): ItemDaCoerencia {
  return { dimensao, rotulo: ROTULO_DA_DIMENSAO[dimensao], situacao: falta ? "falta" : motivos.length ? "atencao" : "ok", motivos, etapa: ETAPA_DA_DIMENSAO[dimensao], nota_jev: null };
}

/** As regras fixas (sem IA): o que falta e o que destoa da direção do arquétipo. */
export function conferirPorCodigo(f: FioDaMarca): ItemDaCoerencia[] {
  const itens: ItemDaCoerencia[] = [];
  const dir = f.arquetipo ? DIRECAO_DO_ARQUETIPO[f.arquetipo.id as ArquetipoId] : null;
  const falta: string[] = [];
  if (!f.arquetipo) falta.push("Sem arquétipo: a direção de cor e de letra fica sem base.");
  if (!f.posicionamento) falta.push("Sem posicionamento: o nome e a tagline ficam sem contra o que conferir.");
  if (!f.tom.length) falta.push("Sem atributos de tom.");
  itens.push(item("estrategia", falta, !f.arquetipo && !f.posicionamento));

  const nome: string[] = [];
  if (f.nome) {
    const palavras = f.nome.split(/\s+/).filter(Boolean).length;
    if (palavras > 3 || f.nome.length > 22) nome.push("Nome longo: acima de 3 palavras ou 22 letras pesa na logo, no @ e no domínio.");
  }
  itens.push(item("nome", nome, !f.nome));

  const paleta: string[] = [];
  if (f.cores.length) {
    if (!f.cores.some((c) => c.papel === "primaria")) paleta.push("Nenhuma cor marcada como primária.");
    if (!f.cores.some((c) => c.papel === "neutra")) paleta.push("Sem neutra para fundo e texto: o sistema fica sem descanso.");
    paleta.push(...avisosDeContraste(f.cores.map((c) => ({ nome: c.nome, papel: c.papel as "primaria", hex: c.hex }))).slice(0, 2));
    const p = perfilDaPaleta(f.cores);
    if (dir && p) {
      if (dir.cor.temperatura !== "livre" && p.temperatura !== "neutra" && p.temperatura !== dir.cor.temperatura) paleta.push(`A paleta é ${p.temperatura}; o arquétipo ${f.arquetipo!.rotulo} costuma pedir ${dir.cor.ideia}.`);
      if (dir.cor.saturacao !== "livre" && ((dir.cor.saturacao === "alta" && p.saturacao === "baixa") || (dir.cor.saturacao === "baixa" && p.saturacao === "alta"))) paleta.push(`Saturação ${p.saturacao} contra a direção do ${f.arquetipo!.rotulo} (${dir.cor.ideia}).`);
    }
    // Marca existente: a cor principal da logo precisa estar na paleta (a logo não muda).
    if (f.logo.cores.length) {
      const principal = rgbParaLab(hexParaRgb(f.logo.cores[0]));
      const perto = f.cores.some((c) => deltaE(principal, rgbParaLab(hexParaRgb(c.hex))) <= 12);
      if (!perto) paleta.push(`A cor principal da logo (${f.logo.cores[0]}, ${nomeDaCor(f.logo.cores[0])}) não está na paleta.`);
    }
  }
  itens.push(item("paleta", paleta, f.cores.length < 2));

  const letra: string[] = [];
  if (f.fontes.length) {
    const texto = f.fontes.filter((t) => t.uso === "texto")[0];
    if (texto && (texto.categoria === "display" || texto.categoria === "manuscrita")) letra.push(`${texto.familia} é ${ROTULO_DA_CATEGORIA[texto.categoria].toLowerCase()}: texto corrido pede uma família de leitura.`);
    if (f.fontes.length > 3) letra.push("Mais de 3 famílias: o sistema perde unidade.");
    if (dir) {
      const contra = f.fontes.filter((t) => t.categoria && dir.letra.evitar.indexOf(t.categoria) >= 0);
      if (contra.length) letra.push(`${contra.map((t) => t.familia).join(" e ")} (${contra.map((t) => ROTULO_DA_CATEGORIA[t.categoria as CategoriaDaFonte].toLowerCase()).join(", ")}) destoa do ${f.arquetipo!.rotulo}, que pede ${dir.letra.ideia}.`);
    }
  }
  itens.push(item("tipografia", letra, !f.fontes.length));

  const tag: string[] = [];
  if (f.tagline && f.tagline.split(/\s+/).filter(Boolean).length > 8) tag.push("Tagline longa: acima de 8 palavras vira frase de campanha, não assinatura.");
  itens.push(item("tagline", tag, !f.tagline));
  return itens;
}

// ------------------------------------------------------------------ Jev

/** Níveis de encaixe (do pior para o melhor), situações concretas. */
function niveis(peca: string): string[] {
  return [
    `${peca} contradiz a estratégia: parece de outra marca, outro público ou outro tom`,
    `${peca} é neutro: não contradiz, mas não expressa nada da estratégia`,
    `${peca} combina em parte: um traço da estratégia aparece e outro destoa`,
    `${peca} combina bem: soa como o arquétipo, o tom e o público pedem`,
    `${peca} é a estratégia em forma: quem conhece o posicionamento reconhece na hora`,
  ];
}

/** O estado que o Jev lê (palavras, não só hex: cor com nome e perfil, letra com categoria). */
export function estadoParaOJev(f: FioDaMarca): Record<string, unknown> {
  const p = perfilDaPaleta(f.cores);
  return {
    estrategia: { arquetipo: f.arquetipo ? `${f.arquetipo.rotulo}: ${f.arquetipo.desejo}; voz ${f.arquetipo.voz}` : null, tracos: f.tracos, tom: f.tom, posicionamento: f.posicionamento || null, publico: f.publico || null, proposito: f.proposito || null },
    identidade: {
      nome: f.nome || null,
      tagline: f.tagline || null,
      paleta: f.cores.map((c) => `${c.nome || nomeDaCor(c.hex)} (${nomeDaCor(c.hex)}, ${c.papel})`),
      perfil_da_paleta: p ? p.texto : null,
      tipografia: f.fontes.map((t) => `${t.familia} para ${t.uso}${t.categoria ? `, ${ROTULO_DA_CATEGORIA[t.categoria].toLowerCase()}` : ""}`),
      logo: f.logo.estilo || f.logo.forma ? `${f.logo.forma} ${f.logo.estilo}`.trim() : null,
    },
  };
}

/** As perguntas das dimensões que existem (uma chamada só; o Jev responde em paralelo). */
export function perguntasDaCoerencia(f: FioDaMarca): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  const base = "a estratégia em `estrategia` (arquétipo, traços, tom, posicionamento e público)";
  if (f.nome) q.nome = { type: "score", instructions: `Avalie o quanto o nome em \`identidade.nome\` expressa ${base}: som, sentido e o que ele promete.`, criteria: niveis("O nome") };
  if (f.cores.length >= 2) q.paleta = { type: "score", instructions: `Avalie o quanto a paleta em \`identidade.paleta\` (com o perfil em \`identidade.perfil_da_paleta\`) expressa ${base}: temperatura, energia e o que as cores fazem sentir.`, criteria: niveis("A paleta") };
  if (f.fontes.length) q.tipografia = { type: "score", instructions: `Avalie o quanto a tipografia em \`identidade.tipografia\` expressa ${base}: a voz que as letras dão à marca.`, criteria: niveis("A tipografia") };
  if (f.tagline) q.tagline = { type: "score", instructions: `Avalie o quanto a tagline em \`identidade.tagline\` expressa ${base}, com clareza em português e sem promessa vazia.`, criteria: niveis("A tagline") };
  if (Object.keys(q).length >= 2) q.conjunto = { type: "score", instructions: `Avalie se nome, tagline, paleta, tipografia e logo em \`identidade\` contam UMA história só, coerente com ${base}, ou se cada peça puxa para um lado.`, criteria: niveis("O conjunto") };
  return q;
}

/** Nota de 0 a 1 de um Score (pelos níveis da legenda; sem ela, 0 a n-1). */
export function notaDaResposta(r: RespostaJev | undefined, nNiveis = 5): number | null {
  if (!r || typeof r.score !== "number" || !isFinite(r.score)) return null;
  const chaves = Object.keys(r.legend || r.probabilities || {}).map(Number).filter((n) => isFinite(n));
  const min = chaves.length ? Math.min.apply(null, chaves) : 0;
  const max = chaves.length ? Math.max.apply(null, chaves) : nNiveis - 1;
  if (max <= min) return null;
  return Math.max(0, Math.min(1, (r.score - min) / (max - min)));
}

const PESOS: Record<Dimensao, number> = { estrategia: 0, nome: 0.25, paleta: 0.25, tipografia: 0.2, tagline: 0.1, conjunto: 0.2 };
/** Abaixo disso o Jev vê pouca ligação com a estratégia (aviso). */
export const NOTA_DE_ATENCAO = 0.45;

/** Junta o código e o Jev: nota 0 a 100 (pesos no código) e o motivo de cada aviso. */
export function juntarCoerencia(codigo: ItemDaCoerencia[], respostas: Record<string, RespostaJev> | null, agora = new Date().toISOString(), aviso: string | null = null): Coerencia {
  const itens = codigo.map((i) => ({ ...i, motivos: i.motivos.slice() }));
  let soma = 0, peso = 0;
  if (respostas) {
    const dims: Dimensao[] = ["nome", "paleta", "tipografia", "tagline", "conjunto"];
    for (const d of dims) {
      const n = notaDaResposta(respostas[d]);
      if (n === null) continue;
      let alvo = itens.filter((i) => i.dimensao === d)[0];
      if (!alvo) {
        alvo = item(d, []);
        itens.push(alvo);
      }
      alvo.nota_jev = Math.round(n * 100) / 100;
      if (n < NOTA_DE_ATENCAO) {
        alvo.motivos.push(`O Jev vê pouca ligação com a estratégia (nota ${Math.round(n * 100)} de 100).`);
        if (alvo.situacao === "ok") alvo.situacao = "atencao";
      }
      soma += n * PESOS[d];
      peso += PESOS[d];
    }
  }
  return { nota: peso ? Math.round((soma / peso) * 100) : null, itens, jev: peso > 0, aviso, em: agora };
}

/** A direção que vai no pedido de paleta, fontes e nomes (texto curto). */
export function direcaoParaPrompt(f: FioDaMarca): Record<string, unknown> | null {
  if (!f.arquetipo) return null;
  const d = DIRECAO_DO_ARQUETIPO[f.arquetipo.id as ArquetipoId];
  return {
    arquetipo: f.arquetipo.rotulo,
    cor: `${d.cor.ideia} (temperatura ${d.cor.temperatura}, saturação ${d.cor.saturacao}, luz ${d.cor.luz})`,
    letra: `${d.letra.ideia}; evitar ${d.letra.evitar.map((c) => ROTULO_DA_CATEGORIA[c].toLowerCase()).join(", ") || "nada fixo"}`,
    nome: d.nome,
    ja_decidido: { nome: f.nome || null, tagline: f.tagline || null, cores_da_logo: f.logo.cores, paleta: f.cores.map((c) => `${c.hex} ${c.papel}`), fontes: f.fontes.map((t) => `${t.familia} ${t.uso}`) },
  };
}
