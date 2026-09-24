import { custoDaResposta, ErroDaMesa } from "@/lib/mesa/api";
import type { EtapaDaLamina } from "./PranchetaDoEstudio";

/**
 * Autocorreção antes de mostrar (docs/mesa-ads/v2/CONTRATO-V2.md, seção
 * "Estúdio: autocorreção antes de mostrar"). Pedido do dono: a conferência vem
 * antes de entregar; se estiver errado, o estúdio já corrige, para não gastar
 * crédito entregando erro.
 *
 * Um ciclo só, usado pelo Estúdio da Mesa (AbaEstudio) e pela arte do
 * criativo da Mesa Ads (ArteDoCriativo): confere; se a decisão do servidor
 * pede correção e a chave "Corrigir sozinho" está ligada, chama corrigir_card
 * e confere de novo, até 2 vezes. A lâmina fica velada o tempo todo (a etapa
 * vem por aoMudarEtapa) e só é revelada no fim. O custo de todas as chamadas
 * volta somado.
 */

export interface DecisaoDeAutocorrecao {
  precisa: boolean;
  motivos: string[];
  instrucao: string | null;
}

/** Rodadas automáticas por ciclo (o servidor recusa a terceira seguida). */
export const RODADAS_AUTOMATICAS = 2;

/** Chave da sessão com a escolha "Corrigir sozinho" de cada trabalho. */
export const chaveDoCorrigirSozinho = (trabalhoId: string) => `mesa:estudio:corrigir-sozinho:${trabalhoId}`;

export function decisaoDaResposta(r: unknown): DecisaoDeAutocorrecao | null {
  const a = r && typeof r === "object" ? (r as { autocorrecao?: Partial<DecisaoDeAutocorrecao> | null }).autocorrecao : null;
  if (!a || typeof a !== "object" || typeof a.precisa !== "boolean") return null;
  return {
    precisa: a.precisa,
    motivos: Array.isArray(a.motivos) ? a.motivos.map((m: unknown) => String(m)) : [],
    instrucao: typeof a.instrucao === "string" ? a.instrucao : null,
  };
}

/** "Texto errado na arte: faltou ..." vira "Texto errado na arte" (a etapa no véu). */
export function motivoCurto(motivo: string | undefined): string {
  if (!motivo) return "";
  const i = motivo.indexOf(":");
  const curto = (i > 0 ? motivo.slice(0, i) : motivo).replace(/\s*\(.*\)\s*$/, "").trim();
  return curto.charAt(0).toLocaleLowerCase("pt-BR") + curto.slice(1);
}

export interface ResultadoDoCiclo {
  custo_usd: number;
  /** Decisão da última conferência (null se nenhuma conferência respondeu). */
  autocorrecao: DecisaoDeAutocorrecao | null;
  /** Quantas correções este ciclo fez. */
  rodadas: number;
  /** Erro que parou o ciclo (a arte já estava gerada e cobrada). */
  falha: unknown;
}

/**
 * Confere e, se precisar, corrige e confere de novo. Nunca lança: a arte já
 * foi gerada e cobrada, então a falha volta em `falha` com o custo somado até
 * ali. O limite do servidor (limite_de_autocorrecao) só encerra o ciclo.
 */
export async function conferirECorrigir(opcoes: {
  conferir: () => Promise<unknown>;
  corrigir: (pedidoDaEquipe: boolean) => Promise<unknown>;
  corrigirSozinho: boolean;
  aoMudarEtapa: (etapa: EtapaDaLamina, detalhe?: string) => void;
  /** Botão "Corrigir de novo": começa corrigindo, sem conferir antes. */
  comecarCorrigindo?: DecisaoDeAutocorrecao | null;
}): Promise<ResultadoDoCiclo> {
  let custo = 0;
  let rodadas = 0;
  let decisao: DecisaoDeAutocorrecao | null = opcoes.comecarCorrigindo || null;
  let falha: unknown = null;
  const somar = (r: unknown) => { custo += custoDaResposta(r) || 0; };
  try {
    if (!opcoes.comecarCorrigindo) {
      opcoes.aoMudarEtapa("conferindo");
      const c = await opcoes.conferir();
      somar(c);
      decisao = decisaoDaResposta(c);
    }
    const podeCorrigir = opcoes.corrigirSozinho || !!opcoes.comecarCorrigindo;
    while (podeCorrigir && decisao && decisao.precisa && rodadas < RODADAS_AUTOMATICAS) {
      opcoes.aoMudarEtapa("corrigindo", motivoCurto(decisao.motivos[0]));
      const r = await opcoes.corrigir(!!opcoes.comecarCorrigindo && rodadas === 0);
      somar(r);
      if (!r || !(r as { corrigido?: boolean }).corrigido) {
        decisao = decisaoDaResposta(r) || decisao;
        break;
      }
      rodadas++;
      opcoes.aoMudarEtapa("reconferindo");
      const c = await opcoes.conferir();
      somar(c);
      decisao = decisaoDaResposta(c);
      // "Corrigir de novo" com a chave desligada: uma correção só.
      if (!opcoes.corrigirSozinho) break;
    }
  } catch (e) {
    if (!(e instanceof ErroDaMesa && e.codigo === "limite_de_autocorrecao")) falha = e;
  }
  return { custo_usd: custo, autocorrecao: decisao, rodadas, falha };
}
