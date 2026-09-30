/**
 * Ações que o estrategista comercial da Mesa Proposta propõe (contrato comum
 * em ../_shared/acoes-do-agente.ts: apelido em vez de UUID, cartão
 * Confirmar/Cancelar com o custo antes, item a item, Desfazer, aprendizado).
 *
 * Alvos: a proposta aberta (p1), os blocos (b1..b12, na ordem da página) e os
 * itens do investimento (i1..).
 *
 * Sem custo e com Desfazer (pedido claro vai direto, regra 6):
 * - trocar_headline (b1, a capa)      para = a headline nova
 * - ocultar_bloco / mostrar_bloco (b) para vazio
 * - definir_validade (p1)             para = AAAA-MM-DD
 * - adicionar_item (p1, repete)       para = "nome | valor | unico ou mensal | quantidade"
 * - remover_item (i)                  para vazio
 * Com IA (Confirmar e custo antes):
 * - gerar_proposta (p1)     escreve os blocos com o contexto e a pesquisa de mercado
 * - pesquisar_mercado (p1)  refaz só o mercado, com busca na web (fonte e data)
 * - reescrever_bloco (b)    reescreve um bloco pela orientação
 * - resumir_reuniao (p1)    resume a transcrição colada nas notas (frente PRO2)
 * Com o Jev (Confirmar e custo antes, frente PRO2):
 * - montar_pacotes (p1)     monta Essencial, Recomendado e Completo com a biblioteca
 * Sem custo, mas mexe em preço (Confirmar, com Desfazer, frente PRO2):
 * - ajustar_margem (p1)     para = a margem em %, pela calculadora de hora técnica
 *
 * Regra do preço: o valor de um item só entra se estiver escrito no pedido da
 * equipe (o agente não inventa preço). Enviar ao cliente não é ação do agente:
 * é o Confirmar da etapa Envio.
 *
 * Sem import de Deno: o Vitest lê este arquivo.
 */
import {
  type AcaoDoAgente,
  type AlvoComApelido,
  blocoDosAlvos,
  type CaminhoDoAgente,
  comApelido,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import { caminhoNaArea } from "../_shared/mapa-do-painel.ts";
import { type Bloco, blocoVazio, diaValido, type ItemDaProposta, lerValor, numeroTemOrigem, reais, ROTULO_DO_BLOCO, textoLimpo } from "../_shared/proposta-modelo.ts";
import { lerMargem } from "../_shared/proposta-comercial.ts";

export const OPERACOES_DA_PROPOSTA = [
  "trocar_headline",
  "ocultar_bloco",
  "mostrar_bloco",
  "definir_validade",
  "adicionar_item",
  "remover_item",
  "gerar_proposta",
  "pesquisar_mercado",
  "reescrever_bloco",
  "montar_pacotes",
  "ajustar_margem",
  "resumir_reuniao",
];
/** Operações que chamam o modelo (custam IA). */
export const OPERACOES_COM_IA = ["gerar_proposta", "pesquisar_mercado", "reescrever_bloco", "resumir_reuniao", "montar_pacotes"];

export const ESQUEMA_DAS_ACOES_DA_PROPOSTA = esquemaDasAcoes(OPERACOES_DA_PROPOSTA);

type AlvoDaProposta = { id: string; titulo: string; detalhe?: string | null; dados?: Record<string, unknown> };

export type PropostaParaAcao = { id: string; titulo: string; numero: string; status: string; validade_ate: string | null; blocos: Bloco[]; itens: ItemDaProposta[] };

export function alvosDaProposta(p: PropostaParaAcao): Array<AlvoComApelido<AlvoDaProposta>> {
  const proposta = comApelido([{ id: p.id, titulo: `Proposta ${p.numero}: ${p.titulo}`, detalhe: `${p.status}${p.validade_ate ? `, válida até ${p.validade_ate}` : ""}`, dados: { status: p.status } }], "p");
  const blocos = comApelido(
    // PRO3: "O que você já tem" só entra na lista quando existe (upsell); nas outras, os apelidos ficam como antes.
    p.blocos.filter((b) => b.tipo !== "ja_tem" || !blocoVazio(b)).map((b) => ({ id: `${p.id}:${b.tipo}`, titulo: `${ROTULO_DO_BLOCO[b.tipo]}${b.titulo !== ROTULO_DO_BLOCO[b.tipo] ? ` (${b.titulo})` : ""}`, detalhe: b.visivel ? "visível" : "oculto", dados: { tipo: b.tipo, visivel: b.visivel, status: p.status } })),
    "b",
  );
  const itens = comApelido(
    p.itens.map((i) => ({ id: `${p.id}:item:${i.id}`, titulo: i.nome, detalhe: `${i.quantidade} x ${reais(i.valor_unitario)} ${i.recorrencia === "mensal" ? "por mês" : "único"}`, dados: { status: p.status } })),
    "i",
  );
  return [...proposta, ...blocos, ...itens];
}

/** Id do alvo de bloco: "<proposta>:<tipo>". */
export function lerAlvoDoBloco(alvoId: unknown): { propostaId: string; tipo: string } | null {
  const s = String(alvoId || "");
  const m = /^([0-9a-f-]{36}):([a-z_]+)$/i.exec(s);
  return m ? { propostaId: m[1], tipo: m[2] } : null;
}

/** Id do alvo de item: "<proposta>:item:<id do item>". */
export function lerAlvoDoItem(alvoId: unknown): { propostaId: string; itemId: string } | null {
  const s = String(alvoId || "");
  const m = /^([0-9a-f-]{36}):item:(.+)$/i.exec(s);
  return m ? { propostaId: m[1], itemId: m[2] } : null;
}

/** "Site institucional | 4.500 | unico | 1" -> item (sem valor válido: null). */
export function lerItemPedido(bruto: unknown): { nome: string; valor: number; recorrencia: "unico" | "mensal"; quantidade: number; valorEscrito: string } | null {
  const partes = String(bruto == null ? "" : bruto).split("|").map((x) => x.trim());
  const nome = textoLimpo(partes[0], 120);
  const valorEscrito = partes[1] || "";
  const valor = lerValor(valorEscrito);
  if (!nome || valor === null || valor <= 0) return null;
  const rec = (partes[2] || "").toLowerCase();
  const q = Math.round(Number(partes[3] || 1));
  return { nome, valor, recorrencia: /mens|m[eê]s/.test(rec) ? "mensal" : "unico", quantidade: q >= 1 && q <= 999 ? q : 1, valorEscrito };
}

/** O valor do item foi dito no pedido da equipe? (o agente não inventa preço) */
export function valorCitadoNoPedido(valorEscrito: string, pedido: string): boolean {
  if (!valorEscrito) return false;
  if (numeroTemOrigem(valorEscrito, pedido)) return true;
  // "4,5 mil" no pedido e 4500 no item (ou o contrário): compara o valor lido.
  const alvo = lerValor(valorEscrito);
  const candidatos = String(pedido || "").toLowerCase().match(/(r\$\s*)?\d+([.,]\d+)*(\s*(mil|k))?/g) || [];
  return alvo !== null && candidatos.some((c) => lerValor(c) === alvo);
}

const travaDoStatus = (alvo: AlvoComApelido<AlvoDaProposta>) => {
  const s = alvo.dados ? alvo.dados.status : null;
  if (s === "aceita") return "Proposta aceita não muda. Crie uma nova.";
  return null;
};

export function regrasDaProposta(): Record<string, RegraDaOperacao<AlvoDaProposta>> {
  return {
    trocar_headline: {
      rotulo: "trocar a headline da",
      alvos: ["b"],
      direta: true,
      para: (bruto) => {
        const t = textoLimpo(bruto, 160);
        return t.length >= 6 ? t : null;
      },
      trava: (alvo) => travaDoStatus(alvo) || (alvo.dados && alvo.dados.tipo !== "capa" ? "A headline mora na capa (b1)." : null),
    },
    ocultar_bloco: {
      rotulo: "ocultar o bloco",
      alvos: ["b"],
      direta: true,
      trava: (alvo) => travaDoStatus(alvo) || (alvo.dados && alvo.dados.visivel === false ? "Já está oculto." : alvo.dados && alvo.dados.tipo === "capa" ? "A capa não sai." : null),
    },
    mostrar_bloco: {
      rotulo: "mostrar o bloco",
      alvos: ["b"],
      direta: true,
      trava: (alvo) => travaDoStatus(alvo) || (alvo.dados && alvo.dados.visivel === true ? "Já está visível." : null),
    },
    definir_validade: {
      rotulo: "definir a validade da",
      alvos: ["p"],
      direta: true,
      para: (bruto) => diaValido(String(bruto || "").trim()),
      trava: (alvo) => travaDoStatus(alvo),
    },
    adicionar_item: {
      rotulo: "adicionar o item",
      alvos: ["p"],
      direta: true,
      repete: true,
      para: (bruto) => {
        const it = lerItemPedido(bruto);
        return it ? `${it.nome} | ${it.valorEscrito} | ${it.recorrencia} | ${it.quantidade}` : null;
      },
      trava: (alvo) => travaDoStatus(alvo),
    },
    remover_item: {
      rotulo: "remover o item",
      alvos: ["i"],
      direta: true,
      trava: (alvo) => travaDoStatus(alvo),
    },
    gerar_proposta: {
      rotulo: "escrever a proposta",
      alvos: ["p"],
      para: (bruto) => textoLimpo(bruto, 400) || "sem orientação extra",
      trava: (alvo) => travaDoStatus(alvo),
    },
    pesquisar_mercado: {
      rotulo: "pesquisar o mercado para a",
      alvos: ["p"],
      para: (bruto) => textoLimpo(bruto, 300) || "concorrentes e faixa de preço do nicho e da região",
      trava: (alvo) => travaDoStatus(alvo),
    },
    reescrever_bloco: {
      rotulo: "reescrever o bloco",
      alvos: ["b"],
      para: (bruto) => {
        const t = textoLimpo(bruto, 400);
        return t.length >= 3 ? t : null;
      },
      trava: (alvo) =>
        travaDoStatus(alvo) ||
        (alvo.dados && (alvo.dados.tipo === "provas" || alvo.dados.tipo === "quem_somos") ? "Provas e quem somos vêm dos dados da agência, não do agente." : null) ||
        // PRO3: o que o cliente já tem e os resultados vêm do painel ("Reler os dados de hoje"), nunca do agente.
        (alvo.dados && alvo.dados.tipo === "ja_tem" ? "O que o cliente já tem vem do painel: use Reler os dados de hoje." : null),
    },
    montar_pacotes: {
      rotulo: "montar os 3 pacotes da",
      // Combina com as outras na mesma proposta (ex.: resumir e depois montar os pacotes).
      combina: true,
      alvos: ["p"],
      para: (bruto) => textoLimpo(bruto, 300) || "sem orientação extra",
      trava: (alvo) => travaDoStatus(alvo),
    },
    // Sem custo, mas mexe em preço: sempre com Confirmar (sem "direta").
    ajustar_margem: {
      rotulo: "ajustar os preços pela margem na",
      // Combina com as outras na mesma proposta (ex.: resumir e depois montar os pacotes).
      combina: true,
      alvos: ["p"],
      para: (bruto) => {
        const m = lerMargem(bruto);
        return m === null ? null : String(m);
      },
      trava: (alvo) => travaDoStatus(alvo),
    },
    resumir_reuniao: {
      rotulo: "resumir a reunião nas notas da",
      // Combina com as outras na mesma proposta (ex.: resumir e depois montar os pacotes).
      combina: true,
      alvos: ["p"],
      trava: (alvo) => travaDoStatus(alvo),
    },
  };
}

export const DESCRICOES_DA_PROPOSTA: Record<string, string> = {
  trocar_headline: "troca a headline da capa (ref b1). para: a headline nova, de benefício, sem número inventado.",
  ocultar_bloco: "tira o bloco da página do cliente (ref b..). para vazio.",
  mostrar_bloco: "volta o bloco para a página (ref b..). para vazio.",
  definir_validade: "muda a validade (ref p1). para: a data AAAA-MM-DD.",
  adicionar_item: "adiciona um item ao investimento (ref p1, pode repetir). para: 'nome | valor | unico ou mensal | quantidade'. SÓ com o valor que a equipe escreveu no pedido; sem valor dito, pergunte.",
  remover_item: "remove um item do investimento (ref i..). para vazio.",
  gerar_proposta: "escreve a proposta inteira com o contexto, as notas, a transcrição, os arquivos e a pesquisa de mercado (ref p1). para: orientação extra ou vazio.",
  pesquisar_mercado: "refaz só o bloco de mercado com busca na web: concorrentes e faixa de preço do nicho e da região, cada número com fonte e data (ref p1). para: o foco da pesquisa.",
  reescrever_bloco: "reescreve um bloco pela orientação (ref b.., menos provas e quem somos). para: a orientação (ex.: 'mais direto, na voz do cliente').",
  montar_pacotes: "monta os 3 pacotes (Essencial, Recomendado e Completo) com os itens e a biblioteca de serviços da agência; o preço vem da biblioteca (ref p1). para: orientação extra ou vazio.",
  ajustar_margem: "recalcula o preço dos itens que têm horas pela calculadora de hora técnica para chegar na margem pedida (ref p1). para: a margem em %, SÓ a que a equipe disse (ex.: '35').",
  resumir_reuniao: "resume a transcrição e as notas coladas em notas organizadas (objetivo, dores, pedidos, prazos, falas, o que falta), embaixo das notas atuais (ref p1). para vazio.",
};

/** Bloco do prompt com os alvos (apelidos, nunca id) e a regra das ações. */
export function blocoDasAcoesDaProposta(p: PropostaParaAcao): string {
  const alvos = alvosDaProposta(p);
  const lista = (prefixo: string) => alvos.filter((a) => a.ref.charAt(0) === prefixo);
  return `${blocoDosAlvos("PROPOSTA ABERTA", lista("p"))}${blocoDosAlvos("BLOCOS DA PROPOSTA (na ordem da página)", lista("b"))}${blocoDosAlvos("ITENS DO INVESTIMENTO", lista("i"), "nenhum ainda.")}\n${regraDasAcoes(DESCRICOES_DA_PROPOSTA)}`;
}

/**
 * Lê as ações do modelo, troca apelido por alvo e aplica a regra do preço:
 * item com valor que não está no pedido vai para recusados, com o motivo.
 */
export function normalizarAcoesDaProposta(bruto: unknown, p: PropostaParaAcao, pedido: string, custoPorGeracaoUsd: number, custoDaPesquisaUsd: number, id?: string, custosDaPro2: { resumo?: number; pacotes?: number } = {}): AcaoDoAgente | null {
  const acao = normalizarAcaoDoAgente(bruto, alvosDaProposta(p), regrasDaProposta(), {
    agente: "proposta",
    id: id || `proposta-${Date.now().toString(36)}`,
    contexto: { proposta_id: p.id },
    rotuloDoPara: (operacao, para) => (operacao === "gerar_proposta" && para === "sem orientação extra" ? null : null),
  });
  if (!acao) return null;
  const ficam = [];
  for (const it of acao.itens) {
    if (it.operacao === "adicionar_item") {
      const lido = lerItemPedido(it.para);
      if (!lido || !valorCitadoNoPedido(lido.valorEscrito, pedido)) {
        acao.recusados.push({ ref: it.ref, titulo: lido ? lido.nome : it.titulo, operacao: it.operacao, motivo: "O valor não está no seu pedido. Diga o preço e eu adiciono." });
        continue;
      }
      it.para_rotulo = `${lido.nome}: ${lido.quantidade} x ${reais(lido.valor)} ${lido.recorrencia === "mensal" ? "por mês" : "único"}`;
    }
    // A margem é a da equipe: número que não está no pedido não vira preço.
    if (it.operacao === "ajustar_margem") {
      if (!numeroTemOrigem(String(it.para || ""), pedido)) {
        acao.recusados.push({ ref: it.ref, titulo: it.titulo, operacao: it.operacao, motivo: "A margem não está no seu pedido. Diga a margem em % e eu ajusto." });
        continue;
      }
      it.para_rotulo = `margem de ${it.para}%`;
    }
    ficam.push(it);
  }
  acao.itens = ficam;
  if (!acao.itens.length && !acao.recusados.length) return null;
  let custo = 0;
  for (const it of acao.itens) {
    if (it.operacao === "gerar_proposta") custo += custoPorGeracaoUsd + custoDaPesquisaUsd;
    else if (it.operacao === "pesquisar_mercado") custo += custoDaPesquisaUsd;
    else if (it.operacao === "reescrever_bloco") custo += custoPorGeracaoUsd / 3;
    else if (it.operacao === "resumir_reuniao") custo += custosDaPro2.resumo ?? custoPorGeracaoUsd / 3;
    else if (it.operacao === "montar_pacotes") custo += custosDaPro2.pacotes ?? 0.01;
  }
  acao.custo_estimado_usd = custo > 0 ? Math.round(custo * 1e6) / 1e6 : 0;
  return acao;
}

/** "Ir para" depois de feito: IA e blocos abrem o Rascunho; preço e validade, o Contexto. */
export function caminhoDaProposta(clientId: string, propostaId: string, acao: Pick<AcaoDoAgente, "itens">, opcoes: { abrirSozinho?: boolean } = {}): CaminhoDoAgente | null {
  const precoOuValidade = acao.itens.every((i) => ["adicionar_item", "remover_item", "definir_validade", "montar_pacotes", "ajustar_margem", "resumir_reuniao"].indexOf(i.operacao) >= 0);
  return caminhoNaArea("mesa_proposta", {
    clientId,
    etapa: precoOuValidade ? "contexto" : "rascunho",
    estado: { proposta: propostaId },
    rotulo: precoOuValidade ? "Ver o investimento" : "Ver a proposta",
    abrirSozinho: opcoes.abrirSozinho,
  });
}

/** A resposta promete fazer sem trazer a lista? */
export function respostaPromete(resposta: unknown): boolean {
  return /\b(vou|irei|vamos) (j[aá] )?(gerar|preparar|fazer|criar|escrever|reescrever|pesquisar|montar|ajustar|trocar|adicionar|incluir|mudar)\b/i.test(String(resposta == null ? "" : resposta));
}
