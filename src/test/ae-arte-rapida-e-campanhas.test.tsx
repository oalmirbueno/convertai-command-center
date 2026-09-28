import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente AE (28/09): arte rápida, campanhas com tipo e ligadas às mesas,
 * marcas separadas (Acerbi e CME) e arquivar pela faixa do Estúdio.
 * Pedidos do dono: "da foto para a arte, com campanha"; "campanhas menos
 * genéricas"; "área nova de arte avulsa"; "na Acerbi está misturando tudo";
 * "apagar os conteúdos que não quero mais por aqui também".
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn(), upload: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: mock.rpc,
    from: mock.from,
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.png" }, error: null })),
        upload: mock.upload,
        download: vi.fn(),
      })),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import {
  aplicarArquivosNasLaminas,
  arteRapidaDa,
  corpoDaArteRapida,
  decidirArteRapida,
  linkDaArteRapida,
  normalizarPedidoDaArteRapida,
  papelPeloNome,
  pecaPelaRegra,
  perguntasDaArteRapida,
  tituloDoPedido,
  type ArquivoDaArteRapida,
} from "../../supabase/functions/_shared/arte-rapida";
import {
  blocoDoTipoParaOEstrategista,
  direcaoDoSeloDoTipo,
  perguntaDoTipoDaCampanha,
  TIPOS_DE_CAMPANHA,
  tipoDaCampanha,
  tipoPelaResposta,
} from "../../supabase/functions/_shared/tipos-de-campanha";
import { campanhaDaMarca, contextoComMarca, fontesDaMarca, fotoDaMarca, kitComMarca } from "../../supabase/functions/_shared/marca";
import { campanhaDaMarcaNaTela, filtrarPorMarca, projetosDaMarca, type MarcaDoCliente } from "@/lib/mesa/marcas";
import { fontesDaMarcaNaTela } from "@/lib/mesa/tipografiaDoCliente";
import { definirCampanhaEmUso, lerCampanhaEmUso } from "@/lib/mesa/campanhaAtiva";
import { artesDoHistorico, arteRapidaDaMarca, itemDaArteRapida, situacaoDaArteRapida } from "@/components/mesa/arteRapidaApi";
import { pautasParecidas, titulosParecidos, tituloComparavel } from "@/components/mesa/arquivarDaFaixa";
import { comArteRapidaTrocada } from "@/components/mesa/estudioUtil";
import { linhasCopiadasParaAMarca } from "@/components/mesa/EstudioSemTipografia";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import AbaEstudio from "@/components/mesa/AbaEstudio";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import type { ModeloIa } from "@/lib/mesa/api";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const ACERBI_ID = "1435444b-55a2-47e5-9c9f-6c5398a6f379";
const CME_ID = "d65dc686-8f4e-4906-ab5d-568ecffc9bfa";
const PROJ_ACERBI = "1a55e3e5-c823-4cc9-8e26-1ba14396219a";
const PROJ_CME = "a220d8f6-0259-41b5-aaa4-eb1ef5435fb1";
const CAMP_A = "22222222-2222-4222-8222-222222222222";
const CAMP_B = "33333333-3333-4333-8333-333333333333";
const FOTO_ACERVO = "44444444-4444-4444-8444-444444444444";

const marca = (id: string, principal: boolean, project_id: string): MarcaDoCliente => ({
  id,
  client_id: CLIENTE,
  project_id,
  nome: principal ? "Acerbi" : "CME",
  principal,
  ordem: principal ? 0 : 1,
  paleta: [],
  logo_path: null,
  logo_alt_path: null,
  logo_file_id: null,
  logo_alt_file_id: null,
  estilo: null,
  regras: null,
  tom: null,
  contexto_extra: null,
});
const ACERBI = marca(ACERBI_ID, true, PROJ_ACERBI);
const CME = marca(CME_ID, false, PROJ_CME);
const leve = (m: MarcaDoCliente) => ({ id: m.id, client_id: CLIENTE, project_id: m.project_id, nome: m.nome, principal: m.principal });

const fonte = (caminho: string) => readFileSync(resolve(__dirname, "..", "..", caminho), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem storage */
  }
});

// ------------------------------------------------------------------ tipos de campanha

describe("tipos de campanha: identidade e selo próprios", () => {
  it("sete tipos, cada um com briefing, identidade, selo e arco; o Jev escolhe com 'outro' e confiança mínima", () => {
    expect(TIPOS_DE_CAMPANHA).toEqual(["promocao", "lancamento", "data_comemorativa", "institucional", "evento", "prova_social", "sazonal"]);
    const bloco = blocoDoTipoParaOEstrategista("evento");
    expect(bloco).toContain("TIPO DA CAMPANHA: Evento");
    expect(bloco).toContain("Nada disso é inventado");
    expect(blocoDoTipoParaOEstrategista("qualquer")).toBe("");
    expect(direcaoDoSeloDoTipo("promocao")).toContain("Nunca o preço dentro do selo");
    expect(direcaoDoSeloDoTipo(null)).toContain("sem poluir");
    const p = perguntaDoTipoDaCampanha();
    expect(p.type).toBe("choice");
    expect(Object.keys(p.criteria)).toEqual(TIPOS_DE_CAMPANHA.concat(["outro"] as any));
    expect(tipoPelaResposta({ choice: "lancamento", confidence: 0.8 })).toBe("lancamento");
    expect(tipoPelaResposta({ choice: "lancamento", confidence: 0.2 })).toBeNull();
    expect(tipoPelaResposta({ choice: "outro", confidence: 0.9 })).toBeNull();
    expect(tipoDaCampanha({ tipo: "sazonal" })).toBe("sazonal");
    expect(tipoDaCampanha({})).toBeNull();
  });

  it("servidor: o tipo entra na criação (tela ou Jev), sobrevive aos ajustes, troca sem IA e guia o selo; a campanha nasce na marca", () => {
    const cal = fonte("supabase/functions/agente-calendario/index.ts");
    expect(cal).toContain("tipoDaCampanhaPeloJev(clientId, pedidoTexto, hype, chamador.userId)");
    expect(cal).toContain("normalizarIdentidade(r.identidade, { tipo: tipoDaCriacao.tipo, marca_id:");
    expect(cal).toContain("normalizarIdentidade(nova.identidade, (c.identidade ?? null)");
    expect(cal).toContain("direcaoDoSeloDoTipo(tipoDaCampanha(c.identidade))");
    expect(cal).toContain("if (corpo.tipo !== undefined) {");
  });
});

// ------------------------------------------------------------------ arte rápida: regras

describe("arte rápida: pedido, Jev e regras fixas", () => {
  const baseCorpo = {
    pedido: "Faça uma promoção do mouse gamer, R$ 149 no Pix até sexta",
    arquivos: [
      { caminho: `${CLIENTE}/pedidos/a.jpg`, nome: "mouse.jpg", papel: "auto" },
      { caminho: `${CLIENTE}/pedidos/a.jpg`, nome: "repetida.jpg" },
      { caminho: `outro-cliente/pedidos/b.jpg`, nome: "de fora.jpg" },
      { caminho: `${CLIENTE}/../x.jpg`, nome: "subindo.jpg" },
      { imagem_id: FOTO_ACERVO, nome: "foto da mesa foto", papel: "foto" },
    ],
    documentos: [{ nome: "tabela.pdf", texto: "Mouse gamer 16000 DPI" }],
    campanha_id: "auto",
    laminas: 4,
  };

  it("normaliza: só arquivos da pasta do cliente, sem repetir; campanha 'auto', uuid ou nada", () => {
    const p = normalizarPedidoDaArteRapida(baseCorpo, CLIENTE);
    expect(p.arquivos.map((a) => a.nome)).toEqual(["mouse.jpg", "foto da mesa foto"]);
    expect(p.arquivos[0].papel).toBe("auto");
    expect(p.arquivos[1]).toEqual({ imagem_id: FOTO_ACERVO, caminho: null, nome: "foto da mesa foto", papel: "foto" });
    expect(p.campanha).toBe("auto");
    expect(p.peca).toBe("auto");
    expect(p.laminas).toBe(4);
    expect(normalizarPedidoDaArteRapida({ ...baseCorpo, campanha_id: "nada" }, CLIENTE).campanha).toBeNull();
  });

  it("perguntas ao Jev só do que ficou em Automático, todas numa chamada; campanhas por código", () => {
    const p = normalizarPedidoDaArteRapida(baseCorpo, CLIENTE);
    const q = perguntasDaArteRapida(p, [
      { id: CAMP_A, nome: "Semana do Mouse", identidade: { tipo: "promocao" }, briefing: { oferta: "15% no Pix" } },
      { id: CAMP_B, nome: "Dia das Crianças" },
    ]);
    expect(Object.keys(q.questions).sort()).toEqual(["campanha", "papel_1", "peca"]);
    expect(q.campanhas).toEqual({ c1: CAMP_A, c2: CAMP_B });
    expect(JSON.stringify(q.questions.campanha.criteria.c1)).toContain("promoção");
    expect(Object.keys(q.questions.peca.criteria)).toEqual(["unica", "carrossel"]);
    const tudoDecidido = perguntasDaArteRapida({ ...p, peca: "unica", campanha: null, arquivos: [{ caminho: "x", nome: "x", papel: "foto" }] }, []);
    expect(Object.keys(tudoDecidido.questions)).toEqual([]);
  });

  it("decide: a equipe vale sobre o Jev; o Jev com confiança; sem o Jev, regra fixa; avisos claros", () => {
    const p = normalizarPedidoDaArteRapida(baseCorpo, CLIENTE);
    const q = perguntasDaArteRapida(p, [{ id: CAMP_A, nome: "Semana do Mouse" }]);
    const d = decidirArteRapida(p, q, {
      peca: { choice: "unica", confidence: 0.9 },
      campanha: { choice: "c1", confidence: 0.8 },
      papel_1: { choice: "logo", confidence: 0.7 },
    });
    expect(d.peca).toBe("unica");
    expect(d.peca_por).toBe("jev");
    expect(d.campanha_id).toBe(CAMP_A);
    expect(d.campanha_por).toBe("jev");
    expect(d.arquivos.map((a) => [a.codigo, a.papel, a.papel_por])).toEqual([
      ["L1", "logo", "jev"],
      ["F1", "foto", "equipe"],
    ]);
    // Pouca confiança na campanha: segue a marca e avisa.
    const incerta = decidirArteRapida(p, q, { campanha: { choice: "c1", confidence: 0.3 } });
    expect(incerta.campanha_id).toBeNull();
    expect(incerta.avisos.join(" ")).toContain("sem certeza");
    // Sem o Jev: regra pelas palavras, papel pelo nome, senão foto.
    const semJev = decidirArteRapida({ ...p, pedido: "carrossel com as 5 dicas" }, q, null);
    expect(semJev.peca).toBe("carrossel");
    expect(semJev.peca_por).toBe("regra");
    expect(semJev.arquivos[0].papel).toBe("foto");
    // A equipe manda na peça.
    expect(decidirArteRapida({ ...p, peca: "carrossel" }, q, { peca: { choice: "unica", confidence: 1 } }).peca).toBe("carrossel");
    // Arte única com duas fotos: avisa que uma ficou de fora.
    const duas = decidirArteRapida({ ...p, peca: "unica", arquivos: [{ caminho: "a", nome: "a", papel: "foto" }, { caminho: "b", nome: "b", papel: "foto" }] }, null, null);
    expect(duas.avisos.join(" ")).toContain("1 foto ficou de fora");
  });

  it("título curto sem travessão, papel pelo nome e peça pelas palavras", () => {
    expect(tituloDoPedido("Arte do palestrante — evento de sexta. Com a foto")).toBe("Arte do palestrante, evento de sexta");
    expect(tituloDoPedido("")).toBe("Arte rápida");
    expect(tituloDoPedido("x".repeat(90)).length).toBeLessThanOrEqual(64);
    expect(papelPeloNome("logo-sebrae.png")).toBe("logo");
    expect(papelPeloNome("flyer_cliente.jpg")).toBe("arte_para_melhorar");
    expect(papelPeloNome("IMG_2034.jpg")).toBeNull();
    expect(pecaPelaRegra("faça um carrossel")).toBe("carrossel");
    expect(pecaPelaRegra("um post para o story")).toBe("unica");
    expect(pecaPelaRegra("promoção do mouse")).toBeNull();
  });

  it("fotos e logos nas lâminas: foto real intacta como base, toda foto usada, logos só as enviadas na capa e no fim", () => {
    const arquivos: ArquivoDaArteRapida[] = [
      { codigo: "F1", imagem_id: null, caminho: `${CLIENTE}/pedidos/f1.jpg`, nome: "palestrante.jpg", papel: "foto", papel_por: "equipe" },
      { codigo: "F2", imagem_id: FOTO_ACERVO, caminho: null, nome: "palco", papel: "foto", papel_por: "jev" },
      { codigo: "L1", imagem_id: null, caminho: `${CLIENTE}/pedidos/l1.png`, nome: "logo-sebrae.png", papel: "logo", papel_por: "regra" },
      { codigo: "A1", imagem_id: null, caminho: `${CLIENTE}/pedidos/a1.png`, nome: "flyer.png", papel: "arte_para_melhorar", papel_por: "equipe" },
    ];
    const unica = aplicarArquivosNasLaminas([{ ordem: 1 }], {}, arquivos, "unica");
    expect(unica[0].fotos_livres).toEqual([
      { caminho: `${CLIENTE}/pedidos/f1.jpg`, papel: "fundo", nota: expect.stringContaining("sem ser refeita nem escurecida") },
      { caminho: `${CLIENTE}/pedidos/l1.png`, papel: "elemento", nota: expect.stringContaining("sem redesenhar") },
    ]);
    const carrossel = aplicarArquivosNasLaminas([{ ordem: 1 }, { ordem: 2 }, { ordem: 3 }], { 2: "F1" }, arquivos, "carrossel");
    expect(carrossel[1].fotos_livres?.[0].caminho).toBe(`${CLIENTE}/pedidos/f1.jpg`);
    expect(carrossel[0].imagens_ids).toEqual([FOTO_ACERVO]);
    expect(carrossel[2].fotos_livres?.some((f) => f.papel === "elemento")).toBe(true);
    expect(carrossel[1].fotos_livres?.some((f) => f.papel === "elemento")).toBe(false);
    // A arte a melhorar nunca vira lâmina (o diretor lê e refaz com a marca).
    expect(JSON.stringify(carrossel)).not.toContain("a1.png");
  });

  it("endereço, corpo e leitura gravada", () => {
    expect(linkDaArteRapida(CLIENTE, "nova", { fotos: [FOTO_ACERVO, "lixo"], campanha: CAMP_A })).toBe(
      `/mesa?client=${CLIENTE}&aba=estudio&rapida=nova&fotos=${FOTO_ACERVO}&campanha=${CAMP_A}`,
    );
    const corpo = corpoDaArteRapida({ clientId: CLIENTE, pedido: " arte ", peca: "unica", campanha: null, arquivos: [{ imagem_id: FOTO_ACERVO, nome: "f", papel: "foto" }], documentos: [], formato: "quadrado_1x1", laminas: 5, marcaId: CME_ID });
    expect(corpo).toEqual({ acao: "rapida_preparar", client_id: CLIENTE, pedido: "arte", peca: "unica", campanha_id: null, arquivos: [{ imagem_id: FOTO_ACERVO, nome: "f", papel: "foto" }], formato: "quadrado_1x1", marca_id: CME_ID });
    const a = arteRapidaDa({ arte_rapida: { pedido: "x", titulo: "X", peca: "carrossel", arquivos: [{ codigo: "F1", papel: "foto", nome: "f" }, { papel: "outra" }], documentos: [] } });
    expect(a && a.peca).toBe("carrossel");
    expect(a && a.arquivos.length).toBe(1);
    expect(arteRapidaDa({ cards: [] })).toBeNull();
  });
});

// ------------------------------------------------------------------ servidor da arte rápida

describe("arte rápida no servidor: o mesmo diretor, sem motor novo", () => {
  const estudio = fonte("supabase/functions/estudio-arte/index.ts");
  it("ações novas, trabalho sem item, legenda e preparar pelo mesmo caminho, marca obrigatória com duas marcas", () => {
    expect(estudio).toContain("rapida_preparar: (ch, corpo) => rapidaPreparar(ch, corpo, null)");
    expect(estudio).toContain("rapida_para_agenda: rapidaParaAgenda");
    expect(estudio).toContain("rapida_arquivar: rapidaArquivar");
    expect(estudio).toContain('"preparar", "rapida_preparar"');
    expect(estudio).toContain("if (!alvo.task_id && ehArteRapida(alvo.direcao)) return await rapidaPreparar(");
    expect(estudio).toContain("return await prepararItem(ch, corpo, item, null);");
    expect(estudio).toContain("task_id: item.tarefa.id || null,");
    expect(estudio).toContain("const item = t.task_id ? await lerItemDaAgenda(t.task_id) : itemDaArteRapida(t);");
    expect(estudio).toContain('"escolha_a_marca"');
    expect(estudio).toContain("INSTRUCOES_DA_ARTE_RAPIDA");
    expect(estudio).toContain("aplicarArquivosNasLaminas(cards, codigosDasFotosDoDiretor(bruto.cards, postUnico)");
    // Levar para a Agenda: item pelo escritor editorial, no projeto da marca; data de hoje em diante.
    expect(estudio).toContain("projetoId: marca ? marca.project_id : null,");
    expect(estudio).toContain("dataDaAgendaValida(data, hojeEmSaoPaulo())");
    const agenda = fonte("supabase/functions/estudio-arte/arte-rapida-na-agenda.ts");
    expect(agenda).toContain("idempotency_key: `mesa-estudio:arte-rapida:${pedido}`");
  });
});

// ------------------------------------------------------------------ marcas separadas

describe("Acerbi e CME não se misturam", () => {
  it("fontes, estilo e tom: a CME fica só com o que é dela (tela e servidor iguais)", () => {
    const fontes = [
      { id: "c1", marca_id: null },
      { id: "m1", marca_id: CME_ID },
    ];
    expect(fontesDaMarca(fontes, leve(CME)).map((f) => f.id)).toEqual(["m1"]);
    expect(fontesDaMarca([fontes[0]], leve(CME))).toEqual([]);
    expect(fontesDaMarcaNaTela([fontes[0]], CME)).toEqual([]);
    expect(fontesDaMarca(fontes, leve(ACERBI)).map((f) => f.id)).toEqual(["c1"]);
    const kit = kitComMarca({ paleta: [{ hex: "#003366" }], logo_path: "c/logo.png", estilo: "institucional azul", regras: "não destacar associado" }, { ...CME, contexto: null } as any);
    expect(kit.logo_path).toBeNull();
    expect(kit.paleta).toEqual([]);
    expect(kit.estilo).toBeNull();
    expect(kit.regras).toBe("não destacar associado");
    const ctx = contextoComMarca({ negocio: "Associação", tom_de_voz: "formal" } as any, { ...CME, contexto: null } as any);
    expect((ctx as any).tom_de_voz).toBeUndefined();
    // Com tom próprio, vale o dela.
    expect((contextoComMarca({ tom_de_voz: "formal" } as any, { ...CME, tom: "acolhedor", contexto: null } as any) as any).tom_de_voz).toBe("acolhedor");
  });

  it("copiar as fontes do cliente para a CME é um clique explícito (linhas novas com a marca dela)", () => {
    const linhas = linhasCopiadasParaAMarca([{ id: "c1", client_id: CLIENTE, nome: "Lato", papel: "texto", storage_path: "x", marca_id: null, criado_em: "t" }, { id: "m1", marca_id: CME_ID }], CME_ID);
    expect(linhas).toEqual([{ client_id: CLIENTE, nome: "Lato", papel: "texto", storage_path: "x", marca_id: CME_ID }]);
  });

  it("fotos do acervo, campanhas e artes rápidas: cada uma na sua marca (sem etiqueta, só na principal)", () => {
    expect(fotoDaMarca(["marca:" + CME_ID], leve(CME))).toBe(true);
    expect(fotoDaMarca(["marca:" + CME_ID], leve(ACERBI))).toBe(false);
    expect(fotoDaMarca([], leve(ACERBI))).toBe(true);
    expect(fotoDaMarca(null, leve(CME))).toBe(false);
    expect(fotoDaMarca([], null)).toBe(true);
    for (const [identidade, m, esperado] of [
      [{ marca_id: CME_ID }, CME, true],
      [{ marca_id: CME_ID }, ACERBI, false],
      [{}, ACERBI, true],
      [{}, CME, false],
      [null, null, true],
    ] as [unknown, MarcaDoCliente | null, boolean][]) {
      expect(campanhaDaMarca(identidade, m ? leve(m) : null)).toBe(esperado);
      expect(campanhaDaMarcaNaTela(identidade, m)).toBe(esperado);
    }
    const t = (id: string, marcaId?: string, arquivada = false) =>
      ({ id, direcao: { cards: [], ...(marcaId ? { marca_id: marcaId } : {}), arte_rapida: { pedido: id, titulo: id, peca: "unica", arquivos: [], documentos: [], ...(arquivada ? { arquivada_em: "x" } : {}) } }, cards: [] }) as unknown as Trabalho;
    const lista = [t("a", ACERBI_ID), t("b", CME_ID), t("c"), t("d", CME_ID, true)];
    expect(artesDoHistorico(lista).filter((x) => arteRapidaDaMarca(x, CME)).map((x) => x.id)).toEqual(["b"]);
    expect(artesDoHistorico(lista).filter((x) => arteRapidaDaMarca(x, ACERBI)).map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("pautas: a lista da CME só tem o projeto dela; a da Acerbi nunca o da CME", () => {
    const itens = [
      { id: "1", project_id: PROJ_ACERBI },
      { id: "2", project_id: PROJ_CME },
      { id: "3", project_id: "site" },
    ];
    expect(filtrarPorMarca(itens, projetosDaMarca(CME, [ACERBI, CME])).map((i) => i.id)).toEqual(["2"]);
    expect(filtrarPorMarca(itens, projetosDaMarca(ACERBI, [ACERBI, CME])).map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("servidor: o diretor só pega foto da marca, a Mesa Foto só lista campanhas dela, o post de fotos nasce no projeto dela", () => {
    const estudio = fonte("supabase/functions/estudio-arte/index.ts");
    expect(estudio).toContain("lerAcervo(clientId, 40, marcaDoItem)");
    expect(estudio).toContain(".filter((f) => fotoDaMarca(f.tags, marca))");
    expect(fonte("supabase/functions/mesa-foto/campanhas.ts")).toContain("campanhaDaMarca((l as { identidade?: unknown }).identidade, marca)");
    expect(fonte("supabase/functions/estudio-arte/fotos-na-agenda.ts")).toContain("projetoId: marca ? marca.project_id : null,");
  });
});

// ------------------------------------------------------------------ campanha em uso e faixa

describe("campanha em uso nas mesas e arquivar pela faixa", () => {
  it("a campanha em uso fica por cliente e troca em qualquer mesa", () => {
    expect(lerCampanhaEmUso(CLIENTE)).toBeNull();
    definirCampanhaEmUso(CLIENTE, CAMP_A);
    expect(lerCampanhaEmUso(CLIENTE)).toBe(CAMP_A);
    definirCampanhaEmUso(CLIENTE, "lixo");
    expect(lerCampanhaEmUso(CLIENTE)).toBeNull();
  });

  it("pauta parecida no mesmo dia (o caso das duas 'Você reconheceria Florianópolis' de 25/09)", () => {
    expect(tituloComparavel("Carrossel | Você reconheceria Florianópolis só por esta silhueta?")).toBe("voce reconheceria florianopolis so por esta silhueta");
    expect(titulosParecidos("Carrossel | Você reconheceria Florianópolis só por esta silhueta?", "Você reconheceria Florianópolis só por esta silhueta")).toBe(true);
    expect(titulosParecidos("Dicas de postura", "Promoção de verão")).toBe(false);
    const p = pautasParecidas([
      { id: "a", title: "Carrossel | Você reconheceria Florianópolis só por esta silhueta?", due_date: "2026-09-25" },
      { id: "b", title: "Carrossel | Você reconheceria Florianópolis só por esta silhueta?", due_date: "2026-09-25" },
      { id: "c", title: "Carrossel | Você reconheceria Florianópolis só por esta silhueta?", due_date: "2026-09-26" },
    ]);
    expect(p).toEqual({ a: ["b"], b: ["a"] });
  });

  it("servidor: arquivar leva o post só planejado junto (antes da tarefa) e o desfazer devolve os dois", () => {
    const cal = fonte("supabase/functions/agente-calendario/index.ts");
    expect(cal).toContain('if (corpo.arquivar_post === true && postId) {');
    expect(cal).toContain('rpc("archive_editorial_post", { p_post_id: p.id, p_expected_version: p.version })');
    expect(cal).toContain("desarquivarPostDoItem(servico, clientId, t.id, corpo.post_id)");
    // Nunca o apagar de verdade.
    expect(fonte("src/components/mesa/arquivarDaFaixa.ts")).not.toMatch(/import[^;]*taskDelete/);
  });

  it("cache: o trabalho devolvido pela função troca na lista e na peça aberta da arte rápida", () => {
    const antes = [{ id: "t1", legenda: null }, { id: "t2", legenda: null }];
    expect(comArteRapidaTrocada(antes, { id: "t2", task_id: null, legenda: "nova" })).toEqual([{ id: "t1", legenda: null }, { id: "t2", task_id: null, legenda: "nova" }]);
    expect(comArteRapidaTrocada({ id: "t1" }, { id: "t1", task_id: null, legenda: "x" })).toEqual({ id: "t1", task_id: null, legenda: "x" });
    expect(comArteRapidaTrocada(antes, { id: "zz", task_id: null })).toBe(antes);
  });

  it("peça da arte rápida: item sem task_id (só chave de tela) e situação simples", () => {
    const t = { id: "t9", status: "dirigido", direcao: { cards: [{ ordem: 1 }, { ordem: 2 }], arte_rapida: { pedido: "p", titulo: "Promo", peca: "carrossel", arquivos: [], documentos: [] } }, cards: [{ ordem: 1, versao: 1, storage_path: "x" }] } as unknown as Trabalho;
    expect(itemDaArteRapida(t)).toEqual({ id: "rapida-t9", title: "Promo", due_date: null, delivery_type: "carousel", status: "todo", project_id: "" });
    expect(situacaoDaArteRapida(t)).toEqual({ rotulo: "1 de 2", tom: "alerta" });
  });
});

// ------------------------------------------------------------------ tela

const modelo = (extra: Partial<ModeloIa>): ModeloIa => ({
  id: "x",
  provedor: "openai",
  modelo_api: "x",
  tipo: "texto",
  rotulo: "X",
  preco_entrada_1m: 1,
  preco_saida_1m: 2,
  preco_cache_1m: null,
  preco_imagem: null,
  raciocinio: [],
  padrao_para: [],
  ativo: true,
  ...extra,
});
const catalogo = [
  modelo({ id: "openai:diretor", padrao_para: ["diretor_arte"] }),
  modelo({ id: "openai:leitor", padrao_para: ["leitura"], preco_entrada_1m: 0.1, preco_saida_1m: 0.4 }),
  modelo({ id: "openai:imagem", tipo: "imagem", preco_entrada_1m: 0, preco_saida_1m: 0, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 }, padrao_para: ["imagem"] }),
];
const valorDaMesa = (extra: Partial<MesaValor> = {}): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
  ...extra,
});

function bancoFalso(tabelas: Record<string, any[]>) {
  return (nome: string) => {
    const filtros: ((r: any) => boolean)[] = [];
    const b: any = {
      select: () => b,
      order: () => b,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; },
      neq: () => b,
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.indexOf(r[c]) >= 0); return b; },
      is: () => b,
      not: () => b,
      gte: () => b,
      lt: () => b,
      lte: () => b,
      limit: () => b,
      range: () => b,
      contains: () => b,
      overlaps: () => b,
      or: () => b,
      maybeSingle: () => Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r)))[0] || null, error: null }),
      then: (ok: any, erro: any) => Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r))), error: null }).then(ok, erro),
    };
    return b;
  };
}

function montar(endereco: string, valor = valorDaMesa()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, { initialEntries: [endereco] }, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(MesaProvider, { valor }, h(AbaEstudio, { mes: "2026-09-01", onMes: vi.fn(), tarefaId: null, onTarefa: vi.fn() }))))),
  );
}

describe("tela da arte rápida", () => {
  it("abre pelo endereço, com a campanha do endereço; Criar arte chama rapida_preparar e a arte única entra na fila", async () => {
    const trabalhos: any[] = [];
    mock.from.mockImplementation(
      bancoFalso({
        estudio_trabalhos: trabalhos,
        mesa_campanhas: [{ id: CAMP_A, client_id: CLIENTE, nome: "Semana do Mouse", status: "planejada", identidade: { tipo: "promocao" }, briefing: { oferta: "15% no Pix" }, periodo_inicio: "2026-09-28", periodo_fim: "2026-10-05", selo_path: null }],
        tasks: [],
        projects: [],
        cliente_fontes: [{ id: "f1", client_id: CLIENTE, nome: "Lato", papel: "texto", marca_id: null }],
      }),
    );
    const trabalho = { id: "55555555-5555-4555-8555-555555555555", client_id: CLIENTE, task_id: null, status: "dirigido", direcao: { conceito: "c", campanha_id: CAMP_A, cards: [{ ordem: 1, funcao: "capa", texto_exato: "Mouse" }], arte_rapida: { pedido: "promo", titulo: "Promo do mouse", peca: "unica", arquivos: [], documentos: [] } }, cards: [], file_ids: [], custo_usd: 0.05, atualizado_em: "2026-09-28" };
    mock.invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => {
      if (body.acao === "rapida_preparar") {
        trabalhos.push(trabalho);
        return { data: { trabalho, custo_usd: 0.05, avisos: [] }, error: null };
      }
      if (body.acao === "enfileirar") return { data: { lote_id: "l", itens: [] }, error: null };
      return { data: {}, error: null };
    });
    montar(`/mesa?client=${CLIENTE}&aba=estudio&rapida=nova&campanha=${CAMP_A}`);
    expect(await screen.findByRole("heading", { name: "Arte rápida" })).toBeTruthy();
    const modo = screen.getByRole("radiogroup", { name: "Modo do Estúdio" });
    expect(within(modo).getByRole("radio", { name: /Arte rápida/ }).getAttribute("aria-checked")).toBe("true");
    const campanhas = await screen.findByRole("radiogroup", { name: "Campanha da arte" });
    await waitFor(() => expect(within(campanhas).getByRole("radio", { name: /Semana do Mouse/ }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByText(/A arte puxa a base inteira/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("O que você precisa?"), { target: { value: "Promoção do mouse gamer, R$ 149 no Pix até sexta" } });
    const botao = screen.getByRole("button", { name: /Criar arte/ });
    fireEvent.click(botao);
    await waitFor(() => expect(mock.invoke.mock.calls.some((c) => (c[1] as any).body.acao === "rapida_preparar")).toBe(true));
    const corpo = (mock.invoke.mock.calls.filter((c) => (c[1] as any).body.acao === "rapida_preparar")[0][1] as any).body;
    expect(corpo).toMatchObject({ client_id: CLIENTE, pedido: "Promoção do mouse gamer, R$ 149 no Pix até sexta", peca: "auto", campanha_id: CAMP_A });
    await waitFor(() => expect(mock.invoke.mock.calls.some((c) => (c[1] as any).body.acao === "enfileirar" && (c[1] as any).body.trabalho_id === trabalho.id)).toBe(true));
    // A peça criada abre no Estúdio de sempre, com "Levar para a Agenda" no lugar da Entrega.
    expect(await screen.findByText(/Arte rápida · Arte única · Semana do Mouse/)).toBeTruthy();
  });
});

describe("faixa das pautas: arquivar", () => {
  it("o botão do cartão pede confirmação e arquiva pelo caminho do Mês, com o post planejado junto; pauta parecida ganha o aviso", async () => {
    const hoje = new Date();
    const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    mock.from.mockImplementation(
      bancoFalso({
        projects: [{ id: "p1", client_id: CLIENTE, deleted_at: null }],
        tasks: [
          { id: "i-1", title: "Carrossel | Você reconheceria Florianópolis só por esta silhueta?", due_date: dia, delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null },
          { id: "i-2", title: "Carrossel | Você reconheceria Florianópolis só por esta silhueta?", due_date: dia, delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null },
        ],
        estudio_trabalhos: [],
        editorial_post_internal: [],
        editorial_posts: [],
        editorial_publications: [],
        staff_files_secure: [],
        calendario_propostas: [],
        task_attachments: [],
      }),
    );
    mock.invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => {
      if (body.acao === "arquivar_item_agenda") return { data: { task_id: body.task_id, titulo: "x", memoria_id: "m1", post_arquivado: null }, error: null };
      return { data: {}, error: null };
    });
    montar(`/mesa?client=${CLIENTE}&aba=estudio`);
    const botoes = await screen.findAllByRole("button", { name: /^Arquivar Carrossel/ });
    expect(botoes.length).toBe(2);
    expect(screen.getAllByText("parecida com outra").length).toBe(2);
    fireEvent.click(botoes[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(mock.invoke.mock.calls.some((c) => (c[1] as any).body.acao === "arquivar_item_agenda")).toBe(true));
    const corpo = (mock.invoke.mock.calls.filter((c) => (c[1] as any).body.acao === "arquivar_item_agenda")[0][1] as any).body;
    expect(corpo).toMatchObject({ client_id: CLIENTE, task_id: "i-1", confirmar_arte: true, arquivar_post: true });
  });
});
