import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  blocoDoJaDito,
  escreverRitual,
  limiteDoRitual,
  montarPedidoAoEscritor,
  numerosDoTexto,
  pontosDaVersao,
  SEM_NOVIDADE,
  SYSTEM_PROMPT,
} from "../../supabase/functions/ritual-writer/escritor";
import { acabamentoDoRitual } from "../../supabase/functions/ritual-writer/modulos/acabamento";

// 19/10 (o dono): "ele está burro, sempre repete a mesma coisa, é muito textão, os clientes já estão de saco
// cheio dessas mensagens". Em 30 dias, 83 de 89 rituais saíram pela reserva, com 1.300 a 2.400 caracteres,
// e a mesma abertura, o mesmo título e o mesmo "R$ 2 por contato" toda semana.

const ANTERIOR =
  "Boa tarde, Simone. Fechamos a semana mostrando o que a gente combinou: os anúncios mantiveram o volume de contatos acima da semana anterior.\n\nEntre 03/10 e 09/10, investimos R$ 100 nos anúncios e trouxemos 47 conversas no WhatsApp, mantendo o custo por contato em R$ 2.";
const anteriores = [{ quando: "2026-10-09T18:00:00Z", titulo: "Semana fecha com anúncios em alta", texto: ANTERIOR }];

const REPETIDA =
  "Boa tarde, Simone. Fechamos a semana mostrando o que a gente combinou: os anúncios mantiveram o volume de contatos acima da semana anterior.\n\nInvestimos R$ 100 nos anúncios e trouxemos 47 conversas no WhatsApp, mantendo o custo por contato em R$ 2.\n\nTudo no painel: aceleriq.online";
const NOVA =
  "Boa tarde, Simone. O carrossel dos quartos entrou no ar ontem e já é o post mais salvo do mês.\n\nNa segunda começa a collab de almoço, para trazer quem já está na cidade.\n\nTudo no painel: aceleriq.online";

const resposta = (body: string, extra: Record<string, unknown> = {}) => ({
  texto: JSON.stringify({ title: "t", body, next_steps: "próximo", alertas: [], tarefas_sugeridas: [], ...extra }),
  modelo: "openrouter:openai/gpt-6-luna",
  rotulo: "GPT-6 Luna",
  raciocinio: "medium",
  custoUsd: 0.001,
  reserva: null,
});

// 23/10: relógio fixo (sexta, 15:30 em São Paulo) porque a saudação sai do horário; o texto escolhido passa
// pelo acabamento (https, saudação, "fechamento da semana" e a linha do painel) antes da escolha.
const agora = new Date("2026-10-23T18:30:00Z");
const pedido = { ritual: "prova_movimento", clientName: "Mirante", contactName: "Simone", facts: "fatos", clientId: "c1", jaDito: anteriores, agora };
const acabado = (b: string) => acabamentoDoRitual(b, { ritual: "prova_movimento", agora, contato: "Simone", negocio: "Mirante" }).texto;

describe("ritual curto e sem repetir", () => {
  it("o roteiro pede até 6 linhas na semana e o bloco JÁ DITO entra antes dos fatos", () => {
    expect(SYSTEM_PROMPT).toContain("de 3 a 6 linhas no total, até 600 caracteres");
    expect(SYSTEM_PROMPT).toContain("no máximo UM número por mensagem da semana");
    expect(SYSTEM_PROMPT).toContain('"sem_novidade":false');
    expect(SYSTEM_PROMPT).not.toContain("Entre 10 e 18 linhas");
    const usuario = montarPedidoAoEscritor(pedido);
    expect(usuario.indexOf("JÁ DITO A ESTE CLIENTE")).toBeGreaterThan(-1);
    expect(usuario.indexOf("JÁ DITO A ESTE CLIENTE")).toBeLessThan(usuario.indexOf("FATOS DO PAINEL"));
    expect(limiteDoRitual("rota_semana")).toEqual({ linhas: 6, caracteres: 650 });
    expect(limiteDoRitual("radar_aceleriq").linhas).toBe(14);
  });

  it("o JÁ DITO traz data, título, abertura e os números citados", () => {
    const bloco = blocoDoJaDito(anteriores);
    expect(bloco).toContain("- 09/10: título \"Semana fecha com anúncios em alta\"");
    expect(bloco).toContain("abertura \"Fechamos a semana mostrando o que a gente combinou");
    expect(bloco).toContain("R$ 100");
    expect(bloco).toContain("47 conversas");
    expect(blocoDoJaDito([])).toBe("");
    expect(numerosDoTexto("R$ 2 por contato, 41 conversas e 12% a mais; R$ 2 de novo")).toEqual(["R$ 2", "41 conversas", "12%"]);
  });

  it("a regra pontua menos a versão que repete e a que passa do tamanho", () => {
    expect(pontosDaVersao(NOVA, "prova_movimento", anteriores)).toBeGreaterThan(pontosDaVersao(REPETIDA, "prova_movimento", anteriores));
    const longa = Array.from({ length: 14 }, (_, i) => `Linha ${i} com o carrossel dos quartos e a collab de almoço.`).join("\n");
    expect(pontosDaVersao(longa, "prova_movimento", [])).toBeLessThan(pontosDaVersao(NOVA, "prova_movimento", []));
  });

  it("escreve duas versões em paralelo e fica a que não repete, mesmo sem o Jev", async () => {
    const escrever = vi.fn()
      .mockResolvedValueOnce(resposta(REPETIDA))
      .mockResolvedValueOnce(resposta(NOVA));
    const julgar = vi.fn(async () => null);
    const r = await escreverRitual(pedido, escrever as never, julgar);
    expect(escrever).toHaveBeenCalledTimes(2);
    expect(String(escrever.mock.calls[1][0].usuario)).toContain("VERSÃO B");
    expect(r?.body).toBe(acabado(NOVA));
    expect(r?.escolha_da_versao).toMatchObject({ versoes: 2, escolhida: 1, jev: false });
  });

  it("com o Jev, a nota de novidade e clareza decide entre versões parecidas", async () => {
    const outra = "Boa tarde, Simone. A collab de almoço foi fechada e entra no ar na segunda.\n\nO carrossel dos quartos segue agendado.\n\nTudo no painel: aceleriq.online";
    const escrever = vi.fn().mockResolvedValueOnce(resposta(NOVA)).mockResolvedValueOnce(resposta(outra));
    const julgar = vi.fn(async () => [{ novidade: 1, clareza: 1 }, { novidade: 3, clareza: 3 }]);
    const r = await escreverRitual(pedido, escrever as never, julgar);
    // 23/10: o Jev julga o texto já acabado e recebe os fatos (para conferir a fidelidade).
    expect(julgar).toHaveBeenCalledWith([acabado(NOVA), acabado(outra)], anteriores, { clientId: "c1", criadoPor: null }, "fatos");
    expect(r?.body).toBe(acabado(outra));
    expect(r?.escolha_da_versao?.jev).toBe(true);
  });

  it("uma versão só no aprimorar; uma versão que falha não derruba a outra", async () => {
    const escrever = vi.fn().mockResolvedValue(resposta(NOVA));
    await escreverRitual({ ...pedido, textoAtual: "texto que a equipe ajustou" }, escrever as never, vi.fn());
    expect(escrever).toHaveBeenCalledTimes(1);
    const metade = vi.fn().mockRejectedValueOnce(new Error("fora")).mockResolvedValueOnce(resposta(NOVA));
    const r = await escreverRitual(pedido, metade as never, vi.fn(async () => null));
    expect(r?.body).toBe(acabado(NOVA));
    expect(r?.escolha_da_versao).toBeNull();
  });

  it("sem novidade, a equipe recebe o aviso; mensagem longa demais também avisa", async () => {
    const curta = "Boa tarde, Simone. O carrossel dos quartos segue em produção.\n\nNa segunda ele entra no ar.";
    const escrever = vi.fn().mockResolvedValue(resposta(curta, { sem_novidade: true }));
    const r = await escreverRitual({ ...pedido, textoAtual: "x" }, escrever as never, vi.fn());
    expect(r?.sem_novidade).toBe(true);
    expect(r?.alertas[0]).toBe(SEM_NOVIDADE);
    const longa = Array.from({ length: 12 }, (_, i) => `Linha ${i}.`).join("\n");
    const r2 = await escreverRitual({ ...pedido, textoAtual: "x" }, vi.fn().mockResolvedValue(resposta(longa)) as never, vi.fn());
    // 23/10: a linha do painel entra pelo acabamento: 12 linhas da IA + 1.
    expect(r2?.alertas.join(" ")).toContain("A mensagem saiu com 13 linhas (o combinado é até 6)");
  });
});

describe("portal sem texto interno (19/10)", () => {
  // Em 09/10, 15 clientes receberam no portal a preparação interna do Hermes ("corte 09/10", "não comprova").
  const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261019120000_portal_sem_texto_interno.sql"), "utf8");
  const titulo = /prepara(ç|c)(ã|a)o interna|corte [0-9]{2}\/[0-9]{2}/i;
  const texto = /prepara(ç|c)(ã|a)o interna|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it("o banco recusa publicar com marca de nota interna, só quando vira publicado ou o texto publicado muda", () => {
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF status, summary, title ON public.reports");
    expect(sql).toContain("RAISE EXCEPTION 'TEXTO_INTERNO_NO_PORTAL");
    expect(sql).toContain("OR OLD.status IS DISTINCT FROM 'published'");
    expect(sql).toContain("SET search_path = public, pg_temp");
  });

  it("as marcas pegam a preparação interna e deixam passar a mensagem para o cliente", () => {
    expect(titulo.test("SKC | Fechamento semanal parcial 05–11/10 | corte 09/10")).toBe(true);
    expect(texto.test("Preparação interna para revisão; corte 09/10/2026")).toBe(true);
    expect(texto.test("Contrato 5061ae81-7e47-41c5-9a0c-ee368d37f1d9 completed")).toBe(true);
    expect(titulo.test("Carrossel dos quartos entra em produção")).toBe(false);
    expect(texto.test("Bom dia, Simone. O carrossel dos quartos entra no ar na quarta, 21/10.")).toBe(false);
  });
});
