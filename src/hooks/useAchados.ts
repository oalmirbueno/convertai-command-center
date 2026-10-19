import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { useNow } from "@/hooks/useNow";
import { useCobrancasPendentes } from "@/hooks/useFinancialData";
import { isInternalClient } from "@/lib/clientFlags";
import { addDays, localIso, mondayOf } from "@/lib/cycleWeek";
import {
  contarLeadsDasAcoes,
  LIMITE_DO_LEAD_PARADO,
  type PropostaDoAchado,
  detectarAchados,
  type Achado,
  type ClienteDoAchado,
  type DadosDosAchados,
} from "@/components/achados/detectores";

/**
 * Achados (20/10/2026): lê, com consultas leves, só o que os detectores
 * precisam e devolve os cartões "achado → ação" já ordenados. Usado no topo
 * da Carteira da Central e do Ciclo.
 *
 * - Cada leitura que falha (ou que a regra de acesso recusa) vira "sem dado"
 *   para aquele detector, que some; nada vira zero inventado.
 * - Comercial, propostas, cobranças e carteira de IA são de admin e gestor.
 * - Rituais usam a mesma chave e a mesma leitura da Central (cache comum).
 */

const VIVO = { staleTime: 60_000, refetchOnWindowFocus: true, refetchInterval: 5 * 60_000 } as const;

type Linha = Record<string, any>;

async function ler(consulta: PromiseLike<{ data: unknown; error: unknown }>): Promise<Linha[]> {
  const { data, error } = await consulta;
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as Linha[];
}

export function useAchados({ clienteEmFoco = null, ativo = true, agora }: { clienteEmFoco?: string | null; ativo?: boolean; agora?: Date } = {}) {
  const { user, profile } = useAuth();
  const role = profile?.role || "";
  const equipe = ativo && !!user && ["admin", "manager", "design", "traffic"].includes(role);
  const gestao = equipe && (role === "admin" || role === "manager");
  const db = supabase as any;

  const relogio = useNow();
  const momento = agora ?? relogio;
  const hoje = localIso(momento);
  const segunda = localIso(mondayOf(momento));
  const inicioDaSemana = new Date(`${segunda}T00:00:00`).toISOString();
  const seteDiasAtras = localIso(addDays(new Date(`${hoje}T12:00:00`), -7));

  const { data: clients } = useClients();
  const cobrancas = useCobrancasPendentes();
  // Propostas: mesma leitura e mesma régua de follow-up de Clientes > Propostas
  // (linhaDaCarteira + followupDaProposta). O módulo das propostas é pesado e
  // só é carregado aqui dentro, quando a leitura roda (a Central e o Ciclo
  // abrem sem ele).
  const propostas = useQuery({
    queryKey: ["achados", "propostas"],
    enabled: gestao,
    ...VIVO,
    queryFn: async (): Promise<PropostaDoAchado[]> => {
      const { linhaDaCarteira, enderecoDaProposta } = await import("@/components/clientes-propostas/propostasDaCarteira");
      const base = "id, client_id, lead_id, numero, titulo, status, validade_ate, total_unico, total_mensal, enviada_em, vista_em, aceita_em, atualizado_em";
      const pedir = (campos: string) => db.from("propostas").select(campos).is("arquivada_em", null).order("atualizado_em", { ascending: false }).limit(300);
      let resposta = await pedir(`${base}, ultimo_followup_em`);
      // Banco sem a coluna nova do follow-up: lê sem ela (a régua continua valendo).
      if (resposta.error) resposta = await pedir(base);
      if (resposta.error) throw resposta.error;
      const linhas = (Array.isArray(resposta.data) ? resposta.data : []) as unknown[];
      const saida: PropostaDoAchado[] = [];
      for (const bruta of linhas) {
        const l = linhaDaCarteira(bruta);
        if (!l) continue;
        saida.push({
          id: l.id,
          clienteId: l.client_id,
          titulo: l.titulo,
          totalUnico: l.total_unico,
          totalMensal: l.total_mensal,
          followup: l.followup ? { situacao: l.followup.situacao, dias: l.followup.dias } : null,
          endereco: enderecoDaProposta(l),
        });
      }
      return saida;
    },
  });

  const leads = useQuery({
    queryKey: ["achados", "leads"],
    enabled: gestao,
    ...VIVO,
    queryFn: async () => {
      const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const [lista, eventos] = await Promise.all([
        ler(db.from("commercial_leads").select("id, name, company, stage, updated_at, next_action_at, monthly_value, one_off_value, won_client_id").is("archived_at", null).in("stage", Object.keys(LIMITE_DO_LEAD_PARADO))),
        ler(db.from("commercial_lead_events").select("lead_id, created_at").gte("created_at", desde)),
      ]);
      const ultimo = new Map<string, string>();
      for (const e of eventos) {
        const id = String(e.lead_id);
        const em = String(e.created_at || "");
        if (em && (!ultimo.has(id) || em > (ultimo.get(id) as string))) ultimo.set(id, em);
      }
      return lista.map((l) => ({
        id: String(l.id),
        nome: String(l.company || l.name || "Lead"),
        estagio: String(l.stage || ""),
        atualizadoEm: (l.updated_at as string) || null,
        ultimoEventoEm: ultimo.get(String(l.id)) || null,
        proximoPassoEm: (l.next_action_at as string) || null,
        valorMensal: Number(l.monthly_value) || 0,
        valorUnico: Number(l.one_off_value) || 0,
        clienteId: (l.won_client_id as string) || null,
      }));
    },
  });

  const publicacoes = useQuery({
    queryKey: ["achados", "publicacoes", segunda],
    enabled: equipe,
    ...VIVO,
    queryFn: async () => {
      const linhas = await ler(
        db.from("editorial_publications")
          .select("client_id, status, scheduled_at, published_at")
          .in("status", ["scheduled", "published"])
          .or(`scheduled_at.gte.${inicioDaSemana},published_at.gte.${inicioDaSemana}`),
      );
      return linhas.map((p) => ({ clienteId: String(p.client_id), status: String(p.status), agendadaEm: (p.scheduled_at as string) || null, publicadaEm: (p.published_at as string) || null }));
    },
  });

  const ocultosDoSocial = useQuery({
    queryKey: ["achados", "ocultos", hoje],
    enabled: equipe,
    ...VIVO,
    queryFn: async () => {
      const linhas = await ler(db.from("cycle_client_prefs").select("client_id, hidden_areas, hidden_until"));
      // Lista simples (não Set): o cache do React Query pode ser guardado como JSON.
      const ocultos: string[] = [];
      for (const p of linhas) {
        const areas = Array.isArray(p.hidden_areas) ? (p.hidden_areas as string[]) : [];
        const ate = typeof p.hidden_until === "string" ? p.hidden_until : null;
        if (areas.indexOf("social") >= 0 && (ate === null || ate >= hoje)) ocultos.push(String(p.client_id));
      }
      return ocultos;
    },
  });

  const aprovacoes = useQuery({
    queryKey: ["achados", "aprovacoes"],
    enabled: equipe,
    ...VIVO,
    queryFn: async () => {
      const linhas = await ler(
        db.from("files")
          .select("id, client_id, file_name, created_at")
          .eq("visibility", "approval")
          .eq("requires_approval", true)
          .eq("approval_status", "pending")
          .eq("status", "ready")
          .is("archived_at", null)
          .is("parent_file_id", null)
          .order("created_at", { ascending: true })
          .limit(1000),
      );
      return linhas.filter((f) => f.client_id).map((f) => ({ id: String(f.id), clienteId: String(f.client_id), nomeDoArquivo: String(f.file_name || ""), criadoEm: String(f.created_at) }));
    },
  });

  const anuncios = useQuery({
    queryKey: ["achados", "anuncios", seteDiasAtras],
    enabled: equipe,
    ...VIVO,
    queryFn: async () => {
      const [diario, verbas] = await Promise.all([
        ler(db.from("ads_campaign_daily").select("client_id, campaign_id, day, spend, actions").gte("day", seteDiasAtras)),
        ler(db.from("ads_wallet").select("client_id, balance")),
      ]);
      return {
        dias: diario.map((d) => ({ clienteId: String(d.client_id), campanhaId: String(d.campaign_id), dia: String(d.day).slice(0, 10), gasto: Number(d.spend) || 0, leads: contarLeadsDasAcoes(d.actions) })),
        verbas: verbas.map((v) => ({ clienteId: String(v.client_id), saldo: Number(v.balance) || 0 })),
      };
    },
  });

  const carteirasIa = useQuery({
    queryKey: ["achados", "carteiras-ia"],
    enabled: gestao,
    ...VIVO,
    queryFn: async () => {
      const linhas = await ler(db.from("ia_carteiras").select("client_id, saldo_usd, atualizado_em"));
      return linhas.map((c) => ({ clienteId: String(c.client_id), saldoUsd: Number(c.saldo_usd) || 0, atualizadoEm: (c.atualizado_em as string) || null }));
    },
  });

  // Mesma chave e mesma leitura da Central: os rituais marcados no Ciclo nesta semana.
  const rituais = useQuery({
    queryKey: ["cycle-rituals-central", segunda],
    enabled: equipe,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await db.from("cycle_rituals").select("client_id, ritual_key, source, done_at").eq("week_start", segunda);
      return (data ?? []) as Array<{ client_id: string; ritual_key: string; source: string; done_at: string }>;
    },
  });

  const clientes = useMemo<ClienteDoAchado[]>(() => {
    const ocultos = new Set<string>(Array.isArray(ocultosDoSocial.data) ? ocultosDoSocial.data : []);
    return ((Array.isArray(clients) ? clients : []) as Linha[])
      .filter((c) => !c.deleted_at)
      .map((c) => {
        const id = String(c.id);
        const tipo = String(c.client_type || "recurring");
        const plano = String(c.plan_status || "active");
        const sc = (c.services_config || {}) as Record<string, unknown>;
        return {
          id,
          nome: String(c.company_name || c.full_name || "Cliente"),
          recorrente: (plano === "active" || plano === "onboarding") && tipo !== "one_off" && !isInternalClient(c),
          social: plano === "active" && tipo !== "one_off" && sc.social === true && !ocultos.has(id),
        };
      });
  }, [clients, ocultosDoSocial.data]);

  const agoraMs = momento.getTime();
  const achados = useMemo<Achado[]>(() => {
    if (!equipe || clientes.length === 0) return [];
    const internos = new Set(((Array.isArray(clients) ? clients : []) as Linha[]).filter((c) => isInternalClient(c)).map((c) => String(c.id)));
    const dados: DadosDosAchados = {
      agora: agoraMs,
      hoje,
      segunda,
      clientes,
      leads: gestao && Array.isArray(leads.data) ? leads.data : null,
      propostas: gestao && Array.isArray(propostas.data) ? propostas.data : null,
      // Sem a lista de ocultos, "sem post" poderia acusar quem saiu da frente: espera as duas.
      publicacoes: Array.isArray(publicacoes.data) && Array.isArray(ocultosDoSocial.data) ? publicacoes.data : null,
      aprovacoes: Array.isArray(aprovacoes.data) ? aprovacoes.data : null,
      verbas: anuncios.data && Array.isArray(anuncios.data.verbas) ? anuncios.data.verbas : null,
      anuncios: anuncios.data && Array.isArray(anuncios.data.dias) ? anuncios.data.dias : null,
      carteirasIa: gestao && Array.isArray(carteirasIa.data) ? carteirasIa.data : null,
      cobrancas: gestao && Array.isArray(cobrancas.data)
        ? (cobrancas.data as Linha[]).filter((b) => !internos.has(String(b.client_id))).map((b) => ({ clienteId: String(b.client_id), status: String(b.status), tipo: (b.type as string) || null, vencimento: String(b.due_date || ""), valor: Number(b.amount) || 0 }))
        : null,
      rituaisFeitos: Array.isArray(rituais.data) ? rituais.data.map((r) => ({ clienteId: String(r.client_id), ritual: String(r.ritual_key) })) : null,
      clienteEmFoco,
    };
    return detectarAchados(dados);
  }, [equipe, gestao, clientes, clients, agoraMs, hoje, segunda, leads.data, propostas.data, publicacoes.data, ocultosDoSocial.data, aprovacoes.data, anuncios.data, carteirasIa.data, cobrancas.data, rituais.data, clienteEmFoco]);

  return { achados };
}
