/**
 * O correio do cliente dentro do painel (18/11/2026): cada pessoa abre a própria caixa e o master
 * abre todas as da empresa. Contrato do banco: 20261118200000_produto_email_central_e_correio.sql.
 *
 *   pastas   { caixa_id }                        -> { pastas }
 *   listar   { caixa_id, pasta?, pagina?, busca? } -> { mensagens }
 *   ler      { caixa_id, pasta?, id }            -> { mensagem }
 *   enviar   { caixa_id, para, assunto, texto }  -> { id }
 *   guardar_segredo { caixa_id, segredo }        -> { guardado }   (quem administra a empresa, ou a casa)
 *
 * Toda ação confere no banco se a pessoa pode abrir aquela caixa (produto_email_pode_abrir) antes de
 * tocar no provedor. A senha de aplicativo de cada caixa mora no Vault e nunca volta para a tela.
 * Sem provedor contratado, tudo responde "correio_desligado" (409), e a tela mostra "em preparação".
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { adaptadorPara, CorreioDesligado, envioValido, type CaixaAberta, type ProvedorDeCorreio } from "./modulos/adaptador.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...PREFLIGHT_CACHE,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

let cache: SupabaseClient | null = null;
const servico = () => (cache ||= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } }));

async function quemChama(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  const { data } = await servico().auth.getUser(token);
  if (!data || !data.user) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  return data.user.id;
}

const idDaCaixa = (v: unknown) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ErroHttp(400, "caixa_invalida", "Escolha a caixa de novo.");
  return v;
};

/** Confere a permissão e abre a caixa com o segredo do Vault. */
async function abrir(usuario: string, caixaId: string): Promise<{ caixa: CaixaAberta; ligado: boolean; temSegredo: boolean }> {
  const { data: pode } = await servico().rpc("produto_email_pode_abrir", { _caixa: caixaId, _usuario: usuario });
  // Caixa de outra empresa responde igual a caixa inexistente.
  if (pode !== true) throw new ErroHttp(404, "caixa_inexistente", "Essa caixa não está disponível para você.");
  const { data } = await servico().from("produto_email_caixas").select("id, endereco, tem_segredo, dominio_id").eq("id", caixaId).maybeSingle();
  const c = data as { id: string; endereco: string; tem_segredo: boolean; dominio_id: string } | null;
  if (!c) throw new ErroHttp(404, "caixa_inexistente", "Essa caixa não está disponível para você.");
  const { data: d } = await servico().from("produto_email_dominios").select("dominio, correio_provedor, correio_ligado").eq("id", c.dominio_id).maybeSingle();
  const dom = (d || { dominio: "", correio_provedor: "nenhum", correio_ligado: false }) as { dominio: string; correio_provedor: ProvedorDeCorreio; correio_ligado: boolean };
  let segredo = "";
  if (dom.correio_ligado && c.tem_segredo) {
    const { data: s } = await servico().rpc("produto_email_ler_segredo_da_caixa", { _caixa: c.id });
    segredo = typeof s === "string" ? s : "";
  }
  return { caixa: { id: c.id, endereco: c.endereco, dominio: dom.dominio, provedor: dom.correio_provedor, segredo }, ligado: dom.correio_ligado, temSegredo: !!segredo };
}

async function comAdaptador<T>(usuario: string, corpo: Record<string, unknown>, fazer: (a: ReturnType<typeof adaptadorPara>, caixa: CaixaAberta) => Promise<T>): Promise<T> {
  const { caixa, ligado, temSegredo } = await abrir(usuario, idDaCaixa(corpo.caixa_id));
  try {
    return await fazer(adaptadorPara(caixa.provedor, ligado, temSegredo), caixa);
  } catch (e) {
    if (e instanceof CorreioDesligado) throw new ErroHttp(409, "correio_desligado", e.message);
    if (e instanceof ErroHttp) throw e;
    console.error("[produto-correio] provedor", e instanceof Error ? e.message.slice(0, 200) : "");
    throw new ErroHttp(502, "provedor", "O provedor de e-mail não respondeu agora. Tente de novo.");
  }
}

const pasta = (v: unknown) => (typeof v === "string" && /^[\w .\-/]{1,80}$/.test(v) ? v : "INBOX");

type Acao = (usuario: string, corpo: Record<string, unknown>) => Promise<Response>;
const ACOES: Record<string, Acao> = {
  pastas: async (u, c) => json({ pastas: await comAdaptador(u, c, (a, caixa) => a.pastas(caixa)) }),
  listar: async (u, c) =>
    json({ mensagens: await comAdaptador(u, c, (a, caixa) => a.listar(caixa, { pasta: pasta(c.pasta), pagina: Math.max(1, Math.min(200, Math.floor(Number(c.pagina) || 1))), busca: typeof c.busca === "string" ? c.busca.slice(0, 120) : undefined })) }),
  ler: async (u, c) => {
    if (typeof c.id !== "string" || !c.id || c.id.length > 300) throw new ErroHttp(400, "mensagem_invalida", "Escolha a mensagem de novo.");
    return json({ mensagem: await comAdaptador(u, c, (a, caixa) => a.ler(caixa, { pasta: pasta(c.pasta), id: String(c.id) })) });
  },
  enviar: async (u, c) => {
    const envio = envioValido(c);
    if ("erro" in envio) throw new ErroHttp(400, "envio_invalido", envio.erro);
    return json(await comAdaptador(u, c, (a, caixa) => a.enviar(caixa, envio)));
  },
  guardar_segredo: async (u, c) => {
    const caixaId = idDaCaixa(c.caixa_id);
    const { data: linha } = await servico().from("produto_email_caixas").select("conta_id").eq("id", caixaId).maybeSingle();
    const contaId = linha ? String((linha as { conta_id: string }).conta_id) : "";
    const [{ data: papeis }, { data: membro }] = await Promise.all([
      servico().from("user_roles").select("role").eq("user_id", u),
      servico().from("produto_membros").select("papel").eq("user_id", u).eq("conta_id", contaId || "00000000-0000-0000-0000-000000000000").eq("estado", "ativo").maybeSingle(),
    ]);
    const dono = ((papeis || []) as Array<{ role: string }>).some((p) => p.role === "admin");
    if (!contaId || !(dono || (membro && (membro as { papel: string }).papel === "admin"))) throw new ErroHttp(403, "sem_permissao", "Só quem administra a empresa guarda a senha da caixa.");
    const segredo = typeof c.segredo === "string" ? c.segredo.trim() : "";
    if (segredo.length > 200) throw new ErroHttp(400, "segredo_invalido", "A senha de aplicativo é longa demais.");
    const { data, error } = await servico().rpc("produto_email_guardar_segredo_da_caixa", { _caixa: caixaId, _segredo: segredo });
    if (error) throw new ErroHttp(500, "cofre", "Não foi possível guardar no cofre agora.");
    return json({ guardado: data === true });
  },
};

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
    try {
      const corpo = ((await req.json().catch(() => ({}))) || {}) as Record<string, unknown>;
      const fn = ACOES[String(corpo.acao || "")];
      if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida." }, 400);
      return await fn(await quemChama(req), corpo);
    } catch (err) {
      if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
      console.error("[produto-correio] erro inesperado", err instanceof Error ? err.message.slice(0, 200) : "");
      return json({ error: "erro_interno", mensagem: "Falha inesperada. Tente de novo." }, 500);
    }
  });
}
