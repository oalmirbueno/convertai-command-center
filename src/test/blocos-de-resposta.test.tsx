import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ESQUEMA_DOS_BLOCOS,
  LIMITES_DOS_BLOCOS,
  urlSegura,
  validarBlocos,
  type BlocoDeResposta,
  type BlocoFluxo,
} from "@/lib/agentes/blocosDeResposta";
import BlocosDeResposta, { camadasDoFluxo } from "@/components/agentes/respostas/BlocosDeResposta";
import TextoFormatado from "@/components/agentes/respostas/TextoFormatado";

vi.mock("recharts", async () => {
  const real = await vi.importActual<typeof import("recharts")>("recharts");
  const react = await vi.importActual<typeof import("react")>("react");
  // No jsdom o ResponsiveContainer mede 0 e não desenha: troca por um tamanho fixo.
  const Fixo = ({ children }: { children: import("react").ReactElement }) => react.cloneElement(children, { width: 400, height: 220 });
  return { ...real, ResponsiveContainer: Fixo };
});

const tabela = { tipo: "tabela", titulo: "Leads da semana", colunas: ["Canal", "Leads"], linhas: [["Instagram", 12], ["Google", null]], fontes: ["crm"] };

describe("validarBlocos", () => {
  it("aceita blocos bons e devolve objetos novos só com os campos conhecidos", () => {
    const { blocos, recusados } = validarBlocos({ blocos: [{ tipo: "texto", texto: "  Oi  ", extra: 1 }, tabela] });
    expect(recusados).toEqual([]);
    expect(blocos[0]).toEqual({ tipo: "texto", texto: "Oi" });
    expect(blocos[1]).toMatchObject({ tipo: "tabela", colunas: ["Canal", "Leads"] });
  });

  it("aceita a lista direta e o JSON em texto; nulls do modo strict viram ausência", () => {
    const r = validarBlocos(JSON.stringify([{ tipo: "metricas", titulo: null, itens: [{ rotulo: "Alcance", valor: 1200, variacao: null, tom: null }], fontes: null }]));
    expect(r.recusados).toEqual([]);
    expect(r.blocos[0]).toEqual({ tipo: "metricas", itens: [{ rotulo: "Alcance", valor: 1200 }] });
    expect(validarBlocos("nao e json").recusados[0].motivo).toMatch(/JSON/);
  });

  it("tipo desconhecido sai e os outros seguem", () => {
    const r = validarBlocos([{ tipo: "html", html: "<b>x</b>" }, { tipo: "texto", texto: "fica" }]);
    expect(r.blocos).toEqual([{ tipo: "texto", texto: "fica" }]);
    expect(r.recusados).toEqual([{ indice: 0, motivo: "tipo desconhecido: html" }]);
  });

  it("limites: colunas, linhas, séries, pontos, passos e total de blocos", () => {
    const nove = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    expect(validarBlocos([{ tipo: "tabela", colunas: nove, linhas: [nove] }]).recusados[0].motivo).toMatch(/colunas passa do limite de 8/);
    const linhas = Array.from({ length: 51 }, (_, i) => [String(i)]);
    expect(validarBlocos([{ tipo: "tabela", colunas: ["x"], linhas }]).recusados[0].motivo).toMatch(/linhas passa do limite de 50/);
    expect(validarBlocos([{ tipo: "tabela", colunas: ["a", "b"], linhas: [["só uma"]] }]).recusados[0].motivo).toMatch(/1 células, esperado 2/);
    const serie = (n: number) => ({ nome: "s", pontos: Array.from({ length: n }, (_, i) => ({ x: `d${i}`, y: i })) });
    expect(validarBlocos([{ tipo: "grafico", tipo_grafico: "linhas", series: [serie(61)] }]).recusados[0].motivo).toMatch(/limite de 60/);
    expect(validarBlocos([{ tipo: "grafico", tipo_grafico: "linhas", series: [serie(2), serie(2), serie(2), serie(2), serie(2)] }]).recusados[0].motivo).toMatch(/limite de 4/);
    const passos = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, rotulo: "x" }));
    expect(validarBlocos([{ tipo: "fluxo", natureza: "proposta", passos }]).recusados[0].motivo).toMatch(/limite de 20/);
    const muitos = Array.from({ length: 14 }, () => ({ tipo: "texto", texto: "a" }));
    const r = validarBlocos(muitos);
    expect(r.blocos).toHaveLength(LIMITES_DOS_BLOCOS.blocos);
    expect(r.recusados).toHaveLength(2);
  });

  it("corta texto longo no limite e recusa número que não é finito", () => {
    const r = validarBlocos([{ tipo: "texto", texto: "a".repeat(5000) }]);
    expect((r.blocos[0] as { texto: string }).texto.length).toBe(LIMITES_DOS_BLOCOS.texto);
    expect(validarBlocos([{ tipo: "tabela", colunas: ["n"], linhas: [[Infinity]] }]).recusados).toHaveLength(1);
    expect(validarBlocos([{ tipo: "metricas", itens: [{ rotulo: "x", valor: NaN }] }]).recusados).toHaveLength(1);
    expect(validarBlocos([{ tipo: "grafico", tipo_grafico: "barras", series: [{ nome: "s", pontos: [{ x: "a", y: "3" }] }] }]).recusados).toHaveLength(1);
  });

  it("com fontesConhecidas: número sem fonte ou com fonte desconhecida é recusado", () => {
    const opcoes = { fontesConhecidas: ["crm", "meta"] };
    const semFonte = { tipo: "metricas", itens: [{ rotulo: "Leads", valor: 30 }] };
    const inventada = { ...tabela, fontes: ["planilha-que-ninguem-leu"] };
    const r = validarBlocos([semFonte, inventada, tabela, { tipo: "texto", texto: "texto não precisa" }], opcoes);
    expect(r.blocos.map((b) => b.tipo)).toEqual(["tabela", "texto"]);
    expect(r.recusados[0]).toEqual({ indice: 0, motivo: "número sem fonte: cite ao menos uma fonte lida" });
    expect(r.recusados[1].motivo).toMatch(/fonte desconhecida: planilha-que-ninguem-leu/);
    const grafico = { tipo: "grafico", tipo_grafico: "barras", series: [{ nome: "s", pontos: [{ x: "a", y: 1 }] }], fontes: [] };
    expect(validarBlocos([grafico], opcoes).recusados).toHaveLength(1);
    // Sem a lista, fonte é opcional.
    expect(validarBlocos([semFonte]).recusados).toEqual([]);
  });

  it("arquivo: só https, sem credencial, e host permitido quando há lista", () => {
    const arq = (url: string) => ({ tipo: "arquivo", nome: "a.png", mime: "image/png", url });
    expect(validarBlocos([arq("http://x.com/a.png")]).recusados).toHaveLength(1);
    expect(validarBlocos([arq("javascript:alert(1)")]).recusados).toHaveLength(1);
    expect(validarBlocos([arq("data:image/png;base64,AAA")]).recusados).toHaveLength(1);
    expect(validarBlocos([arq("https://user:senha@x.com/a.png")]).recusados).toHaveLength(1);
    expect(validarBlocos([arq("https://x.supabase.co/a.png")]).blocos).toHaveLength(1);
    expect(validarBlocos([arq("https://x.supabase.co/a.png")], { hostsPermitidos: ["supabase.co"] }).blocos).toHaveLength(1);
    expect(validarBlocos([arq("https://evilsupabase.co/a.png")], { hostsPermitidos: ["supabase.co"] }).recusados).toHaveLength(1);
    expect(urlSegura("https://a.com/x y")).toBeNull();
    expect(validarBlocos([{ tipo: "arquivo", nome: "x", objeto: { tipo: "tarefa", id: "1" } }]).recusados).toHaveLength(1);
  });

  it("fluxo: ids únicos, ligação para passo que existe; proposta não carrega estado de execução", () => {
    expect(validarBlocos([{ tipo: "fluxo", natureza: "registro", passos: [{ id: "a", rotulo: "A" }, { id: "a", rotulo: "B" }] }]).recusados[0].motivo).toMatch(/repetido/);
    expect(
      validarBlocos([{ tipo: "fluxo", natureza: "registro", passos: [{ id: "a", rotulo: "A" }], ligacoes: [{ de: "a", para: "z" }] }]).recusados[0].motivo,
    ).toMatch(/não existe/);
    const r = validarBlocos([
      { tipo: "fluxo", natureza: "proposta", passos: [{ id: "a", rotulo: "A", estado: "concluido" }, { id: "b", rotulo: "B", estado: "planejado" }] },
      { tipo: "fluxo", natureza: "registro", passos: [{ id: "a", rotulo: "A", estado: "concluido" }] },
    ]);
    const [proposta, registro] = r.blocos as BlocoFluxo[];
    expect(proposta.passos[0].estado).toBeUndefined();
    expect(proposta.passos[1].estado).toBe("planejado");
    expect(registro.passos[0].estado).toBe("concluido");
    expect(validarBlocos([{ tipo: "fluxo", passos: [{ id: "a", rotulo: "A" }] }]).recusados[0].motivo).toMatch(/natureza/);
  });

  it("gráfico: pizza com uma série, sem negativo; x repetido na série é recusado", () => {
    const pizza = (series: unknown[]) => ({ tipo: "grafico", tipo_grafico: "pizza", series });
    const s = { nome: "Canais", pontos: [{ x: "A", y: 1 }, { x: "B", y: 2 }] };
    expect(validarBlocos([pizza([s, s])]).recusados).toHaveLength(1);
    expect(validarBlocos([pizza([{ nome: "x", pontos: [{ x: "A", y: -1 }] }])]).recusados).toHaveLength(1);
    expect(validarBlocos([pizza([s])]).blocos).toHaveLength(1);
    expect(validarBlocos([pizza([{ nome: "x", pontos: [{ x: "A", y: 1 }, { x: "A", y: 2 }] }])]).recusados[0].motivo).toMatch(/repete/);
  });
});

describe("ESQUEMA_DOS_BLOCOS (modo strict da OpenAI)", () => {
  it("todo objeto fecha additionalProperties e exige todas as propriedades", () => {
    const problemas: string[] = [];
    (function andar(no: unknown, caminho: string) {
      if (Array.isArray(no)) return no.forEach((x, i) => andar(x, `${caminho}[${i}]`));
      if (!no || typeof no !== "object") return;
      const o = no as Record<string, unknown>;
      const tipo = o.type;
      if (tipo === "object" || (Array.isArray(tipo) && tipo.indexOf("object") >= 0)) {
        if (o.additionalProperties !== false) problemas.push(`${caminho}: additionalProperties`);
        const props = Object.keys((o.properties as object) || {});
        const req = (o.required as string[]) || [];
        if (props.sort().join() !== req.slice().sort().join()) problemas.push(`${caminho}: required`);
      }
      for (const [k, v] of Object.entries(o)) andar(v, `${caminho}.${k}`);
    })(ESQUEMA_DOS_BLOCOS, "$");
    expect(problemas).toEqual([]);
    expect(ESQUEMA_DOS_BLOCOS.type).toBe("object");
    expect(ESQUEMA_DOS_BLOCOS.properties.blocos.items.anyOf).toHaveLength(8);
  });
});

describe("componentes", () => {
  const blocos = (b: unknown[]) => validarBlocos(b).blocos as BlocoDeResposta[];

  it("tabela: título, cabeçalho, número em pt-BR, vazio como s/d, fonte clicável", () => {
    const aoAbrirFonte = vi.fn();
    render(<BlocosDeResposta blocos={blocos([{ ...tabela, linhas: [["Instagram", 1200.5], ["Google", null]] }])} aoAbrirFonte={aoAbrirFonte} />);
    expect(screen.getByText("Leads da semana")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Canal" })).toBeTruthy();
    expect(screen.getByText("1.200,5")).toBeTruthy();
    expect(screen.getByText("s/d")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "crm" }));
    expect(aoAbrirFonte).toHaveBeenCalledWith("crm");
  });

  it("tabela longa mostra 10 linhas e abre o resto", () => {
    const linhas = Array.from({ length: 14 }, (_, i) => [`linha ${i}`]);
    render(<BlocosDeResposta blocos={blocos([{ tipo: "tabela", colunas: ["Item"], linhas }])} />);
    expect(screen.getAllByRole("row")).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar todas (14)" }));
    expect(screen.getAllByRole("row")).toHaveLength(15);
  });

  it("métricas: rótulo, valor e variação", () => {
    render(<BlocosDeResposta blocos={blocos([{ tipo: "metricas", titulo: "Semana", itens: [{ rotulo: "Alcance", valor: 15300, variacao: "+12%", tom: "bom" }, { rotulo: "CPL", valor: "R$ 4,20" }] }])} />);
    expect(screen.getByText("Alcance")).toBeTruthy();
    expect(screen.getByText("15.300")).toBeTruthy();
    expect(screen.getByText("+12%").className).toContain("text-success");
    expect(screen.getByText("R$ 4,20")).toBeTruthy();
  });

  it("gráfico: título, legenda das séries e números sob demanda", () => {
    const { container } = render(
      <BlocosDeResposta
        blocos={blocos([{ tipo: "grafico", titulo: "Leads por dia", tipo_grafico: "barras", unidade: "R$", series: [{ nome: "Meta", pontos: [{ x: "seg", y: 10 }, { x: "ter", y: 20 }] }, { nome: "Google", pontos: [{ x: "seg", y: 5 }] }] }])}
      />,
    );
    expect(screen.getByText("Leads por dia")).toBeTruthy();
    expect(screen.getByText("Meta")).toBeTruthy();
    expect(screen.getByText("Google")).toBeTruthy();
    expect(container.querySelector(".recharts-wrapper")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver números" }));
    const numeros = container.querySelector("[data-numeros-do-grafico]") as HTMLElement;
    expect(within(numeros).getByText("R$ 20")).toBeTruthy();
    // Google não tem "ter": fica s/d, não zero.
    expect(within(numeros).getByText("s/d")).toBeTruthy();
  });

  it("gráfico de pizza e de linhas desenham", () => {
    const { container } = render(
      <BlocosDeResposta
        blocos={blocos([
          { tipo: "grafico", tipo_grafico: "pizza", series: [{ nome: "Canais", pontos: [{ x: "Orgânico", y: 3 }, { x: "Pago", y: 7 }] }] },
          { tipo: "grafico", tipo_grafico: "linhas", series: [{ nome: "Seguidores", pontos: [{ x: "jan", y: 60 }, { x: "fev", y: 80 }] }] },
        ])}
      />,
    );
    expect(screen.getByText("Orgânico")).toBeTruthy();
    expect(screen.getByText("Seguidores")).toBeTruthy();
    expect(container.querySelectorAll(".recharts-wrapper")).toHaveLength(2);
  });

  it("fluxo proposta mostra o selo Proposta; registro mostra estado no sistema", () => {
    render(
      <BlocosDeResposta
        blocos={blocos([
          { tipo: "fluxo", titulo: "Plano do lançamento", natureza: "proposta", passos: [{ id: "a", rotulo: "Briefing" }, { id: "b", rotulo: "Arte" }, { id: "c", rotulo: "Legenda" }, { id: "d", rotulo: "Publicar" }], ligacoes: [{ de: "a", para: "b" }, { de: "a", para: "c" }, { de: "b", para: "d" }, { de: "c", para: "d", rotulo: "depois de aprovar" }] },
          { tipo: "fluxo", natureza: "registro", passos: [{ id: "x", rotulo: "Post criado", estado: "concluido" }, { id: "y", rotulo: "Aprovação", estado: "aguardando_aprovacao" }] },
        ])}
      />,
    );
    expect(screen.getByText("Proposta")).toBeTruthy();
    expect(screen.getByText("Plano do lançamento")).toBeTruthy();
    expect(screen.getByText("Estado no sistema")).toBeTruthy();
    expect(screen.getByText("Aguardando aprovação")).toBeTruthy();
    expect(screen.getByText("depois de aprovar: Publicar")).toBeTruthy();
  });

  it("camadas do fluxo: ramos lado a lado, ciclo não trava", () => {
    const bloco = validarBlocos([
      { tipo: "fluxo", natureza: "proposta", passos: [{ id: "a", rotulo: "A" }, { id: "b", rotulo: "B" }, { id: "c", rotulo: "C" }, { id: "d", rotulo: "D" }], ligacoes: [{ de: "a", para: "b" }, { de: "a", para: "c" }, { de: "b", para: "d" }, { de: "c", para: "d" }] },
    ]).blocos[0] as BlocoFluxo;
    expect(camadasDoFluxo(bloco)).toEqual([["a"], ["b", "c"], ["d"]]);
    const ciclo = validarBlocos([{ tipo: "fluxo", natureza: "registro", passos: [{ id: "a", rotulo: "A" }, { id: "b", rotulo: "B" }], ligacoes: [{ de: "a", para: "b" }, { de: "b", para: "a" }] }]).blocos[0] as BlocoFluxo;
    expect(camadasDoFluxo(ciclo).reduce((n, c) => n + c.length, 0)).toBe(2);
  });

  it("entrega: cartão clicável chama aoAbrirObjeto com o objeto do bloco", () => {
    const aoAbrirObjeto = vi.fn();
    render(
      <BlocosDeResposta
        aoAbrirObjeto={aoAbrirObjeto}
        blocos={blocos([{ tipo: "entrega", nome: "Carrossel de outubro", tipo_objeto: "post", objeto: { tipo: "post", id: "p1", client_id: "c1" }, estado: "aguardando_aprovacao", cliente: "Acerbi", proxima: "Aprovar a capa" }])}
      />,
    );
    expect(screen.getByText("Aguardando aprovação")).toBeTruthy();
    expect(screen.getByText("post · Acerbi")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Carrossel de outubro" }));
    expect(aoAbrirObjeto).toHaveBeenCalledWith({ tipo: "post", id: "p1", client_id: "c1" });
  });

  it("entrega sem objeto não vira botão", () => {
    render(<BlocosDeResposta aoAbrirObjeto={vi.fn()} blocos={blocos([{ tipo: "entrega", nome: "Relatório", tipo_objeto: "relatório", estado: "Em revisão" }])} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Em revisão")).toBeTruthy();
  });

  it("arquivo: prévia de imagem, baixar em nova aba e abrir no painel", () => {
    const aoAbrirObjeto = vi.fn();
    render(
      <BlocosDeResposta
        aoAbrirObjeto={aoAbrirObjeto}
        blocos={blocos([{ tipo: "arquivo", nome: "capa.png", mime: "image/png", url: "https://x.supabase.co/capa.png", objeto: { tipo: "arquivo", id: "f1" } }])}
      />,
    );
    const img = screen.getByRole("img", { name: "capa.png" });
    expect(img.getAttribute("src")).toBe("https://x.supabase.co/capa.png");
    const baixar = screen.getByRole("link", { name: "Baixar" });
    expect(baixar.getAttribute("rel")).toBe("noopener noreferrer");
    expect(baixar.getAttribute("target")).toBe("_blank");
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(aoAbrirObjeto).toHaveBeenCalledWith({ tipo: "arquivo", id: "f1", titulo: "capa.png" });
  });

  it("arquivo com url que não é https (bloco montado à mão) não vira link", () => {
    render(<BlocosDeResposta blocos={[{ tipo: "arquivo", nome: "x.pdf", url: "javascript:alert(1)" }]} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("progresso: etapas com estado real e contagem", () => {
    const { container } = render(
      <BlocosDeResposta
        blocos={blocos([{ tipo: "progresso", titulo: "Entrega do mês", etapas: [{ rotulo: "Roteiro", estado: "concluido", quando: "02/10", evidencia: "Aprovado pelo cliente" }, { rotulo: "Gravação", estado: "em_execucao" }, { rotulo: "Edição", estado: "planejado" }] }])}
      />,
    );
    expect(screen.getByText("Entrega do mês")).toBeTruthy();
    expect(screen.getByText("1 de 3")).toBeTruthy();
    expect(screen.getByText("Aprovado pelo cliente")).toBeTruthy();
    expect(screen.getByText("Em execução")).toBeTruthy();
    expect(Array.from(container.querySelectorAll("[data-etapa]")).map((e) => e.getAttribute("data-etapa"))).toEqual(["concluido", "em_execucao", "planejado"]);
  });

  it("texto e lista vazia", () => {
    const { container } = render(<BlocosDeResposta blocos={[]} />);
    expect(container.innerHTML).toBe("");
    render(<BlocosDeResposta blocos={blocos([{ tipo: "texto", texto: "Pronto." }])} />);
    expect(screen.getByText("Pronto.")).toBeTruthy();
  });
});

describe("TextoFormatado", () => {
  it("não desenha HTML cru (script, img onerror)", () => {
    const { container } = render(<TextoFormatado texto={'Oi <script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<b>negrito cru</b>'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror/);
  });

  it("link http(s) abre em nova aba com rel seguro; javascript: não vira link", () => {
    render(<TextoFormatado texto={"[Painel](https://aceleriq.com) e [mal](javascript:alert(1))"} />);
    const link = screen.getByRole("link", { name: "Painel" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("mal").tagName).toBe("SPAN");
  });

  it("tabela, lista, código e título", () => {
    const md = "## Resumo\n\n- um\n- dois\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\nconst x = 1;\n```\n\nUse `npm`.";
    const { container } = render(<TextoFormatado texto={md} />);
    expect(screen.getByRole("heading", { name: "Resumo" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(container.querySelector("table")!.parentElement!.className).toContain("overflow-x-auto");
    expect(container.querySelector("pre")!.textContent).toContain("const x = 1;");
    expect(screen.getByText("npm").tagName).toBe("CODE");
  });
});
