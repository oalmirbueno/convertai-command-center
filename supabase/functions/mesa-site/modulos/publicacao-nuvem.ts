/**
 * Prévia na nuvem e publicação por versão (20/10/2026, decisão do dono: "use
 * a Vercel da agência"). Regras puras, lidas pela tela, pela função
 * mesa-site, pelo worker e pelos testes.
 *
 * - Prévia na nuvem: cada versão salva (e o rascunho, quando pedido) vira um
 *   deploy de prévia na Vercel, com endereço próprio. O link fica no
 *   resultado do trabalho que o fez (motor_trabalhos.resultado.previa_nuvem),
 *   com o commit, as páginas e o mapa de arquivos (caminho -> sha1).
 * - Publicar: compara o que vai subir com o que está no ar (páginas que
 *   entram, que mudam e que saem do ar) pelo mapa de arquivos; publica só a
 *   versão salva que a tela mostrou (se outra foi salva no meio, recusa).
 *
 * Sem regex com lookbehind, \p{} ou grupo nomeado (piso do Safari 11).
 */

import type { TrabalhoDoMotor } from "../../_shared/motor-codigo.ts";

type TrabalhoLido = Pick<TrabalhoDoMotor, "id" | "tipo" | "estado" | "resultado"> & { commit?: string | null; terminado_em?: string | null; criado_em?: string };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const texto = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");

export type MapaDeArquivos = Record<string, string>;

export type PreviaNaNuvem = {
  url: string;
  deploy_id: string;
  projeto_vercel: string;
  commit: string;
  ramo: "main" | "rascunho";
  paginas: string[];
  arquivos: MapaDeArquivos;
  em: string;
  /** "ligada": a Vercel não deixou desligar o login nas prévias (o link pede conta na Vercel). */
  protecao: "desligada" | "ligada" | null;
};

/** Nome do projeto na Vercel (minúsculo, letras, números e hífen; até 100). Um projeto por site. */
export function nomeNaVercel(projeto: string): string {
  const s = String(projeto || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 90);
  return s || "site";
}

/** Endereço fixo da prévia de uma versão: <projeto>-v<commit 8>.vercel.app (rótulo de até 63). */
export function apelidoDaPrevia(nome: string, commit: string): string {
  const c = String(commit || "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 8) || "0";
  const base = nomeNaVercel(nome).slice(0, 63 - c.length - 2).replace(/-+$/, "");
  return `${base}-v${c}.vercel.app`;
}

/** As páginas do site pelo mapa de arquivos: index.html vira "/", obrigado/index.html vira "/obrigado/". */
export function paginasDosArquivos(arquivos: MapaDeArquivos | string[]): string[] {
  const nomes = Array.isArray(arquivos) ? arquivos : Object.keys(arquivos);
  const paginas: string[] = [];
  for (const n of nomes) {
    const c = String(n).split("\\").join("/").replace(/^\/+/, "");
    if (c === "index.html") paginas.push("/");
    else if (c.slice(-11) === "/index.html") paginas.push(`/${c.slice(0, -10)}`);
  }
  return paginas.sort(ordemDasPaginas);
}

const ordemDasPaginas = (a: string, b: string) => (a === "/" ? -1 : b === "/" ? 1 : a < b ? -1 : a > b ? 1 : 0);

/** O arquivo HTML de uma página ("/" -> index.html, "/obrigado/" -> obrigado/index.html). */
export const arquivoDaPagina = (p: string) => (p === "/" ? "index.html" : `${p.replace(/^\/+/, "").replace(/\/+$/, "")}/index.html`);

/** As páginas pelo mapa do site (slug), quando a versão ainda não tem a prévia na nuvem. */
export function paginasDoMapa(mapa: unknown): string[] {
  const ps = Array.isArray(obj(mapa).paginas) ? (obj(mapa).paginas as unknown[]) : [];
  const saida = ps.map((p) => texto(obj(p).slug, 80).replace(/^\/+/, "").replace(/\/+$/, "")).map((s) => (s ? `/${s}/` : "/"));
  const unicas = saida.filter((p, i) => saida.indexOf(p) === i);
  return (unicas.length ? unicas : ["/"]).sort(ordemDasPaginas);
}

const mapaDeArquivos = (v: unknown): MapaDeArquivos => {
  const o = obj(v);
  const m: MapaDeArquivos = {};
  for (const k of Object.keys(o).slice(0, 5000)) if (typeof o[k] === "string") m[k] = String(o[k]).slice(0, 64);
  return m;
};
const listaDeTextos = (v: unknown, max = 200) => (Array.isArray(v) ? v.map((x) => texto(x, 200)).filter(Boolean).slice(0, max) : []);

export function lerPreviaNaNuvem(v: unknown): PreviaNaNuvem | null {
  const o = obj(v);
  const url = texto(o.url, 300);
  if (url.indexOf("https://") !== 0 || typeof o.commit !== "string" || !o.commit) return null;
  const arquivos = mapaDeArquivos(o.arquivos);
  return {
    url,
    deploy_id: texto(o.deploy_id, 120),
    projeto_vercel: texto(o.projeto_vercel, 120),
    commit: texto(o.commit, 64),
    ramo: o.ramo === "rascunho" ? "rascunho" : "main",
    paginas: listaDeTextos(o.paginas).length ? listaDeTextos(o.paginas) : paginasDosArquivos(arquivos),
    arquivos,
    em: texto(o.em, 40),
    protecao: o.protecao === "ligada" || o.protecao === "desligada" ? o.protecao : null,
  };
}

/** As prévias na nuvem já feitas (trabalhos terminados), da mais nova à mais velha. */
export function previasNaNuvem(trabalhos: TrabalhoLido[]): Array<PreviaNaNuvem & { trabalho_id: string }> {
  const saida: Array<PreviaNaNuvem & { trabalho_id: string }> = [];
  for (const t of trabalhos) {
    if (t.estado !== "feito") continue;
    const p = lerPreviaNaNuvem(obj(t.resultado).previa_nuvem);
    if (p) saida.push({ ...p, trabalho_id: t.id });
  }
  return saida;
}

/** O commit a é o mesmo que b (um pode ser o começo do outro). */
export const mesmoCommit = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && (a.indexOf(b) === 0 || b.indexOf(a) === 0);

/** A prévia na nuvem de um commit (a mais nova). */
export function previaDoCommit(trabalhos: TrabalhoLido[], commit: string | null | undefined): (PreviaNaNuvem & { trabalho_id: string }) | null {
  if (!commit) return null;
  return previasNaNuvem(trabalhos).find((p) => mesmoCommit(p.commit, commit)) || null;
}

/**
 * A prévia na nuvem do estado atual (rascunho ou versão salva) é pedida como
 * um trabalho "revisar" com esta instrução (compila, confere e sobe a prévia;
 * sem custo de modelo). A marca que o worker lê vai no pacote do pedido.
 */
export const INSTRUCAO_DA_PREVIA_NA_NUVEM = "Prévia na nuvem";

/** A prévia na nuvem que ainda está na fila ou rodando (salvar ou pedida): a tela mostra "fazendo". */
export function previaNaNuvemPedida(trabalhos: Array<TrabalhoLido & { instrucao?: string | null }>): TrabalhoLido | null {
  return trabalhos.find((t) => (t.estado === "na_fila" || t.estado === "executando" || t.estado === "parando") && (t.tipo === "salvar" || (t.tipo === "revisar" && t.instrucao === INSTRUCAO_DA_PREVIA_NA_NUVEM))) || null;
}

// ------------------------------------------------------------------ o que está no ar

export type Publicado = {
  projeto_vercel: string | null;
  deploy_id: string | null;
  deploy_url: string | null;
  commit: string | null;
  paginas: string[];
  arquivos: MapaDeArquivos;
  publicado_em: string | null;
  no_ar: boolean;
  tirado_em: string | null;
};

/** O que sites.publicacao diz que está no ar (null: nunca publicado). */
export function lerPublicado(publicacao: unknown): Publicado | null {
  const p = obj(publicacao);
  if (typeof p.deploy_url !== "string" || !p.deploy_url) return null;
  const arquivos = mapaDeArquivos(p.arquivos);
  return {
    projeto_vercel: texto(p.projeto_vercel, 120) || null,
    deploy_id: texto(p.deploy_id, 120) || null,
    deploy_url: texto(p.deploy_url, 300),
    commit: texto(p.commit, 64) || null,
    paginas: listaDeTextos(p.paginas).length ? listaDeTextos(p.paginas) : paginasDosArquivos(arquivos),
    arquivos,
    publicado_em: texto(p.publicado_em, 40) || null,
    no_ar: p.no_ar !== false,
    tirado_em: texto(p.tirado_em, 40) || null,
  };
}

// ------------------------------------------------------------------ comparação antes de publicar

export type Comparacao = {
  /** Nada no ar ainda (ou foi tirado do ar): tudo entra. */
  primeira: boolean;
  /** Páginas novas (não estão no ar). */
  entra: string[];
  /** Páginas que estão no ar e vão mudar. */
  muda: string[];
  /** Páginas no ar que somem com esta versão. */
  sai: string[];
  /** Páginas iguais às do ar. */
  igual: string[];
  /** Sem o mapa de arquivos de um dos lados: "muda" é estimado (toda página em comum). */
  estimada: boolean;
  /** Arquivos (HTML, CSS, JS, imagens) novos, trocados e removidos, quando dá para saber. */
  arquivos: { novos: number; trocados: number; removidos: number } | null;
  /** A versão a publicar é a mesma que está no ar. */
  mesma_versao: boolean;
};

export function compararComPublicado(nova: { commit: string | null; paginas: string[]; arquivos?: MapaDeArquivos | null }, publicado: Publicado | null): Comparacao {
  const paginas = nova.paginas.length ? nova.paginas : ["/"];
  if (!publicado || !publicado.no_ar) {
    return { primeira: true, entra: paginas.slice(), muda: [], sai: [], igual: [], estimada: false, arquivos: null, mesma_versao: false };
  }
  const novos = nova.arquivos && Object.keys(nova.arquivos).length ? nova.arquivos : null;
  const antigos = Object.keys(publicado.arquivos).length ? publicado.arquivos : null;
  const noAr = publicado.paginas.length ? publicado.paginas : antigos ? paginasDosArquivos(antigos) : ["/"];
  const entra = paginas.filter((p) => noAr.indexOf(p) < 0);
  const sai = noAr.filter((p) => paginas.indexOf(p) < 0);
  const comuns = paginas.filter((p) => noAr.indexOf(p) >= 0);
  const mesmaVersao = mesmoCommit(nova.commit, publicado.commit);
  if (novos && antigos) {
    const muda = comuns.filter((p) => novos[arquivoDaPagina(p)] !== antigos[arquivoDaPagina(p)]);
    const ks = Object.keys(novos);
    const ka = Object.keys(antigos);
    return {
      primeira: false,
      entra,
      muda,
      sai,
      igual: comuns.filter((p) => muda.indexOf(p) < 0),
      estimada: false,
      arquivos: { novos: ks.filter((k) => !(k in antigos)).length, trocados: ks.filter((k) => k in antigos && antigos[k] !== novos[k]).length, removidos: ka.filter((k) => !(k in novos)).length },
      mesma_versao: mesmaVersao,
    };
  }
  return { primeira: false, entra, muda: mesmaVersao ? [] : comuns, sai, igual: mesmaVersao ? comuns : [], estimada: !mesmaVersao, arquivos: null, mesma_versao: mesmaVersao };
}

/** Uma linha por grupo, para o Confirmar do Publicar. */
export function linhasDaComparacao(c: Comparacao): string[] {
  if (c.primeira) return [`Entra no ar: ${c.entra.join(", ")} (primeira publicação).`];
  const l: string[] = [];
  if (c.entra.length) l.push(`Entra: ${c.entra.join(", ")}.`);
  if (c.muda.length) l.push(`${c.estimada ? "Pode mudar" : "Muda"}: ${c.muda.join(", ")}.`);
  if (c.sai.length) l.push(`Sai do ar: ${c.sai.join(", ")}.`);
  if (c.igual.length) l.push(`Igual ao que está no ar: ${c.igual.join(", ")}.`);
  if (!c.entra.length && !c.muda.length && !c.sai.length) l.push(c.mesma_versao ? "É a mesma versão que já está no ar." : "Nenhuma página muda.");
  return l;
}

// ------------------------------------------------------------------ só a versão salva

/** A versão salva que o Publicar leva (a tela manda o commit que mostrou; o servidor confere). */
export function conferirVersaoPedida(pedida: unknown, atual: string | null): { ok: boolean; codigo: string | null; motivo: string | null } {
  if (pedida === undefined || pedida === null || pedida === "") return { ok: true, codigo: null, motivo: null };
  if (typeof pedida !== "string" || !/^[0-9a-f]{7,64}$/i.test(pedida)) return { ok: false, codigo: "versao_invalida", motivo: "A versão pedida não é um commit válido." };
  if (!mesmoCommit(pedida, atual)) return { ok: false, codigo: "versao_mudou", motivo: "Outra versão foi salva depois da comparação. Confira de novo o que entra, muda e sai do ar antes de publicar." };
  return { ok: true, codigo: null, motivo: null };
}
