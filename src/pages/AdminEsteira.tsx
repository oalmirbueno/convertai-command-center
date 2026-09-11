import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Eye, Megaphone, Package, RefreshCw, Share2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNow } from "@/hooks/useNow";
import { usePwaProfile } from "@/hooks/usePwaProfile";
import { useEsteira, type ClienteDaEsteira } from "@/hooks/useEsteira";
import { itensDaFrente } from "@/lib/esteira/esteiraMontar";
import { ocultarCliente } from "@/lib/esteira/esteiraAcoes";
import { addDays, localIso, mondayOf, weekLabel } from "@/lib/cycleWeek";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import EsteiraClientSheet from "@/components/esteira/EsteiraClientSheet";
import EsteiraItemRow from "@/components/esteira/EsteiraItemRow";

type Aba = "social" | "trafego" | "avulso";
const ABA_KEY = "aceleriq-esteira-aba";

// A Esteira e o Ciclo lido do estado real: cada card e um cliente, cada
// linha e um item que existe de verdade (post no seu elo, campanha, tarefa,
// passo de entrada). Celular e uma lista; tela grande, duas colunas.

export default function AdminEsteira() {
  const { profile } = useAuth();
  const canWrite = ["admin", "manager"].includes(profile?.role || "");
  usePwaProfile({ manifestHref: "/ciclo.webmanifest", appleTitle: "Ciclo", appleIcon: "/ciclo-apple-touch-icon.png" });
  const agora = useNow();

  const [aba, setAba] = useState<Aba>(() => {
    const s = typeof localStorage !== "undefined" ? localStorage.getItem(ABA_KEY) : null;
    return s === "trafego" || s === "avulso" ? s : "social";
  });
  useEffect(() => { try { localStorage.setItem(ABA_KEY, aba); } catch { /* sem cache */ } }, [aba]);

  const [semanaOffset, setSemanaOffset] = useState(0);
  const segunda = useMemo(() => addDays(mondayOf(agora), semanaOffset * 7), [agora, semanaOffset]);
  const weekStart = localIso(segunda);

  const { clientes, carregando, recarregar } = useEsteira(weekStart, agora);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [quemEntraAberto, setQuemEntraAberto] = useState(false);

  // Altura real do topo fixo, medida: o espaco reservado nunca fica menor
  // nem maior que ele (a faixa de resumo muda de altura em telas estreitas).
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerH, setHeaderH] = useState(96);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeaderH(el.getBoundingClientRect().height));
    ro.observe(el);
    setHeaderH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  const frente: "social" | "trafego" = aba === "trafego" ? "trafego" : "social";

  const { visiveis, ocultos } = useMemo(() => {
    const v: ClienteDaEsteira[] = [];
    const o: ClienteDaEsteira[] = [];
    for (const c of clientes) {
      const ehAvulso = c.tipo === "one_off";
      if (aba === "avulso") { if (ehAvulso) v.push(c); continue; }
      if (ehAvulso) continue;
      if (!c.fatos.servicos[frente]) continue;
      if (c.fatos.oculto.areas.includes(frente)) o.push(c); else v.push(c);
    }
    const peso = (c: ClienteDaEsteira) => c.esteira.resumo.urgentes * 100 + c.esteira.resumo.atencao * 10 + c.esteira.resumo.normais;
    v.sort((a, b) => peso(b) - peso(a) || a.nome.localeCompare(b.nome));
    return { visiveis: v, ocultos: o };
  }, [clientes, aba, frente]);

  const detalhe = clientes.find((c) => c.id === detalheId) ?? null;

  if (!["admin", "manager", "design", "traffic"].includes(profile?.role || "")) {
    return <div className="p-6 text-sm text-muted-foreground">Esta área é da equipe.</div>;
  }

  // Resumo da frente para o topo: o que a semana pede, de relance.
  const resumo = visiveis.reduce((acc, c) => {
    const its = itensDaFrente(c.esteira, frente);
    acc.urgentes += its.filter((i) => i.gravidade === "urgente").length;
    acc.atencao += its.filter((i) => i.gravidade === "atencao").length;
    acc.emDia += its.length === 0 ? 1 : 0;
    acc.entrada += c.esteira.onboardingCompleto ? 0 : 1;
    acc.rituaisFeitos += c.esteira.rituais.filter((r) => r.feito).length;
    acc.feitos += c.esteira.feitos.length;
    return acc;
  }, { urgentes: 0, atencao: 0, emDia: 0, entrada: 0, rituaisFeitos: 0, feitos: 0 });
  const totalUrgentes = resumo.urgentes;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Topo FIXO (nao sticky): no celular, a rolagem nunca leva a semana
          junto. O espaco reservado abaixo tem a mesma altura. */}
      <header ref={headerRef} className="fixed inset-x-0 top-0 z-30 border-b border-border bg-background/95 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 pt-2.5 pb-1.5">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Semana anterior" onClick={() => setSemanaOffset((v) => v - 1)} className="rounded-lg p-1.5 hover:bg-secondary"><ChevronLeft className="h-4 w-4" /></button>
            <div className="text-center">
              <p className="text-[13px] font-semibold leading-tight">{weekLabel(segunda)}</p>
              <p className="text-[11px] text-muted-foreground">{semanaOffset === 0 ? "Semana atual" : semanaOffset < 0 ? "Semana passada" : "Semana futura"}</p>
            </div>
            <button type="button" aria-label="Próxima semana" onClick={() => setSemanaOffset((v) => v + 1)} className="rounded-lg p-1.5 hover:bg-secondary"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setQuemEntraAberto(true)} className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary"><span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />Quem entra</span></button>
            <button type="button" aria-label="Recarregar" onClick={recarregar} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} /></button>
            <Link to="/dashboard" className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-secondary">Painel</Link>
          </div>
        </div>
        <div className="mx-auto flex max-w-5xl items-center gap-1.5 overflow-x-auto px-4 pb-2 text-[11px] [scrollbar-width:none]">
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">{visiveis.length} cliente{visiveis.length === 1 ? "" : "s"}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${resumo.urgentes ? "bg-destructive/15 text-destructive" : "bg-secondary text-muted-foreground"}`}>{resumo.urgentes} urgente{resumo.urgentes === 1 ? "" : "s"}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${resumo.atencao ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground"}`}>{resumo.atencao} atenção</span>
          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary">{resumo.emDia} em dia</span>
          {resumo.entrada > 0 && <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">{resumo.entrada} em entrada</span>}
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">rituais {resumo.rituaisFeitos}/{visiveis.length * 3}</span>
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">{resumo.feitos} feito{resumo.feitos === 1 ? "" : "s"} na semana</span>
        </div>
      </header>
      <div style={{ height: headerH }} aria-hidden />

      <main className="mx-auto max-w-5xl px-4 pb-[calc(env(safe-area-inset-bottom)+72px)] pt-3">
        {carregando && clientes.length === 0 && (
          <p className="py-10 text-center text-[13px] text-muted-foreground">Lendo a operação de cada cliente…</p>
        )}
        {!carregando && visiveis.length === 0 && (
          <p className="py-10 text-center text-[13px] text-muted-foreground">Nenhum cliente nesta frente. Use "Quem entra" para incluir.</p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visiveis.map((c) => {
            const itens = itensDaFrente(c.esteira, frente);
            const topo = itens.slice(0, 3);
            const resto = itens.length - topo.length;
            const r = c.esteira.rituais;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setDetalheId(c.id)}
                className="rounded-2xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold leading-tight">{c.nome}</p>
                    <p className="text-[11px] text-muted-foreground">{c.esteira.onboardingCompleto ? "Em operação" : "Entrada em andamento"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {itens.filter((i) => i.gravidade === "urgente").length > 0 && (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">{itens.filter((i) => i.gravidade === "urgente").length}</span>
                    )}
                    {itens.filter((i) => i.gravidade === "atencao").length > 0 && (
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">{itens.filter((i) => i.gravidade === "atencao").length}</span>
                    )}
                    {itens.length === 0 && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">em dia</span>}
                  </div>
                </div>
                <div className="mt-2.5 space-y-1.5">
                  {topo.map((it) => <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={false} onMudou={recarregar} compacto />)}
                  {resto > 0 && <p className="px-1 text-[11px] text-muted-foreground">+ {resto} item{resto === 1 ? "" : "s"}</p>}
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  {r.map((x) => (
                    <span key={x.key} title={x.rotulo} className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${x.feito ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
                      {x.key === "segunda" ? "S" : x.key === "quarta" ? "Q" : "S"}
                    </span>
                  ))}
                  <span className="ml-1 text-[11px] text-muted-foreground">rituais {r.filter((x) => x.feito).length}/3</span>
                  {c.esteira.insights.filter((i) => i.frente === frente)[0] && (
                    <span className="ml-auto truncate text-[11px] text-muted-foreground">{c.esteira.insights.filter((i) => i.frente === frente)[0].titulo}: {c.esteira.insights.filter((i) => i.frente === frente)[0].atual ?? "–"}{c.esteira.insights.filter((i) => i.frente === frente)[0].variacao !== null ? ` (${(c.esteira.insights.filter((i) => i.frente === frente)[0].variacao as number) > 0 ? "+" : ""}${c.esteira.insights.filter((i) => i.frente === frente)[0].variacao}%)` : ""}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto flex h-14 max-w-[560px] items-stretch">
          {([
            { k: "social", rotulo: "Social", Icone: Share2 },
            { k: "trafego", rotulo: "Tráfego", Icone: Megaphone },
            { k: "avulso", rotulo: "Avulso", Icone: Package },
          ] as Array<{ k: Aba; rotulo: string; Icone: typeof Share2 }>).map(({ k, rotulo, Icone }) => (
            <button key={k} type="button" onClick={() => setAba(k)} className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${aba === k ? "text-primary" : "text-muted-foreground"}`}>
              <Icone className="h-5 w-5" />{rotulo}
            </button>
          ))}
        </div>
      </nav>

      <EsteiraClientSheet cliente={detalhe} frente={frente} weekStart={weekStart} canWrite={canWrite} aberta={detalhe !== null} onFechar={() => setDetalheId(null)} onMudou={recarregar} />

      <Sheet open={quemEntraAberto} onOpenChange={setQuemEntraAberto}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:mx-auto sm:max-w-lg">
          <SheetHeader className="text-left"><SheetTitle className="text-base">Quem entra em {frente === "social" ? "Social" : "Tráfego"}</SheetTitle></SheetHeader>
          <div className="mt-3 space-y-1.5">
            {clientes.filter((c) => c.tipo !== "one_off").map((c) => {
              const temServico = c.fatos.servicos[frente];
              const oculto = c.fatos.oculto.areas.includes(frente);
              const estado = !temServico ? "sem este serviço" : oculto ? (c.fatos.oculto.ate ? `oculto até ${c.fatos.oculto.ate.slice(8, 10)}/${c.fatos.oculto.ate.slice(5, 7)}` : "fora desta frente") : "na esteira";
              return (
                <div key={c.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                  <div className="min-w-0"><p className="truncate text-[13px] font-medium">{c.nome}</p><p className="text-[11px] text-muted-foreground">{estado}</p></div>
                  {temServico && canWrite && (
                    <button type="button" onClick={async () => { const ok = await ocultarCliente({ clientId: c.id, area: frente, ocultar: !oculto, ateQuando: null }); if (ok) recarregar(); }} className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:border-primary/50">{oculto ? "Incluir" : "Ocultar"}</button>
                  )}
                </div>
              );
            })}
            {ocultos.length === 0 && clientes.length > 0 && <p className="pt-1 text-center text-[11px] text-muted-foreground">Ninguém oculto nesta frente.</p>}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
