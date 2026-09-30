/**
 * Base UI UX Pro Max 2.15.0 na Mesa Identidade (frente UXM, 30/09/2026): a
 * marca manda, a base apoia. Tudo por projeto (que é por marca), guardado em
 * dados.sistema.base_de_design.
 *
 * - base_sugerir_marca { projeto_id } (Jev, não grava): produto (192 + nenhum)
 *   e par de fontes (74 + nenhum) numa requisição só, lista completa.
 * - paleta_do_setor { projeto_id, produto } (sem IA): a paleta de referência
 *   do setor e o apoio calculado para a paleta da marca (primária,
 *   secundária e destaque nunca mudam; contraste conferido por código).
 * - pares_da_base { projeto_id, produto? } (sem IA): os 74 pares, sem os de
 *   escrita não latina, ordenados pelo produto e pela personalidade, com a
 *   licença de cada família (todas OFL ou Apache).
 * - base_salvar_marca { projeto_id, produto?, par?, paleta_setor? }: grava a
 *   escolha (com a trava de versão do projeto).
 * - base_proposta { projeto_id, tipo: paleta|fonte, produto?, par? }: "Usar
 *   como proposta" grava em propostas_de_paleta ou propostas_de_fonte com a
 *   origem da base, sem trocar o sistema (a passagem para o kit continua pelo
 *   kit_sugerir com Confirmar).
 *
 * Julgamento é do Jev; o resto é busca exata. Sem travessão.
 */

import { cobrarJev } from "../_shared/ia-motor.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { normalizarEstrategia } from "../_shared/estrategia-de-marca.ts";
import { estilosDaPersonalidade, fonteDoCatalogo, urlDoGoogleFonts } from "../_shared/tipografia-da-marca.ts";
import { BASE_COMPLETA, comRotulos } from "../_shared/uiux/base-completa.ts";
import { apoioDaPaleta } from "../_shared/uiux/apoio-da-paleta.ts";
import { lerBaseDaMarca, paletaDoSetor, paresDoProduto, parDeOutraEscrita, produtoPorId, type BaseDaMarca, type EscolhaDaBase } from "../_shared/uiux/consultas.ts";
import { MENSAGEM_SEM_JEV, notasDosPares, perguntasDaBase, probabilidadesDasRespostas, produtoDaSugestao, QUANTOS_NA_TELA } from "../_shared/uiux/jev-da-base.ts";
import { rotuloDoProduto } from "../_shared/uiux/pt.ts";
import { idDeCitacao } from "../_shared/uiux/citar.ts";
import { type Chamador, dadosComParte, ErroHttp, gravarProjeto, json, lerProjeto, type LinhaDoProjeto, marcaDoPedido, nomeDaMarca, servico, TAREFA } from "./comum.ts";
import { lerContextoDaMarca } from "../_shared/marca.ts";
import { lerContextoConsolidado } from "../_shared/contexto-cliente.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const texto = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

export const ACOES_LONGAS_DA_BASE_DA_MARCA = ["base_sugerir_marca"];

const sistemaDe = (p: LinhaDoProjeto) => obj(p.dados.sistema);
const baseDaMarcaDe = (p: LinhaDoProjeto): BaseDaMarca => lerBaseDaMarca(sistemaDe(p).base_de_design);
const estilosDoProjeto = (p: LinhaDoProjeto) => {
  const est = normalizarEstrategia(p.dados.estrategia);
  return estilosDaPersonalidade({ arquetipo: est.arquetipo.principal || undefined, eixos: est.personalidade.eixos });
};

async function estadoDaMarca(p: LinhaDoProjeto) {
  const marca = p.marca_id ? await marcaDoPedido(p.client_id, p.marca_id).catch((e) => (registrarFalha("mesa-identidade: marca da base", e), null)) : null;
  const [nome, contexto] = await Promise.all([
    nomeDaMarca(p.client_id, p.marca_id),
    (marca ? lerContextoDaMarca(servico(), p.client_id, marca) : lerContextoConsolidado(servico(), p.client_id)).catch((e) => (registrarFalha("mesa-identidade: contexto da base", e), {} as Record<string, unknown>)),
  ]);
  const c = obj(contexto);
  const est = normalizarEstrategia(p.dados.estrategia);
  const briefing: Record<string, string> = {};
  const b = obj(p.dados.briefing);
  for (const k of Object.keys(b).slice(0, 20)) briefing[k] = texto(typeof b[k] === "string" ? b[k] : JSON.stringify(b[k]), 500);
  return {
    marca: {
      nome: (obj(p.dados.naming).nome as string) || nome,
      negocio: texto(c.negocio, 800) || null,
      publico: texto(c.publico, 600) || null,
      oferta: texto(c.oferta, 600) || null,
      tom: texto(c.tom_de_voz, 200) || null,
      diferenciais: Array.isArray(c.diferenciais) ? (c.diferenciais as unknown[]).slice(0, 6).map((d) => texto(d, 160)) : [],
      arquetipo: est.arquetipo.principal || null,
      eixos: est.personalidade.eixos as unknown as Record<string, number>,
    },
    briefing,
    kit: { tem_paleta: Array.isArray(sistemaDe(p).cores) && (sistemaDe(p).cores as unknown[]).length > 0, tem_fontes: false },
  };
}

export async function baseSugerirMarca(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const estado = await estadoDaMarca(p);
  const estilos = estilosDoProjeto(p);
  try {
    const r = await jevPerguntar({ state: estado, questions: perguntasDaBase(BASE_COMPLETA, { estilo: false, padrao: false, preset: false }) });
    const cobrado = await cobrarJev(r, { clientId: p.client_id, tarefa: TAREFA, referencia: { tipo: "idv_projeto", id: p.id }, criadoPor: ch.userId });
    const probs = probabilidadesDasRespostas(r.answers);
    const produto = produtoDaSugestao(probs, {});
    const pares = notasDosPares(BASE_COMPLETA, probs, produto.escolhido ? produto.escolhido.id : null, estilos).slice(0, QUANTOS_NA_TELA);
    return json({ produto, pares, probabilidades: probs, sem_jev: false, custo_usd: cobrado ? cobrado.custoUsd : 0 });
  } catch (e) {
    registrarFalha("mesa-identidade: Jev da base", e, { projeto_id: p.id });
    return json({ produto: { escolhido: null, top: [], escolher_a_mao: true }, pares: [], probabilidades: {}, sem_jev: true, aviso: MENSAGEM_SEM_JEV, custo_usd: 0 });
  }
}

function produtoDoPedido(p: LinhaDoProjeto, v: unknown): string | null {
  const pedido = texto(v, 6);
  if (pedido) {
    if (!produtoPorId(BASE_COMPLETA, pedido)) throw new ErroHttp(400, "produto_invalido", "Esse tipo de produto não existe na base.");
    return pedido;
  }
  const guardado = baseDaMarcaDe(p).produto;
  return guardado ? guardado.id : null;
}

export async function paletaDoSetorAcao(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const produto = produtoDoPedido(p, corpo.produto);
  if (!produto) throw new ErroHttp(400, "sem_produto", "Escolha o tipo de produto da marca antes.");
  const setor = paletaDoSetor(BASE_COMPLETA, produto);
  if (!setor) throw new ErroHttp(404, "sem_paleta", "A base não tem paleta para este produto.");
  const cores = (Array.isArray(sistemaDe(p).cores) ? sistemaDe(p).cores : []) as Array<{ hex?: string; papel?: string; nome?: string }>;
  const apoio = apoioDaPaleta({ marca: cores, setor });
  return json({ produto: { id: produto, rotulo: rotuloDoProduto(produto, setor.nome) }, setor, apoio, citacao: idDeCitacao("color", setor.no), custo_usd: 0 });
}

export async function paresDaBaseAcao(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const produtoNo = produtoDoPedido(p, corpo.produto);
  const produto = produtoNo ? produtoPorId(BASE_COMPLETA, produtoNo) : null;
  const ordem = paresDoProduto(BASE_COMPLETA, produto, estilosDoProjeto(p));
  const licenca = (familia: string) => (BASE_COMPLETA.fontes.filter((f) => f.familia === familia)[0] || { licenca: "" }).licenca;
  const pares = ordem.map((x) => ({
    no: x.par.no,
    id: idDeCitacao("typography", x.par.no),
    nome: x.par.nome,
    titulo: x.par.titulo,
    texto: x.par.texto,
    humor: x.par.humor,
    melhor_para: x.par.melhorPara,
    encaixe: x.encaixe,
    licencas: [licenca(x.par.titulo), licenca(x.par.texto)],
    da_casa: !!fonteDoCatalogo(x.par.titulo) && !!fonteDoCatalogo(x.par.texto),
    url: urlDoGoogleFonts([{ familia: x.par.titulo, pesos: [700] }, { familia: x.par.texto, pesos: [400, 600] }], { extras: BASE_COMPLETA.fontes, somenteConhecidas: true }),
  }));
  return json({ produto: produto ? { id: produto.no, rotulo: rotuloDoProduto(produto.no, produto.nome) } : null, pares, total: BASE_COMPLETA.pares.filter((x) => !parDeOutraEscrita(x)).length, custo_usd: 0 });
}

const escolhaDe = (v: unknown, origem: "jev" | "equipe"): EscolhaDaBase | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const o = typeof v === "string" ? { id: v } : obj(v);
  return lerBaseDaMarca({ produto: { ...o, origem: o.origem === "jev" ? "jev" : origem } }).produto;
};

export async function baseSalvarMarca(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const atual = baseDaMarcaDe(p);
  const nova: BaseDaMarca = { ...atual };
  for (const k of ["produto", "par", "paleta_setor"] as const) {
    const e = escolhaDe(corpo[k], corpo.origem === "jev" ? "jev" : "equipe");
    if (e !== undefined) nova[k] = e;
  }
  if (nova.produto && !produtoPorId(BASE_COMPLETA, nova.produto.id)) throw new ErroHttp(400, "produto_invalido", "Esse tipo de produto não existe na base.");
  if (nova.paleta_setor && !paletaDoSetor(BASE_COMPLETA, nova.paleta_setor.id)) throw new ErroHttp(400, "paleta_invalida", "Essa paleta de setor não existe na base.");
  if (nova.par && !BASE_COMPLETA.pares.some((x) => x.no === nova.par!.id)) throw new ErroHttp(400, "par_invalido", "Esse par de fontes não existe na base.");
  const versao = typeof corpo.versao === "number" ? corpo.versao : undefined;
  const projeto = await gravarProjeto(p, { dados: dadosComParte(p.dados, "sistema", { base_de_design: comRotulos(nova) }) }, versao);
  return json({ projeto, anterior: atual, custo_usd: 0 });
}

/** "Usar como proposta": a paleta de apoio (marca intacta + neutros do setor) ou o par da base, com a origem. */
export async function baseProposta(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const sistema = sistemaDe(p);
  if (corpo.tipo === "paleta") {
    const produto = produtoDoPedido(p, corpo.produto);
    const setor = produto ? paletaDoSetor(BASE_COMPLETA, produto) : null;
    if (!setor) throw new ErroHttp(400, "sem_produto", "Escolha o tipo de produto da marca antes.");
    const cores = (Array.isArray(sistema.cores) ? sistema.cores : []) as Array<{ hex?: string; papel?: string; nome?: string }>;
    const apoio = apoioDaPaleta({ marca: cores, setor });
    const papeis: Array<[string, string, "primaria" | "secundaria" | "destaque" | "neutra"]> = [
      ["primaria", "Primária", "primaria"],
      ["secundaria", "Secundária", "secundaria"],
      ["destaque", "Destaque", "destaque"],
      ["fundo", "Fundo", "neutra"],
      ["texto", "Texto", "neutra"],
      ["borda", "Borda", "neutra"],
      ["suave", "Suave", "neutra"],
    ];
    const lista = papeis
      .map(([papel, nome, papelDaCor]) => {
        const c = apoio.papeis.filter((x) => x.papel === papel)[0];
        return c ? { nome, papel: papelDaCor, hex: c.hex } : null;
      })
      .filter((x): x is { nome: string; papel: "primaria" | "secundaria" | "destaque" | "neutra"; hex: string } => !!x)
      .filter((c, i, l) => l.findIndex((x) => x.hex === c.hex) === i)
      .slice(0, 8);
    if (!lista.length) throw new ErroHttp(400, "sem_paleta_da_marca", "A marca ainda não tem cores no sistema.");
    const proposta = { id: `uupm-${setor.no}-${Date.now().toString(36)}`, nome: `Apoio do setor: ${rotuloDoProduto(setor.no, setor.nome)}`, ideia: "A paleta da marca intacta, com fundo, texto e borda da referência do setor, contraste conferido.", cores: lista, avisos: apoio.avisos.slice(0, 4), origem: idDeCitacao("color", setor.no) };
    const antes = Array.isArray(sistema.propostas_de_paleta) ? (sistema.propostas_de_paleta as unknown[]) : [];
    const base = comRotulos({ ...baseDaMarcaDe(p), produto: { id: produto!, origem: "equipe" as const }, paleta_setor: { id: setor.no, origem: "equipe" as const } });
    const projeto = await gravarProjeto(p, { dados: dadosComParte(p.dados, "sistema", { propostas_de_paleta: [proposta].concat(antes as never[]).slice(0, 6), base_de_design: base }) });
    return json({ projeto, proposta, custo_usd: 0 });
  }
  if (corpo.tipo === "fonte") {
    const no = texto(corpo.par, 4);
    const par = BASE_COMPLETA.pares.filter((x) => x.no === no)[0];
    if (!par) throw new ErroHttp(400, "par_invalido", "Esse par de fontes não existe na base.");
    const proposta = { titulo: par.titulo, texto: par.texto, porque: `${par.nome} (base UI UX Pro Max): ${texto(par.notas, 200)}`, conferida: true, origem: idDeCitacao("typography", par.no) };
    const antes = Array.isArray(sistema.propostas_de_fonte) ? (sistema.propostas_de_fonte as Array<Record<string, unknown>>) : [];
    const lista = [proposta as Record<string, unknown>].concat(antes.filter((x) => !(x.titulo === par.titulo && x.texto === par.texto))).slice(0, 6);
    const base = comRotulos({ ...baseDaMarcaDe(p), par: { id: par.no, origem: "equipe" as const } });
    const projeto = await gravarProjeto(p, { dados: dadosComParte(p.dados, "sistema", { propostas_de_fonte: lista, base_de_design: base }) });
    return json({ projeto, proposta, custo_usd: 0 });
  }
  throw new ErroHttp(400, "tipo_invalido", "Use tipo paleta ou fonte.");
}

export const ROTAS_DA_BASE_DA_MARCA: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  base_sugerir_marca: baseSugerirMarca,
  paleta_do_setor: paletaDoSetorAcao,
  pares_da_base: paresDaBaseAcao,
  base_salvar_marca: baseSalvarMarca,
  base_proposta: baseProposta,
};
