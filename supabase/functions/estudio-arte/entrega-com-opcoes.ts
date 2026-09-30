/**
 * Entregar com três opções (frente EN, 28/09).
 *
 * Pedido do dono: "No Estúdio, na hora de entregar, quero três opções:
 * 1. Disponibilizar ao cliente, pronto para agendar: não precisa de
 *    aprovação. É quando o cliente já me deu o aval para aprovar tudo. Já
 *    deixa tudo certinho: só agendar e seguir, tudo programado.
 * 2. Enviar para aprovação: o fluxo normal.
 * 3. Só entregar em Arquivos."
 *
 * A entrega em Arquivos continua na ação `entregar` (com `sem_agenda` na
 * opção 3). Esta ação fecha as opções 1 e 3 depois dela:
 *
 * entrega_concluir { trabalho_id, modo: "pronto" | "arquivos", mostrar_ao_cliente? }
 * - pronto (só admin e gestor): a peça entra na Agenda (se a entrega não
 *   levou), o admin aprova em nome do cliente pela RPC aprovar_pelo_cliente
 *   (revisão da agência, liberação e o aval do cliente, canal "equipe", com o
 *   JWT de quem chamou: as travas e a auditoria do banco valem), e agenda na
 *   hora pelo mesmo caminho do "Publicar em" (publicacao_confirmar), na data
 *   da publicação (a do conteúdo) e no perfil da marca que a entrega pôs.
 *   Sem data que sirva (pauta passada, sem perfil): devolve precisa_data e a
 *   tela abre a janela do "Agendar" já preenchida. Nada é publicado aqui: o
 *   motor de sempre publica no horário.
 * - arquivos: a peça fica em Arquivos, sem post e marcada "não vai postar".
 *   Com mostrar_ao_cliente (só admin e gestor), fica disponível para o
 *   cliente ver (admin_release_file_now em client_shared).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { problemaNoHorario, publicacaoDaPeca } from "./modulos/entrega-na-agenda.ts";
import { postAtualDaPeca, type ContextoDaAgenda, type TrabalhoParaAgenda } from "./agenda-da-entrega.ts";

type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

/** O que esta ação lê do trabalho (estudio_trabalhos). */
export interface TrabalhoDaEntrega extends TrabalhoParaAgenda {
  tipo?: string | null;
  entrega_status?: string | null;
  aprovado_em?: string | null;
  publicar_em?: string | null;
  publicar_em_confirmado_em?: string | null;
  agenda_sincronizada_em?: string | null;
  agenda_historico?: unknown;
}

export type DepsDaEntrega = {
  json: (body: unknown, status?: number) => Response;
  erro: (status: number, codigo: string, mensagem: string) => Error;
  servico: () => SupabaseClient;
  trabalhoComAcesso: (ch: Chamador, id: string) => Promise<TrabalhoDaEntrega>;
  lerTrabalho: (id: string) => Promise<TrabalhoDaEntrega>;
  mutarTrabalho: (id: string, mudar: (t: TrabalhoDaEntrega) => Record<string, unknown>) => Promise<TrabalhoDaEntrega>;
  exigirQuemPublica: (ch: Chamador) => Promise<void>;
  contextoDaAgenda: (ch: Chamador) => ContextoDaAgenda;
  /** A peça entra (ou se atualiza) na Agenda. Nunca lança. */
  levarParaAgenda: (ch: Chamador, t: TrabalhoDaEntrega) => Promise<{ ok: boolean; post_id: string | null; aviso: string | null; publicar_em: string | null }>;
  /** Mesmo caminho do "Publicar em": confirma a data (aprovada, agenda). */
  agendar: (ch: Chamador, trabalhoId: string, quando: string) => Promise<{ quando: string | null; status: string }>;
  /** Data do conteúdo (dia da pauta + melhor horário) ou null. */
  dataDoConteudo: (t: TrabalhoDaEntrega, agora: Date) => Promise<string | null>;
  comHistorico: (historico: unknown, linha: Record<string, unknown>) => Record<string, unknown>[];
};

export const NOTA_DO_AVAL = "aval do cliente ao admin";

const texto = (v: unknown, max: number) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim().slice(0, max);

/**
 * A data em que a peça "pronta para agendar" vai ao ar: a da publicação que
 * a entrega criou (data do conteúdo ou a confirmada), senão a proposta do
 * trabalho, senão a data do conteúdo. Só vale data à frente (2 min ou mais).
 */
export function dataParaAgendarAgora(
  candidatas: (string | null | undefined)[],
  agora: Date,
): string | null {
  for (const c of candidatas) {
    if (c && !problemaNoHorario(c, agora)) return c;
  }
  return null;
}

/** Frase curta para o erro do banco ao aprovar pelo cliente. */
export function motivoDaAprovacao(bruto: unknown): string {
  const m = String((bruto as { message?: string })?.message || bruto || "");
  if (/só admin ou gestor|42501|sem acesso/i.test(m)) return "Só admin ou gestor com acesso ao cliente aprova por ele.";
  if (/reprovado|rejected/i.test(m)) return "Este material foi reprovado e a decisão é final. Entregue uma nova versão.";
  if (/arquivado/i.test(m)) return "O material está arquivado em Arquivos. Desarquive antes.";
  if (/immutable/i.test(m)) return "Esta versão já está travada em Arquivos.";
  if (/snapshot/i.test(m)) return "O post da Agenda mudou enquanto aprovava. Tente de novo.";
  if (/could not find the function|does not exist/i.test(m)) return "O banco ainda não tem a aprovação pelo cliente (SQL EN-01).";
  return m || "Não foi possível aprovar pelo cliente.";
}

export function acoesDaEntregaComOpcoes(d: DepsDaEntrega) {
  async function trabalhoEntregue(ch: Chamador, corpo: Record<string, unknown>) {
    const t = await d.trabalhoComAcesso(ch, texto(corpo.trabalho_id, 64));
    if (t.tipo === "ads") throw d.erro(409, "anuncio_fora_da_agenda", "Criativo de anúncio tem a entrega própria.");
    if (t.status !== "entregue" || !t.file_ids?.length) throw d.erro(409, "sem_entrega", "Entregue a arte em Arquivos antes.");
    return t;
  }

  /**
   * Opção 1: aprova em nome do cliente e agenda (ou pede a data).
   *
   * Ordem pensada para "um fato, um aviso": a data vai para a publicação
   * ANTES da aprovação; assim o aviso da aprovação já diz "agendado para
   * DD/MM" e o aviso do agendamento dessa mesma data não repete (a chave do
   * aviso é a publicação + o horário). Depois da aprovação, o mesmo caminho
   * do "Publicar em" deixa a publicação agendada na hora; se ele não
   * conseguir, a data e a aprovação já estão gravadas e o agendador do banco
   * (mesa_agendar_aprovados + promotor) termina em instantes.
   */
  async function concluirPronto(ch: Chamador, t0: TrabalhoDaEntrega) {
    await d.exigirQuemPublica(ch);
    let t = t0;
    // A peça precisa estar na Agenda para nascer aprovada nela.
    if (!t.post_id || !t.agenda_sincronizada_em) {
      await d.levarParaAgenda(ch, t);
      t = await d.lerTrabalho(t.id);
    }

    // Data e perfil: os da publicação que a entrega criou (conta da marca).
    let pubQuando: string | null = null;
    let pubStatus: string | null = null;
    let temPerfil = false;
    try {
      const post = await postAtualDaPeca(d.servico(), t);
      const pub = publicacaoDaPeca(post?.publications || []);
      pubQuando = pub?.scheduled_at ?? null;
      pubStatus = pub?.status ?? null;
      temPerfil = !!pub?.external_account_id;
    } catch {
      temPerfil = false;
    }
    const agora = new Date();
    const conteudo = pubQuando || t.publicar_em ? null : await d.dataDoConteudo(t, agora).catch(() => null);
    let quando = pubStatus === "scheduled" ? pubQuando : dataParaAgendarAgora([pubQuando, t.publicar_em, conteudo], agora);
    let motivoDaData: string | null = !temPerfil ? "Escolha o perfil para agendar." : !quando ? "A data do conteúdo já passou. Escolha a data." : null;

    // A data vai antes da aprovação (planejada, porque ainda não está aprovada).
    if (temPerfil && quando && pubStatus !== "scheduled" && quando !== pubQuando) {
      try {
        await d.agendar(ch, t.id, quando);
      } catch (e) {
        motivoDaData = e instanceof Error ? e.message : "A Agenda não aceitou a data.";
        quando = null;
      }
    }

    const { data, error } = await ch.doChamador.rpc("aprovar_pelo_cliente", { p_file_id: t.file_ids[0], p_nota: NOTA_DO_AVAL });
    if (error) throw d.erro(409, "aprovacao_recusada", motivoDaAprovacao(error));
    const aprovacao = (data || {}) as { estado?: string; aprovado_por?: string };
    const agoraIso = new Date().toISOString();
    await d.mutarTrabalho(t.id, (a) => ({
      enviado_em: agoraIso,
      enviado_por: ch.userId,
      entrega_aviso: null,
      agenda_historico: d.comHistorico(a.agenda_historico, {
        em: agoraIso, por: ch.userId, acao: "aprovou_pelo_cliente", estado: aprovacao.estado ?? null,
      }),
    }));

    if (pubStatus === "scheduled") {
      return { aprovacao, agendado: { quando: pubQuando, status: "scheduled" }, precisa_data: false, motivo: null, publicar_em: pubQuando };
    }
    if (!temPerfil || !quando) {
      return { aprovacao, agendado: null, precisa_data: true, motivo: motivoDaData, publicar_em: quando || t.publicar_em || null };
    }
    try {
      // Aprovada: o caminho do "Publicar em" congela as lâminas e agenda.
      const r = await d.agendar(ch, t.id, quando);
      return { aprovacao, agendado: r, precisa_data: false, motivo: null, publicar_em: r.quando };
    } catch {
      // Data e aprovação já gravadas: o agendador do banco termina.
      return { aprovacao, agendado: { quando, status: "planned" }, precisa_data: false, motivo: "O agendamento termina em instantes.", publicar_em: quando };
    }
  }

  /** Opção 3: só Arquivos; mostrar ao cliente é opcional (client_shared). */
  async function concluirArquivos(ch: Chamador, t: TrabalhoDaEntrega, mostrar: boolean) {
    const agora = new Date().toISOString();
    if (mostrar) {
      await d.exigirQuemPublica(ch);
      const { error } = await ch.doChamador.rpc("admin_release_file_now", { p_file_id: t.file_ids[0], p_mode: "client_shared" });
      if (error) throw d.erro(409, "liberacao_recusada", String(error.message || "Não foi possível mostrar ao cliente."));
    }
    await d.mutarTrabalho(t.id, (a) => {
      const comDispensa = "publicacao_dispensada_em" in (a as unknown as Record<string, unknown>);
      return {
        ...(comDispensa ? { publicacao_dispensada_em: agora, publicacao_dispensada_por: ch.userId } : {}),
        // Disponível ao cliente conta como aprovado (regra da casa), fora da pergunta de data.
        ...(mostrar ? { entrega_status: "aprovado", aprovado_em: a.aprovado_em || agora, enviado_em: agora, enviado_por: ch.userId, entrega_aviso: null } : {}),
        agenda_historico: d.comHistorico(a.agenda_historico, { em: agora, por: ch.userId, acao: mostrar ? "so_arquivos_mostrado" : "so_arquivos" }),
      };
    });
    return { mostrado_ao_cliente: mostrar };
  }

  /** entrega_concluir { trabalho_id, modo, mostrar_ao_cliente? } */
  async function entregaConcluir(ch: Chamador, corpo: Record<string, unknown>) {
    const modo = texto(corpo.modo, 20);
    if (modo !== "pronto" && modo !== "arquivos") throw d.erro(400, "modo_invalido", "Escolha pronto ou arquivos.");
    const t = await trabalhoEntregue(ch, corpo);
    if (modo === "pronto") {
      const r = await concluirPronto(ch, t);
      return d.json({ trabalho_id: t.id, modo, ...r });
    }
    const r = await concluirArquivos(ch, t, corpo.mostrar_ao_cliente === true);
    return d.json({ trabalho_id: t.id, modo, ...r });
  }

  return { acoes: { entrega_concluir: entregaConcluir } };
}
