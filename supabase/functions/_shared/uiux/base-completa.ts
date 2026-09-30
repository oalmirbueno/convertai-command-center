/**
 * A base UI UX Pro Max inteira, para o SERVIDOR (frente UXM, 30/09/2026):
 * mesa-site, mesa-identidade, preencher-ia e o worker importam daqui. A tela
 * nunca importa este arquivo (ela carrega o índice leve sob demanda por
 * src/lib/uiux/carregar.ts).
 *
 * Aqui também moram as montagens que precisam dos dados: os itens citáveis de
 * um base_de_design (citar.ts dá o apelido), a parte do pacote do site que vai
 * ao motor e o apoio da paleta do setor.
 *
 * Sem Deno, sem banco. Sem travessão.
 */

import { ESTILOS_DA_BASE } from "./dados/estilos.ts";
import { PRODUTOS_DA_BASE } from "./dados/produtos.ts";
import { PALETAS_DA_BASE } from "./dados/paletas.ts";
import { RACIOCINIO_DA_BASE } from "./dados/raciocinio.ts";
import { PARES_DA_BASE } from "./dados/pares.ts";
import { FONTES_DA_BASE } from "./dados/fontes.ts";
import { PADROES_DA_BASE } from "./dados/landing.ts";
import { REGRAS_DE_UX_DA_BASE } from "./dados/ux.ts";
import {
  type BaseDeDesign,
  type BaseParaConsulta,
  consultaDaBase,
  graficoParaDados,
  produtoPorId,
  type SerieReal,
  VERSAO_DA_ESCOLHA,
  naoUsarParaDe,
  paletaDoSetor,
} from "./consultas.ts";
import { idDeCitacao, type ItemDaBase, type ItemSemApelido, numerarItens } from "./citar.ts";
import { modoDaRegra, REGRAS_DA_SECAO, REGRAS_DO_AGENTE, type TipoDoGrafico } from "./mapeamentos.ts";
import { REGRA_DE_UX_EM_PORTUGUES, rotuloDoEstilo, rotuloDoPadrao, rotuloDoProduto, severidadeDaRegra, type SeveridadeDaRegra } from "./pt.ts";
import { apoioDaPaleta, type ApoioDaPaleta, type CorDaMarcaParaApoio } from "./apoio-da-paleta.ts";

export const BASE_COMPLETA: BaseParaConsulta & {
  pares: typeof PARES_DA_BASE;
  paletas: typeof PALETAS_DA_BASE;
  fontes: typeof FONTES_DA_BASE;
  estilosCompletos: typeof ESTILOS_DA_BASE;
  produtosCompletos: typeof PRODUTOS_DA_BASE;
  raciocinioCompleto: typeof RACIOCINIO_DA_BASE;
  padroesCompletos: typeof PADROES_DA_BASE;
  uxCompleta: typeof REGRAS_DE_UX_DA_BASE;
} = {
  estilos: ESTILOS_DA_BASE,
  produtos: PRODUTOS_DA_BASE,
  raciocinio: RACIOCINIO_DA_BASE,
  padroes: PADROES_DA_BASE,
  paletas: PALETAS_DA_BASE,
  pares: PARES_DA_BASE,
  fontes: FONTES_DA_BASE,
  ux: REGRAS_DE_UX_DA_BASE,
  estilosCompletos: ESTILOS_DA_BASE,
  produtosCompletos: PRODUTOS_DA_BASE,
  raciocinioCompleto: RACIOCINIO_DA_BASE,
  padroesCompletos: PADROES_DA_BASE,
  uxCompleta: REGRAS_DE_UX_DA_BASE,
};

const corta = (s: unknown, n: number) => {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/[\s,;:]+$/, "")}…` : t;
};

const estiloCompleto = (id: string) => ESTILOS_DA_BASE.filter((e) => e.id === id)[0] || null;
const padraoCompleto = (id: string) => PADROES_DA_BASE.filter((p) => p.id === id)[0] || null;
const parCompleto = (no: string) => PARES_DA_BASE.filter((p) => p.no === no)[0] || null;
const regraCompleta = (no: string) => REGRAS_DE_UX_DA_BASE.filter((r) => r.no === no)[0] || null;

/** O nome em português que vai junto da escolha guardada (a tela mostra sem carregar a base). */
export function rotuloDaEscolha(tipo: "produto" | "estilo" | "padrao" | "par" | "paleta_setor", id: string): string {
  if (tipo === "produto" || tipo === "paleta_setor") {
    const p = produtoPorId(BASE_COMPLETA, id);
    return p ? rotuloDoProduto(p.no, p.nome) : id;
  }
  if (tipo === "estilo") {
    const e = estiloCompleto(id);
    return rotuloDoEstilo(id, e ? e.nome : id);
  }
  if (tipo === "padrao") {
    const x = padraoCompleto(id);
    return rotuloDoPadrao(id, x ? x.nome : id);
  }
  const par = parCompleto(id);
  return par ? `${par.nome}: ${par.titulo} + ${par.texto}` : id;
}

/** Põe o rótulo em cada escolha que existe. */
export function comRotulos<B extends Partial<Record<"produto" | "estilo" | "padrao" | "par" | "paleta_setor", { id: string; rotulo?: string } | null>>>(b: B): B {
  const saida = { ...b };
  for (const k of ["produto", "estilo", "padrao", "par", "paleta_setor"] as const) {
    const e = saida[k];
    if (e) (saida as Record<string, unknown>)[k] = { ...e, rotulo: rotuloDaEscolha(k, e.id) };
  }
  return saida;
}

/** Um item citável de uma regra de UX (texto nosso em português). */
export function itemDaRegra(no: string): ItemSemApelido | null {
  const r = regraCompleta(no);
  const pt = REGRA_DE_UX_EM_PORTUGUES[no];
  if (!r || !pt) return null;
  return { id: idDeCitacao("ux", no), tipo: "regra", rotulo: `${no}: ${pt.titulo.toLowerCase()}`, texto: `${pt.titulo}: ${pt.corrigir}` };
}

/**
 * Os itens citáveis de um base_de_design (na ordem: produto, estilo, padrão,
 * par, paleta do setor e as regras pedidas), já com os apelidos b1..bN.
 */
export function itensDaBaseDeDesign(b: Partial<BaseDeDesign> | null | undefined, extras: { regras?: string[]; paletaDoSetor?: string | null; comPar?: boolean; max?: number } = {}): ItemDaBase[] {
  const itens: ItemSemApelido[] = [];
  const produto = b && b.produto ? produtoPorId(BASE_COMPLETA, b.produto.id) : null;
  if (produto) {
    const r = RACIOCINIO_DA_BASE.filter((x) => x.no === produto.no)[0];
    itens.push({
      id: idDeCitacao("reasoning", produto.no),
      tipo: "produto",
      rotulo: rotuloDoProduto(produto.no, produto.nome),
      texto: `Tipo de produto: ${rotuloDoProduto(produto.no, produto.nome)} (${produto.nome}).${r ? ` Cor: ${corta(r.humorDeCor, 80)}. Evitar no setor: ${corta(r.antipadroes, 140)}.` : ""}`,
    });
  }
  const estilo = b && b.estilo ? estiloCompleto(b.estilo.id) : null;
  if (estilo) {
    const nao = naoUsarParaDe(estilo);
    itens.push({
      id: idDeCitacao("style", estilo.id),
      tipo: "estilo",
      rotulo: rotuloDoEstilo(estilo.id, estilo.nome),
      texto: `Estilo ${rotuloDoEstilo(estilo.id, estilo.nome)} (${estilo.nome}). Efeitos: ${corta(estilo.efeitos, 120)}.${nao ? ` Não usar para: ${corta(nao, 100)}.` : ""}`,
    });
  }
  const padrao = b && b.padrao ? padraoCompleto(b.padrao.id) : null;
  if (padrao) {
    itens.push({
      id: idDeCitacao("landing", padrao.id),
      tipo: "padrao",
      rotulo: rotuloDoPadrao(padrao.id, padrao.nome),
      texto: `Padrão ${rotuloDoPadrao(padrao.id, padrao.nome)}: ${corta(padrao.ordem, 140)}. CTA: ${corta(padrao.cta, 90)}.`,
    });
  }
  if (extras.comPar !== false && b && b.par) {
    const par = parCompleto(b.par.id);
    if (par) itens.push({ id: idDeCitacao("typography", par.no), tipo: "par", rotulo: `${par.nome} (${par.titulo} + ${par.texto})`, texto: `Par de fontes ${par.titulo} (títulos) + ${par.texto} (texto): ${corta(par.notas, 100)}` });
  }
  if (extras.paletaDoSetor) {
    const p = paletaDoSetor(BASE_COMPLETA, extras.paletaDoSetor);
    if (p) itens.push({ id: idDeCitacao("color", p.no), tipo: "paleta", rotulo: rotuloDoProduto(p.no, p.nome), texto: "Paleta de referência do setor: só neutros, erro e anel de foco completam a paleta da marca, com contraste conferido." });
  }
  for (const no of extras.regras || []) {
    const i = itemDaRegra(no);
    if (i) itens.push(i);
  }
  return numerarItens(itens, extras.max);
}

/** As regras de UX que valem para as seções do mapa: as do agente (layout vivo) e as ligadas a cada tipo de seção. */
export function regrasDoMapa(tipos: string[]): string[] {
  const saida = REGRAS_DO_AGENTE.slice();
  for (const t of tipos) for (const r of REGRAS_DA_SECAO[t] || []) if (saida.indexOf(r) < 0) saida.push(r);
  return saida;
}

// ------------------------------------------------------------------ o que vai ao motor

export type VarianteNoPacote = { id: string; rotulo: string; padrao: string; cta?: string; origem: string };

export type BaseNoPacote = {
  versao: typeof VERSAO_DA_ESCOLHA;
  /** Em inglês, dos nomes exatos da base: a busca do agente na skill usa isto (sem tradução). */
  consulta: string;
  produto?: { id: string; nome: string; rotulo: string };
  estilo?: { id: string; nome: string; rotulo: string; checklist: string; variaveis: string; efeitos: string; nao_usar_para: string };
  padrao?: { id: string; nome: string; rotulo: string; ordem: string; cta: string };
  par?: { titulo: string; texto: string; url: string; no: string };
  apoio?: Array<{ papel: string; hex: string; origem: string }>;
  variantes?: Record<string, VarianteNoPacote>;
  regras_ux: Array<{ id: string; severidade: SeveridadeDaRegra; titulo: string; modo: string }>;
  grafico?: { tipo: TipoDoGrafico; dados: SerieReal["pontos"]; fonte: string; regra: string } | null;
};

/**
 * A parte base_de_design do pacote do site. `apoio` vem calculado de fora
 * (quem chama tem a paleta da marca); `variantes` vem do mapa; `serie` é a
 * série real com fonte da seção de números (sem ela, sem gráfico).
 */
export function pacoteDaBaseDeDesign(
  b: BaseDeDesign | null,
  p: { tipos: string[]; variantes?: Record<string, VarianteNoPacote>; apoio?: ApoioDaPaleta | null; kitTemFontes: boolean; serie?: SerieReal | null },
): BaseNoPacote | null {
  const regras = regrasDoMapa(p.tipos).map((no) => {
    const r = regraCompleta(no);
    const pt = REGRA_DE_UX_EM_PORTUGUES[no];
    return r && pt ? { id: idDeCitacao("ux", no), severidade: severidadeDaRegra(r.severidade), titulo: pt.titulo, modo: modoDaRegra(no).modo } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (!b && !p.apoio && !regras.length) return null;
  const saida: BaseNoPacote = { versao: VERSAO_DA_ESCOLHA, consulta: b ? consultaDaBase(BASE_COMPLETA, b) : "", regras_ux: regras };
  const produto = b && b.produto ? produtoPorId(BASE_COMPLETA, b.produto.id) : null;
  if (produto) saida.produto = { id: idDeCitacao("product", produto.no), nome: produto.nome, rotulo: rotuloDoProduto(produto.no, produto.nome) };
  const estilo = b && b.estilo ? estiloCompleto(b.estilo.id) : null;
  if (estilo) {
    saida.estilo = { id: estilo.id, nome: estilo.nome, rotulo: rotuloDoEstilo(estilo.id, estilo.nome), checklist: corta(estilo.checklist, 400), variaveis: corta(estilo.variaveis, 300), efeitos: corta(estilo.efeitos, 240), nao_usar_para: corta(naoUsarParaDe(estilo), 200) };
  }
  const padrao = b && b.padrao ? padraoCompleto(b.padrao.id) : null;
  if (padrao) saida.padrao = { id: padrao.id, nome: padrao.nome, rotulo: rotuloDoPadrao(padrao.id, padrao.nome), ordem: padrao.ordem, cta: padrao.cta };
  if (!p.kitTemFontes && b && b.par) {
    const par = parCompleto(b.par.id);
    if (par) saida.par = { titulo: par.titulo, texto: par.texto, url: par.url, no: par.no };
  }
  if (p.apoio) saida.apoio = p.apoio.papeis.map((x) => ({ papel: x.papel, hex: x.hex, origem: x.origem }));
  if (p.variantes && Object.keys(p.variantes).length) saida.variantes = p.variantes;
  const g = graficoParaDados(p.serie || null);
  if (g && p.serie) saida.grafico = { tipo: g.tipo, dados: p.serie.pontos.slice(0, 12), fonte: String(p.serie.fonte).slice(0, 200), regra: idDeCitacao("chart", g.no) };
  return saida;
}

/**
 * O apoio da paleta com a paleta do setor do produto escolhido (null sem
 * produto). No site, `forcar` traz fundo, texto e destaque de coresDoSite: o
 * texto sobre o destaque, o destaque para texto e o anel saem do MESMO
 * destaque do --cor-destaque.
 */
export function apoioDoProduto(marca: CorDaMarcaParaApoio[], produtoNo: string | null, forcar: { fundo?: string | null; texto?: string | null; destaque?: string | null } = {}): ApoioDaPaleta | null {
  const setor = produtoNo ? paletaDoSetor(BASE_COMPLETA, produtoNo) : null;
  if (!marca.length && !setor) return null;
  return apoioDaPaleta({ marca, setor, fundo: forcar.fundo, texto: forcar.texto, destaque: forcar.destaque });
}
