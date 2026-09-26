import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente S2 (26/09): estilo do cliente (agente de estilo).
 * 1. Desligado (o padrão), o prompt do Estúdio é byte a byte o de hoje, no
 *    modo replicar (fixture replicar-identica-hoje.json) e no modo normal
 *    (fixture lamina-normal-hoje.json), e o banco nem é lido.
 * 2. Ligado: o bloco ESTILO DO CLIENTE entra curto, no fim, sem mexer no que
 *    vem antes; as referências do estilo vêm depois das da lâmina.
 * 3. Normalização das ações do agente (contrato comum).
 * 4. Aprovar teste vira referência; versões, aprendizados e o modo sem tabela.
 * 5. Tela: botão Estilo, interruptor e as abas.
 * 6. Registro em motores.ts.
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
import { guiaDoFormulario, normalizarEstado } from "@/components/estilo/estiloApi";
import { layoutPadrao, promptDaLamina } from "../../supabase/functions/_shared/direcao-arte";
import {
  blocoDoEstiloParaOGerador,
  CAMPOS_DAS_REGRAS,
  comAprendizado,
  comNovaVersao,
  comTesteMudado,
  comTestes,
  estiloVazio,
  type GuiaDoEstilo,
  guiaAtual,
  guiaComReferencias,
  lerAprendizado,
  lerEstilo,
  mudarEstilo,
  normalizarGuia,
  promptDoTeste,
  regrasVazias,
  TETO_DO_BLOCO_DO_ESTILO,
  usarEstiloNoTrabalho,
  voltandoPara,
} from "../../supabase/functions/_shared/estilo-do-cliente";
import { estiloNaGeracao } from "../../supabase/functions/estudio-arte/estilo-na-geracao";
import { alvosDoEstilo, lerPedidoDeTeste, normalizarAcoesDoEstilo } from "../../supabase/functions/agente-estilo/acoes-do-estilo";
import { MOTORES, origemDoBloco, MUDANCAS_DO_GERADOR_DO_ESTUDIO } from "../../supabase/functions/_shared/motores";
import * as ESTILO from "../../supabase/functions/_shared/conhecimento-estilo";
import { CASOS_DO_REPLICAR, MARCA_CASO } from "./fixtures/replicarCasos";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const HOJE = JSON.parse(ler("src/test/fixtures/replicar-identica-hoje.json")) as { replicar: { nome: string; prompt: string }[] };

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const REF1 = "22222222-2222-2222-2222-222222222222";
const REF2 = "33333333-3333-3333-3333-333333333333";
const REF3 = "44444444-4444-4444-4444-444444444444";

const GUIA: GuiaDoEstilo = {
  resumo: "Editorial limpo, muito respiro e foto clara de gente real.",
  regras: {
    ...regrasVazias(),
    layout: ["Título no terço de cima, margem larga igual em todas as lâminas", "Uma ideia por lâmina"],
    tipografia: ["Sem serifa condensada em caixa alta no título", "Apoio em peso regular, no máximo duas linhas"],
    cor: ["Verde dominante, laranja só na palavra que importa"],
    foto: ["Luz natural de manhã, contraste suave"],
    elementos: ["Fio fino laranja sob o título"],
    capa: ["Promessa concreta em até 6 palavras"],
    miolo: ["Mesmo molde da capa, texto à esquerda"],
    cta: ["Um CTA só, no rodapé"],
    evitar: ["Fundo escuro", "Letra fina demais", "Muitos elementos"],
  },
  referencias: [
    { id: REF1, origem: "referencia", bucket: "mesa", caminho: `${CLIENTE}/estilo/refs/a.jpg`, nome: "arte 1" },
    { id: REF2, origem: "acervo", bucket: "files", caminho: `${CLIENTE}/x/v1/b.png`, nome: "arte 2" },
    { id: REF3, origem: "teste", bucket: "mesa", caminho: `${CLIENTE}/estilo/testes/c.png`, nome: "teste" },
  ],
};

// ------------------------------------------------------------------ banco de mentira

type Linha = Record<string, any>;
function bancoFalso(opcoes: { semTabela?: boolean; linhas?: Linha[]; arquivos?: Record<string, string> } = {}) {
  const linhas: Linha[] = opcoes.linhas ? opcoes.linhas.slice() : [];
  const arquivos: Record<string, string> = { ...(opcoes.arquivos || {}) };
  const chamadas = { from: 0, storage: 0 };
  const erroTabela = { code: "42P01", message: 'relation "cliente_estilos" does not exist' };
  const consulta = () => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let patch: Linha | null = null;
    let novo: Linha | null = null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      insert: (l: Linha) => ((novo = l), q),
      update: (p: Linha) => ((patch = p), q),
      maybeSingle: async () => {
        if (opcoes.semTabela) return { data: null, error: erroTabela };
        if (novo) {
          const l = { id: "55555555-5555-5555-5555-555555555555", ...novo };
          linhas.push(l);
          return { data: l, error: null };
        }
        const achada = linhas.find((l) => filtros.every((f) => f(l)));
        if (patch) {
          if (!achada) return { data: null, error: null };
          Object.assign(achada, patch);
          return { data: achada, error: null };
        }
        return { data: achada || null, error: null };
      },
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

const estiloAtivo = () => {
  let e = comNovaVersao(estiloVazio(CLIENTE, null, "tabela"), GUIA, "agente", "primeira", null, "2026-09-26T10:00:00.000Z");
  e = { ...e, ativo: true };
  return { id: "66666666-6666-6666-6666-666666666666", client_id: CLIENTE, marca_id: null, ativo: true, versao_atual: e.versao_atual, versoes: e.versoes, aprendizados: [], testes: [], atualizado_em: "2026-09-26T10:00:00.000Z" };
};

// ------------------------------------------------------------------ 1. desligado = hoje

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

// Como gerarCard compõe (mesmos arrays, mesma ordem; os blocos do meio vazios aqui).
const REGRAS = "REGRAS DE RENDER (sintético)";
const compoeNormal = (base: string, blocoDoEstilo: string) => `${[base, "", "", "", "", "", "", blocoDoEstilo].filter(Boolean).join("\n\n")}\n\n${REGRAS}`;
const compoeReplicar = (prompt: string, blocoDoEstilo: string) => [prompt, "", "", "", "", blocoDoEstilo, REGRAS].filter(Boolean).join("\n\n");

const FIXTURE_NORMAL = "src/test/fixtures/lamina-normal-hoje.json";
if (process.env.GERAR_FIXTURE_S2 === "1") {
  // Gerado uma vez antes da ligação do estilo (26/09); não gere de novo sem conferir o código antigo.
  writeFileSync(resolve(process.cwd(), FIXTURE_NORMAL), JSON.stringify({ gerado_em: "2026-09-26", normal: CASOS_NORMAIS.map((c) => ({ nome: c.nome, prompt: baseNormal(c) })) }, null, 1));
}
const HOJE_NORMAL = JSON.parse(ler(FIXTURE_NORMAL)) as { normal: { nome: string; prompt: string }[] };

describe("1. Estilo desligado: o prompt é o de hoje, byte a byte", () => {
  const servidor = ler("supabase/functions/estudio-arte/index.ts");

  it("desligado (ausente, false, texto 'true', null) não lê o banco e devolve null", async () => {
    for (const direcao of [{}, { usar_estilo_do_cliente: false }, { usar_estilo_do_cliente: "true" }, null, { cards: [] }]) {
      const { db, chamadas } = bancoFalso({ linhas: [estiloAtivo()] });
      const marca = vi.fn(async () => null);
      const baixar = vi.fn();
      expect(await estiloNaGeracao({ client_id: CLIENTE, direcao }, { db: db as never, marca, baixar, anexosDaLamina: 2 })).toBeNull();
      expect(chamadas.from + chamadas.storage).toBe(0);
      expect(marca).not.toHaveBeenCalled();
      expect(baixar).not.toHaveBeenCalled();
      expect(usarEstiloNoTrabalho(direcao)).toBe(false);
    }
  });

  it("modo replicar: com o estilo desligado cada caso do fixture sai igual", () => {
    expect(HOJE.replicar.length).toBe(CASOS_DO_REPLICAR.length);
    for (const c of HOJE.replicar) {
      expect(compoeReplicar(c.prompt, ""), c.nome).toBe(`${c.prompt}\n\n${REGRAS}`);
    }
  });

  it("modo normal: promptDaLamina é o do fixture e, com o estilo desligado, a composição não muda", () => {
    expect(HOJE_NORMAL.normal.length).toBe(CASOS_NORMAIS.length);
    CASOS_NORMAIS.forEach((c, i) => {
      const base = baseNormal(c);
      expect(base, c.nome).toBe(HOJE_NORMAL.normal[i].prompt);
      expect(compoeNormal(base, ""), c.nome).toBe(`${HOJE_NORMAL.normal[i].prompt}\n\n${REGRAS}`);
    });
  });

  it("no gerarCard o estilo só entra pelo interruptor: bloco vazio, nenhuma imagem e nada na versão quando desligado", () => {
    expect(servidor).toContain('const blocoDoEstilo = estiloDoCliente ? blocoDoEstiloParaOGerador(estiloDoCliente.guia, { ordem, total, indices: indicesDoEstilo }) : "";');
    expect(servidor).toContain("(estiloDoCliente ? estiloDoCliente.imagens : []).forEach((img) => {");
    expect(servidor).toContain("...(estiloDoCliente ? { estilo_do_cliente: { versao: estiloDoCliente.versao, referencias: indicesDoEstilo.length } } : {}),");
    // Último item antes do join no normal; antes das regras de render no replicar. Nada mais mudou de lugar.
    // Frente T: o bloco do template (vazio com "Nenhum") vem logo depois do estilo.
    expect(servidor).toContain("ordem, total > 1 && ordem > 1),\n    blocoDoEstilo,\n    blocoDoTemplate,\n  ].filter(Boolean).join(\"\\n\\n\");");
    expect(servidor).toContain("blocoDeVariacao(versoesAntes, false, true, ordem, false),\n      blocoDoEstilo,\n      blocoDoTemplate,\n      regrasDeRender(t, { ...card, texto_exato: replica.textoExato }, legendas, regraDaLogo, true),");
    expect((servidor.match(/^\s+blocoDoEstilo,$/gm) || []).length).toBe(2);
    // As imagens do estilo entram depois do laço das da lâmina e antes das legendas (numeração contínua).
    const i = servidor.indexOf("const estiloDoCliente = await estiloNaGeracao(t, {");
    expect(i).toBeGreaterThan(servidor.indexOf("for (const c of escolhidosDaLamina) {"));
    expect(i).toBeLessThan(servidor.indexOf("const legendas = rotulos.map("));
    // O modelo de imagem não muda.
    expect(ler("supabase/functions/estudio-arte/estilo-na-geracao.ts")).not.toMatch(/modelo_imagem_id|modeloId|carregarModelo/);
  });
});

// ------------------------------------------------------------------ 2. ligado

describe("2. Estilo ligado: bloco curto no fim e referências depois das da lâmina", () => {
  it("lê o estilo ativo e traz até 2 referências, dentro do teto de anexos", async () => {
    const { db } = bancoFalso({ linhas: [estiloAtivo()] });
    const baixar = vi.fn(async (_b: string, c: string) => ({ bytes: new Uint8Array([1]), mime: "image/png", nome: c }));
    const r = await estiloNaGeracao({ client_id: CLIENTE, direcao: { usar_estilo_do_cliente: true } }, { db: db as never, marca: async () => null, baixar, anexosDaLamina: 3 });
    expect(r && r.versao).toBe(1);
    expect(r && r.imagens.length).toBe(2);
    const cheio = await estiloNaGeracao({ client_id: CLIENTE, direcao: { usar_estilo_do_cliente: true } }, { db: db as never, marca: async () => null, baixar, anexosDaLamina: 8 });
    expect(cheio && cheio.imagens.length).toBe(0);
    expect(cheio && cheio.guia.resumo).toBe(GUIA.resumo);
  });

  it("estilo desligado no cliente, sem guia ou banco com erro: null (a geração segue igual)", async () => {
    const inativo = { ...estiloAtivo(), ativo: false };
    const { db } = bancoFalso({ linhas: [inativo] });
    const deps = { db: db as never, marca: async () => null, baixar: vi.fn(), anexosDaLamina: 1 };
    expect(await estiloNaGeracao({ client_id: CLIENTE, direcao: { usar_estilo_do_cliente: true } }, deps)).toBeNull();
    const quebrado = { from: () => { throw new Error("fora"); }, storage: { from: () => ({}) } };
    expect(await estiloNaGeracao({ client_id: CLIENTE, direcao: { usar_estilo_do_cliente: true } }, { ...deps, db: quebrado as never })).toBeNull();
  });

  it("o bloco é curto, diz que a lâmina manda, e muda capa, miolo e CTA pela posição", () => {
    const capa = blocoDoEstiloParaOGerador(GUIA, { ordem: 1, total: 5, indices: [5, 6] });
    const miolo = blocoDoEstiloParaOGerador(GUIA, { ordem: 3, total: 5 });
    const fim = blocoDoEstiloParaOGerador(GUIA, { ordem: 5, total: 5 });
    for (const b of [capa, miolo, fim]) {
      expect(b.startsWith("ESTILO DO CLIENTE (ponto de partida")).toBe(true);
      expect(b).toContain("valem sobre ele");
      expect(b).toContain("- EVITAR: Fundo escuro; Letra fina demais; Muitos elementos");
      expect(b.length).toBeLessThanOrEqual(TETO_DO_BLOCO_DO_ESTILO);
      expect(b).not.toMatch(/[—–]/);
    }
    expect(capa).toContain("- CAPA:");
    expect(capa).not.toContain("- CTA:");
    expect(capa).toContain("Imagens 5 e 6: referência do estilo do cliente, só para acabamento");
    expect(miolo).toContain("- MIOLO:");
    expect(miolo).not.toContain("- CAPA:");
    expect(fim).toContain("- CTA:");
    expect(blocoDoEstiloParaOGerador(null, { ordem: 1, total: 1 })).toBe("");
    expect(blocoDoEstiloParaOGerador(normalizarGuia({}), { ordem: 1, total: 1 })).toBe("");
  });

  it("guia enorme continua no teto e guarda o EVITAR e as imagens", () => {
    const longo = "x".repeat(210);
    const regras = regrasVazias();
    for (const c of CAMPOS_DAS_REGRAS) regras[c] = [longo, longo, longo, longo, longo, longo];
    const b = blocoDoEstiloParaOGerador({ resumo: "r".repeat(600), regras, referencias: [] }, { ordem: 1, total: 1, indices: [4] });
    expect(b.length).toBeLessThanOrEqual(TETO_DO_BLOCO_DO_ESTILO);
    expect(b).toContain("- EVITAR:");
    expect(b).toContain("Imagem 4: referência do estilo");
  });

  it("ligado, o que vinha antes fica igual (prefixo) e o bloco entra antes das regras de render", () => {
    const bloco = blocoDoEstiloParaOGerador(GUIA, { ordem: 1, total: 4, indices: [3] });
    for (const c of HOJE.replicar) {
      const com = compoeReplicar(c.prompt, bloco);
      expect(com.startsWith(`${c.prompt}\n\n`)).toBe(true);
      expect(com.endsWith(`${bloco}\n\n${REGRAS}`)).toBe(true);
    }
    CASOS_NORMAIS.forEach((c, i) => {
      const com = compoeNormal(baseNormal(c), bloco);
      expect(com.startsWith(`${HOJE_NORMAL.normal[i].prompt}\n\n`)).toBe(true);
      expect(com).toContain(`\n\n${bloco}\n\n${REGRAS}`);
    });
  });

  it("prompt do teste: tema, paleta válida e o bloco do estilo", () => {
    const p = promptDoTeste(GUIA, { cliente: "Clínica Sorriso", tema: "promoção de outubro", paleta: ["#1f6f43", "azul", "#E8742A"], indices: [1, 2], variacao: 2, total: 3 });
    expect(p).toContain("promoção de outubro");
    expect(p).toContain("#1f6f43, #E8742A");
    expect(p).not.toContain("azul,");
    expect(p).toContain("Variação 2 de 3");
    expect(p).toContain("ESTILO DO CLIENTE");
    expect(p).toContain("Foto nunca escurecida");
  });
});

// ------------------------------------------------------------------ 3. ações

describe("3. Ações do agente de estilo (contrato comum)", () => {
  const estilo = { ...estiloVazio(CLIENTE, null, "tabela"), id: "66666666-6666-6666-6666-666666666666" };
  const candidatas = [
    { id: "77777777-7777-7777-7777-777777777777", titulo: "anexada", detalhe: "anexada agora", dados: { origem: "referencia" as const, bucket: "mesa", caminho: `${CLIENTE}/estilo/refs/n.jpg` } },
  ];
  const alvos = alvosDoEstilo(estilo, candidatas);
  const proposta = { resumo: "Claro e editorial.", regras: { ...regrasVazias(), cor: ["Verde domina"] } };

  it("apelidos: e1 é o estilo, r1 a anexada; o modelo nunca vê id", () => {
    expect(alvos.estilo.map((a) => a.ref)).toEqual(["e1"]);
    expect(alvos.candidatas.map((a) => a.ref)).toEqual(["r1"]);
  });

  it("gravar sem proposta é ignorado; com proposta a proposta vai no contexto", () => {
    const sem = normalizarAcoesDoEstilo({ resumo: "x", itens: [{ operacao: "gravar_estilo", ref: "e1", para: "" }] }, alvos, { proposta: null, clientId: CLIENTE, marcaId: null, custoPorImagem: 0.04 });
    expect(sem).toBeNull();
    const com = normalizarAcoesDoEstilo({ resumo: "Gravo o estilo.", itens: [{ operacao: "gravar_estilo", ref: "e1", para: "estilo novo" }] }, alvos, { proposta, clientId: CLIENTE, marcaId: null, custoPorImagem: 0.04 })!;
    expect(com.itens.map((i) => i.operacao)).toEqual(["gravar_estilo"]);
    expect((com.contexto as any).proposta.regras.cor).toEqual(["Verde domina"]);
    expect(com.sem_desfazer).toBeUndefined();
    expect(com.custo_estimado_usd).toBeUndefined();
  });

  it("ordem de execução, apelido inventado, trava e custo das imagens de teste", () => {
    const a = normalizarAcoesDoEstilo(
      {
        resumo: "Tudo.",
        itens: [
          { operacao: "gerar_teste", ref: "e1", para: "2: promoção de outubro" },
          { operacao: "ligar_estilo", ref: "e1", para: "" },
          { operacao: "usar_referencia", ref: "r1", para: "" },
          { operacao: "registrar_aprendizado", ref: "e1", para: "não gostou: fundo escuro | gostou: letra grossa" },
          { operacao: "gravar_estilo", ref: "e1", para: "novo" },
          { operacao: "usar_referencia", ref: "r9", para: "" },
          { operacao: "desligar_estilo", ref: "e1", para: "" },
        ],
      },
      alvos,
      { proposta, clientId: CLIENTE, marcaId: null, custoPorImagem: 0.05 },
    )!;
    expect(a.itens.map((i) => i.operacao)).toEqual(["gravar_estilo", "usar_referencia", "registrar_aprendizado", "ligar_estilo", "gerar_teste"]);
    expect(a.ignorados).toEqual(["r9"]);
    expect(a.recusados.map((r) => r.operacao)).toEqual(["desligar_estilo"]);
    expect(a.custo_estimado_usd).toBe(0.1);
    expect(a.itens.find((i) => i.operacao === "registrar_aprendizado")!.para).toBe("não gostou: fundo escuro | gostou: letra grossa");
    expect((a.contexto as any).referencias["77777777-7777-7777-7777-777777777777"].caminho).toContain("/estilo/refs/");
    expect(a.itens.every((i) => !/[0-9a-f]{8}-[0-9a-f]{4}/.test(i.ref))).toBe(true);
  });

  it("só testes: sem desfazer; teste sem estilo é recusado; pedido fora de 1..4 ignorado", () => {
    const so = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "gerar_teste", ref: "e1", para: "3" }] }, alvos, { proposta, clientId: CLIENTE, marcaId: null, custoPorImagem: 0.02 })!;
    expect(so.sem_desfazer).toBe(true);
    const semEstilo = normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "gerar_teste", ref: "e1", para: "1" }] }, alvos, { proposta: null, clientId: CLIENTE, marcaId: null, custoPorImagem: 0.02 })!;
    expect(semEstilo.recusados[0].motivo).toContain("Ainda não há estilo");
    expect(normalizarAcoesDoEstilo({ resumo: "", itens: [{ operacao: "gerar_teste", ref: "e1", para: "9" }] }, alvos, { proposta, clientId: CLIENTE, marcaId: null, custoPorImagem: 0.02 })).toBeNull();
    expect(lerPedidoDeTeste("2: dia das crianças")).toEqual({ n: 2, tema: "dia das crianças" });
    expect(lerPedidoDeTeste("promoção")).toEqual({ n: 1, tema: "promoção" });
    expect(lerAprendizado("Não gostou - fundo preto")).toEqual({ tipo: "nao_gostou", texto: "fundo preto" });
  });
});

// ------------------------------------------------------------------ 4. estilo guardado

describe("4. Versões, aprovar teste e o modo sem tabela", () => {
  it("aprovar um teste: vira referência do estilo numa versão nova, com aprendizado", () => {
    let e = comNovaVersao(estiloVazio(CLIENTE, null), { ...GUIA, referencias: [] }, "agente", "v1", null, "2026-09-26T10:00:00Z");
    e = comTestes(e, [{ id: "t1", caminho: `${CLIENTE}/estilo/testes/t1.png`, tema: "outubro", versao: 1, custo_usd: 0.04, criado_em: "", status: "novo" }]);
    const ref = { id: REF3, origem: "teste" as const, bucket: "mesa", caminho: `${CLIENTE}/estilo/testes/t1.png`, nome: "outubro" };
    e = comTesteMudado(e, "t1", (t) => ({ ...t, status: "aprovado", referencia_id: REF3 }));
    e = comNovaVersao(e, guiaComReferencias(guiaAtual(e), [ref], []), "teste_aprovado", "Teste aprovado", null, "2026-09-26T11:00:00Z");
    e = comAprendizado(e, "gostou", "aprovou o teste", null, "2026-09-26T11:00:00Z", "a1");
    expect(e.versao_atual).toBe(2);
    expect(guiaAtual(e)!.referencias.map((r) => r.origem)).toEqual(["teste"]);
    expect(e.testes[0].status).toBe("aprovado");
    expect(e.aprendizados[0].tipo).toBe("gostou");
    // Voltar é uma versão nova igual à antiga (histórico linear).
    const v = voltandoPara(e, 1, null, "2026-09-26T12:00:00Z");
    expect(v.versao_atual).toBe(3);
    expect(guiaAtual(v)!.referencias).toEqual([]);
  });

  it("o servidor sobe o teste aprovado para Arquivos, acervo e referências do cliente", () => {
    const fn = ler("supabase/functions/agente-estilo/index.ts");
    const corpo = fn.slice(fn.indexOf("async function testeAprovar"), fn.indexOf("async function testeDescartar"));
    expect(corpo).toContain('rpc("create_file_record"');
    expect(corpo).toContain('from("cliente_imagens").insert(');
    expect(corpo).toContain("aprovada: true");
    expect(corpo).toContain('from("cliente_referencias").insert(');
    expect(corpo).toContain('papel: "identidade"');
    expect(corpo).toContain('origem: "teste"');
    expect(corpo).toContain("idempotency_key: chave");
    // Testes usam o gerador do Estúdio (mesmo papel/modelo), nunca outro.
    expect(fn).toContain('return await modeloPorPapel("imagem");');
    expect(fn).toContain('agente: "gerador_imagem"');
  });

  it("mudarEstilo grava na tabela e cria versão; sem tabela, guarda o JSON no bucket", async () => {
    const t = bancoFalso();
    const e1 = await mudarEstilo(t.db as never, CLIENTE, null, (x) => comNovaVersao(x, GUIA, "equipe", "primeira", null, "2026-09-26T10:00:00Z"), "u1");
    expect(e1.guardado_em).toBe("tabela");
    expect(e1.versao_atual).toBe(1);
    expect(t.linhas.length).toBe(1);
    const e2 = await mudarEstilo(t.db as never, CLIENTE, null, (x) => ({ ...x, ativo: true }), "u1");
    expect(e2.ativo).toBe(true);
    expect(t.linhas.length).toBe(1);

    const semTabela = bancoFalso({ semTabela: true });
    const a = await mudarEstilo(semTabela.db as never, CLIENTE, REF1, (x) => comNovaVersao(x, GUIA, "equipe", "primeira", null, "2026-09-26T10:00:00Z"), "u1");
    expect(a.guardado_em).toBe("arquivo");
    expect(Object.keys(semTabela.arquivos)).toEqual([`${CLIENTE}/estilo/estilo-${REF1}.json`]);
    const lido = await lerEstilo(semTabela.db as never, CLIENTE, REF1);
    expect(lido.guardado_em).toBe("arquivo");
    expect(guiaAtual(lido)!.resumo).toBe(GUIA.resumo);
  });
});

// ------------------------------------------------------------------ 5. tela

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

const ESTADO_COMPLETO = {
  client_id: CLIENTE,
  marca_id: null,
  marca_nome: null,
  guardado_em: "tabela",
  aviso: null,
  ativo: true,
  versao_atual: 2,
  guia: GUIA,
  referencias: [],
  versoes: [
    { numero: 2, origem: "equipe", nota: "Editado", criado_em: "2026-09-26T10:00:00Z", guia: GUIA },
    { numero: 1, origem: "agente", nota: "Primeira", criado_em: "2026-09-25T10:00:00Z", guia: GUIA },
  ],
  aprendizados: [{ id: "a1", tipo: "nao_gostou", texto: "fundo escuro", em: "2026-09-26T10:00:00Z" }],
  testes: [],
  conversa_id: null,
  mensagens: [],
};

describe("5. Tela: botão Estilo, interruptor e abas", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (_fn: string, { body }: { body: any }) => {
      if (body.acao === "estado" && body.leve) return { data: { client_id: CLIENTE, ativo: true, versao_atual: 2 }, error: null };
      if (body.acao === "estado") return { data: ESTADO_COMPLETO, error: null };
      if (body.acao === "interruptor_ler") return { data: { ligados: [] }, error: null };
      if (body.acao === "interruptor") return { data: { ligado: body.ligado, feitos: 1, falhas: [] }, error: null };
      if (body.acao === "versao_voltar") return { data: { ...ESTADO_COMPLETO, versao_atual: 3 }, error: null };
      return { data: {}, error: null };
    });
  });

  it("botão discreto e interruptor desligado por padrão; ligar grava só no trabalho", async () => {
    montar(h(BotaoDoEstilo, { trabalhoIds: ["88888888-8888-8888-8888-888888888888"] }));
    expect(screen.getByRole("button", { name: "Abrir o agente de estilo do cliente" }).textContent).toContain("Estilo");
    const chave = await screen.findByRole("switch", { name: "Usar estilo do cliente nesta geração" });
    await waitFor(() => expect(chave.hasAttribute("disabled")).toBe(false));
    expect(chave.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(chave);
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("agente-estilo", { body: expect.objectContaining({ acao: "interruptor", ligado: true, trabalho_ids: ["88888888-8888-8888-8888-888888888888"], client_id: CLIENTE }) }),
    );
  });

  it("sem trabalhos: só o botão (sem interruptor)", () => {
    montar(h(BotaoDoEstilo, {}));
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("abre o painel com Conversa, Estilo, Templates (frente T) e Testes; o guia aparece e dá para voltar a versão", async () => {
    montar(h(BotaoDoEstilo, {}));
    fireEvent.click(screen.getByRole("button", { name: "Abrir o agente de estilo do cliente" }));
    const abas = await screen.findAllByRole("tab", {}, { timeout: 8000 });
    // Frente T (26/09) acrescentou a aba Templates entre Estilo e Testes; as três do S2 continuam, na mesma ordem.
    expect(abas.map((a) => a.textContent)).toEqual([expect.stringContaining("Conversa"), expect.stringContaining("Estilo"), expect.stringContaining("Templates"), expect.stringContaining("Testes")]);
    fireEvent.click(abas[1]);
    expect(await screen.findByText(GUIA.resumo, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText("fundo escuro")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Voltar para esta/ }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("agente-estilo", { body: expect.objectContaining({ acao: "versao_voltar", numero: 1 }) }));
  }, 20_000);

  it("formulário e estado normalizados", () => {
    const g = guiaDoFormulario(" Resumo ", { cor: "- Verde domina\n\n* Laranja destaca", evitar: "Fundo escuro" });
    expect(g.resumo).toBe("Resumo");
    expect(g.regras.cor).toEqual(["Verde domina", "Laranja destaca"]);
    expect(g.regras.layout).toEqual([]);
    expect(normalizarEstado({ client_id: CLIENTE, versoes: null })!.versoes).toEqual([]);
    expect(normalizarEstado(null)).toBeNull();
  });
});

// ------------------------------------------------------------------ 6. motores

describe("6. Registro em motores.ts", () => {
  it("o motor estilo.agente recebe os blocos do estilo, com origem, e a mudança do gerador está registrada", () => {
    const m = MOTORES.find((x) => x.id === "estilo.agente")!;
    const k = m.montar();
    for (const b of m.promete) expect(k.ids).toContain(b);
    for (const id of k.ids) expect(origemDoBloco(id), id).not.toBeNull();
    for (const [nome, v] of Object.entries(ESTILO)) {
      if (typeof v !== "string" || nome.startsWith("VERSAO")) continue;
      expect(k.texto, nome).toContain(v);
      expect(v, nome).not.toMatch(/[—–]/);
    }
    expect(MUDANCAS_DO_GERADOR_DO_ESTUDIO.map((x) => x.id)).toContain("estilo_do_cliente");
  });

  it("arquivos novos sem travessão", () => {
    for (const p of [
      "supabase/functions/_shared/estilo-do-cliente.ts",
      "supabase/functions/_shared/conhecimento-estilo.ts",
      "supabase/functions/agente-estilo/index.ts",
      "supabase/functions/agente-estilo/acoes-do-estilo.ts",
      "supabase/functions/estudio-arte/estilo-na-geracao.ts",
      "src/components/estilo/PainelDoEstilo.tsx",
      "src/components/estilo/BotaoDoEstilo.tsx",
      "src/components/estilo/InterruptorDoEstilo.tsx",
      "docs/estudio/ESTILO-DO-CLIENTE.md",
    ]) {
      expect(ler(p), p).not.toMatch(/[—–]/);
    }
  });
});
