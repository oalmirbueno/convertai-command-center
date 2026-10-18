import { useQuery } from "@tanstack/react-query";
import { Carregando, EstadoDeErro, EstadoVazio, Secao, campo, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";

/**
 * Painel de evolução (17/10, dono): por cliente e por mês, se o trabalho está melhorando.
 * A conta é toda da função (base-dos-agentes, acao "evolucao"); aqui só mostra.
 * Tipo copiado de supabase/functions/base-dos-agentes/evolucao.ts: aquele arquivo importa
 * o cliente do Supabase pelo "npm:" do Deno, que o tsc do painel não resolve.
 */
export interface MesDaEvolucao {
  mes: string;
  decididas: number;
  aprovadasDePrimeira: number;
  /** Fração de 0 a 1. */
  taxaDePrimeira: number | null;
  rodadasMedia: number | null;
  posts: number;
  multiploMedio: number | null;
  custoPorResultado: number | null;
  resultadosAds: number;
}

const NOMES_DOS_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeDoMes = (m: string) => `${NOMES_DOS_MESES[Number(m.slice(5, 7)) - 1] || m.slice(5, 7)}/${m.slice(2, 4)}`;
const virgula = (v: number, casas: number) => v.toFixed(casas).replace(".", ",");
const temDado = (m: MesDaEvolucao) => m.decididas > 0 || m.posts > 0 || m.resultadosAds > 0 || m.custoPorResultado !== null;

export default function EvolucaoDoCliente({ clientes }: { clientes: { id: string; nome: string }[] }) {
  const [escolhido, setEscolhido] = useEstadoDaTela<string>("base-dos-agentes:evolucao:cliente", "", { validar: (v) => typeof v === "string" });
  // Cliente lembrado que saiu da lista cai no primeiro.
  const clienteId = clientes.some((c) => c.id === escolhido) ? escolhido : clientes[0]?.id || "";

  const evolucao = useQuery({
    queryKey: ["base-dos-agentes", "evolucao", clienteId],
    queryFn: () => chamarFuncao<{ ok: boolean; meses: MesDaEvolucao[] }>("base-dos-agentes", { acao: "evolucao", client_id: clienteId }),
    enabled: !!clienteId,
    staleTime: 300_000,
    retry: false,
  });
  const meses = evolucao.data?.meses || [];

  return (
    <Secao
      titulo="Evolução do trabalho"
      descricao="Últimos 6 meses, por cliente"
      data-evolucao-do-cliente=""
      ajuda={
        <>
          Aprovadas de primeira: peças aprovadas sem nenhum ajuste, entre as decididas no mês (aprovadas e reprovadas).
          Rodadas por peça: quantas versões cada peça aprovada precisou (1 é de primeira). Posts: o desempenho médio dos
          posts publicados contra o normal do perfil (1,0x é o normal). Ads: custo por resultado dos anúncios no mês,
          na moeda da conta.
        </>
      }
      acao={
        clientes.length > 0 ? (
          <select aria-label="Cliente" className={juntar(campo, "w-48")} value={clienteId} onChange={(e) => setEscolhido(e.target.value)}>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        ) : undefined
      }
    >
      {!clientes.length ? (
        <EstadoVazio compacto titulo="Nenhum cliente." descricao="A evolução aparece quando houver cliente com peças." />
      ) : evolucao.isLoading ? (
        <Carregando rotulo="Carregando a evolução" linhas={3} />
      ) : evolucao.isError ? (
        <EstadoDeErro titulo="Não foi possível carregar a evolução." descricao={textoDoErro(evolucao.error)} />
      ) : !meses.some(temDado) ? (
        <EstadoVazio compacto titulo="Sem dados nos últimos 6 meses." descricao="Nenhuma peça decidida, post medido ou anúncio com gasto." />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-left">
            <thead>
              <tr className={texto.rotulo}>
                <th scope="col" className="py-1.5 pr-3 font-medium">Mês</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Aprovadas de primeira</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Rodadas por peça</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Posts</th>
                <th scope="col" className="py-1.5 font-medium">Ads (custo por resultado)</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => {
                const pct = m.taxaDePrimeira === null ? null : Math.round(m.taxaDePrimeira * 100);
                return (
                  <tr key={m.mes} className={juntar(texto.corpo, "border-t border-border tabular-nums")} data-mes={m.mes}>
                    <th scope="row" className="whitespace-nowrap py-2 pr-3 font-medium">{nomeDoMes(m.mes)}</th>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {pct === null ? (
                        <span className="text-muted-foreground">sem peças</span>
                      ) : (
                        <span className="inline-flex items-center">
                          <span className="mr-2 inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                          </span>
                          <span>{m.aprovadasDePrimeira} de {m.decididas} ({pct}%)</span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{m.rodadasMedia === null ? <span className="text-muted-foreground">-</span> : virgula(m.rodadasMedia, 1)}</td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {m.posts === 0 ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <span>
                          {m.posts} {m.posts === 1 ? "post" : "posts"}
                          {m.multiploMedio !== null && <span className="text-muted-foreground"> · {virgula(m.multiploMedio, 1)}x</span>}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2">
                      {m.custoPorResultado === null ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <span>
                          {virgula(m.custoPorResultado, 2)}
                          <span className="text-muted-foreground"> · {m.resultadosAds} {m.resultadosAds === 1 ? "resultado" : "resultados"}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Secao>
  );
}
