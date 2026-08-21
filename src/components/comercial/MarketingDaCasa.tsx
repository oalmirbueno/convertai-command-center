import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isInternalClient } from "@/lib/clientFlags";
import {
  type Campanha,
  type Lead,
  dinheiro,
  proximoMes,
} from "@/lib/comercial";

/**
 * O marketing da propria casa.
 *
 * Nao e um calendario novo: a Aceleriq ja e cliente dentro do painel, e o
 * conteudo dela ja mora na Agenda editorial junto com o dos outros. Fazer
 * uma segunda tela de conteudo aqui criaria dois lugares para a mesma
 * pergunta, e no primeiro conserto os dois divergiriam.
 *
 * O que esta area responde e o que so ela pode responder: a casa esta se
 * mexendo pela propria marca? Quanto isso custou? E de onde as pessoas
 * estao chegando? A ultima e a ponte entre marketing e CRM, e sai do proprio
 * funil: origem do lead nao e palpite, e o que foi anotado quando ele entrou.
 */

interface Props {
  leads: Lead[];
  campanhas: Campanha[];
  periodo: string;
}

const ROTULO_DA_ORIGEM: Record<string, string> = {
  indicacao: "Indicação",
  instagram: "Instagram",
  quiz: "Diagnóstico",
  prospeccao: "Prospecção",
  evento: "Evento",
  site: "Site",
  manual: "Cadastro manual",
};

export default function MarketingDaCasa({ leads, campanhas, periodo }: Props) {
  const fim = proximoMes(periodo);

  /**
   * O conteudo da propria casa, lido de onde ele ja vive.
   *
   * `internal_company` e a bandeira que marca as empresas do grupo. Sem ela
   * a consulta traria o conteudo de todo mundo, e a tela do comercial
   * passaria a falar de cliente, que nao e o assunto dela.
   */
  const { data: conteudo } = useQuery({
    queryKey: ["marketing-da-casa", periodo],
    queryFn: async () => {
      const { data: perfis } = await supabase
        .from("profiles")
        .select("id, company_name, full_name, services_config")
        .is("deleted_at", null);
      const daCasa = ((perfis || []) as Array<Record<string, unknown>>).filter(
        (p) => isInternalClient(p),
      );
      if (daCasa.length === 0) return { agendadas: 0, publicadas: 0, nomes: [] as string[] };

      const ids = daCasa.map((p) => String(p.id));
      const { data: publicacoes } = await supabase
        .from("editorial_publications")
        .select("id, status, scheduled_at")
        .in("client_id", ids)
        .gte("scheduled_at", periodo)
        .lt("scheduled_at", fim);

      const linhas = (publicacoes || []) as Array<{ status: string }>;
      return {
        agendadas: linhas.filter((l) => l.status === "scheduled" || l.status === "planned")
          .length,
        publicadas: linhas.filter(
          (l) => l.status === "published" || l.status === "partially_published",
        ).length,
        nomes: daCasa.map((p) => String(p.company_name || p.full_name || "Casa")),
      };
    },
  });

  const investido = useMemo(
    () => campanhas.reduce((soma, c) => soma + c.spent, 0),
    [campanhas],
  );

  const porOrigem = useMemo(() => {
    const noMes = leads.filter(
      (lead) => lead.created_at >= periodo && lead.created_at < fim,
    );
    const conta = new Map<string, { total: number; ganhos: number }>();
    for (const lead of noMes) {
      const atual = conta.get(lead.origin) || { total: 0, ganhos: 0 };
      atual.total += 1;
      if (lead.stage === "ganho") atual.ganhos += 1;
      conta.set(lead.origin, atual);
    }
    return [...conta.entries()]
      .map(([origem, dados]) => ({ origem, ...dados }))
      .sort((a, b) => b.total - a.total);
  }, [leads, periodo, fim]);

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Cartao
          titulo="Conteúdo no ar"
          valor={String(conteudo?.publicadas ?? 0)}
          apoio="publicações da casa no mês"
        />
        <Cartao
          titulo="Já agendado"
          valor={String(conteudo?.agendadas ?? 0)}
          apoio="esperando a data chegar"
        />
        <Cartao
          titulo="Investido"
          valor={dinheiro(investido)}
          apoio="somando as campanhas"
        />
      </div>

      <div className="rounded-2xl border border-border bg-card p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              O conteúdo da casa
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {conteudo && conteudo.nomes.length > 0
                ? `Ele vive na Agenda editorial, junto com o dos clientes: ${conteudo.nomes.join(", ")}. Aqui fica só o retrato, para não existirem dois lugares com a mesma resposta.`
                : "Nenhuma empresa do grupo está marcada como interna no cadastro, então não há conteúdo da casa para mostrar."}
            </p>
          </div>
          <Link
            to="/calendario"
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-[11.5px] font-semibold text-primary hover:bg-secondary"
          >
            Abrir agenda
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-3.5">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Megaphone className="h-3.5 w-3.5 text-primary" />
          De onde as pessoas chegaram
        </p>
        {/* A ponte entre marketing e CRM. Sai do proprio funil: a origem do
            lead foi anotada quando ele entrou, nao e palpite depois. */}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Leads que entraram no mês, pela origem anotada no cadastro.
        </p>

        <div className="mt-2.5 space-y-1.5">
          {porOrigem.map((linha) => (
            <div
              key={linha.origem}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                {ROTULO_DA_ORIGEM[linha.origem] || linha.origem}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {linha.total} {linha.total === 1 ? "lead" : "leads"}
                {linha.ganhos > 0 && (
                  <span className="ml-1.5 font-semibold text-success">
                    {linha.ganhos} fechou
                  </span>
                )}
              </span>
            </div>
          ))}
          {porOrigem.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[10.5px] text-muted-foreground">
              Nenhum lead entrou neste mês.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Cartao({
  titulo,
  valor,
  apoio,
}: {
  titulo: string;
  valor: string;
  apoio: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-2.5">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {titulo}
      </p>
      <p className="mt-0.5 truncate text-[15px] font-bold tabular-nums text-foreground">
        {valor}
      </p>
      <p className="truncate text-[10px] text-muted-foreground">{apoio}</p>
    </div>
  );
}
