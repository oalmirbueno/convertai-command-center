import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Aperture, BookOpen, Camera, Library, MoreHorizontal, Shapes, UserRound, UsersRound } from "lucide-react";
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
import {
  ABAS_FUTURAS,
  ETAPAS_DA_MESA_FOTO,
  ETAPAS_DE_APOIO,
  MesaFotoProvider,
  NavDoCriar,
  PASSOS_PRINCIPAIS,
  passoDaEtapa,
  type EtapaDaMesaFoto,
  type MesaFotoValor,
} from "@/components/mesa-foto/Comuns";
import { classeDaFoto, proximoPasso, useEnsaios, useFotos, useKits } from "@/components/mesa-foto/fotoApi";
import { CHAVES_DO_ABERTO, useContextoDoDiretor, useFocoDoDiretor } from "@/components/mesa-foto/diretorApi";
import { destinoAoEscolher, destinoDoGerar, ehObjetivo, marcadasQueContam, objetivoDaEtapa, objetivoPorValor, type ObjetivoDaFoto } from "@/components/mesa-foto/linhaDeProducao";
import { gravarNaSessao } from "@/components/mesa-foto/sessao";
import { CHAVE_DAS_FOTOS_DO_POST } from "@/components/mesa-foto/agendaApi";
import { lerPecaDoEndereco, type PedidoDePeca } from "@/components/mesa-foto/pecasDeFoto";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import SeletorDeMarca, { useMarcaNaCasca } from "@/components/mesa/SeletorDeMarca";
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import { useTelaCheiaDaMesa } from "@/components/mesa/TelaCheiaDaMesa";
import CascaDaMesa from "@/components/sistema/CascaDaMesa";
import AreaDeTrabalho, { abrirLateralDaArea } from "@/components/sistema/AreaDeTrabalho";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { foco, juntar, superficie } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

/**
 * Mesa Foto (/mesa-foto, só equipe: admin, gestor e design): o estúdio
 * fotográfico do cliente (docs/mesa-foto/CONTRATO.md). Mesma casca da Mesa e
 * da Mesa Ads: barra fina com o seletor de cliente, as etapas, a troca entre
 * as mesas e o saldo; embaixo, o kit e o ensaio abertos com o estado e o
 * custo. Endereço completo:
 * /mesa-foto?client=<id>&etapa=ensaio&kit=<id>&ensaio=<id>&imagem=<id>
 *
 * Caminho principal em 3 passos (pedido do dono, 25/09: "não tem um processo
 * mais simples e fácil de entender"): 1. Fotos (sobe as fotos e o produto é
 * identificado ali mesmo; a pessoa só confirma), 2. Criar (Variações,
 * Campanha com modelo ou Preparar; aprovar e refazer no próprio resultado) e
 * 3. Usar (o que falta revisar e as prontas, com Mesa, Mesa Ads, Baixar e
 * aprovação em cada foto). O próximo passo fica sempre em destaque. Depois de
 * um traço fino, as ferramentas de apoio: Biblioteca, Modelos (personas
 * sintéticas), Clones, Book (estúdio do book do produto ou da pessoa, 26/09)
 * e Canvas (docs/mesa-foto/MODELOS-E-CANVAS.md), num seletor só ("Ferramentas").
 * O Canvas carrega o React Flow só quando a aba abre.
 *
 * 30/09 (frente FTL; dono: "a linha de produção das fotos está muito confusa
 * e difícil, facilite"): a linha de produção em 5 passos, na ordem em que a
 * pessoa pensa (src/components/mesa-foto/linhaDeProducao.ts): 1 O que fazer
 * (?etapa=criar, onde a mesa abre), 2 Fotos, 3 Gerar (a ferramenta do que foi
 * escolhido), 4 Aprovar (conferir e aprovar num lugar só) e 5 Usar. O
 * objetivo fica guardado por cliente; as ferramentas avançadas ficam em "Mais".
 *
 * Sistema de design (26/09, docs/design/SISTEMA.md): o corpo é uma
 * AreaDeTrabalho. A etapa rola na região principal (a posição fica guardada
 * por etapa e cliente) e o diretor de fotografia é a lateral fixa, com o campo
 * sempre à vista; no celular vira o botão de baixo que abre a gaveta. As
 * etapas de apoio (Modelos, Clones, Book, Canvas) renderizam dentro da região
 * principal e não criam outra AreaDeTrabalho. No Canvas a lateral usa outra
 * memória e começa recolhida (o quadro precisa da largura toda). A Mesa é a
 * principal: todo plano usa o contexto do cliente e a campanha da Mesa (a
 * escolhida ou a do mês).
 *
 * Regra da fotografia: nunca escurecer a foto para dar destaque; foto
 * sintética sempre marcada como gerada.
 *
 * 27/09 (dono: "ainda está confuso, não está tão facilitado pra criar"): o
 * caminho ficou Fotos → o que fazer (Estúdio de fotos, Variações, Campanha)
 * → Usar (Post na Agenda para o cliente aprovar, Mesa, Mesa Ads). O Estúdio
 * de fotos (?etapa=estudio&imagem=) e o Post na Agenda (?etapa=agenda&task=
 * &trabalho=) abrem de qualquer foto, em um clique. O caminho que o diretor
 * deixa pode levar junto canvas=, book=, clone= e modelo=: a página abre o
 * que foi feito e tira o parâmetro do endereço.
 */

const ComposicaoRapida = lazy(() => import("@/components/mesa-foto/ComposicaoRapida"));

const carregarAcervo = () => import("@/components/mesa-foto/EtapaAcervo");
const carregarKits = () => import("@/components/mesa-foto/EtapaKits");
const carregarPreparar = () => import("@/components/mesa-foto/EtapaPreparar");
const carregarEnsaio = () => import("@/components/mesa-foto/EtapaEnsaio");
const carregarRevisar = () => import("@/components/mesa-foto/EtapaRevisar");
const carregarUsar = () => import("@/components/mesa-foto/EtapaUsar");
const carregarBiblioteca = () => import("@/components/mesa-foto/EtapaBiblioteca");
const carregarCampanha = () => import("@/components/mesa-foto/EtapaCampanha");
const carregarCriar = () => import("@/components/mesa-foto/EtapaCriar");
const carregarModelos = () => import("@/components/mesa-foto/EtapaModelos");
const carregarClones = () => import("@/components/mesa-foto/EtapaClones");
const carregarBook = () => import("@/components/mesa-foto/EtapaBook");
const carregarEstudio = () => import("@/components/mesa-foto/EtapaEstudio");
const carregarAgenda = () => import("@/components/mesa-foto/EtapaAgenda");
const carregarAprovar = () => import("@/components/mesa-foto/EtapaAprovar");
// O Canvas (React Flow, ~60 KB) não entra na pré-carga: só baixa quando a aba abre.
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts): o que já
// baixou antes do clique aparece direto, sem esqueleto.
const EtapaModelos = lazyComPreCarga("mesa-foto/modelos", carregarModelos);
const EtapaClones = lazyComPreCarga("mesa-foto/clones", carregarClones);
const EtapaBook = lazyComPreCarga("mesa-foto/book", carregarBook);
const EtapaEstudio = lazyComPreCarga("mesa-foto/estudio", carregarEstudio);
const EtapaAgenda = lazyComPreCarga("mesa-foto/agenda", carregarAgenda);
const EtapaCanvas = lazyComPreCarga("mesa-foto/canvas", () => import("@/components/mesa-foto/EtapaCanvas"));
const EtapaCampanha = lazyComPreCarga("mesa-foto/campanha", carregarCampanha);
const EtapaCriar = lazyComPreCarga("mesa-foto/criar", carregarCriar);
const EtapaAcervo = lazyComPreCarga("mesa-foto/acervo", carregarAcervo);
const EtapaKits = lazyComPreCarga("mesa-foto/kits", carregarKits);
const EtapaPreparar = lazyComPreCarga("mesa-foto/preparar", carregarPreparar);
const EtapaEnsaio = lazyComPreCarga("mesa-foto/ensaio", carregarEnsaio);
const EtapaRevisar = lazyComPreCarga("mesa-foto/revisar", carregarRevisar);
const EtapaUsar = lazyComPreCarga("mesa-foto/usar", carregarUsar);
const EtapaAprovar = lazyComPreCarga("mesa-foto/aprovar", carregarAprovar);
const EtapaBiblioteca = lazyComPreCarga("mesa-foto/biblioteca", carregarBiblioteca);
const BarraDoEnsaio = lazyComPreCarga("mesa-foto/barra-do-ensaio", () => import("@/components/mesa-foto/BarraDoEnsaio"));
const AgenteDiretor = lazyComPreCarga("mesa-foto/agente-diretor", () => import("@/components/mesa-foto/AgenteDiretor"));
// 02/10: a esteira das peças de foto do mês no topo (e a janela da peça aberta pelo endereço ?peca= ou ?task=).
const EsteiraDoMes = lazyComPreCarga("mesa-foto/esteira-do-mes", () => import("@/components/mesa-foto/EsteiraDoMes"));
const ChavesECotas = lazy(() => import("@/components/mesa/ChavesECotas"));
const ModelosDeIa = lazy(() => import("@/components/mesa/ModelosDeIa"));

export { ETAPAS_DA_MESA_FOTO };

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: string | null) => (v && UUID_VALIDO.test(v) ? v : null);

interface OndeParou {
  etapa: string | null;
  kit: string | null;
  ensaio: string | null;
  nome: string | null;
}

const chaveOnde = (clientId: string) => `mesa-foto:onde:${clientId}`;

function lerOnde(clientId: string): OndeParou {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveOnde(clientId)) || "null");
    if (!v || typeof v !== "object") return { etapa: null, kit: null, ensaio: null, nome: null };
    return {
      etapa: ETAPAS_DA_MESA_FOTO.some((e) => e.valor === v.etapa) ? String(v.etapa) : null,
      kit: uuidOuNulo(typeof v.kit === "string" ? v.kit : null),
      ensaio: uuidOuNulo(typeof v.ensaio === "string" ? v.ensaio : null),
      nome: typeof v.nome === "string" && v.nome ? v.nome.slice(0, 120) : null,
    };
  } catch {
    return { etapa: null, kit: null, ensaio: null, nome: null };
  }
}

function gravarOnde(clientId: string, onde: OndeParou) {
  try {
    window.localStorage.setItem(chaveOnde(clientId), JSON.stringify(onde));
  } catch {
    /* armazenamento indisponível: abre sempre no passo 1 */
  }
}

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

/** Ícone e uma linha de cada ferramenta de apoio no seletor. */
const FERRAMENTAS: Record<string, { icone: ReactNode; descricao: string }> = {
  biblioteca: { icone: <Library className="h-4 w-4" />, descricao: "Prompts e referências" },
  modelos: { icone: <UserRound className="h-4 w-4" />, descricao: "Pessoas sintéticas" },
  clones: { icone: <UsersRound className="h-4 w-4" />, descricao: "Pessoa real, com autorização" },
  book: { icone: <BookOpen className="h-4 w-4" />, descricao: "Book do produto ou da pessoa" },
  canvas: { icone: <Shapes className="h-4 w-4" />, descricao: "Quadro livre" },
};

/** Etapas que organizam a própria coluna (a região principal não rola; a lista longa rola por dentro). */
// 27/09: o Estúdio de fotos também (a foto cabe na altura e as ferramentas rolam ao lado).
const ETAPAS_EM_COLUNA: string[] = ["acervo", "estudio"];

function EsqueletoDoDiretor() {
  return (
    <div aria-busy="true" aria-label="Abrindo o diretor" className={juntar(superficie.painel, "flex h-full min-h-[320px] flex-col p-3")}>
      <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="mt-auto h-20 animate-pulse rounded-md bg-muted/70" />
    </div>
  );
}

export default function MesaFoto() {
  const { profile, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const clientesQuery = useClients();
  const catalogo = useCatalogo();

  const clientIdUrl = params.get("client") || "";
  const etapaUrl = params.get("etapa");
  // 30/09 (frente FTL): a mesa abre no passo 1, "O que fazer".
  const etapa: EtapaDaMesaFoto = ETAPAS_DA_MESA_FOTO.some((e) => e.valor === etapaUrl) ? (etapaUrl as EtapaDaMesaFoto) : "criar";
  const kitUrl = uuidOuNulo(params.get("kit"));
  const ensaioUrl = uuidOuNulo(params.get("ensaio"));
  const imagemUrl = uuidOuNulo(params.get("imagem"));

  const [recargaAberta, setRecargaAberta] = useState(false);
  const [chavesAbertas, setChavesAbertas] = useState(false);
  const [modelosAbertos, setModelosAbertos] = useState(false);
  const [chavesUsadas, setChavesUsadas] = useState(false);
  const [modelosUsados, setModelosUsados] = useState(false);
  const [versaoCarteira, setVersaoCarteira] = useState(0);
  const [pedidoAoDiretor, setPedidoAoDiretor] = useState<{ mensagem: string; em: number; rascunho?: boolean } | null>(null);
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
  // Fotos marcadas no passo 1: ficam ao sair e voltar (por cliente).
  const [selecionadas, setSelecionadas] = useEstadoDaTela<string[]>(`mesa-foto:selecionadas:${clientId}`, [], {
    validar: (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
  });
  const onde = useMemo(() => (clientId ? lerOnde(clientId) : null), [clientId]);
  // O que produzir (passo 1), por cliente. Só a escolha da pessoa muda o objetivo: o passo 1, a
  // faixa das Fotos e o seletor do passo 3. Quem chega DE FORA numa ferramenta de gerar (primeira
  // carga com ?etapa=, link do diretor, outra mesa) já está "fazendo" aquilo e o objetivo segue a
  // ferramenta. A navegação interna (passos, Próximo, Abrir no Estúdio, Post na Agenda) não regrava:
  // usar uma foto aprovada num post não transforma "Fotos do produto" em "Post com fotos".
  const [objetivoGuardado, setObjetivoGuardado] = useEstadoDaTela<ObjetivoDaFoto | null>(`mesa-foto:objetivo:${clientId}`, null, {
    validar: (v) => v === null || ehObjetivo(v),
  });
  const objetivo: ObjetivoDaFoto | null = objetivoGuardado;
  // A etapa que a própria página pediu (mudar): a chegada nela é interna e não mexe no objetivo.
  const etapaPedidaAqui = useRef<string | null>(null);
  useEffect(() => {
    if (!clientId) return;
    const interna = etapaPedidaAqui.current === etapa;
    etapaPedidaAqui.current = null;
    if (interna) return;
    const deFora = objetivoDaEtapa(etapa);
    if (deFora && deFora !== objetivoGuardado) setObjetivoGuardado(deFora);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, etapa]);
  // O caminho do diretor (e dos avisos) pode trazer o que abrir em cada etapa: grava o "aberto"
  // da etapa antes dela montar e tira o parâmetro do endereço (voltar não reabre o antigo).
  const abertosAplicados = useRef<string>("");
  const abertosNoEndereco = (["canvas", "book", "clone", "modelo"] as const)
    .map((k) => [k, uuidOuNulo(params.get(k))] as const)
    .filter((x) => !!x[1]);
  const chaveDosAbertos = abertosNoEndereco.map((x) => `${x[0]}=${x[1]}`).join("&");
  if (clientId && chaveDosAbertos && abertosAplicados.current !== `${clientId}|${chaveDosAbertos}`) {
    abertosAplicados.current = `${clientId}|${chaveDosAbertos}`;
    abertosNoEndereco.forEach(([k, id]) => {
      const chave = k === "canvas" ? CHAVES_DO_ABERTO.canvas(clientId) : k === "book" ? CHAVES_DO_ABERTO.book(clientId) : k === "clone" ? CHAVES_DO_ABERTO.clone(clientId) : CHAVES_DO_ABERTO.persona(clientId);
      gravarEstadoDaTela(chave, id);
    });
  }
  const nomeDoCliente = (clienteNaLista && clienteNaLista.nome) || (onde && onde.nome) || "";
  // Marca por projeto (só a Acerbi hoje: Acerbi e CME): cores e contexto do diretor. Uma marca só: nada muda.
  const { marcas, marca } = useMarcaNaCasca(clientId, params.get("marca"));
  // Diretor agêntico: o contexto do cliente carrega com a página (mesmo com a lateral recolhida ou no
  // botão do celular), na mesma chave que o diretor lê; trocar de cliente ou de etapa troca o contexto.
  const focoDoDiretor = useFocoDoDiretor(clientId, etapa, selecionadas, kitUrl, ensaioUrl);
  useContextoDoDiretor(clientId, focoDoDiretor);

  // Duas trocas no mesmo clique (ex.: escolher o kit e abrir o ensaio) se
  // somam: a segunda parte do endereço já mudado, não do que estava na tela.
  // Antes a segunda apagava a primeira e o kit sumia da URL.
  const pendente = useRef<{ base: URLSearchParams; atual: URLSearchParams } | null>(null);
  const mudar = (mudancas: Record<string, string | null>, substituir = false) => {
    const base = pendente.current && pendente.current.base === params ? pendente.current.atual : params;
    const next = new URLSearchParams(base);
    if (mudancas.etapa && mudancas.etapa !== etapa) etapaPedidaAqui.current = mudancas.etapa;
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    pendente.current = { base: params, atual: next };
    setParams(next, { replace: substituir });
  };

  const trocarCliente = (id: string) => {
    const o = lerOnde(id);
    mudar({ client: id, etapa: o.etapa || "criar", kit: o.kit, ensaio: o.ensaio, imagem: null, marca: null });
  };

  useEffect(() => {
    if (!chaveDosAbertos) return;
    mudar({ canvas: null, book: null, clone: null, modelo: null }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDosAbertos]);

  // Peça do mês pelo endereço (o planejamento liga aqui): ?peca=<proposta_id>:<indice> ou ?task=<task_id>
  // (o task= só fora da etapa agenda, que já usa task= para o post). Guarda o pedido e limpa o endereço;
  // a esteira abre a peça quando a lista chega.
  const [pedidoDePeca, setPedidoDePeca] = useState<PedidoDePeca | null>(null);
  const pecaNoEndereco = lerPecaDoEndereco(params);
  const chaveDaPecaNoEndereco = pecaNoEndereco ? (pecaNoEndereco.tipo === "peca" ? `${pecaNoEndereco.proposta_id}:${pecaNoEndereco.indice}` : `task:${pecaNoEndereco.task_id}`) : "";
  useEffect(() => {
    if (!pecaNoEndereco) return;
    setPedidoDePeca(pecaNoEndereco);
    mudar(pecaNoEndereco.tipo === "peca" ? { peca: null } : { task: null }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDaPecaNoEndereco]);

  // Endereço só com o cliente: abre onde parou.
  useEffect(() => {
    if (!clientId || etapaUrl) return;
    const o = lerOnde(clientId);
    if (o.etapa) mudar({ etapa: o.etapa, kit: kitUrl || o.kit, ensaio: ensaioUrl || o.ensaio }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (clientId && etapaUrl) gravarOnde(clientId, { etapa, kit: kitUrl, ensaio: ensaioUrl, nome: nomeDoCliente || null });
  }, [clientId, etapaUrl, etapa, kitUrl, ensaioUrl, nomeDoCliente]);

  // O caminho principal: o próximo passo sai do que já existe (fotos, kits, ensaio aberto).
  const fotosQ = useFotos(clientId);
  const kitsQ = useKits(clientId);
  const ensaiosQ = useEnsaios(clientId);
  const listaDeKits = kitsQ.data || [];
  const ensaioAberto = ensaioUrl ? (ensaiosQ.data || []).find((e) => e.id === ensaioUrl) || null : null;
  // As marcadas que contam (existem e podem sair): a mesma regra da faixa das Fotos, do Próximo e da aba 3.
  const marcadas = useMemo(() => marcadasQueContam(selecionadas, fotosQ.isSuccess ? fotosQ.data || [] : null), [selecionadas, fotosQ.isSuccess, fotosQ.data]);
  // Geradas fora dos lotes (Estúdio, Preparar, ângulo, clone, Canvas): o passo 4 depois de gerar.
  const geradas = useMemo(() => {
    const g = (fotosQ.data || []).filter((f) => !f.referencia_web && classeDaFoto(f) === "gerada");
    return { pendentes: g.filter((f) => !f.aprovada).length, aprovadas: g.filter((f) => f.aprovada).length };
  }, [fotosQ.data]);
  const proximo =
    clientId && fotosQ.isSuccess && kitsQ.isSuccess
      ? proximoPasso({ fotos: (fotosQ.data || []).length, kits: listaDeKits, kitId: kitUrl, ensaio: ensaioAberto, selecionadas: marcadas.length, objetivo, etapa, geradas })
      : null;

  // Kit ou ensaio no endereço que a lista em cache ainda não tem (gravado pelo
  // diretor ou pela função agora): relê uma vez, em vez de mostrar "nenhum".
  const relidos = useRef<string[]>([]);
  useEffect(() => {
    if (kitUrl && kitsQ.isSuccess && !kitsQ.isFetching && !listaDeKits.some((k) => k.id === kitUrl) && relidos.current.indexOf(`kit:${kitUrl}`) < 0) {
      relidos.current.push(`kit:${kitUrl}`);
      void kitsQ.refetch();
    }
    if (ensaioUrl && ensaiosQ.isSuccess && !ensaiosQ.isFetching && !ensaioAberto && relidos.current.indexOf(`ensaio:${ensaioUrl}`) < 0) {
      relidos.current.push(`ensaio:${ensaioUrl}`);
      void ensaiosQ.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitUrl, ensaioUrl, kitsQ.dataUpdatedAt, ensaiosQ.dataUpdatedAt, kitsQ.isSuccess, ensaiosQ.isSuccess]);

  useEffect(
    () =>
      quandoOcioso(() => {
        for (const etapa of [EtapaCriar, EtapaAcervo, EtapaKits, EtapaEstudio, EtapaEnsaio, EtapaCampanha, EtapaPreparar, EtapaAprovar, EtapaRevisar, EtapaUsar, EtapaAgenda, EtapaBiblioteca, EtapaModelos, EtapaClones, EtapaBook]) {
          etapa.preCarregar().catch(() => {
            /* sem rede agora: baixa quando a etapa abrir */
          });
        }
      }),
    [],
  );

  const mesAtual = inicioDoMes();
  // Mesmas chaves da Mesa e da Mesa Ads: o saldo é o mesmo nas três telas.
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
        marcas,
        marca,
      }
    : null;

  const valorDaFoto: MesaFotoValor = {
    kitId: kitUrl,
    ensaioId: ensaioUrl,
    imagemId: imagemUrl,
    escolherKit: (id) => mudar({ kit: id }, true),
    escolherEnsaio: (id) => mudar({ ensaio: id }, true),
    irPara: (e, extras) => {
      const m: Record<string, string | null> = { etapa: e };
      if (extras && extras.imagem !== undefined) m.imagem = extras.imagem;
      if (extras && extras.kit !== undefined) m.kit = extras.kit;
      if (extras && extras.ensaio !== undefined) m.ensaio = extras.ensaio;
      mudar(m);
    },
    selecionadas,
    setSelecionadas,
    marcadas,
    // O diretor é a lateral fixa: abrir é mostrar a lateral (ou a gaveta no
    // celular); o pedido de outra etapa vai para o rascunho do campo dele.
    abrirAgente: () => {
      abrirLateralDaArea();
    },
    etapa,
    proximo,
    pedirAoDiretor: (mensagem: string, opcoes?: { soRascunho?: boolean }) => {
      setPedidoAoDiretor({ mensagem, em: Date.now(), rascunho: !!(opcoes && opcoes.soRascunho) });
      abrirLateralDaArea();
    },
    // Frente MF: de qualquer foto, um clique para o Estúdio de fotos ou para o Post na Agenda.
    abrirNoEstudio: (imagemId: string, ferramenta?: string | null) => mudar({ etapa: "estudio", imagem: imagemId, ferramenta: ferramenta || null }),
    prepararNaAgenda: (imagemIds: string[]) => {
      if (clientId) gravarNaSessao(clientId, CHAVE_DAS_FOTOS_DO_POST, imagemIds.slice(0, 20));
      mudar({ etapa: "agenda", task: null, trabalho: null });
    },
    objetivo,
    escolherObjetivo: (o: ObjetivoDaFoto | null, ir?: boolean) => {
      setObjetivoGuardado(o);
      if (!ir) return;
      // 02/10: com o que precisa em mãos, vai direto para gerar (nunca volta ao passo 1).
      const d = o ? destinoAoEscolher(o, { marcadas, kitId: kitUrl, produtos: listaDeKits.filter((k) => k.status !== "arquivado").length }) : null;
      if (d && d.levarAoPost && clientId) {
        gravarNaSessao(clientId, CHAVE_DAS_FOTOS_DO_POST, marcadas.slice(0, 20));
        mudar({ etapa: "agenda", task: null, trabalho: null });
      } else if (d) mudar(d.imagem ? { etapa: d.etapa, imagem: d.imagem } : { etapa: d.etapa });
      else mudar({ etapa: "acervo" });
    },
  };
  const passoAtual = passoDaEtapa(etapa);
  const passoRecomendado = proximo ? passoDaEtapa(proximo.etapa) : null;
  const objetivoAberto = objetivoPorValor(objetivo);
  // Passo 3 (Gerar): a ferramenta do objetivo, já na foto marcada (Estúdio e Preparar); o post não
  // gera e vai direto ao post (passo 5) levando as marcadas.
  const abrirPasso = (p: { passo: number; etapa: EtapaDaMesaFoto }) => {
    if (p.passo !== 3) {
      mudar({ etapa: p.etapa });
      return;
    }
    // 02/10: o Gerar sempre vai para frente (sem objetivo, deduz pelo produto ou pela foto marcada).
    const d = destinoDoGerar({ objetivo, marcadas, kitId: kitUrl });
    if (!objetivo) setObjetivoGuardado(d.objetivo);
    if (d.levarAoPost && valorDaFoto.prepararNaAgenda) valorDaFoto.prepararNaAgenda(marcadas);
    else mudar(d.imagem ? { etapa: d.etapa, imagem: d.imagem } : { etapa: d.etapa });
  };
  // Ferramentas de apoio (aba com disponivel false em ABAS_FUTURAS some).
  const apoios = ETAPAS_DE_APOIO.filter((e) => ABAS_FUTURAS.every((a) => a.etapa !== e.etapa || a.disponivel));
  const ferramentaAberta = apoios.find((e) => e.etapa === etapa) || null;
  const ferramentaRecomendada = proximo && apoios.some((e) => e.etapa === proximo.etapa) ? proximo.etapa : null;
  const ferramentaEmDestaque = !ferramentaAberta && !!ferramentaRecomendada;
  // Canvas: o quadro precisa da largura toda; a lateral do diretor tem memória própria e começa recolhida.
  const noCanvas = etapa === "canvas";
  const memoriaDaLateral = noCanvas ? "mesa-foto-diretor-canvas" : "mesa-foto-diretor";
  const emColuna = ETAPAS_EM_COLUNA.indexOf(etapa) >= 0;
  const rotuloDaEtapa = (ETAPAS_DA_MESA_FOTO.find((e) => e.valor === etapa) || { rotulo: "Etapa" }).rotulo;
  // Passo 2: as formas de criar vão na barra do kit e do ensaio (cabeçalho), sem linha própria na etapa.
  const formaDeCriar = etapa === "compor" || etapa === "ensaio" || etapa === "campanha" || etapa === "preparar" || etapa === "estudio";
  // Etapa nova sem posição guardada começa no topo: a RegiaoRolavel do sistema
  // faz isso sozinha ao trocar a chave de memória (mesa-foto:<etapa>:<cliente>).

  return (
    // Casca padrão das mesas (src/components/sistema/CascaDaMesa.tsx). O caminho
    // em 5 passos (linha de produção) e as ferramentas avançadas ficam numa linha própria até 1536 px.
    <CascaDaMesa
      mesa="foto"
      titulo="Mesa Foto"
      clientId={clientId}
      marcaId={marca ? marca.id : null}
      telaCheia={telaCheia}
      etapasEmLinhaPropriaAte="2xl"
      cliente={<SeletorDeClientesDaMesa mesa="foto" clientesBrutos={clientesQuery.data as ClienteBruto[] | undefined} valor={clientId} nome={nomeDoCliente} carregando={clientesQuery.isLoading} onEscolher={trocarCliente} />}
      marca={
        // Troca rápida de marca: só no cliente com 2 ou mais marcas.
        clientId && marca ? <SeletorDeMarca marcas={marcas} valor={marca.id} onEscolher={(id) => mudar({ marca: id }, true)} /> : null
      }
      etapas={
        clientId ? (
          <nav aria-label="Etapas da Mesa Foto" className="flex w-full min-w-0 items-center py-1">
            {/* Linha de produção (frente FTL, 30/09): 5 passos. No celular só o passo aberto mostra o
                nome; os outros ficam no número (o nome vai no leitor de tela e na dica). */}
            <div className="flex min-w-0 flex-1 rounded-lg bg-muted p-0.5" data-caminho-principal="" data-linha-de-producao="">
              {PASSOS_PRINCIPAIS.map((p, i) => {
                const ativo = !!passoAtual && passoAtual.passo === p.passo;
                const recomendado = !ativo && !!passoRecomendado && passoRecomendado.passo === p.passo;
                const pula = p.passo === 3 && !!objetivoAberto && objetivoAberto.valor === "post";
                const dica = p.passo === 3 && objetivoAberto ? (pula ? "O post usa fotos prontas: não precisa gerar" : `${p.dica}. Agora: ${objetivoAberto.titulo}`) : p.dica;
                return (
                  <button
                    key={p.passo}
                    type="button"
                    onClick={() => abrirPasso(p)}
                    aria-current={ativo ? "page" : undefined}
                    aria-label={`${p.passo}. ${p.rotulo}`}
                    title={dica}
                    data-passo={p.passo}
                    data-proximo={recomendado ? "" : undefined}
                    data-pula={pula ? "" : undefined}
                    className={juntar(
                      "inline-flex h-8 min-w-0 items-center justify-center rounded-md text-[13px] font-medium transition-colors",
                      i > 0 && "ml-0.5",
                      ativo ? "flex-1 bg-card px-2 text-foreground shadow-sm" : "shrink-0 px-1.5 sm:flex-1 sm:shrink sm:px-2",
                      foco,
                      !ativo && (recomendado ? "text-primary hover:bg-card/60" : pula ? "text-muted-foreground/60 hover:text-foreground" : "text-muted-foreground hover:text-foreground"),
                    )}
                  >
                    <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${ativo || recomendado ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}>
                      {p.passo}
                    </span>
                    <span className={juntar("ml-1.5 min-w-0 truncate", !ativo && "hidden sm:block")}>{p.rotulo}</span>
                  </button>
                );
              })}
            </div>
            {/* Ferramentas avançadas (Mais): um seletor só, fora da linha de produção, com a aberta
                no botão e a recomendada marcada na lista. */}
            <div
              className="ml-1.5 min-w-0 max-w-[42%] shrink-0 sm:ml-2 sm:max-w-none"
              data-etapas-de-apoio=""
              data-ferramenta={ferramentaAberta ? ferramentaAberta.etapa : undefined}
              data-proximo={ferramentaEmDestaque ? "" : undefined}
              role="group"
              aria-label="Ferramentas avançadas"
            >
              <SeletorCompacto
                modo="lista"
                rotulo="Mais"
                icone={<MoreHorizontal className="h-4 w-4" />}
                opcoes={apoios.map((e) => ({
                  valor: e.etapa,
                  rotulo: e.rotulo,
                  icone: FERRAMENTAS[e.etapa] ? FERRAMENTAS[e.etapa].icone : undefined,
                  descricao: e.etapa === ferramentaRecomendada && e.etapa !== etapa ? "Recomendada agora" : FERRAMENTAS[e.etapa] ? FERRAMENTAS[e.etapa].descricao : undefined,
                }))}
                valor={ferramentaAberta ? ferramentaAberta.etapa : ""}
                onEscolher={(v) => mudar({ etapa: v })}
                className={juntar("w-full", ferramentaAberta ? "border-primary/40 bg-muted" : ferramentaEmDestaque ? "border-primary/50 text-primary" : "text-muted-foreground")}
              />
            </div>
          </nav>
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
            onChaves={abrirChaves}
            onModelos={abrirModelos}
          />
        ) : null
      }
      abaixo={
        valor ? (
          <MesaProvider valor={valor}>
            <MesaFotoProvider valor={valorDaFoto}>
              <Suspense fallback={<div className="mt-2 h-5" />}>
                <BarraDoEnsaio inicio={formaDeCriar ? <NavDoCriar atual={etapa} /> : undefined} />
              </Suspense>
            </MesaFotoProvider>
          </MesaProvider>
        ) : null
      }
    >

      {!clientId && <EstadoVazio icone={<Camera className="h-5 w-5" />} titulo="Escolha um cliente" descricao="A Mesa Foto abre com as fotos dele." />}

      {valor && (
        <MesaProvider valor={valor}>
          <MesaFotoProvider valor={valorDaFoto}>
            {/* Área de trabalho (src/components/sistema/AreaDeTrabalho.tsx): a etapa na
                região principal e o diretor de fotografia fixo ao lado. O "relative"
                da etapa prende dentro da região o que é absoluto (o select escondido
                do Radix): sem ele, a página inteira rolava junto no computador. */}
            <AreaDeTrabalho
              key={memoriaDaLateral}
              memoria={memoriaDaLateral}
              nasceRecolhida={noCanvas}
              memoriaDaRolagem={`mesa-foto:${etapa}:${valor.clientId}`}
              principalRolavel={!emColuna}
              rotuloDoPrincipal={rotuloDaEtapa}
              rotuloDaLateral="Diretor de fotografia"
              iconeDaLateral={<Aperture className="h-4 w-4" />}
              lateral={
                <Suspense fallback={<EsqueletoDoDiretor />}>
                  <AgenteDiretor key={`agente-${valor.clientId}`} pedido={pedidoAoDiretor} />
                </Suspense>
              }
            >
              <div key={valor.clientId} className={emColuna ? "relative flex min-w-0 flex-col lg:min-h-0 lg:flex-1" : "relative min-w-0 pb-6"} data-etapa-da-mesa-foto={etapa}>
                {/* A faixa das peças do mês fica fora do Canvas (o quadro precisa da altura); a janela da peça vale em todas. */}
                <Suspense fallback={null}>
                  <EsteiraDoMes mostrarFaixa={!noCanvas} pedido={pedidoDePeca} onPedidoAtendido={() => setPedidoDePeca(null)} />
                </Suspense>
                <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo a etapa" />}>
                  {etapa === "acervo" && <EtapaAcervo />}
                  {etapa === "kits" && <EtapaKits />}
                  {etapa === "criar" && <EtapaCriar />}
                  {etapa === "estudio" && <EtapaEstudio />}
                  {etapa === "compor" && <ComposicaoRapida />}
                  {etapa === "agenda" && <EtapaAgenda />}
                  {etapa === "preparar" && <EtapaPreparar />}
                  {etapa === "ensaio" && <EtapaEnsaio />}
                  {etapa === "campanha" && <EtapaCampanha />}
                  {etapa === "revisar" && <EtapaRevisar />}
                  {etapa === "aprovar" && <EtapaAprovar />}
                  {etapa === "usar" && <EtapaUsar />}
                  {etapa === "biblioteca" && <EtapaBiblioteca />}
                  {etapa === "modelos" && <EtapaModelos />}
                  {etapa === "clones" && <EtapaClones />}
                  {etapa === "book" && <EtapaBook />}
                  {etapa === "canvas" && <EtapaCanvas />}
                </Suspense>
              </div>
            </AreaDeTrabalho>
          </MesaFotoProvider>

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
