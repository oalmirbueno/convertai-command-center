import { faseDaEtapa, faseNaData, normalizarLinhaDoTempo, type LinhaDoTempo } from "../../agente-calendario/modulos/linha-do-tempo.ts";
import { normalizarRoteiroDeVideo } from "../../agente-calendario/modulos/roteiro-de-video.ts";

/**
 * A campanha no roteiro da peça (22/10/2026, dono: "no vídeo, gravar: ele monta o roteiro com base no tema
 * da campanha"). Com campanha_id, o roteirista lê o briefing (oferta, público, tom, CTA, provas e produtos),
 * a fase da linha do tempo em que a peça cai e o que a peça já tem na série (gancho, cenas, CTA e o
 * roteiro_video do agente da campanha). A peça é achada na série pela tarefa da agenda ou pelo tema_id.
 * Puro (a função e os testes importam o mesmo). Sem lookbehind, sem classe Unicode e sem grupo nomeado.
 */

type Objeto = Record<string, unknown>;

const obj = (v: unknown): Objeto => (v && typeof v === "object" && !Array.isArray(v) ? (v as Objeto) : {});
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ouNulo = (v: unknown, max: number) => txt(v, max) || null;

/** O item da série (calendario_propostas.itens) desta peça: pela tarefa da agenda e, sem ela, pelo tema_id. */
export function itemDaPecaNaSerie(itens: unknown, peca: { taskId?: string | null; temaId?: string | null }): Objeto | null {
  const lista = (Array.isArray(itens) ? itens : []).map(obj);
  if (peca.taskId) {
    const pelaTarefa = lista.filter((x) => x.task_id === peca.taskId)[0];
    if (pelaTarefa) return pelaTarefa;
  }
  if (peca.temaId) return lista.filter((x) => x.tema_id === peca.temaId)[0] || null;
  return null;
}

/** A fase da linha do tempo da peça: pela data (dentro da janela) e, fora dela, pela etapa escrita. */
export function faseDaPecaNaLinha(linha: LinhaDoTempo | null, peca: Objeto | null) {
  if (!peca) return null;
  const etapa = txt(peca.etapa, 80);
  if (linha) {
    const data = txt(peca.data, 10);
    const pelaEtapa = faseDaEtapa(etapa);
    const f = (data ? faseNaData(linha, data) : null) || (pelaEtapa ? linha.fases.filter((x) => x.fase === pelaEtapa)[0] || null : null);
    if (f) return { nome: f.nome, etapa: f.etapa, papel: f.papel, inicio: f.inicio, fim: f.fim };
  }
  return etapa ? { nome: etapa, etapa, papel: null, inicio: null, fim: null } : null;
}

/** O bloco "campanha" dos DADOS do roteirista (o briefing só com o que tem; a peça só quando foi achada). */
export function campanhaParaORoteiro(campanha: Objeto, peca: Objeto | null) {
  const b = obj(campanha.briefing);
  const produtos = (Array.isArray(b.produtos) ? b.produtos : [])
    .map(obj)
    .map((p) => ({ nome: txt(p.nome, 120), por_que: ouNulo(p.por_que, 300), preco: ouNulo(p.preco, 40), preco_promocional: ouNulo(p.preco_promocional, 40) }))
    .filter((p) => p.nome)
    .slice(0, 6);
  const provas = (Array.isArray(b.provas) ? b.provas : []).map((p) => txt(p, 300)).filter(Boolean).slice(0, 6);
  const briefing = {
    oferta: ouNulo(b.oferta, 600),
    mensagem_central: ouNulo(b.mensagem_central, 400),
    publico: ouNulo(b.publico, 600),
    tom: ouNulo(b.tom, 300) || ouNulo(b.tom_da_campanha, 300),
    cta: ouNulo(b.cta, 200),
    provas: provas.length ? provas : null,
    produtos: produtos.length ? produtos : null,
  };
  const temBriefing = Object.keys(briefing).some((k) => (briefing as Objeto)[k] !== null);
  const roteiroDaSerie = peca ? normalizarRoteiroDeVideo(peca.roteiro_video) : null;
  return {
    nome: campanha.nome ?? null,
    objetivo: campanha.objetivo ?? null,
    conceito: campanha.conceito ?? null,
    pedido: campanha.pedido ?? null,
    periodo: [campanha.periodo_inicio ?? null, campanha.periodo_fim ?? null],
    briefing: temBriefing ? briefing : null,
    fase_da_peca: faseDaPecaNaLinha(normalizarLinhaDoTempo(b.linha_do_tempo), peca),
    peca_na_serie: peca
      ? {
        tema: ouNulo(peca.tema, 300),
        data: ouNulo(peca.data, 10),
        gancho: ouNulo(peca.gancho, 300),
        resumo: ouNulo(peca.resumo, 600),
        cta: ouNulo(peca.cta, 200),
        roteiro_video: roteiroDaSerie
          ? { gancho: roteiroDaSerie.gancho, cenas: roteiroDaSerie.cenas.map((c) => ({ descricao: c.descricao, fala: c.fala, texto_na_tela: c.texto_na_tela, segundos: c.segundos })), duracao: roteiroDaSerie.duracao, cta: roteiroDaSerie.cta }
          : null,
      }
      : null,
  };
}
