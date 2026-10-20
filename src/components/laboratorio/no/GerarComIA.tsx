import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Undo2, WandSparkles, X } from "lucide-react";
import { botao, campo, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { custoDoPreencher, fontesDoCliente, preencherNo } from "@/lib/laboratorio/api";
import type { NoDoLab } from "@/lib/laboratorio/nos";
import { useAcoesDoQuadro } from "./contexto";

/** Fontes do cliente (dossiê, marca, mídias, documentos), lidas uma vez e guardadas 5 min. */
export function useFontesDoCliente(clientId: string | null, ativo: boolean) {
  return useQuery({
    queryKey: ["laboratorio", "fontes-do-cliente", clientId || "livre"],
    queryFn: () => fontesDoCliente(clientId),
    enabled: ativo,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

const dinheiro = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

/**
 * "Gerar com IA" no próprio nó: um pedido curto opcional, o custo numa
 * confirmação compacta (no_preencher responde 409 com o custo; confirmar
 * reenvia com confirmado), os dados entram no nó e dá para Desfazer.
 * `campos` limita o que a IA preenche (ex.: só a instrução do Agente).
 */
export default function GerarComIA({
  no,
  campos,
  rotulo = "Gerar com IA",
  pedidoPadrao = "",
  icone,
  aberto: abertoDeFora,
  onFechar,
}: {
  no: NoDoLab;
  campos?: string[];
  rotulo?: string;
  pedidoPadrao?: string;
  icone?: ReactNode;
  /** Controlado de fora (o botão do cabeçalho abre); sem isso, o próprio botão abre. */
  aberto?: boolean;
  onFechar?: () => void;
}) {
  const a = useAcoesDoQuadro();
  const [abertoProprio, setAbertoProprio] = useState(false);
  const aberto = abertoDeFora !== undefined ? abertoDeFora : abertoProprio;
  const fechar = () => {
    setAbertoProprio(false);
    if (onFechar) onFechar();
  };
  const [pedido, setPedido] = useState(pedidoPadrao);
  const [fase, setFase] = useState<"livre" | "custo" | "pedindo" | "gerando">("livre");
  const [custo, setCusto] = useState(0);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState<{ antes: Record<string, unknown>; explicacao: string } | null>(null);

  const aplicar = (dados: Record<string, unknown>, explicacao: string) => {
    const antes: Record<string, unknown> = {};
    Object.keys(dados).forEach((k) => (antes[k] = no.dados[k]));
    a.mudarDados(no.id, dados);
    setFeito({ antes, explicacao });
    setFase("livre");
    fechar();
  };

  const pedir = async (confirmado: boolean) => {
    setErro("");
    setFase(confirmado ? "gerando" : "pedindo");
    try {
      await a.antesDeChamar();
      const r = await preencherNo({ projetoId: a.projetoId, noId: no.id, pedido: pedido || pedidoPadrao, campos, confirmado });
      aplicar(r.dados, r.explicacao);
    } catch (e) {
      const c = custoDoPreencher(e);
      if (c !== null && !confirmado) {
        setCusto(c);
        setFase("custo");
        return;
      }
      setErro(textoDoErro(e, "Não deu para gerar agora. Tente de novo."));
      setFase("livre");
    }
  };

  const ocupado = fase === "pedindo" || fase === "gerando";
  return (
    <div className="min-w-0" data-gerar-com-ia={no.id}>
      {abertoDeFora === undefined && !aberto ? (
        <button type="button" className={juntar(botao.barra, "h-7 px-2 text-primary")} onClick={() => setAbertoProprio(true)} title={`${rotulo} (mostra o custo antes)`} data-abrir-gerar="">
          {icone || <WandSparkles className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
          {rotulo}
        </button>
      ) : null}
      {aberto ? (
        <div className="mb-2 min-w-0 rounded-md bg-primary/[0.06] p-2" data-painel-gerar="">
          {fase === "custo" ? (
            <div className="flex min-w-0 flex-wrap items-center" data-confirmar-gerar="">
              <span className={juntar(texto.corpo, "mb-1 block w-full")}>
                Gerar custa <strong className="tabular-nums">{dinheiro(custo)}</strong>
              </span>
              <span className="flex-1" />
              <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => setFase("livre")}>
                Cancelar
              </button>
              <button type="button" className={juntar(botao.primario, "ml-1 h-7 px-2.5 text-[12px]")} onClick={() => void pedir(true)}>
                Confirmar
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center">
              <label htmlFor={`pedido-ia-${no.id}`} className="sr-only">
                Pedido para a IA (opcional)
              </label>
              <input
                id={`pedido-ia-${no.id}`}
                className={juntar(campo, "h-8 min-w-0 flex-1")}
                placeholder="Pedido curto (opcional)"
                value={pedido}
                onChange={(e) => setPedido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void pedir(false);
                  if (e.key === "Escape") fechar();
                }}
                disabled={ocupado}
              />
              <button type="button" className={juntar(botao.primario, "ml-1 h-8 px-2.5 text-[12px]")} onClick={() => void pedir(false)} disabled={ocupado} data-pedir-gerar="">
                {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <WandSparkles className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                {ocupado ? null : "Gerar"}
              </button>
              <button type="button" className={juntar(botao.icone, "ml-0.5 h-7 w-7")} onClick={fechar} aria-label="Fechar" title="Fechar" disabled={ocupado}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
          {erro ? (
            <p role="alert" className={juntar(texto.auxiliar, "mt-1 text-destructive")}>
              {erro}
            </p>
          ) : null}
        </div>
      ) : null}
      {feito ? (
        <div className="mb-2 flex min-w-0 items-center" data-feito-pela-ia="">
          <WandSparkles className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")} title={feito.explicacao}>
            {feito.explicacao || "Preenchido pela IA"}
          </span>
          <button
            type="button"
            className={juntar(botao.barra, "h-6 px-1.5 text-[12px]")}
            onClick={() => {
              a.mudarDados(no.id, feito.antes);
              setFeito(null);
            }}
            data-desfazer-ia=""
          >
            <Undo2 className="mr-1 h-3 w-3" aria-hidden="true" />
            Desfazer
          </button>
          <button type="button" className={juntar(botao.icone, "h-6 w-6")} onClick={() => setFeito(null)} aria-label="Dispensar" title="Dispensar">
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
