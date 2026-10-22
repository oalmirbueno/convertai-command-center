import { useEstimativa } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { campo, juntar } from "@/components/sistema/estilos";
import { modelosAtivos, nomeDoModelo, precoDoModelo, usd, type ModeloIa } from "@/lib/mesa/api";
import { corpoDoModelo, modeloRecomendadoParaCopy, ORDEM_DO_RACIOCINIO, parteDeTexto, resolverModeloDaCopy, TAMANHOS_ADS, type EscolhaGuardadaDoModelo } from "./adsApi";

/**
 * Modelo da copy da Mesa Ads (frente CR, pedido do dono em 27/09: "eu escolher
 * o modelo ali no plano de teste onde prepara a copy e também refinar com o
 * modelo que eu escolher"). Um seletor só, igual nas três telas que escrevem
 * copy (Criar criativos no Plano de teste, Refinar copy e Pacote de copy):
 * modelo de texto ativo do catálogo com o preço ao lado e o raciocínio.
 *
 * Padrão (22/10/2026): o melhor para copy (modeloRecomendadoParaCopy: o papel
 * "copy" do catálogo, senão o Claude Opus, senão o estrategista) no raciocínio
 * máximo que o modelo aceita, marcado "recomendado para copy" na lista, com o
 * custo de um refino à vista ao lado. A escolha fica lembrada por cliente e por
 * pessoa (useEstadoDaTela, rota fixa da Mesa Ads) e vai até o servidor em
 * modelo_id e raciocinio; o servidor respeita (resolverModelo).
 */

const ROTULO_DO_RACIOCINIO: Record<string, string> = {
  none: "Sem raciocínio",
  minimal: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
};

export const rotuloDoRaciocinio = (r: string | null | undefined) => (r ? ROTULO_DO_RACIOCINIO[r] || r : "");

const ehEscolha = (v: unknown) => !!v && typeof v === "object" && typeof (v as EscolhaGuardadaDoModelo).modelo === "string" && typeof (v as EscolhaGuardadaDoModelo).raciocinio === "string";

/** Chave da escolha: por cliente, na rota da Mesa Ads (as etapas trocam só o endereço). */
export const chaveDoModeloDaCopy = (clientId: string) => `mesa-ads:modelo-da-copy:${clientId}`;

export function useModeloDaCopy() {
  const { clientId, catalogo } = useMesa();
  const [guardada, setGuardada] = useEstadoDaTela<EscolhaGuardadaDoModelo>(chaveDoModeloDaCopy(clientId), { modelo: "", raciocinio: "" }, { validar: ehEscolha, esperaMs: 0, rota: "/mesa-ads" });
  const escolha = resolverModeloDaCopy(catalogo, guardada);
  const recomendado = modeloRecomendadoParaCopy(catalogo);
  return {
    ...escolha,
    recomendadoId: recomendado ? recomendado.id : "",
    modelos: modelosAtivos(catalogo, "texto"),
    corpo: corpoDoModelo(escolha),
    trocarModelo: (id: string) => setGuardada({ modelo: id, raciocinio: "" }),
    trocarRaciocinio: (r: string) => setGuardada({ modelo: escolha.modelo ? escolha.modelo.id : "", raciocinio: r }),
  };
}

export type EstadoDoModeloDaCopy = ReturnType<typeof useModeloDaCopy>;

/** Nome curto do modelo e do raciocínio ("OpenAI: GPT-6 Luna · Máximo"). */
export function resumoDoModelo(modelo: ModeloIa | null, raciocinio: string | null): string {
  if (!modelo) return "sem modelo de texto no catálogo";
  return raciocinio ? `${nomeDoModelo(modelo)} · ${rotuloDoRaciocinio(raciocinio)}` : nomeDoModelo(modelo);
}

/** Os dois campos (modelo e raciocínio), compactos, com o preço de cada modelo. */
export function SeletorDoModeloDaCopy({ estado, className = "" }: { estado: EstadoDoModeloDaCopy; className?: string }) {
  const { modelo, raciocinio, modelos } = estado;
  const niveis = ((modelo && modelo.raciocinio) || []).filter((n) => ORDEM_DO_RACIOCINIO.indexOf(n) >= 0);
  // Custo à vista: um refino de copy (3 variações) no modelo e raciocínio escolhidos, a mesma conta do botão.
  const estimativa = useEstimativa(modelo ? [parteDeTexto(estado, TAMANHOS_ADS.variarCopy.entrada + 3000, TAMANHOS_ADS.variarCopy.saida)] : null);
  return (
    <div className={juntar("flex min-w-0 flex-wrap items-center", className)} role="group" aria-label="Escolha do modelo da copy">
      <select
        aria-label="Modelo da copy"
        value={modelo ? modelo.id : ""}
        onChange={(e) => estado.trocarModelo(e.target.value)}
        disabled={!modelos.length}
        className={juntar(campo, "mb-1 mr-1.5 h-8 w-auto max-w-[260px] px-2 text-[12px]")}
        title={modelo ? `${nomeDoModelo(modelo)}: ${precoDoModelo(modelo)} (entrada e saída)` : undefined}
      >
        {!modelos.length && <option value="">Nenhum modelo de texto ativo</option>}
        {modelos.map((m) => (
          <option key={m.id} value={m.id}>
            {nomeDoModelo(m)} · {precoDoModelo(m)}{m.id === estado.recomendadoId ? " · recomendado para copy" : ""}
          </option>
        ))}
      </select>
      <select
        aria-label="Raciocínio da copy"
        value={raciocinio || ""}
        onChange={(e) => estado.trocarRaciocinio(e.target.value)}
        disabled={!niveis.length}
        className={juntar(campo, "mb-1 h-8 w-auto px-2 text-[12px]")}
      >
        {!niveis.length && <option value="">Sem níveis</option>}
        {niveis.map((n) => (
          <option key={n} value={n}>
            {rotuloDoRaciocinio(n)}
          </option>
        ))}
      </select>
      {modelo && (
        <span className="mb-1 ml-1.5 text-[11px] text-muted-foreground" data-custo-da-copy="">
          {estimativa.isLoading ? "estimando…" : typeof estimativa.data === "number" ? `~${usd(estimativa.data)} por refino` : "sem estimativa"}
          {modelo.id === estado.recomendadoId ? " · recomendado para copy" : ""}
        </span>
      )}
    </div>
  );
}
