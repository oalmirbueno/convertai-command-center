import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Palette } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { DialogoDeRecarga, type ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import { MesaProvider, useCatalogo, type MesaValor } from "@/components/mesa/MesaContexto";
import { inicioDoMes, lerPrevisao, textoDoErro, type PrevisaoDoPlano } from "@/lib/mesa/api";
import { CustoCompacto } from "@/components/mesa/CustoCompacto";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";
import type { ClienteBruto } from "@/components/mesa/clientesDaMesa";
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import { useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import CascaDaMesa from "@/components/sistema/CascaDaMesa";
import BotaoDoConselho from "@/components/conselho/BotaoDoConselho";
import SeletorDeMarca, { useMarcaNaCasca } from "@/components/mesa/SeletorDeMarca";
import Etapas from "@/components/sistema/Etapas";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { juntar, superficie } from "@/components/sistema/estilos";
import { ETAPAS_DA_IDENTIDADE, etapaAtual, etapaFeita, etapasDoProjeto, ehEtapaDaIdentidade, podeAbrir, progresso, type EtapaDaIdentidade } from "../../supabase/functions/_shared/identidade-etapas";
import { chamarIdentidade, guardarProjeto, useProjeto, type ProjetoDeIdentidade } from "@/components/mesa-identidade/identidadeApi";
import { ProjetoProvider, type ProjetoDaMesa } from "@/components/mesa-identidade/Comuns";
import { ContextoDasGravacoes, GravacoesDaMesa, novaFilaDeGravacao, salvarNaFila, type FilaDeGravacao } from "@/components/mesa-identidade/gravacao";

/**
 * Mesa Identidade Visual e Naming (/mesa-identidade, só equipe: admin, gestor
 * e design), frente IDV (30/09). Pedido do dono: "estúdio sequencial desde o
 * início, envolvente, organizado e limpo"; "selecionar o modelo que eu
 * quiser"; "área de naming e criador de nomes".
 *
 * Mesma casca das outras mesas: barra com o seletor de cliente e de marca,
 * as etapas numeradas, a troca de mesas, o saldo e a tela cheia. As etapas
 * seguem a sequência do projeto (Início, Briefing, Pesquisa, Estratégia,
 * Naming quando é marca do zero ou quando pedido, Conceito, Sistema,
 * Aplicações, Guideline, Apresentação, Entrega): a próxima abre quando a de
 * antes fecha. O diretor de marca fica
 * fixo ao lado (no celular, a gaveta do botão de baixo).
 * Endereço: /mesa-identidade?client=<id>&marca=<id>&projeto=<id>&etapa=<etapa>
 * (&completar=1 abre o "Completar tudo" da marca existente, IDV3)
 */

const carregarInicio = () => import("@/components/mesa-identidade/EtapaInicio");
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const EtapaInicio = lazyComPreCarga("mesa-identidade/inicio", carregarInicio);
const EtapaBriefing = lazyComPreCarga("mesa-identidade/briefing", () => import("@/components/mesa-identidade/EtapaBriefing"));
const EtapaPesquisa = lazyComPreCarga("mesa-identidade/pesquisa", () => import("@/components/mesa-identidade/EtapaPesquisa"));
const EtapaEstrategia = lazyComPreCarga("mesa-identidade/estrategia", () => import("@/components/mesa-identidade/EtapaEstrategia"));
const EtapaApresentacao = lazyComPreCarga("mesa-identidade/apresentacao", () => import("@/components/mesa-identidade/EtapaApresentacao"));
const EtapaNaming = lazyComPreCarga("mesa-identidade/naming", () => import("@/components/mesa-identidade/EtapaNaming"));
const EtapaConceito = lazyComPreCarga("mesa-identidade/conceito", () => import("@/components/mesa-identidade/EtapaConceito"));
const EtapaSistema = lazyComPreCarga("mesa-identidade/sistema", () => import("@/components/mesa-identidade/EtapaSistema"));
const EtapaMockups = lazyComPreCarga("mesa-identidade/mockups", () => import("@/components/mesa-identidade/EtapaMockups"));
const EtapaGuideline = lazyComPreCarga("mesa-identidade/guideline", () => import("@/components/mesa-identidade/EtapaGuideline"));
const EtapaEntrega = lazyComPreCarga("mesa-identidade/entrega", () => import("@/components/mesa-identidade/EtapaEntrega"));
const AgenteDiretorDeMarca = lazyComPreCarga("mesa-identidade/agente", () => import("@/components/mesa-identidade/AgenteDiretorDeMarca"));
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

export const ETAPAS_DA_MESA_IDENTIDADE = ETAPAS_DA_IDENTIDADE;

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: string | null) => (v && UUID_VALIDO.test(v) ? v : null);

const chaveOnde = (clientId: string) => `mesa-identidade:onde:${clientId}`;

function lerOnde(clientId: string): { etapa: string | null; projeto: string | null; nome: string | null } {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveOnde(clientId)) || "null");
    if (!v || typeof v !== "object") return { etapa: null, projeto: null, nome: null };
    return {
      etapa: ehEtapaDaIdentidade(v.etapa) ? String(v.etapa) : null,
      projeto: typeof v.projeto === "string" && UUID_VALIDO.test(v.projeto) ? v.projeto : null,
      nome: typeof v.nome === "string" && v.nome ? v.nome.slice(0, 120) : null,
    };
  } catch {
    return { etapa: null, projeto: null, nome: null };
  }
}

function gravarOnde(clientId: string, etapa: string, projeto: string | null, nome: string | null) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify({ etapa, projeto, nome }));
  } catch {
    /* sem armazenamento: abre no Início */
  }
}

function EsqueletoDaEtapa() {
  return <Carregando forma="aba" rotulo="Abrindo a etapa" />;
}

function EsqueletoDoAgente() {
  return <div aria-busy="true" aria-label="Abrindo o agente" className={juntar(superficie.painel, "h-full min-h-[320px] animate-pulse")} />;
}

export default function MesaIdentidade() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  const projetoUrl = uuidOuNulo(params.get("projeto"));

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);
  const telaCheia = useTelaCheiaDaMesa();
  // UXS 30/09: uma fila de gravação por página (projeto_salvar um por vez; a versão sai do cache na hora).
  const filaDeGravacao = useRef<FilaDeGravacao | null>(null);
  if (!filaDeGravacao.current) filaDeGravacao.current = novaFilaDeGravacao();
  const gravacoes = useRef<GravacoesDaMesa | null>(null);
  if (!gravacoes.current) gravacoes.current = new GravacoesDaMesa();

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
  const { marcas, marca } = useMarcaNaCasca(clientId, params.get("marca"));
  const onde = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (onde && onde.nome) || "";
  const [rascunhoDoAgente, setRascunhoDoAgente] = useEstadoDaTela<string>(`mesa-identidade:agente:rascunho:${clientId || "sem-cliente"}`, "");

  const projetoQ = useProjeto(clientId ? projetoUrl : null);
  // Projeto de outro cliente (endereço velho) não abre.
  const projeto = projetoQ.data && projetoQ.data.client_id === clientId ? projetoQ.data : null;
  const etapasDoProj: EtapaDaIdentidade[] = projeto ? etapasDoProjeto(projeto) : ["inicio"];
  const pedida = ehEtapaDaIdentidade(etapaUrl) ? etapaUrl : null;
  const etapa: EtapaDaIdentidade = !projeto ? "inicio" : pedida && etapasDoProj.indexOf(pedida) >= 0 && podeAbrir(projeto, pedida).pode ? pedida : etapaAtual(projeto);

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
    mudar({ client: id, etapa: o.etapa || "inicio", projeto: o.projeto, marca: null });
  };

  // Endereço só com o cliente: abre onde parou (projeto e etapa).
  useEffect(() => {
    if (!clientId || etapaUrl || projetoUrl) return;
    const o = lerOnde(clientId);
    if (o.projeto || o.etapa) mudar({ etapa: o.etapa, projeto: o.projeto }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (clientId) gravarOnde(clientId, etapa, projeto ? projeto.id : null, nomeDoCliente || null);
  }, [clientId, etapa, projeto, nomeDoCliente]);

  // Mudança ainda indo para o banco: o navegador pergunta antes de fechar ou recarregar.
  useEffect(() => {
    const g = gravacoes.current;
    const antesDeFechar = (e: BeforeUnloadEvent) => {
      if (!g || !g.temPendente()) return undefined;
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", antesDeFechar);
    return () => window.removeEventListener("beforeunload", antesDeFechar);
  }, []);

  /**
   * Antes de trocar de etapa: grava o pendente. Se falhar, não troca (o texto
   * fica na tela) e o aviso oferece sair mesmo assim.
   */
  const trocarDeEtapa = (v: EtapaDaIdentidade) => {
    const g = gravacoes.current;
    if (!g || !g.temPendente()) {
      mudar({ etapa: v });
      return;
    }
    g.salvarTudo().then(
      () => mudar({ etapa: v }),
      (e) =>
        toast.error("A mudança desta etapa não foi salva", {
          description: textoDoErro(e),
          duration: 12_000,
          action: { label: "Sair mesmo assim", onClick: () => mudar({ etapa: v }) },
        }),
    );
  };

  const mesAtual = inicioDoMes();
  const consumo = useQuery({
    queryKey: ["mesa", "consumo", clientId, mesAtual],
    enabled: !!clientId,
    queryFn: async (): Promise<ConsumoDoMes> => {
      const { data, error } = await (supabase as any).rpc("ia_consumo_cliente", { _client_id: clientId, _mes: mesAtual });
      if (error) throw error;
      return (data || {}) as ConsumoDoMes;
    },
  });
  const previsao = useQuery({ queryKey: ["mesa", "previsao", clientId], enabled: !!clientId, queryFn: () => lerPrevisao(clientId) });
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
        marcas,
        marca,
      }
    : null;

  // Projeto aberto: salvar parcial, concluir e reabrir etapa (tudo pela função, com a versão lida).
  const contextoDoProjeto: ProjetoDaMesa | null = projeto
    ? {
        projeto,
        guardar: (p) => guardarProjeto(queryClient, p),
        // UXS 30/09 (IDV-01/02): uma gravação por vez; a versão sai do cache na hora de gravar (nunca a do render).
        salvarParte: (parte, v, opcoes = {}) => salvarNaFila(filaDeGravacao.current as FilaDeGravacao, queryClient, projeto.id, projeto.versao, parte, v, opcoes),
        concluir: async (e) => {
          try {
            const r = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("etapa_concluir", { projeto_id: projeto.id, etapa: e });
            guardarProjeto(queryClient, r.projeto);
            toast.success(e === "entrega" ? "Projeto entregue" : "Etapa concluída");
            if (r.projeto && r.projeto.etapa !== e) mudar({ etapa: r.projeto.etapa });
          } catch (err) {
            toast.error("A etapa não fechou", { description: textoDoErro(err) });
          }
        },
        reabrir: async (e) => {
          try {
            const r = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("etapa_reabrir", { projeto_id: projeto.id, etapa: e });
            guardarProjeto(queryClient, r.projeto);
          } catch (err) {
            toast.error("A etapa não reabriu", { description: textoDoErro(err) });
          }
        },
        irPara: (e) => trocarDeEtapa(e),
      }
    : null;

  const escolherEtapa = (v: string) => {
    if (!ehEtapaDaIdentidade(v)) return;
    if (!projeto) {
      if (v !== "inicio") toast.info("Comece pelo Início: marca do zero ou rebranding.");
      mudar({ etapa: "inicio" });
      return;
    }
    const abre = podeAbrir(projeto, v);
    if (!abre.pode) {
      toast.info(abre.motivo || "Etapa ainda fechada.");
      return;
    }
    if (v === etapa) return;
    trocarDeEtapa(v);
  };

  const andamento = projeto ? progresso(projeto) : null;

  return (
    <CascaDaMesa
      mesa="identidade"
      titulo="Mesa Identidade"
      clientId={clientId}
      telaCheia={telaCheia}
      marcaId={marca ? marca.id : null}
      marca={clientId && marca ? <SeletorDeMarca marcas={marcas} valor={marca.id} onEscolher={(id) => mudar({ marca: id, projeto: null, etapa: "inicio" }, true)} /> : null}
      cliente={<SeletorDeClientesDaMesa mesa="identidade" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />}
      etapas={
        clientId ? (
          <Etapas
            rotulo="Etapas da Mesa Identidade"
            numerar
            itens={(projeto ? etapasDoProj : ETAPAS_DA_IDENTIDADE.map((e) => e.valor).filter((e) => e !== "naming")).map((v) => {
              const e = ETAPAS_DA_IDENTIDADE.filter((x) => x.valor === v)[0];
              const aberta = !projeto ? v === "inicio" : podeAbrir(projeto, v).pode;
              // UXS 30/09 (IDV-07): feita pela mesma regra do andamento (projeto antigo conta a etapa nova atrás de uma fechada).
              const feita = !!projeto && etapaFeita(projeto, v);
              return { valor: v, rotulo: e.rotulo, dica: aberta ? (feita ? "Concluída" : undefined) : "Abre quando a etapa de antes fechar", destaque: !!projeto && v === etapaAtual(projeto) && !feita, feita, fechada: !aberta, dados: { "data-etapa-aberta": aberta ? "sim" : "nao" } };
            })}
            valor={etapa}
            onEscolher={escolherEtapa}
          />
        ) : null
      }
      acoes={
        clientId ? (
          <>
          <BotaoDoConselho
            clientId={clientId}
            origem="mesa-identidade"
            tema={`Identidade${nomeDoCliente ? ` de ${nomeDoCliente}` : ""}`}
            contexto={"A identidade visual aberta na mesa: conceito, naming, logo e guideline."}
            onUsar={(t) => setRascunhoDoAgente(t)}
            rotuloDoUsar="Levar para o diretor de marca"
          />
          <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-border" />
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
          </>
        ) : null
      }
    >
      {!clientId && (
        <EstadoVazio icone={<Palette className="h-5 w-5" />} titulo="Escolha um cliente para abrir a Mesa Identidade dele." descricao="Identidade visual, naming e brandbook." />
      )}

      {valor && (
        <MesaProvider valor={valor}>
          <AreaDeTrabalho
            key={valor.clientId}
            memoria="mesa-identidade"
            rotuloDaLateral="Diretor de marca"
            iconeDaLateral={<Palette className="h-4 w-4" />}
            rotuloDoPrincipal="Etapa da Mesa Identidade"
            principalRolavel={false}
            lateral={
              <Suspense fallback={<EsqueletoDoAgente />}>
                <AgenteDiretorDeMarca projetoId={projeto ? projeto.id : null} rascunho={rascunhoDoAgente} onRascunho={setRascunhoDoAgente} />
              </Suspense>
            }
          >
            <RegiaoRolavel key={`${etapa}:${projeto ? projeto.id : "novo"}`} modo="lg" memoria={`mesa-identidade:${valor.clientId}:${etapa}`} className="pb-6 lg:pr-1" data-regiao-da-etapa={etapa} data-andamento={andamento ? `${andamento.feitas}/${andamento.total}` : ""}>
              <Suspense fallback={<EsqueletoDaEtapa />}>
                {projetoUrl && projetoQ.isLoading ? (
                  <EsqueletoDaEtapa />
                ) : !projeto || etapa === "inicio" ? (
                  <EtapaInicio
                    projetoAberto={projeto}
                    contexto={contextoDoProjeto}
                    onAbrir={(p, e, extra) => {
                      guardarProjeto(queryClient, p);
                      mudar({ projeto: p.id, etapa: e || etapaAtual(p), ...(extra || {}) });
                    }}
                  />
                ) : contextoDoProjeto ? (
                  <ProjetoProvider valor={contextoDoProjeto}>
                    <ContextoDasGravacoes.Provider value={gravacoes.current}>
                    {etapa === "briefing" && <EtapaBriefing />}
                    {etapa === "pesquisa" && <EtapaPesquisa />}
                    {etapa === "estrategia" && <EtapaEstrategia />}
                    {etapa === "naming" && <EtapaNaming />}
                    {etapa === "conceito" && <EtapaConceito />}
                    {etapa === "sistema" && <EtapaSistema />}
                    {etapa === "mockups" && <EtapaMockups />}
                    {etapa === "guideline" && <EtapaGuideline />}
                    {etapa === "apresentacao" && <EtapaApresentacao />}
                    {etapa === "entrega" && <EtapaEntrega />}
                    </ContextoDasGravacoes.Provider>
                  </ProjetoProvider>
                ) : null}
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
