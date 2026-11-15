import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 14/11/2026, agência autogerenciável:
 *  - o menu perde o que não se usa (Pedidos), por uma lista reversível, sem
 *    tirar rota, página nem tabela;
 *  - a ficha do cliente mostra como ele aprova as peças (só admin altera), e
 *    isso continua sendo só o registro da regra.
 */

const banco = vi.hoisted(() => ({
  modo: "portal" as string | null,
  erroDeLeitura: null as null | { message: string },
  erroDeGravacao: null as null | { message: string },
  leituras: [] as Array<{ tabela: string; colunas: string; id: string }>,
  gravacoes: [] as Array<{ tabela: string; valores: Record<string, unknown>; id: string }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: (colunas: string) => ({
        eq: (_coluna: string, id: string) => ({
          maybeSingle: async () => {
            banco.leituras.push({ tabela, colunas, id });
            return banco.erroDeLeitura ? { data: null, error: banco.erroDeLeitura } : { data: { modo_aprovacao_do_cliente: banco.modo }, error: null };
          },
        }),
      }),
      update: (valores: Record<string, unknown>) => ({
        eq: async (_coluna: string, id: string) => {
          banco.gravacoes.push({ tabela, valores, id });
          if (banco.erroDeGravacao) return { error: banco.erroDeGravacao };
          banco.modo = String(valores.modo_aprovacao_do_cliente);
          return { error: null };
        },
      }),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { menuDoPapel } from "@/components/AppLayout";
import ModoDeAprovacaoNoCadastro from "@/components/admin/ModoDeAprovacaoNoCadastro";
import { ITENS_OCULTOS_DO_MENU, ocultoDoMenu, semItensOcultos } from "@/lib/navegacao/itensOcultosDoMenu";
import { modoDeAprovacaoDe, ROTULO_DO_MODO } from "@/lib/clientes/modoDeAprovacao";
import { toast } from "sonner";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const PAPEIS = ["admin", "manager", "design", "traffic", "client"];
const urlsDoMenu = (papel: string) => {
  const menu = menuDoPapel(papel);
  return [...menu.principal, ...menu.grupos.flatMap((g) => g.items), ...menu.mais].map((i) => i.url);
};

describe("menu enxuto e reversível", () => {
  it("a lista de ocultos é explícita e hoje tem só Pedidos", () => {
    expect([...ITENS_OCULTOS_DO_MENU]).toEqual(["/pedidos"]);
  });

  it("Pedidos não aparece no menu montado de nenhum papel (barra, grupos e Mais)", () => {
    for (const papel of PAPEIS) {
      const menu = menuDoPapel(papel);
      expect(urlsDoMenu(papel), papel).not.toContain("/pedidos");
      const titulos = [...menu.principal, ...menu.grupos.flatMap((g) => g.items), ...menu.mais].map((i) => i.title);
      expect(titulos, papel).not.toContain("Pedidos");
    }
  });

  it("o que não era para esconder continua no menu de quem já via", () => {
    const admin = urlsDoMenu("admin");
    for (const url of ["/ciclo", "/timeline", "/metricas", "/laboratorio", "/membros", "/api-docs", "/hoje", "/dashboard", "/esteira", "/central", "/comercial", "/freela", "/briefings", "/relatorios", "/projetos", "/aprovacoes"]) {
      expect(admin, url).toContain(url);
    }
    const cliente = urlsDoMenu("client");
    for (const url of ["/dashboard", "/projetos", "/relatorios", "/aprovacoes", "/membros", "/financeiro", "/perfil"]) expect(cliente, url).toContain(url);
    // O Quiz já tinha saído e não voltou.
    for (const papel of PAPEIS) expect(urlsDoMenu(papel).some((u) => u.includes("quiz")), papel).toBe(false);
  });

  it("a peneira por papel segue igual: gestão só para admin e gestor, item do admin só para o admin", () => {
    expect(urlsDoMenu("design")).not.toContain("/comercial");
    expect(urlsDoMenu("traffic")).not.toContain("/laboratorio");
    expect(urlsDoMenu("manager")).toContain("/comercial");
    expect(urlsDoMenu("manager")).not.toContain("/central/mensagens");
    expect(urlsDoMenu("admin")).toContain("/central/mensagens");
    expect(menuDoPapel("client").grupos).toEqual([]);
  });

  it("todas as saídas do menu passam pela mesma lista: barra, grupos da equipe, Mais do cliente, celular e busca", () => {
    const layout = ler("src/components/AppLayout.tsx");
    expect(layout).toContain('import { semItensOcultos } from "@/lib/navegacao/itensOcultosDoMenu";');
    for (const lista of ["adminMainNav", "clientMainNav", "clientMoreNav"]) expect(layout).toContain(`const ${lista}: NavItem[] = semItensOcultos([`);
    expect(layout).toContain("items: semItensOcultos(grupo.items).filter(");
    // A tela monta tudo a partir de menuDoPapel; busca e celular leem as mesmas listas.
    expect(layout).toContain("const menu = menuDoPapel(role);");
    expect(layout).toContain("const mainNav = menu.principal;");
    expect(layout).toContain("...mainNav.map((item) => ({ title: item.title, url: item.url, icon: item.icon, grupo: \"Principal\" })),");
    expect(layout).toContain("? gruposDoMenu.flatMap((grupo) => grupo.items.map((item) => ({ title: item.title, url: item.url, icon: item.icon, grupo: grupo.label })))");
    expect(layout).toContain(': clientMoreNav.map((item) => ({ title: item.title, url: item.url, icon: item.icon, grupo: "Mais" }))),');
    expect(layout).toContain('? [{ label: "Principal", items: mainNav }, ...gruposDoMenu]');
    expect(layout).toContain(': [{ label: "Principal", items: mainNav }, { label: "Mais", items: clientMoreNav }]');
    // Nenhuma outra lista de navegação nasce fora da peneira.
    expect(layout.match(/: NavItem\[\] = \[/g)).toBeNull();
  });

  it("reversível: a rota, a página e o item continuam no código; tirar a URL da lista traz o item de volta", () => {
    const app = ler("src/App.tsx");
    expect(app).toContain('<Route path="/pedidos" element=');
    expect(app).toContain("<AdminRequests />");
    expect(app).toContain("<ClientRequests />");
    const layout = ler("src/components/AppLayout.tsx");
    expect(layout.match(/\{ title: "Pedidos", url: "\/pedidos", icon: ShoppingBag \}/g)).toHaveLength(2);

    const itens = [{ url: "/aprovacoes" }, { url: "/pedidos" }, { url: "/pedidos-de-acesso" }];
    expect(semItensOcultos(itens).map((i) => i.url)).toEqual(["/aprovacoes", "/pedidos-de-acesso"]);
    expect(semItensOcultos(itens, []).map((i) => i.url)).toEqual(["/aprovacoes", "/pedidos", "/pedidos-de-acesso"]);
    expect(ocultoDoMenu("/pedidos")).toBe(true);
    expect(ocultoDoMenu("/pedidos/novo")).toBe(false);
  });

  it("a lista registra a evidência e como reverter", () => {
    const fonte = ler("src/lib/navegacao/itensOcultosDoMenu.ts");
    expect(fonte).toContain("PARA REVERTER: tire a URL da lista abaixo");
    expect(fonte).toContain("client_requests tem 0 linhas");
    expect(fonte).toContain("14/11/2026");
  });
});

function montar(admin: boolean, clientId = "cliente-1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ModoDeAprovacaoNoCadastro clientId={clientId} admin={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ficha do cliente: como este cliente aprova as peças", () => {
  beforeEach(() => {
    banco.modo = "portal";
    banco.erroDeLeitura = null;
    banco.erroDeGravacao = null;
    banco.leituras.length = 0;
    banco.gravacoes.length = 0;
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("mostra a regra gravada, com os dois textos, lendo só a coluna da regra", async () => {
    montar(true);
    expect(screen.getByText("Como este cliente aprova as peças")).toBeTruthy();
    const portal = await screen.findByRole("radio", { name: /Pelo portal do cliente/ });
    const dispensada = screen.getByRole("radio", { name: /A revisão interna basta \(exceção\)/ });
    await waitFor(() => expect(portal.getAttribute("aria-checked")).toBe("true"));
    expect(dispensada.getAttribute("aria-checked")).toBe("false");
    expect(banco.leituras).toEqual([{ tabela: "profiles", colunas: "modo_aprovacao_do_cliente", id: "cliente-1" }]);
    expect(screen.queryByText("Salvar regra")).toBeNull();
  });

  it("cliente com a exceção aparece marcado como a revisão interna basta", async () => {
    banco.modo = "dispensada";
    montar(true);
    const dispensada = await screen.findByRole("radio", { name: /A revisão interna basta/ });
    await waitFor(() => expect(dispensada.getAttribute("aria-checked")).toBe("true"));
  });

  it("admin escolhe, salva, e a gravação mexe só nesta coluna deste cliente", async () => {
    montar(true);
    const dispensada = await screen.findByRole("radio", { name: /A revisão interna basta/ });
    await waitFor(() => expect((dispensada as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dispensada);
    expect(banco.gravacoes).toHaveLength(0);
    fireEvent.click(screen.getByText("Salvar regra"));
    await waitFor(() => expect(banco.gravacoes).toHaveLength(1));
    expect(banco.gravacoes[0]).toEqual({ tabela: "profiles", valores: { modo_aprovacao_do_cliente: "dispensada" }, id: "cliente-1" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`Aprovação das peças: ${ROTULO_DO_MODO.dispensada}`, { description: "A regra ficou registrada no cadastro. Nada foi agendado nem publicado." }));
    await waitFor(() => expect(screen.queryByText("Salvar regra")).toBeNull());
    expect(dispensada.getAttribute("aria-checked")).toBe("true");
  });

  it("desfazer volta à regra gravada sem salvar nada", async () => {
    montar(true);
    const dispensada = await screen.findByRole("radio", { name: /A revisão interna basta/ });
    await waitFor(() => expect((dispensada as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dispensada);
    fireEvent.click(screen.getByText("Desfazer"));
    expect(screen.getByRole("radio", { name: /Pelo portal do cliente/ }).getAttribute("aria-checked")).toBe("true");
    expect(banco.gravacoes).toHaveLength(0);
  });

  it("quem não é admin só lê: opções desativadas, sem botão de salvar, e clicar não grava", async () => {
    banco.modo = "dispensada";
    montar(false);
    const portal = await screen.findByRole("radio", { name: /Pelo portal do cliente/ });
    const dispensada = screen.getByRole("radio", { name: /A revisão interna basta/ });
    await waitFor(() => expect(dispensada.getAttribute("aria-checked")).toBe("true"));
    expect((portal as HTMLButtonElement).disabled).toBe(true);
    expect((dispensada as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(portal);
    expect(screen.queryByText("Salvar regra")).toBeNull();
    expect(screen.getByText("Só o administrador altera esta regra.")).toBeTruthy();
    expect(banco.gravacoes).toHaveLength(0);
  });

  it("falha ao salvar avisa e mantém a escolha para tentar de novo", async () => {
    banco.erroDeGravacao = { message: "campo restrito ao administrador" };
    montar(true);
    const dispensada = await screen.findByRole("radio", { name: /A revisão interna basta/ });
    await waitFor(() => expect((dispensada as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dispensada);
    fireEvent.click(screen.getByText("Salvar regra"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Não salvou", { description: "campo restrito ao administrador" }));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("Salvar regra")).toBeTruthy();
  });

  it("se a coluna não puder ser lida, o bloco avisa e não oferece edição (a ficha segue)", async () => {
    banco.erroDeLeitura = { message: "column profiles.modo_aprovacao_do_cliente does not exist" };
    montar(true);
    expect(await screen.findByText(/não pôde ser lida agora/)).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(banco.gravacoes).toHaveLength(0);
  });

  it("valor desconhecido vale portal", () => {
    expect(modoDeAprovacaoDe("dispensada")).toBe("dispensada");
    for (const v of ["portal", null, undefined, "", "qualquer"]) expect(modoDeAprovacaoDe(v)).toBe("portal");
  });

  it("está na aba Cadastro, logo depois do Dia Prioritário, e só admin altera", () => {
    const ficha = ler("src/components/admin/EditClientDrawer.tsx");
    const dia = ficha.indexOf("<DiaPrioritarioNoCadastro client=");
    const modo = ficha.indexOf("<ModoDeAprovacaoNoCadastro clientId={String(client.id)} admin={isAdmin} />");
    const servicos = ficha.indexOf('<Secao titulo="Serviços ativos"');
    expect(dia).toBeGreaterThan(0);
    expect(modo).toBeGreaterThan(dia);
    expect(servicos).toBeGreaterThan(modo);
  });

  it("a regra continua sendo só registro: agenda e publicação não leem a coluna", () => {
    for (const arquivo of ["src/lib/editorialScheduler.ts", "src/hooks/useEditorialCalendar.ts", "src/components/editorial/EditorialScheduleDialog.tsx"]) {
      expect(ler(arquivo), arquivo).not.toContain("modo_aprovacao_do_cliente");
    }
    const lib = ler("src/lib/clientes/modoDeAprovacao.ts");
    expect(lib.match(/\.from\("profiles"\)/g)).toHaveLength(2);
    expect(lib).not.toMatch(/\.rpc\(|functions\.invoke/);
  });
});
