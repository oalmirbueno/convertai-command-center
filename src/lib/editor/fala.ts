import type { ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { custoDoTimestamp, juntarPartes, PROVEDORES_DE_TIMESTAMP, type PalavraComTempo } from "../../../supabase/functions/editor-video/ferramentas";
import { extrairAudio, partesDoAudio, suportaExtrairAudio, wavDe } from "./audio";
import { chamarEditorVideo, novoId, subirDoEditor } from "./api";
import { aplicarOperacao, trilhaPrincipal, type Operacao } from "./operacoes";
import { skillPorPalavras, type IdDaSkill } from "./skills";

/**
 * Marcar a fala (Timestamp) fora do painel do Timestamp (frente Q, 26/09):
 * o agente editor e a Entrada usam o mesmo caminho. Só o áudio sai do
 * navegador (mono 16 kHz, em partes de ~60 s); cada parte vai para
 * editor-video/timestamp_parte com o custo máximo mostrado; as palavras voltam
 * no tempo da fonte. Sem nova tentativa sozinha (regra "sem laço").
 *
 * A Entrada guarda a fala do arquivo no navegador (por cliente e arquivo); o
 * editor usa essa fala sem pagar de novo.
 */

/** Fontes da trilha principal (vídeo ou áudio, com duração) que ainda não têm fala marcada. */
export function fontesSemFala(p: ProjetoDeEdicao): string[] {
  const t = trilhaPrincipal(p);
  const saida: string[] = [];
  (t ? t.clipes : []).forEach((c) => {
    if (!c.fonte || saida.indexOf(c.fonte) >= 0) return;
    const f = p.fontes[c.fonte];
    if (!f || f.midia === "imagem" || !f.duracao_s) return;
    const tr = p.transcricoes[c.fonte];
    if (tr && tr.segmentos.length) return;
    saida.push(c.fonte);
  });
  return saida;
}

/** Custo de transcrever essas fontes (Whisper por minuto, por parte). */
export function custoDaFala(p: ProjetoDeEdicao, chaves: string[]): number {
  const soma = chaves.reduce((s, k) => s + custoDoTimestamp("transcrever", (p.fontes[k] && p.fontes[k].duracao_s) || 0), 0);
  return Math.round(soma * 10000) / 10000;
}

/** Skills que ficam boas só com a fala marcada (corte na pausa, legenda na palavra). */
const SKILLS_COM_FALA: IdDaSkill[] = ["brabo", "cortar_silencios", "legendas", "punch_in"];

/** O pedido precisa da fala? (edição dinâmica, silêncio, legenda, gancho, corte na fala). Regra fixa por palavras. */
export function pedidoPrecisaDeFala(pedido: string): boolean {
  const s = skillPorPalavras(pedido);
  if (s) return SKILLS_COM_FALA.indexOf(s) >= 0;
  const t = String(pedido || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return /edit|edicao|corta|corte|fala|timestamp|transcr|ritmo|dinamic/.test(t);
}

export const skillPrecisaDeFala = (id: IdDaSkill) => SKILLS_COM_FALA.indexOf(id) >= 0;

/** Operação que guarda a fala de uma fonte no projeto (versão +1). */
export function operacaoDaFala(p: ProjetoDeEdicao, chave: string, palavras: PalavraComTempo[], origem: string, agora: string): Operacao {
  const anterior = p.transcricoes[chave];
  return {
    op: "transcricao",
    fonte: chave,
    transcricao: { segmentos: palavras.slice(0, 12000), por_palavra: true, origem, versao: (anterior ? anterior.versao : 0) + 1, em: agora },
  };
}

export interface MarcarFala {
  clientId: string;
  url: string;
  aoAndar?: (texto: string) => void;
  cancelado?: () => boolean;
  /** Nomes, marcas e valores (dica de vocabulário para o Whisper; não muda o tempo). */
  dica?: string;
}

/** Transcreve uma mídia (URL assinada) palavra por palavra. Lança em erro (a tela mostra). */
export async function transcreverMidia(e: MarcarFala): Promise<{ palavras: PalavraComTempo[]; custo_usd: number; provedor: string }> {
  if (!suportaExtrairAudio()) throw new Error("Este navegador não tira o áudio do vídeo. Use Chrome, Edge ou Safari atualizados.");
  const audio = await extrairAudio(e.url, e.aoAndar);
  const partes = partesDoAudio(audio.amostras, audio.taxa);
  const referencia = novoId();
  const juntas: PalavraComTempo[][] = [];
  let gasto = 0;
  for (const parte of partes) {
    if (e.cancelado && e.cancelado()) throw new Error("Parado. O que já foi marcado não foi guardado.");
    if (e.aoAndar) e.aoAndar(`Marcando a fala: parte ${parte.n + 1} de ${partes.length}`);
    const caminho = await subirDoEditor(e.clientId, "audio", wavDe(audio.amostras.subarray(parte.de, parte.ate), audio.taxa), "wav");
    const dur = parte.fim_s - parte.inicio_s;
    const r = await chamarEditorVideo<{ palavras: PalavraComTempo[]; custo_usd: number }>({
      acao: "timestamp_parte",
      client_id: e.clientId,
      audio_path: caminho,
      inicio_s: parte.inicio_s,
      duracao_s: dur,
      idioma: "pt",
      texto: e.dica ? e.dica.slice(0, 800) : undefined,
      referencia_id: referencia,
      custo_maximo_usd: custoDoTimestamp("transcrever", dur),
    });
    juntas.push((r && r.palavras) || []);
    gasto += Number(r && r.custo_usd) || 0;
  }
  return { palavras: juntarPartes(juntas), custo_usd: Math.round(gasto * 10000) / 10000, provedor: PROVEDORES_DE_TIMESTAMP.whisper.modelo };
}

/**
 * Marca a fala de várias fontes do projeto (uma de cada vez) e devolve o
 * projeto com a fala guardada. Fonte com fala guardada pela Entrada entra de
 * graça. Sem URL da fonte: erro claro.
 */
export async function marcarFalaDoProjeto(
  p: ProjetoDeEdicao,
  chaves: string[],
  e: { clientId: string; urls: Record<string, string>; agora: string; aoAndar?: (t: string) => void; cancelado?: () => boolean },
): Promise<{ projeto: ProjetoDeEdicao; custo_usd: number; marcadas: number }> {
  let atual = p;
  let gasto = 0;
  let marcadas = 0;
  for (const chave of chaves) {
    const f = atual.fontes[chave];
    if (!f) continue;
    const guardada = f.arquivo_id ? lerFalaDaEntrada(e.clientId, f.arquivo_id) : null;
    if (guardada && guardada.length) {
      atual = aplicarOperacao(atual, operacaoDaFala(atual, chave, guardada, "entrada", e.agora));
      marcadas++;
      continue;
    }
    const url = e.urls[chave];
    if (!url) throw new Error(`A mídia ${f.nome} ainda não abriu aqui. Espere um instante e peça de novo.`);
    const r = await transcreverMidia({ clientId: e.clientId, url, aoAndar: e.aoAndar ? (t) => e.aoAndar!(`${f.nome}: ${t}`) : undefined, cancelado: e.cancelado });
    gasto += r.custo_usd;
    atual = aplicarOperacao(atual, operacaoDaFala(atual, chave, r.palavras, r.provedor, e.agora));
    marcadas++;
  }
  return { projeto: atual, custo_usd: Math.round(gasto * 10000) / 10000, marcadas };
}

// ------------------------------------------------------------------ fala guardada pela Entrada (no navegador)

const chaveDaFala = (clientId: string, arquivoId: string) => `mesa-edicao:fala:${clientId}:${arquivoId}`;

/** Palavras em forma curta ([t, i, f]) para caber no armazenamento do navegador. */
export function guardarFalaDaEntrada(clientId: string, arquivoId: string, palavras: PalavraComTempo[]): boolean {
  try {
    const curto = palavras.slice(0, 12000).map((w) => [w.t, w.i, w.f]);
    window.localStorage.setItem(chaveDaFala(clientId, arquivoId), JSON.stringify({ v: 1, em: new Date().toISOString(), p: curto }));
    return true;
  } catch {
    return false;
  }
}

export function lerFalaDaEntrada(clientId: string, arquivoId: string): PalavraComTempo[] | null {
  try {
    const bruto = window.localStorage.getItem(chaveDaFala(clientId, arquivoId));
    if (!bruto) return null;
    const o = JSON.parse(bruto);
    if (!o || !Array.isArray(o.p)) return null;
    const saida: PalavraComTempo[] = [];
    (o.p as unknown[]).forEach((x) => {
      if (!Array.isArray(x) || x.length < 3) return;
      const i = Number(x[1]);
      const f = Number(x[2]);
      if (!isFinite(i) || !isFinite(f)) return;
      saida.push({ t: String(x[0]), i, f });
    });
    return saida;
  } catch {
    return null;
  }
}
