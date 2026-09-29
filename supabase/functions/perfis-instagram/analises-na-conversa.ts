/**
 * O agente do perfil faz pela conversa o que antes só os botões faziam
 * (29/09: "todos agênticos"): ler os posts, comparar com o cliente, gerar o
 * plano igual ao perfil e ideias de resposta. Cada uma usa IA, então vira um
 * cartão com o custo e o Confirmar; ao confirmar, a análise roda e o
 * resultado entra na conversa logo abaixo (o plano e as ideias chegam com o
 * cartão de agendar, que já existia).
 *
 * Puro: o Vitest lê este arquivo.
 */
import { type AcaoDoAgente, TIPO_DA_ACAO } from "../_shared/acoes-do-agente.ts";

export const ANALISES_DO_PERFIL = ["ler_posts", "comparar", "gerar_ideias", "plano_igual"] as const;
export type AnaliseDoPerfil = (typeof ANALISES_DO_PERFIL)[number];

/** Custo aproximado (medido em ia_usos, 29/09): uma chamada de texto, ideias com o Jev, leitura de até 12 imagens. */
export const CUSTO_DA_ANALISE_USD: Record<AnaliseDoPerfil, number> = {
  ler_posts: 0.06,
  comparar: 0.005,
  gerar_ideias: 0.015,
  plano_igual: 0.02,
};

const ROTULO: Record<AnaliseDoPerfil, { titulo: string; rotulo: string; resumo: string }> = {
  ler_posts: { titulo: "Ler os posts capturados", rotulo: "ler", resumo: "Ler os posts do perfil (até 12 por vez) e atualizar o resumo." },
  comparar: { titulo: "Comparar com o cliente", rotulo: "comparar", resumo: "Comparar este perfil com o cliente (números, formatos e o que funciona)." },
  gerar_ideias: { titulo: "Ideias de resposta", rotulo: "gerar", resumo: "Gerar ideias de conteúdo em resposta a este perfil, prontas para a agenda." },
  plano_igual: { titulo: "Plano igual ao perfil", rotulo: "gerar", resumo: "Gerar o plano do mês no ritmo e nos formatos deste perfil, adaptado ao cliente." },
};

/** Propriedade do JSON Schema: a análise que o pedido manda fazer (ou nenhuma). */
export const PROPRIEDADE_DA_ANALISE = { executar: { type: "string", enum: [...ANALISES_DO_PERFIL, "nenhuma"] } } as const;

export const REGRA_DA_ANALISE_NO_PROMPT = `- executar: quando a equipe pedir para LER os posts (ler_posts), COMPARAR com o cliente (comparar), gerar IDEIAS de resposta (gerar_ideias) ou um PLANO igual ao perfil (plano_igual), escolha a análise; o painel mostra o custo e roda depois do Confirmar, e o resultado entra na conversa. Senão, nenhuma. Não escreva a análise na resposta: diga em uma frase o que vai rodar.`;

export function analiseDoModelo(v: unknown): AnaliseDoPerfil | null {
  return (ANALISES_DO_PERFIL as readonly string[]).indexOf(String(v)) >= 0 ? (v as AnaliseDoPerfil) : null;
}

/** O cartão da análise pedida (um item, com custo; nada a desfazer: só lê e escreve na conversa). */
export function acaoDaAnalise(analise: AnaliseDoPerfil, perfil: { id: string; handle: string }, opcoes: { mes?: string | null; pedido?: string | null; id?: string } = {}): AcaoDoAgente {
  const r = ROTULO[analise];
  return {
    tipo: TIPO_DA_ACAO,
    agente: "perfis",
    id: opcoes.id || `perfis-${analise}-${Date.now().toString(36)}`,
    resumo: `${r.resumo} Perfil @${perfil.handle}.`,
    itens: [{ ref: "a1", alvo_id: perfil.id, titulo: r.titulo, detalhe: `@${perfil.handle}`, operacao: analise, rotulo: r.rotulo, para: null }],
    ignorados: [],
    recusados: [],
    contexto: { perfil_id: perfil.id, handle: perfil.handle, ...(opcoes.mes ? { mes: opcoes.mes } : {}), ...(opcoes.pedido ? { pedido: String(opcoes.pedido).slice(0, 800) } : {}) },
    sem_desfazer: true,
    custo_estimado_usd: CUSTO_DA_ANALISE_USD[analise],
  };
}
