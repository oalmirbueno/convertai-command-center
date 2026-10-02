import { useQuery } from "@tanstack/react-query";
import { chamarFuncao } from "@/lib/mesa/api";
import {
  lerChaveDaPeca,
  normalizarPecaDeFoto,
  UUID_DA_PECA,
  type DirecaoDaFoto,
  type PecaDeFoto,
} from "../../../supabase/functions/mesa-foto/modulos/pecas-de-foto";
import { cameraPeloTexto, lerVariacoes, luzPeloTexto } from "../../../supabase/functions/mesa-foto/modulos/opcoes-do-resultado";
import type { DirecaoParaACaixa } from "./canvas/caixas";
import type { DadosDoNo } from "./canvasApi";

export type { DirecaoDaFoto, PecaDeFoto };

/**
 * Esteira das peças de foto do mês no topo da Mesa Foto (02/10/2026; dono:
 * "quando eu abrir, aparecer a esteira do que está pronto para fazer, já
 * puxando a direção de foto certa"). A lista vem da ação pecas_de_foto da
 * função mesa-foto (calendario_propostas do mês atual e do próximo, com a
 * checagem de acesso ao cliente). Abrir uma peça leva a direção para o
 * diretor (o pedido fica no campo dele, para revisar e mandar) ou para uma
 * caixa nova no Canvas, já montada.
 *
 * Endereço direto (o planejamento do mês liga aqui):
 *   /mesa-foto?client=<id>&peca=<proposta_id>:<indice>
 *   /mesa-foto?client=<id>&task=<task_id>   (fora da etapa agenda, que já usa task=)
 */

export const chaveDasPecasDeFoto = (clientId: string, marcaId: string | null = null) => ["mesa-foto", "pecas-de-foto", clientId, marcaId || ""];

/** O que chegou da função, conferido de novo (forma errada fica de fora). */
export function normalizarPecasDeFoto(data: unknown): PecaDeFoto[] {
  const bruto = data && typeof data === "object" ? (data as { pecas?: unknown }).pecas : null;
  const saida: PecaDeFoto[] = [];
  (Array.isArray(bruto) ? bruto : []).forEach((x) => {
    const p = normalizarPecaDeFoto(x);
    if (p && !saida.some((y) => y.chave === p.chave)) saida.push(p);
  });
  return saida;
}

export function usePecasDeFoto(clientId: string, marcaId: string | null = null, ativo = true) {
  return useQuery({
    queryKey: chaveDasPecasDeFoto(clientId, marcaId),
    enabled: ativo && !!clientId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<PecaDeFoto[]> => normalizarPecasDeFoto(await chamarFuncao<unknown>("mesa-foto", { acao: "pecas_de_foto", client_id: clientId })),
  });
}

// ------------------------------------------------------------------ endereço direto

export type PedidoDePeca = { tipo: "peca"; proposta_id: string; indice: number } | { tipo: "task"; task_id: string };

/**
 * A peça pedida no endereço: ?peca=<proposta_id>:<indice> ou ?task=<task_id>.
 * O task= só vale fora da etapa agenda (lá ele é o post da Agenda).
 */
export function lerPecaDoEndereco(params: Pick<URLSearchParams, "get">): PedidoDePeca | null {
  const peca = lerChaveDaPeca(params.get("peca"));
  if (peca) return { tipo: "peca", proposta_id: peca.proposta_id, indice: peca.indice };
  const task = (params.get("task") || "").trim();
  if (task && params.get("etapa") !== "agenda" && UUID_DA_PECA.test(task)) return { tipo: "task", task_id: task.toLowerCase() };
  return null;
}

/** A peça da lista que o endereço pediu (ou null). */
export function acharPeca(pecas: PecaDeFoto[], pedido: PedidoDePeca | null): PecaDeFoto | null {
  if (!pedido) return null;
  if (pedido.tipo === "peca") return pecas.find((p) => p.proposta_id.toLowerCase() === pedido.proposta_id && p.indice === pedido.indice) || null;
  return pecas.find((p) => !!p.task_id && p.task_id.toLowerCase() === pedido.task_id) || null;
}

// ------------------------------------------------------------------ textos

const dataCurta = (dia: string | null) => {
  if (!dia) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  return m ? `${m[3]}/${m[2]}` : "";
};

/** "12/10" (ou vazio). */
export const rotuloDaData = (p: Pick<PecaDeFoto, "data">) => dataCurta(p.data);

/** Uma linha curta da direção: "3 fotos · Frontal, 3/4 · Natural". */
export function resumoDaDirecao(f: DirecaoDaFoto): string {
  const partes = [`${f.quantidade} ${f.quantidade === 1 ? "foto" : "fotos"}`];
  if (f.angulos.length) partes.push(f.angulos.slice(0, 3).join(", "));
  if (f.luz) partes.push(f.luz);
  return partes.join(" · ");
}

/** O pedido ao diretor de fotografia com a direção da peça (vai para o campo dele, para revisar). */
export function pedidoAoDiretorDaPeca(p: PecaDeFoto, modelo: string | null = null): string {
  const f = p.foto;
  const linhas = [`Peça de foto do mês${p.data ? ` (${dataCurta(p.data)})` : ""}: ${p.titulo}.`];
  linhas.push(`Assunto: ${f.assunto}.`);
  if (f.objetivo) linhas.push(`Objetivo: ${f.objetivo}.`);
  linhas.push(`Quantidade: ${f.quantidade} ${f.quantidade === 1 ? "foto" : "fotos"}, nos ângulos: ${f.angulos.join(", ")}.`);
  if (f.cenario) linhas.push(`Cenário: ${f.cenario}.`);
  if (f.luz) linhas.push(`Luz: ${f.luz}.`);
  if (modelo) linhas.push(`Pessoa: use a modelo ${modelo}${f.pessoa ? ` (${f.pessoa})` : ""}.`);
  else linhas.push(f.pessoa ? `Pessoa: ${f.pessoa}.` : "Sem pessoa na foto.");
  if (f.texto_na_foto) linhas.push(`Deixe respiro para o texto "${f.texto_na_foto}" (não escreva o texto na foto).`);
  if (f.referencias.length) linhas.push(`Referências: ${f.referencias.join("; ")}.`);
  linhas.push("Monte o plano com o produto do cliente e me mostre o custo antes de gerar.");
  return linhas.join("\n");
}

/** A direção da peça para uma caixa nova do Canvas (pedido, cenário, câmera, luz, variações). */
export function direcaoParaOCanvas(p: PecaDeFoto, kitId: string | null = null, pessoa: DadosDoNo | null = null): DirecaoParaACaixa {
  const f = p.foto;
  const pedido = [
    f.assunto,
    f.objetivo ? `Objetivo: ${f.objetivo}.` : "",
    f.angulos.length > 1 ? `Ângulos da série: ${f.angulos.join(", ")}.` : "",
    f.pessoa ? `Pessoa: ${f.pessoa}.` : "",
    f.texto_na_foto ? `Deixe respiro para o texto "${f.texto_na_foto}", sem escrever o texto na foto.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    pedido,
    cenario: f.cenario,
    camera: cameraPeloTexto(f.angulos[0] || ""),
    luz: luzPeloTexto(f.luz),
    variacoes: lerVariacoes(Math.max(1, f.quantidade - 1)),
    kit_id: kitId,
    titulo: p.titulo,
    pessoa,
  };
}

// ------------------------------------------------------------------ peça levada ao Canvas

export const chaveDaPecaNoCanvas = (clientId: string) => `mesa-foto:canvas:peca:${clientId}`;

/** A peça guardada para o Canvas, com a pessoa escolhida no seletor de modelo (ou null). */
export type PecaLevada = PecaDeFoto & { pessoa: DadosDoNo | null };

/** Guarda a peça (e a pessoa escolhida) para o Canvas abrir com ela numa caixa nova (vale por 10 minutos). */
export function levarPecaAoCanvas(clientId: string, p: PecaDeFoto, pessoa: DadosDoNo | null = null) {
  try {
    window.sessionStorage.setItem(chaveDaPecaNoCanvas(clientId), JSON.stringify({ peca: p, pessoa, em: Date.now() }));
  } catch {
    /* sem armazenamento: a pessoa monta a caixa à mão */
  }
}

/** A peça guardada para o Canvas (lê uma vez só). */
export function lerPecaLevadaAoCanvas(clientId: string): PecaLevada | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(chaveDaPecaNoCanvas(clientId)) || "null");
    window.sessionStorage.removeItem(chaveDaPecaNoCanvas(clientId));
    if (!v || Date.now() - Number(v.em || 0) > 10 * 60_000) return null;
    const peca = normalizarPecaDeFoto(v.peca);
    return peca ? { ...peca, pessoa: v.pessoa && typeof v.pessoa === "object" ? (v.pessoa as DadosDoNo) : null } : null;
  } catch {
    return null;
  }
}
