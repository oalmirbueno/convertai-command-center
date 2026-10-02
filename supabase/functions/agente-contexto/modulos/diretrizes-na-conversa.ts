/**
 * Diretrizes na conversa do agente de contexto (frente CI, 02/10/2026).
 *
 * Pedido do dono: "o agente de contexto tem que ser muito mais inteligente.
 * Tem que testar. Tudo que eu mandar ali, com base na marca e no contexto,
 * ele já tem que alterar e fazer" ("não quero que o perfil siga aquele",
 * "isso está muito ruim", "o cliente não gostou de X"). E "ler os perfis de
 * referência e gerar toda a base a partir deles (identidade, vídeo e
 * pegada)", refletindo em todas as mesas da marca.
 *
 * O caminho de cada mensagem:
 * 1. o modelo da conversa devolve `diretrizes` (evitar, preferir, remover,
 *    excluir_perfis, voltar_a_seguir), além do kit de sempre;
 * 2. o Jev julga se é um ajuste duradouro (não uma pergunta) e resolve qual
 *    perfil cadastrado o dono quis dizer com "aquele" (perguntasDoJev);
 * 3. vira uma ação JÁ FEITA, com Desfazer (sem custo e com reverso: regra 6
 *    do contrato em _shared/acoes-do-agente.ts), gravada em
 *    contexto.diretrizes da marca aberta (o kit do cliente, ou a linha da
 *    outra marca em cliente_marcas: nunca a de outra marca);
 * 4. o agente TESTA: relê o banco (conferirNoBanco) e monta o bloco que cada
 *    mesa lê (conferirNasMesas) para provar que a mudança chegou lá, e diz o
 *    resultado na resposta.
 *
 * A síntese dos perfis de referência (custo de IA, pede Confirmar) usa os
 * resumos e as leituras que a função perfis-instagram já guardou
 * (cliente_perfis_instagram e cliente_perfis_posts), sem raspar nada; o
 * perfil excluído não entra.
 *
 * Sem import de Deno: o vitest lê este arquivo com um banco falso. Sem travessão.
 */
import { type AcaoDoAgente, type ItemDaAcaoDoAgente, type RegraDaOperacao, type ResultadoDoItem, TIPO_DA_ACAO } from "../../_shared/acoes-do-agente.ts";
import {
  aplicarMudancas,
  AREAS_DA_DIRETRIZ,
  blocoTraz,
  chaveDoTexto,
  type Conferencia,
  conferirMudancas,
  type DesfazerDasDiretrizes,
  diretrizValeNaArea,
  handleDoPerfil,
  type IdentidadeDeReferencia,
  type MudancasNasDiretrizes,
  mudancasVazias,
  normalizarDiretrizes,
  normalizarMudancas,
  reverterMudancas,
  ROTULO_DA_AREA_DA_DIRETRIZ,
  semMudancas,
  trocarIdentidade,
} from "../../_shared/diretrizes-da-marca.ts";
import { type AreaDoContexto, montarBlocoDoPacote, type PacoteDaMarca, type ParteDoContexto } from "../../_shared/contexto-completo-regras.ts";
import type { PerguntaJev, RespostaJev } from "../../_shared/jev.ts";

// deno-lint-ignore no-explicit-any
export type BancoDasDiretrizes = { from: (tabela: string) => any };

export const OPERACAO_DAS_DIRETRIZES = "ajustar_diretrizes";
export const MAX_ITENS_DAS_DIRETRIZES = 12;

/** Sem custo e com Desfazer: vai direto (regra 6). */
export const REGRAS_DAS_DIRETRIZES: Record<string, Pick<RegraDaOperacao, "direta">> = { [OPERACAO_DAS_DIRETRIZES]: { direta: true } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const linha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

// ------------------------------------------------------------------ o que o modelo devolve

const NOVA_DIRETRIZ = {
  type: "object",
  additionalProperties: false,
  required: ["texto", "area", "origem"],
  properties: {
    texto: { type: "string" },
    area: { type: "string", enum: AREAS_DA_DIRETRIZ.slice() },
    origem: { type: "string", enum: ["dono", "cliente"] },
  },
};

/** Propriedade `diretrizes` do esquema da conversa (sem união: listas vazias quando não há nada). */
export const ESQUEMA_DAS_DIRETRIZES = {
  type: "object",
  additionalProperties: false,
  required: ["evitar", "preferir", "remover", "excluir_perfis", "voltar_a_seguir"],
  properties: {
    evitar: { type: "array", items: NOVA_DIRETRIZ },
    preferir: { type: "array", items: NOVA_DIRETRIZ },
    remover: { type: "array", items: { type: "string" } },
    excluir_perfis: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["handle", "motivo"], properties: { handle: { type: "string" }, motivo: { type: "string" } } },
    },
    voltar_a_seguir: { type: "array", items: { type: "string" } },
  },
};

export const REGRAS_DAS_DIRETRIZES_NO_PROMPT = `- diretrizes: TODA mensagem com preferência, reclamação, elogio com instrução ou pedido do cliente sobre como a marca deve (ou não deve) ser feita vira diretriz concreta, aplicada na hora em todas as mesas da marca:
  - "isso está muito ruim" sobre algo da conversa: evitar O QUE foi ruim, concreto e aplicável ("fundo rosa chapado com texto pequeno nas artes", nunca "coisa ruim"). Se não der para saber o que foi ruim, pergunte na resposta e devolva as listas vazias.
  - "o cliente não gostou de X": evitar X com origem "cliente". "o cliente adorou Y" / "quero mais Z": preferir.
  - "não quero que o perfil siga aquele" / "tira o @fulano": excluir_perfis com o @ da lista PERFIS DE REFERÊNCIA DA MARCA (motivo curto). "pode voltar a usar o @x": voltar_a_seguir.
  - mudou de ideia sobre algo que já está nas diretrizes: remover (o texto que sai).
  - area: arte, video, copy, foto, ads ou geral (vale em tudo). Uma ideia por item, até 8 por lista.
  - se a diretriz também muda estilo, regras ou tom do kit, mude esses campos também.
  - nada disso na mensagem: todas as listas vazias. Pergunta, hipótese ou pedido de uma peça só não é diretriz.
- Na resposta, diga em uma frase o que mudou e que todas as mesas da marca já recebem; o painel confere sozinho e mostra o teste.`;

export function mudancasDoModelo(bruto: unknown): MudancasNasDiretrizes | null {
  return normalizarMudancas(bruto);
}

// ------------------------------------------------------------------ Jev: é ajuste duradouro? e qual perfil?

export type PerfilDaMarca = { handle: string; nome: string | null; excluido?: boolean };

export type PerguntasDoJev = { state: Record<string, unknown>; questions: Record<string, PerguntaJev>; perfilDaPergunta: Record<string, string> };

/**
 * As perguntas do Jev para as mudanças que o modelo devolveu: `ajuste`
 * (noul: a mensagem pede mudança duradoura?) e, para cada @ que não está
 * entre os perfis cadastrados, `perfil_N` (choice: qual perfil o dono quis
 * dizer, ou nenhum).
 */
export function perguntasDoJev(mensagem: string, anteriores: string[], m: MudancasNasDiretrizes, perfis: PerfilDaMarca[]): PerguntasDoJev {
  const cadastrados = perfis.map((p) => p.handle);
  const questions: Record<string, PerguntaJev> = {
    ajuste: {
      type: "noul",
      instructions:
        "A última mensagem da equipe expressa uma preferência, reclamação, instrução ou pedido do cliente sobre como esta marca deve (ou não deve) ser feita daqui em diante, e as mudanças propostas traduzem isso com fidelidade? Pergunta, hipótese, conversa solta ou pedido de uma peça só não contam.",
      criteria: { true: "sim, é um ajuste duradouro e as mudanças batem com o pedido", false: "não, é pergunta, hipótese, peça pontual ou as mudanças não batem" },
    },
  };
  const perfilDaPergunta: Record<string, string> = {};
  const pedidos = m.excluir_perfis.map((e) => e.handle).concat(m.voltar_a_seguir).filter((h) => cadastrados.indexOf(h) < 0);
  if (perfis.length) {
    pedidos.slice(0, 4).forEach((h, i) => {
      const criteria: Record<string, string> = {};
      perfis.slice(0, 12).forEach((p, j) => {
        criteria[`p${j + 1}`] = `O perfil @${p.handle}${p.nome ? ` (${p.nome})` : ""}, de \`perfis[${j}]\`.`;
      });
      criteria.nenhum = "Nenhum dos perfis cadastrados: o dono falou de outro perfil ou não dá para saber.";
      questions[`perfil_${i + 1}`] = {
        type: "choice",
        instructions: `Na conversa, a equipe pediu para mudar o que a marca segue sobre "${h}". Qual perfil cadastrado ela quis dizer?`,
        criteria,
      };
      perfilDaPergunta[`perfil_${i + 1}`] = h;
    });
  }
  return {
    state: {
      mensagem: linha(mensagem, 1500),
      conversa_anterior: anteriores.slice(-4).map((t) => linha(t, 400)),
      mudancas_propostas: m,
      perfis: perfis.slice(0, 12).map((p) => ({ handle: `@${p.handle}`, nome: p.nome, ja_excluido: !!p.excluido })),
    },
    questions,
    perfilDaPergunta,
  };
}

export const MINIMO_DO_AJUSTE = 0.25;

/**
 * Lê as respostas do Jev. Ajuste com probabilidade abaixo do mínimo: nada é
 * gravado. Perfil resolvido troca o @; "nenhum" (ou incerto) só fica quando
 * a equipe escreveu o @ com todas as letras.
 */
export function mudancasComOJev(
  m: MudancasNasDiretrizes,
  mensagem: string,
  perfis: PerfilDaMarca[],
  respostas: Record<string, RespostaJev> | null,
  perfilDaPergunta: Record<string, string>,
): { mudancas: MudancasNasDiretrizes | null; motivo: string | null } {
  if (respostas) {
    const p = respostas.ajuste && typeof respostas.ajuste.noul === "number" ? respostas.ajuste.noul : null;
    if (p !== null && p < MINIMO_DO_AJUSTE) return { mudancas: null, motivo: "o Jev leu como pergunta ou pedido pontual, não como ajuste duradouro" };
  }
  const escrito = chaveDoTexto(mensagem);
  const cadastrados = perfis.map((x) => x.handle);
  const trocar: Record<string, string | null> = {};
  for (const q of Object.keys(perfilDaPergunta)) {
    const original = perfilDaPergunta[q];
    const r = respostas ? respostas[q] : undefined;
    const n = r && typeof r.choice === "string" && r.choice !== "nenhum" && !(typeof r.confidence === "number" && r.confidence < 0.5) ? Number(r.choice.replace(/^p/, "")) : NaN;
    trocar[original] = Number.isInteger(n) && n >= 1 && n <= perfis.length ? perfis[n - 1].handle : null;
  }
  const resolver = (h: string): string | null => {
    if (cadastrados.indexOf(h) >= 0) return h;
    if (trocar[h]) return trocar[h];
    return escrito.indexOf(`@${h}`) >= 0 ? h : null;
  };
  const excluir: MudancasNasDiretrizes["excluir_perfis"] = [];
  for (const e of m.excluir_perfis) {
    const h = resolver(e.handle);
    if (h && !excluir.some((x) => x.handle === h)) excluir.push({ handle: h, motivo: e.motivo });
  }
  const voltar = m.voltar_a_seguir.map(resolver).filter((h): h is string => !!h).filter((h, i, a) => a.indexOf(h) === i);
  const saida: MudancasNasDiretrizes = { ...m, excluir_perfis: excluir, voltar_a_seguir: voltar };
  return semMudancas(saida) ? { mudancas: null, motivo: "o perfil citado não foi achado entre os da marca" } : { mudancas: saida, motivo: null };
}

// ------------------------------------------------------------------ a ação (feita na hora, com Desfazer)

const UMA_MUDANCA = (parte: Partial<MudancasNasDiretrizes>): MudancasNasDiretrizes => ({ ...mudancasVazias(), ...parte });

/** Uma linha por mudança no cartão; cada item leva só a mudança dele. */
export function acaoDasDiretrizes(
  m: MudancasNasDiretrizes,
  alvo: { clientId: string; marcaId: string | null; marcaNome: string | null },
  id?: string,
): AcaoDoAgente | null {
  const itens: ItemDaAcaoDoAgente[] = [];
  const dados: Record<string, Record<string, unknown>> = {};
  const marcaId = alvo.marcaId && UUID.test(alvo.marcaId) ? alvo.marcaId : null;
  const add = (ref: string, titulo: string, detalhe: string | null, parte: Partial<MudancasNasDiretrizes>) => {
    if (itens.length >= MAX_ITENS_DAS_DIRETRIZES) return;
    itens.push({ ref, alvo_id: "diretrizes", titulo: linha(titulo, 200), detalhe, operacao: OPERACAO_DAS_DIRETRIZES, rotulo: "gravar", para: null });
    dados[`${OPERACAO_DAS_DIRETRIZES}:${ref}`] = { mudancas: UMA_MUDANCA(parte), marca_id: marcaId };
  };
  const detalhe = (area: string, origem: string) => [area !== "geral" ? `nas ${ROTULO_DA_AREA_DA_DIRETRIZ[area as keyof typeof ROTULO_DA_AREA_DA_DIRETRIZ]}` : "em tudo", origem === "cliente" ? "o cliente pediu" : ""].filter(Boolean).join(" · ");
  m.remover.forEach((r, i) => add(`x${i + 1}`, `Tirar das diretrizes: ${r}`, null, { remover: [r] }));
  m.evitar.forEach((n, i) => add(`v${i + 1}`, `Evitar: ${n.texto}`, detalhe(n.area, n.origem), { evitar: [n] }));
  m.preferir.forEach((n, i) => add(`f${i + 1}`, `Preferir: ${n.texto}`, detalhe(n.area, n.origem), { preferir: [n] }));
  m.excluir_perfis.forEach((e, i) => add(`n${i + 1}`, `Não seguir @${e.handle}`, e.motivo || "sai da identidade de referência e de todas as mesas", { excluir_perfis: [e] }));
  m.voltar_a_seguir.forEach((h, i) => add(`s${i + 1}`, `Voltar a seguir @${h}`, null, { voltar_a_seguir: [h] }));
  if (!itens.length) return null;
  const onde = alvo.marcaNome ? ` da ${alvo.marcaNome}` : "";
  return {
    tipo: TIPO_DA_ACAO,
    agente: "contexto",
    id: id || `diretrizes-${Date.now().toString(36)}`,
    resumo: `Ajustei as diretrizes${onde} (${itens.length} ${itens.length === 1 ? "mudança" : "mudanças"}). Todas as mesas da marca já leem.`,
    itens,
    ignorados: [],
    recusados: [],
    contexto: { client_id: alvo.clientId, tipo: "diretrizes_na_conversa", marca_id: marcaId, dados },
  };
}

/** As mudanças que deram certo numa ação feita (para a conferência). */
export function mudancasFeitas(acao: AcaoDoAgente): MudancasNasDiretrizes {
  const total = mudancasVazias();
  const ok = new Set((acao.resultados || []).filter((r) => r.ok && r.desfazer).map((r) => `${r.operacao}:${r.ref}`));
  const dados = ((acao.contexto || {}) as Record<string, unknown>).dados as Record<string, Record<string, unknown>> | undefined;
  for (const it of acao.itens) {
    const k = `${it.operacao}:${it.ref}`;
    if (!ok.has(k) || !dados || !dados[k]) continue;
    const m = normalizarMudancas(dados[k].mudancas);
    if (!m) continue;
    total.evitar.push(...m.evitar);
    total.preferir.push(...m.preferir);
    total.remover.push(...m.remover);
    total.excluir_perfis.push(...m.excluir_perfis);
    total.voltar_a_seguir.push(...m.voltar_a_seguir);
  }
  return total;
}

// ------------------------------------------------------------------ banco: ler e gravar o contexto da marca

export type DependenciasDasDiretrizes = { userId: string; agora?: () => string; gerarId?: () => string };

const agoraDe = (deps: DependenciasDasDiretrizes) => (deps.agora ? deps.agora() : new Date().toISOString());
let contador = 0;
const idDe = (deps: DependenciasDasDiretrizes) => (deps.gerarId ? deps.gerarId() : `d${Date.now().toString(36)}${(contador++).toString(36)}`);

/**
 * O contexto onde as diretrizes da marca moram: a linha da outra marca
 * (cliente_marcas, presa ao cliente) ou o kit do cliente (cliente e marca
 * principal). Nunca o de outra marca.
 */
export async function lerContextoDoAlvo(db: BancoDasDiretrizes, clientId: string, marcaId: string | null): Promise<{ contexto: Record<string, unknown>; existe: boolean }> {
  if (marcaId) {
    const { data, error } = await db.from("cliente_marcas").select("id, client_id, principal, contexto").eq("id", marcaId).eq("client_id", clientId).maybeSingle();
    if (error) throw new Error("Não foi possível ler o contexto da marca.");
    const m = data as { client_id: string; principal: boolean; contexto: unknown } | null;
    if (!m || m.client_id !== clientId) throw new Error("Esta marca não é mais deste cliente.");
    const c = m.contexto && typeof m.contexto === "object" && !Array.isArray(m.contexto) ? (m.contexto as Record<string, unknown>) : {};
    return { contexto: { ...c }, existe: true };
  }
  const { data, error } = await db.from("cliente_kit_marca").select("contexto").eq("client_id", clientId).maybeSingle();
  if (error) throw new Error("Não foi possível ler o contexto do cliente.");
  const c = (data as { contexto?: unknown } | null)?.contexto;
  return { contexto: c && typeof c === "object" && !Array.isArray(c) ? { ...(c as Record<string, unknown>) } : {}, existe: !!data };
}

export async function gravarContextoDoAlvo(db: BancoDasDiretrizes, clientId: string, marcaId: string | null, contexto: Record<string, unknown>, existe: boolean, deps: DependenciasDasDiretrizes) {
  const agora = agoraDe(deps);
  if (marcaId) {
    const { error } = await db.from("cliente_marcas").update({ contexto, atualizado_por: deps.userId, atualizado_em: agora }).eq("id", marcaId).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível gravar as diretrizes da marca.");
    return;
  }
  const { error } = existe
    ? await db.from("cliente_kit_marca").update({ contexto, atualizado_em: agora, atualizado_por: deps.userId }).eq("client_id", clientId)
    : await db.from("cliente_kit_marca").insert({ client_id: clientId, contexto, atualizado_em: agora, atualizado_por: deps.userId });
  if (error) throw new Error("Não foi possível gravar as diretrizes no contexto do cliente.");
}

function cargaDoItem(acao: Pick<AcaoDoAgente, "contexto">, item: Pick<ItemDaAcaoDoAgente, "operacao" | "ref">): Record<string, unknown> {
  const dados = (acao.contexto && (acao.contexto as Record<string, unknown>).dados) as Record<string, Record<string, unknown>> | undefined;
  const c = dados ? dados[`${item.operacao}:${item.ref}`] : undefined;
  if (!c || typeof c !== "object") throw new Error("A ação não tem os dados deste item. Peça de novo ao agente.");
  return c;
}

const marcaDaCarga = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

/** Um item da ação: lê o contexto da marca, aplica a mudança e grava. Devolve o Desfazer. */
export async function executarAjusteDasDiretrizes(
  db: BancoDasDiretrizes,
  clientId: string,
  item: ItemDaAcaoDoAgente,
  acao: Pick<AcaoDoAgente, "contexto">,
  deps: DependenciasDasDiretrizes,
): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string }> {
  const carga = cargaDoItem(acao, item);
  const m = normalizarMudancas(carga.mudancas);
  if (!m) throw new Error("A mudança veio vazia.");
  const marcaId = marcaDaCarga(carga.marca_id);
  const { contexto, existe } = await lerContextoDoAlvo(db, clientId, marcaId);
  const r = aplicarMudancas(contexto.diretrizes, m, { agora: agoraDe(deps), gerarId: () => idDe(deps) });
  if (!r.resumo.length) return { aviso: "já estava assim" };
  await gravarContextoDoAlvo(db, clientId, marcaId, { ...contexto, diretrizes: r.diretrizes }, existe, deps);
  return { desfazer: { marca_id: marcaId, diretrizes: r.desfazer } };
}

/** Desfazer de um item: tira só o que ele pôs e devolve o que ele tirou. */
export async function reverterAjusteDasDiretrizes(db: BancoDasDiretrizes, clientId: string, r: Pick<ResultadoDoItem, "desfazer">, deps: DependenciasDasDiretrizes): Promise<void> {
  const d = (r.desfazer ?? {}) as Record<string, unknown>;
  const marcaId = marcaDaCarga(d.marca_id);
  const { contexto, existe } = await lerContextoDoAlvo(db, clientId, marcaId);
  const novas = reverterMudancas(contexto.diretrizes, d.diretrizes as Partial<DesfazerDasDiretrizes>, agoraDe(deps));
  await gravarContextoDoAlvo(db, clientId, marcaId, { ...contexto, diretrizes: novas }, existe, deps);
}

/** Grava a identidade de referência sintetizada; devolve a de antes para o Desfazer. */
export async function gravarIdentidade(db: BancoDasDiretrizes, clientId: string, marcaId: string | null, identidade: IdentidadeDeReferencia | null, deps: DependenciasDasDiretrizes) {
  const { contexto, existe } = await lerContextoDoAlvo(db, clientId, marcaId);
  const r = trocarIdentidade(contexto.diretrizes, identidade, agoraDe(deps));
  await gravarContextoDoAlvo(db, clientId, marcaId, { ...contexto, diretrizes: r.diretrizes }, existe, deps);
  return { antes: r.antes };
}

// ------------------------------------------------------------------ o agente testa o que fez

/** Relê o contexto da marca no banco e confere cada mudança. */
export async function conferirNoBanco(db: BancoDasDiretrizes, clientId: string, marcaId: string | null, m: MudancasNasDiretrizes): Promise<Conferencia> {
  try {
    const { contexto } = await lerContextoDoAlvo(db, clientId, marcaId);
    return conferirMudancas(normalizarDiretrizes(contexto.diretrizes), m);
  } catch (e) {
    return { ok: false, conferidos: [], faltaram: [`não deu para reler o banco (${e instanceof Error ? e.message : "erro"})`] };
  }
}

/**
 * As mesas que o agente confere: cada uma com a área, as partes e o teto que
 * a função dela pede ao contexto completo (contextoCompletoParaPrompt).
 */
export const MESAS_CONFERIDAS: Array<{ nome: string; area: AreaDoContexto; partes: ParteDoContexto[]; teto: number }> = [
  { nome: "Estúdio de artes", area: "arte", partes: ["contexto", "estrategia", "briefing", "decisoes", "instagram"], teto: 4000 },
  { nome: "Vídeos", area: "video", partes: ["kit", "estrategia", "briefing", "decisoes", "cerebro"], teto: 5000 },
  { nome: "Roteiros e Motion", area: "video", partes: ["marca", "estrategia", "briefing", "decisoes", "instagram"], teto: 3500 },
  { nome: "Foto", area: "foto", partes: ["estrategia", "briefing", "decisoes", "instagram"], teto: 4000 },
  { nome: "Ads", area: "ads", partes: ["estrategia", "decisoes", "instagram"], teto: 3500 },
  { nome: "Copy", area: "copy", partes: ["marca", "kit", "contexto", "estrategia", "briefing", "decisoes", "cerebro"], teto: 7000 },
  { nome: "Calendário e Instagram", area: "calendario", partes: ["estrategia", "briefing", "decisoes"], teto: 5000 },
  { nome: "Site", area: "site", partes: ["estrategia", "briefing", "decisoes", "cerebro"], teto: 6000 },
];

/**
 * Monta, com o pacote relido, o bloco de cada mesa e confere que cada
 * diretriz nova (da área dela) e cada @ excluído estão lá; o perfil que
 * voltou a valer não pode aparecer como excluído.
 */
export function conferirNasMesas(pacote: PacoteDaMarca, m: MudancasNasDiretrizes): { ok: boolean; mesas: string[]; faltaram: string[] } {
  const mesas: string[] = [];
  const faltaram: string[] = [];
  for (const mesa of MESAS_CONFERIDAS) {
    const bloco = montarBlocoDoPacote(pacote, { area: mesa.area, partes: mesa.partes, teto: mesa.teto, semTitulo: true });
    const esperados = m.evitar.concat(m.preferir).filter((n) => diretrizValeNaArea(n, mesa.area)).map((n) => n.texto.slice(0, 40));
    const handles = m.excluir_perfis.map((e) => `@${e.handle}`);
    const linhaDosExcluidos = bloco.split("\n").filter((l) => l.indexOf("NÃO segue") >= 0)[0] || "";
    const ok = esperados.every((t) => blocoTraz(bloco, t)) && handles.every((h) => blocoTraz(linhaDosExcluidos, h)) &&
      m.voltar_a_seguir.every((h) => !blocoTraz(linhaDosExcluidos, `@${h}`));
    (ok ? mesas : faltaram).push(mesa.nome);
  }
  return { ok: faltaram.length === 0, mesas, faltaram };
}

/** Kit que a conversa mudou (estilo, regras, paleta, campos do contexto): está mesmo gravado? */
export function conferirKit(kit: { estilo?: string | null; regras?: string | null; paleta?: unknown; contexto?: Record<string, unknown> | null } | null, acao: AcaoDoAgente): Conferencia {
  const conferidos: string[] = [];
  const faltaram: string[] = [];
  const dados = ((acao.contexto || {}) as Record<string, unknown>).dados as Record<string, Record<string, unknown>> | undefined;
  const ok = new Set((acao.resultados || []).filter((r) => r.ok).map((r) => `${r.operacao}:${r.ref}`));
  const igual = (a: unknown, b: unknown) => linha(a, 4000) === linha(b, 4000);
  for (const it of acao.itens) {
    const k = `${it.operacao}:${it.ref}`;
    const c = dados ? dados[k] : undefined;
    if (!ok.has(k) || !c) continue;
    if (it.operacao === "kit_estilo") (igual(kit && kit.estilo, c.estilo) ? conferidos : faltaram).push("estilo");
    else if (it.operacao === "kit_regras") (igual(kit && kit.regras, c.regras) ? conferidos : faltaram).push("regras");
    else if (it.operacao === "kit_paleta") {
      const hex = (v: unknown) => (Array.isArray(v) ? v : []).map((p) => linha(p && (p as Record<string, unknown>).hex, 7).toUpperCase()).join(" ");
      (hex(kit && kit.paleta) === hex(c.paleta) ? conferidos : faltaram).push("paleta");
    } else if (it.operacao === "preencher_contexto") {
      const campo = String(c.campo || "");
      (igual(kit && kit.contexto ? kit.contexto[campo] : null, c.valor) ? conferidos : faltaram).push(campo.replace(/_/g, " "));
    }
  }
  return { ok: faltaram.length === 0, conferidos, faltaram };
}

/** A frase do teste na resposta do agente. */
export function textoDoTeste(banco: Conferencia | null, mesas: { ok: boolean; mesas: string[]; faltaram: string[] } | null, kit: Conferencia | null): string {
  const partes: string[] = [];
  const total = (banco ? banco.conferidos.length + banco.faltaram.length : 0) + (kit ? kit.conferidos.length + kit.faltaram.length : 0);
  if (!total) return "";
  const certos = (banco ? banco.conferidos.length : 0) + (kit ? kit.conferidos.length : 0);
  const faltas = (banco ? banco.faltaram : []).concat(kit ? kit.faltaram : []);
  partes.push(faltas.length ? `Teste: reli o banco e ${certos} de ${total} ${total === 1 ? "mudança está" : "mudanças estão"} gravadas; não gravou: ${faltas.slice(0, 4).join(", ")}.` : `Teste: reli o banco e ${total === 1 ? "a mudança está gravada" : `as ${total} mudanças estão gravadas`}.`);
  if (mesas) {
    if (mesas.ok) partes.push(`Conferi o que as mesas leem e já está em todas (${mesas.mesas.join(", ")}).`);
    else partes.push(`Ainda não aparece no que estas mesas leem: ${mesas.faltaram.join(", ")}${mesas.mesas.length ? ` (já aparece em ${mesas.mesas.join(", ")})` : ""}.`);
  }
  return partes.join(" ");
}

// ------------------------------------------------------------------ síntese dos perfis de referência

export const MAX_PERFIS_NA_SINTESE = 6;
export const MAX_POSTS_POR_PERFIL_NA_SINTESE = 10;
export const CUSTO_ESTIMADO_DA_SINTESE_USD = 0.02;

export type PostParaSintese = {
  formato: string | null;
  formato_editorial: string | null;
  legenda: string | null;
  leitura: string | null;
  engajamento: number | null;
  fora_da_curva: boolean | null;
};
export type PerfilParaSintese = { handle: string; nome: string | null; resumo: Record<string, unknown> | null; posts: PostParaSintese[] };

const ehVideo = (f: string | null) => f === "reel" || f === "video";

/** Os posts que mais dizem do perfil: os lidos e com mais engajamento, sempre com até 3 vídeos. */
export function escolherPostsParaSintese(posts: PostParaSintese[], max = MAX_POSTS_POR_PERFIL_NA_SINTESE): PostParaSintese[] {
  const peso = (p: PostParaSintese) => (p.leitura ? 1000 : 0) + (p.fora_da_curva ? 500 : 0) + (Number(p.engajamento) || 0);
  const ordenados = posts.slice().sort((a, b) => peso(b) - peso(a));
  const videos = ordenados.filter((p) => ehVideo(p.formato)).slice(0, 3);
  const resto = ordenados.filter((p) => videos.indexOf(p) < 0);
  return videos.concat(resto).slice(0, max);
}

/** O texto que o modelo lê: resumo de cada perfil e os posts escolhidos (só o que a perfis-instagram já guardou). */
export function entradaDaSintese(perfis: PerfilParaSintese[], nomeDaMarca: string): string {
  const blocos = perfis.slice(0, MAX_PERFIS_NA_SINTESE).map((p) => {
    const r = p.resumo || {};
    const resumo = ["padrao_visual", "padrao_editorial", "o_que_funciona", "o_que_evitar"]
      .map((k) => (r[k] ? `${k.replace(/_/g, " ")}: ${linha(r[k], 500)}` : ""))
      .filter(Boolean);
    const posts = escolherPostsParaSintese(p.posts).map((x, i) =>
      `  ${i + 1}. ${x.formato || "post"}${x.formato_editorial ? `, ${x.formato_editorial}` : ""}${x.fora_da_curva ? ", fora da curva" : ""}${x.leitura ? `. Visual: ${linha(x.leitura, 350)}` : ""}${x.legenda ? `. Legenda: ${linha(x.legenda, 220)}` : ""}`
    );
    return [`PERFIL @${p.handle}${p.nome ? ` (${linha(p.nome, 60)})` : ""}`, resumo.length ? resumo.join("\n") : "sem resumo ainda", posts.length ? `Posts:\n${posts.join("\n")}` : "sem posts lidos"].join("\n");
  });
  return `MARCA: ${linha(nomeDaMarca, 80)}\n\n${blocos.join("\n\n")}`;
}

export const ESQUEMA_DA_SINTESE = {
  nome: "identidade_das_referencias",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["visual", "video", "tom", "formatos", "levar", "nao_levar", "por_perfil"],
    properties: {
      visual: { type: "string" },
      video: { type: "string" },
      tom: { type: "string" },
      formatos: { type: "string" },
      levar: { type: "string" },
      nao_levar: { type: "string" },
      por_perfil: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["handle", "visual", "video", "tom", "formatos"],
          properties: { handle: { type: "string" }, visual: { type: "string" }, video: { type: "string" }, tom: { type: "string" }, formatos: { type: "string" } },
        },
      },
    },
  },
};

export const SISTEMA_DA_SINTESE = `Você é o diretor de criação de uma agência. Recebe os perfis do Instagram que a marca usa como referência (o resumo de cada um e os posts com a descrição visual, o formato e a legenda) e escreve a IDENTIDADE DE REFERÊNCIA que todas as mesas (artes, vídeos, motion, foto, anúncios e textos) vão seguir para esta marca.
- visual: grid, enquadramento, luz, paleta aproximada, tipografia, relação foto e texto (3 a 5 frases técnicas).
- video: a pegada dos vídeos e reels: ritmo e cortes, gancho dos primeiros segundos, câmera (mão, tripé, POV), quem aparece, texto na tela, áudio e duração aparente. Sem vídeo nos dados: diga "sem vídeo nas referências".
- tom: como os perfis falam (pessoa, energia, gírias, tamanho da legenda, chamada).
- formatos: os formatos e séries que mais funcionam (com o porquê em números quando houver).
- levar: o que adaptar para a marca; nao_levar: o que não serve para ela (copiar texto, identidade ou rosto de outro perfil nunca).
- por_perfil: uma linha curta de cada perfil (handle sem @).
Só o que está nos dados; nada inventado. Português do Brasil, sem travessão.`;

/** A resposta do modelo vira a identidade gravada (só os perfis que entraram). */
export function identidadeDaSintese(bruto: unknown, perfis: PerfilParaSintese[], agora: string): IdentidadeDeReferencia | null {
  const j = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const usados = perfis.slice(0, MAX_PERFIS_NA_SINTESE).map((p) => p.handle);
  const porPerfil = (Array.isArray(j.por_perfil) ? j.por_perfil : [])
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>;
      const h = handleDoPerfil(r.handle);
      return h && usados.indexOf(h) >= 0 ? { handle: h, visual: linha(r.visual, 400), video: linha(r.video, 400), tom: linha(r.tom, 300), formatos: linha(r.formatos, 300) } : null;
    })
    .filter((x): x is IdentidadeDeReferencia["por_perfil"][number] => !!x);
  const ident: IdentidadeDeReferencia = {
    visual: linha(j.visual, 900),
    video: linha(j.video, 900),
    tom: linha(j.tom, 600),
    formatos: linha(j.formatos, 600),
    levar: linha(j.levar, 600),
    nao_levar: linha(j.nao_levar, 600),
    perfis: usados,
    por_perfil: porPerfil,
    posts: perfis.slice(0, MAX_PERFIS_NA_SINTESE).reduce((s, p) => s + escolherPostsParaSintese(p.posts).length, 0),
    gerado_em: agora,
  };
  return ident.visual || ident.video || ident.tom || ident.formatos ? ident : null;
}

/** A exclusão de agora tirou um perfil da síntese gravada? (então a síntese precisa ser refeita) */
export function sintesePrecisaRefazer(identidadePerfis: string[] | null | undefined, m: MudancasNasDiretrizes): boolean {
  const lista = identidadePerfis || [];
  return m.excluir_perfis.some((e) => lista.indexOf(e.handle) >= 0) || (m.voltar_a_seguir.length > 0 && lista.length > 0);
}
