// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  acoesDoCarrossel, destaquesEscolhidos, numeroConferido, numerosDoTrecho, perguntasDeDestaque, type DepsDoCarrossel,
} from "../../supabase/functions/estudio-arte/modulos/template-carrossel";
import { alternarNegrito, aplicarDestaques, candidatosDeDestaque, limitarDestaques, semNegrito, trechosEmNegrito } from "../../supabase/functions/estudio-arte/modulos/destaques-do-texto";
import type { TrabalhoDaGeracao } from "../../supabase/functions/estudio-arte/modulos/template-geracao";
import { normalizarTemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";

/**
 * Template Carrossel X (23/10): quebra de linha, negrito por palavra, destaques pelo Jev, gráfico e manchete
 * pela IA só com dado real, preencher uma lâmina só e o bloco do perfil (a chamada "Siga").
 */
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TRABALHO = "22222222-2222-4222-8222-222222222222";
const ch = { userId: "equipe" };
const erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Object.assign(new Error(mensagem), { status, codigo, detalhes });
type T = TrabalhoDaGeracao & { custo_usd: number };
const json = async (r: Response) => JSON.parse(await r.text());

describe("negrito por palavra (botão B e Ctrl+B)", () => {
  it("a seleção vira negrito e, selecionada de novo, sai do negrito; a seleção volta ao mesmo trecho", () => {
    const t = "A IA já faz 3 dias em 1.";
    const r = alternarNegrito(t, t.indexOf("3 dias"), t.indexOf("3 dias") + 6);
    expect(r.texto).toBe("A IA já faz **3 dias** em 1.");
    expect(r.texto.slice(r.inicio, r.fim)).toBe("3 dias");
    const volta = alternarNegrito(r.texto, r.inicio, r.fim);
    expect(volta.texto).toBe(t);
  });
  it("sem seleção vale a palavra do cursor; o espaço fica fora dos asteriscos; emoji não desalinha", () => {
    expect(alternarNegrito("Olha 🔥 isso aqui", 9, 9).texto).toBe("Olha 🔥 **isso** aqui");
    expect(alternarNegrito("um dois três", 2, 8).texto).toBe("um **dois** três");
  });
  it("a quebra de linha fica: cada linha leva o próprio par de asteriscos", () => {
    const t = "Primeira linha\nsegunda linha";
    const r = alternarNegrito(t, 0, t.length);
    expect(r.texto).toBe("**Primeira linha**\n**segunda linha**");
    expect(trechosEmNegrito(r.texto)).toEqual(["Primeira linha", "segunda linha"]);
    expect(semNegrito(r.texto)).toBe(t);
  });
});

describe("destaques bons: 1 a 3 trechos curtos, nunca a frase inteira", () => {
  it("o excesso perde o negrito (frase inteira e mais de 3 trechos)", () => {
    expect(limitarDestaques("**Toda esta frase longa está em negrito sem motivo nenhum**")).toBe("Toda esta frase longa está em negrito sem motivo nenhum");
    const muitos = limitarDestaques("**um** dois **três** quatro **cinco** seis **sete** oito nove dez onze doze treze");
    expect(trechosEmNegrito(muitos)).toHaveLength(3);
  });
  it("candidatos do código: valores, números com unidade e palavras fortes; aplicar marca a primeira ocorrência", () => {
    const c = candidatosDeDestaque("O INSS negou 40% dos pedidos e o prazo é de 30 dias. Revisão custa R$ 1.200.");
    expect(c).toEqual(expect.arrayContaining(["R$ 1.200", "40%", "30 dias"]));
    expect(aplicarDestaques("O prazo é de 30 dias.", ["30 dias"])).toBe("O prazo é de **30 dias**.");
  });
  it("o Jev julga cada candidato (Noul): até 2 por lâmina acima de 55%, ou o melhor acima de 35%", () => {
    const { perguntas, candidatos } = perguntasDeDestaque([{ ordem: 1, texto: "O INSS negou 40% dos pedidos em 30 dias." }]);
    expect(Object.values(perguntas).every((p) => p.type === "noul")).toBe(true);
    const ids = Object.keys(candidatos);
    const altos = destaquesEscolhidos({ [ids[0]]: { noul: 0.9 }, [ids[1]]: { noul: 0.7 }, [ids[2]]: { noul: 0.6 } }, candidatos);
    expect(altos[1]).toHaveLength(2);
    const baixo = destaquesEscolhidos({ [ids[0]]: { noul: 0.4 }, [ids[1]]: { noul: 0.2 } }, candidatos);
    expect(baixo[1]).toEqual([candidatos[ids[0]].trecho]);
  });
});

describe("números conferidos na fonte (o gráfico por IA não inventa)", () => {
  it("lê número em português e confere o trecho na fonte", () => {
    expect(numerosDoTrecho("R$ 1.200 e 3,5% em 2 mil casos")).toEqual(expect.arrayContaining([1200, 3.5, 2, 2000]));
    expect(numeroConferido(40, "negou 40% dos pedidos", "O INSS negou 40% dos pedidos em 2026.")).toBe(true);
    expect(numeroConferido(45, "negou 40% dos pedidos", "O INSS negou 40% dos pedidos em 2026.")).toBe(false);
    expect(numeroConferido(40, "negou 40% das revisões", "O INSS negou 40% dos pedidos em 2026.")).toBe(false);
  });
});

function cenario(o: { redator?: unknown; jev?: Record<string, { choice?: string; confidence?: number; noul?: number }>; noticias?: Array<{ titulo: string; fonte: string; link: string; data?: string; resumo?: string }> } = {}) {
  let atual: T = {
    id: TRABALHO, client_id: CLIENTE, status: "dirigido", tipo: "social", entrega_status: null, legenda: null, custo_usd: 1, modelo_imagem_id: "gpt-image",
    direcao: { conceito: "Revisão de aposentadoria no INSS", formato: "feed_4x5", cards: [{ ordem: 1, texto_exato: "O INSS negou 40% dos pedidos\n\nE agora?" }, { ordem: 2, texto_exato: "Revisão em 30 dias." }, { ordem: 3, texto_exato: "Siga" }] } as T["direcao"],
    cards: [],
  };
  const escrever = vi.fn(async (..._a: unknown[]) => ({ json: o.redator, custoUsd: 0.02 }));
  const jev = vi.fn(async (..._a: unknown[]) => ({ answers: o.jev || {}, custoUsd: 0.001 }));
  const deps: DepsDoCarrossel<typeof ch, T> = {
    erro, json: (b) => new Response(JSON.stringify(b)),
    trabalhoComAcesso: vi.fn(async () => structuredClone(atual)),
    mutarTrabalho: vi.fn(async (_id, mudar) => { atual = { ...atual, ...mudar(structuredClone(atual)) } as T; return structuredClone(atual); }),
    ehPostDeFotos: () => false,
    atualizarTexto: (t, ordem, texto) => ({ ...t.direcao, cards: t.direcao.cards.map((c) => (c.ordem === ordem ? { ...c, texto_exato: texto } : c)) }),
    estimarTexto: vi.fn(async () => 0.03), escreverTexto: escrever, perguntarJev: jev,
    jsonDoCommons: vi.fn(async () => ({})), jsonDoPexels: null,
    noticiasDoAssunto: vi.fn(async () => o.noticias || []),
    baixarVideo: vi.fn(async () => null), guardarVideo: vi.fn(async () => ""),
    pedirRender: vi.fn(), pedidosDaLamina: vi.fn(async () => []), linkAssinado: vi.fn(async () => null),
  } as unknown as DepsDoCarrossel<typeof ch, T>;
  return { acoes: acoesDoCarrossel(deps), escrever, jev, ler: () => atual };
}
const NOTICIAS = [
  { titulo: "Receita divulga calendário do IR", fonte: "g1", link: "https://g1.globo.com/ir", data: "2026-10-20" },
  { titulo: "INSS nega 40% dos pedidos de aposentadoria em 2026", fonte: "Folha", link: "https://folha.uol.com.br/inss", data: "2026-10-22", resumo: "O INSS negou 40% dos pedidos e 25% foram revistos na Justiça." },
];

describe("template_destaques: o Jev destaca as melhores palavras (custo antes)", () => {
  it("409 antes; depois o negrito sai dos candidatos escolhidos, com a quebra de linha intacta", async () => {
    const c = cenario();
    await expect(c.acoes.template_destaques(ch, { trabalho_id: TRABALHO, ordem: 1 })).rejects.toMatchObject({ status: 409, codigo: "confirmar_custo" });
    expect(c.jev).not.toHaveBeenCalled();
    const { candidatos } = perguntasDeDestaque([{ ordem: 1, texto: "O INSS negou 40% dos pedidos\n\nE agora?" }]);
    const id40 = Object.keys(candidatos).find((k) => candidatos[k].trecho === "40%")!;
    const d = cenario({ jev: { [id40]: { noul: 0.92 } } });
    const r = await json(await d.acoes.template_destaques(ch, { trabalho_id: TRABALHO, ordem: 1, confirmado: true }));
    expect(d.ler().direcao.cards[0].texto_exato).toBe("O INSS negou **40%** dos pedidos\n\nE agora?");
    expect(r.laminas[0].destaques).toEqual(["40%"]);
    expect(d.ler().custo_usd).toBeCloseTo(1.001);
  });
});

describe("template_bloco_ia: gráfico e manchete com dado real", () => {
  it("manchete: o Jev escolhe a notícia real da lâmina; nenhuma, 422 sem inventar", async () => {
    const c = cenario({ noticias: NOTICIAS, jev: { noticia: { choice: "n2", confidence: 0.86 } } });
    await expect(c.acoes.template_bloco_ia(ch, { trabalho_id: TRABALHO, ordem: 1, tipo: "manchete" })).rejects.toMatchObject({ status: 409 });
    const r = await json(await c.acoes.template_bloco_ia(ch, { trabalho_id: TRABALHO, ordem: 1, tipo: "manchete", confirmado: true }));
    expect(r.manchete).toMatchObject({ veiculo: "Folha", titulo: "INSS nega 40% dos pedidos de aposentadoria em 2026", url: "https://folha.uol.com.br/inss", data: "22/10/2026" });
    expect(c.jev.mock.calls[0][2]).toMatchObject({ noticia: { type: "choice" } });
    const nenhuma = cenario({ noticias: NOTICIAS, jev: { noticia: { choice: "nenhuma" } } });
    await expect(nenhuma.acoes.template_bloco_ia(ch, { trabalho_id: TRABALHO, ordem: 1, tipo: "manchete", confirmado: true })).rejects.toMatchObject({ status: 422, codigo: "sem_dado_real" });
    const sem = cenario({ noticias: [] });
    await expect(sem.acoes.template_bloco_ia(ch, { trabalho_id: TRABALHO, ordem: 1, tipo: "manchete", confirmado: true })).rejects.toMatchObject({ codigo: "sem_dado_real" });
    expect(sem.jev).not.toHaveBeenCalled();
  });
  it("gráfico: só ficam os números achados no trecho da fonte; com menos de dois, 422", async () => {
    const redator = { tipo: "barras", titulo: "Pedidos no INSS", unidade: "%", fonte: 6, dados: [
      { rotulo: "Negados", valor: 40, trecho: "O INSS negou 40% dos pedidos" },
      { rotulo: "Revistos", valor: 25, trecho: "25% foram revistos na Justiça" },
      { rotulo: "Inventado", valor: 90, trecho: "90% ganham" },
    ] };
    const c = cenario({ noticias: NOTICIAS, redator });
    const r = await json(await c.acoes.template_bloco_ia(ch, { trabalho_id: TRABALHO, ordem: 1, tipo: "grafico", confirmado: true }));
    expect(r.grafico).toEqual({ tipo: "barras", titulo: "Pedidos no INSS", unidade: "%", fonte: "Folha", dados: [{ rotulo: "Negados", valor: 40 }, { rotulo: "Revistos", valor: 25 }] });
    expect(r.fonte).toEqual({ nome: "Folha", url: "https://folha.uol.com.br/inss" });
    expect(r.descartados).toBe(1);
    const fraco = cenario({ noticias: NOTICIAS, redator: { ...redator, dados: [redator.dados[2]] } });
    await expect(fraco.acoes.template_bloco_ia(ch, { trabalho_id: TRABALHO, ordem: 1, tipo: "grafico", confirmado: true })).rejects.toMatchObject({ status: 422, codigo: "sem_dado_real" });
    expect(fraco.ler().custo_usd).toBeCloseTo(1.02);
  });
  it("número grande aceita um valor só", async () => {
    const c = cenario({ redator: { tipo: "numero", titulo: "Negados", unidade: "%", fonte: 2, dados: [{ rotulo: "dos pedidos negados", valor: 40, trecho: "negou 40% dos pedidos" }] } });
    const r = await json(await c.acoes.template_bloco_ia(ch, { trabalho_id: TRABALHO, ordem: 1, tipo: "grafico", confirmado: true }));
    expect(r.grafico).toMatchObject({ tipo: "numero", dados: [{ valor: 40 }], fonte: "Lâmina 1" });
  });
});

describe("gerador: destaques e uma lâmina só", () => {
  const REDATOR = { laminas: [{ ordem: 1, texto: "O INSS negou 40% dos pedidos.\nVeja por quê →", busca: "", dados: [], tipo_de_grafico: "", unidade: "", fonte_dos_dados: "" }, { ordem: 2, texto: "**Revisão em 30 dias resolve a maior parte dos casos negados**", busca: "", dados: [], tipo_de_grafico: "", unidade: "", fonte_dos_dados: "" }], legenda: "Legenda #inss" };
  it("lâmina sem negrito ganha o destaque do Jev no mesmo pedido da mídia; negrito na frase inteira sai", async () => {
    const { candidatos } = perguntasDeDestaque([{ ordem: 1, texto: REDATOR.laminas[0].texto }]);
    const id40 = Object.keys(candidatos).find((k) => candidatos[k].trecho === "40%")!;
    const c = cenario({ redator: REDATOR, jev: { midia_1: { choice: "so_texto", confidence: 0.8 }, midia_2: { choice: "so_texto", confidence: 0.8 }, [id40]: { noul: 0.9 } } });
    await c.acoes.template_carrossel(ch, { trabalho_id: TRABALHO, ordem: 1, assunto: "INSS", confirmado: true });
    expect(c.jev).toHaveBeenCalledTimes(1);
    expect(c.ler().direcao.cards[0].texto_exato).toBe("O INSS negou **40%** dos pedidos.\nVeja por quê →");
    expect(c.ler().direcao.cards[1].texto_exato).toBe("Revisão em 30 dias resolve a maior parte dos casos negados");
  });
  it("so_esta reescreve só a lâmina aberta e não grava a legenda", async () => {
    const c = cenario({ redator: { laminas: [{ ...REDATOR.laminas[1], ordem: 2, texto: "Revisão em **30 dias**." }], legenda: "nova" }, jev: { midia_2: { choice: "so_texto" } } });
    await c.acoes.template_carrossel(ch, { trabalho_id: TRABALHO, ordem: 2, assunto: "INSS", confirmado: true, so_esta: true, gravar_legenda: true });
    expect((c.escrever.mock.calls[0][2] as { pedido: { ordens_pedidas: number[] } }).pedido.ordens_pedidas).toEqual([2]);
    expect(c.ler().direcao.cards.map((x) => x.texto_exato)).toEqual(["O INSS negou 40% dos pedidos\n\nE agora?", "Revisão em **30 dias**.", "Siga"]);
    expect(c.ler().legenda).toBeNull();
  });
});

describe("normalizador: perfil (Siga) e número grande", () => {
  const base = { versao: 1, estilo: "carrossel", nome: "Thainá", username: "thaina", texto: "Siga →", cor_fundo: "#ffffff" };
  it("o perfil guarda os dados de Redes editáveis e recusa @ inválido", () => {
    const t = normalizarTemplateProfile({ ...base, bloco: { tipo: "perfil", perfil: { estilo: "instagram", nome: "Thainá Rosa", username: "@thaina.adv", bio: "Advogada previdenciária\nCuritiba", posts: 120, seguidores: 3400, seguindo: 210 } } }, CLIENTE, erro);
    expect(t.bloco?.perfil).toEqual({ estilo: "instagram", nome: "Thainá Rosa", username: "thaina.adv", bio: "Advogada previdenciária\nCuritiba", posts: 120, seguidores: 3400, seguindo: 210 });
    expect(() => normalizarTemplateProfile({ ...base, bloco: { tipo: "perfil", perfil: { estilo: "x", nome: "A", username: "não vale" } } }, CLIENTE, erro)).toThrow("@");
  });
  it("número grande com um valor", () => {
    const t = normalizarTemplateProfile({ ...base, bloco: { tipo: "grafico", grafico: { tipo: "numero", dados: [{ rotulo: "negados", valor: 40 }] } } }, CLIENTE, erro);
    expect(t.bloco?.grafico).toMatchObject({ tipo: "numero", dados: [{ valor: 40 }] });
  });
});
