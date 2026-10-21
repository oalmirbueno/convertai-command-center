import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FilePlus2, Megaphone, Newspaper, Search, TrendingUp } from "lucide-react";
import CampoDeBusca from "@/components/sistema/CampoDeBusca";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import LinhaDoHypeETrending, { Detalhe } from "./LinhaDoHypeETrending";
import {
  buscarTrending, filtrarNoticias, fontesDasNoticias, juntadoDaLeitura, juntadoDaNoticia, mensagemDaNoticia, podeJuntar, quandoDaNoticia,
  RECENCIAS, type ItemJuntado, type Recencia,
} from "./hypeETrending";
import { chaves, dominioDoLink, linkSeguro, mensagemDoHype, partesDoPedido, pedidoLivre } from "./mesaV4Api";
import type { ItemDoTrendy } from "./trendy";

interface Props {
  /** Assuntos prontos para clicar além dos que o servidor sugere (ex.: as próximas datas do Hype). */
  assuntosExtras: string[];
  nicho: ItemDoTrendy[];
  pesquisadoEm: string | null;
  juntados: ItemJuntado[];
  onAlternar: (item: ItemJuntado) => void;
  onCriarCampanha: (item: ItemJuntado) => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}

/**
 * Trending: o que está em alta AGORA. Manchetes reais do Google Notícias (assunto, fonte, data real e link
 * da matéria), busca livre, recência (24 h, 7 dias, 30 dias) e fonte. Mais o "em alta no nicho" da leitura
 * semanal. Buscar notícias não custa IA.
 */
export default function AreaDoTrending({ assuntosExtras, nicho, pesquisadoEm, juntados, onAlternar, onCriarCampanha, onPedidoInicio, onPedidoFim }: Props) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [rascunho, setRascunho] = useState("");
  const [pedido, setPedido] = useState<{ clientId: string; assunto: string; recencia: Recencia } | null>(null);
  const [fonte, setFonte] = useState("");
  const atual = pedido && pedido.clientId === clientId ? pedido : null;
  const recencia: Recencia = atual ? atual.recencia : "7d";

  const noticias = useQuery({
    queryKey: ["mesa", "trending", clientId, atual ? atual.assunto.toLowerCase() : "", recencia],
    queryFn: () => buscarTrending(clientId, atual ? atual.assunto : "", recencia),
    enabled: !!atual,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const buscar = (assunto: string, r: Recencia = recencia) => {
    setFonte("");
    setRascunho(assunto);
    setPedido({ clientId, assunto: assunto.trim(), recencia: r });
  };

  const dados = noticias.data && atual ? noticias.data : null;
  const agora = Date.now();
  const itens = dados ? filtrarNoticias(dados.itens || [], { recencia, fonte }, agora) : [];
  const fontes = dados ? fontesDasNoticias(dados.itens || []) : [];
  const sugeridos = (dados ? dados.sugeridos : []).concat(assuntosExtras).filter((a, i, l) => a && l.indexOf(a) === i).slice(0, 8);
  const marcado = (chave: string) => juntados.some((x) => x.chave === chave);

  const pedir = async (mensagem: string, titulo: string) => {
    if (onPedidoInicio) onPedidoInicio({ mensagem, desde: Date.now() });
    try {
      const data = await pedidoLivre({ clientId, mensagem, hype: { tipo: "nicho", titulo } });
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      return data;
    } finally {
      if (onPedidoFim) onPedidoFim();
    }
  };

  const acoes = (titulo: string, mensagem: () => string, item: ItemJuntado, rotuloDoConteudo: string) => (
    <>
      <BotaoComCusto
        rotulo={<><FilePlus2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{rotuloDoConteudo}</span></>}
        titulo={`Conteúdo sobre "${titulo}"`}
        descricao={`${rotuloDoConteudo}: o agente do mês prepara com o contexto do cliente e põe no próximo espaço livre da agenda; aparece na conversa, pronto para gravar.`}
        partes={() => partesDoPedido(catalogo, 0)}
        executar={() => pedir(mensagem(), titulo)}
        variant="ghost"
        className="toque-compacto h-8 px-2"
      />
      <button type="button" className={botao.icone} onClick={() => onCriarCampanha(item)} aria-label="Criar campanha" title={`Criar campanha com "${titulo}"`}>
        <Megaphone className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );

  return (
    <div className="min-w-0 space-y-4" data-area="trending">
      <form
        className="flex min-w-0 items-center"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          buscar(rascunho);
        }}
      >
        <CampoDeBusca className="mr-2 flex-1" valor={rascunho} onMudar={setRascunho} placeholder="Assunto (ex.: Black Friday, odontologia)" rotulo="Assunto das notícias" />
        <button type="submit" className={botao.secundario} aria-label="Buscar notícias" title="Buscar notícias deste assunto (sem custo)">
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>

      {sugeridos.length > 0 && (
        <div className="-m-1 flex min-w-0 flex-wrap" aria-label="Assuntos sugeridos">
          {sugeridos.map((a) => (
            <button key={a} type="button" onClick={() => buscar(a)} className={juntar(botao.barra, "m-1 max-w-full border border-border", atual && atual.assunto.toLowerCase() === a.toLowerCase() ? "border-primary text-primary" : "")} title={`Buscar notícias de ${a}`}>
              <span className="truncate">{a}</span>
            </button>
          ))}
        </div>
      )}

      {atual && (
        <div className="-m-1 flex min-w-0 flex-wrap items-center">
          <span className="m-1">
            <SeletorCompacto rotulo="Recência" opcoes={RECENCIAS.map((r) => ({ valor: r.valor, rotulo: r.rotulo }))} valor={recencia} onEscolher={(v) => buscar(atual.assunto, v as Recencia)} />
          </span>
          {fontes.length > 1 && (
            <span className="m-1">
              <SeletorCompacto rotulo="Fonte" modo="lista" opcoes={[{ valor: "", rotulo: "Todas as fontes" }].concat(fontes.map((f) => ({ valor: f, rotulo: f })))} valor={fonte} onEscolher={setFonte} />
            </span>
          )}
        </div>
      )}

      {!atual && (
        <EstadoVazio
          compacto
          titulo="Notícias em alta agora."
          descricao="Manchetes reais por assunto, com fonte, data e link."
          acao={<button type="button" className={botao.primario} onClick={() => buscar(rascunho)}>Buscar o que está em alta</button>}
        />
      )}
      {atual && noticias.isLoading && <Carregando rotulo="Buscando notícias" linhas={4} />}
      {atual && noticias.isError && (
        <EstadoDeErro
          titulo="Não foi possível buscar as notícias."
          descricao={noticias.error instanceof Error ? noticias.error.message : undefined}
          acao={<button type="button" className={botao.secundario} onClick={() => void noticias.refetch()}>Tentar de novo</button>}
        />
      )}
      {dados && dados.sem_assunto && <p className={texto.auxiliar}>Escreva um assunto ou escolha um dos sugeridos.</p>}
      {dados && !dados.sem_assunto && (
        <p role="status" className={texto.auxiliar}>
          {itens.length} {itens.length === 1 ? "notícia" : "notícias"} sobre “{dados.assunto}” · {dados.fonte || "Google Notícias"}
        </p>
      )}
      {dados && !dados.sem_assunto && !itens.length && !noticias.isFetching && (
        <EstadoVazio compacto titulo="Nenhuma notícia nesse período." descricao="Tente 30 dias ou outro assunto." acao={recencia !== "30d" ? <button type="button" className={botao.secundario} onClick={() => buscar(dados.assunto, "30d")}>Ver 30 dias</button> : undefined} />
      )}
      {itens.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Notícias em alta">
          {itens.map((n) => {
            const item = juntadoDaNoticia(n);
            return (
              <LinhaDoHypeETrending
                key={item.chave}
                titulo={n.titulo}
                apoio={
                  <span className="flex min-w-0 items-center">
                    <Newspaper className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{n.fonte} · {quandoDaNoticia(n.data, agora)}</span>
                    <a href={n.link} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex shrink-0 items-center text-primary hover:underline" aria-label={`Abrir a matéria: ${n.titulo}`} title="Abrir a matéria">
                      matéria<ExternalLink className="ml-0.5 h-3 w-3" aria-hidden="true" />
                    </a>
                  </span>
                }
                marcado={marcado(item.chave)}
                podeMarcar={podeJuntar(juntados, item)}
                onMarcar={() => onAlternar(item)}
                acoes={acoes(n.titulo, () => mensagemDaNoticia(n), item, "Criar conteúdo desta notícia")}
              />
            );
          })}
        </ul>
      )}

      {nicho.length > 0 && (
        <div className="min-w-0 space-y-1">
          <h3 className={juntar(texto.rotulo, "flex items-center")}>
            <TrendingUp className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Em alta no nicho{pesquisadoEm ? ` (pesquisa de ${pesquisadoEm.slice(8, 10)}/${pesquisadoEm.slice(5, 7)})` : ""}
          </h3>
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Em alta no nicho">
            {nicho.map(({ h, indice }) => {
              const item = juntadoDaLeitura(h, indice, pesquisadoEm);
              const link = linkSeguro(h.fonte);
              return (
                <LinhaDoHypeETrending
                  key={item.chave}
                  titulo={h.titulo}
                  nota={typeof h.nota === "number" ? h.nota : null}
                  apoio={h.sinal || h.o_que_e || "em alta agora"}
                  marcado={marcado(item.chave)}
                  podeMarcar={podeJuntar(juntados, item)}
                  onMarcar={() => onAlternar(item)}
                  detalhes={
                    <>
                      {h.o_que_e && <Detalhe rotulo="O que é">{h.o_que_e}</Detalhe>}
                      {h.como_usar && <Detalhe rotulo="Como usar">{h.como_usar}</Detalhe>}
                      {h.cuidado && <Detalhe rotulo="Cuidado">{h.cuidado}</Detalhe>}
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center text-primary hover:underline" aria-label={`Ver fonte de ${h.titulo}`}>
                          <span className="truncate">{dominioDoLink(link)}</span><ExternalLink className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
                        </a>
                      )}
                    </>
                  }
                  acoes={acoes(h.titulo, () => mensagemDoHype(h), item, "Criar conteúdo")}
                />
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
