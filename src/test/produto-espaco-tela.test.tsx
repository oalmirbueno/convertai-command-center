import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { EstadoDoProduto } from "@/lib/produto/api";

/**
 * Espaço do CRM, a tela (13/11/2026): com um banco de mentira na memória,
 * confere o caminho que a pessoa faz. Empresa sem página vê os quatro modelos;
 * um clique cria e abre a página; o endereço guarda a página aberta; quem não
 * pode editar só lê; mexer no título grava sozinho e mostra "Salvo".
 */

type Linha = Record<string, any>;
const banco: { linhas: Linha[]; proximo: number; gravacoes: Array<{ id: string; corpo: Linha; versao?: number }> } = { linhas: [], proximo: 1, gravacoes: [] };

function consulta() {
  const filtros: Array<[string, unknown]> = [];
  let acao: "ler" | "criar" | "mudar" | "apagar" = "ler";
  let corpo: Linha = {};
  let um = false;
  const rodar = () => {
    const bate = (l: Linha) => filtros.every(([c, v]) => l[c] === v);
    if (acao === "criar") {
      const agora = new Date().toISOString();
      const nova: Linha = { id: `p${banco.proximo}`, conta_id: "conta-1", criado_por: "ana", atualizado_por: "ana", criado_em: agora, atualizado_em: agora, arquivada_em: null, versao: 1, ...corpo };
      banco.proximo += 1;
      banco.linhas.push(nova);
      return { data: um ? nova : [nova], error: null };
    }
    if (acao === "mudar") {
      const alvo = banco.linhas.filter(bate);
      alvo.forEach((l) => {
        banco.gravacoes.push({ id: l.id, corpo, versao: (filtros.filter(([c]) => c === "versao")[0] || [])[1] as number | undefined });
        Object.assign(l, corpo, { versao: l.versao + 1, atualizado_em: new Date().toISOString() });
      });
      return { data: alvo, error: null };
    }
    if (acao === "apagar") {
      const alvo = banco.linhas.filter(bate);
      banco.linhas = banco.linhas.filter((l) => !bate(l));
      return { data: alvo, error: null };
    }
    const achadas = banco.linhas.filter(bate);
    return { data: um ? achadas[0] || null : achadas, error: null };
  };
  const q: any = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: (c: string, v: unknown) => {
      filtros.push([c, v]);
      return q;
    },
    insert: (c: Linha) => {
      acao = "criar";
      corpo = c;
      return q;
    },
    update: (c: Linha) => {
      acao = "mudar";
      corpo = c;
      return q;
    },
    delete: () => {
      acao = "apagar";
      return q;
    },
    single: () => {
      um = true;
      return q;
    },
    maybeSingle: () => {
      um = true;
      return q;
    },
    then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve().then(rodar).then(ok, falha),
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => consulta() } }));
const login = { id: "ana" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: login }) }));

import EspacoDaConta from "@/components/produto/espaco/EspacoDaConta";

function estado(papel: "admin" | "gerente" | "usuario"): EstadoDoProduto {
  return {
    conta: { id: "conta-1", nome: "Imobiliária Horizonte", perfil: { nicho: "imobiliaria", etapas: { diagnostico: "Visita" } } },
    eu: { membro_id: "m1", papel, nome: "Ana", email: "ana@h.com" },
    equipe: [{ id: "m1", user_id: "ana", nome: "Ana", email: "ana@h.com", papel, estado: "ativo" }],
  } as unknown as EstadoDoProduto;
}

let endereco = "";
function Endereco() {
  const l = useLocation();
  endereco = l.pathname + l.search;
  return null;
}

function montar(papel: "admin" | "gerente" | "usuario" = "admin", em = "/app/espaco") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[em]}>
        <Endereco />
        <EspacoDaConta estado={estado(papel)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pagina = (extra: Linha): Linha => ({
  id: "x",
  conta_id: "conta-1",
  pai_id: null,
  titulo: "Página",
  icone: null,
  conteudo: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto da página" }] }] },
  visivel_para: "todos",
  ordem: 1,
  versao: 1,
  criado_por: "ana",
  atualizado_por: "ana",
  criado_em: "2026-11-13T10:00:00Z",
  atualizado_em: "2026-11-13T10:00:00Z",
  arquivada_em: null,
  ...extra,
});

beforeEach(() => {
  banco.linhas = [];
  banco.proximo = 1;
  banco.gravacoes = [];
  login.id = "ana";
  window.localStorage.clear();
});

describe("Espaço: a tela", () => {
  it("empresa sem página vê os quatro modelos, e um clique cria e abre o Playbook", async () => {
    const { container } = montar();
    await screen.findByText("O Espaço da equipe começa aqui");
    expect(Array.from(container.querySelectorAll("[data-modelo]")).map((b) => b.getAttribute("data-modelo"))).toEqual(["playbook", "roteiro", "objecoes", "boas_vindas"]);

    fireEvent.click(screen.getByText("Playbook de vendas"));
    await waitFor(() => expect(endereco).toBe("/app/espaco?pagina=p1"));
    expect(banco.linhas).toHaveLength(1);
    expect(banco.linhas[0].titulo).toBe("Playbook de vendas");
    expect(JSON.stringify(banco.linhas[0].conteudo)).toContain("Imobiliária Horizonte");

    // A página abre com o título editável e o editor mostra o conteúdo do modelo.
    await waitFor(() => expect((container.querySelector("textarea[data-titulo-da-pagina]") as HTMLTextAreaElement).value).toBe("Playbook de vendas"));
    await waitFor(() => expect(container.querySelector("[data-editor-da-pagina] .ProseMirror")).not.toBeNull(), { timeout: 8000 });
    const texto = container.querySelector("[data-editor-da-pagina] .ProseMirror") as HTMLElement;
    expect(texto.getAttribute("contenteditable")).toBe("true");
    expect(texto.textContent).toContain("Quem compra da gente");
    expect(texto.querySelectorAll("h2").length).toBeGreaterThanOrEqual(5);
    expect(texto.querySelectorAll("ul[data-type='taskList'] input[type='checkbox']").length).toBe(4);
    expect(container.querySelector("[data-ferramentas]")).not.toBeNull();
    expect(container.querySelector("[data-lista-de-paginas] [data-pagina='p1']")).not.toBeNull();
  });

  it("a árvore mostra página dentro de página, recolhe, e a página do endereço abre com a trilha", async () => {
    banco.linhas = [pagina({ id: "a", titulo: "Playbook", ordem: 1 }), pagina({ id: "b", titulo: "Etapas", pai_id: "a" }), pagina({ id: "c", titulo: "Roteiro", ordem: 2 }), pagina({ id: "z", titulo: "Antiga", arquivada_em: "2026-11-01T00:00:00Z" })];
    const { container } = montar("admin", "/app/espaco?pagina=b");
    await waitFor(() => expect(container.querySelectorAll("[data-lista-de-paginas] > li").length).toBe(3));
    const linhas = () => Array.from(container.querySelectorAll("[data-lista-de-paginas] > li")).map((li) => `${li.getAttribute("data-nivel")}:${li.getAttribute("data-pagina")}`);
    expect(linhas()).toEqual(["0:a", "1:b", "0:c"]);

    await waitFor(() => expect(container.querySelector("[data-pagina-aberta='b']")).not.toBeNull());
    expect((container.querySelector("[data-trilha]") as HTMLElement).textContent).toContain("Playbook");
    expect((container.querySelector("[data-trilha]") as HTMLElement).textContent).toContain("Etapas");

    fireEvent.click(screen.getByLabelText("Recolher as páginas de Playbook"));
    expect(linhas()).toEqual(["0:a", "0:c"]);
    fireEvent.click(screen.getByLabelText("Mostrar as páginas de Playbook"));
    expect(linhas()).toEqual(["0:a", "1:b", "0:c"]);

    // Abrir outra página troca o endereço.
    fireEvent.click(screen.getByText("Roteiro"));
    await waitFor(() => expect(endereco).toBe("/app/espaco?pagina=c"));
  });

  it("mexer no título grava sozinho, dizendo a versão que leu, e mostra Salvo", async () => {
    banco.linhas = [pagina({ id: "a", titulo: "Playbook", versao: 4 })];
    const { container } = montar("admin", "/app/espaco?pagina=a");
    const campo = (await waitFor(() => {
      const el = container.querySelector("textarea[data-titulo-da-pagina]");
      if (!el) throw new Error("sem título");
      return el;
    })) as HTMLTextAreaElement;
    expect((container.querySelector("[data-situacao]") as HTMLElement).getAttribute("data-situacao")).toBe("salvo");

    fireEvent.change(campo, { target: { value: "Playbook de vendas 2027" } });
    expect((container.querySelector("[data-situacao]") as HTMLElement).textContent).toContain("Salvando");
    await waitFor(() => expect(banco.gravacoes).toHaveLength(1), { timeout: 4000 });
    expect(banco.gravacoes[0]).toEqual({ id: "a", corpo: { titulo: "Playbook de vendas 2027" }, versao: 4 });
    await waitFor(() => expect((container.querySelector("[data-situacao]") as HTMLElement).textContent).toContain("Salvo"));
    // A árvore passa a mostrar o título novo.
    await waitFor(() => expect((container.querySelector("[data-lista-de-paginas] [data-pagina='a']") as HTMLElement).textContent).toContain("Playbook de vendas 2027"));
  });

  it("outra pessoa gravou antes: avisa em vez de passar por cima", async () => {
    banco.linhas = [pagina({ id: "a", titulo: "Playbook", versao: 4 })];
    const { container } = montar("admin", "/app/espaco?pagina=a");
    const campo = (await waitFor(() => {
      const el = container.querySelector("textarea[data-titulo-da-pagina]");
      if (!el) throw new Error("sem título");
      return el;
    })) as HTMLTextAreaElement;
    banco.linhas[0].versao = 5;
    banco.linhas[0].titulo = "Playbook do Gil";
    fireEvent.change(campo, { target: { value: "Playbook da Ana" } });
    await waitFor(() => expect(container.querySelector("[data-aviso-conflito]")).not.toBeNull(), { timeout: 4000 });
    expect(banco.linhas[0].titulo).toBe("Playbook do Gil");
    expect(banco.gravacoes).toHaveLength(0);

    fireEvent.click(screen.getByText("Manter a minha"));
    await waitFor(() => expect(banco.linhas[0].titulo).toBe("Playbook da Ana"));
    await waitFor(() => expect(container.querySelector("[data-aviso-conflito]")).toBeNull());
  });

  it("vendedor lê a página de outra pessoa sem poder editar", async () => {
    banco.linhas = [pagina({ id: "a", titulo: "Playbook", criado_por: "hugo" })];
    const { container } = montar("usuario", "/app/espaco?pagina=a");
    await waitFor(() => expect(container.querySelector("[data-pagina-aberta='a']")).not.toBeNull());
    expect(container.querySelector("[data-pagina-aberta='a']")!.getAttribute("data-editavel")).toBe("nao");
    expect(container.querySelector("textarea[data-titulo-da-pagina]")).toBeNull();
    expect((container.querySelector("h2[data-titulo-da-pagina]") as HTMLElement).textContent).toBe("Playbook");
    expect(screen.getByText("Só leitura")).toBeTruthy();
    expect(container.querySelector("select[data-quem-ve]")).toBeNull();
    await waitFor(() => expect(container.querySelector("[data-editor-da-pagina] .ProseMirror")).not.toBeNull(), { timeout: 8000 });
    expect((container.querySelector("[data-editor-da-pagina] .ProseMirror") as HTMLElement).getAttribute("contenteditable")).toBe("false");
    expect(container.querySelector("[data-ferramentas]")).toBeNull();
  });

  it("o seletor de quem vê oferece só o que o cargo pode, e grava a escolha", async () => {
    banco.linhas = [pagina({ id: "a", titulo: "Anotações" })];
    const { container, unmount } = montar("usuario", "/app/espaco?pagina=a");
    const seletor = (await waitFor(() => {
      const el = container.querySelector("select[data-quem-ve]");
      if (!el) throw new Error("sem seletor");
      return el;
    })) as HTMLSelectElement;
    expect(Array.from(seletor.options).map((o) => o.value)).toEqual(["todos", "eu"]);
    fireEvent.change(seletor, { target: { value: "eu" } });
    await waitFor(() => expect(banco.linhas[0].visivel_para).toBe("eu"), { timeout: 4000 });
    unmount();

    banco.linhas = [pagina({ id: "a", titulo: "Anotações", criado_por: "vera" })];
    const outra = montar("gerente", "/app/espaco?pagina=a");
    const doGestor = (await waitFor(() => {
      const el = outra.container.querySelector("select[data-quem-ve]");
      if (!el) throw new Error("sem seletor");
      return el;
    })) as HTMLSelectElement;
    expect(Array.from(doGestor.options).map((o) => o.value)).toEqual(["todos", "gestores"]);
  });

  it("no editor: a barra abre os tipos de bloco, Enter aplica, e o atalho de markdown vira título e tarefa", async () => {
    // O jsdom não mede texto: devolve zero para o editor conseguir posicionar o menu.
    const zero = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    const semMedida = () => [zero] as unknown as DOMRectList;
    Range.prototype.getClientRects = semMedida;
    Range.prototype.getBoundingClientRect = () => zero as DOMRect;
    Element.prototype.getClientRects = semMedida;

    banco.linhas = [pagina({ id: "a", titulo: "Playbook", conteudo: { type: "doc", content: [{ type: "paragraph" }] } })];
    const { container } = montar("admin", "/app/espaco?pagina=a");
    const dom = (await waitFor(
      () => {
        const el = container.querySelector("[data-editor-da-pagina] .ProseMirror");
        if (!el) throw new Error("sem editor");
        return el;
      },
      { timeout: 8000 },
    )) as HTMLElement & { editor: any };
    const editor = dom.editor;
    const digitar = (texto: string) =>
      act(() => {
        for (const letra of texto.split("")) {
          const { from, to } = editor.state.selection;
          const tratou = editor.view.someProp("handleTextInput", (f: any) => f(editor.view, from, to, letra));
          if (!tratou) editor.view.dispatch(editor.state.tr.insertText(letra, from, to));
        }
      });
    const tecla = (key: string) => act(() => void fireEvent.keyDown(dom, { key }));

    // O jsdom só dá foco a quem tem tabindex; no navegador o próprio contenteditable recebe.
    dom.setAttribute("tabindex", "0");
    const focar = () =>
      act(() => {
        dom.focus();
        editor.commands.setTextSelection(editor.state.doc.content.size);
      });
    focar();
    expect(editor.isFocused).toBe(true);

    // Menu de barra.
    digitar("/");
    await waitFor(() => expect(container.querySelector("[data-menu-de-barra]")).not.toBeNull());
    expect(container.querySelectorAll("[data-menu-de-barra] [role='option']").length).toBe(10);
    digitar("tit");
    await waitFor(() => expect(Array.from(container.querySelectorAll("[data-menu-de-barra] [role='option']")).map((b) => b.getAttribute("data-bloco"))).toEqual(["titulo1", "titulo2", "titulo3"]));
    tecla("ArrowDown");
    await waitFor(() => expect(container.querySelector("[data-menu-de-barra] [aria-selected='true']")!.getAttribute("data-bloco")).toBe("titulo2"));
    tecla("Enter");
    await waitFor(() => expect(container.querySelector("[data-menu-de-barra]")).toBeNull());
    expect(editor.getJSON().content[0]).toEqual({ type: "heading", attrs: { level: 2 } });
    digitar("Etapas do funil");
    expect(dom.querySelector("h2")!.textContent).toBe("Etapas do funil");

    // Esc fecha o menu sem aplicar, e a barra fica no texto.
    act(() => void editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" }));
    focar();
    digitar("/");
    await waitFor(() => expect(container.querySelector("[data-menu-de-barra]")).not.toBeNull());
    tecla("Escape");
    await waitFor(() => expect(container.querySelector("[data-menu-de-barra]")).toBeNull());
    digitar("lis");
    expect(container.querySelector("[data-menu-de-barra]")).toBeNull();
    expect(editor.getJSON().content[1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "/lis" }] });

    // Clicar num item do menu também aplica.
    act(() => void editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" }));
    focar();
    digitar("/tare");
    const opcao = await waitFor(() => {
      const el = container.querySelector("[data-menu-de-barra] [data-bloco='tarefas']");
      if (!el) throw new Error("sem a opção");
      return el;
    });
    act(() => void fireEvent.click(opcao));
    expect(editor.getJSON().content[2].type).toBe("taskList");
    expect(dom.querySelectorAll("ul[data-type='taskList'] input[type='checkbox']").length).toBe(1);

    // Atalhos de markdown: "# " vira título 1, "- " vira lista, "> " vira citação.
    for (const [atalho, tipo] of [["# ", "heading"], ["- ", "bulletList"], ["> ", "blockquote"], ["1. ", "orderedList"], ["[ ] ", "taskList"]] as const) {
      act(() => void editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" }));
      focar();
      digitar(atalho);
      const blocos = editor.getJSON().content;
      expect(`${atalho}=> ${blocos[blocos.length - 1].type}`).toBe(`${atalho}=> ${tipo}`);
    }

    // Tudo isso foi para o salvamento automático.
    await waitFor(() => expect(banco.gravacoes.length).toBeGreaterThan(0), { timeout: 4000 });
    expect(JSON.stringify(banco.linhas[0].conteudo)).toContain("Etapas do funil");
    await waitFor(() => expect((container.querySelector("[data-situacao]") as HTMLElement).textContent).toContain("Salvo"), { timeout: 4000 });
  });

  it("página que não existe (ou sem acesso) mostra o aviso, não uma tela quebrada", async () => {
    banco.linhas = [pagina({ id: "a", titulo: "Playbook" })];
    montar("admin", "/app/espaco?pagina=nao-existe");
    await screen.findByText("Página não encontrada");
    fireEvent.click(screen.getByText("Ver as páginas"));
    await waitFor(() => expect(endereco).toBe("/app/espaco"));
  });

  it("criar página em branco pelo mais abre a página nova com o cursor no título", async () => {
    banco.linhas = [pagina({ id: "a", titulo: "Playbook", ordem: 3 })];
    const { container } = montar("usuario", "/app/espaco");
    await waitFor(() => expect(container.querySelector("[data-nova-pagina]")).not.toBeNull());
    await act(async () => {
      fireEvent.click(container.querySelector("[data-nova-pagina]") as HTMLElement);
    });
    await waitFor(() => expect(endereco).toBe("/app/espaco?pagina=p1"));
    expect(banco.linhas[1]).toMatchObject({ titulo: "", pai_id: null, ordem: 4, visivel_para: "todos" });
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector("textarea[data-titulo-da-pagina]")));
  });
});
