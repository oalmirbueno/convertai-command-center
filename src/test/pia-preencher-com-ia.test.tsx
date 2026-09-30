import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente PIA (30/09): a peça comum "Preencher com IA".
 * - esquema JSON estrito a partir dos campos;
 * - limpeza da resposta (número ou nome fora das fontes cai, com aviso);
 * - só os vazios por padrão;
 * - a tela: prévia, aplicar parcial, desfazer e o modelo lembrado por papel.
 */

const { estimar, preencher, toastSucesso } = vi.hoisted(() => ({
  estimar: vi.fn(),
  preencher: vi.fn(),
  toastSucesso: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSucesso(...a), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/mesa/preencherComIA", async (original) => {
  const real = await original<typeof import("@/lib/mesa/preencherComIA")>();
  return { ...real, estimarPreenchimento: (...a: unknown[]) => estimar(...a), preencherComIA: (...a: unknown[]) => preencher(...a) };
});
vi.mock("@/lib/mesa/api", async (original) => {
  const real = await original<typeof import("@/lib/mesa/api")>();
  return { ...real, lerCatalogo: async () => CATALOGO };
});
// O Select do Radix não abre no jsdom: um select nativo com o mesmo contrato.
vi.mock("@/components/mesa/Seletores", () => ({
  SeletorDeModelo: (p: { catalogo: Array<{ id: string }>; valor: string; onChange: (id: string) => void }) =>
    h(
      "select",
      { "aria-label": "Modelo", value: p.valor, onChange: (e: { target: { value: string } }) => p.onChange(e.target.value) },
      p.catalogo.map((m) => h("option", { key: m.id, value: m.id }, m.id)),
    ),
}));

import {
  camposAPreencher,
  esquemaDosCampos,
  limparResposta,
  montarPedido,
  nomesSemFonte,
  normalizarCampos,
  numerosSemFonte,
  referenciaDas,
  type CampoParaPreencher,
  type FonteLida,
} from "../../supabase/functions/_shared/preencher-com-ia";
import { chaveDoModeloLembrado, PreencherComIA, ROTA_DO_MODELO_LEMBRADO } from "@/components/sistema/PreencherComIA";
import { PreencherComIA as DoIndice } from "@/components/sistema";
import { gravarEstadoDaTela, lerEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

const modelo = (id: string, padrao: string[]) => ({
  id,
  provedor: "openai",
  modelo_api: id,
  tipo: "texto" as const,
  rotulo: id,
  preco_entrada_1m: 1,
  preco_saida_1m: 2,
  preco_cache_1m: null,
  preco_imagem: null,
  raciocinio: null,
  padrao_para: padrao,
  ativo: true,
});
const CATALOGO = [modelo("m-a", ["proposta"]), modelo("m-b", ["estrategista"])];

const raiz = resolve(__dirname, "../..");

const CAMPOS: CampoParaPreencher[] = [
  { chave: "capa.headline", rotulo: "Headline", tipo: "texto", maximo: 40 },
  { chave: "capa.resumo", rotulo: "Resumo", tipo: "texto_longo", valorAtual: "Já escrito" },
  { chave: "entregas", rotulo: "Entregas", tipo: "lista", maximo: 2 },
  { chave: "preco", rotulo: "Preço mensal", tipo: "numero" },
  { chave: "plano", rotulo: "Plano", tipo: "escolha", opcoes: ["Básico", "Completo"] },
  { chave: "contato", rotulo: "Contato", tipo: "objeto", valorAtual: { nome: "", cargo: "" } },
  { chave: "extra", rotulo: "Extra", tipo: "objeto" },
];

describe("esquema a partir dos campos", () => {
  it("monta o esquema estrito: tudo obrigatório, vazio para sem base, opções e objetos", () => {
    const { schema, mapa } = esquemaDosCampos(CAMPOS);
    const s = schema as any;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["valores", "fontes_usadas", "citacoes", "avisos"]);
    const v = s.properties.valores;
    expect(v.additionalProperties).toBe(false);
    expect(v.required).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6"]);
    expect(Object.keys(mapa).map((k) => mapa[k].chave)).toEqual(CAMPOS.map((c) => c.chave));
    expect(v.properties.c0.type).toBe("string");
    expect(v.properties.c0.description).toContain("até 40 caracteres");
    expect(v.properties.c0.description).toContain("texto vazio quando as fontes não dão base");
    expect(v.properties.c2.type).toBe("array");
    expect(v.properties.c2.items).toEqual({ type: "string" });
    expect(v.properties.c2.description).toContain("até 2 itens");
    expect(v.properties.c2.description).toContain("lista vazia");
    // Número vai como texto (algarismos): pode voltar vazio sem inventar 0.
    expect(v.properties.c3.type).toBe("string");
    // Escolha: as opções mais a opção vazia (sem base), sem tipo em lista nem anyOf.
    expect(v.properties.c4).toMatchObject({ type: "string", enum: ["Básico", "Completo", ""] });
    expect(v.properties.c5.type).toBe("object");
    expect(v.properties.c5.required).toEqual(["nome", "cargo"]);
    expect(v.properties.c5.additionalProperties).toBe(false);
    expect(v.properties.c5.properties.nome).toEqual({ type: "string" });
    // Objeto sem forma conhecida vai como texto JSON.
    expect(v.properties.c6.type).toBe("string");
    const citacao = s.properties.citacoes.items;
    expect(citacao.required).toEqual(["campo", "trecho", "url"]);
    expect(citacao.properties.url.type).toBe("string");
  });

  it("nenhum tipo união no esquema, nem com 40 campos (a Anthropic recusa mais de 16)", () => {
    // Visto em 30/09: Preencher tudo do site (18 campos) no Opus 5.5 voltou 400
    // "Schemas contains too many parameters with union types (19 ...) limit: 16".
    const muitos: CampoParaPreencher[] = [];
    for (let i = 0; i < 40; i++) {
      const tipo = (["texto", "texto_longo", "lista", "numero", "escolha", "objeto"] as const)[i % 6];
      muitos.push({ chave: `k${i}`, rotulo: `Campo ${i}`, tipo, opcoes: tipo === "escolha" ? ["a", "b"] : undefined, valorAtual: tipo === "objeto" ? { x: "", y: [], z: 0 } : undefined });
    }
    const { schema } = esquemaDosCampos(muitos);
    const unioes: string[] = [];
    const opcionais: string[] = [];
    const andar = (no: unknown, caminho: string) => {
      if (!no || typeof no !== "object") return;
      const o = no as Record<string, any>;
      if (Array.isArray(o.type) || Array.isArray(o.anyOf) || Array.isArray(o.oneOf)) unioes.push(caminho);
      if (o.enum) expect(typeof o.type).toBe("string");
      if (o.type === "object") {
        expect(o.additionalProperties).toBe(false);
        Object.keys(o.properties || {}).forEach((k) => {
          if ((o.required || []).indexOf(k) < 0) opcionais.push(`${caminho}.${k}`);
          andar(o.properties[k], `${caminho}.${k}`);
        });
      }
      if (o.items) andar(o.items, `${caminho}[]`);
    };
    andar(schema, "$");
    expect(unioes).toEqual([]);
    expect(opcionais).toEqual([]);
  });

  it("vazio do modelo é sem base: texto, lista, escolha e número em texto", () => {
    const { mapa } = esquemaDosCampos(CAMPOS);
    const r = limparResposta(
      { valores: { c0: "", c2: [], c3: "", c4: "", c5: { nome: "", cargo: "" }, c6: "" }, fontes_usadas: [], citacoes: [{ campo: "c0", trecho: "x", url: "" }], avisos: [] },
      { papel: "proposta", mapa, fontes: FONTES },
    );
    expect(r.valores).toEqual({});
    expect(r.avisos.filter((a) => a.indexOf("ficou vazio, as fontes não dão base") > 0)).toHaveLength(6);
    // Número em texto (como o esquema pede) é convertido e conferido.
    const n = limparResposta({ valores: { c3: "R$ 1.500" }, fontes_usadas: [], citacoes: [], avisos: [] }, { papel: "proposta", mapa, fontes: FONTES });
    expect(n.valores.preco).toBe(1500);
    // Inteiro pequeno (escala de -2 a 2) fica livre, como no texto.
    const escala = esquemaDosCampos([{ chave: "eixo", rotulo: "Formal ou casual", tipo: "numero", dica: "Inteiro de -2 a 2" }]);
    const e = limparResposta({ valores: { c0: "-1" }, fontes_usadas: [], citacoes: [], avisos: [] }, { papel: "identidade", mapa: escala.mapa, fontes: [] });
    expect(e.valores.eixo).toBe(-1);
  });

  it("número em texto sem algarismo é sem base (nunca vira 0); até 80 campos passam (Dados do contrato com 3 serviços)", () => {
    const campos: CampoParaPreencher[] = [{ chave: "multa", rotulo: "Multa", tipo: "numero" }];
    const { mapa } = esquemaDosCampos(campos);
    const r = limparResposta({ valores: { c0: "não informado" }, fontes_usadas: [], citacoes: [], avisos: [] }, { papel: "contrato", mapa, fontes: FONTES });
    expect(r.valores.multa).toBeUndefined();
    expect(r.avisos[0]).toContain("Multa: ficou vazio");
    const muitos = Array.from({ length: 43 }, (_, i) => ({ chave: `v${i}`, rotulo: `Variável ${i}`, tipo: "texto" }));
    expect(normalizarCampos(muitos)).toHaveLength(43);
    expect(() => normalizarCampos(Array.from({ length: 81 }, (_, i) => ({ chave: `v${i}`, tipo: "texto" })))).toThrow();
  });

  it("objeto em lista (Exemplos por situação): esquema de lista de objetos pela dica e itens conferidos um a um", () => {
    // QA 30/09: tom.exemplos da estratégia é "objeto" com valor [] e voltava sempre vazio.
    const campos: CampoParaPreencher[] = [
      { chave: "tom.exemplos", rotulo: "Exemplos por situação", tipo: "objeto", valorAtual: [], dica: "Lista de { situacao, certo, errado } (ex.: responder reclamação).", maximo: 2 },
      { chave: "publico.persona", rotulo: "Persona", tipo: "objeto", valorAtual: { nome: "", idade: "", dores: [] }, dica: "Objeto { nome, idade, dores[] }" },
    ];
    const { schema, mapa } = esquemaDosCampos(campos);
    const v = (schema as any).properties.valores.properties;
    expect(v.c0.type).toBe("array");
    expect(v.c0.items).toMatchObject({ type: "object", additionalProperties: false, required: ["situacao", "certo", "errado"] });
    expect(v.c1.properties.dores).toEqual({ type: "array", items: { type: "string" } });
    const r = limparResposta(
      {
        valores: {
          c0: [
            { situacao: "Responder reclamação", certo: "Sentimos muito, vamos resolver hoje.", errado: "Não é culpa nossa." },
            { situacao: "Anunciar promoção", certo: "Pão quente com desconto de 90%", errado: "Compre já" },
            { situacao: "Agradecer", certo: "Obrigado pela visita!", errado: "Valeu" },
            { situacao: "Convidar", certo: "Venha provar o pão de hoje.", errado: "Aparece" },
          ],
          c1: { nome: "Carlos Lima", idade: "de 25 a 34", dores: ["Pouco tempo de manhã"] },
        },
        fontes_usadas: [],
        citacoes: [],
        avisos: [],
      },
      { papel: "identidade", mapa, fontes: FONTES },
    );
    // O item com número inventado (90%) sai sozinho; a lista é cortada no máximo.
    expect(r.valores["tom.exemplos"]).toEqual([
      { situacao: "Responder reclamação", certo: "Sentimos muito, vamos resolver hoje.", errado: "Não é culpa nossa." },
      { situacao: "Anunciar promoção", errado: "Compre já" },
    ]);
    // Na persona, só a idade (números fora das fontes) sai; nome e dores ficam.
    expect(r.valores["publico.persona"]).toEqual({ nome: "Carlos Lima", dores: ["Pouco tempo de manhã"] });
    expect(r.avisos.some((a) => a.indexOf("Persona:") === 0 && a.indexOf("idade saiu") > 0)).toBe(true);
  });

  it("objeto: chave que era número volta número; avisos do modelo sem c0/c1 e sem repetir a conferência", () => {
    const campos: CampoParaPreencher[] = [
      { chave: "persona", rotulo: "Persona", tipo: "objeto", valorAtual: { nome: "", idade: 0 } },
      { chave: "site", rotulo: "Sites que o cliente admira", tipo: "texto" },
      { chave: "obs", rotulo: "Observação", tipo: "texto" },
    ];
    const { mapa } = esquemaDosCampos(campos);
    const r = limparResposta(
      {
        valores: { c0: { nome: "Carlos Lima", idade: "1.500" }, c1: "", c2: "" },
        fontes_usadas: [],
        citacoes: [],
        avisos: ["c1 ficou vazio: as fontes não informam sites.", "c2 sem base no briefing."],
      },
      { papel: "identidade", mapa, fontes: FONTES, substituir: true },
    );
    expect(r.valores.persona).toEqual({ nome: "Carlos Lima", idade: 1500 });
    expect(r.avisos.some((a) => /\bc\d\b/.test(a))).toBe(false);
    expect(r.avisos.filter((a) => a.indexOf("Sites que o cliente admira") === 0)).toHaveLength(1);
  });

  it("recusa campo sem chave, tipo desconhecido, escolha sem opções e chave repetida", () => {
    expect(() => normalizarCampos([])).toThrow();
    expect(() => normalizarCampos([{ rotulo: "x", tipo: "texto" }])).toThrow();
    expect(() => normalizarCampos([{ chave: "a", tipo: "data" }])).toThrow();
    expect(() => normalizarCampos([{ chave: "a", tipo: "escolha" }])).toThrow();
    expect(() => normalizarCampos([{ chave: "a", tipo: "texto" }, { chave: "a", tipo: "texto" }])).toThrow();
    expect(normalizarCampos([{ chave: "a", tipo: "texto", maximo: "12" }])[0]).toEqual({ chave: "a", rotulo: "a", tipo: "texto", maximo: 12 });
  });
});

const FONTES: FonteLida[] = [
  { id: "briefing", rotulo: "briefing de 12/09", texto: "Padaria Pão Quente, no Bacacheri. Mensalidade de R$ 1.500. Atendimento das 7h às 19h. Dono: Carlos Lima." },
];

describe("limpeza da resposta", () => {
  const ctx = (extra: Partial<Parameters<typeof limparResposta>[1]> = {}) => {
    const { mapa } = esquemaDosCampos(CAMPOS);
    return { papel: "proposta", mapa, fontes: FONTES, ...extra };
  };

  it("número inventado cai (campo vazio com aviso); número das fontes fica, mesmo escrito de outro jeito", () => {
    const r = limparResposta(
      { valores: { c0: "Pão quente todo dia desde 1998", c3: 1500 }, fontes_usadas: ["briefing de 12/09"], citacoes: [], avisos: [] },
      ctx(),
    );
    expect(r.valores["capa.headline"]).toBeUndefined();
    expect(r.avisos.some((a) => a.indexOf("Headline") === 0 && a.indexOf("1998") > 0)).toBe(true);
    expect(r.valores.preco).toBe(1500);
    expect(r.fontes).toEqual(["briefing de 12/09"]);
  });

  it("preço inventado em texto e em número cai", () => {
    const r = limparResposta({ valores: { c0: "Plano por R$ 2.990", c3: 2990 }, fontes_usadas: [], citacoes: [], avisos: [] }, ctx());
    expect(r.valores["capa.headline"]).toBeUndefined();
    expect(r.valores.preco).toBeUndefined();
    expect(r.avisos.some((a) => a.indexOf("Preço mensal") === 0)).toBe(true);
  });

  it("nome próprio fora das fontes cai (menos no naming); nome das fontes fica", () => {
    const inventado = { valores: { c0: "Feito pela família Souza" }, fontes_usadas: [], citacoes: [], avisos: [] };
    expect(limparResposta(inventado, ctx()).valores["capa.headline"]).toBeUndefined();
    expect(limparResposta(inventado, ctx({ papel: "naming" })).valores["capa.headline"]).toBe("Feito pela família Souza");
    const real = { valores: { c0: "O pão do Carlos no Bacacheri" }, fontes_usadas: [], citacoes: [], avisos: [] };
    expect(limparResposta(real, ctx()).valores["capa.headline"]).toBe("O pão do Carlos no Bacacheri");
  });

  it("escolha fora das opções cai; lista cortada no máximo; texto cortado no limite; sem travessão", () => {
    const r = limparResposta(
      {
        valores: {
          c0: "Pão quente e café fresco — para começar o dia com calma",
          c2: ["Posts no feed", "Stories", "Anúncios"],
          c4: "Premium",
        },
        fontes_usadas: [],
        citacoes: [],
        avisos: ["Contato ficou vazio: sem dado.", "Faltou o briefing de preços."],
      },
      ctx(),
    );
    expect(String(r.valores["capa.headline"]).length).toBeLessThanOrEqual(40);
    expect(String(r.valores["capa.headline"])).not.toContain("—");
    expect(r.valores.entregas).toEqual(["Posts no feed", "Stories"]);
    expect(r.valores.plano).toBeUndefined();
    // Aviso do modelo que não repete a conferência fica; o que repete (Contato) sai.
    expect(r.avisos).toContain("Faltou o briefing de preços.");
    expect(r.avisos.filter((a) => a.indexOf("Contato") === 0)).toHaveLength(1);
    expect(r.avisos.some((a) => a.indexOf("Entregas") === 0 && a.indexOf("2 itens") > 0)).toBe(true);
  });

  it("escolha acha a opção sem acento e sem caixa; número da web só com a citação e a url", () => {
    const semUrl = limparResposta(
      { valores: { c4: "basico", c3: 45 }, fontes_usadas: [], citacoes: [{ campo: "c3", trecho: "média de 45 reais", url: null }], avisos: [] },
      ctx({ web: true }),
    );
    expect(semUrl.valores.plano).toBe("Básico");
    expect(semUrl.valores.preco).toBeUndefined();
    const comUrl = limparResposta(
      { valores: { c3: 45 }, fontes_usadas: [], citacoes: [{ campo: "c3", trecho: "média de 45 reais", url: "https://exemplo.com/p" }], avisos: [] },
      ctx({ web: true }),
    );
    expect(comUrl.valores.preco).toBe(45);
    expect(comUrl.fontes).toContain("https://exemplo.com/p");
  });

  it("confere números por código (formato brasileiro e inteiros pequenos soltos)", () => {
    const ref = referenciaDas(["Mensalidade de R$ 1.500,50 e 12/09/2026"]);
    expect(numerosSemFonte("R$ 1500,50 em 12/09", ref)).toEqual([]);
    expect(numerosSemFonte("3 passos simples", ref)).toEqual([]);
    expect(numerosSemFonte("3% de desconto", ref)).toEqual(["3"]);
    expect(numerosSemFonte("em 2027", ref)).toEqual(["2027"]);
    expect(nomesSemFonte("Transforme Sua Rotina Hoje", ref)).toEqual([]);
    expect(nomesSemFonte("Siga no Instagram", ref)).toEqual([]);
  });
});

describe("só vazios por padrão", () => {
  it("camposAPreencher tira os preenchidos, a menos que substituir", () => {
    expect(camposAPreencher(CAMPOS).map((c) => c.chave)).toEqual(["capa.headline", "entregas", "preco", "plano", "contato", "extra"]);
    expect(camposAPreencher(CAMPOS, true)).toHaveLength(CAMPOS.length);
  });

  it("a limpeza não devolve valor para campo preenchido sem substituir; o pedido leva as fontes e a regra", () => {
    const { mapa } = esquemaDosCampos(CAMPOS);
    const r = limparResposta({ valores: { c1: "Resumo novo do Bacacheri" }, fontes_usadas: [], citacoes: [], avisos: [] }, { papel: "proposta", mapa, fontes: FONTES });
    expect(r.valores["capa.resumo"]).toBeUndefined();
    const r2 = limparResposta({ valores: { c1: "Resumo novo do Bacacheri" }, fontes_usadas: [], citacoes: [], avisos: [] }, { papel: "proposta", mapa, fontes: FONTES, substituir: true });
    expect(r2.valores["capa.resumo"]).toBe("Resumo novo do Bacacheri");
    const p = montarPedido({ papel: "proposta", campos: camposAPreencher(CAMPOS), fontes: FONTES, instrucao: "tom direto" });
    expect(p.mensagem).toContain("### briefing de 12/09");
    expect(p.mensagem).toContain("tom direto");
    expect(p.mensagem).not.toContain("Já escrito");
    expect(p.sistema).toContain("Nunca invente número");
  });
});

describe("registro da função", () => {
  it("preencher-ia no config.toml com verify_jwt e na FuncaoDaMesa", () => {
    expect(readFileSync(resolve(raiz, "supabase/config.toml"), "utf8")).toMatch(/\[functions\.preencher-ia\]\s+verify_jwt = true/);
    expect(readFileSync(resolve(raiz, "src/lib/mesa/api.ts"), "utf8")).toContain('| "preencher-ia"');
    const f = readFileSync(resolve(raiz, "supabase/functions/preencher-ia/index.ts"), "utf8");
    expect(f).toContain("can_access_client");
    expect(f).toContain("is_staff");
    expect(f).toContain("garantirSaldo");
    expect(f).toContain("tarefa: papel");
    expect(f).toContain("agente: papel");
    expect(DoIndice).toBe(PreencherComIA);
  });
});

// ------------------------------------------------------------------ tela

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function montar(props: Partial<Parameters<typeof PreencherComIA>[0]> = {}) {
  const onAplicar = vi.fn();
  const onDesfazer = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const campos: CampoParaPreencher[] = [
    { chave: "capa.headline", rotulo: "Headline", tipo: "texto", valorAtual: "" },
    { chave: "capa.sub", rotulo: "Subtítulo", tipo: "texto", valorAtual: "Antigo" },
  ];
  render(
    h(QueryClientProvider, { client: qc }, h(PreencherComIA, { papel: "proposta", clientId: "c-1", campos, onAplicar, onDesfazer, ...props })),
  );
  return { onAplicar, onDesfazer };
}

describe("a tela do Preencher com IA", () => {
  beforeEach(() => {
    (globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ObservadorFalso;
    window.localStorage.clear();
    estimar.mockReset();
    preencher.mockReset();
    toastSucesso.mockReset();
    estimar.mockResolvedValue({ partes: [], custo_usd: 0.0123, modelo_id: "m-a", modelo_nome: "m-a", campos_a_preencher: 1 });
    preencher.mockResolvedValue({
      valores: { "capa.headline": "Pão quente no Bacacheri", "capa.sub": "Desde cedo" },
      modelo_id: "m-a",
      custo_usd: 0.01,
      fontes: ["briefing de 12/09"],
      avisos: ["Preço ficou vazio."],
    });
  });

  it("botão compacto só com o ícone e title", () => {
    montar({ compacto: true, campos: [{ chave: "a", rotulo: "A", tipo: "texto" }] });
    const b = screen.getByRole("button", { name: "Preencher com IA" });
    expect(b.getAttribute("title")).toBe("Preencher com IA");
    expect(b.textContent).toBe("");
  });

  it("mostra a prévia, aplica só um campo e o Desfazer devolve o valor anterior", async () => {
    const { onAplicar, onDesfazer } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Preencher tudo" }));
    await screen.findByText(/Custo estimado/);
    fireEvent.click(screen.getByRole("button", { name: "Preencher" }));
    const previa = await screen.findByRole("list", { name: "Prévia do preenchimento" });
    expect(within(previa).getByText("Pão quente no Bacacheri")).toBeTruthy();
    expect(within(previa).getByText("Antigo")).toBeTruthy();
    expect(screen.getByText(/Fontes: briefing de 12\/09/)).toBeTruthy();
    expect(screen.getByText("Preço ficou vazio.")).toBeTruthy();
    expect(preencher.mock.calls[0][0]).toMatchObject({ papel: "proposta", clientId: "c-1", modeloId: "m-a", fontes: ["contexto", "briefing", "dossie"], substituir: false });

    fireEvent.click(screen.getByRole("button", { name: "Aplicar Subtítulo" }));
    await waitFor(() => expect(onAplicar).toHaveBeenCalledTimes(1));
    expect(onAplicar.mock.calls[0][0]).toEqual({ "capa.sub": "Desde cedo" });
    // O outro campo continua na prévia.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Aplicar Subtítulo" })).toBeNull());
    expect(screen.getByRole("button", { name: "Aplicar Headline" })).toBeTruthy();

    const [frase, opcoes] = toastSucesso.mock.calls[0];
    expect(frase).toBe("Subtítulo preenchido");
    expect(opcoes.action.label).toBe("Desfazer");
    await act(async () => {
      opcoes.action.onClick();
    });
    expect(onDesfazer).toHaveBeenCalledWith({ "capa.sub": "Antigo" });
  });

  it("erro fica visível e a instrução não se perde", async () => {
    preencher.mockRejectedValueOnce(new Error("Saldo insuficiente"));
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Preencher tudo" }));
    const campo = await screen.findByPlaceholderText(/tom mais direto/);
    fireEvent.change(campo, { target: { value: "foco em família" } });
    fireEvent.click(screen.getByRole("button", { name: "Preencher" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Saldo insuficiente");
    expect((screen.getByPlaceholderText(/tom mais direto/) as HTMLTextAreaElement).value).toBe("foco em família");
    expect(preencher.mock.calls[0][0].instrucao).toBe("foco em família");
  });

  it("lembra o último modelo escolhido por papel", async () => {
    gravarEstadoDaTela(chaveDoModeloLembrado("proposta"), "m-b", ROTA_DO_MODELO_LEMBRADO);
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Preencher tudo" }));
    const seletor = (await screen.findByRole("combobox", { name: "Modelo" })) as HTMLSelectElement;
    await waitFor(() => expect(seletor.value).toBe("m-b"));
    fireEvent.change(seletor, { target: { value: "m-a" } });
    expect(lerEstadoDaTela(chaveDoModeloLembrado("proposta"), "", undefined, ROTA_DO_MODELO_LEMBRADO)).toBe("m-a");
    fireEvent.click(screen.getByRole("button", { name: "Preencher" }));
    await waitFor(() => expect(preencher).toHaveBeenCalled());
    expect(preencher.mock.calls[0][0].modeloId).toBe("m-a");
  });

  it("sem nada vazio, avisa para marcar substituir e não chama a IA", async () => {
    estimar.mockResolvedValue({ partes: [], custo_usd: 0, modelo_id: "m-a", modelo_nome: "m-a", campos_a_preencher: 0 });
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Preencher tudo" }));
    await screen.findByText(/Substituir o que já tem\" para refazer/);
    expect((screen.getByRole("button", { name: "Preencher" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("substituirInicial abre com \"Substituir o que já tem\" marcado e o estimar já pede substituir", async () => {
    // QA 30/09: "Sugerir texto da cláusula" (Contratos) sempre tem texto e ficava travado.
    montar({ substituirInicial: true });
    fireEvent.click(screen.getByRole("button", { name: "Preencher tudo" }));
    const caixa = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(caixa.checked).toBe(true);
    await waitFor(() => expect(estimar).toHaveBeenCalled());
    expect(estimar.mock.calls[estimar.mock.calls.length - 1][0].substituir).toBe(true);
  });
});
