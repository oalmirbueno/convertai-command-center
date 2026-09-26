/**
 * Executor das ações do agente do cliente que a equipe confirmou (frente C):
 * o plano (projeto, marcos, tarefas, contexto, decisões, caminho) e a
 * proposta de kit do brand book importado.
 *
 * Cada item confere de novo no banco o que a proposta diz (o projeto é do
 * cliente, o marco é do projeto, o dono é da equipe) antes de gravar, e
 * devolve o que o Desfazer precisa. Criar volta para a lixeira (deleted_at);
 * nada é apagado de verdade.
 *
 * Os itens do plano correm um de cada vez, na ordem da proposta (projeto,
 * marcos, tarefas): o que acabou de ser criado entra na `memoria` (apelido
 * novo para id real) e o item seguinte usa.
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo com um banco falso.
 */
import type { AcaoDoAgente, ItemDaAcaoDoAgente, ResultadoDoItem } from "../_shared/acoes-do-agente.ts";
import { pastaDoBrandBook } from "../_shared/identidade-visual.ts";

// deno-lint-ignore no-explicit-any
export type ServicoDoPlano = { from: (tabela: string) => any };

export type DependenciasDoExecutor = {
  userId: string;
  /** Grava no cérebro do cliente (gravarNoCerebro); nunca lança. */
  gravarDecisao: (d: { area: string; categoria: string; texto: string }) => Promise<{ id: string | null; situacao: string | null; erro: string | null }>;
  /** Motivo para recusar a imagem como logo (grande demais, não é imagem); null quando pode. */
  conferirLogo?: (caminho: string) => Promise<string | null>;
  agora?: () => string;
};

/** Apelido novo (pn1, mn1...) para o id criado nesta confirmação. */
export type MemoriaDoPlano = Map<string, string>;

export const OPERACOES_DO_KIT = ["kit_paleta", "kit_tipografia", "kit_logo", "kit_estilo", "kit_regras"];
const PAPEIS_DA_EQUIPE = ["admin", "design", "traffic", "manager"];

export function ehOperacaoDoKit(op: string): boolean {
  return OPERACOES_DO_KIT.indexOf(op) >= 0;
}

/** O valor do item guardado na proposta (contexto.dados["operacao:ref"]). */
export function cargaDoItem(acao: Pick<AcaoDoAgente, "contexto">, item: Pick<ItemDaAcaoDoAgente, "operacao" | "ref">): Record<string, unknown> {
  const dados = (acao.contexto && (acao.contexto as Record<string, unknown>).dados) as Record<string, Record<string, unknown>> | undefined;
  const c = dados ? dados[`${item.operacao}:${item.ref}`] : undefined;
  if (!c || typeof c !== "object") throw new Error("A proposta não tem os dados deste item. Peça de novo ao agente.");
  return c;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const agoraIso = (deps: DependenciasDoExecutor) => (deps.agora ? deps.agora() : new Date().toISOString());

async function projetoDoCliente(db: ServicoDoPlano, clientId: string, id: unknown): Promise<{ id: string; start_date: string | null; deadline: string | null }> {
  const s = String(id || "");
  if (!UUID.test(s)) throw new Error("Projeto inválido.");
  const { data, error } = await db.from("projects").select("id, client_id, deleted_at, start_date, deadline").eq("id", s).maybeSingle();
  if (error) throw new Error("Não foi possível ler o projeto.");
  const p = data as { id: string; client_id: string; deleted_at: string | null; start_date: string | null; deadline: string | null } | null;
  if (!p || p.client_id !== clientId || p.deleted_at) throw new Error("Este projeto não está mais com o cliente.");
  return p;
}

/** O projeto de destino: o que já existia (projeto_id) ou o criado nesta confirmação (projeto_novo). */
async function projetoDoItem(db: ServicoDoPlano, clientId: string, carga: Record<string, unknown>, memoria: MemoriaDoPlano): Promise<string> {
  if (carga.projeto_novo) {
    const id = memoria.get(String(carga.projeto_novo));
    if (!id) throw new Error("O projeto novo do plano não foi criado, então este item ficou de fora.");
    return id;
  }
  return (await projetoDoCliente(db, clientId, carga.projeto_id)).id;
}

async function daEquipe(db: ServicoDoPlano, userId: unknown): Promise<boolean> {
  const s = String(userId || "");
  if (!UUID.test(s)) return false;
  const { data } = await db.from("user_roles").select("role").eq("user_id", s);
  return ((data ?? []) as Array<{ role: string }>).some((r) => PAPEIS_DA_EQUIPE.indexOf(r.role) >= 0);
}

type KitBruto = { paleta: unknown; estilo: string | null; regras: string | null; logo_path: string | null; logo_alt_path: string | null; contexto: Record<string, unknown> | null } | null;

async function lerKitBruto(db: ServicoDoPlano, clientId: string): Promise<KitBruto> {
  const { data, error } = await db.from("cliente_kit_marca").select("paleta, estilo, regras, logo_path, logo_alt_path, contexto").eq("client_id", clientId).maybeSingle();
  if (error) throw new Error("Não foi possível ler o kit da marca.");
  return (data as KitBruto) ?? null;
}

async function gravarKit(db: ServicoDoPlano, clientId: string, patch: Record<string, unknown>, deps: DependenciasDoExecutor) {
  const { error } = await db.from("cliente_kit_marca").upsert({ client_id: clientId, ...patch, atualizado_em: agoraIso(deps), atualizado_por: deps.userId }, { onConflict: "client_id" });
  if (error) throw new Error("Não foi possível gravar no kit da marca.");
}

/** Troca uma chave do contexto consolidado (o resto fica como está). */
async function mudarNoContexto(db: ServicoDoPlano, clientId: string, chave: string, valor: unknown, deps: DependenciasDoExecutor): Promise<unknown> {
  const kit = await lerKitBruto(db, clientId);
  const contexto = { ...((kit && kit.contexto && typeof kit.contexto === "object" ? kit.contexto : {}) as Record<string, unknown>) };
  const antes = Object.prototype.hasOwnProperty.call(contexto, chave) ? contexto[chave] : null;
  if (valor === null || valor === undefined) delete contexto[chave];
  else contexto[chave] = valor;
  await gravarKit(db, clientId, { contexto }, deps);
  return antes;
}

/** Uma operação do plano ou do kit, já confirmada. */
export async function executarItemDoPlano(
  db: ServicoDoPlano,
  clientId: string,
  item: ItemDaAcaoDoAgente,
  acao: Pick<AcaoDoAgente, "contexto">,
  memoria: MemoriaDoPlano,
  deps: DependenciasDoExecutor,
): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string }> {
  const carga = cargaDoItem(acao, item);
  switch (item.operacao) {
    case "criar_projeto": {
      const linha = {
        client_id: clientId,
        name: String(carga.name || "").slice(0, 200),
        description: carga.description ?? null,
        project_type: String(carga.project_type || "marketing_digital"),
        status: "active",
        progress: 0,
        start_date: carga.start_date,
        deadline: carga.deadline,
        scope: carga.scope ?? null,
        objectives: carga.objectives ?? null,
        created_by: deps.userId,
      };
      if (!linha.name) throw new Error("Projeto sem nome.");
      const { data, error } = await db.from("projects").insert(linha).select("id").single();
      if (error || !data) throw new Error("Não foi possível criar o projeto.");
      const id = (data as { id: string }).id;
      memoria.set(item.ref, id);
      return { desfazer: { projeto_id: id } };
    }
    case "atualizar_projeto": {
      const p = await projetoDoCliente(db, clientId, carga.projeto_id);
      const campos = (carga.campos ?? {}) as Record<string, unknown>;
      const permitidos = ["objectives", "scope", "description", "deadline"].filter((k) => Object.prototype.hasOwnProperty.call(campos, k));
      if (!permitidos.length) return { aviso: "nada para mudar" };
      const { data: antesRaw } = await db.from("projects").select(permitidos.join(", ")).eq("id", p.id).maybeSingle();
      const patch: Record<string, unknown> = {};
      for (const k of permitidos) patch[k] = campos[k];
      if (patch.deadline && p.start_date && String(patch.deadline) < p.start_date) throw new Error("O prazo novo vem antes do início do projeto.");
      const { error } = await db.from("projects").update(patch).eq("id", p.id).eq("client_id", clientId);
      if (error) throw new Error("Não foi possível atualizar o projeto.");
      return { desfazer: { projeto_id: p.id, antes: antesRaw ?? {} } };
    }
    case "criar_marco": {
      const projetoId = await projetoDoItem(db, clientId, carga, memoria);
      const { data, error } = await db
        .from("milestones")
        .insert({ project_id: projetoId, title: String(carga.title || "").slice(0, 200), description: carga.description ?? null, target_date: carga.target_date, status: "pending", milestone_order: Number(carga.ordem) || null })
        .select("id")
        .single();
      if (error || !data) throw new Error("Não foi possível criar o marco.");
      const id = (data as { id: string }).id;
      memoria.set(item.ref, id);
      return { desfazer: { marco_id: id, projeto_id: projetoId } };
    }
    case "criar_tarefa": {
      const projetoId = await projetoDoItem(db, clientId, carga, memoria);
      let marcoId: string | null = null;
      let aviso: string | undefined;
      if (carga.marco_novo) {
        marcoId = memoria.get(String(carga.marco_novo)) || null;
        if (!marcoId) aviso = "entrou sem marco (o marco novo não foi criado)";
      } else if (carga.marco_id) {
        const { data: m } = await db.from("milestones").select("id, project_id, deleted_at").eq("id", String(carga.marco_id)).maybeSingle();
        const mm = m as { id: string; project_id: string; deleted_at: string | null } | null;
        if (mm && mm.project_id === projetoId && !mm.deleted_at) marcoId = mm.id;
        else aviso = "entrou sem marco (o marco não é mais deste projeto)";
      }
      let dono: string | null = carga.assigned_to ? String(carga.assigned_to) : null;
      if (dono && !(await daEquipe(db, dono))) {
        dono = null;
        aviso = aviso ? `${aviso}; sem dono (a pessoa não é mais da equipe)` : "entrou sem dono (a pessoa não é mais da equipe)";
      }
      const { data, error } = await db
        .from("tasks")
        .insert({
          project_id: projetoId,
          milestone_id: marcoId,
          title: String(carga.title || "").slice(0, 200),
          description: carga.description ?? null,
          status: "todo",
          priority: carga.priority || "medium",
          delivery_type: carga.delivery_type || "unspecified",
          workstream: carga.workstream || "general",
          assigned_to: dono,
          due_date: carga.due_date || null,
          source: "agente:contexto",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("Não foi possível criar a tarefa.");
      const id = (data as { id: string }).id;
      memoria.set(item.ref, id);
      return { desfazer: { tarefa_id: id, projeto_id: projetoId }, aviso };
    }
    case "atualizar_tarefa": {
      const id = String(carga.tarefa_id || "");
      const { data } = await db.from("tasks").select("id, project_id, assigned_to, due_date, priority, deleted_at").eq("id", id).maybeSingle();
      const t = data as { id: string; project_id: string; assigned_to: string | null; due_date: string | null; priority: string | null; deleted_at: string | null } | null;
      if (!t || t.deleted_at) throw new Error("Esta tarefa não existe mais.");
      await projetoDoCliente(db, clientId, t.project_id);
      const campos = (carga.campos ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      const antes: Record<string, unknown> = {};
      if (Object.prototype.hasOwnProperty.call(campos, "assigned_to")) {
        if (!(await daEquipe(db, campos.assigned_to))) throw new Error("A pessoa escolhida não é da equipe.");
        patch.assigned_to = campos.assigned_to;
        antes.assigned_to = t.assigned_to;
      }
      if (campos.due_date) { patch.due_date = campos.due_date; antes.due_date = t.due_date; }
      if (campos.priority) { patch.priority = campos.priority; antes.priority = t.priority; }
      if (!Object.keys(patch).length) return { aviso: "nada para mudar" };
      const { error } = await db.from("tasks").update(patch).eq("id", t.id);
      if (error) throw new Error("Não foi possível atualizar a tarefa.");
      return { desfazer: { tarefa_id: t.id, projeto_id: t.project_id, antes } };
    }
    case "preencher_contexto": {
      const campo = String(carga.campo || "");
      if (["negocio", "publico", "oferta", "tom_de_voz", "nicho", "posicionamento", "estagio"].indexOf(campo) < 0) throw new Error("Campo do contexto desconhecido.");
      const antes = await mudarNoContexto(db, clientId, campo, String(carga.valor || "").slice(0, 1200), deps);
      return { desfazer: { campo, antes } };
    }
    case "gravar_decisao": {
      const r = await deps.gravarDecisao({ area: String(carga.area), categoria: String(carga.categoria), texto: String(carga.texto || "") });
      if (r.erro || !r.id) throw new Error("Não foi possível guardar no cérebro do cliente.");
      // Só a decisão nova tem reverso; o reforço de uma que já existia fica.
      return r.situacao === "criado" ? { desfazer: { memoria_id: r.id } } : { aviso: r.situacao === "reforcado" ? "reforçou uma decisão que já existia" : "substituiu uma decisão antiga" };
    }
    case "gravar_caminho": {
      const caminho = { ...((carga.caminho ?? {}) as Record<string, unknown>), atualizado_em: agoraIso(deps) };
      const antes = await mudarNoContexto(db, clientId, "caminho", caminho, deps);
      return { desfazer: { campo: "caminho", antes } };
    }
    // ---------------------------------------------------------------- kit pelo brand book
    case "kit_paleta": {
      const kit = await lerKitBruto(db, clientId);
      await gravarKit(db, clientId, { paleta: carga.paleta }, deps);
      return { desfazer: { campo: "paleta", antes: kit ? kit.paleta ?? null : null } };
    }
    case "kit_estilo":
    case "kit_regras": {
      const campo = item.operacao === "kit_estilo" ? "estilo" : "regras";
      const kit = await lerKitBruto(db, clientId);
      await gravarKit(db, clientId, { [campo]: String(carga[campo] || "").slice(0, 3000) }, deps);
      return { desfazer: { campo, antes: kit ? (kit as Record<string, unknown>)[campo] ?? null : null } };
    }
    case "kit_tipografia": {
      const antes = await mudarNoContexto(db, clientId, "tipografia", carga.tipografia, deps);
      return { desfazer: { campo: "contexto.tipografia", antes } };
    }
    case "kit_logo": {
      const caminho = String(carga.caminho || "");
      if (caminho.indexOf(pastaDoBrandBook(clientId)) !== 0 || caminho.indexOf("..") >= 0) throw new Error("A imagem não está na pasta do brand book deste cliente.");
      const motivo = deps.conferirLogo ? await deps.conferirLogo(caminho) : null;
      if (motivo) throw new Error(motivo);
      const alternativa = carga.alternativa === true;
      const kit = await lerKitBruto(db, clientId);
      const coluna = alternativa ? "logo_alt_path" : "logo_path";
      await gravarKit(db, clientId, { [coluna]: caminho }, deps);
      // Clara ou escura era da logo anterior: zera (sem a coluna, só segue).
      await Promise.resolve(db.from("cliente_kit_marca").update({ [alternativa ? "logo_alt_tom" : "logo_tom"]: null }).eq("client_id", clientId)).then(() => undefined, () => undefined);
      return { desfazer: { alternativa, caminho: kit ? (kit as Record<string, unknown>)[coluna] ?? null : null } };
    }
    default:
      throw new Error("Operação desconhecida.");
  }
}

/** Desfaz um item do plano ou do kit (o criado vai para a lixeira). */
export async function reverterItemDoPlano(db: ServicoDoPlano, clientId: string, r: ResultadoDoItem, deps: DependenciasDoExecutor): Promise<void> {
  const d = (r.desfazer ?? {}) as Record<string, unknown>;
  const agora = agoraIso(deps);
  switch (r.operacao) {
    case "criar_projeto": {
      const { error } = await db.from("projects").update({ deleted_at: agora }).eq("id", String(d.projeto_id)).eq("client_id", clientId);
      if (error) throw new Error("Não foi possível tirar o projeto.");
      return;
    }
    case "atualizar_projeto": {
      await projetoDoCliente(db, clientId, d.projeto_id).catch(() => undefined);
      const { error } = await db.from("projects").update((d.antes ?? {}) as Record<string, unknown>).eq("id", String(d.projeto_id)).eq("client_id", clientId);
      if (error) throw new Error("Não foi possível voltar o projeto.");
      return;
    }
    case "criar_marco": {
      const { data } = await db.from("projects").select("client_id").eq("id", String(d.projeto_id)).maybeSingle();
      if (!data || (data as { client_id: string }).client_id !== clientId) throw new Error("O marco não é mais deste cliente.");
      const { error } = await db.from("milestones").update({ deleted_at: agora }).eq("id", String(d.marco_id)).eq("project_id", String(d.projeto_id));
      if (error) throw new Error("Não foi possível tirar o marco.");
      return;
    }
    case "criar_tarefa":
    case "atualizar_tarefa": {
      const { data } = await db.from("projects").select("client_id").eq("id", String(d.projeto_id)).maybeSingle();
      if (!data || (data as { client_id: string }).client_id !== clientId) throw new Error("A tarefa não é mais deste cliente.");
      const patch = r.operacao === "criar_tarefa" ? { deleted_at: agora } : ((d.antes ?? {}) as Record<string, unknown>);
      const { error } = await db.from("tasks").update(patch).eq("id", String(d.tarefa_id)).eq("project_id", String(d.projeto_id));
      if (error) throw new Error("Não foi possível voltar a tarefa.");
      return;
    }
    case "preencher_contexto":
    case "gravar_caminho":
      await mudarNoContexto(db, clientId, String(d.campo), d.antes ?? null, deps);
      return;
    case "kit_tipografia":
      await mudarNoContexto(db, clientId, "tipografia", d.antes ?? null, deps);
      return;
    case "gravar_decisao": {
      const { error } = await db.from("agente_memoria").update({ ativa: false }).eq("id", String(d.memoria_id)).eq("client_id", clientId);
      if (error) throw new Error("Não foi possível tirar a decisão do cérebro.");
      return;
    }
    case "kit_paleta":
    case "kit_estilo":
    case "kit_regras":
      await gravarKit(db, clientId, { [String(d.campo)]: d.antes ?? null }, deps);
      return;
    case "kit_logo": {
      const alternativa = d.alternativa === true;
      await gravarKit(db, clientId, { [alternativa ? "logo_alt_path" : "logo_path"]: (d.caminho as string | null) ?? null }, deps);
      await Promise.resolve(db.from("cliente_kit_marca").update({ [alternativa ? "logo_alt_tom" : "logo_tom"]: null }).eq("client_id", clientId)).then(() => undefined, () => undefined);
      return;
    }
  }
}
