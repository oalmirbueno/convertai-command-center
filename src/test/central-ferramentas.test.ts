import { describe, expect, it } from "vitest";
import { comApelido, normalizarAcaoDoAgente, podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { dataValida, PARA, regrasDoGestor } from "../../supabase/functions/gestor-aceleriq/modulos/ferramentas";
import { linhaDeContexto } from "../../supabase/functions/gestor-aceleriq/modulos/hermes";
import { atalhosDaCentral, caminhoEmbutido, enderecoExterno } from "@/lib/centralAtalhos";
// @ts-expect-error módulo .mjs da ponte do servidor do Hermes (sem tipos)
import { ORIGENS_QUE_RECEBEM, ORIGENS_VISIVEIS, mensagemParaOPainel, sessaoParaOPainel } from "../../integrations/hermes-operational/painel_ponte.mjs";

describe("ferramentas do Gestor: argumentos validados", () => {
  it("criar_tarefa exige título, data real e prioridade conhecida", () => {
    expect(JSON.parse(PARA.criar_tarefa('{"titulo":"Roteiro do vídeo","prazo":"2026-10-10","prioridade":"high"}')!)).toEqual({ titulo: "Roteiro do vídeo", prazo: "2026-10-10", prioridade: "high" });
    expect(PARA.criar_tarefa('{"titulo":"ok"}')).toBeNull();
    expect(PARA.criar_tarefa('{"titulo":"Tarefa boa","prazo":"2026-02-30"}')).toBeNull();
    expect(PARA.criar_tarefa('{"titulo":"Tarefa boa","prioridade":"altissima"}')).toBeNull();
    expect(PARA.criar_tarefa("texto solto")).toBeNull();
    expect(dataValida("2026-10-08")).toBe("2026-10-08");
  });

  it("registrar_memoria aceita só os tipos combinados; agente só da lista", () => {
    expect(PARA.registrar_memoria('{"tipo":"preferencia","texto":"Cliente prefere vídeos curtos"}')).toContain("preferencia");
    expect(PARA.registrar_memoria('{"tipo":"fofoca","texto":"qualquer coisa"}')).toBeNull();
    expect(PARA.pedir_ao_agente('{"agente":"atlas","instrucao":"Conferir os links"}', ["atlas"])).toContain("atlas");
    expect(PARA.pedir_ao_agente('{"agente":"inventado","instrucao":"Conferir os links"}', ["atlas"])).toBeNull();
  });

  const alvos = [
    ...comApelido([{ id: "cli-1", titulo: "Acerbi" }], "c"),
    ...comApelido([{ id: "proj-1", titulo: "Institucional" }], "p"),
    ...comApelido([{ id: "task-1", titulo: "Edição dos vídeos", dados: { status: "doing" } }, { id: "task-2", titulo: "Post publicado", dados: { status: "done" } }], "t"),
  ];
  const regras = regrasDoGestor(["atlas"]);

  it("apelido inventado ou operação no alvo errado é ignorado; concluir e aprendizado sem evidência são recusados com motivo", () => {
    const acao = normalizarAcaoDoAgente({ resumo: "x", itens: [
      { operacao: "criar_tarefa", ref: "p1", para: '{"titulo":"Roteiro do vídeo"}' },
      { operacao: "criar_tarefa", ref: "p9", para: '{"titulo":"Inventado"}' },
      { operacao: "criar_tarefa", ref: "t1", para: '{"titulo":"Alvo errado"}' },
      { operacao: "atualizar_tarefa", ref: "t1", para: '{"status":"done"}' },
      { operacao: "registrar_memoria", ref: "c1", para: '{"tipo":"aprendizado","texto":"Reels convertem mais"}' },
    ] }, alvos, regras, { agente: "gestor" })!;
    expect(acao.itens.map((i) => `${i.operacao}:${i.alvo_id}`)).toEqual(["criar_tarefa:proj-1"]);
    expect(acao.ignorados).toEqual(["p9", "t1"]);
    expect(acao.recusados.map((r) => r.motivo)).toEqual([
      "Concluir é na revisão, com prova (Execução ou Kanban), não pelo Gestor.",
      "Aprendizado só com evidência (resultado medido ou fonte); sem isso é hipótese.",
    ]);
  });

  it("vai direto só com ordem clara e operações com Desfazer; pedir a agente sempre pede Confirmar", () => {
    const criar = normalizarAcaoDoAgente({ resumo: "x", itens: [{ operacao: "criar_tarefa", ref: "p1", para: '{"titulo":"Roteiro do vídeo"}' }] }, alvos, regras, { agente: "gestor" })!;
    expect(podeExecutarDireto(criar, regras, { pedidoClaro: true }).direto).toBe(true);
    expect(podeExecutarDireto(criar, regras, { pedidoClaro: false }).direto).toBe(false);
    const pedir = normalizarAcaoDoAgente({ resumo: "x", itens: [{ operacao: "pedir_ao_agente", ref: "t1", para: '{"agente":"atlas","instrucao":"Conferir os links"}' }] }, alvos, regras, { agente: "gestor", semDesfazer: () => true })!;
    expect(podeExecutarDireto(pedir, regras, { pedidoClaro: true }).direto).toBe(false);
  });
});

describe("Hermes: ponte do painel", () => {
  it("WhatsApp não aparece; só sessão da API recebe mensagem; o resto se continua por cópia", () => {
    expect(ORIGENS_VISIVEIS.has("whatsapp")).toBe(false);
    expect(ORIGENS_VISIVEIS.has("desktop")).toBe(true);
    expect([...ORIGENS_QUE_RECEBEM]).toEqual(["api_server"]);
    expect(sessaoParaOPainel({ id: "s1", source: "desktop", title: "Plano", message_count: 3 })).toMatchObject({ id: "s1", origem: "desktop", pode_enviar: false, mensagens: 3 });
    expect(sessaoParaOPainel({ id: "s2", source: "api_server", title: "Central · Acerbi" }).pode_enviar).toBe(true);
  });

  it("mensagem sai sem raciocínio interno, com as ferramentas usadas", () => {
    const m = mensagemParaOPainel({ id: 1, role: "assistant", content: [{ type: "text", text: "Feito." }], reasoning: "segredo", tool_calls: [{ function: { name: "delegate_task" } }], timestamp: 1 });
    expect(m).toEqual({ id: 1, papel: "assistant", texto: "Feito.", ferramenta: null, chamadas: ["delegate_task"], quando: 1 });
  });

  it("contexto compartilhado leva só referências do OS", () => {
    expect(linhaDeContexto({ cliente: { id: "c1", nome: "Acerbi" }, projeto: null, tarefa: null })).toBe("[Contexto do painel Aceleriq: cliente Acerbi (c1). Confira no MCP antes de agir.]");
    expect(linhaDeContexto(null)).toBe("");
  });
});

describe("atalhos e navegador", () => {
  it("Mesas com o cliente e o projeto da conversa; embutido só para caminho interno", () => {
    const a = atalhosDaCentral({ clientId: "c1", projectId: "p1" });
    expect(a.find((x) => x.id === "mesa-ads")!.caminho).toBe("/mesa-ads?client=c1");
    expect(a.find((x) => x.id === "kanban")!.caminho).toBe("/kanban?client=c1&project=p1");
    expect(a.find((x) => x.id === "mesa")!.caminho).toBe("/mesa?client=c1");
    expect(a.find((x) => x.id === "dossie")!.caminho).toBe("/mesa?client=c1&aba=contexto");
    expect(a.find((x) => x.id === "design")!.caminho).toBe("/mesa-identidade?client=c1");
    expect(caminhoEmbutido("/workspace?client=c1")).toBe("/workspace?client=c1&embutido=1");
    expect(caminhoEmbutido("https://evil.test")).toBeNull();
    expect(caminhoEmbutido("//evil.test")).toBeNull();
  });

  it("navegador aceita só http/https e recusa credencial na URL", () => {
    expect(enderecoExterno("instagram.com/acerbi")).toBe("https://instagram.com/acerbi");
    expect(enderecoExterno("javascript:alert(1)")).toBeNull();
    expect(enderecoExterno("https://user:senha@site.com")).toBeNull();
  });
});

import { conferirContraAFicha } from "../../supabase/functions/gestor-aceleriq/modulos/ficha";
import { aplicarConferenciaDaConversa, perguntasDeConversa } from "../../supabase/functions/gestor-aceleriq/modulos/conferencia";
import { objetoDaFonte, objetoValido } from "@/lib/centralObjetos";
import { lerArrastado } from "@/lib/centralArrastar";

describe("Gestor conversa (09/10): liberdade de redação, não de fato", () => {
  const fontes = [{ apelido: "F1", tipo: "aprovacao", estado: "decisao_pendente", titulo: "Abertura da semana", quando: null, texto: "aguarda aprovação", cliente: "Acerbi", agente: null, ids: { aprovacao: "ap-1" } }] as any;

  it("frase de conversa sem fonte passa a barreira de código; fato sem fonte não", () => {
    const { aceitos, recusados } = conferirContraAFicha([
      { secao: "conversa", texto: "Deixei a aprovação pronta para você confirmar.", fontes: [] },
      { secao: "feito", texto: "Publicamos tudo.", fontes: [] },
      { secao: "conversa", texto: "A que depende de você é a abertura da semana.", fontes: ["F1"] },
      { secao: "feito", texto: "A abertura foi aprovada.", fontes: ["F1"] },
    ], fontes);
    expect(aceitos.map((i) => i.texto)).toEqual(["Deixei a aprovação pronta para você confirmar.", "A que depende de você é a abertura da semana."]);
    expect(recusados.map((r) => r.motivo)).toEqual(["sem_fonte", "estado_incompativel"]);
  });

  it("o Jev tira a frase sem fonte que afirma fato da operação", () => {
    const itens = [{ secao: "conversa" as const, texto: "Quer que eu prepare a aprovação?", fontes: [] }, { secao: "conversa" as const, texto: "Já aprovei e enviei ao cliente.", fontes: [] }];
    const { questions } = perguntasDeConversa(itens);
    expect(Object.keys(questions)).toEqual(["c0", "c1"]);
    const r = aplicarConferenciaDaConversa(itens, { c0: { choice: "conversa", probabilities: { conversa: 0.9, afirma_fato: 0.1 } }, c1: { choice: "afirma_fato", probabilities: { conversa: 0.05, afirma_fato: 0.95 } } });
    expect(r.ficam.map((i) => i.texto)).toEqual(["Quer que eu prepare a aprovação?"]);
    expect(r.sairam.map((i) => i.texto)).toEqual(["Já aprovei e enviei ao cliente."]);
  });

  it("aprovar é uma operação própria sobre a solicitação real: nunca vai direto e recusa a já decidida", () => {
    const alvosA = comApelido([{ id: "ap-1", titulo: "Abertura da semana", dados: { status: "pendente" } }, { id: "ap-2", titulo: "Antiga", dados: { status: "aprovado" } }], "a");
    const r = regrasDoGestor(["atlas"]);
    const acao = normalizarAcaoDoAgente({ resumo: "x", itens: [{ operacao: "aprovar_solicitacao", ref: "a1", para: "{}" }, { operacao: "aprovar_solicitacao", ref: "a2", para: "{}" }, { operacao: "aprovar_solicitacao", ref: "t1", para: "{}" }] }, [...alvosA, ...comApelido([{ id: "task-1", titulo: "x", dados: { status: "doing" } }], "t")], r, { agente: "gestor", semDesfazer: () => true })!;
    expect(acao.itens.map((i) => i.alvo_id)).toEqual(["ap-1"]);
    expect(acao.recusados[0].motivo).toMatch(/já foi decidida/);
    expect(acao.ignorados).toEqual(["t1"]);
    expect(podeExecutarDireto(acao, r, { pedidoClaro: true }).direto).toBe(false);
    expect(PARA.pedir_alteracao('{"nota":""}')).toBeNull();
  });

  it("objetos da conversa: fonte vira objeto nativo; dado gravado malformado não abre nada; arraste só com link seguro", () => {
    expect(objetoDaFonte(fontes[0])).toEqual({ tipo: "aprovacao", id: "ap-1", titulo: "Abertura da semana" });
    expect(objetoValido({ tipo: "tarefa", id: "a1b2c3d4-0000-4000-8000-000000000001" })).toMatchObject({ tipo: "tarefa" });
    expect(objetoValido({ tipo: "pagina", id: "a1b2c3d4-0000-4000-8000-000000000001" })).toBeNull();
    expect(objetoValido({ tipo: "tarefa", id: "../../x" })).toBeNull();
    expect(lerArrastado(JSON.stringify({ nome: "a.pdf", mime: "application/pdf", url: "https://x.supabase.co/storage/v1/object/sign/a.pdf?token=t" }))).toHaveLength(1);
    expect(lerArrastado(JSON.stringify({ nome: "a", url: "javascript:alert(1)" }))).toHaveLength(0);
  });
});
