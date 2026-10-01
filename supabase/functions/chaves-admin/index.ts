/**
 * chaves-admin (frente CHV, 01/10/2026): Configurações › Chaves e custos.
 * Só o admin. A chave nunca volta para o navegador: só os 4 últimos.
 *
 * POST { acao: "listar" }
 *   -> QuadroDasChaves (uma linha por provedor: estado, origem, final, último
 *      teste com saldo e uso, gasto do mês no ia_usos) e os últimos eventos.
 * POST { acao: "testar", provedor }
 *   -> testa a chave EM USO (servidor primeiro, depois o cofre) numa rota de
 *      consulta do provedor, sem custo, e guarda o resultado.
 * POST { acao: "salvar", provedor, valores: { NOME: "segredo" }, confirmar? }
 *   -> testa ANTES de gravar. Recusada pelo provedor, não grava e devolve
 *      { precisa_confirmar: true } (a não ser que venha confirmar: true).
 *      Grava no Vault (vault.create_secret / update_secret) pela RPC
 *      chaves_admin_salvar e registra "chave X trocada por fulano".
 * POST { acao: "alerta", provedor, saldo_minimo_usd }
 *   -> ajusta o aviso de saldo baixo do provedor (começa em US$ 10).
 * POST { acao: "uso_semana" }
 *   -> uso dos últimos 7 dias por agente (só números), para Modelos de IA
 *      mostrar o custo estimado por semana antes de trocar o padrão de um papel.
 * POST { acao: "remover", provedor, confirmar: true }
 *   -> tira do cofre (o segredo do servidor, se houver, continua valendo).
 *
 * Nada da chave vai para log, erro, auditoria ou ia_usos. Os erros levam só o
 * código e uma frase nossa.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { carregarChaves, chaveCarregada, esquecerChaves } from "../_shared/chaves.ts";
import { provedorPorId, SEGREDOS_DO_CATALOGO } from "./modulos/catalogo.ts";
import { finalDe, type ListadoDoBanco, montarQuadro, type PresencaNoServidor } from "./modulos/quadro.ts";
import { semAChave, testarChave } from "./modulos/testes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  return servicoCache;
}

interface Admin {
  userId: string;
  nome: string;
}

async function identificarAdmin(req: Request): Promise<Admin> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const admin = await servico().rpc("has_role", { _user_id: userId, _role: "admin" });
  if (admin.error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (admin.data !== true) throw new ErroHttp(403, "somente_admin", "Só o admin cadastra e testa as chaves.");
  const { data: perfil } = await servico().from("profiles").select("full_name").eq("id", userId).maybeSingle();
  const nome = String((perfil && (perfil as { full_name?: string | null }).full_name) || user?.user?.email || "admin").slice(0, 120);
  return { userId, nome };
}

const lerAmbiente = (nome: string) => {
  try {
    return (Deno.env.get(nome) || "").trim();
  } catch {
    return "";
  }
};

/** Finais dos segredos que existem no ambiente desta função (o valor não sai daqui). */
function presencaNoServidor(): PresencaNoServidor {
  const p: PresencaNoServidor = {};
  SEGREDOS_DO_CATALOGO.forEach((n) => {
    const v = lerAmbiente(n);
    if (v) p[n] = finalDe(v);
  });
  return p;
}

async function listado(): Promise<ListadoDoBanco> {
  const { data, error } = await servico().rpc("chaves_admin_listar");
  if (error) {
    registrarFalha("chaves-admin: listar", new Error(String(error.message || "sem leitura")));
    if (/chaves_admin_listar|schema cache|PGRST20|42883/i.test(String(error.message || "") + String(error.code || ""))) {
      throw new ErroHttp(503, "banco_sem_chaves", "O cofre das chaves ainda não foi ativado no banco (migration 20260930323000).");
    }
    throw new ErroHttp(503, "leitura_indisponivel", "Não foi possível ler as chaves agora.");
  }
  return (data || {}) as ListadoDoBanco;
}

function exigirProvedor(id: unknown) {
  const p = provedorPorId(String(id || ""));
  if (!p) throw new ErroHttp(400, "provedor_invalido", "Provedor desconhecido.");
  return p;
}

async function listar() {
  return json(montarQuadro(await listado(), presencaNoServidor()));
}

async function testar(admin: Admin, corpo: Record<string, unknown>) {
  const p = exigirProvedor(corpo.provedor);
  const nomes = p.campos.map((c) => c.nome);
  esquecerChaves(nomes);
  await carregarChaves(nomes);
  const valores: Record<string, string> = {};
  nomes.forEach((n) => {
    const v = chaveCarregada(n);
    if (v) valores[n] = v;
  });
  if (Object.keys(valores).length < nomes.length) throw new ErroHttp(409, "sem_chave", `O ${p.nome} ainda não tem chave. Cadastre antes de testar.`);
  const origem = nomes.some((n) => !lerAmbiente(n)) ? "painel" : "servidor";
  const r = await testarChave(p.id, valores, (u, i) => fetch(u, i));
  const { error } = await servico().rpc("chaves_admin_registrar_teste", {
    _provedor: p.id,
    _estado: r.estado,
    _origem: origem,
    _final_chave: finalDe(valores[nomes[0]]),
    _resultado: { mensagem: r.mensagem, numeros: r.numeros, http: r.http },
    _ator: admin.userId,
  });
  if (error) registrarFalha("chaves-admin: registrar teste", new Error(String(error.message || "sem escrita")), { provedor: p.id });
  const quadro = montarQuadro(await listado(), presencaNoServidor());
  return json({ teste: semAChave({ estado: r.estado, mensagem: r.mensagem, numeros: r.numeros }, valores), linha: quadro.linhas.find((l) => l.id === p.id) || null, quadro });
}

/** Lê e confere os valores enviados: só os segredos do provedor, sem espaço, de 8 a 4096 caracteres. */
function valoresDoPedido(p: ReturnType<typeof exigirProvedor>, bruto: unknown): Record<string, string> {
  const entrada = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const permitidos = new Set(p.campos.map((c) => c.nome as string));
  const saida: Record<string, string> = {};
  for (const [nome, v] of Object.entries(entrada)) {
    if (!permitidos.has(nome)) throw new ErroHttp(400, "campo_invalido", "Esse campo não é deste provedor.");
    const valor = typeof v === "string" ? v.trim() : "";
    if (!valor) continue;
    if (valor.length < 8 || valor.length > 4096 || /\s/.test(valor)) throw new ErroHttp(400, "chave_mal_formada", "A chave parece incompleta ou tem espaço no meio. Cole de novo.");
    saida[nome] = valor;
  }
  if (!Object.keys(saida).length) throw new ErroHttp(400, "chave_vazia", "Cole a chave antes de salvar.");
  return saida;
}

async function salvar(admin: Admin, corpo: Record<string, unknown>) {
  const p = exigirProvedor(corpo.provedor);
  const novos = valoresDoPedido(p, corpo.valores);
  const nomes = p.campos.map((c) => c.nome as string);
  // Para testar a chave nova junto da outra metade (Higgsfield), completa com a em uso.
  esquecerChaves(nomes);
  await carregarChaves(nomes);
  const completos: Record<string, string> = {};
  nomes.forEach((n) => {
    const v = novos[n] || chaveCarregada(n);
    if (v) completos[n] = v;
  });
  const r = await testarChave(p.id, completos, (u, i) => fetch(u, i));
  if (r.estado === "invalida" && corpo.confirmar !== true) {
    return json({ salva: false, precisa_confirmar: true, teste: semAChave({ estado: r.estado, mensagem: r.mensagem, numeros: r.numeros }, completos) });
  }
  const { error } = await servico().rpc("chaves_admin_salvar", {
    _provedor: p.id,
    _valores: novos,
    _teste: { estado: r.estado, final_chave: finalDe(completos[nomes[0]] || ""), resultado: { mensagem: r.mensagem, numeros: r.numeros, http: r.http } },
    _ator: admin.userId,
    _ator_nome: admin.nome,
  });
  if (error) {
    // Só o código e o provedor: a mensagem do banco pode citar o parâmetro.
    registrarFalha("chaves-admin: salvar", new Error(`falha ao gravar (${String(error.code || "sem código")})`), { provedor: p.id });
    throw new ErroHttp(503, "gravacao_indisponivel", "Não foi possível guardar a chave agora. Nada mudou.");
  }
  esquecerChaves(nomes);
  const quadro = montarQuadro(await listado(), presencaNoServidor());
  const linha = quadro.linhas.find((l) => l.id === p.id) || null;
  const servidorManda = nomes.some((n) => !!lerAmbiente(n));
  return json({
    salva: true,
    teste: semAChave({ estado: r.estado, mensagem: r.mensagem, numeros: r.numeros }, completos),
    aviso: servidorManda ? `O segredo do servidor (${nomes.filter((n) => lerAmbiente(n)).join(", ")}) continua com prioridade. Para valer a chave do painel, apague esse segredo no Supabase.` : null,
    linha,
    quadro,
  });
}

/** Aviso de saldo baixo do provedor (US$; começa em 10). */
async function alerta(admin: Admin, corpo: Record<string, unknown>) {
  const p = exigirProvedor(corpo.provedor);
  const valor = Number(corpo.saldo_minimo_usd);
  if (!isFinite(valor) || valor < 0 || valor > 100000) throw new ErroHttp(400, "alerta_invalido", "Use um valor em dólar entre 0 e 100.000.");
  const { error } = await servico().rpc("chaves_admin_alerta", { _provedor: p.id, _saldo_minimo_usd: Math.round(valor * 100) / 100, _ator: admin.userId });
  if (error) {
    registrarFalha("chaves-admin: alerta", new Error(`falha ao gravar (${String(error.code || "sem código")})`), { provedor: p.id });
    throw new ErroHttp(503, "gravacao_indisponivel", "Não foi possível guardar o aviso agora.");
  }
  const quadro = montarQuadro(await listado(), presencaNoServidor());
  return json({ linha: quadro.linhas.find((l) => l.id === p.id) || null, quadro });
}

/** Uso dos últimos 7 dias por agente: base da estimativa semanal ao trocar o modelo de um papel. */
async function usoDaSemana() {
  const { data, error } = await servico().rpc("chaves_admin_uso_semana");
  if (error) {
    registrarFalha("chaves-admin: uso da semana", new Error(String(error.message || "sem leitura")));
    throw new ErroHttp(503, "leitura_indisponivel", "Não foi possível ler o uso da semana agora.");
  }
  return json({ agentes: Array.isArray(data) ? data : [], desde_dias: 7 });
}

async function remover(admin: Admin, corpo: Record<string, unknown>) {
  const p = exigirProvedor(corpo.provedor);
  if (corpo.confirmar !== true) throw new ErroHttp(400, "precisa_confirmar", "Confirme para remover a chave.");
  const { data, error } = await servico().rpc("chaves_admin_remover", { _provedor: p.id, _ator: admin.userId, _ator_nome: admin.nome });
  if (error) {
    registrarFalha("chaves-admin: remover", new Error(`falha ao remover (${String(error.code || "sem código")})`), { provedor: p.id });
    throw new ErroHttp(503, "remocao_indisponivel", "Não foi possível remover agora. Nada mudou.");
  }
  esquecerChaves(p.campos.map((c) => c.nome));
  const removidos = Array.isArray((data as { nomes?: unknown })?.nomes) ? ((data as { nomes: unknown[] }).nomes.length) : 0;
  const quadro = montarQuadro(await listado(), presencaNoServidor());
  return json({ removida: removidos > 0, linha: quadro.linhas.find((l) => l.id === p.id) || null, quadro });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const admin = await identificarAdmin(req);
    let corpo: Record<string, unknown> = {};
    try {
      const lido = await req.json();
      corpo = lido && typeof lido === "object" ? (lido as Record<string, unknown>) : {};
    } catch {
      corpo = {};
    }
    const acao = String(corpo.acao || "listar");
    if (acao === "listar") return await listar();
    if (acao === "testar") return await testar(admin, corpo);
    if (acao === "salvar") return await salvar(admin, corpo);
    if (acao === "remover") return await remover(admin, corpo);
    if (acao === "alerta") return await alerta(admin, corpo);
    if (acao === "uso_semana") return await usoDaSemana();
    throw new ErroHttp(400, "acao_invalida", "Ação desconhecida.");
  } catch (err) {
    if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
    // Nunca o corpo do pedido: ele traz a chave.
    registrarFalha("chaves-admin: erro inesperado", err instanceof Error ? new Error(err.name) : new Error("erro"));
    return json({ error: "erro_interno", mensagem: "Não foi possível concluir agora. Tente de novo." }, 500);
  }
});

