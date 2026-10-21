import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { documentarProjeto, docxDoProjeto, htmlParaImprimir, linkSeguroDaExportacao, sanitizarExportacao, textoSeguroDaExportacao, type EntradaDaExportacao } from "@/lib/laboratorio/exportar";
import type { ExecucaoDoLab, SaidaDaExecucao } from "@/lib/laboratorio/api";

const saida = (texto: string): SaidaDaExecucao => ({ texto, imagens: [], html_path: "", html_url: "", tarefa_id: "", tarefa_url: "", escolha: null, aviso_jev: "", avisos: [], json: null, fontes: [], storyboards: [], storyboard_escolhido: null, etapa_filme: "", render_progresso: null, video_url: "", video_path: "", estado_no_ar: null, aprovacao_id: "", link_aprovacao: "", operador: "", prova: "", link_no_ar: "", rascunho_sem_fonte: [] });
const execucao = (id: string, texto: string, data: string): ExecucaoDoLab => ({ id, no_id: "copy", tipo: "copy", status: "pronto", saida: saida(texto), custo_usd: 0.01, erro: "", rodada_id: "r1", created_at: data });
const entrada = (): EntradaDaExportacao => {
  const canvas: EntradaDaExportacao["canvas"] = { nos: [
    { id: "brief", tipo: "contexto", x: 0, y: 0, dados: { texto: "Público brasileiro e oferta real" } },
    { id: "copy", tipo: "copy", x: 400, y: 0, dados: { modelo_id: "opus", instrucao: "Escreva com clareza" } },
    { id: "pagina", tipo: "pagina", x: 800, y: 0, dados: { tipo_pagina: "landing", modelo_id: "gpt-6-sol" } },
  ], ligacoes: [{ id: "l1", de: "brief", para: "copy" }, { id: "l2", de: "copy", para: "pagina", gatilho: "clicou_botao" }], viewport: { x: 12, y: 18, zoom: 0.8 } };
  return { projeto: { id: "p1", nome: "Funil do café", client_id: "c1", cliente_nome: "Cliente Café", contexto: "Lançar com orçamento informado. Não prometer resultado.", canvas, total_nos: 3, versao: 9, status: "ativo", updated_at: "2026-10-21T12:00:00Z", previa_url: "" }, canvas, execucoes: [execucao("ex2", "Copy revisada", "2026-10-21T13:00:00Z"), execucao("ex1", "Primeira versão", "2026-10-21T12:00:00Z")] };
};

describe("documentação completa do Canvas", () => {
  it("conserva contexto, modelos, campos, ligações, posição e cada execução sem alterar a fonte", () => {
    const dados = entrada();
    const antes = JSON.stringify(dados);
    const documento = documentarProjeto(dados, "2026-10-21T14:00:00Z");
    expect(documento.markdown).toContain("Cliente Café");
    expect(documento.markdown).toContain("Não prometer resultado");
    expect(documento.markdown).toContain("opus");
    expect(documento.markdown).toContain("gpt-6-sol");
    expect(documento.markdown).toContain("Gatilho: Clicou no botão");
    expect(documento.markdown).toContain("Copy revisada");
    expect(documento.markdown).toContain("Primeira versão");
    expect(documento.markdown.indexOf("Primeira versão")).toBeLessThan(documento.markdown.indexOf("Copy revisada"));
    const json = JSON.parse(documento.json);
    expect(json.canvas).toEqual(dados.canvas);
    expect(json.projeto.contexto).toBe(dados.projeto.contexto);
    expect(json.execucoes).toHaveLength(2);
    expect(json.canvas.viewport.zoom).toBe(0.8);
    expect(JSON.stringify(dados)).toBe(antes);
    expect(documento.nome).toBe("funil-do-cafe-documentacao");
  });

  it("separa criação de execução e não inventa a entrega de um nó só desenhado", () => {
    const documento = documentarProjeto(entrada());
    expect(documento.pendencias).toHaveLength(1);
    expect(documento.pendencias[0]).toContain("pagina");
    expect(documento.pendencias[0]).toContain("ainda não executado");
    expect(documento.markdown).toContain("Um nó desenhado ainda não é uma entrega executada");
    expect(documento.markdown).toContain("não inclui os arquivos binários");
  });

  it("inclui falhas, fontes, arquivos, prova e histórico de nós removidos", () => {
    const dados = entrada();
    dados.execucoes[0].status = "erro";
    dados.execucoes[0].erro = "O motor não respondeu";
    dados.execucoes[0].saida.fontes = [{ titulo: "Referência oficial", url: "https://fonte.example/artigo?utm_source=teste" }];
    dados.execucoes[0].saida.imagens = [{ path: "cliente/p1/peca-2.png", url: "https://storage.example/storage/v1/object/sign/workspace/peca.png?token=privado" }];
    dados.execucoes[0].saida.prova = "Foi gerado um arquivo, ainda não publicado.";
    dados.execucoes.push({ ...execucao("removido", "Resultado antigo preservado", "2026-10-21T11:00:00Z"), no_id: "removido" });
    const documento = documentarProjeto(dados);
    expect(documento.markdown).toContain("O motor não respondeu");
    expect(documento.markdown).toContain("Referência oficial");
    expect(documento.markdown).toContain("cliente/p1/peca-2.png");
    expect(documento.markdown).toContain("ainda não publicado");
    expect(documento.markdown).toContain("Resultado antigo preservado");
    expect(documento.markdown).not.toContain("token=privado");
    expect(documento.json).not.toContain("token=privado");
  });

  it("lida com canvas vazio sem afirmar que o funil foi criado", () => {
    const dados = entrada();
    dados.canvas = { nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } };
    dados.execucoes = [];
    const documento = documentarProjeto(dados);
    expect(documento.totalNos).toBe(0);
    expect(documento.markdown).toContain("Nenhuma ligação registrada");
    expect(JSON.parse(documento.json).canvas.nos).toEqual([]);
  });
});

describe("exportação sem credenciais ou conteúdo ativo", () => {
  it.each([
    "https://storage.example/storage/v1/object/sign/workspace/foto.png?token=segredo",
    "https://arquivos.example/a.png?X-Amz-Signature=segredo",
    "https://conta:senha@site.example/pagina",
    "https://site.example/callback?access_token=segredo",
    "/storage/v1/object/sign/workspace/foto.png?token=segredo",
  ])("omite link sensível %s", (url) => expect(linkSeguroDaExportacao(url)).toContain("omitido"));

  it("remove parâmetros e fragmentos dos links normais, mantendo o endereço base", () => {
    expect(linkSeguroDaExportacao("https://site.example/guia?id=1#dados")).toBe("https://site.example/guia");
    expect(linkSeguroDaExportacao("javascript:alert(1)")).toBe("[endereço não exportável]");
    expect(linkSeguroDaExportacao("data:text/html,pagina")).toBe("[endereço não exportável]");
    expect(textoSeguroDaExportacao("Arquivo /storage/v1/object/sign/workspace/foto.png?token=segredo")).not.toContain("token=segredo");
  });

  it("redige credenciais em campos aninhados e no texto, preservando dados de criação", () => {
    const seguro = JSON.stringify(sanitizarExportacao({ api_key: "não-vazar", clientSecret: "não-vazar", cfg: { password: "não-vazar", authorization: "não-vazar" }, modelo_id: "opus", contexto: "Authorization: Bearer abcdefg senha=outra api_key=terceira" }));
    expect(seguro).not.toContain("não-vazar");
    expect(seguro).not.toContain("abcdefg");
    expect(seguro).not.toContain("outra");
    expect(seguro).not.toContain("terceira");
    expect(seguro).toContain("opus");
    expect(seguro).toContain("credencial omitida");
    expect(textoSeguroDaExportacao("sk-" + "exemplo".repeat(6))).toBe("[credencial omitida]");
  });

  it("representa HTML e instruções do projeto como dados, sem executar scripts na impressão", () => {
    const dados = entrada();
    dados.projeto.nome = '<img src=x onerror="alert(1)">';
    dados.projeto.contexto = '</p><script>alert("roubo")</script>';
    dados.execucoes[0].saida.json = { html: '<iframe src="javascript:alert(2)"></iframe>' };
    const html = htmlParaImprimir(documentarProjeto(dados));
    const parser = new DOMParser().parseFromString(html, "text/html");
    expect(parser.querySelectorAll("script,iframe,img,a,form")).toHaveLength(0);
    expect(parser.body.textContent).toContain("<script>");
    expect(parser.documentElement.lang).toBe("pt-BR");
    expect(html).toContain("@page{size:A4");
  });
});

describe("documento Word real", () => {
  it("gera um DOCX válido com OOXML, estilos de títulos e texto preservado sem relações externas", async () => {
    const documento = documentarProjeto(entrada());
    const blob = await docxDoProjeto(documento);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    const xml = await zip.file("word/document.xml")!.async("string");
    const estilos = await zip.file("word/styles.xml")!.async("string");
    const relacoes = await zip.file("word/_rels/document.xml.rels")!.async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.localName).toBe("document");
    expect(doc.documentElement.textContent).toContain("Copy revisada");
    expect(doc.documentElement.textContent).toContain("Primeira versão");
    expect(xml).toContain('w:pStyle w:val="Title"');
    expect(estilos).toContain('w:color w:val="000000"');
    expect(relacoes).not.toContain('TargetMode="External"');
    expect(Object.keys(zip.files).some((nome) => /vba|macro/i.test(nome))).toBe(false);
  });
});
