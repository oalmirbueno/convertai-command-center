import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardCheck, Compass, Megaphone, Package, RefreshCw, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useNow } from "@/hooks/useNow";
import { usePwaProfile } from "@/hooks/usePwaProfile";
import { useEsteira, type ClienteDaEsteira } from "@/hooks/useEsteira";
import { itensDaFrente } from "@/lib/esteira/esteiraMontar";
import { ocultarCliente } from "@/lib/esteira/esteiraAcoes";
import { addDays, localIso, mondayOf, weekLabel } from "@/lib/cycleWeek";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import EsteiraClientSheet from "@/components/esteira/EsteiraClientSheet";
import EsteiraItemRow from "@/components/esteira/EsteiraItemRow";
import { useCentralReviewPendentes } from "@/hooks/useCentralReviewPendentes";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import { useFotosDosClientes } from "@/hooks/useFotosDosClientes";
import {
  AjudaRecolhida,
  AreaDeTrabalho,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Etapas,
  botao,
  etiqueta,
  foco,
  juntar,
  larguraDaMesa,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";

type Aba = "social" | "trafego" | "avulso";
/** Chave antiga da aba (antes do useEstadoDaTela): lida uma vez para ninguém perder a escolha. */
const ABA_KEY = "aceleriq-esteira-aba";
const ehAba = (v: unknown): v is Aba => v === "social" || v === "trafego" || v === "avulso";
const ehSemana = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function abaAntiga(): Aba {
  try {
    const s = typeof localStorage !== "undefined" ? localStorage.getItem(ABA_KEY) : null;
    return ehAba(s) ? s : "social";
  } catch {
    return "social";
  }
}

const ABAS: Array<{ k: Aba; rotulo: string; Icone: typeof Share2 }> = [
  { k: "social", rotulo: "Social", Icone: Share2 },
  { k: "trafego", rotulo: "Tráfego", Icone: Megaphone },
  { k: "avulso", rotulo: "Avulso", Icone: Package },
];

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// A Esteira é o Ciclo lido do estado real: cada bloco é um cliente, cada
// linha é um item que existe de verdade (post no seu elo, campanha, tarefa,
// passo de entrada). Sistema de design (docs/design/SISTEMA.md): cabeçalho
// fino com a semana e as ações na mesma linha, a lista sem caixa por cliente
// (divisória), no computador a lista rola por dentro (AreaDeTrabalho) e no
// celular a página rola normal, com as frentes na barra de baixo.

export default function AdminEsteira() {
  const { profile } = useAuth();
  usePwaProfile({ manifestHref: "/ciclo.webmanifest", appleTitle: "Ciclo", appleIcon: "/ciclo-apple-touch-icon.png" });
  const agora = useNow();

  // Aba e semana lembradas no navegador (sair e voltar mantém).
  const [aba, setAba] = useEstadoDaTela<Aba>("ciclo:aba", abaAntiga(), { validar: ehAba });
  const [semanaEscolhida, setSemanaEscolhida] = useEstadoDaTela<string>("ciclo:semana", "", { validar: ehSemana, esperaMs: 0 });
  const segundaDeHoje = useMemo(() => mondayOf(agora), [agora]);
  const segunda = useMemo(() => {
    if (!semanaEscolhida) return segundaDeHoje;
    const d = new Date(`${semanaEscolhida}T12:00:00`);
    return Number.isNaN(d.getTime()) ? segundaDeHoje : mondayOf(d);
  }, [semanaEscolhida, segundaDeHoje]);
  const semanaOffset = Math.round((segunda.getTime() - segundaDeHoje.getTime()) / (7 * 86400000));
  const irParaSemana = (delta: number) => {
    const nova = addDays(segunda, delta * 7);
    const iso = localIso(nova);
    setSemanaEscolhida(iso === localIso(segundaDeHoje) ? "" : iso);
  };
  const weekStart = localIso(segunda);

  const { clientes, carregando, atualizando, erro, recarregar } = useEsteira(weekStart, agora);
  const { total: revisoesPendentes } = useCentralReviewPendentes(profile?.role === "admin");
  const canWrite = !erro && ["admin", "manager"].includes(profile?.role || "");
  const clientesParaFoto = useMemo(() => clientes.map((c) => ({ id: c.id, nome: c.nome, avatar_url: c.avatarUrl })), [clientes]);
  const { fotoDe } = useFotosDosClientes(clientesParaFoto);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [quemEntraAberto, setQuemEntraAberto] = useState(false);
  const [comecarAberto, setComecarAberto] = useState(false);

  const atualizar = async () => {
    try {
      await recarregar();
      toast.success("Atualizado com o estado de agora.");
    } catch {
      toast.error("Não consegui atualizar agora.");
    }
  };

  const recarregarAposAcao = () => {
    void recarregar().catch(() => toast.error("A ação foi salva, mas não consegui atualizar a leitura. Tente atualizar novamente."));
  };

  // Altura real do topo fixo, medida: o espaço reservado nunca fica menor
  // nem maior que ele. Sem ResizeObserver (Safari 11), mede ao redimensionar.
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerH, setHeaderH] = useState(112);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const medir = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      setHeaderH((a) => (Math.abs(a - h) < 1 ? a : h));
    };
    medir();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", medir);
      return () => window.removeEventListener("resize", medir);
    }
    const ro = new ResizeObserver(medir);
    ro.observe(el);
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

  // Quantos clientes em cada frente (contador das abas).
  const contagemDasAbas = useMemo(() => {
    const c: Record<Aba, number> = { social: 0, trafego: 0, avulso: 0 };
    for (const x of clientes) {
      if (x.tipo === "one_off") { c.avulso += 1; continue; }
      if (x.fatos.servicos.social && !x.fatos.oculto.areas.includes("social")) c.social += 1;
      if (x.fatos.servicos.trafego && !x.fatos.oculto.areas.includes("trafego")) c.trafego += 1;
    }
    return c;
  }, [clientes]);

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

  const rotuloDaFrente = frente === "social" ? "Social" : "Tráfego";
  const quandoESemana = semanaOffset === 0
    ? "Semana atual"
    : `${Math.abs(semanaOffset)} ${Math.abs(semanaOffset) === 1 ? "semana" : "semanas"} ${semanaOffset < 0 ? "atrás" : "à frente"}`;
  const bloqueado = Boolean(erro) || carregando;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Topo FIXO (não sticky): no celular, a rolagem nunca leva a semana
          junto. O espaço reservado abaixo tem a mesma altura, medida. */}
      <header ref={headerRef} className="fixed inset-x-0 top-0 z-30 border-b border-border bg-background/95 pt-[calc(env(safe-area-inset-top)+0.625rem)] backdrop-blur">
        <div className={juntar(larguraDaMesa, "px-3 sm:px-4 md:px-6")}>
          {/* Linha 1: voltar, título, semana (do tablet para cima) e ações */}
          <div className="flex h-10 min-w-0 items-center">
            <Link to="/dashboard" aria-label="Voltar ao painel" className={juntar(botao.icone, "mr-1")}><ArrowLeft className="h-4 w-4" /></Link>
            <h1 className={juntar(texto.tituloPagina, "shrink-0 text-[18px]")}>Ciclo</h1>
            <AjudaRecolhida className="ml-1.5 min-h-0" titulo="Ciclo da semana">
              Cada bloco é um cliente e cada linha é algo que existe de verdade: post no seu elo, campanha, tarefa, passo de entrada. Toque no cliente para ver o dossiê, os números, os rituais e marcar o que foi feito. As frentes Social, Tráfego e Avulso ficam nas abas.
            </AjudaRecolhida>

            <div className="ml-3 hidden min-w-0 items-center md:flex">
              <SemanaNav segunda={segunda} quando={quandoESemana} offset={semanaOffset} onMudar={irParaSemana} onHoje={() => setSemanaEscolhida("")} />
            </div>

            <div className="ml-auto flex shrink-0 items-center pl-2 [&>*+*]:ml-1 sm:[&>*+*]:ml-2">
              {profile?.role === "admin" && (
                <Link to="/ciclo/revisao" aria-label="Revisão por cliente" title="Revisão por cliente" className={juntar(botao.secundario, "relative h-8 px-2 sm:px-3")}>
                  <ClipboardCheck className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Revisão</span>
                  {revisoesPendentes > 0 && <span className={juntar(etiqueta, "ml-1.5 bg-primary text-primary-foreground")} aria-label={`${revisoesPendentes} esperando decisão`}>{revisoesPendentes}</span>}
                </Link>
              )}
              <button type="button" onClick={() => setQuemEntraAberto(true)} aria-label="Quem entra" title="Quem entra" className={juntar(botao.discreto, "h-8 px-2")}>
                <Users className="h-4 w-4 lg:mr-1.5" aria-hidden="true" />
                <span className="hidden lg:inline">Quem entra</span>
              </button>
              <button type="button" aria-label="Atualizar" title="Atualizar" disabled={atualizando} onClick={() => void atualizar()} className={botao.icone}>
                <RefreshCw className={`h-4 w-4 ${atualizando ? "animate-spin" : ""}`} aria-hidden="true" />
              </button>
              <button type="button" aria-label="Por onde começar" title="Por onde começar" disabled={bloqueado} onClick={() => setComecarAberto(true)} className={juntar(botao.primario, "h-8 px-2.5 sm:px-3")}>
                <Compass className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Por onde começar</span>
              </button>
            </div>
          </div>

          {/* Linha 2: semana (celular) ou frentes (tablet para cima), e o estado em uma linha */}
          <div className="flex min-h-[40px] min-w-0 items-center pb-1.5">
            <div className="shrink-0 md:hidden">
              <SemanaNav segunda={segunda} quando={quandoESemana} offset={semanaOffset} onMudar={irParaSemana} onHoje={() => setSemanaEscolhida("")} />
            </div>
            <Etapas
              className="hidden md:block"
              rotulo="Frentes do ciclo"
              valor={aba}
              onEscolher={(v) => { if (ehAba(v)) setAba(v); }}
              itens={ABAS.map(({ k, rotulo, Icone }) => ({ valor: k, rotulo, icone: <Icone className="h-3.5 w-3.5" />, contador: contagemDasAbas[k] }))}
            />
            <p className={juntar(texto.auxiliar, "ml-auto min-w-0 truncate pl-3 text-right")} aria-live="polite">
              {erro ? (
                <span className="text-destructive">Leitura indisponível</span>
              ) : carregando && clientes.length === 0 ? (
                "Lendo a operação…"
              ) : (
                <>
                  <span className="hidden sm:inline">{plural(visiveis.length, "cliente", "clientes")}{" · "}</span>
                  <span className={resumo.urgentes ? "font-medium text-destructive" : ""}>{plural(resumo.urgentes, "urgente", "urgentes")}</span>
                  {" · "}<span className={resumo.atencao ? "font-medium text-warning" : ""}>{resumo.atencao} atenção</span>
                  <span className="hidden sm:inline">{" · "}<span className="text-primary">{resumo.emDia} em dia</span></span>
                  {resumo.entrada > 0 && <span className="hidden lg:inline">{" · "}{resumo.entrada} em entrada</span>}
                  <span className="hidden lg:inline">{" · "}rituais {resumo.rituaisFeitos}/{visiveis.length * 3}</span>
                  <span className="hidden xl:inline">{" · "}{plural(resumo.feitos, "feito", "feitos")} na semana</span>
                </>
              )}
            </p>
          </div>
        </div>
      </header>
      <div style={{ height: headerH }} aria-hidden />

      <main className={juntar(larguraDaMesa, "px-4 pb-[calc(env(safe-area-inset-bottom)+80px)] pt-3 md:px-6 md:pb-6")}>
        <AreaDeTrabalho rotuloDoPrincipal="Clientes do ciclo" memoriaDaRolagem={`ciclo:lista:${aba}:${weekStart}`}>
          {erro && (
            <EstadoDeErro
              className="mb-3"
              titulo="Não consegui atualizar a Esteira."
              descricao={clientes.length > 0 ? "Os dados abaixo são da última leitura concluída. As ações ficam pausadas até atualizar." : "A leitura está indisponível. Isso não significa que não há clientes ou pendências."}
              acao={<button type="button" disabled={atualizando} onClick={() => void atualizar()} className={juntar(botao.secundario, "h-8 text-[12px]")}>Tentar novamente</button>}
            />
          )}
          {carregando && clientes.length === 0 && !erro && <Carregando linhas={6} rotulo="Lendo a operação de cada cliente" />}
          {!erro && !carregando && visiveis.length === 0 && (
            <EstadoVazio
              icone={<Users className="h-5 w-5" />}
              titulo="Nenhum cliente nesta frente."
              descricao='Use "Quem entra" para incluir.'
              acao={<button type="button" onClick={() => setQuemEntraAberto(true)} className={botao.secundario}>Quem entra</button>}
            />
          )}
          {visiveis.length > 0 && (
            <ul className={juntar("grid min-w-0 grid-cols-1 lg:grid-cols-2 lg:gap-x-8", visiveis.length >= 3 && "desk:grid-cols-3")} aria-label={`Clientes em ${aba === "avulso" ? "Avulso" : rotuloDaFrente}`}>
              {visiveis.map((c) => (
                <li key={c.id} className="min-w-0 border-t border-border">
                  <CartaoDoCliente
                    cliente={c}
                    frente={frente}
                    weekStart={weekStart}
                    foto={fotoDe({ id: c.id, nome: c.nome, avatar_url: c.avatarUrl })}
                    onAbrir={() => setDetalheId(c.id)}
                    onMudou={recarregarAposAcao}
                  />
                </li>
              ))}
            </ul>
          )}
        </AreaDeTrabalho>
      </main>

      {/* Celular: as frentes na barra de baixo, a um toque do polegar. Do tablet
          para cima elas ficam no cabeçalho (Etapas). */}
      <nav aria-label="Frentes do ciclo" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto flex h-14 max-w-[560px] items-stretch">
          {ABAS.map(({ k, rotulo, Icone }) => (
            <button key={k} type="button" onClick={() => setAba(k)} aria-current={aba === k ? "page" : undefined} className={juntar("flex flex-1 flex-col items-center justify-center text-[11px]", aba === k ? "text-primary" : "text-muted-foreground", foco)}>
              <Icone className="mb-0.5 h-5 w-5" aria-hidden="true" />{rotulo}
            </button>
          ))}
        </div>
      </nav>

      <EsteiraClientSheet cliente={detalhe} frente={frente} weekStart={weekStart} canWrite={canWrite} canReview={profile?.role === "admin"} aberta={detalhe !== null} onFechar={() => setDetalheId(null)} onMudou={recarregarAposAcao} />

      {/* Por onde começar: a carteira ordenada pela urgência real, com o
          motivo de cada posição. Toca no cliente e abre a gaveta dele. */}
      <Sheet open={comecarAberto} onOpenChange={setComecarAberto}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:mx-auto sm:max-w-lg sm:px-6">
          <SheetHeader className="space-y-0 pr-10 text-left">
            <SheetTitle className={texto.tituloSecao}>Por onde começar em {rotuloDaFrente}</SheetTitle>
            <SheetDescription className={texto.auxiliar}>Pela urgência real de cada cliente.</SheetDescription>
          </SheetHeader>
          {(() => {
            const fila = visiveis
              .map((c) => {
                const its = itensDaFrente(c.esteira, frente);
                const urg = its.filter((i) => i.gravidade === "urgente");
                const att = its.filter((i) => i.gravidade === "atencao");
                const primeiros = [...urg, ...att, ...its.filter((i) => i.gravidade === "normal")].slice(0, 2);
                const rituaisFaltando = c.esteira.rituais.filter((r) => !r.feito).length;
                const peso = urg.length * 100 + att.length * 10 + (c.esteira.onboardingCompleto ? 0 : 5) + rituaisFaltando;
                return { c, its, urg, att, primeiros, peso, rituaisFaltando };
              })
              .filter((x) => x.its.length > 0 || x.rituaisFaltando > 0)
              .sort((a, b) => b.peso - a.peso || a.c.nome.localeCompare(b.c.nome));
            if (fila.length === 0) return <EstadoVazio compacto className="mt-4" titulo="Tudo em dia nesta frente." descricao="Nada para começar." />;
            const top = fila[0];
            return (
              <div className="mt-3">
                <p className={juntar(superficie.poco, "px-3 py-2 text-[13px] leading-5")}>
                  Comece por <span className="font-semibold">{top.c.nome}</span>: {top.urg.length ? `${top.urg.length} urgente${top.urg.length === 1 ? "" : "s"}` : top.att.length ? `${top.att.length} de atenção` : "o que pede a semana"}{top.primeiros[0] ? `. Primeiro: ${top.primeiros[0].titulo}, ${top.primeiros[0].passo.toLowerCase()}.` : "."}
                </p>
                <ol className="mt-2 divide-y divide-border">
                  {fila.map((x, i) => (
                    <li key={x.c.id}>
                      <button type="button" onClick={() => { setComecarAberto(false); setDetalheId(x.c.id); }} className={juntar("flex w-full min-w-0 items-start rounded-md px-1 py-2.5 text-left hover:bg-muted/50", foco)}>
                        <span className="mr-2.5 mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center">
                            <span className="mr-1.5 min-w-0 truncate text-[13px] font-semibold">{x.c.nome}</span>
                            {x.urg.length > 0 && <span className={juntar(etiqueta, "mr-1 bg-destructive/15 text-destructive")}>{x.urg.length}</span>}
                            {x.att.length > 0 && <span className={juntar(etiqueta, "mr-1 bg-warning/15 text-warning")}>{x.att.length}</span>}
                            {x.rituaisFaltando > 0 && <span className="shrink-0 text-[11px] text-muted-foreground">rituais {3 - x.rituaisFaltando}/3</span>}
                          </span>
                          {x.primeiros.map((it) => (
                            <span key={it.key} className="block truncate text-[12px] text-muted-foreground">{it.titulo}: {it.passo}</span>
                          ))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      <Sheet open={quemEntraAberto} onOpenChange={setQuemEntraAberto}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:mx-auto sm:max-w-lg sm:px-6">
          <SheetHeader className="space-y-0 pr-10 text-left">
            <SheetTitle className={texto.tituloSecao}>Quem entra em {rotuloDaFrente}</SheetTitle>
            <SheetDescription className={texto.auxiliar}>{ocultos.length === 0 ? "Ninguém oculto nesta frente." : plural(ocultos.length, "oculto", "ocultos")}</SheetDescription>
          </SheetHeader>
          <ul className="mt-3 divide-y divide-border">
            {clientes.filter((c) => c.tipo !== "one_off").map((c) => {
              const temServico = c.fatos.servicos[frente];
              const oculto = c.fatos.oculto.areas.includes(frente);
              const estado = !temServico ? "sem este serviço" : oculto ? (c.fatos.oculto.ate ? `oculto até ${c.fatos.oculto.ate.slice(8, 10)}/${c.fatos.oculto.ate.slice(5, 7)}` : "fora desta frente") : "na esteira";
              return (
                <li key={c.id} className="flex min-w-0 items-center justify-between py-2">
                  <div className="mr-3 min-w-0"><p className="truncate text-[13px] font-medium">{c.nome}</p><p className={texto.auxiliar}>{estado}</p></div>
                  {temServico && canWrite && (
                    <button type="button" onClick={async () => { const ok = await ocultarCliente({ clientId: c.id, area: frente, ocultar: !oculto, ateQuando: null }); if (ok) recarregarAposAcao(); }} className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")}>{oculto ? "Incluir" : "Ocultar"}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Semana: anterior, o rótulo (toque volta para hoje) e a próxima. */
function SemanaNav({ segunda, quando, offset, onMudar, onHoje }: { segunda: Date; quando: string; offset: number; onMudar: (delta: number) => void; onHoje: () => void }) {
  return (
    <div className="flex min-w-0 items-center">
      <button type="button" aria-label="Semana anterior" onClick={() => onMudar(-1)} className={botao.icone}><ChevronLeft className="h-4 w-4" /></button>
      <button type="button" onClick={onHoje} disabled={offset === 0} title={offset === 0 ? undefined : "Voltar para a semana atual"} className={juntar("mx-0.5 min-w-0 rounded-md px-1 text-center disabled:cursor-default", foco)}>
        <span className="block truncate text-[13px] font-semibold leading-5">{weekLabel(segunda)}</span>
        <span className={juntar("block truncate text-[11px] leading-4", offset === 0 ? "text-muted-foreground" : "text-primary")}>{quando}</span>
      </button>
      <button type="button" aria-label="Próxima semana" onClick={() => onMudar(1)} className={botao.icone}><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

/** Um cliente na lista: sem caixa, as três linhas que mais pedem e os rituais. */
function CartaoDoCliente({ cliente: c, frente, weekStart, foto, onAbrir, onMudou }: {
  cliente: ClienteDaEsteira;
  frente: "social" | "trafego";
  weekStart: string;
  foto: ReturnType<ReturnType<typeof useFotosDosClientes>["fotoDe"]>;
  onAbrir: () => void;
  onMudou: () => void;
}) {
  const itens = itensDaFrente(c.esteira, frente);
  const topo = itens.slice(0, 3);
  const resto = itens.length - topo.length;
  const r = c.esteira.rituais;
  const urgentes = itens.filter((i) => i.gravidade === "urgente").length;
  const atencao = itens.filter((i) => i.gravidade === "atencao").length;
  const insight = c.esteira.insights.filter((i) => i.frente === frente)[0];
  return (
    <button type="button" onClick={onAbrir} className={juntar("block w-full min-w-0 rounded-md px-1 py-3 text-left transition-colors hover:bg-muted/40 lg:px-2", foco)}>
      <span className="flex min-w-0 items-center">
        <span className="mr-2.5 shrink-0"><FotoDoCliente nome={c.nome} foto={foto} tamanho="md" /></span>
        <span className="mr-2 min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold leading-5">{c.nome}</span>
          <span className={juntar(texto.auxiliar, "block truncate")}>{c.esteira.onboardingCompleto ? "Em operação" : "Entrada em andamento"}</span>
        </span>
        <span className="flex shrink-0 items-center [&>*+*]:ml-1">
          {urgentes > 0 && <span className={juntar(etiqueta, "bg-destructive/15 text-destructive")} title="Urgentes">{urgentes}</span>}
          {atencao > 0 && <span className={juntar(etiqueta, "bg-warning/15 text-warning")} title="Atenção">{atencao}</span>}
          {itens.length === 0 && <span className={juntar(etiqueta, "bg-primary/15 text-primary")}>em dia</span>}
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </span>
      </span>
      {topo.length > 0 && (
        <span className="mt-1.5 block pl-[46px]">
          {topo.map((it) => <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={false} onMudou={onMudou} compacto />)}
          {resto > 0 && <span className={juntar(texto.auxiliar, "block pl-[18px]")}>+ {resto} {resto === 1 ? "item" : "itens"}</span>}
        </span>
      )}
      <span className="mt-2 flex min-w-0 items-center pl-[46px]">
        {r.map((x) => (
          <span key={x.key} title={x.rotulo} className={`mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${x.feito ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
            {x.key === "segunda" ? "S" : x.key === "quarta" ? "Q" : "S"}
          </span>
        ))}
        <span className={juntar(texto.auxiliar, "ml-1 shrink-0")}>rituais {r.filter((x) => x.feito).length}/3</span>
        {insight && (
          <span className={juntar(texto.auxiliar, "ml-auto min-w-0 truncate pl-3")}>{insight.titulo}: {insight.atual ?? "–"}{insight.variacao !== null ? ` (${(insight.variacao as number) > 0 ? "+" : ""}${insight.variacao}%)` : ""}</span>
        )}
      </span>
    </button>
  );
}
