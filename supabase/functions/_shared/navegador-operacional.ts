/**
 * Navegador operacional (09/10/2026, lote C): a ferramenta que Hermes, Gestor e a equipe
 * compartilham para usar o navegador remoto real de cada cliente (Browserbase).
 *
 * - Um navegador por cliente, no perfil (contexto) dele: o login feito uma vez pela pessoa
 *   fica guardado e vale para os agentes; nunca é usado em outro cliente.
 * - Comando pelo protocolo oficial de conexão (CDP, no connectUrl que o provedor devolve na
 *   hora; o endereço nunca é gravado nem registrado). Com keepAlive (plano pago) a sessão
 *   continua viva quando o agente desconecta, e a equipe acompanha ao vivo na Central.
 * - Um agente por vez: trava na sessão (comandada_por + trava_ate). Outro agente recebe
 *   "sessão ocupada" com quem está comandando.
 * - Toda ação vira uma linha em navegador_acoes, com URL, título, trecho lido e a captura
 *   de tela (Storage, bucket mesa). É a evidência.
 * - Leitura (navegar, ler, pesquisar, capturar, abas) é livre. Clique e digitação também,
 *   mas clicar em algo que publica, envia, paga, assina ou apaga exige uma aprovação já
 *   aprovada (operator_approvals) e digitar senha nunca: login é sempre da pessoa.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ErroDoProvedor, type Provedor } from "../navegador-remoto/provedor.ts";

export type AgenteDoNavegador = "hermes" | "gestor" | "equipe";
export const ACOES_DO_NAVEGADOR = ["navegar", "ler", "pesquisar", "capturar", "clicar", "digitar", "abas", "nova_aba"] as const;
export type AcaoDoNavegador = (typeof ACOES_DO_NAVEGADOR)[number];

export class ErroDoNavegador extends Error {
  constructor(public codigo: string, mensagem: string, public status = 400) { super(mensagem); }
}

/** Texto de alvo que publica, envia, paga, assina ou apaga: só com aprovação aprovada. */
export const ALVO_SENSIVEL = /\b(publicar|publique|postar|poste|compartilhar|enviar|envie|mandar mensagem|send|publish|post|pagar|pague|pagamento|comprar|compre|finalizar compra|checkout|assinar|assine|excluir|exclua|apagar|apague|deletar|delete|remover|ativar|impulsionar|turbinar|boost|transferir|confirmar pagamento|salvar e publicar)\b/i;

/** Quanto tempo a trava vale sem renovar (o agente solta ao terminar; se cair, expira sozinha). */
export const TRAVA_S = 120;
/** Sessão sem atividade há mais que isto: o zelador encerra (economiza as horas do plano). */
export const OCIOSA_MIN = 20;
const BUSCA = "https://html.duckduckgo.com/html/?q=";

export function urlSegura(v: unknown): string | null {
  const t = String(v || "").trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- CDP (cliente mínimo)

type Mensagem = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string }; sessionId?: string };

export class Cdp {
  private id = 0;
  private pendentes = new Map<number, { ok: (r: Record<string, unknown>) => void; falha: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      let m: Mensagem;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (typeof m.id === "number" && this.pendentes.has(m.id)) {
        const p = this.pendentes.get(m.id)!;
        this.pendentes.delete(m.id);
        if (m.error) p.falha(new ErroDoNavegador("cdp_erro", `O navegador recusou: ${String(m.error.message || "erro").slice(0, 160)}`));
        else p.ok(m.result || {});
      }
    };
    ws.onclose = () => {
      for (const p of this.pendentes.values()) p.falha(new ErroDoNavegador("conexao_fechada", "A conexão com o navegador caiu."));
      this.pendentes.clear();
    };
  }

  static abrir(url: string, ms = 15_000): Promise<Cdp> {
    return new Promise((ok, falha) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => { try { ws.close(); } catch { /* nada */ } falha(new ErroDoNavegador("conexao_demorou", "O navegador não respondeu a tempo.")); }, ms);
      ws.onopen = () => { clearTimeout(t); ok(new Cdp(ws)); };
      ws.onerror = () => { clearTimeout(t); falha(new ErroDoNavegador("conexao_falhou", "Não consegui conectar ao navegador remoto.")); };
    });
  }

  enviar(method: string, params: Record<string, unknown> = {}, sessionId?: string, ms = 30_000): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((ok, falha) => {
      const t = setTimeout(() => { this.pendentes.delete(id); falha(new ErroDoNavegador("comando_demorou", `O navegador demorou para ${method}.`)); }, ms);
      this.pendentes.set(id, { ok: (r) => { clearTimeout(t); ok(r); }, falha: (e) => { clearTimeout(t); falha(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  fechar() {
    try { this.ws.close(); } catch { /* nada */ }
  }
}

type Aba = { id: string; titulo: string; url: string };

async function abas(c: Cdp): Promise<Aba[]> {
  const r = await c.enviar("Target.getTargets");
  const lista = (Array.isArray(r.targetInfos) ? r.targetInfos : []) as Array<Record<string, unknown>>;
  return lista.filter((t) => t.type === "page").map((t) => ({ id: String(t.targetId), titulo: String(t.title || ""), url: String(t.url || "") }));
}

async function anexar(c: Cdp, alvo: string): Promise<string> {
  const r = await c.enviar("Target.attachToTarget", { targetId: alvo, flatten: true });
  const s = String(r.sessionId || "");
  if (!s) throw new ErroDoNavegador("aba_sem_sessao", "Não consegui abrir a aba para comandar.");
  await c.enviar("Page.enable", {}, s).catch(() => undefined);
  await c.enviar("Runtime.enable", {}, s).catch(() => undefined);
  return s;
}

async function avaliar<T>(c: Cdp, s: string, expressao: string): Promise<T> {
  const r = await c.enviar("Runtime.evaluate", { expression: expressao, returnByValue: true, awaitPromise: true }, s);
  if (r.exceptionDetails) throw new ErroDoNavegador("pagina_recusou", "A página não deixou ler ou agir agora.");
  return ((r.result as { value?: T } | undefined) || {}).value as T;
}

async function esperarCarregar(c: Cdp, s: string, ms = 15_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const estado = await avaliar<string>(c, s, "document.readyState").catch(() => "");
    if (estado === "complete") return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

const LER_PAGINA = `(() => {
  const texto = (document.body && document.body.innerText || "").replace(/\\n{3,}/g, "\\n\\n").slice(0, 12000);
  const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 400)
    .map((a) => ({ texto: (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ").slice(0, 120), href: a.href }))
    .filter((l) => l.texto && /^https?:/.test(l.href)).slice(0, 40);
  return { url: location.href, titulo: document.title, texto, links };
})()`;

const LER_BUSCA = `(() => Array.from(document.querySelectorAll(".result")).slice(0, 10).map((r) => {
  const a = r.querySelector(".result__a");
  const s = r.querySelector(".result__snippet");
  let href = a ? a.href : "";
  try { const u = new URL(href); const real = u.searchParams.get("uddg"); if (real) href = real; } catch (e) {}
  return { titulo: a ? a.innerText.trim() : "", link: href, trecho: s ? s.innerText.trim() : "" };
}).filter((x) => x.titulo && x.link))()`;

/** Acha o elemento para clicar (por seletor ou pelo texto visível) e devolve o texto dele, sem clicar. */
function scriptDoAlvo(seletor: string | null, texto: string | null, clicar: boolean): string {
  return `(() => {
    const visivel = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const nome = (e) => ((e.innerText || e.value || e.getAttribute("aria-label") || e.getAttribute("title") || "") + "").trim().replace(/\\s+/g, " ");
    let el = null;
    const sel = ${JSON.stringify(seletor)};
    const txt = ${JSON.stringify(texto ? texto.toLowerCase() : null)};
    if (sel) el = document.querySelector(sel);
    if (!el && txt) {
      const cands = Array.from(document.querySelectorAll("a, button, [role=button], input[type=submit], input[type=button], [role=link], [role=tab], [role=menuitem], summary, label"));
      el = cands.find((e) => visivel(e) && nome(e).toLowerCase() === txt) || cands.find((e) => visivel(e) && nome(e).toLowerCase().includes(txt)) || null;
    }
    if (!el) return { achou: false };
    const rotulo = nome(el).slice(0, 160);
    if (${clicar ? "true" : "false"}) { el.scrollIntoView({ block: "center" }); el.click(); }
    return { achou: true, rotulo };
  })()`;
}

function scriptDeDigitar(seletor: string | null, campo: string | null, valor: string): string {
  return `(() => {
    const sel = ${JSON.stringify(seletor)};
    const campo = ${JSON.stringify(campo ? campo.toLowerCase() : null)};
    let el = sel ? document.querySelector(sel) : null;
    if (!el && campo) {
      const cands = Array.from(document.querySelectorAll("input, textarea, [contenteditable=true]"));
      const rot = (e) => [e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("name"), e.id && (document.querySelector('label[for="' + e.id + '"]') || {}).innerText].filter(Boolean).join(" ").toLowerCase();
      el = cands.find((e) => rot(e).includes(campo)) || null;
    }
    if (!el) return { achou: false };
    if ((el.getAttribute("type") || "").toLowerCase() === "password") return { achou: true, senha: true };
    el.focus();
    if (el.isContentEditable) { el.textContent = ${JSON.stringify(valor)}; }
    else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, "value").set;
      set.call(el, ${JSON.stringify(valor)});
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { achou: true, rotulo: (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "campo").slice(0, 120) };
  })()`;
}

// ---------------------------------------------------------------- sessão do cliente, trava e registro

type LinhaDaSessao = { id: string; client_id: string; contexto_id: string; sessao_externa: string; estado: string; comandada_por: string | null; trava_ate: string | null };

/** O navegador do cliente: reaproveita a sessão viva; senão abre uma nova no perfil dele. */
export async function sessaoDoCliente(
  db: SupabaseClient, p: Provedor, o: { clientId: string; origem: "central" | "gestor" | "hermes"; pedido?: string | null; userId?: string | null },
): Promise<{ sessao: LinhaDaSessao; nova: boolean }> {
  const { data: aberta } = await db.from("navegador_sessoes").select("id, client_id, contexto_id, sessao_externa, estado, comandada_por, trava_ate").eq("client_id", o.clientId).eq("estado", "aberta").order("aberta_em", { ascending: false }).limit(1).maybeSingle();
  if (aberta) {
    const viva = await p.verSessao((aberta as LinhaDaSessao).sessao_externa).catch(() => null);
    if (viva && viva.rodando) return { sessao: aberta as LinhaDaSessao, nova: false };
    await db.from("navegador_sessoes").update({ estado: "encerrada", encerrada_em: new Date().toISOString(), comandada_por: null, trava_ate: null }).eq("id", (aberta as LinhaDaSessao).id);
  }
  const { data: cli } = await db.from("profiles").select("id").eq("id", o.clientId).maybeSingle();
  if (!cli) throw new ErroDoNavegador("cliente_invalido", "Esse cliente não existe no cadastro.");
  let { data: ctx } = await db.from("navegador_contextos").select("id, contexto_externo").eq("client_id", o.clientId).eq("provedor", "browserbase").maybeSingle();
  if (!ctx) {
    const externo = await p.criarContexto(`aceleriq-cliente-${o.clientId}`);
    const { data: novo, error } = await db.from("navegador_contextos").insert({ client_id: o.clientId, provedor: "browserbase", contexto_externo: externo, criado_por: o.userId || null }).select("id, contexto_externo").single();
    if (error || !novo) throw new ErroDoNavegador("contexto_nao_gravado", "O perfil do navegador do cliente foi criado, mas o registro falhou. Tente de novo.", 503);
    ctx = novo;
  }
  const c = ctx as { id: string; contexto_externo: string };
  const externa = await p.criarSessao(c.contexto_externo);
  const { data: reg, error } = await db.from("navegador_sessoes").insert({ client_id: o.clientId, contexto_id: c.id, sessao_externa: externa, origem: o.origem, pedido: o.pedido ? String(o.pedido).slice(0, 500) : null, aberta_por: o.userId || null, ultima_atividade: new Date().toISOString() }).select("id, client_id, contexto_id, sessao_externa, estado, comandada_por, trava_ate").single();
  if (error || !reg) {
    await p.encerrar(externa).catch(() => undefined);
    throw new ErroDoNavegador("sessao_nao_gravada", "Não consegui registrar a sessão: fechei para não ficar solta.", 503);
  }
  await db.from("navegador_contextos").update({ usado_em: new Date().toISOString() }).eq("id", c.id);
  return { sessao: reg as LinhaDaSessao, nova: true };
}

/** Trava a sessão para um agente (ou renova a dele). Ocupada por outro: erro com quem está comandando. */
export async function travar(db: SupabaseClient, sessaoId: string, agente: AgenteDoNavegador): Promise<void> {
  const agora = new Date();
  const ate = new Date(agora.getTime() + TRAVA_S * 1000).toISOString();
  const { data } = await db.from("navegador_sessoes").update({ comandada_por: agente, trava_ate: ate, ultima_atividade: agora.toISOString() })
    .eq("id", sessaoId)
    .or(`trava_ate.is.null,trava_ate.lt.${agora.toISOString()},comandada_por.eq.${agente}`)
    .select("id");
  if (!data || !(data as unknown[]).length) {
    const { data: s } = await db.from("navegador_sessoes").select("comandada_por, trava_ate").eq("id", sessaoId).maybeSingle();
    const quem = (s as { comandada_por: string | null } | null)?.comandada_por || "outro agente";
    throw new ErroDoNavegador("sessao_ocupada", `O navegador deste cliente está sendo comandado por ${quem} agora. Tente de novo em instantes.`, 409);
  }
}

export async function soltar(db: SupabaseClient, sessaoId: string, agente: AgenteDoNavegador): Promise<void> {
  await db.from("navegador_sessoes").update({ comandada_por: null, trava_ate: null, ultima_atividade: new Date().toISOString() }).eq("id", sessaoId).eq("comandada_por", agente);
}

/** Aprovação válida para ação sensível (operator_approvals aprovada e no prazo). */
export async function aprovacaoValida(db: SupabaseClient, id: unknown): Promise<boolean> {
  const t = String(id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return false;
  const { data } = await db.from("operator_approvals").select("status, valid_until").eq("id", t).maybeSingle();
  const a = data as { status: string; valid_until: string | null } | null;
  return !!a && a.status === "aprovado" && (!a.valid_until || new Date(a.valid_until).getTime() > Date.now());
}

export type PedidoAoNavegador = {
  clientId: string;
  agente: AgenteDoNavegador;
  acao: AcaoDoNavegador;
  url?: string | null;
  termos?: string | null;
  seletor?: string | null;
  texto?: string | null;
  campo?: string | null;
  valor?: string | null;
  aba?: number | null;
  pedido?: string | null;
  aprovacaoId?: string | null;
  userId?: string | null;
};

export type ResultadoDoNavegador = {
  ok: boolean;
  acao: AcaoDoNavegador;
  sessao_id: string;
  url: string | null;
  titulo: string | null;
  texto: string | null;
  links?: Array<{ texto: string; href: string }>;
  resultados?: Array<{ titulo: string; link: string; trecho: string }>;
  abas?: Array<{ indice: number; titulo: string; url: string }>;
  evidencia: string | null;
  acao_id: string | null;
  aviso?: string;
};

/**
 * Faz UMA ação no navegador do cliente: abre ou reaproveita a sessão, trava para o agente,
 * conecta, age, lê, captura a tela, registra e solta. A sessão continua viva (keepAlive) para
 * a equipe acompanhar e para a próxima ação.
 */
export async function usarNavegador(db: SupabaseClient, p: Provedor, pedido: PedidoAoNavegador): Promise<ResultadoDoNavegador> {
  if (!(ACOES_DO_NAVEGADOR as readonly string[]).includes(pedido.acao)) throw new ErroDoNavegador("acao_invalida", "Ação do navegador desconhecida.");
  const origem = pedido.agente === "equipe" ? "central" : pedido.agente;
  const { sessao } = await sessaoDoCliente(db, p, { clientId: pedido.clientId, origem, pedido: pedido.pedido, userId: pedido.userId });
  await travar(db, sessao.id, pedido.agente);
  const inicio = Date.now();
  let c: Cdp | null = null;
  const reg: Record<string, unknown> = { sessao_id: sessao.id, client_id: pedido.clientId, agente: pedido.agente, acao: pedido.acao, pedido: pedido.pedido ? String(pedido.pedido).slice(0, 500) : null, aprovacao_id: pedido.aprovacaoId || null };
  try {
    c = await Cdp.abrir(await p.conectar(sessao.sessao_externa));
    let lista = await abas(c);
    let alvo: Aba | null = null;
    if (pedido.acao === "nova_aba") {
      const url = urlSegura(pedido.url);
      if (!url) throw new ErroDoNavegador("url_invalida", "Endereço inválido (só http ou https, sem usuário e senha).");
      const r = await c.enviar("Target.createTarget", { url });
      lista = await abas(c);
      alvo = lista.find((a) => a.id === String(r.targetId)) || null;
    } else {
      const i = typeof pedido.aba === "number" && pedido.aba >= 0 ? pedido.aba : 0;
      alvo = lista[i] || lista[0] || null;
      if (!alvo) {
        const r = await c.enviar("Target.createTarget", { url: "about:blank" });
        lista = await abas(c);
        alvo = lista.find((a) => a.id === String(r.targetId)) || lista[0] || null;
      }
    }
    if (!alvo) throw new ErroDoNavegador("sem_aba", "O navegador não tem aba aberta.");
    if (pedido.acao === "abas") {
      const res: ResultadoDoNavegador = { ok: true, acao: "abas", sessao_id: sessao.id, url: alvo.url, titulo: alvo.titulo, texto: null, abas: lista.map((a, i) => ({ indice: i, titulo: a.titulo, url: a.url })), evidencia: null, acao_id: null };
      res.acao_id = await registrar(db, { ...reg, ok: true, url: alvo.url, titulo: alvo.titulo, resultado: lista.map((a, i) => `${i}: ${a.titulo || a.url}`).join("\n").slice(0, 2000), duracao_ms: Date.now() - inicio });
      return res;
    }
    const s = await anexar(c, alvo.id);
    let aviso: string | undefined;
    let resultados: ResultadoDoNavegador["resultados"];
    if (pedido.acao === "navegar") {
      const url = urlSegura(pedido.url);
      if (!url) throw new ErroDoNavegador("url_invalida", "Endereço inválido (só http ou https, sem usuário e senha).");
      reg.alvo = url;
      await c.enviar("Page.navigate", { url }, s);
      await esperarCarregar(c, s);
    } else if (pedido.acao === "pesquisar") {
      const termos = String(pedido.termos || "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (!termos) throw new ErroDoNavegador("sem_termos", "Diga o que pesquisar.");
      reg.alvo = termos;
      await c.enviar("Page.navigate", { url: `${BUSCA}${encodeURIComponent(termos)}` }, s);
      await esperarCarregar(c, s);
      resultados = (await avaliar<ResultadoDoNavegador["resultados"]>(c, s, LER_BUSCA).catch(() => [])) || [];
    } else if (pedido.acao === "clicar") {
      const seletor = pedido.seletor ? String(pedido.seletor).slice(0, 300) : null;
      const texto = pedido.texto ? String(pedido.texto).slice(0, 160) : null;
      if (!seletor && !texto) throw new ErroDoNavegador("sem_alvo", "Diga o texto do botão ou link (ou o seletor) para clicar.");
      reg.alvo = texto || seletor;
      const previa = await avaliar<{ achou: boolean; rotulo?: string }>(c, s, scriptDoAlvo(seletor, texto, false));
      if (!previa || !previa.achou) throw new ErroDoNavegador("alvo_nao_achado", `Não achei "${texto || seletor}" na página.`);
      if ((ALVO_SENSIVEL.test(previa.rotulo || "") || ALVO_SENSIVEL.test(texto || "")) && !(await aprovacaoValida(db, pedido.aprovacaoId))) {
        throw new ErroDoNavegador("precisa_aprovacao", `"${previa.rotulo || texto}" publica, envia, paga, assina ou apaga: só com uma aprovação aprovada (aprovacao_id). Nada foi clicado.`, 403);
      }
      await avaliar(c, s, scriptDoAlvo(seletor, texto, true));
      await new Promise((r) => setTimeout(r, 1500));
      await esperarCarregar(c, s, 8000);
      aviso = `Cliquei em "${previa.rotulo}".`;
    } else if (pedido.acao === "digitar") {
      const valor = String(pedido.valor ?? "").slice(0, 2000);
      const seletor = pedido.seletor ? String(pedido.seletor).slice(0, 300) : null;
      const campo = pedido.campo ? String(pedido.campo).slice(0, 120) : null;
      if (!seletor && !campo) throw new ErroDoNavegador("sem_campo", "Diga o campo (nome, rótulo ou seletor) onde digitar.");
      reg.alvo = campo || seletor;
      const r = await avaliar<{ achou: boolean; senha?: boolean; rotulo?: string }>(c, s, scriptDeDigitar(seletor, campo, valor));
      if (!r || !r.achou) throw new ErroDoNavegador("campo_nao_achado", `Não achei o campo "${campo || seletor}".`);
      if (r.senha) throw new ErroDoNavegador("senha_e_da_pessoa", "Campo de senha: o login é feito pela pessoa no navegador ao vivo, uma vez; depois fica guardado. Nada foi digitado.", 403);
      aviso = `Digitei em "${r.rotulo}".`;
    }
    const pagina = (await avaliar<{ url: string; titulo: string; texto: string; links: Array<{ texto: string; href: string }> }>(c, s, LER_PAGINA).catch(() => null)) || { url: alvo.url, titulo: alvo.titulo, texto: "", links: [] };
    let evidencia: string | null = null;
    try {
      const cap = await c.enviar("Page.captureScreenshot", { format: "jpeg", quality: 55 }, s, 20_000);
      evidencia = await guardarCaptura(db, pedido.clientId, sessao.id, String(cap.data || ""));
    } catch { /* sem captura: a ação vale, a evidência fica no texto */ }
    const resumo = pedido.acao === "pesquisar" && resultados && resultados.length
      ? resultados.map((x, i) => `${i + 1}. ${x.titulo} | ${x.link}\n${x.trecho}`).join("\n").slice(0, 4000)
      : (pagina.texto || "").slice(0, 4000);
    const res: ResultadoDoNavegador = {
      ok: true, acao: pedido.acao, sessao_id: sessao.id, url: pagina.url, titulo: pagina.titulo, texto: pagina.texto,
      links: pagina.links, resultados, evidencia, acao_id: null, aviso,
    };
    res.acao_id = await registrar(db, { ...reg, ok: true, url: pagina.url, titulo: pagina.titulo, resultado: resumo, evidencia_caminho: evidencia, duracao_ms: Date.now() - inicio });
    await db.from("navegador_sessoes").update({ ultima_url: pagina.url ? pagina.url.slice(0, 1000) : null }).eq("id", sessao.id);
    return res;
  } catch (e) {
    const erro = e instanceof ErroDoNavegador || e instanceof ErroDoProvedor ? e.message : "Falha no navegador remoto.";
    await registrar(db, { ...reg, ok: false, erro: erro.slice(0, 500), duracao_ms: Date.now() - inicio });
    throw e;
  } finally {
    if (c) c.fechar();
    await soltar(db, sessao.id, pedido.agente).catch(() => undefined);
  }
}

async function registrar(db: SupabaseClient, linha: Record<string, unknown>): Promise<string | null> {
  const { data } = await db.from("navegador_acoes").insert(linha).select("id").single();
  return data ? String((data as { id: string }).id) : null;
}

async function guardarCaptura(db: SupabaseClient, clientId: string, sessaoId: string, base64: string): Promise<string | null> {
  if (!base64) return null;
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  const caminho = `navegador/${clientId}/${sessaoId}/${Date.now()}.jpg`;
  const { error } = await db.storage.from("mesa").upload(caminho, bytes, { contentType: "image/jpeg", upsert: false });
  return error ? null : caminho;
}

/** Zelador: encerra sessões paradas (sem atividade há OCIOSA_MIN e sem trava viva). */
export async function zelar(db: SupabaseClient, p: Provedor): Promise<{ encerradas: number }> {
  const limite = new Date(Date.now() - OCIOSA_MIN * 60_000).toISOString();
  const agora = new Date().toISOString();
  const { data } = await db.from("navegador_sessoes").select("id, sessao_externa, ultima_atividade, aberta_em, trava_ate").eq("estado", "aberta").limit(50);
  let n = 0;
  for (const s of (data || []) as Array<{ id: string; sessao_externa: string; ultima_atividade: string | null; aberta_em: string; trava_ate: string | null }>) {
    const ultima = s.ultima_atividade || s.aberta_em;
    if (ultima > limite || (s.trava_ate && s.trava_ate > agora)) continue;
    await p.encerrar(s.sessao_externa).catch(() => undefined);
    await db.from("navegador_sessoes").update({ estado: "encerrada", encerrada_em: agora, comandada_por: null, trava_ate: null }).eq("id", s.id);
    n++;
  }
  return { encerradas: n };
}

/** Toca a sessão recém-aberta (o provedor encerra sessão sem conexão em 5 min). Nunca lança. */
export async function tocar(p: Provedor, sessaoExterna: string): Promise<void> {
  try {
    const c = await Cdp.abrir(await p.conectar(sessaoExterna), 10_000);
    await c.enviar("Target.getTargets").catch(() => undefined);
    c.fechar();
  } catch { /* sem toque: a sessão ainda pode ser usada pela tela ao vivo */ }
}
