import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCheck, ClipboardCheck, Eye, EyeOff, History, ListPlus, ListTodo, Minus, PackageCheck, ScanSearch, Sparkles, TrendingDown, TrendingUp, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { ClienteDaEsteira } from "@/hooks/useEsteira";
import type { EsteiraItem, Fonte, Insight, Leitura, Numero, PlataformaAds } from "@/lib/esteira/esteiraTipos";
import { ONBOARDING, itensDaFrente, plataformasDoCliente } from "@/lib/esteira/esteiraMontar";
import { itemDoPlano, lerPlanoDaSemana, marcarJaTem, marcarRitual, ocultarCliente, type PlanoDaSemana } from "@/lib/esteira/esteiraAcoes";
import { createChecklist, splitRequestIntoItems } from "@/lib/clientChecklist";
import { MEMORY_LABELS, readMemory, type MemoryEntry } from "@/lib/clientMemory";
import EsteiraItemRow from "./EsteiraItemRow";
import MetasDeSeguidores from "./MetasDeSeguidores";
import TrafegoPlataformas, { PlataformaNaoConfigurada } from "./TrafegoPlataformas";
import TrafegoVendas from "./TrafegoVendas";
import { Carregando, EstadoVazio, Etapas, JanelaCentral, MenuMais, RegiaoRolavel, Secao as SecaoDoSistema, botao, campoTexto, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";

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

function Numeros({ leitura, recolher }: { leitura: Leitura; recolher: string }) {
  const cor = (t: Numero["tendencia"]) => (t === "sobe" ? "text-primary" : t === "cai" ? "text-destructive" : "text-muted-foreground");
  const titulo = leitura.frente === "social" ? "Números do Instagram" : `Números · ${leitura.plataforma ? ROTULO_PLATAFORMA[leitura.plataforma] : "anúncios"}`;
  const colunas = leitura.numeros.length >= 5 ? "grid-cols-2 sm:grid-cols-3" : leitura.numeros.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3";
  // Sistema de design: seção sem caixa; cada número num poço; subiu, parado e
  // caiu em colunas de texto, sem caixa por grupo.
  return (
    <SecaoDoSistema
      nivel={3}
      divisoria
      recolher={recolher}
      resumo={leitura.numeros.slice(0, 2).map((n) => `${n.rotulo} ${fmtNumero(n)}`).join(" · ")}
      titulo={titulo}
      descricao={leitura.periodo}
    >
      <div className={`grid gap-2 ${colunas}`}>
        {leitura.numeros.map((n) => (
          <div key={n.rotulo} className={juntar(superficie.poco, "min-w-0 px-3 py-2")}>
            <p className={juntar(texto.rotulo, "truncate")}>{n.rotulo}</p>
            {/* 16/10/2026: no celular o número encolhe um pouco e quebra em vez de vazar. */}
            <p className="break-words text-[17px] font-semibold leading-7 tabular-nums text-foreground sm:text-[20px]">{fmtNumero(n)}</p>
            <p className={`flex items-center text-[12px] tabular-nums ${cor(n.tendencia)}`}>
              <span className="mr-1 inline-flex"><IconeTendencia t={n.tendencia} /></span>
              {n.variacao !== null ? `${n.variacao > 0 ? "+" : ""}${n.variacao}%` : n.anterior !== null ? "igual" : "sem base"}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { t: "Subiu", lista: leitura.subiu, cls: "text-primary" },
          { t: "Parado", lista: leitura.parado, cls: "text-muted-foreground" },
          { t: "Caiu", lista: leitura.caiu, cls: "text-destructive" },
        ].map((g) => (
          <div key={g.t} className="min-w-0">
            <p className={`text-[12px] font-medium ${g.cls}`}>{g.t}</p>
            {g.lista.length === 0 ? <p className="text-[12px] text-muted-foreground/70">nada</p> : g.lista.map((x, i) => <p key={i} className="text-[12px] leading-5 text-foreground/90">{x}</p>)}
          </div>
        ))}
      </div>
      {leitura.fazer.length > 0 && (
        <div className={juntar(superficie.poco, "mt-3 px-3 py-2")}>
          <p className="text-[12px] font-medium text-primary">O que fazer por causa disso</p>
          <ul className="mt-1 space-y-1">
            {leitura.fazer.map((x, i) => <li key={i} className="text-[13px] leading-5 text-foreground">• {x}</li>)}
          </ul>
        </div>
      )}
    </SecaoDoSistema>
  );
}

/** Abas da folha (16/10/2026, padrão do painel): uma parte visível por vez. */
type AbaDaFolha = "semana" | "dossie" | "numeros" | "lista" | "feitos" | "historia" | "ja-tem";
const ABAS_DA_FOLHA: readonly AbaDaFolha[] = ["semana", "dossie", "numeros", "lista", "feitos", "historia", "ja-tem"];
const ehAbaDaFolha = (v: unknown): v is AbaDaFolha => typeof v === "string" && (ABAS_DA_FOLHA as readonly string[]).includes(v);

interface Props {
  cliente: ClienteDaEsteira | null;
  frente: "social" | "trafego";
  weekStart: string;
  canWrite: boolean;
  canReview?: boolean;
  aberta: boolean;
  onFechar: () => void;
  onMudou: () => void;
}

export default function EsteiraClientSheet({ cliente, frente, weekStart, canWrite, canReview = false, aberta, onFechar, onMudou }: Props) {
  const queryClient = useQueryClient();
  const [pedido, setPedido] = useState("");
  const [montando, setMontando] = useState(false);
  const [plano, setPlano] = useState<PlanoDaSemana | null>(null);
  const [lendoPlano, setLendoPlano] = useState(false);
  const [plataformaEscolhida, setPlataformaEscolhida] = useState<PlataformaAds | null>(null);
  const hoje = useMemo(() => new Date(), []);
  // A aba aberta da folha fica lembrada (sair e voltar mantém).
  const [abaGuardada, setAba] = useEstadoDaTela<AbaDaFolha>("ciclo:folha:aba", "semana", { validar: ehAbaDaFolha });

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
  // Passo do plano feito numa semana anterior continua feito (frente CE,
  // 28/09): antes a marca valia só para a semana e o passo voltava.
  const itensDoPlano = (plano?.proximos ?? []).map((p) => itemDoPlano(cliente.id, p)).map((it) => {
    const est = cliente.fatos.estados[it.key];
    if (est) return { ...it, estado: { status: est.status, note: est.note, doneAt: est.doneAt } };
    const antes = cliente.fatos.estadosAnteriores?.[it.key];
    return antes ? { ...it, estado: { status: "done" as const, note: null, doneAt: antes.doneAt } } : it;
  });
  // Cada aba ve os passos da sua frente (e os gerais); trafego nunca herda social.
  const planoAbertos = itensDoPlano.filter((it) => !it.estado && (it.frente === "geral" || it.frente === frente));
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

  const feitosNaSemana = e.feitos.length + planoFeitos.length;
  const ritualFeitos = e.rituais.filter((r) => r.feito).length;
  const historiaVisivel = historia.filter((h: MemoryEntry) => h.kind !== "esteira_plano");
  const passosDeEntrada = ONBOARDING.filter((p) => !p.soSe || cliente.fatos.servicos[p.soSe]);
  const temPasso = (p: (typeof ONBOARDING)[number]) => (p.key in cliente.fatos.onboardingHas ? cliente.fatos.onboardingHas[p.key] : (p.auto ? p.auto(cliente.fatos) : false));
  // Recolher (dono, 28/09): cada bloco da folha lembra se está aberto, por cliente.
  const chave = (bloco: string) => `ciclo:folha:${bloco}:${cliente.id}`;

  const itensPendentes = grupos.reduce((n, g) => n + g.itens.length, 0);
  const temNumeros = frente === "social" || Boolean(plataformaAtual);
  const abas = [
    { valor: "semana", rotulo: "O que a semana pede", icone: <ListTodo className="h-4 w-4" />, contador: itensPendentes, ajuda: "Os rituais da semana e o que está pendente nesta frente: entrada, publicações, anúncios, tarefas e checklists." },
    { valor: "dossie", rotulo: "Pelo dossiê", icone: <Sparkles className="h-4 w-4" />, contador: planoAbertos.length, ajuda: "Foco da semana, o que foi feito e os próximos passos, lidos do dossiê e da história dos últimos 14 dias. Reler força uma nova leitura." },
    temNumeros && { valor: "numeros", rotulo: "Números", icone: <BarChart3 className="h-4 w-4" />, ajuda: frente === "social" ? "Números do Instagram, metas de seguidores e o que mudou." : "Números de cada plataforma de anúncio, uma por vez, e as vendas." },
    { valor: "lista", rotulo: "Lista rápida", icone: <ListPlus className="h-4 w-4" />, ajuda: "Escreva o que precisa ser feito para este cliente: vira itens da esteira." },
    feitosNaSemana > 0 && { valor: "feitos", rotulo: "Feitos nesta semana", icone: <CheckCheck className="h-4 w-4" />, contador: feitosNaSemana },
    { valor: "historia", rotulo: "História deste cliente", icone: <History className="h-4 w-4" />, contador: historiaVisivel.length },
    !e.onboardingCompleto && { valor: "ja-tem", rotulo: "O que este cliente já tem", icone: <PackageCheck className="h-4 w-4" />, ajuda: "Os passos de entrada que o cliente já tem. Os marcados como detectados o painel achou sozinho." },
  ].filter(Boolean) as Array<{ valor: AbaDaFolha; rotulo: string; icone: ReactNode; contador?: number; ajuda?: string }>;
  // Aba guardada que não existe para este cliente (ex.: sem feitos) cai na semana.
  const aba: AbaDaFolha = abas.some((a) => a.valor === abaGuardada) ? abaGuardada : "semana";
  const descricaoDoDossie = plano ? `${plano.source === "ai" ? `Lido pela IA${plano.modelo ? ` (${plano.modelo})` : ""}` : "Sem IA agora, só o que o painel prova"}${plano.cached ? " · desta semana" : ""}${plano.removidos_por_ja_feito ? ` · ${plano.removidos_por_ja_feito} já feito(s) fora do plano` : ""}${plano.reserva ? ` · ${plano.reserva}` : ""}` : null;

  const ocultarSemana = async () => {
    const fim = new Date(`${weekStart}T00:00:00Z`);
    fim.setUTCDate(fim.getUTCDate() + 6);
    const ok = await ocultarCliente({ clientId: cliente.id, area: frente, ocultar: true, ateQuando: fim.toISOString().slice(0, 10) });
    if (ok) { onMudou(); onFechar(); }
  };
  const tirarDaFrente = async () => {
    const ok = await ocultarCliente({ clientId: cliente.id, area: frente, ocultar: true, ateQuando: null });
    if (ok) { onMudou(); onFechar(); }
  };
  const voltarAMostrar = async () => {
    const ok = await ocultarCliente({ clientId: cliente.id, area: frente, ocultar: false });
    if (ok) onMudou();
  };

  // Sistema de design: a folha é uma janela central (30/09, dono: "qualquer
  // pop-up abrir no centro"). 16/10/2026 (dono): as partes, que vinham uma
  // embaixo da outra, viram abas em ícone no topo (uma visível por vez); as
  // ações vão para o cabeçalho, só em ícone, e o ocultar para o menu "...".
  // Corpo rolando por dentro (RegiaoRolavel "sempre", posição lembrada por
  // cliente e aba), sem caixa dentro de caixa.
  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      largura="lg"
      corpo="fixo"
      semEspaco
      titulo={cliente.nome}
      // 16/10/2026 (celular mais limpo): abaixo de 640 px a linha de estado
      // mostra só os urgentes; o resto continua a partir do tablet.
      descricao={<><span className="max-sm:hidden">{`${e.onboardingCompleto ? "Em operação" : "Entrada em andamento"} · `}</span>{`${e.resumo.urgentes} urgente${e.resumo.urgentes === 1 ? "" : "s"}`}<span className="max-sm:hidden">{` · ${e.resumo.atencao} de atenção · ${feitosNaSemana} feito${feitosNaSemana === 1 ? "" : "s"}`}</span></>}
      acoes={(canReview || canWrite) ? (
        <>
          {canReview && (
            <Link to={`/ciclo/revisao?client=${encodeURIComponent(cliente.id)}`} aria-label="Revisar rituais deste cliente" title="Revisar rituais deste cliente" className={botao.icone}>
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          {canWrite && (
            <MenuMais
              rotulo="Mais ações deste cliente"
              itens={oculto ? [
                { rotulo: "Voltar a mostrar nesta frente", icone: <Eye className="h-4 w-4" />, aoEscolher: () => void voltarAMostrar() },
              ] : [
                { rotulo: "Ocultar esta semana", icone: <EyeOff className="h-4 w-4" />, aoEscolher: () => void ocultarSemana() },
                { rotulo: "Tirar desta frente", icone: <UserMinus className="h-4 w-4" />, aoEscolher: () => void tirarDaFrente(), perigo: true },
              ]}
            />
          )}
        </>
      ) : undefined}
    >
        <div className="flex min-w-0 shrink-0 items-center border-b border-border px-3 py-1 sm:px-4">
          <Etapas
            soIcone
            rotulo="Partes da folha do cliente"
            className="min-w-0 flex-1"
            valor={aba}
            onEscolher={(v) => { if (ehAbaDaFolha(v)) setAba(v); }}
            itens={abas}
          />
          {aba === "dossie" && (
            <button type="button" onClick={() => void relerDossie()} disabled={lendoPlano} aria-label="Reler o dossiê" title="Reler o dossiê" className={juntar(botao.icone, "ml-1")}>
              <ScanSearch className={`h-4 w-4 ${lendoPlano ? "animate-pulse" : ""}`} aria-hidden="true" />
            </button>
          )}
        </div>
        <RegiaoRolavel modo="sempre" sobre="cartao" memoria={`ciclo:folha:${cliente.id}:${frente}:${aba}`} className="px-4 pb-5 pt-4 sm:px-5">
          <div className="space-y-5">
            {aba === "semana" && (
              <>
                <div className="min-w-0">
                  <p className={juntar(texto.rotulo, "mb-1")}>Rituais da semana · {ritualFeitos} de {e.rituais.length}</p>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
                    {e.rituais.map((r) => (
                      <label key={r.key} className={juntar("flex min-w-0 cursor-pointer items-center rounded-md px-2 py-2 text-[13px] hover:bg-muted/60 max-sm:min-h-[44px]", r.feito ? "text-foreground" : "text-muted-foreground")}>
                        <Checkbox checked={r.feito} onCheckedChange={(v) => void alternarRitual(r.key, v === true)} disabled={!canWrite} className="mr-2 min-h-0 shrink-0" />
                        <span className="min-w-0 leading-tight">{r.rotulo}{r.fonte === "central" ? " · Central" : ""}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {grupos.length === 0 && planoAbertos.length === 0 && (
                  <EstadoVazio compacto titulo="Em dia." descricao="Nada pendente nesta frente." />
                )}
                {grupos.length === 0 && planoAbertos.length > 0 && (
                  <p className={texto.auxiliar}>Nada pendente nos itens da frente. O dossiê propõe {planoAbertos.length} {planoAbertos.length === 1 ? "próximo passo" : "próximos passos"}: veja em Pelo dossiê.</p>
                )}
                {grupos.map((g) => (
                  <SecaoDoSistema
                    key={g.titulo}
                    nivel={3}
                    divisoria
                    recolher={chave(`grupo:${g.fontes[0]}`)}
                    resumo={`${g.itens.length} ${g.itens.length === 1 ? "item" : "itens"}`}
                    titulo={g.titulo}
                    descricao={`${g.itens.length} ${g.itens.length === 1 ? "item" : "itens"}`}
                  >
                    <div className="divide-y divide-border">
                      {g.itens.map((it: EsteiraItem) => <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={canWrite} onMudou={onMudou} />)}
                    </div>
                  </SecaoDoSistema>
                ))}
              </>
            )}

            {/* Pelo dossiê: foco, o que foi feito, o que vem */}
            {aba === "dossie" && (
              <div className="min-w-0">
                {descricaoDoDossie && <p className={juntar(texto.auxiliar, "mb-2")}>{descricaoDoDossie}</p>}
                {lendoPlano && !plano && <Carregando linhas={2} rotulo="Lendo o dossiê" />}
                {plano && (
                  <div className="space-y-3">
                    {plano.foco && <p className="text-[13px] font-medium leading-5 text-foreground">{plano.foco}</p>}
                    {plano.feito.length > 0 && (
                      <div>
                        <p className={texto.rotulo}>Feito nesta semana</p>
                        <ul className="mt-1 space-y-0.5">
                          {plano.feito.map((f, i) => <li key={i} className="text-[13px] leading-5 text-foreground/90">• {f}</li>)}
                        </ul>
                      </div>
                    )}
                    {planoAbertos.length > 0 && (
                      <div>
                        <p className={texto.rotulo}>Próximos passos</p>
                        <div className="divide-y divide-border">
                          {planoAbertos.map((it) => <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={canWrite} onMudou={onMudou} />)}
                        </div>
                      </div>
                    )}
                    {plano.lacunas.length > 0 && (
                      <div>
                        <p className="text-[12px] font-medium text-warning">O que a esteira não encontrou</p>
                        <ul className="mt-1 space-y-0.5">
                          {plano.lacunas.map((l, i) => <li key={i} className="text-[12px] leading-5 text-foreground/85">• {l}</li>)}
                        </ul>
                      </div>
                    )}
                    {plano.proximos.length === 0 && plano.feito.length === 0 && !plano.foco && (
                      <p className={texto.auxiliar}>O dossiê ainda não dá base para propor passos. Escreva o dossiê na Central e clique em Reler.</p>
                    )}
                  </div>
                )}
                {!lendoPlano && !plano && <p className={texto.auxiliar}>Não consegui ler o dossiê agora. Tente Reler.</p>}
              </div>
            )}

            {aba === "numeros" && (
              <>
                {frente === "trafego" && plataformaAtual && (
                  <>
                    <TrafegoPlataformas plataformas={plataformas} selecionada={plataforma} onSelecionar={setPlataformaEscolhida} />
                    {leitura ? <Numeros leitura={leitura} recolher={chave("numeros")} /> : <PlataformaNaoConfigurada plataforma={plataformaAtual} />}
                    {plataformaAtual.estado !== "nao-configurada" && (
                      <TrafegoVendas fatos={cliente.fatos} plataforma={plataforma} hoje={hoje} canWrite={canWrite} onMudou={onMudou} />
                    )}
                  </>
                )}
                {frente === "social" && leitura && <Numeros leitura={leitura} recolher={chave("numeros")} />}
                {frente === "social" && <MetasDeSeguidores clientId={cliente.id} metricas={cliente.fatos.metricas} canWrite={canWrite} />}

                {insights.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {insights.map((i) => (
                      <div key={i.key} className={juntar(superficie.poco, "min-w-0 px-3 py-2")}>
                        <p className={juntar(texto.rotulo, "flex items-center")}><span className="mr-1.5 inline-flex"><IconeTendencia t={i.tendencia} /></span>{i.titulo}</p>
                        <p className="text-[13px] leading-5 text-foreground">{i.texto}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {aba === "lista" && (
              <div className="min-w-0">
                <textarea
                  value={pedido}
                  onChange={(ev) => setPedido(ev.target.value)}
                  placeholder="O que precisa ser feito para este cliente. Ex.: gravar depoimento na loja, refazer a arte do cardápio."
                  rows={3}
                  aria-label="Pedido da lista rápida"
                  className={juntar(campoTexto, "min-h-[80px] resize-none")}
                />
                <div className="mt-2 flex min-w-0 items-center justify-end">
                  <button type="button" onClick={() => void montarLista()} disabled={pedido.trim().length < 3 || montando || !canWrite} className={botao.primario}>
                    <Sparkles className={`mr-1.5 h-3.5 w-3.5 ${montando ? "animate-pulse" : ""}`} aria-hidden="true" />{montando ? "Montando…" : "Montar checklist"}
                  </button>
                </div>
              </div>
            )}

            {aba === "feitos" && (
              <div className="divide-y divide-border">
                {[...e.feitos, ...planoFeitos].map((it) => <EsteiraItemRow key={it.key} item={it} weekStart={weekStart} canWrite={canWrite} onMudou={onMudou} />)}
              </div>
            )}

            {aba === "historia" && (
              historiaVisivel.length === 0 ? (
                <p className={texto.auxiliar}>Nada registrado ainda.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {historiaVisivel.map((h: MemoryEntry) => (
                    <li key={h.id} className="min-w-0 py-2">
                      <p className={texto.auxiliar}>{new Date(h.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · {MEMORY_LABELS[h.kind] || h.kind}</p>
                      <p className="text-[13px] font-medium leading-5 text-foreground">{h.title || ""}</p>
                      <p className="text-[12px] leading-5 text-muted-foreground line-clamp-3">{h.content}</p>
                    </li>
                  ))}
                </ul>
              )
            )}

            {aba === "ja-tem" && (
              <div className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-1")}>{passosDeEntrada.filter((p) => temPasso(p)).length} de {passosDeEntrada.length}</p>
                <ul className="divide-y divide-border">
                  {passosDeEntrada.map((p) => {
                    const tem = temPasso(p);
                    return (
                      <li key={p.key} className="flex min-w-0 items-center justify-between py-2">
                        <span className="mr-3 min-w-0 text-[13px] text-foreground">{p.rotulo}{p.auto ? <span className="ml-1 text-[12px] text-muted-foreground">(detectado)</span> : null}</span>
                        <Switch checked={Boolean(tem)} disabled={!canWrite} aria-label={p.rotulo} className="min-h-0 shrink-0" onCheckedChange={async (v) => { const ok = await marcarJaTem(cliente.id, p.key, v); if (ok) { onMudou(); void queryClient.invalidateQueries({ queryKey: ["esteira-historia", cliente.id] }); } else toast.error("Não foi possível gravar."); }} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </RegiaoRolavel>
    </JanelaCentral>
  );
}
