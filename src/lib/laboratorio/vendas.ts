/**
 * Vendas pelo checkout do gateway do cliente (Laboratório v4, nó `checkout`):
 * a ponte da tela com a função `vendas-webhook` (ações da equipe) e o que a
 * tela precisa saber de cada gateway (nome, segredo, instrução de onde colar).
 *
 * A função é a fonte da verdade (supabase/functions/vendas-webhook/index.ts);
 * os leitores abaixo casam com o que ela devolve. Segredo nunca volta da
 * listagem: só `tem_segredo` e os 4 últimos caracteres.
 *
 * Compatível com Safari 11 / Chrome 64: regex sem lookbehind, sem classe Unicode e sem grupo com nome.
 */
import { supabase } from "@/integrations/supabase/client";

export const GATEWAYS_DE_VENDA = ["hotmart", "kiwify", "stripe", "mercado_pago", "asaas"] as const;
export type GatewayDeVenda = (typeof GATEWAYS_DE_VENDA)[number];

export type InfoDoGateway = {
  nome: string;
  /** O painel gera o segredo (mostra uma vez). Senão, o dono cola o que o gateway mostrou. */
  segredoDoPainel: boolean;
  /** Nome do segredo que o dono cola (quando não é do painel). */
  rotuloDoSegredo: string;
  /** Chave de API do cliente: obrigatória (Mercado Pago), opcional (Asaas) ou não usa. */
  tokenApi: "obrigatorio" | "opcional" | "nao";
  /** Onde colar o endereço no gateway (o "?" recolhido). */
  ondeColar: string[];
};

export const INFO_DO_GATEWAY: Record<GatewayDeVenda, InfoDoGateway> = {
  hotmart: {
    nome: "Hotmart",
    segredoDoPainel: false,
    rotuloDoSegredo: "Hottok da Hotmart",
    tokenApi: "nao",
    ondeColar: [
      "Na Hotmart: Ferramentas › Webhook (API e notificações) › Cadastrar webhook, versão 2.0.0.",
      "Cole o endereço, escolha o produto e marque compra aprovada, boleto/Pix impresso, cancelada, reembolsada, chargeback, expirada, abandono de carrinho e cancelamento de assinatura.",
      "Copie o Hottok da mesma tela e cole aqui. O painel guarda só uma impressão dele.",
    ],
  },
  kiwify: {
    nome: "Kiwify",
    segredoDoPainel: false,
    rotuloDoSegredo: "Token do webhook da Kiwify",
    tokenApi: "nao",
    ondeColar: [
      "Na Kiwify: Apps › Webhooks › Criar webhook.",
      "Cole o endereço, escolha os produtos e marque compra aprovada, recusada, reembolsada, chargeback, Pix gerado, boleto gerado, carrinho abandonado e os de assinatura.",
      "Copie o Token que a Kiwify mostra e cole aqui. Faça uma compra de teste para conferir.",
    ],
  },
  stripe: {
    nome: "Stripe",
    segredoDoPainel: false,
    rotuloDoSegredo: "Segredo de assinatura (whsec_...)",
    tokenApi: "nao",
    ondeColar: [
      "No Stripe: Desenvolvedores › Webhooks › Adicionar destino.",
      "Cole o endereço e marque checkout.session.completed, async_payment_succeeded, async_payment_failed, expired, charge.refunded, charge.dispute.created, invoice.paid, invoice.payment_failed e customer.subscription.deleted.",
      "Copie o Segredo de assinatura (começa com whsec_) e cole aqui.",
    ],
  },
  mercado_pago: {
    nome: "Mercado Pago",
    segredoDoPainel: false,
    rotuloDoSegredo: "Assinatura secreta do webhook",
    tokenApi: "obrigatorio",
    ondeColar: [
      "No Mercado Pago: Suas integrações › sua aplicação › Webhooks › Configurar notificações, modo produtivo.",
      "Cole o endereço, marque o evento Pagamentos e salve. Copie a Assinatura secreta e cole aqui.",
      "Cole também o Access Token de produção (Credenciais): o aviso só traz o número do pagamento, e o painel lê o valor e o comprador com ele.",
    ],
  },
  asaas: {
    nome: "Asaas",
    segredoDoPainel: true,
    rotuloDoSegredo: "Token de autenticação",
    tokenApi: "opcional",
    ondeColar: [
      "No Asaas: Integrações › Webhooks › Adicionar, versão v3.",
      "Cole o endereço e, em Token de autenticação, o token que o painel mostrou ao criar. Marque os eventos de cobrança.",
      "Opcional: cole aqui a chave de API para o painel ler o e-mail do comprador e ligar a venda ao lead.",
    ],
  },
};

/** O nó guarda o gateway como texto da escolha ("Mercado Pago", "outro link"): vira o slug, ou null quando não manda eventos. */
export function gatewayDoNo(texto: string | null | undefined): GatewayDeVenda | null {
  const s = String(texto || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (s === "mercadopago") return "mercado_pago";
  return (GATEWAYS_DE_VENDA as readonly string[]).indexOf(s) >= 0 ? (s as GatewayDeVenda) : null;
}

export type TipoDeEventoDeVenda =
  | "compra_aprovada"
  | "compra_recusada"
  | "pix_gerado"
  | "boleto_gerado"
  | "pagamento_expirado"
  | "carrinho_abandonado"
  | "reembolso"
  | "chargeback"
  | "cancelamento"
  | "assinatura_renovada"
  | "assinatura_atrasada"
  | "assinatura_cancelada";

export const ROTULO_DO_EVENTO: Record<TipoDeEventoDeVenda, string> = {
  compra_aprovada: "Compra aprovada",
  compra_recusada: "Compra recusada",
  pix_gerado: "Pix gerado",
  boleto_gerado: "Boleto gerado",
  pagamento_expirado: "Pix ou boleto vencido",
  carrinho_abandonado: "Carrinho abandonado",
  reembolso: "Reembolso",
  chargeback: "Chargeback",
  cancelamento: "Compra cancelada",
  assinatura_renovada: "Assinatura renovada",
  assinatura_atrasada: "Assinatura em atraso",
  assinatura_cancelada: "Assinatura cancelada",
};

export const rotuloDoEvento = (tipo: string) => ROTULO_DO_EVENTO[tipo as TipoDeEventoDeVenda] || tipo;

/** "R$ 197,00" (ou "USD 10.00" fora do real). Sem Intl de moeda: igual em todo navegador. */
export function valorNaTela(valor: number | null | undefined, moeda: string | null | undefined): string {
  if (valor == null || !isFinite(Number(valor))) return "";
  const n = Number(valor).toFixed(2);
  if (!moeda || moeda === "BRL") {
    const partes = n.split(".");
    const inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `R$ ${inteiro},${partes[1]}`;
  }
  return `${moeda} ${n}`;
}

export interface IntegracaoDeVenda {
  id: string;
  client_id: string | null;
  gateway: GatewayDeVenda;
  ativo: boolean;
  endereco: string;
  criado_em: string;
  tem_segredo: boolean;
  segredo_final: string | null;
  segredo_gerado_pelo_painel: boolean;
  token_api: "obrigatorio" | "opcional" | "nao";
  tem_token_api: boolean;
  ultimo_evento_em: string | null;
}

export interface EventoDeVendaNaTela {
  id: string;
  tipo: string;
  valor: number | null;
  moeda: string | null;
  produto_externo_id: string | null;
  comprador_email: string | null;
  comprador_nome: string | null;
  lead_id: string | null;
  recebido_em: string;
}

/** A integração está pronta para receber? (segredo salvo e, no Mercado Pago, a chave de API.) */
export function falta(i: IntegracaoDeVenda): "segredo" | "token_api" | null {
  if (!i.tem_segredo) return "segredo";
  if (i.token_api === "obrigatorio" && !i.tem_token_api) return "token_api";
  return null;
}

export class ErroDeVendas extends Error {
  codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroDeVendas";
    this.codigo = codigo;
  }
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("vendas-webhook", { body: corpo });
  if (error) {
    let detalhe: { error?: string; mensagem?: string } | null = null;
    try {
      const ctx = (error as { context?: { clone?: () => Response; json?: () => Promise<unknown> } }).context;
      if (ctx && typeof ctx.clone === "function") detalhe = (await ctx.clone().json()) as typeof detalhe;
      else if (ctx && typeof ctx.json === "function") detalhe = (await ctx.json()) as typeof detalhe;
    } catch {
      detalhe = null;
    }
    if (detalhe && typeof detalhe.error === "string") throw new ErroDeVendas(detalhe.error, detalhe.mensagem || "Não foi possível concluir.");
    throw new ErroDeVendas("servico_indisponivel", "O serviço de vendas não respondeu. Tente de novo em instantes.");
  }
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    const d = data as { error: string; mensagem?: string };
    throw new ErroDeVendas(d.error, d.mensagem || "Não foi possível concluir.");
  }
  return data as T;
}

export async function listarIntegracoes(clienteId: string | null, gateway?: GatewayDeVenda): Promise<IntegracaoDeVenda[]> {
  const r = await chamar<{ integracoes?: IntegracaoDeVenda[] }>({ acao: "integracao_listar", client_id: clienteId, gateway: gateway || null });
  return Array.isArray(r && r.integracoes) ? r.integracoes : [];
}

export async function criarIntegracao(clienteId: string | null, gateway: GatewayDeVenda): Promise<{ integracao: IntegracaoDeVenda; segredo: string | null }> {
  const r = await chamar<{ integracao: IntegracaoDeVenda; segredo?: string | null }>({ acao: "integracao_criar", client_id: clienteId, gateway });
  return { integracao: r.integracao, segredo: r.segredo || null };
}

export async function salvarSegredo(id: string, valores: { segredo?: string; token_api?: string }): Promise<IntegracaoDeVenda> {
  const r = await chamar<{ integracao: IntegracaoDeVenda }>({ acao: "integracao_segredo", id, segredo: valores.segredo || null, token_api: valores.token_api || null });
  return r.integracao;
}

export async function desligarIntegracao(id: string): Promise<void> {
  await chamar<{ ok: boolean }>({ acao: "integracao_desligar", id });
}

export async function listarEventos(clienteId: string | null, filtro: { gateway?: GatewayDeVenda; integracaoId?: string; limite?: number } = {}): Promise<EventoDeVendaNaTela[]> {
  const r = await chamar<{ eventos?: EventoDeVendaNaTela[] }>({
    acao: "eventos_listar",
    client_id: clienteId,
    gateway: filtro.gateway || null,
    integracao_id: filtro.integracaoId || null,
    limite: filtro.limite || 5,
  });
  return Array.isArray(r && r.eventos) ? r.eventos : [];
}
