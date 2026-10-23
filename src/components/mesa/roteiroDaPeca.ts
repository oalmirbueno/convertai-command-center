import type { ItemProposto, Campanha } from "./mesaV4Api";
import { linhaDaCampanha } from "./CampanhaLinhaDoTempo";
import { indiceDaFase } from "./areasDaCampanha";
import { useRoteiros, type PedidoDeGeracao } from "@/components/mesa-roteiros/roteirosApi";
import { modoDoTipo, versaoPorNumero, type LinhaDoRoteiro, type Roteiro, type VersaoDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import { normalizarRoteiroDeVideo, type RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import {
  linhaDaPeca,
  tipoDoEstilo,
  versoesAntigasDaPeca,
  type CriatividadeDoRoteiro,
  type EstiloDoRoteiro,
  type VersaoAntigaDaPeca,
} from "../../../supabase/functions/mesa-roteiros/modulos/roteiro-da-peca";

/**
 * O roteiro da peça de vídeo da campanha, um só (agente unificado, 23/10/2026; dono: "pode juntar os dois em um
 * só"). A fonte de verdade é a tabela roteiros (mesa-roteiros): versões, conversa do agente com Confirmar e
 * Desfazer, PDF e Word. O item da série guarda só as cenas de IA do caminho Gerar (roteiro_video), que saem do
 * roteiro. Peça que só tinha roteiro no item (o agente antigo da aba Roteiro e o "Gerar o roteiro") aparece
 * pela migração na leitura (versoesAntigasDaPeca) e entra na tabela na primeira ação (peca_importar).
 * Puro, mais o hook que junta a lista de roteiros do cliente com a peça.
 */

const roteiroDaSerie = (item: ItemProposto): RoteiroDeVideo | null => normalizarRoteiroDeVideo((item as ItemProposto & { roteiro_video?: unknown }).roteiro_video);

/** O roteiro já feito desta peça: o da tarefa da agenda; fora dela, o da campanha (ou da série) com o título do tema. */
export function roteiroDaPecaDaCampanha(lista: LinhaDoRoteiro[], p: { campanhaId: string; propostaId?: string | null; item: ItemProposto }): LinhaDoRoteiro | null {
  return linhaDaPeca(lista, { taskId: p.item.task_id || null, campanhaId: p.campanhaId, propostaId: p.propostaId || null, tema: String(p.item.tema || "") });
}

/** O pedido ao roteirista com o que a peça já tem: fase, gancho, resumo, cenas e CTA do roteiro da série. */
export function pedidoDaPecaDaCampanha(campanha: Campanha, item: ItemProposto): string {
  const linha = linhaDaCampanha(campanha);
  const k = linha ? indiceDaFase(linha.fases, item) : -1;
  const fase = linha && k >= 0 ? linha.fases[k] : null;
  const rv = roteiroDaSerie(item);
  const cenas = rv
    ? rv.cenas.map((c, i) => `${i + 1}) ${c.descricao}${c.fala ? ` | fala: ${c.fala}` : ""}${c.texto_na_tela ? ` | na tela: ${c.texto_na_tela}` : ""} (${c.segundos} s)`).join("; ")
    : "";
  const cta = (rv && rv.cta) || item.cta || "";
  return [
    `Peça de vídeo da campanha "${campanha.nome}".`,
    fase ? `Fase da linha do tempo: ${fase.nome} (${fase.inicio} a ${fase.fim}), ${fase.papel}.` : item.etapa ? `Fase: ${item.etapa}.` : "",
    item.gancho ? `Gancho da série: ${item.gancho}` : "",
    item.resumo ? `Resumo da peça: ${item.resumo}` : "",
    rv && rv.gancho && rv.gancho !== item.gancho ? `Gancho do roteiro da série: ${rv.gancho}` : "",
    cenas ? `Cenas do roteiro da série: ${cenas}` : "",
    cta ? `CTA: ${cta}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

/** O que a pessoa escolhe no criar: a ideia, a duração (até 5 min), o estilo e a criatividade. */
export interface DirecaoDoCriar {
  ideia: string;
  duracao: number;
  estilo: EstiloDoRoteiro;
  criatividade: CriatividadeDoRoteiro;
}

/** O corpo do peca_gerar desta peça (2 versões, o Jev escolhe). O tipo do roteiro sai do estilo. */
export function corpoDoRoteiroDaPeca(p: { clientId: string; campanha: Campanha; item: ItemProposto; modeloId?: string | null; roteiroId?: string | null; direcao?: Partial<DirecaoDoCriar> }): PedidoDeGeracao {
  const rv = roteiroDaSerie(p.item);
  const d = p.direcao || {};
  return {
    client_id: p.clientId,
    task_id: p.item.task_id || null,
    tipo: tipoDoEstilo(d.estilo),
    duracao_s: d.duracao || (rv && rv.duracao ? rv.duracao : 30),
    objetivo: String(p.item.objetivo || p.campanha.objetivo || "").slice(0, 300) || undefined,
    pedido: pedidoDaPecaDaCampanha(p.campanha, p.item),
    tema: String(p.item.tema || p.item.titulo || "Vídeo da campanha").slice(0, 300),
    modelo_id: p.modeloId || null,
    campanha_id: p.campanha.id,
    tema_id: p.item.tema_id || null,
    ...(p.roteiroId ? { roteiro_id: p.roteiroId } : {}),
    ...(d.ideia !== undefined ? { ideia: String(d.ideia || "").trim().slice(0, 1200) } : {}),
    ...(d.estilo ? { estilo: d.estilo } : {}),
    ...(d.criatividade ? { criatividade: d.criatividade } : {}),
  };
}

/** O roteiro em texto com títulos (# e ##), para o documento Word. */
export function textoDoRoteiro(r: Roteiro): string {
  const linhas: string[] = [`# ${r.titulo || "Roteiro"}`];
  if (r.subtitulo) linhas.push(r.subtitulo);
  linhas.push(`${modoDoTipo(r.tipo).rotulo} · ${r.duracao_alvo_s} s${r.objetivo ? ` · ${r.objetivo}` : ""}`, "");
  if (r.ganchos.length) {
    linhas.push("## Ganchos");
    r.ganchos.forEach((g, i) => linhas.push(`${i + 1}. ${g.texto}${i === r.gancho_escolhido ? " (escolhido)" : ""}`));
    linhas.push("");
  }
  linhas.push("## Roteiro");
  r.blocos.forEach((b, i) => {
    linhas.push(`### ${i + 1}. ${b.funcao || "Bloco"} (${b.segundos} s)`);
    if (b.fala) linhas.push(`Fala: ${b.fala}`);
    if (b.visual) linhas.push(`Visual: ${b.visual}`);
    if (b.texto_na_tela) linhas.push(`Texto na tela: ${b.texto_na_tela}`);
    if (b.broll) linhas.push(`B-roll: ${b.broll}`);
  });
  linhas.push("");
  const d = r.direcao;
  const direcao = ([["Enquadramento", d.enquadramento], ["Ambiente", d.ambiente], ["Figurino", d.figurino], ["Objetos", d.objetos], ["Luz", d.luz], ["Câmera", d.camera]] as const).filter(([, v]) => !!v);
  if (direcao.length || d.orientacoes.length) {
    linhas.push("## Direção de gravação", ...direcao.map(([k, v]) => `${k}: ${v}`), ...d.orientacoes.map((o) => `- ${o}`), "");
  }
  if (r.broll.length) linhas.push("## B-roll", ...r.broll.map((b) => `- ${b}`), "");
  if (r.cta) linhas.push("## CTA", r.cta, "");
  if (r.legenda) linhas.push("## Legenda", ...r.legenda.split("\n"), "");
  if (r.hashtags.length) linhas.push("## Hashtags", r.hashtags.join(" "), "");
  if (r.pendencias.length) linhas.push("## Confirmar antes de gravar", ...r.pendencias.map((p) => `- ${p}`), "");
  return linhas.join("\n");
}

/** "Escolhida pelo Jev. Versão 2 (gancho de erro), viral 78 contra 64." da versão atual, quando houve escolha. */
export function escolhaDaVersao(linha: LinhaDoRoteiro | null): { porque: string; outra: number | null } | null {
  if (!linha) return null;
  const v = versaoPorNumero(linha.versoes, linha.versao_atual);
  const nota = v && v.nota ? v.nota : "";
  if (nota.indexOf("Escolhida pelo Jev.") !== 0) return null;
  const outra = linha.versoes.filter((x) => x.numero < linha.versao_atual && (x.nota || "").indexOf("(o Jev escolheu a outra)") >= 0).map((x) => x.numero).pop();
  return { porque: nota.slice("Escolhida pelo Jev.".length).trim(), outra: outra == null ? null : outra };
}

/** O nome do arquivo Word (sem acento, só letras, números e hífen). */
export function nomeDoWord(titulo: string): string {
  const base = String(titulo || "video").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `roteiro-${base || "video"}`;
}

/** Baixa o roteiro em PDF (o mesmo documento da Mesa Roteiros) ou em Word. Linha: a versão atual com o status. */
export async function baixarRoteiro(tipo: "pdf" | "docx", p: { roteiro: Roteiro; linha: LinhaDoRoteiro | null; cliente: string; tema: string }) {
  if (tipo === "pdf") {
    const { baixarBytes, itemDoPdf, itemSolto, montarPdf } = await import("@/components/mesa-roteiros/pdfNoNavegador");
    const doc = (p.linha && itemDoPdf(p.linha, false)) || itemSolto(p.roteiro);
    const { bytes, nome } = montarPdf(p.cliente || "Cliente", [doc]);
    baixarBytes(bytes, nome);
    return;
  }
  const { baixarDocumentoDoLab, docxDoProjeto } = await import("@/lib/laboratorio/exportar");
  const nome = nomeDoWord(p.roteiro.titulo || p.tema || "video");
  const blob = await docxDoProjeto({ nome, titulo: p.roteiro.titulo || "Roteiro", markdown: textoDoRoteiro(p.roteiro), json: "", totalNos: 0, totalExecucoes: 0, pendencias: [] });
  baixarDocumentoDoLab(blob, `${nome}.docx`);
}

export interface EstadoDoRoteiroDaPeca {
  /** O roteiro na tabela (null: ainda não entrou). */
  linha: LinhaDoRoteiro | null;
  versao: VersaoDoRoteiro | null;
  /** O roteiro à vista: a versão atual da tabela ou, sem ela, o que o item guardava. */
  roteiro: Roteiro | null;
  /** O que o item guarda de roteiro (migração na leitura); vazio quando a tabela já tem. */
  antigas: VersaoAntigaDaPeca[];
  carregando: boolean;
  erro: unknown;
  indisponivel: boolean;
}

/**
 * A lista de roteiros do cliente com a peça: o da tabela ou o antigo do item. Sem campanha (a peça de vídeo do
 * Mês, GravarDaPauta), o roteiro é o da tarefa da agenda (item.task_id).
 */
export function useRoteiroDaPeca(p: { clientId: string; campanha: Campanha | null; propostaId: string | null; item: ItemProposto }): EstadoDoRoteiroDaPeca {
  const roteiros = useRoteiros(p.clientId);
  const linha = !roteiros.data
    ? null
    : p.campanha
      ? roteiroDaPecaDaCampanha(roteiros.data.lista, { campanhaId: p.campanha.id, propostaId: p.propostaId || p.campanha.proposta_id, item: p.item })
      : linhaDaPeca(roteiros.data.lista, { taskId: p.item.task_id || null, campanhaId: "", tema: "" });
  const versao = linha ? versaoPorNumero(linha.versoes, linha.versao_atual) : null;
  const antigas = linha ? [] : versoesAntigasDaPeca(p.item as unknown as Record<string, unknown>);
  const roteiro = versao ? versao.conteudo : antigas.length ? antigas[antigas.length - 1].conteudo : null;
  return {
    linha,
    versao,
    roteiro,
    antigas,
    carregando: roteiros.isLoading,
    erro: roteiros.isError ? roteiros.error : null,
    indisponivel: !!(roteiros.data && roteiros.data.indisponivel),
  };
}
