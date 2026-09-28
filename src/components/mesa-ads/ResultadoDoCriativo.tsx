import { useQuery } from "@tanstack/react-query";
import { useMesa } from "@/components/mesa/MesaContexto";
import {
  brl,
  chamarAds,
  chavesAds,
  inteiro,
  normalizarConta,
  porcento,
  type AnuncioAoVivo,
  type Angulo,
  type ContaAoVivo,
  type CriativoAds,
} from "./adsApi";
import { SeloDoSinal } from "./Comuns";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";

/**
 * Foco em resultado no Estúdio Ads (pedido do dono, 25/09): o criativo ligado
 * a um anúncio mostra a métrica real da conta (conta_ao_vivo, 14 dias, sem IA
 * e grátis) contra a regra de corte do ângulo; o ainda não ligado mostra a
 * hipótese, a métrica que decide e o corte, para ninguém subir peça sem meta.
 */

export const DIAS_DO_RESULTADO = 14;

/** Veredito em código: o custo por resultado do anúncio contra o corte do ângulo. */
export function vereditoDoCorte(a: AnuncioAoVivo | null, angulo: Angulo | null): string | null {
  if (!a || !angulo || !angulo.corte) return null;
  const c = angulo.corte;
  const m = a.metricas;
  const gasto = m.gasto || 0;
  const resultados = m.resultados || 0;
  if (c.gasto_sem_resultado_brl !== null && resultados === 0 && gasto >= c.gasto_sem_resultado_brl) return `Passou do corte: ${brl(gasto)} sem resultado.`;
  if ((m.impressoes || 0) < c.impressoes_minimas) return `Ainda sem volume para julgar (menos de ${inteiro(c.impressoes_minimas)} impressões).`;
  if (c.limite_brl !== null && m.custo_por_resultado !== null) {
    return m.custo_por_resultado > c.limite_brl
      ? `Acima do corte: ${brl(m.custo_por_resultado)} por resultado (o limite é ${brl(c.limite_brl)}).`
      : `Dentro da meta: ${brl(m.custo_por_resultado)} por resultado (o limite é ${brl(c.limite_brl)}).`;
  }
  return null;
}

/** Uma linha para o bloco recolhido: os números do anúncio, ou a meta quando ainda não há anúncio. */
export function resumoDoResultado(anuncio: AnuncioAoVivo | null, criativo: CriativoAds, angulo: Angulo | null, lendo: boolean): string {
  if (anuncio) {
    const m = anuncio.metricas;
    return [`${brl(m.gasto)} em ${DIAS_DO_RESULTADO} dias`, `${inteiro(m.resultados)} resultados`, m.custo_por_resultado !== null ? `${brl(m.custo_por_resultado)} cada` : null, m.ctr_saida !== null && m.ctr_saida !== undefined ? `CTR ${porcento(m.ctr_saida)}` : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (criativo.ad_id) return lendo ? "Lendo a conta…" : `Sem entrega nos últimos ${DIAS_DO_RESULTADO} dias`;
  return angulo && angulo.corte ? `Sem anúncio ligado · corte: ${angulo.corte.texto}` : "Sem anúncio ligado";
}

export default function ResultadoDoCriativo({ criativo, angulo }: { criativo: CriativoAds; angulo: Angulo | null }) {
  const { clientId } = useMesa();
  const conta = useQuery({
    queryKey: chavesAds.conta(clientId, DIAS_DO_RESULTADO),
    enabled: !!criativo.ad_id,
    queryFn: async (): Promise<ContaAoVivo> => normalizarConta(await chamarAds("conta_ao_vivo", { client_id: clientId, dias: DIAS_DO_RESULTADO })),
    staleTime: 2 * 60_000,
    retry: false,
  });
  const anuncio = criativo.ad_id && conta.data ? conta.data.anuncios.find((a) => a.ad_id === criativo.ad_id) || null : null;
  const veredito = vereditoDoCorte(anuncio, angulo);
  // 28/09 (frente AD4, dono): recolhido por padrão, sem caixa; o título recolhe e o resumo fica numa linha.
  const [recolhido, setRecolhido] = useRecolhido(`mesa-ads:estudio:resultado:${clientId}`, true);
  if (!criativo.ad_id && !angulo) return null;
  const resumo = resumoDoResultado(anuncio, criativo, angulo, conta.isLoading);

  return (
    <section className="min-w-0" aria-label="Resultado do criativo" data-resultado-do-criativo="">
      <CabecalhoDeSecao
        nivel={3}
        titulo="Resultado"
        recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo: veredito ? `${resumo} · ${veredito}` : resumo }}
        acao={anuncio ? <SeloDoSinal sinal={anuncio.sinal} /> : undefined}
      />
      {!recolhido && (
        <div className="mt-2 min-w-0">
          {criativo.ad_id && conta.isLoading && <p className="text-[11.5px] text-muted-foreground">Lendo a conta…</p>}
          {criativo.ad_id && conta.isError && <p className="text-[11.5px] text-muted-foreground">A conta não respondeu agora.</p>}
          {anuncio ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4" aria-label={`Métricas dos últimos ${DIAS_DO_RESULTADO} dias`}>
              <span>Gasto: <b className="tabular-nums">{brl(anuncio.metricas.gasto)}</b></span>
              <span>Resultados: <b className="tabular-nums">{inteiro(anuncio.metricas.resultados)}</b></span>
              <span>Por resultado: <b className="tabular-nums">{brl(anuncio.metricas.custo_por_resultado)}</b></span>
              <span>CTR saída: <b className="tabular-nums">{porcento(anuncio.metricas.ctr_saida)}</b></span>
            </div>
          ) : criativo.ad_id && conta.data ? (
            <p className="text-[12px] text-muted-foreground">O anúncio ligado não entregou nos últimos {DIAS_DO_RESULTADO} dias.</p>
          ) : !criativo.ad_id ? (
            <p className="text-[12px] text-muted-foreground">Sem anúncio ligado: ligue ao anúncio da Meta quando subir para acompanhar contra a meta.</p>
          ) : null}
          {veredito && <p className="mt-1.5 text-[12.5px] font-medium [overflow-wrap:anywhere]">{veredito}</p>}
          {angulo && (angulo.corte || angulo.hipotese) && (
            <div className="mt-2 space-y-1 border-t border-border pt-2 text-[12px] leading-snug [overflow-wrap:anywhere]">
              {angulo.hipotese && <p><span className="font-medium">Hipótese: </span>{angulo.hipotese}</p>}
              {angulo.corte && <p><span className="font-medium">Métrica que decide: </span>{angulo.corte.metrica}</p>}
              {angulo.corte && <p><span className="font-medium">Corte: </span>{angulo.corte.texto}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
