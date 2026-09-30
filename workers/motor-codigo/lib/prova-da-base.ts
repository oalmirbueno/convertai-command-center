/**
 * Prova de que o agente consultou a base de design (skill ui-ux-pro-max) e
 * conferiu o checklist de UX em cada seção. Sem o SDK (o teste do painel lê
 * este arquivo): só lê o que o embrulho e o agente escreveram no projeto.
 *  - .aceleriq/uiux-log.jsonl: uma linha por chamada de `node scripts/uiux.mjs`;
 *  - .aceleriq/ux/<seção>.json: {"conferidas": ["uupm:ux:66"], "pendentes": [{"regra", "motivo"}]}.
 * É aviso, nunca trava (feito só com evidência: a tela mostra o que houve).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EventoResumido } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { SKILL_DA_UIUX } from "./config-opencode.ts";

export const LOG_DA_BASE = join(".aceleriq", "uiux-log.jsonl");
export const PASTA_DA_PROVA_DE_UX = join(".aceleriq", "ux");

export type LinhaDoLogDaBase = { em?: string; args?: string[]; ms?: number; bytes?: number; codigo?: number; ok?: boolean; recusado?: string; cortado?: boolean; origem?: string };
export type ProvaDeUx = { conferidas: string[]; pendentes: Array<{ regra: string; motivo: string }> };
export type ConsultaDaSecao = { secao: string; consultas: number; falhas: number; sem_python: boolean; conferidas: string[]; pendentes: ProvaDeUx["pendentes"]; com_prova: boolean };

const REGRA = /^uupm:ux:\d{1,4}$/;

/** A tabela de regras de UX da skill (ux-guidelines.csv), na pasta do worker: o projeto não tem cópia da skill. */
export const CSV_DAS_REGRAS_DE_UX = join(SKILL_DA_UIUX, "data", "ux-guidelines.csv");

/** Leitor de CSV (RFC 4180: aspas, vírgula e quebra de linha dentro do campo, BOM). */
export function lerCsv(texto: string): string[][] {
  const t = String(texto || "").replace(/^\uFEFF/, "");
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    if (aspas) {
      if (c === '"' && t.charAt(i + 1) === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t.charAt(i + 1) === "\n") i++;
      linha.push(campo);
      campo = "";
      if (linha.length > 1 || linha[0] !== "") linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/**
 * Nome da regra (campo Issue, que a busca --domain ux mostra) para os ids
 * uupm:ux:<No>. Um nome pode ter mais de um id ("Font Loading" é 50 e 75).
 */
export function idsDasRegrasDeUx(csv: string): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  const [cabeca, ...corpo] = lerCsv(csv);
  if (!cabeca) return mapa;
  const iNo = cabeca.indexOf("No");
  const iIssue = cabeca.indexOf("Issue");
  if (iNo < 0 || iIssue < 0) return mapa;
  for (const l of corpo) {
    const no = String(l[iNo] || "").trim();
    const nome = String(l[iIssue] || "").trim().toLowerCase();
    if (!/^\d{1,4}$/.test(no) || !nome) continue;
    const lista = mapa.get(nome) || [];
    lista.push(`uupm:ux:${no}`);
    mapa.set(nome, lista);
  }
  return mapa;
}

let nomesDaBase: Map<string, string[]> | null = null;

/** O mapa de nomes das regras da skill do worker (lido uma vez; vazio quando a skill não está lá). */
export function regrasDeUxDaBase(caminho: string = CSV_DAS_REGRAS_DE_UX): Map<string, string[]> {
  if (caminho === CSV_DAS_REGRAS_DE_UX && nomesDaBase) return nomesDaBase;
  let mapa = new Map<string, string[]>();
  try {
    if (existsSync(caminho)) mapa = idsDasRegrasDeUx(readFileSync(caminho, "utf8"));
  } catch {
    mapa = new Map();
  }
  if (caminho === CSV_DAS_REGRAS_DE_UX) nomesDaBase = mapa;
  return mapa;
}

/** As linhas do log (as quebradas somem). */
export function lerLogDaBase(pasta: string): LinhaDoLogDaBase[] {
  const caminho = join(pasta, LOG_DA_BASE);
  if (!existsSync(caminho)) return [];
  const saida: LinhaDoLogDaBase[] = [];
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const t = linha.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as LinhaDoLogDaBase;
      if (o && typeof o === "object") saida.push(o);
    } catch {
      /* linha quebrada */
    }
  }
  return saida;
}

/** Ids de uma citação: o id da base ("uupm:ux:66") ou o nome da regra como a busca mostra ("Focus States"). */
function idsDaCitacao(r: unknown, nomes: Map<string, string[]>): string[] {
  const t = String(r == null ? "" : r).trim();
  if (REGRA.test(t)) return [t];
  // O agente costuma pôr uma explicação junto do id ("uupm:ux:66, alvo de toque..."): vale o id do começo.
  const comTexto = /^uupm:ux:(\d{1,4})\b/i.exec(t);
  if (comTexto) return [`uupm:ux:${comTexto[1]}`];
  const inteiro = nomes.get(t.toLowerCase());
  if (inteiro) return inteiro.slice();
  // O nome da regra seguido de explicação ("Focus States: botões com anel").
  const nome = t.split(/\s[-\u2013\u2014]\s|[:(]/)[0].trim().toLowerCase();
  return (nome && nome !== t.toLowerCase() ? nomes.get(nome) || [] : []).slice();
}

/** A prova de UX de uma seção, validada (só regras da base, no máximo 150 itens), ou null. */
export function normalizarProvaDeUx(bruto: unknown, nomes: Map<string, string[]> = new Map()): ProvaDeUx | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as { conferidas?: unknown; pendentes?: unknown };
  const conferidas: string[] = [];
  for (const r of Array.isArray(o.conferidas) ? o.conferidas : []) for (const id of idsDaCitacao(r, nomes)) if (conferidas.indexOf(id) < 0) conferidas.push(id);
  const pendentes: ProvaDeUx["pendentes"] = [];
  for (const p of Array.isArray(o.pendentes) ? o.pendentes : []) {
    if (!p || typeof p !== "object") continue;
    const motivo = String((p as { motivo?: unknown }).motivo || "").replace(/\s+/g, " ").trim().slice(0, 200);
    for (const id of idsDaCitacao((p as { regra?: unknown }).regra, nomes)) if (conferidas.indexOf(id) < 0 && !pendentes.some((x) => x.regra === id)) pendentes.push({ regra: id, motivo });
  }
  return { conferidas: conferidas.slice(0, 150), pendentes: pendentes.slice(0, 150) };
}

/** Lê .aceleriq/ux/<seção>.json; `desde` (ms) ignora a prova velha que esta passada não tocou. */
export function lerProvaDeUx(pasta: string, secao: string, desde = 0): ProvaDeUx | null {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(secao)) return null;
  const caminho = join(pasta, PASTA_DA_PROVA_DE_UX, `${secao}.json`);
  if (!existsSync(caminho)) return null;
  try {
    if (desde && statSync(caminho).mtimeMs + 1000 < desde) return null;
    return normalizarProvaDeUx(JSON.parse(readFileSync(caminho, "utf8")), regrasDeUxDaBase());
  } catch {
    return null;
  }
}

/** O que a passada fez com a base: as linhas novas do log (só as do agente; a do motor não conta) e a prova da seção. */
export function consultaDaSecao(secao: string, todas: LinhaDoLogDaBase[], ux: ProvaDeUx | null): ConsultaDaSecao {
  const novas = todas.filter((l) => l && l.origem !== "motor");
  const consultas = novas.filter((l) => l.codigo === 0).length;
  return {
    secao,
    consultas,
    falhas: novas.length - consultas,
    sem_python: consultas === 0 && novas.some((l) => l.codigo === 3),
    conferidas: ux ? ux.conferidas : [],
    pendentes: ux ? ux.pendentes : [],
    com_prova: !!ux,
  };
}

const vezes = (n: number) => (n === 1 ? "1 vez" : `${n} vezes`);
const regras = (n: number) => (n === 1 ? "1 regra" : `${n} regras`);

/**
 * O evento da seção para a tela: "Consultou a base 3 vezes; conferiu 12
 * regras; 1 pendente", ou o aviso quando a seção foi construída sem consultar
 * (ou sem Python na máquina).
 */
export function eventoDaConsulta(c: ConsultaDaSecao, rotulo: string): EventoResumido {
  const dados = { secao: c.secao, consultas: c.consultas, conferidas: c.conferidas.length, pendentes: c.pendentes.length, regras_pendentes: c.pendentes.slice(0, 10) };
  if (c.consultas === 0) {
    const porque = c.sem_python ? "a busca não rodou (sem Python 3 na máquina do motor)" : c.falhas ? `tentou ${vezes(c.falhas)} e a busca falhou ou foi recusada` : "nenhuma busca";
    return { tipo: "aviso", resumo: `A seção ${rotulo} foi construída sem consultar a base de design: ${porque}${c.com_prova ? `; conferiu ${regras(c.conferidas.length)}` : ""}`.slice(0, 280), dados };
  }
  const partes = [`Consultou a base ${vezes(c.consultas)}`];
  partes.push(c.com_prova ? `conferiu ${regras(c.conferidas.length)}` : "sem a prova do checklist de UX");
  if (c.pendentes.length) partes.push(`${c.pendentes.length} pendente${c.pendentes.length > 1 ? "s" : ""}`);
  return { tipo: c.com_prova ? "passo" : "aviso", resumo: `${rotulo}: ${partes.join("; ")}`.slice(0, 280), dados };
}

/** O total do trabalho (vai no resultado e no evento "fim"). */
export function totalDaBase(lista: ConsultaDaSecao[]) {
  return {
    consultas: lista.reduce((s, c) => s + c.consultas, 0),
    regras_conferidas: lista.reduce((s, c) => s + c.conferidas.length, 0),
    pendentes: lista.reduce((s, c) => s + c.pendentes.length, 0),
    sem_consulta: lista.filter((c) => c.consultas === 0).map((c) => c.secao),
    secoes: lista,
  };
}

/** O resumo curto para o evento "fim" (gancho do documento de entrega), ou null quando não houve passada do agente. */
export function resumoDaBaseNaEntrega(total: unknown) {
  if (!total || typeof total !== "object") return null;
  const t = total as ReturnType<typeof totalDaBase>;
  return { consultas: t.consultas, regras_conferidas: t.regras_conferidas, pendentes: t.pendentes, sem_consulta: t.sem_consulta };
}
