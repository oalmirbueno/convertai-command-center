import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import BarraDeCusto, { DialogoDeRecarga, type ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import { MesaProvider, useCatalogo, type MesaValor } from "@/components/mesa/MesaContexto";
import { inicioDoMes, lerPrevisao, type PrevisaoDoPlano } from "@/lib/mesa/api";

/**
 * Mesa do cliente (/mesa, só equipe: admin, gestor e design).
 *
 * Traz para dentro do painel o calendário e a arte que eram feitos fora.
 * Cinco abas em sequência (Contexto, Mês, Campanhas, Estúdio, Entrega) e uma
 * barra de custo fixa no topo. Endereço completo:
 * /mesa?client=<id>&aba=estudio&task=<id>&mes=AAAA-MM-01
 * (na aba Campanhas: &campanha=<id>, ou &hype=<n> para abrir a campanha nova
 * a partir do hype n da busca mais recente)
 *
 * Abre rápido (pedido do dono em 23/09): o cliente sai do endereço na hora,
 * sem esperar a lista de clientes; cada aba baixa só quando é aberta (as
 * outras vêm em tempo ocioso, logo depois); e o que já foi lido volta do
 * cache guardado no navegador (src/lib/mesa/cachePersistido.ts).
 */

// Cada aba em arquivo próprio: a Mesa pinta o cabeçalho e a barra sem
// esperar o código do Estúdio, que é o maior.
const carregarContexto = () => import("@/components/mesa/AbaContexto");
const carregarMes = () => import("@/components/mesa/AbaMes");
const carregarCampanhas = () => import("@/components/mesa/AbaCampanhas");
const carregarEstudio = () => import("@/components/mesa/AbaEstudio");
const carregarEntrega = () => import("@/components/mesa/AbaEntrega");
const AbaContexto = lazy(carregarContexto);
const AbaMes = lazy(carregarMes);
const AbaCampanhas = lazy(carregarCampanhas);
const AbaEstudio = lazy(carregarEstudio);
const AbaEntrega = lazy(carregarEntrega);
// Janelas do admin: só baixam na primeira vez que abrem.
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

const ABAS = [
  { valor: "contexto", rotulo: "Contexto" },
  { valor: "mes", rotulo: "Mês" },
  { valor: "campanhas", rotulo: "Campanhas" },
  { valor: "estudio", rotulo: "Estúdio" },
  { valor: "entrega", rotulo: "Entrega" },
] as const;

type Aba = (typeof ABAS)[number]["valor"];

const MES_VALIDO = /^\d{4}-\d{2}-01$/;
const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Onde a pessoa parou em cada cliente (aba, mês e item), para "continuar de
 * onde parou" ao trocar de cliente e voltar. Guarda também o nome, para o
 * cabeçalho já abrir com ele antes da lista de clientes chegar. Fica no
 * navegador; se o armazenamento estiver bloqueado, a Mesa só abre no começo.
 */
interface OndeParou {
  aba?: string | null;
  mes?: string | null;
  task?: string | null;
  nome?: string | null;
}

const chaveOnde = (clientId: string) => `mesa:onde:${clientId}`;

function lerOnde(clientId: string): OndeParou | null {
  try {
    const bruto = window.localStorage.getItem(chaveOnde(clientId));
    if (!bruto) return null;
    const v = JSON.parse(bruto);
    if (!v || typeof v !== "object") return null;
    return {
      aba: ABAS.some((a) => a.valor === v.aba) ? String(v.aba) : null,
      mes: typeof v.mes === "string" && MES_VALIDO.test(v.mes) ? v.mes : null,
      task: typeof v.task === "string" && v.task ? v.task : null,
      nome: typeof v.nome === "string" && v.nome ? v.nome.slice(0, 120) : null,
    };
  } catch {
    return null;
  }
}

function gravarOnde(clientId: string, onde: OndeParou) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify(onde));
  } catch {
    /* armazenamento indisponível: segue sem lembrar */
  }
}

/** Pede ao navegador para rodar quando estiver ocioso (setTimeout onde não há). */
function quandoOcioso(fn: () => void): () => void {
  const w = window as any;
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(fn, { timeout: 4000 });
    return () => {
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(id);
}

/** Espaço da aba enquanto o código dela chega: o resto da Mesa não pisca. */
function EsqueletoDaAba() {
  return (
    <div aria-busy="true" aria-label="Abrindo a etapa" className="space-y-3">
      <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted sm:w-1/3" />
      <div className="h-28 animate-pulse rounded-xl bg-muted/80" />
      <div className="h-[45vh] animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

export default function MesaDoCliente() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const abaUrl = params.get("aba") as Aba | null;
  const aba: Aba = ABAS.some((a) => a.valor === abaUrl) ? (abaUrl as Aba) : "contexto";
  const tarefaId = params.get("task");
  const mesUrl = params.get("mes") || "";
  const mes = MES_VALIDO.test(mesUrl) ? mesUrl : inicioDoMes();
  const campanhaBruta = params.get("campanha") || "";
  const campanhaUrl = UUID_VALIDO.test(campanhaBruta) ? campanhaBruta : null;
  const hypeBruto = params.get("hype");
  const hypeUrl = hypeBruto !== null && /^\d{1,2}$/.test(hypeBruto) ? Number(hypeBruto) : null;

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);

  const role = profile?.role || "";
  const isAdmin = role === "admin";
  const podeRecarregar = role === "admin" || role === "manager";

  const clientes = useMemo(
    () =>
      ((clientesQuery.data || []) as any[])
        .map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clientesQuery.data],
  );
  const clienteNaLista = clientes.find((c) => c.id === clientIdUrl) || null;

  // A lista pode estar velha (cliente criado agora, cache do navegador):
  // antes de dizer que o cliente do endereço não existe, relê uma vez.
  const [conferido, setConferido] = useState<{ id: string; em: number } | null>(null);
  const listaPronta = clientesQuery.isSuccess;
  useEffect(() => {
    if (!clientIdUrl || !listaPronta || clienteNaLista || clientesQuery.isFetching) return;
    if (conferido && conferido.id === clientIdUrl) return;
    setConferido({ id: clientIdUrl, em: clientesQuery.dataUpdatedAt });
    void clientesQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdUrl, listaPronta, clienteNaLista, clientesQuery.isFetching]);
  const naoEstaNaLista =
    listaPronta &&
    !clienteNaLista &&
    !clientesQuery.isFetching &&
    !!conferido &&
    conferido.id === clientIdUrl &&
    clientesQuery.dataUpdatedAt > conferido.em;

  // O cliente sai do endereço na hora: nada espera a lista de clientes.
  // Endereço com id inválido, ou fora da lista depois de reler, volta ao seletor.
  const clientId = clientIdUrl && UUID_VALIDO.test(clientIdUrl) && !naoEstaNaLista ? clientIdUrl : "";
  const ondeGuardado = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (ondeGuardado && ondeGuardado.nome) || "";

  const mudar = (mudancas: Record<string, string | null>, substituir = false) => {
    const next = new URLSearchParams(params);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setParams(next, { replace: substituir });
  };

  // Trocar de cliente volta para a aba, o mês e o item em que parou nele.
  const trocarCliente = (id: string) => {
    const onde = lerOnde(id);
    mudar({ client: id, aba: (onde && onde.aba) || "contexto", mes: (onde && onde.mes) || null, task: (onde && onde.task) || null, campanha: null, hype: null });
  };

  // Endereço só com o cliente (sem aba): abre onde parou da última vez.
  useEffect(() => {
    if (!clientId || params.get("aba")) return;
    const onde = lerOnde(clientId);
    if (onde && onde.aba) mudar({ aba: onde.aba, mes: onde.mes || null, task: onde.task || null }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Guarda onde parou sempre que a aba, o mês ou o item mudam.
  useEffect(() => {
    if (!clientId || !abaUrl) return;
    gravarOnde(clientId, {
      aba,
      mes: MES_VALIDO.test(mesUrl) ? mesUrl : null,
      task: tarefaId || null,
      nome: nomeDoCliente || null,
    });
  }, [clientId, abaUrl, aba, mesUrl, tarefaId, nomeDoCliente]);

  // Depois da primeira pintura, com o navegador ocioso, baixa as outras abas:
  // trocar de etapa não espera download.
  useEffect(
    () =>
      quandoOcioso(() => {
        for (const carregar of [carregarContexto, carregarMes, carregarCampanhas, carregarEstudio, carregarEntrega]) {
          carregar().catch(() => {
            /* sem rede agora: baixa quando a aba abrir */
          });
        }
      }),
    [],
  );

  const mesAtual = inicioDoMes();

  // Saldo, consumo e previsão: duas leituras (o saldo vem no consumo e na
  // previsão; a RPC só de saldo saiu).
  const consumo = useQuery({
    queryKey: ["mesa", "consumo", clientId, mesAtual],
    enabled: !!clientId,
    queryFn: async (): Promise<ConsumoDoMes> => {
      const { data, error } = await (supabase as any).rpc("ia_consumo_cliente", { _client_id: clientId, _mes: mesAtual });
      if (error) throw error;
      return (data || {}) as ConsumoDoMes;
    },
  });

  // Mesma chave que a aba Entrega usa: salvar o plano lá atualiza a barra.
  const previsao = useQuery({
    queryKey: ["mesa", "previsao", clientId],
    enabled: !!clientId,
    queryFn: () => lerPrevisao(clientId),
  });

  const numeroOuNulo = (v: unknown) => (v === undefined || v === null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const saldoUsd =
    numeroOuNulo(consumo.data ? consumo.data.saldo_usd : null) ?? numeroOuNulo(previsao.data ? previsao.data.saldo_usd : null);

  const atualizarCusto = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "consumo", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
  };

  const abrirChaves = () => {
    setChavesUsadas(true);
    setChavesAbertas(true);
  };
  const abrirModelos = () => {
    setModelosUsados(true);
    setModelosAbertos(true);
  };

  const valor: MesaValor | null = clientId
    ? {
        clientId,
        clientName: nomeDoCliente,
        userId: user?.id || null,
        isAdmin,
        podeRecarregar,
        saldoUsd,
        catalogo: catalogo.data || [],
        catalogoCarregando: catalogo.isLoading,
        atualizarCusto,
        abrirRecarga: () => setRecargaAberta(true),
        abrirChaves,
        abrirModelos,
        versaoCarteira,
      }
    : null;

  return (
    // Fundo sólido próprio: a grade do fundo do painel não aparece através das
    // superfícies semitransparentes da Mesa (pedido do dono em 23/09).
    <div className="relative isolate -mx-4 space-y-5 bg-background px-4 pb-10 md:-mx-6 md:px-6">
      <div className="flex flex-col sm:flex-row sm:items-center">
        <div className="mb-3 min-w-0 flex-1 sm:mb-0 sm:mr-3">
          <h1 className="heading-page">Mesa do cliente</h1>
        </div>
        <Select value={clientId} onValueChange={trocarCliente}>
          <SelectTrigger className="h-9 w-full min-w-0 text-[13px] sm:w-[280px]">
            <SelectValue placeholder={clientesQuery.isLoading ? "Carregando clientes…" : "Escolha o cliente"}>
              {clientId ? nomeDoCliente || "Carregando…" : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Barra fixa de custo e etapas. No celular a página rola dentro do
          main (top-0); no computador rola a janela, abaixo do cabeçalho de 80px. */}
      {clientId && (
        <header className="sticky top-0 z-20 -mx-4 space-y-2.5 border-b border-border bg-background px-4 pb-2.5 pt-2.5 md:-mx-6 md:top-[calc(env(safe-area-inset-top)+80px)] md:px-6">
          <BarraDeCusto
            saldoUsd={saldoUsd}
            consumo={consumo.data || null}
            previsao={previsao.data || null}
            carregando={consumo.isLoading}
            podeRecarregar={podeRecarregar}
            isAdmin={isAdmin}
            onRecarregar={() => setRecargaAberta(true)}
            onChaves={abrirChaves}
            onModelos={abrirModelos}
          />
          <nav aria-label="Etapas da Mesa" className="grid grid-cols-5 gap-1 rounded-xl bg-muted p-1">
            {ABAS.map((a, i) => (
              <button
                key={a.valor}
                type="button"
                onClick={() => mudar({ aba: a.valor, hype: null })}
                aria-current={aba === a.valor ? "page" : undefined}
                className={`min-w-0 truncate rounded-lg px-1 py-2 text-[12px] font-medium transition-colors sm:text-[12.5px] ${
                  aba === a.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="mr-1 hidden text-[11px] text-muted-foreground sm:inline">{i + 1}</span>
                {a.rotulo}
              </button>
            ))}
          </nav>
        </header>
      )}

      {!clientId && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">Escolha um cliente para abrir a mesa dele.</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Contexto, calendário do mês, estúdio de arte e entrega, com o custo de IA sempre à vista.
          </p>
        </div>
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <div key={valor.clientId} className="min-w-0">
            <Suspense fallback={<EsqueletoDaAba />}>
              {aba === "contexto" && <AbaContexto />}
              {aba === "mes" && (
                <AbaMes
                  onAbrirNoEstudio={(taskId, mesDoItem) => mudar({ aba: "estudio", task: taskId, mes: mesDoItem })}
                  onCriarCampanha={(indice) => mudar({ aba: "campanhas", hype: String(indice), campanha: null })}
                />
              )}
              {aba === "campanhas" && (
                <AbaCampanhas
                  campanhaId={campanhaUrl}
                  onCampanha={(id) => mudar({ campanha: id, hype: null }, true)}
                  hypeIndice={hypeUrl}
                  onLimparHype={() => mudar({ hype: null }, true)}
                  onAbrirNoEstudio={(taskId, mesDoItem) => mudar({ aba: "estudio", task: taskId, mes: mesDoItem || null, hype: null })}
                />
              )}
              {aba === "estudio" && (
                <AbaEstudio
                  mes={mes}
                  onMes={(m) => mudar({ mes: m, task: null })}
                  tarefaId={tarefaId}
                  onTarefa={(id) => mudar({ task: id })}
                />
              )}
              {aba === "entrega" && (
                <AbaEntrega mes={mes} onMes={(m) => mudar({ mes: m })} onAbrir={(id) => mudar({ aba: "estudio", task: id })} />
              )}
            </Suspense>
          </div>

          {podeRecarregar && (
            <DialogoDeRecarga
              aberto={recargaAberta}
              onOpenChange={setRecargaAberta}
              clientId={valor.clientId}
              clientName={valor.clientName}
              onRecarregado={(saldoNovo) => {
                // A recarga devolve o saldo novo: a barra muda na hora, sem
                // esperar a releitura do consumo e da previsão.
                if (typeof saldoNovo === "number") {
                  queryClient.setQueryData<ConsumoDoMes>(["mesa", "consumo", clientId, mesAtual], (c) => ({ ...(c || {}), saldo_usd: saldoNovo }));
                  queryClient.setQueryData<PrevisaoDoPlano>(["mesa", "previsao", clientId], (p) => (p ? { ...p, saldo_usd: saldoNovo } : p));
                }
                atualizarCusto();
                // Avisos de saldo insuficiente que estavam na tela somem.
                setVersaoCarteira((v) => v + 1);
              }}
              sugestaoUsd={previsao.data?.recarga_sugerida_usd ?? null}
            />
          )}
          {isAdmin && (chavesUsadas || modelosUsados) && (
            <Suspense fallback={null}>
              {chavesUsadas && (
                <ChavesECotas aberto={chavesAbertas} onOpenChange={setChavesAbertas} clientId={valor.clientId} clientName={valor.clientName} />
              )}
              {modelosUsados && <ModelosDeIa aberto={modelosAbertos} onOpenChange={setModelosAbertos} />}
            </Suspense>
          )}
        </MesaProvider>
      )}
    </div>
  );
}
