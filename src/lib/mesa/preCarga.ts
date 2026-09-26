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

export const MESAS_DO_PAINEL: Record<"/mesa" | "/mesa-ads" | "/mesa-foto" | "/mesa-videos" | "/mesa-publicidade" | "/mesa-roteiros", MesaDoPainel> = {
  "/mesa": {
    prefixo: "mesa",
    pagina: () => import("@/pages/MesaDoCliente"),
    parametro: "aba",
    padrao: "contexto",
    onde: "mesa:onde:",
    campoOnde: "aba",
    etapas: {
      contexto: () => import("@/components/mesa/AbaContexto"),
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
      // O Canvas (React Flow) só baixa quando o endereço já pede o Canvas.
      canvas: () => import("@/components/mesa-foto/EtapaCanvas"),
    },
    sempre: {
      "barra-do-ensaio": () => import("@/components/mesa-foto/BarraDoEnsaio"),
      "agente-diretor": () => import("@/components/mesa-foto/AgenteDiretor"),
    },
  },
  // Mesa Vídeos (frente V2, 25/09): acervo, história, roteiro e cenas, edição e versões.
  "/mesa-videos": {
    prefixo: "mesa-videos",
    pagina: () => import("@/pages/MesaVideos"),
    parametro: "etapa",
    padrao: "acervo",
    onde: "mesa-videos:onde:",
    campoOnde: "etapa",
    etapas: {
      acervo: () => import("@/components/mesa-videos/EtapaAcervo"),
      historia: () => import("@/components/mesa-videos/EtapaHistoria"),
      roteiros: () => import("@/components/mesa-videos/EtapaRoteiros"),
      edicao: () => import("@/components/mesa-videos/EtapaEdicao"),
      memoria: () => import("@/components/mesa-videos/EtapaMemoria"),
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
};

type Caminho = keyof typeof MESAS_DO_PAINEL;

export const chaveDaPagina = (caminho: Caminho) => `pagina${caminho}`;
export const chaveDaEtapa = (caminho: Caminho, etapa: string) => `${MESAS_DO_PAINEL[caminho].prefixo}/${etapa}`;

function mesaDoCaminho(caminho: string): Caminho | null {
  const limpo = (caminho || "").replace(/\/+$/, "") || "/";
  return limpo === "/mesa" || limpo === "/mesa-ads" || limpo === "/mesa-foto" || limpo === "/mesa-videos" || limpo === "/mesa-publicidade" || limpo === "/mesa-roteiros" ? limpo : null;
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
export const PaginaMesaPublicidade = paginaDaMesa("/mesa-publicidade");
export const PaginaMesaRoteiros = paginaDaMesa("/mesa-roteiros");

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
