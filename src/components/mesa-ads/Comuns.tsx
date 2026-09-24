import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSegundos, tempoCurto } from "@/components/mesa/Cronometro";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import { AVISO_DA_EVIDENCIA, copiarTexto, ESCALA_DE_EVIDENCIA, sinalDe, type DiagnosticoDoCriativo, type Evidencia } from "./adsApi";

/** Cartão das etapas: título pequeno em caixa alta, ação à direita, corpo livre. */
export function Cartao({
  titulo,
  dica,
  acao,
  children,
  className = "",
}: {
  titulo: ReactNode;
  dica?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-border bg-card p-4 ${className}`}>
      <div className="mb-3 flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{titulo}</h3>
          {dica && <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{dica}</p>}
        </div>
        {acao && <div className="ml-2 shrink-0">{acao}</div>}
      </div>
      {children}
    </section>
  );
}

/** Selo E0 a E4 com cor e a escala inteira no tooltip (a atual em destaque). */
export function SeloDeEvidencia({ valor, className = "" }: { valor: Evidencia; className?: string }) {
  const nivel = ESCALA_DE_EVIDENCIA.find((e) => e.valor === valor) || ESCALA_DE_EVIDENCIA[0];
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Evidência ${nivel.valor}: ${nivel.rotulo}`}
            data-evidencia={nivel.valor}
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${nivel.cor} ${className}`}
          >
            {nivel.valor}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] p-3">
          <p className="text-[12px] font-semibold">Escala de evidência</p>
          <ul className="mt-1.5 space-y-1">
            {ESCALA_DE_EVIDENCIA.map((e) => (
              <li key={e.valor} className={`text-[11.5px] leading-snug ${e.valor === nivel.valor ? "text-foreground" : "text-muted-foreground"}`}>
                <span className={`mr-1.5 font-semibold ${e.valor === nivel.valor ? "" : "opacity-70"}`}>{e.valor}</span>
                <span className={e.valor === nivel.valor ? "font-medium" : ""}>{e.rotulo}</span>: {e.dica}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{AVISO_DA_EVIDENCIA}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Rótulo de campo; sem dado, a caixa fica marcada como lacuna (nada é inventado). */
export function Campo({
  rotulo,
  lacuna,
  children,
  dica,
}: {
  rotulo: string;
  lacuna?: boolean;
  children: ReactNode;
  dica?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 flex min-w-0 items-center text-[11.5px] font-medium text-foreground/80">
        <span className="min-w-0 truncate">{rotulo}</span>
        {lacuna && <span className="ml-1.5 shrink-0 rounded-full bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning">lacuna</span>}
      </span>
      <span className={`block rounded-md ${lacuna ? "ring-1 ring-warning/50 ring-offset-0" : ""}`}>{children}</span>
      {dica && <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{dica}</span>}
    </label>
  );
}

/** Andamento discreto de uma ação de IA (rótulo e cronômetro), fora do botão. */
export function Andamento({ desde, rotulo }: { desde: number | null; rotulo: string }) {
  const s = useSegundos(desde);
  if (desde === null) return null;
  return (
    <span role="status" className="inline-flex items-center text-[11.5px] text-muted-foreground">
      <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
      {rotulo}
      <span className="ml-1.5 tabular-nums">{tempoCurto(s)}</span>
    </span>
  );
}

/** Marca o início de uma ação longa e solta ao terminar (para o cronômetro). */
export function useAndamento(): [number | null, <T>(fn: () => Promise<T>) => Promise<T>] {
  const [desde, setDesde] = useState<number | null>(null);
  const rodar = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setDesde(Date.now());
    try {
      return await fn();
    } finally {
      setDesde(null);
    }
  };
  return [desde, rodar];
}

/** Barra de 0 a 10 (nota do Jev). `inverso`: quanto maior, pior. */
export function BarraDeNota({ rotulo, nota, inverso = false, dica }: { rotulo: string; nota: number | null; inverso?: boolean; dica?: string }) {
  const boa = nota === null ? null : inverso ? nota <= 3 : nota >= 7;
  const media = nota === null ? null : inverso ? nota > 3 && nota <= 6 : nota >= 5 && nota < 7;
  const cor = nota === null ? "bg-muted" : boa ? "bg-success" : media ? "bg-warning" : "bg-destructive";
  return (
    <div className="min-w-0" title={`${rotulo}: ${nota === null ? "sem nota" : `${nota.toLocaleString("pt-BR")} de 10`}${inverso ? " (quanto menor, melhor)" : ""}${dica ? ` (${dica})` : ""}`}>
      <div className="flex items-baseline justify-between text-[10.5px] text-muted-foreground">
        <span className="truncate">{rotulo}</span>
        <span className="ml-1 shrink-0 tabular-nums text-foreground">{nota === null ? "-" : nota.toLocaleString("pt-BR")}</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary" role="meter" aria-label={rotulo} aria-valuemin={0} aria-valuemax={10} aria-valuenow={nota === null ? undefined : nota}>
        <div className={`h-full rounded-full ${cor}`} style={{ width: `${nota === null ? 0 : nota * 10}%` }} />
      </div>
    </div>
  );
}

/**
 * Imagem de anúncio ou referência: endereço completo (Meta, página, URL
 * assinada) vai direto no <img>; caminho do bucket passa pela Mesa. Link que
 * venceu vira o espaço neutro, nunca uma imagem quebrada.
 */
export function Foto({ src, alt, className = "", contain = false }: { src: string | null | undefined; alt: string; className?: string; contain?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  if (!src || falhou) {
    return <div className={`flex items-center justify-center bg-secondary/60 text-[11px] text-muted-foreground ${className}`}>{src ? "Imagem indisponível" : "Sem imagem"}</div>;
  }
  if (/^https?:\/\//i.test(src) && src.indexOf("/storage/v1/") < 0) {
    return <img src={src} alt={alt} loading="lazy" onError={() => setFalhou(true)} className={`${contain ? "object-contain" : "object-cover"} ${className}`} />;
  }
  return <ImagemDaMesa caminho={src} alt={alt} className={`${contain ? "!object-contain" : ""} ${className}`} />;
}

/** Botão pequeno de copiar um texto, com o aviso de copiado. */
export function BotaoCopiar({ texto, rotulo = "Copiar", className = "" }: { texto: string; rotulo?: string; className?: string }) {
  const [feito, setFeito] = useState(false);
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copiarTexto(texto);
        if (ok) {
          setFeito(true);
          window.setTimeout(() => setFeito(false), 1500);
        } else toast.error("Não foi possível copiar", { description: "Selecione o texto e copie à mão." });
      }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className}`}
    >
      {feito ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Sinal do anúncio (escalar, manter, observar, renovar, pausar, sem dados) com a regra no título. */
export function SeloDoSinal({ sinal, className = "" }: { sinal: string; className?: string }) {
  const s = sinalDe(sinal);
  return (
    <span data-sinal={s.valor} title={s.dica} className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10.5px] font-semibold ${s.tom} ${className}`}>
      {s.rotulo}
    </span>
  );
}

/** Classe das pílulas de filtro e escolha (mesma em todas as etapas). */
export const pilula = (ativa: boolean) =>
  `mb-1.5 mr-1.5 inline-flex h-7 items-center rounded-full border px-2.5 text-[11.5px] transition-colors ${
    ativa ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
  }`;

/** Abas simples (botões com role=tab): funcionam em qualquer navegador e nos testes. */
export function Abas<T extends string>({ valor, opcoes, onMudar, rotulo, className = "" }: { valor: T; opcoes: { valor: T; rotulo: ReactNode; oculta?: boolean }[]; onMudar: (v: T) => void; rotulo: string; className?: string }) {
  return (
    <div role="tablist" aria-label={rotulo} className={`flex min-w-0 flex-wrap items-center border-b border-border ${className}`}>
      {opcoes.filter((o) => !o.oculta).map((o) => {
        const ativa = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="tab"
            aria-selected={ativa}
            onClick={() => onMudar(o.valor)}
            className={`-mb-px mr-1 border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors ${ativa ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** Diagnóstico da tabela do dossiê: etiqueta do sinal, leitura e próximo passo. */
export function Diagnostico({ valor }: { valor: DiagnosticoDoCriativo | string | null }) {
  if (!valor) return <span className="text-[11.5px] text-muted-foreground">Sem diagnóstico</span>;
  if (typeof valor === "string") return <p className="text-[12px] leading-snug [overflow-wrap:anywhere]">{valor}</p>;
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  return (
    <div className="min-w-0 space-y-0.5" data-diagnostico="">
      {texto(valor.sinal) && <span className="inline-block rounded-full bg-warning/15 px-2 py-0.5 text-[10.5px] font-medium text-warning">{texto(valor.sinal)}</span>}
      {texto(valor.leitura) && <p className="text-[12px] leading-snug [overflow-wrap:anywhere]">{texto(valor.leitura)}</p>}
      {texto(valor.acao) && <p className="text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">Próximo passo: {texto(valor.acao)}</p>}
    </div>
  );
}

/**
 * Nota de política do Jev: 0 (viola) a 10 (sem risco). Aparece como
 * "Política" com a leitura de segurança, nunca como "risco 9".
 */
export function BarraDePolitica({ nota }: { nota: number | null }) {
  const leitura = nota === null ? "" : nota >= 7 ? "seguro" : nota >= 5 ? "atenção" : "arriscado";
  return <BarraDeNota rotulo="Política" nota={nota} dica={nota === null ? "sem nota" : `${nota.toLocaleString("pt-BR")}/10 ${leitura}; quanto maior, mais seguro`} />;
}
