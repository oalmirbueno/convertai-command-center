/**
 * Esquema JSON na forma que a Anthropic aceita (ESQ 30/09/2026). Arquivo
 * puro (só importa o teto-de-saida, também puro): roda no Deno (ia-motor.ts)
 * e no vitest.
 *
 * Por que existe: o Claude Opus 5.5 é o padrão de 7 papéis e nunca rodou com
 * sucesso com os esquemas estritos das mesas. A Anthropic (direta, em
 * output_config.format, e pelo OpenRouter, em response_format) recusa com 400:
 * - mais de 16 parâmetros com união (type em lista, anyOf ou oneOf);
 * - mais de 24 parâmetros opcionais;
 * - enum com null ou enum com type em lista ("Enum value ... does not match
 *   declared type");
 * - minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf,
 *   minLength, maxLength, maxItems, minItems acima de 1 e outras restrições;
 * - objeto sem additionalProperties false;
 * - format fora da lista aceita.
 *
 * O que faz:
 * - diagnosticarEsquema: conta as uniões e os opcionais e aponta os problemas;
 * - converterParaAnthropic: devolve o esquema na forma aceita, sem mudar o que
 *   o código lê depois, e só mexe no que a Anthropic recusa. Enum com null
 *   perde o null e ganha a opção "". Acima de 16 uniões, a união com null de
 *   texto e de lista vira o tipo base com o vazio natural ("" ou []); se
 *   ainda passar, número, sim/não e objeto com null viram lista com no máximo
 *   um item (vazia = null). Restrições sem suporte saem do esquema, vão para
 *   a descrição e passam a ser conferidas no código;
 * - normalizarDaAnthropic: na leitura, devolve o "vazio" como null onde o
 *   esquema original aceitava null, desembrulha a lista de um item, confere
 *   mínimo, máximo e tamanho e acerta a caixa das opções (a Anthropic não
 *   garante maiúsculas e minúsculas do enum).
 *
 * Só vale para modelos da Anthropic: OpenAI e os outros modelos do OpenRouter
 * recebem o esquema original, sem nenhuma mudança (ia-motor.ts).
 *
 * Limite conhecido: onde a conversão troca o null pelo vazio, "" e [] voltam
 * como null (o modelo não tem mais como dizer "texto vazio" diferente de
 * "sem valor"). Só acontece nos esquemas acima de 16 uniões e nos enums com
 * null, que a Anthropic recusava de todo jeito.
 */

import { ehModeloDaAnthropic } from "./teto-de-saida.ts";

export const LIMITE_DE_UNIOES = 16;
export const LIMITE_DE_OPCIONAIS = 24;

/** Formatos de texto que a Anthropic aceita (docs de structured outputs, 30/09/2026). */
export const FORMATOS_ACEITOS = ["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"];

/** Palavras que a Anthropic não aceita no esquema estrito: saem e, as que dá, passam a ser conferidas no código. */
export const PALAVRAS_SEM_SUPORTE = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "contains",
  "minContains",
  "maxContains",
  "patternProperties",
  "propertyNames",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "then",
  "else",
  "not",
];

type No = Record<string, unknown>;

export type Diagnostico = {
  /** Caminhos com união (type em lista, anyOf ou oneOf). */
  unioes: string[];
  /** Propriedades fora de required. */
  opcionais: string[];
  /** Regras quebradas que dão 400 mesmo com poucas uniões. */
  problemas: string[];
};

function ehNo(v: unknown): v is No {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function tiposDe(n: No): string[] {
  if (Array.isArray(n.type)) return n.type.filter((t): t is string => typeof t === "string");
  return typeof n.type === "string" ? [n.type] : [];
}

function ehObjeto(n: No): boolean {
  return tiposDe(n).indexOf("object") >= 0 || (!n.type && ehNo(n.properties));
}

/** Padrão de regex com o que a Anthropic não aceita: retrovisor, lookaround, fronteira de palavra. */
function padraoSemSuporte(p: unknown): boolean {
  return typeof p === "string" && /\\[1-9bB]|\(\?[=!<]/.test(p);
}

function filhos(n: No, caminho: string): Array<[No, string]> {
  const saida: Array<[No, string]> = [];
  if (ehNo(n.properties)) for (const k of Object.keys(n.properties)) {
    const f = (n.properties as No)[k];
    if (ehNo(f)) saida.push([f, `${caminho}.${k}`]);
  }
  if (ehNo(n.items)) saida.push([n.items, `${caminho}[]`]);
  else if (Array.isArray(n.items)) n.items.forEach((f, i) => ehNo(f) && saida.push([f, `${caminho}[${i}]`]));
  if (ehNo(n.additionalProperties)) saida.push([n.additionalProperties, `${caminho}{}`]);
  for (const chave of ["anyOf", "oneOf", "allOf"]) {
    const lista = n[chave];
    if (Array.isArray(lista)) lista.forEach((f, i) => ehNo(f) && saida.push([f, `${caminho}|${chave === "allOf" ? "&" : ""}${i}`]));
  }
  for (const chave of ["$defs", "definitions"]) {
    const defs = n[chave];
    if (ehNo(defs)) for (const k of Object.keys(defs)) {
      const f = defs[k];
      if (ehNo(f)) saida.push([f, `${caminho}#${k}`]);
    }
  }
  return saida;
}

/** O esquema de dentro de { nome, schema } (EsquemaJson do motor) ou o próprio esquema. */
export function schemaDoEsquema(e: unknown): unknown {
  const o = e as { schema?: unknown };
  return ehNo(o) && ehNo(o.schema) ? o.schema : e;
}

/** Conta as uniões e os opcionais e aponta o que a Anthropic recusa. */
export function diagnosticarEsquema(esquema: unknown): Diagnostico {
  const d: Diagnostico = { unioes: [], opcionais: [], problemas: [] };
  const andar = (n: No, caminho: string) => {
    if (Array.isArray(n.type) || Array.isArray(n.anyOf) || Array.isArray(n.oneOf)) d.unioes.push(caminho);
    if (Array.isArray(n.oneOf)) d.problemas.push(`${caminho}: oneOf`);
    if (Array.isArray(n.enum)) {
      if (Array.isArray(n.type)) d.problemas.push(`${caminho}: enum com type em lista`);
      if (n.enum.indexOf(null) >= 0) d.problemas.push(`${caminho}: enum com null`);
      if (n.enum.some((v) => v !== null && typeof v === "object")) d.problemas.push(`${caminho}: enum com valor composto`);
    }
    for (const k of PALAVRAS_SEM_SUPORTE) if (n[k] !== undefined) d.problemas.push(`${caminho}: ${k}`);
    if (typeof n.minItems === "number" && n.minItems > 1) d.problemas.push(`${caminho}: minItems ${n.minItems}`);
    if (typeof n.format === "string" && FORMATOS_ACEITOS.indexOf(n.format) < 0) d.problemas.push(`${caminho}: format ${n.format}`);
    if (padraoSemSuporte(n.pattern)) d.problemas.push(`${caminho}: pattern sem suporte`);
    if (typeof n.$ref === "string" && !/^#/.test(n.$ref)) d.problemas.push(`${caminho}: $ref externo`);
    if (ehObjeto(n)) {
      if (n.additionalProperties !== false) d.problemas.push(`${caminho}: additionalProperties`);
      const req = Array.isArray(n.required) ? n.required : [];
      if (ehNo(n.properties)) for (const k of Object.keys(n.properties)) if (req.indexOf(k) < 0) d.opcionais.push(`${caminho}.${k}`);
    }
    for (const [f, c] of filhos(n, caminho)) andar(f, c);
  };
  const raiz = schemaDoEsquema(esquema);
  if (ehNo(raiz)) andar(raiz, "$");
  return d;
}

/** Cabe nas regras da Anthropic: sem problemas, até 16 uniões e até 24 opcionais. */
export function respeitaAsRegrasDaAnthropic(esquema: unknown): boolean {
  const d = diagnosticarEsquema(esquema);
  return !d.problemas.length && d.unioes.length <= LIMITE_DE_UNIOES && d.opcionais.length <= LIMITE_DE_OPCIONAIS;
}

// ------------------------------------------------------------------ conversão

/** Como o "vazio" de um nó que aceitava null ficou no esquema convertido. */
export type FormaDoVazio = "texto" | "lista" | "embrulho";

export type Conversao = {
  /** No mesmo formato da entrada ({ nome, schema } ou o esquema puro). */
  schema: Record<string, unknown>;
  /** Caminho (no esquema ORIGINAL) de cada nó que aceitava null e como o vazio ficou. */
  vazios: Record<string, FormaDoVazio>;
  mudou: boolean;
  antes: Diagnostico;
  depois: Diagnostico;
};

function clonar<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function juntarDescricao(n: No, extra: string) {
  const atual = typeof n.description === "string" ? n.description.trim() : "";
  n.description = atual ? `${atual.replace(/[.\s]+$/, "")}. ${extra}` : extra;
}

/** Leva para a descrição o que sai do esquema (o modelo continua sabendo do limite). */
function limitesNaDescricao(n: No): string[] {
  const partes: string[] = [];
  const num = (k: string) => (typeof n[k] === "number" ? (n[k] as number) : null);
  const min = num("minimum");
  const max = num("maximum");
  if (min !== null && max !== null) partes.push(`entre ${min} e ${max}`);
  else if (min !== null) partes.push(`no mínimo ${min}`);
  else if (max !== null) partes.push(`no máximo ${max}`);
  if (num("exclusiveMinimum") !== null) partes.push(`maior que ${num("exclusiveMinimum")}`);
  if (num("exclusiveMaximum") !== null) partes.push(`menor que ${num("exclusiveMaximum")}`);
  if (num("multipleOf") !== null) partes.push(`múltiplo de ${num("multipleOf")}`);
  if ((num("minLength") || 0) > 0) partes.push(`no mínimo ${num("minLength")} caracteres`);
  if (num("maxLength") !== null) partes.push(`até ${num("maxLength")} caracteres`);
  if ((num("minItems") || 0) > 1) partes.push(`no mínimo ${num("minItems")} itens`);
  if (num("maxItems") !== null) partes.push(`até ${num("maxItems")} itens`);
  if (n.uniqueItems === true) partes.push("sem itens repetidos");
  return partes;
}

/** Correções que valem sempre (dão 400 com qualquer número de uniões). */
function corrigirNo(n: No) {
  const limites = limitesNaDescricao(n);
  for (const k of PALAVRAS_SEM_SUPORTE) delete n[k];
  if (typeof n.minItems === "number" && n.minItems > 1) n.minItems = 1;
  if (typeof n.format === "string" && FORMATOS_ACEITOS.indexOf(n.format) < 0) {
    limites.push(`formato ${n.format}`);
    delete n.format;
  }
  if (padraoSemSuporte(n.pattern)) delete n.pattern;
  if (Array.isArray(n.oneOf)) {
    n.anyOf = (Array.isArray(n.anyOf) ? n.anyOf : []).concat(n.oneOf);
    delete n.oneOf;
  }
  if (Array.isArray(n.enum)) n.enum = n.enum.filter((v) => v === null || typeof v !== "object");
  // Objeto com propriedades conhecidas fecha (additionalProperties false). Mapa livre
  // (sem propriedades, ou additionalProperties com esquema) fica: fechar apagaria o
  // conteúdo calado; ele segue como problema, vai para o log e o provedor recusa.
  if (ehObjeto(n) && ehNo(n.properties) && (n.additionalProperties === undefined || n.additionalProperties === true)) {
    n.additionalProperties = false;
  }
  if (limites.length) juntarDescricao(n, `(${limites.join(", ")})`);
}

/** O lado não nulo de um nó que aceita null (type em lista, anyOf com null ou enum com null); null se não aceita. */
function ladoNaoNulo(n: No): { base: No; tipo: string } | null {
  if (Array.isArray(n.type)) {
    const tipos = n.type.filter((t) => t !== "null");
    if (tipos.length === n.type.length || tipos.length !== 1) return null;
    const base: No = { ...n, type: tipos[0] };
    if (Array.isArray(base.enum)) base.enum = (base.enum as unknown[]).filter((v) => v !== null);
    return { base, tipo: String(tipos[0]) };
  }
  if (Array.isArray(n.anyOf)) {
    const alts = n.anyOf as unknown[];
    const nulo = (a: unknown) => ehNo(a) && (a.type === "null" || (Array.isArray(a.enum) && a.enum.length === 1 && a.enum[0] === null));
    const semNulo = alts.filter((a) => !nulo(a));
    if (semNulo.length !== 1 || semNulo.length === alts.length || !ehNo(semNulo[0])) return null;
    const { anyOf: _fora, ...resto } = n;
    const base: No = { ...(semNulo[0] as No), ...resto };
    const tipo = tiposDe(base)[0] || (Array.isArray(base.enum) ? "string" : "");
    if (!base.type && tipo) base.type = tipo;
    return { base, tipo };
  }
  if (Array.isArray(n.enum) && n.enum.indexOf(null) >= 0) {
    const base: No = { ...n, enum: (n.enum as unknown[]).filter((v) => v !== null) };
    const tipo = tiposDe(base)[0] || ((base.enum as unknown[]).every((v) => typeof v === "string") ? "string" : "");
    if (!base.type && tipo) base.type = tipo;
    return { base, tipo };
  }
  return null;
}

function ehEnumDeTexto(n: No): boolean {
  return Array.isArray(n.enum) && (n.enum as unknown[]).every((v) => typeof v === "string");
}

/** enum com null ou enum com type em lista: a Anthropic recusa com qualquer número de uniões. */
function enumQueARecusa(n: No): boolean {
  return Array.isArray(n.enum) && (Array.isArray(n.type) || (n.enum as unknown[]).indexOf(null) >= 0);
}

function trocar(n: No, novo: No) {
  for (const k of Object.keys(n)) delete n[k];
  Object.assign(n, novo);
}

/** Texto, opção de texto e lista com null: o vazio natural ("", opção "" ou []). */
function vazioNatural(n: No, caminho: string, vazios: Record<string, FormaDoVazio>): boolean {
  const lado = ladoNaoNulo(n);
  if (!lado) return false;
  const { base, tipo } = lado;
  if (tipo === "string" && (!Array.isArray(base.enum) || ehEnumDeTexto(base))) {
    if (Array.isArray(base.enum)) {
      if ((base.enum as string[]).indexOf("") < 0) base.enum = (base.enum as string[]).concat([""]);
      juntarDescricao(base, "Opção vazia \"\" quando não houver");
    } else {
      juntarDescricao(base, "Texto vazio quando não houver");
    }
    trocar(n, base);
    vazios[caminho] = "texto";
    return true;
  }
  if (tipo === "array") {
    juntarDescricao(base, "Lista vazia quando não houver");
    trocar(n, base);
    vazios[caminho] = "lista";
    return true;
  }
  return false;
}

/** Número, sim/não, objeto ou enum não textual com null: lista com no máximo um item (vazia = null). */
function embrulhar(n: No, caminho: string, vazios: Record<string, FormaDoVazio>): boolean {
  const lado = ladoNaoNulo(n);
  if (!lado) return false;
  const { description, ...item } = lado.base;
  const antes = typeof description === "string" && description.trim() ? `${description.trim().replace(/[.\s]+$/, "")}. ` : "";
  trocar(n, { type: "array", items: item, description: `${antes}Lista com um item, ou vazia quando não houver` });
  vazios[caminho] = "embrulho";
  return true;
}

type Par = { original: No; copia: No; caminho: string };

/** Nós do original e da cópia lado a lado, em pré-ordem, com o caminho do ORIGINAL (o que a leitura usa). */
function paresEmOrdem(original: No, copia: No, caminho: string, saida: Par[] = []): Par[] {
  saida.push({ original, copia, caminho });
  const fo = filhos(original, caminho);
  const fc = filhos(copia, caminho);
  for (let i = 0; i < fo.length && i < fc.length; i++) paresEmOrdem(fo[i][0], fc[i][0], fo[i][1], saida);
  return saida;
}

const CACHE = new WeakMap<object, Conversao>();

/**
 * Esquema na forma que a Anthropic aceita. Só muda o que ela recusa:
 * 1. sempre: palavras sem suporte (vão para a descrição), oneOf, format,
 *    additionalProperties do objeto com propriedades e enum com null (perde
 *    o null e ganha "");
 * 2. acima de 16 uniões: todo texto, opção e lista com null ganha o vazio
 *    natural ("", opção "" ou []);
 * 3. ainda acima de 16: número, sim/não e enum não textual com null, e por
 *    último objeto com null, viram lista com no máximo um item, um a um, na
 *    ordem do esquema, até caber.
 * Esquema dentro das regras sai igual. Determinística e guardada por objeto:
 * a leitura (normalizarDaAnthropic) refaz o mesmo caminho.
 */
export function converterParaAnthropic(esquema: unknown): Conversao {
  const chave = ehNo(esquema) ? esquema : null;
  const guardado = chave ? CACHE.get(chave) : undefined;
  if (guardado) return guardado;
  const original = schemaDoEsquema(esquema);
  const antes = diagnosticarEsquema(original);
  const raiz = clonar(ehNo(original) ? original : {}) as No;
  const vazios: Record<string, FormaDoVazio> = {};
  const pares = ehNo(original) ? paresEmOrdem(original, raiz, "$") : [];
  const unioes = () => diagnosticarEsquema(raiz).unioes.length;

  // 1) De baixo para cima (o filho já corrigido entra inteiro no pai quando o anyOf com null se desfaz).
  for (let i = pares.length - 1; i >= 0; i--) {
    const { copia, caminho } = pares[i];
    corrigirNo(copia);
    if (enumQueARecusa(copia) && !vazioNatural(copia, caminho, vazios)) embrulhar(copia, caminho, vazios);
  }
  // 2) Acima de 16: o vazio natural de texto, opção e lista, em todos.
  if (unioes() > LIMITE_DE_UNIOES) for (const { copia, caminho } of pares) vazioNatural(copia, caminho, vazios);
  // 3) Ainda acima de 16: lista de um item, primeiro os pequenos, depois os objetos.
  for (const fase of [["number", "integer", "boolean", "string", ""], ["object", "array"]]) {
    for (const { copia, caminho } of pares) {
      if (unioes() <= LIMITE_DE_UNIOES) break;
      const lado = ladoNaoNulo(copia);
      if (lado && fase.indexOf(lado.tipo) >= 0) embrulhar(copia, caminho, vazios);
    }
  }

  const depois = diagnosticarEsquema(raiz);
  const mudou = JSON.stringify(raiz) !== JSON.stringify(original);
  const talvez = esquema as { schema?: unknown };
  const saida: Conversao = {
    schema: ehNo(talvez) && ehNo(talvez.schema) ? { ...talvez, schema: raiz } : raiz,
    vazios,
    mudou,
    antes,
    depois,
  };
  if (chave) CACHE.set(chave, saida);
  return saida;
}

// ------------------------------------------------------------------ leitura

function vazioNaForma(v: unknown, forma: FormaDoVazio): boolean {
  if (v === null || v === undefined) return true;
  if (forma === "texto") return typeof v === "string" && !v.trim();
  return Array.isArray(v) && v.length === 0;
}

/** Confere no código o que saiu do esquema: faixa do número, tamanho do texto e da lista, caixa da opção. */
function conferirValor(n: No, v: unknown): unknown {
  const tipos = tiposDe(n);
  if (typeof v === "string") {
    if (Array.isArray(n.enum) && (n.enum as unknown[]).indexOf(v) < 0) {
      const alvo = v.trim().toLowerCase();
      const achado = (n.enum as unknown[]).find((o) => typeof o === "string" && o.toLowerCase() === alvo);
      if (achado !== undefined) return achado;
    }
    if (typeof n.maxLength === "number" && v.length > n.maxLength) return v.slice(0, n.maxLength);
    return v;
  }
  if (typeof v === "number") {
    let x = v;
    if (tipos.indexOf("integer") >= 0 && tipos.indexOf("number") < 0 && !Number.isInteger(x)) x = Math.round(x);
    if (typeof n.multipleOf === "number" && n.multipleOf > 0) x = Math.round(x / n.multipleOf) * n.multipleOf;
    if (typeof n.minimum === "number" && x < n.minimum) x = n.minimum;
    if (typeof n.maximum === "number" && x > n.maximum) x = n.maximum;
    return x;
  }
  if (Array.isArray(v) && typeof n.maxItems === "number" && v.length > n.maxItems) return v.slice(0, n.maxItems);
  return v;
}

function tipoDoValor(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function aceitaTipo(n: No, v: unknown): boolean {
  const tipos = tiposDe(n);
  if (!tipos.length) return !Array.isArray(n.enum) || (n.enum as unknown[]).some((o) => typeof o === typeof v);
  const t = tipoDoValor(v);
  return tipos.indexOf(t) >= 0 || (t === "integer" && tipos.indexOf("number") >= 0);
}

/** n é o nó do esquema ORIGINAL e caminho é o caminho dele (o mesmo da conversão). */
function normalizarNo(n: No, v: unknown, caminho: string, vazios: Record<string, FormaDoVazio>): unknown {
  const forma = vazios[caminho];
  let valor = v;
  if (forma) {
    if (vazioNaForma(valor, forma)) return null;
    // Lista de um item: volta a ser o item (e segue a conferência com o nó original).
    if (forma === "embrulho" && Array.isArray(valor)) valor = valor.length ? valor[0] : null;
  }
  if (valor === null || valor === undefined) return valor;
  // União que ficou: segue pela alternativa do tipo do valor (mesmo índice da conversão).
  const alts = Array.isArray(n.anyOf) ? n.anyOf : Array.isArray(n.oneOf) ? n.oneOf : null;
  if (alts) {
    for (let i = 0; i < alts.length; i++) {
      const a = alts[i];
      if (ehNo(a) && a.type !== "null" && aceitaTipo(a, valor)) return normalizarNo(a, valor, `${caminho}|${i}`, vazios);
    }
    return valor;
  }
  valor = conferirValor(n, valor);
  if (Array.isArray(valor)) {
    const itens = n.items;
    if (!ehNo(itens)) return valor;
    return valor.map((item) => normalizarNo(itens, item, `${caminho}[]`, vazios));
  }
  if (ehNo(valor) && ehNo(n.properties)) {
    const props = n.properties as No;
    const saida: Record<string, unknown> = {};
    for (const k of Object.keys(valor)) {
      const p = props[k];
      saida[k] = ehNo(p) ? normalizarNo(p, valor[k], `${caminho}.${k}`, vazios) : valor[k];
    }
    return saida;
  }
  return valor;
}

/**
 * Resposta de um modelo da Anthropic de volta à forma que o código espera do
 * esquema original: vazio vira null onde o original aceitava null e a
 * conversão trocou o null pelo vazio, a lista de um item volta a ser o item,
 * números entram na faixa, textos e listas no tamanho, opções na caixa
 * certa. Valor fora do formato fica como veio (a conferência de cada mesa
 * continua valendo).
 */
export function normalizarDaAnthropic(esquema: unknown, valor: unknown): unknown {
  const original = schemaDoEsquema(esquema);
  if (!ehNo(original)) return valor;
  const { vazios } = converterParaAnthropic(esquema);
  return normalizarNo(original, valor, "$", vazios);
}

// ------------------------------------------------------------------ por modelo

type ModeloDoEsquema = { provedor: string; modelo_api: string; id?: string };

/**
 * O esquema que vai ao provedor. Modelo da Anthropic (direto ou
 * anthropic/* no OpenRouter): a forma aceita, se precisar mudar. Qualquer
 * outro (OpenAI, Gemini, Luna pelo OpenRouter): o MESMO objeto de entrada.
 */
export function esquemaNoProvedor<T>(m: ModeloDoEsquema, esquema: T): { esquema: T | Record<string, unknown>; conversao: Conversao | null } {
  if (!esquema || !ehModeloDaAnthropic(m)) return { esquema, conversao: null };
  const c = converterParaAnthropic(esquema);
  return { esquema: c.mudou ? c.schema : esquema, conversao: c };
}

/** A resposta de volta à forma do esquema original (só nos modelos da Anthropic; nos outros, o mesmo valor). */
export function respostaNoFormatoOriginal(m: ModeloDoEsquema, esquema: unknown, valor: unknown): unknown {
  if (!esquema || !ehModeloDaAnthropic(m)) return valor;
  return normalizarDaAnthropic(esquema, valor);
}
