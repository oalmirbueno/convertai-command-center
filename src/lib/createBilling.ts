import { supabase } from "@/integrations/supabase/client";
import { notifyUser } from "@/lib/notifyHelpers";

export interface BillingDraft {
  client_id: string;
  type: string;
  amount: string;
  due_date: string;
  description: string;
}

/** Persiste antes de avisar. Erro de notificacao nao desfaz uma cobranca criada. */
export async function createBilling(draft: BillingDraft): Promise<{ notificationFailed: boolean }> {
  if (!draft.client_id || !draft.amount || !draft.due_date) {
    throw new Error("Preencha todos os campos");
  }
  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Informe um valor maior que zero");
  }
  const { data, error } = await supabase.from("billing").insert({
    client_id: draft.client_id,
    type: draft.type,
    amount,
    due_date: draft.due_date,
    description: draft.description.trim() || null,
  }).select("id").single();
  if (error || !data?.id) {
    throw new Error("Não foi possível confirmar a criação da cobrança. Seus dados foram mantidos; confira a lista antes de tentar novamente.");
  }

  try {
    const formatted = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
    await notifyUser(draft.client_id, `Nova cobrança de ${formatted} registrada`, "billing", "/financeiro");
    return { notificationFailed: false };
  } catch {
    return { notificationFailed: true };
  }
}
