import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { createElement as h, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  alturasFixasDaJanela,
  caixaAlta,
  cantosForaDoToken,
  cartaoFeitoAMao,
  fontesForaDaEscala,
  pareceCartao,
  rolagemPresaNoCelular,
  sombrasFortes,
  tituloQueQuebra,
  translucidoEmBloco,
} from "@/components/sistema/regras";
import { ESCALA_DE_FONTE, espaco, lista, rolagem, texto } from "@/components/sistema/estilos";
import BarraDeControles from "@/components/sistema/BarraDeControles";
import MenuMais from "@/components/sistema/MenuMais";
import GradeDeSecoes from "@/components/sistema/GradeDeSecoes";
import { GradeDeGrupos, GrupoDeFuncoes } from "@/components/sistema/GrupoDeFuncoes";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import AreaDeTrabalho from "@/components/sistema/AreaDeTrabalho";
import { tituloEmChave } from "@/components/sistema/TituloRecolhivel";

/**
 * Catraca do padrão visual (frente L0, 28/09; docs/design/SISTEMA.md seção 16
 * e plano de padronização, 2.8). "Vale também para as próximas atualizações":
 * conta no código inteiro (src, sem ui/ e sem testes) o que o padrão tira, e
 * FALHA SE ALGUM NÚMERO SUBIR em relação ao teto gravado abaixo.
 *
 * Cada lote (L1 a L10) baixa os números dos seus arquivos e, no mesmo
 * commit, baixa o teto aqui para o número novo (o teste avisa no console
 * quando o número caiu e o teto ficou folgado). Nunca suba um teto: se uma
 * tela nova precisa de algo que a catraca conta, use o componente ou o token
 * do sistema (texto.*, rolagem.*, lista.*, Painel, BarraDeControles...).
 *
 * Para ver os números por arquivo: CATRACA_MOSTRAR=1 npx vitest run src/test/padrao-visual-catraca.test.ts
 */

type Metrica =
  | "fonteForaDaEscala"
  | "fonteComNomeDoTailwind"
  | "translucidoEmBloco"
  | "rolagemPresaNoCelular"
  | "rolagemDentroDeRolagem"
  | "alturaFixaDaJanela"
  | "cartaoFeitoAMao"
  | "secaoEmCartao"
  | "cartaoDentroDeCartao"
  | "paragrafoFixo"
  | "descricaoExplicativa"
  | "cantoForaDoToken"
  | "tituloQueQuebra"
  | "sombraForte"
  | "caixaAlta"
  | "h1FeitoAMao";

/**
 * TETO de hoje (28/09, frente L0). Só desce.
 * O que cada número conta está em `medir` abaixo e em src/components/sistema/regras.ts.
 */
const TETO: Record<Metrica, number> = {
  fonteForaDaEscala: 1980,
  fonteComNomeDoTailwind: 483,
  translucidoEmBloco: 27,
  rolagemPresaNoCelular: 30,
  rolagemDentroDeRolagem: 5,
  alturaFixaDaJanela: 2,
  cartaoFeitoAMao: 196,
  secaoEmCartao: 0,
  cartaoDentroDeCartao: 128,
  paragrafoFixo: 130,
  descricaoExplicativa: 4,
  cantoForaDoToken: 57,
  tituloQueQuebra: 11,
  sombraForte: 49,
  caixaAlta: 251,
  h1FeitoAMao: 15,
};

const METRICAS = Object.keys(TETO) as Metrica[];
const raiz = resolve(__dirname, "../..");
const pastaSrc = resolve(raiz, "src");

function arquivosDoPainel(): string[] {
  const saida: string[] = [];
  (function andar(pasta: string) {
    for (const nome of readdirSync(pasta)) {
      const caminho = resolve(pasta, nome);
      if (statSync(caminho).isDirectory()) {
        if (caminho === resolve(pastaSrc, "test") || caminho === resolve(pastaSrc, "components", "ui")) continue;
        andar(caminho);
      } else if (/\.tsx$/.test(nome) && !/\.(test|spec)\./.test(nome)) saida.push(caminho);
    }
  })(pastaSrc);
  return saida.sort();
}

/** Janela, popover, gaveta, menu: rolagem própria e parágrafo longo são permitidos lá dentro. */
const FLUTUANTE = /Dialog|Sheet|Popover|Dropdown|Command|Janela|Drawer|Select|Tooltip|HoverCard|Menu|Ajuda/;
/** Tokens do sistema que viram cartão quando usados como classe. */
const TOKENS_DE_CARTAO: Record<string, string> = { "superficie.painel": "rounded-lg border border-border bg-card" };

function nomeDaTag(no: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return (ts.isJsxElement(no) ? no.openingElement.tagName : no.tagName).getText();
}
function atributos(no: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttributeLike[] {
  return Array.from((ts.isJsxElement(no) ? no.openingElement : no).attributes.properties);
}
function atributo(no: ts.JsxElement | ts.JsxSelfClosingElement, nome: string): ts.JsxAttribute | null {
  for (const a of atributos(no)) if (ts.isJsxAttribute(a) && a.name.getText() === nome) return a;
  return null;
}

/** Números de um arquivo. */
function medir(texto: string, rel: string): Record<Metrica, number> {
  const n = {} as Record<Metrica, number>;
  for (const m of METRICAS) n[m] = 0;
  const sf = ts.createSourceFile(rel, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const doSistema = rel.indexOf("components/sistema/") === 0;

  // Constantes de texto do topo do arquivo (const CARTAO = "...").
  const constantes: Record<string, string> = {};
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const ini = d.initializer;
      if (ini && ts.isIdentifier(d.name) && (ts.isStringLiteral(ini) || ts.isNoSubstitutionTemplateLiteral(ini))) constantes[d.name.text] = ini.text;
    }
  }

  // 1) Tudo que é texto no código (sem comentários): fonte, canto, sombra, caixa alta.
  (function literais(no: ts.Node) {
    let pedacos: string[] = [];
    if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) pedacos = [no.text];
    else if (ts.isTemplateExpression(no)) pedacos = [no.head.text].concat(no.templateSpans.map((s) => s.literal.text));
    for (const p of pedacos) {
      for (const f of fontesForaDaEscala(p)) {
        if (/^text-\[/.test(f)) n.fonteForaDaEscala += 1;
        else n.fonteComNomeDoTailwind += 1;
      }
      n.cantoForaDoToken += cantosForaDoToken(p).length;
      n.sombraForte += sombrasFortes(p).length;
      if (caixaAlta(p)) n.caixaAlta += 1;
    }
    no.forEachChild(literais);
  })(sf);

  // 2) Por elemento: as classes dele (className e afins), com os ancestrais.
  function classes(el: ts.JsxElement | ts.JsxSelfClosingElement, comTokens: boolean): string {
    const saida: string[] = [];
    for (const a of atributos(el)) {
      if (!ts.isJsxAttribute(a) || !/class/i.test(a.name.getText()) || !a.initializer) continue;
      (function v(x: ts.Node) {
        if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) saida.push(x.text);
        else if (ts.isTemplateExpression(x)) {
          saida.push(x.head.text);
          for (const s of x.templateSpans) {
            v(s.expression);
            saida.push(s.literal.text);
          }
        } else if (ts.isIdentifier(x) && constantes[x.text] !== undefined) saida.push(constantes[x.text]);
        else if (comTokens && ts.isPropertyAccessExpression(x) && TOKENS_DE_CARTAO[x.getText()]) saida.push(TOKENS_DE_CARTAO[x.getText()]);
        else x.forEachChild(v);
      })(a.initializer);
    }
    return saida.join(" ");
  }

  type Pai = { tag: string; cartao: boolean; rola: boolean };
  const pilha: Pai[] = [];
  (function andar(no: ts.Node) {
    let empilhou = false;
    if (ts.isJsxElement(no) || ts.isJsxSelfClosingElement(no)) {
      const tag = nomeDaTag(no);
      const cls = classes(no, false);
      const clsComTokens = classes(no, true);
      const dentroDeFlutuante = pilha.some((p) => FLUTUANTE.test(p.tag));
      const secaoCartao = tag === "Secao" && (() => {
        const a = atributo(no, "cartao");
        return !!a && (!a.initializer || a.initializer.getText() !== "{false}");
      })();
      const cartao = tag === "Painel" || tag === "Card" || secaoCartao || (/^[a-z]/.test(tag) && pareceCartao(clsComTokens));
      const rola = tag === "RegiaoRolavel" || tag === "ScrollArea" || /(^|\s|:)overflow-(y-)?auto(\s|$)/.test(cls);

      if (secaoCartao) n.secaoEmCartao += 1;
      if (/^[a-z]/.test(tag) && cartaoFeitoAMao(cls) && !doSistema) n.cartaoFeitoAMao += 1;
      if (cartao && pilha.some((p) => p.cartao)) n.cartaoDentroDeCartao += 1;
      if (translucidoEmBloco(cls)) n.translucidoEmBloco += 1;
      if (!dentroDeFlutuante && rolagemPresaNoCelular(cls)) n.rolagemPresaNoCelular += 1;
      // Janela e popover podem usar a altura da janela; área da página, não.
      if (!dentroDeFlutuante && !FLUTUANTE.test(tag)) n.alturaFixaDaJanela += alturasFixasDaJanela(cls).length;
      if (rola && !dentroDeFlutuante && pilha.some((p) => p.rola)) n.rolagemDentroDeRolagem += 1;
      if (/^h[1-3]$/.test(tag) && tituloQueQuebra(cls)) n.tituloQueQuebra += 1;
      if (tag === "h1" && !doSistema) n.h1FeitoAMao += 1;
      // Descrição de título com cara de explicação (mais de 60 caracteres ou frase
      // com ponto): vai para `ajuda` (o "?"); na tela fica só estado curto.
      if (/^(Secao|CabecalhoDeSecao|CabecalhoDePagina|Painel|GrupoDeCampos)$/.test(tag)) {
        const d = atributo(no, "descricao");
        const ini = d && d.initializer;
        let valor = "";
        if (ini && ts.isStringLiteral(ini)) valor = ini.text;
        else if (ini && ts.isJsxExpression(ini) && ini.expression && (ts.isStringLiteral(ini.expression) || ts.isNoSubstitutionTemplateLiteral(ini.expression))) valor = ini.expression.text;
        valor = valor.trim();
        if (valor && (valor.length > 60 || /[.!?](\s|$)/.test(valor))) n.descricaoExplicativa += 1;
      }
      if (tag === "p" && ts.isJsxElement(no) && !dentroDeFlutuante) {
        const corrido = no.children
          .filter(ts.isJsxText)
          .map((t) => t.getText().replace(/\s+/g, " ").trim())
          .join(" ")
          .trim();
        if (corrido.length >= 90) n.paragrafoFixo += 1;
      }
      pilha.push({ tag, cartao, rola: rola && !dentroDeFlutuante });
      empilhou = true;
    }
    no.forEachChild(andar);
    if (empilhou) pilha.pop();
  })(sf);
  return n;
}

function medirPainel() {
  const porArquivo: Record<string, Record<Metrica, number>> = {};
  const total = {} as Record<Metrica, number>;
  for (const m of METRICAS) total[m] = 0;
  for (const caminho of arquivosDoPainel()) {
    const rel = relative(pastaSrc, caminho).split(sep).join("/");
    const n = medir(readFileSync(caminho, "utf8").replace(/\r\n/g, "\n"), rel);
    porArquivo[rel] = n;
    for (const m of METRICAS) total[m] += n[m];
  }
  return { porArquivo, total };
}

describe("catraca do padrão visual (só desce)", () => {
  it("nenhum número subiu em relação ao teto gravado", () => {
    const { porArquivo, total } = medirPainel();
    if (process.env.CATRACA_MOSTRAR) {
      const linhas: Record<string, Record<string, number>> = {};
      for (const [arq, n] of Object.entries(porArquivo)) {
        const soNaoZero: Record<string, number> = {};
        for (const m of METRICAS) if (n[m]) soNaoZero[m] = n[m];
        if (Object.keys(soNaoZero).length) linhas[arq] = soNaoZero;
      }
      console.log(JSON.stringify({ total, porArquivo: linhas }, null, 1));
    }
    const subiram: string[] = [];
    for (const m of METRICAS) {
      if (total[m] > TETO[m]) {
        const maiores = Object.entries(porArquivo)
          .filter(([, n]) => n[m] > 0)
          .sort((a, b) => b[1][m] - a[1][m])
          .slice(0, 12)
          .map(([arq, n]) => `${arq}: ${n[m]}`);
        subiram.push(`${m}: ${total[m]} (teto ${TETO[m]}). Onde tem: ${maiores.join(", ")}`);
      } else if (total[m] < TETO[m]) {
        console.info(`catraca: ${m} caiu para ${total[m]} (teto ${TETO[m]}). Baixe o teto em src/test/padrao-visual-catraca.test.ts.`);
      }
    }
    expect(subiram, "Subiu. Use o token ou o componente do sistema (docs/design/SISTEMA.md) em vez de subir o teto.").toEqual([]);
  }, 180000);

  it("os componentes novos da base (L0) nascem sem nada que a catraca conta", () => {
    for (const nome of ["BarraDeControles.tsx", "MenuMais.tsx", "GradeDeSecoes.tsx", "GrupoDeFuncoes.tsx"]) {
      const rel = `components/sistema/${nome}`;
      const n = medir(readFileSync(resolve(pastaSrc, rel), "utf8").replace(/\r\n/g, "\n"), rel);
      for (const m of METRICAS) expect(n[m], `${nome}: ${m}`).toBe(0);
    }
  });
});

describe("regras em código (src/components/sistema/regras.ts)", () => {
  it("escala de fonte fechada: 11, 12, 13, 14, 15, 20 e 24 px", () => {
    expect(Array.from(ESCALA_DE_FONTE)).toEqual([11, 12, 13, 14, 15, 20, 24]);
    expect(fontesForaDaEscala("text-[12px] sm:text-[12.5px] text-sm lg:text-lg text-[24px] text-primary text-left")).toEqual(["text-[12.5px]", "text-sm", "text-lg"]);
    for (const papel of Object.values(texto)) expect(fontesForaDaEscala(papel), papel).toEqual([]);
    expect(texto.etiqueta).toContain("text-[11px]");
    expect(texto.numero).toContain("text-[24px]");
    expect(texto.numero).toContain("tabular-nums");
  });

  it("rolagem: caixa com teto só rola por dentro de 1024 px para cima", () => {
    expect(rolagemPresaNoCelular("max-h-[300px] overflow-y-auto")).toBe(true);
    expect(rolagemPresaNoCelular("lg:max-h-[300px] lg:overflow-y-auto")).toBe(false);
    expect(rolagemPresaNoCelular("sm:max-h-[300px] sm:overflow-y-auto")).toBe(false);
    expect(rolagemPresaNoCelular("max-h-[300px] lg:overflow-y-auto")).toBe(false);
    for (const chave of ["curta", "lista", "longa"] as const) {
      expect(rolagemPresaNoCelular(rolagem[chave]), chave).toBe(false);
      expect(rolagem[chave]).toMatch(/lg:max-h-\[\d+px\] lg:overflow-y-auto/);
    }
  });

  it("cartão sólido; seção não vira cartão; cartão à mão conta para sair", () => {
    expect(translucidoEmBloco("rounded-lg bg-card/40 p-4")).toBe(true);
    expect(translucidoEmBloco("absolute bg-background/80")).toBe(false);
    expect(translucidoEmBloco("bg-card hover:bg-card/80")).toBe(false);
    expect(cartaoFeitoAMao("rounded-xl border border-border bg-card p-4")).toBe(true);
    expect(cartaoFeitoAMao("rounded-lg border-dashed border bg-card")).toBe(false);
    expect(cartaoFeitoAMao("rounded-lg px-2 py-2.5 hover:bg-muted/40")).toBe(false);
    expect(cantosForaDoToken("rounded-2xl rounded-t-3xl rounded-lg")).toEqual(["rounded-2xl", "rounded-t-3xl"]);
    expect(tituloQueQuebra("min-w-0 [overflow-wrap:anywhere]")).toBe(true);
    expect(sombrasFortes("shadow-sm shadow-lg")).toEqual(["shadow-lg"]);
    expect(alturasFixasDaJanela("lg:h-[calc(100vh-260px)] max-h-[calc(100vh-8rem)] h-full")).toEqual(["h-[calc(100vh-260px)]", "max-h-[calc(100vh-8rem)]"]);
  });

  it("ritmo de espaço e linha de lista sem caixa", () => {
    expect(espaco.pagina).toContain("space-y-6");
    expect(espaco.colunas).toContain("gap-x-8");
    expect(espaco.grade).toContain("gap-4");
    expect(lista.linha).toContain("hover:bg-muted/40");
    expect(lista.linha).toContain("rounded-lg");
    expect(cartaoFeitoAMao(lista.linha)).toBe(false);
    expect(lista.destaque).not.toMatch(/border-l/);
  });
});

describe("componentes da base (L0)", () => {
  it("MenuMais: botão com nome, perigo por último e item condicional", () => {
    const escolhidos: string[] = [];
    render(
      h(MenuMais, {
        rotulo: "Mais do calendário",
        itens: [
          { rotulo: "Arquivar", perigo: true, aoEscolher: () => escolhidos.push("arquivar") },
          false,
          { rotulo: "Exportar", aoEscolher: () => escolhidos.push("exportar") },
        ],
      }),
    );
    const botao = screen.getByRole("button", { name: "Mais do calendário" });
    fireEvent.keyDown(botao, { key: "Enter" });
    const itens = screen.getAllByRole("menuitem");
    expect(itens.map((i) => i.textContent)).toEqual(["Exportar", "Arquivar"]);
    fireEvent.click(itens[0]);
    expect(escolhidos).toEqual(["exportar"]);
  });

  it("MenuMais sem item não desenha nada", () => {
    const { container } = render(h(MenuMais, { itens: [false, null] }));
    expect(container.innerHTML).toBe("");
  });

  it("BarraDeControles: duas linhas quando cabe; nada some", () => {
    render(
      h(BarraDeControles, {
        rotulo: "Filtros do teste",
        inicio: h("input", { "aria-label": "Buscar" }),
        acoes: h("button", { type: "button" }, "Novo"),
        filtros: [h("button", { key: "a", type: "button" }, "Status"), h("button", { key: "b", type: "button" }, "Tipo")],
        mais: [{ rotulo: "Exportar", aoEscolher: () => undefined }],
      }),
    );
    const barra = screen.getByRole("group", { name: "Filtros do teste" });
    expect(barra.getAttribute("data-filtros")).toBe("na-barra");
    expect(barra.querySelectorAll("[data-linha-da-barra]")).toHaveLength(2);
    expect(within(barra).getByRole("button", { name: "Status" })).toBeTruthy();
    expect(within(barra).getByRole("button", { name: "Mais ações" })).toBeTruthy();
    // Compatibilidade: espaço por margem, nunca gap em flex.
    for (const linha of Array.from(barra.querySelectorAll("[data-linha-da-barra]"))) expect((linha as HTMLElement).className).not.toMatch(/\bgap-/);
  });

  it("BarraDeControles: a linha 2 que não cabe vira 'Filtros (n)' e abre na gaveta no celular", () => {
    const largura = window.innerWidth;
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).getAttribute("data-linha-da-barra") === "2" ? 900 : 0;
      },
    });
    try {
      function Teste() {
        const [status, setStatus] = useState("todos");
        return h(BarraDeControles, {
          rotulo: "Filtros do teste",
          inicio: h("input", { "aria-label": "Buscar" }),
          filtros: h("button", { type: "button", onClick: () => setStatus("abertos") }, `Status: ${status}`),
          filtrosAtivos: status === "todos" ? 0 : 1,
          aoLimparFiltros: () => setStatus("todos"),
        });
      }
      render(h(Teste));
      const barra = screen.getByRole("group", { name: "Filtros do teste" });
      expect(barra.getAttribute("data-filtros")).toBe("recolhidos");
      expect(barra.querySelectorAll("[data-linha-da-barra]")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: /Status/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
      const gaveta = screen.getByRole("dialog");
      fireEvent.click(within(gaveta).getByRole("button", { name: "Status: todos" }));
      expect(screen.getByRole("button", { name: "Filtros (1)" })).toBeTruthy();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Limpar filtros" }));
      expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Status: todos" })).toBeTruthy();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pronto" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollWidth", original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: largura });
    }
  });

  it("GradeDeSecoes: colunas por largura, filho que encolhe, sem caixa", () => {
    render(h(GradeDeSecoes, { colunas: 2, "data-testid": "grade" }, h("section", null, "a"), h("section", null, "b")));
    const grade = screen.getByTestId("grade");
    expect(grade.className).toContain("lg:grid-cols-2");
    expect(grade.className).toContain("[&>*]:min-w-0");
    expect(grade.className).toContain("gap-x-8");
    expect(pareceCartao(grade.className)).toBe(false);
  });

  it("GrupoDeFuncoes: título curto, controles alinhados, secundário no '...', sem borda nem fundo", () => {
    render(
      h(
        GradeDeGrupos,
        { colunas: 3 },
        h(
          GrupoDeFuncoes,
          { titulo: "Referência", grade: 2, mais: [{ rotulo: "Colar link", aoEscolher: () => undefined }] },
          h("button", { type: "button" }, "Foto"),
          h("button", { type: "button" }, "Arquivo"),
        ),
      ),
    );
    const grupo = screen.getByRole("group", { name: "Referência" });
    expect(grupo.className).not.toMatch(/\bborder\b|\bbg-/);
    expect(within(grupo).getByRole("button", { name: "Mais em Referência" })).toBeTruthy();
    const controles = within(grupo).getByRole("button", { name: "Foto" }).parentElement as HTMLElement;
    expect(controles.className).toContain("grid-cols-2");
  });
});

describe("tudo recolhe (28/09)", () => {
  it("Secao com título em texto já nasce recolhível (aberta), com a setinha pequena", () => {
    window.localStorage.clear();
    const { unmount } = render(h(Secao, { titulo: "Paleta da marca", descricao: "3 cores" }, h("p", null, "conteúdo")));
    // O título continua título; o controle é a setinha "Recolher" (não muda o nome dos botões da tela).
    expect(screen.getByRole("heading", { name: "Paleta da marca" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Paleta/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recolher" }));
    expect(screen.queryByText("conteúdo")).toBeNull();
    // Recolhida: o estado (descricao) fica embaixo do título, como resumo.
    expect(screen.getByText("3 cores").hasAttribute("data-resumo-recolhido")).toBe(true);
    unmount();
    render(h(Secao, { titulo: "Paleta da marca" }, h("p", null, "conteúdo")));
    expect(screen.queryByText("conteúdo")).toBeNull();
    fireEvent.click(screen.getByRole("heading", { name: "Paleta da marca" }));
    expect(screen.getByText("conteúdo")).toBeTruthy();
  });

  it("recolher={false} desliga; título que não é texto não ganha chave", () => {
    render(h("div", null, h(Secao, { titulo: "Fixa", recolher: false }, "a"), h(Secao, { titulo: h("span", null, "Elemento") }, "b")));
    expect(screen.queryByRole("button", { name: "Recolher" })).toBeNull();
    expect(tituloEmChave("Ação do mês: 3. Fotos")).toBe("acao-do-mes-3-fotos");
  });

  it("Painel com título também recolhe", () => {
    window.localStorage.clear();
    render(h(Painel, { titulo: "Resumo do contrato", rodape: h("button", { type: "button" }, "Salvar") }, h("p", null, "corpo")));
    fireEvent.click(screen.getByRole("button", { name: "Recolher" }));
    expect(screen.queryByText("corpo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mostrar" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("lateral sem botão próprio ganha o botão pequeno no canto e recolhe para a tirinha", () => {
    const largura = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    try {
      window.localStorage.clear();
      render(h(AreaDeTrabalho, { lateral: h("div", null, "lista lateral"), rotuloDaLateral: "Lista", memoria: "teste-tirinha" }, h("p", null, "principal")));
      fireEvent.click(screen.getByRole("button", { name: "Recolher lista" }));
      expect(screen.queryByText("lista lateral")).toBeNull();
      const tirinha = screen.getByRole("button", { name: "Abrir lista" });
      expect(tirinha.className).toContain("w-8");
      expect(tirinha.className).not.toMatch(/bg-card/);
      expect(window.localStorage.getItem("area:teste-tirinha:recolhida")).toBe("1");
      fireEvent.click(tirinha);
      expect(screen.getByText("lista lateral")).toBeTruthy();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: largura });
    }
  });
});
