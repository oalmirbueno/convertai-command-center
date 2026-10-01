/**
 * Pareamento de máquina do Aceleriq Motores (frente SUP, 01/10/2026): a parte
 * pura da função motores-parear, testável no vitest com dependências falsas.
 *
 * - gerar (admin): código de 8 caracteres (sem 0, O, 1, I, L), mostrado como
 *   ABCD-EFGH, válido por 10 min, uma vez. Só o HMAC vai para o banco.
 * - trocar (instalador, sem login): código válido -> a chave de serviço, uma vez,
 *   só por HTTPS, com limite de tentativas (no banco) e sem cache.
 *
 * Regra dura: a chave de serviço nunca vai para log, nem para erro, nem para
 * uma segunda resposta. Só a resposta 200 de uma troca bem-sucedida a carrega.
 */

export const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TAMANHO_DO_CODIGO = 8;
export const MINUTOS_DO_CODIGO = 10;
export const MOTORES_VALIDOS = ["render", "codigo", "navegador"] as const;

export type Aleatorio = (n: number) => Uint8Array;
const aleatorioPadrao: Aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Código sem viés (rejeita bytes acima do maior múltiplo do alfabeto). */
export function gerarCodigo(aleatorio: Aleatorio = aleatorioPadrao): string {
  const limite = 256 - (256 % ALFABETO.length);
  let s = "";
  while (s.length < TAMANHO_DO_CODIGO) {
    for (const b of aleatorio(16)) {
      if (b >= limite) continue;
      s += ALFABETO[b % ALFABETO.length];
      if (s.length === TAMANHO_DO_CODIGO) break;
    }
  }
  return s;
}

export const formatarCodigo = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** Aceita "abcd-efgh", " ABCD EFGH " etc. Fora do alfabeto ou tamanho errado: null. */
export function normalizarCodigo(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const c = texto.toUpperCase().replace(/[\s-]/g, "");
  if (c.length !== TAMANHO_DO_CODIGO) return null;
  for (const ch of c) if (ALFABETO.indexOf(ch) < 0) return null;
  return c;
}

export async function hmac(segredo: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const a = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
  let h = "";
  for (const b of a) h += b.toString(16).padStart(2, "0");
  return h;
}

export const hashDoCodigo = (segredo: string, codigo: string) => hmac(segredo, `motores-codigo:${codigo}`);
export const hashDaOrigem = (segredo: string, origem: string) => hmac(segredo, `motores-origem:${origem}`);

export function limparMotores(m: unknown): string[] {
  const lista = Array.isArray(m) ? m.map(String) : [];
  return MOTORES_VALIDOS.filter((x) => lista.indexOf(x) >= 0);
}

export function limparTexto(t: unknown, max = 80): string | null {
  if (typeof t !== "string") return null;
  const s = t.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
}

export interface RespostaDaRpc {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

export interface PacoteVigente {
  versao: string;
  sha256: string;
  tamanho: number | null;
  url: string;
}

export interface Dependencias {
  supabaseUrl: string;
  /** A chave de serviço (só sai na resposta de uma troca bem-sucedida). */
  chaveDeServico: string;
  /** Segredo do HMAC (MOTORES_PAREAR_SEGREDO; sem ele, a própria chave de serviço). */
  segredo: string;
  rpc(nome: string, args: Record<string, unknown>): Promise<RespostaDaRpc>;
  /** Quem chama (pelo token do painel): id e se é admin. null = sem sessão. */
  quem(token: string): Promise<{ id: string; admin: boolean } | null>;
  /** O pacote vigente com URL assinada (1 h), ou null. */
  pacote(): Promise<PacoteVigente | null>;
  log(onde: string, dados: Record<string, unknown>): void;
  aleatorio?: Aleatorio;
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "7200",
};

const SEM_CACHE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, ...SEM_CACHE, "Content-Type": "application/json" } });
}

const erro = (status: number, codigo: string, mensagem: string) => json({ error: codigo, mensagem }, status);

/** Só HTTPS: recusa quando o gateway diz que veio por http (fora do teste local). */
export function veioPorHttps(req: Request): boolean {
  const proto = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  if (proto) return proto === "https";
  const u = new URL(req.url);
  return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.endsWith(".supabase.co") || u.hostname.indexOf(".") < 0;
}

export function origemDoPedido(req: Request): string {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "").split(",")[0].trim();
  return ip || "desconhecida";
}

const MENSAGEM_DO_MOTIVO: Record<string, [number, string]> = {
  muitas_tentativas: [429, "Muitas tentativas erradas. Espere 15 minutos e gere um código novo no painel."],
  codigo_invalido: [404, "Código inválido, vencido ou já usado. Gere um novo no painel (Configurações › Estado dos motores)."],
  ja_usado: [404, "Código inválido, vencido ou já usado. Gere um novo no painel (Configurações › Estado dos motores)."],
  expirado: [404, "Código inválido, vencido ou já usado. Gere um novo no painel (Configurações › Estado dos motores)."],
  revogado: [404, "Código inválido, vencido ou já usado. Gere um novo no painel (Configurações › Estado dos motores)."],
};

/** Tira a chave de qualquer texto (cinto e suspensório: nenhum log deveria tê-la). */
export function semAChave(texto: string, chave: string): string {
  return chave && chave.length >= 12 ? texto.split(chave).join("[chave]") : texto;
}

export function criarTratador(dep: Dependencias): (req: Request) => Promise<Response> {
  const d: Dependencias = {
    ...dep,
    log: (onde, dados) => {
      try {
        dep.log(onde, JSON.parse(semAChave(JSON.stringify(dados), dep.chaveDeServico)));
      } catch {
        dep.log(onde, {});
      }
    },
  };
  async function gerar(req: Request, corpo: Record<string, unknown>): Promise<Response> {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const q = token ? await d.quem(token) : null;
    if (!q) return erro(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
    if (!q.admin) return erro(403, "somente_admin", "Só o admin instala motores numa máquina.");
    const codigo = gerarCodigo(d.aleatorio);
    const motores = limparMotores(corpo.motores);
    const r = await d.rpc("motores_pareamento_criar", {
      _hash: await hashDoCodigo(d.segredo, codigo),
      _ator: q.id,
      _nome: limparTexto(corpo.nome),
      _motores: motores.length ? motores : [...MOTORES_VALIDOS],
      _minutos: MINUTOS_DO_CODIGO,
    });
    if (r.error) {
      if (String(r.error.message || "").indexOf("MOTORES_CODIGOS_DEMAIS") >= 0) return erro(429, "codigos_demais", "Há 5 códigos abertos. Use um deles ou revogue antes de gerar outro.");
      d.log("motores-parear: gerar", { motivo: String(r.error.message || "erro").slice(0, 160) });
      return erro(500, "falha_ao_gerar", "Não foi possível gerar o código agora. Tente de novo.");
    }
    const dados = (r.data || {}) as { id?: string; expira_em?: string; motores?: string[] };
    return json({ codigo: formatarCodigo(codigo), id: dados.id, expira_em: dados.expira_em, motores: dados.motores || motores, validade_min: MINUTOS_DO_CODIGO });
  }

  async function trocar(req: Request, corpo: Record<string, unknown>): Promise<Response> {
    if (!veioPorHttps(req)) return erro(400, "so_https", "O pareamento só funciona por HTTPS.");
    const codigo = normalizarCodigo(corpo.codigo);
    const maquina = (corpo.maquina && typeof corpo.maquina === "object" ? corpo.maquina : {}) as Record<string, unknown>;
    const origem = await hashDaOrigem(d.segredo, origemDoPedido(req));
    // Código fora do formato também conta como tentativa errada (vai para o banco com hash vazio).
    const hash = codigo ? await hashDoCodigo(d.segredo, codigo) : null;
    const r = await d.rpc("motores_pareamento_trocar", {
      _hash: hash,
      _origem: origem,
      _nome: limparTexto(maquina.nome),
      _hostname: limparTexto(maquina.hostname),
      _sistema: limparTexto(maquina.sistema, 10),
    });
    if (r.error) {
      d.log("motores-parear: trocar", { motivo: String(r.error.message || "erro").slice(0, 160) });
      return erro(500, "falha_ao_parear", "Não foi possível parear agora. Tente de novo em instantes.");
    }
    const t = (r.data || {}) as { ok?: boolean; motivo?: string; maquina_id?: string; nome?: string; motores?: string[] };
    if (!t.ok) {
      const [status, mensagem] = MENSAGEM_DO_MOTIVO[String(t.motivo)] || MENSAGEM_DO_MOTIVO.codigo_invalido;
      return erro(status, String(t.motivo || "codigo_invalido"), mensagem);
    }
    let pacote: PacoteVigente | null = null;
    try {
      pacote = await d.pacote();
    } catch (e) {
      d.log("motores-parear: pacote", { motivo: e instanceof Error ? e.message.slice(0, 160) : "erro" });
    }
    d.log("motores-parear: pareada", { maquina_id: t.maquina_id, nome: t.nome });
    return json({
      ok: true,
      supabase_url: d.supabaseUrl,
      chave_de_servico: d.chaveDeServico,
      maquina: { id: t.maquina_id, nome: t.nome, motores: t.motores || [] },
      pacote,
    });
  }

  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return erro(405, "metodo", "Use POST.");
    let corpo: Record<string, unknown> = {};
    try {
      const c = await req.json();
      if (c && typeof c === "object") corpo = c as Record<string, unknown>;
    } catch {
      return erro(400, "corpo_invalido", "Pedido inválido.");
    }
    try {
      if (corpo.acao === "gerar") return await gerar(req, corpo);
      if (corpo.acao === "trocar") return await trocar(req, corpo);
      return erro(400, "acao_desconhecida", "Ação desconhecida.");
    } catch (e) {
      // Nunca a chave: só a mensagem, cortada, sem o corpo do pedido.
      d.log("motores-parear", { motivo: e instanceof Error ? e.message.slice(0, 160) : "erro" });
      return erro(500, "falha", "Não foi possível concluir agora. Tente de novo.");
    }
  };
}
