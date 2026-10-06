/**
 * Regras puras do formato do perfil no plano do mês (frente MF, 27/09): as
 * perguntas do Jev no "alternar", o equilíbrio metade e metade e o texto que
 * o planejador lê. Sem import de Deno nem de npm: mesa-do-item.ts (banco e
 * Jev) e os testes (vitest) leem este arquivo.
 */
import type { PerguntaJev } from "../_shared/jev.ts";
import type { FormatoDoPerfil, MesaDoItem } from "../_shared/post-de-fotos.ts";

export type ItemComMesa = {
  tema_id?: string;
  data: string;
  tema: string;
  resumo?: string;
  gancho?: string;
  formato?: string;
  tipo_conteudo?: string;
  instrucao_arte?: string;
  task_id?: string | null;
  cards?: Array<{ texto?: string; ilustracao?: string }>;
  mesa?: MesaDoItem | "video" | null;
};

/** O que o planejador lê do perfil (só quando não é "artes": o padrão fica como sempre foi). */
export function textoDoPerfilParaOPlano(perfil: FormatoDoPerfil): string | null {
  if (perfil === "fotos") {
    return "Só fotos: todo post deste cliente é fotografia real (produto, bastidor, ambiente, pessoas, resultado), feito na Mesa Foto, sem arte e sem texto na imagem. O texto vai na legenda; cards e instrução de arte descrevem as fotos.";
  }
  if (perfil === "alternar") {
    return "Alternar: o mês mistura posts de fotografia real (Mesa Foto, sem texto na imagem: bastidor, produto, ambiente, resultado) e posts de arte do Estúdio (dica, lista, passo a passo, dado). Planeje metade de cada.";
  }
  return null;
}

/** Perguntas do Jev para o "alternar": uma Choice por item, todas numa chamada. */
export function perguntasDaMesa(itens: ItemComMesa[]): { state: Record<string, unknown>; questions: Record<string, PerguntaJev> } {
  const state = {
    itens: itens.map((i, k) => ({
      n: k + 1,
      tema: String(i.tema || "").slice(0, 200),
      gancho: String(i.gancho || "").slice(0, 200),
      resumo: String(i.resumo || "").slice(0, 400),
      formato: i.formato || null,
      tipo: i.tipo_conteudo || null,
      instrucao_de_arte: String(i.instrucao_arte || "").slice(0, 300),
      laminas: (i.cards || []).slice(0, 6).map((c) => String(c.texto || c.ilustracao || "").slice(0, 120)),
    })),
  };
  const questions: Record<string, PerguntaJev> = {};
  itens.forEach((_, k) => {
    questions[`mesa_${k}`] = {
      type: "choice",
      instructions: `O post \`itens[${k}]\` de um perfil do Instagram funciona melhor como fotografia real ou como arte gráfica com texto?`,
      criteria: {
        foto: "Se sustenta com fotografia real, sem texto na imagem: produto, bastidor, ambiente, pessoa, antes e depois, resultado, momento da marca. O texto cabe na legenda.",
        arte: "Precisa de texto, dado, lista, passo a passo, comparação, citação ou design gráfico na imagem para ser entendido.",
      },
    };
  });
  return { state, questions };
}

/**
 * Metade e metade pela probabilidade de foto (a mais "foto" vai para a Mesa
 * Foto). Sem nota nenhuma (sem o Jev): alterna pela ordem das datas (arte,
 * foto, arte...). `fixas` são as marcadas pela equipe (entram na conta e não
 * mudam).
 */
export function equilibrarMesas(probFoto: Array<number | null>, fixas: Array<MesaDoItem | null>): MesaDoItem[] {
  const n = probFoto.length;
  const alvoFotos = Math.round(n / 2);
  const saida: Array<MesaDoItem | null> = fixas.slice(0, n);
  while (saida.length < n) saida.push(null);
  const jaFotos = saida.filter((m) => m === "foto").length;
  const livres = saida.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
  const faltam = Math.max(0, alvoFotos - jaFotos);
  if (probFoto.every((p) => p === null)) {
    livres.forEach((i, k) => {
      saida[i] = k % 2 === 1 && k < faltam * 2 ? "foto" : "arte";
    });
    return saida as MesaDoItem[];
  }
  const ordenados = livres.slice().sort((a, b) => {
    const pa = probFoto[a];
    const pb = probFoto[b];
    if (pa === null && pb === null) return a - b;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pb - pa || a - b;
  });
  ordenados.forEach((i, k) => {
    saida[i] = k < faltam ? "foto" : "arte";
  });
  return saida as MesaDoItem[];
}
