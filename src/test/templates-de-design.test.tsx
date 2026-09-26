import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente T (26/09): templates de design, combinação, referências de carrossel,
 * continuidade e trava da marca.
 * 1. "Nenhum" (o padrão): o prompt e as entradas são byte a byte os de hoje
 *    (fixtures do S2), sem ler o banco.
 * 2. Escolhido: bloco no lugar certo (depois do estilo, antes das regras de
 *    render) e prioridade das imagens (lâmina, estilo, template; limite do modelo).
 * 3. Continuidade: leitura normalizada, faixa da borda e fatias determinísticas.
 * 4. Referência de carrossel: mapa das lâminas (mesmo tamanho, maior, menor) e reordenação guardada.
 * 5. Trava da marca: fonte e cor da referência nunca chegam ao prompt.
 * 6. Ações do agente (contrato comum) e combinação com Jev simulado (e a falha dele).
 * 7. Guardar sem tabela (JSON no bucket) e o template de outro cliente.
 * 8. Tela: aba Templates e o seletor "Template" (Nenhum por padrão).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: new Error("sem") }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import BotaoDoEstilo from "@/components/estilo/BotaoDoEstilo";
import { mover, normalizarEstadoDosTemplates } from "@/components/estilo/templatesApi";
import { layoutPadrao, promptDaLamina } from "../../supabase/functions/_shared/direcao-arte";
import {
  blocoDoTemplateParaOGerador,
  comNovaVersaoDoTemplate,
  corpoAtual,
  type CorpoDoTemplate,
  escolherMelhoresPontos,
  escolhasDoDono,
  type FonteDaCombinacao,
  lerGosto,
  lerTemplate,
  lerTemplates,
  mudarTemplate,
  normalizarCorpo,
  normalizarProposta,
  perguntasDaCombinacao,
  templateEscolhidoNoTrabalho,
  templateNovo,
  TETO_DO_BLOCO_DO_TEMPLATE,
} from "../../supabase/functions/_shared/templates-de-design";
import {
  estrategiaDaContinuidade,
  faixaDaBorda,
  fatiasDoPanorama,
  laminaParaAOrdem,
  linhasDaContinuidade,
  normalizarContinuidade,
  papelPelaOrdem,
} from "../../supabase/functions/_shared/continuidade-do-carrossel";
import { blocoDaReferenciaDeCarrossel, mapaDasLaminas, normalizarLaminasDeReferencia, partesLidas, reordenarLaminas } from "../../supabase/functions/_shared/referencia-de-carrossel";
import { blocoDaMarcaTravada, neutralizarMarcaDaReferencia } from "../../supabase/functions/_shared/trava-da-marca";
import { guiaComMarcaTravada, limiteDeAnexosDoTemplate, templateNaLamina } from "../../supabase/functions/estudio-arte/estilo-na-geracao";
import { regrasVazias } from "../../supabase/functions/_shared/estilo-do-cliente";
import {
  acaoDaCombinacao,
  alvosDosTemplates,
  blocoDosAlvosDosTemplates,
  esquemaComTemplates,
  lerDestinoDaAncora,
  normalizarAcoesDosTemplates,
  separarAcoes,
} from "../../supabase/functions/agente-estilo/acoes-dos-templates";
import { ESQUEMA_DO_AGENTE_DE_ESTILO } from "../../supabase/functions/agente-estilo/acoes-do-estilo";
import { CASOS_DO_REPLICAR, MARCA_CASO } from "./fixtures/replicarCasos";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const HOJE_REPLICAR = JSON.parse(ler("src/test/fixtures/replicar-identica-hoje.json")) as { replicar: { nome: string; prompt: string }[] };
const HOJE_NORMAL = JSON.parse(ler("src/test/fixtures/lamina-normal-hoje.json")) as { normal: { nome: string; prompt: string }[] };

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const OUTRO = "99999999-9999-9999-9999-999999999999";
const TPL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TPL2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const A1 = "d1111111-1111-4111-8111-111111111111";
const A2 = "d2222222-2222-4222-8222-222222222222";
const A3 = "d3333333-3333-4333-8333-333333333333";
const L = (n: number) => `e${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`.slice(0, 36);

const CORPO: CorpoDoTemplate = normalizarCorpo({
  formato: "carrossel",
  resumo: "Editorial claro, título grande e muito respiro.",
  regras: {
    ...regrasVazias(),
    layout: ["Título no terço de cima, margem de 8% igual em todas as lâminas"],
    tipografia: ["Título em peso black, apoio em regular, duas linhas no máximo"],
    cor: ["Cor dominante no fundo, destaque só na palavra-chave"],
    tratamento: ["Luz natural, contraste suave"],
    elementos: ["Fio fino sob o título"],
    capa: ["Promessa concreta em até 6 palavras"],
    miolo: ["Uma ideia por lâmina, mesmo molde da capa"],
    cta: ["Um CTA só, no rodapé"],
    evitar: ["Fundo escuro", "Texto em caixa"],
  },
  areas: { titulo: "terço de cima", logo: "canto inferior direito, pequeno", area_segura: "8% em volta" },
  continuidade: {
    total: 4,
    laminas: [
      { ordem: 1, papel: "capa", funcao: "gancho", hierarquia: "título enorme", corte_direita: "fita laranja", corte_y0: 60, corte_y1: 70 },
      { ordem: 2, papel: "miolo", funcao: "dado", hierarquia: "número grande", corte_direita: "fita laranja", corte_y0: 60, corte_y1: 70 },
      { ordem: 3, papel: "miolo", funcao: "exemplo", hierarquia: "título e apoio", corte_direita: "", corte_y0: 0, corte_y1: 0 },
      { ordem: 4, papel: "fechamento", funcao: "CTA", hierarquia: "CTA grande", corte_direita: "nada", corte_y0: 10, corte_y1: 20 },
    ],
    tipos: ["elemento_na_borda", "numeracao"],
    descricao: "Uma fita atravessa as lâminas na mesma altura.",
    ritmo: "Capa pesada, miolo respira.",
  },
  ancoras: [
    { id: A1, origem: "arte_aprovada", bucket: "mesa", caminho: `${CLIENTE}/a1.jpg`, nome: "arte capa", papel: "capa" },
    { id: A2, origem: "referencia", bucket: "mesa", caminho: `${CLIENTE}/a2.jpg`, nome: "geral", papel: "geral" },
    { id: A3, origem: "teste", bucket: "mesa", caminho: `${CLIENTE}/a3.jpg`, nome: "miolo", papel: "miolo" },
  ],
});

// ------------------------------------------------------------------ banco de mentira

type Linha = Record<string, any>;
function bancoFalso(opcoes: { semTabela?: boolean; linhas?: Linha[]; arquivos?: Record<string, string> } = {}) {
  const linhas: Linha[] = opcoes.linhas ? opcoes.linhas.map((l) => ({ ...l })) : [];
  const arquivos: Record<string, string> = { ...(opcoes.arquivos || {}) };
  const chamadas = { from: 0, storage: 0 };
  const erroTabela = { code: "42P01", message: 'relation "cliente_templates_design" does not exist' };
  const consulta = () => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let patch: Linha | null = null;
    let novo: Linha | null = null;
    const resolver = (unico: boolean) => {
      if (opcoes.semTabela) return { data: null, error: erroTabela };
      if (novo) {
        const l = { ...novo };
        linhas.push(l);
        return { data: l, error: null };
      }
      const achadas = linhas.filter((l) => filtros.every((f) => f(l)));
      if (patch) {
        if (!achadas.length) return { data: null, error: null };
        Object.assign(achadas[0], patch);
        return { data: achadas[0], error: null };
      }
      return { data: unico ? achadas[0] || null : achadas, error: null };
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      order: () => q,
      limit: () => q,
      insert: (l: Linha) => ((novo = l), q),
      update: (p: Linha) => ((patch = p), q),
      maybeSingle: async () => resolver(true),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resolver(false)).then(ok, erro),
    };
    return q;
  };
  const db = {
    from: () => (chamadas.from++, consulta()),
    storage: {
      from: () => {
        chamadas.storage++;
        return {
          download: async (p: string) => (arquivos[p] ? { data: { text: async () => arquivos[p] }, error: null } : { data: null, error: new Error("sem") }),
          upload: async (p: string, b: Blob) => {
            arquivos[p] = await new Promise<string>((ok) => {
              const fr = new FileReader();
              fr.onload = () => ok(String(fr.result || ""));
              fr.readAsText(b);
            });
            return { error: null };
          },
        };
      },
    },
  };
  return { db, linhas, arquivos, chamadas };
}

const linhaDoTemplate = (o: { id?: string; tipo?: "template" | "referencia_carrossel"; corpo?: CorpoDoTemplate; escopo?: "cliente" | "agencia"; client?: string | null; status?: string; nome?: string } = {}) => {
  const t = templateNovo({
    id: o.id || TPL,
    tipo: o.tipo,
    escopo: o.escopo || "cliente",
    clientId: o.escopo === "agencia" ? null : o.client === undefined ? CLIENTE : o.client,
    marcaId: null,
    nome: o.nome || "Carrossel editorial",
    origem: "agente",
    corpo: o.corpo || CORPO,
    nota: "primeira",
    por: null,
    agora: "2026-09-26T10:00:00.000Z",
  });
  return { ...t, status: o.status || "ativo", atualizado_em: "2026-09-26T10:00:00.000Z" };
};

const baixarFalso = () => vi.fn(async (_b: string, c: string, nome: string) => ({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png", nome: `${nome}|${c}` }));

// ------------------------------------------------------------------ como o gerarCard compõe (mesmos arrays, mesma ordem)

const REGRAS = "REGRAS DE RENDER (sintético)";
const compoeNormal = (base: string, blocoDoEstilo: string, blocoDoTemplate: string) => `${[base, "", "", "", "", "", "", blocoDoEstilo, blocoDoTemplate].filter(Boolean).join("\n\n")}\n\n${REGRAS}`;
const compoeReplicar = (prompt: string, blocoDoEstilo: string, blocoDoTemplate: string) => [prompt, "", "", "", "", blocoDoEstilo, blocoDoTemplate, REGRAS].filter(Boolean).join("\n\n");

const CAPA = CASOS_DO_REPLICAR[0].entrada.card;
const MEIO = CASOS_DO_REPLICAR[1].entrada.card;
const FINAL = CASOS_DO_REPLICAR[3].entrada.card;
const CASOS_NORMAIS: Array<{ nome: string; card: any; total: number; fio?: string; anuncio?: any; post?: any }> = [
  { nome: "capa 4:5 com logo", card: CAPA, total: 4 },
  { nome: "miolo com fio visual", card: MEIO, total: 4, fio: "mesma dentista, consultório claro" },
  { nome: "final com cta", card: FINAL, total: 4 },
  { nome: "anúncio 9:16", card: CAPA, total: 1, anuncio: { formato: "stories_9x16" } },
  { nome: "post 1:1", card: MEIO, total: 3, post: "quadrado_1x1" },
];
const baseNormal = (c: (typeof CASOS_NORMAIS)[number]) =>
  promptDaLamina({ ...c.card, layout: layoutPadrao(c.card.funcao, c.card.ordem, c.total) } as never, MARCA_CASO, {
    total: c.total,
    carrosselInfinito: false,
    levaLogo: true,
    conceito: "Conceito sintético",
    fioVisual: c.fio ?? null,
    anuncio: c.anuncio ?? null,
    post: c.post,
  } as never);

// ------------------------------------------------------------------ 1. Nenhum = hoje

describe("1. Template Nenhum: prompt e entradas byte a byte os de hoje", () => {
  it("sem template (ausente, null, texto, id inválido) devolve vazio, não lê o banco e não toca nas listas", async () => {
    for (const direcao of [{}, null, { cards: [] }, { template_de_design: null }, { template_de_design: "abc" }, { template_de_design: { id: "nao-uuid" } }, { usar_estilo_do_cliente: true }]) {
      const { db, chamadas } = bancoFalso({ linhas: [linhaDoTemplate()] });
      const imagens = [{ bytes: new Uint8Array([9]), mime: "image/png", nome: "lamina" }];
      const rotulos = ["da lâmina"];
      const antes = JSON.stringify({ imagens: imagens.map((i) => i.nome), rotulos });
      const baixar = baixarFalso();
      const bloco = await templateNaLamina({ client_id: CLIENTE, direcao }, { ordem: 1, total: 4, imagens, rotulos, deslocamento: 0 }, { db: db as never, baixar });
      expect(bloco).toBe("");
      expect(chamadas.from + chamadas.storage).toBe(0);
      expect(baixar).not.toHaveBeenCalled();
      expect(JSON.stringify({ imagens: imagens.map((i) => i.nome), rotulos })).toBe(antes);
      expect(templateEscolhidoNoTrabalho(direcao)).toBeNull();
    }
  });

  it("modo normal: cada caso do fixture sai igual com template Nenhum (e estilo desligado)", () => {
    expect(HOJE_NORMAL.normal.length).toBe(CASOS_NORMAIS.length);
    CASOS_NORMAIS.forEach((c, i) => {
      const base = baseNormal(c);
      expect(base, c.nome).toBe(HOJE_NORMAL.normal[i].prompt);
      expect(compoeNormal(base, "", ""), c.nome).toBe(`${HOJE_NORMAL.normal[i].prompt}\n\n${REGRAS}`);
    });
  });

  it("modo replicar: cada caso do fixture sai igual com template Nenhum", () => {
    for (const c of HOJE_REPLICAR.replicar) expect(compoeReplicar(c.prompt, "", ""), c.nome).toBe(`${c.prompt}\n\n${REGRAS}`);
  });

  it("template arquivado, vazio, de outro cliente ou banco quebrado: vazio e listas intactas", async () => {
    const casos = [
      bancoFalso({ linhas: [linhaDoTemplate({ status: "arquivado" })] }).db,
      bancoFalso({ linhas: [linhaDoTemplate({ corpo: normalizarCorpo({}) })] }).db,
      bancoFalso({ linhas: [linhaDoTemplate({ client: OUTRO })] }).db,
      { from: () => { throw new Error("fora"); }, storage: { from: () => ({}) } },
    ];
    for (const db of casos) {
      const imagens: any[] = [];
      const rotulos: string[] = [];
      expect(await templateNaLamina({ client_id: CLIENTE, direcao: { template_de_design: { id: TPL } } }, { ordem: 1, total: 4, imagens, rotulos, deslocamento: 0 }, { db: db as never, baixar: baixarFalso() })).toBe("");
      expect(imagens.length + rotulos.length).toBe(0);
    }
  });

  it("o gancho no gerarCard, quando plugado, fica logo depois do estilo e antes das legendas", () => {
    const servidor = ler("supabase/functions/estudio-arte/index.ts");
    const hook = ler("supabase/functions/estudio-arte/estilo-na-geracao.ts");
    expect(hook).toContain("const blocoDoTemplate = await templateNaLamina(t, { ordem, total, imagens, rotulos, deslocamento }");
    if (servidor.indexOf("templateNaLamina(") >= 0) {
      const i = servidor.indexOf("const blocoDoTemplate = await templateNaLamina(");
      expect(i).toBeGreaterThan(servidor.indexOf("const blocoDoEstilo = estiloDoCliente ?"));
      expect(i).toBeLessThan(servidor.indexOf("const legendas = rotulos.map("));
      expect((servidor.match(/^\s+blocoDoTemplate,$/gm) || []).length).toBe(2);
    }
    // O modelo de imagem não muda.
    expect(hook).not.toMatch(/modelo_imagem_id|modeloId|carregarModelo/);
  });
});

// ------------------------------------------------------------------ 2. escolhido

describe("2. Template escolhido: bloco depois do estilo e prioridade das imagens", () => {
  it("o bloco entra depois do estilo e antes das regras de render; o que vinha antes fica igual", () => {
    const tpl = blocoDoTemplateParaOGerador("Carrossel editorial", CORPO, { ordem: 1, total: 4, indicesDasAncoras: [5] });
    const estilo = "ESTILO DO CLIENTE (sintético)";
    CASOS_NORMAIS.forEach((c, i) => {
      const com = compoeNormal(baseNormal(c), estilo, tpl);
      expect(com.startsWith(`${HOJE_NORMAL.normal[i].prompt}\n\n`)).toBe(true);
      expect(com.endsWith(`${estilo}\n\n${tpl}\n\n${REGRAS}`)).toBe(true);
    });
    for (const c of HOJE_REPLICAR.replicar) {
      const com = compoeReplicar(c.prompt, "", tpl);
      expect(com).toBe(`${c.prompt}\n\n${tpl}\n\n${REGRAS}`);
    }
  });

  it("o papel da lâmina escolhe a parte do template; o bloco é curto e sem travessão", () => {
    const capa = blocoDoTemplateParaOGerador("T", CORPO, { ordem: 1, total: 4 });
    const miolo = blocoDoTemplateParaOGerador("T", CORPO, { ordem: 2, total: 4 });
    const fim = blocoDoTemplateParaOGerador("T", CORPO, { ordem: 4, total: 4 });
    expect(capa).toContain("PAPEL DESTA LÂMINA: capa (lâmina 1 de 4); gancho");
    expect(capa).toContain("- CAPA: Promessa concreta");
    expect(capa).not.toContain("- MIOLO:");
    expect(miolo).toContain("miolo (lâmina 2 de 4); dado");
    expect(miolo).toContain("- MIOLO:");
    expect(miolo).not.toContain("- CAPA:");
    expect(fim).toContain("fechamento (lâmina 4 de 4)");
    expect(fim).toContain("- CTA E FECHAMENTO: Um CTA só");
    for (const b of [capa, miolo, fim]) {
      expect(b.startsWith('TEMPLATE "T" (molde escolhido pela equipe')).toBe(true);
      expect(b).toContain("- MARCA TRAVADA:");
      expect(b.length).toBeLessThanOrEqual(TETO_DO_BLOCO_DO_TEMPLATE);
      expect(b).not.toMatch(/[\u2014\u2013]/);
    }
    expect(blocoDoTemplateParaOGerador("T", normalizarCorpo({}), { ordem: 1, total: 1 })).toBe("");
  });

  it("template enorme continua no teto e guarda a trava da marca", () => {
    const longo = "x".repeat(215);
    const regras: any = {};
    for (const d of ["layout", "tipografia", "cor", "tratamento", "elementos", "capa", "miolo", "cta", "evitar"]) regras[d] = [longo, longo, longo, longo, longo, longo];
    const b = blocoDoTemplateParaOGerador("T", normalizarCorpo({ ...CORPO, resumo: "r".repeat(500), regras }, "carrossel"), { ordem: 2, total: 4, indicesDasAncoras: [6, 7] });
    expect(b.length).toBeLessThanOrEqual(TETO_DO_BLOCO_DO_TEMPLATE);
    expect(b).toContain("- LOGO: só a do cliente");
  });

  it("prioridade: as imagens do template vêm depois das da lâmina e do estilo, as do papel da lâmina primeiro, até 2", async () => {
    const { db } = bancoFalso({ linhas: [linhaDoTemplate({ corpo: normalizarCorpo({ ...CORPO, continuidade: null }, "post") })] });
    const imagens: any[] = [{ nome: "lamina-1" }, { nome: "estilo-1" }];
    const rotulos = ["lâmina", "estilo"];
    const baixar = baixarFalso();
    const bloco = await templateNaLamina({ client_id: CLIENTE, direcao: { template_de_design: { id: TPL } } }, { ordem: 1, total: 1, imagens, rotulos, deslocamento: 1 }, { db: db as never, baixar });
    expect(imagens.slice(0, 2).map((i) => i.nome)).toEqual(["lamina-1", "estilo-1"]);
    expect(imagens.slice(2).map((i) => i.nome.split("|")[1])).toEqual([`${CLIENTE}/a1.jpg`, `${CLIENTE}/a2.jpg`]);
    expect(rotulos.slice(2).every((r) => r.indexOf("âncora do TEMPLATE") === 0)).toBe(true);
    expect(bloco).toContain("Imagens 4 e 5: âncora do template");
  });

  it("limite do modelo: sem vaga, nenhuma âncora; com 1 vaga, só a do papel", async () => {
    const { db } = bancoFalso({ linhas: [linhaDoTemplate({ corpo: normalizarCorpo({ ...CORPO, continuidade: null }, "post") })] });
    const cheio: any[] = Array.from({ length: 8 }, (_, i) => ({ nome: `x${i}` }));
    await templateNaLamina({ client_id: CLIENTE, direcao: { template_de_design: { id: TPL } } }, { ordem: 1, total: 1, imagens: cheio, rotulos: [], deslocamento: 0 }, { db: db as never, baixar: baixarFalso() });
    expect(cheio.length).toBe(8);
    const tres: any[] = [{ nome: "a" }, { nome: "b" }, { nome: "c" }];
    await templateNaLamina(
      { client_id: CLIENTE, direcao: { template_de_design: { id: TPL } } },
      { ordem: 1, total: 1, imagens: tres, rotulos: [], deslocamento: 0 },
      { db: db as never, baixar: baixarFalso(), modelo: { provedor: "openrouter", modelo_api: "x/y", capacidades: { refs_max: 4 } } },
    );
    expect(tres.length).toBe(4);
    expect(tres[3].nome).toContain("a1.jpg");
    expect(limiteDeAnexosDoTemplate(null)).toBe(8);
    expect(limiteDeAnexosDoTemplate({ provedor: "openrouter", modelo_api: "x/y", capacidades: { refs_max: 3 } })).toBe(3);
  });

  it("carrossel com elemento que cruza a borda: a faixa da lâmina anterior vem antes das âncoras", async () => {
    const { db } = bancoFalso({ linhas: [linhaDoTemplate()] });
    const imagens: any[] = [{ nome: "lamina" }];
    const rotulos = ["lâmina"];
    const recortar = vi.fn(async (_b: Uint8Array, f: (l: number, a: number) => any) => {
      expect(f(1088, 1360)).toEqual({ x: 957, y: 0, largura: 131, altura: 1360 });
      return new Uint8Array([7]);
    });
    const t = { client_id: CLIENTE, direcao: { template_de_design: { id: TPL } }, cards: [{ ordem: 1, versao: 1, storage_path: "v1.png" }, { ordem: 1, versao: 3, storage_path: "v3.png" }] };
    const baixar = baixarFalso();
    const bloco = await templateNaLamina(t, { ordem: 2, total: 4, imagens, rotulos, deslocamento: 0 }, { db: db as never, baixar, recortar });
    expect(baixar.mock.calls[0][1]).toBe("v3.png");
    expect(imagens[1].nome).toBe("borda-1.png");
    expect(rotulos[1]).toContain("faixa da borda direita da lâmina anterior");
    expect(bloco).toContain("Imagem 2: faixa da BORDA DIREITA da lâmina anterior. fita cor do kit chega");
    expect(bloco).toContain("Saída pela borda direita (entre 60% e 70% da altura)");
    // Com o carrossel contínuo ligado, o panorama resolve: sem faixa.
    const outras: any[] = [];
    const b2 = await templateNaLamina(t, { ordem: 2, total: 4, imagens: outras, rotulos: [], deslocamento: 0 }, { db: db as never, baixar: baixarFalso(), recortar, panorama: true });
    expect(outras.some((i) => i.nome === "borda-1.png")).toBe(false);
    expect(b2).toContain("fatia da cena contínua");
  });

  it("referência de carrossel: a lâmina mapeada vem primeiro, com o nível e as partes", async () => {
    const laminas = [1, 2, 3].map((n) => ({ id: L(n), bucket: "mesa", caminho: `ref/${n}.jpg`, nome: `l${n}`, partes: { titulo: `título ${n} em Montserrat Black`, cta: n === 3 ? "botão laranja" : "" } }));
    const corpo = normalizarCorpo({ formato: "carrossel", laminas_referencia: laminas }, "carrossel");
    const { db } = bancoFalso({ linhas: [linhaDoTemplate({ tipo: "referencia_carrossel", corpo })] });
    const imagens: any[] = [];
    const rotulos: string[] = [];
    const bloco = await templateNaLamina(
      { client_id: CLIENTE, direcao: { template_de_design: { id: TPL, fidelidade: "proxima" } } },
      { ordem: 5, total: 5, imagens, rotulos, deslocamento: 1 },
      { db: db as never, baixar: baixarFalso(), marca: MARCA_CASO },
    );
    expect(imagens[0].nome).toContain("ref/3.jpg");
    expect(bloco).toContain("segue a lâmina 3 de 3 da referência (fechamento)");
    expect(bloco).toContain("Imagem 2: essa lâmina da referência.");
    expect(bloco).toContain("Nível Próxima:");
    expect(bloco).not.toContain("Montserrat");
    expect(bloco).not.toContain("laranja");
    expect(bloco).toContain("Fonte Título (titulo)");
  });
});

// ------------------------------------------------------------------ 3. continuidade

describe("3. Continuidade do carrossel", () => {
  it("leitura normalizada: renumera, papéis pela posição, a última não corta, tipos só os conhecidos", () => {
    const c = normalizarContinuidade({
      total: 3,
      laminas: [
        { ordem: 9, papel: "fechamento", funcao: "gancho — forte", corte_direita: "seta", corte_y0: 80, corte_y1: 40 },
        { ordem: 10, papel: "capa", funcao: "meio", corte_direita: "" },
        { ordem: 11, papel: "miolo", funcao: "fim", corte_direita: "fita", corte_y0: 1, corte_y1: 2 },
      ],
      tipos: ["numeracao", "inventado", "numeracao"],
    })!;
    expect(c.laminas.map((l) => [l.ordem, l.papel])).toEqual([[1, "capa"], [2, "miolo"], [3, "fechamento"]]);
    expect(c.laminas[0].funcao).toBe("gancho , forte");
    expect(c.laminas[0]).toMatchObject({ corte_direita: "seta", corte_y0: 40, corte_y1: 80 });
    expect(c.laminas[2]).toMatchObject({ corte_direita: "", corte_y0: null });
    expect(c.tipos).toEqual(["numeracao", "elemento_na_borda"]);
    expect(normalizarContinuidade({ laminas: [{}] })).toBeNull();
    expect(normalizarContinuidade(null)).toBeNull();
  });

  it("faixa da borda e fatias do panorama: determinísticas, inteiras, sem sobra", () => {
    expect(faixaDaBorda(1088, 1360)).toEqual(faixaDaBorda(1088.9, 1360.2));
    expect(faixaDaBorda(1088, 1360)).toEqual({ x: 957, y: 0, largura: 131, altura: 1360 });
    expect(faixaDaBorda(1, 10)).toBeNull();
    const f = fatiasDoPanorama(3264, 1360, 3);
    expect(f.map((x) => x.x)).toEqual([0, 1088, 2176]);
    expect(f.reduce((s, x) => s + x.largura, 0)).toBe(3264);
    const g = fatiasDoPanorama(1000, 10, 3);
    expect(g.map((x) => x.largura)).toEqual([333, 333, 334]);
    expect(fatiasDoPanorama(2, 10, 3)).toEqual([]);
  });

  it("estratégia: panorama com o contínuo ligado, faixa sem ele, só texto sem corte", () => {
    const c = normalizarContinuidade(CORPO.continuidade)!;
    expect(estrategiaDaContinuidade(c, { ordem: 2, total: 4, panoramaLigado: true })).toBe("panorama_fatiado");
    expect(estrategiaDaContinuidade(c, { ordem: 2, total: 4, panoramaLigado: false })).toBe("faixa_da_borda");
    expect(estrategiaDaContinuidade(c, { ordem: 1, total: 4, panoramaLigado: false })).toBe("so_texto");
    expect(estrategiaDaContinuidade(c, { ordem: 4, total: 4, panoramaLigado: false })).toBe("so_texto");
    expect(estrategiaDaContinuidade(null, { ordem: 2, total: 4, panoramaLigado: false })).toBe("nenhuma");
    expect(linhasDaContinuidade(c, { ordem: 3, total: 4, estrategia: "faixa_da_borda", indiceDaFaixa: null }).join("\n")).not.toContain("Imagem");
    expect(laminaParaAOrdem(c, 6, 7)!.funcao).toBe("dado");
    expect(laminaParaAOrdem(c, 5, 7)!.funcao).toBe("exemplo");
    expect(papelPelaOrdem(1, 1)).toBe("capa");
  });
});

// ------------------------------------------------------------------ 4. referência de carrossel

describe("4. Referência de carrossel: mapa das lâminas e ordem guardada", () => {
  it("mesmo tamanho: 1 com 1", () => {
    expect(mapaDasLaminas(5, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("gerado maior: capa, miolos pela ordem repetindo o molde, fechamento", () => {
    expect(mapaDasLaminas(5, 7)).toEqual([1, 2, 3, 4, 2, 3, 5]);
    expect(mapaDasLaminas(3, 6)).toEqual([1, 2, 2, 2, 2, 3]);
    expect(mapaDasLaminas(2, 4)).toEqual([1, 1, 1, 2]);
    expect(mapaDasLaminas(1, 3)).toEqual([1, 1, 1]);
  });
  it("gerado menor: capa, os primeiros miolos, fechamento", () => {
    expect(mapaDasLaminas(6, 3)).toEqual([1, 2, 6]);
    expect(mapaDasLaminas(6, 2)).toEqual([1, 6]);
    expect(mapaDasLaminas(6, 1)).toEqual([1]);
    expect(mapaDasLaminas(0, 3)).toEqual([]);
  });
  it("reordenar guarda a ordem nova como versão; ordem incompleta ou repetida é recusada", async () => {
    const laminas = normalizarLaminasDeReferencia([1, 2, 3].map((n) => ({ id: L(n), bucket: "mesa", caminho: `r/${n}.jpg`, nome: `l${n}` })));
    expect(laminas.map((l) => l.papel)).toEqual(["capa", "miolo", "fechamento"]);
    const nova = reordenarLaminas(laminas, [L(3), L(1), L(2)])!;
    expect(nova.map((l) => l.nome)).toEqual(["l3", "l1", "l2"]);
    expect(nova.map((l) => l.papel)).toEqual(["capa", "miolo", "fechamento"]);
    expect(reordenarLaminas(laminas, [L(1), L(1), L(2)])).toBeNull();
    expect(reordenarLaminas(laminas, [L(1), L(2)])).toBeNull();
    const corpo = normalizarCorpo({ formato: "carrossel", laminas_referencia: laminas }, "carrossel");
    const { db } = bancoFalso({ linhas: [linhaDoTemplate({ tipo: "referencia_carrossel", corpo })] });
    const gravado = await mudarTemplate(db as never, CLIENTE, TPL, (t) => comNovaVersaoDoTemplate(t!, { ...corpoAtual(t)!, laminas_referencia: nova }, "equipe", "Lâminas reordenadas.", null, "2026-09-26T11:00:00.000Z"), null);
    expect(gravado.versao_atual).toBe(2);
    const relido = (await lerTemplate(db as never, CLIENTE, TPL))!;
    expect(corpoAtual(relido)!.laminas_referencia.map((l) => l.nome)).toEqual(["l3", "l1", "l2"]);
    expect(relido.versoes[0].corpo.laminas_referencia.map((l) => l.nome)).toEqual(["l1", "l2", "l3"]);
    expect(mover(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });
  it("partes lidas por posição, sem fonte nem cor da referência", () => {
    const p = partesLidas({ laminas: [{ imagem_n: 2, titulo: "título em Poppins azul #0033FF", apoio: "", imagem: "foto", elementos: "", cta: "", continuidade: "" }, { imagem_n: 9, titulo: "x" }] }, 2);
    expect(p[0]).toEqual({});
    expect(p[1].titulo).toBe("título em fonte do kit cor do kit cor do kit");
  });
});

// ------------------------------------------------------------------ 5. trava da marca

describe("5. Trava da marca: a letra, as cores e o logo são sempre os do cliente", () => {
  const kit = { fontes: [{ nome: "Outfit", papel: "titulo" }, { nome: "Inter", papel: "texto" }], paleta: [{ hex: "#00A600", papel: "dominante" }, { hex: "#FF7A00", papel: "destaque" }] };
  it("referência com fonte X e cor Y: o texto final só tem as do cliente", () => {
    const n = neutralizarMarcaDaReferencia('Título em Montserrat Black, fonte "Neue Machina", cor #E11D48 e fundo vermelho escuro, texto branco; rgb(1,2,3). Outfit fica. #00A600 fica.', kit);
    expect(n).not.toMatch(/Montserrat|Neue Machina|#E11D48|vermelho|rgb\(/i);
    expect(n).toContain("fonte do kit Black");
    expect(n).toContain("Outfit fica");
    expect(n).toContain("#00A600 fica");
    expect(n).toContain("neutro claro");
  });
  it("no bloco do template e da referência de carrossel: só o kit", () => {
    const corpo = normalizarCorpo({ ...CORPO, regras: { ...CORPO.regras, tipografia: ["Título em Bebas Neue, apoio em Helvetica"], cor: ["Fundo azul marinho, destaque amarelo"] } }, "carrossel");
    const b = blocoDoTemplateParaOGerador("Ref", corpo, { ordem: 1, total: 4, kit });
    expect(b).not.toMatch(/Bebas|Helvetica|azul|amarelo/i);
    expect(b).toContain("LETRA: Outfit (titulo), Inter (texto)");
    expect(b).toContain("COR: #00A600 dominante, #FF7A00 destaque");
    const r = blocoDaReferenciaDeCarrossel("Ref Poppins", normalizarLaminasDeReferencia([{ id: L(1), bucket: "m", caminho: "c.jpg", partes: { titulo: "Poppins bold rosa" } }]), { ordem: 1, total: 3, fidelidade: "identica", indice: 3, kit });
    expect(r).not.toMatch(/Poppins|rosa/i);
    expect(r).toContain("Nível Idêntica: quase idêntica");
    expect(blocoDaMarcaTravada(null)).toContain("a do kit do cliente");
  });
  it("o estilo do cliente perde só fonte e hex (as cores dele ficam pela função); guia limpo sai igual", () => {
    const g = { resumo: "Montserrat no título, #123456 no fundo", regras: { ...regrasVazias(), cor: ["Verde domina"] }, referencias: [] };
    const t = guiaComMarcaTravada(g);
    expect(t.resumo).toBe("fonte do kit no título, cor do kit no fundo");
    expect(t.regras.cor).toEqual(["Verde domina"]);
    const limpo = { resumo: "Editorial claro.", regras: { ...regrasVazias(), layout: ["Título em cima"] }, referencias: [] };
    expect(guiaComMarcaTravada(limpo)).toEqual(limpo);
  });
  it("hex escrito no template vira função na hora de guardar", () => {
    expect(normalizarCorpo({ regras: { cor: ["Fundo #112233 sempre"] } }).regras.cor).toEqual(["Fundo cor do kit sempre"]);
  });
});

// ------------------------------------------------------------------ 6. ações e combinação

describe("6. Ações dos templates e combinação", () => {
  const t1 = { ...linhaDoTemplate(), guardado_em: "tabela" as const };
  const t2 = { ...linhaDoTemplate({ id: TPL2, tipo: "referencia_carrossel", nome: "Ref de carrossel" }), guardado_em: "tabela" as const };
  const candidatas = [{ id: REF, titulo: "arte da marca", detalhe: null, ref: "r1", dados: { origem: "referencia", bucket: "mesa", caminho: "x.jpg" } }];
  const alvos = alvosDosTemplates([t1 as never, t2 as never], candidatas, 3);
  const proposta = { nome: "Novo", resumo: "Claro.", regras: { ...regrasVazias(), layout: ["Título em cima"] }, areas: {}, continuidade: null, de_onde: [] };

  it("apelidos n1, t1..tN, m1 e r1; o modelo nunca vê id", () => {
    expect(alvos.todos.map((a) => a.ref)).toEqual(["n1", "t1", "t2", "m1", "r1"]);
    const bloco = blocoDosAlvosDosTemplates(alvos, [t1 as never, t2 as never]);
    expect(bloco).not.toContain(TPL);
    expect(bloco).toContain("t2 | Ref de carrossel | referência de carrossel");
    expect(alvosDosTemplates([], [], 1).carrossel).toEqual([]);
  });

  it("normaliza: criar pede proposta, âncora vira id no contexto, referência não recebe proposta, apelido inventado é ignorado", () => {
    const bruto = {
      resumo: "Vou criar e ancorar.",
      itens: [
        { operacao: "criar_template", ref: "n1", para: "Carrossel claro" },
        { operacao: "ancora_no_template", ref: "r1", para: "t1:capa" },
        { operacao: "atualizar_template", ref: "t2", para: "muda" },
        { operacao: "arquivar_template", ref: "t9", para: "" },
        { operacao: "registrar_gosto_template", ref: "t1", para: "dono gostou: capa forte | cliente não gostou: letra fina" },
        { operacao: "guardar_referencia_carrossel", ref: "m1", para: "Sequência da cafeteria" },
        { operacao: "gerar_teste_template", ref: "t1", para: "2: outubro" },
      ],
    };
    const a = normalizarAcoesDosTemplates(bruto, alvos, {
      proposta,
      formato: "carrossel",
      clientId: CLIENTE,
      marcaId: null,
      custoPorImagem: 0.05,
      carrossel: [{ bucket: "mesa", caminho: "1.jpg", nome: "1" }, { bucket: "mesa", caminho: "2.jpg", nome: "2" }],
      candidatas: { [REF]: { bucket: "mesa", caminho: "x.jpg", nome: "arte", origem: "referencia" } },
    })!;
    expect(a.itens.map((i) => i.operacao)).toEqual(["guardar_referencia_carrossel", "criar_template", "ancora_no_template", "registrar_gosto_template", "gerar_teste_template"]);
    expect(a.ignorados).toEqual(["t9"]);
    expect(a.recusados.map((r) => r.ref)).toEqual(["t2"]);
    expect((a.contexto as any).destinos).toEqual({ t1: TPL });
    expect((a.contexto as any).proposta_de_template.nome).toBe("Novo");
    expect((a.contexto as any).carrossel.length).toBe(2);
    expect(a.itens.find((i) => i.operacao === "ancora_no_template")!.para_rotulo).toBe("Carrossel editorial (capa)");
    expect(a.custo_estimado_usd).toBe(0.1);
    expect(a.agente).toBe("estilo");
    const semProposta = normalizarAcoesDosTemplates({ itens: [{ operacao: "criar_template", ref: "n1", para: "x" }] }, alvos, { proposta: null, formato: "post", clientId: CLIENTE, marcaId: null, custoPorImagem: 0 });
    expect(semProposta).toBeNull();
    expect(lerDestinoDaAncora("T2 : miolo")).toEqual({ ref: "t2", papel: "miolo" });
    expect(lerGosto("dono não gostou: fundo")).toEqual({ quem: "dono", tipo: "nao_gostou", texto: "fundo" });
  });

  it("separa as ações do estilo das dos templates e o esquema ganha os campos sem perder os do estilo", () => {
    const s = separarAcoes({ resumo: "r", itens: [{ operacao: "gravar_estilo", ref: "e1", para: "" }, { operacao: "criar_template", ref: "n1", para: "" }] }) as any;
    expect(s.doEstilo.itens.map((i: any) => i.operacao)).toEqual(["gravar_estilo"]);
    expect(s.dosTemplates.itens.map((i: any) => i.operacao)).toEqual(["criar_template"]);
    expect(separarAcoes(null)).toEqual({ doEstilo: null, dosTemplates: null });
    const e = esquemaComTemplates(ESQUEMA_DO_AGENTE_DE_ESTILO as never) as any;
    expect(e.schema.required).toEqual([...ESQUEMA_DO_AGENTE_DE_ESTILO.schema.required, "formato_da_proposta", "proposta_de_template", "pedido_de_combinacao"]);
    expect(e.schema.properties.acoes.properties.itens.items.properties.operacao.enum).toContain("gravar_estilo");
    expect(e.schema.properties.acoes.properties.itens.items.properties.operacao.enum).toContain("criar_template");
  });

  const fontes: FonteDaCombinacao[] = [
    { apelido: "t1", nome: "Carrossel editorial", tipo: "template", corpo: CORPO, gostos: ["cliente gostou: capa"] },
    { apelido: "r1", nome: "referência nova", tipo: "referencia", leitura: "Título enorme em caixa alta à esquerda, foto recortada, fita diagonal." },
  ];
  const ctx = { cliente: "Cliente sintético", objetivo: "carrossel de dicas" };

  it("combinação: um Choice por dimensão com a opção combinar, e a coerência depois (Jev simulado)", async () => {
    const pedidos: any[] = [];
    const perguntar = vi.fn(async (p: any) => {
      pedidos.push(p);
      if (p.questions.coerencia) return { answers: { coerencia: { score: 2.4 } } };
      const answers: Record<string, any> = {};
      for (const k of Object.keys(p.questions)) answers[k] = { choice: k === "dim_tipografia" ? "r1" : k === "dim_elementos" ? "combinar" : "t1", confidence: k === "dim_cor" ? 0.2 : 0.9 };
      return { answers };
    });
    const r = await escolherMelhoresPontos(fontes, ctx, perguntar);
    expect(perguntar).toHaveBeenCalledTimes(2);
    const q = pedidos[0].questions;
    expect(Object.keys(q)).toEqual(["dim_layout", "dim_tipografia", "dim_cor", "dim_tratamento", "dim_elementos", "dim_capa", "dim_cta"]);
    expect(Object.keys(q.dim_layout.criteria)).toEqual(["t1", "r1", "combinar"]);
    expect(q.dim_layout.type).toBe("choice");
    expect(JSON.stringify(pedidos[0].state)).not.toContain(TPL);
    expect(pedidos[1].questions.coerencia.criteria.length).toBe(4);
    if (r.modo === "pedir_ao_dono") throw new Error("devia combinar");
    expect(r.modo).toBe("jev");
    expect(r.escolhas.tipografia!.fonte).toBe("r1");
    expect(r.escolhas.elementos!.fonte).toBe("combinar");
    expect(r.escolhas.cor!.duvida).toBe(true);
    expect(r.coerencia).toBeCloseTo(0.8, 5);
    expect(r.variacoes).toBe(1);
  });

  it("coerência baixa: 2 variações de uma vez (sem laço); coerência falhando: segue com 1", async () => {
    const escolhe = (p: any) => Object.fromEntries(Object.keys(p.questions).map((k) => [k, { choice: "t1", confidence: 0.8 }]));
    const baixa = await escolherMelhoresPontos(fontes, ctx, async (p: any) => (p.questions.coerencia ? { answers: { coerencia: { score: 0.5 } } } : { answers: escolhe(p) }));
    expect(baixa.modo === "jev" && baixa.variacoes).toBe(2);
    const semCoerencia = await escolherMelhoresPontos(fontes, ctx, async (p: any) => {
      if (p.questions.coerencia) throw new Error("fora");
      return { answers: escolhe(p) };
    });
    expect(semCoerencia.modo === "jev" && semCoerencia.coerencia).toBeNull();
    expect(semCoerencia.modo === "jev" && semCoerencia.variacoes).toBe(1);
  });

  it("falha do Jev: nenhuma combinação automática, pede a escolha ao dono (e a escolha do dono vale)", async () => {
    const falha = await escolherMelhoresPontos(fontes, ctx, async () => {
      throw new Error("typesafe_529");
    });
    expect(falha.modo).toBe("pedir_ao_dono");
    const foraDasOpcoes = await escolherMelhoresPontos(fontes, ctx, async (p: any) => ({ answers: Object.fromEntries(Object.keys(p.questions).map((k) => [k, { choice: "t7" }])) }));
    expect(foraDasOpcoes.modo).toBe("pedir_ao_dono");
    expect((await escolherMelhoresPontos(fontes.slice(0, 1), ctx, vi.fn())).modo).toBe("pedir_ao_dono");
    const dono = escolhasDoDono({ layout: "r1", cor: "COMBINAR", tipografia: "t9" }, fontes)!;
    expect(dono.modo).toBe("dono");
    if (dono.modo === "pedir_ao_dono") throw new Error("x");
    expect(dono.escolhas.layout!.fonte).toBe("r1");
    expect(dono.escolhas.cor!.fonte).toBe("combinar");
    expect(dono.escolhas.tipografia).toBeUndefined();
  });

  it("dimensão que só uma fonte descreve não vai ao Jev", () => {
    const soUma: FonteDaCombinacao[] = [
      { apelido: "t1", nome: "A", tipo: "template", corpo: normalizarCorpo({ regras: { layout: ["x"], cor: ["y"] } }) },
      { apelido: "t2", nome: "B", tipo: "template", corpo: normalizarCorpo({ regras: { layout: ["z"] } }) },
    ];
    const { perguntas, unicas } = perguntasDaCombinacao(soUma);
    expect(Object.keys(perguntas)).toEqual(["dim_layout"]);
    expect(unicas).toEqual({ cor: "t1" });
  });

  it("proposta combinada: de onde só com fontes conhecidas; cartão com uma variação por item", () => {
    const p = normalizarProposta({ ...proposta, de_onde: [{ dimensao: "layout", fonte: "t1", frase: "grade da capa" }, { dimensao: "cor", fonte: "x9", frase: "inventada" }, { dimensao: "elementos", fonte: "combinar", frase: "fita e fio" }] }, "carrossel", fontes)!;
    expect(p.de_onde.map((x) => [x.fonte, x.nome])).toEqual([["t1", "Carrossel editorial"], ["combinar", "combinação"]]);
    const a = acaoDaCombinacao([p, p], { clientId: CLIENTE, marcaId: null, fontes: [TPL], escopo: "cliente", coerencia: 0.3 })!;
    expect(a.itens.map((i) => [i.ref, i.operacao])).toEqual([["n1", "criar_template"], ["n2", "criar_template"]]);
    expect(Object.keys((a.contexto as any).propostas)).toEqual(["variacao-1", "variacao-2"]);
    expect(acaoDaCombinacao([], { clientId: CLIENTE, marcaId: null, fontes: [], escopo: "cliente", coerencia: null })).toBeNull();
  });
});

// ------------------------------------------------------------------ 7. guardar

describe("7. Guardar: tabela, arquivo sem tabela e o template de outro cliente", () => {
  it("sem tabela: o JSON no bucket do cliente e o da agência, lidos juntos", async () => {
    const semTabela = bancoFalso({ semTabela: true });
    await mudarTemplate(semTabela.db as never, CLIENTE, TPL, () => templateNovo({ id: TPL, escopo: "cliente", clientId: CLIENTE, marcaId: null, nome: "Do cliente", origem: "equipe", corpo: CORPO, nota: "", por: null, agora: "x" }), null);
    await mudarTemplate(semTabela.db as never, CLIENTE, TPL2, () => templateNovo({ id: TPL2, escopo: "agencia", clientId: null, marcaId: null, nome: "Da agência", origem: "equipe", corpo: CORPO, nota: "", por: null, agora: "x" }), null);
    expect(Object.keys(semTabela.arquivos).sort()).toEqual([`${CLIENTE}/estilo/templates.json`, "_agencia/estilo/templates.json"].sort());
    const r = await lerTemplates(semTabela.db as never, CLIENTE, null);
    expect(r.guardado_em).toBe("arquivo");
    expect(r.templates.map((t) => t.nome).sort()).toEqual(["Da agência", "Do cliente"]);
    // Outro cliente vê o da agência, não o do cliente.
    expect((await lerTemplates(semTabela.db as never, OUTRO, null)).templates.map((t) => t.nome)).toEqual(["Da agência"]);
    expect(await lerTemplate(semTabela.db as never, OUTRO, TPL)).toBeNull();
  });

  it("com tabela: arquivado some da lista (volta com arquivados) e o de outro cliente não aparece", async () => {
    const { db } = bancoFalso({ linhas: [linhaDoTemplate(), linhaDoTemplate({ id: TPL2, status: "arquivado", nome: "Velho" })] });
    expect((await lerTemplates(db as never, CLIENTE, null)).templates.map((t) => t.nome)).toEqual(["Carrossel editorial"]);
    expect((await lerTemplates(db as never, CLIENTE, null, { incluirArquivados: true })).templates.length).toBe(2);
    expect(await lerTemplate(db as never, OUTRO, TPL)).toBeNull();
  });
});

// ------------------------------------------------------------------ 8. tela

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

const TEMPLATE_NA_TELA = { id: TPL, tipo: "template", escopo: "cliente", nome: "Carrossel editorial", formato: "carrossel", status: "ativo", origem: "agente", versao_atual: 1, corpo: CORPO, versoes: [], gostos: [], testes: [], ancoras: [], laminas: [] };

describe("8. Tela: aba Templates e o seletor Template", () => {
  let comTemplates = true;
  beforeEach(() => {
    comTemplates = true;
    try {
      window.localStorage.clear();
    } catch {
      /* sem armazenamento */
    }
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (_fn: string, { body }: { body: any }) => {
      if (body.acao === "estado" && body.leve) return { data: { client_id: CLIENTE, ativo: false, versao_atual: 0 }, error: null };
      if (body.acao === "estado") return { data: { client_id: CLIENTE, guia: null, versoes: [], referencias: [], aprendizados: [], testes: [], mensagens: [] }, error: null };
      if (body.acao === "templates_estado") return { data: { guardado_em: "tabela", templates: comTemplates ? [TEMPLATE_NA_TELA] : [] }, error: null };
      if (body.acao === "template_no_trabalho_ler") return { data: { escolhas: {} }, error: null };
      if (body.acao === "template_no_trabalho") return { data: { template_id: body.template_id, feitos: 1, falhas: [] }, error: null };
      if (body.acao === "interruptor_ler") return { data: { ligados: [] }, error: null };
      return { data: {}, error: null };
    });
  });

  it("seletor Template: Nenhum por padrão; escolher grava só no trabalho", async () => {
    montar(h(BotaoDoEstilo, { trabalhoIds: ["88888888-8888-8888-8888-888888888888"] }));
    const botaoDoSeletor = await screen.findByRole("button", { name: "Template: Nenhum" }, { timeout: 8000 });
    fireEvent.click(botaoDoSeletor);
    fireEvent.click(await screen.findByRole("option", { name: /Carrossel editorial/ }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("agente-estilo", { body: expect.objectContaining({ acao: "template_no_trabalho", template_id: TPL, trabalho_ids: ["88888888-8888-8888-8888-888888888888"], client_id: CLIENTE }) }),
    );
  }, 20_000);

  it("sem templates no cliente, o seletor não aparece (a barra fica como estava)", async () => {
    comTemplates = false;
    montar(h(BotaoDoEstilo, { trabalhoIds: ["88888888-8888-8888-8888-888888888888"] }));
    await screen.findByRole("switch", { name: "Usar estilo do cliente nesta geração" });
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("agente-estilo", { body: expect.objectContaining({ acao: "templates_estado" }) }));
    expect(screen.queryByRole("button", { name: /^Template:/ })).toBeNull();
  });

  it("painel com Conversa, Estilo, Templates e Testes; a aba Templates lista com miniatura e abre o detalhe", async () => {
    montar(h(BotaoDoEstilo, {}));
    fireEvent.click(screen.getByRole("button", { name: "Abrir o agente de estilo do cliente" }));
    const abas = await screen.findAllByRole("tab", {}, { timeout: 8000 });
    expect(abas.slice(0, 4).map((a) => a.textContent)).toEqual([expect.stringContaining("Conversa"), expect.stringContaining("Estilo"), expect.stringContaining("Templates"), expect.stringContaining("Testes")]);
    fireEvent.click(abas[2]);
    const cartao = await screen.findByRole("button", { name: "Abrir Carrossel editorial" }, { timeout: 8000 });
    fireEvent.click(cartao);
    expect(await screen.findByText("Editorial claro, título grande e muito respiro.")).toBeTruthy();
    expect(screen.getByText("Continuidade")).toBeTruthy();
  }, 20_000);

  it("estado dos templates normalizado (resposta parcial não quebra)", () => {
    expect(normalizarEstadoDosTemplates(null).templates).toEqual([]);
    const n = normalizarEstadoDosTemplates({ templates: [{ id: "x", tipo: "referencia_carrossel", formato: "??", laminas: null }] });
    expect(n.templates[0]).toMatchObject({ tipo: "referencia_carrossel", formato: "post", laminas: [], ancoras: [] });
  });
});

// ------------------------------------------------------------------ 9. texto

describe("9. Sem travessão nos arquivos da frente T", () => {
  it("nenhum travessão", () => {
    for (const p of [
      "supabase/functions/_shared/templates-de-design.ts",
      "supabase/functions/_shared/continuidade-do-carrossel.ts",
      "supabase/functions/_shared/referencia-de-carrossel.ts",
      "supabase/functions/_shared/trava-da-marca.ts",
      "supabase/functions/agente-estilo/templates.ts",
      "supabase/functions/agente-estilo/acoes-dos-templates.ts",
      "supabase/functions/estudio-arte/estilo-na-geracao.ts",
      "src/components/estilo/AbaTemplates.tsx",
      "src/components/estilo/SeletorDeTemplate.tsx",
      "src/components/estilo/templatesApi.ts",
    ]) {
      expect(ler(p), p).not.toMatch(/[\u2014\u2013]/);
    }
  });
});
