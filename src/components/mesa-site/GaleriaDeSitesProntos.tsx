import { useState, type ReactNode } from "react";
import { ExternalLink, LayoutTemplate, Star } from "lucide-react";
import { etiqueta, juntar, texto } from "@/components/sistema/estilos";
import type { ModeloPronto } from "../../../supabase/functions/mesa-site/modulos/modelos-prontos";
import { objetivoDoSite } from "../../../supabase/functions/mesa-site/modulos/jornada-do-site";
import { opcaoDaGrade } from "./PassoObjetivo";

/** Grade dos cartões grandes da Mesa Site (sites prontos e modelos de página): 1, 2, 3 e 4 colunas. */
export const gradeDeCartoes = "grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 desk:grid-cols-4";

/** Objetivos do modelo em palavras ("Agendar horário · Captar contatos"). */
export const objetivosDoModelo = (m: Pick<ModeloPronto, "objetivo">) =>
  (Array.isArray(m.objetivo) ? m.objetivo : [])
    .map((id) => (objetivoDoSite(id) || { rotulo: "" }).rotulo)
    .filter(Boolean)
    .join(" · ");

/**
 * Miniatura real do site pronto (a captura da Start Bootstrap), na proporção
 * 16:10 por padding (Safari 11 não tem aspect-ratio). Se a imagem não abre
 * (rede bloqueada, endereço fora do ar), fica o ícone e o nome no lugar.
 */
function Miniatura({ m }: { m: ModeloPronto }) {
  const [quebrou, setQuebrou] = useState(false);
  return (
    <span className="relative block w-full overflow-hidden rounded-md bg-muted/50" style={{ paddingTop: "62.5%" }} data-miniatura={quebrou ? "sem-imagem" : "real"}>
      {m.miniatura && !quebrou ? (
        <img src={m.miniatura} alt="" loading="lazy" width={400} height={250} onError={() => setQuebrou(true)} className="absolute inset-0 h-full w-full object-cover object-top" />
      ) : (
        <span className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center" aria-hidden="true">
          <LayoutTemplate className="h-6 w-6 text-muted-foreground" />
          <span className={juntar(texto.auxiliar, "mt-2 block max-w-full truncate")}>{m.nome}</span>
        </span>
      )}
    </span>
  );
}

/**
 * A galeria dos sites prontos (catálogo modelos-prontos.ts), a mesma no passo
 * Partida e na tela inicial da Mesa Site. No passo, o cartão é a escolha
 * (`onEscolher`); na tela inicial, o cartão mostra e a `acao` embaixo usa o site.
 */
export default function GaleriaDeSitesProntos({
  modelos,
  escolhido = null,
  recomendado = null,
  onEscolher,
  acao,
  ...resto
}: {
  modelos: ModeloPronto[];
  escolhido?: string | null;
  recomendado?: string | null;
  onEscolher?: (id: string) => void;
  /** Botão embaixo de cada cartão (ex.: "Usar este site"). */
  acao?: (m: ModeloPronto) => ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <ul className={gradeDeCartoes} {...resto}>
      {modelos.map((m) => {
        const marcado = escolhido === m.id;
        const objetivos = objetivosDoModelo(m);
        const corpo = (
          <>
            <Miniatura m={m} />
            <span className="mt-2 flex min-w-0 items-center">
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{m.nome}</span>
              {recomendado === m.id && (
                <span className={juntar(etiqueta, "ml-1 shrink-0 bg-primary/10 text-primary")} title="Recomendado pelo Jev para este cliente" data-recomendado="">
                  <Star className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
                  Jev
                </span>
              )}
            </span>
            <span className={juntar(texto.auxiliar, "block truncate")}>{m.descricao}</span>
            <span className={juntar(texto.auxiliar, "mt-1 flex min-w-0")} title={objetivos ? `Objetivo: ${objetivos}` : undefined}>
              <span className="shrink-0" data-licenca={m.licenca}>
                Licença {m.licenca}
              </span>
              {objetivos && <span className="ml-1 min-w-0 truncate" data-objetivos-do-pronto="">{`· ${objetivos}`}</span>}
            </span>
          </>
        );
        return (
          <li key={m.id} className="flex min-w-0 flex-col" data-modelo-pronto={m.id}>
            {onEscolher ? (
              <button type="button" className={juntar(opcaoDaGrade(marcado), "flex-col items-stretch p-2")} aria-pressed={marcado} onClick={() => onEscolher(m.id)} title={m.descricao}>
                {corpo}
              </button>
            ) : (
              <div className="flex min-w-0 flex-col rounded-md border border-border p-2" title={m.descricao}>
                {corpo}
              </div>
            )}
            <span className="mt-1 flex min-w-0 items-center">
              {m.previa_url && (
                <a href={m.previa_url} target="_blank" rel="noopener noreferrer" className={juntar(texto.auxiliar, "inline-flex h-8 shrink-0 items-center rounded-md px-1 underline-offset-2 hover:text-foreground hover:underline")} title="Ver o modelo no ar" aria-label={`Ver ${m.nome} no ar`} data-previa-do-pronto={m.id}>
                  <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Prévia
                </a>
              )}
              <a href={m.repositorio} target="_blank" rel="noopener noreferrer" className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate underline-offset-2 hover:text-foreground hover:underline")} title={`${m.repositorio} (commit ${m.commit.slice(0, 7)}) · ${m.autor}`}>
                Repositório
              </a>
              {acao && <span className="ml-auto flex shrink-0 items-center pl-2">{acao(m)}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
