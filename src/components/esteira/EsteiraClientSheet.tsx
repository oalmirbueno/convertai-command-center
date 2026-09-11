import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Minus, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { ClienteDaEsteira } from "@/hooks/useEsteira";
import type { EsteiraItem, Fonte, Insight, Leitura, Numero, PlataformaAds } from "@/lib/esteira/esteiraTipos";
import { ONBOARDING, itensDaFrente, plataformasDoCliente } from "@/lib/esteira/esteiraMontar";
import { itemDoPlano, lerPlanoDaSemana, marcarJaTem, marcarRitual, ocultarCliente, type PlanoDaSemana } from "@/lib/esteira/esteiraAcoes";
import { createChecklist, splitRequestIntoItems } from "@/lib/clientChecklist";
import { MEMORY_LABELS, readMemory, type MemoryEntry } from "@/lib/clientMemory";
import EsteiraItemRow from "./EsteiraItemRow";
import TrafegoPlataformas, { PlataformaNaoConfigurada } from "./TrafegoPlataformas";
import TrafegoVendas from "./TrafegoVendas";

const GRUPOS: Array<{ fontes: Fonte[]; titulo: string }> = [
  { fontes: ["onboarding"], titulo: "Entrada do cliente" },
  { fontes: ["post", "agenda"], titulo: "Publicações" },
  { fontes: ["anuncio"], titulo: "Anúncios" },
  { fontes: ["marco", "tarefa"], titulo: "Tarefas e marcos da semana" },
  { fontes: ["checklist"], titulo: "Checklists" },
];

function IconeTendencia({ t }: { t: Insight["tendencia"] }) {
  if (t === "sobe") return <TrendingUp className="h-3.5 w-3.5 text-primary" />;
  if (t === "cai") return <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function fmtNumero(n: Numero): string {
  if (n.atual === null) return "–";
  if (n.formato === "brl") return `R$ ${Math.round(n.atual).toLocaleString("pt-BR")}`;
  if (n.formato === "dec") return n.atual.toFixed(1);
  return Math.round(n.atual).toLocaleString("pt-BR");
}

const ROTULO_PLATAFORMA: Record<PlataformaAds, string> = { meta_ads: "Meta Ads", google_ads: "Google Ads", tiktok_ads: "TikTok Ads" };

function Numeros({ leitura }: { leitura: Leitura }) {
  const cor = (t: Numero["tendencia"]) => (t === "sobe" ? "text-primary" : t === "cai" ? "text-destructive" : "text-muted-foreground");
  const titulo = leitura.frente === "social" ? "Números do Instagram" : `Números · ${leitura.plataforma ? ROTULO_PLATAFORMA[leitura.plataforma] : "anúncios"}`;
  const colunas = leitura.numeros.length >= 5 ? "grid-cols-2 sm:grid-cols-3" : leitura.numeros.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3";
  return (
    <section className="mt-3 rounded-2xl border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{titulo}</p>
        <p className="text-[10px] text-muted-foreground/80">{leitura.periodo}</p>
      </div>
      <div className={`mt-2 grid gap-2 ${colunas}`}>
        {leitura.numeros.map((n) => (
          <div key={n.rotulo} className="rounded-xl bg-secondary/60 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{n.rotulo}</p>
            <p className="text-[20px] font-bold leading-tight tabular-nums text-foreground">{fmtNumero(n)}</p>
            <p className={`flex items-center gap-1 text-[11px] tabular-nums ${cor(n.tendencia)}`}>
              <IconeTendencia t={n.tendencia} />
              {n.variacao !== null ? `${n.variacao > 0 ? "+" : ""}${n.variacao}%` : n.anterior !== null ? "igual" : "sem base"}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          { t: "Subiu", lista: leitura.subiu, cls: "text-primary" },
          { t: "Parado", lista: leitura.parado, cls: "text-muted-foreground" },
          { t: "Caiu", lista: leitura.caiu, cls: "text-destructive" },
        ].map((g) => (
          <div key={g.t} className="rounded-xl border border-border/70 px-2.5 py-2">
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${g.cls}`}>{g.t}</p>
            {g.lista.length === 0 ? <p className="text-[11px] text-muted-foreground/70">nada</p> : g.lista.map((x, i) => <p key={i} className="text-[11.5px] leading-snug text-foreground/90">{x}</p>)}
          </div>
        ))}
      </div>
      {leitura.fazer.length > 0 && (
        <div className="mt-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">O que fazer por causa disso</p>
          <ul className="mt-1 space-y-1">
            {leitura.fazer.map((x, i) => <li key={i} className="text-[12.5px] leading-snug text-foreground">• {x}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function Secao({ titulo, aberta, onToggle, children }: { titulo: string; aberta: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{titulo}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${aberta ? "rotate-180" : ""}`} />
      </button>
      {aberta && <div className="mt-1.5">{children}</div>}
    </section>
  );
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
  const queryClient = useQueryClient();
  const [feitosAbertos, setFeitosAbertos] = useState(false);
  const [jaTemAberto, setJaTemAberto] = useState(false);
  const [historiaAberta, setHistoriaAberta] = useState(false);
  const [listaAberta, setListaAberta] = useState(false);
  const [pedido, setPedido] = useState("");
  const [montando, setMontando] = useState(false);
  const [plano, setPlano] = useState<PlanoDaSemana | null>(null);
  const [lendoPlano, setLendoPlano] = useState(false);
  const [plataformaEscolhida, setPlataformaEscolhida] = useState<PlataformaAds | null>(null);
  const hoje = useMemo(() => new Date(), []);

  const clienteId = cliente?.id ?? null;

  // Trocou de cliente: a plataforma volta para a que tem campanha no ar.
  useEffect(() => { setPlataformaEscolhida(null); }, [clienteId]);

  // O plano da semana pelo dossie: cache da semana, com "Reler" para forcar.
  useEffect(() => {
    if (!aberta || !clienteId) return;
    let vivo = true;
    setPlano(null);
    setLendoPlano(true);
    void lerPlanoDaSemana(clienteId, weekStart).then((p) => { if (vivo) { setPlano(p); setLendoPlano(false); } });
    return () => { vivo = false; };
  }, [aberta, clienteId, weekStart]);

  const { data: historia = [] } = useQuery({
    queryKey: ["esteira-historia", clienteId],
    enabled: aberta && Boolean(clienteId),
    queryFn: () => readMemory(clienteId as string, { limit: 20 }),
  });

  if (!cliente) return null;
  const e = cliente.esteira;
  // Trafego: uma plataforma por vez (Meta, Google, TikTok), nunca misturadas.
  const plataformas = frente === "trafego" ? plataformasDoCliente(cliente.fatos, hoje) : [];
  const plataforma: PlataformaAds = plataformaEscolhida
    ?? plataformas.find((p) => p.estado === "ativa")?.key
    ?? plataformas.find((p) => p.estado === "ligada")?.key
    ?? "meta_ads";
  const plataformaAtual = plataformas.find((p) => p.key === plataforma) ?? null;
  const itens = itensDaFrente(e, frente).filter((it) => frente !== "trafego" || it.fonte !== "anuncio" || !it.plataforma || it.plataforma === plataforma);
  const leitura = e.leituras.find((l) => l.frente === frente && (frente === "social" || l.plataforma === plataforma)) ?? null;
  // Insights soltos so quando nao ha leitura completa (ex.: segunda conta).
  const insights = leitura || frente === "trafego" ? [] : e.insights.filter((i) => i.frente === frente);
  const grupos = GRUPOS.map((g) => ({ ...g, itens: itens.filter((it) => g.fontes.includes(it.fonte)) })).filter((g) => g.itens.length > 0);
  const oculto = cliente.fatos.oculto.areas.includes(frente);

  // Proximos passos do dossie viram itens da esteira; feito/adiado/ignorado
  // valem por cima deles como em qualquer outro item.
  const itensDoPlano = (plano?.proximos ?? []).map((p) => itemDoPlano(cliente.id, p)).map((it) => {
    const est = cliente.fatos.estados[it.key];
    return est ? { ...it, estado: { status: est.status, note: est.note, doneAt: est.doneAt } } : it;
  });
  const planoAbertos = itensDoPlano.filter((it) => !it.estado);
  const planoFeitos = itensDoPlano.filter((it) => it.estado?.status === "done");

  const alternarRitual = async (key: "segunda" | "quarta" | "sexta", feito: boolean) => {
    if (!canWrite) { toast.error("Só admin ou manager marca rituais."); return; }
    const ok = await marcarRitual({ clientId: cliente.id, weekStart, ritual: key, feito });
    if (ok) onMudou(); else toast.error("Não foi possível gravar.");
  };

  const relerDossie = async () => {
    setLendoPlano(true);
    const p = await lerPlanoDaSemana(cliente.id, weekStart, true);
    setPlano(p);
    setLendoPlano(false);
    if (!p) toast.error("Não consegui ler o dossiê agora.");
    else void queryClient.invalidateQueries({ queryKey: ["esteira-historia", cliente.id] });
  };

  const montarLista = async () => {
    const texto = pedido.trim();
    if (texto.length < 3 || montando) return;
    if (!canWrite) { toast.error("Só admin ou manager cria listas."); return; }
    setMontando(true);
    try {
      let itensLista: string[] = [];
      try {
        const contexto = [plano?.foco ? `Foco da semana: ${plano.foco}` : "", cliente.fatos.dossieResumo ? `Dossiê: ${cliente.fatos.dossieResumo}` : ""].filter(Boolean).join("\n");
        const { data } = await supabase.functions.invoke("client-checklist", { body: { request: texto, client_name: cliente.nome, context: contexto } });
        if (Array.isArray((data as any)?.items) && (data as any).items.length) itensLista = (data as any).items;
      } catch { /* sem motor: divide o texto */ }
      if (itensLista.length === 0) itensLista = splitRequestIntoItems(texto);
      if (itensLista.length === 0) { toast.error("Escreva uma tarefa por linha."); return; }
      const criado = await createChecklist({ clientId: cliente.id, title: texto.slice(0, 50), items: itensLista, request: texto, tags: [frente] });
      if (!criado) { toast.error("A lista foi montada, mas não consegui guardar."); return; }
      setPedido("");
      toast.success(`Lista com ${itensLista.length} item${itensLista.length === 1 ? "" : "s"} entrou na esteira.`);
      onMudou();
    } finally { setMontando(false); }
  };

  return (
    <Sheet open={aberta} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:mx-auto sm:max-w-2xl [&>button]:right-4 [&>button]:top-6 [&>button]:h-9 [&>button]:w-9 [&>button]:opacity-100">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border" aria-hidden />
        <SheetHeader className="pr-12 text-left">
          <SheetTitle className="text-base">{cliente.nome}</SheetTitle>
          <SheetDescription>
            {e.onboardingCompleto ? "Em operação" : "Entrada em andamento"} · {e.resumo.urgentes} urgente{e.resumo.urgentes === 1 ? "" : "s"}, {e.resumo.atencao} de atenção · {e.feitos.length + planoFeitos.length} feito{e.feitos.length + planoFeitos.length === 1 ? "" : "s"} na semana
          </SheetDescription>
        </SheetHeader>

        {/* Pelo dossie: foco, o que foi feito, o que vem */}
        <section className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary"><Sparkles className="h-3.5 w-3.5" />Pelo dossiê e pela história</p>
            <button type="button" onClick={() => void relerDossie()} disabled={lendoPlano} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary disabled:opacity-50">
              <RefreshCw className={`h-3 w-3 ${lendoPlano ? "animate-spin" : ""}`} />Reler
            </button>
          </div>
          {lendoPlano && !plano && <p className="mt-1.5 text-[12px] text-muted-foreground">Lendo o dossiê e os últimos 14 dias…</p>}
          {plano && (
            <>
              {plano.foco && <p className="mt-1.5 text-[13px] font-medium text-foreground">{plano.foco}</p>}
              {plano.feito.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] text-muted-foreground">Feito nesta semana</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {plano.feito.map((f, i) => <li key={i} className="text-[12px] text-foreground/90">• {f}</li>)}
                  </ul>
                </div>
              )}
              {planoAbertos.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] text-muted-foreground">Próximos passos deste cliente</p>
                  <div className="space-y-1.5">
                    {planoAbertos.map((it) => <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={canWrite} onMudou={onMudou} />)}
                  </div>
                </div>
              )}
              {plano.proximos.length === 0 && plano.feito.length === 0 && !plano.foco && (
                <p className="mt-1.5 text-[12px] text-muted-foreground">O dossiê ainda não dá base para propor passos. Escreva o dossiê na Central e clique em Reler.</p>
              )}
              <p className="mt-1.5 text-[10px] text-muted-foreground/70">{plano.source === "ai" ? "Lido pela IA" : "Sem IA agora, só o que o painel prova"}{plano.cached ? " · desta semana" : ""}</p>
            </>
          )}
          {!lendoPlano && !plano && <p className="mt-1.5 text-[12px] text-muted-foreground">Não consegui ler o dossiê agora. Tente Reler.</p>}
        </section>

        {frente === "trafego" && plataformaAtual && (
          <>
            <TrafegoPlataformas plataformas={plataformas} selecionada={plataforma} onSelecionar={setPlataformaEscolhida} />
            {leitura ? <Numeros leitura={leitura} /> : <PlataformaNaoConfigurada plataforma={plataformaAtual} />}
            {plataformaAtual.estado !== "nao-configurada" && (
              <TrafegoVendas fatos={cliente.fatos} plataforma={plataforma} hoje={hoje} canWrite={canWrite} onMudou={onMudou} />
            )}
          </>
        )}
        {frente === "social" && leitura && <Numeros leitura={leitura} />}

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

        {grupos.length === 0 && planoAbertos.length === 0 && (
          <p className="mt-4 rounded-xl border border-border bg-secondary/40 px-3 py-4 text-center text-[13px] text-muted-foreground">Em dia. Nada pendente nesta frente.</p>
        )}
        {grupos.map((g) => (
          <section key={g.titulo} className="mt-4">
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">{g.titulo} · {g.itens.length}</p>
            <div className="space-y-1.5">
              {g.itens.map((it: EsteiraItem) => <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={canWrite} onMudou={onMudou} />)}
            </div>
          </section>
        ))}

        <Secao titulo="Lista rápida (vira itens da esteira)" aberta={listaAberta} onToggle={() => setListaAberta((v) => !v)}>
          <textarea
            value={pedido}
            onChange={(ev) => setPedido(ev.target.value)}
            placeholder="Descreva o que precisa ser feito para este cliente. Ex: gravar depoimento na loja, refazer a arte do cardápio e pedir as fotos novas."
            rows={2}
            className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none"
          />
          <button type="button" onClick={() => void montarLista()} disabled={pedido.trim().length < 3 || montando || !canWrite} className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-40">
            <Sparkles className={`h-3.5 w-3.5 ${montando ? "animate-pulse" : ""}`} />{montando ? "Montando a lista…" : "Montar checklist"}
          </button>
        </Secao>

        {(e.feitos.length > 0 || planoFeitos.length > 0) && (
          <Secao titulo={`Feitos nesta semana · ${e.feitos.length + planoFeitos.length}`} aberta={feitosAbertos} onToggle={() => setFeitosAbertos((v) => !v)}>
            <div className="space-y-1.5">
              {[...e.feitos, ...planoFeitos].map((it) => <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={canWrite} onMudou={onMudou} />)}
            </div>
          </Secao>
        )}

        <Secao titulo={`História deste cliente · ${historia.length}`} aberta={historiaAberta} onToggle={() => setHistoriaAberta((v) => !v)}>
          {historia.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Nada registrado ainda.</p>
          ) : (
            <div className="space-y-1.5">
              {historia.filter((h: MemoryEntry) => h.kind !== "esteira_plano").map((h: MemoryEntry) => (
                <div key={h.id} className="rounded-xl border border-border px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">{new Date(h.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · {MEMORY_LABELS[h.kind] || h.kind}</p>
                  <p className="text-[13px] font-medium leading-tight text-foreground">{h.title || ""}</p>
                  <p className="text-[12px] leading-snug text-muted-foreground line-clamp-3">{h.content}</p>
                </div>
              ))}
            </div>
          )}
        </Secao>

        {!e.onboardingCompleto && (
          <Secao titulo="O que este cliente já tem" aberta={jaTemAberto} onToggle={() => setJaTemAberto((v) => !v)}>
            <div className="space-y-1">
              {ONBOARDING.filter((p) => !p.soSe || cliente.fatos.servicos[p.soSe]).map((p) => {
                const tem = p.key in cliente.fatos.onboardingHas ? cliente.fatos.onboardingHas[p.key] : (p.auto ? p.auto(cliente.fatos) : false);
                return (
                  <div key={p.key} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                    <span className="text-[13px] text-foreground">{p.rotulo}{p.auto ? <span className="ml-1 text-[11px] text-muted-foreground">(detectado)</span> : null}</span>
                    <Switch checked={Boolean(tem)} disabled={!canWrite} onCheckedChange={async (v) => { const ok = await marcarJaTem(cliente.id, p.key, v); if (ok) { onMudou(); void queryClient.invalidateQueries({ queryKey: ["esteira-historia", cliente.id] }); } else toast.error("Não foi possível gravar."); }} />
                  </div>
                );
              })}
            </div>
          </Secao>
        )}

        {canWrite && (
          <section className="mt-5 flex flex-wrap gap-2 border-t border-border pt-3">
            {!oculto ? (
              <>
                <button type="button" onClick={async () => { const fim = new Date(`${weekStart}T00:00:00Z`); fim.setUTCDate(fim.getUTCDate() + 6); const ok = await ocultarCliente({ clientId: cliente.id, area: frente, ocultar: true, ateQuando: fim.toISOString().slice(0, 10) }); if (ok) { onMudou(); onFechar(); } }} className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-primary/50">Ocultar esta semana</button>
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
