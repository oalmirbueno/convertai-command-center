import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Flame, Megaphone, RefreshCw, TrendingUp } from "lucide-react";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, juntar, superficie } from "@/components/sistema/estilos";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { Cronometro } from "./Cronometro";
import { ganchoDaDescricao } from "./momentoDoGancho";
import { dadosDoTrendy, filtrarTrendy, FILTROS_INICIAIS_DO_TRENDY, FORMATOS_DO_TRENDY, itensDoTrendy, type FiltrosDoTrendy, type FormatoDoTrendy, type TipoDoTrendy } from "./trendy";
import { supabase } from "@/integrations/supabase/client";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import {
  buscarHypes,
  chaves,
  dominioDoLink,
  hojeIso,
  lerHypes,
  linkSeguro,
  mensagemDoHype,
  pedidoLivre,
  periodoCurto,
  partesDoPedido,
  partesDosHypes,
  ROTULO_DA_JANELA,
  segundaDaSemanaIso,
  type Hype,
} from "./mesaV4Api";

/**
 * Hypes da semana (topo da aba Mês): os assuntos em alta que servem a este
 * cliente, pesquisados na web com o contexto dele e com a nota do Jev. Uma
 * busca por semana: a da semana aparece direto, sem custo; "Buscar de novo"
 * refaz. Cada hype vira conteúdo (cai na conversa do agente do mês) ou
 * campanha (abre a aba Campanhas já preenchida).
 *
 * 17/10/2026 (dono: "além do hype, ter um para puxar assuntos em alta do nicho"):
 * a mesma busca traz a segunda lista, "Em alta no nicho" (`tipo: "nicho"`), lida
 * na web e nos posts reais do Instagram (hashtags do nicho e perfis de
 * referência), com o "onde está viralizando". As duas listas também entram
 * sozinhas em toda geração do Mês enquanto valem (o conteúdo já nasce tematizado).
 */

/** Chave antiga (sem cliente): só dá o ponto de partida de quem já tinha escolhido. */
const CHAVE_RECOLHIDO = "mesa:hypes:recolhido";
const VISIVEIS = 3;

function lerRecolhido(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_RECOLHIDO) === "1";
  } catch {
    return false;
  }
}

/**
 * 17/10 (dono: "quando adiciona na agenda os gerados pelo hype, ele some dali"): os ganchos já gravados na
 * agenda do cliente (tarefas dos últimos 45 dias em diante). O hype cujo título aparece num deles sai da lista.
 */
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

const corDaNota = (n: number) => (n >= 7 ? "bg-primary text-primary-foreground" : n >= 4 ? "bg-secondary text-foreground" : "bg-muted text-muted-foreground");

function CartaoDoHype({
  hype,
  onCriarCampanha,
  onPedidoInicio,
  onPedidoFim,
}: {
  hype: Hype;
  onCriarCampanha: () => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [detalhes, setDetalhes] = useState(false);
  const link = linkSeguro(hype.fonte);
  const nota = typeof hype.nota === "number" && isFinite(hype.nota) ? Math.round(hype.nota * 10) / 10 : null;

  const criarConteudo = async () => {
    const mensagem = mensagemDoHype(hype);
    if (onPedidoInicio) onPedidoInicio({ mensagem, desde: Date.now() });
    try {
      const data = await pedidoLivre({ clientId, mensagem, hype: { tipo: hype.tipo, titulo: hype.titulo } });
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      return data;
    } finally {
      if (onPedidoFim) onPedidoFim();
    }
  };

  return (
    // Item de grade (cartão com função): o cartão sólido do sistema.
    <article className={`flex min-w-0 flex-col p-3.5 ${superficie.painel}`}>
      <div className="flex min-w-0 items-start">
        {/* Título numa linha (28/09); inteiro no title. */}
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug" title={hype.titulo}>{hype.titulo}</h3>
        {nota !== null && (
          <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${corDaNota(nota)}`} title="Quanto serve a este cliente, de 0 a 10">
            {nota.toLocaleString("pt-BR")}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {hype.tipo === "nicho" ? "em alta agora" : ROTULO_DA_JANELA[String(hype.janela || "")] || "esta semana"}
        {hype.formato ? ` · ${hype.formato === "estatico" ? "estático" : hype.formato}` : ""}
      </p>
      {hype.tipo === "nicho" && hype.sinal && (
        <p title={hype.sinal} className="mt-1 flex min-w-0 items-start gap-1 text-[12px] font-medium text-primary [overflow-wrap:anywhere]">
          <TrendingUp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2">{hype.sinal}</span>
        </p>
      )}
      {hype.o_que_e && <p title={hype.o_que_e} className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{hype.o_que_e}</p>}
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`Ver fonte de ${hype.titulo}`} className="mt-1.5 inline-flex max-w-full items-center self-start text-[11px] text-primary hover:underline">
          <span className="truncate">{dominioDoLink(link)}</span><ExternalLink className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
        </a>
      )}
      {detalhes && (
        <dl className="mt-2 space-y-1.5 text-[12px] leading-relaxed [overflow-wrap:anywhere]">
          {hype.por_que_agora && (
            <div><dt className="text-[11px] font-medium text-muted-foreground">Por que agora</dt><dd>{hype.por_que_agora}</dd></div>
          )}
          {hype.como_usar && (
            <div><dt className="text-[11px] font-medium text-muted-foreground">Como usar</dt><dd>{hype.como_usar}</dd></div>
          )}
          {hype.cuidado && (
            <div><dt className="text-[11px] font-medium text-muted-foreground">Cuidado</dt><dd>{hype.cuidado}</dd></div>
          )}
          {hype.pauta && hype.pauta.tema && (
            <div data-pauta-pronta="">
              <dt className="text-[11px] font-medium text-muted-foreground">Pauta pronta (sem data)</dt>
              <dd>
                <p className="font-medium">{hype.pauta.tema}</p>
                {hype.pauta.gancho && <p className="text-muted-foreground">Capa: {hype.pauta.gancho}</p>}
                {hype.pauta.laminas.length > 0 && (
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4">{hype.pauta.laminas.map((l, i) => <li key={i}>{l}</li>)}</ol>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}
      <button
        type="button"
        onClick={() => setDetalhes((v) => !v)}
        aria-expanded={detalhes}
        className="mt-1.5 inline-flex items-center self-start text-[12px] font-medium text-primary hover:underline"
      >
        {detalhes ? "Menos" : "Como usar"}
        <ChevronDown className={`ml-0.5 h-3.5 w-3.5 transition-transform ${detalhes ? "rotate-180" : ""}`} />
      </button>
      <div className="mt-auto flex flex-wrap items-center pt-2.5">
        <BotaoComCusto
          rotulo={hype.pauta && hype.pauta.tema ? "Usar a pauta" : "Criar conteúdo"}
          titulo={`Conteúdo sobre "${hype.titulo}"`}
          descricao="O agente do mês prepara o conteúdo com o contexto do cliente e põe no próximo espaço livre da agenda (sem passar do limite de posts por dia); aparece na conversa, pronto para gravar."
          partes={() => partesDoPedido(catalogo, 0)}
          executar={criarConteudo}
          variant="outline"
          className="mb-1 mr-1.5 h-8"
        />
        {/* 16/10/2026 (dono: "texto + ícone vira só o ícone, sem bordas"): o nome fica no title e no leitor de tela. */}
        <button type="button" className={juntar(botao.icone, "mb-1")} onClick={onCriarCampanha} aria-label="Criar campanha" title="Criar campanha">
          <Megaphone className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

export default function HypesDaSemana({
  onCriarCampanha,
  onPedidoInicio,
  onPedidoFim,
}: {
  onCriarCampanha: (indice: number) => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  // Recolher padronizado (TituloRecolhivel): lembrado por cliente.
  const [recolhido, setRecolhido] = useRecolhido(`mesa:mes:hypes:${clientId}`, lerRecolhido());
  const [todos, setTodos] = useState(false);
  const [escolha, setEscolha] = useState<{ clientId: string; filtros: FiltrosDoTrendy }>({ clientId, filtros: FILTROS_INICIAIS_DO_TRENDY });
  const filtros = escolha.clientId === clientId ? escolha.filtros : FILTROS_INICIAIS_DO_TRENDY;
  const mudarFiltros = (campos: Partial<FiltrosDoTrendy>) => {
    setEscolha({ clientId, filtros: { ...filtros, ...campos } });
    setTodos(false);
  };
  const [buscandoDesde, setBuscandoDesde] = useState<number | null>(null);

  const hypes = useQuery({ queryKey: chaves.hypes(clientId), queryFn: () => lerHypes(clientId) });
  const naAgenda = useQuery({ queryKey: ["mesa", "hypes-na-agenda", clientId], queryFn: () => lerGanchosNaAgenda(clientId), staleTime: 30_000, retry: false });
  const semanaAtual = segundaDaSemanaIso(hojeIso());
  const dados = dadosDoTrendy(hypes.data, clientId);
  const daSemana = !!dados && dados.semana === semanaAtual;
  const itens = dados ? dados.itens : [];
  // O índice original segue junto: "Criar campanha" aponta o item certo da lista gravada.
  // O que já virou conteúdo na agenda sai da lista (o índice original segue para o "Criar campanha").
  const ganchos = naAgenda.data || [];
  const comIndice = itensDoTrendy(itens, ganchos);
  const jaNaAgenda = itens.length - comIndice.length;
  const filtrados = filtrarTrendy(comIndice, filtros);
  const doMomento = filtrados.filter((x) => x.h.tipo !== "nicho");
  const doNicho = filtrados.filter((x) => x.h.tipo === "nicho");
  const temFiltro = filtros.tipo !== "todos" || filtros.formato !== "todos" || !!filtros.busca.trim();

  const alternar = () => setRecolhido(!recolhido);

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

  const aoBuscar = () => {
    setRecolhido(false);
    setTodos(false);
  };

  const quando = dados && dados.criado_em ? new Date(dados.criado_em) : null;
  const rotuloQuando = quando && !Number.isNaN(quando.getTime())
    ? `busca de ${quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`
    : "";
  // Uma linha de estado: quantos e de quando (à vista também com o bloco recolhido).
  const linhaDeEstado = [
    comIndice.length ? `${comIndice.length} sugestões` : "",
    jaNaAgenda ? `${jaNaAgenda} já na agenda` : "",
    dados ? (daSemana ? rotuloQuando : `semana de ${periodoCurto(dados.semana)}`) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // Seção sem caixa (docs/design/SISTEMA.md): título de seção, ação à direita, conteúdo logo abaixo.
    <section className="min-w-0" aria-label="Trendy" data-trendy-client={clientId}>
      <CabecalhoDeSecao
        titulo="Trendy"
        icone={<Flame className="h-4 w-4" />}
        truncar
        descricao={linhaDeEstado || undefined}
        recolher={{ recolhido, onAlternar: alternar, resumo: linhaDeEstado || undefined }}
        acao={
          <>
            {buscandoDesde !== null && <span className="hidden sm:inline-flex"><Cronometro desde={buscandoDesde} rotulo="Pesquisando" previsao="~90s" /></span>}
            {daSemana ? (
              <BotaoComCusto
                // 16/10/2026: só o ícone (o preço continua visível); o nome vai para o leitor de tela e a descrição para o title.
                rotulo={<><RefreshCw className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Buscar de novo</span></>}
                titulo="Hypes da semana"
                descricao="Refaz a pesquisa na web com o contexto do cliente e a nota do Jev."
                partes={() => partesDosHypes(catalogo)}
                executar={() => buscar(true)}
                aoConcluir={aoBuscar}
                variant="ghost"
                className="h-8"
              />
            ) : (
              <BotaoComCusto
                rotulo={<><Flame className="h-3.5 w-3.5 sm:mr-1.5" /><span className="max-sm:sr-only">Buscar hypes</span></>}
                titulo="Hypes da semana"
                descricao="Pesquisa na web e no Instagram o que está em alta para o público deste cliente e o que está viralizando no nicho, com a nota do Jev. Leva de 60 a 90 segundos."
                partes={() => partesDosHypes(catalogo)}
                executar={() => buscar(false)}
                aoConcluir={aoBuscar}
                // Um primário por área (28/09): o da aba é o "Agente do mês".
                variant="outline"
                className="h-8"
              />
            )}
          </>
        }
      />
      {buscandoDesde !== null && (
        <div className="pb-2 pt-1 sm:hidden"><Cronometro desde={buscandoDesde} rotulo="Pesquisando na web" previsao="~90s" /></div>
      )}

      {!recolhido && (
        <div className="space-y-3 pt-3">
          {hypes.isError && <AvisoDeErro erro={hypes.error} />}
          {hypes.isLoading && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
          {hypes.isSuccess && !dados && buscandoDesde === null && (
            <p className="text-[13px] text-muted-foreground">Nenhuma busca ainda.</p>
          )}
          {dados && !daSemana && itens.length > 0 && (
            <p className="text-[12px] text-muted-foreground">Estes são da semana de {periodoCurto(dados.semana)}. Busque os desta semana.</p>
          )}
          {dados && dados.resumo && <p className="text-[13px] leading-relaxed [overflow-wrap:anywhere]">{dados.resumo}</p>}
          {dados && comIndice.length > 0 && (
            <div className="flex flex-wrap items-end gap-2" aria-label="Filtros do Trendy">
              <label className="min-w-40 flex-1 text-[11px] text-muted-foreground">Buscar nas sugestões
                <input type="search" value={filtros.busca} onChange={(e) => mudarFiltros({ busca: e.target.value })} placeholder="Assunto, gancho ou fonte" className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground" />
              </label>
              <label className="text-[11px] text-muted-foreground">Tipo
                <select value={filtros.tipo} onChange={(e) => mudarFiltros({ tipo: e.target.value as TipoDoTrendy })} className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground"><option value="todos">Todos</option><option value="momento">Momento</option><option value="nicho">Nicho</option></select>
              </label>
              <label className="text-[11px] text-muted-foreground">Formato
                <select value={filtros.formato} onChange={(e) => mudarFiltros({ formato: e.target.value as FormatoDoTrendy })} className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground">{FORMATOS_DO_TRENDY.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}</select>
              </label>
              {temFiltro && <button type="button" onClick={() => mudarFiltros(FILTROS_INICIAIS_DO_TRENDY)} className="h-8 text-[12px] text-primary hover:underline">Limpar filtros</button>}
              <p role="status" className="w-full text-[11px] text-muted-foreground">{filtrados.length} de {comIndice.length} sugestões{rotuloQuando ? ` · ${rotuloQuando}` : ""}</p>
            </div>
          )}
          {dados && comIndice.length > 0 && !filtrados.length && <p className="text-[12px] text-muted-foreground">Nenhuma sugestão com estes filtros.</p>}
          {dados && itens.length > 0 && !comIndice.length && <p className="text-[12px] text-muted-foreground">As sugestões desta pesquisa já estão na agenda.</p>}
          {[
            { chave: "momento", titulo: "Hypes do momento", lista: doMomento },
            { chave: "nicho", titulo: "Em alta no nicho", lista: doNicho },
          ].filter((g) => g.lista.length > 0).map((g) => {
            const visiveis = todos ? g.lista : g.lista.slice(0, VISIVEIS);
            return (
              <div key={g.chave} className="space-y-2">
                {/* Com as duas listas, cada uma ganha o nome; busca antiga (só hypes) fica como era. */}
                {doNicho.length > 0 && (
                  <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                    {g.chave === "nicho" ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <Flame className="h-3.5 w-3.5" aria-hidden="true" />}
                    {g.titulo}
                  </h3>
                )}
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {visiveis.map(({ h, indice }) => (
                    <CartaoDoHype
                      key={`${h.titulo}-${indice}`}
                      hype={h}
                      onCriarCampanha={() => onCriarCampanha(indice)}
                      onPedidoInicio={onPedidoInicio}
                      onPedidoFim={onPedidoFim}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {(doMomento.length > VISIVEIS || doNicho.length > VISIVEIS) && (
            <button type="button" onClick={() => setTodos((v) => !v)} className="text-[12px] font-medium text-primary hover:underline">
              {todos ? "Mostrar menos" : `Ver todos (${filtrados.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
