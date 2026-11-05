import { supabase } from "@/integrations/supabase/client";
import { generatePassword } from "@/components/admin/CreateClientModal";
import type { FechamentoDoGanho, Lead } from "@/lib/comercial";
import { APP_PUBLIC_URL as PORTAL_URL } from "@/lib/publicUrl";
import { fireWebhook, webhooks } from "@/lib/webhooks";

export type TipoDoCliente = "recurring" | "one_off" | "hybrid";

export interface DadosDoCadastroNoGanho {
  lead: Pick<Lead, "id">;
  /** Cliente que já existe, escolhido na janela. Sem ele, a conta é achada pelo e-mail ou criada. */
  clienteExistente?: string | null;
  tipo: TipoDoCliente;
  mensalidade: number;
  valorDoProjeto: number;
  nome: string;
  empresa: string;
  email: string;
  whatsapp: string;
  marca?: string | null;
  planoNome?: string | null;
  servicos?: Record<string, boolean> | null;
  fechamento: FechamentoDoGanho;
  proximaParcela?: string | null;
  mensalidadeVencimento: string | null;
  mensalidadePaga: boolean;
}

export interface ResultadoDoCadastroNoGanho {
  clientId: string;
  /** Nasceu uma conta agora. Só ela recebe convite sozinha. */
  contaNova: boolean;
  /** O cliente já tinha plano ou cobrança: só ganhou o vínculo, nada entrou no Financeiro. */
  vinculado: boolean;
  /** Link de primeiro acesso, para mandar no grupo. */
  linkDoConvite: string | null;
  conviteEnviado: boolean;
}

/**
 * 05/11/2026 (dono: "cliente criado, e me dá o link para mandar no grupo; idêntico ao cadastro normal, só que direto do
 * CRM"). Os mesmos passos do Novo cliente, na mesma ordem: conta pelo manage-team, primeiro acesso e e-mail de boas-vindas.
 * Perfil, cobranças e a passagem do lead são uma transação só no banco. Repetir depois de uma falha retoma: a conta já
 * existe, o banco completa o que faltou e não duplica.
 */
export async function cadastrarNoGanho(d: DadosDoCadastroNoGanho): Promise<ResultadoDoCadastroNoGanho> {
  const email = d.email.trim().toLowerCase();
  const nome = d.nome.trim();
  const empresa = d.empresa.trim();

  let clientId = d.clienteExistente || "";
  if (!clientId) {
    const padrao = email.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data: existente, error: erroDaBusca } = await supabase.from("profiles").select("id").ilike("email", padrao).maybeSingle();
    if (erroDaBusca) throw new Error(erroDaBusca.message);
    clientId = (existente as { id?: string } | null)?.id || "";
  }
  const contaNova = !clientId;
  if (contaNova) {
    const { data: criado, error } = await supabase.functions.invoke("manage-team", {
      body: { action: "create", email, full_name: nome, role: "client", password: generatePassword() },
    });
    const resposta = (criado || {}) as { error?: unknown; user_id?: unknown };
    if (error || resposta.error) throw new Error(typeof resposta.error === "string" ? resposta.error : "Não consegui criar a conta do cliente.");
    clientId = typeof resposta.user_id === "string" ? resposta.user_id : "";
    if (!clientId) throw new Error("A conta foi criada sem um identificador válido.");
  }

  const { data, error } = await (supabase.rpc as never as (nome: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)("crm_ganho_cadastrar", {
    p_lead_id: d.lead.id,
    p_client_id: clientId,
    p_tipo: d.tipo,
    p_mensalidade: d.mensalidade,
    p_valor_projeto: d.valorDoProjeto,
    p_empresa: empresa,
    p_email: email,
    p_whatsapp: d.whatsapp.trim(),
    p_marca: d.marca || null,
    p_plano_nome: d.planoNome || null,
    p_servicos: d.servicos || null,
    p_entrada_recebida: d.fechamento.entrada_recebida ?? null,
    p_entrada_parcelas: d.fechamento.entrada_parcelas ?? null,
    p_proxima_parcela: d.proximaParcela || null,
    p_mensalidade_inicio: d.fechamento.mensalidade_inicio ?? null,
    p_mensalidade_vencimento: d.mensalidadeVencimento,
    p_mensalidade_paga: d.mensalidadePaga,
  });
  if (error) throw new Error(error.message);
  const vinculado = !!(data as { vinculado?: boolean } | null)?.vinculado;

  let linkDoConvite: string | null = null;
  let conviteEnviado = false;
  if (contaNova) {
    // Falha no convite não desfaz o ganho: a tela oferece reenviar e copiar o link.
    const { data: emissao, error: erroDaEmissao } = await supabase.rpc("issue_first_access_token", { p_profile_id: clientId });
    const token = (Array.isArray(emissao) ? emissao[0] : emissao as { token?: string } | null)?.token;
    if (!erroDaEmissao && typeof token === "string") {
      linkDoConvite = `${PORTAL_URL}/primeiro-acesso?token=${token}`;
      const { data: envio, error: erroDoEnvio } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "client-welcome",
          recipientEmail: email,
          idempotencyKey: `client-welcome-${clientId}`,
          templateData: { name: nome, company: empresa, email, firstAccessUrl: linkDoConvite },
        },
      });
      conviteEnviado = !erroDoEnvio && !(envio as { error?: unknown } | null)?.error;
    }
    void fireWebhook(webhooks.onboardClient, { client_id: clientId, name: nome, email, company: empresa, phone: d.whatsapp.trim(), services: d.servicos || {}, send_welcome_email: true });
  }
  return { clientId, contaNova, vinculado, linkDoConvite, conviteEnviado };
}

/** Convite de novo, pelo mesmo caminho da tela de Novo cliente. */
export async function reenviarConviteDoGanho(clientId: string, email: string, nome: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("admin-reset-client-access", {
    body: { profile_id: clientId, new_email: email.trim().toLowerCase(), new_full_name: nome.trim() },
  });
  const r = (data || {}) as { error?: unknown; firstAccessUrl?: unknown };
  if (error || r.error) throw new Error("Ainda não foi possível enviar. Copie o link e mande direto ao cliente.");
  return typeof r.firstAccessUrl === "string" ? r.firstAccessUrl : null;
}
