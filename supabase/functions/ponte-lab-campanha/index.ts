/**
 * ponte-lab-campanha (25/10/2026): a ponte entre o canvas do Laboratório e as Campanhas da Mesa.
 * Contrato: docs/laboratorio/PONTE-CAMPANHAS.md. Regras puras em modulos/regras.ts; banco em modulos/aplicar.ts.
 *
 * Ações (POST { acao, ... }):
 * - aviso { campanha_id, lado, novo }: do banco (gatilhos da migration 20261025160000), com o cabeçalho
 *   x-ponte-segredo. novo=true cria o canvas da campanha; depois roda os dois sentidos.
 * - estado { campanha_id | projeto_id }: ligação, sincronia e sugestões abertas.
 * - sincronizar { campanha_id }: roda os dois sentidos agora (sem IA, sem custo).
 * - abrir_no_lab { campanha_id }: garante o canvas da campanha e devolve { projeto_id, criado }.
 * - ligar { projeto_id, campanha_id } / desligar { projeto_id }.
 * - montar_campanha { projeto_id, confirmado? }: cria a campanha pelo canvas (agente-calendario campanha_criar,
 *   com o JWT de quem pediu). Sem confirmado: 409 confirmar_custo com a estimativa.
 * - sugestao_decidir { id, aceitar }: aceitar aplica no destino; recusar só fecha.
 * As ações de tela exigem equipe (is_staff) com acesso ao cliente (can_access_client).
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import {
  decidirSugestao,
  ErroDaPonte,
  estadoDaPonte,
  garantirProjeto,
  lerCampanha,
  lerProjeto,
  lerSaidas,
  projetoDaCampanha,
  rodarPonte,
} from "./modulos/aplicar.ts";
import { pedidoDoCanvas } from "./modulos/regras.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ponte-segredo",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idDe = (v: unknown, nome: string) => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroDaPonte(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroDaPonte(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user && user.user ? user.user.id : "";
  if (!userId) throw new ErroDaPonte(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroDaPonte(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroDaPonte(403, "somente_equipe", "A ponte do Laboratório com as campanhas é da equipe.");
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, token, doChamador };
}

async function garantirAcesso(ch: Chamador, clientId: string | null) {
  if (!clientId) return;
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroDaPonte(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroDaPonte(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

let segredoCache: string | null = null;
async function avisoDoBanco(req: Request): Promise<boolean> {
  const recebido = req.headers.get("x-ponte-segredo") || "";
  if (!recebido) return false;
  if (!segredoCache) {
    const { data } = await servico().rpc("ponte_lab_campanha_segredo");
    segredoCache = typeof data === "string" ? data : null;
  }
  return !!segredoCache && recebido.length === segredoCache.length && recebido === segredoCache;
}

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroDaPonte) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  registrarFalha("ponte-lab-campanha: erro inesperado", err);
  return json({ error: "erro_interno", mensagem: "Falha inesperada na ponte do Laboratório com as campanhas." }, 500);
}

// ------------------------------------------------------------------ custo do montar

async function estimativaDoMontar(quantidade: number): Promise<number> {
  const { data } = await servico().from("ia_modelos").select("preco_entrada_1m, preco_saida_1m, padrao_para, ativo").eq("ativo", true).contains("padrao_para", ["estrategista"]).limit(1);
  const m = ((data || []) as Array<Record<string, unknown>>)[0];
  const pe = Number(m && m.preco_entrada_1m) || 3;
  const ps = Number(m && m.preco_saida_1m) || 15;
  const entrada = 35000;
  const saida = 8000 + Math.max(1, quantidade) * 1500;
  return Math.round(((entrada * pe + saida * ps) / 1e6) * 10000) / 10000;
}

const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function montarCampanha(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const projeto = await lerProjeto(servico(), idDe(corpo.projeto_id, "projeto_id"));
  if (!projeto.client_id) throw new ErroDaPonte(400, "projeto_sem_cliente", "Escolha o cliente do projeto antes de montar a campanha.");
  await garantirAcesso(ch, projeto.client_id);
  if (projeto.campanha_id) throw new ErroDaPonte(409, "ja_tem_campanha", "Este canvas já está ligado a uma campanha.", { campanha_id: projeto.campanha_id });
  const saidas = await lerSaidas(servico(), projeto.id);
  const p = pedidoDoCanvas(projeto.canvas, saidas, projeto.nome);
  const estimativa = await estimativaDoMontar(p.quantidade);
  if (corpo.confirmado !== true) {
    throw new ErroDaPonte(409, "confirmar_custo", `Montar a campanha custa cerca de US$ ${estimativa.toFixed(4)}. Confirme para montar.`, { estimativa_usd: estimativa, quantidade: p.quantidade });
  }
  const inicio = hoje();
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/agente-calendario`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ch.token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" },
    body: JSON.stringify({
      acao: "campanha_criar",
      client_id: projeto.client_id,
      pedido: p.pedido,
      nome: p.nome,
      periodo_inicio: inicio,
      periodo_fim: somarDias(inicio, 14),
      quantidade: p.quantidade,
      formatos: p.formatos,
      ...(Object.keys(p.briefing).length ? { briefing: p.briefing } : {}),
    }),
  });
  const texto = await r.text();
  let resposta: Record<string, unknown> = {};
  try {
    resposta = JSON.parse(texto);
  } catch {
    throw new ErroDaPonte(502, "campanha_nao_criada", "O estrategista não respondeu ao montar a campanha. Tente de novo.");
  }
  if (!r.ok || resposta.error) {
    throw new ErroDaPonte(Number(resposta.status_http) || r.status || 502, String(resposta.error || "campanha_nao_criada"), String(resposta.mensagem || resposta.message || "A campanha não foi criada."));
  }
  const campanha = (resposta.campanha || {}) as Record<string, unknown>;
  const campanhaId = String(campanha.id || "");
  if (!UUID.test(campanhaId)) throw new ErroDaPonte(502, "campanha_nao_criada", "A campanha não voltou do estrategista.");
  // O aviso de campanha nova pode ter criado um canvas antes: o canvas que montou a campanha vale; o outro é arquivado.
  const outro = await projetoDaCampanha(servico(), campanhaId);
  if (outro && outro.id !== projeto.id) await servico().from("lab_projetos").update({ campanha_id: null, status: "arquivado" }).eq("id", outro.id);
  await servico().from("lab_projetos").update({ campanha_id: campanhaId }).eq("id", projeto.id);
  const passada = await rodarPonte(servico(), campanhaId, "ambos");
  return json({ campanha_id: campanhaId, projeto_id: projeto.id, custo_usd: Number(resposta.custo_usd) || 0, resumo: passada ? passada.resumo : null, campanha: resposta.campanha, proposta: resposta.proposta });
}

// ------------------------------------------------------------------ ações

type Acao = (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>;

const ACOES: Record<string, Acao> = {
  async estado(ch, corpo) {
    const db = servico();
    if (corpo.projeto_id) {
      const p = await lerProjeto(db, idDe(corpo.projeto_id, "projeto_id"));
      await garantirAcesso(ch, p.client_id);
      return json(await estadoDaPonte(db, { projetoId: p.id }));
    }
    const lida = await lerCampanha(db, idDe(corpo.campanha_id, "campanha_id"));
    await garantirAcesso(ch, lida.campanha.client_id);
    return json(await estadoDaPonte(db, { campanhaId: lida.campanha.id }));
  },

  async sincronizar(ch, corpo) {
    const db = servico();
    const lida = await lerCampanha(db, idDe(corpo.campanha_id, "campanha_id"));
    await garantirAcesso(ch, lida.campanha.client_id);
    const passada = await rodarPonte(db, lida.campanha.id, "ambos");
    if (!passada) throw new ErroDaPonte(409, "sem_canvas", "Esta campanha ainda não tem canvas. Abra no Laboratório primeiro.");
    return json({ estado: await estadoDaPonte(db, { campanhaId: lida.campanha.id }), resumo: passada.resumo, avisos: passada.avisos });
  },

  async abrir_no_lab(ch, corpo) {
    const db = servico();
    const lida = await lerCampanha(db, idDe(corpo.campanha_id, "campanha_id"));
    await garantirAcesso(ch, lida.campanha.client_id);
    const { projeto, criado } = await garantirProjeto(db, lida.campanha.id, ch.userId);
    if (!criado) await rodarPonte(db, lida.campanha.id, "ambos");
    return json({ projeto_id: projeto.id, criado });
  },

  async ligar(ch, corpo) {
    const db = servico();
    const projeto = await lerProjeto(db, idDe(corpo.projeto_id, "projeto_id"));
    const lida = await lerCampanha(db, idDe(corpo.campanha_id, "campanha_id"));
    await garantirAcesso(ch, lida.campanha.client_id);
    if (projeto.client_id && projeto.client_id !== lida.campanha.client_id) throw new ErroDaPonte(400, "outro_cliente", "O projeto e a campanha são de clientes diferentes.");
    const outro = await projetoDaCampanha(db, lida.campanha.id);
    if (outro && outro.id !== projeto.id) throw new ErroDaPonte(409, "campanha_ja_ligada", "Esta campanha já tem outro canvas ligado.", { projeto_id: outro.id });
    const { error } = await db.from("lab_projetos").update({ campanha_id: lida.campanha.id, client_id: lida.campanha.client_id }).eq("id", projeto.id);
    if (error) throw new ErroDaPonte(503, "ligacao_nao_gravada", "Não foi possível ligar o projeto à campanha agora.");
    const passada = await rodarPonte(db, lida.campanha.id, "ambos");
    return json({ estado: await estadoDaPonte(db, { campanhaId: lida.campanha.id }), resumo: passada ? passada.resumo : null, avisos: passada ? passada.avisos : [] });
  },

  async desligar(ch, corpo) {
    const db = servico();
    const projeto = await lerProjeto(db, idDe(corpo.projeto_id, "projeto_id"));
    await garantirAcesso(ch, projeto.client_id);
    await db.from("lab_projetos").update({ campanha_id: null }).eq("id", projeto.id);
    if (projeto.campanha_id) await db.from("ponte_sugestoes").update({ situacao: "superada", updated_at: new Date().toISOString() }).eq("campanha_id", projeto.campanha_id).eq("situacao", "aberta");
    return json({ ok: true });
  },

  montar_campanha: montarCampanha,

  async sugestao_decidir(ch, corpo) {
    const db = servico();
    const id = idDe(corpo.id, "id");
    const { data } = await db.from("ponte_sugestoes").select("campanha_id").eq("id", id).maybeSingle();
    if (!data) throw new ErroDaPonte(404, "sugestao_inexistente", "Esta sugestão não existe mais.");
    const lida = await lerCampanha(db, String((data as Record<string, unknown>).campanha_id));
    await garantirAcesso(ch, lida.campanha.client_id);
    const sugestao = await decidirSugestao(db, id, corpo.aceitar === true, ch.userId);
    return json({ sugestao, estado: await estadoDaPonte(db, { campanhaId: lida.campanha.id }) });
  },
};

const LONGAS = new Set(["montar_campanha"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  let corpo: Record<string, unknown> = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio */ }
  const acao = String(corpo.acao ?? "");
  try {
    if (acao === "aviso") {
      if (!(await avisoDoBanco(req))) return json({ error: "nao_autorizado", mensagem: "Aviso sem o segredo da ponte." }, 401);
      const campanhaId = idDe(corpo.campanha_id, "campanha_id");
      const lado = corpo.lado === "canvas" ? "canvas" : "campanha";
      // O banco não espera: responde já e a passada segue em segundo plano.
      const trabalho = (async () => {
        try {
          if (corpo.novo === true) {
            const { criado } = await garantirProjeto(servico(), campanhaId, null);
            if (criado) return;
          }
          await rodarPonte(servico(), campanhaId, lado);
        } catch (e) {
          if (!(e instanceof ErroDaPonte && (e.codigo === "campanha_inexistente" || e.codigo === "canvas_mudou"))) registrarFalha("ponte-lab-campanha: aviso", e, { campanha_id: campanhaId });
        }
      })();
      const er = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (er && typeof er.waitUntil === "function") er.waitUntil(trabalho);
      else await trabalho;
      return json({ ok: true });
    }
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES).concat(["aviso"]) }, 400);
    const ch = await identificar(req);
    const rodar = async () => {
      try {
        return await fn(ch, corpo);
      } catch (err) {
        return respostaDeErro(err);
      }
    };
    return LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
