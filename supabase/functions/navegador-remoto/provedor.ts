/**
 * Provedor do navegador remoto: Browserbase (API v1). Separado para teste.
 * Contexto = perfil do navegador do cliente (cookies cifrados no provedor);
 * sessão = navegador vivo com o contexto, persist: true (o login fica);
 * Live View = endereço embutível com controle humano (debuggerFullscreenUrl).
 * Docs: docs.browserbase.com (features/contexts, features/session-live-view).
 */

export class ErroDoProvedor extends Error { constructor(public codigo: string, m: string) { super(m); } }

// `id` é sempre retornado pelo Browserbase; opcional no tipo para provedores/callers legados.
export type SessaoViva = { rodando: boolean; ao_vivo: string | null; paginas: Array<{ id?: string; titulo: string; url: string; ao_vivo: string | null }> };

export type Provedor = {
  criarContexto(nome: string): Promise<string>;
  criarSessao(contexto: string, o?: OpcoesDaSessao): Promise<string>;
  verSessao(sessao: string): Promise<SessaoViva>;
  encerrar(sessao: string): Promise<void>;
  /** Endereço de conexão CDP da sessão, pedido na hora (nunca gravado nem registrado). */
  conectar(sessao: string): Promise<string>;
  /** Plano real da conta: projetos (limite de sessões simultâneas) e minutos usados no período. */
  conta(): Promise<ContaDoProvedor>;
};

export type ContaDoProvedor = { projetos: Array<{ id: string; nome: string; simultaneas: number; tempo_padrao_s: number; minutos_usados: number | null }> };

const API = "https://api.browserbase.com/v1";
/** Uma hora por sessão (o dono reabre; o contexto guarda o login). */
const TEMPO_DA_SESSAO_S = 3600;
/** Sem keepAlive (plano gratuito): sessão curta, para não gastar a hora do mês num navegador esquecido. */
const TEMPO_SEM_PLANO_PAGO_S = 900;
/** A região mais perto do Brasil entre as do provedor (us-west-2, us-east-1, eu-central-1, ap-southeast-1). */
const REGIAO = "us-east-1";

/** Tamanho da tela do navegador remoto (a página "de verdade" que a Live View mostra encolhida ou não). */
export type Tela = { largura: number; altura: number };
export type OpcoesDaSessao = { tela?: Tela | null };
/**
 * 15/10 (dono: "as letras estão muito pequenas"): a Live View encaixa a tela remota no quadro,
 * então tela remota grande = letra miúda. A tela nasce do tamanho do quadro ampliado de quem abriu
 * (letra quase 1:1); agente sem tela (Hermes, Gestor) usa a padrão. Limites para o site não virar
 * versão de celular nem passar do monitor.
 */
export const TELA_PADRAO: Tela = { largura: 1280, altura: 720 };
export function telaDaSessao(t?: Partial<Tela> | null): Tela {
  const n = (v: unknown, min: number, max: number, padrao: number) => Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Math.min(max, Math.max(min, Number(v)))) : padrao;
  return { largura: n(t?.largura, 1024, 1600, TELA_PADRAO.largura), altura: n(t?.altura, 600, 1000, TELA_PADRAO.altura) };
}
/**
 * 15/10 (dono: "conecto o Facebook da Casa dos Assados e ele não entra e reinicia"): Facebook,
 * Instagram e a Meta barram login vindo de IP de datacenter fora do país e devolvem para o início.
 * Só esses domínios saem por IP residencial do Brasil (proxy do provedor, plano Developer ou
 * acima); o resto vai direto, para não gastar banda do proxy à toa.
 */
export const DOMINIOS_DA_META = "^([a-zA-Z0-9-]+\\.)*(facebook\\.com|facebook\\.net|fbcdn\\.net|fbsbx\\.com|instagram\\.com|cdninstagram\\.com|meta\\.com|messenger\\.com|whatsapp\\.com|whatsapp\\.net)$";
const PROXY_DA_META = [{ type: "browserbase", geolocation: { country: "BR" }, domainPattern: DOMINIOS_DA_META }];

/**
 * `projeto` é opcional (docs, 09/10): sem ele, o Browserbase infere o projeto pela API key.
 * Só vai no corpo quando existe.
 */
/** A mensagem de erro do provedor, curta e sem nada que pareça chave (a própria, bb_..., tokens longos). */
export function motivoDoProvedor(corpo: Record<string, unknown> | null, chave: string): string {
  const bruto = corpo ? String(corpo.message || corpo.error || corpo.detail || "") : "";
  let t = bruto.replace(/\s+/g, " ").trim();
  if (chave) t = t.split(chave).join("[chave]");
  return t.replace(/\bbb_[A-Za-z0-9_-]+/g, "[chave]").replace(/[A-Za-z0-9_-]{24,}/g, "[oculto]").slice(0, 160);
}

export function provedorBrowserbase(chave: string, projeto: string | null, f: typeof fetch = fetch): Provedor {
  const doProjeto = projeto ? { projectId: projeto } : {};
  const chamar = async (caminho: string, init: RequestInit = {}) => {
    const r = await f(`${API}${caminho}`, { ...init, headers: { "X-BB-API-Key": chave, "Content-Type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(20_000) });
    const corpo = await r.json().catch(() => null) as Record<string, unknown> | null;
    // O motivo do provedor ajuda a resolver (chave inválida, projeto, plano); a chave nunca entra no texto.
    const motivo = motivoDoProvedor(corpo, chave);
    if (r.status === 401 || r.status === 403) throw new ErroDoProvedor("provedor_recusou", `O provedor do navegador recusou a chave (${r.status}${motivo ? `: ${motivo}` : ""}).`);
    if (r.status === 429) throw new ErroDoProvedor("limite_do_provedor", `O plano do navegador remoto chegou ao limite de sessões ou de horas${motivo ? ` (${motivo})` : ""}.`);
    if (!r.ok) throw new ErroDoProvedor("provedor_erro", `O provedor do navegador respondeu ${r.status}${motivo ? `: ${motivo}` : ""}.`);
    return corpo || {};
  };
  return {
    async criarContexto() {
      const c = await chamar("/contexts", { method: "POST", body: JSON.stringify({ ...doProjeto }) });
      const id = String(c.id || "");
      if (!id) throw new ErroDoProvedor("contexto_sem_id", "O provedor não devolveu o contexto.");
      return id;
    },
    async criarSessao(contexto: string, o: OpcoesDaSessao = {}) {
      const tela = telaDaSessao(o.tela);
      const pedir = (manterViva: boolean, tempo: number, comProxy: boolean) => chamar("/sessions", {
        method: "POST",
        body: JSON.stringify({
          ...doProjeto, keepAlive: manterViva, timeout: tempo, region: REGIAO,
          ...(comProxy ? { proxies: PROXY_DA_META } : {}),
          browserSettings: { context: { id: contexto, persist: true }, viewport: { width: tela.largura, height: tela.altura } },
        }),
      });
      // Do melhor para o mínimo: proxy do Brasil para a Meta (Developer+), depois sem ele, e por fim
      // sem keepAlive (só do plano Hobby para cima, docs 09/10), com 15 min. Chave recusada e limite não repetem.
      const tentativas: Array<[boolean, number, boolean]> = [[true, TEMPO_DA_SESSAO_S, true], [true, TEMPO_DA_SESSAO_S, false], [false, TEMPO_SEM_PLANO_PAGO_S, false]];
      let s: Record<string, unknown> = {};
      for (const [i, [manterViva, tempo, comProxy]] of tentativas.entries()) {
        try {
          s = await pedir(manterViva, tempo, comProxy);
          break;
        } catch (e) {
          if (!(e instanceof ErroDoProvedor) || e.codigo !== "provedor_erro" || i === tentativas.length - 1) throw e;
          console.warn(`navegador-remoto: o provedor recusou a sessão (${comProxy ? "com proxy do Brasil" : "com keepAlive"}); tentando sem: ${e.message}`);
        }
      }
      const id = String(s.id || "");
      if (!id) throw new ErroDoProvedor("sessao_sem_id", "O provedor não devolveu a sessão.");
      return id;
    },
    async verSessao(sessao: string) {
      const s = await chamar(`/sessions/${encodeURIComponent(sessao)}`);
      const rodando = String(s.status || "").toUpperCase() === "RUNNING";
      if (!rodando) return { rodando: false, ao_vivo: null, paginas: [] };
      const d = await chamar(`/sessions/${encodeURIComponent(sessao)}/debug`);
      const paginas = (Array.isArray(d.pages) ? d.pages : []) as Array<Record<string, unknown>>;
      return {
        rodando: true,
        // Com a barra de endereço do próprio navegador: o dono digita o site ali (nada é aberto por inferência).
        ao_vivo: d.debuggerFullscreenUrl ? String(d.debuggerFullscreenUrl) : null,
        // A identidade do target não depende da URL, da ordem ou do token do Live View.
        paginas: paginas.map((p) => ({ id: String(p.id || ""), titulo: String(p.title || ""), url: String(p.url || ""), ao_vivo: p.debuggerFullscreenUrl ? String(p.debuggerFullscreenUrl) : null })),
      };
    },
    async encerrar(sessao: string) {
      await chamar(`/sessions/${encodeURIComponent(sessao)}`, { method: "POST", body: JSON.stringify({ status: "REQUEST_RELEASE" }) });
    },
    async conectar(sessao: string) {
      const s = await chamar(`/sessions/${encodeURIComponent(sessao)}`);
      const url = String(s.connectUrl || "");
      if (!/^wss:\/\//i.test(url)) throw new ErroDoProvedor("sem_conexao", "O provedor não devolveu o endereço de conexão da sessão.");
      return url;
    },
    async conta() {
      const lista = await f(`${API}/projects`, { headers: { "X-BB-API-Key": chave }, signal: AbortSignal.timeout(20_000) });
      if (lista.status === 401 || lista.status === 403) throw new ErroDoProvedor("provedor_recusou", `O provedor do navegador recusou a chave (${lista.status}).`);
      if (!lista.ok) throw new ErroDoProvedor("provedor_erro", `O provedor do navegador respondeu ${lista.status}.`);
      const projetos = ((await lista.json().catch(() => [])) || []) as Array<Record<string, unknown>>;
      const saida: ContaDoProvedor["projetos"] = [];
      for (const pj of Array.isArray(projetos) ? projetos : []) {
        const id = String(pj.id || "");
        if (!id) continue;
        const uso = await chamar(`/projects/${encodeURIComponent(id)}/usage`).catch(() => null) as Record<string, unknown> | null;
        saida.push({ id, nome: String(pj.name || ""), simultaneas: Number(pj.concurrency || 0), tempo_padrao_s: Number(pj.defaultTimeout || 0), minutos_usados: uso && typeof uso.browserMinutes === "number" ? uso.browserMinutes : null });
      }
      return { projetos: saida };
    },
  };
}

/**
 * A chave como o onboarding do provedor costuma mostrar: às vezes a linha inteira do .env
 * (BROWSERBASE_API_KEY="bb_live_..."), com aspas ou "export". Fica só o valor. Nunca é registrada.
 */
export function chaveLimpa(bruta: string): string {
  let t = String(bruta || "").trim();
  t = t.replace(/^export\s+/i, "").replace(/^[A-Z_]*API_KEY\s*[=:]\s*/i, "").trim();
  t = t.replace(/^["'`]+|["'`;,]+$/g, "").trim();
  return t;
}

/** O provedor com a chave do ambiente (função, MCP e Gestor usam o mesmo). Sem chave: null. */
export function provedorDoAmbiente(): Provedor | null {
  const chave = chaveLimpa(Deno.env.get("BROWSERBASE_API_KEY") || "");
  const projeto = (Deno.env.get("BROWSERBASE_PROJECT_ID") || "").trim();
  return chave ? provedorBrowserbase(chave, projeto || null) : null;
}
