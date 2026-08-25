import { supabase } from "@/integrations/supabase/client";

/**
 * O que está REALMENTE acontecendo com cada cliente, agora.
 *
 * O ciclo nasceu cego: ele sorteava três tarefas de um acervo e não sabia
 * nada do painel. Podia mandar "planejar os stories da semana" para um
 * cliente com sete artes prontas paradas esperando aprovação há cinco
 * dias, e não mandar nada sobre a aprovação. A tarefa não era errada, era
 * IRRELEVANTE — e tarefa irrelevante é o que faz o checklist virar
 * burocracia que ninguém lê.
 *
 * Este módulo lê o estado de verdade — artes, aprovações, agendamentos,
 * publicações — para as sugestões saírem do que a semana daquele cliente
 * está pedindo, e para o painel conseguir dizer, sem ninguém perguntar, o
 * que está pendente em cada um.
 *
 * Tudo em UMA consulta por tabela, para a lista inteira de clientes: a
 * tela do ciclo mostra a carteira toda, e uma consulta por cliente viraria
 * dezenas de idas ao servidor a cada abertura.
 */

export interface SituacaoDoCliente {
  clientId: string;
  /** Artes aprovadas/disponibilizadas, prontas para virar post. */
  artesProntas: number;
  /** Enviadas ao cliente e ainda sem resposta. */
  aguardandoAprovacao: number;
  /** Dias que a aprovação mais antiga está parada. */
  aprovacaoParadaDias: number | null;
  /** O cliente pediu alteração e ninguém refez ainda. */
  artesRecusadas: number;
  /** Publicações programadas daqui para a frente. */
  agendados: number;
  /** Data do próximo post no ar. */
  proximoAgendado: string | null;
  /** Programados para uma data que já passou e não publicaram. */
  perderamAData: number;
  /** Foram ao ar nos últimos 7 dias. */
  publicadosNaSemana: number;
  /** Última vez que alguém escreveu no diário do cliente. */
  ultimoDiario: string | null;
  /** Tarefas de produção abertas no Kanban. */
  tarefasAbertas: number;
  /** Abertas com prazo já vencido. */
  tarefasAtrasadas: number;
  /** Abertas sem ninguém responsável. */
  tarefasSemDono: number;
  /** Pauta no calendário editorial ainda sem arte anexada. */
  pautasSemArte: number;

  /* ── Tráfego ── */
  /** Campanhas que a Meta reporta como no ar. */
  campanhasAtivas: number;
  /** Campanhas cadastradas, em qualquer estado. */
  campanhasTotal: number;
  /** Saldo da carteira de anúncios, quando existe. */
  saldoVerba: number | null;
  /** Dias desde a última recarga registrada. */
  diasDesdeRecarga: number | null;
  /** Dias desde a última vez que os dados de campanha se moveram. */
  diasSemDadoDeCampanha: number | null;
}

export function situacaoVazia(clientId: string): SituacaoDoCliente {
  return {
    clientId,
    artesProntas: 0,
    aguardandoAprovacao: 0,
    aprovacaoParadaDias: null,
    artesRecusadas: 0,
    agendados: 0,
    proximoAgendado: null,
    perderamAData: 0,
    publicadosNaSemana: 0,
    ultimoDiario: null,
    tarefasAbertas: 0,
    tarefasAtrasadas: 0,
    tarefasSemDono: 0,
    pautasSemArte: 0,
    campanhasAtivas: 0,
    campanhasTotal: 0,
    saldoVerba: null,
    diasDesdeRecarga: null,
    diasSemDadoDeCampanha: null,
  };
}

const diasEntre = (iso: string, agora: number) =>
  Math.floor((agora - new Date(iso).getTime()) / 86_400_000);

/**
 * Lê a situação de vários clientes de uma vez.
 *
 * `agoraIso` entra por parâmetro em vez de sair de `new Date()` aqui
 * dentro para o teste conseguir fixar o tempo: "parada há 5 dias" só é
 * testável se o agora não se mover.
 */
export async function lerSituacoes(
  clientIds: string[],
  agoraIso?: string,
): Promise<Map<string, SituacaoDoCliente>> {
  const mapa = new Map<string, SituacaoDoCliente>();
  for (const id of clientIds) mapa.set(id, situacaoVazia(id));
  if (clientIds.length === 0) return mapa;

  const agora = agoraIso ? new Date(agoraIso).getTime() : Date.now();
  const seteDiasAtras = new Date(agora - 7 * 86_400_000).toISOString();

  const [arquivos, publicacoes, diario, tarefas, pautas, campanhas, carteira] = await Promise.all([
    supabase
      .from("files")
      .select("client_id, approval_status, agency_approval_status, visibility, locked_at, status, approval_requested_at")
      .in("client_id", clientIds)
      .is("archived_at", null)
      .is("parent_file_id", null),
    supabase
      .from("editorial_publications")
      .select("client_id, status, scheduled_at, published_at")
      .in("client_id", clientIds)
      .neq("status", "cancelled"),
    (supabase as any)
      .from("project_memory")
      .select("client_id, created_at")
      .in("client_id", clientIds)
      .order("created_at", { ascending: false }),
    // Tarefa NAO tem client_id: o vinculo com o cliente passa pelo
    // projeto. Buscar direto por client_id retorna erro que o catch
    // engole, e a contagem ficaria sempre zero sem ninguem perceber.
    (supabase as any)
      .from("projects")
      .select("id, client_id, tasks(status, due_date, assigned_to)")
      .in("client_id", clientIds)
      .is("deleted_at", null),
    // Pauta no calendario sem arte: primary_file_id nulo. E o buraco entre
    // "planejei o conteudo" e "existe conteudo" — o calendario parece
    // cheio e nao ha o que publicar.
    (supabase as any)
      .from("editorial_posts")
      .select("client_id, primary_file_id, production_status")
      .in("client_id", clientIds)
      .is("archived_at", null)
      .is("primary_file_id", null),
    (supabase as any)
      .from("ads_campaigns")
      .select("client_id, effective_status, status, updated_at")
      .in("client_id", clientIds),
    (supabase as any)
      .from("ads_wallet")
      .select("client_id, balance, last_recharge_date")
      .in("client_id", clientIds),
  ]);

  for (const linha of (arquivos.data ?? []) as Array<Record<string, unknown>>) {
    const s = mapa.get(String(linha.client_id));
    if (!s) continue;
    const agencia = String(linha.agency_approval_status ?? "");
    const cliente = String(linha.approval_status ?? "");
    const visibilidade = String(linha.visibility ?? "");
    const estado = String(linha.status ?? "ready");

    // A regra da casa: disponibilizado ao cliente vale como aprovado.
    const pronta = agencia === "approved"
      && (visibilidade === "client_shared"
        || (visibilidade === "approval" && cliente === "approved"))
      && Boolean(linha.locked_at)
      && estado === "ready";
    if (pronta) { s.artesProntas += 1; continue; }

    if (agencia === "rejected" || cliente === "rejected") { s.artesRecusadas += 1; continue; }

    const esperando = visibilidade === "approval" && cliente !== "approved";
    if (esperando) {
      s.aguardandoAprovacao += 1;
      const desde = linha.approval_requested_at;
      if (typeof desde === "string") {
        const dias = diasEntre(desde, agora);
        s.aprovacaoParadaDias = s.aprovacaoParadaDias == null
          ? dias
          : Math.max(s.aprovacaoParadaDias, dias);
      }
    }
  }

  for (const linha of (publicacoes.data ?? []) as Array<Record<string, unknown>>) {
    const s = mapa.get(String(linha.client_id));
    if (!s) continue;
    const publicado = linha.published_at;
    const marcado = linha.scheduled_at;
    if (typeof publicado === "string") {
      if (new Date(publicado).getTime() >= new Date(seteDiasAtras).getTime()) {
        s.publicadosNaSemana += 1;
      }
      continue;
    }
    if (typeof marcado !== "string") continue;
    const quando = new Date(marcado).getTime();
    if (quando >= agora) {
      s.agendados += 1;
      if (!s.proximoAgendado || quando < new Date(s.proximoAgendado).getTime()) {
        s.proximoAgendado = marcado;
      }
    } else {
      // Programado para trás e nunca publicou: é justamente o caso que
      // ninguém percebe, porque some do futuro sem ir para o passado.
      s.perderamAData += 1;
    }
  }

  for (const linha of (diario.data ?? []) as Array<Record<string, unknown>>) {
    const s = mapa.get(String(linha.client_id));
    if (!s || s.ultimoDiario) continue;   // a lista vem do mais novo
    s.ultimoDiario = String(linha.created_at);
  }

  const ABERTAS = new Set(["backlog", "todo", "doing", "review"]);
  const hoje = new Date(agora).toISOString().slice(0, 10);
  for (const projeto of (tarefas.data ?? []) as Array<Record<string, unknown>>) {
    const s = mapa.get(String(projeto.client_id));
    if (!s) continue;
    const lista = (projeto.tasks ?? []) as Array<{
      status?: string | null; due_date?: string | null; assigned_to?: string | null;
    }>;
    for (const t of lista) {
      if (!ABERTAS.has(String(t.status ?? ""))) continue;
      s.tarefasAbertas += 1;
      if (typeof t.due_date === "string" && t.due_date < hoje) s.tarefasAtrasadas += 1;
      if (!t.assigned_to) s.tarefasSemDono += 1;
    }
  }

  for (const linha of (pautas.data ?? []) as Array<Record<string, unknown>>) {
    const s = mapa.get(String(linha.client_id));
    if (s) s.pautasSemArte += 1;
  }

  for (const linha of (campanhas.data ?? []) as Array<Record<string, unknown>>) {
    const s = mapa.get(String(linha.client_id));
    if (!s) continue;
    s.campanhasTotal += 1;
    const estado = String(linha.effective_status ?? linha.status ?? "").toUpperCase();
    if (estado === "ACTIVE") s.campanhasAtivas += 1;
    const quando = linha.updated_at;
    if (typeof quando === "string") {
      const dias = diasEntre(quando, agora);
      s.diasSemDadoDeCampanha = s.diasSemDadoDeCampanha == null
        ? dias
        : Math.min(s.diasSemDadoDeCampanha, dias);
    }
  }

  for (const linha of (carteira.data ?? []) as Array<Record<string, unknown>>) {
    const s = mapa.get(String(linha.client_id));
    if (!s) continue;
    const saldo = Number(linha.balance ?? 0);
    s.saldoVerba = (s.saldoVerba ?? 0) + (Number.isFinite(saldo) ? saldo : 0);
    const recarga = linha.last_recharge_date;
    if (typeof recarga === "string") {
      const dias = diasEntre(recarga, agora);
      s.diasDesdeRecarga = s.diasDesdeRecarga == null
        ? dias
        : Math.min(s.diasDesdeRecarga, dias);
    }
  }

  return mapa;
}
