import { ListChecks } from "lucide-react";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import {
  IDS_DOS_METODOS,
  ROTULOS_DOS_METODOS,
  type Caminho,
  type IdDoMetodo,
} from "../../../supabase/functions/_shared/superpoderes-catalogo";

/**
 * "Método: brainstorm, plano, verificação" embaixo da resposta do agente
 * (frente SPP, 30/09/2026). Lê o anexo `metodo_usado` que o servidor grava
 * (_shared/superpoderes.ts, anexoDoMetodo): os métodos da casa que o agente
 * seguiu nesta resposta, adaptados de obra/superpowers (licença MIT).
 *
 * Uma linha, 12 px, cinza, sem caixa. Prova que faltou ("disse pronto sem
 * ação feita") vira "verificação pendente" com o "?" que explica.
 */

export const TIPO_DO_ANEXO_METODO = "metodo_usado";

export interface MetodoUsado {
  tipo: typeof TIPO_DO_ANEXO_METODO;
  ids: IdDoMetodo[];
  fonte: "declarado" | "injetado";
  caminho: Caminho | null;
  prova: "ok" | "faltou" | "nao_se_aplica";
  versao: string | null;
}

export function metodoUsadoDosAnexos(anexos: unknown): MetodoUsado | null {
  if (!Array.isArray(anexos)) return null;
  const a = anexos.find((x) => x && typeof x === "object" && (x as { tipo?: unknown }).tipo === TIPO_DO_ANEXO_METODO) as Record<string, unknown> | undefined;
  if (!a) return null;
  const lista = Array.isArray(a.ids) ? a.ids.map((x) => String(x)) : [];
  const ids = IDS_DOS_METODOS.filter((id) => lista.indexOf(id) >= 0);
  const prova = a.prova === "faltou" ? "faltou" : a.prova === "ok" ? "ok" : "nao_se_aplica";
  if (!ids.length && prova !== "faltou") return null;
  return {
    tipo: TIPO_DO_ANEXO_METODO,
    ids,
    fonte: a.fonte === "injetado" ? "injetado" : "declarado",
    caminho: typeof a.caminho === "string" ? (a.caminho as Caminho) : null,
    prova,
    versao: typeof a.versao === "string" ? a.versao : null,
  };
}

/** Os rótulos na ordem do catálogo; a verificação que faltou vira "verificação pendente". */
export function rotulosDoMetodo(m: MetodoUsado): string[] {
  const saida: string[] = [];
  // A ordem da frase é a do trabalho: entender, planejar, fazer, verificar.
  const ordem: IdDoMetodo[] = ["entender", "plano", "aceite", "causa", "receber", "revisor", "frentes", "prova"];
  for (const id of ordem) {
    if (id === "prova") continue;
    if (m.ids.indexOf(id) >= 0) saida.push(ROTULOS_DOS_METODOS[id]);
  }
  if (m.prova === "faltou") saida.push(`${ROTULOS_DOS_METODOS.prova} pendente`);
  else if (m.ids.indexOf("prova") >= 0) saida.push(ROTULOS_DOS_METODOS.prova);
  return saida;
}

export default function MetodoDoAgente({ anexos }: { anexos: unknown }) {
  const m = metodoUsadoDosAnexos(anexos);
  if (!m) return null;
  const rotulos = rotulosDoMetodo(m);
  if (!rotulos.length) return null;
  return (
    <p className="flex min-w-0 items-start text-[12px] leading-snug text-muted-foreground" data-metodo-do-agente={m.ids.join(",")} data-prova={m.prova}>
      <ListChecks className="mr-1.5 mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-medium text-foreground">Método:</span> {rotulos.join(", ")}
      </span>
      {m.prova === "faltou" && (
        <AjudaRecolhida rotulo="Por que a verificação ficou pendente?" className="ml-1 shrink-0">
          A resposta disse que algo já estava feito, mas nenhuma ação foi executada nesta mensagem. Por isso o agente avisou
          "Ainda não fiz". Para fazer de verdade, peça a ação: o cartão aparece com Confirmar.
        </AjudaRecolhida>
      )}
    </p>
  );
}
