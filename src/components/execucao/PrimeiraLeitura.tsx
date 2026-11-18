import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Rodada v4 (15/11/2026, dono: "o painel está dançando"): várias leituras da
 * mesma tela chegam uma depois da outra e cada uma empurrava o que já estava
 * desenhado. Aqui a região espera a PRIMEIRA resposta de todas as leituras
 * dela e aparece inteira de uma vez; enquanto isso fica o esqueleto, do
 * tamanho da região. O conteúdo já fica montado (escondido), porque é ele que
 * dispara as leituras. Depois da primeira vez não esconde mais nada: releitura
 * e troca de aba seguem na hora. Não lê nem muda dado nenhum; só olha o estado
 * das leituras que a tela já faz.
 */
export default function PrimeiraLeitura({
  chaves,
  aguardar = false,
  limiteMs = 3500,
  esqueleto,
  children,
}: {
  /** Prefixos das leituras (queryKey) que precisam ter respondido uma vez. */
  chaves: ReadonlyArray<QueryKey>;
  /** Espera extra de quem chama (uma leitura própria ainda carregando). */
  aguardar?: boolean;
  /** Teto: passou disso, mostra o que tiver. Leitura lenta não prende a tela. */
  limiteMs?: number;
  esqueleto: ReactNode;
  children: ReactNode;
}) {
  const cliente = useQueryClient();
  const [pronto, setPronto] = useState(false);
  const inicio = useRef(Date.now());
  const chavesRef = useRef(chaves);
  chavesRef.current = chaves;
  const aguardarRef = useRef(aguardar);
  aguardarRef.current = aguardar;

  useEffect(() => {
    if (pronto) return;
    const conferir = () => {
      const passou = Date.now() - inicio.current;
      if (passou >= limiteMs) { setPronto(true); return; }
      if (aguardarRef.current) return;
      // Leitura desligada ou de outra aba não segura a tela: vale depois de um instante.
      const folga = passou > 450;
      const assentou = chavesRef.current.every((chave) => {
        const leituras = cliente.getQueryCache().findAll({ queryKey: chave });
        if (leituras.length === 0) return folga;
        return leituras.every((l) => l.state.status !== "pending" || (folga && l.state.fetchStatus === "idle"));
      });
      if (assentou) setPronto(true);
    };
    conferir();
    const parar = cliente.getQueryCache().subscribe(conferir);
    const curto = window.setTimeout(conferir, 500);
    const teto = window.setTimeout(conferir, limiteMs + 20);
    return () => { parar(); window.clearTimeout(curto); window.clearTimeout(teto); };
  }, [pronto, aguardar, limiteMs, cliente]);

  return (
    <>
      {!pronto && esqueleto}
      <div className={pronto ? "contents" : "hidden"} data-primeira-leitura={pronto ? "pronta" : "esperando"}>{children}</div>
    </>
  );
}

/** Esqueleto de cartões empilhados com altura fixa (a mesma do conteúdo que vem). */
export function EsqueletoDeCartoes({ alturas, rotulo = "Carregando", className = "" }: { alturas: number[]; rotulo?: string; className?: string }) {
  return (
    <div aria-busy="true" aria-label={rotulo} className={`min-w-0 space-y-4 ${className}`}>
      {alturas.map((h, i) => (
        <div key={i} className="rounded-lg bg-muted/70 motion-safe:animate-pulse" style={{ height: h }} />
      ))}
    </div>
  );
}
