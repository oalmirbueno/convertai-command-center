import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montarCsp } from "../../config/csp";
import type { ExecucaoDoLab, SaidaDaExecucao } from "@/lib/laboratorio/api";
import type { CanvasDoLab } from "@/lib/laboratorio/nos";
import { CAMINHO_DO_CONTROLADOR, CAMINHO_DO_TAILWIND, caminhoDoArquivo, htmlSeguroDaPrevia, MENSAGEM_DE_FORMULARIO, MENSAGEM_DE_NAVEGACAO, paginasDaPrevia, resolverDestinoDaPrevia } from "@/lib/laboratorio/previas";

const controladorDoVisor = readFileSync(resolve(process.cwd(), "public/lab-preview-controller.js"), "utf8");

/** JSDOM não aplica CSP nem baixa recursos: o comportamento usa o arquivo estático real. */
function htmlComControladorCarregado(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const script = doc.querySelector(`script[src$="${CAMINHO_DO_CONTROLADOR}"]`)!;
  script.removeAttribute("src");
  script.textContent = controladorDoVisor;
  return doc.documentElement.outerHTML;
}

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
    expect(doc.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(doc.querySelector("a")?.getAttribute("role")).toBe("link");
    expect(doc.querySelector("a")?.getAttribute("tabindex")).toBe("0");
    expect(doc.querySelector("a")?.getAttribute("data-lab-destino")).toBe("/checkout");
    const csp = doc.head.firstElementChild?.getAttribute("content");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(doc.querySelectorAll("script[src]")).toHaveLength(2);
    expect(doc.querySelectorAll("script:not([src])")).toHaveLength(0);
    expect(doc.querySelector("script[src$='lab-preview-controller.js']")?.getAttribute("src")).toBe(new URL(CAMINHO_DO_CONTROLADOR, window.location.origin).href);
    expect(doc.querySelector(`script[src$='${CAMINHO_DO_TAILWIND}']`)?.getAttribute("src")).toBe(new URL(CAMINHO_DO_TAILWIND, window.location.origin).href);
    expect(doc.querySelector("script[src^='https://cdn.tailwindcss.com']")).toBeNull();
    expect(doc.documentElement.outerHTML).not.toContain("fetch('/pagar')");
  });

  it("o controlador real intercepta clique e submit sem enviar formulário ou navegar para fora", () => {
    const html = htmlSeguroDaPrevia('<a href="/checkout">Continuar</a><form action="https://pagar.example"><input name="email"><button>Enviar</button></form>', "nonceSeguraDaPrevia123456");
    const dom = new JSDOM(htmlComControladorCarregado(html), { runScripts: "dangerously", url: "https://previa.example" });
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

  it("usa script da própria origem permitido pela CSP publicada, sem depender de inline ou afrouxar a política global", () => {
    const doc = new DOMParser().parseFromString(htmlSeguroDaPrevia('<a href="/checkout">Continuar</a>', "nonceSeguraDaPrevia123456"), "text/html");
    const cspDoPainel = montarCsp("<html><head></head><body></body></html>");
    const politicaPai = cspDoPainel.split(";").find((p) => p.trim().startsWith("script-src"))!;
    expect(politicaPai.trim()).toBe("script-src 'self'");
    expect(politicaPai).not.toContain("'unsafe-inline'");
    const script = doc.querySelector<HTMLScriptElement>("script[src$='lab-preview-controller.js']")!;
    const endereco = new URL(script.src);
    expect(endereco.origin).toBe(window.location.origin);
    expect(endereco.pathname).toBe(CAMINHO_DO_CONTROLADOR);
    expect(script.textContent).toBe("");
    const cspLocal = doc.querySelector("meta[http-equiv='Content-Security-Policy']")!.getAttribute("content")!;
    const scriptsLocais = cspLocal.split(";").find((p) => p.trim().startsWith("script-src"))!;
    expect(scriptsLocais.trim()).toBe(`script-src ${script.src} ${new URL(CAMINHO_DO_TAILWIND, window.location.origin).href}`);
    expect(scriptsLocais).not.toMatch(/nonce-|unsafe-inline|blob:|data:/);
    expect(scriptsLocais).not.toContain("cdn.tailwindcss.com");
    expect(cspLocal).toContain("form-action 'none'");
  });

  it.each(["Enter", " "])("aciona a ligação pelo teclado (%s) sem navegar o iframe para o painel", (tecla) => {
    const html = htmlSeguroDaPrevia('<a href="/checkout"><span>Continuar</span></a>', "nonceSeguraDaPrevia123456");
    const dom = new JSDOM(htmlComControladorCarregado(html), { runScripts: "dangerously", url: "https://previa.example/laboratorio" });
    const postar = vi.spyOn(dom.window, "postMessage").mockImplementation(() => {});
    try {
      const evento = new dom.window.KeyboardEvent("keydown", { key: tecla, bubbles: true, cancelable: true });
      expect(dom.window.document.querySelector("span")!.dispatchEvent(evento)).toBe(false);
      expect(postar).toHaveBeenCalledOnce();
      expect(postar).toHaveBeenCalledWith({ tipo: MENSAGEM_DE_NAVEGACAO, caminho: "/checkout" }, "*");
      expect(dom.window.location.href).toBe("https://previa.example/laboratorio");
    } finally { dom.window.close(); }
  });

  it("uma falha ao carregar o controlador deixa links sem navegação nativa", () => {
    const html = htmlSeguroDaPrevia('<a href="/checkout">Continuar</a>', "nonceSeguraDaPrevia123456");
    const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://previa.example/laboratorio" });
    try {
      const link = dom.window.document.querySelector("a")!;
      expect(link.hasAttribute("href")).toBe(false);
      expect(link.getAttribute("data-lab-destino")).toBe("/checkout");
      link.click();
      expect(dom.window.location.href).toBe("https://previa.example/laboratorio");
    } finally { dom.window.close(); }
  });

  it("reescreve apenas o Tailwind oficial reconhecido e mantém inativos scripts e configurações da página", () => {
    const html = `<script src="https://cdn.tailwindcss.com/3.4.17" crossorigin="anonymous" integrity="desatualizado"></script><script>tailwind.config={theme:{}};window.acaoDaPagina=true;</script><script src="https://cdn.tailwindcss.com/4"></script><script src="https://cdn.tailwindcss.com/?plugins=forms"></script><script src="https://outro.example/tailwind.js"></script>`;
    const doc = new DOMParser().parseFromString(htmlSeguroDaPrevia(html, "nonceSeguraDaPrevia123456"), "text/html");
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    const runtime = doc.querySelector<HTMLScriptElement>(`script[src$='${CAMINHO_DO_TAILWIND}']`)!;
    expect(runtime.hasAttribute("integrity")).toBe(false);
    expect(runtime.hasAttribute("crossorigin")).toBe(false);
    expect(doc.documentElement.outerHTML).not.toContain("acaoDaPagina");
    expect(doc.documentElement.outerHTML).not.toContain("tailwind.config");
  });

  it("preserva a proveniência e compila o layout real com o runtime oficial fixo, sem executar código da IA", async () => {
    const runtime = readFileSync(resolve(process.cwd(), `public${CAMINHO_DO_TAILWIND}`));
    const proveniencia = JSON.parse(readFileSync(resolve(process.cwd(), "public/vendor/tailwindcss-3.4.17.proveniencia.json"), "utf8"));
    expect(proveniencia.version).toBe("3.4.17");
    expect(proveniencia.sourceUrl).toBe("https://cdn.tailwindcss.com/3.4.17");
    expect(proveniencia.modified).toBe(false);
    expect(runtime.length).toBe(proveniencia.bytes);
    expect(createHash("sha256").update(runtime).digest("hex")).toBe("176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15");
    expect(proveniencia.sha256).toBe(createHash("sha256").update(runtime).digest("hex"));
    expect(readFileSync(resolve(process.cwd(), "public/vendor/tailwindcss-3.4.17.LICENSE.txt"), "utf8")).toContain("MIT License");
    expect(runtime.toString()).not.toMatch(/\beval\s*\(|\b(?:new\s+)?Function\s*\(/);
    const html = htmlSeguroDaPrevia('<html><head><script src="https://cdn.tailwindcss.com"></script><script>window.acaoDaPagina=true;</script></head><body class="bg-slate-950 font-sans"><main class="mx-auto grid max-w-7xl grid-cols-1 gap-8 p-6 md:grid-cols-2"><h1 class="text-4xl font-bold text-[#33e099] md:text-6xl">Design real</h1></main></body></html>', "nonceSeguraDaPrevia123456");
    const doc = new DOMParser().parseFromString(htmlComControladorCarregado(html), "text/html");
    const script = doc.querySelector(`script[src$='${CAMINHO_DO_TAILWIND}']`)!;
    script.removeAttribute("src");
    script.textContent = runtime.toString();
    const erros: string[] = [];
    const consoleVirtual = new VirtualConsole();
    consoleVirtual.on("jsdomError", (erro) => erros.push(erro.message));
    const observadores: Array<{ disconnect: () => void }> = [];
    const dom = new JSDOM(doc.documentElement.outerHTML, {
      runScripts: "dangerously", url: "https://previa.example/laboratorio", virtualConsole: consoleVirtual,
      beforeParse(janela) {
        const Nativo = janela.MutationObserver;
        janela.MutationObserver = class extends Nativo {
          constructor(callback: ConstructorParameters<typeof Nativo>[0]) { super(callback); observadores.push(this); }
        };
      },
    });
    try {
      await waitFor(() => {
        const css = [...dom.window.document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
        expect(css).toContain(".grid{display:grid}");
        expect(css).toContain("md\\:grid-cols-2");
        expect(css).toContain(".gap-8");
        expect(css).toContain(".text-4xl");
        expect(css).toContain("33e099");
      }, { timeout: 5000 });
      expect((dom.window as unknown as { acaoDaPagina?: boolean }).acaoDaPagina).toBeUndefined();
      expect(erros).toEqual([]);
    } finally {
      observadores.forEach((observador) => observador.disconnect());
      await new Promise((resolver) => setTimeout(resolver, 0));
      dom.window.close();
    }
  }, 10_000);
});
