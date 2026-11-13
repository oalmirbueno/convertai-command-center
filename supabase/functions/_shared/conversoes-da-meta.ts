/**
 * API de Conversões da Meta para o CRM da empresa (13/11/2026): como o evento
 * é montado e como a resposta é lida. Formato conferido na documentação da
 * Meta em 13/11/2026 (Conversions API, "Using the API" e "Customer Information
 * Parameters"):
 *   POST https://graph.facebook.com/{versão}/{pixel}/events
 *   corpo: { data: [evento], access_token, test_event_code? }
 *   e-mail, telefone e nome vão com SHA-256 depois de normalizados; fbc, fbp,
 *   IP e navegador vão sem hash; event_time até 7 dias atrás; event_id evita
 *   contar duas vezes o mesmo evento (o Pixel da página manda o mesmo id).
 *
 * Puro: sem Deno, sem npm e sem banco. Só usa crypto.subtle e TextEncoder, que
 * existem no navegador, no Deno e no Node. Nada aqui registra ou devolve o token.
 */

/** Versão da Graph API usada no envio. Troque pelo segredo META_GRAPH_VERSION quando a Meta aposentar esta. */
export const VERSAO_DA_GRAPH = "v26.0";

export async function sha256Hex(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** E-mail como a Meta pede antes do hash: sem espaço nas pontas e em minúsculas. Vazio quando não é e-mail. */
export function normalizarEmail(v: unknown): string {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : "";
}

/**
 * Telefone como a Meta pede antes do hash: só dígitos, sem zeros à esquerda e
 * com o código do país. Número brasileiro sem o 55 (DDD + número, 10 ou 11
 * dígitos) ganha o 55. Vazio quando não parece telefone.
 */
export function normalizarTelefone(v: unknown, paisPadrao = "55"): string {
  let d = (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = paisPadrao + d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}

/** Nome e sobrenome como a Meta pede: minúsculas, sem pontuação. */
export function normalizarNome(v: unknown): { primeiro: string; ultimo: string } {
  const partes = (typeof v === "string" ? v : "")
    .toLowerCase()
    .replace(/[0-9.,;:!?()"'`´^~*_+=<>@#$%&|\\/[\]{}-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return { primeiro: partes[0] || "", ultimo: partes.length > 1 ? partes[partes.length - 1] : "" };
}

/** O fbc que a Meta espera quando só temos o fbclid do link: fb.1.<instante do clique em ms>.<fbclid>. */
export function montarFbc(fbclid: unknown, clicadoEmMs: unknown): string {
  const id = typeof fbclid === "string" ? fbclid.trim() : "";
  const instante = Math.floor(Number(clicadoEmMs));
  if (!/^[A-Za-z0-9_.-]{8,500}$/.test(id) || !isFinite(instante) || instante <= 0) return "";
  return `fb.1.${instante}.${id}`;
}

/** Uma linha da fila crm_conversoes, como crm_conversoes_pegar devolve. */
export interface ConversaoDaFila {
  id: string;
  conta_id: string;
  lead_id: string;
  evento: "Lead" | "Purchase";
  valor: number | string;
  dados: Record<string, unknown> | null;
  tentativas: number;
  criado_em: string;
  nome: string | null;
  email: string | null;
  whatsapp: string | null;
}

const textoDe = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * O evento no formato da API de Conversões. Só entra o que existe: identificador
 * sem valor fica de fora (a Meta recusa hash de texto vazio).
 */
export async function montarEventoDaMeta(c: ConversaoDaFila, agora = Date.now()): Promise<Record<string, unknown>> {
  const dados = c.dados && typeof c.dados === "object" ? c.dados : {};
  const criado = new Date(c.criado_em).getTime();
  const instante = isFinite(criado) && criado > 0 ? Math.min(criado, agora) : agora;

  const usuario: Record<string, unknown> = {};
  const email = normalizarEmail(c.email);
  if (email) usuario.em = [await sha256Hex(email)];
  const telefone = normalizarTelefone(c.whatsapp);
  if (telefone) usuario.ph = [await sha256Hex(telefone)];
  const nome = normalizarNome(c.nome);
  if (nome.primeiro) usuario.fn = [await sha256Hex(nome.primeiro)];
  if (nome.ultimo) usuario.ln = [await sha256Hex(nome.ultimo)];
  if (c.lead_id) usuario.external_id = [await sha256Hex(String(c.lead_id))];
  const fbc = montarFbc(dados.fbclid, dados.clicado_em || instante);
  if (fbc) usuario.fbc = fbc;
  const fbp = textoDe(dados.fbp, 100);
  if (fbp) usuario.fbp = fbp;

  const navegador = textoDe(dados.navegador, 300);
  const ip = textoDe(dados.ip, 45);
  const pagina = textoDe(dados.pagina, 300);
  // Evento de site pede o navegador de quem preencheu. A venda acontece dentro do CRM, sem navegador.
  const doSite = c.evento === "Lead" && !!navegador;
  if (doSite) {
    usuario.client_user_agent = navegador;
    if (ip) usuario.client_ip_address = ip;
  }

  const evento: Record<string, unknown> = {
    event_name: c.evento,
    event_time: Math.floor(instante / 1000),
    event_id: c.id,
    action_source: doSite ? "website" : "system_generated",
    user_data: usuario,
  };
  if (doSite && /^https?:\/\//.test(pagina)) evento.event_source_url = pagina;
  if (c.evento === "Purchase") {
    const valor = Number(c.valor);
    evento.custom_data = { currency: "BRL", value: isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : 0, event_source: "crm", lead_event_source: "Aceleriq CRM" };
  } else {
    const formulario = textoDe(dados.formulario, 80);
    evento.custom_data = { event_source: "crm", lead_event_source: "Aceleriq CRM", ...(formulario ? { content_name: formulario } : {}) };
  }
  return evento;
}

/** O endereço do envio. O token NÃO vai no endereço: vai no corpo, para não ficar em registro de acesso. */
export function enderecoDosEventos(pixel: string, versao = VERSAO_DA_GRAPH): string {
  const v = /^v[0-9]{1,3}\.[0-9]$/.test(versao) ? versao : VERSAO_DA_GRAPH;
  if (!/^[0-9]{5,25}$/.test(pixel)) throw new Error("pixel invalido");
  return `https://graph.facebook.com/${v}/${pixel}/events`;
}

export function corpoDoEnvio(eventos: Array<Record<string, unknown>>, token: string, codigoDeTeste?: string | null): Record<string, unknown> {
  return { data: eventos, access_token: token, ...(codigoDeTeste ? { test_event_code: codigoDeTeste } : {}) };
}

export interface ResultadoDaMeta {
  ok: boolean;
  /** Não adianta tentar de novo sem alguém corrigir (token, pixel, evento malformado). */
  definitivo: boolean;
  erro: string;
}

/** Códigos da Graph API que são falha passageira ou limite de chamadas: vale tentar de novo. */
const PASSAGEIROS = [1, 2, 4, 17, 32, 341, 613, 80004];
/** Códigos de token ou permissão: só resolve trocando o token. */
const DE_TOKEN = [10, 102, 190, 200, 270];

/** Tira do texto qualquer coisa com cara de token antes de guardar ou registrar. */
export function semSegredo(texto: string, token = ""): string {
  let t = String(texto || "");
  if (token) t = t.split(token).join("[token]");
  return t.replace(/access_token=[^&\s"]+/gi, "access_token=[token]").replace(/EAA[A-Za-z0-9]{20,}/g, "[token]").slice(0, 280);
}

/** Lê a resposta da Meta: enviado, tentar de novo ou erro que precisa de gente. */
export function lerRespostaDaMeta(status: number, corpo: unknown, token = ""): ResultadoDaMeta {
  const o = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  const erro = o.error && typeof o.error === "object" ? (o.error as Record<string, unknown>) : null;
  if (status >= 200 && status < 300 && !erro) {
    const recebidos = Number(o.events_received);
    if (!isFinite(recebidos) || recebidos >= 1) return { ok: true, definitivo: false, erro: "" };
    return { ok: false, definitivo: false, erro: "A Meta respondeu sem receber o evento." };
  }
  const codigo = erro ? Number(erro.code) : NaN;
  const mensagem = semSegredo(String((erro && (erro.error_user_msg || erro.message)) || ""), token);
  if (DE_TOKEN.indexOf(codigo) >= 0 || status === 401 || status === 403) {
    return { ok: false, definitivo: true, erro: "A Meta recusou o token. Gere um novo no Gerenciador de Eventos e salve de novo." };
  }
  if (status === 429 || status >= 500 || PASSAGEIROS.indexOf(codigo) >= 0 || (erro && erro.is_transient === true)) {
    return { ok: false, definitivo: false, erro: mensagem || "A Meta não respondeu agora." };
  }
  if (status === 404 || codigo === 803) {
    return { ok: false, definitivo: true, erro: "A Meta não achou esse Pixel. Confira o ID do Pixel." };
  }
  return { ok: false, definitivo: true, erro: mensagem || `A Meta recusou o evento (${status}).` };
}
