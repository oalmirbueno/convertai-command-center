import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import TituloRecolhivel from "./TituloRecolhivel";
import { botao, juntar, lista } from "./estilos";

/**
 * Motor de copy da casa (frente CPY, 30/09): a nota de cada variação (código
 * e Jev: voz da marca, força, fato inventado, promessa proibida, clichê de IA)
 * e as outras variações escritas junto, para trocar com um clique. A
 * conferência é aviso: nada muda sozinho.
 */

export interface OpcaoDaCopy {
  texto: string;
  nota?: number | null;
  alerta?: boolean;
  avisos?: string[];
  framework?: string | null;
}

/** As variações na resposta da função (`opcoes`, da melhor para a pior); `campo` é onde mora o texto. */
export function opcoesDaResposta(data: unknown, campo = "legenda"): OpcaoDaCopy[] {
  const itens = data && typeof data === "object" && Array.isArray((data as { opcoes?: unknown }).opcoes) ? (data as { opcoes: unknown[] }).opcoes : [];
  return itens
    .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : {}))
    .filter((o) => typeof o[campo] === "string" && String(o[campo]).trim() !== "")
    .map((o) => ({
      texto: String(o[campo]),
      nota: typeof o.nota === "number" ? o.nota : null,
      alerta: o.alerta === true,
      avisos: Array.isArray(o.avisos) ? (o.avisos as unknown[]).map(String) : [],
      framework: typeof o.framework === "string" ? o.framework : null,
    }));
}

const NOME_DO_FRAMEWORK: Record<string, string> = { aida: "AIDA", pas: "PAS", bab: "BAB", "4u": "4U", gcc: "Gancho, corpo e CTA" };

/** "Nota 82" e os avisos, numa linha pequena (o detalhe fica no title). */
export function NotaDaCopy({ nota, alerta, avisos, framework }: Omit<OpcaoDaCopy, "texto">) {
  if (typeof nota !== "number" && !(avisos && avisos.length)) return null;
  const todos = avisos || [];
  return (
    <p className={`mt-1 text-[11px] leading-snug ${alerta ? "text-warning" : "text-muted-foreground"}`} title={todos.join("\n") || undefined} data-nota-da-copy>
      {alerta && <AlertTriangle className="mr-1 inline h-3 w-3 align-[-2px]" />}
      {typeof nota === "number" && <span className="mr-1 font-medium">Nota {nota}</span>}
      {framework && NOME_DO_FRAMEWORK[framework] && <span className="mr-1">· {NOME_DO_FRAMEWORK[framework]}</span>}
      {todos.length > 0 && <span>· {todos[0]}{todos.length > 1 ? ` (+${todos.length - 1})` : ""}</span>}
    </p>
  );
}

/**
 * Avisos do texto de um item do Mês ou da Campanha (lâminas e legenda pelo
 * motor de copy): uma linha recolhida "N avisos no texto" que abre a lista.
 * Aviso, nunca bloqueio: o item segue igual.
 */
export function AvisosDoTexto({ avisos, className = "" }: { avisos?: unknown; className?: string }) {
  const [aberto, setAberto] = useState(false);
  const todos = Array.isArray(avisos) ? (avisos as unknown[]).map(String).filter((a) => a.trim() !== "") : [];
  if (!todos.length) return null;
  return (
    <div className={juntar("min-w-0", className)} data-avisos-do-texto="">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="inline-flex min-w-0 items-center text-left text-[11px] leading-snug text-warning hover:underline"
      >
        <AlertTriangle className="mr-1 h-3 w-3 shrink-0" />
        {todos.length === 1 ? "1 aviso no texto" : `${todos.length} avisos no texto`}
      </button>
      {aberto && (
        <ul className={juntar(lista.divisoria, "mt-1 min-w-0")}>
          {todos.map((a, i) => (
            <li key={i} className="break-words py-1 text-[11px] leading-snug text-muted-foreground">
              {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** As outras variações, recolhidas; "Usar esta" troca o texto no campo. */
export default function OpcoesDaCopy({ opcoes, atual, bloqueado = false, onUsar }: { opcoes: OpcaoDaCopy[]; atual: string; bloqueado?: boolean; onUsar: (texto: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const outras = opcoes.filter((o) => o.texto && o.texto.trim() !== atual.trim());
  if (!outras.length) return null;
  return (
    <div className="min-w-0" data-opcoes-da-copy>
      <TituloRecolhivel
        titulo={`Outras ${outras.length === 1 ? "opção" : `${outras.length} opções`} escritas junto`}
        recolhido={!aberto}
        onAlternar={() => setAberto((a) => !a)}
      />
      {aberto && (
        <ol className={juntar(lista.aberta, lista.divisoria, "mt-1")}>
          {outras.map((o, i) => (
            <li key={i} className="flex min-w-0 items-start px-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{o.texto}</p>
                <NotaDaCopy nota={o.nota} alerta={o.alerta} avisos={o.avisos} framework={o.framework} />
              </div>
              <button type="button" className={juntar(botao.secundario, "ml-3 h-7 px-2.5 text-[12px]")} disabled={bloqueado} onClick={() => onUsar(o.texto)}>
                Usar esta
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
