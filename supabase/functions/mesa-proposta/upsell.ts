/**
 * Retrato do cliente para a proposta de upsell (frente PRO3, 30/09): lê do
 * banco o que ele já tem (serviços do cadastro e o plano do Financeiro) e os
 * resultados reais (lerEstadoReal, com o cliente do Supabase de quem pediu:
 * a RLS decide). O formato e as regras moram em _shared/proposta-upsell.ts.
 *
 * Fonte que falha não derruba a proposta: vira aviso no retrato e vai para o
 * log (registrarFalha). Nada é inventado: sem base, a linha não existe.
 */
import { lerEstadoReal, type BancoDoEstado } from "../_shared/estado-real-do-cliente.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { montarUpsell, resultadosDoEstado, servicosDoCadastro, type PlanoAtual, type UpsellDaProposta } from "../_shared/proposta-upsell.ts";

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any };

const DIA = 86_400_000;

/** Plano atual: o termo vigente do Financeiro v2 (ativo e sem fim ganha); sem termo, o plano do cadastro. */
export async function planoDoCliente(db: Banco, clientId: string, perfil: { plan_name?: string | null; plan_value?: number | string | null } | null, avisos: string[]): Promise<PlanoAtual | null> {
  try {
    const { data, error } = await db
      .from("financial_client_terms")
      .select("status, final_amount, operational_amount, billing_period, starts_on, ends_on, plan_version_id, financial_plan_versions(plan_id, financial_plans(name))")
      .eq("client_id", clientId)
      .in("status", ["active", "paused"])
      .order("starts_on", { ascending: false })
      .limit(5);
    if (error) throw error;
    const termos = (Array.isArray(data) ? data : []) as Array<Record<string, any>>;
    const nota = (t: Record<string, any>) => (t.status === "active" ? 2 : 0) + (t.ends_on ? 0 : 1);
    const termo = termos.slice().sort((a, b) => nota(b) - nota(a))[0];
    if (termo) {
      const versao = termo.financial_plan_versions || null;
      const plano = versao && versao.financial_plans ? versao.financial_plans : null;
      const nome = (plano && plano.name) || (perfil && perfil.plan_name) || "Plano personalizado";
      const valor = Number(termo.final_amount) || Number(termo.operational_amount) || null;
      return { nome: String(nome), valor, periodo: termo.billing_period || "monthly", desde: termo.starts_on ? String(termo.starts_on).slice(0, 10) : null, origem: "financeiro" };
    }
  } catch (e) {
    avisos.push("O plano do Financeiro não foi lido agora.");
    registrarFalha("mesa-proposta: plano do Financeiro não lido para o upsell", e, { client_id: clientId });
  }
  if (perfil && perfil.plan_name) {
    const v = Number(perfil.plan_value);
    return { nome: String(perfil.plan_name), valor: v > 0 ? v : null, periodo: "monthly", desde: null, origem: "cadastro" };
  }
  return null;
}

/**
 * O retrato inteiro. `dbDoChamador` lê os resultados com a RLS de quem pediu;
 * `dbServico` lê cadastro e Financeiro (o acesso ao cliente já foi conferido).
 */
export async function retratoDoCliente(dbServico: Banco, dbDoChamador: BancoDoEstado, clientId: string, cliente: string, agora: Date = new Date()): Promise<UpsellDaProposta> {
  const avisos: string[] = [];
  const { data: perfil, error: erroPerfil } = await dbServico.from("profiles").select("services_config, plan_name, plan_value").eq("id", clientId).maybeSingle();
  if (erroPerfil) {
    avisos.push("O cadastro do cliente não foi lido agora.");
    registrarFalha("mesa-proposta: cadastro não lido para o upsell", erroPerfil, { client_id: clientId });
  }
  const p = (perfil || null) as { services_config?: unknown; plan_name?: string | null; plan_value?: number | null } | null;
  const desde = new Date(agora.getTime() - 30 * DIA).toISOString();
  const [plano, estado] = await Promise.all([
    planoDoCliente(dbServico, clientId, p, avisos),
    lerEstadoReal(dbDoChamador, clientId, { agora, desde }).catch((e) => {
      avisos.push("Os resultados do painel não foram lidos agora.");
      registrarFalha("mesa-proposta: resultados não lidos para o upsell", e, { client_id: clientId });
      return null;
    }),
  ]);
  if (estado && estado.avisos.length) registrarFalha("mesa-proposta: fontes do estado real com aviso no upsell", new Error(estado.avisos.slice(0, 5).join(" | ")), { client_id: clientId });
  return montarUpsell({ cliente, servicos: servicosDoCadastro(p ? p.services_config : null), plano, resultados: resultadosDoEstado(estado), avisos, lidoEm: agora.toISOString() });
}
