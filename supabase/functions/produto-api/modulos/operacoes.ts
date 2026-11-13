/**
 * O que a API do CRM da empresa sabe fazer (13/11/2026). As mesmas operações
 * servem a API REST e a porta MCP (Claude, ChatGPT): um lugar só para a regra.
 *
 * Tudo roda com a chave de serviço, então CADA leitura e CADA escrita leva o
 * conta_id da chave que chamou. Nada aqui aceita conta_id vindo de fora.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface Contexto {
  contaId: string;
  /** Quem criou a chave: fica como autor do que a API grava. */
  autor: string | null;
  /** Nomes que a empresa deu às etapas (o resto usa o nome padrão). */
  etapas: Record<string, string>;
}

export class ErroDaApi extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

export const ETAPAS = ["novo", "contato", "diagnostico", "proposta", "negociacao", "ganho", "perdido"] as const;
const NOME_PADRAO: Record<string, string> = { novo: "Novo", contato: "Em contato", diagnostico: "Diagnóstico", proposta: "Proposta", negociacao: "Negociação", ganho: "Ganho", perdido: "Perdido" };
const ORIGENS = ["indicacao", "instagram", "quiz", "prospeccao", "evento", "site", "manual", "maquina_de_leads", "checkout"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUNAS = "id, name, company, email, whatsapp, origin, stage, monthly_value, one_off_value, owner_id, next_action, notes, lost_reason, expected_close_date, closed_at, created_at, updated_at";

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const dinheiro = (v: unknown) => {
  const n = typeof v === "string" ? Number(v.replace(/\./g, "").replace(",", ".")) : Number(v);
  return isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
};
const idValido = (v: unknown) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ErroDaApi(400, "id_invalido", "O id informado não é válido.");
  return v;
};

/** Aceita o id da etapa ("proposta") ou o nome dela, o padrão ou o que a empresa deu ("Visita"). */
export function etapaDe(v: unknown, proprias: Record<string, string>): string | null {
  const t = texto(v, 40).toLowerCase();
  if (!t) return null;
  for (const id of ETAPAS) {
    if (t === id || t === NOME_PADRAO[id].toLowerCase() || (proprias[id] && t === proprias[id].toLowerCase())) return id;
  }
  return null;
}

const nomeDaEtapa = (id: string, proprias: Record<string, string>) => proprias[id] || NOME_PADRAO[id] || id;

/** O negócio como a API devolve: nomes em português e a etapa com o nome que a empresa usa. */
export function negocioParaFora(l: Record<string, unknown>, proprias: Record<string, string>) {
  return {
    id: l.id,
    nome: l.name,
    empresa: l.company || null,
    email: l.email || null,
    whatsapp: l.whatsapp || null,
    origem: l.origin,
    etapa: l.stage,
    etapa_nome: nomeDaEtapa(String(l.stage), proprias),
    valor_mensal: Number(l.monthly_value) || 0,
    valor_entrada: Number(l.one_off_value) || 0,
    proximo_passo: l.next_action || null,
    notas: l.notes || null,
    motivo_da_perda: l.lost_reason || null,
    previsao: l.expected_close_date || null,
    fechado_em: l.closed_at || null,
    criado_em: l.created_at,
    atualizado_em: l.updated_at,
  };
}

/** Os campos que vieram de fora, já no nome da coluna. Só entra o que foi enviado. */
export function camposDoNegocio(d: Record<string, unknown>): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if ("nome" in d) c.name = texto(d.nome, 200);
  if ("empresa" in d) c.company = texto(d.empresa, 200) || null;
  if ("email" in d) c.email = texto(d.email, 254).toLowerCase() || null;
  if ("whatsapp" in d || "telefone" in d) c.whatsapp = texto(d.whatsapp || d.telefone, 30) || null;
  if ("origem" in d) c.origin = ORIGENS.indexOf(texto(d.origem, 30)) >= 0 ? texto(d.origem, 30) : "site";
  if ("valor_mensal" in d) c.monthly_value = dinheiro(d.valor_mensal) ?? 0;
  if ("valor_entrada" in d) c.one_off_value = dinheiro(d.valor_entrada) ?? 0;
  if ("proximo_passo" in d) c.next_action = texto(d.proximo_passo, 300) || null;
  if ("notas" in d) c.notes = texto(d.notas, 4000) || null;
  if ("previsao" in d) c.expected_close_date = /^\d{4}-\d{2}-\d{2}$/.test(texto(d.previsao, 10)) ? texto(d.previsao, 10) : null;
  return c;
}

export function criarOperacoes(db: SupabaseClient, ctx: Contexto) {
  const falha = (e: { message?: string } | null, oQue: string) => {
    if (e && e.message) console.error("[produto-api]", oQue, e.message.slice(0, 160));
    return new ErroDaApi(500, "banco", `Não foi possível ${oQue} agora.`);
  };

  async function lerNegocioBruto(id: string) {
    const { data, error } = await db.from("crm_leads").select(COLUNAS).eq("conta_id", ctx.contaId).eq("id", idValido(id)).is("archived_at", null).maybeSingle();
    if (error) throw falha(error, "ler o negócio");
    if (!data) throw new ErroDaApi(404, "negocio_inexistente", "Esse negócio não existe nesta empresa.");
    return data as Record<string, unknown>;
  }

  async function responsavelPorEmail(email: unknown): Promise<string | null | undefined> {
    const e = texto(email, 254).toLowerCase();
    if (!e) return undefined;
    const { data } = await db.from("produto_membros").select("user_id").eq("conta_id", ctx.contaId).eq("email", e).eq("estado", "ativo").maybeSingle();
    const id = (data as { user_id?: string } | null)?.user_id;
    if (!id) throw new ErroDaApi(400, "responsavel_inexistente", "Não há ninguém ativo na equipe com esse e-mail.");
    return id;
  }

  return {
    async eu() {
      const [{ data: conta }, { count }] = await Promise.all([
        db.from("produto_contas").select("nome, plano_id, estado").eq("id", ctx.contaId).maybeSingle(),
        db.from("crm_leads").select("id", { count: "exact", head: true }).eq("conta_id", ctx.contaId).is("archived_at", null),
      ]);
      const c = (conta || {}) as { nome?: string; plano_id?: string; estado?: string };
      return { empresa: c.nome || "", plano: c.plano_id || "", situacao: c.estado || "", negocios: count || 0, etapas: ETAPAS.map((id) => ({ id, nome: nomeDaEtapa(id, ctx.etapas) })) };
    },

    async listarNegocios(p: Record<string, unknown>) {
      const limite = Math.max(1, Math.min(100, Math.floor(Number(p.limite) || 25)));
      const pagina = Math.max(1, Math.floor(Number(p.pagina) || 1));
      let q = db.from("crm_leads").select(COLUNAS, { count: "exact" }).eq("conta_id", ctx.contaId).is("archived_at", null);
      if (p.etapa) {
        const etapa = etapaDe(p.etapa, ctx.etapas);
        if (!etapa) throw new ErroDaApi(400, "etapa_invalida", `Etapa desconhecida. Use uma de: ${ETAPAS.join(", ")}.`);
        q = q.eq("stage", etapa);
      } else if (p.abertos === true || p.abertos === "true") q = q.not("stage", "in", "(ganho,perdido)");
      const busca = texto(p.busca, 80).replace(/[%,()]/g, " ").trim();
      if (busca) q = q.or(`name.ilike.%${busca}%,company.ilike.%${busca}%,email.ilike.%${busca}%`);
      const { data, error, count } = await q.order("updated_at", { ascending: false }).range((pagina - 1) * limite, pagina * limite - 1);
      if (error) throw falha(error, "listar os negócios");
      return { total: count || 0, pagina, limite, negocios: ((data || []) as Array<Record<string, unknown>>).map((l) => negocioParaFora(l, ctx.etapas)) };
    },

    async lerNegocio(p: Record<string, unknown>) {
      const l = await lerNegocioBruto(String(p.id || ""));
      const { data: historia } = await db.from("crm_lead_events").select("kind, from_stage, to_stage, note, created_at").eq("conta_id", ctx.contaId).eq("lead_id", String(l.id)).order("created_at", { ascending: false }).limit(20);
      return { negocio: negocioParaFora(l, ctx.etapas), historia: historia || [] };
    },

    async criarNegocio(p: Record<string, unknown>) {
      const campos = camposDoNegocio(p);
      if (!campos.name || String(campos.name).length < 2) throw new ErroDaApi(400, "sem_nome", "Informe o nome da pessoa ou da empresa (campo nome).");
      const etapa = p.etapa ? etapaDe(p.etapa, ctx.etapas) : "novo";
      if (!etapa) throw new ErroDaApi(400, "etapa_invalida", `Etapa desconhecida. Use uma de: ${ETAPAS.join(", ")}.`);
      const dono = await responsavelPorEmail(p.responsavel_email);
      // O mesmo e-mail ou WhatsApp já em aberto: devolve o que existe em vez de duplicar (formulário enviado duas vezes).
      const chaves = [campos.email ? `email.eq.${campos.email}` : "", campos.whatsapp ? `whatsapp.eq.${String(campos.whatsapp).replace(/[,()]/g, "")}` : ""].filter(Boolean);
      if (chaves.length && p.permitir_repetido !== true) {
        const { data: ja } = await db.from("crm_leads").select(COLUNAS).eq("conta_id", ctx.contaId).is("archived_at", null).not("stage", "in", "(ganho,perdido)").or(chaves.join(",")).limit(1);
        if (ja && ja.length) return { negocio: negocioParaFora(ja[0] as Record<string, unknown>, ctx.etapas), repetido: true };
      }
      const fechou = etapa === "ganho" || etapa === "perdido";
      const { data, error } = await db.from("crm_leads").insert({
        origin: "site", ...campos, stage: etapa, closed_at: fechou ? new Date().toISOString() : null,
        owner_id: dono === undefined ? null : dono, created_by: ctx.autor, conta_id: ctx.contaId,
      }).select(COLUNAS).single();
      if (error || !data) throw falha(error, "criar o negócio");
      await db.from("crm_lead_events").insert({ conta_id: ctx.contaId, lead_id: (data as { id: string }).id, kind: "nota", note: "Entrou pela API.", created_by: ctx.autor });
      return { negocio: negocioParaFora(data as Record<string, unknown>, ctx.etapas), repetido: false };
    },

    async atualizarNegocio(p: Record<string, unknown>) {
      const atual = await lerNegocioBruto(String(p.id || ""));
      const campos = camposDoNegocio(p);
      if ("name" in campos && String(campos.name).length < 2) delete campos.name;
      const dono = await responsavelPorEmail(p.responsavel_email);
      if (dono !== undefined) campos.owner_id = dono;
      let etapa: string | null = null;
      if (p.etapa) {
        etapa = etapaDe(p.etapa, ctx.etapas);
        if (!etapa) throw new ErroDaApi(400, "etapa_invalida", `Etapa desconhecida. Use uma de: ${ETAPAS.join(", ")}.`);
        if (etapa === "perdido" && !texto(p.motivo, 300) && atual.stage !== "perdido") throw new ErroDaApi(400, "sem_motivo", "Para marcar como perdido, informe o motivo (campo motivo).");
      }
      const mudouDeEtapa = !!etapa && etapa !== atual.stage;
      if (mudouDeEtapa) {
        const fechou = etapa === "ganho" || etapa === "perdido";
        campos.stage = etapa;
        campos.closed_at = fechou ? new Date().toISOString() : null;
        campos.lost_reason = etapa === "perdido" ? texto(p.motivo, 300) : null;
      }
      if (!Object.keys(campos).length) return { negocio: negocioParaFora(atual, ctx.etapas), mudou: false };
      const { data, error } = await db.from("crm_leads").update(campos).eq("conta_id", ctx.contaId).eq("id", String(atual.id)).select(COLUNAS).single();
      if (error || !data) throw falha(error, "atualizar o negócio");
      if (mudouDeEtapa) {
        await db.from("crm_lead_events").insert({ conta_id: ctx.contaId, lead_id: String(atual.id), kind: "stage", from_stage: atual.stage, to_stage: etapa, note: texto(p.motivo, 300) || null, created_by: ctx.autor });
      }
      return { negocio: negocioParaFora(data as Record<string, unknown>, ctx.etapas), mudou: true };
    },

    async anotar(p: Record<string, unknown>) {
      const l = await lerNegocioBruto(String(p.id || ""));
      const nota = texto(p.texto, 2000);
      if (nota.length < 2) throw new ErroDaApi(400, "sem_texto", "Escreva a anotação (campo texto).");
      const { error } = await db.from("crm_lead_events").insert({ conta_id: ctx.contaId, lead_id: String(l.id), kind: "nota", note: nota, created_by: ctx.autor });
      if (error) throw falha(error, "anotar");
      return { ok: true };
    },

    async listarEmpresas(p: Record<string, unknown>) {
      const limite = Math.max(1, Math.min(100, Math.floor(Number(p.limite) || 50)));
      let q = db.from("crm_organizations").select("id, name, segment, city, website, instagram, phone, cnpj, created_at").eq("conta_id", ctx.contaId).is("archived_at", null);
      const busca = texto(p.busca, 80).replace(/[%,()]/g, " ").trim();
      if (busca) q = q.ilike("name", `%${busca}%`);
      const { data, error } = await q.order("name", { ascending: true }).limit(limite);
      if (error) throw falha(error, "listar as empresas");
      return { empresas: ((data || []) as Array<Record<string, unknown>>).map((o) => ({ id: o.id, nome: o.name, segmento: o.segment || null, cidade: o.city || null, site: o.website || null, instagram: o.instagram || null, telefone: o.phone || null, cnpj: o.cnpj || null })) };
    },

    async listarCompromissos(p: Record<string, unknown>) {
      const limite = Math.max(1, Math.min(100, Math.floor(Number(p.limite) || 30)));
      let q = db.from("crm_activities").select("id, lead_id, kind, title, notes, due_at, done_at").eq("conta_id", ctx.contaId);
      if (p.todos !== true && p.todos !== "true") q = q.is("done_at", null);
      if (p.negocio_id) q = q.eq("lead_id", idValido(p.negocio_id));
      const { data, error } = await q.order("due_at", { ascending: true }).limit(limite);
      if (error) throw falha(error, "listar os compromissos");
      return { compromissos: ((data || []) as Array<Record<string, unknown>>).map((a) => ({ id: a.id, negocio_id: a.lead_id, tipo: a.kind, titulo: a.title, notas: a.notes || null, quando: a.due_at, feito_em: a.done_at || null })) };
    },

    async criarCompromisso(p: Record<string, unknown>) {
      const l = await lerNegocioBruto(String(p.negocio_id || ""));
      const titulo = texto(p.titulo, 200);
      if (titulo.length < 2) throw new ErroDaApi(400, "sem_titulo", "Diga o que é o compromisso (campo titulo).");
      const quando = new Date(texto(p.quando, 40));
      if (isNaN(quando.getTime())) throw new ErroDaApi(400, "quando_invalido", "Informe a data e a hora em ISO 8601 (campo quando), por exemplo 2026-11-20T14:00:00-03:00.");
      const { data, error } = await db.from("crm_activities").insert({
        conta_id: ctx.contaId, lead_id: String(l.id), kind: texto(p.tipo, 30) || "tarefa", title: titulo, notes: texto(p.notas, 2000) || null,
        due_at: quando.toISOString(), owner_id: (l.owner_id as string) || null, created_by: ctx.autor,
      }).select("id, due_at").single();
      if (error || !data) throw falha(error, "criar o compromisso");
      return { id: (data as { id: string }).id, quando: (data as { due_at: string }).due_at };
    },

    async concluirCompromisso(p: Record<string, unknown>) {
      const { data, error } = await db.from("crm_activities").update({ done_at: new Date().toISOString() }).eq("conta_id", ctx.contaId).eq("id", idValido(p.id)).is("done_at", null).select("id");
      if (error) throw falha(error, "concluir o compromisso");
      if (!data || !data.length) throw new ErroDaApi(404, "compromisso_inexistente", "Esse compromisso não existe ou já foi concluído.");
      return { ok: true };
    },

    async resumoDoFunil() {
      const { data, error } = await db.from("crm_leads").select("stage, monthly_value, one_off_value").eq("conta_id", ctx.contaId).is("archived_at", null).limit(5000);
      if (error) throw falha(error, "ler o funil");
      const linhas = (data || []) as Array<{ stage: string; monthly_value: number; one_off_value: number }>;
      const valor = (l: { monthly_value: number; one_off_value: number }) => (Number(l.monthly_value) || 0) * 12 + (Number(l.one_off_value) || 0);
      return {
        etapas: ETAPAS.map((id) => {
          const da = linhas.filter((l) => l.stage === id);
          return { etapa: id, nome: nomeDaEtapa(id, ctx.etapas), negocios: da.length, valor_em_12_meses: Math.round(da.reduce((s, l) => s + valor(l), 0) * 100) / 100 };
        }),
        abertos: linhas.filter((l) => l.stage !== "ganho" && l.stage !== "perdido").length,
      };
    },
  };
}

export type Operacoes = ReturnType<typeof criarOperacoes>;
