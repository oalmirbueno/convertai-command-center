import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, ChevronDown, Flame, Lightbulb, MousePointerClick,
} from "lucide-react";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import { Carregando, EstadoDeErro, Painel, Secao, botao, foco, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import {
  recomendar, resumirCampanha,
  type CampanhaAtiva, type DiaDaCampanha, type Gravidade,
} from "@/lib/recomendacoesDeAnuncios";

/**
 * O que está rodando AGORA, e o que fazer a respeito.
 *
 * A área de anúncios mostrava números acumulados sem dizer o que está no
 * ar neste momento nem o que eles pedem. Número sem recomendação é
 * relatório; recomendação sem número é palpite. Aqui os dois andam juntos:
 * cada aviso traz a conta que o gerou.
 *
 * Sistema de design (26/09): uma seção sem caixa em volta, o "agora" numa
 * linha de estado, os avisos numa lista com divisória (nada de um cartão por
 * aviso) e as campanhas ativas recolhidas no pé do mesmo painel.
 */

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;
const inteiro = (v: number) => v.toLocaleString("pt-BR");

const COR_DO_ICONE: Record<Gravidade, string> = {
  alta: "text-destructive",
  media: "text-warning",
  baixa: "text-muted-foreground",
};
const ICONE: Record<Gravidade, typeof AlertTriangle> = {
  alta: AlertTriangle,
  media: Flame,
  baixa: Lightbulb,
};

export default function CampanhasAtivas({
  clientId,
  nomesDeClientes,
  aoAbrirCliente,
}: {
  clientId?: string;
  /** client_id -> nome. Sem isto a lista mistura campanhas de todo mundo. */
  nomesDeClientes?: Map<string, string>;
  aoAbrirCliente?: (clientId: string) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: identidades } = useIdentidadesDosClientes();

  const { data, error, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["campanhas-ativas", clientId ?? "todas"],
    queryFn: async () => {
      let q = (supabase as any).from("ads_campaigns")
        .select("campaign_id, name, effective_status, objective, daily_budget, lifetime_budget, client_id, updated_at");
      if (clientId) q = q.eq("client_id", clientId);
      const { data: campanhas, error: erroCampanhas } = await q;
      if (erroCampanhas) throw new Error(erroCampanhas.message);

      let qd = (supabase as any).from("ads_campaign_daily")
        .select("campaign_id, day, spend, impressions, clicks, link_clicks, ctr, cpc, frequency")
        .gte("day", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
      if (clientId) qd = qd.eq("client_id", clientId);
      const { data: dias, error: erroDias } = await qd;
      if (erroDias) throw new Error(erroDias.message);

      return {
        campanhas: (campanhas || []) as Array<CampanhaAtiva & { client_id: string }>,
        dias: (dias || []) as DiaDaCampanha[],
      };
    },
    // O dono pediu tempo real. Um minuto é o intervalo em que a Meta
    // realmente atualiza; pedir mais rápido gastaria chamada sem trazer
    // número novo. A releitura mantém o dado na tela (nada pisca).
    refetchInterval: 60_000,
  });

  const ativas = useMemo(
    () => (data?.campanhas ?? []).filter(
      (c) => (c.effective_status || "").toUpperCase() === "ACTIVE"),
    [data],
  );

  /** De qual cliente é uma campanha: o aviso sem dono não diz onde agir. */
  const nomeDoClienteDaCampanha = (campaignId: string) => {
    const c = (data?.campanhas ?? []).find((x) => x.campaign_id === campaignId);
    return c ? nomesDeClientes?.get((c as any).client_id) ?? null : null;
  };

  const recomendacoes = useMemo(
    () => data ? recomendar(data.campanhas, data.dias, hoje) : [],
    [data, hoje],
  );

  /**
   * As campanhas ativas agrupadas por CLIENTE.
   *
   * Uma lista corrida com uma etiqueta pequena em cada linha ainda obriga
   * a ler linha por linha para saber de quem é. Agrupar responde a
   * pergunta antes dela ser feita, e é ela que o dono fez: "não consigo
   * entender qual campanha está ativa de qual cliente".
   *
   * A ordem é por gasto de 14 dias: quem consome mais dinheiro merece o
   * primeiro olhar.
   */
  const porCliente = useMemo(() => {
    const grupos = new Map<string, typeof ativas>();
    for (const c of ativas) {
      const id = (c as any).client_id as string;
      const atual = grupos.get(id);
      if (atual) atual.push(c);
      else grupos.set(id, [c]);
    }
    return [...grupos.entries()]
      .map(([id, lista]) => ({
        clientId: id,
        nome: nomesDeClientes?.get(id) ?? "Cliente",
        campanhas: lista,
        gasto: lista.reduce(
          (s, c) => s + resumirCampanha(data?.dias ?? [], c.campaign_id, 14, hoje).gasto, 0),
      }))
      .sort((a, b) => b.gasto - a.gasto || a.nome.localeCompare(b.nome));
  }, [ativas, nomesDeClientes, data, hoje]);

  const clientesAtivos = porCliente;

  const totalHoje = useMemo(() => {
    if (!data) return { gasto: 0, impressoes: 0, cliques: 0 };
    const doDia = data.dias.filter((d) => String(d.day).slice(0, 10) === hoje);
    return {
      gasto: doDia.reduce((s, d) => s + Number(d.spend || 0), 0),
      impressoes: doDia.reduce((s, d) => s + Number(d.impressions || 0), 0),
      cliques: doDia.reduce((s, d) => s + Number(d.clicks || 0), 0),
    };
  }, [data, hoje]);

  // A lista aberta ou fechada não se perde ao sair e voltar.
  const [listaAberta, setListaAberta] = useEstadoDaTela(`anuncios:ativas:${clientId || "todas"}`, false, {
    validar: (v) => typeof v === "boolean",
  });

  const ajuda =
    "O que está rodando agora e o que fazer a respeito. Cada aviso traz o número que o gerou, e os avisos só aparecem com volume suficiente para não confundir ruído com sinal. Atualiza sozinho a cada minuto.";

  if (error && !data) {
    return (
      <Secao divisoria titulo="No ar agora" ajuda={ajuda}>
        <EstadoDeErro
          titulo="Não consegui ler as campanhas."
          descricao={`${error instanceof Error ? error.message : String(error)}. Nenhuma campanha está sendo dada como parada: a leitura falhou.`}
          acao={
            <button type="button" onClick={() => refetch()} className={botao.secundario}>
              Tentar de novo
            </button>
          }
        />
      </Secao>
    );
  }
  if (isLoading) {
    return (
      <Secao divisoria titulo="No ar agora" ajuda={ajuda}>
        <Carregando rotulo="Lendo as campanhas" linhas={2} />
      </Secao>
    );
  }

  // DE QUEM são estes números. Totais sem escopo fazem quem lê achar que é
  // de um cliente só, e decidir errado por isso.
  const escopo = clientId
    ? (nomesDeClientes?.get(clientId) ?? "este cliente")
    : `todos os clientes · ${clientesAtivos.length}`;
  const hora = new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <Secao
      divisoria
      titulo="No ar agora"
      ajuda={ajuda}
      descricao={
        <span className="block truncate">
          {escopo} · {ativas.length} {ativas.length === 1 ? "campanha ativa" : "campanhas ativas"} · hoje{" "}
          <span className="tabular-nums text-foreground">{dinheiro(totalHoje.gasto)}</span>, {inteiro(totalHoje.impressoes)} exibições,{" "}
          {inteiro(totalHoje.cliques)} cliques · {hora}
        </span>
      }
    >
      {totalHoje.impressoes === 0 && ativas.length > 0 && (
        /* Zero hoje não é zero sempre: a Meta consolida o dia com atraso,
           e chamar isso de "parado" às 9h da manhã seria alarme falso. */
        <p className={juntar(texto.auxiliar, "-mt-1 mb-3 truncate")}>
          Sem números de hoje ainda: a Meta consolida o dia com algumas horas de atraso.
        </p>
      )}

      <Painel
        semEspaco
        className="overflow-hidden"
        titulo={
          <span className="flex items-center">
            <Lightbulb className="mr-1.5 h-3.5 w-3.5 text-warning" aria-hidden="true" /> O que fazer
            {recomendacoes.length > 0 && (
              <span className="ml-2 rounded bg-warning/15 px-1.5 text-[11px] font-semibold leading-5 tabular-nums text-warning">{recomendacoes.length}</span>
            )}
          </span>
        }
      >
        {/* O QUE FAZER, cada aviso com a conta que o gerou. */}
        {recomendacoes.length === 0 ? (
          <p className={juntar(texto.auxiliar, "px-4 py-3")}>Nada pede ação agora.</p>
        ) : (
          <ul className="min-w-0 divide-y divide-border">
            {recomendacoes.map((r, i) => {
              const Icone = ICONE[r.gravidade];
              const cliente = !clientId ? nomeDoClienteDaCampanha(r.campaign_id) : null;
              return (
                <li key={`${r.campaign_id}-${i}`} className="flex min-w-0 items-start px-4 py-2.5">
                  <Icone className={juntar("mr-2.5 mt-0.5 h-4 w-4 shrink-0", COR_DO_ICONE[r.gravidade])} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{r.titulo}</p>
                    <p className={juntar(texto.auxiliar, "truncate")}>
                      {cliente && <span className="font-medium text-foreground/80">{cliente} · </span>}
                      {r.campanha}
                    </p>
                    {/* O NÚMERO e a ação. Sem o número o aviso vira palpite. */}
                    <p className="mt-0.5 text-[12.5px] leading-5 text-foreground/90">
                      {r.porque} <span className="text-muted-foreground">{r.acao}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* AS CAMPANHAS ATIVAS, recolhidas no pé: abrem com um clique. */}
        {ativas.length > 0 && (
          <div className="border-t border-border">
            <button
              type="button"
              onClick={() => setListaAberta((v) => !v)}
              aria-expanded={listaAberta}
              className={juntar("flex w-full items-center px-4 py-2.5 text-left text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground", foco)}
            >
              <ChevronDown className={juntar("mr-1.5 h-4 w-4 transition-transform", listaAberta ? "rotate-180" : "")} aria-hidden="true" />
              {listaAberta ? "Esconder" : "Ver"} as campanhas ativas · últimos 14 dias
            </button>
            {listaAberta && (
              <div className="min-w-0 border-t border-border">
                {porCliente.map((grupo) => (
                  <div key={grupo.clientId} className="min-w-0">
                    {/* O cliente como cabeçalho do grupo, e não como etiqueta miúda. */}
                    {!clientId && (
                      <button
                        type="button"
                        onClick={() => aoAbrirCliente?.(grupo.clientId)}
                        className={juntar("flex w-full min-w-0 items-center bg-muted/40 px-4 py-2 text-left transition-colors hover:bg-muted", foco)}
                      >
                        <LogoDoCliente
                          url={identidades?.get(grupo.clientId)?.profile_picture_url}
                          nome={grupo.nome}
                          tamanho={22}
                          className="mr-2"
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">
                          {grupo.nome}
                        </span>
                        <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>
                          {grupo.campanhas.length} ativa{grupo.campanhas.length > 1 ? "s" : ""}
                          {grupo.gasto > 0 && ` · ${dinheiro(grupo.gasto)} em 14 dias`}
                        </span>
                      </button>
                    )}
                    <ul className="min-w-0 divide-y divide-border">
                      {grupo.campanhas.map((c) => {
                        const r = resumirCampanha(data!.dias, c.campaign_id, 14, hoje);
                        const temAviso = recomendacoes.some((x) => x.campaign_id === c.campaign_id);
                        return (
                          <li
                            key={c.campaign_id}
                            role={aoAbrirCliente ? "button" : undefined}
                            tabIndex={aoAbrirCliente ? 0 : undefined}
                            onClick={() => aoAbrirCliente?.((c as any).client_id)}
                            onKeyDown={(e) => {
                              if (!aoAbrirCliente || (e.key !== "Enter" && e.key !== " ")) return;
                              e.preventDefault();
                              aoAbrirCliente((c as any).client_id);
                            }}
                            className={juntar(
                              "min-w-0 px-4 py-2",
                              aoAbrirCliente && "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            )}
                          >
                            <div className="flex min-w-0 items-center">
                              <span className={juntar("mr-2 h-1.5 w-1.5 shrink-0 rounded-full", temAviso ? "bg-warning" : "bg-success")} aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                                {c.name || c.campaign_id}
                              </span>
                              <span className="ml-2 shrink-0 text-[12.5px] tabular-nums text-foreground">{dinheiro(r.gasto)}</span>
                            </div>
                            <p className={juntar(texto.auxiliar, "mt-0.5 flex flex-wrap pl-3.5 tabular-nums [&>*]:mr-3")}>
                              <span>{inteiro(r.impressoes)} exibições</span>
                              <span className="inline-flex items-center">
                                <MousePointerClick className="mr-1 h-3 w-3" aria-hidden="true" />
                                {inteiro(r.cliques)} cliques · CTR {pct(r.ctr)}
                              </span>
                              {r.cpc > 0 && <span>CPC {dinheiro(r.cpc)}</span>}
                              {r.frequencia > 0 && (
                                <span className={juntar(r.frequencia >= 3.5 && "font-semibold text-warning")}>
                                  freq. {r.frequencia.toFixed(1)}
                                </span>
                              )}
                              {c.daily_budget ? <span>teto {dinheiro(Number(c.daily_budget))}/dia</span> : null}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Painel>
    </Secao>
  );
}
