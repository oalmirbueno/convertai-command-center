/**
 * Ações que o agente de estilo PROPÕE e a equipe CONFIRMA (contrato comum:
 * _shared/acoes-do-agente.ts). Apelidos: e1 é o estilo do cliente; r1..rN são
 * imagens que podem entrar no estilo (anexadas agora, artes aprovadas,
 * referências do cliente); s1..sN são as referências que já estão no estilo.
 *
 * - gravar_estilo (e1): grava a proposta do agente como versão nova (a
 *   proposta vai no contexto da ação; sem proposta, o item é ignorado).
 * - registrar_aprendizado (e1): "gostou: ..." ou "não gostou: ...".
 * - ligar_estilo / desligar_estilo (e1): o estilo pode ou não ser usado nas gerações.
 * - gerar_teste (e1): 1 a 4 imagens de teste (custo antes, sem desfazer).
 * - usar_referencia (r*) / tirar_referencia (s*): versão nova com a lista trocada.
 *
 * Frente AG2 (29/09):
 * - ajustar_estilo (e1): troca UM campo do guia ("tipografia: a | b"), versão
 *   nova; Desfazer volta a versão.
 * - aprovar_teste (x*): vai para Arquivos, acervo e referências (sem Desfazer).
 * - descartar_teste (x*): o teste sai da lista (Desfazer devolve); o motivo ensina.
 * - estilo_na_peca / estilo_fora_da_peca (p*): o interruptor "Usar estilo do
 *   cliente" das peças abertas no Estúdio; Desfazer volta como estava.
 * - template_na_peca (p*, para "t2" ou "t2:nivel") / template_fora_da_peca
 *   (p*): o template da geração daquela peça; Desfazer volta o de antes.
 * x1..xN são os testes na ordem da aba Testes; p1..pN, as peças abertas.
 * Sem custo e com Desfazer: com ordem clara, vão direto (direta: true).
 *
 * Puro (a tela e o vitest leem). Sem travessão.
 */

import {
  type AcaoDoAgente,
  type Alvo,
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
import {
  CAMPOS_DAS_REGRAS,
  type CampoDaRegra,
  type EstiloDoCliente,
  guiaAtual,
  guiaTemConteudo,
  lerAprendizado,
  MAX_ITENS_POR_REGRA,
  MAX_TESTES_POR_VEZ,
  normalizarGuia,
  type GuiaDoEstilo,
  ROTULOS_DAS_REGRAS,
} from "../_shared/estilo-do-cliente.ts";
import { CAMPOS_DO_APRENDIZADO } from "../_shared/aprendizado-das-mesas.ts";
import { FIDELIDADES } from "../_shared/fidelidade-da-referencia.ts";

export const AGENTE_DO_ESTILO = "estilo";

/** Operações que só mudam o que o painel do estilo já mostra (teste, gosto): sem "Ir para". */
const SO_NO_PAINEL = ["gerar_teste", "registrar_aprendizado", "gerar_teste_template", "registrar_gosto_template", "aprovar_teste", "descartar_teste"];

/**
 * O "Ir para" do estilo e dos templates (dono, 27/09: "quando termina ele dá
 * o caminho pra mim apertar e ir"): o estilo e os templates são usados no
 * Estúdio (o interruptor "Usar estilo do cliente" e o seletor de template
 * ficam lá), então o caminho é o Estúdio da Mesa do cliente. Teste e gosto
 * aparecem no próprio painel: sem caminho. Conta só o que deu certo.
 */
export function caminhoDoEstilo(clientId: string, acao: Pick<AcaoDoAgente, "itens" | "resultados">, opcoes: { abrirSozinho?: boolean } = {}): CaminhoDoAgente | null {
  const feitos = acao.resultados && acao.resultados.length ? acao.resultados.filter((r) => r.ok) : null;
  const ops = acao.itens.filter((i) => !feitos || feitos.some((r) => r.ref === i.ref && r.operacao === i.operacao)).map((i) => i.operacao);
  if (!ops.some((op) => SO_NO_PAINEL.indexOf(op) < 0)) return null;
  const rotulo = ops.some((op) => op.indexOf("template") >= 0) && !ops.some((op) => op.indexOf("estilo") >= 0) ? "Usar o template no Estúdio" : "Usar no Estúdio";
  return caminhoNaArea("mesa", { clientId, etapa: "estudio", rotulo, abrirSozinho: opcoes.abrirSozinho });
}

export const OPERACOES_DO_ESTILO = [
  "gravar_estilo",
  "ajustar_estilo",
  "registrar_aprendizado",
  "ligar_estilo",
  "desligar_estilo",
  "gerar_teste",
  "usar_referencia",
  "tirar_referencia",
  "aprovar_teste",
  "descartar_teste",
  "estilo_na_peca",
  "estilo_fora_da_peca",
  "template_na_peca",
  "template_fora_da_peca",
] as const;
export type OperacaoDoEstilo = (typeof OPERACOES_DO_ESTILO)[number];

export const DESCRICOES_DAS_OPERACOES: Record<OperacaoDoEstilo, string> = {
  gravar_estilo: "e1. Grava a sua proposta_de_estilo como versão nova do estilo. Só com proposta_de_estilo preenchida. para: uma frase do que muda.",
  ajustar_estilo: "e1. Troca UM campo do guia atual, sem reescrever o resto (pedido como \"muda só a tipografia\"). para: \"campo: regra | regra\" (campos: resumo, layout, tipografia, cor, foto, elementos, capa, miolo, cta, evitar). Um item por campo.",
  registrar_aprendizado: "e1. Registra o que o cliente gostou ou não. para: \"gostou: ...\" ou \"não gostou: ...\" (várias separadas por |).",
  ligar_estilo: "e1. Deixa o estilo pronto para ser usado nas gerações (a equipe ainda liga o interruptor no Estúdio). para vazio.",
  desligar_estilo: "e1. Tira o estilo das gerações. para vazio.",
  gerar_teste: "e1. Gera imagens de teste do estilo atual com o gerador do Estúdio (TEM CUSTO, vai com Confirmar). para: quantas (1 a 4) e, depois de dois pontos, o tema (ex.: \"2: promoção de outubro\").",
  usar_referencia: "r*. Põe a imagem como referência de acabamento do estilo. para vazio.",
  tirar_referencia: "s*. Tira a referência do estilo. para vazio.",
  aprovar_teste: "x*. Aprova a imagem de teste: vai para Arquivos, para o acervo e vira referência do estilo. para vazio.",
  descartar_teste: "x*. Descarta a imagem de teste. para: o motivo em poucas palavras, quando a equipe disse (senão \"sem motivo\").",
  estilo_na_peca: "p*. Liga \"Usar estilo do cliente\" na geração desta peça aberta no Estúdio. para vazio.",
  estilo_fora_da_peca: "p*. Desliga o estilo do cliente na geração desta peça. para vazio.",
  template_na_peca: "p*. Aplica um template na geração desta peça. para: o apelido do template (\"t2\") e, para referência de carrossel, o nível depois de dois pontos (\"t2:identica\", \"t2:inspirada\"...).",
  template_fora_da_peca: "p*. Tira o template da geração desta peça (volta para \"Nenhum\"). para vazio.",
};

export const ORDEM_DE_EXECUCAO: OperacaoDoEstilo[] = [
  "gravar_estilo",
  "ajustar_estilo",
  "usar_referencia",
  "tirar_referencia",
  "registrar_aprendizado",
  "desligar_estilo",
  "ligar_estilo",
  "descartar_teste",
  "aprovar_teste",
  "estilo_fora_da_peca",
  "estilo_na_peca",
  "template_fora_da_peca",
  "template_na_peca",
  "gerar_teste",
];

/**
 * Regra 6 do contrato: sem custo e com Desfazer, a operação pode ir direto
 * quando o pedido é uma ordem clara. gravar_estilo (proposta inteira nova)
 * pede o olho da equipe; gerar_teste custa; aprovar_teste manda para Arquivos.
 */
export const DIRETAS_DO_ESTILO: Record<OperacaoDoEstilo, { direta: boolean }> = {
  gravar_estilo: { direta: false },
  ajustar_estilo: { direta: true },
  registrar_aprendizado: { direta: true },
  ligar_estilo: { direta: true },
  desligar_estilo: { direta: true },
  gerar_teste: { direta: false },
  usar_referencia: { direta: true },
  tirar_referencia: { direta: true },
  aprovar_teste: { direta: false },
  descartar_teste: { direta: true },
  estilo_na_peca: { direta: true },
  estilo_fora_da_peca: { direta: true },
  template_na_peca: { direta: true },
  template_fora_da_peca: { direta: true },
};

/** Níveis de fidelidade aceitos em "t2:nivel" (os do Estúdio). */
const NIVEIS_DO_TEMPLATE: readonly string[] = FIDELIDADES;

/** "t2" ou "t2:identica" -> { ref, nivel }. */
export function lerTemplateDaPeca(bruto: unknown, niveis: readonly string[] = NIVEIS_DO_TEMPLATE): { ref: string; nivel: string | null } | null {
  const m = /^\s*(t\d+)\s*(?::\s*([a-z_]+))?\s*$/i.exec(String(bruto ?? ""));
  if (!m) return null;
  const n = String(m[2] || "").toLowerCase();
  return { ref: m[1].toLowerCase(), nivel: n && niveis.indexOf(n) >= 0 ? n : null };
}

/** Campo do guia pelo nome ou pelo rótulo da tela ("Tipografia", "CTA"). "resumo" também vale. */
function campoDoAjuste(bruto: string): CampoDaRegra | "resumo" | null {
  const s = bruto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (s === "resumo") return "resumo";
  for (const c of CAMPOS_DAS_REGRAS) {
    const rot = String(ROTULOS_DAS_REGRAS[c] || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    if (s === c || s === rot) return c;
  }
  return null;
}

/** "tipografia: título pesado | apoio regular" -> { campo, regras }. Campo desconhecido ou vazio: null. */
export function lerAjusteDoEstilo(bruto: unknown): { campo: CampoDaRegra | "resumo"; regras: string[] } | null {
  const s = String(bruto ?? "").replace(/[\u2014\u2013]/g, ",").trim();
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const campo = campoDoAjuste(s.slice(0, i));
  if (!campo) return null;
  const resto = s.slice(i + 1);
  const regras = (campo === "resumo" ? [resto] : resto.split("|"))
    .map((x) => x.replace(/\s+/g, " ").trim().slice(0, 220))
    .filter(Boolean)
    .slice(0, campo === "resumo" ? 1 : MAX_ITENS_POR_REGRA);
  return regras.length ? { campo, regras } : null;
}

/** Guia com um campo trocado (a tela e o executor usam o mesmo). */
export function guiaComAjuste(g: GuiaDoEstilo | null, ajuste: { campo: CampoDaRegra | "resumo"; regras: string[] }): GuiaDoEstilo {
  const base = normalizarGuia(g || {});
  if (ajuste.campo === "resumo") return { ...base, resumo: ajuste.regras[0] || "" };
  return { ...base, regras: { ...base.regras, [ajuste.campo]: ajuste.regras.slice() } };
}

// ------------------------------------------------------------------ evidência (nada inventado)

/** Nota da versão gravada com evidência fraca: a tela e o agente leem "Provisório". */
export const PREFIXO_PROVISORIO = "Provisório";

export const ehNotaProvisoria = (nota: unknown) => String(nota || "").trim().indexOf(PREFIXO_PROVISORIO) === 0;

export type EvidenciaDoEstilo = { fraca: boolean; tem: string[]; falta: string[] };

/**
 * O que o agente tem de OBSERVADO para montar o estilo (dono, 29/09: "nada
 * inventado"). Posicionamento e contexto do negócio não contam como evidência
 * visual. Fraca: nenhuma imagem lida, nenhuma arte aprovada, nenhuma
 * referência no estilo e nenhum aprendizado do cliente.
 */
export function evidenciaDoEstilo(e: {
  novas: number;
  referenciasNoEstilo: number;
  artesAprovadas: number;
  candidatasLidas: number;
  aprendizados: number;
  testesAprovados: number;
  temKit: boolean;
}): EvidenciaDoEstilo {
  const tem: string[] = [];
  const falta: string[] = [];
  const conta = (n: number, sim: string, nao: string) => (n > 0 ? tem.push(`${n} ${sim}`) : falta.push(nao));
  conta(e.novas, "referência(s) mandada(s) agora", "");
  conta(e.referenciasNoEstilo, "referência(s) no estilo", "referências visuais do cliente");
  conta(e.artesAprovadas, "arte(s) aprovada(s) lida(s)", "artes aprovadas do cliente");
  conta(e.candidatasLidas, "referência(s) do cliente já lida(s)", "");
  conta(e.aprendizados, "aprendizado(s) do que o cliente gostou ou não", "o que o cliente gostou ou não");
  conta(e.testesAprovados, "teste(s) aprovado(s)", "");
  if (e.temKit) tem.push("kit da marca (cores)");
  else falta.push("kit da marca (cores, fontes, logo)");
  const visuais = e.novas + e.referenciasNoEstilo + e.artesAprovadas + e.candidatasLidas + e.aprendizados + e.testesAprovados;
  return { fraca: visuais === 0, tem, falta: falta.filter(Boolean) };
}

/** Frase que a resposta ganha quando o estilo proposto é provisório e o modelo não disse. */
export function fraseDoProvisorio(ev: EvidenciaDoEstilo): string {
  const falta = ev.falta.slice(0, 3).join(", ");
  return `Sem evidência visual deste cliente${falta ? ` (falta: ${falta})` : ""}, o que proponho é suposição: se confirmar, grava como rascunho provisório e desligado. Quer mandar referências ou artes aprovadas antes?`;
}

/** Candidata a referência (r*): de onde vem e onde está o arquivo. */
export type CandidataDeReferencia = Alvo & { dados: { origem: "referencia" | "acervo"; bucket: string; caminho: string; leitura?: string | null } };

/** Peça aberta no Estúdio (p*): o trabalho da tela, já conferido no banco. */
export type PecaDaTela = Alvo & { dados: { estilo_ligado: boolean; template_id: string | null; template_de_design: Record<string, unknown> | null } };

export type AlvosDoEstilo = {
  estilo: Array<AlvoComApelido>;
  candidatas: Array<AlvoComApelido<CandidataDeReferencia>>;
  noEstilo: Array<AlvoComApelido>;
  /** Testes na ordem da aba Testes (o mais novo primeiro, sem os descartados). */
  testes: Array<AlvoComApelido>;
  /** Peças abertas no Estúdio quando o painel foi aberto de lá. */
  pecas: Array<AlvoComApelido<PecaDaTela>>;
  todos: Array<AlvoComApelido>;
};

/** Testes como a aba Testes mostra: o mais novo primeiro, sem os descartados. */
export function testesNaOrdemDaTela(estilo: EstiloDoCliente) {
  return estilo.testes.slice().reverse().filter((t) => t.status !== "descartado");
}

/** Monta os apelidos: e1, r1..rN (candidatas, as anexadas agora primeiro), s1..sN, x1..xN (testes) e p1..pN (peças). */
export function alvosDoEstilo(estilo: EstiloDoCliente, candidatas: CandidataDeReferencia[], extra: { pecas?: PecaDaTela[] } = {}): AlvosDoEstilo {
  const g = guiaAtual(estilo);
  const noEstiloIds = new Set((g ? g.referencias : []).map((r) => r.id));
  const alvoEstilo: Alvo = {
    id: estilo.id || estilo.client_id,
    titulo: "Estilo do cliente",
    detalhe: estilo.versao_atual ? `versão ${estilo.versao_atual}, ${estilo.ativo ? "ligado" : "desligado"}` : "ainda sem versão",
    dados: { ativo: estilo.ativo, tem_guia: guiaTemConteudo(g) },
  };
  const e = comApelido([alvoEstilo], "e");
  const r = comApelido(candidatas.filter((c) => !noEstiloIds.has(c.id)).slice(0, 40), "r");
  const s = comApelido(
    (g ? g.referencias : []).map((x) => ({ id: x.id, titulo: x.nome, detalhe: x.leitura ? x.leitura.slice(0, 140) : x.origem })),
    "s",
  );
  const x = comApelido(
    testesNaOrdemDaTela(estilo).slice(0, 24).map((t) => ({
      id: t.id,
      titulo: t.tema ? `Teste "${t.tema}"` : "Teste sem tema",
      detalhe: `versão ${t.versao}, ${t.status === "aprovado" ? "aprovado" : "novo, esperando aprovar ou descartar"}`,
      dados: { status: t.status },
    })),
    "x",
  );
  const p = comApelido((extra.pecas || []).slice(0, 60), "p");
  return { estilo: e, candidatas: r, noEstilo: s, testes: x, pecas: p, todos: [...e, ...r, ...s, ...x, ...p] };
}

export function blocoDosAlvosDoEstilo(a: AlvosDoEstilo): string {
  return [
    blocoDosAlvos("ESTILO", a.estilo),
    blocoDosAlvos("IMAGENS QUE PODEM ENTRAR NO ESTILO", a.candidatas, "nenhuma."),
    blocoDosAlvos("REFERÊNCIAS QUE JÁ ESTÃO NO ESTILO (na ordem da aba Estilo)", a.noEstilo, "nenhuma."),
    blocoDosAlvos("IMAGENS DE TESTE (na ordem da aba Testes)", a.testes, "nenhuma."),
    blocoDosAlvos("PEÇAS ABERTAS NO ESTÚDIO (a geração delas)", a.pecas, "nenhuma (o painel não foi aberto de uma peça; não use as operações de peça)."),
    regraDasAcoes(DESCRICOES_DAS_OPERACOES),
  ].join("");
}

/** Esquema da proposta de estilo (blocos claros). Null quando o agente não propõe. */
export const ESQUEMA_DA_PROPOSTA = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["resumo", "regras"],
  properties: {
    resumo: { type: "string" },
    regras: {
      type: "object",
      additionalProperties: false,
      required: [...CAMPOS_DAS_REGRAS],
      properties: Object.fromEntries(CAMPOS_DAS_REGRAS.map((c) => [c, { type: "array", items: { type: "string" } }])),
    },
  },
};

export const ESQUEMA_DO_AGENTE_DE_ESTILO = {
  nome: "resposta_do_agente_de_estilo",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resposta", "sugestoes", "leitura_das_referencias", "proposta_de_estilo", "acoes", "regra_aprendida", "regras_seguidas"],
    properties: {
      resposta: { type: "string" },
      sugestoes: { type: "array", items: { type: "string" } },
      leitura_das_referencias: { type: "string" },
      proposta_de_estilo: ESQUEMA_DA_PROPOSTA,
      acoes: esquemaDasAcoes([...OPERACOES_DO_ESTILO]),
      // Frente AG2 (29/09): o que o pedido ensinou e as regras ensinadas que a resposta seguiu.
      ...CAMPOS_DO_APRENDIZADO,
    },
  },
};

/** "2: promoção de outubro" -> { n: 2, tema }. Fora de 1..4: null. */
export function lerPedidoDeTeste(bruto: unknown): { n: number; tema: string } | null {
  const s = String(bruto ?? "").trim();
  const m = /^(\d+)\s*(?::\s*(.*))?$/.exec(s);
  const n = m ? Number(m[1]) : 1;
  if (!Number.isInteger(n) || n < 1 || n > MAX_TESTES_POR_VEZ) return null;
  const tema = (m ? m[2] || "" : s).replace(/\s+/g, " ").trim().slice(0, 200);
  return { n, tema };
}

/** Normaliza o que o modelo pediu em "|" para a lista de aprendizados. */
export function aprendizadosDoPara(bruto: unknown): Array<{ tipo: "gostou" | "nao_gostou"; texto: string }> {
  return String(bruto ?? "")
    .split("|")
    .map(lerAprendizado)
    .filter((x): x is { tipo: "gostou" | "nao_gostou"; texto: string } => !!x)
    .slice(0, 6);
}

/** Motivo do descarte ("sem motivo" quando a equipe não disse). */
export const SEM_MOTIVO = "sem motivo";

/**
 * Lê as ações do modelo. A proposta de estilo (quando houver e disser algo)
 * vai no contexto da ação para o executor gravar. Custo: imagens de teste x
 * custo por imagem (mostrado no cartão antes de confirmar).
 * - provisorio: evidência fraca (nada observado): gravar_estilo vira "gravar
 *   como rascunho provisório" e o mesmo cartão não liga o estilo.
 * - templates: os t* da conversa (template_na_peca troca o apelido pelo id no contexto).
 */
export function normalizarAcoesDoEstilo(
  bruto: unknown,
  alvos: AlvosDoEstilo,
  opcoes: {
    proposta: unknown;
    clientId: string;
    marcaId: string | null;
    custoPorImagem: number;
    id?: string;
    provisorio?: boolean;
    templates?: Array<AlvoComApelido>;
  },
): AcaoDoAgente | null {
  const propostaNorm: GuiaDoEstilo | null = opcoes.proposta ? normalizarGuia(opcoes.proposta) : null;
  const proposta = propostaNorm && guiaTemConteudo(propostaNorm) ? propostaNorm : null;
  const provisorio = !!(opcoes.provisorio && proposta);
  const dado = (a: AlvoComApelido, k: string) => (a.dados ? (a.dados as Record<string, unknown>)[k] : undefined);
  const ativo = (a: AlvoComApelido) => !!dado(a, "ativo");
  const temGuia = (a: AlvoComApelido) => !!dado(a, "tem_guia");
  const estiloTemGuia = alvos.estilo.some(temGuia) || !!proposta;
  const templatePorRef = new Map((opcoes.templates || []).map((t) => [t.ref.toLowerCase(), t]));
  const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/[\u2014\u2013]/g, ",").replace(/\s+/g, " ").trim().slice(0, max);
  const regras: Record<OperacaoDoEstilo, RegraDaOperacao> = {
    gravar_estilo: {
      rotulo: provisorio ? "gravar como rascunho provisório" : "gravar o estilo novo",
      alvos: ["e"],
      combina: true,
      para: (v) => (proposta ? umaLinha(v, 200) || "estilo proposto na conversa" : null),
    },
    ajustar_estilo: {
      rotulo: "ajustar um campo do estilo",
      alvos: ["e"],
      combina: true,
      repete: true,
      para: (v) => {
        const a = lerAjusteDoEstilo(v);
        return a ? `${a.campo}: ${a.regras.join(" | ")}` : null;
      },
      direta: true,
    },
    registrar_aprendizado: {
      rotulo: "registrar aprendizado",
      alvos: ["e"],
      combina: true,
      para: (v) => {
        const l = aprendizadosDoPara(v);
        return l.length ? l.map((x) => `${x.tipo === "gostou" ? "gostou" : "não gostou"}: ${x.texto}`).join(" | ") : null;
      },
      direta: true,
    },
    ligar_estilo: {
      rotulo: "ligar o estilo",
      alvos: ["e"],
      combina: true,
      trava: (a) =>
        ativo(a)
          ? "O estilo já está ligado."
          : provisorio
          ? "Estilo provisório (sem evidência visual): ligue depois de ter referências ou artes aprovadas."
          : !temGuia(a) && !proposta
          ? "Ainda não há estilo gravado para ligar."
          : null,
      direta: true,
    },
    desligar_estilo: { rotulo: "desligar o estilo", alvos: ["e"], combina: true, trava: (a) => (ativo(a) ? null : "O estilo já está desligado."), direta: true },
    gerar_teste: {
      rotulo: "gerar imagens de teste",
      alvos: ["e"],
      combina: true,
      para: (v) => {
        const p = lerPedidoDeTeste(v);
        return p ? (p.tema ? `${p.n}: ${p.tema}` : String(p.n)) : null;
      },
      trava: (a) => (!temGuia(a) && !proposta ? "Ainda não há estilo para testar." : null),
    },
    usar_referencia: { rotulo: "pôr no estilo", alvos: ["r"], direta: true },
    tirar_referencia: { rotulo: "tirar do estilo", alvos: ["s"], direta: true },
    aprovar_teste: {
      rotulo: "aprovar o teste (vai para Arquivos)",
      alvos: ["x"],
      trava: (a) => (dado(a, "status") === "aprovado" ? "Este teste já foi aprovado." : null),
    },
    descartar_teste: {
      rotulo: "descartar o teste",
      alvos: ["x"],
      para: (v) => umaLinha(v, 200) || SEM_MOTIVO,
      trava: (a) => (dado(a, "status") === "aprovado" ? "Este teste já foi aprovado e está em Arquivos." : null),
      direta: true,
    },
    estilo_na_peca: {
      rotulo: "usar o estilo nesta peça",
      alvos: ["p"],
      combina: true,
      trava: (a) => (dado(a, "estilo_ligado") ? "O estilo já está ligado nesta peça." : !estiloTemGuia ? "Ainda não há estilo gravado para usar." : null),
      direta: true,
    },
    estilo_fora_da_peca: {
      rotulo: "tirar o estilo desta peça",
      alvos: ["p"],
      combina: true,
      trava: (a) => (dado(a, "estilo_ligado") ? null : "O estilo já está desligado nesta peça."),
      direta: true,
    },
    template_na_peca: {
      rotulo: "aplicar o template nesta peça",
      alvos: ["p"],
      combina: true,
      para: (v) => {
        const t = lerTemplateDaPeca(v);
        return t && templatePorRef.has(t.ref) ? (t.nivel ? `${t.ref}:${t.nivel}` : t.ref) : null;
      },
      trava: (a, para) => {
        const t = lerTemplateDaPeca(para);
        const alvo = t ? templatePorRef.get(t.ref) : null;
        return alvo && dado(a, "template_id") === alvo.id ? "Este template já está nesta peça." : null;
      },
      direta: true,
    },
    template_fora_da_peca: {
      rotulo: "tirar o template desta peça",
      alvos: ["p"],
      combina: true,
      trava: (a) => (dado(a, "template_id") ? null : "Esta peça não tem template."),
      direta: true,
    },
  };
  const acao = normalizarAcaoDoAgente(bruto, alvos.todos, regras, {
    agente: AGENTE_DO_ESTILO,
    id: opcoes.id,
    contexto: { client_id: opcoes.clientId, marca_id: opcoes.marcaId, ...(proposta ? { proposta } : {}), ...(provisorio ? { provisorio: true } : {}) },
    semDesfazer: (itens) => itens.every((i) => i.operacao === "gerar_teste" || i.operacao === "aprovar_teste"),
    rotuloDoPara: (op, para) => {
      if (op !== "template_na_peca" || typeof para !== "string") return null;
      const t = lerTemplateDaPeca(para);
      const alvo = t ? templatePorRef.get(t.ref) : null;
      return alvo ? `${alvo.titulo}${t && t.nivel ? ` (${t.nivel})` : ""}` : null;
    },
  });
  if (!acao) return null;
  // Ordem de execução (um item por vez): grava o guia, troca referências, aprende, liga e só então testa.
  const ordem = (op: string) => ORDEM_DE_EXECUCAO.indexOf(op as OperacaoDoEstilo);
  acao.itens.sort((a, b) => ordem(a.operacao) - ordem(b.operacao));
  // Dados da candidata (bucket e caminho) viajam no contexto: o executor não depende do modelo.
  const refs: Record<string, unknown> = {};
  const templatesDaPeca: Record<string, { id: string; tipo: string | null }> = {};
  for (const i of acao.itens) {
    if (i.operacao === "usar_referencia") {
      const c = alvos.candidatas.find((x) => x.ref === i.ref);
      if (c) refs[c.id] = { origem: c.dados.origem, bucket: c.dados.bucket, caminho: c.dados.caminho, nome: c.titulo, leitura: c.dados.leitura ?? null };
    }
    if (i.operacao === "template_na_peca") {
      const t = lerTemplateDaPeca(i.para);
      const alvo = t ? templatePorRef.get(t.ref) : null;
      if (t && alvo) templatesDaPeca[t.ref] = { id: alvo.id, tipo: typeof dado(alvo, "tipo") === "string" ? String(dado(alvo, "tipo")) : null };
    }
  }
  if (Object.keys(refs).length) acao.contexto = { ...(acao.contexto || {}), referencias: refs };
  if (Object.keys(templatesDaPeca).length) acao.contexto = { ...(acao.contexto || {}), templates_da_peca: templatesDaPeca };
  const imagens = acao.itens.filter((i) => i.operacao === "gerar_teste").reduce((s, i) => s + (lerPedidoDeTeste(String(i.para || "1").split(":")[0])?.n || 1), 0);
  if (imagens > 0 && opcoes.custoPorImagem > 0) acao.custo_estimado_usd = Math.round(imagens * opcoes.custoPorImagem * 1e4) / 1e4;
  return acao;
}
