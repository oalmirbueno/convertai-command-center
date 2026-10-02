import { supabase } from "@/integrations/supabase/client";
import type { DadosDoNo } from "../canvasApi";
import type { FotoDoAcervo, KitDeFoto, ModoDePreparo } from "../fotoApi";
import { capaDoProduto, produtoDaFoto } from "../seletores/seletores";

/**
 * Preparar imagens (02/10/2026; dono: "quero só editar imagens: selecionar,
 * editar e salvar editadas; depois comparar antes e depois e poder apagar o
 * antes e ficar só com o resultado; mesma lógica para fotos, produtos e
 * artes; tudo sincronizado para os vídeos e os outros motores").
 *
 * - Editar usa as ações que a função já tem (preparar: tirar fundo, fundo
 *   branco, luz e cor, limpar, cenário; upscale e tirar fundo pro). Cada uma
 *   grava uma versão NOVA no acervo com derivada_de = a original (a
 *   linhagem fica), marcada como editada. O original nunca muda.
 * - "Ficar com o depois" arquiva o antes (ativa = false, volta com Desfazer):
 *   nunca apaga de verdade. Foto que é referência de um produto não é
 *   arquivada (o produto depende dela).
 * - O acervo é um só (cliente_imagens): a Mesa Vídeos, a Motion e o Estúdio
 *   leem o mesmo, então a versão editada aparece lá sem cópia.
 */

/** As edições de um clique (todas viram versão nova no acervo). */
export const EDICOES_RAPIDAS: { modo: ModoDePreparo; rotulo: string; dica: string }[] = [
  { modo: "fundo_transparente", rotulo: "Tirar fundo", dica: "PNG sem fundo, o assunto como está." },
  { modo: "fundo_branco", rotulo: "Fundo branco", dica: "Fundo de estúdio branco com sombra suave." },
  { modo: "luz_cor", rotulo: "Luz e cor", dica: "Acerta luz, contraste e cor sem mudar o assunto." },
  { modo: "limpar", rotulo: "Limpar", dica: "Tira sujeira, poeira e distrações pequenas." },
];

/** Dá para ficar só com o depois (arquivar o antes)? */
export function podeFicarComODepois(antesId: string, kits: KitDeFoto[]): { ok: boolean; motivo: string | null } {
  const kit = produtoDaFoto(kits, antesId);
  if (kit) return { ok: false, motivo: `É foto do produto ${kit.nome}: ela fica guardada.` };
  return { ok: true, motivo: null };
}

/** Na lista do que está sendo editado, o depois toma o lugar do antes (sem repetir). */
export function trocarNaLista(ids: string[], antes: string, depois: string): string[] {
  const saida: string[] = [];
  ids.forEach((id) => {
    const novo = id === antes ? depois : id;
    if (saida.indexOf(novo) < 0) saida.push(novo);
  });
  if (saida.indexOf(depois) < 0) saida.push(depois);
  return saida;
}

/** A versão nova veio mesmo da foto aberta? (a linhagem que a função grava) */
export const ehVersaoDe = (nova: Pick<FotoDoAcervo, "derivada_de"> | null, antesId: string) => !!nova && nova.derivada_de === antesId;

/**
 * O que vai para a edição: as imagens marcadas e a capa de cada produto
 * marcado (editar o produto é editar a foto dele), sem repetir.
 */
export function imagensParaEditar(imagemIds: string[], kitIds: string[], kits: KitDeFoto[]): string[] {
  const saida: string[] = [];
  imagemIds.forEach((id) => {
    if (id && saida.indexOf(id) < 0) saida.push(id);
  });
  kitIds.forEach((kid) => {
    const k = kits.find((x) => x.id === kid);
    const capa = k ? capaDoProduto(k) : null;
    if (capa && saida.indexOf(capa) < 0) saida.push(capa);
  });
  return saida;
}

/** Arquiva (ativa = false) ou volta (ativa = true) uma foto do acervo do cliente. Nunca apaga. */
export async function mudarAtivaDaFoto(clientId: string, imagemId: string, ativa: boolean): Promise<void> {
  const { error } = await (supabase as any).from("cliente_imagens").update({ ativa }).eq("id", imagemId).eq("client_id", clientId);
  if (error) throw error;
}

// ------------------------------------------------------------------ escolha levada ao Canvas

export interface SelecaoParaOCanvas {
  kit_ids: string[];
  imagem_ids: string[];
  /** O cartão Pessoa (modelo da IA ou clone autorizado). */
  pessoa: DadosDoNo | null;
}

export const chaveDaSelecaoNoCanvas = (clientId: string) => `mesa-foto:canvas:selecao:${clientId}`;

export function levarSelecaoAoCanvas(clientId: string, s: SelecaoParaOCanvas) {
  try {
    window.sessionStorage.setItem(chaveDaSelecaoNoCanvas(clientId), JSON.stringify({ selecao: s, em: Date.now() }));
  } catch {
    /* sem armazenamento: a pessoa põe os cartões à mão */
  }
}

/** A escolha guardada para o Canvas (lê uma vez só; vale por 10 minutos). */
export function lerSelecaoLevadaAoCanvas(clientId: string): SelecaoParaOCanvas | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(chaveDaSelecaoNoCanvas(clientId)) || "null");
    window.sessionStorage.removeItem(chaveDaSelecaoNoCanvas(clientId));
    if (!v || !v.selecao || Date.now() - Number(v.em || 0) > 10 * 60_000) return null;
    const s = v.selecao;
    const ids = (x: unknown) => (Array.isArray(x) ? x.filter((y) => typeof y === "string" && !!y).slice(0, 12) : []);
    const pessoa = s.pessoa && typeof s.pessoa === "object" ? (s.pessoa as DadosDoNo) : null;
    const sel = { kit_ids: ids(s.kit_ids), imagem_ids: ids(s.imagem_ids), pessoa };
    return sel.kit_ids.length || sel.imagem_ids.length || sel.pessoa ? sel : null;
  } catch {
    return null;
  }
}
