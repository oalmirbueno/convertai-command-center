/**
 * vendas-webhook: o recebimento do aviso do gateway, sem Deno.serve e sem
 * banco direto (tudo pela porta). index.ts liga a porta no Supabase; os
 * testes ligam numa porta falsa.
 *
 * Ordem: integração pela chave do endereço → assinatura (antes de qualquer
 * coisa do corpo) → normalizar → completar pela API do cliente quando o
 * gateway só manda o id (Mercado Pago; Asaas para o e-mail) → gravar
 * idempotente (o banco liga ao lead do CRM).
 *
 * Respostas: 200 gravado, repetido ou ignorado (o gateway não precisa
 * reenviar); 401 assinatura; 404 integração inexistente ou desligada; 503
 * banco ou API do cliente fora (o gateway reenvia depois).
 */
import {
  CHAVE_DA_INTEGRACAO,
  clienteDoAsaas,
  conferirAssinatura,
  ehGateway,
  type EventoDeVenda,
  type Gateway,
  idDoPagamentoMercadoPago,
  normalizar,
  normalizarAsaas,
  normalizarMercadoPago,
  type PedidoDoGateway,
} from "./modulos/gateways.ts";

export type IntegracaoParaWebhook = {
  id: string;
  client_id: string | null;
  gateway: Gateway;
  ativo: boolean;
  segredo_hash: string | null;
  segredo: string | null;
  token_api: string | null;
};

export type ResultadoDoRegistro = { ok: boolean; duplicado?: boolean; codigo?: string; evento_id?: string; lead_id?: string | null };

export interface PortaDeVendas {
  integracao(gateway: Gateway, chave: string): Promise<IntegracaoParaWebhook | null>;
  registrar(integracaoId: string, e: EventoDeVenda): Promise<ResultadoDoRegistro>;
  /** fetch para a API do cliente (Mercado Pago e Asaas), só GET de leitura. */
  buscar(url: string, init: RequestInit): Promise<Response>;
  falha(onde: string, erro: unknown): void;
}

export type Resposta = { status: number; corpo: Record<string, unknown> };

const r = (status: number, corpo: Record<string, unknown>): Resposta => ({ status, corpo });

/** /functions/v1/vendas-webhook/<gateway>/<chave> → { gateway, chave }; qualquer outra forma → null. */
export function rotaDoWebhook(caminho: string): { gateway: Gateway; chave: string } | null {
  const partes = caminho.split("/").filter(Boolean);
  const i = partes.indexOf("vendas-webhook");
  const resto = i >= 0 ? partes.slice(i + 1) : [];
  if (resto.length !== 2) return null;
  const [gateway, chave] = resto;
  if (!ehGateway(gateway) || !CHAVE_DA_INTEGRACAO.test(chave)) return null;
  return { gateway, chave };
}

export const LIMITE_DO_CORPO = 256 * 1024;

async function lerJson(resp: Response): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

export async function receberWebhook(
  porta: PortaDeVendas,
  rota: { gateway: Gateway; chave: string },
  pedido: PedidoDoGateway,
  agoraMs = Date.now(),
): Promise<Resposta> {
  let integracao: IntegracaoParaWebhook | null;
  try {
    integracao = await porta.integracao(rota.gateway, rota.chave);
  } catch (e) {
    porta.falha("vendas-webhook: integração não lida", e);
    return r(503, { ok: false, codigo: "indisponivel" });
  }
  if (!integracao || !integracao.ativo || integracao.gateway !== rota.gateway) return r(404, { ok: false, codigo: "integracao_desligada" });

  const conferencia = await conferirAssinatura(rota.gateway, pedido, { segredoHash: integracao.segredo_hash, segredo: integracao.segredo }, agoraMs);
  if (!conferencia.ok) return r(401, { ok: false, codigo: conferencia.motivo === "sem_segredo" ? "integracao_sem_segredo" : conferencia.motivo });

  let evento: EventoDeVenda | null = null;
  if (rota.gateway === "mercado_pago") {
    const id = idDoPagamentoMercadoPago(pedido);
    if (!id) return r(200, { ok: true, ignorado: true });
    if (!integracao.token_api) return r(503, { ok: false, codigo: "integracao_sem_token_api" });
    let resp: Response;
    try {
      resp = await porta.buscar(`https://api.mercadopago.com/v1/payments/${id}`, { method: "GET", headers: { Authorization: `Bearer ${integracao.token_api}` } });
    } catch (e) {
      porta.falha("vendas-webhook: Mercado Pago fora", e);
      return r(503, { ok: false, codigo: "gateway_indisponivel" });
    }
    if (!resp.ok) {
      porta.falha("vendas-webhook: Mercado Pago recusou a leitura do pagamento", { status: resp.status });
      return r(503, { ok: false, codigo: resp.status === 401 || resp.status === 403 ? "token_api_recusado" : "gateway_indisponivel" });
    }
    evento = normalizarMercadoPago(await lerJson(resp));
  } else if (rota.gateway === "asaas") {
    let cliente: unknown = null;
    const idDoCliente = clienteDoAsaas(pedido.json);
    if (idDoCliente && integracao.token_api) {
      const base = integracao.token_api.indexOf("_hmlg_") >= 0 ? "https://api-sandbox.asaas.com" : "https://api.asaas.com";
      try {
        const resp = await porta.buscar(`${base}/v3/customers/${idDoCliente}`, { method: "GET", headers: { access_token: integracao.token_api } });
        if (resp.ok) cliente = await lerJson(resp);
        else porta.falha("vendas-webhook: Asaas recusou a leitura do cliente", { status: resp.status });
      } catch (e) {
        // Sem o e-mail o evento ainda vale (valor e tipo): grava sem ligar ao lead.
        porta.falha("vendas-webhook: Asaas fora ao ler o cliente", e);
      }
    }
    evento = normalizarAsaas(pedido.json, cliente);
  } else {
    evento = normalizar(rota.gateway, pedido.json);
  }
  if (!evento) return r(200, { ok: true, ignorado: true });

  let gravado: ResultadoDoRegistro;
  try {
    gravado = await porta.registrar(integracao.id, evento);
  } catch (e) {
    porta.falha("vendas-webhook: evento não gravado", e);
    return r(503, { ok: false, codigo: "indisponivel" });
  }
  if (!gravado.ok) {
    if (gravado.codigo === "integracao_desligada") return r(404, { ok: false, codigo: "integracao_desligada" });
    porta.falha("vendas-webhook: banco recusou o evento", { codigo: gravado.codigo });
    return r(503, { ok: false, codigo: gravado.codigo || "indisponivel" });
  }
  return r(200, { ok: true, duplicado: !!gravado.duplicado, tipo: evento.tipo });
}
