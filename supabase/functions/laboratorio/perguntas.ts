/**
 * laboratorio: perguntas guiadas antes de montar um projeto completo (v3, clickmax-rea.md, item 3).
 *
 * O Jev (TypeSafe, 4 perguntas Noul juntas, sobre o mesmo estado) diz se o pedido já traz o essencial:
 * produto/oferta, público, preço/ticket e objetivo. O que falta vira até 4 perguntas com exemplos, e o
 * planejar devolve as perguntas em vez de operações. Sem o Jev (sem chave, fora do ar), vale a pista fixa
 * do texto (regras.ts). Falha nunca trava o pedido: no pior caso, monta sem perguntar.
 */
import { jevPerguntar, probabilidadeNoul, type ResultadoJev } from "../_shared/jev.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { type PerguntaGuiada, perguntasDoJevSobreOEssencial, perguntasQueFaltam } from "./modulos/regras.ts";

export type Perguntador = (estado: unknown, perguntas: ReturnType<typeof perguntasDoJevSobreOEssencial>) => Promise<ResultadoJev>;
export type Cobrador = (r: ResultadoJev) => Promise<number>;

export type ResultadoDasPerguntas = { perguntas: PerguntaGuiada[]; fonte: "jev" | "pista"; custo_usd: number };

export async function perguntasGuiadas(
  o: { pedido: string; contexto?: string | null; respostas?: string | null },
  portas: { perguntar?: Perguntador; cobrar?: Cobrador } = {},
): Promise<ResultadoDasPerguntas> {
  const todoTexto = [o.pedido, o.contexto || "", o.respostas || ""].join("\n");
  const perguntar: Perguntador = portas.perguntar || ((state, questions) => jevPerguntar({ state, questions }, { timeoutMs: 12_000 }));
  try {
    const r = await perguntar(
      { pedido: o.pedido.slice(0, 4000), contexto_do_projeto: (o.contexto || "").slice(0, 4000) || null, respostas: (o.respostas || "").slice(0, 4000) || null },
      perguntasDoJevSobreOEssencial(),
    );
    const custo = portas.cobrar ? await portas.cobrar(r).catch(() => 0) : 0;
    const probs: Record<string, number | null> = {};
    for (const id of Object.keys(r.answers || {})) probs[id] = probabilidadeNoul(r.answers[id]);
    return { perguntas: perguntasQueFaltam(todoTexto, probs), fonte: "jev", custo_usd: custo };
  } catch (e) {
    registrarFalha("laboratorio: Jev não avaliou o essencial do pedido (vale a pista do texto)", e);
    return { perguntas: perguntasQueFaltam(todoTexto, null), fonte: "pista", custo_usd: 0 };
  }
}
