/**
 * Motor de copy no servidor (frente CPY): a voz da marca pelo contexto
 * completo e a conferência pelo Jev. Nunca lança: sem contexto, voz vazia;
 * sem o Jev, ordem pela conferência em código e a falha no log e em jev_erro.
 * Aviso, sem reescrever nem chamar o modelo de novo.
 */

import { contextoCompletoParaPrompt } from "./contexto-completo-da-marca.ts";
import { montarBlocoDoPacote } from "./contexto-completo-regras.ts";
import { JevErro, jevPerguntar, type PerguntaJev } from "./jev.ts";
import { cobrarJev, type ReferenciaUso, type Tarefa } from "./ia-motor.ts";
import { registrarFalha } from "./falha-registrada.ts";
import {
  type CanalDaCopy,
  type ConferenciaDaCopy,
  conferirCopy,
  estadoDaConferencia,
  lerConferencia,
  limparCopy,
  notaDaCopy,
  type NotaDoJev,
  type ObjetivoDaCopy,
  perguntasDaConferencia,
  ranquear,
  regrasDaCasa,
  type RegrasDaCasa,
} from "./motor-de-copy.ts";

type Banco = { from: (tabela: string) => any };

/** bloco: o contexto completo para o pedido ao modelo; essencial: o recorte da voz para o Jev. */
export type VozDaMarca = { bloco: string; essencial: string; usando: string; nome: string; regras: RegrasDaCasa };

/** A voz da marca aberta (regra da herança) para escrever e conferir copy. Nunca lança. */
export async function vozDaMarca(db: Banco, clientId: string, alvo: unknown, teto = 3500): Promise<VozDaMarca> {
  try {
    const ctx = await contextoCompletoParaPrompt(db, clientId, alvo as never, { area: "copy", teto });
    const nome = ctx.pacote.marca ? ctx.pacote.marca.nome : ctx.pacote.nomeCliente;
    // Para o Jev, o essencial da voz (marca, contexto, estratégia, cérebro, briefing), sem o título longo.
    const essencial = montarBlocoDoPacote(ctx.pacote, { area: "copy", teto: Math.min(teto, 3000), partes: ["marca", "contexto", "estrategia", "cerebro", "briefing"], semTitulo: true });
    return { bloco: ctx.bloco, essencial, usando: ctx.usando, nome, regras: regrasDaCasa(essencial) };
  } catch (e) {
    registrarFalha("motor-de-copy: voz da marca não lida", e, { client_id: clientId });
    return { bloco: "", essencial: "", usando: "", nome: "", regras: regrasDaCasa() };
  }
}

const vozParaOJev = (v: VozDaMarca | null | undefined) => (v ? v.essencial || v.bloco : "");

export type PedidoDaConferencia = {
  textos: string[];
  canal: CanalDaCopy;
  objetivo: ObjetivoDaCopy;
  voz?: VozDaMarca | null;
  oferta?: string | null;
  semHashtags?: boolean;
  /** false: não corta no teto do canal (a mesa já tem o dela). */
  cortar?: boolean;
  /** Sem Jev (ex.: a mesa já conferiu por outro caminho): só a conferência em código. */
  semJev?: boolean;
  cobranca: { clientId: string; tarefa: Tarefa; referencia?: ReferenciaUso; criadoPor?: string | null };
  /** Para teste e prova local: outro jeito de perguntar ao Jev e de registrar o uso. */
  jev?: typeof jevPerguntar;
  cobrar?: (r: { usage: { input_tokens?: number; output_tokens?: number } | null; modelo?: string }, c: PedidoDaConferencia["cobranca"]) => Promise<{ custoUsd: number } | null>;
};

export type ResultadoDaConferencia = {
  /** Os textos limpos, na ordem em que vieram. */
  textos: string[];
  /** Uma conferência por texto, na ordem em que vieram. */
  conferencias: ConferenciaDaCopy[];
  /** Índices da melhor para a pior. */
  ordem: number[];
  jev_erro: string | null;
  custo_usd: number;
};

/**
 * Limpa, confere em código e pergunta ao Jev (uma chamada para todas as
 * variações). Devolve a conferência de cada uma e a ordem da melhor para a pior.
 */
export async function conferirCopies(p: PedidoDaConferencia): Promise<ResultadoDaConferencia> {
  const regras = p.voz ? p.voz.regras : regrasDaCasa();
  const limpos = p.textos.map((t) => limparCopy(t, p.canal, { regras, semHashtags: p.semHashtags, cortar: p.cortar }));
  const locais = limpos.map((l) => conferirCopy(l.texto, p.canal, regras));
  let notas: (NotaDoJev | null)[] = limpos.map(() => null);
  let jevErro: string | null = null;
  let custo = 0;
  const comTexto = limpos.filter((l) => l.texto).length;
  if (!p.semJev && comTexto) {
    try {
      const r = await (p.jev ?? jevPerguntar)({
        state: estadoDaConferencia(limpos.map((l) => l.texto), { canal: p.canal, objetivo: p.objetivo, marca: vozParaOJev(p.voz), oferta: p.oferta }),
        questions: perguntasDaConferencia(limpos.length) as Record<string, PerguntaJev>,
      });
      notas = lerConferencia(r.answers as never, limpos.length);
      const cobrado = await (p.cobrar ?? cobrarJev)(r, p.cobranca);
      custo = cobrado ? cobrado.custoUsd : 0;
    } catch (e) {
      jevErro = e instanceof JevErro ? e.codigo : "jev_falhou";
      registrarFalha("motor-de-copy: conferência do Jev falhou (vale a conferência em código)", e, { client_id: p.cobranca.clientId, canal: p.canal });
    }
  }
  const conferencias = limpos.map((l, i) => {
    const c = notaDaCopy(locais[i], notas[i], i, l.ajustes);
    if (jevErro && i === 0) c.avisos.push("O Jev não respondeu: a ordem saiu só pela conferência em código.");
    return c;
  });
  return { textos: limpos.map((l) => l.texto), conferencias, ordem: ranquear(conferencias).map((c) => c.indice), jev_erro: jevErro, custo_usd: custo };
}
