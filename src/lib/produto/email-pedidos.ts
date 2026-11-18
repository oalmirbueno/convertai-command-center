import { supabase } from "@/integrations/supabase/client";
import { ErroDoProduto, type CaixaDeEmail, type DominioDeEmail, type EtapaDaMigracao } from "./api";

/** O domínio como a casa lê (select *), com os campos da integração. */
export interface DominioComIntegracao extends DominioDeEmail {
  cloudflare_zona_id?: string | null;
  zoho_org_id?: string | null;
  zoho_dc?: string | null;
  zoho_admin?: string | null;
  zoho_plano?: string | null;
  zoho_conectado?: boolean;
  integracao?: { cloudflare?: unknown; zoho?: unknown } | null;
  integracao_conferida_em?: string | null;
}

/**
 * E-mail profissional numa rota só (18/11/2026): a entrada (pedido), o "marcar como pago", a
 * integração com a Cloudflare e o Zoho e a caixa oficial da Aceleriq. Contrato do banco:
 * supabase/migrations/20261118170000_produto_email_rota_unica.sql. O que fala com os provedores
 * passa pela função produto-email; o resto são RPCs que conferem o dono no banco.
 */

const db = supabase as unknown as {
  rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: any; error: { message: string; code?: string } | null }>;
};

export type EstadoDoPedido = "novo" | "aguardando_pagamento" | "pago" | "em_andamento" | "concluido" | "cancelado";
export type TipoDoPedido = "migracao" | "novo";
export type FormaDePagamento = "pix" | "boleto" | "cartao" | "transferencia" | "dinheiro" | "cortesia" | "ja_lancado";

export interface PedidoDeEmail {
  id: string;
  conta_id: string;
  extra_id: string | null;
  dominio_id: string | null;
  tipo: TipoDoPedido;
  dominio: string | null;
  caixas: number;
  provedor_atual: string | null;
  observacao: string | null;
  origem: "pagina" | "app" | "casa" | "agente";
  estado: EstadoDoPedido;
  valor_migracao: number;
  valor_mensal: number;
  pago_em: string | null;
  forma_pagamento: string | null;
  valor_pago: number | null;
  nota: string | null;
  criado_em: string;
  /** Só na leitura da casa. */
  empresa?: string;
  email_contato?: string | null;
  telefone?: string | null;
  client_id?: string | null;
  extra_nome?: string | null;
  etapas_feitas?: number;
  etapas_total?: number;
  extras_de_email?: Array<{ id: string; nome: string; cobranca: string; valor: number }>;
}

export const ROTULO_DO_PEDIDO: Record<EstadoDoPedido, string> = {
  novo: "Novo",
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago",
  em_andamento: "Migrando",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export const ROTULO_DA_ORIGEM: Record<PedidoDeEmail["origem"], string> = { pagina: "Página", app: "Painel do cliente", casa: "Aceleriq", agente: "Agente" };

export const FORMAS: Array<{ valor: FormaDePagamento; rotulo: string }> = [
  { valor: "pix", rotulo: "Pix" },
  { valor: "transferencia", rotulo: "Transferência" },
  { valor: "boleto", rotulo: "Boleto" },
  { valor: "cartao", rotulo: "Cartão" },
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "cortesia", rotulo: "Cortesia (sem valor)" },
  { valor: "ja_lancado", rotulo: "Já está no Financeiro" },
];

/** Formas que não lançam dinheiro: não pedem valor. */
export const semLancamento = (f: FormaDePagamento) => f === "cortesia" || f === "ja_lancado";

const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export function lerPedido(x: any): PedidoDeEmail {
  return {
    ...x,
    caixas: n(x && x.caixas) || 1,
    valor_migracao: n(x && x.valor_migracao),
    valor_mensal: n(x && x.valor_mensal),
    valor_pago: x && x.valor_pago != null ? n(x.valor_pago) : null,
    etapas_feitas: n(x && x.etapas_feitas),
    etapas_total: n(x && x.etapas_total),
    extras_de_email: Array.isArray(x && x.extras_de_email) ? x.extras_de_email.map((e: any) => ({ ...e, valor: n(e.valor) })) : [],
  } as PedidoDeEmail;
}

/** Quanto cobrar ao marcar pago: a migração quando é migração, senão a primeira mensalidade. */
export const valorSugerido = (p: Pick<PedidoDeEmail, "tipo" | "valor_migracao" | "valor_mensal">) => (p.tipo === "migracao" ? p.valor_migracao : p.valor_mensal);

/** O pedido ainda espera o dinheiro? É isso que mostra o botão "Marcar como pago". */
export const esperaPagamento = (p: Pick<PedidoDeEmail, "estado" | "pago_em">) => !p.pago_em && (p.estado === "novo" || p.estado === "aguardando_pagamento");

/** O próximo passo que a tela da casa mostra em cada entrada. */
export function proximoPasso(p: PedidoDeEmail): string {
  if (p.estado === "cancelado") return "Cancelado.";
  if (p.estado === "concluido") return "Migração concluída.";
  if (esperaPagamento(p)) return p.extra_id ? "Quando pagar, marque como pago: quita a cobrança do extra." : "Combinar e, quando pagar, marcar como pago.";
  if (!p.dominio_id) return "Pago. Falta o domínio para começar o passo a passo.";
  const feitas = p.etapas_feitas || 0;
  const total = p.etapas_total || 0;
  return total ? `Migrando: ${feitas} de ${total} etapas.` : "Migrando.";
}

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(nome, args);
  if (error) throw error;
  return data as T;
}

export async function listarPedidos(estado: "abertos" | null = null): Promise<PedidoDeEmail[]> {
  const d = await rpc<unknown[]>("produto_email_pedidos_da_casa", { _estado: estado, _limite: 200 });
  return (Array.isArray(d) ? d : []).map(lerPedido);
}

export async function novoPedidoPelaCasa(p: { conta_id: string; dominio?: string; caixas: number; tipo: TipoDoPedido; observacao?: string; extra_id?: string | null }) {
  const d = await rpc<{ pedido: unknown; novo: boolean }>("produto_email_registrar_pedido", {
    _conta: p.conta_id, _dominio: p.dominio || null, _caixas: p.caixas, _tipo: p.tipo, _observacao: p.observacao || null, _origem: "casa", _extra: p.extra_id || null,
  });
  return { pedido: lerPedido(d.pedido), novo: !!d.novo };
}

export async function marcarPago(p: { pedido_id: string; forma: FormaDePagamento; valor?: number | null; pago_em?: string | null }) {
  const d = await rpc<{ pedido: unknown; ja_estava_pago: boolean; livro?: string }>("produto_email_marcar_pago", {
    _pedido: p.pedido_id, _forma: p.forma, _valor: p.valor && p.valor > 0 ? p.valor : null, _pago_em: p.pago_em || null,
  });
  return { pedido: lerPedido(d.pedido), jaEstavaPago: !!d.ja_estava_pago, livro: d.livro || null };
}

/** Os extras de e-mail vivos na ficha do cliente da Aceleriq (só o dono lê client_extras). */
export async function extrasDeEmailDoCliente(clientId: string): Promise<Array<{ id: string; nome: string; valor: number; cobranca: string }>> {
  const semTipo = supabase as unknown as { from: (t: string) => any };
  const { data, error } = await semTipo.from("client_extras").select("id, nome, valor, cobranca").eq("client_id", clientId).eq("categoria", "email").neq("status", "encerrado");
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((x: any) => ({ id: String(x.id), nome: String(x.nome), valor: n(x.valor), cobranca: String(x.cobranca) }));
}

export const mudarPedido =(pedidoId: string, estado: "aguardando_pagamento" | "concluido" | "cancelado" | "reabrir", nota?: string) =>
  rpc<{ pedido: unknown }>("produto_email_pedido_mudar", { _pedido: pedidoId, _estado: estado, _nota: nota || null }).then((d) => lerPedido(d.pedido));

/** De quem é a caixa no correio (nulo = ninguém). */
export const atribuirCaixa = (caixaId: string, membroId: string | null) => rpc<unknown>("produto_email_caixa_atribuir", { _caixa: caixaId, _membro: membroId });

export const salvarIntegracao = (dominioId: string, dados: Partial<{ cloudflare_zona_id: string; zoho_org_id: string; zoho_dc: string; zoho_admin: string; zoho_plano: string; dominio_vence_em: string; provedor_vence_em: string; provedor_custo_mensal: string; correio_provedor: string; correio_ligado: boolean }>) =>
  rpc<unknown>("produto_email_dominio_atualizar", { _dominio_id: dominioId, _dados: dados });

// ------------------------------------------------------------------ a função produto-email

async function chamarEmail<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("produto-email", { body: corpo });
  if (error) {
    let resposta: { error?: string; mensagem?: string } | null = null;
    try {
      const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context;
      resposta = ctx && typeof ctx.clone === "function" ? ((await ctx.clone().json()) as { error?: string; mensagem?: string }) : null;
    } catch {
      resposta = null;
    }
    if (resposta && resposta.mensagem) throw new ErroDoProduto(String(resposta.error || "erro"), resposta.mensagem);
    throw new ErroDoProduto("servico_indisponivel", "A função produto-email não respondeu. Ela já foi publicada?");
  }
  return data as T;
}

export interface ItemConferido {
  chave: string;
  situacao: "ok" | "alerta" | "falta";
  texto: string;
}

export interface ConferenciaDaCloudflare {
  ok: boolean;
  status?: string;
  name_servers?: string[];
  proxied_email?: number;
  itens: ItemConferido[];
  conferido_em: string;
}

export interface ConferenciaDoZoho {
  ok: boolean;
  sem_api?: boolean;
  org_id?: string | null;
  plano?: string | null;
  usuarios?: number;
  caixas?: Array<{ endereco: string; nome: string; apelidos: string[]; ativa: boolean; admin: boolean }>;
  dominio?: { verificado: boolean; mx: string | null; spf: boolean; dkim: boolean; seletor: string | null } | null;
  avisos: string[];
  conferido_em: string;
}

export const conferirCloudflare = (dominioId: string) => chamarEmail<{ resumo: ConferenciaDaCloudflare }>({ acao: "conferir_cloudflare", dominio_id: dominioId }).then((r) => r.resumo);
export const conferirZoho = (dominioId: string) => chamarEmail<{ resumo: ConferenciaDoZoho }>({ acao: "conferir_zoho", dominio_id: dominioId }).then((r) => r.resumo);
/** O token vai direto para o cofre (Vault) pela função; a tela nunca lê de volta. "" apaga. */
export const guardarTokenZoho = (dominioId: string, token: string) => chamarEmail<{ guardado: boolean }>({ acao: "guardar_token_zoho", dominio_id: dominioId, token }).then((r) => r.guardado);

export interface EstadoDaCaixaOficial {
  ligada: boolean;
  motivo: string | null;
  plano_necessario: string;
  custo: { por_usuario_mes: string; cobranca: string; fonte: string };
}
export interface MensagemDaCaixa {
  id: string;
  de: string;
  assunto: string;
  resumo: string;
  recebida_em: string | null;
  lida: boolean;
}
export const estadoDaCaixaOficial = () => chamarEmail<{ estado: EstadoDaCaixaOficial; dominio: string | null }>({ acao: "caixa_estado" });
export const mensagensDaCaixaOficial = () => chamarEmail<{ mensagens: MensagemDaCaixa[] }>({ acao: "caixa_listar" }).then((r) => r.mensagens);

// ------------------------------------------------------------------ o /app

export interface PedidoDoCliente {
  id: string;
  tipo: TipoDoPedido;
  dominio: string | null;
  caixas: number;
  estado: EstadoDoPedido;
  valor_migracao: number;
  valor_mensal: number;
  pago_em: string | null;
  criado_em: string;
}

/** O que a empresa vê do próprio e-mail: liberado (pedido pago ou empresa em dia), o pedido e a migração. */
export async function carregarEmailDoCliente(): Promise<{
  liberado: boolean;
  pedido: PedidoDoCliente | null;
  dominios: DominioDeEmail[];
  caixas: CaixaDeEmail[];
  etapas: EtapaDaMigracao[];
}> {
  const d = (await rpc<any>("produto_email_da_conta", {})) || {};
  const lista = (v: unknown) => (Array.isArray(v) ? v : []);
  const checagem = (c: any) => (c && typeof c === "object" && Array.isArray(c.itens) ? c : null);
  const vazio = { provedor_antigo: null, dns_em: null, registro_em: null, dkim_seletor: null, observacao: null };
  return {
    liberado: d.liberado === true,
    pedido: d.pedido ? { ...d.pedido, caixas: n(d.pedido.caixas) || 1, valor_migracao: n(d.pedido.valor_migracao), valor_mensal: n(d.pedido.valor_mensal) } : null,
    dominios: lista(d.dominios).map((x: any) => ({ ...vazio, ...x, checagem: checagem(x.checagem) })),
    caixas: lista(d.caixas).map((c: any) => ({ tamanho_origem: null, observacao: null, ...c })),
    etapas: lista(d.etapas).map((e: any) => ({ ajuda: "", nota: null, ...e })),
  };
}

/** O que o cliente lê sobre o pedido enquanto o e-mail não está no ar. */
export function fraseDoPedido(p: PedidoDoCliente | null): { titulo: string; texto: string } | null {
  if (!p) return null;
  if (p.estado === "novo" || p.estado === "aguardando_pagamento") {
    return { titulo: "Pedido recebido", texto: "A Aceleriq vai falar com você para combinar. Assim que o pagamento for confirmado, a migração começa e o andamento aparece aqui." };
  }
  if (p.estado === "pago") return { titulo: "Pagamento confirmado", texto: "A Aceleriq já está preparando o seu domínio. O passo a passo aparece aqui em seguida." };
  if (p.estado === "cancelado") return { titulo: "Pedido cancelado", texto: "Se quiser retomar, faça um novo pedido." };
  return null;
}

/**
 * Para onde o /app leva quem entra: empresa que só tem o e-mail (CRM fora do teste ou não contratado)
 * cai direto no E-mail. Quem tem o CRM liberado continua no Início.
 */
export function destinoDoInicio(e: { conta: { email_ativo: boolean } | null; crm: boolean }): "/app/email" | null {
  if (!e.conta || !e.conta.email_ativo) return null;
  return e.crm ? null : "/app/email";
}
