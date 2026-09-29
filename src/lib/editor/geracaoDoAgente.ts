import type { FonteDoProjeto, ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import type { AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import type { ChamadaDeFerramenta } from "../../../supabase/functions/editor-video/ferramentas";
import { custoDe } from "./geracao";
import { chaveDaFonte } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { aplicarOperacao, colide, type Operacao } from "./operacoes";
import { tempoFino } from "./tempo";
import { falaNaLinhaDoTempo } from "./transcricao";
import { Montador } from "./skills/tipos";
import { porPeca } from "./motion/aplicar";
import { frasesParaSugerir } from "./motion/sugestoes";
import { AGENTE_DO_EDITOR } from "./exportar";
import type { ResultadoDaFerramenta, SaidaDoAgente } from "./agente";

/**
 * O agente editor usando os motores que já existem (frente EDT, F3/F4):
 * - sugerir_animacoes: o código monta as candidatas com o que foi dito, o Jev
 *   escolhe (editor-video/animacoes_sugerir), o código põe na palavra medida;
 * - gerar_broll: vídeo pela Mesa Vídeos (gerar_video, modo texto), custo antes
 *   (409 confirmar_custo sem gasto) e o Confirmar do dono com o uid do clique;
 * - gerar_elemento: ícone ou objeto com fundo transparente (editor-video).
 * Nada pago roda sem o cartão confirmado.
 */

type Chamar = (corpo: Record<string, unknown>) => Promise<any>;

const num = (v: unknown, padrao: number) => {
  const n = Number(v);
  return isFinite(n) ? n : padrao;
};
const detalhes = (e: unknown): Record<string, unknown> => (e && typeof e === "object" && (e as { detalhes?: unknown }).detalhes && typeof (e as { detalhes: unknown }).detalhes === "object" ? (e as { detalhes: Record<string, unknown> }).detalhes : {});
const codigo = (e: unknown) => (e && typeof e === "object" && typeof (e as { codigo?: unknown }).codigo === "string" ? String((e as { codigo: string }).codigo) : "");

// ------------------------------------------------------------------ sugerir animações

export async function sugerirAnimacoesNaTela(chamar: Chamar, clientId: string, p: ProjetoDeEdicao, densidade: "poucas" | "medias"): Promise<ResultadoDaFerramenta> {
  const frases = frasesParaSugerir(falaNaLinhaDoTempo(p));
  if (!frases.length) return { projeto: p, operacoes: [], texto: "Nenhuma frase dita com dado, lista ou chamada para animar (ou falta marcar a fala).", ok: true };
  const r = await chamar({ acao: "animacoes_sugerir", client_id: clientId, densidade, frases: frases.map((f) => ({ k: f.k, inicio_s: f.inicio_s, fim_s: f.fim_s, texto: f.texto, candidatas: f.candidatas.map((c) => c.peca) })) });
  const sugestoes = ((r && r.sugestoes) || []) as { k: string; peca: string; probabilidade: number }[];
  const m = new Montador(p);
  const postas: string[] = [];
  const puladas: string[] = [];
  sugestoes.forEach((s) => {
    const f = frases.find((x) => x.k === s.k);
    const c = f ? f.candidatas.find((x) => x.peca === s.peca) : null;
    if (!f || !c) return;
    try {
      const x = porPeca(m, { peca: c.peca, inicio_s: f.inicio_s, params: c.params });
      postas.push(`${c.peca} em ${tempoFino(x.inicio_s)} ("${f.texto.slice(0, 40)}")`);
    } catch (e) {
      puladas.push(`${c.peca} em ${tempoFino(f.inicio_s)}: ${e instanceof Error ? e.message : "não coube"}`);
    }
  });
  const texto = postas.length ? `Pus ${postas.length} ${postas.length === 1 ? "animação" : "animações"}: ${postas.join("; ")}.${puladas.length ? ` Ficaram de fora: ${puladas.join("; ")}.` : ""}` : `Nenhuma frase pediu animação com segurança${puladas.length ? ` (${puladas.join("; ")})` : ""}.`;
  return { projeto: m.projeto, operacoes: m.operacoes, texto, ok: true };
}

// ------------------------------------------------------------------ B-roll e elemento (pagos)

export async function estimarBroll(chamarMesa: Chamar, clientId: string, p: ProjetoDeEdicao, a: Record<string, unknown>): Promise<SaidaDoAgente> {
  const de = Math.max(0, num(a.de_s, 0));
  const ate = Math.max(de + 1, num(a.ate_s, de + 5));
  const prompt = String(a.prompt || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  if (prompt.length < 5) throw new Error("Diga o que o B-roll mostra.");
  let motor = a.motor ? String(a.motor) : "";
  if (!motor) {
    const est = await chamarMesa({ acao: "motores_estado" });
    motor = est && est.sugestao ? String(est.sugestao.normal || est.sugestao.top || "") : "";
    if (!motor) throw new Error("Nenhum motor de vídeo pronto na Mesa Vídeos.");
  }
  const argumentos = { de_s: de, ate_s: ate, prompt, motor, duracao_s: Math.max(3, Math.min(10, Math.ceil(ate - de))), formato: p.formato };
  const corpo = { acao: "gerar_video", client_id: clientId, motor, modo: "texto", tipo: "gerar_livre", prompt, duracao_s: argumentos.duracao_s, formato: p.formato, audio: false, variacoes: 1, titulo: `B-roll ${tempoFino(de)}` };
  try {
    const r = await chamarMesa(corpo);
    return { tipo: "gerar_broll", argumentos, custo_usd: custoDe(r), detalhe: null };
  } catch (e) {
    if (codigo(e) === "confirmar_custo") {
      const d = detalhes(e);
      const c = d.custo_estimado && typeof d.custo_estimado === "object" ? (d.custo_estimado as Record<string, unknown>) : null;
      return { tipo: "gerar_broll", argumentos, custo_usd: custoDe(d), detalhe: c && c.detalhe ? String(c.detalhe) : null };
    }
    throw e;
  }
}

export async function estimarElemento(chamar: Chamar, clientId: string, a: Record<string, unknown>): Promise<SaidaDoAgente> {
  const tipo = a.tipo === "objeto" ? "objeto" : "icone";
  const prompt = String(a.prompt || "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (prompt.length < 3) throw new Error("Diga o que é o elemento.");
  const r = await chamar({ acao: "elemento_estimar", client_id: clientId, tipo, prompt });
  return { tipo: "gerar_elemento", argumentos: { tipo, prompt, inicio_s: Math.max(0, num(a.inicio_s, 0)), duracao_s: Math.max(0.8, Math.min(10, num(a.duracao_s, 2.5))) }, custo_usd: typeof r.custo_usd === "number" ? r.custo_usd : null, detalhe: r.modelo ? String(r.modelo) : null };
}

/** Cartão da geração: um item, custo à vista, sem Desfazer (gerar não volta), só com Confirmar. */
export function acaoDaSaida(s: SaidaDoAgente, id = `gerar-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`): AcaoDoAgente {
  const a = s.argumentos;
  const broll = s.tipo === "gerar_broll";
  const titulo = broll ? `B-roll de ${tempoFino(Number(a.de_s))} a ${tempoFino(Number(a.ate_s))}` : `${a.tipo === "objeto" ? "Objeto" : "Ícone"} em ${tempoFino(Number(a.inicio_s))}`;
  return {
    tipo: "acao_agente",
    agente: AGENTE_DO_EDITOR,
    id,
    resumo: `${broll ? "Gera o vídeo" : "Gera a imagem com fundo transparente"}: "${String(a.prompt).slice(0, 120)}". ${s.custo_usd !== null ? `Custo: US$ ${s.custo_usd.toFixed(2)}, na carteira do cliente.` : "Sem custo conhecido: não gera."}${s.detalhe ? ` (${s.detalhe})` : ""}`,
    itens: [{ ref: "g1", alvo_id: s.tipo, titulo, detalhe: broll ? `${a.motor}, ${a.duracao_s} s, ${a.formato}` : String(a.prompt).slice(0, 80), operacao: s.tipo, rotulo: "Gerar", para: null }],
    ignorados: [],
    recusados: [],
    sem_desfazer: true,
    custo_estimado_usd: s.custo_usd,
    contexto: { saida: s },
  };
}

/** Confirmado: manda com o custo mostrado e o uid do clique (o mesmo clique nunca gera duas vezes). */
export async function confirmarBroll(chamarMesa: Chamar, clientId: string, s: SaidaDoAgente, uid: string): Promise<{ pedido_id: string }> {
  const a = s.argumentos;
  if (s.custo_usd === null) throw new Error("Sem custo conhecido não dá para gerar.");
  const r = await chamarMesa({ acao: "gerar_video", client_id: clientId, motor: a.motor, modo: "texto", tipo: "gerar_livre", prompt: a.prompt, duracao_s: a.duracao_s, formato: a.formato, audio: false, variacoes: 1, titulo: `B-roll ${tempoFino(Number(a.de_s))}`, uid, custo_confirmado_usd: s.custo_usd });
  return { pedido_id: String((r && (r.pedido_id || (r.pedido && r.pedido.id))) || "") };
}

export interface ArquivoGerado {
  id: string;
  nome: string;
  storage_bucket: string;
  storage_path: string;
  duracao_s?: number | null;
  largura?: number | null;
  altura?: number | null;
}

export async function confirmarElemento(chamar: Chamar, clientId: string, s: SaidaDoAgente, uid: string): Promise<{ arquivo: ArquivoGerado; custo_usd: number }> {
  if (s.custo_usd === null) throw new Error("Sem custo conhecido não dá para gerar.");
  const r = await chamar({ acao: "elemento_gerar", client_id: clientId, tipo: s.argumentos.tipo, prompt: s.argumentos.prompt, uid, custo_confirmado_usd: s.custo_usd });
  return { arquivo: r.arquivo as ArquivoGerado, custo_usd: Number(r.custo_usd) || 0 };
}

/**
 * O arquivo gerado entra no trecho: B-roll numa trilha de vídeo "B-roll" por
 * cima da principal (sem som: a voz continua), elemento na sobreposição.
 */
export function opsDoArquivoNoTrecho(p: ProjetoDeEdicao, arq: ArquivoGerado, alvo: { tipo: "broll" | "elemento"; inicio_s: number; duracao_s: number }): Operacao[] {
  let chave = chaveDaFonte(arq.nome || arq.id);
  if (p.fontes[chave] && p.fontes[chave].arquivo_id !== arq.id) chave = `${chave}-${arq.id.slice(0, 6)}`;
  const fonte: FonteDoProjeto = { chave, arquivo_id: arq.id, nome: arq.nome, tipo: alvo.tipo === "broll" ? "gerado" : "quadro", storage_bucket: arq.storage_bucket || "mesa", storage_path: arq.storage_path, duracao_s: arq.duracao_s || null, largura: arq.largura || null, altura: arq.altura || null, midia: alvo.tipo === "broll" ? "video" : "imagem" };
  const ops: Operacao[] = [];
  let atual = p;
  if (!p.fontes[chave]) {
    const o: Operacao = { op: "fonte", fonte };
    ops.push(o);
    atual = aplicarOperacao(atual, o);
  }
  const tipo = alvo.tipo === "broll" ? "video" : "sobreposicao";
  const nome = alvo.tipo === "broll" ? "B-roll" : "Elementos";
  const dur = alvo.tipo === "broll" && arq.duracao_s ? Math.min(alvo.duracao_s, arq.duracao_s) : alvo.duracao_s;
  const fim = alvo.inicio_s + dur;
  let trilha = atual.trilhas.find((t) => t.tipo === tipo && t.nome.indexOf(nome) === 0 && !colide(t, alvo.inicio_s, fim));
  if (!trilha) {
    const antes = atual.trilhas.map((t) => t.id);
    const o1: Operacao = { op: "trilha_nova", tipo };
    atual = aplicarOperacao(atual, o1);
    const nova = atual.trilhas.find((t) => antes.indexOf(t.id) < 0)!;
    const o2: Operacao = { op: "trilha", trilha: nova.id, campos: { nome, ...(tipo === "video" ? { muda: true } : {}) } };
    atual = aplicarOperacao(atual, o2);
    ops.push(o1, o2);
    trilha = atual.trilhas.find((t) => t.id === nova.id)!;
  }
  ops.push({
    op: "inserir",
    trilha: trilha.id,
    clipe: { inicio_s: alvo.inicio_s, entrada_s: 0, saida_s: Math.max(0.2, dur), fonte: chave, volume: 0, estilo: alvo.tipo === "elemento" ? { escala: 0.34, x: 0.5, y: 0.3 } : null, origem: { tipo: "cena", ref: alvo.tipo === "broll" ? "gerar_broll" : "gerar_elemento" } },
  });
  return ops;
}

/** A chamada que o agente pediu é uma geração paga? */
export const ehGeracaoPaga = (ch: ChamadaDeFerramenta) => ch.ferramenta === "gerar_broll" || ch.ferramenta === "gerar_elemento";
