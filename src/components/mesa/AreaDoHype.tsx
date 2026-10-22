import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronDown, GanttChart } from "lucide-react";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { avisarCustoReal, useAvisarErro } from "./Custo";
import { useMesa } from "./MesaContexto";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import LinhaDoHypeETrending, { BlocoDaLinha, CabecalhoDaColuna, Detalhe, AcoesDeCriar, MenuDeFiltro, SubtituloDaLista } from "./LinhaDoHypeETrending";
import {
  agruparPorPeriodo, blocoDaData, datasDasProximasSemanas, faixaDaLinha, linhaCurtaDaData, posicaoNaLinha, quandoDaData,
  ROTULO_DO_TIPO_DE_DATA, segundaDe, seloDaData, separarPeloNicho, type DataDoHype, type TipoDeData,
} from "./datasDoHype";
import {
  CUSTO_DO_JEV_NAS_DATAS_USD, juntadoDaData, mensagemDaData, ordenarDatas, ordenarDatasDoHype, podeJuntar,
  type ItemJuntado, type RespostaDasNotas,
} from "./hypeETrending";
import { chaves, partesDoPedido, pedidoLivre } from "./mesaV4Api";

const SEMANAS = 8;
/** Mesma altura nas duas colunas (de 1024 px para cima); no celular a lista segue a página. */
export const COLUNA_DO_HYPE = "flex min-w-0 flex-col lg:h-[640px]";
const CUSTO_DO_JEV_USD = CUSTO_DO_JEV_NAS_DATAS_USD;

/** Onde ficam as notas do Jev da semana (por cliente). */
export const chaveDasNotasDaSemana = (clientId: string, hoje: string) => `mesa:hype:notas:${clientId}:${segundaDe(hoje)}`;

/** As notas do Jev da semana ficam no navegador: reabrir na mesma semana não paga de novo. */
export function lerNotasGuardadas(chave: string): RespostaDasNotas | null {
  try {
    const bruto = window.localStorage.getItem(chave);
    const v = bruto ? JSON.parse(bruto) : null;
    return v && typeof v === "object" && v.notas && typeof v.notas === "object" ? (v as RespostaDasNotas) : null;
  } catch {
    return null;
  }
}
function guardarNotas(chave: string, r: RespostaDasNotas) {
  try {
    window.localStorage.setItem(chave, JSON.stringify({ notas: r.notas, segmento: r.segmento ?? null, custo_usd: r.custo_usd ?? 0 }));
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}

interface Props {
  hoje: string;
  juntando: boolean;
  juntados: ItemJuntado[];
  onAlternar: (item: ItemJuntado) => void;
  onCriarCampanha: (item: ItemJuntado) => void;
  onPedidoInicio?: (p: PedidoEmAndamento) => void;
  onPedidoFim?: () => void;
}

/** Linha do tempo das próximas 8 semanas, na mesma grade da lista (o nome fica sob o título das linhas). */
function LinhaDoTempo({ datas, hoje }: { datas: DataDoHype[]; hoje: string }) {
  const faixa = faixaDaLinha(hoje, SEMANAS);
  const hojeNaLinha = posicaoNaLinha({ inicio: hoje, pico: hoje, fim: hoje }, faixa).pico;
  const grade = "grid min-w-0 grid-cols-[40px_minmax(0,2fr)_minmax(0,5fr)] items-center gap-x-3 px-2";
  return (
    <div className="-mx-2 min-w-0 pb-1 pt-3" role="img" aria-label={`Linha do tempo das próximas ${SEMANAS} semanas: ${datas.map((d) => `${d.titulo}, pico ${d.pico.slice(8, 10)}/${d.pico.slice(5, 7)}`).join("; ")}`} data-linha-do-tempo="">
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

export default function AreaDoHype({ hoje, juntando, juntados, onAlternar, onCriarCampanha, onPedidoInicio, onPedidoFim }: Props) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [tipo, setTipo] = useState<"todos" | TipoDeData>("todos");
  const [modo, setModo] = useState<"data" | "relevancia">("relevancia");
  const [outrasAbertas, setOutrasAbertas] = useState(false);
  const [ordenando, setOrdenando] = useState(false);
  const [linhaRecolhida, setLinhaRecolhida] = useRecolhido(`mesa:mes:hype:linha:${clientId}`, true);
  const todas = useMemo(() => datasDasProximasSemanas(hoje, SEMANAS), [hoje]);
  const chaveDasNotas = ["mesa", "hype-notas", clientId, todas.map((d) => d.id).join(",")];
  const chaveDaSemana = chaveDasNotasDaSemana(clientId, hoje);
  // 21/10 (dono: "tem que puxar com base no nicho"): as notas do Jev da semana; na 1ª abertura da semana o Jev roda sozinho.
  const notas = useQuery<RespostaDasNotas | null>({ queryKey: chaveDasNotas, queryFn: () => lerNotasGuardadas(chaveDaSemana), staleTime: Infinity });
  const notasPorId = notas.data && notas.data.notas && Object.keys(notas.data.notas).length ? notas.data.notas : null;
  const segmento = notas.data ? notas.data.segmento : null;
  const filtradas = todas.filter((d) => tipo === "todos" || d.tipo === tipo);
  // O que não tem a ver com o nicho sai da lista principal (fica em "Outras datas", recolhido).
  const { principais, outras } = separarPeloNicho(ordenarDatas(filtradas, notasPorId, notasPorId ? modo : "data"), notasPorId, segmento);
  const datas = principais;
  const grupos = agruparPorPeriodo(datas, hoje);
  const tentouSozinho = useRef("");
  useEffect(() => {
    if (!notas.isSuccess || notas.data || tentouSozinho.current === chaveDaSemana || !todas.length) return;
    tentouSozinho.current = chaveDaSemana;
    ordenarDatasDoHype(clientId, todas)
      .then((r) => {
        if (r && r.notas && Object.keys(r.notas).length) guardarNotas(chaveDaSemana, r);
        queryClient.setQueryData(chaveDasNotas, r);
        mesa.atualizarCusto();
      })
      .catch(() => {
        // Sem Jev agora: a regra de tipo e segmento separa as datas; o menu de ordenar tenta de novo.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notas.isSuccess, notas.data, chaveDaSemana]);
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

  const escolherOrdem = async (v: string) => {
    if (v === "data" || notasPorId) {
      setModo(v as "data" | "relevancia");
      return;
    }
    setOrdenando(true);
    try {
      const r = await ordenarDatasDoHype(clientId, todas);
      if (r && r.notas && Object.keys(r.notas).length) guardarNotas(chaveDaSemana, r);
      queryClient.setQueryData(chaveDasNotas, r);
      avisarCustoReal("Datas ordenadas pelo cliente", r, mesa.atualizarCusto);
      if (r && r.notas && Object.keys(r.notas).length) setModo("relevancia");
    } catch (e) {
      mesa.atualizarCusto();
      avisarErro(e, "Datas ordenadas pelo cliente");
    } finally {
      setOrdenando(false);
    }
  };

  const criar = (titulo: string, mensagem: () => string, hype: { tipo: "hype" | "nicho"; titulo: string }, item: ItemJuntado, rotulo = "Criar conteúdo") => (
    <AcoesDeCriar titulo={titulo} rotuloDoConteudo={rotulo} partes={() => partesDoPedido(catalogo, 0)} executar={() => pedir(mensagem(), hype)} onCampanha={() => onCriarCampanha(item)} />
  );

  const linhaDaData = (d: DataDoHype) => {
    const item = juntadoDaData(d, notasPorId ? notasPorId[d.id] : null);
    const nota = notasPorId && notasPorId[d.id] ? notasPorId[d.id] : null;
    const selo = seloDaData(d, hoje);
    const b = blocoDaData(d.pico);
    return (
      <LinhaDoHypeETrending
        key={item.chave}
        bloco={<BlocoDaLinha dia={b.dia} mes={b.mes} destaque={!!selo} />}
        titulo={d.titulo}
        apoio={linhaCurtaDaData(d, hoje)}
        selo={selo}
        nota={nota ? nota.nota : null}
        juntando={juntando}
        marcado={marcado(item.chave)}
        podeMarcar={podeJuntar(juntados, item)}
        onMarcar={() => onAlternar(item)}
        detalhes={
          <>
            {nota && nota.nivel && <Detalhe rotulo="Para este cliente (Jev)">{nota.nivel}</Detalhe>}
            <Detalhe rotulo="Por que importa">{d.porQue}</Detalhe>
            <Detalhe rotulo="Como usar">{d.comoUsar}</Detalhe>
            <Detalhe rotulo="Janela">{quandoDaData(d)} · {ROTULO_DO_TIPO_DE_DATA[d.tipo]}</Detalhe>
          </>
        }
        criar={criar(d.titulo, () => mensagemDaData(d), { tipo: "hype", titulo: d.titulo }, item)}
      />
    );
  };

  return (
    <div className={COLUNA_DO_HYPE} data-area="hype">
      <CabecalhoDaColuna
        icone={<CalendarDays className="h-4 w-4" />}
        titulo="Datas"
        ajuda={
          <>
            Datas e eventos das próximas {SEMANAS} semanas que têm a ver com o nicho do cliente, por período (o Jev separa uma vez por semana; o resto fica em “Outras datas”). "Aqueça já": o assunto já está aquecendo; "Agora": está no pico.
            {" "}Clique na linha para ver por que importa e como usar. A nota (0 a 10) é do Jev: quanto a data serve a este cliente.
            {" "}Na linha do tempo, a barra é a janela, o ponto é o pico e o traço é hoje.
          </>
        }
        controles={
          <>
            <button type="button" className={juntar(botao.icone, !linhaRecolhida ? "text-primary" : "")} onClick={() => setLinhaRecolhida(!linhaRecolhida)} aria-pressed={!linhaRecolhida} aria-label={linhaRecolhida ? "Mostrar a linha do tempo" : "Recolher a linha do tempo"} title={linhaRecolhida ? "Mostrar a linha do tempo" : "Recolher a linha do tempo"}>
              <GanttChart className="h-4 w-4" aria-hidden="true" />
            </button>
            <MenuDeFiltro
              grupos={[
                { rotulo: "Mostrar", valor: tipo, onEscolher: (v) => setTipo(v as "todos" | TipoDeData), opcoes: [{ valor: "todos", rotulo: "Todas as datas" }].concat(tiposPresentes.map((t) => ({ valor: t, rotulo: ROTULO_DO_TIPO_DE_DATA[t] }))) },
                {
                  rotulo: "Ordenar",
                  valor: notasPorId ? modo : "data",
                  onEscolher: (v) => void escolherOrdem(v),
                  opcoes: [
                    { valor: "data", rotulo: "Por data" },
                    { valor: "relevancia", rotulo: ordenando ? "Ordenando…" : "Por relevância (Jev)", apoio: notasPorId ? undefined : `~${usd(CUSTO_DO_JEV_USD)}` },
                  ],
                },
              ]}
            />
          </>
        }
      />
      <RegiaoRolavel modo="lg" rotulo="Lista das datas" className="pb-6 pt-1">
        <p className={juntar(texto.auxiliar, "truncate pt-2")} role="status" data-estado-do-jev="">
          {notasPorId
            ? `Do nicho do cliente, pelo Jev${notas.data && notas.data.custo_usd ? ` · ${usd(notas.data.custo_usd)}` : ""}`
            : notas.data && notas.data.jev_erro
              ? "O Jev não respondeu agora: datas separadas pelo tipo e pelo segmento do cliente."
              : `Separando as datas pelo nicho do cliente (Jev ~${usd(CUSTO_DO_JEV_USD)})…`}
        </p>
        {!linhaRecolhida && datas.length > 0 && <LinhaDoTempo datas={datas.slice(0, 10)} hoje={hoje} />}
        {datas.length === 0 && <p className={juntar(texto.auxiliar, "pt-3")}>Nenhuma data deste tipo nas próximas semanas.</p>}
        {grupos.map((g) => (
          <div key={g.chave} className="min-w-0" data-grupo={g.chave}>
            <SubtituloDaLista>{g.titulo}</SubtituloDaLista>
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label={g.titulo}>{g.datas.map(linhaDaData)}</ul>
          </div>
        ))}
        {outras.length > 0 && (
          <div className="min-w-0 pt-3" data-grupo="outras">
            <button type="button" className={juntar(botao.barra, "-ml-2")} onClick={() => setOutrasAbertas(!outrasAbertas)} aria-expanded={outrasAbertas}>
              <ChevronDown className={juntar("mr-1 h-3.5 w-3.5 transition-transform", outrasAbertas ? "rotate-180" : "")} aria-hidden="true" />
              {outrasAbertas ? "Esconder outras datas" : `Outras datas (${outras.length})`}
            </button>
            {outrasAbertas && <ul className={juntar(lista.aberta, lista.divisoria, "opacity-80")} aria-label="Outras datas">{outras.map(linhaDaData)}</ul>}
          </div>
        )}

      </RegiaoRolavel>
    </div>
  );
}
