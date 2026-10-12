/**
 * Alertas da Conta ao vivo (12/10/2026, skills ads-monitor e ads-creative do claude-ads).
 *
 * Puro (sem Deno, banco ou rede), testado no Vitest. Lê o retrato da conta (ads_creative_daily já
 * somado por lerContaAoVivo) e devolve avisos com a prova em números. Nada é alterado na conta.
 *
 * Regras do claude-ads respeitadas:
 * - fadiga é tendência, não idade: frequência alta junto com o CTR caindo da 1ª para a 2ª metade da janela;
 * - nunca alertar com denominador trivial: cada alerta exige impressões, gasto ou resultados mínimos (C04);
 * - o número de corte não é universal: vem da camada 04 da memória (limites da rotina, editáveis por cliente);
 * - ROAS e custo máximo comparados com o que o negócio aguenta (C01), calculados em código.
 */
import type { ItemDaConta, Limites, RetratoDaConta } from "../rotina-trafego.ts";

export type NivelDoAlerta = "atencao" | "critico";
export type TipoDoAlerta = "fadiga" | "frequencia_alta" | "custo_subiu" | "custo_acima_do_maximo" | "roas_abaixo_do_equilibrio" | "coleta_parada" | "gasto_sem_resultado";

export type Alerta = {
  nivel: NivelDoAlerta;
  tipo: TipoDoAlerta;
  /** null = a conta toda. */
  alvo: { nivel: ItemDaConta["nivel"]; meta_id: string; nome: string } | null;
  titulo: string;
  texto: string;
  /** A camada da memória que sustenta o corte. */
  camada: "C01" | "C04" | "C07";
  prova: Record<string, number | string | null>;
};

export type EntradaDosAlertas = {
  retrato: RetratoDaConta;
  limites: Limites;
  /** Da memória (C01); null quando falta preencher. */
  custo_maximo_brl: number | null;
  roas_de_equilibrio: number | null;
  /** ROAS da conta no período (valor de compra / gasto), quando a Meta mediu valor. */
  roas_da_conta: number | null;
  horas_desde_a_coleta: number | null;
};

const pct = (v: number) => `${String(Math.round(v * 10) / 10).replace(".", ",")}%`;
const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const ativo = (i: ItemDaConta) => String(i.status ?? "").toUpperCase() === "ACTIVE";

export function alertasDaConta(e: EntradaDosAlertas): Alerta[] {
  const L = e.limites;
  const saida: Alerta[] = [];

  if (e.horas_desde_a_coleta !== null && e.horas_desde_a_coleta > 6) {
    saida.push({
      nivel: e.horas_desde_a_coleta > 24 ? "critico" : "atencao", tipo: "coleta_parada", alvo: null, camada: "C07",
      titulo: "Os números estão velhos",
      texto: `A última coleta da Meta foi há ${e.horas_desde_a_coleta} h. Sincronize antes de decidir qualquer coisa.`,
      prova: { horas_desde_a_coleta: e.horas_desde_a_coleta },
    });
  }

  for (const i of e.retrato.itens.filter((x) => x.nivel === "anuncio" && ativo(x))) {
    const alvo = { nivel: i.nivel, meta_id: i.meta_id, nome: i.nome };
    const volume = i.impressoes >= L.impressoes_minimas;
    // Fadiga: frequência alta E o CTR caindo (tendência), com impressões suficientes.
    if (volume && i.frequencia !== null && i.frequencia >= L.frequencia_maxima) {
      const caiu = i.ctr_var_pct !== null && i.ctr_var_pct <= -L.queda_ctr_pct;
      saida.push({
        nivel: caiu ? "critico" : "atencao", tipo: caiu ? "fadiga" : "frequencia_alta", alvo, camada: "C04",
        titulo: caiu ? "Criativo cansado" : "Frequência alta",
        texto: caiu
          ? `Frequência ${String(i.frequencia).replace(".", ",")} e o CTR caiu ${pct(-(i.ctr_var_pct as number))} da primeira para a segunda metade do período. Hora de trocar o criativo ou abrir público.`
          : `Frequência ${String(i.frequencia).replace(".", ",")} (alerta a partir de ${String(L.frequencia_maxima).replace(".", ",")}). O CTR ainda não caiu: acompanhar.`,
        prova: { frequencia: i.frequencia, ctr_var_pct: i.ctr_var_pct, impressoes: i.impressoes, frequencia_maxima: L.frequencia_maxima, queda_ctr_pct: L.queda_ctr_pct },
      });
    }
    // Custo subindo: com resultados e gasto mínimos, para não alertar com denominador pequeno.
    const comVolume = i.resultados >= L.resultados_min_para_custo && i.gasto >= L.gasto_minimo_brl;
    if (comVolume && i.custo_var_pct !== null && i.custo_var_pct >= L.alta_custo_pct) {
      saida.push({
        nivel: "atencao", tipo: "custo_subiu", alvo, camada: "C04",
        titulo: "Custo por resultado subindo",
        texto: `${i.resultado_rotulo}: o custo subiu ${pct(i.custo_var_pct)} da primeira para a segunda metade do período${i.custo_por_resultado !== null ? ` (hoje ${reais(i.custo_por_resultado)} cada)` : ""}.`,
        prova: { custo_var_pct: i.custo_var_pct, custo_por_resultado: i.custo_por_resultado, resultados: i.resultados, gasto: i.gasto, alta_custo_pct: L.alta_custo_pct },
      });
    }
    // Acima do custo máximo do negócio (C01): o anúncio dá prejuízo por resultado.
    if (comVolume && e.custo_maximo_brl !== null && i.custo_por_resultado !== null && i.custo_por_resultado > e.custo_maximo_brl) {
      saida.push({
        nivel: i.custo_por_resultado > e.custo_maximo_brl * L.multiplo_custo_alto ? "critico" : "atencao", tipo: "custo_acima_do_maximo", alvo, camada: "C01",
        titulo: "Acima do custo máximo",
        texto: `${reais(i.custo_por_resultado)} por resultado, acima do custo máximo de ${reais(e.custo_maximo_brl)} que o negócio aguenta (ticket x margem).`,
        prova: { custo_por_resultado: i.custo_por_resultado, custo_maximo_brl: e.custo_maximo_brl, resultados: i.resultados },
      });
    }
    // Gastou o bastante sem nenhum resultado (regra da rotina, mostrada antes de ela agir).
    if (i.resultados === 0 && L.custo_alvo_brl !== null && i.gasto >= L.custo_alvo_brl * L.multiplo_sem_resultado && i.dias_com_gasto >= L.dias_aprendizado) {
      saida.push({
        nivel: "critico", tipo: "gasto_sem_resultado", alvo, camada: "C04",
        titulo: "Gasto sem resultado",
        texto: `Gastou ${reais(i.gasto)} sem nenhum resultado (${String(L.multiplo_sem_resultado).replace(".", ",")} vezes o custo-alvo de ${reais(L.custo_alvo_brl)}).`,
        prova: { gasto: i.gasto, custo_alvo_brl: L.custo_alvo_brl, dias_com_gasto: i.dias_com_gasto },
      });
    }
  }

  if (e.roas_da_conta !== null && e.roas_de_equilibrio !== null && e.retrato.totais.gasto >= L.gasto_minimo_brl * 3 && e.roas_da_conta < e.roas_de_equilibrio) {
    saida.push({
      nivel: "critico", tipo: "roas_abaixo_do_equilibrio", alvo: null, camada: "C01",
      titulo: "ROAS abaixo do equilíbrio",
      texto: `O ROAS da conta no período é ${String(e.roas_da_conta).replace(".", ",")}, abaixo do equilíbrio de ${String(e.roas_de_equilibrio).replace(".", ",")} (1 / margem). Cada venda pelo anúncio está dando prejuízo na primeira compra.`,
      prova: { roas_da_conta: e.roas_da_conta, roas_de_equilibrio: e.roas_de_equilibrio, gasto: e.retrato.totais.gasto },
    });
  }

  const peso = (a: Alerta) => (a.nivel === "critico" ? 0 : 1);
  return saida.sort((a, b) => peso(a) - peso(b)).slice(0, 30);
}
