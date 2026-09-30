import { useEffect } from "react";
import { lazyComPreCarga, preCarregarEmSilencio, quandoOcioso, redeEconomica } from "@/lib/lazyComPreCarga";

/**
 * A Mesa abre na hora (dono, 25/09: "eu clico, ele já aparece tudo").
 *
 * Três jeitos de o código chegar antes do clique:
 * 1. Painel ocioso: logo depois de o painel abrir, a equipe baixa as três
 *    mesas e a primeira etapa de cada uma (menos em rede econômica).
 * 2. Mouse em cima, foco ou toque no link de uma mesa (propsDePreCarga).
 * 3. Na própria abertura, a página e a etapa que vai aparecer baixam JUNTAS,
 *    em paralelo: antes a etapa só começava depois que a página chegava.
 *
 * As chaves são as mesmas que as páginas usam no lazyComPreCarga (o teste
 * src/test/mesa-velocidade-e-tela-cheia.test.ts confere): baixar aqui é o
 * mesmo download e o mesmo módulo de lá, e a tela aparece sem esqueleto.
 */

type Carregar = () => Promise<unknown>;

interface MesaDoPainel {
  /** Prefixo das chaves das etapas ("mesa/contexto"). */
  prefixo: string;
  pagina: Carregar;
  /** Nome do parâmetro da etapa no endereço. */
  parametro: string;
  padrao: string;
  /** Onde a página guarda "onde parou" por cliente (localStorage) e o campo da etapa. */
  onde: string;
  campoOnde: string;
  etapas: Record<string, Carregar>;
  /** Peças que a página sempre mostra com cliente aberto. */
  sempre?: Record<string, Carregar>;
  /** O que a mesa mostra sem cliente escolhido. */
  semCliente?: Record<string, Carregar>;
}

export const MESAS_DO_PAINEL: Record<"/mesa" | "/mesa-ads" | "/mesa-foto" | "/mesa-videos" | "/mesa-edicao" | "/mesa-publicidade" | "/mesa-roteiros" | "/mesa-identidade" | "/mesa-proposta" | "/mesa-site" | "/mesa-motion", MesaDoPainel> = {
  "/mesa": {
    prefixo: "mesa",
    pagina: () => import("@/pages/MesaDoCliente"),
    parametro: "aba",
    padrao: "contexto",
    onde: "mesa:onde:",
    campoOnde: "aba",
    etapas: {
      contexto: () => import("@/components/mesa/AbaContexto"),
      instagram: () => import("@/components/mesa/AbaInstagram"),
      mes: () => import("@/components/mesa/AbaMes"),
      campanhas: () => import("@/components/mesa/AbaCampanhas"),
      estudio: () => import("@/components/mesa/AbaEstudio"),
      entrega: () => import("@/components/mesa/AbaEntrega"),
    },
    // Sem cliente, a Mesa abre na fila de prioridades da equipe.
    semCliente: { fila: () => import("@/components/mesa/FilaDePrioridades") },
  },
  "/mesa-ads": {
    prefixo: "mesa-ads",
    pagina: () => import("@/pages/MesaAds"),
    parametro: "etapa",
    padrao: "oferta",
    onde: "mesa-ads:onde:",
    campoOnde: "etapa",
    etapas: {
      oferta: () => import("@/components/mesa-ads/AbaOferta"),
      referencias: () => import("@/components/mesa-ads/AbaReferencias"),
      plano: () => import("@/components/mesa-ads/AbaPlano"),
      estudio: () => import("@/components/mesa-ads/AbaEstudioAds"),
      conta: () => import("@/components/mesa-ads/AbaConta"),
      resultados: () => import("@/components/mesa-ads/AbaResultados"),
    },
  },
  "/mesa-foto": {
    prefixo: "mesa-foto",
    pagina: () => import("@/pages/MesaFoto"),
    parametro: "etapa",
    padrao: "acervo",
    onde: "mesa-foto:onde:",
    campoOnde: "etapa",
    etapas: {
      acervo: () => import("@/components/mesa-foto/EtapaAcervo"),
      kits: () => import("@/components/mesa-foto/EtapaKits"),
      preparar: () => import("@/components/mesa-foto/EtapaPreparar"),
      ensaio: () => import("@/components/mesa-foto/EtapaEnsaio"),
      revisar: () => import("@/components/mesa-foto/EtapaRevisar"),
      usar: () => import("@/components/mesa-foto/EtapaUsar"),
      biblioteca: () => import("@/components/mesa-foto/EtapaBiblioteca"),
      campanha: () => import("@/components/mesa-foto/EtapaCampanha"),
      criar: () => import("@/components/mesa-foto/EtapaCriar"),
      modelos: () => import("@/components/mesa-foto/EtapaModelos"),
      clones: () => import("@/components/mesa-foto/EtapaClones"),
      book: () => import("@/components/mesa-foto/EtapaBook"),
      // Frente MF (27/09): Estúdio de fotos e Post na Agenda.
      estudio: () => import("@/components/mesa-foto/EtapaEstudio"),
      agenda: () => import("@/components/mesa-foto/EtapaAgenda"),
      // O Canvas (React Flow) só baixa quando o endereço já pede o Canvas.
      canvas: () => import("@/components/mesa-foto/EtapaCanvas"),
    },
    sempre: {
      "barra-do-ensaio": () => import("@/components/mesa-foto/BarraDoEnsaio"),
      "agente-diretor": () => import("@/components/mesa-foto/AgenteDiretor"),
    },
  },
  // Mesa Vídeos (frente V2, 25/09; separada da Edição na frente E2, 26/09; diretor na V-A): base, kit, bíblia, roteiro, gerar e resultados.
  "/mesa-videos": {
    prefixo: "mesa-videos",
    pagina: () => import("@/pages/MesaVideos"),
    parametro: "etapa",
    padrao: "base",
    onde: "mesa-videos:onde:",
    campoOnde: "etapa",
    etapas: {
      base: () => import("@/components/mesa-videos/EtapaBase"),
      // Frente V-A (26/09): kit, bíblia e roteiro do diretor.
      kit: () => import("@/components/mesa-videos/EtapaKit"),
      biblia: () => import("@/components/mesa-videos/EtapaBiblia"),
      roteiro: () => import("@/components/mesa-videos/EtapaRoteiro"),
      gerar: () => import("@/components/mesa-videos/EtapaGerar"),
      resultados: () => import("@/components/mesa-videos/EtapaResultados"),
    },
    sempre: {
      agente: () => import("@/components/mesa-videos/AgenteDaMesaDeVideo"),
    },
  },
  // Mesa Edição (frente E2, 26/09): entrada, organizar e editar.
  "/mesa-edicao": {
    prefixo: "mesa-edicao",
    pagina: () => import("@/pages/MesaEdicao"),
    parametro: "etapa",
    padrao: "entrada",
    onde: "mesa-edicao:onde:",
    campoOnde: "etapa",
    etapas: {
      entrada: () => import("@/components/mesa-edicao/EtapaEntrada"),
      organizar: () => import("@/components/mesa-edicao/EtapaOrganizar"),
      editar: () => import("@/components/mesa-edicao/EtapaEditar"),
    },
    sempre: {
      agente: () => import("@/components/mesa-edicao/AgenteDaEdicao"),
    },
  },
  // Mesa Publicidade (frente P, 26/09): campanha, direção, tomadas, revisão e envio.
  "/mesa-publicidade": {
    prefixo: "mesa-publicidade",
    pagina: () => import("@/pages/MesaPublicidade"),
    parametro: "etapa",
    padrao: "campanha",
    onde: "mesa-publicidade:onde:",
    campoOnde: "etapa",
    etapas: {
      campanha: () => import("@/components/mesa-publicidade/EtapaCampanha"),
      direcao: () => import("@/components/mesa-publicidade/EtapaDirecao"),
      tomadas: () => import("@/components/mesa-publicidade/EtapaTomadas"),
      revisao: () => import("@/components/mesa-publicidade/EtapaRevisao"),
      envio: () => import("@/components/mesa-publicidade/EtapaEnvio"),
    },
    sempre: {
      agente: () => import("@/components/mesa-publicidade/AgenteDaPublicidade"),
    },
  },
  // Mesa Roteiros (frente R2, 26/09): agenda, roteiro, revisão, PDF e modelos.
  "/mesa-roteiros": {
    prefixo: "mesa-roteiros",
    pagina: () => import("@/pages/MesaRoteiros"),
    parametro: "etapa",
    padrao: "agenda",
    onde: "mesa-roteiros:onde:",
    campoOnde: "etapa",
    etapas: {
      agenda: () => import("@/components/mesa-roteiros/EtapaAgenda"),
      roteiro: () => import("@/components/mesa-roteiros/EtapaRoteiro"),
      revisao: () => import("@/components/mesa-roteiros/EtapaRevisao"),
      pdf: () => import("@/components/mesa-roteiros/EtapaPdf"),
      modelos: () => import("@/components/mesa-roteiros/EtapaModelos"),
    },
    sempre: {
      agente: () => import("@/components/mesa-roteiros/AgenteRoteirista"),
    },
  },
  // Mesa Identidade (frente IDV, 30/09): etapas em sequência; fora de PRIMEIRAS e da pré-carga ociosa.
  "/mesa-identidade": {
    prefixo: "mesa-identidade",
    pagina: () => import("@/pages/MesaIdentidade"),
    parametro: "etapa",
    padrao: "inicio",
    onde: "mesa-identidade:onde:",
    campoOnde: "etapa",
    etapas: {
      inicio: () => import("@/components/mesa-identidade/EtapaInicio"),
      briefing: () => import("@/components/mesa-identidade/EtapaBriefing"),
      pesquisa: () => import("@/components/mesa-identidade/EtapaPesquisa"),
      estrategia: () => import("@/components/mesa-identidade/EtapaEstrategia"),
      naming: () => import("@/components/mesa-identidade/EtapaNaming"),
      conceito: () => import("@/components/mesa-identidade/EtapaConceito"),
      sistema: () => import("@/components/mesa-identidade/EtapaSistema"),
      mockups: () => import("@/components/mesa-identidade/EtapaMockups"),
      guideline: () => import("@/components/mesa-identidade/EtapaGuideline"),
      apresentacao: () => import("@/components/mesa-identidade/EtapaApresentacao"),
      entrega: () => import("@/components/mesa-identidade/EtapaEntrega"),
    },
    sempre: {
      agente: () => import("@/components/mesa-identidade/AgenteDiretorDeMarca"),
    },
  },
  // Mesa Proposta (frente PRO, 30/09): contexto, rascunho, revisão e envio. Fora da pré-carga ociosa.
  "/mesa-proposta": {
    prefixo: "mesa-proposta",
    pagina: () => import("@/pages/MesaProposta"),
    parametro: "etapa",
    padrao: "contexto",
    onde: "mesa-proposta:onde:",
    campoOnde: "etapa",
    etapas: {
      contexto: () => import("@/components/mesa-proposta/EtapaContexto"),
      rascunho: () => import("@/components/mesa-proposta/EtapaRascunho"),
      revisao: () => import("@/components/mesa-proposta/EtapaRevisao"),
      envio: () => import("@/components/mesa-proposta/EtapaEnvio"),
    },
    sempre: {
      agente: () => import("@/components/mesa-proposta/AgenteDaProposta"),
    },
  },
  // Mesa Site (frente SIT, 30/09; SIT2 acrescentou Integrações e SEO): as 9 etapas do site e o diretor de site. Fora da pré-carga ociosa.
  "/mesa-site": {
    prefixo: "mesa-site",
    pagina: () => import("@/pages/MesaSite"),
    parametro: "etapa",
    padrao: "briefing",
    onde: "mesa-site:onde:",
    campoOnde: "etapa",
    etapas: {
      briefing: () => import("@/components/mesa-site/EtapaBriefing"),
      referencias: () => import("@/components/mesa-site/EtapaReferencias"),
      direcao: () => import("@/components/mesa-site/EtapaDirecao"),
      conteudo: () => import("@/components/mesa-site/EtapaConteudo"),
      imagens: () => import("@/components/mesa-site/EtapaImagens"),
      integracoes: () => import("@/components/mesa-site/EtapaIntegracoes"),
      construcao: () => import("@/components/mesa-site/EtapaConstrucao"),
      revisao: () => import("@/components/mesa-site/EtapaRevisao"),
      publicacao: () => import("@/components/mesa-site/EtapaPublicacao"),
    },
    sempre: {
      agente: () => import("@/components/mesa-site/AgenteDoSite"),
    },
  },
  // Mesa Motion (frente MOT, 30/09): apresentação em motion e filme da marca (9 etapas) e o diretor de motion. Fora da pré-carga ociosa.
  "/mesa-motion": {
    prefixo: "mesa-motion",
    pagina: () => import("@/pages/MesaMotion"),
    parametro: "etapa",
    padrao: "insumos",
    onde: "mesa-motion:onde:",
    campoOnde: "etapa",
    etapas: {
      insumos: () => import("@/components/mesa-motion/EtapaInsumos"),
      entrevista: () => import("@/components/mesa-motion/EtapaEntrevista"),
      brand: () => import("@/components/mesa-motion/EtapaBrand"),
      storyboards: () => import("@/components/mesa-motion/EtapaStoryboards"),
      stills: () => import("@/components/mesa-motion/EtapaStills"),
      construcao: () => import("@/components/mesa-motion/EtapaConstrucao"),
      critica: () => import("@/components/mesa-motion/EtapaCritica"),
      som: () => import("@/components/mesa-motion/EtapaSom"),
      render: () => import("@/components/mesa-motion/EtapaRender"),
    },
    sempre: {
      agente: () => import("@/components/mesa-motion/AgenteDoMotion"),
    },
  },
};

type Caminho = keyof typeof MESAS_DO_PAINEL;

export const chaveDaPagina = (caminho: Caminho) => `pagina${caminho}`;
export const chaveDaEtapa = (caminho: Caminho, etapa: string) => `${MESAS_DO_PAINEL[caminho].prefixo}/${etapa}`;

function mesaDoCaminho(caminho: string): Caminho | null {
  const limpo = (caminho || "").replace(/\/+$/, "") || "/";
  return limpo === "/mesa" || limpo === "/mesa-ads" || limpo === "/mesa-foto" || limpo === "/mesa-videos" || limpo === "/mesa-edicao" || limpo === "/mesa-publicidade" || limpo === "/mesa-roteiros" || limpo === "/mesa-identidade" || limpo === "/mesa-proposta" || limpo === "/mesa-site" || limpo === "/mesa-motion" ? limpo : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A etapa que a mesa vai abrir: a do endereço, senão onde parou com o cliente, senão a primeira. Sem cliente: nenhuma. */
export function etapaQueVaiAbrir(caminho: string, busca: string): string | null {
  const qual = mesaDoCaminho(caminho);
  if (!qual) return null;
  const m = MESAS_DO_PAINEL[qual];
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(busca || "");
  } catch {
    return null;
  }
  const cliente = params.get("client") || "";
  if (!UUID.test(cliente)) return null;
  const pedida = params.get(m.parametro);
  if (pedida && m.etapas[pedida]) return pedida;
  try {
    const guardado = JSON.parse(window.localStorage.getItem(m.onde + cliente) || "null");
    const etapa = guardado && typeof guardado === "object" ? String(guardado[m.campoOnde] || "") : "";
    if (etapa && m.etapas[etapa]) return etapa;
  } catch {
    /* sem armazenamento: vale a primeira etapa */
  }
  return m.padrao;
}

/** O que baixar para abrir esta mesa: [chave, carregar] da página, da etapa e das peças fixas. */
export function cargasDaMesa(caminho: string, busca: string, comPagina = true): Array<[string, Carregar]> {
  const qual = mesaDoCaminho(caminho);
  if (!qual) return [];
  const m = MESAS_DO_PAINEL[qual];
  const saida: Array<[string, Carregar]> = [];
  if (comPagina) saida.push([chaveDaPagina(qual), m.pagina]);
  const etapa = etapaQueVaiAbrir(qual, busca);
  const extras = etapa ? m.sempre || {} : m.semCliente || {};
  if (etapa) saida.push([chaveDaEtapa(qual, etapa), m.etapas[etapa]]);
  for (const nome of Object.keys(extras)) saida.push([`${m.prefixo}/${nome}`, extras[nome]]);
  return saida;
}

function separar(destino: string): { caminho: string; busca: string } {
  const i = destino.indexOf("?");
  return i < 0 ? { caminho: destino, busca: "" } : { caminho: destino.slice(0, i), busca: destino.slice(i) };
}

/** Baixa a mesa deste endereço (ex.: "/mesa-ads?client=…"). Sem rede: baixa quando abrir. */
export function preCarregarMesa(destino: string) {
  const { caminho, busca } = separar(destino);
  for (const [chave, carregar] of cargasDaMesa(caminho, busca)) preCarregarEmSilencio(chave, carregar);
}

/** Para pôr num link de mesa: mouse em cima, foco do teclado ou toque já começam a baixar. */
export function propsDePreCarga(destino: string) {
  const baixar = () => preCarregarMesa(destino);
  return { onMouseEnter: baixar, onFocus: baixar, onTouchStart: baixar };
}

/** A etapa do endereço atual baixa junto com a página (em paralelo, não depois). */
function etapaDoEnderecoJunto(caminho: Caminho) {
  try {
    for (const [chave, carregar] of cargasDaMesa(caminho, window.location.search, false)) preCarregarEmSilencio(chave, carregar);
  } catch {
    /* sem endereço: a página pede a etapa quando abrir */
  }
}

function paginaDaMesa(caminho: Caminho) {
  return lazyComPreCarga(chaveDaPagina(caminho), () => {
    etapaDoEnderecoJunto(caminho);
    return MESAS_DO_PAINEL[caminho].pagina() as Promise<{ default: any }>;
  });
}

/** As três páginas para as rotas do painel (src/App.tsx). */
export const PaginaMesaDoCliente = paginaDaMesa("/mesa");
export const PaginaMesaAds = paginaDaMesa("/mesa-ads");
export const PaginaMesaFoto = paginaDaMesa("/mesa-foto");
export const PaginaMesaVideos = paginaDaMesa("/mesa-videos");
export const PaginaMesaEdicao = paginaDaMesa("/mesa-edicao");
export const PaginaMesaPublicidade = paginaDaMesa("/mesa-publicidade");
export const PaginaMesaRoteiros = paginaDaMesa("/mesa-roteiros");
export const PaginaMesaIdentidade = paginaDaMesa("/mesa-identidade");
export const PaginaMesaProposta = paginaDaMesa("/mesa-proposta");
export const PaginaMesaSite = paginaDaMesa("/mesa-site");
export const PaginaMesaMotion = paginaDaMesa("/mesa-motion");

/** Primeira etapa de cada mesa, baixada no tempo ocioso do painel. */
const PRIMEIRAS: Array<[Caminho, string]> = [
  ["/mesa", "contexto"],
  ["/mesa-ads", "oferta"],
  ["/mesa-foto", "acervo"],
];

/**
 * Painel ocioso: a equipe que usa as mesas já tem o código delas antes do
 * clique. Espera o painel assentar (2,5 s e o navegador ocioso), baixa as três
 * páginas e, no próximo ócio, a primeira etapa de cada. Em rede econômica, não.
 */
export function usePreCargaOciosaDasMesas(ativo: boolean) {
  useEffect(() => {
    if (!ativo || redeEconomica()) return;
    let cancelar: () => void = () => undefined;
    const espera = window.setTimeout(() => {
      cancelar = quandoOcioso(() => {
        PaginaMesaDoCliente.preCarregar().catch(() => undefined);
        PaginaMesaAds.preCarregar().catch(() => undefined);
        PaginaMesaFoto.preCarregar().catch(() => undefined);
        cancelar = quandoOcioso(() => {
          for (const [caminho, etapa] of PRIMEIRAS) preCarregarEmSilencio(chaveDaEtapa(caminho, etapa), MESAS_DO_PAINEL[caminho].etapas[etapa]);
        }, 8000);
      }, 6000);
    }, 2500);
    return () => {
      window.clearTimeout(espera);
      cancelar();
    };
  }, [ativo]);
}
