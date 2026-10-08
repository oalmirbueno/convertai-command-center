// Ponte do painel Aceleriq para as sessões reais do Hermes (Central de Autonomia, 08/10/2026).
//
// Roda no servidor do Hermes, ao lado da ponte MCP (mesma conta de serviço e
// mesmo cofre de credenciais do systemd). Só o painel fala com ela, pela
// função gestor do Supabase, com um token próprio. Ela repassa um conjunto
// FECHADO de chamadas para a API local do Hermes (127.0.0.1:8642):
//   GET  /painel-api/saude
//   GET  /painel-api/sessoes?limite=&busca=
//   GET  /painel-api/sessoes/:id
//   GET  /painel-api/sessoes/:id/mensagens?limite=
//   GET  /painel-api/sessoes/:id/estado
//   POST /painel-api/sessoes                 { titulo }
//   POST /painel-api/sessoes/:id/continuar   (fork de sessão do Desktop ou outra; a original fica intacta)
//   POST /painel-api/sessoes/:id/enviar      { texto } -> 202; a resposta chega nas mensagens
// Regras:
// - conversas do WhatsApp (clientes) e de Telegram não aparecem;
// - só se escreve em sessão criada pela API (as do painel); sessão do Desktop
//   se continua por fork, nunca disputando a sessão aberta no app;
// - uma resposta por vez em cada sessão (409 enquanto o Hermes trabalha);
// - nada de raciocínio interno nem prompt de sistema sai daqui;
// - nenhum conteúdo de conversa vai para o log.

import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

// Credenciais do cofre do systemd, lidas só quando o serviço sobe (os testes importam o arquivo sem elas).
let API_KEY = "";
let TOKEN = "";
const API = process.env.HERMES_API_URL || "http://127.0.0.1:8642";
const HOST = process.env.PONTE_HOST || "172.16.0.1";
const PORT = Number(process.env.PONTE_PORT || 9121);
const PREFIXO = "/painel-api";

export const ORIGENS_VISIVEIS = new Set(["desktop", "api_server", "cli", "cron", "kanban", "subagent", "tool", "oneshot"]);
export const ORIGENS_QUE_RECEBEM = new Set(["api_server"]);
const ID_VALIDO = /^[A-Za-z0-9_.:-]{1,160}$/;
const MAX_TEXTO = 12000;
const TEMPO_DO_TURNO_MS = 30 * 60_000;

/** sessão -> { desde, erro, fim } */
const turnos = new Map();

function seguro(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function responder(res, status, corpo) {
  const t = JSON.stringify(corpo);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(t);
}

async function hermes(caminho, opcoes = {}) {
  const r = await fetch(`${API}${caminho}`, {
    method: opcoes.method || "GET",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    signal: AbortSignal.timeout(opcoes.tempo || 20_000),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }
  return { status: r.status, json };
}

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let total = 0;
    const partes = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > 64 * 1024) { falha(new Error("grande")); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => {
      try { ok(partes.length ? JSON.parse(Buffer.concat(partes).toString("utf8")) : {}); } catch { ok(null); }
    });
    req.on("error", falha);
  });
}

export function sessaoParaOPainel(s) {
  const origem = String(s.source || "");
  return {
    id: s.id,
    titulo: s.title || s.preview || "Sessão sem título",
    origem,
    iniciada_em: s.started_at ?? null,
    ultima_atividade: s.last_active ?? s.started_at ?? null,
    mensagens: s.message_count ?? 0,
    ferramentas: s.tool_call_count ?? 0,
    arquivada: !!s.archived,
    fixada: !!s.pinned,
    pai: s.parent_session_id || null,
    pode_enviar: ORIGENS_QUE_RECEBEM.has(origem),
    ocupada: turnos.has(s.id) && !turnos.get(s.id).fim,
  };
}

function textoDoConteudo(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p && (p.text || p.content) ? String(p.text || p.content) : "")).filter(Boolean).join("\n");
  return c == null ? "" : String(c);
}

export function mensagemParaOPainel(m) {
  const chamadas = Array.isArray(m.tool_calls) ? m.tool_calls.map((t) => (t && t.function && t.function.name) || (t && t.name) || "").filter(Boolean) : [];
  return {
    id: m.id ?? null,
    papel: m.role,
    texto: textoDoConteudo(m.content).slice(0, 20_000),
    ferramenta: m.tool_name || null,
    chamadas,
    quando: m.timestamp ?? null,
  };
}

async function sessaoVisivel(id) {
  if (!ID_VALIDO.test(id)) return { erro: [400, { error: "sessao_invalida" }] };
  const r = await hermes(`/api/sessions/${encodeURIComponent(id)}`);
  if (r.status === 404) return { erro: [404, { error: "sessao_inexistente" }] };
  if (r.status !== 200 || !r.json) return { erro: [502, { error: "hermes_indisponivel", status: r.status }] };
  const s = r.json.session || r.json;
  if (!ORIGENS_VISIVEIS.has(String(s.source || ""))) return { erro: [403, { error: "sessao_privada" }] };
  return { sessao: s };
}

async function rota(req, res) {
  const url = new URL(req.url, "http://ponte");
  if (!url.pathname.startsWith(`${PREFIXO}/`)) return responder(res, 404, { error: "fora_da_ponte" });
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ") || !seguro(auth.slice(7).trim(), TOKEN)) return responder(res, 401, { error: "nao_autorizado" });
  const partes = url.pathname.slice(PREFIXO.length + 1).split("/").filter(Boolean);
  const metodo = req.method || "GET";

  if (metodo === "GET" && partes[0] === "saude" && partes.length === 1) {
    const r = await hermes("/health", { tempo: 8000 });
    return responder(res, 200, { ok: r.status === 200, hermes: r.json?.status || r.status });
  }

  if (partes[0] !== "sessoes") return responder(res, 404, { error: "rota_desconhecida" });

  if (metodo === "GET" && partes.length === 1) {
    const limite = Math.min(Math.max(Number(url.searchParams.get("limite")) || 40, 1), 100);
    const busca = String(url.searchParams.get("busca") || "").trim().toLowerCase().slice(0, 80);
    const r = await hermes(`/api/sessions?limit=${Math.min(limite * 3, 200)}`);
    if (r.status !== 200 || !r.json) return responder(res, 502, { error: "hermes_indisponivel", status: r.status });
    const lista = (Array.isArray(r.json.data) ? r.json.data : [])
      .filter((s) => ORIGENS_VISIVEIS.has(String(s.source || "")) && !s.hidden)
      .map(sessaoParaOPainel)
      .filter((s) => !busca || String(s.titulo).toLowerCase().includes(busca))
      .slice(0, limite);
    return responder(res, 200, { sessoes: lista });
  }

  if (metodo === "POST" && partes.length === 1) {
    const corpo = await lerCorpo(req);
    const titulo = String((corpo && corpo.titulo) || "").replace(/\s+/g, " ").trim().slice(0, 100) || "Conversa do painel";
    const r = await hermes("/api/sessions", { method: "POST", body: { title: `Central · ${titulo}`, source: "api_server" } });
    if (r.status !== 201 && r.status !== 200) return responder(res, 502, { error: "sessao_nao_criada", status: r.status });
    const s = r.json.session || r.json;
    return responder(res, 201, { sessao: sessaoParaOPainel({ ...s, source: s.source || "api_server" }) });
  }

  const id = decodeURIComponent(partes[1] || "");
  const { sessao, erro } = await sessaoVisivel(id);
  if (erro) return responder(res, erro[0], erro[1]);

  if (metodo === "GET" && partes.length === 2) return responder(res, 200, { sessao: sessaoParaOPainel(sessao) });

  if (metodo === "GET" && partes[2] === "mensagens") {
    const limite = Math.min(Math.max(Number(url.searchParams.get("limite")) || 80, 1), 300);
    const r = await hermes(`/api/sessions/${encodeURIComponent(id)}/messages?limit=${limite}&order=latest`);
    if (r.status !== 200 || !r.json) return responder(res, 502, { error: "hermes_indisponivel", status: r.status });
    const msgs = (Array.isArray(r.json.data) ? r.json.data : []).filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool").map(mensagemParaOPainel);
    return responder(res, 200, { sessao: sessaoParaOPainel(sessao), mensagens: msgs });
  }

  if (metodo === "GET" && partes[2] === "estado") {
    const t = turnos.get(id);
    return responder(res, 200, { ocupada: !!t && !t.fim, desde: t?.desde || null, fim: t?.fim || null, erro: t?.erro || null });
  }

  if (metodo === "POST" && partes[2] === "continuar") {
    const r = await hermes(`/api/sessions/${encodeURIComponent(id)}/fork`, { method: "POST", body: { title: `Central · continuação de ${String(sessao.title || id).slice(0, 60)}` } });
    if (r.status !== 201 && r.status !== 200) return responder(res, 502, { error: "fork_falhou", status: r.status });
    const nova = r.json.session || r.json;
    return responder(res, 201, { sessao: sessaoParaOPainel({ ...nova, source: nova.source || "api_server" }) });
  }

  if (metodo === "POST" && partes[2] === "enviar") {
    if (!ORIGENS_QUE_RECEBEM.has(String(sessao.source || ""))) return responder(res, 409, { error: "sessao_so_leitura", mensagem: "Esta sessão é de outro app. Use Continuar para seguir dela no painel." });
    const atual = turnos.get(id);
    if (atual && !atual.fim) return responder(res, 409, { error: "hermes_ocupado", mensagem: "O Hermes ainda está respondendo nesta sessão." });
    const corpo = await lerCorpo(req);
    const texto = String((corpo && corpo.texto) || "").trim().slice(0, MAX_TEXTO);
    if (!texto) return responder(res, 400, { error: "texto_vazio" });
    const turno = { desde: new Date().toISOString(), fim: null, erro: null };
    turnos.set(id, turno);
    // O turno roda em segundo plano (pode levar minutos); a resposta aparece nas mensagens da sessão.
    hermes(`/api/sessions/${encodeURIComponent(id)}/chat`, { method: "POST", body: { message: texto, author: { name: "Almir (painel Aceleriq)" } }, tempo: TEMPO_DO_TURNO_MS })
      .then((r) => { turno.erro = r.status === 200 ? null : `hermes_${r.status}`; })
      .catch((e) => { turno.erro = e && e.name === "TimeoutError" ? "tempo_esgotado" : "falha_de_rede"; })
      .finally(() => { turno.fim = new Date().toISOString(); });
    return responder(res, 202, { aceito: true, desde: turno.desde });
  }

  return responder(res, 404, { error: "rota_desconhecida" });
}

if (process.argv[1] && process.argv[1].endsWith("painel_ponte.mjs")) {
  const CRED = process.env.CREDENTIALS_DIRECTORY || "";
  API_KEY = readFileSync(`${CRED}/hermes-api-key`, "utf8").trim();
  TOKEN = readFileSync(`${CRED}/painel-token`, "utf8").trim();
  if (TOKEN.length < 32) throw new Error("painel-token curto demais");
  http.createServer((req, res) => {
    rota(req, res).catch((e) => {
      console.error("painel-ponte: falha", e && e.name);
      if (!res.headersSent) responder(res, 500, { error: "falha_interna" });
    });
  }).listen(PORT, HOST, () => console.log(`painel-ponte ouvindo em ${HOST}:${PORT}`));
}
