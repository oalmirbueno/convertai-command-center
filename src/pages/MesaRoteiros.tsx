import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { DialogoDeRecarga, type ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import { MesaProvider, useCatalogo, type MesaValor } from "@/components/mesa/MesaContexto";
import { inicioDoMes, lerPrevisao, type PrevisaoDoPlano } from "@/lib/mesa/api";
import { CustoCompacto } from "@/components/mesa/CustoCompacto";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";
import type { ClienteBruto } from "@/components/mesa/clientesDaMesa";
import TrocaDeMesas from "@/components/mesa-foto/TrocaDeMesas";
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import { BotaoDeTelaCheia, classeDaRaiz, useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";

/**
 * Mesa Roteiros (/mesa-roteiros, só equipe: admin, gestor e design), Frente
 * R2 (26/09). Primeiro lote do Estúdio Audiovisual V2: agenda -> roteiro ->
 * revisão salva -> PDF, mais a memória (modelos). Mesma casca das outras
 * mesas: barra fina com o seletor de cliente (padrão: plano mensal ativo),
 * as etapas, a troca de mesas, o saldo e a tela cheia. Endereço completo:
 * /mesa-roteiros?client=<id>&etapa=roteiro&roteiro=<id>&tarefa=<id>&modelo=<id>
 *
 * Etapas: Agenda (peças de vídeo da agenda e roteiros avulsos), Roteiro
 * (gerar com custo antes e editar), Revisão (versões, comentários, aprovar,
 * gravado, arquivar), PDF (padrão do documento de roteiro da agência, Baixar
 * e Compartilhar com o cliente) e Modelos (memória do cliente e da agência).
 * O agente da mesa fica à mão em todas as etapas, com ações confirmadas.
 */

const carregarAgenda = () => import("@/components/mesa-roteiros/EtapaAgenda");
const carregarRoteiro = () => import("@/components/mesa-roteiros/EtapaRoteiro");
const carregarRevisao = () => import("@/components/mesa-roteiros/EtapaRevisao");
const carregarPdf = () => import("@/components/mesa-roteiros/EtapaPdf");
const carregarModelos = () => import("@/components/mesa-roteiros/EtapaModelos");
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const EtapaAgenda = lazyComPreCarga("mesa-roteiros/agenda", carregarAgenda);
const EtapaRoteiro = lazyComPreCarga("mesa-roteiros/roteiro", carregarRoteiro);
const EtapaRevisao = lazyComPreCarga("mesa-roteiros/revisao", carregarRevisao);
const EtapaPdf = lazyComPreCarga("mesa-roteiros/pdf", carregarPdf);
const EtapaModelos = lazyComPreCarga("mesa-roteiros/modelos", carregarModelos);
const AgenteRoteirista = lazyComPreCarga("mesa-roteiros/agente", () => import("@/components/mesa-roteiros/AgenteRoteirista"));
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

export const ETAPAS_DA_MESA_ROTEIROS = [
  { valor: "agenda", rotulo: "Agenda" },
  { valor: "roteiro", rotulo: "Roteiro" },
  { valor: "revisao", rotulo: "Revisão" },
  { valor: "pdf", rotulo: "PDF" },
  { valor: "modelos", rotulo: "Modelos" },
] as const;

type Etapa = (typeof ETAPAS_DA_MESA_ROTEIROS)[number]["valor"];

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: string | null) => (v && UUID_VALIDO.test(v) ? v : null);

const chaveOnde = (clientId: string) => `mesa-roteiros:onde:${clientId}`;

function lerOnde(clientId: string): { etapa: string | null; nome: string | null } {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveOnde(clientId)) || "null");
    if (!v || typeof v !== "object") return { etapa: null, nome: null };
    return {
      etapa: ETAPAS_DA_MESA_ROTEIROS.some((e) => e.valor === v.etapa) ? String(v.etapa) : null,
      nome: typeof v.nome === "string" && v.nome ? v.nome.slice(0, 120) : null,
    };
  } catch {
    return { etapa: null, nome: null };
  }
}

function gravarOnde(clientId: string, etapa: string, nome: string | null) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify({ etapa, nome }));
  } catch {
    /* armazenamento indisponível: abre sempre na Agenda */
  }
}

function EsqueletoDaEtapa() {
  return (
    <div aria-busy="true" aria-label="Abrindo a etapa" className="space-y-3">
      <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted sm:w-1/3" />
      <div className="h-28 animate-pulse rounded-xl bg-muted/80" />
      <div className="h-[45vh] animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

export default function MesaRoteiros() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  const etapa: Etapa = ETAPAS_DA_MESA_ROTEIROS.some((e) => e.valor === etapaUrl) ? (etapaUrl as Etapa) : "agenda";
  const roteiroUrl = uuidOuNulo(params.get("roteiro"));
  const tarefaUrl = uuidOuNulo(params.get("tarefa"));
  const modeloUrl = uuidOuNulo(params.get("modelo"));
  const avulso = params.get("avulso") === "1";

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);
  const [agenteAberto, setAgenteAberto] = useState(false);
  const telaCheia = useTelaCheiaDaMesa();

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
  const naoEstaNaLista = clientesQuery.isSuccess && !clientesQuery.isFetching && clientes.length > 0 && !clienteNaLista;
  const clientId = clientIdUrl && UUID_VALIDO.test(clientIdUrl) && !naoEstaNaLista ? clientIdUrl : "";
  const onde = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (onde && onde.nome) || "";

  const mudar = (mudancas: Record<string, string | null>, substituir = false) => {
    const next = new URLSearchParams(params);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setParams(next, { replace: substituir });
  };

  const trocarCliente = (id: string) => {
    const o = lerOnde(id);
    mudar({ client: id, etapa: o.etapa || "agenda", roteiro: null, tarefa: null, modelo: null, avulso: null });
  };

  const abrirRoteiro = (id: string, destino: Etapa = "roteiro") => mudar({ etapa: destino, roteiro: id, tarefa: null, avulso: null, modelo: null });
  const novoDaPeca = (taskId: string) => mudar({ etapa: "roteiro", roteiro: null, tarefa: taskId, avulso: null });
  const novoAvulso = (modeloId?: string | null) => mudar({ etapa: "roteiro", roteiro: null, tarefa: null, avulso: "1", modelo: modeloId || null });

  // Endereço só com o cliente: abre na etapa em que parou.
  useEffect(() => {
    if (!clientId || etapaUrl) return;
    const o = lerOnde(clientId);
    if (o.etapa) mudar({ etapa: o.etapa }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (clientId && etapaUrl) gravarOnde(clientId, etapa, nomeDoCliente || null);
  }, [clientId, etapaUrl, etapa, nomeDoCliente]);

  const mesAtual = inicioDoMes();
  // Mesmas chaves da Mesa do cliente: o saldo é o mesmo em todas as mesas.
  const consumo = useQuery({
    queryKey: ["mesa", "consumo", clientId, mesAtual],
    enabled: !!clientId,
    queryFn: async (): Promise<ConsumoDoMes> => {
      const { data, error } = await (supabase as any).rpc("ia_consumo_cliente", { _client_id: clientId, _mes: mesAtual });
      if (error) throw error;
      return (data || {}) as ConsumoDoMes;
    },
  });
  const previsao = useQuery({
    queryKey: ["mesa", "previsao", clientId],
    enabled: !!clientId,
    queryFn: () => lerPrevisao(clientId),
  });

  const numeroOuNulo = (v: unknown) => (v === undefined || v === null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const saldoUsd = numeroOuNulo(consumo.data ? consumo.data.saldo_usd : null) ?? numeroOuNulo(previsao.data ? previsao.data.saldo_usd : null);

  const atualizarCusto = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "consumo", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
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
        abrirChaves: () => {
          setChavesUsadas(true);
          setChavesAbertas(true);
        },
        abrirModelos: () => {
          setModelosUsados(true);
          setModelosAbertos(true);
        },
        versaoCarteira,
        marcas: [],
        marca: null,
      }
    : null;

  return (
    <div className={`relative isolate -mx-4 space-y-5 bg-background px-4 pb-24 md:-mx-6 md:px-6 ${classeDaRaiz(telaCheia.cheia)}`}>
      <header data-cabecalho-da-mesa="" className="relative z-20 -mx-4 border-b border-border bg-background px-4 py-2 md:sticky md:-mx-6 md:top-[calc(env(safe-area-inset-top)+80px)] md:px-6">
        <h1 className="sr-only">Mesa Roteiros</h1>
        <div className="flex min-w-0 flex-wrap items-center lg:flex-nowrap">
          <div className="mr-2 flex min-w-0 flex-1 items-center lg:flex-none">
            <span className="mr-2 hidden shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-primary sm:inline">Roteiros</span>
            <SeletorDeClientesDaMesa mesa="roteiros" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />
          </div>
          {clientId && (
            <nav
              aria-label="Etapas da Mesa Roteiros"
              className="order-last mt-2 grid w-full grid-cols-5 gap-0.5 rounded-lg bg-muted p-0.5 lg:order-none lg:mx-3 lg:mt-0 lg:flex lg:w-auto lg:min-w-0 lg:flex-1"
            >
              {ETAPAS_DA_MESA_ROTEIROS.map((e, i) => (
                <button
                  key={e.valor}
                  type="button"
                  onClick={() => mudar({ etapa: e.valor })}
                  aria-current={etapa === e.valor ? "page" : undefined}
                  className={`min-w-0 truncate rounded-md px-1 py-1.5 text-[12px] font-medium transition-colors lg:flex-auto lg:px-1.5 ${
                    etapa === e.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="mr-1 hidden text-[10.5px] text-muted-foreground sm:inline lg:hidden 2xl:inline">{i + 1}</span>
                  {e.rotulo}
                </button>
              ))}
            </nav>
          )}
          {clientId && <TrocaDeMesas atual="roteiros" clientId={clientId} />}
          {clientId && (
            <CustoCompacto
              saldoUsd={saldoUsd}
              consumo={consumo.data || null}
              previsao={previsao.data || null}
              carregando={consumo.isLoading}
              podeRecarregar={podeRecarregar}
              isAdmin={isAdmin}
              onRecarregar={() => setRecargaAberta(true)}
              onChaves={() => {
                setChavesUsadas(true);
                setChavesAbertas(true);
              }}
              onModelos={() => {
                setModelosUsados(true);
                setModelosAbertos(true);
              }}
            />
          )}
          <BotaoDeTelaCheia tela={telaCheia} />
        </div>
      </header>

      {!clientId && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-[14px] font-medium">Escolha um cliente para abrir a Mesa Roteiros dele.</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            As peças de vídeo da agenda viram roteiro de gravação: gancho, falas com tempo, direção, texto na tela, apoio, CTA e legenda. Revisão com versões e o PDF para o cliente.
          </p>
        </div>
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <div key={valor.clientId} className="min-w-0">
            <Suspense fallback={<EsqueletoDaEtapa />}>
              {etapa === "agenda" && <EtapaAgenda onAbrirRoteiro={(id) => abrirRoteiro(id)} onNovoDaPeca={novoDaPeca} onAvulso={() => novoAvulso()} />}
              {etapa === "roteiro" && (
                <EtapaRoteiro
                  roteiroId={roteiroUrl}
                  tarefaId={tarefaUrl}
                  avulso={avulso}
                  modeloId={modeloUrl}
                  onAberto={(id) => mudar({ roteiro: id, tarefa: null, avulso: null, modelo: null }, true)}
                  onIrPara={(e, id) => mudar({ etapa: e, roteiro: id || roteiroUrl })}
                  onVoltar={() => mudar({ etapa: "agenda", roteiro: null, tarefa: null, avulso: null, modelo: null })}
                />
              )}
              {etapa === "revisao" && <EtapaRevisao roteiroId={roteiroUrl} onAbrirRoteiro={(id, e) => abrirRoteiro(id, e || "revisao")} />}
              {etapa === "pdf" && <EtapaPdf roteiroId={roteiroUrl} />}
              {etapa === "modelos" && <EtapaModelos onUsarModelo={(id) => novoAvulso(id)} />}
            </Suspense>
            <Suspense fallback={null}>
              <AgenteRoteirista aberto={agenteAberto} onAberto={setAgenteAberto} roteiroId={roteiroUrl} onAbrirRoteiro={(id) => abrirRoteiro(id)} />
            </Suspense>
          </div>

          {podeRecarregar && (
            <DialogoDeRecarga
              aberto={recargaAberta}
              onOpenChange={setRecargaAberta}
              clientId={valor.clientId}
              clientName={valor.clientName}
              onRecarregado={(saldoNovo) => {
                if (typeof saldoNovo === "number") {
                  queryClient.setQueryData<ConsumoDoMes>(["mesa", "consumo", clientId, mesAtual], (c) => ({ ...(c || {}), saldo_usd: saldoNovo }));
                  queryClient.setQueryData<PrevisaoDoPlano>(["mesa", "previsao", clientId], (p) => (p ? { ...p, saldo_usd: saldoNovo } : p));
                }
                atualizarCusto();
                setVersaoCarteira((v) => v + 1);
              }}
              sugestaoUsd={previsao.data?.recarga_sugerida_usd ?? null}
            />
          )}
          {isAdmin && (chavesUsadas || modelosUsados) && (
            <Suspense fallback={null}>
              {chavesUsadas && <ChavesECotas aberto={chavesAbertas} onOpenChange={setChavesAbertas} clientId={valor.clientId} clientName={valor.clientName} />}
              {modelosUsados && <ModelosDeIa aberto={modelosAbertos} onOpenChange={setModelosAbertos} />}
            </Suspense>
          )}
        </MesaProvider>
      )}
    </div>
  );
}
