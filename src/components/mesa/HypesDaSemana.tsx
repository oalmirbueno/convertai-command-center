import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Flame, ListChecks, Newspaper, RefreshCw, Sparkles } from "lucide-react";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import Etapas from "@/components/sistema/Etapas";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { Cronometro } from "./Cronometro";
import { ganchoDaDescricao } from "./momentoDoGancho";
import { dadosDoTrendy, itensDoTrendy, ordenarPelaNota } from "./trendy";
import { supabase } from "@/integrations/supabase/client";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import AreaDoHype from "./AreaDoHype";
import AreaDoTrending, { type ConsultaDoTrending } from "./AreaDoTrending";
import VisaoDaSemana from "./VisaoDaSemana";
import VisaoTrendy from "./VisaoTrendy";
import BarraDeJuntar from "./BarraDeJuntar";
import { datasDasProximasSemanas } from "./datasDoHype";
import { alternarJuntado, CUSTO_DO_JEV_NAS_NOTICIAS_USD, sementeDaSelecao, type ItemJuntado, type Recencia } from "./hypeETrending";
import { guardarSementeDaCampanha } from "./sementeDaCampanha";
import { buscarHypes, chaves, hojeIso, lerHypes, partesDosHypes, periodoCurto, segundaDaSemanaIso } from "./mesaV4Api";
import { botao, juntar } from "@/components/sistema/estilos";

/**
 * Hype e Trending no Mês (21/10/2026). Três visões em abas de ícone e rótulo, no topo da seção:
 * - "Da semana" (abre primeiro): o modelo de antes, em cartões (VisaoDaSemana.tsx), com a leitura semanal
 *   (buscar_hypes): hypes do momento e "em alta no nicho", pauta pronta, Criar conteúdo/Usar a pauta e campanha.
 *   A leitura mora só aqui.
 * - "Datas": o calendário fixo do que vem por aí (AreaDoHype.tsx), agrupado por período, com selo de urgência.
 * - "Em alta": manchetes reais de agora (AreaDoTrending.tsx, buscar_trending).
 * - "Trendy": a busca e os filtros do Codex sobre a leitura gravada (VisaoTrendy.tsx), sem nova pesquisa.
 *
 * "Juntar" no topo liga as caixinhas nas três visões; a barra embaixo grava a semente
 * (sementeDaCampanha.ts) e abre a campanha nova. "Buscar o que está em alta agora" busca as notícias do
 * nicho (conferidas pelo Jev) e refaz a leitura semanal (custo à vista). Em cada item, uma ação só: "Criar".
 */

type VisaoDoHype = "semana" | "datas" | "em-alta" | "trendy";

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
  // Três visões; abre na "Da semana" (o modelo de antes, que o dono conhecia).
  const [aba, setAba] = useState<VisaoDoHype>("semana");
  const [modoJuntar, setModoJuntar] = useState(false);
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
  // A leitura já vem do agente com o nicho; aqui a ordem é a da relevância ao cliente (nota do Jev), estável.
  const leitura = ordenarPelaNota(itensDoTrendy(dados ? dados.itens : [], naAgenda.data || []));
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

  /** "Buscar o que está em alta agora": as notícias do nicho (com o Jev) e a leitura da web (custo à vista no botão). */
  const buscarAgora = async () => {
    consultar({ assunto: "", recencia: "7d" });
    // As notícias chegam em segundos no "Em alta"; a leitura da semana segue no "Da semana".
    setAba("em-alta");
    return buscar(daSemana);
  };

  const jaNaAgenda = dados ? dados.itens.length - leitura.length : 0;
  // Com algo marcado, a caixinha continua à vista mesmo com o modo juntar desligado.
  const juntando = modoJuntar || juntados.length > 0;
  const linhaDeEstado = [
    juntados.length ? `${juntados.length} para juntar` : "",
    dados ? (daSemana ? `leitura de ${pesquisadoEm ? `${pesquisadoEm.slice(8, 10)}/${pesquisadoEm.slice(5, 7)}` : "esta semana"}` : `leitura da semana de ${periodoCurto(dados.semana)}`) : "",
  ].filter(Boolean).join(" · ");

  const props = {
    juntando,
    juntados,
    onAlternar: alternar,
    onCriarCampanha: (item: ItemJuntado) => abrirCampanha([item], ""),
    onPedidoInicio,
    onPedidoFim,
  };

  return (
    <section className="min-w-0" aria-label="Hype e Trending" data-hype-trending={clientId}>
      <CabecalhoDeSecao
        titulo="Hype e Trending"
        icone={<Flame className="h-4 w-4" />}
        truncar
        descricao={linhaDeEstado || undefined}
        ajuda="Da semana: a leitura semanal da web (hypes e o que viraliza no nicho), em cartões. Datas: o calendário do que vem por aí. Em alta: notícias reais de agora. Trendy: buscar e filtrar a leitura da semana. Ligue “Juntar” para marcar itens e criar uma campanha com eles. O botão do topo busca as notícias do nicho e refaz a leitura da semana (custo à vista)."
        recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo: linhaDeEstado || undefined }}
        acao={
          <>
            {buscandoDesde !== null && <span className="hidden sm:inline-flex"><Cronometro desde={buscandoDesde} rotulo="Pesquisando" previsao="~90s" /></span>}
            <button type="button" className={juntar(botao.barra, "toque-compacto", modoJuntar ? "bg-muted text-foreground" : "")} onClick={() => setModoJuntar(!modoJuntar)} aria-pressed={modoJuntar} aria-label="Juntar para campanha" title="Juntar para campanha: marque itens das três visões e crie uma campanha com eles">
              <ListChecks className="h-4 w-4 sm:mr-1" aria-hidden="true" />
              <span className="max-sm:sr-only">Juntar</span>
            </button>
            <BotaoComCusto
              rotulo={<><RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" /><span className="max-sm:sr-only">Buscar o que está em alta agora</span></>}
              titulo="O que está em alta agora"
              descricao="Busca as notícias do nicho agora, conferidas pelo Jev, e refaz a leitura da semana na web e no Instagram, com a nota do Jev. Leva de 60 a 90 segundos."
              partes={() => partesDosHypes(catalogo).concat([{ modeloId: null, tipo: "texto", fixoUsd: CUSTO_DO_JEV_NAS_NOTICIAS_USD }])}
              executar={buscarAgora}
              aoConcluir={() => setRecolhido(false)}
              variant="outline"
              className="toque-compacto ml-1 h-8"
            />
          </>
        }
      />
      {buscandoDesde !== null && <div className="pb-2 pt-1 sm:hidden"><Cronometro desde={buscandoDesde} rotulo="Pesquisando na web" previsao="~90s" /></div>}

      {!recolhido && (
        <div className="min-w-0 space-y-3 pt-3">
          {hypes.isError && <AvisoDeErro erro={hypes.error} />}
          <Etapas
            rotulo="Visões do Hype e Trending"
            valor={aba}
            onEscolher={(v) => setAba(v as VisaoDoHype)}
            itens={[
              { valor: "semana", rotulo: "Da semana", dica: "A leitura semanal da web, em cartões", icone: <Flame className="h-4 w-4" />, contador: leitura.length || null },
              { valor: "datas", rotulo: "Datas", dica: "Datas e eventos que vêm por aí", icone: <CalendarDays className="h-4 w-4" /> },
              { valor: "em-alta", rotulo: "Em alta", dica: "Notícias em alta agora", icone: <Newspaper className="h-4 w-4" /> },
              { valor: "trendy", rotulo: "Trendy", dica: "Buscar e filtrar a leitura da semana (sem nova pesquisa)", icone: <Sparkles className="h-4 w-4" /> },
            ]}
          />
          {aba === "semana" && <VisaoDaSemana {...props} dados={dados} daSemana={daSemana} carregando={hypes.isLoading} itens={leitura} jaNaAgenda={jaNaAgenda} />}
          {aba === "datas" && <AreaDoHype {...props} hoje={hoje} />}
          {aba === "em-alta" && <AreaDoTrending {...props} consulta={consulta} onConsulta={consultar} assuntosExtras={proximas} />}
          {aba === "trendy" && <VisaoTrendy {...props} dados={dados} itens={leitura} />}
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
