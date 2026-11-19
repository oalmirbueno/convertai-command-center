/**
 * Produto CRM e E-mail (13/11/2026). Contrato: supabase/migrations/20261113120000_produto_crm_e_email.sql.
 *
 * O que precisa de chave de serviço ou do Asaas passa por aqui. O resto a tela faz direto no banco (RLS e RPC).
 *
 * Quem administra a empresa:
 *   convidar { email, nome?, papel? }                 -> { membro_id, enviado }
 *   reenviar_convite { membro_id }                    -> { enviado }
 *   assinar { plano_id, usuarios, so_guardar? }       -> { link } (checkout do Asaas) ou { atualizado: true }
 *   cancelar {}                                       -> { cancelada: true, acesso_ate }
 *   pedir_email { dominio?, caixas?, tipo?, observacao?, origem? } -> { ok, pedido_id, novo }
 *   dns { dominio_id }                                -> { checagem }   (qualquer pessoa da empresa, ou a casa)
 *
 * A casa (admin do painel):
 *   admin_criar_conta { nome, email, ... }            -> { conta_id, enviado }
 *   admin_convidar { conta_id, email, nome?, papel?, enviar?, com_link? } -> { membro_id, enviado, message_id, link, extra }
 *   admin_remover_membro { membro_id }                -> { removido, extra, aviso }
 *   admin_definir_senha { membro_id, senha }          -> { definida, email }  (a senha nunca volta nem é gravada)
 *   admin_enviar_link { membro_id }                   -> { enviado, message_id }
 *   admin_estado_do_envio { message_id }              -> { situacao, frase }
 *   admin_sincronizar { conta_id }                    -> { assinatura }
 *   admin_cobrar_migracao { conta_id, valor? }        -> { link }
 *
 * O cartão nunca passa por esta função: o checkout é a página do próprio Asaas.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chave } from "../_shared/chaves.ts";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { documentoValido, ErroDoAsaas } from "../_shared/comercial-asaas.ts";
import { resolvePublicAppUrl } from "../_shared/public-url.ts";
import {
  apagarCobrancaNoAsaas,
  cancelarAssinaturaNoAsaas,
  clienteNoAsaas,
  criarCheckoutDaAssinatura,
  criarCobrancaAvulsa,
  descricaoDaEntrada,
  descricaoDosItens,
  diaEmSaoPaulo,
  estadoDaCobranca,
  itensValidos,
  lerAssinaturaNoAsaas,
  lerPagamentoNoAsaas,
  mudarValorDaAssinatura,
  totalDosItens,
} from "./modulos/asaas.ts";
import { conferirDominio, type Provedor } from "./modulos/dns.ts";
import { comPedido, ehReducao, fimDoAcessoAoCancelar } from "./modulos/regras.ts";
import { ajusteDoExtraCrm, leituraDoEnvio, problemaDaSenha, type MudancaNaEquipe } from "./modulos/acessos.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...PREFLIGHT_CACHE,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

class ErroHttp extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

/** O banco com o login de quem chamou: as RPCs do produto conferem a permissão por auth.uid(). */
function comoAPessoa(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

interface Chamador {
  userId: string;
  token: string;
  dono: boolean;
  contaId: string | null;
  adminDaConta: boolean;
}

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  const { data } = await servico().auth.getUser(token);
  const userId = data && data.user ? data.user.id : "";
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.");
  const [{ data: papeis }, { data: membro }] = await Promise.all([
    servico().from("user_roles").select("role").eq("user_id", userId),
    servico().from("produto_membros").select("conta_id, papel").eq("user_id", userId).eq("estado", "ativo").maybeSingle(),
  ]);
  const m = membro as { conta_id: string; papel: string } | null;
  return {
    userId,
    token,
    dono: ((papeis || []) as Array<{ role: string }>).some((p) => p.role === "admin"),
    contaId: m ? m.conta_id : null,
    adminDaConta: !!m && m.papel === "admin",
  };
}

function exigirAdminDaConta(ch: Chamador): string {
  if (!ch.contaId || !ch.adminDaConta) throw new ErroHttp(403, "sem_permissao", "Só quem administra a empresa faz isso.");
  return ch.contaId;
}

function exigirDono(ch: Chamador) {
  if (!ch.dono) throw new ErroHttp(403, "sem_permissao", "Só a administração da Aceleriq faz isso.");
}

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const uuidDe = (v: unknown, nome: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ErroHttp(400, `${nome}_invalido`, "Pedido incompleto. Recarregue a tela e tente de novo.");
  return v;
};

/** A mensagem do banco quando a regra recusou (raise exception com texto para a pessoa). */
function erroDoBanco(e: { message?: string; code?: string } | null, padrao: string): ErroHttp {
  const m = e && typeof e.message === "string" ? e.message : "";
  const daRegra = e && (e.code === "P0001" || e.code === "42501") && m;
  return new ErroHttp(daRegra ? 400 : 500, daRegra ? "regra" : "banco", daRegra ? m.slice(0, 240) : padrao);
}

const app = () => resolvePublicAppUrl().replace(/\/+$/, "");

async function registrar(contaId: string | null, ator: string | null, acao: string, detalhe: Record<string, unknown> = {}) {
  const { error } = await servico().from("produto_historico").insert({ conta_id: contaId, ator, acao, detalhe });
  if (error) console.error("[produto] histórico não gravado", error.message.slice(0, 160));
}

// ------------------------------------------------------------------ convites

/**
 * Manda o convite. Para quem ainda não tem login, o link já cria o acesso e
 * entra; para quem tem, o link entra direto. Nos dois casos a pessoa cai no
 * produto e o banco a coloca na empresa pelo e-mail confirmado.
 */
/**
 * O link que entra no CRM: para quem ainda não tem login, o convite (cria o acesso e pede a senha na
 * primeira entrada); para quem já tem, um link de entrada que abre a troca de senha. Vale uma vez.
 */
async function gerarLinkDeAcesso(email: string): Promise<string | null> {
  const convite = await servico().auth.admin.generateLink({ type: "invite", email, options: { redirectTo: `${app()}/app/bem-vindo` } });
  if (convite.data && convite.data.properties && convite.data.properties.action_link) return convite.data.properties.action_link;
  const entrada = await servico().auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${app()}/app?nova_senha=1` } });
  if (entrada.data && entrada.data.properties && entrada.data.properties.action_link) return entrada.data.properties.action_link;
  return null;
}

/** O link de acesso para copiar e mandar por WhatsApp: não depende do e-mail sair. */
async function linkDeAcesso(ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.membro_id, "membro");
  const { data: m } = await servico().from("produto_membros").select("conta_id, email, estado").eq("id", id).maybeSingle();
  const membro = m as { conta_id?: string; email?: string; estado?: string } | null;
  const contaDoMembro = (membro && membro.conta_id) || "";
  if (!contaDoMembro || !(ch.dono || (ch.adminDaConta && ch.contaId === contaDoMembro))) throw new ErroHttp(403, "sem_permissao", "Só quem administra a empresa gera o link de acesso.");
  if (!membro || !membro.email || membro.estado === "removido") throw new ErroHttp(404, "sem_pessoa", "Essa pessoa não está mais na empresa.");
  const link = await gerarLinkDeAcesso(membro.email);
  if (!link) throw new ErroHttp(502, "sem_link", "Não foi possível gerar o link agora. Tente de novo.");
  await registrar(contaDoMembro, ch.userId, "link_de_acesso", { membro: id });
  return json({ link, email: membro.email });
}

/**
 * Manda o link de acesso por e-mail (o mesmo modelo do convite: cria o acesso de quem é novo e entra direto
 * para quem já tem login). `qualquerEstado`: a casa manda também para quem já entrou (troca de senha).
 * Devolve o id da mensagem na fila, para a tela conferir depois se saiu de fato.
 */
async function mandarLinkPorEmail(membroId: string, quemConvidou: string | null, qualquerEstado = false): Promise<{ enviado: boolean; message_id: string | null; link: string | null }> {
  const { data: m } = await servico().from("produto_membros").select("id, conta_id, email, nome, papel, estado").eq("id", membroId).maybeSingle();
  const membro = m as { id: string; conta_id: string; email: string; nome: string; papel: string; estado: string } | null;
  if (!membro || membro.estado === "removido" || (!qualquerEstado && membro.estado !== "convidado")) return { enviado: false, message_id: null, link: null };
  const { data: conta } = await servico().from("produto_contas").select("nome").eq("id", membro.conta_id).maybeSingle();
  const gerado = await gerarLinkDeAcesso(membro.email);
  const link = gerado || `${app()}/app`;
  let nomeDeQuem = "";
  if (quemConvidou) {
    const { data: p } = await servico().from("profiles").select("full_name").eq("id", quemConvidou).maybeSingle();
    nomeDeQuem = texto((p as { full_name?: string } | null)?.full_name, 80);
  }
  const { data, error } = await servico().functions.invoke("send-transactional-email", {
    body: {
      templateName: "produto-convite",
      recipientEmail: membro.email,
      idempotencyKey: `produto-convite-${membro.id}-${Date.now()}`,
      templateData: {
        name: membro.nome,
        company: (conta as { nome?: string } | null)?.nome || "",
        invitedBy: nomeDeQuem,
        admin: membro.papel === "admin",
        link,
      },
    },
  });
  if (error) console.error("[produto] convite não enviado", String(error.message || "").slice(0, 160));
  const id = data && typeof (data as { message_id?: unknown }).message_id === "string" ? String((data as { message_id: string }).message_id) : null;
  return { enviado: !error, message_id: id, link: gerado };
}

async function enviarConvite(membroId: string, quemConvidou: string | null): Promise<boolean> {
  return (await mandarLinkPorEmail(membroId, quemConvidou)).enviado;
}

async function convidar(ch: Chamador, corpo: Record<string, unknown>) {
  exigirAdminDaConta(ch);
  const { data, error } = await comoAPessoa(ch.token).rpc("produto_convidar", {
    _email: texto(corpo.email, 254),
    _nome: texto(corpo.nome, 120),
    _papel: corpo.papel === "admin" ? "admin" : corpo.papel === "gerente" ? "gerente" : "usuario",
    _gerente: typeof corpo.gerente_id === "string" && corpo.gerente_id ? uuidDe(corpo.gerente_id, "gerente") : null,
    _cargo: texto(corpo.cargo, 60),
  });
  if (error || typeof data !== "string") throw erroDoBanco(error, "Não foi possível convidar agora.");
  return json({ membro_id: data, enviado: await enviarConvite(data, ch.userId) });
}

async function reenviarConvite(ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.membro_id, "membro");
  const { data: m } = await servico().from("produto_membros").select("conta_id").eq("id", id).maybeSingle();
  const contaDoMembro = (m as { conta_id?: string } | null)?.conta_id || "";
  if (!contaDoMembro || !(ch.dono || (ch.adminDaConta && ch.contaId === contaDoMembro))) throw new ErroHttp(403, "sem_permissao", "Só quem administra a empresa reenvia o convite.");
  // No máximo três reenvios por hora para a mesma pessoa: o e-mail sai do domínio da casa.
  const { count } = await servico().from("produto_historico").select("id", { count: "exact", head: true }).eq("conta_id", contaDoMembro).eq("acao", "convite_reenviado").eq("detalhe->>membro", id).gte("criado_em", new Date(Date.now() - 3600 * 1000).toISOString());
  if ((count || 0) >= 3) throw new ErroHttp(429, "muitos_reenvios", "O convite já foi reenviado há pouco. Espere um pouco antes de tentar de novo.");
  await registrar(contaDoMembro, ch.userId, "convite_reenviado", { membro: id });
  return json({ enviado: await enviarConvite(id, ch.userId) });
}

// ------------------------------------------------------------------ assinatura

interface Conta {
  id: string;
  nome: string;
  documento: string | null;
  email_cobranca: string | null;
  telefone: string | null;
  plano_id: string;
  usuarios_contratados: number;
  estado: string;
  cobranca_por?: string;
}

async function lerConta(id: string): Promise<Conta> {
  const { data, error } = await servico().from("produto_contas").select("id, nome, documento, email_cobranca, telefone, plano_id, usuarios_contratados, estado, cobranca_por").eq("id", id).maybeSingle();
  if (error || !data) throw new ErroHttp(404, "conta_inexistente", "A empresa não foi encontrada.");
  return data as Conta;
}

async function itensDaConta(id: string) {
  const { data, error } = await servico().rpc("produto_itens_da_conta", { _conta: id });
  if (error) throw new ErroHttp(500, "banco", "Não consegui calcular a mensalidade agora.");
  return itensValidos(data);
}

async function tokenDoAsaas(): Promise<string> {
  try {
    const t = await chave("ASAAS_API_KEY");
    if (t) return t;
  } catch {
    /* cai no erro abaixo */
  }
  throw new ErroHttp(503, "asaas_sem_chave", "A cobrança ainda não está configurada. Fale com a Aceleriq.");
}

function erroDoPagamento(e: unknown): ErroHttp {
  if (e instanceof ErroHttp) return e;
  if (e instanceof ErroDoAsaas) {
    console.error("[produto] asaas", e.etapa, e.status, e.message.slice(0, 200));
    return new ErroHttp(e.status >= 500 ? 502 : 400, "asaas", e.status >= 500 ? "O Asaas não respondeu agora. Tente de novo em instantes." : e.message.slice(0, 240));
  }
  console.error("[produto] pagamento", e instanceof Error ? e.message.slice(0, 200) : "");
  return new ErroHttp(500, "erro_interno", "Não foi possível falar com a cobrança agora.");
}

async function pagamentosLigados(): Promise<boolean> {
  const { data } = await servico().from("produto_config").select("pagamentos_ativos").maybeSingle();
  return (data as { pagamentos_ativos?: boolean } | null)?.pagamentos_ativos === true;
}

/**
 * Assinar, trocar de plano ou mudar o número de usuários.
 * Sem assinatura: grava a escolha e devolve o link do checkout.
 * Com assinatura: muda o valor no Asaas e só então vale aqui.
 */
/**
 * `pelaCasa`: o admin da Aceleriq gera o link de pagamento de uma empresa (para mandar ao cliente).
 * Vale com a cobrança geral desligada (é uma venda fechada à mão) e o link dura 24 horas.
 */
async function assinar(ch: Chamador, corpo: Record<string, unknown>, pelaCasa?: string) {
  const contaId = pelaCasa || exigirAdminDaConta(ch);
  const conta = await lerConta(contaId);
  const planoId = texto(corpo.plano_id, 40) || conta.plano_id;
  const usuarios = Math.floor(Number(corpo.usuarios) || conta.usuarios_contratados);
  const [{ data: plano }, { count: ocupados }, { data: ass }] = await Promise.all([
    servico().from("produto_planos").select("id, ativo, minimo_usuarios").eq("id", planoId).maybeSingle(),
    servico().from("produto_membros").select("id", { count: "exact", head: true }).eq("conta_id", contaId).neq("estado", "removido"),
    servico().from("produto_assinaturas").select("asaas_assinatura_id, asaas_cliente_id, estado, valor_mensal, proximo_vencimento, pedidos").eq("conta_id", contaId).maybeSingle(),
  ]);
  const p = plano as { id: string; ativo: boolean; minimo_usuarios: number } | null;
  if (!p || !p.ativo) throw new ErroHttp(400, "plano_indisponivel", "Esse plano não está disponível.");
  if (!(usuarios >= 1 && usuarios <= 500)) throw new ErroHttp(400, "usuarios_invalidos", "Diga quantos usuários a empresa precisa.");
  if (usuarios < p.minimo_usuarios) throw new ErroHttp(400, "abaixo_do_minimo", `Esse plano começa com ${p.minimo_usuarios} usuários.`);
  if (usuarios < (ocupados || 0)) throw new ErroHttp(400, "lugares_em_uso", `A empresa tem ${ocupados} pessoas na equipe. Remova alguém antes de diminuir os usuários.`);

  const a = (ass || {}) as { asaas_assinatura_id?: string | null; asaas_cliente_id?: string | null; estado?: string; valor_mensal?: number; proximo_vencimento?: string | null; pedidos?: Record<string, unknown> };
  const antes = { plano_id: conta.plano_id, usuarios_contratados: conta.usuarios_contratados };
  const gravar = (v: { plano_id: string; usuarios_contratados: number }) => servico().from("produto_contas").update({ ...v, atualizado_em: new Date().toISOString() }).eq("id", contaId);

  // CRM cobrado no plano do cliente da Aceleriq: não abre checkout, senão a empresa pagaria duas vezes.
  if (conta.cobranca_por === "plano") {
    throw new ErroHttp(409, "pelo_plano", pelaCasa
      ? "O CRM desta empresa é cobrado no plano do cliente. Mude usuários e valor no extra de CRM, na ficha do cliente."
      : "O CRM da sua empresa é cobrado junto com o plano da Aceleriq. Para mudar o número de usuários, fale com a Aceleriq.");
  }
  // Em cortesia quem paga é a casa: plano e usuários só mudam por ela.
  if (conta.estado === "cortesia") throw new ErroHttp(409, "cortesia", "A empresa está em cortesia. Para mudar o plano ou os usuários, fale com a Aceleriq.");
  const assinando = !!a.asaas_assinatura_id && (a.estado === "ativa" || a.estado === "atrasada");
  // Em teste dá para guardar a escolha sem pagar ainda. O que vai valer depois é o que for pago no checkout.
  if (conta.estado === "teste" && corpo.so_guardar === true && !assinando) {
    await gravar({ plano_id: planoId, usuarios_contratados: usuarios });
    await registrar(contaId, ch.userId, "plano_mudou", { plano: planoId, usuarios });
    return json({ atualizado: true });
  }
  if (!pelaCasa && !(await pagamentosLigados())) throw new ErroHttp(409, "pagamentos_desligados", "A assinatura pelo cartão ainda não foi aberta. Fale com a Aceleriq para liberar.");
  const documento = documentoValido(conta.documento);
  if (!documento) throw new ErroHttp(400, "sem_documento", "Preencha o CPF ou o CNPJ da empresa antes de assinar.");

  await gravar({ plano_id: planoId, usuarios_contratados: usuarios });
  try {
    const itens = await itensDaConta(contaId);
    if (!itens.length) throw new ErroHttp(400, "nada_a_cobrar", "Não há o que cobrar nesta escolha.");
    const token = await tokenDoAsaas();
    const valor = totalDosItens(itens);

    if (assinando && a.asaas_assinatura_id) {
      // Baixar o valor no meio do ciclo espera a próxima cobrança: senão dava para subir, usar e descer sem pagar.
      if (ehReducao(valor, Number(a.valor_mensal) || 0)) {
        await gravar(antes);
        await servico().from("produto_assinaturas").update({ troca_agendada: { plano_id: planoId, usuarios, valor, pedida_em: new Date().toISOString() }, atualizado_em: new Date().toISOString() }).eq("conta_id", contaId);
        await registrar(contaId, ch.userId, "troca_agendada", { plano: planoId, usuarios, valor });
        return json({ agendado: true, valor, a_partir_de: a.proximo_vencimento || null });
      }
      const nova = await mudarValorDaAssinatura(token, fetch, a.asaas_assinatura_id, { valor, descricao: descricaoDosItens(itens) });
      await servico().from("produto_assinaturas").update({ valor_mensal: nova.valor, itens, proximo_vencimento: nova.proximo_vencimento, troca_agendada: null, atualizado_em: new Date().toISOString() }).eq("conta_id", contaId);
      await registrar(contaId, ch.userId, "plano_mudou", { plano: planoId, usuarios, valor });
      return json({ atualizado: true, valor });
    }

    const clienteId = a.asaas_cliente_id || (await clienteNoAsaas(token, fetch, { nome: conta.nome, documento, email: conta.email_cobranca, telefone: conta.telefone }));
    const checkout = await criarCheckoutDaAssinatura(token, fetch, { clienteId, itens, referencia: `conta:${contaId}`, voltarPara: `${app()}/app/conta`, agora: new Date(), imagemBase64: Deno.env.get("PRODUTO_CHECKOUT_IMAGEM_BASE64") || undefined, ...(pelaCasa ? { minutos: 1440 } : {}) });
    const { error } = await servico().from("produto_assinaturas").upsert({
      conta_id: contaId,
      asaas_cliente_id: clienteId,
      asaas_checkout_id: checkout.id,
      checkout_link: checkout.link,
      checkout_expira: checkout.expira_em,
      estado: "aguardando",
      valor_mensal: valor,
      itens,
      // O que foi pedido NESTE checkout: se ele for pago, é isto que a empresa leva (mesmo que a tela mude depois).
      pedidos: comPedido(a.pedidos, checkout.id, { plano_id: planoId, usuarios, valor }, new Date()),
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "conta_id" });
    if (error) throw new ErroHttp(500, "banco", "O checkout foi criado, mas não consegui guardar. Tente de novo.");
    await registrar(contaId, ch.userId, "checkout_aberto", { plano: planoId, usuarios, valor });
    return json({ link: checkout.link, valor });
  } catch (e) {
    // O que não valeu no Asaas não vale aqui.
    await gravar(antes);
    throw erroDoPagamento(e);
  }
}

async function cancelar(ch: Chamador) {
  const contaId = exigirAdminDaConta(ch);
  const contaAtual = await lerConta(contaId);
  const { data: ass } = await servico().from("produto_assinaturas").select("asaas_assinatura_id, proximo_vencimento, estado").eq("conta_id", contaId).maybeSingle();
  const a = (ass || {}) as { asaas_assinatura_id?: string | null; proximo_vencimento?: string | null; estado?: string };
  // Só se cancela o que existe: cortesia e teste sem assinatura continuam como estão.
  if (contaAtual.estado === "cortesia") throw new ErroHttp(409, "cortesia", "A empresa está em cortesia: não há assinatura para cancelar.");
  if (!a.asaas_assinatura_id || (a.estado !== "ativa" && a.estado !== "atrasada")) throw new ErroHttp(409, "sem_assinatura", "A empresa não tem assinatura ativa para cancelar.");
  try {
    await cancelarAssinaturaNoAsaas(await tokenDoAsaas(), fetch, a.asaas_assinatura_id);
  } catch (e) {
    throw erroDoPagamento(e);
  }
  // Quem está em dia usa até o fim do período pago; em atraso, o acesso termina agora.
  const ate = fimDoAcessoAoCancelar({ estadoDaConta: contaAtual.estado, proximoVencimento: a.proximo_vencimento, agora: new Date() });
  await servico().from("produto_assinaturas").update({ estado: "cancelada", checkout_link: null, troca_agendada: null, atualizado_em: new Date().toISOString() }).eq("conta_id", contaId);
  await servico().from("produto_contas").update({ estado: "cancelada", acesso_ate: ate, atualizado_em: new Date().toISOString() }).eq("id", contaId);
  await registrar(contaId, ch.userId, "assinatura_cancelada", { acesso_ate: ate });
  await servico().rpc("produto_avisar_casa", { _mensagem: `CRM: ${contaAtual.nome} cancelou a assinatura.`, _link: "/produto" });
  return json({ cancelada: true, acesso_ate: ate });
}

/**
 * O cliente pede o e-mail profissional (página /email/pedir ou o /app): vira UMA entrada em
 * produto_email_pedidos (pedir de novo completa a mesma), com aviso no sino. O negócio no Comercial
 * só nasce junto com a entrada nova, para o mesmo pedido não abrir vários negócios.
 */
async function pedirEmail(ch: Chamador, corpo: Record<string, unknown>) {
  const contaId = exigirAdminDaConta(ch);
  const conta = await lerConta(contaId);
  const dominio = texto(corpo.dominio, 120).toLowerCase();
  const caixas = Math.max(0, Math.min(500, Math.floor(Number(corpo.caixas) || 0)));
  const observacao = texto(corpo.observacao, 600);
  const tipo = corpo.tipo === "novo" || corpo.tipo === "migracao" ? corpo.tipo : null;
  const { count } = await servico().from("produto_historico").select("id", { count: "exact", head: true }).eq("conta_id", contaId).in("acao", ["email_pedido", "email_pedido_atualizado"]).gte("criado_em", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  if ((count || 0) >= 5) throw new ErroHttp(429, "muitos_pedidos", "O pedido já chegou. A Aceleriq vai falar com você.");
  const { data: registro, error: erroDoPedido } = await servico().rpc("produto_email_registrar_pedido", {
    _conta: contaId,
    _dominio: dominio || null,
    _caixas: caixas || null,
    _tipo: tipo,
    _observacao: observacao || null,
    _origem: corpo.origem === "app" ? "app" : "pagina",
    _ator: ch.userId,
    _provedor_atual: texto(corpo.provedor_atual, 120) || null,
  });
  if (erroDoPedido || !registro) throw erroDoBanco(erroDoPedido, "Não foi possível registrar o pedido agora.");
  const r = registro as { pedido: { id: string; estado: string }; novo: boolean };
  // As ofertas marcadas no pedido (order bumps). Só antes de pagar; o banco guarda o preço de agora.
  const ofertas = idsDasOfertas(corpo.ofertas);
  if (ofertas && (r.pedido.estado === "novo" || r.pedido.estado === "aguardando_pagamento")) {
    const { error: erroDasOfertas } = await servico().rpc("produto_email_escolher_ofertas", { _pedido: r.pedido.id, _ofertas: ofertas, _ator: ch.userId });
    if (erroDasOfertas) console.error("[produto] ofertas do pedido", erroDasOfertas.message.slice(0, 160));
  }
  if (!r.novo) return json({ ok: true, pedido_id: r.pedido.id, novo: false });
  const { error } = await servico().from("commercial_leads").insert({
    name: conta.nome,
    company: conta.nome,
    email: conta.email_cobranca,
    whatsapp: conta.telefone,
    origin: "site",
    stage: "novo",
    classe: "upsell",
    next_action: "Responder o pedido de e-mail profissional",
    notes: [`Pedido feito dentro do CRM (${conta.nome}).`, dominio ? `Domínio: ${dominio}` : "", caixas ? `Caixas: ${caixas}` : "", ofertas && ofertas.length ? `Ofertas: ${ofertas.join(", ")}` : "", observacao].filter(Boolean).join("\n"),
    qualificacao: { fonte: "produto_crm", produto_conta_id: contaId, oferta: "E-mail profissional", email_pedido_id: r.pedido.id },
  });
  if (error) console.error("[produto] lead do pedido não criado", error.message.slice(0, 160));
  return json({ ok: true, pedido_id: r.pedido.id, novo: true });
}

/**
 * Contratar mais pelo correio (19/11/2026): caixas a mais e extras do catálogo, para a empresa que já tem o
 * e-mail. Os preços saem do banco (nada do que a tela manda vale como preço). Vira pedido no histórico e
 * oportunidade no CRM da Aceleriq, que confirma e manda o link; a cobrança automática entra quando os
 * pagamentos online forem ligados depois do teste no sandbox.
 */
async function contratarEmailExtras(ch: Chamador, corpo: Record<string, unknown>) {
  const contaId = exigirAdminDaConta(ch);
  const conta = await lerConta(contaId);
  const caixas = Math.max(0, Math.min(100, Math.floor(Number(corpo.caixas_a_mais) || 0)));
  const pedidas = idsDasOfertas(corpo.ofertas) || [];
  if (!caixas && !pedidas.length) throw new ErroHttp(400, "nada_escolhido", "Escolha mais caixas ou um extra.");
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [{ count }, { data: config }, { data: catalogo }] = await Promise.all([
    servico().from("produto_historico").select("id", { count: "exact", head: true }).eq("conta_id", contaId).eq("acao", "email_contratar_extras").gte("criado_em", desde),
    servico().from("produto_config").select("email_caixa_extra").maybeSingle(),
    pedidas.length ? servico().from("produto_ofertas").select("id, nome, cobranca, valor, ativo").in("id", pedidas) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  if ((count || 0) >= 5) throw new ErroHttp(429, "muitos_pedidos", "O pedido já chegou. A Aceleriq vai falar com você.");
  const ofertas = ((catalogo || []) as Array<{ id: string; nome: string; cobranca: string; valor: number; ativo: boolean }>).filter((o) => o.ativo && Number(o.valor) > 0);
  if (pedidas.length && ofertas.length !== pedidas.length) throw new ErroHttp(400, "oferta_indisponivel", "Um dos extras não está mais disponível. Atualize a página.");
  const precoCaixa = Number((config as { email_caixa_extra?: number } | null)?.email_caixa_extra) || 0;
  const centavos = (v: number) => Math.round(v * 100) / 100;
  const mensal = centavos(caixas * precoCaixa + ofertas.filter((o) => o.cobranca !== "unica").reduce((s, o) => s + Number(o.valor), 0));
  const unico = centavos(ofertas.filter((o) => o.cobranca === "unica").reduce((s, o) => s + Number(o.valor), 0));
  const itens = [caixas ? `${caixas} ${caixas === 1 ? "caixa a mais" : "caixas a mais"}` : "", ...ofertas.map((o) => o.nome)].filter(Boolean);
  await registrar(contaId, ch.userId, "email_contratar_extras", { caixas_a_mais: caixas, ofertas: ofertas.map((o) => o.id), mensal_a_mais: mensal, unico });
  const { error } = await servico().from("commercial_leads").insert({
    name: conta.nome,
    company: conta.nome,
    email: conta.email_cobranca,
    whatsapp: conta.telefone,
    origin: "site",
    stage: "novo",
    classe: "upsell",
    next_action: "Confirmar a contratação pelo correio e mandar o link",
    notes: [`Contratou pelo correio (${conta.nome}): ${itens.join(", ")}.`, mensal ? `A mais por mês: R$ ${mensal.toFixed(2).replace(".", ",")}` : "", unico ? `Uma vez: R$ ${unico.toFixed(2).replace(".", ",")}` : ""].filter(Boolean).join("\n"),
    qualificacao: { fonte: "produto_correio", produto_conta_id: contaId, oferta: "E-mail profissional", caixas_a_mais: caixas, ofertas: ofertas.map((o) => o.id) },
  });
  if (error) console.error("[produto] lead da contratação não criado", error.message.slice(0, 160));
  return json({ ok: true, itens, mensal_a_mais: mensal, unico });
}

/** Os códigos das ofertas que vieram do pedido: lista curta, só no formato do catálogo. Sem lista, null. */
function idsDasOfertas(bruto: unknown): string[] | null {
  if (!Array.isArray(bruto)) return null;
  const saida: string[] = [];
  for (const x of bruto) {
    const id = String(x || "").trim().toLowerCase();
    if (/^[a-z][a-z0-9_]{1,39}$/.test(id) && saida.indexOf(id) < 0) saida.push(id);
    if (saida.length >= 12) break;
  }
  return saida;
}

interface CobrancaDoPedido {
  pedido_id: string;
  itens_hoje: unknown;
  itens_mensais: unknown;
  total_hoje: number;
  total_mensal: number;
}

/**
 * A cobrança única do pedido de e-mail: migração, 1º mês e as ofertas, numa fatura só do Asaas
 * (Pix, boleto ou cartão). Quando é paga, o aviso do Asaas libera o pedido (gatilho do banco) e cria a
 * mensalidade do e-mail para o mês que vem. Pedir de novo com o mesmo valor devolve a mesma fatura.
 */
async function cobrarEntradaDoEmail(contaId: string, ator: string | null, corpo: Record<string, unknown>) {
  const conta = await lerConta(contaId);
  const documento = documentoValido(conta.documento) || documentoValido(corpo.documento);
  if (!documento) throw new ErroHttp(400, "sem_documento", "Diga o CPF ou o CNPJ de quem paga.");
  if (!documentoValido(conta.documento)) {
    await servico().from("produto_contas").update({ documento, atualizado_em: new Date().toISOString() }).eq("id", contaId);
  }
  const { data: aberto } = await servico().from("produto_email_pedidos")
    .select("id, estado, cobranca_asaas_id, cobranca_link, cobranca_valor")
    .eq("conta_id", contaId).in("estado", ["novo", "aguardando_pagamento"]).maybeSingle();
  const pedido = aberto as { id: string; estado: string; cobranca_asaas_id: string | null; cobranca_link: string | null; cobranca_valor: number | null } | null;
  if (!pedido) throw new ErroHttp(404, "sem_pedido", "Não há pedido de e-mail aberto para pagar.");

  const ofertas = idsDasOfertas(corpo.ofertas);
  if (ofertas) {
    const { error } = await servico().rpc("produto_email_escolher_ofertas", { _pedido: pedido.id, _ofertas: ofertas, _ator: ator });
    if (error) throw erroDoBanco(error, "Não foi possível guardar as ofertas agora.");
  }
  const { data: calc, error: erroDoCalculo } = await servico().rpc("produto_email_cobranca_do_pedido", { _pedido: pedido.id });
  if (erroDoCalculo || !calc) throw erroDoBanco(erroDoCalculo, "Não consegui calcular o pedido agora.");
  const c = calc as CobrancaDoPedido;
  const itens = itensValidos(c.itens_hoje);
  const total = totalDosItens(itens);
  const mensal = totalDosItens(itensValidos(c.itens_mensais));
  if (!(total >= 5)) throw new ErroHttp(400, "nada_a_cobrar", "Não há o que cobrar neste pedido.");

  try {
    const token = await tokenDoAsaas();
    // Mesma conta, mesmo valor e fatura ainda aberta: é a mesma. Valor mudou: a antiga sai e nasce outra.
    if (pedido.cobranca_asaas_id) {
      const antiga = await lerPagamentoNoAsaas(token, fetch, pedido.cobranca_asaas_id).catch(() => null);
      const aberta = antiga && !antiga.apagado && estadoDaCobranca(antiga.estado) === "aberta";
      if (aberta && pedido.cobranca_link && Math.abs(Number(pedido.cobranca_valor) - total) < 0.01) {
        return json({ link: pedido.cobranca_link, valor: total, mensal, itens, reaproveitada: true });
      }
      if (aberta) {
        await apagarCobrancaNoAsaas(token, fetch, pedido.cobranca_asaas_id).catch(() => false);
        await servico().from("produto_cobrancas").update({ estado: "cancelada", atualizado_em: new Date().toISOString() }).eq("asaas_pagamento_id", pedido.cobranca_asaas_id);
      }
    }
    const { data: ass } = await servico().from("produto_assinaturas").select("asaas_cliente_id").eq("conta_id", contaId).maybeSingle();
    const clienteId = (ass as { asaas_cliente_id?: string | null } | null)?.asaas_cliente_id || (await clienteNoAsaas(token, fetch, { nome: conta.nome, documento, email: conta.email_cobranca, telefone: conta.telefone }));
    const pg = await criarCobrancaAvulsa(token, fetch, {
      clienteId,
      valor: total,
      descricao: descricaoDaEntrada(itens),
      referencia: `conta:${contaId}:migracao`,
      vencimento: diaEmSaoPaulo(new Date(), 3),
      voltarPara: `${app()}/app/email?pagamento=ok`,
    });
    await servico().from("produto_assinaturas").upsert({ conta_id: contaId, asaas_cliente_id: clienteId }, { onConflict: "conta_id" });
    await servico().from("produto_cobrancas").insert({
      conta_id: contaId, asaas_pagamento_id: pg.id, tipo: "migracao", descricao: "Pedido do e-mail profissional", valor: total, vencimento: pg.vencimento, estado: "aberta", link: pg.link,
    });
    await servico().from("produto_email_pedidos").update({
      estado: "aguardando_pagamento", cobranca_asaas_id: pg.id, cobranca_link: pg.link, cobranca_valor: total, atualizado_em: new Date().toISOString(),
    }).eq("id", pedido.id);
    await registrar(contaId, ator, "email_cobranca_aberta", { valor: total, mensal, ofertas: ofertas || null });
    return json({ link: pg.link, valor: total, mensal, itens });
  } catch (e) {
    throw erroDoPagamento(e);
  }
}

/** O cliente paga o pedido sozinho (página /email/pedir). Só com a cobrança geral ligada. */
async function pagarEmail(ch: Chamador, corpo: Record<string, unknown>) {
  const contaId = exigirAdminDaConta(ch);
  if (!(await pagamentosLigados())) throw new ErroHttp(409, "pagamentos_desligados", "O pagamento online ainda não foi aberto. O pedido ficou com a Aceleriq, que manda o link para você.");
  return cobrarEntradaDoEmail(contaId, ch.userId, corpo);
}

/** A casa gera o link do pedido de uma empresa (vale com a cobrança geral desligada: venda fechada à mão). */
async function adminCobrarEntradaEmail(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  return cobrarEntradaDoEmail(uuidDe(corpo.conta_id, "conta"), ch.userId, corpo);
}

// ------------------------------------------------------------------ e-mail

async function dns(ch: Chamador, corpo: Record<string, unknown>) {
  const id = uuidDe(corpo.dominio_id, "dominio");
  const { data } = await servico().from("produto_email_dominios").select("id, conta_id, dominio, provedor, dkim_seletor").eq("id", id).maybeSingle();
  const d = data as { id: string; conta_id: string; dominio: string; provedor: Provedor; dkim_seletor: string | null } | null;
  if (!d || !(ch.dono || ch.contaId === d.conta_id)) throw new ErroHttp(404, "dominio_inexistente", "O domínio não foi encontrado.");
  let checagem;
  try {
    checagem = await conferirDominio(fetch, { dominio: d.dominio, provedor: d.provedor, seletor: d.dkim_seletor });
  } catch {
    throw new ErroHttp(502, "dns_indisponivel", "Não consegui consultar o DNS agora. Tente de novo em instantes.");
  }
  await servico().from("produto_email_dominios").update({ checagem, checado_em: checagem.conferido_em }).eq("id", id);
  return json({ checagem });
}

// ------------------------------------------------------------------ a casa

async function adminCriarConta(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  const nome = texto(corpo.nome, 120);
  const email = texto(corpo.email, 254).toLowerCase();
  if (nome.length < 2) throw new ErroHttp(400, "sem_nome", "Diga o nome da empresa.");
  if (!EMAIL.test(email)) throw new ErroHttp(400, "email_invalido", "Diga o e-mail de quem vai administrar a empresa.");
  const { data: ja } = await servico().from("produto_membros").select("id").eq("email", email).neq("estado", "removido").limit(1);
  if (ja && ja.length) throw new ErroHttp(409, "email_em_uso", "Esse e-mail já está numa empresa do produto.");
  const planoId = texto(corpo.plano_id, 40) || "starter";
  const { data: cfg } = await servico().from("produto_config").select("teste_dias").maybeSingle();
  const dias = Math.max(0, Number((cfg as { teste_dias?: number } | null)?.teste_dias) || 0);
  const cortesia = corpo.estado === "cortesia";
  const clientId = typeof corpo.client_id === "string" && UUID.test(corpo.client_id) ? corpo.client_id : null;
  const { data: conta, error } = await servico().from("produto_contas").insert({
    nome,
    documento: documentoValido(corpo.documento),
    telefone: texto(corpo.telefone, 40) || null,
    email_cobranca: email,
    client_id: clientId,
    plano_id: planoId,
    usuarios_contratados: Math.max(1, Math.min(500, Math.floor(Number(corpo.usuarios) || 1))),
    crm_ativo: corpo.crm_ativo !== false,
    email_ativo: corpo.email_ativo === true,
    email_caixas_contratadas: Math.max(0, Math.min(500, Math.floor(Number(corpo.email_caixas) || 0))),
    estado: cortesia ? "cortesia" : "teste",
    teste_ate: cortesia ? null : new Date(Date.now() + dias * 86400 * 1000).toISOString(),
    origem: "painel",
    observacao: texto(corpo.observacao, 600) || null,
  }).select("id").single();
  if (error || !conta) throw erroDoBanco(error, "A empresa não foi criada.");
  const contaId = String((conta as { id: string }).id);
  await servico().from("produto_assinaturas").insert({ conta_id: contaId });
  const { data: membro, error: erroDoMembro } = await servico().from("produto_membros").insert({
    conta_id: contaId, email, nome: texto(corpo.nome_responsavel, 120), papel: "admin", estado: "convidado", convidado_por: ch.userId,
  }).select("id").single();
  if (erroDoMembro || !membro) throw erroDoBanco(erroDoMembro, "A empresa foi criada, mas o convite não. Convide pela ficha da empresa.");
  await registrar(contaId, ch.userId, "conta_criada", { plano: planoId, origem: "painel", cortesia });
  const enviado = corpo.convidar === false ? false : await enviarConvite(String((membro as { id: string }).id), ch.userId);
  return json({ conta_id: contaId, enviado });
}

/**
 * Central de acessos: numa empresa cobrada pelo plano do cliente (extra "crm"), pôr ou tirar uma pessoa
 * acompanha a quantidade e o valor do extra, pelo mesmo caminho da ficha do cliente (quantidade direto no
 * extra e valor pelo extra_editar, com a sessão do dono). O banco recalcula os usuários da empresa sozinho.
 */
async function ajustarExtraDoCrm(ch: Chamador, contaId: string, mudanca: MudancaNaEquipe, pessoasDepois: number): Promise<{ extra_id: string; quantidade: number; valor: number } | null> {
  const { data: c } = await servico().from("produto_contas").select("cobranca_por, extra_id, plano_id").eq("id", contaId).maybeSingle();
  const conta = c as { cobranca_por?: string; extra_id?: string | null; plano_id?: string } | null;
  if (!conta || conta.cobranca_por !== "plano" || !conta.extra_id) return null;
  const { data: e } = await servico().from("client_extras").select("id, quantidade, valor, produto_plano_id, status").eq("id", conta.extra_id).maybeSingle();
  const extra = e as { id: string; quantidade: number | null; valor: number | null; produto_plano_id: string | null; status: string } | null;
  if (!extra || extra.status === "encerrado") return null;
  const { data: pl } = await servico().from("produto_planos").select("preco_usuario").eq("id", extra.produto_plano_id || conta.plano_id || "starter").maybeSingle();
  const ajuste = ajusteDoExtraCrm({
    quantidadeAtual: Number(extra.quantidade) || 1,
    valorAtual: Number(extra.valor) || 0,
    pessoasDepois,
    mudanca,
    precoDoPlano: Number((pl as { preco_usuario?: number } | null)?.preco_usuario) || 0,
  });
  if (!ajuste) return null;
  const comoDono = comoAPessoa(ch.token);
  const { error: eq } = await comoDono.from("client_extras").update({ quantidade: ajuste.quantidade }).eq("id", extra.id);
  if (eq) throw new ErroHttp(500, "extra", "Não consegui atualizar os usuários do extra de CRM do cliente.");
  if (ajuste.valor > 0) {
    const { error: ev } = await comoDono.rpc("extra_editar", { _id: extra.id, _dados: { valor: ajuste.valor } });
    if (ev) throw new ErroHttp(500, "extra", "Os usuários do extra mudaram, mas o valor não. Confira o extra de CRM na ficha do cliente.");
  }
  await registrar(contaId, ch.userId, "extra_crm_acompanhou", { quantidade: ajuste.quantidade, valor: ajuste.valor, mudanca });
  return { extra_id: extra.id, ...ajuste };
}

const contarPessoas = async (contaId: string) => {
  const { count } = await servico().from("produto_membros").select("id", { count: "exact", head: true }).eq("conta_id", contaId).neq("estado", "removido");
  return count || 0;
};

/**
 * A casa põe uma pessoa no CRM de uma empresa. `enviar: false` não manda o e-mail na hora (a tela oferece
 * depois) e `com_link: true` devolve o link de primeiro acesso para copiar ou mandar no WhatsApp.
 */
async function adminConvidar(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  const contaId = uuidDe(corpo.conta_id, "conta");
  const email = texto(corpo.email, 254).toLowerCase();
  if (!EMAIL.test(email)) throw new ErroHttp(400, "email_invalido", "E-mail inválido.");
  const conta = await lerConta(contaId);
  const [{ data: ja }, ocupados] = await Promise.all([
    servico().from("produto_membros").select("id").eq("email", email).neq("estado", "removido").limit(1),
    contarPessoas(contaId),
  ]);
  if (ja && ja.length) throw new ErroHttp(409, "email_em_uso", "Esse e-mail já está numa empresa do produto.");
  // Cobrada pelo plano do cliente: a pessoa nova entra e o extra de CRM acompanha. Senão, vale o contratado.
  const extra = await ajustarExtraDoCrm(ch, contaId, "entrou", ocupados + 1);
  if (!extra && conta.cobranca_por !== "plano" && ocupados >= conta.usuarios_contratados) {
    throw new ErroHttp(409, "sem_lugar", `Os ${conta.usuarios_contratados} usuários da empresa estão em uso. Aumente os usuários antes.`);
  }
  const { data, error } = await servico().from("produto_membros").insert({
    conta_id: contaId, email, nome: texto(corpo.nome, 120), papel: corpo.papel === "admin" ? "admin" : corpo.papel === "gerente" ? "gerente" : "usuario", estado: "convidado", convidado_por: ch.userId,
  }).select("id").single();
  if (error || !data) throw erroDoBanco(error, "Não foi possível convidar agora.");
  const id = String((data as { id: string }).id);
  await registrar(contaId, ch.userId, "membro_convidado", { membro: id, pela_casa: true });
  if (corpo.enviar === false) {
    const link = corpo.com_link === true ? await gerarLinkDeAcesso(email) : null;
    return json({ membro_id: id, enviado: false, message_id: null, link, extra });
  }
  const envio = await mandarLinkPorEmail(id, ch.userId);
  return json({ membro_id: id, enviado: envio.enviado, message_id: envio.message_id, link: corpo.com_link === true ? envio.link : null, extra });
}

/** A casa tira uma pessoa do CRM. Numa empresa cobrada pelo plano, o extra de CRM acompanha. */
async function adminRemoverMembro(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  const id = uuidDe(corpo.membro_id, "membro");
  const { data, error } = await servico().rpc("produto_admin_remover_membro", { _membro: id, _ator: ch.userId });
  if (error || !data) throw erroDoBanco(error, "Não foi possível tirar a pessoa agora.");
  const r = data as { conta_id: string; pessoas: number };
  let extra = null;
  let aviso: string | null = null;
  try {
    extra = await ajustarExtraDoCrm(ch, r.conta_id, "saiu", r.pessoas);
  } catch (e) {
    aviso = e instanceof ErroHttp ? e.message : "O extra de CRM não acompanhou. Confira na ficha do cliente.";
  }
  return json({ removido: true, extra, aviso });
}

/**
 * Definir senha nova (a senha do CRM não é recuperável, então não aparece em lugar nenhum). A casa digita
 * ou gera a senha na tela; aqui ela só passa para o Supabase Auth. Nunca vai para o banco, o histórico ou o
 * log, e a resposta não a devolve. Quem ainda não tinha login ganha o login já com essa senha.
 */
async function adminDefinirSenha(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  const id = uuidDe(corpo.membro_id, "membro");
  const senha = typeof corpo.senha === "string" ? corpo.senha : "";
  const problema = problemaDaSenha(senha);
  if (problema) throw new ErroHttp(400, "senha_fraca", problema);
  const { data: m } = await servico().from("produto_membros").select("conta_id, email, estado, user_id, nome").eq("id", id).maybeSingle();
  const membro = m as { conta_id: string; email: string; estado: string; user_id: string | null; nome: string } | null;
  if (!membro || membro.estado === "removido") throw new ErroHttp(404, "sem_pessoa", "Essa pessoa não está mais na empresa.");
  let userId = membro.user_id;
  if (!userId) {
    const { data: achado } = await servico().rpc("produto_auth_usuario_por_email", { _email: membro.email });
    userId = typeof achado === "string" ? achado : null;
  }
  let criado = false;
  if (userId) {
    // E-mail confirmado: a casa responde por esta pessoa, e sem isso a senha nova não entra.
    const { error } = await servico().auth.admin.updateUserById(userId, { password: senha, email_confirm: true });
    if (error) throw new ErroHttp(502, "auth", "O login não aceitou a senha nova agora. Tente de novo.");
  } else {
    const { error } = await servico().auth.admin.createUser({ email: membro.email, password: senha, email_confirm: true, user_metadata: { full_name: membro.nome || "" } });
    if (error) throw new ErroHttp(502, "auth", "Não foi possível criar o login com essa senha agora.");
    criado = true;
  }
  await registrar(membro.conta_id, ch.userId, "senha_definida_pela_casa", { membro: id, login_criado: criado });
  return json({ definida: true, email: membro.email, login_criado: criado });
}

/** A casa manda o link de acesso por e-mail para qualquer pessoa da empresa (primeiro acesso ou troca de senha). */
async function adminEnviarLink(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  const id = uuidDe(corpo.membro_id, "membro");
  const { data: m } = await servico().from("produto_membros").select("conta_id").eq("id", id).maybeSingle();
  const contaDoMembro = (m as { conta_id?: string } | null)?.conta_id || "";
  if (!contaDoMembro) throw new ErroHttp(404, "sem_pessoa", "Essa pessoa não está mais na empresa.");
  const { count } = await servico().from("produto_historico").select("id", { count: "exact", head: true }).eq("conta_id", contaDoMembro).eq("acao", "convite_reenviado").eq("detalhe->>membro", id).gte("criado_em", new Date(Date.now() - 3600 * 1000).toISOString());
  if ((count || 0) >= 3) throw new ErroHttp(429, "muitos_reenvios", "O link já foi mandado há pouco. Espere um pouco ou copie o link.");
  await registrar(contaDoMembro, ch.userId, "convite_reenviado", { membro: id, pela_casa: true });
  const r = await mandarLinkPorEmail(id, ch.userId, true);
  return json({ enviado: r.enviado, message_id: r.message_id });
}

/** O que a fila de e-mail disse sobre uma mensagem (a tela pergunta logo depois de mandar). */
async function adminEstadoDoEnvio(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  const id = uuidDe(corpo.message_id, "mensagem");
  const { data } = await servico().from("email_send_log").select("status, error_message, created_at").eq("message_id", id).order("created_at", { ascending: false }).limit(1);
  const linha = ((data || []) as Array<{ status: string; error_message: string | null }>)[0];
  return json(leituraDoEnvio(linha ? linha.status : "", linha ? linha.error_message : ""));
}

/** Depois que a casa muda plano, usuários ou e-mail de uma empresa: leva o valor novo ao Asaas e confere o estado. */
async function adminSincronizar(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  const contaId = uuidDe(corpo.conta_id, "conta");
  const { data: ass } = await servico().from("produto_assinaturas").select("asaas_assinatura_id, valor_mensal, estado").eq("conta_id", contaId).maybeSingle();
  const a = (ass || {}) as { asaas_assinatura_id?: string | null; valor_mensal?: number; estado?: string };
  const itens = await itensDaConta(contaId);
  const valor = totalDosItens(itens);
  if (!a.asaas_assinatura_id) {
    await servico().from("produto_assinaturas").upsert({ conta_id: contaId, valor_mensal: valor, itens, atualizado_em: new Date().toISOString() }, { onConflict: "conta_id" });
    return json({ assinatura: null, valor });
  }
  try {
    const token = await tokenDoAsaas();
    let lida = await lerAssinaturaNoAsaas(token, fetch, a.asaas_assinatura_id);
    if (!lida) throw new ErroHttp(404, "assinatura_inexistente", "A assinatura não foi encontrada no Asaas.");
    if (!lida.apagada && lida.estado === "ACTIVE" && valor > 0 && Math.abs(lida.valor - valor) > 0.009) {
      lida = await mudarValorDaAssinatura(token, fetch, a.asaas_assinatura_id, { valor, descricao: descricaoDosItens(itens) });
      await registrar(contaId, ch.userId, "valor_sincronizado", { valor });
    }
    await servico().from("produto_assinaturas").update({
      valor_mensal: lida.valor,
      itens,
      proximo_vencimento: lida.proximo_vencimento,
      estado: lida.apagada || lida.estado !== "ACTIVE" ? "cancelada" : a.estado === "atrasada" ? "atrasada" : "ativa",
      atualizado_em: new Date().toISOString(),
    }).eq("conta_id", contaId);
    return json({ assinatura: lida, valor });
  } catch (e) {
    throw erroDoPagamento(e);
  }
}

/**
 * Teste da conexão com o Asaas, sem cobrar ninguém: abre um checkout recorrente de R$ 5, sem cliente,
 * que vale 10 minutos. Mostra se a chave funciona e se o Asaas aceita o formato do checkout do produto.
 * Ninguém paga: o link expira sozinho. A referência "teste:" é ignorada pelo aviso de pagamento.
 */
async function adminTestarAsaas(ch: Chamador) {
  exigirDono(ch);
  let token = "";
  try {
    token = await tokenDoAsaas();
  } catch (e) {
    return json({ ok: false, etapa: "chave", mensagem: e instanceof ErroHttp ? e.message : "Chave do Asaas não configurada." });
  }
  const ambiente = token.indexOf("_hmlg_") >= 0 ? "sandbox" : "producao";
  try {
    const checkout = await criarCheckoutDaAssinatura(token, fetch, {
      clienteId: "",
      itens: [{ chave: "teste", nome: "Teste do CRM", quantidade: 1, unitario: 5, total: 5 }],
      referencia: `teste:${crypto.randomUUID()}`,
      voltarPara: `${app()}/produto`,
      agora: new Date(),
      minutos: 10,
    });
    await registrar(null, ch.userId, "asaas_testado", { ok: true, ambiente });
    return json({ ok: true, ambiente, link: checkout.link, expira_em: checkout.expira_em });
  } catch (e) {
    const mensagem = e instanceof ErroDoAsaas ? e.message : e instanceof Error ? e.message.slice(0, 240) : "Falha inesperada.";
    await registrar(null, ch.userId, "asaas_testado", { ok: false, ambiente, mensagem });
    return json({ ok: false, ambiente, etapa: "checkout", mensagem });
  }
}

/** O admin da casa gera o link do checkout da assinatura de uma empresa, com o plano e os usuários dela (ou os que vierem). */
/**
 * Liga o CRM ao plano do cliente da Aceleriq (extra "crm" da ficha): cria ou acha a empresa do cliente,
 * convida quem vai administrar e devolve o estado. O acesso libera quando o dono marca a cobrança do
 * extra como paga (o banco cuida disso). O login geral do painel não vira usuário do CRM.
 */
async function adminCrmPeloPlano(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  const { data, error } = await servico().rpc("produto_crm_pelo_plano", {
    _extra: uuidDe(corpo.extra_id, "extra"),
    _email: texto(corpo.email, 254).toLowerCase(),
    _nome: texto(corpo.nome, 120),
    _ator: ch.userId,
  });
  if (error || !data) throw erroDoBanco(error, "Não foi possível ligar o CRM agora.");
  const r = data as { conta_id: string; membro_id: string | null; estado: string; acesso_ate: string | null; liberada: boolean };
  const enviado = r.membro_id ? await enviarConvite(r.membro_id, ch.userId) : false;
  return json({ ...r, convite_enviado: enviado });
}

async function adminGerarCheckout(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  return assinar(ch, corpo, uuidDe(corpo.conta_id, "conta"));
}

async function adminCobrarMigracao(ch: Chamador, corpo: Record<string, unknown>) {
  exigirDono(ch);
  const contaId = uuidDe(corpo.conta_id, "conta");
  const conta = await lerConta(contaId);
  const documento = documentoValido(conta.documento);
  if (!documento) throw new ErroHttp(400, "sem_documento", "Preencha o CPF ou o CNPJ da empresa antes de cobrar.");
  const { data: cfg } = await servico().from("produto_config").select("email_migracao").maybeSingle();
  const pedido = Number(corpo.valor);
  const valor = Math.round((pedido > 0 ? pedido : Number((cfg as { email_migracao?: number } | null)?.email_migracao) || 0) * 100) / 100;
  if (!(valor >= 5)) throw new ErroHttp(400, "valor_invalido", "Diga o valor da migração.");
  try {
    const token = await tokenDoAsaas();
    const { data: ass } = await servico().from("produto_assinaturas").select("asaas_cliente_id").eq("conta_id", contaId).maybeSingle();
    const clienteId = (ass as { asaas_cliente_id?: string | null } | null)?.asaas_cliente_id || (await clienteNoAsaas(token, fetch, { nome: conta.nome, documento, email: conta.email_cobranca, telefone: conta.telefone }));
    const pg = await criarCobrancaAvulsa(token, fetch, {
      clienteId,
      valor,
      descricao: `Migração do e-mail profissional (${conta.nome})`,
      referencia: `conta:${contaId}:migracao`,
      vencimento: diaEmSaoPaulo(new Date(), 3),
    });
    await servico().from("produto_assinaturas").upsert({ conta_id: contaId, asaas_cliente_id: clienteId }, { onConflict: "conta_id" });
    await servico().from("produto_cobrancas").insert({
      conta_id: contaId, asaas_pagamento_id: pg.id, tipo: "migracao", descricao: "Migração do e-mail profissional", valor, vencimento: pg.vencimento, estado: "aberta", link: pg.link,
    });
    await registrar(contaId, ch.userId, "migracao_cobrada", { valor });
    return json({ link: pg.link, valor });
  } catch (e) {
    throw erroDoPagamento(e);
  }
}

type Acao = (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>;
const ACOES: Record<string, Acao> = {
  convidar,
  reenviar_convite: reenviarConvite,
  link_de_acesso: linkDeAcesso,
  assinar,
  cancelar: (ch) => cancelar(ch),
  pedir_email: pedirEmail,
  pagar_email: pagarEmail,
  contratar_email_extras: contratarEmailExtras,
  dns,
  admin_criar_conta: adminCriarConta,
  admin_convidar: adminConvidar,
  admin_remover_membro: adminRemoverMembro,
  admin_definir_senha: adminDefinirSenha,
  admin_enviar_link: adminEnviarLink,
  admin_estado_do_envio: adminEstadoDoEnvio,
  admin_sincronizar: adminSincronizar,
  admin_cobrar_migracao: adminCobrarMigracao,
  admin_cobrar_entrada_email: adminCobrarEntradaEmail,
  admin_gerar_checkout: adminGerarCheckout,
  admin_crm_pelo_plano: adminCrmPeloPlano,
  admin_testar_asaas: (ch) => adminTestarAsaas(ch),
};

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
    try {
      let corpo: Record<string, unknown> = {};
      try {
        corpo = await req.json();
      } catch {
        /* corpo vazio */
      }
      const fn = ACOES[String(corpo.acao || "")];
      if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida." }, 400);
      return await fn(await identificar(req), corpo);
    } catch (err) {
      if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
      console.error("[produto] erro inesperado", err instanceof Error ? err.message.slice(0, 200) : "");
      return json({ error: "erro_interno", mensagem: "Falha inesperada. Tente de novo." }, 500);
    }
  });
}
