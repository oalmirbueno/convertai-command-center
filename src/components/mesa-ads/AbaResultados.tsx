import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkCheck, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta, padraoPara } from "@/lib/mesa/api";
import { chamarAds, chavesAds, lerAprendizados } from "./adsApi";
import { Diagnostico } from "./Comuns";
import { PERIODOS_DA_CONTA_V4, type PeriodoDaConta } from "./contaApi";
import { CartaoCompacto, FiltroDeObjetivo, PainelDeResultados, ResumoDoTopo } from "./ResultadosClaros";
import { chaveDosResultados, lerContaComResultados, type AnuncioDoResultado, type GrupoDeObjetivo } from "./resultadosApi";
import VinculoAutomatico from "./VinculoAutomatico";

export { Diagnostico };

/**
 * Etapa 6, Resultados (refeita em 26/09/2026, pedido do dono: "deixar mais
 * claro, está confuso"): o resumo no topo (investimento, resultado principal,
 * custo por resultado e tendência), o filtro por objetivo com o rótulo certo
 * do resultado, as abas simples (Ativos agora, Melhores anúncios, Melhores
 * criativos, Todos, Para descartar) e o vínculo automático com os criativos da
 * Mesa Ads no lugar da lista "anúncios sem vínculo". Números de
 * conta_ao_vivo (grátis, regra em código). Sem tabela larga: nada rola de
 * lado nem cria rolagem dupla na página.
 */

export const PERIODOS = PERIODOS_DA_CONTA_V4.map((d) => ({ dias: d, rotulo: `${d} dias` }));

const dataIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function periodoDosUltimos(dias: number, hoje = new Date()): { inicio: string; fim: string } {
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  const inicio = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() - (dias - 1));
  return { inicio: dataIso(inicio), fim: dataIso(fim) };
}

export default function AbaResultados() {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [dias, setDias] = useState<PeriodoDaConta>(14);
  const [grupo, setGrupo] = useState<GrupoDeObjetivo | "">("");
  const [registrando, setRegistrando] = useState<string | null>(null);
  const [textoDoAprendizado, setTextoDoAprendizado] = useState("");
  const conta = useQuery({
    queryKey: chaveDosResultados(clientId, dias),
    queryFn: () => lerContaComResultados(clientId, dias),
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const aprendizados = useQuery({ queryKey: chavesAds.aprendizados(clientId), queryFn: () => lerAprendizados(clientId) });
  const dados = conta.data || null;
  const estrategista = padraoPara(catalogo, "estrategista");
  const periodo = dados && dados.conta.periodo ? dados.conta.periodo : periodoDosUltimos(dias);

  const cartao = (a: AnuncioDoResultado) => {
    const criativoId = a.criativo && a.criativo.origem === "ligado" ? a.criativo.id : null;
    const aberto = registrando === a.ad_id;
    return (
      <div className="min-w-0 space-y-1.5">
        <CartaoCompacto
          a={a}
          acao={
            criativoId ? (
              <Button type="button" size="sm" variant={aberto ? "secondary" : "ghost"} className="h-7 text-[11.5px]" onClick={() => { setRegistrando(aberto ? null : a.ad_id); setTextoDoAprendizado(""); }}>
                <BookmarkCheck className="mr-1 h-3.5 w-3.5" /> Aprendizado
              </Button>
            ) : undefined
          }
        />
        {aberto && criativoId && (
          <div className="rounded-lg border border-border bg-muted/40 p-2.5">
            {a.diagnostico && <div className="mb-2"><Diagnostico valor={a.diagnostico} /></div>}
            <div className="flex min-w-0 flex-wrap items-end">
              <Textarea
                aria-label="Aprendizado"
                value={textoDoAprendizado}
                onChange={(e) => setTextoDoAprendizado(e.target.value)}
                rows={2}
                placeholder="Opcional: o que aprendemos. Em branco, o estrategista escreve no formato do dossiê a partir das métricas."
                className="mb-1 mr-2 min-w-0 flex-1 text-[12.5px]"
              />
              <BotaoComCusto
                rotulo="Registrar"
                titulo="Registrar aprendizado"
                descricao="Grava o aprendizado com as métricas do período (E3; E4 quando confirma em nova janela) e alimenta a memória do estrategista de ads."
                className="mb-1 h-9"
                partes={() => [{ modeloId: estrategista ? estrategista.id : null, tipo: "texto", tokensEntrada: 8000, tokensSaida: 1200 }]}
                executar={() => chamarAds("aprendizado_registrar", { criativo_id: criativoId, periodo_inicio: periodo.inicio, periodo_fim: periodo.fim, texto: textoDoAprendizado.trim() || undefined })}
                aoConcluir={() => {
                  setRegistrando(null);
                  setTextoDoAprendizado("");
                  void queryClient.invalidateQueries({ queryKey: chavesAds.aprendizados(clientId) });
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card px-4 py-3">
        <div className="mb-1 mr-3 mt-1 min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Resultados</h2>
          <p className="text-[12px] text-muted-foreground">
            De {dataCurta(periodo.inicio)} a {dataCurta(periodo.fim)}. O resultado de cada anúncio é o que o objetivo dele busca; o custo só se compara dentro do mesmo objetivo.
          </p>
        </div>
        <div className="mb-1 mr-2 mt-1 flex max-w-full flex-wrap items-center rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              role="radio"
              aria-checked={dias === p.dias}
              onClick={() => setDias(p.dias)}
              className={`h-7 rounded-md px-2.5 text-[12px] ${dias === p.dias ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" className="mb-1 mt-1 h-9" disabled={conta.isFetching} onClick={() => void conta.refetch()} title="Relê as métricas (sem custo de IA)">
          {conta.isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      {conta.isError && <AvisoDeErro erro={conta.error} />}
      {conta.isLoading && <div className="h-40 animate-pulse rounded-xl bg-muted/70" />}

      {dados && !dados.conta.conectada && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">A conta de anúncios deste cliente não está conectada</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Conecte a conta da Meta no cadastro do cliente para ver os resultados aqui.</p>
        </div>
      )}

      {dados && dados.conta.conectada && (
        <>
          <ResumoDoTopo dados={dados} grupo={grupo} onGrupo={setGrupo} />
          <FiltroDeObjetivo dados={dados} valor={grupo} onMudar={setGrupo} />
          <PainelDeResultados dados={dados} grupo={grupo} renderAnuncio={cartao} />
          <VinculoAutomatico />
        </>
      )}

      {(aprendizados.data || []).length > 0 && (
        <details className="rounded-xl border border-border bg-card p-4" aria-label="Aprendizados registrados">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Aprendizados registrados ({(aprendizados.data || []).length})</summary>
          <ul className="mt-2 space-y-2">
            {(aprendizados.data || []).map((a) => (
              <li key={a.id} className="rounded-lg border border-border px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{a.evidencia} · {dataCurta(a.criado_em)}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{a.texto}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
