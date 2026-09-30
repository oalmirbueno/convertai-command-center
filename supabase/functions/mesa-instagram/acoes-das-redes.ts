/**
 * O agente das redes age (29/09: "tem que ser agêntico"). Antes ele só
 * respondia "não consigo editar pela API; copie e cole no app" a cada pedido
 * (Acerbi, 28/09, 7 vezes seguidas). O Instagram não deixa editar bio nem
 * destaques pela API, mas o painel faz a parte dele:
 *
 * - ordenar_grade (sem custo, vai direto, com Desfazer): a ordem dos próximos
 *   posts na grade planejada. O modelo devolve os apelidos p1..pN na ordem
 *   nova; o código confere (sem repetido, sem apelido inventado) e completa
 *   com os que ficaram de fora, na ordem de antes.
 * - gerar_capa (com custo, pede Confirmar): uma capa por destaque proposto,
 *   nas cores do kit (trava da marca), um por vez com andamento e Parar. O
 *   Desfazer arquiva as capas geradas.
 * - analisar_bio (centavos, pede Confirmar): o Jev julga a bio e o
 *   estrategista sugere bio e nome, no bloco Bio da aba.
 *
 * Contrato comum em ../_shared/acoes-do-agente.ts. Puro: o Vitest lê.
 */
import { type AcaoDoAgente, type ItemDaAcaoDoAgente, TIPO_DA_ACAO } from "../_shared/acoes-do-agente.ts";
import type { CorDaPaleta, DestaqueProposto } from "./modulos/conhecimento-perfil-instagram.ts";

/** Medido em ia_usos (29/09): capa de destaque em qualidade baixa, US$ 0,007. */
export const CUSTO_DA_CAPA_USD = 0.007;
/** Jev da bio mais uma chamada curta do estrategista. */
export const CUSTO_DA_ANALISE_DA_BIO_USD = 0.004;

export const REGRAS_DAS_REDES = {
  ordenar_grade: { direta: true },
  gerar_capa: {},
  analisar_bio: {},
} as const;

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

export type PostDaGrade = { id: string; titulo: string; data: string | null };

/** Os posts da grade com apelido p1..pN (o modelo nunca vê o id). */
export function gradeComApelido(grade: PostDaGrade[], ordemAtual: string[] = [], max = 40): Array<PostDaGrade & { ref: string }> {
  const pos = new Map(ordemAtual.map((id, i) => [id, i]));
  const ordenada = grade.slice().sort((a, b) => {
    const pa = pos.has(a.id) ? (pos.get(a.id) as number) : 1e6;
    const pb = pos.has(b.id) ? (pos.get(b.id) as number) : 1e6;
    return pa - pb;
  });
  return ordenada.slice(0, max).map((p, i) => ({ ...p, ref: `p${i + 1}` }));
}

/** Bloco do prompt com a grade e a regra das ações das redes. */
export function blocoDasAcoesDasRedes(grade: Array<PostDaGrade & { ref: string }>): string {
  const linhas = grade.map((p) => `${p.ref} | ${umaLinha(p.titulo || "sem título", 90)}${p.data ? ` | ${p.data}` : ""}`);
  return [
    grade.length ? `GRADE PLANEJADA NA ORDEM DE HOJE (apelido | título | data):\n${linhas.join("\n")}` : "GRADE PLANEJADA: vazia.",
    `AÇÕES QUE VOCÊ FAZ (o painel executa; nunca diga só "copie e cole" quando uma delas resolve):
- ordem_da_grade: quando pedirem para organizar, reordenar ou encaixar a grade, a lista COMPLETA de apelidos p# na ordem nova (o primeiro é o próximo a sair). Sem pedido, null. Sem custo: o painel já faz, com Desfazer.
- gerar_capas: true quando pedirem para criar, gerar ou fazer as capas (ícones) dos destaques que você propõe nesta resposta. Com custo: o painel mostra o valor e pede Confirmar. Senão false.
- analisar_bio: true quando pedirem para revisar, melhorar ou sugerir bio ou nome do perfil. Com custo de centavos: pede Confirmar. Senão false.
O que a API do Instagram não deixa (trocar a bio, criar o destaque no app): a equipe copia do painel; diga isso em no máximo uma frase, e só quando for o caso.`,
  ].join("\n\n");
}

/** Propriedades do JSON Schema para a resposta do agente das redes. */
export const PROPRIEDADES_DAS_ACOES_DAS_REDES = {
  ordem_da_grade: { type: ["array", "null"], items: { type: "string" } },
  gerar_capas: { type: "boolean" },
  analisar_bio: { type: "boolean" },
} as const;

/** A ordem nova da grade conferida: ids na ordem, sem repetido; os esquecidos vão no fim, na ordem de antes. Null quando nada muda. */
export function ordemConferida(bruto: unknown, grade: Array<PostDaGrade & { ref: string }>): { ids: string[]; ignorados: string[] } | null {
  if (!Array.isArray(bruto) || !bruto.length || !grade.length) return null;
  const porRef = new Map(grade.map((p) => [p.ref.toLowerCase(), p]));
  const ids: string[] = [];
  const ignorados: string[] = [];
  for (const b of bruto) {
    const ref = umaLinha(b, 12).toLowerCase();
    const p = porRef.get(ref);
    if (!p || ids.indexOf(p.id) >= 0) {
      if (ref) ignorados.push(ref);
      continue;
    }
    ids.push(p.id);
  }
  if (!ids.length) return null;
  for (const p of grade) if (ids.indexOf(p.id) < 0) ids.push(p.id);
  const antes = grade.map((p) => p.id);
  if (ids.join(",") === antes.join(",")) return null;
  return { ids, ignorados };
}

/** A ação de reordenar (um item só, com a ordem nova em `para`). */
export function acaoDaOrdem(conferida: { ids: string[]; ignorados: string[] }, grade: Array<PostDaGrade & { ref: string }>, id?: string): AcaoDoAgente {
  const titulo = new Map(grade.map((p) => [p.id, p.titulo]));
  const primeiros = conferida.ids.slice(0, 3).map((x) => umaLinha(titulo.get(x) || "post", 40)).join(", ");
  return {
    tipo: TIPO_DA_ACAO,
    agente: "redes",
    id: id || `redes-ordem-${Date.now().toString(36)}`,
    resumo: `Reordenar a grade: ${conferida.ids.length} posts, começando por ${primeiros}.`,
    itens: [{ ref: "o1", alvo_id: "grade", titulo: "Ordem da grade planejada", detalhe: `${conferida.ids.length} posts`, operacao: "ordenar_grade", rotulo: "reordenar", para: conferida.ids.join(","), para_rotulo: `começa por ${primeiros}` }],
    ignorados: conferida.ignorados,
    recusados: [],
  };
}

/** Cores da capa: fundo (papel "fundo" ou a primeira) e desenho (a primária que não é o fundo). Sempre do kit. */
export function estiloPadraoDaCapa(paleta: CorDaPaleta[]): { fundo: string; desenho: string; traco: "linha" } | null {
  if (!paleta.length) return null;
  const fundo = (paleta.find((c) => /fundo|background|claro/i.test(String(c.papel || ""))) || paleta[0]).hex;
  const desenho = (paleta.find((c) => c.hex !== fundo && /primaria|principal|destaque/i.test(String(c.papel || ""))) || paleta.find((c) => c.hex !== fundo) || paleta[0]).hex;
  return { fundo, desenho, traco: "linha" };
}

/** A ação de gerar as capas dos destaques propostos (com custo; o Desfazer arquiva). */
export function acaoDasCapas(destaques: DestaqueProposto[], paleta: CorDaPaleta[], id?: string): AcaoDoAgente | null {
  if (!destaques.length) return null;
  const estilo = estiloPadraoDaCapa(paleta);
  const itens: ItemDaAcaoDoAgente[] = destaques.map((d, i) => ({
    ref: `d${i + 1}`,
    alvo_id: d.nome,
    titulo: d.nome,
    detalhe: umaLinha(d.conceito || d.icone, 140) || null,
    operacao: "gerar_capa",
    rotulo: "gerar a capa de",
    para: null,
  }));
  const acao: AcaoDoAgente = {
    tipo: TIPO_DA_ACAO,
    agente: "redes",
    id: id || `redes-capas-${Date.now().toString(36)}`,
    resumo: estilo
      ? `Gerar ${destaques.length} ${destaques.length === 1 ? "capa" : "capas"} de destaque nas cores do kit (fundo ${estilo.fundo}, desenho ${estilo.desenho}).`
      : "O kit ainda não tem cores: defina a paleta em Contexto antes de gerar as capas.",
    itens: estilo ? itens : [],
    ignorados: [],
    recusados: estilo ? [] : itens.map((i) => ({ ref: i.ref, titulo: i.titulo, operacao: i.operacao, motivo: "sem cores no kit (trava da marca)" })),
    contexto: { destaques, estilo },
    custo_estimado_usd: estilo ? Math.round(destaques.length * CUSTO_DA_CAPA_USD * 1000) / 1000 : 0,
  };
  return acao;
}

/** A ação de analisar a bio e sugerir bio e nome (centavos, sem nada a desfazer). */
export function acaoDaBio(username: string | null, id?: string): AcaoDoAgente {
  return {
    tipo: TIPO_DA_ACAO,
    agente: "redes",
    id: id || `redes-bio-${Date.now().toString(36)}`,
    resumo: `Analisar a bio${username ? ` de @${username}` : ""} e sugerir bio e nome (fica no bloco Bio para copiar).`,
    itens: [{ ref: "b1", alvo_id: "bio", titulo: "Bio e nome do perfil", detalhe: username ? `@${username}` : null, operacao: "analisar_bio", rotulo: "analisar", para: null }],
    ignorados: [],
    recusados: [],
    sem_desfazer: true,
    custo_estimado_usd: CUSTO_DA_ANALISE_DA_BIO_USD,
  };
}
