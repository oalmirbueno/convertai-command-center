/**
 * Frente MF (27/09): post de fotos da Mesa Foto no fluxo das artes.
 *
 * Ação (POST { acao, ... } na função estudio-arte, só equipe com acesso):
 * - fotos_preparar { client_id, imagem_ids[], formato?, task_id?, trabalho_id?,
 *   novo_item?: { titulo, data }, pedido_id? }
 *     -> { trabalho, task, criado, convertido, item_criado, recusadas, avisos, sem_aprovacao_da_equipe, custo_usd: 0 }
 *   Cria ou atualiza o post de fotos do item da agenda (regras em
 *   _shared/post-de-fotos.ts): cada lâmina é uma foto do acervo, nada é
 *   gerado. Sem item, cria o item na Agenda pelo escritor editorial (mesma
 *   data e idempotência pelo pedido). Depois disso valem as ações de sempre:
 *   legenda, entregar (Arquivos e Agenda), Publicar em e a aprovação.
 *
 * Trava: post de fotos não gera, não ajusta e não corrige lâmina
 * (garantirEditavel no index recusa com "post_de_fotos"). Item com post de
 * fotos já com fotos não recebe direção de arte por cima; o reservado pelo
 * plano (sem fotos) é liberado para a arte (sai do item, nada é apagado).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ehPostDeFotos, ErroDoPost, prepararPostDeFotos } from "../_shared/post-de-fotos.ts";
import { criarItemDoPostDeFotos } from "../_shared/post-de-fotos-item.ts";
import { resolverMarca } from "../_shared/marca.ts";

type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

export type DepsDasFotos = {
  servico: () => SupabaseClient;
  garantirAcesso: (ch: Chamador, clientId: string) => Promise<void>;
  json: (body: unknown, status?: number) => Response;
  /** Erro que o roteador da estudio-arte já sabe responder. */
  erro: (status: number, codigo: string, mensagem: string) => Error;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** Formatos do item que o Estúdio não faz (mesma lista do index). */
const FORA_DO_POST = ["reel", "video", "short", "story", "article"];

const texto = (v: unknown, max: number) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, max);

export function acoesDasFotosNaAgenda(d: DepsDasFotos) {
  const db = () => d.servico();

  const comoErro = (e: unknown) => (e instanceof ErroDoPost ? d.erro(e.status, e.codigo, e.message) : e);

  async function lerItem(taskId: string, clientId: string) {
    const { data: t } = await db().from("tasks").select("id, project_id, title, delivery_type, due_date, deleted_at").eq("id", taskId).maybeSingle();
    const tarefa = t as { id: string; project_id: string; title: string | null; delivery_type: string | null; due_date: string | null; deleted_at: string | null } | null;
    if (!tarefa || tarefa.deleted_at) throw d.erro(404, "item_inexistente", "Item da agenda não encontrado.");
    const { data: p } = await db().from("projects").select("id, client_id, deleted_at").eq("id", tarefa.project_id).maybeSingle();
    const projeto = p as { id: string; client_id: string; deleted_at: string | null } | null;
    if (!projeto || projeto.deleted_at || projeto.client_id !== clientId) throw d.erro(409, "item_de_outro_cliente", "O item da agenda não pertence a este cliente.");
    if (FORA_DO_POST.indexOf(String(tarefa.delivery_type || "")) >= 0) {
      throw d.erro(400, "formato_fora_do_post", "Este item é de vídeo ou outro formato: o post de fotos vai em item de carrossel ou estático.");
    }
    return tarefa;
  }

  /** fotos_preparar: o post de fotos do item (ou de um item novo), com as fotos na ordem. Sem custo. */
  async function fotosPreparar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = texto(corpo.client_id, 64);
    await d.garantirAcesso(ch, clientId);
    const imagemIds = (Array.isArray(corpo.imagem_ids) ? corpo.imagem_ids : []).map((x) => String(x || "").trim()).filter((x) => UUID.test(x));
    if (!imagemIds.length) throw d.erro(400, "sem_fotos", "Escolha ao menos uma foto do acervo.");
    let taskId = texto(corpo.task_id, 64);
    let itemCriado = false;
    let titulo = "";
    if (!UUID.test(taskId)) {
      const novo = (corpo.novo_item && typeof corpo.novo_item === "object" ? corpo.novo_item : {}) as Record<string, unknown>;
      const data = texto(novo.data, 10);
      if (!DATA.test(data)) throw d.erro(400, "sem_item", "Escolha o item da Agenda ou a data do post novo.");
      const pedido = texto(corpo.pedido_id, 80) || crypto.randomUUID();
      // Frente AE: o item novo nasce no projeto da marca aberta (Acerbi ou CME), nunca no da outra.
      const marca = await resolverMarca(db(), clientId, { marca_id: corpo.marca_id }).catch(() => null);
      try {
        const criado = await criarItemDoPostDeFotos(db(), {
          projetoId: marca ? marca.project_id : null,
          clientId,
          userId: ch.userId,
          titulo: texto(novo.titulo, 200) || "Post de fotos",
          data,
          carrossel: imagemIds.length > 1,
          pedidoId: pedido,
        });
        taskId = criado.task_id;
        titulo = criado.title;
        itemCriado = !criado.replayed;
      } catch (e) {
        throw comoErro(e);
      }
    }
    const item = await lerItem(taskId, clientId);
    titulo = titulo || texto(item.title, 200) || "Post de fotos";
    try {
      const r = await prepararPostDeFotos(db(), {
        clientId,
        taskId,
        titulo,
        formato: corpo.formato,
        imagemIds,
        userId: ch.userId,
        trabalhoId: UUID.test(texto(corpo.trabalho_id, 64)) ? texto(corpo.trabalho_id, 64) : null,
      });
      const avisos = r.avisos.slice();
      if (item.delivery_type === "static" && r.trabalho.cards.length > 1) avisos.push("O item estava como post estático: com mais de uma foto ele vai como carrossel.");
      if (r.sem_aprovacao_da_equipe) avisos.push(`${r.sem_aprovacao_da_equipe} ${r.sem_aprovacao_da_equipe === 1 ? "foto gerada precisa" : "fotos geradas precisam"} da aprovação da equipe antes de ir ao cliente.`);
      return d.json({
        trabalho: r.trabalho,
        task: { id: item.id, title: item.title, due_date: item.due_date, delivery_type: item.delivery_type },
        criado: r.criado,
        convertido: r.convertido,
        item_criado: itemCriado,
        recusadas: r.recusadas,
        avisos,
        sem_aprovacao_da_equipe: r.sem_aprovacao_da_equipe,
        custo_usd: 0,
      });
    } catch (e) {
      throw comoErro(e);
    }
  }

  return {
    acoes: { fotos_preparar: fotosPreparar } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
  };
}

/**
 * Antes de a direção de arte nascer num item: post de fotos com fotos trava
 * (o item é da Mesa Foto); o reservado pelo plano, ainda sem fotos, sai do
 * item (task_id vazio, marcado como liberado) e a arte segue. Nada é apagado.
 */
export async function liberarItemParaArte(db: SupabaseClient, clientId: string, taskId: string): Promise<{ bloqueado: boolean }> {
  if (!UUID.test(taskId)) return { bloqueado: false };
  const { data } = await db.from("estudio_trabalhos").select("id, direcao, cards, file_ids").eq("client_id", clientId).eq("task_id", taskId).limit(10);
  const lista = (data as { id: string; direcao: Record<string, unknown> | null; cards: unknown[] | null; file_ids: string[] | null }[] | null) || [];
  const deFotos = lista.filter((t) => ehPostDeFotos(t.direcao));
  if (deFotos.some((t) => (Array.isArray(t.cards) && t.cards.length) || (Array.isArray(t.file_ids) && t.file_ids.length))) return { bloqueado: true };
  for (const t of deFotos) {
    await db.from("estudio_trabalhos")
      .update({ task_id: null, direcao: { ...(t.direcao || {}), liberado_para_arte_em: new Date().toISOString(), task_id_anterior: taskId } })
      .eq("id", t.id)
      .then(() => undefined, () => undefined);
  }
  return { bloqueado: false };
}
