import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, Loader2, Pause, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { usd, type Qualidade } from "@/lib/mesa/api";
import { useMesaFoto } from "./Comuns";
import { partesDaGeracao, tomadasParaGerar, type Camera, type Ensaio, type Guia } from "./fotoApi";
import { esquecerLote, iniciarLote, pararLote, resumoDoLote, useLote, type EstadoNoLote } from "./lote";

/**
 * O botão "Gerar todas (N fotos, ~US$ X)" e o andamento do lote, iguais no
 * Ensaio, na Campanha e no diretor. O total aparece antes (BotaoComCusto);
 * o lote gera uma por vez e segue mesmo trocando de etapa.
 */

const ROTULO_DO_ESTADO: Record<EstadoNoLote, string> = {
  fila: "na fila",
  gerando: "gerando",
  feita: "pronta",
  falhou: "falhou",
  pulada: "ficou para depois",
};

/** As tomadas que o lote vai gerar: sem versão, não bloqueadas, não gerando. */
export const tomadasDoLote = (e: Ensaio | null | undefined) => tomadasParaGerar(e).filter((t) => !t.versoes.length);

export function BotaoDoLote({
  ensaio,
  modeloId,
  qualidade,
  guia,
  cameras,
  rotulo,
  className = "",
  variant = "default",
}: {
  ensaio: Ensaio;
  modeloId: string;
  qualidade: Qualidade;
  guia?: Guia | null;
  cameras?: Record<string, Camera | null>;
  rotulo?: (n: number) => ReactNode;
  className?: string;
  variant?: "default" | "outline";
}) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const lote = useLote(ensaio.id);
  const pendentes = tomadasDoLote(ensaio);
  const n = pendentes.length;
  return (
    <BotaoComCusto
      rotulo={
        rotulo ? (
          rotulo(n)
        ) : (
          <>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar todas ({n} {n === 1 ? "foto" : "fotos"})
          </>
        )
      }
      titulo="Lote de fotos"
      descricao="Gera cada foto ainda sem versão, uma por vez. Bloqueadas ficam de fora. Pode trocar de etapa: o lote continua."
      variant={variant}
      className={className}
      disabled={!n || !modeloId || !!(lote && lote.ativo)}
      partes={() => partesDaGeracao(modeloId, qualidade, Math.max(1, n))}
      fecharAoConfirmar
      executar={async () => {
        const ok = iniciarLote({
          clientId,
          ensaioId: ensaio.id,
          tomadas: pendentes.map((t) => ({ id: t.id, nome: t.nome, camera: cameras ? cameras[t.id] || null : null })),
          modeloImagemId: modeloId,
          qualidade,
          guia: guia || null,
          queryClient,
          aoAtualizarCusto: atualizarCusto,
        });
        if (ok) toast.info(`Gerando ${n} ${n === 1 ? "foto" : "fotos"}, uma por vez`, { description: "Pode trocar de etapa: o andamento segue na barra de cima." });
        return {};
      }}
    />
  );
}

export function AndamentoDoLote({ ensaioId, className = "" }: { ensaioId: string; className?: string }) {
  const lote = useLote(ensaioId);
  const { irPara } = useMesaFoto();
  if (!lote) return null;
  const r = resumoDoLote(lote);
  const pct = r.total ? Math.round((r.andando / r.total) * 100) : 0;
  return (
    <section className={`min-w-0 rounded-xl border border-primary/30 bg-card p-3 ${className}`} aria-label="Andamento do lote" data-lote={ensaioId}>
      <div className="flex min-w-0 flex-wrap items-center">
        <p className="mr-auto min-w-0 text-[12.5px] font-semibold" role="status" aria-live="polite">
          {lote.ativo ? (
            <span className="inline-flex items-center">
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-primary" />
              Gerando {Math.min(r.andando + 1, r.total)} de {r.total}
            </span>
          ) : (
            `${r.feitas} de ${r.total} ${r.total === 1 ? "pronta" : "prontas"}`
          )}
          <span className="ml-2 font-normal text-muted-foreground">{usd(lote.custo_usd)}</span>
        </p>
        {lote.ativo && !lote.parar && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => pararLote(ensaioId)}>
            <Pause className="mr-1 h-3.5 w-3.5" /> Parar depois desta
          </Button>
        )}
        {!lote.ativo && r.feitas > 0 && (
          <Button type="button" size="sm" className="h-7 px-2.5 text-[11.5px]" onClick={() => irPara("revisar", { ensaio: ensaioId })}>
            <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Revisar
          </Button>
        )}
        {!lote.ativo && (
          <button type="button" className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Fechar o andamento" onClick={() => esquecerLote(ensaioId)}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-2 flex min-w-0 flex-wrap">
        {lote.itens.map((i) => (
          <li
            key={i.tomada_id}
            title={i.erro || undefined}
            className={`mb-1 mr-1 inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10.5px] ${
              i.estado === "feita"
                ? "border-success/40 text-success"
                : i.estado === "falhou"
                  ? "border-destructive/40 text-destructive"
                  : i.estado === "gerando"
                    ? "border-primary/50 text-primary"
                    : "border-border text-muted-foreground"
            }`}
            data-item-do-lote={i.estado}
          >
            {i.estado === "gerando" && <Loader2 className="mr-1 h-3 w-3 shrink-0 animate-spin" />}
            {i.estado === "feita" && <Check className="mr-1 h-3 w-3 shrink-0" />}
            <span className="truncate">{i.nome}</span>
            <span className="ml-1 shrink-0 opacity-80">· {ROTULO_DO_ESTADO[i.estado]}</span>
          </li>
        ))}
      </ul>
      {lote.motivo_parada && !lote.ativo && <p className="mt-1 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{lote.motivo_parada}</p>}
      {lote.ativo && <p className="mt-1 text-[11px] text-muted-foreground">Pode trocar de etapa. Cada foto pronta já fica salva.</p>}
    </section>
  );
}
