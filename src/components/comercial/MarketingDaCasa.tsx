import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isInternalClient } from "@/lib/clientFlags";
import { AreaDeTrabalho, EstadoVazio, Secao, botao, juntar, texto } from "@/components/sistema";
import {
  type Campanha,
  type Lead,
  dinheiro,
  proximoMes,
} from "@/lib/comercial";
import { Card, Donut, ProgressBar, StatCard, StatGrid, chartColor } from "@/components/ds";

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
  maquina_de_leads: "Máquina de leads",
  checkout: "Checkout",
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
    // Trocar de mês não apaga os números da tela enquanto o novo chega.
    placeholderData: (anterior) => anterior,
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

  const carregando = conteudo === undefined;
  const totalDoMes = porOrigem.reduce((s, l) => s + l.total, 0);

  return (
    <AreaDeTrabalho rotuloDoPrincipal="Marketing da casa" memoriaDaRolagem="comercial:marketing">
      <div className="min-w-0 space-y-6 sm:space-y-8">
        {/* Rodada ousada (15/11/2026): os três números em cartões; o publicado sobre o planejado do mês vira barra. */}
        <StatGrid cols={3} label="Números do marketing da casa">
          <StatCard
            variant="accent"
            label="Conteúdo no ar"
            value={carregando ? "…" : String(conteudo.publicadas)}
            hint="no mês"
            chart={!carregando && conteudo.publicadas + conteudo.agendadas > 0 ? <ProgressBar value={conteudo.publicadas} max={conteudo.publicadas + conteudo.agendadas} tone="current" striped label={`${conteudo.publicadas} no ar de ${conteudo.publicadas + conteudo.agendadas} do mês`} /> : undefined}
          />
          <StatCard label="Já agendado" value={carregando ? "…" : String(conteudo.agendadas)} hint="esperando a data" />
          <StatCard variant="ink" className="max-lg:col-span-2" label="Investido" value={dinheiro(investido)} hint="somando as campanhas" />
        </StatGrid>

        <Secao
          titulo="O conteúdo da casa"
          descricao={
            carregando
              ? "Lendo a Agenda editorial"
              : conteudo.nomes.length > 0
                ? `Na Agenda editorial: ${conteudo.nomes.join(", ")}`
                : "Nenhuma empresa do grupo marcada como interna"
          }
          ajuda="O conteúdo da casa vive na Agenda editorial, junto com o dos clientes. Aqui fica só o retrato, para não existirem dois lugares com a mesma resposta. A empresa entra aqui quando está marcada como interna no cadastro."
          acao={
            <Link to="/calendario" className={botao.icone} aria-label="Abrir a Agenda editorial" title="Abrir a Agenda editorial">
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        />

        {/* A ponte entre marketing e CRM. Sai do proprio funil: a origem do
            lead foi anotada quando ele entrou, nao e palpite depois. */}
        <Secao
          titulo="De onde as pessoas chegaram"
          descricao={`${porOrigem.reduce((s, l) => s + l.total, 0)} leads no mês`}
          ajuda="Leads que entraram no mês, pela origem anotada no cadastro."
        >
          {porOrigem.length === 0 ? (
            <EstadoVazio compacto titulo="Nenhum lead entrou neste mês." />
          ) : (
            <Card>
              <div className="flex min-w-0 flex-col items-center lg:flex-row lg:items-start">
                <Donut segments={porOrigem.map((l) => ({ label: ROTULO_DA_ORIGEM[l.origem] || l.origem, value: l.total }))} size={156} thickness={18} className="mb-5 lg:mb-0 lg:mr-8" label="Leads do mês por origem">
                  <span className="block text-[28px] font-semibold leading-8 tracking-[-0.03em] tabular-nums">{totalDoMes}</span>
                  <span className="block text-[11px] font-medium leading-4 text-muted-foreground">{totalDoMes === 1 ? "lead" : "leads"}</span>
                </Donut>
                <ul className="w-full min-w-0 flex-1 divide-y divide-border/60">
                  {porOrigem.map((linha, i) => (
                    <li key={linha.origem} className="min-w-0 py-3">
                      <div className="flex min-w-0 items-center">
                        <span aria-hidden="true" className="mr-2.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: chartColor(undefined, i) }} />
                        <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate font-medium")}>
                          {ROTULO_DA_ORIGEM[linha.origem] || linha.origem}
                        </span>
                        {linha.ganhos > 0 && (
                          <span className="mr-3 inline-flex h-6 shrink-0 items-center rounded-full bg-success-soft px-2.5 text-[12px] font-medium tabular-nums text-success">
                            {linha.ganhos} fechou
                          </span>
                        )}
                        <span className="w-16 shrink-0 text-right text-[13px] font-semibold tabular-nums text-foreground">
                          {linha.total} {linha.total === 1 ? "lead" : "leads"}
                        </span>
                      </div>
                      <ProgressBar className="mt-2" value={linha.total} max={totalDoMes} height={6} tone={((i % 5) + 1) as 1 | 2 | 3 | 4 | 5} label={`${ROTULO_DA_ORIGEM[linha.origem] || linha.origem}: ${linha.total} de ${totalDoMes} leads`} />
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}
        </Secao>
      </div>
    </AreaDeTrabalho>
  );
}
