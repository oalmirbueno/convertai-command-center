/**
 * Central de domínios e sites da casa (19/11/2026).
 * Contrato: supabase/migrations/20261119120000_casa_dominios_e_sites.sql.
 *
 * Só o dono da casa chama. Tudo é leitura lá fora: nada muda DNS, zona, Worker ou registro.
 *   estado {}            -> { cloudflare }  se o segredo da Cloudflare está colado
 *   ler_cloudflare {}    -> { dominios, sites, avisos }  zonas, Workers e Pages da conta da Aceleriq (só GET)
 *   conferir { parte }   -> { dominios, sites }  RDAP e DNS de e-mail dos domínios; resposta e SSL dos sites
 *                           parte: "dominios" | "sites" | "tudo" (padrão)
 *
 * Segredos da função (nunca no banco do painel nem no front):
 *   CLOUDFLARE_API_TOKEN: token só de leitura na conta da Aceleriq (Zone:Read, DNS:Read, Workers Scripts:Read,
 *   Workers Routes:Read, Cloudflare Pages:Read). CLOUDFLARE_ACCOUNT_ID (padrão: a conta da Aceleriq).
 * Sem o token, "conferir" funciona igual (RDAP, DNS público e os sites); só a leitura da conta fica parada.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { conferirDominio, type Provedor } from "../produto/modulos/dns.ts";
import { consultarRdap, conferirSite, emLotes, lerConta, montarLeitura } from "./modulos/leitura.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...PREFLIGHT_CACHE,
};
const CONTA_DA_ACELERIQ = "f1a32e14e962f68134a06c0370e45e0e";

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const amb = (n: string) => String(Deno.env.get(n) || "").trim();

let cache: SupabaseClient | null = null;
const servico = () => (cache ||= createClient(amb("SUPABASE_URL"), amb("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }));

async function exigirDono(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  const { data } = await servico().auth.getUser(token);
  const id = data && data.user ? data.user.id : "";
  if (!id) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  const { data: papeis } = await servico().from("user_roles").select("role").eq("user_id", id);
  if (!((papeis || []) as Array<{ role: string }>).some((p) => p.role === "admin")) {
    throw new ErroHttp(403, "sem_permissao", "Só a administração da Aceleriq faz isso.");
  }
  return id;
}

async function gravar(leitura: Record<string, unknown>) {
  const { data, error } = await servico().rpc("casa_dominios_sites_gravar_leitura", { _leitura: leitura });
  if (error) throw new ErroHttp(500, "gravar", `A leitura não foi gravada: ${error.message.slice(0, 160)}`);
  return data as Record<string, number>;
}

async function lerCloudflare() {
  const token = amb("CLOUDFLARE_API_TOKEN");
  if (!token) throw new ErroHttp(409, "sem_chave", "Falta colar o segredo CLOUDFLARE_API_TOKEN na função casa-dominios (token só de leitura da conta da Aceleriq).");
  let lido;
  try {
    lido = await lerConta(token, fetch, amb("CLOUDFLARE_ACCOUNT_ID") || CONTA_DA_ACELERIQ);
  } catch (e) {
    throw new ErroHttp(502, "cloudflare", e instanceof Error ? e.message : "A Cloudflare não respondeu.");
  }
  const { dominios, sites } = montarLeitura(lido);
  const gravado = await gravar({ dominios, sites });
  return json({ ...gravado, avisos: lido.avisos });
}

interface LinhaDeDominio {
  dominio: string;
  arquivado_em: string | null;
}

async function conferir(corpo: Record<string, unknown>) {
  const parte = corpo.parte === "dominios" || corpo.parte === "sites" ? corpo.parte : "tudo";
  const leitura: Record<string, unknown[]> = { dominios: [], saude_sites: [] };

  if (parte !== "sites") {
    const [{ data: casa }, { data: doEmail }] = await Promise.all([
      servico().from("casa_dominios").select("dominio, arquivado_em").is("arquivado_em", null).limit(500),
      servico().from("produto_email_dominios").select("dominio, provedor, dkim_seletor").limit(500),
    ]);
    const email: Record<string, { provedor: string; dkim_seletor: string | null }> = {};
    for (const e of (doEmail || []) as Array<{ dominio: string; provedor: string; dkim_seletor: string | null }>) email[String(e.dominio).toLowerCase()] = e;
    const nomes = ((casa || []) as LinhaDeDominio[]).map((d) => d.dominio).concat(Object.keys(email)).filter((x, i, a) => a.indexOf(x) === i);
    leitura.dominios = await emLotes(nomes, 3, async (dominio) => {
      const linha: Record<string, unknown> = { dominio, rdap: true, origem: email[dominio] ? "email" : "manual" };
      try {
        const r = await consultarRdap(fetch, dominio);
        linha.vence_em = r.vence_em;
        if (r.registrador) linha.registrador = r.registrador;
        if (r.titular) linha.titular = r.titular;
        if (r.nameservers.length) linha.nameservers = r.nameservers;
        linha.rdap_erro = r.vence_em ? null : "O RDAP não informou o vencimento.";
      } catch (e) {
        linha.rdap_erro = e instanceof Error ? e.message : "O RDAP não respondeu.";
      }
      try {
        const e = email[dominio];
        const provedor = (e && ["zoho", "google", "microsoft"].indexOf(e.provedor) >= 0 ? e.provedor : "outro") as Provedor;
        linha.dns_email = await conferirDominio(fetch, { dominio, provedor, seletor: e ? e.dkim_seletor : null });
      } catch {
        /* DNS público fora do ar: fica a conferência anterior */
      }
      return linha;
    });
  }

  if (parte !== "dominios") {
    const { data: sites } = await servico().from("casa_sites").select("id, endereco").is("arquivado_em", null).not("endereco", "is", null).limit(300);
    leitura.saude_sites = await emLotes((sites || []) as Array<{ id: string; endereco: string }>, 5, async (s) => ({ id: s.id, ...(await conferirSite(fetch, s.endereco)) }));
  }

  return json(await gravar(leitura));
}

type Acao = (corpo: Record<string, unknown>) => Promise<Response>;
const ACOES: Record<string, Acao> = {
  estado: async () => json({ cloudflare: !!amb("CLOUDFLARE_API_TOKEN") }),
  ler_cloudflare: () => lerCloudflare(),
  conferir,
};

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
    try {
      const corpo = ((await req.json().catch(() => ({}))) || {}) as Record<string, unknown>;
      const fn = ACOES[String(corpo.acao || "")];
      if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida." }, 400);
      await exigirDono(req);
      return await fn(corpo);
    } catch (err) {
      if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
      console.error("[casa-dominios] erro inesperado", err instanceof Error ? err.message.slice(0, 200) : "");
      return json({ error: "erro_interno", mensagem: "Falha inesperada. Tente de novo." }, 500);
    }
  });
}
