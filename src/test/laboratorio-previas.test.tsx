import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecucaoDoLab, SaidaDaExecucao } from "@/lib/laboratorio/api";
import type { CanvasDoLab } from "@/lib/laboratorio/nos";
import { caminhoDoArquivo, htmlSeguroDaPrevia, MENSAGEM_DE_FORMULARIO, MENSAGEM_DE_NAVEGACAO, paginasDaPrevia, resolverDestinoDaPrevia } from "@/lib/laboratorio/previas";

const m = vi.hoisted(() => ({ ler: vi.fn() }));
vi.mock("@/lib/laboratorio/arquivos", () => ({ lerHtmlSalvo: m.ler, enderecosAssinados: vi.fn(), enderecoParaBaixar: vi.fn() }));
vi.mock("@/lib/laboratorio/api", () => ({ enderecoDaAprovacao: () => "" }));
vi.mock("@/components/sistema", () => ({
  AjudaRecolhida: ({ children }: { children: React.ReactNode }) => <span hidden>{children}</span>,
  JanelaCentral: ({ aberta, children }: { aberta: boolean; children: React.ReactNode }) => aberta ? <div>{children}</div> : null,
  botao: { icone: "" }, texto: { auxiliar: "" }, etiqueta: "", juntar: (...partes: Array<string | false | undefined>) => partes.filter(Boolean).join(" "),
}));
import ProvedorDasPrevias from "@/components/laboratorio/ContextoDasPrevias";
import { PreviaDaLanding } from "@/components/laboratorio/ResultadoDoNo";

const canvas: CanvasDoLab = { nos: [
  { id: "oferta", tipo: "pagina", x: 0, y: 0, dados: { caminho: "/oferta" } },
  { id: "checkout", tipo: "checkout", x: 400, y: 0, dados: { caminho: "/checkout" } },
  { id: "obrigado", tipo: "pagina", x: 800, y: 0, dados: { caminho: "/obrigado" } },
  { id: "webinar", tipo: "webinar", x: 0, y: 500, dados: { caminho: "/aula" } },
], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } };
const saida = (htmlPath: string): SaidaDaExecucao => ({ texto: "", imagens: [], html_path: htmlPath, html_url: "", tarefa_id: "", tarefa_url: "", escolha: null, aviso_jev: "", avisos: [], json: null, fontes: [], storyboards: [], storyboard_escolhido: null, etapa_filme: "", render_progresso: null, video_url: "", video_path: "", estado_no_ar: null, aprovacao_id: "", link_aprovacao: "", operador: "", prova: "", link_no_ar: "", rascunho_sem_fonte: [] });
const execucao = (noId: string, arquivo = `${noId}.html`): ExecucaoDoLab => ({ id: `ex-${noId}`, no_id: noId, tipo: "pagina", status: "pronto", saida: saida(arquivo), custo_usd: 0, erro: "", rodada_id: null, created_at: "2026-10-21T18:00:00Z" });
const execucoes = () => canvas.nos.map((n) => execucao(n.id));
const montar = (arquivo = "oferta.html", lista = execucoes()) => <ProvedorDasPrevias canvas={canvas} execucoes={lista}><PreviaDaLanding caminho={arquivo} url="" alta /></ProvedorDasPrevias>;
const frameAtual = () => screen.getByTitle<HTMLIFrameElement>("Prévia da landing");
const mensagem = (frame: HTMLIFrameElement, caminho: string, tipo = MENSAGEM_DE_NAVEGACAO) => fireEvent(window, new MessageEvent("message", { source: frame.contentWindow, data: { tipo, caminho } }));

beforeEach(() => {
  m.ler.mockReset();
  m.ler.mockImplementation(async (arquivo: string) => `<html><body><h1>${arquivo}</h1><a href="/checkout">Continuar</a></body></html>`);
});

describe("endereços de páginas reais deste projeto", () => {
  it("indexa só caminhos declarados com arquivo salvo e execução pronta", () => {
    const lista = execucoes();
    lista[1].status = "rodando";
    lista[2].saida.html_path = "";
    lista.push(execucao("no-de-outro-projeto", "externo.html"));
    const paginas = paginasDaPrevia(canvas, lista);
    expect(paginas.map((p) => p.caminho)).toEqual(["/oferta", "/aula"]);
    expect(caminhoDoArquivo(paginas, "oferta.html")).toBe("/oferta");
    expect(resolverDestinoDaPrevia(paginas, "/oferta", "/checkout").ok).toBe(false);
  });

  it("inclui páginas extras do webinar nos dois formatos, sem duplicar a inscrição", () => {
    const lista = execucoes();
    lista[3].saida.paginas = [{ nome: "Inscrição", caminho: "/aula", html_path: "webinar.html", html_url: "" }, { nome: "Sala", caminho: "/aula/sala", html_path: "sala.html", html_url: "" }];
    lista[3].saida.json = { paginas: [{ nome: "Encerramento", caminho: "/aula/encerramento", html_path: "fim.html" }, { nome: "Externa", caminho: "/aula/externa", html_url: "https://fora.example" }] };
    const paginas = paginasDaPrevia(canvas, lista);
    expect(paginas.filter((p) => p.caminho === "/aula")).toHaveLength(1);
    expect(resolverDestinoDaPrevia(paginas, "/aula", "aula/sala")).toEqual({ ok: true, pagina: expect.objectContaining({ htmlPath: "sala.html" }) });
    expect(resolverDestinoDaPrevia(paginas, "/aula", "/aula/encerramento").ok).toBe(true);
    expect(resolverDestinoDaPrevia(paginas, "/aula", "/aula/externa").ok).toBe(false);
  });

  it("recusa caminhos duplicados, destino não gerado e caminhos sem origem", () => {
    const paginas = paginasDaPrevia(canvas, execucoes());
    const duplicadas = [...paginas, { ...paginas[0], noId: "outra-pagina", htmlPath: "outra.html" }];
    expect(resolverDestinoDaPrevia(duplicadas, "/checkout", "/oferta")).toEqual({ ok: false, motivo: expect.stringContaining("mais de uma página") });
    expect(resolverDestinoDaPrevia(paginas, "/oferta", "/nao-gerada")).toEqual({ ok: false, motivo: expect.stringContaining("ainda não tem um HTML pronto") });
    expect(resolverDestinoDaPrevia(paginas, null, "checkout")).toEqual({ ok: false, motivo: expect.stringContaining("origem") });
  });

  it.each(["https://aceleriq.online/checkout", "https://pagar.example/oferta", "//pagar.example", "javascript:alert(1)", "data:text/html,oi", "mailto:contato@example.com", "/%2f%2fpagar.example", "/%5c%5cpagar.example", "\\checkout", "/fora-do-projeto"])("não adivinha nem abre destino fora da prévia: %s", (href) => {
    expect(resolverDestinoDaPrevia(paginasDaPrevia(canvas, execucoes()), "/oferta", href).ok).toBe(false);
  });
});

describe("navegação pelo iframe no Canvas", () => {
  it("abre o arquivo do destino no mesmo visor e permite voltar", async () => {
    render(montar());
    await waitFor(() => expect(frameAtual().srcdoc).toContain("oferta.html"));
    const primeiro = frameAtual();
    expect(primeiro.getAttribute("sandbox")).toBe("allow-scripts");
    mensagem(primeiro, "/checkout");
    await waitFor(() => expect(frameAtual().srcdoc).toContain("checkout.html"));
    expect(m.ler).toHaveBeenCalledWith("checkout.html");
    expect(screen.getByLabelText<HTMLSelectElement>("Página da prévia").value).toBe("/checkout");
    fireEvent.click(screen.getByRole("button", { name: "Página anterior da prévia" }));
    await waitFor(() => expect(frameAtual().srcdoc).toContain("oferta.html"));
  });

  it("ignora mensagens do painel e de outro iframe, mesmo com o protocolo correto", async () => {
    render(montar());
    await waitFor(() => expect(frameAtual().srcdoc).toContain("oferta.html"));
    fireEvent(window, new MessageEvent("message", { source: window, data: { tipo: MENSAGEM_DE_NAVEGACAO, caminho: "/checkout" } }));
    const estrangeiro = document.createElement("iframe");
    document.body.append(estrangeiro);
    mensagem(estrangeiro, "/checkout");
    expect(m.ler).toHaveBeenCalledTimes(1);
    expect(frameAtual().srcdoc).toContain("oferta.html");
    estrangeiro.remove();
  });

  it("inspeciona Obrigado pelo seletor sem fingir pagamento e não mostra seletor na miniatura", async () => {
    const { rerender } = render(montar());
    await waitFor(() => expect(frameAtual().srcdoc).toContain("oferta.html"));
    fireEvent.change(screen.getByLabelText("Página da prévia"), { target: { value: "/obrigado" } });
    await waitFor(() => expect(frameAtual().srcdoc).toContain("obrigado.html"));
    expect(m.ler).toHaveBeenLastCalledWith("obrigado.html");
    rerender(<ProvedorDasPrevias canvas={canvas} execucoes={execucoes()}><PreviaDaLanding caminho="oferta.html" url="" /></ProvedorDasPrevias>);
    expect(screen.queryByLabelText("Página da prévia")).toBeNull();
  });

  it("explica link externo e formulário bloqueado sem chamar API de cliente ou pagamento", async () => {
    render(montar());
    await waitFor(() => expect(frameAtual().srcdoc).toContain("oferta.html"));
    mensagem(frameAtual(), "https://pagar.example/checkout");
    expect(screen.getByText("Links externos e pagamentos ficam desativados nesta prévia.")).toBeTruthy();
    mensagem(frameAtual(), "", MENSAGEM_DE_FORMULARIO);
    expect(screen.getByText("Formulários não são enviados na prévia. Nenhum contato foi salvo e nenhum pagamento foi feito.")).toBeTruthy();
    expect(m.ler).toHaveBeenCalledTimes(1);
  });

  it("não mostra HTML antigo ao trocar de arquivo nem deixa uma resposta lenta sobrescrever a nova página", async () => {
    let concluirAntiga: (html: string) => void = () => {};
    m.ler.mockImplementation((arquivo: string) => arquivo === "oferta.html" ? new Promise<string>((resolver) => { concluirAntiga = resolver; }) : Promise.resolve("<h1>Nova página correta</h1>"));
    const { rerender } = render(montar());
    expect(screen.getByRole("status", { name: "Carregando prévia" })).toBeTruthy();
    rerender(montar("checkout.html"));
    await waitFor(() => expect(frameAtual().srcdoc).toContain("Nova página correta"));
    await act(async () => { concluirAntiga("<h1>HTML antigo indevido</h1>"); });
    expect(frameAtual().srcdoc).not.toContain("HTML antigo indevido");
  });

  it("limpa erro anterior na troca e nunca abre um HTML remoto sem arquivo salvo", async () => {
    m.ler.mockRejectedValueOnce(new Error("Falhou"));
    const { rerender } = render(montar());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    rerender(montar("checkout.html"));
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(frameAtual().srcdoc).toContain("checkout.html"));
    rerender(<PreviaDaLanding caminho="" url="https://pagar.example/checkout" alta />);
    expect(screen.queryByTitle("Prévia da landing")).toBeNull();
    expect(screen.getByText("Esta prévia precisa do arquivo HTML salvo no projeto.")).toBeTruthy();
  });
});

describe("HTML da prévia sem execução de ações externas", () => {
  const perigoso = `<html><head><base href="https://pagar.example"><meta http-equiv="refresh" content="0;url=https://pagar.example"><link rel="prefetch" href="https://pagar.example/charge"><script src="https://cdn.tailwindcss.com"></script><script>fetch('/pagar');</script><script src="https://outro.example/acao.js"></script></head><body><a href="/checkout" target="_blank" onclick="fetch('/pagar')" ping="https://pagar.example">Continuar</a><form action="https://pagar.example" method="post"><input name="email"><button type="submit" formaction="https://pagar.example">Enviar</button></form><iframe src="https://pagar.example"></iframe></body></html>`;

  it("remove ações originais e aplica CSP antes do conteúdo e recursos", () => {
    const doc = new DOMParser().parseFromString(htmlSeguroDaPrevia(perigoso, "nonceSeguraDaPrevia123456"), "text/html");
    expect(doc.querySelector("base,iframe,object,embed,[onclick],meta[http-equiv=refresh],link[rel=prefetch]")).toBeNull();
    expect(doc.querySelector("form")?.getAttribute("action")).toBeNull();
    expect(doc.querySelector("button")?.getAttribute("formaction")).toBeNull();
    expect(doc.querySelector("a")?.getAttribute("href")).toBe("#");
    expect(doc.querySelector("a")?.getAttribute("data-lab-destino")).toBe("/checkout");
    const csp = doc.head.firstElementChild?.getAttribute("content");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(doc.querySelectorAll("script[src]")).toHaveLength(1);
    expect(doc.querySelector("script[src]")?.getAttribute("src")).toBe("https://cdn.tailwindcss.com");
    expect(doc.documentElement.outerHTML).not.toContain("fetch('/pagar')");
  });

  it("o controlador real intercepta clique e submit sem enviar formulário ou navegar para fora", () => {
    const html = htmlSeguroDaPrevia('<a href="/checkout">Continuar</a><form action="https://pagar.example"><input name="email"><button>Enviar</button></form>', "nonceSeguraDaPrevia123456");
    const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://previa.example" });
    const postar = vi.spyOn(dom.window, "postMessage").mockImplementation(() => {});
    try {
      dom.window.document.querySelector("a")!.click();
      expect(postar).toHaveBeenCalledWith({ tipo: MENSAGEM_DE_NAVEGACAO, caminho: "/checkout" }, "*");
      const form = dom.window.document.querySelector("form")!;
      const evento = new dom.window.Event("submit", { bubbles: true, cancelable: true });
      expect(form.dispatchEvent(evento)).toBe(false);
      expect(postar).toHaveBeenLastCalledWith({ tipo: MENSAGEM_DE_FORMULARIO, caminho: "" }, "*");
      form.submit();
      expect(postar).toHaveBeenLastCalledWith({ tipo: MENSAGEM_DE_FORMULARIO, caminho: "" }, "*");
      expect(dom.window.location.href).toBe("https://previa.example/");
    } finally { dom.window.close(); }
  });
});
