import type { ReactNode } from "react";
import { PreencherComIA, type CampoParaPreencher } from "@/components/sistema";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { juntar, texto } from "@/components/sistema/estilos";

type Fonte = "contexto" | "briefing" | "dossie" | "arquivos" | "conversa" | "web";

/**
 * Campo da Mesa Site com o ✨ do "Preencher com IA" na linha do rótulo (papel
 * `site`). A peça mostra a prévia e o custo; a mesa grava no onAplicar e
 * volta no onDesfazer.
 */
export default function CampoComIA({
  rotulo,
  campo,
  contexto,
  fontes,
  onAplicar,
  onDesfazer,
  children,
  className,
}: {
  rotulo: string;
  campo: CampoParaPreencher;
  contexto?: string;
  fontes?: Fonte[];
  onAplicar: (valor: unknown) => void | Promise<void>;
  onDesfazer?: (anterior: unknown) => void | Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  return (
    <div className={juntar("block min-w-0", className)}>
      <div className="mb-1 flex min-w-0 items-center">
        <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{rotulo}</span>
        <PreencherComIA
          papel="site"
          clientId={clientId}
          marcaId={marca ? marca.id : null}
          campos={[campo]}
          contexto={contexto}
          fontes={fontes}
          compacto
          rotulo={`Preencher ${rotulo.toLowerCase()} com IA`}
          onAplicar={(v) => onAplicar(v[campo.chave])}
          onDesfazer={onDesfazer ? (a) => onDesfazer(a[campo.chave]) : undefined}
        />
      </div>
      {children}
    </div>
  );
}

/** Texto de um valor que a IA devolveu (lista vira linhas). */
export const textoDoValor = (v: unknown): string => (Array.isArray(v) ? v.map((x) => String(x ?? "")).join("\n") : v === null || v === undefined ? "" : String(v));

/** Lista de um valor (texto com linhas ou lista). */
export const listaDoValor = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split("\n"))
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
