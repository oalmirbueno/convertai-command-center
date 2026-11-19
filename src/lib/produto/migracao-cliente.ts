import { supabase } from "@/integrations/supabase/client";
import { ErroDoProduto } from "./api";

/**
 * A migração feita pelo próprio cliente (19/11/2026): a tela fala com a função produto-migracao.
 * A senha do e-mail antigo vai direto para o servidor (que guarda no cofre) e nunca volta.
 */

export interface ProvedorDaMigracao {
  id: string;
  nome: string;
  senha_de_app: { onde: string; passos: string[] } | null;
}

export interface MigracaoDoCliente {
  id: string;
  caixa_id: string;
  provedor_origem: string;
  origem_usuario: string;
  estado: "copiando" | "concluida" | "erro" | "pausada" | "cancelada";
  total: number;
  copiadas: number;
  puladas: number;
  erros: number;
  mensagem: string | null;
  criado_em: string;
  atualizado_em: string;
  concluida_em: string | null;
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("produto-migracao", { body: corpo });
  if (error) {
    let resposta: { error?: string; mensagem?: string } | null = null;
    try {
      const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context;
      resposta = ctx && typeof ctx.clone === "function" ? ((await ctx.clone().json()) as { error?: string; mensagem?: string }) : null;
    } catch {
      resposta = null;
    }
    throw new ErroDoProduto(String((resposta && resposta.error) || "erro"), (resposta && resposta.mensagem) || "Não foi possível falar com o servidor agora.");
  }
  return data as T;
}

export const migracaoDoCliente = {
  provedores: () => chamar<{ provedores: ProvedorDaMigracao[] }>({ acao: "provedores" }).then((r) => r.provedores),
  estado: (caixaId: string) => chamar<{ migracao: MigracaoDoCliente | null }>({ acao: "estado", caixa_id: caixaId }).then((r) => r.migracao),
  iniciar: (p: { caixa_id: string; provedor: string; usuario: string; senha: string; host?: string; senha_destino?: string }) => chamar<{ migracao: MigracaoDoCliente }>({ acao: "iniciar", ...p }).then((r) => r.migracao),
  pausar: (id: string) => chamar<{ migracao: MigracaoDoCliente }>({ acao: "pausar", migracao_id: id }).then((r) => r.migracao),
  continuar: (id: string) => chamar<{ migracao: MigracaoDoCliente }>({ acao: "continuar", migracao_id: id }).then((r) => r.migracao),
  cancelar: (id: string) => chamar<{ migracao: MigracaoDoCliente }>({ acao: "cancelar", migracao_id: id }).then((r) => r.migracao),
};

/** A porcentagem que a barra mostra (copiadas e já existentes contam; nunca passa de 100). */
export function porcentagem(m: Pick<MigracaoDoCliente, "total" | "copiadas" | "puladas" | "estado">): number {
  if (m.estado === "concluida") return 100;
  if (!m.total) return 0;
  return Math.max(0, Math.min(99, Math.round(((m.copiadas + m.puladas) / m.total) * 100)));
}
