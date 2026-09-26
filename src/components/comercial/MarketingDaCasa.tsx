import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isInternalClient } from "@/lib/clientFlags";
import { AreaDeTrabalho, EstadoVazio, Painel, Secao, botao, juntar, texto } from "@/components/sistema";
import {
  type Campanha,
  type Lead,
  dinheiro,
  proximoMes,
} from "@/lib/comercial";
import { FaixaDeNumeros } from "@/components/sistema";

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

  return (
    <AreaDeTrabalho rotuloDoPrincipal="Marketing da casa" memoriaDaRolagem="comercial:marketing">
      <div className="min-w-0 space-y-6">
        <FaixaDeNumeros
          tamanho="compacto"
          apoioAoLado
          rotulo="Números do marketing da casa"
          itens={[
            { rotulo: "Conteúdo no ar", valor: carregando ? "…" : String(conteudo.publicadas), apoio: "no mês" },
            { rotulo: "Já agendado", valor: carregando ? "…" : String(conteudo.agendadas), apoio: "esperando a data" },
            { rotulo: "Investido", valor: dinheiro(investido), apoio: "somando as campanhas" },
          ]}
        />

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
            <Link to="/calendario" className={botao.secundario} aria-label="Abrir a Agenda editorial">
              <span className="hidden sm:inline">Abrir agenda</span>
              <ArrowUpRight className="h-3.5 w-3.5 sm:ml-1.5" aria-hidden="true" />
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
            <Painel semEspaco>
              <ul className="divide-y divide-border">
                {porOrigem.map((linha) => (
                  <li key={linha.origem} className="flex min-w-0 items-center px-4 py-2.5">
                    <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate font-medium")}>
                      {ROTULO_DA_ORIGEM[linha.origem] || linha.origem}
                    </span>
                    {linha.ganhos > 0 && (
                      <span className="mr-3 shrink-0 text-[12px] font-medium tabular-nums text-success">
                        {linha.ganhos} fechou
                      </span>
                    )}
                    <span className={juntar(texto.auxiliar, "w-16 shrink-0 text-right tabular-nums")}>
                      {linha.total} {linha.total === 1 ? "lead" : "leads"}
                    </span>
                  </li>
                ))}
              </ul>
            </Painel>
          )}
        </Secao>
      </div>
    </AreaDeTrabalho>
  );
}
