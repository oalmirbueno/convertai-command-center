/**
 * navegador-remoto (Central de Autonomia, 09/10/2026, lote C).
 *
 * O navegador real de cada cliente (Browserbase), que a Central mostra ao vivo e que
 * Hermes (MCP) e Gestor também comandam, pelo mesmo motor (_shared/navegador-operacional.ts).
 *
 * - Um perfil por cliente (cookies e login cifrados no provedor), nunca compartilhado.
 * - Senha não passa pelo painel: a pessoa entra no site dentro da sessão, uma vez.
 * - Toda sessão e toda ação ficam registradas (navegador_sessoes, navegador_acoes), com evidência.
 * - Um agente por vez em cada sessão (trava); sessão parada é encerrada pelo zelador.
 * - Sem BROWSERBASE_API_KEY: configurado = false e nada é simulado.
 * Só admin (o zelar só com a chave de serviço + x-cron-secret da rotina).
 *
 * Ações: estado · conta · abrir { cliente_id, origem?, pedido? } · ver { sessao_id } ·
 * listar { cliente_id? } · encerrar { sessao_id } · agir { cliente_id, acao, url?, termos?,
 * texto?, seletor?, campo?, valor?, aba?, pedido?, aprovacao_id? } · acoes { cliente_id, limite? } · zelar
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { chave as chaveDoCofre } from "../_shared/chaves.ts";
import { autorizarChamadaInterna } from "../agente-calendario/modulos/refazer-interno.ts";
import { ACOES_DO_NAVEGADOR, type AcaoDoNavegador, ErroDoNavegador, sessaoDoCliente, tocar, usarNavegador, zelar } from "../_shared/navegador-operacional.ts";
import { ErroDoProvedor, provedorDoAmbiente } from "./provedor.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS", ...PREFLIGHT_CACHE };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErroHttp extends Error { constructor(public status: number, public codigo: string, m: string) { super(m); } }

let svc: SupabaseClient | null = null;
const servico = () => (svc ||= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } }));

async function identificar(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const { data } = token ? await servico().auth.getUser(token) : { data: null };
  const id = data?.user?.id;
  if (!id) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const r = await servico().rpc("has_role", { _user_id: id, _role: "admin" });
  if (r.data !== true) throw new ErroHttp(403, "somente_admin", "O navegador remoto é do admin.");
  return id;
}

async function acao(nome: string, corpo: Record<string, unknown>, userId: string | null): Promise<Record<string, unknown>> {
  const p = provedorDoAmbiente();
  if (nome === "estado") return { configurado: !!p, provedor: "browserbase" };
  if (!p) throw new ErroHttp(409, "nao_configurado", "O navegador remoto ainda não foi ligado (falta a conta do provedor).");

  if (nome === "conta") {
    // Plano real: limite de sessões simultâneas e minutos usados (pela API do provedor), e o que o painel registrou.
    const conta = await p.conta();
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { count } = await servico().from("navegador_sessoes").select("id", { count: "exact", head: true }).gte("aberta_em", desde);
    const { count: abertas } = await servico().from("navegador_sessoes").select("id", { count: "exact", head: true }).eq("estado", "aberta");
    return { ...conta, sessoes_30_dias: count || 0, abertas_agora: abertas || 0 };
  }

  if (nome === "abrir") {
    const clientId = String(corpo.cliente_id || "");
    if (!UUID.test(clientId)) throw new ErroHttp(400, "cliente_invalido", "Escolha o cliente do navegador.");
    const origem = ["central", "gestor", "hermes"].includes(String(corpo.origem)) ? (String(corpo.origem) as "central" | "gestor" | "hermes") : "central";
    const { sessao, nova } = await sessaoDoCliente(servico(), p, { clientId, origem, pedido: corpo.pedido ? String(corpo.pedido) : null, userId });
    // Sessão nova sem conexão o provedor encerra em 5 min: um toque mantém viva (keepAlive) para a tela ao vivo.
    if (nova) await tocar(p, sessao.sessao_externa);
    const viva = await p.verSessao(sessao.sessao_externa);
    return { sessao: { id: sessao.id, ...viva, comandada_por: sessao.comandada_por }, reaproveitada: !nova };
  }

  if (nome === "ver" || nome === "encerrar") {
    const id = String(corpo.sessao_id || "");
    if (!UUID.test(id)) throw new ErroHttp(400, "sessao_invalida", "Sessão inválida.");
    const { data } = await servico().from("navegador_sessoes").select("id, sessao_externa, client_id, estado, comandada_por, trava_ate").eq("id", id).maybeSingle();
    const s = data as { id: string; sessao_externa: string; client_id: string; estado: string; comandada_por: string | null; trava_ate: string | null } | null;
    if (!s) throw new ErroHttp(404, "sessao_inexistente", "Sessão não encontrada.");
    if (nome === "encerrar") {
      await p.encerrar(s.sessao_externa).catch((e) => registrarFalha("navegador-remoto: encerrar", e));
      await servico().from("navegador_sessoes").update({ estado: "encerrada", encerrada_em: new Date().toISOString(), comandada_por: null, trava_ate: null }).eq("id", s.id);
      return { encerrada: true };
    }
    const viva = await p.verSessao(s.sessao_externa).catch(() => null);
    if (!viva || !viva.rodando) {
      if (s.estado === "aberta") await servico().from("navegador_sessoes").update({ estado: "encerrada", encerrada_em: new Date().toISOString(), comandada_por: null, trava_ate: null }).eq("id", s.id);
      return { sessao: { id: s.id, rodando: false } };
    }
    // Histórico: a página aberta fica anotada na sessão (contexto para a equipe e os agentes).
    const atual = viva.paginas.find((x) => x.url && x.url !== "about:blank");
    if (atual) await servico().from("navegador_sessoes").update({ ultima_url: atual.url.slice(0, 1000) }).eq("id", s.id);
    const comandando = s.trava_ate && new Date(s.trava_ate).getTime() > Date.now() ? s.comandada_por : null;
    return { sessao: { id: s.id, ...viva, comandada_por: comandando } };
  }

  if (nome === "agir") {
    const clientId = String(corpo.cliente_id || "");
    if (!UUID.test(clientId)) throw new ErroHttp(400, "cliente_invalido", "Escolha o cliente do navegador.");
    const a = String(corpo.acao_do_navegador || corpo.navegador_acao || "") as AcaoDoNavegador;
    if (!(ACOES_DO_NAVEGADOR as readonly string[]).includes(a)) throw new ErroHttp(400, "acao_invalida", "Ação do navegador desconhecida.");
    const r = await usarNavegador(servico(), p, {
      clientId, agente: "equipe", acao: a, userId,
      url: corpo.url ? String(corpo.url) : null, termos: corpo.termos ? String(corpo.termos) : null,
      texto: corpo.texto ? String(corpo.texto) : null, seletor: corpo.seletor ? String(corpo.seletor) : null,
      campo: corpo.campo ? String(corpo.campo) : null, valor: corpo.valor != null ? String(corpo.valor) : null,
      aba: typeof corpo.aba === "number" ? corpo.aba : null, pedido: corpo.pedido ? String(corpo.pedido) : null,
      aprovacaoId: corpo.aprovacao_id ? String(corpo.aprovacao_id) : null,
    });
    return { resultado: { ...r, texto: r.texto ? r.texto.slice(0, 4000) : null } };
  }

  if (nome === "acoes") {
    const clientId = String(corpo.cliente_id || "");
    if (!UUID.test(clientId)) throw new ErroHttp(400, "cliente_invalido", "Escolha o cliente.");
    const limite = Math.min(50, Math.max(1, Number(corpo.limite || 15)));
    const { data } = await servico().from("navegador_acoes").select("id, sessao_id, agente, acao, alvo, ok, url, titulo, erro, evidencia_caminho, criado_em, duracao_ms").eq("client_id", clientId).order("criado_em", { ascending: false }).limit(limite);
    const linhas = (data || []) as Array<Record<string, unknown>>;
    // A evidência é privada (bucket mesa): link assinado curto para a tela.
    const caminhos = linhas.map((l) => String(l.evidencia_caminho || "")).filter(Boolean);
    const assinados = caminhos.length ? (await servico().storage.from("mesa").createSignedUrls(caminhos, 600)).data || [] : [];
    const porCaminho = new Map(assinados.map((x) => [x.path, x.signedUrl]));
    return { acoes: linhas.map((l) => ({ ...l, evidencia_url: l.evidencia_caminho ? porCaminho.get(String(l.evidencia_caminho)) || null : null })) };
  }

  if (nome === "listar") {
    let q = servico().from("navegador_sessoes").select("id, client_id, origem, pedido, estado, aberta_em, encerrada_em, ultima_url, comandada_por, ultima_atividade").order("aberta_em", { ascending: false }).limit(30);
    if (typeof corpo.cliente_id === "string" && UUID.test(corpo.cliente_id)) q = q.eq("client_id", corpo.cliente_id);
    const { data } = await q;
    return { sessoes: data || [] };
  }
  throw new ErroHttp(400, "acao_desconhecida", "Ação desconhecida.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    // Zelador (rotina navegador-zelar): só com a chave de serviço e o x-cron-secret.
    if (String(corpo.acao || "") === "zelar" || String(corpo.acao || "") === "interno") {
      const ok = autorizarChamadaInterna({
        authorization: req.headers.get("Authorization"),
        cronSecretDoPedido: req.headers.get("x-cron-secret"),
        chavesDeServico: [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("SUPABASE_SECRET_KEY")],
        cronSecret: await chaveDoCofre("CRON_SECRET").catch(() => ""),
      });
      if (!ok.ok) return json({ error: ok.codigo, mensagem: ok.mensagem }, ok.status);
      if (String(corpo.acao) === "interno") {
        // Chamada do servidor (teste de ponta a ponta pelo banco, rotinas): mesma regra das ações do admin.
        return json(await acao(String(corpo.interno_acao || ""), corpo, null));
      }
      const p = provedorDoAmbiente();
      return json(p ? await zelar(servico(), p) : { encerradas: 0, configurado: false });
    }
    const userId = await identificar(req);
    return json(await acao(String(corpo.acao || ""), corpo, userId));
  } catch (e) {
    if (e instanceof ErroHttp) return json({ error: e.codigo, mensagem: e.message }, e.status);
    if (e instanceof ErroDoNavegador) return json({ error: e.codigo, mensagem: e.message }, e.status);
    if (e instanceof ErroDoProvedor) return json({ error: e.codigo, mensagem: e.message }, 502);
    registrarFalha("navegador-remoto: falha", e);
    return json({ error: "falha_interna", mensagem: "O navegador remoto falhou. Tente de novo." }, 500);
  }
});
