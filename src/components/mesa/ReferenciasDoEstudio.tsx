import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import SeletorDeReferencias, { MiniaturasEscolhidas, type AbaDoSeletor } from "./SeletorDeReferencias";
import type { CardDaDirecao, Trabalho } from "./useItensDoMes";

/**
 * Referências no Estúdio (aba do inspetor), com o seletor único da Mesa: as
 * do cliente (Artes da marca e Referências de composição, destaque primeiro),
 * as pastas do workspace, o banco da agência (páginas de 24) e o Pinterest.
 * A escolha vale para o conjunto ou só para a lâmina selecionada (sobrepõe as
 * do conjunto) e vai para o estúdio pelo "configurar", sem custo. Id do banco
 * da agência leva "g:". O servidor guarda até 4 por alvo.
 */

export type AlvoDasReferencias = "conjunto" | "lamina";
type AbaDasReferencias = "cliente" | "banco";

const POR_PAGINA = 24;
const PREFIXO_GLOBAL = "g:";
/** configurar guarda no máximo 4 referências por alvo (idsDeReferencia). */
const MAX_NO_ESTUDIO = 4;

const iguais = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.indexOf(x) >= 0);

export default function ReferenciasDoEstudio({
  trabalho,
  cardSelecionado,
  alvo,
  onAlvo,
  aba,
  onAba,
  onAtualizar,
}: {
  trabalho: Trabalho;
  cardSelecionado: CardDaDirecao | null;
  alvo: AlvoDasReferencias;
  onAlvo: (a: AlvoDasReferencias) => void;
  aba: AbaDasReferencias;
  onAba: (a: AbaDasReferencias) => void;
  onAtualizar: () => void;
}) {
  const [rascunho, setRascunho] = useState<string[] | null>(null);
  const [salvando, setSalvando] = useState(0);
  // Pastas do workspace e Pinterest ficam só nesta tela; cliente e banco seguem guardados pelo Estúdio.
  const [abaLocal, setAbaLocal] = useState<AbaDoSeletor | null>(null);
  const fila = useRef<Promise<void>>(Promise.resolve());

  const alvoReal: AlvoDasReferencias = alvo === "lamina" && cardSelecionado ? "lamina" : "conjunto";
  const doConjunto = trabalho.direcao?.referencias_ids || [];
  const daLamina = cardSelecionado?.referencias_ids || [];
  const atual = alvoReal === "lamina" ? daLamina : doConjunto;
  const escolhidas = rascunho || atual;

  // O banco já tem a escolha: o rascunho sai de cena.
  useEffect(() => {
    if (rascunho && iguais(rascunho, atual)) setRascunho(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual.join("|")]);
  useEffect(() => { setRascunho(null); }, [alvoReal, cardSelecionado?.ordem]);

  /** Grava a lista inteira; as gravações seguem em fila, a última vence. */
  const gravar = (lista: string[]) => {
    setRascunho(lista);
    const alvoDaVez = alvoReal;
    const ordem = cardSelecionado ? cardSelecionado.ordem : null;
    setSalvando((n) => n + 1);
    fila.current = fila.current.then(async () => {
      try {
        await chamarFuncao("estudio-arte", {
          acao: "configurar",
          trabalho_id: trabalho.id,
          ...(alvoDaVez === "lamina" && ordem !== null
            ? { card: { ordem, referencias_ids: lista } }
            : { conjunto: { referencias_ids: lista } }),
        });
        onAtualizar();
      } catch (e) {
        setRascunho(null);
        toast.error("Referências não salvas", { description: textoDoErro(e) });
      } finally {
        setSalvando((n) => n - 1);
      }
    });
  };

  const resumo = useMemo(() => {
    if (alvoReal === "lamina") {
      return daLamina.length
        ? `A lâmina ${cardSelecionado?.ordem} usa só estas, no lugar das do conjunto.`
        : `A lâmina ${cardSelecionado?.ordem} usa as do conjunto. Escolha aqui para ela ter as próprias.`;
    }
    return doConjunto.length
      ? "O diretor e o gerador seguem estas de perto em todas as lâminas."
      : "Nenhuma escolhida: o estúdio escolhe sozinho entre as do cliente, as em destaque primeiro.";
  }, [alvoReal, daLamina.length, doConjunto.length, cardSelecionado?.ordem]);

  const doBanco = escolhidas.filter((id) => id.indexOf(PREFIXO_GLOBAL) === 0).length;
  const abaDoSeletor: AbaDoSeletor = abaLocal || aba;

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-1">
        <button
          type="button"
          onClick={() => onAlvo("conjunto")}
          aria-pressed={alvoReal === "conjunto"}
          className={`h-8 min-w-0 truncate rounded-md px-2 text-[12px] transition-colors ${alvoReal === "conjunto" ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Conjunto ({doConjunto.length})
        </button>
        <button
          type="button"
          onClick={() => onAlvo("lamina")}
          disabled={!cardSelecionado}
          aria-pressed={alvoReal === "lamina"}
          className={`h-8 min-w-0 truncate rounded-md px-2 text-[12px] transition-colors disabled:opacity-50 ${alvoReal === "lamina" ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {cardSelecionado ? `Só a lâmina ${cardSelecionado.ordem} (${daLamina.length})` : "Só uma lâmina"}
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex min-w-0 items-start">
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground">
            {resumo}
            {escolhidas.length > 0 && doBanco > 0 ? ` ${doBanco} do banco da agência.` : ""}
          </p>
          {salvando > 0 && <Loader2 className="ml-2 mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          {alvoReal === "lamina" && daLamina.length > 0 && (
            <Button type="button" size="sm" variant="ghost" className="ml-1 h-7 shrink-0 px-2 text-[11.5px]" onClick={() => gravar([])}>
              Usar as do conjunto
            </Button>
          )}
        </div>
        <MiniaturasEscolhidas ids={escolhidas} colunas={5} onTirar={(id) => gravar(escolhidas.filter((x) => x !== id))} />
      </div>

      <SeletorDeReferencias
        selecionados={escolhidas}
        onChange={gravar}
        max={MAX_NO_ESTUDIO}
        modo="escolher"
        colunas={3}
        porPagina={POR_PAGINA}
        alturaMax="min(58vh, 520px)"
        aba={abaDoSeletor}
        onAba={(a) => {
          if (a === "cliente" || a === "banco") {
            setAbaLocal(null);
            onAba(a);
          } else setAbaLocal(a);
        }}
      />
    </div>
  );
}
