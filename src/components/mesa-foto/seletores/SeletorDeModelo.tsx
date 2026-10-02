import { useMemo, useState } from "react";
import { Check, Plus, Search, UserRound, UserRoundX } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { foco, juntar, texto } from "@/components/sistema/estilos";
import { useClones } from "../clonesApi";
import { useAncoras, usePersonas } from "../modelosApi";
import { modelosParaEscolher, rotuloDoModelo, type OpcaoDeModelo } from "./seletores";

/**
 * Seletor de modelo (02/10/2026; dono: "criei um modelo e não sei onde
 * usar"). As modelos da IA (do cliente e da agência) e os clones de pessoa
 * real com autorização numa grade só, com a foto de cada uma; a que ainda não
 * está pronta aparece apagada com o motivo. "Sem pessoa" desmarca. O modelo
 * criado na aba Modelos aparece aqui na hora (mesma lista em cache).
 *
 * Serve para a Mesa Foto (Preparar imagens, peça do mês) e para outras mesas:
 * recebe o cliente por prop e devolve a opção (persona ou clone).
 */

export interface PropsDoSeletorDeModelo {
  clientId: string;
  /** Chave escolhida ("persona:<id>" ou "clone:<id>") ou null. */
  valor: string | null;
  onEscolher: (o: OpcaoDeModelo | null) => void;
  /** Quais tipos entram (padrão: os dois). */
  incluir?: ("persona" | "clone")[];
  /** Leva para criar um modelo (aba Modelos). */
  onCriar?: () => void;
  /** Sem a opção "Sem pessoa". */
  semNenhum?: boolean;
  className?: string;
}

function Rosto({ o, ancora }: { o: OpcaoDeModelo; ancora: { caminho: string; bucket: string } | null }) {
  if (o.tipo === "clone" && o.capa_url) return <img src={o.capa_url} alt={o.nome} className="h-full w-full object-cover" loading="lazy" />;
  if (ancora) return <MiniaturaDoStorage bucket={ancora.bucket} caminho={ancora.caminho} alt={o.nome} largura={200} className="h-full w-full" />;
  return (
    <span className="flex h-full w-full items-center justify-center text-muted-foreground">
      <UserRound className="h-6 w-6" aria-hidden="true" />
    </span>
  );
}

export default function SeletorDeModelo({ clientId, valor, onEscolher, incluir = ["persona", "clone"], onCriar, semNenhum = false, className = "" }: PropsDoSeletorDeModelo) {
  const personasQ = usePersonas(clientId, incluir.indexOf("persona") >= 0);
  const clonesQ = useClones(clientId, incluir.indexOf("clone") >= 0);
  const personas = personasQ.data || [];
  const ancoras = useAncoras(personas.map((p) => p.ancora_imagem_id || ""));
  const [busca, setBusca] = useState("");
  const todas = useMemo(
    () => modelosParaEscolher(incluir.indexOf("persona") >= 0 ? personas : [], incluir.indexOf("clone") >= 0 ? clonesQ.data || [] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personas, clonesQ.data, incluir.join(",")],
  );
  const termo = busca.trim().toLowerCase();
  const lista = termo ? todas.filter((o) => o.nome.toLowerCase().indexOf(termo) >= 0) : todas;
  const carregando = personasQ.isLoading || clonesQ.isLoading;
  const ancoraDe = (o: OpcaoDeModelo) => {
    if (o.tipo !== "persona" || !o.ancora_imagem_id) return null;
    const a = (ancoras.data || []).find((x) => x.id === o.ancora_imagem_id);
    return a ? { caminho: a.storage_path || a.url, bucket: a.storage_bucket || "mesa" } : null;
  };

  const cartao = "relative block w-full overflow-hidden rounded-md border-2 text-left transition-colors";
  return (
    <div className={juntar("min-w-0", className)} data-seletor-de-modelo="">
      {todas.length > 8 && (
        <label className="mb-2 flex h-8 min-w-0 items-center rounded-md border border-border px-2">
          <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo" aria-label="Buscar modelo" className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
        </label>
      )}
      {carregando ? (
        <div className="grid grid-cols-3 gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : (
        <ul className="grid min-w-0 grid-cols-3 gap-2" aria-label="Modelos e clones">
          {!semNenhum && (
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => onEscolher(null)}
                aria-pressed={!valor}
                className={juntar(cartao, !valor ? "border-primary" : "border-border hover:border-primary/50", foco)}
                data-modelo-do-seletor="nenhum"
              >
                <span className="flex aspect-[3/4] w-full items-center justify-center bg-muted text-muted-foreground">
                  <UserRoundX className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="block truncate px-1.5 py-1 text-[12px] font-medium">Sem pessoa</span>
              </button>
            </li>
          )}
          {lista.map((o) => {
            const marcada = valor === o.chave;
            return (
              <li key={o.chave} className="min-w-0">
                <button
                  type="button"
                  onClick={() => o.pronto && onEscolher(o)}
                  disabled={!o.pronto}
                  aria-pressed={marcada}
                  title={o.motivo || rotuloDoModelo(o)}
                  className={juntar(cartao, marcada ? "border-primary" : "border-border hover:border-primary/50", !o.pronto && "cursor-not-allowed opacity-50", foco)}
                  data-modelo-do-seletor={o.chave}
                >
                  <span className="block aspect-[3/4] w-full bg-muted">
                    <Rosto o={o} ancora={ancoraDe(o)} />
                  </span>
                  {marcada && (
                    <span className="pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </span>
                  )}
                  <span className="block truncate px-1.5 pt-1 text-[12px] font-medium">{o.nome}</span>
                  <span className={juntar("block truncate px-1.5 pb-1 text-[11px]", o.pronto ? "text-muted-foreground" : "text-warning")}>{o.pronto ? rotuloDoModelo(o) : o.motivo}</span>
                </button>
              </li>
            );
          })}
          {onCriar && (
            <li className="min-w-0">
              <button type="button" onClick={onCriar} className={juntar(cartao, "border-dashed border-border hover:border-primary/50", foco)} data-modelo-do-seletor="criar">
                <span className="flex aspect-[3/4] w-full items-center justify-center text-primary">
                  <Plus className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="block truncate px-1.5 py-1 text-[12px] font-medium">Criar modelo</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {!carregando && todas.length === 0 && <p className={juntar(texto.auxiliar, "mt-2")}>Nenhuma modelo nem clone ainda.</p>}
    </div>
  );
}
