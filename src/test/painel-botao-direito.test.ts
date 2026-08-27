import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Botão direito pelo painel: cada tela com as funções DAQUELE lugar.
 *
 * O pedido: "em todos os lugares ter o botão direito, só que com funções
 * que sejam para aquilo — copiar, criar pasta, etc, bem completinho". A
 * regra que atravessa as três telas: o menu REUSA as ações que já existem
 * (abrir, mover, excluir, baixar) — um menu com lógica própria divergiria
 * do caminho principal no primeiro conserto.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

describe("o componente compartilhado de menu no cursor", () => {
  const menu = ler("src/components/ui/menu-de-contexto.tsx");

  it("fecha com Escape, clique fora e outro botao direito", () => {
    expect(menu).toContain('e.key === "Escape"');
    expect(menu).toContain("onClick={aoFechar}");
    expect(menu).toContain("aoFechar();");
  });

  it("nao vaza da tela perto da borda", () => {
    expect(menu).toContain("window.innerWidth - 240");
    expect(menu).toContain("window.innerHeight - altura");
  });

  it("acao destrutiva se veste de destrutiva", () => {
    expect(menu).toContain("item.destrutivo");
    expect(menu).toContain("text-destructive");
  });
});

describe("kanban: botao direito no cartao da tarefa", () => {
  const kanban = ler("src/pages/Kanban.tsx");

  it("reusa as acoes que ja existem, sem caminho paralelo", () => {
    // Abrir, mover e excluir passam pelos MESMOS handlers do menu de tres
    // pontos: handleCardClick, changeStatus e setDeleteTask (que abre a
    // mesma confirmacao).
    const trecho = kanban.slice(
      kanban.indexOf("function itensDaTarefa"),
      kanban.indexOf("const handleCardClick"),
    );
    expect(trecho).toContain("handleCardClick(task)");
    expect(trecho).toContain("changeStatus(task, c.id)");
    expect(trecho).toContain("setDeleteTask(task)");
  });

  it("copiar titulo existe e leva o projeto junto", () => {
    expect(kanban).toContain('"Copiar título"');
    expect(kanban).toContain("[task.title, task.project?.name]");
  });

  it("cliente ve so abrir e copiar; mover e excluir sao da equipe", () => {
    const trecho = kanban.slice(
      kanban.indexOf("function itensDaTarefa"),
      kanban.indexOf("const handleCardClick"),
    );
    expect(trecho).toContain("if (!isClient) {");
    // Tarefa nascida de solicitacao nao pode ser excluida por aqui, igual
    // ao menu de tres pontos.
    expect(trecho).toContain("requestIdFromTaskSource(task.source)");
  });

  it("os DOIS layouts de cartao tem o gesto", () => {
    const usos = kanban.match(/setMenuTarefa\(\{ x: e\.clientX/g) ?? [];
    expect(usos.length).toBe(2);
  });
});

describe("clientes: botao direito na linha", () => {
  const clientes = ler("src/pages/Clients.tsx");

  it("abrir e copiar os contatos", () => {
    expect(clientes).toContain('"Abrir cadastro"');
    expect(clientes).toContain('"Copiar nome"');
    expect(clientes).toContain('"Copiar e-mail"');
    expect(clientes).toContain('"Copiar telefone"');
  });

  it("contato ausente nao vira item morto no menu", () => {
    // Cliente sem e-mail nao mostra "Copiar e-mail" — item que copia vazio
    // parece funcionar e nao faz nada.
    const trecho = clientes.slice(
      clientes.indexOf("function itensDoCliente"),
      clientes.indexOf("return itens;"),
    );
    expect(trecho).toContain("if (c.email)");
    expect(trecho).toContain("if (c.phone)");
  });

  it("abrir WhatsApp usa so digitos e abre em aba nova segura", () => {
    expect(clientes).toContain('replace(/\\D/g, "")');
    expect(clientes).toContain('"noopener,noreferrer"');
  });
});

describe("workspace: copiar imagem do arquivo", () => {
  const workspace = ler("src/pages/Workspace.tsx");

  it("existe nos DOIS menus (tres pontos e botao direito), so para imagem", () => {
    const usos = workspace.match(/kindOf\(n\) === "image" && \(/g) ?? [];
    expect(usos.length).toBe(2);
    expect(workspace).toContain("Copiar imagem");
  });

  it("converte para PNG quando preciso: e o unico formato que o clipboard aceita", () => {
    expect(workspace).toContain('blob.type !== "image/png"');
    expect(workspace).toContain("createImageBitmap");
    expect(workspace).toContain('new ClipboardItem({ "image/png": png })');
  });

  it("falha aponta o caminho que funciona sempre", () => {
    expect(workspace).toContain("Baixe o arquivo e copie do disco.");
  });
});
