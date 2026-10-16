import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import CadernoDoDossie, {
  preservarQuebras, secoesDoDossie, tituloLegivel, useCaderno,
} from "@/components/admin/CadernoDoDossie";
import DossieDoCliente from "@/components/admin/DossieDoCliente";

/** Banco simulado: o dossiê atual, o histórico e um dossiê de projeto mais novo. */
vi.mock("@/integrations/supabase/client", () => {
  const atual = {
    content: "Abertura.\n\n## Quem é\nCliente.\n\n## Próximo passo\nAtivar mídia.",
    summary: null, version: 3, change_reason: "entrou a frente de tráfego", source: "mcp",
    updated_at: "2026-10-15T10:00:00Z", effective_at: null,
  };
  const irmao = {
    id: "d2", dossier_type: "contexto", project_id: "p1", version: 2, summary: "site novo",
    updated_at: "2026-10-16T10:00:00Z", project: { name: "Site" },
  };
  const versoes = [
    { id: "v3", version: 3, summary: null, change_reason: "entrou a frente de tráfego", source: "mcp", created_at: "2026-10-15T10:00:00Z", is_current: true, content: "a\nb" },
    { id: "v2", version: 2, summary: null, change_reason: null, source: "mcp", created_at: "2026-10-10T10:00:00Z", is_current: false, content: "a" },
  ];
  const from = (tabela: string) => {
    let colunas = "";
    const responder = () => {
      if (tabela !== "client_dossiers") return { data: [], error: null };
      if (colunas.includes("dossier_type")) return { data: [irmao], error: null };
      return { data: versoes, error: null };
    };
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "is", "in", "order", "limit"]) b[m] = () => b;
    b.select = (c: string) => { colunas = c; return b; };
    b.maybeSingle = () => Promise.resolve({ data: atual, error: null });
    b.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(responder()).then(ok, erro);
    return b;
  };
  return { supabase: { from } };
});

/**
 * O dossiê lido como caderno (16/10, dono: "abrindo como se fosse um caderno
 * mesmo ... e não um monte de código"). O texto do banco é o mesmo; estes
 * testes guardam que ele vira seções com título, sumário e recolher, nos dois
 * formatos que existem (Markdown com ## e o texto puro do prompt semanal).
 */

const raiz = resolve(__dirname, "../..");
const fonte = readFileSync(resolve(raiz, "src/components/admin/CadernoDoDossie.tsx"), "utf8");
const painel = readFileSync(resolve(raiz, "src/components/admin/DossieDoCliente.tsx"), "utf8");

const PROMPT_SEMANAL = [
  "Cliente: Vifut.com.br",
  "",
  "ONDE ESTAMOS",
  "Em 18/08/2026 o plano Vid Pro segue ativo.",
  "",
  "FRENTES CONTRATADAS E ESTADO DE CADA UMA",
  "Conteúdo: 3 reels na semana",
  "Tráfego: pausado",
  "",
  "CAMPANHAS E TRÁFEGO",
  "DESCONHECIDO",
  "",
  "SEO E GMB",
  "Ficha do Google revisada.",
].join("\n");

describe("o texto vira seções", () => {
  it("formato do prompt semanal: título em caixa alta numa linha sozinha", () => {
    const p = secoesDoDossie(PROMPT_SEMANAL);
    expect(p.abertura).toBe("Cliente: Vifut.com.br");
    expect(p.secoes.map((s) => s.titulo)).toEqual([
      "Onde estamos",
      "Frentes contratadas e estado de cada uma",
      "Campanhas e tráfego",
      "SEO e GMB",
    ]);
    // "DESCONHECIDO" é a palavra do formato, não título.
    expect(p.secoes[2].corpo).toBe("DESCONHECIDO");
  });

  it("Markdown: o # sozinho fica na abertura e os ## viram as seções", () => {
    const p = secoesDoDossie("# Dossiê Vifut\n\n## Quem é\nTexto.\n\n## Próximo passo\n- Ativar mídia\n- Revisar verba");
    expect(p.abertura).toBe("# Dossiê Vifut");
    expect(p.secoes.map((s) => s.titulo)).toEqual(["Quem é", "Próximo passo"]);
    expect(p.secoes[1].resumo).toBe("Ativar mídia Revisar verba");
  });

  it("título dentro de bloco de código não corta seção", () => {
    const p = secoesDoDossie("## Um\n```\n## não é título\n```\n## Dois\nfim");
    expect(p.secoes.map((s) => s.titulo)).toEqual(["Um", "Dois"]);
  });

  it("texto sem título nenhum fica inteiro na abertura", () => {
    const p = secoesDoDossie("Só um parágrafo.\nOutra linha.");
    expect(p.secoes).toEqual([]);
    expect(p.abertura).toContain("Outra linha.");
  });

  it("título em caixa alta fica legível e sigla curta continua sigla", () => {
    expect(tituloLegivel("ONDE ESTAMOS")).toBe("Onde estamos");
    expect(tituloLegivel("O QUE FOI PROMETIDO NA ÚLTIMA MENSAGEM")).toBe("O que foi prometido na última mensagem");
    expect(tituloLegivel("CAMPANHAS NO CRM")).toBe("Campanhas no CRM");
    expect(tituloLegivel("1. **Quem é**:")).toBe("Quem é");
  });

  it("Enter simples do texto puro vira quebra de linha, lista e tabela não", () => {
    expect(preservarQuebras("Conteúdo: x\nTráfego: y")).toBe("Conteúdo: x  \nTráfego: y");
    expect(preservarQuebras("Itens:\n- a\n- b")).toBe("Itens:\n- a\n- b");
    expect(preservarQuebras("| a | b |\n|---|---|")).toBe("| a | b |\n|---|---|");
  });

  it("seção longa nasce recolhida, curta nasce aberta", () => {
    const p = secoesDoDossie(`## Curta\nok\n\n## Longa\n${"palavra ".repeat(120)}`);
    expect(p.secoes[0].longa).toBe(false);
    expect(p.secoes[1].longa).toBe(true);
  });
});

function Caderno({ texto }: { texto: string }) {
  const caderno = useCaderno(texto);
  return h("div", null,
    h("button", { type: "button", onClick: caderno.alternarTudo }, caderno.tudoAberto ? "Recolher seções" : "Ler o dossiê inteiro"),
    h(CadernoDoDossie, { caderno }));
}

describe("o caderno na tela", () => {
  const TEXTO = `Abertura curta.\n\n## Quem é\nCliente de **futebol**.\n\n## Histórico\n${"Linha longa de histórico. ".repeat(40)}`;

  it("mostra o sumário com as seções e o Markdown formatado, sem HTML cru", () => {
    const { container } = render(h(Caderno, { texto: `${TEXTO}\n\n<script>alert(1)</script>` }));
    const sumario = screen.getByRole("navigation", { name: "Sumário do dossiê" });
    expect(sumario.textContent).toContain("01Quem é");
    expect(sumario.textContent).toContain("02Histórico");
    expect(container.querySelector("strong")?.textContent).toBe("futebol");
    expect(container.querySelector("script")).toBeNull();
  });

  it("a seção longa abre pelo sumário, pelo título e pelo abrir tudo", () => {
    const { container } = render(h(Caderno, { texto: TEXTO }));
    const secoes = () => Array.from(container.querySelectorAll("[data-secao-do-caderno]")).map((s) => s.getAttribute("data-secao-do-caderno"));
    expect(secoes()).toEqual(["aberta", "recolhida"]);

    const titulo = screen.getByRole("button", { name: /Histórico/, expanded: false });
    fireEvent.click(titulo);
    expect(secoes()).toEqual(["aberta", "aberta"]);
    fireEvent.click(titulo);
    expect(secoes()).toEqual(["aberta", "recolhida"]);

    fireEvent.click(screen.getByText("Ler o dossiê inteiro"));
    expect(secoes()).toEqual(["aberta", "aberta"]);
    fireEvent.click(screen.getByText("Recolher seções"));
    expect(secoes()).toEqual(["recolhida", "recolhida"]);

    const atalhos = container.querySelectorAll("[data-atalho-do-sumario]");
    fireEvent.click(atalhos[1]);
    expect(secoes()).toEqual(["recolhida", "aberta"]);
  });
});

describe("o dossiê em abas (17/10)", () => {
  it("abre no caderno e troca para versões e outros dossiês, uma parte por vez", async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: cliente }, h(DossieDoCliente, { clientId: "c1", clientName: "Vifut" })));

    const abas = screen.getByRole("navigation", { name: "Partes do dossiê" });
    await screen.findByRole("navigation", { name: "Sumário do dossiê" });
    expect(abas.querySelector('[aria-current="page"]')?.getAttribute("data-etapa")).toBe("caderno");
    // Rótulo curto da data; a última mudança aparece sem o prefixo longo.
    expect(screen.getByText(/^atualizado /)).toBeTruthy();
    expect(screen.getByTitle("Última mudança: entrou a frente de tráfego")).toBeTruthy();
    // Ações em ícone, com o nome só no aria-label.
    expect(screen.getByRole("button", { name: "Atualizar dossiê" }).textContent).toBe("");
    // Seções curtas nascem abertas: o botão de tudo começa em "recolher".
    expect(screen.getByRole("button", { name: "Recolher seções" }).textContent).toBe("");

    await waitFor(() => expect(abas.querySelector('[data-etapa="outros"]')).not.toBeNull());
    fireEvent.click(abas.querySelector('[data-etapa="versoes"]') as HTMLElement);
    const historico = await screen.findByRole("list", { name: "Histórico de versões" });
    await waitFor(() => expect(historico.textContent).toContain("v2"));
    expect(screen.queryByRole("navigation", { name: "Sumário do dossiê" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ver" }));
    expect(screen.getByRole("list", { name: "Outros dossiês atuais" }).textContent).toContain("Projeto: Site");
    expect(screen.queryByRole("list", { name: "Histórico de versões" })).toBeNull();
  });
});

describe("regras do painel no código do caderno", () => {
  it("compatível com navegador antigo: sem lookbehind, \\p{} nem grupo nomeado", () => {
    for (const arquivo of [fonte, painel]) {
      expect(arquivo).not.toMatch(/\(\?<[=!]/);
      expect(arquivo).not.toMatch(/\\p\{/);
      expect(arquivo).not.toMatch(/\(\?<[A-Za-z]/);
    }
  });

  it("nunca HTML cru e nenhuma cor fixa", () => {
    for (const arquivo of [fonte, painel]) {
      expect(arquivo).not.toContain("dangerouslySetInnerHTML");
      expect(arquivo).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });

  it("o dossiê usa o caderno e mantém as funções", () => {
    expect(painel).toContain("<CadernoDoDossie caderno={caderno} />");
    for (const funcao of ["Ler o dossiê inteiro", "Ver histórico", "Outros dossiês atuais", "<EntregasNoDossie clientId={clientId} />", "Abrir memória e aprendizados", 'aria-label="Atualizar dossiê"']) {
      expect(painel).toContain(funcao);
    }
  });

  it("as partes viram abas em ícone no topo, com o caderno primeiro (17/10)", () => {
    // Dono: "o scroll está muito longo... tabs aqui em cima".
    expect(painel).toContain("<Etapas");
    expect(painel).toContain("soIcone");
    expect(painel).toContain('{ clientId, aba: "caderno" }');
    for (const parte of ['valor: "caderno"', 'valor: "versoes"', 'valor: "memoria"', 'valor: "entregas"', 'valor: "outros"']) {
      expect(painel).toContain(parte);
    }
    // Uma parte por vez: nada mais empilhado embaixo do texto.
    expect(painel).toContain('{aba === "memoria" && <CerebroDoCliente');
    expect(painel).toContain('{aba === "entregas" && (');
  });

  it("ações só em ícone, cada uma com o próprio ícone e o nome no title", () => {
    expect(painel).toContain("ChevronsUpDown");
    expect(painel).toContain("ChevronsDownUp");
    expect(painel).toContain("RefreshCw");
    // Os textos longos de antes saíram da tela.
    for (const longo of ["Atualizado em {new Date", "Última mudança: {", "Fechar histórico", "Recolher segundo cérebro"]) {
      expect(painel).not.toContain(longo);
    }
  });

  it("menos preto cheio: corpo em tom suave e número da seção em cor", () => {
    expect(fonte).toContain("text-foreground/75");
    expect(fonte).toContain("bg-info/10 text-info");
    expect(fonte).not.toContain("texto.tituloSecao");
  });
});
