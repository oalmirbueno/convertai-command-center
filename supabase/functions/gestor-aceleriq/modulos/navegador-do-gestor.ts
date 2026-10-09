/**
 * Consulta "navegador" do Gestor (lote C, 09/10/2026): o Gestor lê uma página ou pesquisa na web
 * no navegador remoto real do cliente (o mesmo que a equipe vê ao vivo na Central e que o Hermes
 * comanda), pelo motor compartilhado (_shared/navegador-operacional.ts), com a trava de um agente
 * por vez e o registro com evidência. Só leitura: navegar e ler, ou pesquisar. Clicar, digitar e
 * qualquer ação que muda algo ficam com o Hermes (com aprovação quando sensível).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ESQUEMA_DAS_CONSULTAS, NOMES_DAS_CONSULTAS } from "../../_shared/consultas-do-agente.ts";
import { ErroDoNavegador, usarNavegador } from "../../_shared/navegador-operacional.ts";
import { ErroDoProvedor, provedorDoAmbiente } from "../../navegador-remoto/provedor.ts";

export const CONSULTA_DO_NAVEGADOR = "navegador";
/** Por rodada (cada leitura usa minutos do plano). */
export const MAX_NAVEGADOR_POR_RODADA = 2;

export const LINHA_DO_NAVEGADOR = `- ${CONSULTA_DO_NAVEGADOR}: abre uma página ou pesquisa na web no navegador remoto real do cliente (o mesmo que a equipe vê ao vivo na Central) e lê o que aparece. Use para conferir o site, o perfil público ou a concorrência do cliente, ou pesquisar um dado de fora. argumento: a URL (https://...) ou "pesquisar: termos"`;

/** O esquema das consultas do Gestor: as leituras do OS e o navegador. */
export const ESQUEMA_DAS_CONSULTAS_DO_GESTOR = {
  ...ESQUEMA_DAS_CONSULTAS,
  items: {
    ...ESQUEMA_DAS_CONSULTAS.items,
    properties: {
      ...ESQUEMA_DAS_CONSULTAS.items.properties,
      ferramenta: { type: "string", enum: [...NOMES_DAS_CONSULTAS, CONSULTA_DO_NAVEGADOR] },
    },
  },
};

/** Os pedidos de navegador que o modelo fez (argumento limpo, sem repetir). */
export function pedidosDoNavegador(bruto: unknown): string[] {
  const saida: string[] = [];
  for (const x of Array.isArray(bruto) ? bruto : []) {
    if (String((x as { ferramenta?: unknown })?.ferramenta || "") !== CONSULTA_DO_NAVEGADOR) continue;
    const a = String((x as { argumento?: unknown })?.argumento ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!a || saida.includes(a)) continue;
    saida.push(a);
    if (saida.length >= MAX_NAVEGADOR_POR_RODADA) break;
  }
  return saida;
}

/** Lê pelo navegador do cliente e devolve o texto da fonte. Nunca lança (o motivo vira o texto). */
export async function lerPeloNavegador(db: SupabaseClient, clientId: string, argumento: string, pergunta: string): Promise<string> {
  const p = provedorDoAmbiente();
  if (!p) return "Navegador remoto não está ligado (falta a conta do provedor).";
  const pesquisa = /^pesquisar\s*:\s*/i.test(argumento);
  try {
    const r = await usarNavegador(db, p, {
      clientId, agente: "gestor", acao: pesquisa ? "pesquisar" : "navegar",
      termos: pesquisa ? argumento.replace(/^pesquisar\s*:\s*/i, "") : null,
      url: pesquisa ? null : argumento,
      pedido: `Gestor: ${pergunta.slice(0, 300)}`,
    });
    if (pesquisa) {
      const lista = (r.resultados || []).slice(0, 8).map((x, i) => `${i + 1}. ${x.titulo} | ${x.link}\n${x.trecho}`).join("\n");
      return `Pesquisa no navegador do cliente: "${argumento.replace(/^pesquisar\s*:\s*/i, "")}"\n${lista || "Nenhum resultado."}`.slice(0, 6000);
    }
    return `Página aberta no navegador do cliente: ${r.titulo || ""} (${r.url || argumento})\n${(r.texto || "").slice(0, 5500)}`;
  } catch (e) {
    if (e instanceof ErroDoNavegador || e instanceof ErroDoProvedor) return `Navegador: ${e.message}`;
    return "Navegador indisponível agora.";
  }
}
