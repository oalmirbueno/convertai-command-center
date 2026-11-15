import type { CSSProperties, ReactNode } from "react";
import { Check } from "lucide-react";
import { juntar } from "@/components/sistema/estilos";
import { initialsOf } from "@/components/ds";

/**
 * Peças visuais da rodada v4 (15/11/2026) para Central, Ciclo e Execução, no
 * desenho das referências: barra segmentada em pílulas, pilha de avatares,
 * anel de progresso, trio de números sem cartão e passos ligados por linha.
 * Só desenham número que a tela já tem; não leem nada do banco.
 */

export type TomVisual = "perigo" | "aviso" | "info" | "sucesso" | "neutro" | "tinta" | "marca";

const FUNDO: Record<TomVisual, string> = {
  perigo: "bg-danger-soft text-destructive",
  aviso: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  sucesso: "bg-success-soft text-success",
  neutro: "bg-muted text-foreground",
  tinta: "bg-foreground text-background",
  marca: "bg-accent-solid text-on-accent",
};

const HACHURA: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--muted-foreground) / 0.28) 0, hsl(var(--muted-foreground) / 0.28) 2px, transparent 2px, transparent 7px)",
};

export interface Segmento {
  rotulo: string;
  valor: number;
  tom?: TomVisual;
  /** Listrado: o que ainda não começou (fila, previsto). */
  hachura?: boolean;
  aoClicar?: () => void;
}

/**
 * Barra segmentada horizontal (referência "People"): cada parte é uma pílula
 * com o rótulo em cima e o número dentro; a largura acompanha o valor, com um
 * mínimo para o número caber. Parte zerada não aparece.
 */
export function BarraSegmentada({ itens, rotulo, className = "" }: { itens: Segmento[]; rotulo: string; className?: string }) {
  const partes = itens.filter((s) => s.valor > 0);
  const total = partes.reduce((t, s) => t + s.valor, 0);
  if (total === 0) return null;
  return (
    <div role="group" aria-label={rotulo} className={juntar("flex min-w-0 items-end", className)} data-barra-segmentada="">
      {partes.map((s, i) => {
        const miolo = (
          <>
            <span className="mb-1.5 block truncate px-1 text-left text-[11px] font-medium leading-4 text-muted-foreground">{s.rotulo}</span>
            <span
              className={juntar("flex h-9 min-w-0 items-center rounded-full px-3 text-[13px] font-semibold tabular-nums", s.hachura ? "border border-border text-foreground" : FUNDO[s.tom || "neutro"])}
              style={s.hachura ? HACHURA : undefined}
            >
              {s.valor}
              <span className="ml-1 truncate text-[11px] font-medium opacity-80">{Math.round((s.valor / total) * 100)}%</span>
            </span>
          </>
        );
        const estilo: CSSProperties = { flexGrow: s.valor, flexBasis: 0, minWidth: 68 };
        const classe = juntar("block min-w-0", i > 0 && "ml-1.5");
        return s.aoClicar ? (
          <button key={s.rotulo} type="button" onClick={s.aoClicar} style={estilo} title={`${s.rotulo}: ${s.valor}`} className={juntar(classe, "toque-compacto rounded-2xl text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
            {miolo}
          </button>
        ) : (
          <span key={s.rotulo} style={estilo} title={`${s.rotulo}: ${s.valor}`} className={classe}>{miolo}</span>
        );
      })}
    </div>
  );
}

const CORES_DE_AVATAR = ["bg-accent-soft text-primary", "bg-info-soft text-info", "bg-warning-soft text-warning", "bg-muted text-foreground", "bg-success-soft text-success"];

/** Pilha de avatares (iniciais em círculo, sobrepostos) com "+N" no fim. */
export function PilhaDeAvatares({ nomes, max = 4, tamanho = 32, className = "" }: { nomes: string[]; max?: number; tamanho?: number; className?: string }) {
  if (nomes.length === 0) return null;
  const visiveis = nomes.slice(0, max);
  const resto = nomes.length - visiveis.length;
  const caixa: CSSProperties = { width: tamanho, height: tamanho };
  return (
    <span className={juntar("inline-flex shrink-0 items-center", className)} title={nomes.join(", ")} data-pilha-de-avatares="">
      <span className="sr-only">{nomes.join(", ")}</span>
      {visiveis.map((n, i) => (
        <span key={`${n}-${i}`} aria-hidden="true" style={caixa} className={juntar("inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold leading-none ring-2 ring-card", i > 0 && "-ml-2.5", CORES_DE_AVATAR[i % CORES_DE_AVATAR.length])}>
          {initialsOf(n)}
        </span>
      ))}
      {resto > 0 && (
        <span aria-hidden="true" style={caixa} className="-ml-2.5 inline-flex shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold leading-none tabular-nums text-background ring-2 ring-card">+{resto}</span>
      )}
    </span>
  );
}

/** Avatar de iniciais com ponto de presença (verde = ativo, cinza = pausado). */
export function AvatarComPresenca({ nome, ativo, tom = 0, tamanho = 44, className = "" }: { nome: string; ativo?: boolean; tom?: number; tamanho?: number; className?: string }) {
  return (
    <span className={juntar("relative inline-flex shrink-0", className)} style={{ width: tamanho, height: tamanho }} data-avatar-presenca="">
      <span aria-hidden="true" className={juntar("inline-flex h-full w-full items-center justify-center rounded-full text-[13px] font-semibold leading-none", CORES_DE_AVATAR[tom % CORES_DE_AVATAR.length])}>{initialsOf(nome)}</span>
      {ativo !== undefined && (
        <span aria-label={ativo ? "ativo" : "pausado"} role="img" className={juntar("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card", ativo ? "bg-success" : "bg-muted-foreground/50")} />
      )}
    </span>
  );
}

/**
 * Anel de progresso (referência de finanças): trilho apagado e arco na cor da
 * marca, com o miolo livre (ícone ou número). Sem total, só o trilho.
 */
export function AnelDeProgresso({ valor, total, tamanho = 44, espessura = 4, children, rotulo, className = "", cor }: { valor: number; total: number; tamanho?: number; espessura?: number; children?: ReactNode; rotulo?: string; className?: string; cor?: string }) {
  const parte = total > 0 ? Math.max(0, Math.min(1, valor / total)) : 0;
  const raio = 50 - (espessura / tamanho) * 50;
  const traco = (espessura / tamanho) * 100;
  const volta = 2 * Math.PI * raio;
  return (
    <span className={juntar("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: tamanho, height: tamanho }} role="img" aria-label={rotulo || `${valor} de ${total}`} data-anel="">
      <svg viewBox="0 0 100 100" width={tamanho} height={tamanho} aria-hidden="true" focusable="false" className="absolute inset-0 block -rotate-90">
        <circle cx={50} cy={50} r={raio} fill="none" stroke="currentColor" strokeWidth={traco} opacity={0.14} />
        {parte > 0 && <circle cx={50} cy={50} r={raio} fill="none" stroke={cor || "hsl(var(--primary))"} strokeWidth={traco} strokeLinecap="round" strokeDasharray={`${(parte * volta).toFixed(2)} ${volta.toFixed(2)}`} />}
      </svg>
      <span className="relative inline-flex min-w-0 items-center justify-center text-[12px] font-semibold leading-none tabular-nums">{children}</span>
    </span>
  );
}

/** Trio de números sem cartão: rótulo pequeno em cima, número grande embaixo. */
export function TrioDeNumeros({ itens, className = "" }: { itens: Array<{ rotulo: string; valor: ReactNode; tom?: string; aoClicar?: () => void; dica?: string }>; className?: string }) {
  return (
    <dl className={juntar("flex min-w-0 items-end", className)} data-trio-de-numeros="">
      {itens.map((n, i) => {
        const miolo = (
          <>
            <dt className="truncate text-[11px] font-medium leading-4 text-muted-foreground">{n.rotulo}</dt>
            <dd className={juntar("mt-0.5 truncate text-[26px] font-medium leading-8 tracking-[-0.02em] tabular-nums", n.tom || "text-foreground")}>{n.valor}</dd>
          </>
        );
        const classe = juntar("min-w-0 shrink text-left", i > 0 && "ml-6 sm:ml-9");
        return n.aoClicar ? (
          <button key={n.rotulo} type="button" onClick={n.aoClicar} title={n.dica} className={juntar(classe, "toque-compacto rounded-lg transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{miolo}</button>
        ) : (
          <div key={n.rotulo} title={n.dica} className={classe}>{miolo}</div>
        );
      })}
    </dl>
  );
}

/**
 * Passos ligados por linha (referência "Financial Roadmap"): círculo com ✓
 * quando feito, anel na cor da marca no atual, apagado no que falta.
 */
export function Passos({ itens, rotulo, className = "" }: { itens: Array<{ rotulo: string; feito: boolean; atual?: boolean; apoio?: string }>; rotulo: string; className?: string }) {
  if (itens.length === 0) return null;
  return (
    <ol aria-label={rotulo} className={juntar("flex min-w-0 items-start", className)} data-passos="">
      {itens.map((p, i) => (
        <li key={`${p.rotulo}-${i}`} className="relative flex min-w-0 flex-1 flex-col items-center text-center" aria-current={p.atual ? "step" : undefined}>
          {i > 0 && <span aria-hidden="true" className={juntar("absolute right-1/2 top-[11px] mr-3 h-0.5 w-[calc(100%-24px)] rounded-full", p.feito || p.atual ? "bg-primary" : "bg-border")} />}
          <span aria-hidden="true" className={juntar("relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums", p.feito ? "bg-accent-solid text-on-accent" : p.atual ? "bg-card text-foreground ring-2 ring-primary" : "bg-muted text-muted-foreground")}>
            {p.feito ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={juntar("mt-1.5 block w-full truncate px-1 text-[11px] leading-4", p.atual ? "font-semibold text-foreground" : "text-muted-foreground")} title={p.rotulo}>{p.rotulo}{p.feito && <span className="sr-only">, feito</span>}</span>
          {p.apoio && <span className="block w-full truncate px-1 text-[10.5px] leading-4 text-muted-foreground">{p.apoio}</span>}
        </li>
      ))}
    </ol>
  );
}
