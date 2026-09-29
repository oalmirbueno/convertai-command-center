import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente AG2 (29/09/2026), agente de estilo (estilo do cliente e templates).
 * Pedido do dono: "todos mais inteligentes, funcionais, sem bugs, agênticos e
 * completos" e "nada inventado". Confere:
 * 1. Evidência fraca (o caso real de 27/09: sem kit, sem referência, sem arte
 *    aprovada): o guia proposto vira rascunho provisório, não liga junto, e a
 *    resposta diz o que falta.
 * 2. Ações novas: ajustar um campo, aprovar/descartar teste (x*), estilo e
 *    template na peça (p*), com regra 6 (sem custo e com Desfazer vai direto;
 *    teste com custo e aprovar pedem Confirmar).
 * 3. Servidor: a troca é gravada por gravarTroca (sem insert em lote que
 *    engolia o erro), com aviso_registro; leitura única do Estúdio; rotas do
 *    aprendizado; "essa/a segunda" pelo Jev na lista da tela.
 * 4. Aprendizado ligado ao estilo: regra criada e obedecida (bloco no sistema
 *    do modelo e EVITAR no prompt do teste), pedido de uma vez só não vira
 *    regra, Esquecer desliga, repetida reforça.
 * 5. Tela: mensagem que falha sai da lista e o texto volta ao campo com o erro;
 *    aviso de resposta não guardada; uma chamada só para o botão, o
 *    interruptor e o seletor do Estúdio.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: new Error("sem") }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

// O jsdom não tem AbortSignal.timeout (o Jev usa para o tempo limite).
if (typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () => new AbortController().signal;
}

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import BotaoDoEstilo from "@/components/estilo/BotaoDoEstilo";
import { normalizarLeituraDoEstudio, versaoProvisoria } from "@/components/estilo/estiloApi";
import { estiloVazio, regrasVazias, type EstiloDoCliente } from "../../supabase/functions/_shared/estilo-do-cliente";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { aprenderDoPedido, regrasDaMesa, rotasDoAprendizado, type JulgamentoDoEnsino } from "../../supabase/functions/_shared/aprendizado-das-mesas";
import {
  alvosDoEstilo,
  DIRETAS_DO_ESTILO,
  ehNotaProvisoria,
  ESQUEMA_DO_AGENTE_DE_ESTILO,
  evidenciaDoEstilo,
  fraseDoProvisorio,
  guiaComAjuste,
  lerAjusteDoEstilo,
  lerTemplateDaPeca,
  normalizarAcoesDoEstilo,
  OPERACOES_DO_ESTILO,
  type PecaDaTela,
  SEM_MOTIVO,
} from "../../supabase/functions/agente-estilo/acoes-do-estilo";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const ESTILO_ID = "66666666-6666-4666-8666-666666666666";
const PECA = "88888888-8888-4888-8888-888888888888";
const TPL = "99999999-9999-4999-8999-999999999999";
const TESTE_NOVO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TESTE_APROVADO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TESTE_DESCARTADO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PROPOSTA = { resumo: "Rascunho provisório: hierarquia direta.", regras: { ...regrasVazias(), layout: ["Um elemento dominante por peça"] } };

function estiloCom(extra: Partial<EstiloDoCliente> = {}): EstiloDoCliente {
  return { ...estiloVazio(CLIENTE, null, "tabela"), id: ESTILO_ID, ...extra };
}

const GUIA = { resumo: "Editorial claro.", regras: { ...regrasVazias(), tipografia: ["Título pesado"], cor: ["Verde domina"] }, referencias: [] };
const COM_GUIA = estiloCom({
  versao_atual: 1,
  versoes: [{ numero: 1, guia: GUIA, origem: "equipe", nota: "Primeira", criado_em: "2026-09-26T10:00:00Z", criado_por: null }],
  testes: [
    { id: TESTE_APROVADO, caminho: `${CLIENTE}/estilo/testes/a.png`, tema: "outubro", versao: 1, custo_usd: 0.04, criado_em: "2026-09-26T10:00:00Z", status: "aprovado" },
    { id: TESTE_DESCARTADO, caminho: `${CLIENTE}/estilo/testes/b.png`, tema: "velho", versao: 1, custo_usd: 0.04, criado_em: "2026-09-26T11:00:00Z", status: "descartado" },
    { id: TESTE_NOVO, caminho: `${CLIENTE}/estilo/testes/c.png`, tema: "promoção", versao: 1, custo_usd: 0.04, criado_em: "2026-09-26T12:00:00Z", status: "novo" },
  ],
});

const PECAS: PecaDaTela[] = [
  { id: PECA, titulo: "Post de outubro", detalhe: "post, estilo desligado, template: nenhum", dados: { estilo_ligado: false, template_id: null, template_de_design: null } },
];
const TEMPLATES = [{ id: TPL, ref: "t1", titulo: "Carrossel editorial", detalhe: "referência de carrossel", dados: { tipo: "referencia_carrossel" } }];

// ------------------------------------------------------------------ 1. nada inventado

describe("1. Evidência fraca: nada inventado", () => {
  const vazia = { novas: 0, referenciasNoEstilo: 0, artesAprovadas: 0, candidatasLidas: 0, aprendizados: 0, testesAprovados: 0, temKit: false };

  it("o caso real de 27/09 (sem kit, referência nem arte aprovada) é evidência fraca e diz o que falta", () => {
    const ev = evidenciaDoEstilo(vazia);
    expect(ev.fraca).toBe(true);
    expect(ev.falta).toEqual(expect.arrayContaining(["referências visuais do cliente", "artes aprovadas do cliente", "kit da marca (cores, fontes, logo)"]));
    expect(fraseDoProvisorio(ev)).toMatch(/rascunho provisório/);
    // Kit sozinho não é evidência visual de estilo; uma referência mandada agora já é.
    expect(evidenciaDoEstilo({ ...vazia, temKit: true }).fraca).toBe(true);
    expect(evidenciaDoEstilo({ ...vazia, novas: 2 }).fraca).toBe(false);
    expect(evidenciaDoEstilo({ ...vazia, aprendizados: 1 }).fraca).toBe(false);
  });

  it("com evidência fraca, gravar vira \"rascunho provisório\" e o mesmo cartão não liga o estilo", () => {
    const alvos = alvosDoEstilo(estiloCom(), []);
    const a = normalizarAcoesDoEstilo(
      { resumo: "", itens: [{ operacao: "gravar_estilo", ref: "e1", para: "versão inicial" }, { operacao: "ligar_estilo", ref: "e1", para: "" }] },
      alvos,
      { proposta: PROPOSTA, clientId: CLIENTE, marcaId: null, custoPorImagem: 0.04, provisorio: true },
    )!;
    expect(a.itens.map((i) => i.operacao)).toEqual(["gravar_estilo"]);
    expect(a.itens[0].rotulo).toBe("gravar como rascunho provisório");
    expect((a.contexto as any).provisorio).toBe(true);
    expect(a.recusados[0].motivo).toMatch(/provisório/);
    // Com evidência, o mesmo pedido fica como sempre foi.
    const b = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "gravar_estilo", ref: "e1", para: "x" }] }, alvos, { proposta: PROPOSTA, clientId: CLIENTE, marcaId: null, custoPorImagem: 0 })!;
    expect(b.itens[0].rotulo).toBe("gravar o estilo novo");
    expect((b.contexto as any).provisorio).toBeUndefined();
  });

  it("a nota da versão marca o provisório e a tela lê", () => {
    expect(ehNotaProvisoria("Provisório: sem evidência visual. Versão inicial")).toBe(true);
    expect(ehNotaProvisoria("Editado pela equipe.")).toBe(false);
    expect(versaoProvisoria({ versao_atual: 2, versoes: [{ numero: 2, origem: "agente", nota: "Provisório: sem evidência visual.", criado_em: "", guia: GUIA as any }] })).toBe(true);
    expect(versaoProvisoria({ versao_atual: 1, versoes: [{ numero: 1, origem: "agente", nota: "Primeira", criado_em: "", guia: GUIA as any }] })).toBe(false);
    const idx = ler("supabase/functions/agente-estilo/index.ts");
    expect(idx).toContain("ctx.provisorio === true ? `${PREFIXO_PROVISORIO}: sem evidência visual.");
    expect(idx).toContain("provisorio: evidencia.fraca");
    expect(idx).toContain("NADA INVENTADO (DADOS.evidencia)");
  });
});

// ------------------------------------------------------------------ 2. ações

describe("2. Ações novas do estilo (contrato comum)", () => {
  it("apelidos: testes x* na ordem da aba Testes (mais novo primeiro, sem descartados) e peças p*", () => {
    const a = alvosDoEstilo(COM_GUIA, [], { pecas: PECAS });
    expect(a.testes.map((t) => [t.ref, t.id])).toEqual([["x1", TESTE_NOVO], ["x2", TESTE_APROVADO]]);
    expect(a.pecas.map((p) => p.ref)).toEqual(["p1"]);
    expect(a.todos.every((x) => !/[0-9a-f]{8}-[0-9a-f]{4}/.test(x.ref))).toBe(true);
  });

  it("ajustar um campo: troca só aquele campo, aceita o rótulo da tela, e vai direto (sem custo, com Desfazer)", () => {
    expect(lerAjusteDoEstilo("Tipografia: título condensado | apoio regular")).toEqual({ campo: "tipografia", regras: ["título condensado", "apoio regular"] });
    expect(lerAjusteDoEstilo("resumo: Claro e direto.")).toEqual({ campo: "resumo", regras: ["Claro e direto."] });
    expect(lerAjusteDoEstilo("fonte: x")).toBeNull();
    const g = guiaComAjuste(GUIA as any, { campo: "tipografia", regras: ["título condensado"] });
    expect(g.regras.tipografia).toEqual(["título condensado"]);
    expect(g.regras.cor).toEqual(["Verde domina"]);
    const alvos = alvosDoEstilo(COM_GUIA, []);
    const a = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "ajustar_estilo", ref: "e1", para: "tipografia: título condensado" }] }, alvos, { proposta: null, clientId: CLIENTE, marcaId: null, custoPorImagem: 0 })!;
    expect(a.itens[0].para).toBe("tipografia: título condensado");
    expect(podeExecutarDireto(a, DIRETAS_DO_ESTILO, { pedidoClaro: true }).direto).toBe(true);
  });

  it("gravar a proposta inteira, gerar teste (custo) e aprovar teste (Arquivos) pedem Confirmar", () => {
    const alvos = alvosDoEstilo(COM_GUIA, []);
    const gravar = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "gravar_estilo", ref: "e1", para: "x" }] }, alvos, { proposta: PROPOSTA, clientId: CLIENTE, marcaId: null, custoPorImagem: 0 })!;
    expect(podeExecutarDireto(gravar, DIRETAS_DO_ESTILO, { pedidoClaro: true }).direto).toBe(false);
    const teste = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "gerar_teste", ref: "e1", para: "2" }] }, alvos, { proposta: null, clientId: CLIENTE, marcaId: null, custoPorImagem: 0.05 })!;
    expect(teste.custo_estimado_usd).toBe(0.1);
    expect(podeExecutarDireto(teste, DIRETAS_DO_ESTILO, { pedidoClaro: true }).direto).toBe(false);
    const aprovar = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "aprovar_teste", ref: "x1", para: "" }, { operacao: "aprovar_teste", ref: "x2", para: "" }] }, alvos, { proposta: null, clientId: CLIENTE, marcaId: null, custoPorImagem: 0 })!;
    expect(aprovar.itens.map((i) => i.alvo_id)).toEqual([TESTE_NOVO]);
    expect(aprovar.recusados[0].motivo).toMatch(/já foi aprovado/);
    expect(aprovar.sem_desfazer).toBe(true);
    expect(podeExecutarDireto(aprovar, DIRETAS_DO_ESTILO, { pedidoClaro: true }).direto).toBe(false);
  });

  it("descartar teste: motivo opcional (sem motivo não ensina), vai direto; aprovado não descarta", () => {
    const alvos = alvosDoEstilo(COM_GUIA, []);
    const d = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "descartar_teste", ref: "x1", para: "" }] }, alvos, { proposta: null, clientId: CLIENTE, marcaId: null, custoPorImagem: 0 })!;
    expect(d.itens[0].para).toBe(SEM_MOTIVO);
    expect(podeExecutarDireto(d, DIRETAS_DO_ESTILO, { pedidoClaro: true }).direto).toBe(true);
    const aprovado = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "descartar_teste", ref: "x2", para: "fundo escuro" }] }, alvos, { proposta: null, clientId: CLIENTE, marcaId: null, custoPorImagem: 0 })!;
    expect(aprovado.itens).toEqual([]);
    expect(aprovado.recusados[0].motivo).toMatch(/Arquivos/);
  });

  it("peça aberta: estilo e template na geração, o template vira id no contexto, apelido inventado é ignorado", () => {
    const alvos = alvosDoEstilo(COM_GUIA, [], { pecas: PECAS });
    const a = normalizarAcoesDoEstilo(
      { resumo: "", itens: [{ operacao: "estilo_na_peca", ref: "p1", para: "" }, { operacao: "template_na_peca", ref: "p1", para: "t1:inspirada" }, { operacao: "template_fora_da_peca", ref: "p9", para: "" }] },
      alvos,
      { proposta: null, clientId: CLIENTE, marcaId: null, custoPorImagem: 0, templates: TEMPLATES },
    )!;
    expect(a.itens.map((i) => i.operacao)).toEqual(["estilo_na_peca", "template_na_peca"]);
    expect(a.itens[1].para).toBe("t1:inspirada");
    expect(a.itens[1].para_rotulo).toBe("Carrossel editorial (inspirada)");
    expect((a.contexto as any).templates_da_peca).toEqual({ t1: { id: TPL, tipo: "referencia_carrossel" } });
    expect(a.ignorados).toEqual(["p9"]);
    expect(podeExecutarDireto({ ...a, ignorados: [] }, DIRETAS_DO_ESTILO, { pedidoClaro: true }).direto).toBe(true);
    // Template que não está na lista (t7) não entra; tirar template de peça sem template é recusado.
    const b = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "template_na_peca", ref: "p1", para: "t7" }, { operacao: "template_fora_da_peca", ref: "p1", para: "" }] }, alvos, { proposta: null, clientId: CLIENTE, marcaId: null, custoPorImagem: 0, templates: TEMPLATES })!;
    expect(b.itens).toEqual([]);
    expect(b.recusados.map((r) => r.motivo)).toEqual(["Esta peça não tem template."]);
    expect(lerTemplateDaPeca("t2:criativa")).toEqual({ ref: "t2", nivel: "criativa" });
    expect(lerTemplateDaPeca("t2:qualquer")).toEqual({ ref: "t2", nivel: null });
  });

  it("todas as operações novas estão no esquema e na regra 6", () => {
    for (const op of ["ajustar_estilo", "aprovar_teste", "descartar_teste", "estilo_na_peca", "estilo_fora_da_peca", "template_na_peca", "template_fora_da_peca"]) {
      expect(OPERACOES_DO_ESTILO as readonly string[]).toContain(op);
      expect(DIRETAS_DO_ESTILO[op as keyof typeof DIRETAS_DO_ESTILO]).toBeTruthy();
    }
    const props = ESQUEMA_DO_AGENTE_DE_ESTILO.schema.properties as Record<string, unknown>;
    expect(props.regra_aprendida).toBeTruthy();
    expect(props.regras_seguidas).toBeTruthy();
    expect(ESQUEMA_DO_AGENTE_DE_ESTILO.schema.required).toEqual(expect.arrayContaining(["regra_aprendida", "regras_seguidas"]));
  });
});

// ------------------------------------------------------------------ 3. servidor (código-fonte)

describe("3. Servidor: conversa gravada, leitura única e Desfazer de verdade", () => {
  const idx = ler("supabase/functions/agente-estilo/index.ts");
  const tpl = ler("supabase/functions/agente-estilo/templates.ts");

  it("a troca é gravada por gravarTroca (nada de insert em lote com o erro ignorado) e o aviso volta para a tela", () => {
    for (const f of [idx, tpl]) {
      expect(f).not.toMatch(/from\("agente_mensagens"\)\s*\.insert\(\[/);
      expect(f).toContain("gravarTroca(");
      expect(f).toContain("aviso_registro: AVISO_SEM_REGISTRO");
    }
    expect(idx).toContain("mensagem_id: troca.agenteId");
    // A linha do resultado confere o erro (antes: .then(() => undefined, () => undefined)).
    expect(idx).not.toContain(".then(() => undefined, () => undefined)");
    expect(idx).toContain("linha do resultado não gravada na conversa");
  });

  it("o modelo recebe o estado real: evidência, versão e origem, testes e peças com apelido, regras ensinadas e a referência do pedido", () => {
    expect(idx).toContain("evidencia,");
    expect(idx).toContain("origem_da_versao");
    expect(idx).toContain("${ensinadas.bloco ? `${ensinadas.bloco}\\n\\n` : \"\"}");
    expect(idx).toContain("blocoDaReferencia(referencia, itensReferiveis)");
    expect(idx).toContain("referenciaDoPedido(textoDoPedido, itensReferiveis");
    expect(idx).toContain("pecasDaTela(p.clientId, corpo.trabalho_ids)");
    // Regra 6: ordem clara, sem custo e com Desfazer vai direto, com auditoria.
    expect(idx).toContain("podeExecutarDireto(acao, DIRETAS_DO_ESTILO, { pedidoClaro: true })");
    expect(idx).toContain("ehOrdemClara(textoDoPedido");
    expect(idx).toContain("estilo_acao_direta");
  });

  it("Desfazer volta de verdade: versão, teste descartado, estilo e template da peça", () => {
    for (const tipo of ['d.tipo === "versao"', 'd.tipo === "teste"', 'd.tipo === "peca_estilo" || d.tipo === "peca_template"', 'd.tipo === "ativo"']) expect(idx).toContain(tipo);
    // A escrita na peça confere o cliente no banco (o id vem do contexto, nunca do modelo).
    expect(idx).toContain("if (!t || t.client_id !== clientId) return null;");
    expect(idx).toContain("if (tpl.status !== \"ativo\") throw new Error(\"Este template está arquivado.\");");
  });

  it("o Estúdio lê numa chamada só (estudio_ler) e as rotas do aprendizado estão na função", () => {
    expect(idx).toContain("estudio_ler: estudioLer");
    expect(idx).toContain('...rotasDoAprendizado({ mesa: "estilo"');
    expect(idx).not.toMatch(/estudioLer[\s\S]{0,1500}linksAssinados/);
  });
});

// ------------------------------------------------------------------ 4. aprendizado

type Linha = Record<string, unknown>;

/** agente_memoria em memória, com o encadeamento do supabase-js que o cérebro usa. */
function bancoFalso(inicial: Linha[] = []) {
  const linhas: Linha[] = inicial.map((l) => ({ ativa: true, reforcos: 1, criado_em: "2026-09-01T00:00:00Z", ...l }));
  let n = 0;
  const consulta = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Linha = {};
    let novo: Linha | null = null;
    let limite = Infinity;
    const q: Record<string, unknown> = {};
    const base = () => (tabela === "agente_memoria" ? linhas : []);
    const alvo = () => base().filter((l) => filtros.every((f) => f(l))).slice(0, limite);
    const fim = () => {
      if (op === "update") {
        const a = alvo();
        a.forEach((l) => Object.assign(l, patch));
        return { data: a.map((l) => ({ id: l.id })), error: null };
      }
      if (op === "insert" && novo) return { data: novo, error: null };
      return { data: alvo(), error: null };
    };
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.indexOf(l[c]) >= 0), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      order: () => q,
      limit: (k: number) => ((limite = k), q),
      update: (p: Linha) => ((op = "update"), (patch = p), q),
      insert: (p: Linha) => {
        op = "insert";
        novo = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ativa: true, criado_em: new Date().toISOString(), ...p };
        linhas.push(novo);
        return q;
      },
      single: () => Promise.resolve(fim()),
      maybeSingle: () => Promise.resolve({ data: alvo()[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(fim()).then(ok, erro),
    });
    return q;
  };
  return { db: { from: consulta }, linhas };
}

const duradoura = async (): Promise<JulgamentoDoEnsino> => ({ decisao: "preferencia_duradoura", tipo: "evitar", probabilidade: 0.9, fonte: "jev" });

describe("4. Aprendizado ligado ao agente de estilo", () => {
  it("\"não gostei do fundo escuro\" vira regra do estilo e entra no sistema do modelo e no prompt do teste", async () => {
    const { db, linhas } = bancoFalso();
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "estilo", pedido: "não gostei do fundo escuro, nunca mais", regraSugerida: "Não usar fundo escuro nas artes" }, { julgarEnsino: duradoura, julgarDuplicidade: null });
    expect(a).toEqual(expect.objectContaining({ texto: "Não usar fundo escuro nas artes", categoria: "evitar", mesa: "estilo" }));
    expect(linhas[0]).toEqual(expect.objectContaining({ area: "arte", fonte: "estilo", tipo: "evitar" }));
    const r = await regrasDaMesa(db, { clientId: CLIENTE, mesa: "estilo" });
    expect(r.regras.map((x) => x.ref)).toEqual(["g1"]);
    expect(r.bloco).toContain("EVITAR:\n- g1: Não usar fundo escuro nas artes");
    // Obedecer: o bloco vai no sistema da conversa; o EVITAR vai no fim do prompt do teste (estilo e template).
    const idx = ler("supabase/functions/agente-estilo/index.ts");
    expect(idx).toContain('regrasDaMesa(banco() as never, { clientId: p.clientId, mesa: "estilo", marcaId: p.marcaId })');
    expect(idx).toContain("${promptDoTeste(g!, { cliente, tema, paleta, indices, variacao: k + 1, total: quantos })}${evitar}");
    expect(ler("supabase/functions/agente-estilo/templates.ts")).toContain("${evitar}`,");
  });

  it("pedido de uma vez só não vira regra; repetida reforça (não duplica)", async () => {
    const { db, linhas } = bancoFalso();
    expect(await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "estilo", pedido: "só neste post, fundo mais claro", regraSugerida: "Fundo claro" }, { julgarEnsino: async () => ({ decisao: "so_desta_vez", tipo: "preferencia", probabilidade: 0.8, fonte: "jev" }) })).toBeNull();
    expect(linhas).toHaveLength(0);
    await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "estilo", pedido: "nunca fundo escuro", regraSugerida: "Não usar fundo escuro" }, { julgarEnsino: duradoura, julgarDuplicidade: null });
    const b = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "estilo", pedido: "de novo: nunca fundo escuro", regraSugerida: "Não usar fundo escuro" }, { julgarEnsino: duradoura, julgarDuplicidade: null });
    expect(linhas.filter((l) => l.ativa !== false)).toHaveLength(1);
    expect(b && b.situacao).toBe("reforcado");
  });

  it("Esquecer (rota da função de estilo) desliga a regra do cliente", async () => {
    const { db, linhas } = bancoFalso([{ id: "11111111-2222-4333-8444-555555555555", client_id: CLIENTE, agente: "diretor_arte", area: "arte", tipo: "evitar", categoria: "evitar", texto: "Não usar fundo escuro", fonte: "estilo" }]);
    const garantirAcesso = vi.fn(async () => undefined);
    const rotas = rotasDoAprendizado({ mesa: "estilo", servico: () => db as never, garantirAcesso, json: (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s }) });
    const r = await rotas.aprendizado_esquecer({ userId: "u1" }, { client_id: CLIENTE, id: "11111111-2222-4333-8444-555555555555" });
    expect(r.status).toBe(200);
    expect(garantirAcesso).toHaveBeenCalledWith({ userId: "u1" }, CLIENTE);
    expect(linhas[0].ativa).toBe(false);
    // Descartar teste com motivo ensina (forcar), na tela e no cartão.
    const idx = ler("supabase/functions/agente-estilo/index.ts");
    expect(idx).toContain("pedido: `Descartei o teste do estilo: ${motivo}`, motivo, marcaId: p.marcaId, userId: ch.userId, forcar: true");
  });
});

// ------------------------------------------------------------------ 5. tela

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "AcelerIQ",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

const ESTADO_VAZIO = { client_id: CLIENTE, ativo: false, versao_atual: 0, guia: null, versoes: [], referencias: [], aprendizados: [], testes: [], sugeridas_pelas_entregas: [], conversa_id: null, mensagens: [] };

describe("5. Tela do estilo", () => {
  let conversar: (body: any) => any;
  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      /* sem armazenamento */
    }
    conversar = () => ({ data: { error: "erro_interno", mensagem: "Falha simulada do agente." }, error: null });
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (_fn: string, { body }: { body: any }) => {
      if (body.acao === "estado" && body.leve) return { data: { client_id: CLIENTE, ativo: false, versao_atual: 0 }, error: null };
      if (body.acao === "estado") return { data: ESTADO_VAZIO, error: null };
      if (body.acao === "estudio_ler") return { data: { client_id: CLIENTE, ativo: true, versao_atual: 1, ligados: [], escolhas: {}, templates: [{ id: TPL, nome: "Carrossel editorial", tipo: "template", formato: "carrossel", escopo: "cliente", status: "ativo" }] }, error: null };
      if (body.acao === "templates_estado") return { data: { guardado_em: "tabela", templates: [] }, error: null };
      if (body.acao === "conversar") return conversar(body);
      return { data: {}, error: null };
    });
  });

  async function abrirConversa(trabalhoIds: string[] = []) {
    montar(h(BotaoDoEstilo, { trabalhoIds }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir o agente de estilo do cliente" }));
    return (await screen.findByRole("textbox", { name: "Mensagem ao agente de estilo" }, { timeout: 8000 })) as HTMLTextAreaElement;
  }

  it("envio que falha: a bolha sai, o texto volta ao campo e o erro fica à vista (reenviar não duplica)", async () => {
    const campo = await abrirConversa();
    fireEvent.change(campo, { target: { value: "Monte o estilo deste cliente" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente de estilo" }));
    expect(await screen.findByRole("alert", {}, { timeout: 8000 })).toHaveProperty("textContent", expect.stringContaining("Falha simulada do agente."));
    expect(campo.value).toBe("Monte o estilo deste cliente");
    expect(screen.queryByText("Monte o estilo deste cliente", { selector: "p, span, div" })).toBeNull();
  }, 20_000);

  it("resposta não guardada mostra o aviso; as peças abertas vão junto no pedido", async () => {
    conversar = () => ({ data: { conversa_id: "12121212-1212-4121-8121-121212121212", mensagem_id: null, resposta: "Falta referência visual. Quer mandar?", anexos: [], custo_usd: 0.01, aviso_registro: "A resposta chegou, mas não ficou guardada na conversa." }, error: null });
    const campo = await abrirConversa([PECA]);
    fireEvent.change(campo, { target: { value: "Estude o cliente" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente de estilo" }));
    expect(await screen.findByText("A resposta chegou, mas não ficou guardada na conversa.", {}, { timeout: 8000 })).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith("agente-estilo", { body: expect.objectContaining({ acao: "conversar", trabalho_ids: [PECA] }) });
  }, 20_000);

  it("Estúdio: o botão, o interruptor e o seletor fazem UMA chamada (estudio_ler)", async () => {
    montar(h(BotaoDoEstilo, { trabalhoIds: [PECA] }));
    const chave = await screen.findByRole("switch", { name: "Usar estilo do cliente nesta geração" });
    await waitFor(() => expect(chave.hasAttribute("disabled")).toBe(false));
    expect(await screen.findByRole("button", { name: "Template: Nenhum" }, { timeout: 8000 })).toBeTruthy();
    const acoes = mock.invoke.mock.calls.map((c: any[]) => c[1].body.acao);
    expect(acoes).toEqual(["estudio_ler"]);
  }, 20_000);

  it("leitura do Estúdio normalizada (resposta parcial não quebra)", () => {
    expect(normalizarLeituraDoEstudio(null)).toEqual({ ativo: false, versao_atual: 0, ligados: [], escolhas: {}, templates: [] });
    expect(normalizarLeituraDoEstudio({ templates: [{ id: "x", formato: "??" }] }).templates[0]).toMatchObject({ formato: "post", tipo: "template", status: "ativo" });
  });

  it("arquivos da frente sem travessão", () => {
    for (const p of [
      "supabase/functions/agente-estilo/index.ts",
      "supabase/functions/agente-estilo/acoes-do-estilo.ts",
      "supabase/functions/agente-estilo/templates.ts",
      "src/components/estilo/PainelDoEstilo.tsx",
      "src/components/estilo/estiloApi.ts",
      "src/components/estilo/InterruptorDoEstilo.tsx",
      "src/components/estilo/SeletorDeTemplate.tsx",
      "src/components/estilo/BotaoDoEstilo.tsx",
      "src/components/estilo/AbaTemplates.tsx",
    ]) {
      expect(ler(p), p).not.toMatch(/[\u2014\u2013]/);
    }
  });
});
