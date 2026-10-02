import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { foco, juntar, texto } from "@/components/sistema/estilos";
import { useFotos, useKits, type FotoDoAcervo } from "../fotoApi";
import { ehEditada, ehGerada, filtrarImagens, FILTROS_DE_IMAGENS, type FiltroDeImagens } from "./seletores";

/**
 * Seletor de imagens (02/10/2026): o acervo único do cliente com os filtros
 * Todas, Produtos, Artes, Editadas, Originais e Geradas, busca e marcação.
 * Serve para a Mesa Foto (Preparar imagens) e para quem mais precisar
 * escolher imagem do cliente (Mesa Vídeos, Motion): recebe o cliente por
 * prop e devolve os ids do acervo (cliente_imagens). Arquivada e referência
 * da internet não aparecem.
 */

const PASSO = 60;

export interface PropsDoSeletorDeImagens {
  clientId: string;
  escolhidas: string[];
  onMudar: (ids: string[]) => void;
  multiplas?: boolean;
  filtroInicial?: FiltroDeImagens;
  /** Filtros à vista (padrão: todos). */
  filtros?: FiltroDeImagens[];
  /** Nome para leitor de tela. */
  rotulo?: string;
  /** Fotos já carregadas por quem chama (senão lê o acervo do cliente). */
  fotos?: FotoDoAcervo[];
  className?: string;
}

function selo(f: FotoDoAcervo): string | null {
  if (ehEditada(f)) return "editada";
  if (ehGerada(f)) return "gerada";
  return null;
}

export default function SeletorDeImagens({ clientId, escolhidas, onMudar, multiplas = true, filtroInicial = "todas", filtros, rotulo = "Imagens do acervo", fotos, className = "" }: PropsDoSeletorDeImagens) {
  const fotosQ = useFotos(fotos ? "" : clientId);
  const kitsQ = useKits(clientId);
  const [filtro, setFiltro] = useState<FiltroDeImagens>(filtroInicial);
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(PASSO);
  const todas = fotos || fotosQ.data || [];
  const lista = useMemo(() => filtrarImagens(todas, filtro, busca, kitsQ.data || []), [todas, filtro, busca, kitsQ.data]);
  const opcoes = FILTROS_DE_IMAGENS.filter((f) => !filtros || filtros.indexOf(f.valor) >= 0);
  const alternar = (id: string) => {
    if (!multiplas) return onMudar(escolhidas[0] === id ? [] : [id]);
    onMudar(escolhidas.indexOf(id) >= 0 ? escolhidas.filter((x) => x !== id) : escolhidas.concat([id]));
  };
  const carregando = !fotos && fotosQ.isLoading;

  return (
    <div className={juntar("min-w-0", className)} data-seletor-de-imagens="">
      <div className="flex min-w-0 flex-wrap items-center">
        {opcoes.length > 1 && (
          <div role="radiogroup" aria-label="Filtro das imagens" className="mb-2 mr-2 flex min-w-0 flex-wrap">
            {opcoes.map((o) => (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={filtro === o.valor}
                onClick={() => {
                  setFiltro(o.valor);
                  setLimite(PASSO);
                }}
                className={juntar(
                  "mb-1 mr-1 inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] transition-colors",
                  filtro === o.valor ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                  foco,
                )}
                data-filtro-de-imagens={o.valor}
              >
                {o.rotulo}
              </button>
            ))}
          </div>
        )}
        <label className="mb-2 flex h-8 min-w-0 flex-1 items-center rounded-md border border-border px-2 sm:max-w-[240px]">
          <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" aria-label="Buscar imagens" className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
        </label>
      </div>
      {carregando ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <p className={texto.auxiliar}>Nenhuma imagem neste filtro.</p>
      ) : (
        <>
          <ul className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5" aria-label={rotulo}>
            {lista.slice(0, limite).map((f) => {
              const marcada = escolhidas.indexOf(f.id) >= 0;
              const s = selo(f);
              return (
                <li key={f.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => alternar(f.id)}
                    aria-pressed={marcada}
                    aria-label={f.nome}
                    title={f.nome}
                    className={juntar("relative block w-full overflow-hidden rounded-md border-2 transition-colors", marcada ? "border-primary" : "border-transparent hover:border-border", foco)}
                    data-imagem-do-seletor={f.id}
                  >
                    <span className="block aspect-square w-full bg-muted">
                      <MiniaturaDoStorage bucket={f.storage_bucket} caminho={f.storage_path} alt={f.nome} largura={240} className="h-full w-full" />
                    </span>
                    {s && <span className="pointer-events-none absolute left-1 top-1 rounded bg-background/85 px-1 text-[11px] font-medium text-foreground">{s}</span>}
                    {marcada && (
                      <span className="pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {lista.length > limite && (
            <button type="button" className={juntar("mt-2 rounded text-[12px] font-medium text-primary hover:underline", foco)} onClick={() => setLimite(limite + PASSO)}>
              Mostrar mais ({lista.length - limite})
            </button>
          )}
        </>
      )}
    </div>
  );
}
