import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { StatGrid, StatusDot, type Tone } from "@/components/ds";
import { EstadoDeErro, botao, juntar, texto } from "@/components/sistema";

/**
 * Peças comuns das telas de gestão do E-mail e de Domínios e sites (19/11/2026, redesenho no padrão
 * novo): esqueleto da tela, erro com "Tentar de novo", botão de reler, avisos com bolinha e a ficha
 * de "rótulo: valor" das janelas de detalhe.
 */

export type GravidadeDoAviso = "critico" | "atencao" | "info";
export const TOM_DO_AVISO: Record<GravidadeDoAviso, Tone> = { critico: "danger", atencao: "warning", info: "neutral" };

/** Esqueleto da primeira carga: os números no topo e a lista no cartão, na forma do que vem. */
export function EsqueletoDaTela({ numeros = 4, linhas = 5, rotulo = "Carregando" }: { numeros?: number; linhas?: number; rotulo?: string }) {
  return (
    <div className="min-w-0 space-y-4 sm:space-y-6" aria-busy="true" aria-label={rotulo} data-esqueleto="">
      {numeros > 0 && (
        <StatGrid cols={numeros === 3 ? 3 : 4}>
          {Array.from({ length: numeros }).map((_, i) => (
            <div key={i} className="h-[112px] animate-pulse rounded-lg bg-muted sm:h-[136px]" />
          ))}
        </StatGrid>
      )}
      <div className="min-w-0 space-y-2 rounded-lg bg-muted/40 p-4 sm:p-6">
        <div className="mb-4 h-5 w-40 animate-pulse rounded-md bg-muted" />
        {Array.from({ length: linhas }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" style={{ opacity: 1 - i * 0.14 }} />
        ))}
      </div>
    </div>
  );
}

/** Erro numa frase e o "Tentar de novo". */
export function ErroDaTela({ titulo, descricao, aoTentar }: { titulo?: ReactNode; descricao?: ReactNode; aoTentar: () => void }) {
  return (
    <EstadoDeErro
      titulo={titulo || "Não foi possível carregar."}
      descricao={descricao}
      acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={aoTentar}>Tentar de novo</button>}
    />
  );
}

/** Reler os dados: gira enquanto relê. */
export function BotaoDeReler({ aoReler, relendo, rotulo = "Atualizar" }: { aoReler: () => void; relendo?: boolean; rotulo?: string }) {
  return (
    <button type="button" className={botao.icone} onClick={aoReler} aria-label={rotulo} title={rotulo} data-reler="">
      <RefreshCw className={juntar("h-4 w-4", relendo && "animate-spin")} aria-hidden="true" />
    </button>
  );
}

/** Os avisos de um item: bolinha no tom da gravidade e o texto curto. */
export function ListaDeAvisos({ avisos, vazio = "Tudo em dia." }: { avisos: Array<{ gravidade: GravidadeDoAviso; texto: string }>; vazio?: string }) {
  if (!avisos.length) {
    return (
      <p className={juntar(texto.corpo, "flex items-center")} data-avisos="">
        <StatusDot tone="success" className="mr-2 h-2 w-2" />
        {vazio}
      </p>
    );
  }
  return (
    <ul className="min-w-0 space-y-2" data-avisos="">
      {avisos.map((a) => (
        <li key={a.texto} className="flex min-w-0 items-start">
          <StatusDot tone={TOM_DO_AVISO[a.gravidade]} className="mr-2.5 mt-[7px] h-2 w-2" />
          <span className={juntar(texto.corpo, "min-w-0")}>{a.texto}</span>
        </li>
      ))}
    </ul>
  );
}

/** Ficha de "rótulo: valor" (linhas sem valor somem). Duas colunas a partir de 640 px. */
export function FichaDeDados({ itens, className = "" }: { itens: Array<[string, ReactNode]>; className?: string }) {
  const visiveis = itens.filter((i) => i[1] !== "" && i[1] !== null && i[1] !== undefined && i[1] !== false);
  if (!visiveis.length) return null;
  return (
    <dl className={juntar("grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)} data-ficha-de-dados="">
      {visiveis.map(([rotulo, valor]) => (
        <div key={rotulo} className="min-w-0">
          <dt className={texto.rotulo}>{rotulo}</dt>
          <dd className={juntar(texto.corpo, "mt-0.5 min-w-0 break-words")}>{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Título de bloco dentro de janela (sem cartão): texto curto e, se precisar, o que fica à direita. */
export function TituloDoBloco({ children, aoLado }: { children: ReactNode; aoLado?: ReactNode }) {
  return (
    <div className="mb-3 flex min-w-0 items-center">
      <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-6 text-foreground">{children}</h3>
      {aoLado && <div className="ml-2 flex shrink-0 items-center [&>*+*]:ml-1">{aoLado}</div>}
    </div>
  );
}

/** Hora em que a tela leu os dados ("lido às 14:32"). */
export function lidoAs(quando: number): string {
  if (!quando) return "";
  const d = new Date(quando);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `lido às ${hh}:${mm}`;
}
