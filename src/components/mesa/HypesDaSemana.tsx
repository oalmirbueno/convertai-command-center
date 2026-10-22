import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Newspaper, RefreshCw } from "lucide-react";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import Etapas from "@/components/sistema/Etapas";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { Cronometro } from "./Cronometro";
import { ganchoDaDescricao } from "./momentoDoGancho";
import { dadosDoTrendy, itensDoTrendy, separarLeitura } from "./trendy";
import { supabase } from "@/integrations/supabase/client";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import AreaDoHype from "./AreaDoHype";
import AreaDoTrending, { type ConsultaDoTrending } from "./AreaDoTrending";
import BarraDeJuntar from "./BarraDeJuntar";
import { datasDasProximasSemanas } from "./datasDoHype";
import { alternarJuntado, sementeDaSelecao, type ItemJuntado, type Recencia } from "./hypeETrending";
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
 * 2ª rodada (dono: "mais organizado, alinhado, com scroll, sem poluição; o do Mês é complementar"): as duas
 * colunas têm a mesma altura, cabeçalho fixo e rolagem própria (de 1024 px para cima); toda linha é a mesma
 * grade (LinhaDoHypeETrending.tsx); explicações só no "?". Nada do que havia sumiu: a leitura semanal
 * (hypes e "em alta no nicho", com pauta pronta, Criar conteúdo/Usar a pauta e Criar campanha) segue nas
 * colunas, e o "Novo calendário" do agente segue no topo do Mês. O botão do topo, "Buscar o que está em
 * alta agora", busca as notícias do nicho (sem custo) e refaz a leitura semanal (buscar_hypes, custo à vista).
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
  onJuntando,
}: {
  /** Abre a aba Campanhas na campanha nova (a semente já foi gravada por aqui). */
  onCriarCampanha?: () => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
  /** Avisa quando a barra de juntar aparece ou some (o Mês afasta o botão do agente dela). */
  onJuntando?: (ativo: boolean) => void;
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
  const temJuntados = juntados.length > 0 && !recolhido;
  useEffect(() => {
    if (onJuntando) onJuntando(temJuntados);
  }, [temJuntados, onJuntando]);
  useEffect(() => () => { if (onJuntando) onJuntando(false); }, [onJuntando]);
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

  // Trending: a busca de notícias em curso fica aqui para o botão do topo também disparar.
  const [consulta, setConsulta] = useState<ConsultaDoTrending | null>(null);
  const consultar = (c: { assunto: string; recencia: Recencia }) => setConsulta((antes) => ({ clientId, ...c, vez: antes ? antes.vez + 1 : 1 }));

  /** "Buscar o que está em alta agora": as notícias do nicho (sem custo) e a leitura da web (com custo à vista). */
  const buscarAgora = async () => {
    consultar({ assunto: "", recencia: "7d" });
    setAba("trending");
    return buscar(daSemana);
  };

  const jaNaAgenda = dados ? dados.itens.length - leitura.hype.length - leitura.nicho.length : 0;
  const linhaDeEstado = [
    juntados.length ? `${juntados.length} para juntar` : "",
    dados ? (daSemana ? `leitura de ${pesquisadoEm ? `${pesquisadoEm.slice(8, 10)}/${pesquisadoEm.slice(5, 7)}` : "esta semana"}` : `leitura da semana de ${periodoCurto(dados.semana)}`) : "",
  ].filter(Boolean).join(" · ");

  const props = {
    juntados,
    onAlternar: alternar,
    onCriarCampanha: (item: ItemJuntado) => abrirCampanha([item], ""),
    onPedidoInicio,
    onPedidoFim,
    pesquisadoEm,
  };
  const areaDoHype = <AreaDoHype {...props} hoje={hoje} leitura={leitura.hype} resumoDaLeitura={dados ? dados.resumo : null} jaNaAgenda={jaNaAgenda} />;
  const areaDoTrending = <AreaDoTrending {...props} consulta={consulta} onConsulta={consultar} nicho={leitura.nicho} assuntosExtras={proximas} />;

  return (
    <section className="min-w-0" aria-label="Hype e Trending" data-hype-trending={clientId}>
      <CabecalhoDeSecao
        titulo="Hype e Trending"
        icone={<Flame className="h-4 w-4" />}
        truncar
        descricao={linhaDeEstado || undefined}
        ajuda="Hype: datas e eventos que vêm por aí. Trending: o que está em alta agora, em notícias reais, e o que viraliza no nicho. Marque a caixinha dos itens e crie uma campanha com eles juntos. O botão do topo busca as notícias do nicho e refaz a leitura da semana na web (com o custo à vista)."
        recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo: linhaDeEstado || undefined }}
        acao={
          <>
            {buscandoDesde !== null && <span className="hidden sm:inline-flex"><Cronometro desde={buscandoDesde} rotulo="Pesquisando" previsao="~90s" /></span>}
            <BotaoComCusto
              rotulo={<><RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" /><span className="max-sm:sr-only">Buscar o que está em alta agora</span></>}
              titulo="O que está em alta agora"
              descricao="Busca as notícias do nicho agora (sem custo) e refaz a leitura da semana na web e no Instagram, com a nota do Jev. Leva de 60 a 90 segundos."
              partes={() => partesDosHypes(catalogo)}
              executar={buscarAgora}
              aoConcluir={() => setRecolhido(false)}
              variant="outline"
              className="toque-compacto h-8"
            />
          </>
        }
      />
      {buscandoDesde !== null && <div className="pb-2 pt-1 sm:hidden"><Cronometro desde={buscandoDesde} rotulo="Pesquisando na web" previsao="~90s" /></div>}

      {!recolhido && (
        <div className="min-w-0 pt-3">
          {hypes.isError && <AvisoDeErro erro={hypes.error} />}
          {largo ? (
            <div className="grid min-w-0 grid-cols-2 items-start gap-x-8" data-colunas="">
              {areaDoHype}
              {areaDoTrending}
            </div>
          ) : (
            <div className="min-w-0 space-y-3">
              <Etapas
                rotulo="Hype ou Trending"
                soIcone
                valor={aba}
                onEscolher={(v) => setAba(v as "hype" | "trending")}
                itens={[
                  { valor: "hype", rotulo: "Hype", dica: "Datas e eventos que vêm por aí", icone: <Flame className="h-4 w-4" /> },
                  { valor: "trending", rotulo: "Trending", dica: "O que está em alta agora", icone: <Newspaper className="h-4 w-4" /> },
                ]}
              />
              {aba === "hype" ? areaDoHype : areaDoTrending}
            </div>
          )}
          <BarraDeJuntar
            quantos={juntados.length}
            pedido={pedido}
            onPedido={(v) => setSelecao({ clientId, itens: juntados, pedido: v })}
            onCriar={() => abrirCampanha(juntados, pedido)}
            onLimpar={() => setSelecao({ clientId, itens: [], pedido: "" })}
          />
        </div>
      )}
    </section>
  );
}
