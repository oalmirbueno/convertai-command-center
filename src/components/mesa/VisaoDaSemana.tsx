import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Flame, TrendingUp } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EstadoVazio } from "@/components/sistema/Estados";
import { juntar, superficie, texto } from "@/components/sistema/estilos";
import { useMesa } from "./MesaContexto";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import { MenuCriar } from "./LinhaDoHypeETrending";
import { juntadoDaLeitura, podeJuntar, type ItemJuntado } from "./hypeETrending";
import { chaves, dominioDoLink, linkSeguro, mensagemDoHype, partesDoPedido, pedidoLivre, periodoCurto, ROTULO_DA_JANELA, type Hype, type HypesDaSemana } from "./mesaV4Api";
import type { ItemDoTrendy } from "./trendy";

/**
 * "Da semana" (21/10/2026, dono: "voltar também como era antes o hype, que era um modelo que funcionava bem"):
 * a leitura semanal em cartões, como era antes do Trendy (commit 07ece8fa): "Hypes do momento" e "Em alta no
 * nicho", nota do Jev, janela e formato, o sinal do nicho, "Como usar" com a pauta pronta, e 3 por grupo com
 * "Ver todos". Da limpeza desta rodada só mudou a ação: um "Criar" com menu (Conteúdo ou "Usar a pauta", com o
 * custo ali dentro, e Campanha), e a caixinha "juntar" no modo juntar. A leitura mora só aqui (não se repete
 * nas visões Datas e Em alta).
 */

const VISIVEIS = 3;
const corDaNota = (n: number) => (n >= 7 ? "bg-primary text-primary-foreground" : n >= 4 ? "bg-secondary text-foreground" : "bg-muted text-muted-foreground");

function CartaoDoHype({
  hype,
  item,
  juntando,
  marcado,
  podeMarcar,
  onMarcar,
  onCriarCampanha,
  onPedidoInicio,
  onPedidoFim,
}: {
  hype: Hype;
  item: ItemJuntado;
  juntando: boolean;
  marcado: boolean;
  podeMarcar: boolean;
  onMarcar: () => void;
  onCriarCampanha: () => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [detalhes, setDetalhes] = useState(false);
  const link = linkSeguro(hype.fonte);
  const nota = typeof hype.nota === "number" && isFinite(hype.nota) ? Math.round(hype.nota * 10) / 10 : null;
  const temPauta = !!(hype.pauta && hype.pauta.tema);

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
    <article className={juntar("flex min-w-0 flex-col p-3.5", superficie.painel, marcado ? "border-primary" : "")} data-cartao-da-semana={item.chave} data-juntado={marcado ? "" : undefined}>
      <div className="flex min-w-0 items-start">
        {juntando && (
          <span className="mr-2 flex h-5 items-center">
            <Checkbox className="toque-compacto rounded" checked={marcado} disabled={!podeMarcar && !marcado} onCheckedChange={onMarcar} aria-label={`Juntar ${hype.titulo}`} title={podeMarcar || marcado ? "Juntar para criar uma campanha" : "Já tem 6 desta área na seleção"} />
          </span>
        )}
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
        <p title={hype.sinal} className="mt-1 flex min-w-0 items-start text-[12px] font-medium text-primary [overflow-wrap:anywhere]">
          <TrendingUp className="mr-1 mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2">{hype.sinal}</span>
        </p>
      )}
      {hype.o_que_e && <p title={hype.o_que_e} className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{hype.o_que_e}</p>}
      {detalhes && (
        <dl className="mt-2 space-y-1.5 text-[12px] leading-relaxed [overflow-wrap:anywhere]">
          {hype.por_que_agora && <div><dt className="text-[11px] font-medium text-muted-foreground">Por que agora</dt><dd>{hype.por_que_agora}</dd></div>}
          {hype.como_usar && <div><dt className="text-[11px] font-medium text-muted-foreground">Como usar</dt><dd>{hype.como_usar}</dd></div>}
          {hype.cuidado && <div><dt className="text-[11px] font-medium text-muted-foreground">Cuidado</dt><dd>{hype.cuidado}</dd></div>}
          {temPauta && hype.pauta && (
            <div data-pauta-pronta="">
              <dt className="text-[11px] font-medium text-muted-foreground">Pauta pronta (sem data)</dt>
              <dd>
                <p className="font-medium">{hype.pauta.tema}</p>
                {hype.pauta.gancho && <p className="text-muted-foreground">Capa: {hype.pauta.gancho}</p>}
                {hype.pauta.laminas.length > 0 && <ol className="mt-1 list-decimal space-y-0.5 pl-4">{hype.pauta.laminas.map((l, i) => <li key={i}>{l}</li>)}</ol>}
              </dd>
            </div>
          )}
          {link && (
            <div>
              <a href={link} target="_blank" rel="noopener noreferrer" className="toque-compacto inline-flex max-w-full items-center text-[12px] text-primary hover:underline" aria-label={`Ver fonte de ${hype.titulo}`}>
                <span className="truncate">{dominioDoLink(link)}</span>
                <ExternalLink className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
              </a>
            </div>
          )}
        </dl>
      )}
      <div className="mt-auto flex items-center justify-between pt-2.5">
        <button type="button" onClick={() => setDetalhes((v) => !v)} aria-expanded={detalhes} className="toque-compacto inline-flex items-center text-[12px] font-medium text-primary hover:underline">
          {detalhes ? "Menos" : "Como usar"}
          <ChevronDown className={`ml-0.5 h-3.5 w-3.5 transition-transform ${detalhes ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <MenuCriar titulo={hype.titulo} rotuloDoConteudo={temPauta ? "Usar a pauta" : "Conteúdo"} partes={() => partesDoPedido(catalogo, 0)} executar={criarConteudo} onCampanha={onCriarCampanha} />
      </div>
    </article>
  );
}

export default function VisaoDaSemana({
  dados,
  daSemana,
  carregando,
  itens,
  jaNaAgenda,
  juntando,
  juntados,
  onAlternar,
  onCriarCampanha,
  onPedidoInicio,
  onPedidoFim,
}: {
  dados: HypesDaSemana | null;
  daSemana: boolean;
  carregando: boolean;
  itens: ItemDoTrendy[];
  jaNaAgenda: number;
  juntando: boolean;
  juntados: ItemJuntado[];
  onAlternar: (item: ItemJuntado) => void;
  onCriarCampanha: (item: ItemJuntado) => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}) {
  const [todos, setTodos] = useState(false);
  const doMomento = itens.filter((x) => x.h.tipo !== "nicho");
  const doNicho = itens.filter((x) => x.h.tipo === "nicho");
  const pesquisadoEm = dados && dados.criado_em ? dados.criado_em.slice(0, 10) : null;

  if (carregando) return <div className="h-24 animate-pulse rounded-lg bg-muted" />;
  if (!dados) {
    return <EstadoVazio compacto titulo="Nenhuma leitura da semana ainda." descricao="Use “Buscar o que está em alta agora” no topo." />;
  }
  return (
    <div className="min-w-0 space-y-3" data-area="semana">
      {!daSemana && itens.length > 0 && <p className={texto.auxiliar}>Estes são da semana de {periodoCurto(dados.semana)}. Busque os desta semana.</p>}
      {dados.resumo && <p className="text-[13px] leading-relaxed [overflow-wrap:anywhere]">{dados.resumo}</p>}
      {jaNaAgenda > 0 && <p className={texto.auxiliar}>{jaNaAgenda} já {jaNaAgenda === 1 ? "está" : "estão"} na agenda.</p>}
      {[
        { chave: "momento", titulo: "Hypes do momento", lista: doMomento },
        { chave: "nicho", titulo: "Em alta no nicho", lista: doNicho },
      ].filter((g) => g.lista.length > 0).map((g) => {
        const visiveis = todos ? g.lista : g.lista.slice(0, VISIVEIS);
        return (
          <div key={g.chave} className="space-y-2">
            {doNicho.length > 0 && (
              <h3 className="flex items-center text-[12px] font-semibold text-muted-foreground">
                {g.chave === "nicho" ? <TrendingUp className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Flame className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {g.titulo}
              </h3>
            )}
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {visiveis.map(({ h, indice }) => {
                const item = juntadoDaLeitura(h, indice, pesquisadoEm);
                return (
                  <CartaoDoHype
                    key={`${h.titulo}-${indice}`}
                    hype={h}
                    item={item}
                    juntando={juntando}
                    marcado={juntados.some((x) => x.chave === item.chave)}
                    podeMarcar={podeJuntar(juntados, item)}
                    onMarcar={() => onAlternar(item)}
                    onCriarCampanha={() => onCriarCampanha(item)}
                    onPedidoInicio={onPedidoInicio}
                    onPedidoFim={onPedidoFim}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      {(doMomento.length > VISIVEIS || doNicho.length > VISIVEIS) && (
        <button type="button" onClick={() => setTodos((v) => !v)} className="toque-compacto text-[12px] font-medium text-primary hover:underline">
          {todos ? "Mostrar menos" : `Ver todos (${itens.length})`}
        </button>
      )}
    </div>
  );
}
