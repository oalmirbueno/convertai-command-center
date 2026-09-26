import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import {
  corpoDaPrancha,
  estiloDoQuadro,
  proximoPapel,
  ROTULO_DO_PAPEL,
  type PapelDoQuadro,
  type RespostaDaPrancha,
} from "./fidelidadeDaReferencia";

/**
 * Referência prancha (frente E, 25/09 à noite; dono: "às vezes eu coloco
 * várias artes dentro de uma imagem: um print de um perfil do Instagram com
 * várias capas, ou a sequência de um carrossel num print"). Ao escolher a
 * referência, o estúdio lê uma vez se ela é uma prancha (print de celular ou
 * carrossel lado a lado; a de cara de arte única só quando a equipe pede) e
 * mostra os quadros achados, cada um com o papel: capa (molde da capa),
 * sequência (guia das lâminas 2 em diante, na ordem) ou fora. Clicar troca o
 * papel; grava no trabalho pelo configurar, sem custo.
 */

export const chaveDaPrancha = (trabalhoId: string, referenciaId: string) => ["mesa", "prancha", trabalhoId, referenciaId];

const TIPO: Record<string, string> = { perfil: "print do perfil", carrossel: "print do carrossel", mosaico: "prancha" };

export default function EstudioPranchaDaReferencia({
  trabalhoId,
  referenciaId,
  rotulo,
  bloqueado = false,
  onSalvar,
}: {
  trabalhoId: string;
  referenciaId: string;
  /** Como a tela chama esta referência (ex.: "1ª referência"). */
  rotulo: string;
  bloqueado?: boolean;
  onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const chave = chaveDaPrancha(trabalhoId, referenciaId);
  const q = useQuery({
    queryKey: chave,
    queryFn: () => chamarFuncao<RespostaDaPrancha>("estudio-arte", { acao: "prancha", trabalho_id: trabalhoId, referencia_id: referenciaId }),
    staleTime: 30 * 60_000,
    retry: false,
  });

  const lerAgora = async () => {
    setLendo(true);
    try {
      const r = await chamarFuncao<RespostaDaPrancha>("estudio-arte", { acao: "prancha", trabalho_id: trabalhoId, referencia_id: referenciaId, forcar: true });
      queryClient.setQueryData(chave, r);
      if (!r || !r.prancha) toast.message("É uma arte só", { description: "O estúdio usa a imagem inteira como referência, como sempre." });
    } catch (e) {
      toast.error("Não deu para ler a referência", { description: textoDoErro(e) });
    } finally {
      setLendo(false);
    }
  };

  const gravar = async (papeis: PapelDoQuadro[] | null) => {
    setSalvando(true);
    try {
      await onSalvar(corpoDaPrancha(referenciaId, papeis));
      // Os papéis voltam da leitura na próxima consulta; a tela mostra na hora.
      const atual = queryClient.getQueryData<RespostaDaPrancha>(chave);
      if (atual && atual.prancha) {
        const base = atual.prancha.quadros;
        queryClient.setQueryData(chave, {
          ...atual,
          papeis_da_equipe: papeis,
          prancha: { ...atual.prancha, quadros: base.map((x, i) => (papeis && i < papeis.length ? { ...x, papel: papeis[i] } : x)) },
        });
      }
      if (!papeis) void queryClient.invalidateQueries({ queryKey: chave });
    } catch (e) {
      toast.error("Papel do quadro não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  if (q.isLoading) {
    return (
      <p className="flex items-center text-[11px] text-muted-foreground" data-prancha="lendo">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Conferindo se a {rotulo} tem várias artes…
      </p>
    );
  }
  const r = q.data;
  if (q.isError || !r) return null;
  if (!r.prancha) {
    if (r.lida) return null;
    return (
      <button
        type="button"
        onClick={() => void lerAgora()}
        disabled={lendo || bloqueado}
        className="inline-flex items-center text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Para print de perfil ou de carrossel: o estúdio acha cada arte e usa a capa e a sequência"
        data-prancha="ler"
      >
        {lendo ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <LayoutGrid className="mr-1 h-3 w-3" />}
        A {rotulo} tem várias artes? Ler os quadros
      </button>
    );
  }

  const quadros = r.prancha.quadros;
  const capas = quadros.filter((x) => x.papel === "capa").length;
  const seq = quadros.filter((x) => x.papel === "sequencia").length;
  const trocar = (i: number) => {
    if (bloqueado || salvando) return;
    void gravar(quadros.map((x, k) => (k === i ? proximoPapel(x.papel) : x.papel)));
  };

  return (
    <div className="min-w-0 rounded-md border border-border bg-background p-2" data-prancha="quadros">
      <p className="mb-1.5 flex min-w-0 items-center text-[11.5px] leading-snug">
        <LayoutGrid className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          {rotulo[0].toUpperCase() + rotulo.slice(1)}: {TIPO[r.prancha.tipo || "mosaico"] || "prancha"} com {quadros.length} artes. {capas} capa{capas === 1 ? "" : "s"}, {seq} de sequência.
        </span>
        {salvando && <Loader2 className="ml-1 h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
      </p>
      <ul className="grid grid-cols-6 gap-1">
        {quadros.map((x, i) => {
          const e = estiloDoQuadro(x, r.dimensoes);
          return (
            <li key={i} className="min-w-0">
              <button
                type="button"
                onClick={() => trocar(i)}
                disabled={bloqueado || salvando}
                title={`Quadro ${i + 1}: ${ROTULO_DO_PAPEL[x.papel]}. Clique para trocar (capa, sequência, fora).`}
                aria-label={`Quadro ${i + 1}: ${ROTULO_DO_PAPEL[x.papel]}`}
                className={`block w-full overflow-hidden rounded border-2 disabled:cursor-default ${x.papel === "capa" ? "border-primary" : x.papel === "sequencia" ? "border-primary/40" : "border-transparent opacity-40"}`}
              >
                <span className="block bg-secondary" style={e.caixa}>
                  {r.url ? <img src={r.url} alt="" style={e.imagem} loading="lazy" /> : null}
                </span>
              </button>
              <span className="mt-0.5 block truncate text-center text-[10px] text-muted-foreground">
                {i + 1} · {ROTULO_DO_PAPEL[x.papel]}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 flex min-w-0 items-start text-[10.5px] leading-snug text-muted-foreground">
        <span className="min-w-0 flex-1">
          A capa usa um quadro de capa (troca a cada versão quando há vários). A lâmina 2 usa a 1ª sequência, a 3 a 2ª, e assim por diante.
          {seq === 0 ? " Sem sequência, as outras lâminas seguem a capa gerada." : ""}
        </span>
        {r.papeis_da_equipe && r.papeis_da_equipe.length > 0 && (
          <button type="button" className="ml-1 shrink-0 text-primary underline-offset-2 hover:underline disabled:opacity-50" disabled={bloqueado || salvando} onClick={() => void gravar(null)}>
            voltar ao lido
          </button>
        )}
      </p>
    </div>
  );
}
