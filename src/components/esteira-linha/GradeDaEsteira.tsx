import { useRef, useState, type UIEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { foco, juntar, texto } from "@/components/sistema";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import type { CelulaDaEsteira, DiaDaGrade, FaixaDaEsteira } from "@/lib/esteiraLinha/esteiraLinha";
import { cartoesAVista, corDeApoioDoCliente } from "@/lib/esteiraLinha/filtroDeClientes";
import CartaoDaPeca from "./CartaoDaPeca";

/*
 * Medidas da grade, iguais na tabela dos dias (em cima) e na das faixas, para
 * as colunas baterem. No celular a coluna do cliente fica mais estreita e a
 * grade, mais curta; só ela rola na horizontal, a página não.
 */
export const CLASSES_DA_TABELA = "w-full min-w-[860px] table-fixed border-separate border-spacing-0 text-left sm:min-w-[1040px]";
export const LARGURA_DA_COLUNA_DO_CLIENTE = "w-[136px] sm:w-[188px]";
/** O cabeçalho dos dias gruda no topo ao rolar a página (mesma altura do cabeçalho da Mesa). */
export const CLASSES_DO_CABECALHO_DOS_DIAS = "sticky -top-4 z-30 overflow-hidden rounded-md border-y border-border bg-muted md:top-[calc(env(safe-area-inset-top)+80px)]";
/** A rolagem horizontal das datas: a única da grade. Nada de rolagem vertical por dentro. */
export const CLASSES_DA_ROLAGEM_DAS_DATAS = "min-w-0 overflow-x-auto";

function Colunas({ dias }: { dias: DiaDaGrade[] }) {
  return (
    <colgroup>
      <col className={LARGURA_DA_COLUNA_DO_CLIENTE} />
      {dias.map((d) => <col key={d.data} />)}
    </colgroup>
  );
}

/**
 * A grade da semana: os dias em cima (grudados no topo ao descer a página),
 * uma faixa por cliente, separada das outras, com a coluna do cliente presa à
 * esquerda e os cartões das peças em cada dia. Rola na horizontal por dentro
 * quando a tela é estreita. Só leitura.
 *
 * O cabeçalho visível é uma tabela à parte (aria-hidden) porque `overflow-x`
 * na caixa da grade impede o `sticky top` de seguir a página; ele acompanha a
 * rolagem horizontal pelo `scrollLeft`. Para leitor de tela, o cabeçalho de
 * verdade continua no `thead` da tabela das faixas.
 */
export default function GradeDaEsteira({ dias, faixas, hoje }: { dias: DiaDaGrade[]; faixas: FaixaDaEsteira[]; hoje: string }) {
  const topo = useRef<HTMLDivElement>(null);
  const identidades = useIdentidadesDosClientes();
  const aoRolar = (e: UIEvent<HTMLDivElement>) => {
    if (topo.current) topo.current.scrollLeft = e.currentTarget.scrollLeft;
  };

  return (
    <div className="min-w-0" data-grade-da-esteira="">
      <div ref={topo} aria-hidden="true" className={CLASSES_DO_CABECALHO_DOS_DIAS} data-cabecalho-dos-dias="">
        <table className={CLASSES_DA_TABELA}>
          <Colunas dias={dias} />
          <thead>
            <tr>
              <th className={juntar(texto.rotulo, "sticky left-0 z-20 border-l border-border bg-muted px-3 py-2")} data-canto-cliente="">Cliente</th>
              {dias.map((d, i) => (
                <th
                  key={d.data}
                  className={juntar(texto.rotulo, "border-l border-border px-2 py-2", i === dias.length - 1 && "border-r", d.data === hoje && "text-foreground")}
                >
                  {d.rotulo}
                  {d.data === hoje && <span className="ml-1.5 rounded bg-primary/15 px-1 py-0.5 text-[11px] font-medium text-primary">Hoje</span>}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>

      <div className={CLASSES_DA_ROLAGEM_DAS_DATAS} onScroll={aoRolar} data-rolagem-das-datas="">
        <table className={CLASSES_DA_TABELA}>
          <caption className="sr-only">Esteira da semana: peças por cliente e por dia</caption>
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
          {/* Um tbody por cliente: cada faixa é um bloco, com respiro antes do próximo. */}
          {faixas.map((faixa) => (
            <tbody key={faixa.clientId} data-faixa-da-esteira={faixa.clientId}>
              <tr aria-hidden="true"><td colSpan={dias.length + 1} className="h-2 p-0" /></tr>
              <tr>
                <th
                  scope="row"
                  className={juntar(
                    "sticky left-0 z-10 rounded-l-md border-y border-l-4 border-border bg-card px-2.5 py-2 align-top font-normal sm:px-3",
                    corDeApoioDoCliente(faixa.clientId).faixa,
                  )}
                  data-cabecalho-da-faixa=""
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <LogoDoCliente
                      url={identidades.data?.get(faixa.clientId)?.profile_picture_url ?? null}
                      clienteId={faixa.clientId}
                      nome={faixa.nome}
                      tamanho={28}
                      className="hidden shrink-0 sm:block"
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-[13px] font-medium leading-5 text-foreground sm:text-[14px]">{faixa.nome}</span>
                      {faixa.diaPrioritario !== null && (
                        <span className={juntar(texto.auxiliar, "mt-0.5 block")}>Dia prioritário: {faixa.nomeDoDiaPrioritario}</span>
                      )}
                      {faixa.aprovacaoDoClienteDispensada && (
                        <span
                          className={juntar(texto.auxiliar, "mt-0.5 block")}
                          data-aprovacao-dispensada=""
                          title="Regra do cadastro deste cliente: a revisão interna da agência basta. As peças não passam pela aprovação do cliente."
                        >
                          Aprovação do cliente dispensada
                        </span>
                      )}
                    </span>
                  </span>
                </th>
                {faixa.celulas.map((celula, i) => (
                  <CelulaDoDia key={celula.data} celula={celula} ultima={i === faixa.celulas.length - 1} />
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
 * Um dia de um cliente. A altura acompanha o conteúdo (sem rolagem por
 * dentro); acima do teto, os primeiros cartões e um "+N" que abre o resto.
 */
function CelulaDoDia({ celula, ultima }: { celula: CelulaDaEsteira; ultima: boolean }) {
  const [expandida, setExpandida] = useState(false);
  const { visiveis, escondidos, temMais } = cartoesAVista(celula.cartoes, expandida);
  return (
    <td
      data-dia={celula.data}
      data-prioritario={celula.prioritario ? "sim" : undefined}
      data-alerta={celula.alerta ? "sim" : undefined}
      className={juntar(
        "border-y border-l border-border p-1.5 align-top",
        ultima && "rounded-r-md border-r",
        celula.alerta ? "bg-amber-500/15" : celula.prioritario ? "bg-accent" : "bg-card",
      )}
    >
      {celula.prioritario && !celula.alerta && <span className="sr-only">Dia prioritário</span>}
      {celula.alerta ? (
        <p className="flex items-start text-[12px] font-medium leading-4 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Dia prioritário sem peça
        </p>
      ) : (
        <div className="space-y-1.5" data-cartoes-do-dia="">
          {visiveis.map((cartao) => <CartaoDaPeca key={cartao.chave} cartao={cartao} />)}
          {temMais && (
            <button
              type="button"
              onClick={() => setExpandida((e) => !e)}
              aria-expanded={expandida}
              aria-label={expandida ? "Mostrar menos" : `Mostrar mais ${escondidos} ${escondidos === 1 ? "peça" : "peças"}`}
              className={juntar(
                "toque-compacto flex h-8 w-full items-center justify-center rounded-md border border-dashed border-border text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                foco,
              )}
              data-mais-da-celula=""
            >
              {expandida ? "Mostrar menos" : `+${escondidos}`}
            </button>
          )}
        </div>
      )}
    </td>
  );
}
