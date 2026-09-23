import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Flame, Megaphone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { Cronometro } from "./Cronometro";
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
 */

const CHAVE_RECOLHIDO = "mesa:hypes:recolhido";
const VISIVEIS = 3;

function lerRecolhido(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_RECOLHIDO) === "1";
  } catch {
    return false;
  }
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
      const data = await pedidoLivre({ clientId, mensagem });
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      return data;
    } finally {
      if (onPedidoFim) onPedidoFim();
    }
  };

  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3.5">
      <div className="flex min-w-0 items-start">
        <h3 className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug [overflow-wrap:anywhere]">{hype.titulo}</h3>
        {nota !== null && (
          <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${corDaNota(nota)}`} title="Quanto serve a este cliente, de 0 a 10">
            {nota.toLocaleString("pt-BR")}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {ROTULO_DA_JANELA[String(hype.janela || "")] || "esta semana"}
        {hype.formato ? ` · ${hype.formato === "estatico" ? "estático" : hype.formato}` : ""}
      </p>
      {hype.o_que_e && <p title={hype.o_que_e} className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{hype.o_que_e}</p>}
      {detalhes && (
        <dl className="mt-2 space-y-1.5 text-[12px] leading-relaxed [overflow-wrap:anywhere]">
          {hype.por_que_agora && (
            <div><dt className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Por que agora</dt><dd>{hype.por_que_agora}</dd></div>
          )}
          {hype.como_usar && (
            <div><dt className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Como usar</dt><dd>{hype.como_usar}</dd></div>
          )}
          {hype.cuidado && (
            <div><dt className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Cuidado</dt><dd>{hype.cuidado}</dd></div>
          )}
          {link && (
            <div>
              <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center text-[11.5px] text-primary hover:underline">
                <span className="truncate">{dominioDoLink(link)}</span>
                <ExternalLink className="ml-1 h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
        </dl>
      )}
      <button
        type="button"
        onClick={() => setDetalhes((v) => !v)}
        aria-expanded={detalhes}
        className="mt-1.5 inline-flex items-center self-start text-[11.5px] font-medium text-primary hover:underline"
      >
        {detalhes ? "Menos" : "Como usar"}
        <ChevronDown className={`ml-0.5 h-3.5 w-3.5 transition-transform ${detalhes ? "rotate-180" : ""}`} />
      </button>
      <div className="mt-auto flex flex-wrap items-center pt-2.5">
        <BotaoComCusto
          rotulo="Criar conteúdo"
          titulo={`Conteúdo sobre "${hype.titulo}"`}
          descricao="O agente do mês prepara o conteúdo com o contexto do cliente; aparece na conversa, pronto para gravar."
          partes={() => partesDoPedido(catalogo, 0)}
          executar={criarConteudo}
          variant="outline"
          className="mb-1 mr-1.5 h-8"
        />
        <Button type="button" size="sm" variant="ghost" className="mb-1 h-8" onClick={onCriarCampanha}>
          <Megaphone className="mr-1.5 h-3.5 w-3.5" />
          Criar campanha
        </Button>
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
  const [recolhido, setRecolhido] = useState(lerRecolhido);
  const [todos, setTodos] = useState(false);
  const [buscandoDesde, setBuscandoDesde] = useState<number | null>(null);

  const hypes = useQuery({ queryKey: chaves.hypes(clientId), queryFn: () => lerHypes(clientId) });
  const semanaAtual = segundaDaSemanaIso(hojeIso());
  const dados = hypes.data || null;
  const daSemana = !!dados && dados.semana === semanaAtual;
  const itens = dados ? dados.itens : [];
  const visiveis = todos ? itens : itens.slice(0, VISIVEIS);

  const alternar = () => {
    const novo = !recolhido;
    setRecolhido(novo);
    try {
      window.localStorage.setItem(CHAVE_RECOLHIDO, novo ? "1" : "0");
    } catch {
      /* sem armazenamento */
    }
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

  const aoBuscar = () => {
    setRecolhido(false);
    setTodos(false);
  };

  const quando = dados && dados.criado_em ? new Date(dados.criado_em) : null;
  const rotuloQuando = quando && !Number.isNaN(quando.getTime())
    ? `busca de ${quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`
    : "";

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card" aria-label="Hypes da semana">
      <div className="flex min-w-0 flex-wrap items-center px-3.5 py-2.5">
        <button type="button" onClick={alternar} aria-expanded={!recolhido} className="mr-2 flex min-w-0 flex-1 items-center text-left">
          <Flame className="mr-2 h-4 w-4 shrink-0 text-primary" />
          <span className="mr-2 shrink-0 text-[13.5px] font-semibold">Hypes da semana</span>
          {itens.length > 0 && <span className="mr-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{itens.length}</span>}
          <span className="hidden min-w-0 truncate text-[11.5px] text-muted-foreground sm:inline">
            {dados ? (daSemana ? rotuloQuando : `semana de ${periodoCurto(dados.semana)}`) : ""}
          </span>
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${recolhido ? "" : "rotate-180"}`} />
        </button>
        <div className="flex shrink-0 items-center">
          {buscandoDesde !== null && <span className="mr-2 hidden sm:inline-flex"><Cronometro desde={buscandoDesde} rotulo="Pesquisando" previsao="~90s" /></span>}
          {daSemana ? (
            <BotaoComCusto
              rotulo={<><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Buscar de novo</>}
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
              rotulo={<><Flame className="mr-1.5 h-3.5 w-3.5" />Buscar hypes</>}
              titulo="Hypes da semana"
              descricao="Pesquisa na web o que está em alta para o público deste cliente, com a nota do Jev. Leva de 60 a 90 segundos."
              partes={() => partesDosHypes(catalogo)}
              executar={() => buscar(false)}
              aoConcluir={aoBuscar}
              variant={dados ? "outline" : "default"}
              className="h-8"
            />
          )}
        </div>
      </div>
      {buscandoDesde !== null && (
        <div className="px-3.5 pb-2 sm:hidden"><Cronometro desde={buscandoDesde} rotulo="Pesquisando na web" previsao="~90s" /></div>
      )}

      {!recolhido && (
        <div className="space-y-3 border-t border-border px-3.5 pb-3.5 pt-3">
          {hypes.isError && <AvisoDeErro erro={hypes.error} />}
          {hypes.isLoading && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
          {hypes.isSuccess && !dados && buscandoDesde === null && (
            <p className="text-[12.5px] text-muted-foreground">Nenhuma busca ainda. Um clique traz o que está em alta para este cliente.</p>
          )}
          {dados && !daSemana && itens.length > 0 && (
            <p className="text-[11.5px] text-muted-foreground">Estes são da semana de {periodoCurto(dados.semana)}. Busque os desta semana.</p>
          )}
          {dados && dados.resumo && <p className="text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{dados.resumo}</p>}
          {visiveis.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {visiveis.map((h, i) => (
                <CartaoDoHype
                  key={`${h.titulo}-${i}`}
                  hype={h}
                  onCriarCampanha={() => onCriarCampanha(i)}
                  onPedidoInicio={onPedidoInicio}
                  onPedidoFim={onPedidoFim}
                />
              ))}
            </div>
          )}
          {itens.length > VISIVEIS && (
            <button type="button" onClick={() => setTodos((v) => !v)} className="text-[12px] font-medium text-primary hover:underline">
              {todos ? "Mostrar menos" : `Ver todos (${itens.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
