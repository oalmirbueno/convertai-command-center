import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";

/**
 * Peças comuns do Hype e do Trending (21/10/2026, 2ª rodada: "tudo alinhadinho, sem poluição").
 *
 * Toda linha é a MESMA grade: caixinha "juntar" | título e metadados | nota do Jev | ações. A nota tem
 * lugar fixo (vazio quando não há) e as ações ficam sempre na mesma posição à direita: Criar conteúdo,
 * Criar campanha e a seta dos detalhes (com lugar reservado mesmo sem detalhes). Linha de lista do
 * sistema, sem caixa por item; só o item marcado ganha o fundo leve.
 */
export const GRADE_DA_LINHA = "grid min-w-0 grid-cols-[20px_minmax(0,1fr)_28px_auto] items-start gap-x-2";

export default function LinhaDoHypeETrending({
  titulo,
  apoio,
  nota,
  rotuloDaNota = "Quanto serve a este cliente, de 0 a 10 (Jev)",
  marcado,
  podeMarcar,
  onMarcar,
  detalhes,
  acoes,
}: {
  titulo: string;
  apoio?: ReactNode;
  nota?: number | null;
  rotuloDaNota?: string;
  marcado: boolean;
  podeMarcar: boolean;
  onMarcar: () => void;
  detalhes?: ReactNode;
  acoes?: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const n = typeof nota === "number" && isFinite(nota) ? Math.round(nota * 10) / 10 : null;
  return (
    <li className={juntar(lista.linha, GRADE_DA_LINHA, marcado ? lista.destaque : "")} data-juntado={marcado ? "" : undefined} data-linha-hype-trending="">
      <label className="flex h-5 cursor-pointer items-center" title={podeMarcar || marcado ? "Juntar para criar uma campanha" : "Já tem 6 desta área na seleção"}>
        <Checkbox className="toque-compacto" checked={marcado} disabled={!podeMarcar && !marcado} onCheckedChange={onMarcar} aria-label={`Juntar ${titulo}`} />
      </label>
      <div className="min-w-0">
        <p className={juntar(texto.corpo, "truncate font-medium")} title={titulo}>{titulo}</p>
        {apoio && <div className={juntar(texto.auxiliar, "mt-0.5 min-w-0 line-clamp-2 [overflow-wrap:anywhere] sm:line-clamp-1")}>{apoio}</div>}
        {aberto && detalhes && <div className="mt-2 min-w-0 space-y-1.5 text-[12px] leading-5 [overflow-wrap:anywhere]">{detalhes}</div>}
      </div>
      <span className={juntar(texto.etiqueta, "h-5 text-right tabular-nums", n !== null && n >= 7 ? "text-primary" : "text-muted-foreground")} title={n !== null ? rotuloDaNota : undefined} data-nota="">
        {n !== null ? n.toLocaleString("pt-BR") : ""}
      </span>
      <div className="-my-1.5 flex items-center justify-end" data-acoes="">
        {acoes}
        {detalhes ? (
          <button type="button" className={botao.icone} onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-label={aberto ? "Menos" : "Como usar"} title={aberto ? "Menos" : "Como usar"}>
            <ChevronDown className={juntar("h-4 w-4 transition-transform", aberto ? "rotate-180" : "")} aria-hidden="true" />
          </button>
        ) : (
          <span className="inline-block h-8 w-8 shrink-0" aria-hidden="true" />
        )}
      </div>
    </li>
  );
}

/** Um par rótulo/texto dentro dos detalhes. */
export function Detalhe({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{rotulo}</p>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

/** Subtítulo dentro da lista (Lidos na web, Em alta no nicho), alinhado ao texto das linhas. */
export function SubtituloDaLista({ children, apoio }: { children: ReactNode; apoio?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline pb-1 pl-7 pt-4">
      <h4 className={juntar(texto.rotulo, "shrink-0")}>{children}</h4>
      {apoio && <span className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate")}>{apoio}</span>}
    </div>
  );
}

/**
 * Cabeçalho fixo de uma coluna (Hype ou Trending): mesma altura nas duas, título com o "?" e os
 * controles à direita. `abaixo` fica ainda no cabeçalho fixo (a busca do Trending).
 */
export function CabecalhoDaColuna({ icone, titulo, ajuda, controles, abaixo }: { icone: ReactNode; titulo: string; ajuda: ReactNode; controles?: ReactNode; abaixo?: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-border pb-2" data-cabecalho-da-coluna="">
      <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between">
        <h3 className={juntar(texto.tituloSecao, "mr-2 flex min-w-0 items-center")}>
          <span className="mr-1.5 inline-flex shrink-0 text-primary" aria-hidden="true">{icone}</span>
          <span className="truncate">{titulo}</span>
          <AjudaRecolhida rotulo={`O que é ${titulo}?`}>{ajuda}</AjudaRecolhida>
        </h3>
        {controles && <div className="-m-1 flex min-w-0 flex-wrap items-center justify-end">{controles}</div>}
      </div>
      {abaixo && <div className="mt-2 min-w-0">{abaixo}</div>}
    </div>
  );
}
