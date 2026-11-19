import { supabase } from "@/integrations/supabase/client";

/**
 * O E-mail e o CRM do produto vistos do plano do cliente (19/11/2026, pedido do dono: "editar e cadastrar tudo
 * pelo cliente, no plano, sem duplicar"). A casa lê e ajusta a conta do produto ligada ao cliente; o que cada
 * escolha muda na soma do dinheiro:
 *   - "plano":    o cliente paga dentro da mensalidade dele (ou num extra). A conta sai da soma do produto, para
 *                 a mesma mensalidade não ser contada duas vezes.
 *   - "site":     comprou sozinho pelo site e paga no cartão ou Pix (Asaas). Conta na soma do produto, e não no
 *                 plano do cliente.
 *   - "cortesia": ninguém paga; não conta em lugar nenhum.
 */

export type ModoDeCobranca = "plano" | "site" | "cortesia";

export interface ContaDoClienteNoProduto {
  id: string;
  nome: string;
  estado: string;
  crm_ativo: boolean;
  email_ativo: boolean;
  cobranca_por: "plano" | "assinatura";
  extra_id: string | null;
  dominios: Array<{ dominio: string; estado: string }>;
  caixas: number;
}

export const ROTULO_DO_MODO: Record<ModoDeCobranca, { rotulo: string; ajuda: string }> = {
  plano: { rotulo: "No plano do cliente", ajuda: "Já está na mensalidade dele. Não soma de novo no produto." },
  site: { rotulo: "Pago pelo site", ajuda: "Cartão ou Pix pelo Asaas. Soma no produto, não no plano." },
  cortesia: { rotulo: "Cortesia", ajuda: "Ninguém paga. Não soma em lugar nenhum." },
};

export function modoDaConta(c: Pick<ContaDoClienteNoProduto, "estado" | "cobranca_por">): ModoDeCobranca {
  if (c.estado === "cortesia") return "cortesia";
  return c.cobranca_por === "plano" ? "plano" : "site";
}

/** O que gravar na conta para cada escolha. Cortesia guarda o modo de cobrança de antes, para poder voltar. */
export function mudancaDoModo(modo: ModoDeCobranca, atual: Pick<ContaDoClienteNoProduto, "estado" | "cobranca_por">): { estado?: string; cobranca_por?: "plano" | "assinatura" } {
  if (modo === "cortesia") return { estado: "cortesia" };
  const estado = atual.estado === "cortesia" ? "ativa" : undefined;
  return { ...(estado ? { estado } : {}), cobranca_por: modo === "plano" ? "plano" : "assinatura" };
}

export async function lerContaDoCliente(clientId: string): Promise<ContaDoClienteNoProduto | null> {
  const db = supabase as any;
  const { data: c, error } = await db.from("produto_contas").select("id, nome, estado, crm_ativo, email_ativo, cobranca_por, extra_id").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  if (!c) return null;
  const [{ data: doms }, { count }] = await Promise.all([
    db.from("produto_email_dominios").select("dominio, estado").eq("conta_id", c.id),
    db.from("produto_email_caixas").select("id", { count: "exact", head: true }).eq("conta_id", c.id).eq("tipo", "caixa").neq("estado", "removida"),
  ]);
  return {
    id: String(c.id),
    nome: String(c.nome || ""),
    estado: String(c.estado || ""),
    crm_ativo: !!c.crm_ativo,
    email_ativo: !!c.email_ativo,
    cobranca_por: c.cobranca_por === "plano" ? "plano" : "assinatura",
    extra_id: c.extra_id || null,
    dominios: ((doms || []) as Array<{ dominio: string; estado: string }>).map((d) => ({ dominio: String(d.dominio), estado: String(d.estado || "") })),
    caixas: count || 0,
  };
}

export async function mudarModoDaConta(conta: ContaDoClienteNoProduto, modo: ModoDeCobranca): Promise<void> {
  const mudanca = mudancaDoModo(modo, conta);
  const { error } = await (supabase as any).from("produto_contas").update({ ...mudanca, atualizado_em: new Date().toISOString() }).eq("id", conta.id);
  if (error) throw error;
}
