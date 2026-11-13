import { type CSSProperties, type ReactNode } from "react";
import { juntar, texto } from "@/components/sistema";

/**
 * Peças visuais só do produto CRM (13/11/2026, rodada 2): o cartão do painel,
 * a foto da pessoa e a cor de cada etapa do funil. O painel do produto é um
 * mosaico de cartões alinhados numa grade; cada cartão é UMA coisa (um número,
 * um gráfico, uma lista), nunca uma seção inteira embrulhada.
 */

/** A cor de cada etapa: a mesma no painel, no funil e nos relatórios (variáveis em produto.css). */
export const COR_DA_ETAPA: Record<string, string> = {
  novo: "var(--etapa-novo)",
  contato: "var(--etapa-contato)",
  diagnostico: "var(--etapa-diagnostico)",
  proposta: "var(--etapa-proposta)",
  negociacao: "var(--etapa-negociacao)",
  ganho: "var(--etapa-ganho)",
  perdido: "var(--etapa-perdido)",
};

export const corDaEtapa = (id: string): string => COR_DA_ETAPA[id] || "hsl(var(--muted-foreground))";

export function CartaoDoPainel({
  titulo,
  apoio,
  acao,
  children,
  className,
  semRespiro = false,
  ...resto
}: {
  titulo?: ReactNode;
  apoio?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
  semRespiro?: boolean;
  [dado: `data-${string}`]: string | undefined;
}) {
  return (
    <section className={juntar("produto-cartao flex min-w-0 flex-col rounded-xl", className)} {...resto}>
      {(titulo || acao) && (
        <div className="flex min-h-[52px] min-w-0 items-center px-4 pt-1 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className={juntar(texto.tituloSecao, "truncate")}>{titulo}</h2>
            {apoio && <p className={juntar(texto.auxiliar, "truncate")}>{apoio}</p>}
          </div>
          {acao && <div className="ml-3 flex shrink-0 items-center">{acao}</div>}
        </div>
      )}
      <div className={juntar("min-w-0 flex-1", !semRespiro && "px-4 pb-4 sm:px-5 sm:pb-5", !titulo && !acao && !semRespiro && "pt-4 sm:pt-5")}>{children}</div>
    </section>
  );
}

const TAMANHO = { p: "h-7 w-7 text-[11px]", m: "h-9 w-9 text-[12px]", g: "h-12 w-12 text-[15px]", gg: "h-20 w-20 text-[24px]" } as const;

export function Foto({ nome, foto, tamanho = "m", className, apagada = false }: { nome: string; foto?: string | null; tamanho?: keyof typeof TAMANHO; className?: string; apagada?: boolean }) {
  const inicial = (nome || "?").trim().charAt(0).toUpperCase() || "?";
  if (foto) return <img src={foto} alt="" className={juntar(TAMANHO[tamanho], "shrink-0 rounded-full object-cover", className)} />;
  return (
    <span
      aria-hidden="true"
      className={juntar(
        TAMANHO[tamanho],
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        apagada ? "border border-dashed border-border text-muted-foreground" : "bg-primary/[0.14] text-primary",
        className,
      )}
    >
      {inicial}
    </span>
  );
}

/** Barra de progresso fina, com a cor que vier (padrão: destaque). */
export function Barra({ parte, cor, className, altura = 6 }: { parte: number; cor?: string; className?: string; altura?: number }) {
  const largura = Math.max(0, Math.min(100, Math.round(parte * 100)));
  const estilo: CSSProperties = { width: `${largura}%`, ...(cor ? { backgroundColor: cor } : {}) };
  return (
    <span className={juntar("block min-w-0 overflow-hidden rounded-full bg-muted", className)} style={{ height: altura }} aria-hidden="true">
      <span className={juntar("produto-barra-do-funil block h-full rounded-full", !cor && "bg-primary")} style={estilo} />
    </span>
  );
}

/** Variação em relação ao período anterior: "+12%" verde, "-8%" vermelho, nada quando não há base. */
export function Variacao({ agora, antes }: { agora: number; antes: number }) {
  if (!antes) return null;
  const pct = Math.round(((agora - antes) / antes) * 100);
  if (!isFinite(pct) || pct === 0) return null;
  return (
    <span className={juntar("ml-2 inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-medium tabular-nums", pct > 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}
