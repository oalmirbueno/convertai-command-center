import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Newspaper, RefreshCw } from "lucide-react";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import Etapas from "@/components/sistema/Etapas";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { texto } from "@/components/sistema/estilos";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { Cronometro } from "./Cronometro";
import { ganchoDaDescricao } from "./momentoDoGancho";
import { dadosDoTrendy, itensDoTrendy, separarLeitura } from "./trendy";
import { supabase } from "@/integrations/supabase/client";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import AreaDoHype from "./AreaDoHype";
import AreaDoTrending from "./AreaDoTrending";
import BarraDeJuntar from "./BarraDeJuntar";
import { datasDasProximasSemanas } from "./datasDoHype";
import { alternarJuntado, sementeDaSelecao, type ItemJuntado } from "./hypeETrending";
import { guardarSementeDaCampanha } from "./sementeDaCampanha";
import { buscarHypes, chaves, hojeIso, lerHypes, partesDosHypes, periodoCurto, segundaDaSemanaIso, useMidia } from "./mesaV4Api";

/**
 * Hype e Trending no Mês (21/10/2026, dono: "coloque a área de hype e a de trending, que é diferente, igual
 * do MyPostFlow, e deixe bem intuitivo e organizado").
 *
 * - HYPE: datas e eventos que vêm por aí (calendário fixo em datasDoHype.ts, com a janela e a linha do tempo
 *   de 8 semanas) e os hypes da leitura semanal (tipo hype).
 * - TRENDING: o que está em alta AGORA: manchetes reais (agente-calendario/buscar_trending, Google Notícias)
 *   e o "em alta no nicho" da leitura semanal (tipo nicho).
 *
 * Computador largo: as duas lado a lado; celular e tablet: abas de ícone. Cada item tem a caixinha "juntar";
 * a barra embaixo grava a semente (sementeDaCampanha.ts) e abre a campanha nova na aba Campanhas.
 *
 * A leitura semanal (buscar_hypes, pesquisa na web + Jev) continua uma por semana, no botão do cabeçalho.
 */

const CHAVE_RECOLHIDO = "mesa:hypes:recolhido";

function lerRecolhido(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_RECOLHIDO) === "1";
  } catch {
    return false;
  }
}

/** 17/10: ganchos já gravados na agenda; o item da leitura cujo título aparece num deles sai da lista. */
async function lerGanchosNaAgenda(clientId: string): Promise<string[]> {
  const db = supabase as any;
  const { data: projetos, error: e1 } = await db.from("projects").select("id").eq("client_id", clientId).is("deleted_at", null).limit(200);
  if (e1) throw e1;
  const ids = ((projetos || []) as { id: string }[]).map((p) => p.id);
  if (!ids.length) return [];
  const desde = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db.from("tasks").select("description").in("project_id", ids).is("deleted_at", null)
    .gte("due_date", desde).ilike("description", "%Gancho do momento:%").limit(300);
  if (error) throw error;
  return ((data || []) as { description: string | null }[])
    .map((t) => ganchoDaDescricao(t.description) || "")
    .filter(Boolean);
}

export default function HypesDaSemana({
  onCriarCampanha,
  onPedidoInicio,
  onPedidoFim,
}: {
  /** Abre a aba Campanhas na campanha nova (a semente já foi gravada por aqui). */
  onCriarCampanha?: () => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [recolhido, setRecolhido] = useRecolhido(`mesa:mes:hypes:${clientId}`, lerRecolhido());
  const [aba, setAba] = useState<"hype" | "trending">("hype");
  const largo = useMidia("(min-width: 1280px)");
  const [buscandoDesde, setBuscandoDesde] = useState<number | null>(null);
  // Seleção por cliente: trocar de cliente nunca leva itens do anterior.
  const [selecao, setSelecao] = useState<{ clientId: string; itens: ItemJuntado[]; pedido: string }>({ clientId, itens: [], pedido: "" });
  const juntados = selecao.clientId === clientId ? selecao.itens : [];
  const pedido = selecao.clientId === clientId ? selecao.pedido : "";

  const hoje = hojeIso();
  const hypes = useQuery({ queryKey: chaves.hypes(clientId), queryFn: () => lerHypes(clientId) });
  const naAgenda = useQuery({ queryKey: ["mesa", "hypes-na-agenda", clientId], queryFn: () => lerGanchosNaAgenda(clientId), staleTime: 30_000, retry: false });
  const dados = dadosDoTrendy(hypes.data, clientId);
  const daSemana = !!dados && dados.semana === segundaDaSemanaIso(hoje);
  const leitura = separarLeitura(itensDoTrendy(dados ? dados.itens : [], naAgenda.data || []));
  const pesquisadoEm = dados && dados.criado_em ? dados.criado_em.slice(0, 10) : null;
  const proximas = useMemo(() => datasDasProximasSemanas(hoje, 8).filter((d) => d.tipo === "varejo" || d.tipo === "cultural").slice(0, 3).map((d) => d.titulo), [hoje]);

  const alternar = (item: ItemJuntado) => setSelecao({ clientId, itens: alternarJuntado(juntados, item), pedido });
  const abrirCampanha = (itens: ItemJuntado[], texto: string) => {
    guardarSementeDaCampanha(clientId, sementeDaSelecao(itens, texto));
    setSelecao({ clientId, itens: [], pedido: "" });
    if (onCriarCampanha) onCriarCampanha();
  };

  const buscar = async (forcar: boolean) => {
    setBuscandoDesde(Date.now());
    try {
      const data = await buscarHypes(clientId, forcar);
      if (data && data.hypes) queryClient.setQueryData(chaves.hypes(clientId), { ...data.hypes, itens: Array.isArray(data.hypes.itens) ? data.hypes.itens : [] });
      return data;
    } finally {
      setBuscandoDesde(null);
    }
  };

  const linhaDeEstado = [
    juntados.length ? `${juntados.length} para juntar` : "",
    dados ? (daSemana ? `leitura de ${pesquisadoEm ? `${pesquisadoEm.slice(8, 10)}/${pesquisadoEm.slice(5, 7)}` : "esta semana"}` : `leitura da semana de ${periodoCurto(dados.semana)}`) : "datas e notícias em alta",
  ].filter(Boolean).join(" · ");

  const props = {
    juntados,
    onAlternar: alternar,
    onCriarCampanha: (item: ItemJuntado) => abrirCampanha([item], ""),
    onPedidoInicio,
    onPedidoFim,
    pesquisadoEm,
  };
  const areaDoHype = <AreaDoHype {...props} hoje={hoje} leitura={leitura.hype} />;
  const areaDoTrending = <AreaDoTrending {...props} nicho={leitura.nicho} assuntosExtras={proximas} />;

  return (
    <section className="min-w-0" aria-label="Hype e Trending" data-hype-trending={clientId}>
      <CabecalhoDeSecao
        titulo="Hype e Trending"
        icone={<Flame className="h-4 w-4" />}
        truncar
        descricao={linhaDeEstado}
        ajuda="Hype: as datas e eventos que vêm por aí, com quando aquecem, o pico e o fim. Trending: o que está em alta agora, em notícias reais. Marque a caixinha dos itens e crie uma campanha com eles juntos."
        recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo: linhaDeEstado }}
        acao={
          <>
            {buscandoDesde !== null && <span className="hidden sm:inline-flex"><Cronometro desde={buscandoDesde} rotulo="Pesquisando" previsao="~90s" /></span>}
            {daSemana ? (
              <BotaoComCusto
                rotulo={<><RefreshCw className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Buscar de novo</span></>}
                titulo="Hypes da semana"
                descricao="Refaz a leitura da semana na web (hypes e em alta no nicho) com o contexto do cliente e a nota do Jev."
                partes={() => partesDosHypes(catalogo)}
                executar={() => buscar(true)}
                aoConcluir={() => setRecolhido(false)}
                variant="ghost"
                className="h-8"
              />
            ) : (
              <BotaoComCusto
                rotulo={<><Flame className="h-3.5 w-3.5 sm:mr-1.5" /><span className="max-sm:sr-only">Buscar hypes</span></>}
                titulo="Hypes da semana"
                descricao="Pesquisa na web e no Instagram o que está em alta para o público deste cliente e o que viraliza no nicho, com a nota do Jev. Leva de 60 a 90 segundos."
                partes={() => partesDosHypes(catalogo)}
                executar={() => buscar(false)}
                aoConcluir={() => setRecolhido(false)}
                variant="outline"
                className="h-8"
              />
            )}
          </>
        }
      />
      {buscandoDesde !== null && <div className="pb-2 pt-1 sm:hidden"><Cronometro desde={buscandoDesde} rotulo="Pesquisando na web" previsao="~90s" /></div>}

      {!recolhido && (
        <div className="space-y-3 pt-3">
          {hypes.isError && <AvisoDeErro erro={hypes.error} />}
          {dados && !daSemana && dados.itens.length > 0 && <p className={texto.auxiliar}>A leitura da web é da semana de {periodoCurto(dados.semana)}. Busque a desta semana.</p>}
          {largo ? (
            <div className="grid min-w-0 grid-cols-2 items-start gap-x-8">
              <div className="min-w-0">
                <h3 className="mb-2 flex items-center text-[13px] font-semibold"><Flame className="mr-1.5 h-4 w-4 text-primary" aria-hidden="true" />Hype · datas que vêm por aí</h3>
                {areaDoHype}
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 flex items-center text-[13px] font-semibold"><Newspaper className="mr-1.5 h-4 w-4 text-primary" aria-hidden="true" />Trending · em alta agora</h3>
                {areaDoTrending}
              </div>
            </div>
          ) : (
            <>
              <Etapas
                rotulo="Hype ou Trending"
                soIcone
                valor={aba}
                onEscolher={(v) => setAba(v as "hype" | "trending")}
                itens={[
                  { valor: "hype", rotulo: "Hype", dica: "Datas e eventos que vêm por aí", icone: <Flame className="h-4 w-4" /> },
                  { valor: "trending", rotulo: "Trending", dica: "O que está em alta agora (notícias)", icone: <Newspaper className="h-4 w-4" />, contador: leitura.nicho.length || null },
                ]}
              />
              {aba === "hype" ? areaDoHype : areaDoTrending}
            </>
          )}
        </div>
      )}

      <BarraDeJuntar
        quantos={juntados.length}
        pedido={pedido}
        onPedido={(v) => setSelecao({ clientId, itens: juntados, pedido: v })}
        onCriar={() => abrirCampanha(juntados, pedido)}
        onLimpar={() => setSelecao({ clientId, itens: [], pedido: "" })}
      />
    </section>
  );
}
