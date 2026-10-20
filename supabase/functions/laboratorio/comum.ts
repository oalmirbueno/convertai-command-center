/**
 * laboratorio: o que toda ação usa (acesso, banco, erros, carteira, contexto da marca).
 * Só admin, manager e design (rota /laboratorio). Erro sai como { error, mensagem }.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { IaMotorErro, type Tarefa } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { clienteInternoDaAgencia } from "../_shared/nucleo-das-mesas.ts";
import { lerContextoConsolidado, lerMarcaParaDirecao } from "../_shared/contexto-cliente.ts";
import { blocoDaMarca, lerMarcaCompleta, marcasDoCliente } from "../_shared/marca.ts";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { ErroDoCanvas } from "./modulos/regras.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Tarefa do Laboratório em ia_usos (a migration 20261019180000 amplia o CHECK).
 * O tipo Tarefa do motor ainda não lista 'laboratorio': o cast evita mexer no _shared/ia-motor.ts.
 */
export const TAREFA = "laboratorio" as unknown as Tarefa;
export const PAPEIS_DO_LABORATORIO = ["admin", "manager", "design"];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ErroHttp extends Error {
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

const MENSAGEM_MOTOR: Record<string, { status: number; mensagem: string }> = {
  saldo_insuficiente: { status: 402, mensagem: "Saldo insuficiente na carteira de IA. Peça a recarga a um admin ou gestor." },
  cota_da_chave_esgotada: { status: 402, mensagem: "A cota do mês da chave de IA deste cliente acabou." },
  cliente_sem_chave: { status: 403, mensagem: "Este cliente não tem chave de IA própria e o uso da chave da agência está desligado para ele." },
  provedor_sem_chave: { status: 503, mensagem: "O provedor deste modelo está sem chave de API configurada." },
};

export function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof ErroDoCanvas) return json({ error: err.codigo, mensagem: err.message, erros: err.erros }, 400);
  if (err instanceof IaMotorErro) {
    const conhecido = MENSAGEM_MOTOR[err.codigo];
    const status = conhecido?.status ?? (err.status >= 400 ? err.status : 500);
    return json({ ...err.paraJson(), mensagem: conhecido?.mensagem ?? err.message }, status);
  }
  registrarFalha("laboratorio: erro inesperado", err);
  return json({ error: "erro_interno", mensagem: "Falha inesperada no Laboratório." }, 500);
}

// ------------------------------------------------------------------ banco e acesso

export type Chamador = { userId: string; token: string; papeis: string[]; doChamador: SupabaseClient };

let servicoCache: SupabaseClient | null = null;
export function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Lê o usuário pelo JWT e exige admin, manager ou design. */
export async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data, error } = await servico().from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  const papeis = ((data || []) as Array<{ role: string }>).map((r) => String(r.role));
  if (!papeis.some((p) => PAPEIS_DO_LABORATORIO.indexOf(p) >= 0)) {
    throw new ErroHttp(403, "somente_equipe", "O Laboratório é da equipe (admin, gestor ou design).");
  }
  return { userId, token, papeis, doChamador: clienteDoChamador(token) };
}

export async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "client_id precisa ser um UUID.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

export const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroHttp(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};
export const idOuNulo = (v: unknown, nome: string): string | null => (v == null || v === "" ? null : idDe(v, nome));
export const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Tabela do Laboratório ainda não criada (migration pendente)? */
export function semTabela(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const m = String(error.message || "");
  return error.code === "42P01" || error.code === "PGRST205" || /lab_[a-z_]+.*(does not exist|schema cache)/i.test(m);
}

export function erroDoBanco(error: { code?: string; message?: string } | null, codigo: string, frase: string): ErroHttp {
  if (semTabela(error)) return new ErroHttp(503, "banco_sem_laboratorio", "O banco ainda não tem as tabelas do Laboratório (migration 20261019180000_laboratorio.sql pendente).");
  registrarFalha(`laboratorio: ${codigo}`, error);
  return new ErroHttp(503, codigo, frase);
}

export async function nomeDoCliente(clientId: string): Promise<string> {
  const { data } = await servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle();
  const p = data as { company_name?: string | null; full_name?: string | null } | null;
  return (p && (p.company_name || p.full_name)) || "Cliente";
}

// ------------------------------------------------------------------ carteira

export type Carteira = { clientId: string; livre: boolean };

/** Carteira que paga: o cliente do projeto ou, sem cliente ("Livre"), o cliente interno da agência. */
export async function carteiraDe(clientId: string | null): Promise<Carteira> {
  if (clientId) return { clientId, livre: false };
  const interno = await clienteInternoDaAgencia(servico());
  if (!interno) throw new ErroHttp(503, "sem_cliente_interno", "Não achei o cliente interno da Aceleriq para pagar os trabalhos livres.");
  return { clientId: interno, livre: true };
}

/**
 * 20/10: a marca escolhida no nó Marca (cliente_marcas, cliente com duas marcas, como Acerbi e CME) em texto.
 * Só os dados DESTA marca (paleta, tom, estilo, regras, contexto dela): outra marca nunca herda cor, logo
 * nem contexto. Marca de outro cliente ou inexistente: vazio.
 */
export async function marcaEmTextoDaMarca(clientId: string, marcaId: string): Promise<string> {
  try {
    const [m, todas] = await Promise.all([lerMarcaCompleta(servico(), clientId, marcaId), marcasDoCliente(servico(), clientId)]);
    if (!m) return "";
    const paleta = (Array.isArray(m.paleta) ? m.paleta as Array<{ nome?: string; hex?: string; papel?: string }> : []).map((p) => [p.nome, p.hex, p.papel].filter(Boolean).join(" ")).filter(Boolean).join("; ");
    const c = (m.contexto || {}) as Record<string, unknown>;
    const t = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return [
      blocoDaMarca(m, todas),
      t(c.negocio) ? `Negócio: ${t(c.negocio)}` : "",
      t(c.publico) ? `Público: ${t(c.publico)}` : "",
      t(c.oferta) ? `Oferta: ${t(c.oferta)}` : "",
      t(m.tom) || t(c.tom_de_voz) ? `Tom de voz: ${t(m.tom) || t(c.tom_de_voz)}` : "",
      paleta ? `Paleta: ${paleta}` : "",
      t(m.estilo) ? `Estilo: ${t(m.estilo)}` : "",
      t(m.regras) ? `Regras da marca: ${t(m.regras)}` : "",
    ].filter(Boolean).join("\n").slice(0, 4000);
  } catch (e) {
    registrarFalha("laboratorio: marca escolhida sem leitura", e, { client_id: clientId, marca_id: marcaId });
    return "";
  }
}

/** Marca e contexto do cliente em texto (vazio para o Livre). */
export async function marcaEmTexto(clientId: string | null): Promise<string> {
  if (!clientId) return "";
  try {
    const [m, ctx] = await Promise.all([lerMarcaParaDirecao(servico(), clientId), lerContextoConsolidado(servico(), clientId)]);
    const paleta = m.paleta.map((p) => [p.nome, p.hex, p.papel].filter(Boolean).join(" ")).filter(Boolean).join("; ");
    const fontes = m.fontes.map((f) => `${f.nome} (${f.papel})`).join(", ");
    return [
      `Cliente: ${m.nomeCliente}`,
      ctx.negocio ? `Negócio: ${ctx.negocio}` : "",
      ctx.publico ? `Público: ${ctx.publico}` : "",
      ctx.oferta ? `Oferta: ${ctx.oferta}` : "",
      m.tomDeVoz ? `Tom de voz: ${m.tomDeVoz}` : "",
      paleta ? `Paleta: ${paleta}` : "",
      fontes ? `Fontes: ${fontes}` : "",
      m.estilo ? `Estilo: ${m.estilo}` : "",
      m.regras ? `Regras da marca: ${m.regras}` : "",
    ].filter(Boolean).join("\n").slice(0, 4000);
  } catch (e) {
    registrarFalha("laboratorio: marca do cliente sem leitura", e, { client_id: clientId });
    return "";
  }
}

/** Trabalho depois da resposta (EdgeRuntime.waitUntil); sem EdgeRuntime (teste local) devolve false e quem chamou espera. */
export function emSegundoPlano(p: Promise<unknown>): boolean {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") {
    er.waitUntil(p.catch((e) => registrarFalha("laboratorio: trabalho em segundo plano falhou", e)));
    return true;
  }
  return false;
}
