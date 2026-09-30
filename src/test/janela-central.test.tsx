import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { createElement as h, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { JanelaCentral as JanelaDoIndice } from "@/components/sistema";

/**
 * Frente GAV (30/09). Pedido do dono: "biblioteca abrir no padrão central e
 * não na lateral, e qualquer pop-up assim abrir tudo no centro e não na
 * lateral". docs/design/SISTEMA.md, seção 4.4.
 */

vi.mock("@/components/mesa/Custo", () => ({ useAvisarErro: () => vi.fn() }));
vi.mock("@/components/mesa-proposta/propostaApi", () => ({
  CHAVES: { servicos: () => ["servicos"], provas: () => ["provas"], hora: () => ["hora"] },
  chamarBiblioteca: vi.fn(),
  useServicos: () => ({
    data: {
      semTabela: false,
      lista: [{ id: "s1", nome: "Gestão de redes", categoria: "Redes", descricao: "", unidade: "mes", preco: 1800, recorrencia: "mensal", horas: 20, entregaveis: [], arquivado: false }],
    },
  }),
  useProvas: () => ({ data: { semTabela: false, lista: [] } }),
  useHoraTecnica: () => ({ data: null, isLoading: true }),
}));

const raiz = resolve(__dirname, "../..");
const pastaSrc = resolve(raiz, "src");

// ------------------------------------------------------------------ contrato

/**
 * Lista FECHADA de exceções: arquivo, quantas marcas de gaveta ele pode ter e
 * o motivo. Entrar aqui exige que não seja pop-up (menu de navegação,
 * primitivo sem uso). O agente fixo das mesas (AreaDeTrabalho, PainelDoAgente)
 * e a gaveta dele no celular não usam Sheet nem Drawer (portal próprio), e o
 * ui/sheet.tsx só define a gaveta: nenhum dos dois conta aqui.
 */
const EXCECOES: Record<string, { gavetas: number; motivo: string }> = {
  "components/ui/drawer.tsx": { gavetas: 1, motivo: "primitivo do vaul (só a definição; nenhuma tela usa)" },
  "components/ui/sidebar.tsx": { gavetas: 2, motivo: "primitivo do shadcn (só a definição; nenhuma tela usa)" },
  "pages/AdminCiclo.tsx": { gavetas: 2, motivo: "menu de navegação lateral do Ciclo no celular (não é pop-up): o import e a gaveta" },
};

function arquivosDoPainel(): string[] {
  const saida: string[] = [];
  (function andar(pasta: string) {
    for (const nome of readdirSync(pasta)) {
      const caminho = resolve(pasta, nome);
      if (statSync(caminho).isDirectory()) {
        if (caminho === resolve(pastaSrc, "test")) continue;
        andar(caminho);
      } else if (/\.tsx?$/.test(nome) && !/\.(test|spec)\./.test(nome)) saida.push(caminho);
    }
  })(pastaSrc);
  return saida.sort();
}

/** Quantas gavetas laterais o arquivo abre: SheetContent, Drawer do vaul, import de sheet/drawer/vaul. */
function gavetasDe(texto: string): number {
  let n = 0;
  n += (texto.match(/<SheetContent[\s>]/g) || []).length;
  n += (texto.match(/<(Drawer|DrawerContent)[\s>]/g) || []).length;
  n += (texto.match(/from ["']vaul["']/g) || []).length;
  // Import de fora do próprio primitivo (quem importa quer usar).
  n += (texto.match(/from ["']@\/components\/ui\/(sheet|drawer)["']/g) || []).length;
  return n;
}

/** Painel `fixed` preso à lateral (right-0/left-0 com top-0/inset-y-0) aberto por cima. */
const PAINEL_FIXO_NA_LATERAL = /\bfixed\b[^"'`]*\b(inset-y-0|top-0)\b[^"'`]*\b(right|left)-0\b|\bfixed\b[^"'`]*\b(right|left)-0\b[^"'`]*\b(inset-y-0|top-0)\b/;

describe("contrato: pop-up abre no centro, nunca na lateral", () => {
  const medidos = arquivosDoPainel().map((caminho) => {
    const rel = relative(pastaSrc, caminho).split(sep).join("/");
    const texto = readFileSync(caminho, "utf8").replace(/\r\n/g, "\n");
    return { rel, texto, gavetas: gavetasDe(texto) };
  });

  it("nenhum SheetContent, Drawer ou vaul fora da lista fechada de exceções", () => {
    const fora = medidos.filter((m) => m.gavetas > 0 && !EXCECOES[m.rel]).map((m) => `${m.rel}: ${m.gavetas}`);
    expect(fora, "Use a JanelaCentral (docs/design/SISTEMA.md 4.4) em vez de gaveta lateral.").toEqual([]);
  });

  it("as exceções não crescem e continuam precisando estar na lista", () => {
    for (const [rel, e] of Object.entries(EXCECOES)) {
      const m = medidos.find((x) => x.rel === rel);
      expect(m, `${rel} saiu do código: tire da lista`).toBeTruthy();
      expect(m!.gavetas, `${rel}: ${e.motivo}`).toBe(e.gavetas);
    }
  });

  it("o menu do Ciclo é a única gaveta de tela e é o menu de navegação (lado esquerdo)", () => {
    const ciclo = medidos.find((m) => m.rel === "pages/AdminCiclo.tsx")!.texto;
    const gavetas = ciclo.match(/<SheetContent[^>]*>/g) || [];
    expect(gavetas).toHaveLength(1);
    expect(gavetas[0]).toContain('side="left"');
    expect(ciclo.slice(ciclo.indexOf("<Sheet open={menuOpen}"))).toContain("Ir para o painel");
  });

  it("nenhum painel fixed preso à lateral abrindo por cima do conteúdo", () => {
    const fora = medidos
      .filter((m) => m.rel.indexOf("components/ui/") !== 0)
      .filter((m) => (m.texto.match(/["'`][^"'`\n]*["'`]/g) || []).some((t) => PAINEL_FIXO_NA_LATERAL.test(t)))
      .map((m) => m.rel);
    expect(fora).toEqual([]);
    expect(PAINEL_FIXO_NA_LATERAL.test("fixed bottom-0 right-0 top-0 z-50 w-full")).toBe(true);
    expect(PAINEL_FIXO_NA_LATERAL.test("fixed inset-x-0 top-0 z-40")).toBe(false);
  });

  it("as janelas trocadas nesta frente usam a JanelaCentral", () => {
    for (const rel of [
      "components/mesa-proposta/BibliotecaDaAgencia.tsx",
      "components/NotificationsPanel.tsx",
      "components/ciclo/ClientCycleSheet.tsx",
      "components/editorial/EditorialDetailSheet.tsx",
      "components/esteira/EsteiraClientSheet.tsx",
      "components/mesa/AbaCampanhas.tsx",
      "components/mesa/ArquivadosDaFaixa.tsx",
      "components/mesa/ChavesECotas.tsx",
      "components/mesa/ModelosDeIa.tsx",
      "components/mesa-ads/GerenciadorAoVivo.tsx",
      "pages/AdminCiclo.tsx",
      "pages/AdminEsteira.tsx",
      "pages/AdminQuizSubmissions.tsx",
    ]) {
      const m = medidos.find((x) => x.rel === rel);
      expect(m, rel).toBeTruthy();
      expect(m!.texto, rel).toContain("<JanelaCentral");
    }
  });

  it("a JanelaCentral nasce compatível (Safari 11 / Chrome 64) e sem altura fixa pela janela", () => {
    const fonte = readFileSync(resolve(pastaSrc, "components/sistema/JanelaCentral.tsx"), "utf8");
    expect(fonte).not.toMatch(/calc\(100(vh|dvh)/);
    expect(fonte).not.toMatch(/\bgap-/);
    expect(fonte).not.toMatch(/aspect-|:has\(|\.at\(|\(\?<[=!a-zA-Z]|\\p\{/);
    expect(fonte).not.toMatch(/translate-x|translate-y/);
    // dvh só por cima do vh, nunca sozinho.
    expect(fonte).toContain("sm:max-h-[88vh] sm:supports-[height:1dvh]:max-h-[88dvh]");
    expect(fonte).not.toMatch(/slide-in-from-(right|left)/);
  });
});

// ------------------------------------------------------------------ comportamento

function Abridor({ onMudar, rodape = false }: { onMudar?: (v: boolean) => void; rodape?: boolean }) {
  const [aberta, setAberta] = useState(false);
  return h(
    "div",
    null,
    h("button", { type: "button", onClick: () => setAberta(true) }, "Abrir a janela"),
    h(
      JanelaCentral,
      {
        aberta,
        onMudar: (v: boolean) => {
          setAberta(v);
          if (onMudar) onMudar(v);
        },
        titulo: "Biblioteca de teste",
        descricao: "3 itens",
        ajuda: "Explicação que mora no ?",
        largura: "lg",
        rodape: rodape ? h("button", { type: "button" }, "Salvar") : undefined,
        "data-teste": "sim",
      },
      h("input", { "aria-label": "Campo de dentro" }),
      h("p", null, "Conteúdo da janela"),
    ),
  );
}

describe("JanelaCentral: abrir e fechar", () => {
  it("abre no centro com título, estado, '?' e Fechar; Fechar fecha", () => {
    const onMudar = vi.fn();
    render(h(Abridor, { onMudar, rodape: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir a janela" }));
    const janela = screen.getByRole("dialog", { name: "Biblioteca de teste" });
    expect(janela.getAttribute("data-janela-central")).toBe("");
    expect(janela.getAttribute("data-largura")).toBe("lg");
    expect(janela.getAttribute("data-teste")).toBe("sim");
    expect(within(janela).getByText("3 itens")).toBeTruthy();
    expect(within(janela).getByRole("button", { name: "O que é esta janela?" })).toBeTruthy();
    expect(within(janela).getByRole("button", { name: "Salvar" })).toBeTruthy();
    expect(within(janela).getByText("Conteúdo da janela")).toBeTruthy();
    // Centro: o fundo centraliza por flex; no celular a janela ocupa a tela; nada de lado.
    const fundo = janela.parentElement as HTMLElement;
    expect(fundo.className).toContain("items-center");
    expect(fundo.className).toContain("justify-center");
    expect(janela.className).toContain("max-sm:h-full");
    expect(janela.className).toContain("sm:max-w-[720px]");
    expect(janela.className).not.toMatch(/\b(right|left)-0\b|inset-y-0|slide-in-from/);
    // Uma rolagem só: o corpo.
    const corpo = janela.querySelector("[data-corpo-da-janela]") as HTMLElement;
    expect(corpo.getAttribute("data-corpo-da-janela")).toBe("rola");
    expect(corpo.className).toContain("overflow-y-auto");
    fireEvent.click(within(janela).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onMudar).toHaveBeenLastCalledWith(false);
  });

  it("Esc fecha e o foco volta para quem abriu; o foco fica dentro enquanto aberta", async () => {
    render(h(Abridor));
    const abrir = screen.getByRole("button", { name: "Abrir a janela" });
    abrir.focus();
    fireEvent.click(abrir);
    const janela = screen.getByRole("dialog", { name: "Biblioteca de teste" });
    await waitFor(() => expect(janela.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(janela, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(abrir));
  });

  it("rotulo dá o nome da janela; corpo fixo deixa a rolagem para quem está dentro", () => {
    render(
      h(JanelaCentral, { aberta: true, onFechar: () => undefined, titulo: "Reel do jardim", rotulo: "Anúncio Reel do jardim", corpo: "fixo", largura: "tela" }, h("div", null, "conversa")),
    );
    const janela = screen.getByRole("dialog", { name: "Anúncio Reel do jardim" });
    expect(janela.className).toContain("sm:h-[94vh]");
    expect((janela.querySelector("[data-corpo-da-janela]") as HTMLElement).className).toContain("overflow-hidden");
  });

  it("sai também pelo índice do sistema", () => {
    expect(JanelaDoIndice).toBe(JanelaCentral);
  });
});

describe("Biblioteca da Mesa Proposta abre como janela central", () => {
  it("abre no centro (xl), com as partes em abas, e Fechar avisa a mesa", async () => {
    const { default: BibliotecaDaAgencia } = await import("@/components/mesa-proposta/BibliotecaDaAgencia");
    const onAberta = vi.fn();
    const onAba = vi.fn();
    render(
      h(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        h(BibliotecaDaAgencia, { aberta: true, onAberta, aba: "servicos", onAba }),
      ),
    );
    const janela = screen.getByRole("dialog", { name: "Biblioteca comercial" });
    expect(janela.getAttribute("data-janela-central")).toBe("");
    expect(janela.getAttribute("data-largura")).toBe("xl");
    expect(janela.hasAttribute("data-biblioteca-da-agencia")).toBe(true);
    expect(janela.className).not.toMatch(/slide-in-from-right|\bright-0\b/);
    expect(within(janela).getByText("Gestão de redes")).toBeTruthy();
    const abas = within(janela).getByRole("tablist", { name: "Partes da biblioteca" });
    fireEvent.click(within(abas).getByRole("tab", { name: "Hora técnica" }));
    expect(onAba).toHaveBeenCalledWith("hora");
    fireEvent.click(within(janela).getByRole("button", { name: "Fechar" }));
    expect(onAberta).toHaveBeenCalledWith(false);
  });
});
