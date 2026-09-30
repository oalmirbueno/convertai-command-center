/**
 * proposta-publica: o link /proposta/:token (frente PRO, 30/09/2026), sem login.
 * Mesmo desenho do contract-public: a função usa a chave de serviço e só
 * chama as RPCs security definer por token (proposta_publica_ler, _evento e
 * _aceitar), que recusam qualquer outro papel.
 *
 * - GET ?token=...                          -> { proposta, agencia, logo_cliente_url }
 * - POST { token, tipo: aberta|leitura, sessao, segundos } -> { ok } (rastreio de abertura e tempo de leitura)
 * - POST { token, aceitar: { nome, email, aceito: true, pacote?, pagamento? } } -> { ok, aceita_em, contrato }
 *
 * Frente PRO2: o GET leva pacotes, pagamento, visual e anexos (arquivo vira
 * link assinado de 1 h, o caminho não sai); o aceite vai pela RPC v2, que
 * grava o pacote e a forma de pagamento escolhidos (sem a v2 no banco, a de
 * antes, só quando não há pacote).
 *
 * O aceite cria o evento "aceita" (na RPC), que a frente de contratos
 * consome, e o "contrato_pendente": a equipe gera o contrato pela etapa
 * Envio (gerar_do_aceite exige a gestão do cliente, não roda sem login).
 * Nada de erro engolido: vai para o log.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { validarAceite } from "../_shared/proposta-modelo.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { lerDadosDaAgencia } from "../_shared/dados-da-agencia.ts";
import { agenciaPublica } from "../mesa-proposta/agencia.ts";
import { normalizarAnexos } from "../_shared/proposta-comercial.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TOKEN_OK = /^[0-9a-f]{32,128}$/i;

function servico() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ipDe = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 80) || "desconhecido";
const navegadorDe = (req: Request) => (req.headers.get("user-agent") || "").slice(0, 300);

/**
 * Depois do aceite: o evento "aceita" (gravado na RPC) é o que a frente de
 * contratos consome. A ação gerar_do_aceite da função contratos exige alguém
 * da gestão do cliente (can_manage_client), então quem gera o contrato é a
 * equipe, pelo botão "Gerar contrato" da etapa Envio. Aqui fica o evento
 * "contrato_pendente" para a mesa mostrar o que falta.
 */
async function marcarContratoPendente(db: ReturnType<typeof servico>, propostaId: string, clientId: string): Promise<"pendente"> {
  const { error } = await db.from("proposta_eventos").insert({ proposta_id: propostaId, client_id: clientId, tipo: "contrato_pendente", dados: { acao: "gerar_do_aceite", onde: "Mesa Proposta, etapa Envio" } });
  if (error) registrarFalha("proposta-publica: evento do contrato não gravado", error, { proposta_id: propostaId });
  return "pendente";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = servico();
  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("token") || "";
      if (!TOKEN_OK.test(token)) return json({ error: "link_invalido" }, 404);
      const { data, error } = await db.rpc("proposta_publica_ler", { p_token: token });
      if (error) {
        registrarFalha("proposta-publica: leitura falhou", error);
        return json({ error: "indisponivel" }, 503);
      }
      if (!data) return json({ error: "link_invalido" }, 404);
      const proposta = data as Record<string, unknown>;
      let logo: string | null = null;
      const caminho = typeof proposta.logo_cliente_path === "string" ? proposta.logo_cliente_path : "";
      if (caminho) {
        const { data: assinado, error: e } = await db.storage.from("mesa").createSignedUrl(caminho, 60 * 60);
        if (e) registrarFalha("proposta-publica: logo do cliente sem link", e);
        logo = assinado?.signedUrl || null;
      }
      let agencia: ReturnType<typeof agenciaPublica> | null = null;
      try {
        agencia = agenciaPublica(await lerDadosDaAgencia(db));
      } catch (e) {
        registrarFalha("proposta-publica: dados da agência não lidos", e);
      }
      const { logo_cliente_path: _fora, anexos: anexosBrutos, ...publica } = proposta;
      // Anexos: link vai como está; arquivo vira link assinado (o caminho do Storage não sai).
      const anexos: Array<{ id: string; tipo: string; titulo: string; url: string }> = [];
      for (const a of normalizarAnexos(anexosBrutos)) {
        if (a.tipo === "link") anexos.push({ id: a.id, tipo: a.tipo, titulo: a.titulo, url: a.url });
        else {
          const { data: assinado, error: e } = await db.storage.from("mesa").createSignedUrl(a.caminho, 60 * 60);
          if (e || !assinado) registrarFalha("proposta-publica: anexo sem link", e || new Error("sem link"));
          else anexos.push({ id: a.id, tipo: a.tipo, titulo: a.titulo, url: assinado.signedUrl });
        }
      }
      return json({ proposta: { ...publica, anexos }, agencia, logo_cliente_url: logo });
    }

    if (req.method === "POST") {
      const corpo = await req.json().catch(() => null) as Record<string, unknown> | null;
      const token = corpo && typeof corpo.token === "string" ? corpo.token.trim() : "";
      if (!TOKEN_OK.test(token)) return json({ error: "link_invalido" }, 404);

      if (corpo && corpo.aceitar && typeof corpo.aceitar === "object") {
        const a = corpo.aceitar as Record<string, unknown>;
        const erro = validarAceite(a);
        if (erro) return json({ error: "aceite_invalido", mensagem: erro }, 400);
        const pacote = typeof a.pacote === "string" ? a.pacote.trim().slice(0, 20) : "";
        const pagamento = typeof a.pagamento === "string" ? a.pagamento.trim().slice(0, 30) : "";
        const base = { p_token: token, p_nome: String(a.nome).trim(), p_email: String(a.email).trim(), p_ip: ipDe(req), p_user_agent: navegadorDe(req) };
        let { data, error } = await db.rpc("proposta_publica_aceitar_v2", { ...base, p_pacote: pacote || null, p_pagamento: pagamento || null });
        // Sem a v2 no banco (migration da PRO2 pendente): o aceite de antes, só quando não há pacote a gravar.
        if (error && (error.code === "PGRST202" || error.code === "42883") && !pacote) {
          registrarFalha("proposta-publica: aceite v2 ausente, usando o de antes", error);
          ({ data, error } = await db.rpc("proposta_publica_aceitar", base));
        }
        if (error) {
          const m = String(error.message || "");
          if (/package required/.test(m)) return json({ error: "pacote_obrigatorio", mensagem: "Escolha um dos pacotes para aceitar." }, 400);
          if (/invalid payment/.test(m)) return json({ error: "pagamento_invalido", mensagem: "Escolha uma das formas de pagamento." }, 400);
          if (/expired/.test(m)) return json({ error: "expirada", mensagem: "A validade desta proposta terminou. Fale com a Aceleriq para receber uma nova." }, 409);
          if (/not open/.test(m)) return json({ error: "encerrada", mensagem: "Esta proposta não está mais aberta para aceite." }, 409);
          if (/not found/.test(m)) return json({ error: "link_invalido", mensagem: "Link inválido." }, 404);
          registrarFalha("proposta-publica: aceite falhou", error);
          return json({ error: "indisponivel", mensagem: "Não foi possível registrar o aceite agora. Tente de novo." }, 503);
        }
        const r = (data || {}) as { proposta_id?: string; client_id?: string; aceita_em?: string; ja_aceita?: boolean };
        const contrato = r.proposta_id && r.client_id && !r.ja_aceita ? await marcarContratoPendente(db, r.proposta_id, r.client_id) : null;
        return json({ ok: true, aceita_em: r.aceita_em || null, ja_aceita: !!r.ja_aceita, contrato });
      }

      const tipo = corpo ? String(corpo.tipo || "") : "";
      if (tipo !== "aberta" && tipo !== "leitura") return json({ error: "pedido_invalido" }, 400);
      const sessao = corpo && typeof corpo.sessao === "string" ? corpo.sessao.slice(0, 64) : "";
      if (sessao.length < 8) return json({ error: "pedido_invalido" }, 400);
      const { data, error } = await db.rpc("proposta_publica_evento", {
        p_token: token,
        p_tipo: tipo,
        p_sessao: sessao,
        p_segundos: Math.max(0, Math.min(14400, Math.round(Number(corpo && corpo.segundos) || 0))),
        p_ip: ipDe(req),
        p_user_agent: navegadorDe(req),
      });
      if (error) {
        registrarFalha("proposta-publica: rastreio falhou", error);
        return json({ error: "indisponivel" }, 503);
      }
      return json(data || { ok: false });
    }

    return json({ error: "metodo_nao_permitido" }, 405);
  } catch (e) {
    registrarFalha("proposta-publica: erro inesperado", e);
    return json({ error: "indisponivel" }, 500);
  }
});
