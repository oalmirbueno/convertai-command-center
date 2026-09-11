import { useState } from "react";
import { ChevronDown, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { ClienteDaEsteira } from "@/hooks/useEsteira";
import type { EsteiraItem, Fonte, Insight } from "@/lib/esteira/esteiraTipos";
import { ONBOARDING, itensDaFrente } from "@/lib/esteira/esteiraMontar";
import { marcarJaTem, marcarRitual, ocultarCliente } from "@/lib/esteira/esteiraAcoes";
import EsteiraItemRow from "./EsteiraItemRow";

const GRUPOS: Array<{ fontes: Fonte[]; titulo: string }> = [
  { fontes: ["onboarding"], titulo: "Entrada do cliente" },
  { fontes: ["post", "agenda"], titulo: "Publicações" },
  { fontes: ["anuncio"], titulo: "Anúncios" },
  { fontes: ["marco", "tarefa"], titulo: "Tarefas e marcos" },
  { fontes: ["checklist"], titulo: "Checklists" },
];

function IconeTendencia({ t }: { t: Insight["tendencia"] }) {
  if (t === "sobe") return <TrendingUp className="h-3.5 w-3.5 text-primary" />;
  if (t === "cai") return <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

interface Props {
  cliente: ClienteDaEsteira | null;
  frente: "social" | "trafego";
  weekStart: string;
  canWrite: boolean;
  aberta: boolean;
  onFechar: () => void;
  onMudou: () => void;
}

export default function EsteiraClientSheet({ cliente, frente, weekStart, canWrite, aberta, onFechar, onMudou }: Props) {
  const [feitosAbertos, setFeitosAbertos] = useState(false);
  const [jaTemAberto, setJaTemAberto] = useState(false);
  if (!cliente) return null;
  const e = cliente.esteira;
  const itens = itensDaFrente(e, frente);
  const insights = e.insights.filter((i) => i.frente === frente);
  const grupos = GRUPOS.map((g) => ({ ...g, itens: itens.filter((it) => g.fontes.includes(it.fonte)) })).filter((g) => g.itens.length > 0);
  const oculto = cliente.fatos.oculto.areas.includes(frente);

  const alternarRitual = async (key: "segunda" | "quarta" | "sexta", feito: boolean) => {
    if (!canWrite) { toast.error("Só admin ou manager marca rituais."); return; }
    const ok = await marcarRitual({ clientId: cliente.id, weekStart, ritual: key, feito });
    if (ok) onMudou(); else toast.error("Não foi possível gravar.");
  };

  return (
    <Sheet open={aberta} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:mx-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">{cliente.nome}</SheetTitle>
          <SheetDescription>
            {e.onboardingCompleto ? "Em operação" : "Entrada em andamento"} · {e.resumo.urgentes} urgente{e.resumo.urgentes === 1 ? "" : "s"}, {e.resumo.atencao} de atenção
          </SheetDescription>
        </SheetHeader>

        {insights.length > 0 && (
          <section className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {insights.map((i) => (
              <div key={i.key} className="rounded-xl border border-border bg-secondary/50 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground"><IconeTendencia t={i.tendencia} />{i.titulo}</p>
                <p className="text-[13px] text-foreground">{i.texto}</p>
              </div>
            ))}
          </section>
        )}

        <section className="mt-4">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Rituais desta semana</p>
          <div className="grid grid-cols-3 gap-2">
            {e.rituais.map((r) => (
              <label key={r.key} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-[12px] ${r.feito ? "border-primary/50 bg-primary/10" : "border-border"}`}>
                <Checkbox checked={r.feito} onCheckedChange={(v) => void alternarRitual(r.key, v === true)} disabled={!canWrite} />
                <span className="leading-tight">{r.rotulo}{r.fonte === "central" ? " · Central" : ""}</span>
              </label>
            ))}
          </div>
        </section>

        {grupos.length === 0 && (
          <p className="mt-6 rounded-xl border border-border bg-secondary/40 px-3 py-4 text-center text-[13px] text-muted-foreground">Em dia. Nada pendente nesta frente.</p>
        )}
        {grupos.map((g) => (
          <section key={g.titulo} className="mt-4">
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">{g.titulo} · {g.itens.length}</p>
            <div className="space-y-1.5">
              {g.itens.map((it: EsteiraItem) => (
                <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={canWrite} onMudou={onMudou} />
              ))}
            </div>
          </section>
        ))}

        {e.feitos.length > 0 && (
          <section className="mt-4">
            <button type="button" onClick={() => setFeitosAbertos((v) => !v)} className="flex w-full items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>Feitos nesta semana · {e.feitos.length}</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${feitosAbertos ? "rotate-180" : ""}`} />
            </button>
            {feitosAbertos && (
              <div className="mt-1.5 space-y-1.5">
                {e.feitos.map((it) => <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={canWrite} onMudou={onMudou} />)}
              </div>
            )}
          </section>
        )}

        {!e.onboardingCompleto && (
          <section className="mt-4">
            <button type="button" onClick={() => setJaTemAberto((v) => !v)} className="flex w-full items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>O que este cliente já tem</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${jaTemAberto ? "rotate-180" : ""}`} />
            </button>
            {jaTemAberto && (
              <div className="mt-1.5 space-y-1">
                {ONBOARDING.filter((p) => !p.soSe || cliente.fatos.servicos[p.soSe]).map((p) => {
                  const tem = p.key in cliente.fatos.onboardingHas ? cliente.fatos.onboardingHas[p.key] : (p.auto ? p.auto(cliente.fatos) : false);
                  return (
                    <div key={p.key} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                      <span className="text-[13px] text-foreground">{p.rotulo}{p.auto ? <span className="ml-1 text-[11px] text-muted-foreground">(detectado)</span> : null}</span>
                      <Switch checked={Boolean(tem)} disabled={!canWrite} onCheckedChange={async (v) => { const ok = await marcarJaTem(cliente.id, p.key, v); if (ok) onMudou(); else toast.error("Não foi possível gravar."); }} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {canWrite && (
          <section className="mt-5 flex flex-wrap gap-2 border-t border-border pt-3">
            {!oculto ? (
              <>
                <button type="button" onClick={async () => { const fim = new Date(weekStart); fim.setDate(fim.getDate() + 6); const ok = await ocultarCliente({ clientId: cliente.id, area: frente, ocultar: true, ateQuando: fim.toISOString().slice(0, 10) }); if (ok) { onMudou(); onFechar(); } }} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-primary/50">Ocultar esta semana</button>
                <button type="button" onClick={async () => { const ok = await ocultarCliente({ clientId: cliente.id, area: frente, ocultar: true, ateQuando: null }); if (ok) { onMudou(); onFechar(); } }} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-destructive/50">Tirar desta frente</button>
              </>
            ) : (
              <button type="button" onClick={async () => { const ok = await ocultarCliente({ clientId: cliente.id, area: frente, ocultar: false }); if (ok) onMudou(); }} className="rounded-lg border border-primary/50 px-3 py-1.5 text-[12px] text-foreground">Voltar a mostrar nesta frente</button>
            )}
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}
