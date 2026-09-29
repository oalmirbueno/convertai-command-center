import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, BookmarkCheck, CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { dataCurta, padraoPara, textoDoErro } from "@/lib/mesa/api";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { foco, juntar, superficie } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { chamarAds, chavesAds, lerAprendizados } from "./adsApi";
import { CabecalhoDaParte, Diagnostico, useParteRecolhida } from "./Comuns";
import { PERIODOS_DA_CONTA_V4, type PeriodoDaConta } from "./contaApi";
import { CartaoCompacto, FiltroDeObjetivo, PainelDeResultados, ResumoDoTopo, SeletorDaAbaDeResultados, useAbaDosResultados } from "./ResultadosClaros";
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
 *
 * 26/09 (sistema de design): área de trabalho (no computador a etapa rola por
 * dentro, com a posição lembrada), explicação no "?", período num seletor,
 * período, objetivo e aba lembrados por cliente.
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
  const [dias, setDias] = useEstadoDaTela<PeriodoDaConta>(`mesa-ads:resultados:dias:${clientId}`, 14, {
    validar: (v) => typeof v === "number" && PERIODOS.some((p) => p.dias === v),
  });
  const [grupo, setGrupo] = useEstadoDaTela<GrupoDeObjetivo | "">(`mesa-ads:resultados:objetivo:${clientId}`, "", { validar: (v) => typeof v === "string", esperaMs: 0 });
  const [registrando, setRegistrando] = useState<string | null>(null);
  const [abaDosAnuncios, setAbaDosAnuncios] = useAbaDosResultados(`mesa-ads:resultados:aba:${clientId}`);
  const parteDosAnuncios = useParteRecolhida(`mesa-ads:resultados:anuncios:${clientId}`);
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
              <Button type="button" size="sm" variant={aberto ? "secondary" : "ghost"} className="h-7 text-[12px]" onClick={() => { setRegistrando(aberto ? null : a.ad_id); setTextoDoAprendizado(""); }}>
                <BookmarkCheck className="mr-1 h-3.5 w-3.5" /> Aprendizado
              </Button>
            ) : undefined
          }
        />
        {aberto && criativoId && (
          <div className={juntar(superficie.poco, "p-2.5")}>
            {a.diagnostico && <div className="mb-2"><Diagnostico valor={a.diagnostico} /></div>}
            <div className="flex min-w-0 flex-wrap items-end">
              <Textarea
                aria-label="Aprendizado"
                value={textoDoAprendizado}
                onChange={(e) => setTextoDoAprendizado(e.target.value)}
                rows={2}
                placeholder="Opcional: o que aprendemos. Em branco, o estrategista escreve no formato do dossiê a partir das métricas."
                className="mb-1 mr-2 min-w-0 flex-1 text-[13px]"
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
    <AreaDeTrabalho rotuloDoPrincipal="Resultados" memoriaDaRolagem={`mesa-ads:resultados:${clientId}`}>
      <div className="min-w-0 space-y-5 pb-6">
        <CabecalhoDaParte
          titulo="Resultados"
          ajuda="O resultado de cada anúncio é o que o objetivo dele busca; o custo só se compara dentro do mesmo objetivo. Números da conta, calculados em código (grátis)."
          descricao={`De ${dataCurta(periodo.inicio)} a ${dataCurta(periodo.fim)}`}
          acoes={
            <>
              <SeletorCompacto
                rotulo="Período"
                icone={<CalendarDays className="h-3.5 w-3.5" />}
                opcoes={PERIODOS.map((p) => ({ valor: String(p.dias), rotulo: p.rotulo }))}
                valor={String(dias)}
                onEscolher={(v) => setDias(Number(v) as PeriodoDaConta)}
              />
              <Button type="button" size="sm" variant="outline" className="h-9" disabled={conta.isFetching} onClick={() => void conta.refetch()} title="Relê as métricas (sem custo de IA)">
                {conta.isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                Atualizar
              </Button>
            </>
          }
        />

        {conta.isError && (
          <EstadoDeErro
            titulo="Os resultados não abriram."
            descricao={textoDoErro(conta.error)}
            acao={
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void conta.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        )}
        {conta.isLoading && <Carregando forma="aba" rotulo="Lendo os resultados" />}

        {dados && !dados.conta.conectada && (
          <EstadoVazio icone={<BarChart3 className="h-5 w-5" />} titulo="A conta de anúncios deste cliente não está conectada" descricao="Conecte a conta da Meta no cadastro do cliente para ver os resultados aqui." />
        )}

        {dados && dados.conta.conectada && (
          <>
            <ResumoDoTopo dados={dados} grupo={grupo} onGrupo={setGrupo} />
            <section className="min-w-0 border-t border-border pt-5" aria-label="Anúncios">
              <CabecalhoDaParte
                titulo="Anúncios"
                nivel={3}
                recolher={parteDosAnuncios}
                acoes={
                  <>
                    <FiltroDeObjetivo dados={dados} valor={grupo} onMudar={setGrupo} />
                    <SeletorDaAbaDeResultados dados={dados} grupo={grupo} aba={abaDosAnuncios} onMudar={setAbaDosAnuncios} />
                  </>
                }
              />
              {!parteDosAnuncios.recolhido && <PainelDeResultados dados={dados} grupo={grupo} renderAnuncio={cartao} aba={abaDosAnuncios} onAba={setAbaDosAnuncios} />}
            </section>
            <VinculoAutomatico />
          </>
        )}

        {(aprendizados.data || []).length > 0 && (
          <details className="min-w-0 border-t border-border pt-4" aria-label="Aprendizados registrados">
            <summary className={juntar("cursor-pointer rounded text-[13px] font-medium text-foreground", foco)}>Aprendizados registrados ({(aprendizados.data || []).length})</summary>
            <ul className="mt-2 divide-y divide-border">
              {(aprendizados.data || []).map((a) => (
                <li key={a.id} className="py-2">
                  <p className="text-[11px] text-muted-foreground">{a.evidencia} · {dataCurta(a.criado_em)}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{a.texto}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </AreaDeTrabalho>
  );
}
