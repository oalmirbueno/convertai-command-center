import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FilePlus2, Flame, GanttChart, Megaphone, Sparkles } from "lucide-react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import LinhaDoHypeETrending, { CabecalhoDaColuna, Detalhe, SubtituloDaLista } from "./LinhaDoHypeETrending";
import {
  datasDasProximasSemanas, diasAtePico, faixaDaLinha, posicaoNaLinha, quandoDaData, ROTULO_DO_TIPO_DE_DATA, rotuloDoFalta,
  type DataDoHype, type TipoDeData,
} from "./datasDoHype";
import {
  juntadoDaData, juntadoDaLeitura, mensagemDaData, ordenarDatas, ordenarDatasDoHype, podeJuntar,
  type ItemJuntado, type RespostaDasNotas,
} from "./hypeETrending";
import { chaves, dominioDoLink, linkSeguro, mensagemDoHype, partesDoPedido, pedidoLivre, ROTULO_DA_JANELA } from "./mesaV4Api";
import type { ItemDoTrendy } from "./trendy";

const SEMANAS = 8;
/** Mesma altura nas duas colunas (de 1024 px para cima); no celular a lista segue a página. */
export const COLUNA_DO_HYPE = "flex min-w-0 flex-col lg:h-[640px]";

interface Props {
  hoje: string;
  leitura: ItemDoTrendy[];
  pesquisadoEm: string | null;
  resumoDaLeitura?: string | null;
  jaNaAgenda?: number;
  juntados: ItemJuntado[];
  onAlternar: (item: ItemJuntado) => void;
  onCriarCampanha: (item: ItemJuntado) => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}

/** Linha do tempo das próximas 8 semanas, na mesma grade da lista (o nome alinha com o título das linhas). */
function LinhaDoTempo({ datas, hoje }: { datas: DataDoHype[]; hoje: string }) {
  const faixa = faixaDaLinha(hoje, SEMANAS);
  const hojeNaLinha = posicaoNaLinha({ inicio: hoje, pico: hoje, fim: hoje }, faixa).pico;
  const grade = "grid min-w-0 grid-cols-[20px_minmax(0,2fr)_minmax(0,5fr)] items-center gap-x-2 px-2";
  return (
    <div className="-mx-2 min-w-0 pb-2 pt-2" role="img" aria-label={`Linha do tempo das próximas ${SEMANAS} semanas: ${datas.map((d) => `${d.titulo}, pico ${d.pico.slice(8, 10)}/${d.pico.slice(5, 7)}`).join("; ")}`} data-linha-do-tempo="">
      <div className={grade} aria-hidden="true">
        <span />
        <span />
        <span className="grid min-w-0 grid-cols-8">
          {faixa.semanas.map((s, i) => <span key={s.inicio} className={juntar("truncate text-[11px] tabular-nums text-muted-foreground", i % 2 ? "max-sm:invisible" : "")}>{s.rotulo}</span>)}
        </span>
      </div>
      {datas.map((d) => {
        const p = posicaoNaLinha(d, faixa);
        return (
          <div key={`${d.id}-${d.pico}`} className={juntar(grade, "py-0.5")} aria-hidden="true">
            <span />
            <span className="truncate text-[12px] text-muted-foreground" title={`${d.titulo}: ${quandoDaData(d)}`}>{d.titulo}</span>
            <span className="relative block h-3 min-w-0">
              <span className="absolute inset-x-0 top-[5px] h-0.5 rounded-full bg-muted" />
              <span className="absolute top-1 h-1 rounded-full bg-primary/40" style={{ left: `${p.esquerda}%`, width: `${p.largura}%` }} />
              {p.pico !== null && <span className="absolute top-0.5 h-2 w-2 -translate-x-1/2 rounded-full bg-primary" style={{ left: `${p.pico}%` }} />}
              {hojeNaLinha !== null && <span className="absolute top-0 h-3 w-px bg-foreground/40" style={{ left: `${hojeNaLinha}%` }} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function AreaDoHype({ hoje, leitura, pesquisadoEm, resumoDaLeitura, jaNaAgenda = 0, juntados, onAlternar, onCriarCampanha, onPedidoInicio, onPedidoFim }: Props) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<"todos" | TipoDeData>("todos");
  const [modo, setModo] = useState<"data" | "relevancia">("data");
  const [linhaRecolhida, setLinhaRecolhida] = useRecolhido(`mesa:mes:hype:linha:${clientId}`, false);
  const todas = useMemo(() => datasDasProximasSemanas(hoje, SEMANAS), [hoje]);
  const chaveDasNotas = ["mesa", "hype-notas", clientId, todas.map((d) => d.id).join(",")];
  // Só lê o que já veio do Jev nesta visita (o botão é quem chama e paga).
  const notas = useQuery<RespostaDasNotas | null>({ queryKey: chaveDasNotas, queryFn: () => null, enabled: false, staleTime: Infinity });
  const notasPorId = notas.data && notas.data.notas && Object.keys(notas.data.notas).length ? notas.data.notas : null;
  const datas = ordenarDatas(todas.filter((d) => tipo === "todos" || d.tipo === tipo), notasPorId, notasPorId ? modo : "data");
  const tiposPresentes = Object.keys(ROTULO_DO_TIPO_DE_DATA).filter((t) => todas.some((d) => d.tipo === t)) as TipoDeData[];
  const marcado = (chave: string) => juntados.some((x) => x.chave === chave);

  const pedir = async (mensagem: string, hype: { tipo: "hype" | "nicho"; titulo: string }) => {
    if (onPedidoInicio) onPedidoInicio({ mensagem, desde: Date.now() });
    try {
      const data = await pedidoLivre({ clientId, mensagem, hype });
      await queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      return data;
    } finally {
      if (onPedidoFim) onPedidoFim();
    }
  };

  const ordenarPeloJev = async () => {
    const r = await ordenarDatasDoHype(clientId, todas);
    queryClient.setQueryData(chaveDasNotas, r);
    if (r && r.notas && Object.keys(r.notas).length) setModo("relevancia");
    return r;
  };

  const acoes = (titulo: string, mensagem: () => string, hype: { tipo: "hype" | "nicho"; titulo: string }, item: ItemJuntado, rotulo = "Criar conteúdo") => (
    <>
      <BotaoComCusto
        rotulo={<><FilePlus2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{rotulo}</span></>}
        titulo={`Conteúdo sobre "${titulo}"`}
        descricao={`${rotulo}: o agente do mês prepara com o contexto do cliente e põe no próximo espaço livre da agenda; aparece na conversa, pronto para gravar.`}
        partes={() => partesDoPedido(catalogo, 0)}
        executar={() => pedir(mensagem(), hype)}
        variant="ghost"
        className="toque-compacto h-8 px-2"
      />
      <button type="button" className={botao.icone} onClick={() => onCriarCampanha(item)} aria-label="Criar campanha" title={`Criar campanha com "${titulo}"`}>
        <Megaphone className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );

  return (
    <div className={COLUNA_DO_HYPE} data-area="hype">
      <CabecalhoDaColuna
        icone={<Flame className="h-4 w-4" />}
        titulo="Hype"
        ajuda={
          <>
            Datas e eventos das próximas {SEMANAS} semanas: quando o assunto começa a aquecer, o pico e até quando vale. Na linha do tempo, a barra é a janela, o ponto é o pico e o traço é hoje.
            {" "}Abaixo, os hypes da leitura semanal na web. A nota (0 a 10) é do Jev: quanto serve a este cliente.
          </>
        }
        controles={
          <>
            <button type="button" className={juntar(botao.icone, "m-1", !linhaRecolhida ? "text-foreground" : "")} onClick={() => setLinhaRecolhida(!linhaRecolhida)} aria-pressed={!linhaRecolhida} aria-label={linhaRecolhida ? "Mostrar a linha do tempo" : "Recolher a linha do tempo"} title={linhaRecolhida ? "Mostrar a linha do tempo" : "Recolher a linha do tempo"}>
              <GanttChart className="h-4 w-4" aria-hidden="true" />
            </button>
            {tiposPresentes.length > 1 && (
              <span className="m-1">
                <SeletorCompacto rotulo="Tipo de data" modo="lista" opcoes={[{ valor: "todos", rotulo: "Todas" }].concat(tiposPresentes.map((t) => ({ valor: t, rotulo: ROTULO_DO_TIPO_DE_DATA[t] })))} valor={tipo} onEscolher={(v) => setTipo(v as "todos" | TipoDeData)} />
              </span>
            )}
            {notasPorId ? (
              <span className="m-1">
                <SeletorCompacto rotulo="Ordem" opcoes={[{ valor: "relevancia", rotulo: "Relevância" }, { valor: "data", rotulo: "Data" }]} valor={modo} onEscolher={(v) => setModo(v as "data" | "relevancia")} />
              </span>
            ) : (
              <span className="m-1">
                <BotaoComCusto
                  rotulo={<><Sparkles className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Ordenar pela relevância para o cliente</span></>}
                  titulo="Datas ordenadas pelo cliente"
                  descricao="Ordenar pela relevância: o Jev dá a cada data uma nota de quanto ela serve ao negócio e ao público deste cliente."
                  partes={() => [{ modeloId: null, tipo: "texto", fixoUsd: 0.001 }]}
                  executar={ordenarPeloJev}
                  variant="ghost"
                  className="toque-compacto h-8 px-2"
                />
              </span>
            )}
          </>
        }
      />
      <RegiaoRolavel modo="lg" rotulo="Lista do Hype" memoria={`mesa:mes:hype:${clientId}`} className="pb-6">
        {notas.data && notas.data.jev_erro && <p className={juntar(texto.auxiliar, "pt-2")}>O Jev não respondeu agora; as datas seguem na ordem do calendário.</p>}
        {!linhaRecolhida && datas.length > 0 && <LinhaDoTempo datas={datas.slice(0, 10)} hoje={hoje} />}
        {datas.length === 0 && <p className={juntar(texto.auxiliar, "pt-3")}>Nenhuma data deste tipo nas próximas semanas.</p>}
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Datas que vêm por aí">
          {datas.map((d) => {
            const item = juntadoDaData(d, notasPorId ? notasPorId[d.id] : null);
            const nota = notasPorId && notasPorId[d.id] ? notasPorId[d.id] : null;
            const falta = diasAtePico(d, hoje);
            return (
              <LinhaDoHypeETrending
                key={item.chave}
                titulo={d.titulo}
                nota={nota ? nota.nota : null}
                apoio={`${d.mesInteiro && falta < 0 ? "em andamento" : rotuloDoFalta(falta)} · ${quandoDaData(d)}`}
                marcado={marcado(item.chave)}
                podeMarcar={podeJuntar(juntados, item)}
                onMarcar={() => onAlternar(item)}
                detalhes={
                  <>
                    {nota && nota.nivel && <Detalhe rotulo="Para este cliente (Jev)">{nota.nivel}</Detalhe>}
                    <Detalhe rotulo="Por que importa">{d.porQue}</Detalhe>
                    <Detalhe rotulo="Como usar">{d.comoUsar}</Detalhe>
                    <Detalhe rotulo="Tipo">{ROTULO_DO_TIPO_DE_DATA[d.tipo]}</Detalhe>
                  </>
                }
                acoes={acoes(d.titulo, () => mensagemDaData(d), { tipo: "hype", titulo: d.titulo }, item)}
              />
            );
          })}
        </ul>

        {(leitura.length > 0 || jaNaAgenda > 0) && (
          <>
            <SubtituloDaLista apoio={[pesquisadoEm ? `pesquisa de ${pesquisadoEm.slice(8, 10)}/${pesquisadoEm.slice(5, 7)}` : "", jaNaAgenda ? `${jaNaAgenda} já na agenda` : ""].filter(Boolean).join(" · ")}>
              Lidos na web
            </SubtituloDaLista>
            {resumoDaLeitura && <p className={juntar(texto.auxiliar, "truncate pb-1 pl-7")} title={resumoDaLeitura}>{resumoDaLeitura}</p>}
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Hypes lidos na web">
              {leitura.map(({ h, indice }) => {
                const item = juntadoDaLeitura(h, indice, pesquisadoEm);
                const link = linkSeguro(h.fonte);
                const temPauta = !!(h.pauta && h.pauta.tema);
                return (
                  <LinhaDoHypeETrending
                    key={item.chave}
                    titulo={h.titulo}
                    nota={typeof h.nota === "number" ? h.nota : null}
                    apoio={[ROTULO_DA_JANELA[String(h.janela || "")] || "esta semana", h.formato ? (h.formato === "estatico" ? "estático" : h.formato) : "", h.o_que_e || ""].filter(Boolean).join(" · ")}
                    marcado={marcado(item.chave)}
                    podeMarcar={podeJuntar(juntados, item)}
                    onMarcar={() => onAlternar(item)}
                    detalhes={
                      <>
                        {h.o_que_e && <Detalhe rotulo="O que é">{h.o_que_e}</Detalhe>}
                        {h.por_que_agora && <Detalhe rotulo="Por que agora">{h.por_que_agora}</Detalhe>}
                        {h.como_usar && <Detalhe rotulo="Como usar">{h.como_usar}</Detalhe>}
                        {h.cuidado && <Detalhe rotulo="Cuidado">{h.cuidado}</Detalhe>}
                        {temPauta && h.pauta && (
                          <Detalhe rotulo="Pauta pronta (sem data)">
                            <p className="font-medium">{h.pauta.tema}</p>
                            {h.pauta.gancho && <p className="text-muted-foreground">Capa: {h.pauta.gancho}</p>}
                            {h.pauta.laminas.length > 0 && <ol className="mt-1 list-decimal space-y-0.5 pl-4">{h.pauta.laminas.map((l, i) => <li key={i}>{l}</li>)}</ol>}
                          </Detalhe>
                        )}
                        {link && (
                          <a href={link} target="_blank" rel="noopener noreferrer" className="toque-compacto inline-flex max-w-full items-center text-primary hover:underline" aria-label={`Ver fonte de ${h.titulo}`}>
                            <span className="truncate">{dominioDoLink(link)}</span><ExternalLink className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
                          </a>
                        )}
                      </>
                    }
                    acoes={acoes(h.titulo, () => mensagemDoHype(h), { tipo: "hype", titulo: h.titulo }, item, temPauta ? "Usar a pauta" : "Criar conteúdo")}
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
