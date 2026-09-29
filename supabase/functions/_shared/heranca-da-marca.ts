/**
 * Regra única de herança entre o cliente e as marcas dele (frente MC, 29/09).
 *
 * Pedido do dono: "trocar para a CME tem que mudar tudo, igual quando a gente
 * seleciona outro cliente; nada da Acerbi pode vazar para a CME, nem o
 * contrário". Antes cada tela e cada função decidia sozinha o que herdar do
 * cliente, e cada uma decidia diferente (a CME herdava regras, negócio,
 * público e tipografia da Acerbi; a tela de Contexto mostrava a paleta e a
 * logo da Acerbi com a CME aberta).
 *
 * A regra, num lugar só (arquivo puro, sem import: o front importa o mesmo):
 * 1. sem marca aberta (cliente de uma marca só): vale o dado do cliente;
 * 2. marca principal: vale o dado dela quando preenchido; vazio, o do
 *    cliente (o kit do cliente É o kit da principal);
 * 3. outra marca: vale SÓ o dado dela. Vazio fica vazio. Nunca o do cliente
 *    e nunca o de outra marca;
 * 4. exceção: campo genuinamente comum ao cliente (contrato, cobrança,
 *    equipe, cadastro) vale para todas as marcas. Identidade nunca é comum:
 *    cor, logo, fonte, referência, estilo, regras, tom, contexto de negócio,
 *    Instagram, acervo e templates.
 */

/** O que é identidade da marca: nunca passa do cliente para uma marca que não é a principal. */
export const CAMPOS_DA_IDENTIDADE = [
  "paleta",
  "logo",
  "logo_alternativa",
  "fontes",
  "referencias",
  "estilo",
  "regras",
  "tom",
  "contexto",
  "instagram",
  "acervo",
  "templates",
] as const;

/** O que é do cliente como um todo e vale para todas as marcas. */
export const CAMPOS_COMUNS_DO_CLIENTE = ["contrato", "cobranca", "equipe", "cadastro"] as const;

export type CampoDaIdentidade = (typeof CAMPOS_DA_IDENTIDADE)[number];
export type CampoComum = (typeof CAMPOS_COMUNS_DO_CLIENTE)[number];
export type CampoDaMarca = CampoDaIdentidade | CampoComum;

/** O mínimo da marca que a regra precisa (servidor e tela têm formatos maiores). */
export type MarcaDaHeranca = { id?: string; principal: boolean } | null | undefined;

/** De onde veio o valor efetivo: do cliente, da própria marca, ou de lugar nenhum (vazio). */
export type OrigemDoValor = "cliente" | "marca" | "vazio";

/** Valor preenchido: texto com letra, lista com item, objeto com alguma chave preenchida. */
export function preenchido(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).some((k) => preenchido((v as Record<string, unknown>)[k]));
  return true;
}

const COMUNS: readonly string[] = CAMPOS_COMUNS_DO_CLIENTE;

/** A marca aberta pode usar o dado do cliente neste campo? */
export function herdaDoCliente(campo: CampoDaMarca, marca: MarcaDaHeranca): boolean {
  if (!marca) return true;
  if (marca.principal) return true;
  return COMUNS.indexOf(campo) >= 0;
}

/**
 * O valor que vale para a marca aberta, e de onde veio. `daMarca` é o valor
 * gravado na própria marca; `doCliente`, o do cliente. Outra marca com campo
 * vazio devolve `vazio` (nunca o do cliente).
 */
export function valorDaMarca<T>(
  campo: CampoDaMarca,
  marca: MarcaDaHeranca,
  daMarca: T | null | undefined,
  doCliente: T | null | undefined,
  vazio: T,
): { valor: T; origem: OrigemDoValor } {
  if (!marca) return preenchido(doCliente) ? { valor: doCliente as T, origem: "cliente" } : { valor: vazio, origem: "vazio" };
  if (preenchido(daMarca)) return { valor: daMarca as T, origem: "marca" };
  if (herdaDoCliente(campo, marca) && preenchido(doCliente)) return { valor: doCliente as T, origem: "cliente" };
  return { valor: vazio, origem: "vazio" };
}

/** Atalho: só o valor. */
export function valorEfetivo<T>(campo: CampoDaMarca, marca: MarcaDaHeranca, daMarca: T | null | undefined, doCliente: T | null | undefined, vazio: T): T {
  return valorDaMarca(campo, marca, daMarca, doCliente, vazio).valor;
}

/**
 * Linha que carrega marca_id (referência, fonte) é desta marca? Sem marca:
 * todas. Principal: as sem marca (do cliente) e as dela. Outra: só as dela.
 */
export function linhaDaMarca(marcaIdDaLinha: string | null | undefined, marca: MarcaDaHeranca): boolean {
  if (!marca) return true;
  if (marca.principal) return !marcaIdDaLinha || marcaIdDaLinha === marca.id;
  return !!marcaIdDaLinha && marcaIdDaLinha === marca.id;
}

/** Logo (principal e alternativa) com a mesma forma nos dois lados. */
export type LogosDoKit = {
  logo_path: string | null;
  logo_file_id: string | null;
  logo_alt_path: string | null;
  logo_alt_file_id: string | null;
  logo_tom?: string | null;
  logo_alt_tom?: string | null;
};

/**
 * Logos que valem: a logo é um par (caminho e arquivo) e a alternativa outro;
 * cada par é herdado inteiro ou não é (nunca o caminho de um com o arquivo do
 * outro).
 */
export function logosDaMarca(marca: MarcaDaHeranca, daMarca: Partial<LogosDoKit> | null | undefined, doCliente: Partial<LogosDoKit> | null | undefined): LogosDoKit {
  const m = daMarca || {};
  const c = doCliente || {};
  const par = (campo: "logo" | "logo_alternativa", caminho: string | null | undefined, arquivo: string | null | undefined, tom: string | null | undefined, cCaminho: string | null | undefined, cArquivo: string | null | undefined, cTom: string | null | undefined) => {
    const daPropria = preenchido(caminho) || preenchido(arquivo);
    if (marca && daPropria) return { caminho: caminho || null, arquivo: arquivo || null, tom: tom || null };
    if (herdaDoCliente(campo, marca)) return { caminho: cCaminho || null, arquivo: cArquivo || null, tom: cTom || null };
    return { caminho: null, arquivo: null, tom: null };
  };
  const p = par("logo", m.logo_path, m.logo_file_id, m.logo_tom, c.logo_path, c.logo_file_id, c.logo_tom);
  const a = par("logo_alternativa", m.logo_alt_path, m.logo_alt_file_id, m.logo_alt_tom, c.logo_alt_path, c.logo_alt_file_id, c.logo_alt_tom);
  return {
    logo_path: p.caminho,
    logo_file_id: p.arquivo,
    logo_tom: p.tom,
    logo_alt_path: a.caminho,
    logo_alt_file_id: a.arquivo,
    logo_alt_tom: a.tom,
  };
}

/**
 * Contexto de negócio (negócio, público, oferta, diferenciais, tipografia,
 * logo, lacunas...) da marca aberta. Principal: o do cliente com o dela por
 * cima, campo a campo. Outra marca: só o dela.
 */
export function contextoDaMarcaAberta(
  marca: MarcaDaHeranca,
  daMarca: Record<string, unknown> | null | undefined,
  doCliente: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const saida: Record<string, unknown> = herdaDoCliente("contexto", marca) ? { ...(doCliente || {}) } : {};
  if (!marca) return saida;
  const proprio = daMarca && typeof daMarca === "object" ? daMarca : {};
  for (const k of Object.keys(proprio)) {
    const v = proprio[k];
    if (preenchido(v)) saida[k] = v;
  }
  return saida;
}

/** Conta de rede ligada a projeto (project_external_accounts). */
export type LigacaoDeConta = { project_id: string; external_account_id: string };
export type MarcaComProjeto = { id: string; principal: boolean; project_id: string | null };

/**
 * Contas (Instagram, página, anúncios) da marca aberta, pelo projeto da
 * marca: outra marca fica só com as contas ligadas ao projeto dela; a
 * principal com todas as que não são ligadas a projeto de outra marca. Sem
 * marca, todas. Uma conta ligada às duas marcas vale para as duas.
 */
export function contasDaMarcaAberta<C extends { id: string }>(
  contas: C[],
  ligacoes: LigacaoDeConta[],
  marca: MarcaComProjeto | null | undefined,
  marcas: MarcaComProjeto[],
): C[] {
  if (!marca) return contas;
  const projetoDaConta: Record<string, string[]> = {};
  for (const l of ligacoes) (projetoDaConta[l.external_account_id] = projetoDaConta[l.external_account_id] || []).push(l.project_id);
  if (!marca.principal) {
    if (!marca.project_id) return [];
    return contas.filter((c) => (projetoDaConta[c.id] || []).indexOf(marca.project_id as string) >= 0);
  }
  const deOutras: Record<string, true> = {};
  for (const m of marcas) if (m.id !== marca.id && m.project_id) deOutras[m.project_id] = true;
  return contas.filter((c) => {
    const projetos = projetoDaConta[c.id] || [];
    if (!projetos.length) return true;
    return projetos.some((p) => !deOutras[p]);
  });
}

/** Etiqueta da marca numa foto do acervo (cliente_imagens.tags). */
export const etiquetaDaMarca = (marcaId: string) => `marca:${marcaId}`;

/**
 * A foto do acervo é desta marca? Sem marca: sempre. Com a etiqueta de outra
 * marca: nunca. Com a dela: sim. Sem etiqueta: só na principal (onde o
 * acervo sempre esteve). Mesma regra na tela e no servidor.
 */
export function fotoDaMarcaAberta(tags: string[] | null | undefined, marca: MarcaDaHeranca): boolean {
  if (!marca) return true;
  const lista = Array.isArray(tags) ? tags : [];
  const deMarcas = lista.filter((t) => typeof t === "string" && t.indexOf("marca:") === 0);
  if (!deMarcas.length) return marca.principal;
  return !!marca.id && deMarcas.indexOf(etiquetaDaMarca(marca.id)) >= 0;
}

/**
 * Proposta, post ou item preso a projeto é desta marca? Outra marca: só o do
 * projeto dela. Principal: o que não é de projeto de outra marca (e o sem
 * projeto). Sem marca: tudo.
 */
export function projetoDaMarcaAberta(projectId: string | null | undefined, marca: MarcaComProjeto | null | undefined, marcas: MarcaComProjeto[]): boolean {
  if (!marca) return true;
  if (!marca.principal) return !!marca.project_id && projectId === marca.project_id;
  if (!projectId) return true;
  return !marcas.some((m) => m.id !== marca.id && !!m.project_id && m.project_id === projectId);
}

/** Minúsculo e sem acento, só letras e números separados por espaço. */
function palavras(v: string): string {
  return ` ${String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** O texto cita o nome da marca como palavra inteira ("CME Logo" cita "CME"; "acmeria" não). */
export function citaMarca(texto: string, nome: string): boolean {
  const n = palavras(nome).trim();
  return !!n && palavras(texto).indexOf(` ${n} `) >= 0;
}

/**
 * Etiquetas de marca de uma imagem nova do acervo, pela origem: arquivo do
 * projeto de uma marca que não é a principal, ou caminho do Workspace que
 * cita o nome dela. Sem pista: nenhuma (fica com a principal, como sempre).
 */
export function etiquetasDaOrigem(
  origem: { projectId?: string | null; caminho?: string | null },
  marcas: (MarcaComProjeto & { nome: string })[],
): string[] {
  const saida: string[] = [];
  for (const m of marcas) {
    if (m.principal) continue;
    const doProjeto = !!origem.projectId && !!m.project_id && origem.projectId === m.project_id;
    const doCaminho = !!origem.caminho && citaMarca(origem.caminho, m.nome);
    if (doProjeto || doCaminho) saida.push(etiquetaDaMarca(m.id));
  }
  return saida;
}
