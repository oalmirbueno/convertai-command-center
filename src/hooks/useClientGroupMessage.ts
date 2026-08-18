import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { readableFileName, readableProjectName } from "@/lib/clientText";
import {
  buildGroupMessageText,
  type GroupMessageContext,
  type GroupMoment,
} from "@/lib/groupMessage";
import { goalForCampaign, resultFromActions, statusLabel } from "@/lib/adsLanguage";
import { stepLabelsForWeek } from "@/lib/cycleTasks";
import { localIso, mondayOf } from "@/lib/cycleWeek";

/**
 * A mensagem do grupo de UM cliente, montada onde ela for precisa.
 *
 * A Central monta as mensagens de todos os clientes de uma vez, com consultas
 * em lote. O Ciclo precisa da mesma mensagem, mas de um cliente só — e quem
 * está no Ciclo acabou de marcar as etapas da semana, então é justamente ali
 * que a vontade de mandar o recado aparece.
 *
 * Duplicar o texto nas duas telas seria o começo do fim: elas divergem na
 * primeira correção que alguém fizer num lado só. Por isso as duas chamam a
 * MESMA biblioteca (src/lib/groupMessage.ts); o que muda aqui é apenas o
 * jeito de buscar os fatos — direcionado a um cliente, em vez de em lote.
 */

const diasDesde = (iso?: string | null): number => {
  if (!iso) return 999;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
};

export function useClientGroupMessage(client: any | null) {
  const { user } = useAuth();
  const clientId = client?.id as string | undefined;

  const segunda = mondayOf(new Date());
  const semanaKey = localIso(segunda);

  const { data, isLoading } = useQuery({
    queryKey: ["mensagem-grupo-cliente", clientId, semanaKey],
    queryFn: async () => {
      const desdeSemana = new Date(segunda);
      const proximaSegunda = new Date(segunda);
      proximaSegunda.setDate(proximaSegunda.getDate() + 7);
      const seteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString();

      // Uma ida só ao banco para tudo que a mensagem precisa daquele cliente.
      const [entregas, aprovacoes, publicacoes, projetos, ciclo, memoria, relatorios, adsDias, adsCampanhas, pautas] =
        await Promise.all([
          supabase.from("files")
            .select("file_name, created_at")
            .eq("client_id", clientId!).is("archived_at", null)
            .eq("visibility", "client").gte("created_at", seteDiasAtras)
            .order("created_at", { ascending: false }).limit(20),
          supabase.from("files")
            .select("file_name")
            .eq("client_id", clientId!).is("archived_at", null)
            .eq("approval_status", "pending").limit(10),
          supabase.from("editorial_publications")
            .select("status, scheduled_at, published_at")
            .eq("client_id", clientId!).in("status", ["scheduled", "published"]).limit(60),
          supabase.from("projects")
            .select("name, status")
            .eq("client_id", clientId!).is("deleted_at", null).neq("status", "done").limit(20),
          (supabase as any).from("weekly_cycle_progress")
            .select("area, step")
            .eq("client_id", clientId!).eq("week_start", semanaKey),
          (supabase as any).from("project_memory")
            .select("kind, title, content, metadata, created_at")
            .eq("client_id", clientId!)
            .order("created_at", { ascending: false }).limit(40),
          supabase.from("reports")
            .select("next_steps, created_at, status")
            .eq("client_id", clientId!).eq("status", "published")
            .order("created_at", { ascending: false }).limit(5),
          (supabase as any).from("ads_campaign_daily")
            .select("spend, actions, objective")
            .eq("client_id", clientId!).gte("day", localIso(segunda)),
          (supabase as any).from("ads_campaigns")
            .select("status, effective_status")
            .eq("client_id", clientId!),
          // O calendário editorial: peça pronta, com nome, que não depende da
          // janela de 7 dias dos arquivos. É a fonte que faltava — medindo a
          // carteira real, nenhum cliente tinha entrega nessa janela, e vários
          // tinham carrossel pronto esperando data.
          supabase.from("editorial_posts")
            .select("title, production_status")
            .eq("client_id", clientId!).is("archived_at", null)
            .in("production_status", ["ready", "production"])
            .order("updated_at", { ascending: false }).limit(8),
        ]);

      const nome = client.company_name || client.full_name || "time";

      const arquivosSemana = (entregas.data || []) as any[];
      const entregasSemana = arquivosSemana.map((f) => readableFileName(f.file_name));
      const entregasDesdeSegunda = arquivosSemana
        .filter((f) => f.created_at && new Date(f.created_at) >= desdeSemana)
        .map((f) => readableFileName(f.file_name));

      const pubs = (publicacoes.data || []) as any[];
      const publicadasSemana = pubs.filter(
        (p) => p.status === "published" && p.published_at && new Date(p.published_at) >= desdeSemana,
      ).length;
      const proximasAgendadas = pubs
        .filter(
          (p) => p.status === "scheduled" && p.scheduled_at &&
            new Date(p.scheduled_at) > new Date() && new Date(p.scheduled_at) < proximaSegunda,
        )
        .map((p) => new Date(p.scheduled_at))
        .sort((a, b) => a.getTime() - b.getTime())
        .map((d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));

      // As etapas do ciclo desta semana, nas palavras daquele cliente.
      const cicloFeito: string[] = [];
      for (const area of ["social", "trafego"] as const) {
        const marcados = ((ciclo as any).data || []).filter(
          (r: any) => r.area === area && r.step <= 6,
        );
        if (marcados.length === 0) continue;
        const rotulos = stepLabelsForWeek(area, clientId!, semanaKey, {
          services: client.services_config,
        });
        for (const row of marcados) {
          const rotulo = rotulos[row.step - 1];
          if (rotulo) cicloFeito.push(rotulo.replace(/\s*\(.*?\)\s*/g, "").toLowerCase());
        }
      }

      const registros = ((memoria as any).data || []) as any[];
      const avulsosFeitos = registros
        .filter((m) => m.kind === "avulso" && m.metadata?.week_start === semanaKey && m.metadata?.done === true)
        .map((m) => String(m.title || "").toLowerCase())
        .filter(Boolean);

      const CONTEXTO = new Set([
        "decisao", "nota", "marco", "note", "summary", "decision", "fact", "second_brain", "external",
      ]);
      const contexto = registros.find(
        (m) => CONTEXTO.has(m.kind) && diasDesde(m.created_at) <= 14,
      );
      const contextoRecente = contexto
        ? String(contexto.title || contexto.content || "").slice(0, 160).trim() || null
        : null;

      const comPasso = ((relatorios.data || []) as any[]).find(
        (r) => String(r.next_steps || "").trim() && diasDesde(r.created_at) <= 21,
      );
      const proximoPasso = comPasso
        ? String(comPasso.next_steps).split(/\n/)[0].slice(0, 160).trim()
        : null;

      // Anúncios: só entra se houver campanha ou gasto de verdade.
      const dias = ((adsDias as any).data || []) as any[];
      const campanhasNoAr = (((adsCampanhas as any).data || []) as any[]).filter(
        (c) => statusLabel(c.status, c.effective_status).noAr,
      ).length;
      let anuncios: GroupMessageContext["anuncios"] = null;
      if (dias.length > 0 || campanhasNoAr > 0) {
        const todasAcoes = dias.flatMap((d) => (Array.isArray(d.actions) ? d.actions : []));
        const meta = goalForCampaign(dias[0]?.objective ?? null, todasAcoes);
        let investido = 0;
        let resultados = 0;
        let temResultado = false;
        for (const d of dias) {
          investido += Number(d.spend || 0);
          const achado = resultFromActions(d.actions, d.objective, meta);
          if (achado) { resultados += achado.count; temResultado = true; }
        }
        anuncios = {
          campanhasNoAr,
          investidoSemana: investido,
          resultadosSemana: temResultado ? resultados : null,
          nomeDoResultado: meta.resultPlural,
        };
      }

      const contexto_: GroupMessageContext = {
        clientName: nome,
        greeting: (() => {
          const h = new Date().getHours();
          return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
        })(),
        entregasSemana,
        entregasDesdeSegunda,
        aguardandoOk: ((aprovacoes.data || []) as any[]).map((f) => readableFileName(f.file_name)),
        publicadasSemana,
        proximasAgendadas,
        cicloFeito,
        avulsosFeitos,
        frentes: ((projetos.data || []) as any[])
          .map((p) => readableProjectName(p.name, nome))
          .filter(Boolean),
        // Só o que está "ready" entra na mensagem: peça em produção ainda não
        // é promessa que se possa fazer ao cliente.
        pautasProntas: ((pautas as any).data || [])
          .filter((linha: any) => linha.production_status === "ready")
          .map((linha: any) => readableFileName(String(linha.title || "")))
          .filter(Boolean),
        contextoRecente,
        proximoPasso,
        anuncios,
      };
      return contexto_;
    },
    enabled: !!user && !!clientId,
    staleTime: 30_000,
  });

  const montar = (momento: GroupMoment): string | null =>
    data ? buildGroupMessageText(data, momento) : null;

  return { contexto: data ?? null, montar, isLoading };
}

