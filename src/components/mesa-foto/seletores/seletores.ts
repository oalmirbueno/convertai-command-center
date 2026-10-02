import type { DadosDoNo } from "../canvasApi";
import type { Clone } from "../clonesApi";
import { TIPOS_DE_KIT, type FotoDoAcervo, type KitDeFoto } from "../fotoApi";
import type { Persona } from "../modelosApi";

/**
 * Seletores da Mesa Foto (02/10/2026; dono: "preciso de um seletor de
 * modelos e de um seletor de imagens, inclusive das editadas; mesma lógica
 * para tudo: fotos, produtos e artes; tudo sincronizado para preparar imagem
 * para os vídeos e os outros motores"). Regras fixas, sem React: a tela
 * (SeletorDeImagens, SeletorDeModelo, Preparar imagens), o Canvas e os
 * testes usam as mesmas.
 *
 * Tudo vem do acervo único do cliente (cliente_imagens), que a Mesa, a Mesa
 * Vídeos, a Mesa Motion e o Estúdio já leem: a imagem editada aqui aparece lá
 * sem cópia nenhuma.
 */

// ------------------------------------------------------------------ imagens

export type FiltroDeImagens = "todas" | "produtos" | "artes" | "editadas" | "originais" | "geradas";

export const FILTROS_DE_IMAGENS: { valor: FiltroDeImagens; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "produtos", rotulo: "Produtos" },
  { valor: "artes", rotulo: "Artes" },
  { valor: "editadas", rotulo: "Editadas" },
  { valor: "originais", rotulo: "Originais" },
  { valor: "geradas", rotulo: "Geradas" },
];

const temTag = (f: Pick<FotoDoAcervo, "tags">, t: string) => (f.tags || []).some((x) => x === t || x.indexOf(`${t}:`) === 0);

/** Editada: versão nova de outra foto (preparo, ampliar, tirar fundo, Estúdio). */
export function ehEditada(f: Pick<FotoDoAcervo, "derivada_de" | "tags" | "modo">): boolean {
  if (f.modo === "clone" || f.modo === "ensaio") return false;
  return !!f.derivada_de || temTag(f, "preparo") || temTag(f, "upscale") || temTag(f, "sem_fundo");
}

/** Arte: categoria arte ou etiqueta de arte e carrossel. */
export function ehArte(f: Pick<FotoDoAcervo, "categoria" | "tags">): boolean {
  return f.categoria === "arte" || temTag(f, "arte") || temTag(f, "carrossel");
}

/** Gerada por IA (selo "gerada"). */
export function ehGerada(f: Pick<FotoDoAcervo, "gerada" | "modo">): boolean {
  return !!f.gerada || f.modo === "angulo" || f.modo === "ensaio" || f.modo === "canvas" || f.modo === "clone";
}

/** Ids das fotos que são referência de algum produto (kit). */
export function idsDosProdutos(kits: Pick<KitDeFoto, "frente_imagem_id" | "refs" | "tipo">[]): string[] {
  const ids: string[] = [];
  kits.forEach((k) => {
    if (k.tipo === "pessoa") return;
    if (k.frente_imagem_id && ids.indexOf(k.frente_imagem_id) < 0) ids.push(k.frente_imagem_id);
    (k.refs || []).forEach((r) => {
      if (r.imagem_id && ids.indexOf(r.imagem_id) < 0) ids.push(r.imagem_id);
    });
  });
  return ids;
}

/** Foto do produto: categoria produto, ligada a um kit ou referência de um kit. */
export function ehDeProduto(f: Pick<FotoDoAcervo, "id" | "categoria" | "kit_id">, idsDeProdutos: string[]): boolean {
  return f.categoria === "produto" || !!f.kit_id || idsDeProdutos.indexOf(f.id) >= 0;
}

const semAcento = (t: string) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * As imagens que o seletor mostra: só as ativas (arquivada fica de fora) e
 * nunca a referência da internet (uso interno); o filtro e a busca pelo nome,
 * pasta, categoria e etiquetas. Mais novas primeiro (a ordem do acervo).
 */
export function filtrarImagens(fotos: FotoDoAcervo[], filtro: FiltroDeImagens, busca = "", kits: Pick<KitDeFoto, "frente_imagem_id" | "refs" | "tipo">[] = []): FotoDoAcervo[] {
  const termo = semAcento(busca.trim());
  const deProdutos = filtro === "produtos" ? idsDosProdutos(kits) : [];
  return fotos.filter((f) => {
    if (f.ativa === false || f.referencia_web) return false;
    if (filtro === "produtos" && !ehDeProduto(f, deProdutos)) return false;
    if (filtro === "artes" && !ehArte(f)) return false;
    if (filtro === "editadas" && !ehEditada(f)) return false;
    if (filtro === "originais" && (ehEditada(f) || ehGerada(f))) return false;
    if (filtro === "geradas" && !ehGerada(f)) return false;
    if (!termo) return true;
    return semAcento([f.nome, f.pasta || "", f.categoria || "", (f.tags || []).join(" "), f.descricao || ""].join(" ")).indexOf(termo) >= 0;
  });
}

// ------------------------------------------------------------------ produtos (catálogo por departamento)

export interface DepartamentoDeProdutos {
  tipo: string;
  rotulo: string;
  kits: KitDeFoto[];
}

/**
 * Os produtos do cliente como catálogo: agrupados por departamento (o tipo do
 * produto: Moda, Cosmético, Alimento...), em ordem de nome, sem pessoa e sem
 * arquivado, com busca pelo nome e pela variante.
 */
export function produtosPorDepartamento(kits: KitDeFoto[], busca = ""): DepartamentoDeProdutos[] {
  const termo = semAcento(busca.trim());
  const validos = kits.filter((k) => !!k.id && k.tipo !== "pessoa" && k.status !== "arquivado" && (!termo || semAcento(`${k.nome} ${k.variante || ""}`).indexOf(termo) >= 0));
  const saida: DepartamentoDeProdutos[] = [];
  TIPOS_DE_KIT.forEach((t) => {
    if (t.valor === "pessoa") return;
    const doTipo = validos.filter((k) => k.tipo === t.valor).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (doTipo.length) saida.push({ tipo: t.valor, rotulo: t.rotulo, kits: doTipo });
  });
  const semTipo = validos.filter((k) => !TIPOS_DE_KIT.some((t) => t.valor === k.tipo));
  if (semTipo.length) saida.push({ tipo: "outro", rotulo: "Sem departamento", kits: semTipo.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) });
  return saida;
}

/** A foto de capa do produto (a frente ou a primeira referência). */
export const capaDoProduto = (k: Pick<KitDeFoto, "frente_imagem_id" | "refs">): string | null => k.frente_imagem_id || (k.refs && k.refs[0] ? k.refs[0].imagem_id : null) || null;

/** O produto que usa esta foto como referência (ou null). */
export function produtoDaFoto(kits: KitDeFoto[], imagemId: string): KitDeFoto | null {
  return kits.find((k) => k.status !== "arquivado" && (k.frente_imagem_id === imagemId || (k.refs || []).some((r) => r.imagem_id === imagemId))) || null;
}

// ------------------------------------------------------------------ modelos e clones

export interface OpcaoDeModelo {
  /** "persona:<id>" ou "clone:<id>". */
  chave: string;
  tipo: "persona" | "clone";
  id: string;
  nome: string;
  /** Pode ir para a foto agora. */
  pronto: boolean;
  /** Por que ainda não (sem âncora, autorização vencida...). */
  motivo: string | null;
  /** Persona: a âncora (foto_modelo_imagens). */
  ancora_imagem_id: string | null;
  versao: number | null;
  /** Clone: a capa assinada e a foto real principal (acervo). */
  capa_url: string | null;
  imagem_id: string | null;
  /** Persona da agência (serve para qualquer cliente). */
  da_agencia: boolean;
}

/**
 * Modelos sintéticas (personas do cliente e da agência) e clones de pessoa
 * real com autorização, numa lista só: as prontas primeiro, depois pelo
 * nome. Arquivada fica de fora.
 */
export function modelosParaEscolher(personas: Persona[], clones: Clone[]): OpcaoDeModelo[] {
  const saida: OpcaoDeModelo[] = [];
  personas.forEach((p) => {
    if (!p || !p.id || p.status === "arquivada") return;
    const semAncora = p.status === "rascunho" || p.status === "candidatos";
    saida.push({
      chave: `persona:${p.id}`,
      tipo: "persona",
      id: p.id,
      nome: p.nome || "Modelo",
      pronto: !semAncora,
      motivo: semAncora ? "Sem âncora: termine em Modelos" : null,
      ancora_imagem_id: p.ancora_imagem_id,
      versao: p.versao || null,
      capa_url: null,
      imagem_id: null,
      da_agencia: !p.client_id,
    });
  });
  clones.forEach((c) => {
    if (!c || !c.id || c.status === "arquivada") return;
    const real = c.identidade_real || [];
    const principal = (real.find((r) => r.principal) || real[0] || { imagem_id: null }).imagem_id || null;
    const autorizado = !!(c.autorizacao_valida && c.autorizacao_valida.ok);
    saida.push({
      chave: `clone:${c.id}`,
      tipo: "clone",
      id: c.id,
      nome: c.nome || "Clone",
      pronto: autorizado && !!principal,
      motivo: !autorizado ? (c.autorizacao_valida && c.autorizacao_valida.motivo) || "Sem autorização válida" : !principal ? "Sem foto da pessoa" : null,
      ancora_imagem_id: c.ancora_imagem_id,
      versao: c.versao || null,
      capa_url: c.capa_url,
      imagem_id: principal,
      da_agencia: false,
    });
  });
  return saida.sort((a, b) => (a.pronto !== b.pronto ? (a.pronto ? -1 : 1) : a.nome.localeCompare(b.nome, "pt-BR")));
}

/** O cartão Pessoa do Canvas para o modelo escolhido (clone vai como foto real autorizada). */
export function dadosDaPessoa(o: OpcaoDeModelo): DadosDoNo {
  if (o.tipo === "persona") return { modelo_id: o.id, versao: o.versao, imagem_id: null, autorizada: false, titulo: o.nome };
  return { modelo_id: null, versao: null, imagem_id: o.imagem_id, autorizada: o.pronto, titulo: o.nome };
}

/** Rótulo curto do tipo. */
export const rotuloDoModelo = (o: Pick<OpcaoDeModelo, "tipo" | "da_agencia">) => (o.tipo === "clone" ? "Clone, pessoa real" : o.da_agencia ? "Modelo da agência" : "Modelo da IA");
