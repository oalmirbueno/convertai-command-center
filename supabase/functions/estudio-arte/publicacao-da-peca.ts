/**
 * Frente AP (28/09): aprovou → Agenda, e o pedido do cliente entendido.
 *
 * Ações (POST { acao, ... } na função estudio-arte, só equipe com acesso ao cliente):
 * - publicacao_perfis { trabalho_id } -> { perfis, project_id }
 *   Onde a peça pode sair: Instagram e páginas do Facebook ligados ao projeto
 *   do item (a marca: Acerbi e CME separadas). Sem custo.
 * - publicacao_dispensar { trabalho_id, desfazer? } -> { trabalho }
 *   "Não vai postar": a peça aprovada fica em Arquivos e sai da pergunta de
 *   data. Só admin ou gestor. Agendada ou publicada recusa (desfaça antes).
 * - pedido_entender { trabalho_id } -> { pedidos, erro? }
 *   O Jev entende o que o cliente escreveu (pedido de ajuste ou comentário da
 *   aprovação) e o entendimento fica gravado no próprio pedido. Não gera nada.
 *   Sem o Jev (fora do ar ou sem chave), devolve os pedidos como estão.
 * - pedido_visto { trabalho_id, evento_id } -> { trabalho }
 *   O comentário da aprovação foi visto pela equipe (sai da pendência).
 *
 * A data e os perfis são gravados por publicacao_confirmar (index), que chama
 * confirmarDataDaPeca com `perfis`.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { jevPerguntar } from "../_shared/jev.ts";
import {
  ajustesDoCliente,
  comHistorico,
  FUSO_PADRAO,
  horarioDoConteudo,
  localParaIso,
  partesNoFuso,
  problemaNoHorario,
  publicacaoDaPeca,
  tipoDoConteudo,
} from "./modulos/entrega-na-agenda.ts";
import { entendimentoDoPedido, estadoDoPedido, perguntasDoPedido } from "./modulos/pedido-do-cliente.ts";
import { ErroDaAgenda, perfisDaPeca, type ContextoDaAgenda, type TrabalhoParaAgenda } from "./agenda-da-entrega.ts";

type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

/** O que estas ações leem do trabalho (estudio_trabalhos). */
export interface TrabalhoDaPublicacao {
  id: string;
  client_id: string;
  task_id: string | null;
  tipo?: string | null;
  status: string;
  file_ids: string[];
  post_id?: string | null;
  direcao?: unknown;
  entrega_status?: string | null;
  ajustes_do_cliente?: unknown;
  agenda_historico?: unknown;
  atualizado_em: string;
}

export type DepsDaPublicacao = {
  json: (body: unknown, status?: number) => Response;
  erro: (status: number, codigo: string, mensagem: string) => Error;
  trabalhoComAcesso: (ch: Chamador, id: string) => Promise<TrabalhoDaPublicacao>;
  mutarTrabalho: (id: string, mudar: (t: TrabalhoDaPublicacao) => Record<string, unknown>) => Promise<TrabalhoDaPublicacao>;
  exigirQuemPublica: (ch: Chamador) => Promise<void>;
  contextoDaAgenda: (ch: Chamador) => ContextoDaAgenda;
  /** Leitura pela chave de serviço (a ação já conferiu o acesso). */
  servico: () => SupabaseClient;
};

const texto = (v: unknown, max: number) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Pedidos entendidos por chamada (cada um é uma pergunta ao Jev). */
const MAX_POR_CHAMADA = 3;

function formatoDaDirecao(direcao: unknown): string {
  const f = direcao && typeof direcao === "object" ? (direcao as Record<string, unknown>).formato : null;
  return typeof f === "string" && f ? f : "feed_4x5";
}

function laminasDa(t: TrabalhoDaPublicacao): number {
  const cards = t.direcao && typeof t.direcao === "object" ? (t.direcao as { cards?: unknown }).cards : null;
  return Math.max(1, (t.file_ids || []).length || (Array.isArray(cards) ? cards.length : 1));
}

export function acoesDaPublicacaoDaPeca(d: DepsDaPublicacao) {
  const comoErro = (e: unknown): never => {
    if (e instanceof ErroDaAgenda) throw d.erro(e.status, e.codigo, e.message);
    throw e;
  };

  async function trabalhoSocial(ch: Chamador, corpo: Record<string, unknown>) {
    const t = await d.trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
    if (t.tipo === "ads") throw d.erro(409, "anuncio_fora_da_agenda", "Criativo de anúncio não vai para a Agenda de posts.");
    return t;
  }

  /** publicacao_perfis: onde a peça pode sair. */
  async function publicacaoPerfis(ch: Chamador, corpo: Record<string, unknown>) {
    const t = await trabalhoSocial(ch, corpo);
    try {
      // Conexões com o JWT de quem chamou: o service_role não lê external_account_connections (E06).
      const r = await perfisDaPeca(d.servico(), t, ch.doChamador);
      return d.json({ trabalho_id: t.id, project_id: r.projectId, perfis: r.perfis });
    } catch (e) {
      return comoErro(e);
    }
  }

  /** publicacao_dispensar: "não vai postar" (ou desfazer isso). */
  async function publicacaoDispensar(ch: Chamador, corpo: Record<string, unknown>) {
    await d.exigirQuemPublica(ch);
    const t = await trabalhoSocial(ch, corpo);
    const desfazer = corpo.desfazer === true;
    if (!desfazer && t.post_id) {
      const { data } = await d.servico()
        .from("editorial_publications")
        .select("id, status, platform, scheduled_at")
        .eq("post_id", t.post_id);
      const pub = publicacaoDaPeca((data as never[] | null) ?? []) as { status: string; scheduled_at: string | null } | null;
      if (pub && pub.status === "published") throw d.erro(409, "ja_publicado", "Esta peça já foi publicada.");
      if (pub && pub.status === "scheduled") {
        throw d.erro(409, "ja_agendado", "A peça está agendada. Desfaça o agendamento em Publicar em antes de marcar que não vai postar.");
      }
    }
    const agora = new Date().toISOString();
    let atualizado: TrabalhoDaPublicacao;
    try {
      atualizado = await d.mutarTrabalho(t.id, (a) => {
        if (!("publicacao_dispensada_em" in (a as unknown as Record<string, unknown>))) {
          throw d.erro(409, "falta_sql_ap", "Falta aplicar o SQL AP-01 (não vai postar).");
        }
        return {
          publicacao_dispensada_em: desfazer ? null : agora,
          publicacao_dispensada_por: desfazer ? null : ch.userId,
          agenda_historico: comHistorico(a.agenda_historico, { em: agora, por: ch.userId, acao: desfazer ? "vai_postar" : "nao_vai_postar" }),
        };
      });
    } catch (e) {
      return comoErro(e);
    }
    return d.json({ trabalho_id: t.id, trabalho: atualizado });
  }

  /** pedido_entender: o Jev entende os pedidos ainda não entendidos da peça. */
  async function pedidoEntender(ch: Chamador, corpo: Record<string, unknown>) {
    const t = await trabalhoSocial(ch, corpo);
    const lista = ajustesDoCliente(t.ajustes_do_cliente);
    const faltam = lista.filter((p) => !!p.texto && !p.entendido && !!p.evento_id).slice(-MAX_POR_CHAMADA);
    if (!faltam.length) return d.json({ trabalho_id: t.id, pedidos: lista, entendidos: 0 });

    const entendidos: Record<string, Record<string, unknown>> = {};
    let erro: string | null = null;
    await Promise.all(faltam.map(async (p) => {
      try {
        const r = await jevPerguntar({
          state: estadoDoPedido({ texto: p.texto || "", decisao: p.decisao, formatoAtual: formatoDaDirecao(t.direcao), laminas: laminasDa(t), lamina: p.lamina }),
          questions: perguntasDoPedido(),
        });
        entendidos[p.evento_id as string] = entendimentoDoPedido(r.answers, { lamina: p.lamina, modelo: r.modelo }) as unknown as Record<string, unknown>;
      } catch (e) {
        // Sem o Jev a pendência continua com o texto do cliente; nada quebra.
        erro = e instanceof Error ? e.message.slice(0, 120) : "jev_indisponivel";
      }
    }));
    if (!Object.keys(entendidos).length) {
      return d.json({ trabalho_id: t.id, pedidos: lista, entendidos: 0, erro: erro || "jev_indisponivel" });
    }
    const atualizado = await d.mutarTrabalho(t.id, (a) => ({
      ajustes_do_cliente: (Array.isArray(a.ajustes_do_cliente) ? (a.ajustes_do_cliente as Record<string, unknown>[]) : []).map((x) =>
        x && typeof x === "object" && typeof x.evento_id === "string" && entendidos[x.evento_id] && !x.entendido
          ? { ...x, entendido: entendidos[x.evento_id] }
          : x
      ),
    }));
    return d.json({ trabalho_id: t.id, pedidos: ajustesDoCliente(atualizado.ajustes_do_cliente), entendidos: Object.keys(entendidos).length, erro });
  }

  /** pedido_visto: o comentário da aprovação sai da pendência (fica no histórico da peça). */
  async function pedidoVisto(ch: Chamador, corpo: Record<string, unknown>) {
    const t = await trabalhoSocial(ch, corpo);
    const eventoId = texto(corpo.evento_id, 64);
    if (!UUID.test(eventoId)) throw d.erro(400, "evento_invalido", "Pedido inválido.");
    const agora = new Date().toISOString();
    const atualizado = await d.mutarTrabalho(t.id, (a) => ({
      ajustes_do_cliente: (Array.isArray(a.ajustes_do_cliente) ? (a.ajustes_do_cliente as Record<string, unknown>[]) : []).map((x) =>
        x && typeof x === "object" && x.evento_id === eventoId && !x.visto_em ? { ...x, visto_em: agora, visto_por: ch.userId } : x
      ),
    }));
    return d.json({ trabalho_id: t.id, trabalho: atualizado });
  }

  return {
    acoes: {
      publicacao_perfis: publicacaoPerfis,
      publicacao_dispensar: publicacaoDispensar,
      pedido_entender: pedidoEntender,
      pedido_visto: pedidoVisto,
    } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
  };
}

/**
 * Frente AP (28/09): a data do conteúdo para a publicação nascer na Agenda.
 * O dia da pauta (tasks.due_date) com o melhor horário do perfil (o mesmo de
 * mesa_melhor_hora, com o horário automático ligado) ou o horário fixo do
 * cliente. Pauta que já passou (ou de hoje com o horário passado): null, e a
 * peça fica sem data até alguém escolher. Nunca joga para o dia da criação.
 */
export async function dataDoConteudo(
  db: SupabaseClient,
  t: Pick<TrabalhoParaAgenda, "task_id" | "client_id" | "file_ids">,
  agora = new Date(),
): Promise<string | null> {
  if (!t.task_id) return null;
  const [tarefaRes, cfgRes] = await Promise.all([
    db.from("tasks").select("due_date").eq("id", t.task_id).maybeSingle(),
    db.from("mesa_cliente_config").select("hora_publicacao, fuso, horario_automatico").eq("client_id", t.client_id).maybeSingle(),
  ]);
  const dia = (tarefaRes.data as { due_date: string | null } | null)?.due_date ?? null;
  if (!dia) return null;
  const cfg = cfgRes.data as { hora_publicacao: string | null; fuso: string | null; horario_automatico: boolean | null } | null;
  const fuso = cfg?.fuso || FUSO_PADRAO;
  let melhor: string | null = null;
  if (cfg?.horario_automatico !== false) {
    const { data } = await db.rpc("mesa_melhor_hora", { _client_id: t.client_id, _tipo: tipoDoConteudo(t.file_ids || []) });
    melhor = typeof data === "string" ? data.slice(0, 5) : null;
  }
  const local = partesNoFuso(agora, fuso);
  const h = horarioDoConteudo({
    diaDaPeca: dia,
    hoje: local.dia,
    agoraHHMM: local.hora,
    melhorHora: melhor,
    horaFixa: cfg?.hora_publicacao ? String(cfg.hora_publicacao).slice(0, 5) : null,
  });
  if (!h) return null;
  const iso = localParaIso(h.dia, h.hora, fuso);
  return iso && !problemaNoHorario(iso, agora) ? iso : null;
}
