/**
 * Visão geral da carteira e regras que o dono ensinou ao Gestor (09/10/2026).
 *
 * Caso de origem (conversa real de 09/10): "me atualize todos os clientes" ficou preso na Casa dos
 * Assados (continuidade), o Gestor pediu para "mudar o recorte" e listou clientes que "precisaria
 * consultar"; na conversa geral a ficha só trazia o que mudou na semana. E as correções do dono
 * ("Ajenda não é mais cliente", "os ativos são os mensalistas") se perdiam na conversa seguinte.
 *
 * - pedeCarteira: o pedido é da carteira toda (todos, ativos, geral, demais...).
 * - lerCarteira: o painel calculado pelo código, um cliente por fonte (K1..Kn), para os
 *   mensalistas ativos do cadastro (plan_status active, recorrente ou híbrido, fora a agência):
 *   tarefas abertas por estado, atrasadas, aprovações pendentes, publicações e entregas no período.
 * - regras do dono: o que ele ensinou fica em gestor_regras_do_dono e vale em toda conversa.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Fonte } from "./ficha.ts";

const semAcento = (t: string) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O pedido é sobre a carteira toda (e não sobre o cliente tratado até aqui). */
export function pedeCarteira(pergunta: string): boolean {
  const t = semAcento(pergunta);
  return /\b(todos|todas|ativos|ativas|carteira|geral|panorama|demais|os outros|outros clientes|cada cliente|todo mundo|operacao (toda|completa|inteira)|visao geral|resumo geral|mensalistas)\b/.test(t);
}

type ClienteDaCarteira = { id: string; nome: string; plano: string | null; valor: number | null; tipo: string };

const ROTULO_DO_TIPO: Record<string, string> = { recurring: "mensalista", hybrid: "mensalista com projetos" };

/** Os mensalistas ativos do cadastro (sem a empresa interna da agência). */
export async function clientesAtivos(db: SupabaseClient): Promise<ClienteDaCarteira[]> {
  const { data: papeis } = await db.from("user_roles").select("user_id").eq("role", "client");
  const ids = ((papeis as { user_id: string }[] | null) || []).map((r) => r.user_id);
  if (!ids.length) return [];
  const { data } = await db.from("profiles").select("id, company_name, full_name, plan_status, client_type, plan_name, plan_value, services_config").in("id", ids).is("deleted_at", null);
  return ((data || []) as Array<Record<string, unknown>>)
    .filter((p) => p.plan_status === "active" && (p.client_type === "recurring" || p.client_type === "hybrid"))
    // A agência não é cliente dela mesma. Jalimpo também é empresa do dono (internal_company) e é tratada como cliente.
    .filter((p) => !(String(((p.services_config as Record<string, unknown> | null) || {}).internal_company || "") === "true" && /aceleriq/i.test(String(p.company_name || p.full_name || ""))))
    .map((p) => ({ id: String(p.id), nome: String(p.company_name || p.full_name || "Cliente").trim(), plano: p.plan_name ? String(p.plan_name) : null, valor: p.plan_value != null ? Number(p.plan_value) : null, tipo: String(p.client_type) }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/** O painel da carteira: uma fonte por mensalista ativo, calculada pelo código. Nunca lança. */
export async function lerCarteira(db: SupabaseClient, periodo: { desde: string; ate: string; rotulo: string }): Promise<Fonte[]> {
  try {
    const clientes = await clientesAtivos(db);
    if (!clientes.length) return [];
    const ids = clientes.map((c) => c.id);
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: projetos } = await db.from("projects").select("id, client_id").in("client_id", ids).limit(2000);
    const donoDoProjeto = new Map(((projetos || []) as Array<{ id: string; client_id: string }>).map((p) => [p.id, p.client_id]));
    const idsDeProjeto = [...donoDoProjeto.keys()];
    const [tarefas, aprovacoes, publicacoes, entregas] = await Promise.all([
      idsDeProjeto.length ? db.from("tasks").select("id, status, due_date, project_id").in("project_id", idsDeProjeto).is("deleted_at", null).neq("status", "done").limit(5000) : Promise.resolve({ data: [] }),
      db.from("operator_approvals").select("id, client_id").in("client_id", ids).in("status", ["pendente", "adiado"]).limit(1000),
      db.from("editorial_publications").select("id, client_id, status, published_at, scheduled_at").in("client_id", ids).or(`published_at.gte.${periodo.desde},scheduled_at.gte.${periodo.desde}`).limit(2000),
      db.from("operator_deliveries").select("id, client_id").in("client_id", ids).gte("occurred_at", periodo.desde).lt("occurred_at", periodo.ate).limit(2000),
    ]);
    const por = (lista: unknown, campo: string) => {
      const m = new Map<string, Array<Record<string, unknown>>>();
      for (const x of ((lista as { data?: unknown[] }).data || []) as Array<Record<string, unknown>>) {
        const dono = campo === "project_id" ? donoDoProjeto.get(String(x.project_id)) : String(x[campo] || "");
        if (!dono) continue;
        const l = m.get(dono) || [];
        l.push(x);
        m.set(dono, l);
      }
      return m;
    };
    const tPor = por(tarefas, "project_id");
    const aPor = por(aprovacoes, "client_id");
    const pPor = por(publicacoes, "client_id");
    const ePor = por(entregas, "client_id");
    return clientes.map((c, i) => {
      const t = tPor.get(c.id) || [];
      const conta = (s: string) => t.filter((x) => x.status === s).length;
      const atrasadas = t.filter((x) => x.due_date && String(x.due_date).slice(0, 10) < hoje).length;
      const pubs = pPor.get(c.id) || [];
      const publicadas = pubs.filter((x) => x.published_at && String(x.published_at) >= periodo.desde && String(x.published_at) < periodo.ate).length;
      const agendadas = pubs.filter((x) => !x.published_at && x.scheduled_at && String(x.scheduled_at) >= periodo.desde).length;
      const plano = [ROTULO_DO_TIPO[c.tipo] || c.tipo, c.plano, c.valor ? `R$ ${c.valor}` : null].filter(Boolean).join(", ");
      const texto = [
        `${c.nome} (${plano}).`,
        `Tarefas abertas: ${t.length} (a fazer ${conta("todo")}, em andamento ${conta("doing")}, em revisão ${conta("review")}, backlog ${conta("backlog")}); atrasadas: ${atrasadas}.`,
        `Aprovações pendentes do dono: ${(aPor.get(c.id) || []).length}.`,
        `Publicações em ${periodo.rotulo}: ${publicadas} publicadas, ${agendadas} agendadas.`,
        `Entregas registradas em ${periodo.rotulo}: ${(ePor.get(c.id) || []).length}.`,
      ].join(" ");
      return { apelido: `K${i + 1}`, tipo: "leitura", estado: "lido_no_os", titulo: `Painel da carteira: ${c.nome}`, quando: new Date().toISOString(), texto, cliente: c.nome, agente: null, ids: {} } as Fonte;
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- regras que o dono ensinou

export type RegraDoDono = { id: string; texto: string; criado_em: string };

export async function regrasDoDono(db: SupabaseClient, donoId: string): Promise<RegraDoDono[]> {
  const { data } = await db.from("gestor_regras_do_dono").select("id, texto, criado_em").eq("dono_id", donoId).eq("ativa", true).order("criado_em", { ascending: true }).limit(60);
  return (data || []) as RegraDoDono[];
}

export function blocoDasRegras(regras: RegraDoDono[]): string {
  if (!regras.length) return "";
  return `REGRAS QUE O ALMIR JÁ TE ENSINOU (obedeça sempre, sem ele repetir; se duas se contradizem, vale a mais nova):\n${regras.map((r, i) => `${i + 1}. ${r.texto}`).join("\n")}`;
}

/** Guarda a regra nova (sem repetir a mesma). Devolve o texto guardado, ou null. */
export async function guardarRegraDoDono(db: SupabaseClient, donoId: string, bruto: unknown, origem: string): Promise<string | null> {
  const texto = String(bruto || "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (texto.length < 8) return null;
  const atuais = await regrasDoDono(db, donoId);
  if (atuais.some((r) => semAcento(r.texto) === semAcento(texto))) return null;
  const { error } = await db.from("gestor_regras_do_dono").insert({ dono_id: donoId, texto, origem: origem.slice(0, 600) });
  return error ? null : texto;
}
