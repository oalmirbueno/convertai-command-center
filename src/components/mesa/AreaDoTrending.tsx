import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FilePlus2, Megaphone, Newspaper } from "lucide-react";
import CampoDeBusca from "@/components/sistema/CampoDeBusca";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import LinhaDoHypeETrending, { CabecalhoDaColuna, Detalhe, SubtituloDaLista } from "./LinhaDoHypeETrending";
import { COLUNA_DO_HYPE } from "./AreaDoHype";
import {
  buscarTrending, filtrarNoticias, fontesDasNoticias, juntadoDaLeitura, juntadoDaNoticia, mensagemDaNoticia, podeJuntar, quandoDaNoticia,
  RECENCIAS, type ItemJuntado, type Recencia,
} from "./hypeETrending";
import { chaves, dominioDoLink, linkSeguro, mensagemDoHype, partesDoPedido, pedidoLivre } from "./mesaV4Api";
import type { ItemDoTrendy } from "./trendy";

/** A busca de notícias em curso (fica na seção: o "Buscar o que está em alta agora" do topo também dispara). */
export interface ConsultaDoTrending {
  clientId: string;
  assunto: string;
  recencia: Recencia;
  /** Muda a cada pedido explícito: a mesma busca refeita relê. */
  vez: number;
}

interface Props {
  consulta: ConsultaDoTrending | null;
  onConsulta: (c: { assunto: string; recencia: Recencia }) => void;
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

const MAXIMO_DE_SUGERIDOS = 4;

/**
 * Trending: o que está em alta AGORA. Manchetes reais do Google Notícias (assunto, fonte, data real e link
 * da matéria), busca livre, recência e fonte, mais o "em alta no nicho" da leitura semanal (o de antes).
 * Buscar notícias não custa IA.
 */
export default function AreaDoTrending({ consulta, onConsulta, assuntosExtras, nicho, pesquisadoEm, juntados, onAlternar, onCriarCampanha, onPedidoInicio, onPedidoFim }: Props) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const atual = consulta && consulta.clientId === clientId ? consulta : null;
  const [rascunho, setRascunho] = useState({ clientId, texto: "" });
  const textoDoRascunho = rascunho.clientId === clientId ? rascunho.texto : "";
  const [fonte, setFonte] = useState("");
  const recencia: Recencia = atual ? atual.recencia : "7d";

  const noticias = useQuery({
    queryKey: ["mesa", "trending", clientId, atual ? atual.assunto.toLowerCase() : "", recencia, atual ? atual.vez : 0],
    queryFn: () => buscarTrending(clientId, atual ? atual.assunto : "", recencia),
    enabled: !!atual,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const buscar = (assunto: string, r: Recencia = recencia) => {
    setFonte("");
    setRascunho({ clientId, texto: assunto });
    onConsulta({ assunto: assunto.trim(), recencia: r });
  };

  const dados = noticias.data && atual ? noticias.data : null;
  const agora = Date.now();
  const itens = dados ? filtrarNoticias(dados.itens || [], { recencia, fonte }, agora) : [];
  const fontes = dados ? fontesDasNoticias(dados.itens || []) : [];
  const sugeridos = ((dados && dados.sugeridos) || []).concat(assuntosExtras).filter((a, i, l) => a && l.indexOf(a) === i).slice(0, MAXIMO_DE_SUGERIDOS);
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
    <div className={COLUNA_DO_HYPE} data-area="trending">
      <CabecalhoDaColuna
        icone={<Newspaper className="h-4 w-4" />}
        titulo="Trending"
        ajuda="O que está em alta agora: manchetes reais do Google Notícias por assunto, com a fonte, a data da matéria e o link. Buscar não custa IA. Abaixo, o que viraliza no nicho pela leitura semanal."
        controles={
          atual ? (
            <>
              <span className="m-1">
                <SeletorCompacto rotulo="Recência" opcoes={RECENCIAS.map((r) => ({ valor: r.valor, rotulo: r.rotulo }))} valor={recencia} onEscolher={(v) => buscar(atual.assunto, v as Recencia)} />
              </span>
              {fontes.length > 1 && (
                <span className="m-1">
                  <SeletorCompacto rotulo="Fonte" modo="lista" opcoes={[{ valor: "", rotulo: "Todas as fontes" }].concat(fontes.map((f) => ({ valor: f, rotulo: f })))} valor={fonte} onEscolher={setFonte} />
                </span>
              )}
            </>
          ) : undefined
        }
        abaixo={
          <>
            <form className="min-w-0" role="search" onSubmit={(e) => { e.preventDefault(); buscar(textoDoRascunho); }}>
              <CampoDeBusca valor={textoDoRascunho} onMudar={(v) => setRascunho({ clientId, texto: v })} placeholder="Buscar notícias por assunto" rotulo="Assunto das notícias" />
              <button type="submit" className="sr-only">Buscar notícias</button>
            </form>
            {sugeridos.length > 0 && (
              <div className="-mx-1 mt-1.5 flex min-w-0 flex-wrap" aria-label="Assuntos sugeridos">
                {sugeridos.map((a) => {
                  const ativo = !!atual && atual.assunto.toLowerCase() === a.toLowerCase();
                  return (
                    <button key={a} type="button" onClick={() => buscar(a)} aria-pressed={ativo} className={juntar(botao.barra, "mx-1 h-7 max-w-[11rem]", ativo ? "bg-muted text-foreground" : "")} title={`Buscar notícias de ${a}`}>
                      <span className="truncate">{a}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        }
      />
      <RegiaoRolavel modo="lg" rotulo="Lista do Trending" memoria={`mesa:mes:trending:${clientId}`} className="pb-6">
        {!atual && (
          <EstadoVazio
            compacto
            className="mt-3"
            titulo="Notícias em alta agora."
            acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => buscar(textoDoRascunho)}>Buscar o que está em alta</button>}
          />
        )}
        {atual && noticias.isLoading && <Carregando className="pt-3" rotulo="Buscando notícias" linhas={4} />}
        {atual && noticias.isError && (
          <EstadoDeErro
            className="mt-3"
            titulo="Não foi possível buscar as notícias."
            descricao={noticias.error instanceof Error ? noticias.error.message : undefined}
            acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void noticias.refetch()}>Tentar de novo</button>}
          />
        )}
        {dados && dados.sem_assunto && <p className={juntar(texto.auxiliar, "pt-3")}>Escreva um assunto ou escolha um dos sugeridos.</p>}
        {dados && !dados.sem_assunto && (
          <SubtituloDaLista apoio={`${itens.length} ${itens.length === 1 ? "notícia" : "notícias"} · ${dados.fonte || "Google Notícias"}`}>
            <span role="status">“{dados.assunto}”</span>
          </SubtituloDaLista>
        )}
        {dados && !dados.sem_assunto && !itens.length && !noticias.isFetching && (
          <EstadoVazio compacto titulo="Nenhuma notícia nesse período." acao={recencia !== "30d" ? <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => buscar(dados.assunto, "30d")}>Ver 30 dias</button> : undefined} />
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
                    <>
                      {n.fonte} · {quandoDaNoticia(n.data, agora)} ·{" "}
                      <a href={n.link} target="_blank" rel="noopener noreferrer" className="toque-compacto inline-flex items-center text-primary hover:underline" aria-label={`Abrir a matéria: ${n.titulo}`} title="Abrir a matéria">
                        matéria<ExternalLink className="ml-0.5 h-3 w-3" aria-hidden="true" />
                      </a>
                    </>
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
          <>
            <SubtituloDaLista apoio={pesquisadoEm ? `pesquisa de ${pesquisadoEm.slice(8, 10)}/${pesquisadoEm.slice(5, 7)}` : undefined}>Em alta no nicho</SubtituloDaLista>
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Em alta no nicho">
              {nicho.map(({ h, indice }) => {
                const item = juntadoDaLeitura(h, indice, pesquisadoEm);
                const link = linkSeguro(h.fonte);
                const temPauta = !!(h.pauta && h.pauta.tema);
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
                        {h.sinal && <Detalhe rotulo="Onde está viralizando">{h.sinal}</Detalhe>}
                        {h.o_que_e && <Detalhe rotulo="O que é">{h.o_que_e}</Detalhe>}
                        {h.como_usar && <Detalhe rotulo="Como usar">{h.como_usar}</Detalhe>}
                        {h.cuidado && <Detalhe rotulo="Cuidado">{h.cuidado}</Detalhe>}
                        {temPauta && h.pauta && (
                          <Detalhe rotulo="Pauta pronta (sem data)">
                            <p className="font-medium">{h.pauta.tema}</p>
                            {h.pauta.gancho && <p className="text-muted-foreground">Capa: {h.pauta.gancho}</p>}
                          </Detalhe>
                        )}
                        {link && (
                          <a href={link} target="_blank" rel="noopener noreferrer" className="toque-compacto inline-flex max-w-full items-center text-primary hover:underline" aria-label={`Ver fonte de ${h.titulo}`}>
                            <span className="truncate">{dominioDoLink(link)}</span><ExternalLink className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
                          </a>
                        )}
                      </>
                    }
                    acoes={acoes(h.titulo, () => mensagemDoHype(h), item, temPauta ? "Usar a pauta" : "Criar conteúdo")}
                  />
                );
              })}
            </ul>
          </>
        )}
      </RegiaoRolavel>
    </div>
  );
}
