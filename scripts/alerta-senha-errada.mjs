#!/usr/bin/env node
// Alerta de senha errada (só aviso): lê os auth_logs dos últimos 30 min pela
// Management API e, se o mesmo IP (ou e-mail, quando o log trouxer) errar a
// senha 5+ vezes em 10 min, grava um aviso no sino dos admins
// (notification_type = 'login_senha_errada'). Não bloqueia ninguém.
// Uso: node scripts/alerta-senha-errada.mjs [--dry-run|--write] [--fixture arq.json]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

export const LIMIAR = 5;
export const JANELA_MS = 10 * 60 * 1000;
export const LEITURA_MS = 30 * 60 * 1000;
export const DEDUP_MS = 30 * 60 * 1000;
export const TIPO_AVISO = "login_senha_errada";

const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export const LOGS_SQL = `select timestamp, event_message, log_attributes
from logs
where source = 'auth_logs'
  and (log_attributes['error_code'] = 'invalid_credentials'
       or event_message like '%invalid_credentials%')
order by timestamp asc
limit 5000`;

// ---------- parte pura ----------

function comoObjeto(valor) {
  if (!valor) return {};
  if (typeof valor === "object") return valor;
  if (typeof valor === "string") {
    try {
      const v = JSON.parse(valor);
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

function texto(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function parseTimestamp(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number" || /^\d+$/.test(String(valor))) {
    const n = Number(valor);
    // ClickHouse/Logflare costumam mandar microssegundos.
    if (n > 1e17) return Math.floor(n / 1e6); // nanossegundos
    if (n > 1e14) return Math.floor(n / 1e3); // microssegundos
    if (n > 1e11) return n; // milissegundos
    return n * 1000; // segundos
  }
  let s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(" ", "T");
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += "Z";
  // Date só entende milissegundos; corta frações mais longas.
  s = s.replace(/(\.\d{3})\d+/, "$1");
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function normalizarIp(valor) {
  let s = texto(valor);
  if (!s) return null;
  s = s.split(",")[0].trim();
  if (s.startsWith("[")) s = s.slice(1, s.indexOf("]") > 0 ? s.indexOf("]") : undefined);
  if (isIP(s)) return s.toLowerCase();
  const m = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(s);
  if (m && isIP(m[1]) === 4) return m[1];
  return null;
}

export function validarEmail(valor) {
  const s = texto(valor);
  if (!s || s.length > 254 || !EMAIL_RE.test(s)) return null;
  return s.toLowerCase();
}

export function mascararEmail(email) {
  const [local, dominio] = String(email).split("@");
  if (!dominio) return "***";
  return `${local.slice(0, 1)}***@${dominio}`;
}

/** Converte uma linha crua do auth_logs num evento normalizado (ou null). */
export function parsearEvento(linha) {
  if (!linha || typeof linha !== "object") return null;
  const attrs = comoObjeto(linha.log_attributes);
  const msg = comoObjeto(linha.event_message);
  const pegar = (chave) => texto(attrs[chave]) ?? texto(msg[chave]);

  const errorCode = pegar("error_code");
  const grantType = pegar("grant_type");
  const path = texto(msg.path) ?? texto(attrs.path);
  const ip = normalizarIp(texto(msg.remote_addr) ?? texto(attrs.remote_addr));
  let email = null;
  for (const c of ["email", "user_email", "actor_username", "actor_email"]) {
    email = validarEmail(msg[c]) ?? validarEmail(attrs[c]);
    if (email) break;
  }
  const ts = parseTimestamp(linha.timestamp ?? msg.time ?? msg.timestamp);
  return { ts, errorCode, grantType, path, ip, email };
}

export function ehSenhaErrada(ev) {
  if (!ev || ev.ts == null) return false;
  if (ev.errorCode !== "invalid_credentials") return false;
  if (ev.grantType !== "password") return false;
  // path do log_attributes vem "/"; o verdadeiro está no JSON. Se vier e não for /token, ignora.
  if (ev.path && ev.path !== "/" && !ev.path.endsWith("/token")) return false;
  return true;
}

/** Agrupa as falhas de senha por IP e por e-mail (quando existir). */
export function agrupar(eventos) {
  const grupos = new Map();
  const add = (tipo, valor, ev) => {
    const chave = `${tipo}:${valor}`;
    if (!grupos.has(chave)) grupos.set(chave, { tipo, valor, eventos: [] });
    grupos.get(chave).eventos.push(ev);
  };
  for (const ev of eventos) {
    if (!ehSenhaErrada(ev)) continue;
    if (ev.ip) add("ip", ev.ip, ev);
    if (ev.email) add("email", ev.email, ev);
  }
  return [...grupos.values()];
}

/** Janela deslizante de dois ponteiros: maior contagem em até `janelaMs`. */
export function maiorJanela(tempos, janelaMs = JANELA_MS) {
  const t = [...tempos].sort((a, b) => a - b);
  let melhor = { total: 0, inicio: null, fim: null };
  let i = 0;
  for (let j = 0; j < t.length; j++) {
    while (t[j] - t[i] > janelaMs) i++;
    const total = j - i + 1;
    if (total > melhor.total) melhor = { total, inicio: t[i], fim: t[j] };
  }
  return melhor;
}

export function detectarPicos(eventos, { limiar = LIMIAR, janelaMs = JANELA_MS } = {}) {
  const picos = [];
  for (const g of agrupar(eventos)) {
    const j = maiorJanela(g.eventos.map((e) => e.ts), janelaMs);
    if (j.total >= limiar) {
      picos.push({ tipo: g.tipo, valor: g.valor, total: j.total, inicio: j.inicio, fim: j.fim });
    }
  }
  return picos.sort((a, b) => a.inicio - b.inicio || a.valor.localeCompare(b.valor));
}

function valorValidado(pico) {
  if (pico.tipo === "ip") {
    const ip = normalizarIp(pico.valor);
    if (!ip || ip !== pico.valor) throw new Error("IP inválido para o aviso");
    return ip;
  }
  if (pico.tipo === "email") {
    const email = validarEmail(pico.valor);
    if (!email || email !== pico.valor) throw new Error("E-mail inválido para o aviso");
    return email;
  }
  throw new Error("Tipo de agrupamento inválido");
}

/** Trecho estável usado na mensagem e no dedup. */
export function marcador(pico) {
  const v = valorValidado(pico);
  return pico.tipo === "ip" ? `(IP ${v})` : `(conta ${v})`;
}

export function montarMensagem(pico) {
  const m = marcador(pico);
  const total = Number.isInteger(pico.total) && pico.total > 0 ? pico.total : LIMIAR;
  const origem = pico.tipo === "ip" ? "do mesmo endereço" : "na mesma conta";
  return `Alguém errou a senha do painel ${total} vezes em 10 minutos, ${origem} ${m}. A conta não foi bloqueada.`;
}

/** Mensagem para o stdout do CI: e-mail mascarado. */
export function mensagemParaLog(pico) {
  if (pico.tipo === "email") {
    return montarMensagem(pico).replace(marcador(pico), `(conta ${mascararEmail(pico.valor)})`);
  }
  return montarMensagem(pico);
}

export function literalSql(valor) {
  const s = String(valor);
  if (/[\u0000-\u001f\\]/.test(s)) throw new Error("Valor com caractere proibido no SQL");
  return `'${s.replace(/'/g, "''")}'`;
}

function escaparLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function montarInsertSql(pico) {
  const mensagem = literalSql(montarMensagem(pico));
  const padrao = literalSql(`%${escaparLike(marcador(pico))}%`);
  return `insert into public.notifications (user_id, message, notification_type, link)
select distinct ur.user_id, ${mensagem}, '${TIPO_AVISO}', '/'
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
 where ur.role = 'admin'
   and p.deleted_at is null
   and coalesce(p.email, '') not ilike 'n8n@%'
   and not exists (
     select 1 from public.notifications n
      where n.user_id = ur.user_id
        and n.notification_type = '${TIPO_AVISO}'
        and n.created_at > now() - interval '30 minutes'
        and n.message like ${padrao}
   );`;
}

export const AVISOS_RECENTES_SQL = `select message, created_at from public.notifications
 where notification_type = '${TIPO_AVISO}'
   and created_at > now() - interval '30 minutes'`;

/** Remove picos que já têm aviso nos últimos 30 min (mesmo IP/e-mail). */
export function filtrarJaAvisados(picos, avisosRecentes, agora = Date.now(), dedupMs = DEDUP_MS) {
  const recentes = (avisosRecentes ?? []).filter((a) => {
    const t = parseTimestamp(a?.created_at);
    return typeof a?.message === "string" && (t == null || agora - t <= dedupMs);
  });
  return picos.filter((p) => !recentes.some((a) => a.message.includes(marcador(p))));
}

export function parsearRespostaLogs(json) {
  if (Array.isArray(json)) return json;
  if (json && json.error) {
    const msg = typeof json.error === "string" ? json.error : json.error.message || "erro";
    throw new Error(`API de logs respondeu erro: ${String(msg).slice(0, 300)}`);
  }
  if (json && Array.isArray(json.result)) return json.result;
  throw new Error("Resposta da API de logs em formato inesperado");
}

export function janelaLeitura(agora = Date.now(), duracaoMs = LEITURA_MS) {
  const fim = new Date(Math.ceil(agora / 60000) * 60000);
  const inicio = new Date(fim.getTime() - duracaoMs);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  return { inicio: iso(inicio), fim: iso(fim) };
}

// ---------- rede / banco ----------

async function buscarLogs({ projectId, token, agora = Date.now() }) {
  const { inicio, fim } = janelaLeitura(agora);
  const url = new URL(`https://api.supabase.com/v1/projects/${projectId}/analytics/endpoints/logs`);
  url.searchParams.set("sql", LOGS_SQL);
  url.searchParams.set("iso_timestamp_start", inicio);
  url.searchParams.set("iso_timestamp_end", fim);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`API de logs falhou com HTTP ${resp.status}`);
  return parsearRespostaLogs(await resp.json());
}

function rodarSql(sql) {
  return execFileSync("supabase", ["db", "query", "--linked", "--output", "json", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
}

function linhasDoJson(saida) {
  try {
    const j = JSON.parse(saida);
    if (Array.isArray(j)) return j;
    if (Array.isArray(j?.rows)) return j.rows;
  } catch {
    /* sem dedup local; o NOT EXISTS do insert segura */
  }
  return [];
}

// ---------- CLI ----------

function lerArgs(argv) {
  const opts = { write: false, fixture: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") opts.write = true;
    else if (a === "--dry-run") opts.write = false;
    else if (a === "--fixture") {
      opts.fixture = argv[++i];
      if (!opts.fixture) throw new Error("--fixture precisa de um arquivo");
    } else throw new Error(`Argumento desconhecido: ${a}`);
  }
  return opts;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = lerArgs(argv);
  let linhas;
  if (opts.fixture) {
    linhas = parsearRespostaLogs(JSON.parse(readFileSync(opts.fixture, "utf8")));
  } else {
    const projectId = env.SUPABASE_PROJECT_ID;
    const token = env.SUPABASE_ACCESS_TOKEN;
    if (!projectId || !/^[a-z0-9]{20}$/.test(projectId)) {
      throw new Error("SUPABASE_PROJECT_ID ausente ou em formato inválido");
    }
    if (!token) throw new Error("SUPABASE_ACCESS_TOKEN ausente");
    linhas = await buscarLogs({ projectId, token });
  }

  const eventos = linhas.map(parsearEvento).filter(Boolean);
  const falhas = eventos.filter(ehSenhaErrada).length;
  let picos = detectarPicos(eventos);
  console.log(`Linhas lidas: ${linhas.length}. Senhas erradas: ${falhas}. Picos: ${picos.length}.`);

  if (picos.length === 0) {
    console.log("Nenhum pico de senha errada. Nada a avisar.");
    return 0;
  }

  if (opts.write) {
    const recentes = linhasDoJson(rodarSql(AVISOS_RECENTES_SQL));
    const antes = picos.length;
    picos = filtrarJaAvisados(picos, recentes);
    if (antes !== picos.length) console.log(`Já avisados nos últimos 30 min: ${antes - picos.length}.`);
  }

  for (const p of picos) {
    const sql = montarInsertSql(p); // valida IP/e-mail antes de qualquer gravação
    console.log(`${opts.write ? "Gravando" : "[dry-run] Gravaria"}: ${mensagemParaLog(p)}`);
    if (opts.write) rodarSql(sql);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // Só a mensagem: nada de env, headers ou stack com contexto sensível.
      console.error(`Falha no alerta de senha errada: ${err?.message ?? "erro desconhecido"}`);
      process.exit(1);
    },
  );
}
