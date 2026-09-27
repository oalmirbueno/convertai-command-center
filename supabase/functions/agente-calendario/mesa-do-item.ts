/**
 * Formato do perfil do cliente no plano do mês (frente MF, 27/09).
 *
 * Dono: "quando qualquer cliente quiser só fotos no perfil a gente faz só
 * fotos por ali, ou alternar a gente usa as duas mesas, mas de forma
 * inteligente que entenda e não confusão".
 *
 * - mesa_cliente_config.formato_do_perfil (SQL MF-01): "fotos", "artes" ou
 *   "alternar". Sem a coluna (SQL ainda não aplicado) ou sem valor: "artes",
 *   o que sempre foi.
 * - Cada item gravado na Agenda ganha a mesa que o faz (item.mesa, na
 *   proposta): "foto" (Mesa Foto, post de fotos) ou "arte" (Estúdio).
 * - "alternar": o Jev (Choice, uma pergunta por item, todas na mesma
 *   chamada) diz se o conteúdo se sustenta como fotografia real ou precisa de
 *   arte com texto; o código equilibra metade e metade pela probabilidade de
 *   foto. Sem o Jev, alterna pela data (arte, foto, arte...). O que a equipe
 *   já marcou no item fica.
 * - Item de fotos ganha o post de fotos reservado (sem fotos ainda) e NÃO
 *   ganha direção de arte no Estúdio. Abre na Mesa Foto.
 *
 * As regras puras (perguntas, equilíbrio, texto do plano) ficam em
 * mesa-do-item-regras.ts; aqui, banco, Jev e cobrança.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { cobrarJev } from "../_shared/ia-motor.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { formatoDoPerfil, type FormatoDoPerfil, reservarPostDeFotos } from "../_shared/post-de-fotos.ts";
import { equilibrarMesas, type ItemComMesa, perguntasDaMesa, textoDoPerfilParaOPlano } from "./mesa-do-item-regras.ts";

export { equilibrarMesas, perguntasDaMesa, textoDoPerfilParaOPlano };
export type { ItemComMesa };

/** O formato do perfil gravado para o cliente (sem coluna ou sem valor: "artes"). */
export async function lerFormatoDoPerfil(servico: SupabaseClient, clientId: string): Promise<FormatoDoPerfil> {
  try {
    const { data, error } = await servico.from("mesa_cliente_config").select("formato_do_perfil").eq("client_id", clientId).maybeSingle();
    if (error || !data) return "artes";
    return formatoDoPerfil((data as { formato_do_perfil?: unknown }).formato_do_perfil);
  } catch {
    return "artes";
  }
}

/**
 * Marca a mesa de cada item (muda os objetos da lista). Devolve o custo do
 * Jev e de onde veio a decisão. "fotos" e "artes" não chamam IA.
 */
export async function marcarMesasDoPlano(
  servico: SupabaseClient,
  clientId: string,
  itens: ItemComMesa[],
  cobranca: { referencia: { tipo: string; id: string }; criadoPor: string | null },
): Promise<{ perfil: FormatoDoPerfil; custo: number; fonte: "perfil" | "jev" | "regra" }> {
  const perfil = await lerFormatoDoPerfil(servico, clientId);
  if (!itens.length) return { perfil, custo: 0, fonte: "perfil" };
  if (perfil !== "alternar") {
    itens.forEach((i) => {
      if (!i.mesa) i.mesa = perfil === "fotos" ? "foto" : "arte";
    });
    return { perfil, custo: 0, fonte: "perfil" };
  }
  // Na ordem das datas: o equilíbrio e a alternância seguem o calendário.
  const ordem = itens.map((i, k) => ({ i, k })).sort((a, b) => String(a.i.data).localeCompare(String(b.i.data)) || a.k - b.k).map((x) => x.i);
  const fixas = ordem.map((i) => (i.mesa === "foto" || i.mesa === "arte" ? i.mesa : null));
  const livres = ordem.filter((i) => !i.mesa);
  let prob: Array<number | null> = ordem.map(() => null);
  let custo = 0;
  let fonte: "jev" | "regra" = "regra";
  if (livres.length) {
    try {
      const { state, questions } = perguntasDaMesa(livres);
      const r = await jevPerguntar({ state, questions }, { timeoutMs: 8_000 });
      const cobrado = await cobrarJev(r, { clientId, tarefa: "calendario", referencia: cobranca.referencia, criadoPor: cobranca.criadoPor }).catch(() => null);
      custo = cobrado ? cobrado.custoUsd : 0;
      prob = ordem.map((i) => {
        const k = livres.indexOf(i);
        if (k < 0) return null;
        const a = r.answers[`mesa_${k}`];
        const p = a && a.probabilities ? Number(a.probabilities.foto) : NaN;
        return isFinite(p) ? p : null;
      });
      fonte = "jev";
    } catch {
      prob = ordem.map(() => null);
    }
  }
  const mesas = equilibrarMesas(prob, fixas);
  ordem.forEach((i, k) => {
    i.mesa = mesas[k];
  });
  return { perfil, custo, fonte };
}

/** Itens de fotos com item na Agenda ganham o post de fotos reservado (sem fotos ainda). */
export async function reservarPostsDoPlano(servico: SupabaseClient, clientId: string, itens: ItemComMesa[], userId: string): Promise<number> {
  let n = 0;
  for (const i of itens) {
    if (i.mesa !== "foto" || !i.task_id) continue;
    const r = await reservarPostDeFotos(servico as unknown as Parameters<typeof reservarPostDeFotos>[0], {
      clientId,
      taskId: i.task_id,
      titulo: i.tema,
      userId,
    }).catch(() => ({ trabalho_id: null, criado: false }));
    if (r.criado) n++;
  }
  return n;
}
