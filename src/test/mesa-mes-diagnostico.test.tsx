import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DiagnosticoDoMes, {
  chipsDoDiagnostico,
  lerDiagnosticoEstruturado,
  resumoDoTexto,
  secoesDoTexto,
} from "@/components/mesa/DiagnosticoDoMes";

/**
 * Diagnóstico do mês organizado (Frente O, pedido do dono em 26/09): recolhido
 * por padrão com o resumo e até 3 chips; abre com clique; seções com títulos e
 * listas; rolagem própria de até 420 px; texto antigo quebrado em seções.
 */

const estruturado = {
  versao: "2026-09-26.1",
  origem: "pesquisa",
  gerado_em: "2026-09-26T12:00:00.000Z",
  resumo: "Carrossel educativo é o que mais salva no perfil; outubro pede Dia das Crianças e Outubro Rosa.",
  o_que_funciona: [{ ponto: "Carrossel de lista", evidencia: "salvou 3x a média do perfil" }],
  o_que_nao_funciona: [{ ponto: "Imagem única de oferta", evidencia: "alcance de 180 contra média de 540" }],
  oportunidades_do_mes: [
    { data: "2026-10-09", tema: "Dia das Crianças: guia de presentes", por_que: "data comercial do mês" },
    { data: null, tema: "Outubro Rosa com informação correta", por_que: "campanha do mês" },
  ],
  tendencias_do_nicho: [{ tendencia: "Bastidor de produção", como_usar: "série semanal às quartas", fonte: "https://exemplo.com.br/tendencia" }],
  recomendacoes: [
    { acao: "Série fixa de carrossel às quartas", por_que: "constância", prioridade: "alta" },
    { acao: "Oferta só depois de prova", por_que: "fundo precisa de aquecimento", prioridade: "media" },
  ],
  mistura_sugerida: { topo: 40, meio: 40, fundo: 20, justificativa: "Perfil pequeno: mais topo." },
  sinais_para_medir: ["Envios por alcance"],
  limites: ["Poucos posts medidos"],
  fontes: [{ titulo: "Estudo", url: "https://exemplo.com.br/estudo" }],
  texto_base: "Carrossel educativo é o que mais salva no perfil.",
};

const proposta = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  diagnostico: "Carrossel educativo é o que mais salva no perfil.",
  parametros: { diagnostico_estruturado: estruturado, diagnostico_estado: "pronto" },
  ...extra,
});

describe("DiagnosticoDoMes: recolhido, organizado e com rolagem própria", () => {
  it("começa recolhido com o resumo e 3 chips; abre com clique e mostra as seções", () => {
    render(h(DiagnosticoDoMes, { proposta: proposta() }));
    const botao = screen.getByRole("button", { expanded: false });
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(estruturado.resumo)).toBeTruthy();
    expect(screen.getByText("2 oportunidades")).toBeTruthy();
    expect(screen.getByText("1 tendência")).toBeTruthy();
    expect(screen.getByText("2 recomendações")).toBeTruthy();
    expect(screen.queryByTestId("diagnostico-rolagem")).toBeNull();
    expect(screen.queryByText("O que funciona")).toBeNull();

    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    const rolagem = screen.getByTestId("diagnostico-rolagem");
    for (const c of ["max-h-[420px]", "overflow-y-auto", "overscroll-contain"]) expect(rolagem.className).toContain(c);
    for (const t of ["O que funciona", "O que não funciona", "Oportunidades do mês", "Tendências do nicho", "Recomendações", "Mistura sugerida do funil", "Sinais para medir", "Limites e hipóteses", "Fontes"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(screen.getByText("09/10")).toBeTruthy();
    expect(screen.getByText("mês")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Topo 40%, meio 40%, fundo 20%" })).toBeTruthy();
    const link = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(link).toContain("https://exemplo.com.br/tendencia");
    expect(link).toContain("https://exemplo.com.br/estudo");
    // Sem mudança na conversa, o texto não se repete.
    expect(screen.queryByText("Atualizado na conversa")).toBeNull();

    fireEvent.click(botao);
    expect(screen.queryByTestId("diagnostico-rolagem")).toBeNull();
  });

  it("texto antigo sem estruturado vira seções com títulos e listas", () => {
    const antigo = "Perfil com alcance estável e poucos salvamentos. O melhor post foi a lista de erros.\n\nPúblicos prioritários: mães de 30 a 45; donos de pet.\n\nPilares: educação; bastidor; oferta.\n\nPesquisa: tendência de bastidor https://fonte.com/x\n\nHipóteses (dado indisponível): sem dado de vendas.";
    const secoes = secoesDoTexto(antigo);
    expect(secoes.map((s) => s.titulo)).toEqual([null, "Públicos prioritários", "Pilares", "Pesquisa", "Hipóteses (dado indisponível)"]);
    expect(secoes[2].itens).toEqual(["educação", "bastidor", "oferta"]);
    expect(secoes[3].corrido).toBe(true);
    expect(resumoDoTexto(antigo)).toBe("Perfil com alcance estável e poucos salvamentos. O melhor post foi a lista de erros.");
    expect(chipsDoDiagnostico(null, secoes)).toEqual(["Públicos prioritários (2)", "Pilares (3)", "Pesquisa"]);

    render(h(DiagnosticoDoMes, { proposta: { id: "p2", diagnostico: antigo, parametros: {} } }));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Pilares")).toBeTruthy();
    expect(screen.getByText("bastidor")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://fonte.com/x");
  });

  it("mostra o aviso enquanto pesquisa e nada quando não há diagnóstico", () => {
    const { container, rerender } = render(h(DiagnosticoDoMes, { proposta: { id: "p3", diagnostico: null, parametros: { diagnostico_estado: "gerando" } } }));
    expect(screen.getByText(/Pesquisando tendências, datas e números do perfil/)).toBeTruthy();
    rerender(h(DiagnosticoDoMes, { proposta: { id: "p3", diagnostico: null, parametros: {} } }));
    expect(container.innerHTML).toBe("");
    rerender(h(DiagnosticoDoMes, { proposta: null }));
    expect(container.innerHTML).toBe("");
  });

  it("texto mudado na conversa aparece em seção própria; origem frentes ganha o selo", () => {
    render(h(DiagnosticoDoMes, { proposta: proposta({ diagnostico: "Novo foco combinado na conversa: mais prova social." }) }));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Atualizado na conversa")).toBeTruthy();
    expect(screen.getByText("Novo foco combinado na conversa: mais prova social.")).toBeTruthy();
  });

  it("lê o estruturado de coluna própria, de parametros ou em texto JSON, e ignora lixo", () => {
    expect(lerDiagnosticoEstruturado({ diagnostico_estruturado: estruturado })?.recomendacoes[0].prioridade).toBe("alta");
    expect(lerDiagnosticoEstruturado({ parametros: { diagnostico_estruturado: JSON.stringify(estruturado) } })?.resumo).toBe(estruturado.resumo);
    expect(lerDiagnosticoEstruturado({ parametros: { diagnostico_estruturado: { resumo: "" } } })).toBeNull();
    expect(lerDiagnosticoEstruturado({ parametros: { diagnostico_estruturado: "lixo" } })).toBeNull();
    const d = lerDiagnosticoEstruturado({ diagnostico_estruturado: { ...estruturado, origem: "frentes", mistura_sugerida: { topo: 1, meio: 1, fundo: 2 }, fontes: [{ url: "javascript:alert(1)" }], tendencias_do_nicho: [{ tendencia: "x", fonte: "ftp://nao" }] } });
    expect(d?.origem).toBe("frentes");
    expect(d?.mistura_sugerida).toEqual({ topo: 25, meio: 25, fundo: 50, justificativa: "" });
    expect(d?.fontes).toEqual([]);
    expect(d?.tendencias_do_nicho[0].fonte).toBeNull();
  });

  it("segue a regra de Safari 11 e a assinatura combinada com a AbaMes", () => {
    const fonte = readFileSync(resolve(process.cwd(), "src/components/mesa/DiagnosticoDoMes.tsx"), "utf8");
    for (const proibido of [".at(", "Object.hasOwn", "(?<", "aspect-", ":has(", "replaceAll", ".flat("]) {
      expect(fonte, proibido).not.toContain(proibido);
    }
    // min()/max()/clamp() dentro de classe arbitrária do Tailwind.
    expect(fonte).not.toMatch(/\[[^\]\s]*(min|max|clamp)\(/);
    // Sem gap em flex (Safari 11 não tem): espaçamento por margem.
    expect(fonte).not.toMatch(/className="[^"]*\bflex\b[^"]*\bgap-/);
    expect(fonte).toContain("export default function DiagnosticoDoMes({ proposta }: { proposta: PropostaDoDiagnostico })");
    const mes = readFileSync(resolve(process.cwd(), "src/components/mesa/AbaMes.tsx"), "utf8");
    expect(mes).toContain("<DiagnosticoDoMes proposta={proposta} />");
    // Sem travessão no texto da tela.
    expect(fonte).not.toMatch(/[\u2014\u2013]/);
  });
});
