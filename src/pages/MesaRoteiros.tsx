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
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import { useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import CascaDaMesa from "@/components/sistema/CascaDaMesa";
import Etapas from "@/components/sistema/Etapas";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { juntar, superficie } from "@/components/sistema/estilos";
import { Clapperboard } from "lucide-react";

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
 * O agente da mesa fica fixo ao lado das etapas (lateral da AreaDeTrabalho;
 * no celular, a gaveta do botão de baixo), com ações confirmadas.
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
  return <Carregando forma="aba" rotulo="Abrindo a etapa" />;
}

/** Enquanto o agente baixa (primeira abertura): a casca dele, sem texto. */
function EsqueletoDoAgente() {
  return <div aria-busy="true" aria-label="Abrindo o agente" className={juntar(superficie.painel, "h-full min-h-[320px] animate-pulse")} />;
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
  // Rascunho do campo do agente, guardado por cliente (sair e voltar mantém).
  const [rascunhoDoAgente, setRascunhoDoAgente] = useEstadoDaTela<string>(`mesa-roteiros:agente:rascunho:${clientId || "sem-cliente"}`, "");

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
    // Casca padrão das mesas (src/components/sistema/CascaDaMesa.tsx).
    <CascaDaMesa
      mesa="roteiros"
      titulo="Mesa Roteiros"
      clientId={clientId}
      telaCheia={telaCheia}
      cliente={<SeletorDeClientesDaMesa mesa="roteiros" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />}
      etapas={
        clientId ? (
          <Etapas
            rotulo="Etapas da Mesa Roteiros"
            numerar
            itens={ETAPAS_DA_MESA_ROTEIROS.map((e) => ({ valor: e.valor, rotulo: e.rotulo }))}
            valor={etapa}
            onEscolher={(v) => mudar({ etapa: v })}
          />
        ) : null
      }
      acoes={
        clientId ? (
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
        ) : null
      }
    >

      {!clientId && (
        <EstadoVazio
          icone={<Clapperboard className="h-5 w-5" />}
          titulo="Escolha um cliente para abrir a Mesa Roteiros dele."
          descricao="Roteiros de gravação, com revisão e PDF."
        />
      )}

      {valor && (
        <MesaProvider valor={valor}>
          {/* Área de trabalho (src/components/sistema/AreaDeTrabalho.tsx): no
              computador a etapa rola por dentro e o agente fica parado ao lado,
              com o campo sempre à vista; no celular a página rola normal e o
              agente abre em tela cheia pelo botão de baixo. */}
          <AreaDeTrabalho
            key={valor.clientId}
            memoria="mesa-roteiros"
            rotuloDaLateral="Agente de roteiros"
            iconeDaLateral={<Clapperboard className="h-4 w-4" />}
            rotuloDoPrincipal="Etapa da Mesa Roteiros"
            principalRolavel={false}
            lateral={
              <Suspense fallback={<EsqueletoDoAgente />}>
                <AgenteRoteirista roteiroId={roteiroUrl} onAbrirRoteiro={(id) => abrirRoteiro(id)} rascunho={rascunhoDoAgente} onRascunho={setRascunhoDoAgente} />
              </Suspense>
            }
          >
            {/* Uma região por etapa e cliente: trocar de etapa e voltar devolve a rolagem. */}
            <RegiaoRolavel key={etapa} modo="lg" memoria={`mesa-roteiros:${valor.clientId}:${etapa}`} className="pb-6 lg:pr-1" data-regiao-da-etapa={etapa}>
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
            </RegiaoRolavel>
          </AreaDeTrabalho>

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
    </CascaDaMesa>
  );
}
