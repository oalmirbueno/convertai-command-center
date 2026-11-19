/**
 * E-mail profissional, a parte que fala com a Cloudflare e o Zoho (18/11/2026).
 * Contrato: supabase/migrations/20261118170000_produto_email_rota_unica.sql.
 *
 * Só o dono da casa chama. Cloudflare e Zoho: só leitura. Migadu (19/11/2026, o correio da Aceleriq):
 *   conferir_migadu { dominio_id }  -> { resumo }  domínio, registros de DNS e caixas (leitura)
 *   montar_migadu { dominio_id }    -> cria o domínio, as caixas por convite e os apelidos (pode repetir)
 *   ativar_migadu { dominio_id }    -> pede ao Migadu para conferir o DNS e ativar
 * Central de acessos (19/11/2026; a senha da caixa mora no Vault e só volta em caixa_mostrar_senha):
 *   caixa_criar { dominio_id, endereco, senha, pessoa? }  -> { caixa_id, guardada, extra, aviso }  (Migadu)
 *   caixa_mostrar_senha { caixa_id }                      -> { senha }  cada vez fica no histórico
 *   caixa_redefinir_senha { caixa_id, senha, so_guardar? } -> { redefinida, guardada }
 *   caixa_desativar { caixa_id }                          -> { desativada, extra, aviso }
 *   Segredos: MIGADU_USUARIO (e-mail da conta Migadu) e MIGADU_API_KEY. Fora da central de acessos, nenhuma senha de caixa passa aqui.
 *   conferir_cloudflare { dominio_id }        -> { resumo }  zona, proxy, MX, SPF, DKIM, DMARC
 *   conferir_zoho { dominio_id }              -> { resumo }  organização, caixas, apelidos, domínio e DKIM
 *   guardar_token_zoho { dominio_id, token }  -> { guardado } refresh token do cliente no Vault ("" apaga)
 *   caixa_estado {}                           -> { estado }  a caixa oficial da Aceleriq (desligada por padrão)
 *   caixa_listar {}                           -> { mensagens } só com a caixa ligada
 *
 * Segredos da função (nunca no banco do painel nem no front):
 *   CLOUDFLARE_API_TOKEN (Zone:Read e DNS:Read na conta da Aceleriq), CLOUDFLARE_ACCOUNT_ID (opcional),
 *   ZOHO_CLIENT_ID e ZOHO_CLIENT_SECRET (o app OAuth da Aceleriq no console da Zoho),
 *   ACELERIQ_CAIXA_LIGADA=sim (só quando o dono ligar a caixa), ACELERIQ_CAIXA_DOMINIO_ID.
 * O refresh token de cada cliente fica no Vault (produto_email_guardar_token_zoho).
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { lerZona, resumirZona } from "./modulos/cloudflare.ts";
import { dcValido, lerOrganizacao, resumirZoho, SemPermissaoNoZoho, tokenDeAcesso, urlDoMail } from "./modulos/zoho.ts";
import { estadoDaCaixa, lerMensagens } from "./modulos/caixa.ts";
import {
  ativarNoMigadu,
  caixasNoMigadu,
  bloquearCaixaNoMigadu,
  credencialValida,
  criarCaixaComSenhaNoMigadu,
  dominioNoMigadu,
  ErroDoMigadu,
  montarNoMigadu,
  mudarSenhaNoMigadu,
  parteLocal,
  registrosNoMigadu,
  type CaixaPedida,
  type CredencialDoMigadu,
} from "./modulos/migadu.ts";
import { problemaDaSenha, valorDoExtraDeEmail, type MudancaNaEquipe } from "../produto/modulos/acessos.ts";

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

interface Dominio {
  id: string;
  conta_id: string;
  dominio: string;
  provedor: string;
  dkim_seletor: string | null;
  cloudflare_zona_id: string | null;
  zoho_org_id: string | null;
  zoho_dc: string | null;
  zoho_plano: string | null;
}

async function lerDominio(id: unknown): Promise<Dominio> {
  if (typeof id !== "string" || !UUID.test(id)) throw new ErroHttp(400, "dominio_invalido", "Pedido incompleto. Recarregue a tela.");
  const { data } = await servico().from("produto_email_dominios")
    .select("id, conta_id, dominio, provedor, dkim_seletor, cloudflare_zona_id, zoho_org_id, zoho_dc, zoho_plano").eq("id", id).maybeSingle();
  if (!data) throw new ErroHttp(404, "dominio_inexistente", "O domínio não foi encontrado.");
  return data as Dominio;
}

async function gravar(dominioId: string, onde: "cloudflare" | "zoho" | "migadu", resultado: unknown) {
  const { error } = await servico().rpc("produto_email_gravar_conferencia", { _dominio_id: dominioId, _onde: onde, _resultado: resultado });
  if (error) console.error("[produto-email] conferência não gravada", error.message.slice(0, 160));
}

async function conferirCloudflare(ator: string, corpo: Record<string, unknown>) {
  const d = await lerDominio(corpo.dominio_id);
  const token = amb("CLOUDFLARE_API_TOKEN");
  if (!token) throw new ErroHttp(409, "sem_chave", "Falta o segredo CLOUDFLARE_API_TOKEN na função produto-email (Zone:Read e DNS:Read na conta da Aceleriq).");
  let lido;
  try {
    lido = await lerZona(token, fetch, { dominio: d.dominio, zonaId: d.cloudflare_zona_id, contaId: amb("CLOUDFLARE_ACCOUNT_ID") || null });
  } catch (e) {
    throw new ErroHttp(502, "cloudflare", e instanceof Error ? e.message : "A Cloudflare não respondeu.");
  }
  if (!lido) {
    const vazio = { ok: false, itens: [{ chave: "zona", situacao: "falta", texto: `A zona ${d.dominio} não está na Cloudflare da Aceleriq.` }], conferido_em: new Date().toISOString() };
    await gravar(d.id, "cloudflare", vazio);
    return json({ resumo: vazio });
  }
  const resumo = resumirZona(lido.zona, lido.registros, { dominio: d.dominio, provedor: d.provedor, seletor: d.dkim_seletor });
  await gravar(d.id, "cloudflare", resumo);
  if (!d.cloudflare_zona_id) {
    await servico().rpc("produto_email_dominio_atualizar", { _dominio_id: d.id, _dados: { cloudflare_zona_id: lido.zona.id }, _ator: ator });
  }
  return json({ resumo });
}

async function acessoDoZoho(d: Dominio): Promise<{ acesso: string; dc: ReturnType<typeof dcValido> }> {
  const clientId = amb("ZOHO_CLIENT_ID");
  const clientSecret = amb("ZOHO_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new ErroHttp(409, "sem_chave", "Faltam os segredos ZOHO_CLIENT_ID e ZOHO_CLIENT_SECRET na função produto-email.");
  const { data: refresh } = await servico().rpc("produto_email_ler_token_zoho", { _dominio_id: d.id });
  if (!refresh) throw new ErroHttp(409, "sem_token", "Guarde o token do Zoho deste cliente em Integração antes de conferir.");
  const dc = dcValido(d.zoho_dc);
  try {
    return { acesso: await tokenDeAcesso(fetch, { dc, clientId, clientSecret, refreshToken: String(refresh) }), dc };
  } catch (e) {
    throw new ErroHttp(502, "zoho", e instanceof Error ? e.message : "O Zoho não respondeu.");
  }
}

async function conferirZoho(ator: string, corpo: Record<string, unknown>) {
  const d = await lerDominio(corpo.dominio_id);
  const { acesso, dc } = await acessoDoZoho(d);
  try {
    const org = await lerOrganizacao(fetch, { dc, acesso, orgId: d.zoho_org_id, dominio: d.dominio });
    const resumo = resumirZoho({ orgId: org.orgId, plano: org.plano || d.zoho_plano, usuarios: org.usuarios, dominio: org.dominio, nomeDoDominio: d.dominio });
    await gravar(d.id, "zoho", resumo);
    if (org.orgId && org.orgId !== d.zoho_org_id) {
      await servico().rpc("produto_email_dominio_atualizar", { _dominio_id: d.id, _dados: { zoho_org_id: org.orgId }, _ator: ator });
    }
    return json({ resumo });
  } catch (e) {
    if (e instanceof SemPermissaoNoZoho) {
      const resumo = { ok: false, sem_api: true, avisos: [e.message], conferido_em: new Date().toISOString() };
      await gravar(d.id, "zoho", resumo);
      return json({ resumo });
    }
    throw new ErroHttp(502, "zoho", e instanceof Error ? e.message : "O Zoho não respondeu.");
  }
}

async function guardarTokenZoho(_ator: string, corpo: Record<string, unknown>) {
  const d = await lerDominio(corpo.dominio_id);
  const token = typeof corpo.token === "string" ? corpo.token.trim() : "";
  if (token && !/^1000\.[0-9a-f]{20,}\.[0-9a-f]{20,}$/i.test(token)) {
    throw new ErroHttp(400, "token_invalido", "Isso não parece um refresh token do Zoho (começa com 1000.). Gere no console de API da Zoho.");
  }
  const { data, error } = await servico().rpc("produto_email_guardar_token_zoho", { _dominio_id: d.id, _token: token });
  if (error) throw new ErroHttp(500, "cofre", "Não foi possível guardar no cofre agora.");
  return json({ guardado: data === true });
}

async function dominioDaCaixa(): Promise<Dominio | null> {
  const id = amb("ACELERIQ_CAIXA_DOMINIO_ID");
  if (!UUID.test(id)) return null;
  try {
    return await lerDominio(id);
  } catch {
    return null;
  }
}

async function caixaEstado() {
  const d = await dominioDaCaixa();
  let temToken = false;
  if (d) {
    const { data } = await servico().rpc("produto_email_ler_token_zoho", { _dominio_id: d.id });
    temToken = !!data;
  }
  return json({ estado: estadoDaCaixa({ flag: amb("ACELERIQ_CAIXA_LIGADA"), temToken, temDominio: !!d }), dominio: d ? d.dominio : null });
}

async function caixaListar() {
  const d = await dominioDaCaixa();
  const { data: tok } = d ? await servico().rpc("produto_email_ler_token_zoho", { _dominio_id: d.id }) : { data: null };
  const estado = estadoDaCaixa({ flag: amb("ACELERIQ_CAIXA_LIGADA"), temToken: !!tok, temDominio: !!d });
  if (!estado.ligada || !d) throw new ErroHttp(409, "caixa_desligada", estado.motivo || "A caixa está desligada.");
  const { acesso, dc } = await acessoDoZoho(d);
  const cabecalho = { headers: { Authorization: `Zoho-oauthtoken ${acesso}`, Accept: "application/json" } };
  const contas = await (await fetch(`${urlDoMail(dc)}/api/accounts`, cabecalho)).json().catch(() => null) as { data?: Array<{ accountId?: string }> } | null;
  const conta = contas && contas.data && contas.data[0] ? contas.data[0].accountId : null;
  if (!conta) throw new ErroHttp(502, "zoho", "O Zoho não devolveu a conta da caixa (o plano pode não ter a API de mensagens).");
  const r = await fetch(`${urlDoMail(dc)}/api/accounts/${encodeURIComponent(conta)}/messages/view?limit=30&sortorder=false`, cabecalho);
  const d2 = await r.json().catch(() => null) as { data?: unknown } | null;
  if (!r.ok) throw new ErroHttp(502, "zoho", `O Zoho respondeu ${r.status} ao listar as mensagens.`);
  return json({ mensagens: lerMensagens(d2 && d2.data) });
}

// ------------------------------------------------------------------ Migadu (o correio da Aceleriq)

function credencialDoMigadu(): CredencialDoMigadu {
  const c = credencialValida(amb("MIGADU_USUARIO"), amb("MIGADU_API_KEY"));
  if (!c) throw new ErroHttp(503, "migadu_sem_chave", "O Migadu ainda não está conectado: falta contratar o plano e guardar o e-mail da conta e a chave da API nos segredos da função.");
  return c;
}

function erroDoMigadu(e: unknown): ErroHttp {
  if (e instanceof ErroHttp) return e;
  if (e instanceof ErroDoMigadu) {
    console.error("[produto-email] migadu", e.etapa, e.status, e.message.slice(0, 160));
    return new ErroHttp(e.status >= 500 ? 502 : 400, "migadu", e.status >= 500 ? "O Migadu não respondeu agora. Tente de novo em instantes." : e.message);
  }
  return new ErroHttp(500, "erro_interno", "Falha inesperada ao falar com o Migadu.");
}

/** Lê o domínio no Migadu: se existe, se está ativo, os registros de DNS e as caixas. Só leitura. */
async function conferirMigadu(_ator: string, corpo: Record<string, unknown>) {
  const d = await lerDominio(corpo.dominio_id);
  const c = credencialDoMigadu();
  try {
    const dom = await dominioNoMigadu(c, fetch, d.dominio);
    const resumo = dom
      ? { ok: dom.ativo, existe: true, dominio: dom, registros: await registrosNoMigadu(c, fetch, d.dominio), caixas: await caixasNoMigadu(c, fetch, d.dominio), conferido_em: new Date().toISOString() }
      : { ok: false, existe: false, registros: [], caixas: [], conferido_em: new Date().toISOString() };
    await gravar(d.id, "migadu", resumo);
    return json({ resumo });
  } catch (e) {
    throw erroDoMigadu(e);
  }
}

/**
 * Monta o domínio no Migadu: cria o domínio (DNS fora, na Cloudflare), as caixas pedidas por convite
 * e os apelidos. Pode rodar de novo. Devolve os registros de DNS para publicar.
 */
async function montarMigadu(ator: string, corpo: Record<string, unknown>) {
  const d = await lerDominio(corpo.dominio_id);
  if (d.provedor !== "migadu") throw new ErroHttp(409, "outro_provedor", "Este domínio não está no Migadu. Mude o provedor do domínio antes.");
  const c = credencialDoMigadu();
  const [{ data: caixas }, { data: conta }] = await Promise.all([
    servico().from("produto_email_caixas").select("id, endereco, tipo, pessoa, estado, email_convite, destinos").eq("dominio_id", d.id).neq("estado", "removida"),
    servico().from("produto_contas").select("email_cobranca").eq("id", d.conta_id).maybeSingle(),
  ]);
  const reserva = String((conta as { email_cobranca?: string | null } | null)?.email_cobranca || "").toLowerCase();
  const pedidas: CaixaPedida[] = ((caixas || []) as Array<{ id: string; endereco: string; tipo: CaixaPedida["tipo"]; pessoa: string | null; email_convite: string | null; destinos: string[] | null }>).map((x) => ({
    id: x.id,
    endereco: x.endereco,
    tipo: x.tipo,
    pessoa: x.pessoa,
    // O convite vai para o e-mail de hoje da pessoa; sem ele, para quem administra a empresa (se for de fora do domínio).
    recuperacao: x.email_convite || (reserva && !reserva.endsWith(`@${d.dominio}`) ? reserva : null),
    destinos: x.destinos || [],
  }));
  try {
    const r = await montarNoMigadu(c, fetch, { dominio: d.dominio, caixas: pedidas });
    const feitas = new Set([...r.criadas, ...r.ja_existiam]);
    const ids = pedidas.filter((x) => feitas.has(x.endereco.toLowerCase())).map((x) => x.id);
    if (ids.length) await servico().from("produto_email_caixas").update({ estado: "criada", atualizado_em: new Date().toISOString() }).in("id", ids).eq("estado", "pedida");
    await gravar(d.id, "migadu", { ok: r.dominio.ativo, existe: true, dominio: r.dominio, registros: r.registros, pendentes: r.pendentes, conferido_em: new Date().toISOString() });
    await servico().from("produto_historico").insert({ conta_id: d.conta_id, ator, acao: "migadu_montado", detalhe: { dominio: d.dominio, criadas: r.criadas, pendentes: r.pendentes.length } });
    return json(r);
  } catch (e) {
    throw erroDoMigadu(e);
  }
}

/** Pede ao Migadu para conferir o DNS e ativar o domínio (depois de publicar os registros). */
async function ativarMigadu(_ator: string, corpo: Record<string, unknown>) {
  const d = await lerDominio(corpo.dominio_id);
  try {
    return json(await ativarNoMigadu(credencialDoMigadu(), fetch, d.dominio));
  } catch (e) {
    throw erroDoMigadu(e);
  }
}

// ------------------------------------------------------------------ central de acessos (19/11/2026)
//
// A senha de cada caixa mora no Vault (produto_email_guardar_segredo_da_caixa, a mesma que o correio usa
// para abrir a caixa por IMAP). Ela só sai daqui para o dono, na ação caixa_mostrar_senha, e cada vez fica
// no histórico da empresa (quem e quando). Nunca vai para log, erro ou outra resposta.

const semCache = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** Tira a senha de qualquer frase que vá para a tela (o Migadu não costuma repetir, mas não confiamos). */
const semSenha = (frase: string, senha: string) => (senha ? frase.split(senha).join("•••") : frase);

interface CaixaDaCentral {
  id: string;
  conta_id: string;
  dominio_id: string;
  endereco: string;
  tipo: string;
  estado: string;
  pessoa: string | null;
}

async function lerCaixaDaCentral(id: unknown): Promise<{ caixa: CaixaDaCentral; dominio: Dominio }> {
  if (typeof id !== "string" || !UUID.test(id)) throw new ErroHttp(400, "caixa_invalida", "Escolha a caixa de novo.");
  const { data } = await servico().from("produto_email_caixas").select("id, conta_id, dominio_id, endereco, tipo, estado, pessoa").eq("id", id).maybeSingle();
  const caixa = data as CaixaDaCentral | null;
  if (!caixa || caixa.estado === "removida") throw new ErroHttp(404, "caixa_inexistente", "Essa caixa não está mais ativa.");
  return { caixa, dominio: await lerDominio(caixa.dominio_id) };
}

async function historico(contaId: string, ator: string, acao: string, detalhe: Record<string, unknown>) {
  const { error } = await servico().from("produto_historico").insert({ conta_id: contaId, ator, acao, detalhe });
  if (error) console.error("[produto-email] histórico não gravado", error.message.slice(0, 160));
}

async function guardarNoCofre(caixaId: string, senha: string) {
  const { error } = await servico().rpc("produto_email_guardar_segredo_da_caixa", { _caixa: caixaId, _segredo: senha });
  if (error) throw new ErroHttp(500, "cofre", "A senha mudou no provedor, mas não foi guardada no cofre. Redefina de novo.");
}

/**
 * Caixa adicional mexe no extra de e-mail do cliente (quando a empresa está ligada a um cliente com UM
 * extra de e-mail mensal vivo): cada caixa além das do mensal soma o preço da caixa adicional. Pelo mesmo
 * caminho da ficha (extra_editar com a sessão do dono). Falha aqui não desfaz a caixa: volta como aviso.
 */
async function acompanharExtraDeEmail(token: string, ator: string, contaId: string, mudanca: MudancaNaEquipe, caixasAntes: number): Promise<{ extra_id: string; valor: number } | null> {
  const { data: c } = await servico().from("produto_contas").select("client_id").eq("id", contaId).maybeSingle();
  const clientId = (c as { client_id?: string | null } | null)?.client_id;
  if (!clientId) return null;
  const [{ data: extras }, { data: cfg }] = await Promise.all([
    servico().from("client_extras").select("id, valor, cobranca").eq("client_id", clientId).eq("categoria", "email").neq("status", "encerrado"),
    servico().from("produto_config").select("email_caixas_no_mensal, email_caixa_extra").maybeSingle(),
  ]);
  const vivos = ((extras || []) as Array<{ id: string; valor: number | null; cobranca: string }>).filter((x) => x.cobranca === "mensal");
  if (vivos.length !== 1) return null;
  const g = (cfg || {}) as { email_caixas_no_mensal?: number; email_caixa_extra?: number };
  const valor = valorDoExtraDeEmail({ valorAtual: Number(vivos[0].valor) || 0, caixasAntes, mudanca, caixasNoMensal: Number(g.email_caixas_no_mensal) || 0, precoDaCaixaExtra: Number(g.email_caixa_extra) || 0 });
  if (valor === null) return null;
  const comoDono = createClient(amb("SUPABASE_URL"), amb("SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { error } = await comoDono.rpc("extra_editar", { _id: vivos[0].id, _dados: { valor } });
  if (error) throw new ErroHttp(500, "extra", "A caixa ficou pronta, mas o extra de e-mail do cliente não acompanhou. Confira na ficha do cliente.");
  await historico(contaId, ator, "extra_email_acompanhou", { valor, mudanca });
  return { extra_id: vivos[0].id, valor };
}

const contarCaixas = async (contaId: string) => {
  const { count } = await servico().from("produto_email_caixas").select("id", { count: "exact", head: true }).eq("conta_id", contaId).eq("tipo", "caixa").neq("estado", "removida");
  return count || 0;
};

/** Cria a caixa no Migadu com a senha escolhida, guarda a senha no cofre e registra a caixa na empresa. */
async function caixaCriar(ator: string, corpo: Record<string, unknown>, token: string) {
  const d = await lerDominio(corpo.dominio_id);
  if (d.provedor !== "migadu") throw new ErroHttp(409, "outro_provedor", "Só dá para criar caixa por aqui em domínio do Migadu. Nos outros provedores, crie lá e guarde a senha aqui.");
  const endereco = typeof corpo.endereco === "string" ? corpo.endereco.trim().toLowerCase() : "";
  if (!parteLocal(endereco, d.dominio)) throw new ErroHttp(400, "endereco_invalido", `O endereço precisa terminar em @${d.dominio}.`);
  const senha = typeof corpo.senha === "string" ? corpo.senha : "";
  const problema = problemaDaSenha(senha);
  if (problema) throw new ErroHttp(400, "senha_fraca", problema);
  const pessoa = typeof corpo.pessoa === "string" ? corpo.pessoa.trim().slice(0, 120) : "";
  const { data: ja } = await servico().from("produto_email_caixas").select("id").eq("endereco", endereco).neq("estado", "removida").limit(1);
  if (ja && ja.length) throw new ErroHttp(409, "caixa_existe", "Essa caixa já existe.");
  const antes = await contarCaixas(d.conta_id);
  try {
    await criarCaixaComSenhaNoMigadu(credencialDoMigadu(), fetch, { dominio: d.dominio, endereco, nome: pessoa, senha });
  } catch (e) {
    const erro = erroDoMigadu(e);
    throw new ErroHttp(erro.status, erro.codigo, semSenha(erro.message, senha));
  }
  const { data: linha, error } = await servico().from("produto_email_caixas").insert({
    dominio_id: d.id, conta_id: d.conta_id, endereco, pessoa, tipo: "caixa", estado: "criada",
  }).select("id").single();
  if (error || !linha) throw new ErroHttp(500, "banco", "A caixa foi criada no Migadu, mas não foi registrada aqui. Recarregue e confira.");
  const caixaId = String((linha as { id: string }).id);
  await guardarNoCofre(caixaId, senha);
  await historico(d.conta_id, ator, "caixa_criada_pela_casa", { caixa: caixaId, endereco });
  let extra = null;
  let aviso: string | null = null;
  try {
    extra = await acompanharExtraDeEmail(token, ator, d.conta_id, "entrou", antes);
  } catch (e) {
    aviso = e instanceof Error ? e.message : "O extra de e-mail não acompanhou.";
  }
  return json({ caixa_id: caixaId, endereco, guardada: true, extra, aviso });
}

/** Mostra a senha guardada da caixa. Só o dono; cada visualização fica no histórico da empresa. */
async function caixaMostrarSenha(ator: string, corpo: Record<string, unknown>) {
  const { caixa } = await lerCaixaDaCentral(corpo.caixa_id);
  const { data, error } = await servico().rpc("produto_email_ler_segredo_da_caixa", { _caixa: caixa.id });
  if (error) throw new ErroHttp(500, "cofre", "Não foi possível abrir o cofre agora.");
  const senha = typeof data === "string" ? data : "";
  if (!senha) throw new ErroHttp(404, "sem_senha", "A senha desta caixa ainda não está guardada. Redefina a senha ou guarde a atual.");
  await historico(caixa.conta_id, ator, "senha_da_caixa_vista", { caixa: caixa.id, endereco: caixa.endereco });
  return new Response(JSON.stringify({ senha, endereco: caixa.endereco }), { status: 200, headers: { ...corsHeaders, ...semCache, "Content-Type": "application/json" } });
}

/** Troca a senha da caixa no Migadu e no cofre. Fora do Migadu, só guarda (a casa trocou no provedor). */
async function caixaRedefinirSenha(ator: string, corpo: Record<string, unknown>) {
  const { caixa, dominio } = await lerCaixaDaCentral(corpo.caixa_id);
  if (caixa.tipo !== "caixa") throw new ErroHttp(400, "nao_e_caixa", "Apelido e grupo não têm senha.");
  const senha = typeof corpo.senha === "string" ? corpo.senha : "";
  const problema = problemaDaSenha(senha);
  if (problema) throw new ErroHttp(400, "senha_fraca", problema);
  const noProvedor = dominio.provedor === "migadu" && corpo.so_guardar !== true;
  if (noProvedor) {
    try {
      await mudarSenhaNoMigadu(credencialDoMigadu(), fetch, { dominio: dominio.dominio, endereco: caixa.endereco, senha });
    } catch (e) {
      const erro = erroDoMigadu(e);
      throw new ErroHttp(erro.status, erro.codigo, semSenha(erro.message, senha));
    }
  }
  await guardarNoCofre(caixa.id, senha);
  await historico(caixa.conta_id, ator, noProvedor ? "senha_da_caixa_redefinida" : "senha_da_caixa_guardada", { caixa: caixa.id, endereco: caixa.endereco });
  return json({ redefinida: noProvedor, guardada: true });
}

/** Desativa a caixa: bloqueia no Migadu (sem apagar mensagens), tira da empresa e acompanha o extra de e-mail. */
async function caixaDesativar(ator: string, corpo: Record<string, unknown>, token: string) {
  const { caixa, dominio } = await lerCaixaDaCentral(corpo.caixa_id);
  const antes = await contarCaixas(caixa.conta_id);
  if (dominio.provedor === "migadu" && caixa.tipo === "caixa" && caixa.estado !== "pedida") {
    try {
      await bloquearCaixaNoMigadu(credencialDoMigadu(), fetch, { dominio: dominio.dominio, endereco: caixa.endereco });
    } catch (e) {
      throw erroDoMigadu(e);
    }
  }
  await servico().from("produto_email_caixas").update({ estado: "removida", atualizado_em: new Date().toISOString() }).eq("id", caixa.id);
  await historico(caixa.conta_id, ator, "caixa_desativada_pela_casa", { caixa: caixa.id, endereco: caixa.endereco, provedor: dominio.provedor });
  let extra = null;
  let aviso: string | null = dominio.provedor === "migadu" ? null : "A caixa saiu daqui. No provedor dela, desative à mão.";
  if (caixa.tipo === "caixa") {
    try {
      extra = await acompanharExtraDeEmail(token, ator, caixa.conta_id, "saiu", antes);
    } catch (e) {
      aviso = e instanceof Error ? e.message : "O extra de e-mail não acompanhou.";
    }
  }
  return json({ desativada: true, extra, aviso });
}

type Acao = (ator: string, corpo: Record<string, unknown>, token: string) => Promise<Response>;
const ACOES: Record<string, Acao> = {
  conferir_migadu: conferirMigadu,
  montar_migadu: montarMigadu,
  ativar_migadu: ativarMigadu,
  conferir_cloudflare: conferirCloudflare,
  conferir_zoho: conferirZoho,
  guardar_token_zoho: guardarTokenZoho,
  caixa_estado: () => caixaEstado(),
  caixa_listar: () => caixaListar(),
  caixa_criar: caixaCriar,
  caixa_mostrar_senha: caixaMostrarSenha,
  caixa_redefinir_senha: caixaRedefinirSenha,
  caixa_desativar: caixaDesativar,
};

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
    try {
      const corpo = ((await req.json().catch(() => ({}))) || {}) as Record<string, unknown>;
      const fn = ACOES[String(corpo.acao || "")];
      if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida." }, 400);
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      return await fn(await exigirDono(req), corpo, token);
    } catch (err) {
      if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
      console.error("[produto-email] erro inesperado", err instanceof Error ? err.message.slice(0, 200) : "");
      return json({ error: "erro_interno", mensagem: "Falha inesperada. Tente de novo." }, 500);
    }
  });
}
