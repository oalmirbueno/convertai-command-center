/**
 * Auditoria da conta Meta (12/10/2026), a partir do checklist do claude-ads 2.0 (ads-audit, ads-meta,
 * ads-creative, ads-monitor), adaptado ao que o painel mede.
 *
 * Puro (sem Deno, banco ou rede), testado no Vitest. Quem lê a conta e grava é o index.ts.
 *
 * Contrato do claude-ads mantido:
 * - cada controle sai como passou, falhou, sem dado ou não se aplica; "sem dado" nunca vira falha;
 * - peso por severidade: crítico 5, alto 3, médio 1 (informativo não pontua);
 * - saúde da categoria = 100 x peso que passou / peso conhecido;
 *   cobertura = 100 x peso conhecido / peso aplicável;
 *   nota da conta = soma(saúde x peso da categoria), renormalizando sem as categorias sem dado;
 * - cobertura de 80% ou mais: nota valendo; 60 a 80: provisória; abaixo de 60: sem nota (dado insuficiente);
 * - controle crítico sem dado entra sempre nas prioridades;
 * - uma causa, um controle (falha de medição não penaliza de novo cada sintoma).
 * Os números de corte vêm da camada 04 da memória (limites da rotina), nunca de um padrão universal.
 */
import type { Alerta } from "./alertas-da-conta.ts";
import type { Limites, RetratoDaConta } from "../rotina-trafego.ts";

export type Resultado = "passou" | "falhou" | "sem_dado" | "nao_se_aplica";
export type Severidade = "critico" | "alto" | "medio" | "informativo";
export type Categoria = "medicao" | "criativo" | "estrutura" | "publicos" | "entrega" | "politica";

export const PESO_DA_SEVERIDADE: Record<Severidade, number> = { critico: 5, alto: 3, medio: 1, informativo: 0 };
/** Pesos de referência da Meta no claude-ads (lá desligados por padrão; aqui assumidos pela casa e somando 100). */
export const PESO_DA_CATEGORIA: Record<Categoria, number> = { medicao: 25, criativo: 25, estrutura: 20, publicos: 15, entrega: 10, politica: 5 };
export const ROTULO_DA_CATEGORIA: Record<Categoria, string> = { medicao: "Medição", criativo: "Criativo", estrutura: "Estrutura e verba", publicos: "Públicos", entrega: "Entrega", politica: "Política" };

export type Controle = {
  id: string;
  categoria: Categoria;
  nome: string;
  severidade: Severidade;
  resultado: Resultado;
  /** Por que deu este resultado, com o número. */
  evidencia: string;
  /** O que fazer quando falhou ou está sem dado. */
  acao: string | null;
};

export type AnuncioAuditado = {
  ad_id: string;
  nome: string | null;
  status: string | null;
  formato: string | null;
  peca: string | null;
  gasto: number;
  impressoes: number;
  resultados: number;
  ctr_saida_pct: number | null;
};

export type EntradaDaAuditoria = {
  conectada: boolean;
  retrato: RetratoDaConta;
  anuncios: AnuncioAuditado[];
  limites: Limites;
  /** Memória C01 e C03. */
  financas: { custo_maximo_brl: number | null; faltando: string[] };
  confiabilidade: { pixel: string; api_de_conversoes: string; evento_principal: string };
  /** Alertas já calculados (fadiga etc.) para não julgar de novo o mesmo sintoma. */
  alertas: Alerta[];
  mix_alertas: string[];
  horas_desde_a_coleta: number | null;
  /** Ações da Meta vistas na conta (tipos de action_type), para saber se há evento de conversão chegando. */
  tipos_de_acao_vistos: string[];
};

const ativo = (s: string | null) => String(s ?? "").toUpperCase() === "ACTIVE";
const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const n1 = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");

export function controlesDaConta(e: EntradaDaAuditoria): Controle[] {
  const L = e.limites;
  const c: Controle[] = [];
  const add = (x: Controle) => c.push(x);
  const ativos = e.anuncios.filter((a) => ativo(a.status));
  const conversaoVista = e.tipos_de_acao_vistos.some((t) => /offsite_conversion\.fb_pixel|purchase|lead|onsite_conversion\.messaging|complete_registration/.test(t));

  // ---- medição
  const sit = (s: string): Resultado => (s === "ok" ? "passou" : s === "com_problema" || s === "nao_tem" ? "falhou" : "sem_dado");
  add({
    id: "M01", categoria: "medicao", nome: "Pixel instalado e recebendo eventos", severidade: "critico",
    resultado: e.confiabilidade.pixel === "nao_sei" ? (conversaoVista ? "passou" : "sem_dado") : sit(e.confiabilidade.pixel),
    evidencia: e.confiabilidade.pixel !== "nao_sei" ? `Memória da conta (C03): pixel ${e.confiabilidade.pixel.replace("_", " ")}.` : conversaoVista ? "Há eventos de conversão chegando nos números da Meta." : "Ninguém conferiu o pixel e nenhum evento de conversão apareceu nos números.",
    acao: "Conferir o pixel no Gerenciador de Eventos e registrar na memória da conta (C03).",
  });
  add({
    id: "M02", categoria: "medicao", nome: "API de Conversões", severidade: "alto",
    resultado: sit(e.confiabilidade.api_de_conversoes),
    evidencia: `Memória da conta (C03): ${e.confiabilidade.api_de_conversoes === "nao_sei" ? "não conferida" : e.confiabilidade.api_de_conversoes.replace("_", " ")}.`,
    acao: "Ativar a API de Conversões (ou o gateway) e conferir a deduplicação com o pixel.",
  });
  add({
    id: "M07", categoria: "medicao", nome: "Evento principal definido", severidade: "medio",
    resultado: e.confiabilidade.evento_principal ? "passou" : "sem_dado",
    evidencia: e.confiabilidade.evento_principal ? `Evento principal: ${e.confiabilidade.evento_principal}.` : "Evento principal não registrado na memória.",
    acao: "Registrar na memória (C03) qual evento conta como resultado.",
  });
  add({
    id: "M10", categoria: "medicao", nome: "Dados atualizados", severidade: "alto",
    resultado: e.horas_desde_a_coleta === null ? "sem_dado" : e.horas_desde_a_coleta <= 6 ? "passou" : "falhou",
    evidencia: e.horas_desde_a_coleta === null ? "Nenhuma coleta registrada." : `Última coleta há ${e.horas_desde_a_coleta} h.`,
    acao: "Sincronizar a conta e conferir a conexão da Meta no cadastro do cliente.",
  });
  add({
    id: "F01", categoria: "medicao", nome: "Economia definida (custo máximo)", severidade: "alto",
    resultado: e.financas.custo_maximo_brl !== null ? "passou" : "falhou",
    evidencia: e.financas.custo_maximo_brl !== null ? `Custo máximo calculado: ${reais(e.financas.custo_maximo_brl)}.` : `Falta: ${e.financas.faltando.join(", ") || "finanças"}. Sem isso nenhuma decisão de verba tem régua.`,
    acao: "Preencher ticket médio e margem na memória da conta (C01).",
  });

  // ---- criativo
  const formatos = new Set(ativos.map((a) => a.formato).filter(Boolean));
  add({
    id: "M25", categoria: "criativo", nome: "Diversidade de formato", severidade: "medio",
    resultado: ativos.length < 3 ? "nao_se_aplica" : formatos.size >= 2 ? "passou" : "falhou",
    evidencia: ativos.length < 3 ? `Só ${ativos.length} anúncio(s) ativo(s).` : `${ativos.length} anúncios ativos em ${formatos.size} formato(s): ${[...formatos].join(", ") || "sem formato lido"}.`,
    acao: "Ter imagem e vídeo rodando juntos: a Meta entrega cada um para públicos diferentes.",
  });
  const pecas = new Set(ativos.map((a) => a.peca || a.ad_id));
  add({
    id: "M26", categoria: "criativo", nome: "Conceitos diferentes (não só redimensionar)", severidade: "medio",
    resultado: ativos.length < 3 ? "nao_se_aplica" : pecas.size >= 3 ? "passou" : "falhou",
    evidencia: ativos.length < 3 ? `Só ${ativos.length} anúncio(s) ativo(s).` : `${pecas.size} peça(s) diferente(s) entre ${ativos.length} anúncios ativos (a mesma arte em vários tamanhos conta uma vez).`,
    acao: "Subir pelo menos 3 ângulos diferentes (dor, prova, oferta), não a mesma arte em outro tamanho.",
  });
  const fadigados = e.alertas.filter((a) => a.tipo === "fadiga");
  const comFrequencia = e.retrato.itens.filter((i) => i.nivel === "anuncio" && ativo(i.status) && i.frequencia !== null && i.impressoes >= L.impressoes_minimas);
  add({
    id: "M28", categoria: "criativo", nome: "Sem criativo cansado", severidade: "alto",
    resultado: comFrequencia.length === 0 ? "sem_dado" : fadigados.length ? "falhou" : "passou",
    evidencia: comFrequencia.length === 0 ? "Nenhum anúncio ativo com volume para ler a tendência." : fadigados.length ? `${fadigados.length} anúncio(s) com frequência alta e CTR caindo: ${fadigados.slice(0, 3).map((a) => a.alvo?.nome).join("; ")}.` : `${comFrequencia.length} anúncio(s) com volume, nenhum com fadiga (frequência a partir de ${n1(L.frequencia_maxima)} e queda de CTR de ${n1(L.queda_ctr_pct)}%).`,
    acao: "Trocar o criativo cansado pelo próximo do acervo ou abrir o público.",
  });
  const comCtr = ativos.filter((a) => a.impressoes >= L.impressoes_minimas && a.ctr_saida_pct !== null);
  const ctrBaixo = comCtr.filter((a) => (a.ctr_saida_pct as number) < L.ctr_minimo_pct);
  add({
    id: "M-CR4", categoria: "criativo", nome: "CTR de link acima do mínimo", severidade: "medio",
    resultado: comCtr.length === 0 ? "sem_dado" : ctrBaixo.length ? "falhou" : "passou",
    evidencia: comCtr.length === 0 ? "Nenhum anúncio ativo com impressões suficientes." : ctrBaixo.length ? `${ctrBaixo.length} de ${comCtr.length} anúncio(s) abaixo de ${n1(L.ctr_minimo_pct)}%: ${ctrBaixo.slice(0, 3).map((a) => a.nome).join("; ")}.` : `Todos os ${comCtr.length} acima de ${n1(L.ctr_minimo_pct)}%.`,
    acao: "Rever o gancho dos 3 primeiros segundos e a primeira linha do texto dos anúncios com CTR baixo.",
  });

  // ---- estrutura e verba
  const conjuntosAtivos = e.retrato.itens.filter((i) => i.nivel === "conjunto" && ativo(i.status));
  const magros = conjuntosAtivos.filter((i) => i.gasto < L.gasto_minimo_brl);
  add({
    id: "M11", categoria: "estrutura", nome: "Verba sem fragmentar demais", severidade: "medio",
    resultado: conjuntosAtivos.length < 2 ? "nao_se_aplica" : magros.length / conjuntosAtivos.length > 0.5 ? "falhou" : "passou",
    evidencia: conjuntosAtivos.length < 2 ? `${conjuntosAtivos.length} conjunto(s) ativo(s).` : `${magros.length} de ${conjuntosAtivos.length} conjuntos ativos gastaram menos de ${reais(L.gasto_minimo_brl)} no período.`,
    acao: "Juntar conjuntos parecidos: verba picada não sai da fase de aprendizado.",
  });
  const alvo = L.custo_alvo_brl;
  const campanhasAtivas = e.retrato.itens.filter((i) => i.nivel === "campanha" && ativo(i.status) && i.orcamento_diario_brl !== null);
  const curtas = alvo !== null ? campanhasAtivas.filter((i) => (i.orcamento_diario_brl as number) < alvo) : [];
  add({
    id: "M-ST1", categoria: "estrutura", nome: "Verba diária cabe pelo menos um resultado", severidade: "alto",
    resultado: alvo === null || campanhasAtivas.length === 0 ? "sem_dado" : curtas.length ? "falhou" : "passou",
    evidencia: alvo === null ? "Sem custo-alvo definido (C01 ou C04)." : campanhasAtivas.length === 0 ? "Nenhuma campanha ativa com verba diária lida." : curtas.length ? `${curtas.length} campanha(s) com verba diária abaixo do custo-alvo de ${reais(alvo)}: ${curtas.slice(0, 3).map((i) => `${i.nome} (${reais(i.orcamento_diario_brl as number)})`).join("; ")}.` : `Todas as ${campanhasAtivas.length} campanhas ativas com verba diária de pelo menos ${reais(alvo)}.`,
    acao: "Subir a verba diária para pelo menos um custo-alvo, ou juntar campanhas.",
  });
  add({
    id: "M18", categoria: "estrutura", nome: "Objetivo alinhado com a venda", severidade: "alto",
    resultado: e.retrato.totais.gasto === 0 ? "sem_dado" : e.mix_alertas.length ? "falhou" : "passou",
    evidencia: e.retrato.totais.gasto === 0 ? "Sem gasto no período." : e.mix_alertas.length ? e.mix_alertas[0] : "O investimento está em objetivos perto da venda (mensagem, cadastro ou compra).",
    acao: "Trocar o objetivo da campanha principal para mensagem, cadastro ou compra, conforme o negócio vende.",
  });
  const semResultado = e.alertas.filter((a) => a.tipo === "gasto_sem_resultado");
  add({
    id: "M-ST3", categoria: "estrutura", nome: "Sem gasto parado sem resultado", severidade: "alto",
    resultado: alvo === null ? "sem_dado" : semResultado.length ? "falhou" : "passou",
    evidencia: alvo === null ? "Sem custo-alvo para medir." : semResultado.length ? `${semResultado.length} anúncio(s) gastaram ${n1(L.multiplo_sem_resultado)} vezes o custo-alvo sem resultado.` : "Nenhum anúncio ativo queimando verba sem resultado.",
    acao: "Pausar ou trocar o criativo dos anúncios sem resultado (a rotina pode fazer com Confirmar).",
  });

  // ---- públicos e entrega: o painel ainda não lê (sobreposição, lookalike, posicionamentos)
  add({ id: "M19", categoria: "publicos", nome: "Sobreposição de públicos", severidade: "medio", resultado: "sem_dado", evidencia: "O painel ainda não lê a sobreposição de públicos da Meta.", acao: "Conferir na ferramenta de sobreposição do Gerenciador." });
  add({ id: "M23", categoria: "publicos", nome: "Públicos de exclusão (quem já comprou)", severidade: "medio", resultado: "sem_dado", evidencia: "O painel ainda não lê as exclusões dos conjuntos.", acao: "Excluir clientes atuais das campanhas de aquisição." });
  add({ id: "M34", categoria: "entrega", nome: "Desempenho por posicionamento", severidade: "medio", resultado: "sem_dado", evidencia: "Use Métricas da Meta com o recorte por posicionamento.", acao: null });

  // ---- política
  const reprovados = e.anuncios.filter((a) => /DISAPPROVED|WITH_ISSUES/i.test(String(a.status ?? "")));
  add({
    id: "P01", categoria: "politica", nome: "Sem anúncio reprovado", severidade: "critico",
    resultado: e.anuncios.length === 0 ? "sem_dado" : reprovados.length ? "falhou" : "passou",
    evidencia: reprovados.length ? `${reprovados.length} anúncio(s) reprovado(s) ou com problema: ${reprovados.slice(0, 3).map((a) => a.nome).join("; ")}.` : `${e.anuncios.length} anúncio(s) lidos, nenhum reprovado.`,
    acao: "Abrir o motivo da reprovação no Gerenciador e corrigir texto ou arte.",
  });

  return c;
}

export type NotaDaAuditoria = {
  /** null quando a cobertura não chega a 60% (dado insuficiente para dar nota). */
  nota: number | null;
  cobertura: number;
  faixa: "valendo" | "provisoria" | "dado_insuficiente";
  categorias: { categoria: Categoria; rotulo: string; saude: number | null; cobertura: number; peso: number }[];
  prioridades: Controle[];
};

export function notaDaAuditoria(controles: Controle[]): NotaDaAuditoria {
  const cats = (Object.keys(PESO_DA_CATEGORIA) as Categoria[]).map((cat) => {
    const doCat = controles.filter((x) => x.categoria === cat && x.resultado !== "nao_se_aplica");
    const aplicavel = doCat.reduce((s, x) => s + PESO_DA_SEVERIDADE[x.severidade], 0);
    const conhecidos = doCat.filter((x) => x.resultado === "passou" || x.resultado === "falhou");
    const pesoConhecido = conhecidos.reduce((s, x) => s + PESO_DA_SEVERIDADE[x.severidade], 0);
    const pesoPassou = conhecidos.filter((x) => x.resultado === "passou").reduce((s, x) => s + PESO_DA_SEVERIDADE[x.severidade], 0);
    return {
      categoria: cat,
      rotulo: ROTULO_DA_CATEGORIA[cat],
      saude: pesoConhecido > 0 ? Math.round((100 * pesoPassou) / pesoConhecido) : null,
      cobertura: aplicavel > 0 ? Math.round((100 * pesoConhecido) / aplicavel) : 0,
      peso: PESO_DA_CATEGORIA[cat],
      _aplicavel: aplicavel,
      _conhecido: pesoConhecido,
    };
  });
  const comNota = cats.filter((x) => x.saude !== null);
  const somaPesos = comNota.reduce((s, x) => s + x.peso, 0);
  const notaBruta = somaPesos > 0 ? comNota.reduce((s, x) => s + (x.saude as number) * x.peso, 0) / somaPesos : null;
  const aplicavelTotal = cats.reduce((s, x) => s + x._aplicavel, 0);
  const conhecidoTotal = cats.reduce((s, x) => s + x._conhecido, 0);
  const cobertura = aplicavelTotal > 0 ? Math.round((100 * conhecidoTotal) / aplicavelTotal) : 0;
  const faixa = cobertura >= 80 ? "valendo" : cobertura >= 60 ? "provisoria" : "dado_insuficiente";
  const ordem: Record<Severidade, number> = { critico: 0, alto: 1, medio: 2, informativo: 3 };
  const prioridades = controles
    .filter((x) => x.resultado === "falhou" || (x.resultado === "sem_dado" && x.severidade === "critico"))
    .sort((a, b) => ordem[a.severidade] - ordem[b.severidade] || Number(a.resultado === "sem_dado") - Number(b.resultado === "sem_dado"));
  return {
    nota: faixa === "dado_insuficiente" || notaBruta === null ? null : Math.round(notaBruta),
    cobertura,
    faixa,
    categorias: cats.map(({ _aplicavel: _a, _conhecido: _c, ...x }) => x),
    prioridades,
  };
}
