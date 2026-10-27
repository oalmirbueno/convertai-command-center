import { projetoDosTakes } from "../../_shared/projeto-de-edicao.ts";

/**
 * Corte simples do vídeo pronto (27/10/2026, dono: "poder editar e cortar antes de ir pro ar qualquer vídeo com o
 * editor, mas de forma clean; eu mesmo corto manualmente"). O vídeo pronto entra inteiro como fonte única, com a
 * entrada e a saída que a pessoa marcou; a versão nova vai para o render de sempre (worker). O original não muda.
 *
 * Puro: sem Deno e sem banco (os testes leem este arquivo).
 */

export const CORTE_MINIMO_S = 1;

export interface ArquivoParaCorte {
  id: string;
  client_id: string;
  nome: string;
  tipo: string;
  storage_bucket: string | null;
  storage_path: string;
  duracao_s: number | null;
  largura?: number | null;
  altura?: number | null;
}

export class ErroDoCorte extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

const cent = (n: number) => Math.round(n * 100) / 100;

/** Entrada e saída pedidas, presas ao vídeo. Recusa o corte que não corta nada ou fica curto demais. */
export function lerCorte(entradaBruta: unknown, saidaBruta: unknown, duracao: number | null): { entrada_s: number; saida_s: number } {
  if (!duracao || !isFinite(duracao) || duracao <= 0) throw new ErroDoCorte(409, "duracao_desconhecida", "A duração do vídeo ainda não foi medida. Abra o vídeo uma vez e tente de novo.");
  const e = Number(entradaBruta);
  const s = Number(saidaBruta);
  if (!isFinite(e) || !isFinite(s)) throw new ErroDoCorte(400, "corte_invalido", "Marque o início e o fim do corte.");
  const entrada = cent(Math.min(Math.max(0, e), duracao));
  const saida = cent(Math.min(Math.max(0, s), duracao));
  if (saida - entrada < CORTE_MINIMO_S) throw new ErroDoCorte(400, "corte_curto", `O trecho precisa ter pelo menos ${CORTE_MINIMO_S} s.`);
  if (entrada <= 0.05 && saida >= duracao - 0.05) throw new ErroDoCorte(400, "nada_a_cortar", "O trecho marcado é o vídeo inteiro: mova o início ou o fim.");
  return { entrada_s: entrada, saida_s: saida };
}

/** Projeto de uma trilha só: o vídeo pronto do início ao fim marcados, começando no zero. */
export function projetoDoCorte(a: ArquivoParaCorte, corte: { entrada_s: number; saida_s: number }) {
  if (a.storage_bucket !== "mesa" || !a.storage_path.startsWith(`${a.client_id}/`)) throw new ErroDoCorte(400, "arquivo_fora_da_mesa", "Este vídeo não está no acervo da Mesa.");
  const largura = a.largura || 1080;
  const altura = a.altura || 1920;
  const formato = largura === altura ? "1:1" : largura > altura ? "16:9" : largura / altura > 0.7 ? "4:5" : "9:16";
  const p = projetoDosTakes({ titulo: a.nome, formato, takes: [{ ...a, storage_bucket: "mesa", largura, altura, cena_ref: null, melhor: true }] });
  const video = p.trilhas.find((t) => t.tipo === "video");
  const clipe = video && video.clipes[0];
  if (!video || !clipe) throw new ErroDoCorte(409, "sem_clipe", "Não foi possível montar o corte deste vídeo.");
  video.clipes = [{ ...clipe, inicio_s: 0, entrada_s: corte.entrada_s, saida_s: corte.saida_s }];
  return { ...p, largura, altura, duracao_s: cent(corte.saida_s - corte.entrada_s) };
}
