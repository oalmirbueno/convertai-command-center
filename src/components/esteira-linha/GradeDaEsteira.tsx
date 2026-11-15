import { useMemo, useRef, type UIEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { juntar, texto } from "@/components/sistema";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import type { CartaoDaEsteira, CelulaDaEsteira, DiaDaGrade, FaixaDaEsteira } from "@/lib/esteiraLinha/esteiraLinha";
import { corDeApoioDoCliente } from "@/lib/esteiraLinha/filtroDeClientes";
import CartaoDaPeca from "./CartaoDaPeca";

/*
 * Medidas da grade, iguais na tabela dos dias (em cima) e na das faixas, para
 * as colunas baterem. No celular a coluna do cliente fica mais estreita e a
 * grade, mais curta. Com duas semanas a tabela é mais larga (cada dia
 * continua legível) e a rolagem horizontal das datas resolve o resto.
 */
export const CLASSES_DA_TABELA = "w-full min-w-[860px] table-fixed border-separate border-spacing-0 text-left sm:min-w-[1040px]";
export const CLASSES_DA_TABELA_DE_DUAS_SEMANAS = "w-full min-w-[1540px] table-fixed border-separate border-spacing-0 text-left sm:min-w-[1860px]";
const classesDaTabela = (quantosDias: number): string => (quantosDias > 7 ? CLASSES_DA_TABELA_DE_DUAS_SEMANAS : CLASSES_DA_TABELA);
export const LARGURA_DA_COLUNA_DO_CLIENTE = "w-[136px] sm:w-[216px]";
/**
 * O cabeçalho dos dias fica fora da área que rola: com a página cabendo na
 * tela, ele não sai do lugar. O `sticky` continua para a tela muito baixa,
 * em que a página ainda rola um pouco. O espaço da barra de rolagem é
 * reservado nos dois lados para as colunas baterem.
 */
export const CLASSES_DO_CABECALHO_DOS_DIAS = "sticky -top-4 z-30 shrink-0 overflow-hidden rounded-full border border-border bg-card shadow-card [scrollbar-gutter:stable] md:top-[calc(env(safe-area-inset-top)+80px)]";
/**
 * A área das faixas (pedido do Almir, 14/11/2026, 21h55): rola por dentro,
 * na vertical (outro cliente) e na horizontal (outros dias), e ocupa o que
 * sobra da tela. A página não precisa rolar.
 */
export const CLASSES_DA_ROLAGEM_DAS_DATAS = "relative min-h-0 min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]";
/**
 * Cada dia de cada cliente tem teto e rola por dentro (21h55: "scroll
 * individual em cada coluna"); substitui o "+N" de 21h08. Só na vertical.
 * Sem `overscroll-contain`: no fim da célula, a rolagem segue para a área.
 */
export const CLASSES_DA_ROLAGEM_DA_CELULA = "-m-0.5 max-h-[196px] space-y-2 overflow-y-auto overflow-x-hidden p-0.5 sm:max-h-[264px] sm:space-y-2.5";

function Colunas({ dias }: { dias: DiaDaGrade[] }) {
  return (
    <colgroup>
      <col className={LARGURA_DA_COLUNA_DO_CLIENTE} />
      {dias.map((d) => <col key={d.data} />)}
    </colgroup>
  );
}

/**
 * A grade do período: os dias em cima (fixos), uma faixa por cliente,
 * separada das outras, com a coluna do cliente presa à esquerda e os cartões
 * das peças em cada dia. A área das faixas rola por dentro nos dois eixos e
 * cada dia rola o próprio excesso.
 *
 * O cabeçalho visível é uma tabela à parte (aria-hidden) que acompanha a
 * rolagem horizontal pelo `scrollLeft`. Para leitor de tela, o cabeçalho de
 * verdade continua no `thead` da tabela das faixas.
 */
export default function GradeDaEsteira({
  dias,
  faixas,
  hoje,
  aoAbrirCartao,
}: {
  dias: DiaDaGrade[];
  faixas: FaixaDaEsteira[];
  hoje: string;
  aoAbrirCartao: (cartao: CartaoDaEsteira, faixa: FaixaDaEsteira) => void;
}) {
  const topo = useRef<HTMLDivElement>(null);
  const identidades = useIdentidadesDosClientes();
  const aoRolar = (e: UIEvent<HTMLDivElement>) => {
    if (topo.current) topo.current.scrollLeft = e.currentTarget.scrollLeft;
  };
  const classesDasTabelas = classesDaTabela(dias.length);
  // Contagem do cabeçalho de cada dia: os mesmos cartões que as faixas mostram embaixo.
  const pecasPorDia = useMemo(() => {
    const conta = new Map<string, number>();
    for (const f of faixas) for (const c of f.celulas) conta.set(c.data, (conta.get(c.data) ?? 0) + c.cartoes.length);
    return conta;
  }, [faixas]);

  return (
    // Altura mínima: numa janela baixa com o aviso aberto, a grade não some (a página rola um pouco).
    <div className="flex min-h-[240px] min-w-0 flex-1 flex-col" data-grade-da-esteira="" data-dias-da-grade={dias.length}>
      <div ref={topo} aria-hidden="true" className={CLASSES_DO_CABECALHO_DOS_DIAS} data-cabecalho-dos-dias="">
        <table className={classesDasTabelas}>
          <Colunas dias={dias} />
          <thead>
            <tr>
              <th className={juntar(texto.rotulo, "sticky left-0 z-20 bg-card py-3 pl-5 pr-3")} data-canto-cliente="">Cliente</th>
              {dias.map((d, i) => {
                const ehHoje = d.data === hoje;
                const [semana, numero] = d.rotulo.split(" ");
                const pecas = pecasPorDia.get(d.data) ?? 0;
                return (
                  <th
                    key={d.data}
                    className={juntar(
                      "border-l border-transparent px-1 py-1.5 font-normal sm:px-1.5",
                      // Duas semanas: um traço mais forte entre a primeira e a segunda.
                      i === 7 && "border-l-foreground/25",
                    )}
                  >
                    {/* O dia de hoje é a pílula sólida na cor da marca; a contagem do dia vai na pílula da direita. */}
                    <span className={juntar("flex min-w-0 items-center rounded-full py-1 pl-2.5 pr-1 sm:pl-3.5", ehHoje && "ds-accent")} data-dia-de-hoje={ehHoje ? "" : undefined}>
                      <span className="flex min-w-0 flex-1 items-baseline">
                        <span className={juntar(texto.etiqueta, "mr-1.5 truncate", ehHoje ? "font-semibold text-foreground" : "text-muted-foreground")}>{ehHoje ? "Hoje" : numero ? semana : d.rotulo}</span>
                        {numero && <span className="text-[20px] font-semibold leading-7 tracking-[-0.03em] tabular-nums text-foreground">{numero}</span>}
                      </span>
                      <span
                        className={juntar("ml-1 inline-flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded-full bg-muted px-2 text-[12px] font-semibold leading-none tabular-nums", pecas > 0 ? "text-foreground" : "text-muted-foreground")}
                        title={`${pecas} ${pecas === 1 ? "peça" : "peças"}`}
                        data-pecas-do-dia={pecas}
                      >
                        {pecas}
                      </span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
        </table>
      </div>

      <div className={CLASSES_DA_ROLAGEM_DAS_DATAS} onScroll={aoRolar} data-rolagem-das-datas="">
        <table className={classesDasTabelas}>
          <caption className="sr-only">Esteira do período: peças por cliente e por dia</caption>
          <Colunas dias={dias} />
          <thead className="sr-only">
            <tr>
              <th scope="col">Cliente</th>
              {dias.map((d) => (
                <th key={d.data} scope="col" aria-label={d.data === hoje ? `${d.rotuloLongo} (hoje)` : d.rotuloLongo} aria-current={d.data === hoje ? "date" : undefined}>
                  {d.rotulo}
                  {d.data === hoje && <span>Hoje</span>}
                </th>
              ))}
            </tr>
          </thead>
          {/* Um tbody por cliente: cada faixa é um bloco, com respiro antes do próximo. A altura dela tem o teto dos dias. */}
          {faixas.map((faixa) => (
            <tbody key={faixa.clientId} data-faixa-da-esteira={faixa.clientId}>
              <tr aria-hidden="true"><td colSpan={dias.length + 1} className="h-3 p-0 sm:h-5" /></tr>
              <tr>
                <th
                  scope="row"
                  className={juntar(
                    "sticky left-0 z-10 rounded-l-lg border-y border-l-4 border-border bg-card px-3 py-4 align-top font-normal sm:px-4 sm:py-6",
                    corDeApoioDoCliente(faixa.clientId).faixa,
                  )}
                  data-cabecalho-da-faixa=""
                >
                  <span className="flex min-w-0 items-center">
                    <LogoDoCliente
                      url={identidades.data?.get(faixa.clientId)?.profile_picture_url ?? null}
                      clienteId={faixa.clientId}
                      nome={faixa.nome}
                      tamanho={40}
                      className="mr-3 hidden shrink-0 text-[12px] sm:flex"
                    />
                    <span className="block min-w-0 break-words text-[13px] font-semibold leading-5 tracking-[-0.01em] text-foreground sm:text-[15px]">{faixa.nome}</span>
                  </span>
                  <span className="block min-w-0">
                    {faixa.diaPrioritario !== null && (
                        // De 640 px para cima o dia prioritário é uma pílula; no celular a coluna é estreita e fica a linha de texto.
                        <span className={juntar(texto.auxiliar, "mt-1 block sm:mt-3 sm:inline-flex sm:h-6 sm:max-w-full sm:items-center sm:rounded-full sm:bg-accent-soft sm:px-2.5 sm:text-[11px] sm:font-medium sm:text-primary")}>
                          <span className="sm:truncate">Dia prioritário: {faixa.nomeDoDiaPrioritario}</span>
                        </span>
                      )}
                      {faixa.aprovacaoDoClienteDispensada && (
                        <span
                          className={juntar(texto.auxiliar, "mt-1.5 block")}
                          data-aprovacao-dispensada=""
                          title="Regra do cadastro deste cliente: a revisão interna da agência basta. As peças não passam pela aprovação do cliente."
                        >
                          Aprovação do cliente dispensada
                        </span>
                      )}
                  </span>
                </th>
                {faixa.celulas.map((celula, i) => (
                  <CelulaDoDia
                    key={celula.data}
                    celula={celula}
                    ultima={i === faixa.celulas.length - 1}
                    viradaDaSemana={i === 7}
                    aoAbrir={(cartao) => aoAbrirCartao(cartao, faixa)}
                  />
                ))}
              </tr>
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

/**
 * Um dia de um cliente. Até o teto a altura acompanha o conteúdo; passou, os
 * cartões rolam por dentro da célula (barra fina, só na vertical).
 */
function CelulaDoDia({ celula, ultima, viradaDaSemana, aoAbrir }: { celula: CelulaDaEsteira; ultima: boolean; viradaDaSemana: boolean; aoAbrir: (cartao: CartaoDaEsteira) => void }) {
  return (
    <td
      data-dia={celula.data}
      data-prioritario={celula.prioritario ? "sim" : undefined}
      data-alerta={celula.alerta ? "sim" : undefined}
      className={juntar(
        "border-y border-l border-border border-l-border/50 p-2 align-top sm:p-3",
        ultima && "rounded-r-lg border-r",
        viradaDaSemana && "border-l-foreground/25",
        celula.alerta ? "bg-warning-soft" : celula.prioritario ? "bg-accent-soft" : "bg-card",
      )}
    >
      {celula.prioritario && !celula.alerta && <span className="sr-only">Dia prioritário</span>}
      {celula.alerta ? (
        <p className="flex items-start rounded-[16px] bg-card px-2.5 py-2.5 text-[12px] font-medium leading-4 text-warning">
          <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Dia prioritário sem peça
        </p>
      ) : celula.cartoes.length > 0 ? (
        <div className={CLASSES_DA_ROLAGEM_DA_CELULA} data-cartoes-do-dia="" data-rolagem-da-celula="">
          {celula.cartoes.map((cartao) => <CartaoDaPeca key={cartao.chave} cartao={cartao} aoAbrir={aoAbrir} />)}
        </div>
      ) : null}
    </td>
  );
}
