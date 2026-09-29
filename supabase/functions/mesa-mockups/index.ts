/**
 * mesa-mockups: o estúdio de mockups da Mesa Identidade Visual (frente MCK, 29/09/2026).
 *
 * O catálogo e a composição ficam no navegador (src/lib/mockups): aqui só o que precisa de chave.
 * POST { acao, ... }, só equipe com acesso ao cliente. Erro sai como { error, mensagem }.
 *
 * - sugerir { client_id, marca_id?, candidatos[{id,nome,categoria,tags}], quantos? }
 *     -> { sugestoes[{mockup_id, nota, confianca}], segmento, aviso, custo_usd }
 *     Jev (Score) diz quanto cada mockup combina com o negócio. Sem Jev, a ordem da sequência,
 *     com aviso na tela e a falha no log (nada engolido).
 * - cena_estimar { client_id, tipo: fachada|social, modelo_id? } -> { estimativa_usd, modelo_id, modelo_nome } (sem IA)
 * - cena_gerar { client_id, marca_id?, tipo, pedido?, modelo_id? } -> { caminho, custo_usd, saldo_usd, modelo_id }
 *     A cena sai com uma área lisa e SEM logo; a logo entra depois pelo código (homografia).
 *     Guardada em mesa/<cliente>/mockups/cenas/. Custo à vista antes (a tela pede Confirmar).
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { carregarModelo, chamarImagem, cobrarJev, estimarComModelo, IaMotorErro, modeloPadrao, type ModeloIa } from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar } from "../_shared/jev.ts";
import { lerContextoDaMarca, resolverMarca } from "../_shared/marca.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import {
  type ClienteParaSugestao,
  limparCandidatos,
  notasDoLote,
  type NotaDoMockup,
  perguntasDeAdequacao,
  POR_CHAMADA,
  promptDaCena,
  ranquear,
  TAMANHO_DA_CENA,
  type TipoDeCena,
} from "./sugestao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErroHttp extends Error {
  status: number;
  codigo: string;
  extra: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof IaMotorErro) return json({ ...err.paraJson(), mensagem: err.message }, err.status >= 400 ? err.status : 500);
  registrarFalha("mesa-mockups: erro inesperado", err);
  return json({ error: "erro_interno", mensagem: "Falha inesperada no estúdio de mockups." }, 500);
}

// ------------------------------------------------------------------ acesso

type Chamador = { userId: string; doChamador: SupabaseClient };

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe usa o estúdio de mockups.");
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, doChamador };
}

async function garantirAcesso(ch: Chamador, clientId: unknown): Promise<string> {
  const id = String(clientId ?? "");
  if (!UUID.test(id)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: id });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
  return id;
}

/** Contexto do cliente para a marca aberta (a outra marca nunca herda da principal: _shared/marca.ts). */
async function clienteParaSugestao(clientId: string, marcaId: unknown): Promise<{ cliente: ClienteParaSugestao; cores: string[] }> {
  const db = servico();
  const marca = await resolverMarca(db, clientId, { marca_id: marcaId });
  const ctx = (await lerContextoDaMarca(db, clientId, marca)) as Record<string, unknown>;
  const { data: perfil } = await db.from("profiles").select("full_name, company_name").eq("id", clientId).maybeSingle();
  const p = (perfil || {}) as { full_name?: string | null; company_name?: string | null };
  const { data: kit } = await db.from("cliente_kit_marca").select("paleta, estilo").eq("client_id", clientId).maybeSingle();
  const paleta = (marca && !marca.principal ? marca.paleta : (kit as { paleta?: unknown } | null)?.paleta) as Array<{ hex?: string }> | null;
  const estilo = marca && !marca.principal ? marca.estilo : ((kit as { estilo?: string | null } | null)?.estilo ?? null);
  const texto = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return {
    cliente: {
      nome: (marca && marca.nome) || p.company_name || p.full_name || "Cliente",
      negocio: texto(ctx.negocio, 400),
      publico: texto(ctx.publico, 300),
      oferta: texto(ctx.oferta, 300),
      estilo: texto(estilo, 300),
    },
    cores: (Array.isArray(paleta) ? paleta : []).map((c) => String(c?.hex || "")).filter((h) => /^#?[0-9a-f]{6}$/i.test(h)).map((h) => (h[0] === "#" ? h : `#${h}`)),
  };
}

// ------------------------------------------------------------------ ações

async function sugerir(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = await garantirAcesso(ch, corpo.client_id);
  const candidatos = limparCandidatos(corpo.candidatos);
  if (!candidatos.length) throw new ErroHttp(400, "sem_candidatos", "Escolha ao menos uma categoria com mockups.");
  const quantos = Math.max(1, Math.min(24, Number(corpo.quantos) || 8));
  const { cliente } = await clienteParaSugestao(clientId, corpo.marca_id);
  const lotes: typeof candidatos[] = [];
  for (let i = 0; i < candidatos.length; i += POR_CHAMADA) lotes.push(candidatos.slice(i, i + POR_CHAMADA));
  let notas: NotaDoMockup[] = [];
  let custo = 0;
  let aviso: string | null = null;
  try {
    const respostas = await Promise.all(lotes.map((lote) => jevPerguntar(perguntasDeAdequacao(cliente, lote))));
    respostas.forEach((r, i) => {
      notas = notas.concat(notasDoLote(lotes[i], r.answers));
    });
    for (const r of respostas) {
      const cobrado = await cobrarJev(r, { clientId, tarefa: "identidade", criadoPor: ch.userId });
      custo += cobrado?.custoUsd ?? 0;
    }
  } catch (e) {
    // Sem Jev a tela segue com a ordem da sequência, e diz isso; a falha vai para o log.
    const motivo = registrarFalha("mesa-mockups: Jev não sugeriu", e, { client_id: clientId, codigo_jev: e instanceof JevErro ? e.codigo : null });
    aviso = `O Jev não respondeu agora (${motivo}). A lista segue na ordem da sequência; escolha à mão ou tente de novo.`;
    notas = candidatos.map((c, i) => ({ mockup_id: c.id, nota: 0, confianca: null, _ordem: i })).map(({ _ordem: _o, ...n }) => n);
  }
  const ranking = ranquear(candidatos, notas);
  if (!aviso && !cliente.negocio) aviso = "O cliente ainda não tem o negócio descrito no contexto: a sugestão fica genérica.";
  return json({ sugestoes: ranking.slice(0, quantos), todas: ranking, segmento: cliente.negocio, aviso, custo_usd: Math.round(custo * 1e6) / 1e6 });
}

function tipoDe(v: unknown): TipoDeCena {
  if (v === "fachada" || v === "social") return v;
  throw new ErroHttp(400, "tipo_invalido", "A cena é fachada ou social.");
}

/**
 * Gerador da cena: o escolhido na tela; senão o padrão do papel `identidade` (frente BASE) quando
 * ele gera imagem; senão o padrão de imagem. (modeloDoPapel cai no estrategista, que é de texto.)
 */
async function modeloDaCena(modeloId: unknown): Promise<ModeloIa> {
  if (typeof modeloId === "string" && modeloId.trim()) return await carregarModelo(modeloId.trim(), "imagem");
  const doPapel = await modeloPadrao("identidade");
  const m = doPapel && doPapel.tipo === "imagem" ? doPapel : await modeloPadrao("imagem");
  if (!m) throw new ErroHttp(409, "sem_modelo", "Nenhum gerador de imagem ativo no catálogo de modelos.");
  return m;
}

async function cenaEstimar(ch: Chamador, corpo: Record<string, unknown>) {
  await garantirAcesso(ch, corpo.client_id);
  const tipo = tipoDe(corpo.tipo);
  const m = await modeloDaCena(corpo.modelo_id);
  const estimativa = estimarComModelo(m, { imagens: 1, qualidade: "media", tokensEntrada: 400, tamanho: TAMANHO_DA_CENA[tipo] });
  return json({ estimativa_usd: estimativa, modelo_id: m.id, modelo_nome: (m as { nome?: string }).nome || m.id, custo_usd: 0 });
}

async function cenaGerar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = await garantirAcesso(ch, corpo.client_id);
  const tipo = tipoDe(corpo.tipo);
  const m = await modeloDaCena(corpo.modelo_id);
  const { cliente, cores } = await clienteParaSugestao(clientId, corpo.marca_id);
  const pedido = typeof corpo.pedido === "string" ? corpo.pedido : "";
  const img = await chamarImagem({
    clientId,
    modeloId: m.id,
    prompt: promptDaCena(tipo, cliente, cores, pedido),
    referencias: [],
    qualidade: "media",
    tamanho: TAMANHO_DA_CENA[tipo],
    tarefa: "identidade",
    agente: "identidade",
    criadoPor: ch.userId,
  });
  const ext = img.mime.includes("jpeg") ? "jpg" : img.mime.includes("webp") ? "webp" : "png";
  const caminho = `${clientId}/mockups/cenas/${crypto.randomUUID()}.${ext}`;
  const { error } = await servico().storage.from("mesa").upload(caminho, new Blob([new Uint8Array(img.png)], { type: img.mime }), { contentType: img.mime, upsert: false });
  if (error) {
    registrarFalha("mesa-mockups: cena gerada não foi guardada", error, { client_id: clientId, uso_id: img.usoId });
    throw new ErroHttp(503, "cena_nao_guardada", "A cena foi gerada (e cobrada), mas não foi guardada. Tente de novo em instantes.", { custo_usd: img.custoUsd });
  }
  return json({ caminho, tamanho: img.tamanho, custo_usd: img.custoUsd, saldo_usd: img.saldoUsd, modelo_id: img.modeloId, reserva_usada: img.reservaUsada ?? null });
}

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  sugerir,
  cena_estimar: cenaEstimar,
  cena_gerar: cenaGerar,
};

/** Ações que podem passar de 150 s: a resposta começa na hora. */
const ACOES_LONGAS = new Set(["cena_gerar", "sugerir"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const chamador = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    const rodar = async () => {
      try {
        return await fn(chamador, corpo);
      } catch (err) {
        return respostaDeErro(err);
      }
    };
    return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
