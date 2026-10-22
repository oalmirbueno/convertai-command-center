import { projetoDosTakes, type FonteDoProjeto, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { Montador } from "@/lib/editor/skills/tipos";
import { NOME_DA_TRILHA_DE_MUSICA, porTrilha } from "@/lib/editor/motion/aplicar";
import { fimDoClipe } from "@/lib/editor/operacoes";
import { duracoesDasCenas, RESPIRO_ANTES_S, situacaoDaNarracao } from "../../../supabase/functions/agente-calendario/modulos/narracao-da-campanha-regras";
import type { RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import type { TrilhaEscolhida } from "./trilhaDaCampanhaApi";

/**
 * Montagem do vídeo gerado da campanha (22/10/2026, caminho Gerar): o projeto da Mesa Edição
 * (_shared/projeto-de-edicao.ts) com as cenas em vídeo em sequência, cada uma do tamanho da fala quando
 * há narração em dia; a voz em trilha de áudio com estilo.papel "voz" (um clipe por cena, no trecho
 * dela do MP3); o texto na tela como trilha de texto; e a música da campanha com papel "trilha" pelo
 * porTrilha (22 dB abaixo da voz; o worker mede e mixa em -14 LUFS). Puro: a tela registra a versão e
 * pede o render. Sem travessão.
 */

export interface ClipeDaCena {
  ordem: number;
  arquivo_id: string;
  nome: string;
  tipo: string;
  storage_bucket: string;
  storage_path: string;
  /** Duração do arquivo gerado (s); sem medida, a pedida ao motor. */
  duracao_s: number;
  largura: number | null;
  altura: number | null;
}

export const CHAVE_DA_NARRACAO = "narracao-da-peca";
export const CHAVE_DA_TRILHA = "trilha-da-campanha";
/** A cena em vídeo nunca fica mais lenta que metade da velocidade para caber a fala. */
const VELOCIDADE_MINIMA = 0.5;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function daPastaDoCliente(clientId: string, bucket: string | null | undefined, caminho: string | null | undefined, oque: string) {
  if ((bucket || "mesa") !== "mesa" || !caminho || caminho.indexOf(`${clientId}/`) !== 0 || caminho.indexOf("..") >= 0) throw new Error(`${oque} fora do acervo deste cliente.`);
}

export function projetoDoVideoDaCampanha(e: {
  clientId: string;
  titulo: string;
  roteiro: RoteiroDeVideo;
  clipes: ClipeDaCena[];
  trilha: TrilhaEscolhida | null;
  abaixoDb?: number;
  agora?: string | null;
}): { projeto: ProjetoDeEdicao; avisos: string[]; duracao_s: number } {
  const avisos: string[] = [];
  const r = e.roteiro;
  const tempos = duracoesDasCenas(r);
  const clipes = tempos.map((t) => {
    const c = e.clipes.find((x) => x.ordem === t.ordem);
    if (!c) throw new Error(`A cena ${t.ordem} ainda não tem vídeo pronto.`);
    daPastaDoCliente(e.clientId, c.storage_bucket, c.storage_path, `O vídeo da cena ${t.ordem}`);
    if (!(c.duracao_s > 0)) throw new Error(`A duração do vídeo da cena ${t.ordem} ainda não foi medida.`);
    return c;
  });
  const situacao = situacaoDaNarracao(r);
  const n = situacao === "em_dia" && r.narracao ? r.narracao : null;
  if (situacao === "desatualizada") avisos.push("As falas mudaram depois da narração: o vídeo sai sem voz até gerar a narração de novo.");
  if (situacao === "falta") avisos.push("Sem narração: o vídeo sai com o texto na tela e a trilha.");
  if (n) daPastaDoCliente(e.clientId, "mesa", n.arquivo, "A narração");
  if (e.trilha) daPastaDoCliente(e.clientId, "mesa", e.trilha.arquivo, "A trilha");

  const base = projetoDosTakes({
    titulo: e.titulo,
    formato: "9:16",
    direcao: r.gancho ? `Gancho: ${r.gancho}` : null,
    agora: e.agora || null,
    takes: clipes.map((c) => ({ id: c.arquivo_id, nome: `Cena ${c.ordem}`, tipo: c.tipo || "gerado", storage_bucket: c.storage_bucket, storage_path: c.storage_path, cena_ref: String(c.ordem), melhor: true, duracao_s: c.duracao_s, largura: c.largura, altura: c.altura })),
  });
  const m = new Montador(base);
  const fps = m.projeto.fps;
  const naGrade = (s: number) => r3(Math.ceil(s * fps - 1e-6) / fps);
  const idDa = (tipo: string) => (m.projeto.trilhas.find((t) => t.tipo === tipo) as { id: string }).id;
  const video = idDa("video");
  const textoId = idDa("texto");
  const audio = idDa("audio");
  m.aplicar({ op: "limpar_trilha", trilha: video });
  const chaveDoArquivo = (id: string) => Object.keys(m.projeto.fontes).find((k) => m.projeto.fontes[k].arquivo_id === id) as string;

  if (n) {
    const fonte: FonteDoProjeto = { chave: CHAVE_DA_NARRACAO, arquivo_id: n.arquivo_id, nome: `Narração (${n.voz.nome})`, tipo: "audio", storage_bucket: "mesa", storage_path: n.arquivo, duracao_s: n.duracao_s || null, largura: null, altura: null, midia: "audio" };
    m.aplicar({ op: "fonte", fonte });
    if (n.palavras.length) m.aplicar({ op: "transcricao", fonte: CHAVE_DA_NARRACAO, transcricao: { segmentos: n.palavras.map((w) => ({ t: w.t, i: w.i, f: w.f })), por_palavra: true, origem: "elevenlabs", versao: 1, em: n.em || null } });
    m.aplicar({ op: "trilha", trilha: audio, campos: { nome: "Narração" } });
  }

  let cursor = 0;
  tempos.forEach((t, k) => {
    const c = clipes[k];
    const fonte = chaveDoArquivo(c.arquivo_id);
    const slot = naGrade(t.duracao_s);
    const fonteS = c.duracao_s;
    let velocidade = 1;
    let saida = Math.min(slot, fonteS);
    if (fonteS + 0.001 < slot) {
      // O vídeo é mais curto que a fala: desacelera até a metade; abaixo disso, avisa.
      velocidade = Math.max(VELOCIDADE_MINIMA, Math.floor((fonteS / slot) * 1000) / 1000);
      saida = fonteS;
      if (fonteS / VELOCIDADE_MINIMA + 0.001 < slot) avisos.push(`Cena ${t.ordem}: o vídeo tem ${r3(fonteS)} s e a fala pede ${r3(slot)} s. Refaça a cena com mais segundos.`);
    }
    m.aplicar({ op: "inserir", trilha: video, clipe: { inicio_s: cursor, entrada_s: 0, saida_s: r3(saida), velocidade, volume: n ? 0 : 1, fonte, cena_ref: String(t.ordem), origem: { tipo: "cena", ref: `campanha:cena-${t.ordem}` } } });
    const trilhaDeVideo = m.projeto.trilhas.find((x) => x.id === video);
    const inserido = trilhaDeVideo ? trilhaDeVideo.clipes[trilhaDeVideo.clipes.length - 1] : null;
    const fimDoSlot = naGrade(Math.max(cursor + slot, inserido ? fimDoClipe(inserido) : cursor + slot));
    const cena = r.cenas.find((x) => x.ordem === t.ordem);
    if (cena && cena.texto_na_tela) {
      m.aplicar({ op: "inserir", trilha: textoId, clipe: { inicio_s: cursor, entrada_s: 0, saida_s: r3(fimDoSlot - cursor), texto: cena.texto_na_tela, estilo: { preset: k === 0 ? "manchete" : "simples" }, cena_ref: String(t.ordem), origem: { tipo: "cena", ref: `campanha:texto-${t.ordem}` } } });
    }
    if (n && t.fala) {
      const inicio = r3(cursor + Math.min(RESPIRO_ANTES_S, Math.max(0, fimDoSlot - cursor - 0.5)));
      const dur = Math.min(t.fala.ate_s - t.fala.de_s, fimDoSlot - inicio);
      if (dur > 0.05) m.aplicar({ op: "inserir", trilha: audio, clipe: { inicio_s: inicio, entrada_s: r3(t.fala.de_s), saida_s: r3(t.fala.de_s + dur), volume: 1, fonte: CHAVE_DA_NARRACAO, estilo: { papel: "voz" }, cena_ref: String(t.ordem), origem: { tipo: "cena", ref: `campanha:voz-${t.ordem}` } } });
    }
    cursor = fimDoSlot;
  });

  if (e.trilha) {
    const fonte: FonteDoProjeto = { chave: CHAVE_DA_TRILHA, arquivo_id: e.trilha.som_id || null, nome: e.trilha.titulo || "Trilha da campanha", tipo: "audio", storage_bucket: "mesa", storage_path: e.trilha.arquivo, duracao_s: e.trilha.duracao > 0 ? e.trilha.duracao : null, largura: null, altura: null, midia: "audio" };
    m.aplicar({ op: "fonte", fonte });
    const feita = porTrilha(m, CHAVE_DA_TRILHA, typeof e.abaixoDb === "number" ? e.abaixoDb : 22);
    if (feita.duracao_s + 0.05 < cursor) {
      if (e.trilha.loop && e.trilha.duracao > 0) {
        // Trilha em loop: repete até o fim do vídeo, na mesma trilha de música.
        const daMusica = m.projeto.trilhas.find((x) => x.tipo === "audio" && x.nome.indexOf(NOME_DA_TRILHA_DE_MUSICA) === 0 && x.clipes.some((cl) => cl.fonte === CHAVE_DA_TRILHA));
        let ini = naGrade(feita.duracao_s);
        while (daMusica && ini + 0.1 < cursor) {
          const len = r3(Math.min(e.trilha.duracao, cursor - ini));
          m.aplicar({ op: "inserir", trilha: daMusica.id, clipe: { inicio_s: ini, entrada_s: 0, saida_s: len, fonte: CHAVE_DA_TRILHA, estilo: { papel: "trilha" }, origem: { tipo: "skill", ref: "trilha" } } });
          ini = naGrade(ini + len);
        }
      } else avisos.push(`A trilha tem ${Math.round(feita.duracao_s)} s e o vídeo ${Math.round(cursor)} s: o fim fica sem música. Escolha uma trilha mais longa ou em loop.`);
    }
  }
  m.aplicar({ op: "mixagem", campos: { lufs_alvo: -14, duck: true } });
  return { projeto: m.projeto, avisos, duracao_s: r3(cursor) };
}
