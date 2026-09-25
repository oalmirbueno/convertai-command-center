import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import SeletorDeReferencias, { MiniaturasEscolhidas, type AbaDoSeletor } from "./SeletorDeReferencias";
import { gravarTrabalhoNoCache, type TrabalhoGravado } from "./estudioUtil";
import type { CardDaDirecao, Trabalho } from "./useItensDoMes";

/**
 * Referências no Estúdio (aba do inspetor), com o seletor único da Mesa: as
 * do cliente (Artes da marca e Referências de composição, destaque primeiro),
 * as pastas do workspace, o banco da agência (páginas de 24) e o Pinterest.
 * A escolha vale para o conjunto ou só para a lâmina selecionada (sobrepõe as
 * do conjunto) e vai para o estúdio pelo "configurar", sem custo. Id do banco
 * da agência leva "g:".
 *
 * Até 2 por alvo (25/09): o gerador só usa 2, e antes a tela deixava marcar 4
 * (a 3ª e a 4ª eram ignoradas sem aviso). Com referência escolhida, a lâmina
 * é recomposta seguindo o layout dela (modo replicar referência): a 1ª dá a
 * estrutura e a 2ª o tratamento. A escolha entra no cache na hora.
 */

export type AlvoDasReferencias = "conjunto" | "lamina";
type AbaDasReferencias = "cliente" | "banco";

const POR_PAGINA = 24;
const PREFIXO_GLOBAL = "g:";
/** O gerador replica no máximo 2 referências por lâmina (1ª estrutura, 2ª tratamento). */
export const MAX_NO_ESTUDIO = 2;

/** O papel de cada escolhida no modo replicar referência, na ordem da escolha. */
export function papelDaEscolhida(indice: number, total: number): string {
  if (total <= 1) return "layout a replicar";
  return indice === 0 ? "1ª: estrutura e layout" : "2ª: tratamento da imagem";
}

const iguais = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.indexOf(x) >= 0);

export default function ReferenciasDoEstudio({
  trabalho,
  cardSelecionado,
  alvo,
  onAlvo,
  aba,
  onAba,
  onAtualizar,
  entregue = false,
  onReabrir,
}: {
  trabalho: Trabalho;
  /** Trabalho entregue: a escolha não salva até reabrir (antes a tela marcava e o servidor recusava calado). */
  entregue?: boolean;
  onReabrir?: () => void;
  cardSelecionado: CardDaDirecao | null;
  alvo: AlvoDasReferencias;
  onAlvo: (a: AlvoDasReferencias) => void;
  aba: AbaDasReferencias;
  onAba: (a: AbaDasReferencias) => void;
  onAtualizar: () => void;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
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
    if (entregue) {
      toast.error("Trabalho entregue: as referências não mudam", {
        description: "Reabra para corrigir; a entrega anterior fica no histórico.",
        ...(onReabrir ? { action: { label: "Reabrir", onClick: onReabrir } } : {}),
      });
      return;
    }
    setRascunho(lista);
    const alvoDaVez = alvoReal;
    const ordem = cardSelecionado ? cardSelecionado.ordem : null;
    setSalvando((n) => n + 1);
    fila.current = fila.current.then(async () => {
      try {
        const r = await chamarFuncao<{ trabalho?: TrabalhoGravado }>("estudio-arte", {
          acao: "configurar",
          trabalho_id: trabalho.id,
          ...(alvoDaVez === "lamina" && ordem !== null
            ? { card: { ordem, referencias_ids: lista } }
            : { conjunto: { referencias_ids: lista } }),
        });
        gravarTrabalhoNoCache(queryClient, clientId, r && r.trabalho);
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
      ? "O gerador replica estas de perto em todas as lâminas que não têm as próprias."
      : "Nenhuma escolhida: o estúdio escolhe sozinho entre as do cliente, as em destaque primeiro, sem replicar layout.";
  }, [alvoReal, daLamina.length, doConjunto.length, cardSelecionado?.ordem]);

  const doBanco = escolhidas.filter((id) => id.indexOf(PREFIXO_GLOBAL) === 0).length;
  const abaDoSeletor: AbaDoSeletor = abaLocal || aba;

  return (
    <div className="min-w-0 space-y-4">
      {entregue && (
        <div className="flex min-w-0 items-start rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-[12px] leading-snug" role="status">
          <Lock className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">Trabalho entregue: as referências não mudam. Reabra para corrigir.</span>
          {onReabrir && (
            <Button type="button" size="sm" variant="outline" className="ml-2 h-7 shrink-0 px-2 text-[11.5px]" onClick={onReabrir}>
              Reabrir
            </Button>
          )}
        </div>
      )}
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
        {escolhidas.length > 0 && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {escolhidas.length === 1
              ? "A lâmina segue o layout desta referência, com as cores, as fontes e a logo da marca, o texto exato e a foto da lâmina."
              : "Com duas: a 1ª dá a estrutura e o layout; a 2ª dá o tratamento da imagem e os elementos gráficos."}
          </p>
        )}
      </div>

      <SeletorDeReferencias
        selecionados={escolhidas}
        onChange={gravar}
        max={MAX_NO_ESTUDIO}
        modo="escolher"
        colunas={3}
        porPagina={POR_PAGINA}
        alturaMax="520px"
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
