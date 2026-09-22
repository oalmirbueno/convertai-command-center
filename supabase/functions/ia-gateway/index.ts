/**
 * ia-gateway: a porta da equipe para o motor de modelos da Mesa do cliente
 * (docs/mesa-do-cliente/SPEC.md, secao 3).
 *
 * Acoes (POST { acao, ... }):
 * - catalogo: lista o catalogo ia_modelos (equipe).
 * - estimar { modelo_id, tipo, tokens_entrada?, tokens_saida?, imagens?, qualidade?, buscas_web? }:
 *   custo pela tabela, sem chamar provedor (equipe).
 * - consumo { client_id, mes }: totais do mes pela RPC ia_consumo_cliente (equipe).
 * - recarregar { client_id, valor_usd, observacao }: repassa a RPC
 *   ia_carteira_recarregar COM O JWT DE QUEM CHAMOU, para a regra de admin ou
 *   manager valer dentro do banco.
 * - modelos_do_provedor { provedor }: ids reais de modelo do provedor, para
 *   conferir o catalogo. So admin ou chamada com x-cron-secret.
 * - sincronizar_catalogo: atualiza ia_modelos sozinho (cron diario 06:17).
 *   Le a lista publica do OpenRouter (sem chave), converte preco por token
 *   para preco por 1M e grava pela RPC backend ia_modelos_sincronizar: modelo
 *   novo entra desligado e marcado como novo; nunca desliga nem apaga o que o
 *   dono ligou; o que sumiu vira indisponivel. Da OpenAI e da Anthropic
 *   diretas so confere quais ids existem (os precos openai:* ficam como
 *   estao). So admin ou chamada com x-cron-secret.
 * - chaves_listar { client_id }, chave_salvar { client_id, provedor, chave,
 *   rotulo?, cota_mensal_usd? }, chave_cota { chave_id, cota_mensal_usd },
 *   chave_desativar { chave_id }, cliente_config_salvar { client_id,
 *   usar_chave_agencia, observacao? }: chaves proprias do cliente e cotas (SPEC 2.1),
 *   repassadas as RPCs com o JWT de quem chamou (admin ou manager). O segredo
 *   nunca e devolvido nem registrado em log.
 *
 * Nenhuma chave de provedor sai daqui: o navegador so ve ids, precos e custos.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  estimar,
  IaMotorErro,
  listarCatalogoOpenRouter,
  listarModelosDoProvedor,
  type Provedor,
  type Qualidade,
  type TipoModelo,
} from "../_shared/ia-motor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PROVEDORES: Provedor[] = ["openai", "anthropic", "openrouter"];
// Abaixo disso a lista veio incompleta: nada e marcado como indisponivel.
const MINIMO_LISTA_COMPLETA: Record<Provedor, number> = { openrouter: 50, openai: 20, anthropic: 3 };
const ACOES_DO_CRON = ["modelos_do_provedor", "sincronizar_catalogo"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Chamador =
  | { tipo: "cron" }
  | { tipo: "usuario"; userId: string; token: string; admin: boolean };

async function identificar(req: Request, servico: SupabaseClient): Promise<Chamador | null> {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (cronSecret && req.headers.get("x-cron-secret")?.trim() === cronSecret) return { tipo: "cron" };

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: user } = await servico.auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) return null;
  const { data: staff } = await servico.rpc("is_staff", { _user_id: userId });
  if (staff !== true) return null;
  const { data: ehAdmin } = await servico.rpc("has_role", { _user_id: userId, _role: "admin" });
  return { tipo: "usuario", userId, token, admin: ehAdmin === true };
}

/** Cliente do banco com o JWT de quem chamou: RLS e regras das RPCs valem. */
function clienteDoChamador(token: string): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido" }, 405);

  const servico = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const chamador = await identificar(req, servico);
  if (!chamador) return json({ error: "nao_autorizado" }, 401);

  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { /* corpo vazio */ }
  const acao = String(corpo.acao ?? "");

  try {
    // O cron so confere e sincroniza o catalogo; o resto e da equipe logada.
    if (chamador.tipo === "cron" && !ACOES_DO_CRON.includes(acao)) return json({ error: "nao_autorizado" }, 403);

    if (acao === "sincronizar_catalogo") {
      if (chamador.tipo === "usuario" && !chamador.admin) return json({ error: "somente_admin" }, 403);
      const resultado: Record<string, unknown> = {};

      const { linhas, recebidos } = await listarCatalogoOpenRouter();
      const { data: rOpenRouter, error: eOpenRouter } = await servico.rpc("ia_modelos_sincronizar", {
        _provedor: "openrouter",
        _modelos: linhas,
        _completo: linhas.length >= MINIMO_LISTA_COMPLETA.openrouter,
      });
      resultado.openrouter = eOpenRouter
        ? { erro: eOpenRouter.message }
        : { ...(rOpenRouter as Record<string, unknown>), lista_do_provedor: recebidos };

      // Diretos: so a disponibilidade dos ids que ja estao no catalogo.
      for (const provedor of ["openai", "anthropic"] as Provedor[]) {
        try {
          const ids = await listarModelosDoProvedor(provedor);
          const { data, error } = await servico.rpc("ia_modelos_sincronizar", {
            _provedor: provedor,
            _modelos: ids,
            _completo: ids.length >= MINIMO_LISTA_COMPLETA[provedor],
          });
          resultado[provedor] = error ? { erro: error.message } : data;
        } catch (err) {
          resultado[provedor] = { pulado: err instanceof IaMotorErro ? err.codigo : "falha" };
        }
      }
      return json({ ok: !eOpenRouter, ...resultado });
    }

    if (acao === "modelos_do_provedor") {
      if (chamador.tipo === "usuario" && !chamador.admin) return json({ error: "somente_admin" }, 403);
      const provedor = String(corpo.provedor ?? "") as Provedor;
      if (!PROVEDORES.includes(provedor)) return json({ error: "provedor_invalido", aceitos: PROVEDORES }, 400);
      const ids = await listarModelosDoProvedor(provedor);
      return json({ provedor, total: ids.length, ids });
    }

    if (chamador.tipo !== "usuario") return json({ error: "nao_autorizado" }, 401);
    const doChamador = clienteDoChamador(chamador.token);

    if (acao === "catalogo") {
      const { data, error } = await doChamador
        .from("ia_modelos")
        .select("id, provedor, modelo_api, tipo, rotulo, preco_entrada_1m, preco_saida_1m, preco_cache_1m, preco_imagem, raciocinio, padrao_para, ativo, novo, disponivel, contexto_tokens, modalidades, fonte_preco, conferido_em, criado_em")
        .order("tipo")
        .order("provedor")
        .order("id");
      if (error) return json({ error: "catalogo_indisponivel", mensagem: error.message }, 500);
      return json({ modelos: data ?? [] });
    }

    if (acao === "estimar") {
      const modeloId = String(corpo.modelo_id ?? "");
      const tipo = String(corpo.tipo ?? "") as TipoModelo;
      if (!modeloId || (tipo !== "texto" && tipo !== "imagem")) return json({ error: "entrada_invalida" }, 400);
      const custoUsd = await estimar({
        modeloId,
        tipo,
        tokensEntrada: Number(corpo.tokens_entrada) || 0,
        tokensSaida: Number(corpo.tokens_saida) || 0,
        imagens: corpo.imagens == null ? undefined : Number(corpo.imagens) || 0,
        qualidade: (["baixa", "media", "alta"].includes(String(corpo.qualidade)) ? corpo.qualidade : undefined) as Qualidade | undefined,
        buscasWeb: Number(corpo.buscas_web) || 0,
      });
      return json({ modelo_id: modeloId, custo_usd: custoUsd });
    }

    if (acao === "consumo") {
      const clientId = String(corpo.client_id ?? "");
      const mes = String(corpo.mes ?? "");
      if (!UUID.test(clientId) || !/^\d{4}-\d{2}(-\d{2})?$/.test(mes)) return json({ error: "entrada_invalida" }, 400);
      const { data, error } = await doChamador.rpc("ia_consumo_cliente", {
        _client_id: clientId,
        _mes: mes.length === 7 ? `${mes}-01` : mes,
      });
      if (error) return json({ error: "consumo_indisponivel", mensagem: error.message }, 400);
      return json({ consumo: data });
    }

    if (acao === "recarregar") {
      const clientId = String(corpo.client_id ?? "");
      const valor = Number(corpo.valor_usd);
      if (!UUID.test(clientId) || !Number.isFinite(valor) || valor <= 0) return json({ error: "entrada_invalida" }, 400);
      // Com o JWT de quem chamou: a RPC confere admin ou manager.
      const { data, error } = await doChamador.rpc("ia_carteira_recarregar", {
        _client_id: clientId,
        _valor_usd: valor,
        _observacao: corpo.observacao == null ? null : String(corpo.observacao).slice(0, 500),
      });
      if (error) return json({ error: "recarga_recusada", mensagem: error.message }, 403);
      return json({ saldo_usd: data });
    }

    // Chaves de IA por cliente e cotas (SPEC 2.1). Tudo com o JWT de quem
    // chamou: as RPCs conferem admin ou manager. O segredo so entra (em
    // chave_salvar) e vai direto para a RPC, que o guarda no Vault; nunca volta.
    if (acao === "chaves_listar") {
      const clientId = String(corpo.client_id ?? "");
      if (!UUID.test(clientId)) return json({ error: "entrada_invalida" }, 400);
      const { data, error } = await doChamador.rpc("ia_chaves_listar", { _client_id: clientId });
      if (error) return json({ error: "chaves_recusado", mensagem: error.message }, 403);
      return json({ chaves: data ?? [] });
    }

    if (acao === "chave_salvar") {
      const clientId = String(corpo.client_id ?? "");
      const provedor = String(corpo.provedor ?? "") as Provedor;
      const segredo = typeof corpo.chave === "string" ? corpo.chave.trim() : "";
      const cota = corpo.cota_mensal_usd == null || corpo.cota_mensal_usd === "" ? null : Number(corpo.cota_mensal_usd);
      if (!UUID.test(clientId) || !PROVEDORES.includes(provedor) || segredo.length < 8 || segredo.length > 500) {
        return json({ error: "entrada_invalida" }, 400);
      }
      if (cota !== null && (!Number.isFinite(cota) || cota < 0)) return json({ error: "entrada_invalida" }, 400);
      const { data, error } = await doChamador.rpc("ia_chave_salvar", {
        _client_id: clientId,
        _provedor: provedor,
        _chave: segredo,
        _rotulo: corpo.rotulo == null ? null : String(corpo.rotulo).slice(0, 120),
        _cota_mensal_usd: cota,
      });
      if (error) return json({ error: "chave_recusada", mensagem: error.message }, 403);
      return json({ chave: data });
    }

    if (acao === "chave_cota") {
      const chaveId = String(corpo.chave_id ?? "");
      const cota = corpo.cota_mensal_usd == null || corpo.cota_mensal_usd === "" ? null : Number(corpo.cota_mensal_usd);
      if (!UUID.test(chaveId) || (cota !== null && (!Number.isFinite(cota) || cota < 0))) return json({ error: "entrada_invalida" }, 400);
      const { data, error } = await doChamador.rpc("ia_chave_cota", { _chave_id: chaveId, _cota_mensal_usd: cota });
      if (error) return json({ error: "cota_recusada", mensagem: error.message }, 403);
      return json({ chave: data });
    }

    if (acao === "chave_desativar") {
      const chaveId = String(corpo.chave_id ?? "");
      if (!UUID.test(chaveId)) return json({ error: "entrada_invalida" }, 400);
      const { data, error } = await doChamador.rpc("ia_chave_desativar", { _chave_id: chaveId });
      if (error) return json({ error: "desativar_recusado", mensagem: error.message }, 403);
      return json({ chave: data });
    }

    if (acao === "cliente_config_salvar") {
      const clientId = String(corpo.client_id ?? "");
      if (!UUID.test(clientId) || typeof corpo.usar_chave_agencia !== "boolean") return json({ error: "entrada_invalida" }, 400);
      const { data, error } = await doChamador.rpc("ia_cliente_config_salvar", {
        _client_id: clientId,
        _usar_chave_agencia: corpo.usar_chave_agencia,
        _observacao: corpo.observacao == null ? null : String(corpo.observacao).slice(0, 500),
      });
      if (error) return json({ error: "config_recusada", mensagem: error.message }, 403);
      return json({ config: data });
    }

    return json({
      error: "acao_desconhecida",
      aceitas: [
        "catalogo", "estimar", "consumo", "recarregar", "modelos_do_provedor", "sincronizar_catalogo",
        "chaves_listar", "chave_salvar", "chave_cota", "chave_desativar", "cliente_config_salvar",
      ],
    }, 400);
  } catch (err) {
    if (err instanceof IaMotorErro) return json(err.paraJson(), err.status);
    console.error("ia-gateway: falha", { acao, erro: err instanceof Error ? err.message : "desconhecido" });
    return json({ error: "falha_interna" }, 500);
  }
});
