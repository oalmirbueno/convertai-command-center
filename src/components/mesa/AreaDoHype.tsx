import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, FilePlus2, Megaphone, Sparkles } from "lucide-react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import LinhaDoHypeETrending, { Detalhe } from "./LinhaDoHypeETrending";
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

interface Props {
  hoje: string;
  leitura: ItemDoTrendy[];
  pesquisadoEm: string | null;
  juntados: ItemJuntado[];
  onAlternar: (item: ItemJuntado) => void;
  onCriarCampanha: (item: ItemJuntado) => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}

/** Linha do tempo das próximas 8 semanas: barra = janela (aquece até o fim), ponto = pico. */
function LinhaDoTempo({ datas, hoje }: { datas: DataDoHype[]; hoje: string }) {
  const faixa = faixaDaLinha(hoje, SEMANAS);
  const hojeNaLinha = posicaoNaLinha({ inicio: hoje, pico: hoje, fim: hoje }, faixa).pico;
  return (
    <div className="min-w-0" role="img" aria-label={`Linha do tempo das próximas ${SEMANAS} semanas: ${datas.map((d) => `${d.titulo}, pico ${d.pico.slice(8, 10)}/${d.pico.slice(5, 7)}`).join("; ")}`} data-linha-do-tempo="">
      <div className="grid min-w-0 grid-cols-1 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-x-3">
        <span className="hidden sm:block" aria-hidden="true" />
        <div className="grid min-w-0 grid-cols-8 border-b border-border pb-1" aria-hidden="true">
          {faixa.semanas.map((s) => (
            <span key={s.inicio} className="truncate text-[11px] tabular-nums text-muted-foreground">{s.rotulo}</span>
          ))}
        </div>
      </div>
      <ul className="min-w-0">
        {datas.map((d) => {
          const p = posicaoNaLinha(d, faixa);
          return (
            <li key={`${d.id}-${d.pico}`} className="grid min-w-0 grid-cols-1 items-center py-1 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-x-3">
              <span className="truncate text-[12px] text-foreground" title={`${d.titulo}: ${quandoDaData(d)}`}>{d.titulo}</span>
              <span className="relative block h-3 min-w-0" aria-hidden="true">
                <span className="absolute inset-y-1 left-0 right-0 rounded-full bg-muted" />
                <span className="absolute inset-y-0.5 rounded-full bg-primary/30" style={{ left: `${p.esquerda}%`, width: `${p.largura}%` }} />
                {p.pico !== null && <span className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-background bg-primary" style={{ left: `${p.pico}%` }} />}
                {hojeNaLinha !== null && <span className="absolute -top-0.5 h-4 w-px bg-foreground/50" style={{ left: `${hojeNaLinha}%` }} />}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[11px] text-muted-foreground">Barra: quando aquece até o fim · ponto: o pico · traço: hoje</p>
    </div>
  );
}

export default function AreaDoHype({ hoje, leitura, pesquisadoEm, juntados, onAlternar, onCriarCampanha, onPedidoInicio, onPedidoFim }: Props) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<"todos" | TipoDeData>("todos");
  const [modo, setModo] = useState<"data" | "relevancia">("data");
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

  const acoes = (rotulo: string, mensagem: () => string, hype: { tipo: "hype" | "nicho"; titulo: string }, item: ItemJuntado) => (
    <>
      <BotaoComCusto
        rotulo={<><FilePlus2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Criar conteúdo</span></>}
        titulo={`Conteúdo sobre "${rotulo}"`}
        descricao="Criar conteúdo: o agente do mês prepara com o contexto do cliente e põe no próximo espaço livre da agenda; aparece na conversa, pronto para gravar."
        partes={() => partesDoPedido(catalogo, 0)}
        executar={() => pedir(mensagem(), hype)}
        variant="ghost"
        className="toque-compacto h-8 px-2"
      />
      <button type="button" className={botao.icone} onClick={() => onCriarCampanha(item)} aria-label="Criar campanha" title={`Criar campanha com "${rotulo}"`}>
        <Megaphone className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );

  return (
    <div className="min-w-0 space-y-4" data-area="hype">
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <p className={juntar(texto.auxiliar, "mb-1 mr-3")}>Datas e eventos das próximas {SEMANAS} semanas</p>
        <div className="-m-1 flex min-w-0 flex-wrap items-center">
          {tiposPresentes.length > 1 && (
            <span className="m-1">
              <SeletorCompacto
                rotulo="Tipo de data"
                modo="lista"
                opcoes={[{ valor: "todos", rotulo: "Todas" }].concat(tiposPresentes.map((t) => ({ valor: t, rotulo: ROTULO_DO_TIPO_DE_DATA[t] })))}
                valor={tipo}
                onEscolher={(v) => setTipo(v as "todos" | TipoDeData)}
              />
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
        </div>
      </div>
      {notas.data && notas.data.jev_erro && <p className="text-[12px] text-muted-foreground">O Jev não respondeu agora; as datas seguem na ordem do calendário.</p>}

      {datas.length > 0 ? <LinhaDoTempo datas={datas.slice(0, 10)} hoje={hoje} /> : <p className={texto.auxiliar}>Nenhuma data deste tipo nas próximas semanas.</p>}

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
              apoio={<><span className="font-medium text-foreground">{d.mesInteiro && falta < 0 ? "em andamento" : rotuloDoFalta(falta)}</span> · {quandoDaData(d)} · {ROTULO_DO_TIPO_DE_DATA[d.tipo]}</>}
              marcado={marcado(item.chave)}
              podeMarcar={podeJuntar(juntados, item)}
              onMarcar={() => onAlternar(item)}
              destaque={falta >= 0 && falta <= 7}
              detalhes={
                <>
                  {nota && nota.nivel && <Detalhe rotulo="Para este cliente (Jev)">{nota.nivel}</Detalhe>}
                  <Detalhe rotulo="Por que importa">{d.porQue}</Detalhe>
                  <Detalhe rotulo="Como usar">{d.comoUsar}</Detalhe>
                </>
              }
              acoes={acoes(d.titulo, () => mensagemDaData(d), { tipo: "hype", titulo: d.titulo }, item)}
            />
          );
        })}
      </ul>

      {leitura.length > 0 && (
        <div className="min-w-0 space-y-1">
          <h3 className={juntar(texto.rotulo, "flex items-center")}>
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Lidos na web{pesquisadoEm ? ` (pesquisa de ${pesquisadoEm.slice(8, 10)}/${pesquisadoEm.slice(5, 7)})` : ""}
          </h3>
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Hypes lidos na web">
            {leitura.map(({ h, indice }) => {
              const item = juntadoDaLeitura(h, indice, pesquisadoEm);
              const link = linkSeguro(h.fonte);
              return (
                <LinhaDoHypeETrending
                  key={item.chave}
                  titulo={h.titulo}
                  nota={typeof h.nota === "number" ? h.nota : null}
                  apoio={<>{ROTULO_DA_JANELA[String(h.janela || "")] || "esta semana"}{h.o_que_e ? ` · ${h.o_que_e}` : ""}</>}
                  marcado={marcado(item.chave)}
                  podeMarcar={podeJuntar(juntados, item)}
                  onMarcar={() => onAlternar(item)}
                  detalhes={
                    <>
                      {h.por_que_agora && <Detalhe rotulo="Por que agora">{h.por_que_agora}</Detalhe>}
                      {h.como_usar && <Detalhe rotulo="Como usar">{h.como_usar}</Detalhe>}
                      {h.cuidado && <Detalhe rotulo="Cuidado">{h.cuidado}</Detalhe>}
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center text-primary hover:underline" aria-label={`Ver fonte de ${h.titulo}`}>
                          <span className="truncate">{dominioDoLink(link)}</span><ExternalLink className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
                        </a>
                      )}
                    </>
                  }
                  acoes={acoes(h.titulo, () => mensagemDoHype(h), { tipo: "hype", titulo: h.titulo }, item)}
                />
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
