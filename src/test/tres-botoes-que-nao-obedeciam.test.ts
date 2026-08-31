import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Três coisas que existiam na tela e não obedeciam ao clique.
 *
 * Botão que existe e não faz nada é pior que botão ausente: ensina que a
 * tela está quebrada e some com a confiança no resto.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

describe("a menção lia o texto atrasado", () => {
  const drawer = ler("src/components/admin/TaskDetailDrawer.tsx");

  it("o texto vem do evento, não do estado memoizado", () => {
    // getMentionContext é memoizado em [commentText]; chamá-la dentro de
    // um setTimeout executava a versão presa ao texto ANTERIOR. Ao digitar
    // "@" a função ainda lia o texto sem o "@" e o menu nunca abria.
    expect(drawer).toContain("const valor = e.target.value;");
    expect(drawer).toContain("const cursor = e.target.selectionStart;");
    expect(drawer).toContain("const antes = valor.slice(0, cursor);");
  });

  it("não há mais setTimeout no caminho da menção", () => {
    // Escopo no CORPO do handler: há setTimeout legítimo em insertMention,
    // logo abaixo, e reprovar por ele seria testar a coisa errada.
    const inicio = drawer.indexOf("const handleCommentChange");
    const corpo = drawer.slice(inicio, drawer.indexOf("const insertMention", inicio));
    // A CHAMADA, não a palavra: o comentário que explica o bug antigo cita
    // setTimeout, e reprovar por ele seria reprovar a própria explicação.
    expect(corpo).not.toContain("setTimeout(");
  });

  it("o padrão da menção continua o mesmo", () => {
    // Montado por partes: escrever a barra invertida literal aqui é o tipo
    // de coisa que o shell come no caminho e faz o teste passar vazio.
    const padrao = ["antes.match(/@(", String.fromCharCode(92), "w*)$/)"].join("");
    expect(drawer).toContain(padrao);
  });
});

describe("o cartão da Execução abre com clique", () => {
  const pagina = ler("src/pages/AdminExecucao.tsx");

  it("tem clique esquerdo, além do menu de botão direito", () => {
    // Só havia onContextMenu: quem clicava normalmente não via nada, e a
    // conclusão natural era que o quadro estava quebrado.
    const cartao = pagina.slice(pagina.indexOf("const Cartao = ("));
    const abertura = cartao.slice(0, cartao.indexOf("</div>"));
    expect(abertura).toContain("onClick={() => {");
    expect(abertura).toContain("onContextMenu=");
  });

  it("dá para abrir pelo teclado", () => {
    expect(pagina).toContain('role="button"');
    expect(pagina).toContain('if (e.key !== "Enter" && e.key !== " ") return;');
  });

  it("os botões de dentro não disparam a abertura", () => {
    // Sem stopPropagation, clicar em "diário" abriria a tarefa junto.
    expect(pagina).toContain("onClick={(e) => { e.stopPropagation(); setVisao(\"aprovacao\"); }}");
    expect(pagina).toContain("e.stopPropagation(); setDiarioAberto(");
  });

  it("procura a tarefa pelos dois campos de id", () => {
    expect(pagina).toContain("v.kanban_task_id ?? (v as any).painel_task_id");
  });
});

describe("o recolher do Escritório obedece", () => {
  const esc = ler("src/components/execucao/Escritorio.tsx");

  it("a escolha da pessoa vale nos dois sentidos", () => {
    // A versão anterior só guardava as ABERTAS e o padrão era um OU: numa
    // área com trabalho o padrão ganhava sempre e o clique de recolher não
    // fazia nada.
    expect(esc).toContain("escolhas[area] ?? urgencia < 90");
    expect(esc).not.toContain("abertasPelaPessoa.has(area) || urgencia < 90");
  });

  it("o padrão só decide onde ninguém escolheu", () => {
    expect(esc).toContain("!(atual[area] ?? urgencia < 90)");
  });

  it("o botão recebe a urgência, senão o padrão seria outro no clique", () => {
    expect(esc).toContain("alternar(area, urgencia)");
  });
});
