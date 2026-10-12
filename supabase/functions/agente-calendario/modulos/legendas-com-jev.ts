/**
 * Legendas do plano do Mês conferidas pelo Jev (12/10/2026). Antes o Mês só tinha a conferência em
 * código (legenda-do-item.ts); agora, quando a proposta fica pronta, as legendas passam pelo mesmo
 * motor do Estúdio (voz da marca, fato inventado, promessa proibida, clichê e marca de texto de IA).
 *
 * Regra "sem laço de correção": nada é reescrito; o que o Jev vê vira aviso no item (avisos_de_texto),
 * que a equipe lê antes de aprovar. Lotes de 8 legendas por chamada. Nunca lança: sem o Jev, ficam só
 * os avisos em código que o item já tinha.
 */
import { conferirCopies, vozDaMarca } from "../../_shared/motor-de-copy-servidor.ts";
import { objetivoDaCopy } from "../../_shared/motor-de-copy.ts";
import { registrarFalha } from "../../_shared/falha-registrada.ts";

type ItemComLegenda = { copy?: unknown; objetivo?: unknown; avisos_de_texto?: string[] };
type Banco = { from: (tabela: string) => any };

const LOTE = 8;
/** Os avisos que só o Jev dá (os de código o item já tem). */
const DO_JEV = /^(O Jev|Soa como texto genérico|Pouco da voz da marca)/;

export async function conferirLegendasComJev(db: Banco, itens: ItemComLegenda[], cobranca: { clientId: string; criadoPor?: string | null; referenciaId?: string | null }): Promise<{ conferidas: number; custo_usd: number }> {
  const comTexto = itens.map((it, i) => ({ it, i, texto: typeof it.copy === "string" ? it.copy.trim() : "" })).filter((x) => x.texto);
  if (!comTexto.length) return { conferidas: 0, custo_usd: 0 };
  let custo = 0;
  try {
    const voz = await vozDaMarca(db, cobranca.clientId, null, 2500);
    const lotes: (typeof comTexto)[] = [];
    for (let k = 0; k < comTexto.length; k += LOTE) lotes.push(comTexto.slice(k, k + LOTE));
    // Três lotes por vez: um plano de 30 legendas não espera 4 chamadas em fila.
    const umLote = async (lote: typeof comTexto) => {
      const r = await conferirCopies({
        textos: lote.map((x) => x.texto),
        canal: "legenda",
        objetivo: objetivoDaCopy(lote[0].it.objetivo),
        voz,
        semHashtags: false,
        cortar: false,
        cobranca: { clientId: cobranca.clientId, tarefa: "calendario", referencia: cobranca.referenciaId ? { tipo: "calendario_proposta", id: cobranca.referenciaId } : undefined, criadoPor: cobranca.criadoPor ?? null },
      });
      custo += r.custo_usd;
      if (r.jev_erro) return;
      lote.forEach((x, j) => {
        const c = r.conferencias[j];
        const novos = c.avisos.filter((a) => DO_JEV.test(a)).map((a) => `Legenda: ${a}`);
        if (!novos.length) return;
        const antes = Array.isArray(x.it.avisos_de_texto) ? x.it.avisos_de_texto : [];
        x.it.avisos_de_texto = [...antes, ...novos.filter((a) => antes.indexOf(a) < 0)];
      });
    };
    for (let k = 0; k < lotes.length; k += 3) await Promise.all(lotes.slice(k, k + 3).map(umLote));
  } catch (e) {
    registrarFalha("agente-calendario: Jev das legendas do plano falhou (ficam os avisos em código)", e, { client_id: cobranca.clientId });
  }
  return { conferidas: comTexto.length, custo_usd: Math.round(custo * 1e6) / 1e6 };
}
