/**
 * Regras puras da função contratos (frente CON, 30/09/2026): a proposta
 * aceita vira contrato, o Jev escolhe os blocos a partir da explicação do
 * dono e as operações do agente (apelidos, Confirmar, Desfazer).
 *
 * Sem Supabase e sem Deno fora do Jev (que chega por parâmetro): roda no
 * vitest. Sem travessão.
 */
import {
  type AcaoDoAgente,
  type AlvoComApelido,
  blocoDosAlvos,
  comApelido,
  esquemaDasAcoes,
  type ItemDaAcaoDoAgente,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import {
  type ClausulaAlterada,
  type ClausulaMontada,
  DESCRICAO_DO_SERVICO,
  diffDeTexto,
  ehServico,
  lerMoeda,
  type ParteDoDiff,
  ROTULO_DO_SERVICO,
  SERVICOS_DO_CONTRATO,
  SERVICOS_RECORRENTES,
  type ServicoDoContrato,
  servicosEmOrdem,
  type Valores,
  valorInvalido,
  type VariavelDoModelo,
} from "../_shared/contrato-modelo.ts";
import type { PerguntaJev } from "../_shared/jev.ts";

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ serviço pelas palavras (reserva do Jev)

const PALAVRAS: Record<ServicoDoContrato, RegExp> = {
  social: /(instagram|redes? sociais|social media|gest[aã]o de (redes|perfil|conte[uú]do)|posts?|carross[eé]is|carrossel|stories|feed)/i,
  site: /(\bsite\b|landing|p[aá]gina de (vendas|captura|captacao|captação)|loja virtual|e-?commerce|wordpress|webflow)/i,
  marca: /(\bmarca\b|logo(tipo|marca)?|identidade visual|brandbook|manual da marca|papelaria)/i,
  naming: /(naming|criar (o )?nome|nome da (empresa|marca|loja)|batizar)/i,
  trafego: /(tr[aá]fego|an[uú]ncios?|meta ads|google ads|tiktok ads|campanhas? pagas?|gestor de tr[aá]fego)/i,
  video: /(v[ií]deos?|reels? roteirizad|motion|anima[cç][aã]o|capta[cç][aã]o|filmagem|edi[cç][aã]o de v[ií]deo)/i,
  design: /(folder|panfleto|flyer|banner|cart[aã]o de visita|card[aá]pio|embalagem|apresenta[cç][aã]o|pe[cç]a avulsa|design pontual)/i,
  mensalista: /(fee mensal|mensalista|pacote mensal de (design|pe[cç]as|horas)|banco de horas|horas de cria[cç][aã]o)/i,
};

/** Serviços citados com as palavras de sempre (reserva sem IA; o Jev decide quando está no ar). */
export function servicosPorPalavras(texto: string): ServicoDoContrato[] {
  const t = String(texto || "");
  return SERVICOS_DO_CONTRATO.filter((s) => PALAVRAS[s].test(t));
}

// ------------------------------------------------------------------ Jev: blocos, direitos e mudança de cláusula

export const LIMIAR_DO_BLOCO = 0.6;
export const LIMIAR_DO_INCERTO = 0.35;
export const LIMIAR_DA_CLAUSULA = 0.6;

type RespostaDoJev = { choice?: string; confidence?: number; noul?: number };

/** As perguntas ao Jev sobre o pedido do dono (todas juntas, em paralelo, numa chamada). */
export function perguntasDoPedido(opcoes: { comContrato: boolean }): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  for (const s of SERVICOS_DO_CONTRATO) {
    q[`servico_${s}`] = {
      type: "noul",
      instructions: `O \`pedido\` do dono da agência descreve um serviço que o cliente está contratando e que se encaixa em: ${DESCRICAO_DO_SERVICO[s]}? Só o que é contratado agora; o que é citado como exemplo, recusado ou excluído não conta.`,
      criteria: { true: "o pedido inclui este serviço no que o cliente contrata", false: "o pedido não inclui este serviço, ou só o cita sem contratar" },
    };
  }
  q.direitos = {
    type: "choice",
    instructions: "O `pedido` diz qual regra de direitos autorais o dono quer para as entregas?",
    criteria: {
      cessao: "o cliente fica dono das entregas, ou pede cessão ou transferência dos direitos",
      licenca: "a agência continua dona e o cliente só usa (licença de uso)",
      nao_diz: "o pedido não fala de direitos autorais ou de quem fica dono das entregas",
    },
  };
  if (opcoes.comContrato) {
    q.muda_clausula = {
      type: "noul",
      instructions: "O `pedido` pede para mudar o TEXTO de uma regra do contrato (acrescentar, tirar ou reescrever uma cláusula), e não só preencher dados como valor, prazo, nome, quantidade ou escolher uma opção que já existe?",
      criteria: { true: "pede para reescrever, acrescentar ou tirar uma regra do texto", false: "só preenche dados, escolhe opções, pergunta ou comenta" },
    };
  }
  return q;
}

export type JulgamentoDoPedido = {
  escolhidos: ServicoDoContrato[];
  incertos: ServicoDoContrato[];
  direitos: "cessao" | "licenca" | null;
  mudaClausula: boolean | null;
  fonte: "jev" | "palavras";
};

export function lerJulgamentoDoPedido(answers: Record<string, RespostaDoJev> | null | undefined, texto: string): JulgamentoDoPedido {
  if (!answers) return { escolhidos: servicosPorPalavras(texto), incertos: [], direitos: null, mudaClausula: null, fonte: "palavras" };
  const escolhidos: ServicoDoContrato[] = [];
  const incertos: ServicoDoContrato[] = [];
  for (const s of SERVICOS_DO_CONTRATO) {
    const p = answers[`servico_${s}`] && typeof answers[`servico_${s}`].noul === "number" ? Number(answers[`servico_${s}`].noul) : null;
    if (p === null) continue;
    if (p >= LIMIAR_DO_BLOCO) escolhidos.push(s);
    else if (p >= LIMIAR_DO_INCERTO) incertos.push(s);
  }
  const d = answers.direitos;
  const direitos = d && (d.choice === "cessao" || d.choice === "licenca") && (typeof d.confidence !== "number" || d.confidence >= 0.6) ? d.choice : null;
  const m = answers.muda_clausula && typeof answers.muda_clausula.noul === "number" ? answers.muda_clausula.noul >= LIMIAR_DA_CLAUSULA : null;
  return { escolhidos, incertos, direitos, mudaClausula: m, fonte: "jev" };
}

/** Pergunta curta para os serviços incertos ("Inclui também Vídeo e motion?"). */
export function perguntaDosIncertos(incertos: ServicoDoContrato[]): string {
  if (!incertos.length) return "";
  const nomes = incertos.map((s) => ROTULO_DO_SERVICO[s]);
  return `Inclui também ${nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`}?`;
}

// ------------------------------------------------------------------ proposta aceita (frente PRO) vira contrato

export type PropostaParaContrato = {
  id: string;
  clientId: string | null;
  numero: string | null;
  titulo: string | null;
  aceita: boolean;
  aceitaEm: string | null;
  itensTexto: string;
  valorTotal: number | null;
  valorMensal: number | null;
  condicoes: string | null;
  inicio: string | null;
};

const primeiro = (o: Record<string, unknown>, nomes: string[]) => {
  for (const n of nomes) if (o[n] !== undefined && o[n] !== null && o[n] !== "") return o[n];
  return null;
};

/**
 * Lê a proposta da frente PRO sem depender do nome exato das colunas, e o
 * evento "aceita" de proposta_eventos (tipo, evento ou status = aceita).
 */
export function mapearProposta(bruto: unknown, eventos: unknown[]): PropostaParaContrato | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const id = txt(o.id);
  if (!id) return null;
  const aceiteNoEvento = (Array.isArray(eventos) ? eventos : []).find((e) => {
    if (!e || typeof e !== "object") return false;
    const x = e as Record<string, unknown>;
    return [x.tipo, x.evento, x.status, x.acao].some((v) => txt(v).toLowerCase() === "aceita");
  }) as Record<string, unknown> | undefined;
  const aceitaNaLinha = ["aceita", "aceito", "aprovada"].indexOf(txt(o.status).toLowerCase()) >= 0;
  const itens = primeiro(o, ["itens", "servicos", "escopo", "blocos", "pacotes"]);
  let itensTexto = "";
  if (Array.isArray(itens)) {
    itensTexto = itens.map((i) => {
      if (i && typeof i === "object") {
        const r = i as Record<string, unknown>;
        return [r.servico, r.nome, r.titulo, r.tipo, r.descricao, r.quantidade].map(txt).filter(Boolean).join(" ");
      }
      return txt(i);
    }).filter(Boolean).join("; ");
  } else if (itens && typeof itens === "object") itensTexto = JSON.stringify(itens).slice(0, 3000);
  else itensTexto = txt(itens);
  const valor = (nomes: string[]) => {
    const v = primeiro(o, nomes);
    if (typeof v === "number") return isFinite(v) ? v : null;
    return v === null ? null : lerMoeda(v);
  };
  return {
    id,
    clientId: txt(primeiro(o, ["client_id", "cliente_id"])) || null,
    numero: txt(primeiro(o, ["numero", "codigo", "numero_proposta"])) || null,
    titulo: txt(primeiro(o, ["titulo", "nome", "title"])) || null,
    aceita: !!aceiteNoEvento || aceitaNaLinha,
    aceitaEm: txt(aceiteNoEvento ? primeiro(aceiteNoEvento, ["criado_em", "created_at", "em"]) : primeiro(o, ["aceita_em", "aprovada_em"])) || null,
    itensTexto: [txt(primeiro(o, ["titulo", "nome"])), itensTexto, txt(primeiro(o, ["resumo", "descricao"]))].filter(Boolean).join(". ").slice(0, 4000),
    valorTotal: valor(["valor_total", "total", "valor", "investimento"]),
    valorMensal: valor(["valor_mensal", "mensalidade", "fee_mensal"]),
    condicoes: txt(primeiro(o, ["condicoes_pagamento", "condicoes", "forma_pagamento", "pagamento"])) || null,
    inicio: txt(primeiro(o, ["inicio", "data_inicio", "inicio_previsto"])) || null,
  };
}

/** Valores do contrato que vêm da proposta (valor, condições, número, início). */
export function valoresDaProposta(p: PropostaParaContrato, servicos: ServicoDoContrato[]): Valores {
  const v: Valores = {};
  const recorrente = servicos.some((s) => SERVICOS_RECORRENTES.indexOf(s) >= 0);
  const projeto = servicos.some((s) => SERVICOS_RECORRENTES.indexOf(s) < 0);
  if (p.numero) v.proposta_numero = p.numero;
  if (projeto && p.valorTotal !== null) v.valor_total = String(p.valorTotal);
  if (recorrente && p.valorMensal !== null) v.valor_mensal = String(p.valorMensal);
  if (recorrente && !projeto && p.valorMensal === null && p.valorTotal !== null) v.valor_mensal = String(p.valorTotal);
  if (p.condicoes && projeto) v.condicoes_pagamento = p.condicoes;
  if (p.inicio && /^\d{4}-\d{2}-\d{2}/.test(p.inicio)) v.inicio = p.inicio.slice(0, 10);
  return v;
}

// ------------------------------------------------------------------ operações do agente

export type AlvoDoContrato = { id: string; titulo: string; detalhe?: string | null; dados?: Record<string, unknown> };

export const OPERACOES_DO_AGENTE = ["criar_contrato", "incluir_servico", "retirar_servico", "preencher", "alterar_clausula", "restaurar_clausula"] as const;

/** Lê "social, site" ou "Social e Instagram; Sites" como lista de serviços. */
export function lerServicos(bruto: unknown): ServicoDoContrato[] {
  const t = String(bruto == null ? "" : bruto).toLowerCase();
  const diretos = t.split(/[^a-z_]+/).filter(ehServico) as ServicoDoContrato[];
  return servicosEmOrdem(diretos.concat(servicosPorPalavras(t)));
}

/** Valor pedido para uma variável, já no formato guardado (escolha pelo rótulo, número limpo). Null: inválido. */
export function valorPedido(v: VariavelDoModelo, bruto: unknown): string | null {
  const s = txt(bruto);
  if (!s) return null;
  if (v.tipo === "escolha") {
    const o = (v.opcoes || []).find((x) => x.valor === s || x.rotulo.toLowerCase() === s.toLowerCase());
    return o ? o.valor : null;
  }
  if (v.tipo === "moeda") {
    const n = lerMoeda(s);
    return n === null ? null : String(n);
  }
  return valorInvalido(v, s) ? null : s;
}

export type ContextoDasRegras = {
  /** Faltam dados da agência (rótulos): criar contrato fica recusado com o motivo. */
  agenciaFaltando: string[];
  /** O contrato aberto é rascunho? Fora do rascunho nada muda (versão nova pela tela). */
  rascunho: boolean;
  variaveis: Record<string, VariavelDoModelo>;
  servicosAtuais: ServicoDoContrato[];
  clausulas: Record<string, { atual: string; modelo: string }>;
};

export function regrasDasOperacoes(ctx: ContextoDasRegras): Record<string, RegraDaOperacao<AlvoDoContrato>> {
  const soRascunho = () => (ctx.rascunho ? null : "O contrato aberto não é mais rascunho: crie uma versão nova pela tela.");
  return {
    criar_contrato: {
      rotulo: "criar o rascunho do contrato",
      alvos: ["n"],
      direta: true,
      para: (b) => {
        const s = lerServicos(b);
        return s.length ? s.join(",") : null;
      },
      trava: () => (ctx.agenciaFaltando.length ? `Faltam os dados da agência: ${ctx.agenciaFaltando.join(", ")}. Preencha em Configurações antes de gerar contrato.` : null),
    },
    incluir_servico: {
      rotulo: "incluir o serviço",
      alvos: ["s"],
      direta: true,
      trava: (a) => soRascunho() || (ctx.servicosAtuais.indexOf(String(a.dados && a.dados.servico) as ServicoDoContrato) >= 0 ? "Este serviço já está no contrato." : null),
    },
    retirar_servico: {
      rotulo: "retirar o serviço",
      alvos: ["s"],
      direta: true,
      trava: (a) => soRascunho() || (ctx.servicosAtuais.indexOf(String(a.dados && a.dados.servico) as ServicoDoContrato) < 0 ? "Este serviço não está no contrato." : ctx.servicosAtuais.length <= 1 ? "O contrato precisa de pelo menos um serviço." : null),
    },
    preencher: {
      rotulo: "preencher",
      alvos: ["v"],
      direta: true,
      repete: false,
      para: (b, a) => {
        const v = ctx.variaveis[String(a.dados && a.dados.nome)];
        return v ? valorPedido(v, b) : null;
      },
      trava: () => soRascunho(),
    },
    // Reescrever cláusula NUNCA vai direto: o cartão mostra a diferença, pede Confirmar e tem Desfazer.
    alterar_clausula: {
      rotulo: "reescrever a cláusula",
      alvos: ["k"],
      para: (b) => {
        const t = String(b == null ? "" : b).trim();
        return t.length >= 10 && t.length <= 6000 ? t : null;
      },
      trava: (a, para) => soRascunho() || (ctx.clausulas[String(a.dados && a.dados.chave)] && ctx.clausulas[String(a.dados && a.dados.chave)].atual.trim() === String(para).trim() ? "O texto pedido é igual ao atual." : null),
    },
    restaurar_clausula: {
      rotulo: "voltar a cláusula ao texto do modelo",
      alvos: ["k"],
      direta: true,
      trava: (a) => soRascunho() || (ctx.clausulas[String(a.dados && a.dados.chave)] && ctx.clausulas[String(a.dados && a.dados.chave)].atual === ctx.clausulas[String(a.dados && a.dados.chave)].modelo ? "A cláusula já está no texto do modelo." : null),
    },
  };
}

export const DESCRICOES_DAS_OPERACOES: Record<(typeof OPERACOES_DO_AGENTE)[number], string> = {
  criar_contrato: "ref n1; para = serviços separados por vírgula (social, site, marca, naming, trafego, video, design, mensalista). Cria o rascunho para o cliente aberto",
  incluir_servico: "ref s#; inclui o bloco do serviço no contrato aberto",
  retirar_servico: "ref s#; tira o bloco do serviço do contrato aberto",
  preencher: "ref v#; para = o valor (moeda em número, data AAAA-MM-DD, escolha pelo rótulo). Só com valor dito pelo dono ou pelos DADOS; nunca invente",
  alterar_clausula: "ref k#; para = o texto NOVO inteiro da cláusula, mantendo as {{variáveis}} que continuam valendo. Só quando o dono pedir para mudar a regra; a equipe vê a diferença e confirma",
  restaurar_clausula: "ref k#; volta a cláusula alterada ao texto do modelo",
};

export const ESQUEMA_DAS_ACOES_DOS_CONTRATOS = esquemaDasAcoes(OPERACOES_DO_AGENTE as unknown as string[]);

export type AlvosDoAgente = {
  novo: Array<AlvoComApelido<AlvoDoContrato>>;
  servicos: Array<AlvoComApelido<AlvoDoContrato>>;
  variaveis: Array<AlvoComApelido<AlvoDoContrato>>;
  clausulas: Array<AlvoComApelido<AlvoDoContrato>>;
};

/** Apelidos: n1 (novo contrato), s1..s8 (serviços), v1.. (variáveis do aberto), k1.. (cláusulas do aberto). O id nunca vai ao modelo. */
export function alvosDoAgente(p: {
  clientId: string;
  contratoId: string | null;
  servicosAtuais: ServicoDoContrato[];
  variaveis: VariavelDoModelo[];
  valores: Valores;
  faltando: string[];
  clausulas: ClausulaMontada[];
}): AlvosDoAgente {
  const novo = comApelido([{ id: p.clientId, titulo: "novo contrato para este cliente" }], "n");
  const servicos = comApelido(SERVICOS_DO_CONTRATO.map((s) => ({
    id: `${p.contratoId || p.clientId}:${s}`,
    titulo: ROTULO_DO_SERVICO[s],
    detalhe: p.contratoId ? (p.servicosAtuais.indexOf(s) >= 0 ? "já no contrato" : "fora do contrato") : null,
    dados: { servico: s },
  })), "s");
  const variaveis = p.contratoId
    ? comApelido(p.variaveis.map((v) => ({
      id: `${p.contratoId}:${v.nome}`,
      titulo: v.rotulo,
      detalhe: `${v.nome}; ${txt(p.valores[v.nome]) ? `valor: ${txt(p.valores[v.nome]).slice(0, 80)}` : p.faltando.indexOf(v.nome) >= 0 ? "FALTA" : "vazio (opcional)"}${v.tipo === "escolha" ? `; opções: ${(v.opcoes || []).map((o) => o.rotulo).join(" | ")}` : `; tipo ${v.tipo}`}`,
      dados: { nome: v.nome },
    })), "v")
    : [];
  const clausulas = p.contratoId
    ? comApelido(p.clausulas.map((c) => ({
      id: `${p.contratoId}:${c.chave}`,
      titulo: `${c.numero} ${c.titulo}`,
      detalhe: c.alterada ? "alterada nesta versão" : null,
      dados: { chave: c.chave },
    })), "k", 120)
    : [];
  return { novo, servicos, variaveis, clausulas };
}

export function blocoDosAlvosDoContrato(a: AlvosDoAgente): string {
  return [
    blocoDosAlvos("NOVO CONTRATO", a.novo),
    blocoDosAlvos("SERVIÇOS (blocos)", a.servicos),
    blocoDosAlvos("VARIÁVEIS DO CONTRATO ABERTO", a.variaveis, "nenhum contrato aberto."),
    blocoDosAlvos("CLÁUSULAS DO CONTRATO ABERTO", a.clausulas, "nenhum contrato aberto."),
    regraDasAcoes(DESCRICOES_DAS_OPERACOES),
  ].join("\n");
}

export type DiffDaClausula = { ref: string; chave: string; titulo: string; antes: string; depois: string; partes: ParteDoDiff[] };

/**
 * Normaliza a proposta do agente e anexa a diferença de cada cláusula
 * reescrita (contexto.diffs). Sem diferença calculada, o item de reescrita
 * não pode ser executado (executorDeveTerDiff).
 */
export function normalizarAcoesDosContratos(
  bruto: unknown,
  alvos: AlvosDoAgente,
  ctx: ContextoDasRegras,
  opcoes: { contratoId: string | null; clientId: string },
): AcaoDoAgente | null {
  const todos = [...alvos.novo, ...alvos.servicos, ...alvos.variaveis, ...alvos.clausulas];
  const acao = normalizarAcaoDoAgente(bruto, todos, regrasDasOperacoes(ctx), {
    agente: "contratos",
    contexto: { contract_id: opcoes.contratoId, client_id: opcoes.clientId },
    rotuloDoPara: (operacao, para) => {
      if (operacao === "criar_contrato") return lerServicos(para).map((s) => ROTULO_DO_SERVICO[s]).join(", ");
      if (operacao === "alterar_clausula") return "texto novo (veja a diferença)";
      return null;
    },
  });
  if (!acao) return null;
  const diffs: DiffDaClausula[] = [];
  for (const item of acao.itens) {
    if (item.operacao !== "alterar_clausula") continue;
    const chave = chaveDoAlvo(item);
    const c = ctx.clausulas[chave];
    if (!c) continue;
    diffs.push({ ref: item.ref, chave, titulo: item.titulo, antes: c.atual, depois: String(item.para || ""), partes: diffDeTexto(c.atual, String(item.para || "")) });
  }
  if (diffs.length) acao.contexto = { ...(acao.contexto || {}), diffs };
  return acao;
}

/** "<contrato>:<chave>" do alvo, só a parte da chave (cláusula, variável ou serviço). */
export function chaveDoAlvo(item: Pick<ItemDaAcaoDoAgente, "alvo_id">): string {
  const s = String(item.alvo_id || "");
  const i = s.indexOf(":");
  return i >= 0 ? s.slice(i + 1) : s;
}

/** Trava do executor: reescrita só com a diferença mostrada no cartão. */
export function diffDoItem(acao: Pick<AcaoDoAgente, "contexto">, item: Pick<ItemDaAcaoDoAgente, "ref" | "operacao">): DiffDaClausula | null {
  if (item.operacao !== "alterar_clausula") return null;
  const diffs = acao.contexto && Array.isArray((acao.contexto as Record<string, unknown>).diffs) ? ((acao.contexto as Record<string, unknown>).diffs as DiffDaClausula[]) : [];
  return diffs.find((d) => d.ref === item.ref) || null;
}

/** A alteração a guardar no contrato (a tela e o agente usam a mesma). */
export function novaAlteracao(chave: string, texto: string, textoModelo: string, userId: string, motivo?: string | null): ClausulaAlterada {
  return { chave, texto: String(texto).trim(), texto_original: textoModelo, motivo: motivo ? String(motivo).slice(0, 500) : null, confirmada_por: userId, confirmada_em: new Date().toISOString() };
}

/** Troca (ou tira, com texto null) a alteração de uma cláusula na lista. */
export function comAlteracao(lista: ClausulaAlterada[], chave: string, nova: ClausulaAlterada | null): ClausulaAlterada[] {
  const resto = (Array.isArray(lista) ? lista : []).filter((a) => a && a.chave !== chave);
  return nova ? resto.concat([nova]) : resto;
}
