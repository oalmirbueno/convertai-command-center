import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  acabamentoDoRitual,
  LINHA_DO_PAINEL,
  LINK_DO_PAINEL,
  linksComHttps,
  momentoDaSemana,
  saudacaoPelaHora,
  textoNaHoraDoEnvio,
} from "../../supabase/functions/ritual-writer/modulos/acabamento";
import {
  ajustarRitual,
  frasesQueSumiram,
  pedidoMexeNoTexto,
} from "../../supabase/functions/ritual-writer/modulos/ajuste";
import { avisoDeFidelidade, escreverRitual, montarPedidoAoEscritor, pontosDaVersao, SYSTEM_PROMPT } from "../../supabase/functions/ritual-writer/escritor";

/**
 * 23/10/2026 (dono): "No ritual das mensagens está de forma rápida, mas a mensagem está muito ruim. Eu peço
 * conversa com ele e, em vez dele complementar, ele refaz toda a mensagem. Todas as mensagens têm que ter o
 * HTTPS antes do link. Todas têm que falar bom dia, boa tarde, conforme o ritual, e têm que falar que é
 * fechamento da semana, meio da semana ou início da semana. Para conferir o restante, tudo no painel."
 *
 * Banco (09/10 a 23/10, 80 mensagens publicadas): 0 com https; segunda 19/10 "Boa tarde" às 09:49; quarta
 * 21/10 "Boa tarde" às 18:30; nenhuma sexta de 23/10 disse "fechamento da semana"; "Boa tarde, Casa Dos
 * Assados." (o negócio tratado como pessoa); a Acerbi teve 4 versões em 15 minutos e cada pedido refez tudo.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");

// Horários em São Paulo (UTC-3).
const SEG_0949 = new Date("2026-10-19T12:49:00Z");
const QUA_1830 = new Date("2026-10-21T21:30:00Z");
const SEX_1530 = new Date("2026-10-23T18:30:00Z");

describe("todo link com https", () => {
  it("domínio solto, www. e http:// ganham https; e-mail e link certo ficam como estão", () => {
    expect(linksComHttps("Tudo no painel: aceleriq.online")).toBe("Tudo no painel: https://aceleriq.online");
    expect(linksComHttps("Veja em www.terraflor.com.br/projetos.")).toBe("Veja em https://www.terraflor.com.br/projetos.");
    expect(linksComHttps("O site novo: http://thainarosa.adv.br")).toBe("O site novo: https://thainarosa.adv.br");
    expect(linksComHttps("Chama em wa.me/5541999999999, ok?")).toBe("Chama em https://wa.me/5541999999999, ok?");
    expect(linksComHttps("Perfil instagram.com/softymoveis")).toBe("Perfil https://instagram.com/softymoveis");
    expect(linksComHttps("Manda para contato@softy.com.br")).toBe("Manda para contato@softy.com.br");
    expect(linksComHttps("Já certo: https://aceleriq.online/onde-estamos")).toBe("Já certo: https://aceleriq.online/onde-estamos");
    // Número e valor não são link.
    expect(linksComHttps("R$ 2.500 em 23/10, 4.620 pessoas")).toBe("R$ 2.500 em 23/10, 4.620 pessoas");
  });

  it("nenhum link sem https sobra na mensagem acabada, e a linha do painel aparece uma vez só", () => {
    const { texto } = acabamentoDoRitual(
      "Boa tarde, Jobson. O post novo está em www.terraflor.com.br.\n\nÓtimo fim de semana! Tudo no painel: aceleriq.online",
      { ritual: "prova_movimento", agora: SEX_1530, contato: "Jobson", negocio: "Terra Flor" },
    );
    const links = texto.match(/(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.(online|com|br)(\/\S*)?/gi) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.startsWith("https://")).toBe(true);
    expect(texto.split(LINK_DO_PAINEL).length - 1).toBe(1);
    expect(texto.endsWith(LINHA_DO_PAINEL)).toBe(true);
    expect(texto).toContain("Ótimo fim de semana!");
  });
});

describe("saudação pelo horário do envio (São Paulo)", () => {
  it("bom dia de manhã, boa tarde até as 18h, boa noite depois", () => {
    expect(saudacaoPelaHora(SEG_0949)).toBe("Bom dia");
    expect(saudacaoPelaHora(SEX_1530)).toBe("Boa tarde");
    expect(saudacaoPelaHora(QUA_1830)).toBe("Boa noite");
    expect(saudacaoPelaHora(new Date("2026-10-23T15:00:00Z"))).toBe("Boa tarde"); // 12:00
    expect(saudacaoPelaHora(new Date("2026-10-23T14:59:00Z"))).toBe("Bom dia"); // 11:59
  });

  it("corrige a saudação errada e nunca chama o negócio de pessoa", () => {
    // Segunda 19/10 às 09:49 saiu "Boa tarde, Thainá".
    expect(acabamentoDoRitual("Boa tarde, Thainá. Começando a semana com o carrossel no ar.", { ritual: "rota_semana", agora: SEG_0949, contato: "Thainá" }).texto)
      .toMatch(/^Bom dia, Thainá\. Começando a semana/);
    // Quarta 21/10 às 18:30 saiu "Boa tarde, Casa Dos Assados.".
    const casa = acabamentoDoRitual("Boa tarde, Casa Dos Assados. Meio da semana com as ofertas prontas.", { ritual: "meio_semana", agora: QUA_1830, contato: "", negocio: "Casa Dos Assados" });
    expect(casa.texto).toMatch(/^Boa noite! Meio da semana/);
    expect(casa.acertos.join(" ")).toContain("nome do negócio");
    // "Luiz, os anúncios..." (sem saudação) vira "Boa tarde, Luiz. Os anúncios...".
    expect(acabamentoDoRitual("Luiz, os anúncios voltaram e fechando a semana já são 5 conversas.", { ritual: "prova_movimento", agora: SEX_1530, contato: "Luiz" }).texto)
      .toMatch(/^Boa tarde, Luiz\. Os anúncios voltaram/);
  });

  it("na hora de copiar, a saudação passa a valer o horário do envio, sem mexer no resto", () => {
    const gerada = acabamentoDoRitual("Boa tarde, Simone. Fechando a semana com 66 contatos.", { ritual: "prova_movimento", agora: SEX_1530, contato: "Simone" }).texto;
    const copiada = textoNaHoraDoEnvio(gerada, "prova_movimento", new Date("2026-10-23T21:40:00Z"));
    expect(copiada).toBe(gerada.replace("Boa tarde", "Boa noite"));
    // Idempotente.
    expect(textoNaHoraDoEnvio(copiada, "prova_movimento", new Date("2026-10-23T21:40:00Z"))).toBe(copiada);
  });
});

describe("início, meio e fechamento da semana", () => {
  it("o ritual decide; sem ritual da semana, o dia decide", () => {
    expect(momentoDaSemana("rota_semana", SEX_1530)).toBe("inicio");
    expect(momentoDaSemana("meio_semana", SEG_0949)).toBe("meio");
    expect(momentoDaSemana("prova_movimento", SEG_0949)).toBe("fechamento");
    expect(momentoDaSemana(null, SEG_0949)).toBe("inicio");
    expect(momentoDaSemana(null, QUA_1830)).toBe("meio");
    expect(momentoDaSemana(null, SEX_1530)).toBe("fechamento");
    expect(momentoDaSemana("radar_aceleriq", SEX_1530)).toBeNull();
  });

  it("acrescenta o momento quando a mensagem não disse, logo depois da saudação, e não duplica", () => {
    // As sextas de 23/10 não diziam que era fechamento da semana.
    const sexta = acabamentoDoRitual("Boa tarde, Simone. Os anúncios trouxeram 66 contatos de 17/10 a 23/10.", { ritual: "prova_movimento", agora: SEX_1530, contato: "Simone" });
    expect(sexta.texto).toMatch(/^Boa tarde, Simone\. [^.]*fechamento da semana|^Boa tarde, Simone\. Fechando a semana/i);
    expect(sexta.texto).toContain("Os anúncios trouxeram 66 contatos");
    const segunda = acabamentoDoRitual("Bom dia, Andreus. O anúncio do Instagram entra no ar hoje.", { ritual: "rota_semana", agora: SEG_0949, contato: "Andreus" });
    expect(segunda.texto).toMatch(/in[ií]cio de semana|come[çc]ando a semana|abrindo a semana/i);
    const quarta = acabamentoDoRitual("Boa noite, Thiélo. A arte de poda foi aprovada.", { ritual: "meio_semana", agora: QUA_1830, contato: "Thiélo" });
    expect(quarta.texto).toMatch(/meio da semana/i);
    const jaDisse = "Boa tarde, Priscila. Fechando a semana, o vídeo de Halloween está pronto.";
    const r = acabamentoDoRitual(jaDisse, { ritual: "prova_movimento", agora: SEX_1530, contato: "Priscila" });
    expect(r.texto.startsWith(jaDisse)).toBe(true);
    expect(r.texto.match(/semana/gi)?.length).toBe(1);
  });
});

describe("o escritor pede e confere", () => {
  it("o pedido leva a saudação de agora e o momento; o roteiro não manda mais escrever o link sem https", () => {
    const u = montarPedidoAoEscritor({ ritual: "prova_movimento", clientName: "Mirante", contactName: "Simone", facts: "f", agora: SEX_1530 });
    expect(u).toContain("SAUDAÇÃO DE AGORA: Boa tarde");
    expect(u).toContain("MOMENTO DA SEMANA: fechamento da semana");
    expect(SYSTEM_PROMPT).not.toContain('Termine com "Tudo no painel: aceleriq.online"');
    expect(SYSTEM_PROMPT).toContain("ONDE ESTAMOS");
    expect(SYSTEM_PROMPT).toContain("O QUE VEM À FRENTE");
    expect(SYSTEM_PROMPT).toContain("28. POSITIVO E MOTIVADOR");
  });

  it("nada inventado: a versão que afirma o que não está nos fatos perde e, escolhida, vem com aviso", async () => {
    const fiel = "Boa tarde, Simone. Fechando a semana, o carrossel dos quartos entrou no ar.";
    const inventada = "Boa tarde, Simone. Fechando a semana, batemos 200 reservas pelo carrossel dos quartos.";
    expect(pontosDaVersao(fiel, "prova_movimento", [], { novidade: 3, clareza: 3, inventa: 0.05 }))
      .toBeGreaterThan(pontosDaVersao(inventada, "prova_movimento", [], { novidade: 3, clareza: 3, inventa: 0.9 }));
    const resposta = (body: string) => ({ texto: JSON.stringify({ title: "t", body, next_steps: "p", alertas: [] }), modelo: "m", rotulo: "M", raciocinio: "low", custoUsd: 0, reserva: null });
    const escrever = vi.fn().mockResolvedValueOnce(resposta(inventada)).mockResolvedValueOnce(resposta(fiel));
    const julgar = vi.fn(async () => [{ novidade: 3, clareza: 3, inventa: 0.92 }, { novidade: 2, clareza: 3, inventa: 0.04 }]);
    const r = await escreverRitual({ ritual: "prova_movimento", clientName: "Mirante", contactName: "Simone", facts: "Carrossel dos quartos publicado em 20/10.", clientId: "c1", agora: SEX_1530 }, escrever as never, julgar);
    expect(r?.body).toContain("o carrossel dos quartos entrou no ar");
    expect(r?.body).not.toContain("200 reservas");
    expect(r?.body.endsWith(LINHA_DO_PAINEL)).toBe(true);
    // Uma versão só (aprimorar): o Jev ainda confere e o aviso vai para a equipe.
    const so = await escreverRitual(
      { ritual: "prova_movimento", clientName: "Mirante", contactName: "Simone", facts: "f", clientId: "c1", agora: SEX_1530, textoAtual: "x" },
      vi.fn().mockResolvedValue(resposta(inventada)) as never,
      vi.fn(async () => [{ novidade: 2, clareza: 2, inventa: 0.8 }]),
    );
    expect(so?.alertas.join(" ")).toContain("pode não estar nos fatos");
    expect(avisoDeFidelidade(0.2)).toBeNull();
  });
});

describe("conversa que complementa (ajuste sobre o texto atual)", () => {
  const ATUAL = [
    "Boa tarde, Nelly. Fechando a semana, o vídeo publicado em 22/10 chegou a 205 pessoas e teve 2 compartilhamentos.",
    "",
    "A edição dos vídeos da palestra de adesivo está na reta final, com conclusão prevista para 30/10.",
    "",
    "Até 28/10, a gente prepara o conteúdo de Black Friday para orientar empresas e consumidores nas compras.",
    "",
    LINHA_DO_PAINEL,
  ].join("\n");
  const base = {
    ritual: "prova_movimento", anterior: ATUAL, fatos: "Vídeo 22/10: 205 pessoas, 2 compartilhamentos.",
    clientName: "Acerbi", contactName: "Nelly", clientId: "c1", agora: SEX_1530,
  };
  const modelo = (body: string) => vi.fn(async () => ({ texto: JSON.stringify({ body, title: "t", next_steps: "p", mudancas: ["x"] }), modelo: "m", rotulo: "M", raciocinio: "low", custoUsd: 0, reserva: null, usoId: "u1" }));
  const semJev = vi.fn(async () => { throw new Error("sem Jev"); });

  it("o modelo recebe a mensagem atual como base e o pedido; a escrita é uma só", async () => {
    const escrever = modelo(ATUAL);
    await ajustarRitual({ ...base, instrucao: "acrescenta que o carrossel da Black Friday sai dia 28" }, escrever as never, semJev as never);
    expect(escrever).toHaveBeenCalledTimes(1);
    const pedido = (escrever.mock.calls[0] as unknown as [{ usuario: string; sistema: string }])[0];
    expect(pedido.usuario).toContain("MENSAGEM ATUAL (a base");
    expect(pedido.usuario).toContain(ATUAL);
    expect(pedido.usuario).toContain("PEDIDO DO DONO (aplique só isto):\nacrescenta que o carrossel");
    expect(pedido.sistema).toContain("Toda frase que o pedido não toca volta IGUAL");
  });

  it("\"acrescenta X\" preserva o resto", async () => {
    const novo = ATUAL.replace(
      "para orientar empresas e consumidores nas compras.",
      "para orientar empresas e consumidores nas compras. O carrossel da Black Friday sai no dia 28.",
    );
    const r = await ajustarRitual({ ...base, instrucao: "acrescenta que o carrossel da Black Friday sai dia 28" }, modelo(novo) as never, semJev as never);
    expect(r?.perdidas).toEqual([]);
    expect(r?.tiradas).toEqual([]);
    expect(r?.alertas).toEqual([]);
    expect(r?.body).toContain("O carrossel da Black Friday sai no dia 28.");
    for (const f of ["205 pessoas", "palestra de adesivo", "Até 28/10, a gente prepara"]) expect(r?.body).toContain(f);
  });

  it("\"tira Y\" remove só Y", async () => {
    const novo = ATUAL.replace("A edição dos vídeos da palestra de adesivo está na reta final, com conclusão prevista para 30/10.\n\n", "");
    const r = await ajustarRitual({ ...base, instrucao: "tira a parte da palestra de adesivo, ela saiu do trabalho" }, modelo(novo) as never, semJev as never);
    expect(r?.tiradas).toHaveLength(1);
    expect(r?.tiradas[0]).toContain("palestra de adesivo");
    expect(r?.perdidas).toEqual([]);
    expect(r?.body).not.toContain("palestra de adesivo");
    expect(r?.body).toContain("205 pessoas");
    expect(r?.body).toContain("Black Friday");
  });

  it("o que some sem pedido vira aviso (Jev lê o pedido; sem Jev, vale a regra das palavras)", async () => {
    // Pediu para acrescentar, mas o modelo reescreveu e perdeu o vídeo de 22/10 (o que aconteceu em 23/10).
    const refeito = `Boa tarde, Nelly. Fechando a semana, a gente envia até 28/10 o conteúdo de Black Friday. O carrossel sai dia 28.\n\n${LINHA_DO_PAINEL}`;
    const r = await ajustarRitual({ ...base, instrucao: "acrescenta que o carrossel sai dia 28" }, modelo(refeito) as never, semJev as never);
    expect(r?.perdidas.join(" ")).toContain("205 pessoas");
    expect(r?.alertas[0]).toContain("Sumiu sem você pedir");
    expect(r?.alertas[0]).toContain("Desfazer");
    // Com o Jev: ele diz que o pedido não pedia tirar o trecho do vídeo, mas pedia tirar o da palestra.
    const jev = vi.fn(async (q: { state: { trechos: string[] } }) => ({
      answers: Object.fromEntries(q.state.trechos.map((t, i) => [`pedia_${i}`, { noul: /palestra/.test(t) ? 0.9 : 0.1 }])),
      usage: { input_tokens: 100, output_tokens: 1 }, modelo: "jev",
    }));
    const cobrar = vi.fn(async () => null);
    const semVideoNemPalestra = `Boa tarde, Nelly. Fechando a semana, até 28/10 a gente prepara o conteúdo de Black Friday para orientar empresas e consumidores nas compras.\n\n${LINHA_DO_PAINEL}`;
    const r2 = await ajustarRitual({ ...base, instrucao: "tira a palestra" }, modelo(semVideoNemPalestra) as never, jev as never, cobrar);
    expect(jev).toHaveBeenCalledTimes(1);
    // Toda pergunta ao Jev é cobrada (uma chamada, uma cobrança).
    expect(cobrar).toHaveBeenCalledTimes(1);
    expect(r2?.tiradas.join(" ")).toContain("palestra");
    expect(r2?.perdidas.join(" ")).toContain("205 pessoas");
  });

  it("as regras de diff e de pedido", () => {
    expect(pedidoMexeNoTexto("tira a parte da verba").tirar).toBe(true);
    expect(pedidoMexeNoTexto("não fala de verba").tirar).toBe(true);
    expect(pedidoMexeNoTexto("acrescenta o vídeo de sexta").tirar).toBe(false);
    expect(pedidoMexeNoTexto("acrescenta o vídeo de sexta").trocar).toBe(false);
    expect(pedidoMexeNoTexto("deixa mais curto").trocar).toBe(true);
    // Saudação e linha do painel não contam: o sistema refaz as duas.
    expect(frasesQueSumiram(ATUAL, ATUAL.replace("Boa tarde", "Boa noite"))).toEqual([]);
  });

  it("o agente da Central usa o ajuste quando há pedido e mensagem atual; a tela tem Ajustar e Desfazer", () => {
    const agente = ler("supabase/functions/agente-central/index.ts");
    expect(agente).toContain("if (instrucao && anterior) {");
    expect(agente).toContain("await ajustarRitual({");
    expect(agente).toContain("(r) => cobrarJevDaCentral(r, clientId, uid)");
    expect(agente).toContain('modo: "ajuste"');
    // O método do escritor chega ao modelo do ajuste (motores.ts registra a ligação no agente da Central).
    expect(ler("supabase/functions/ritual-writer/modulos/ajuste.ts")).toContain("metodo: p.metodo ?? null,\n  });");
    const tela = ler("src/components/central/AgenteDaCentral.tsx");
    expect(tela).toContain('title="Desfazer: voltar a versão anterior"');
    expect(tela).toContain("versoesAnteriores: comVersaoGuardada(i),");
    expect(tela).toContain('{comPedido ? "Ajustar a mensagem" : "Escrever de novo"}');
    expect(tela).toContain("copiar(textoNaHoraDoEnvio(r.body, r.tipo))");
    // O que sai para o cliente (portal e grupo) passa pelo acabamento na hora do envio.
    expect(ler("src/components/central/agenteCentralApi.ts")).toContain("body: textoNaHoraDoEnvio(p.ritual.body, p.ritual.tipo)");
    expect(ler("src/pages/AdminExperience.tsx")).toContain("const textoFinal = textoNaHoraDoEnvio(");
  });

  it("o módulo da tela não usa lookbehind, \\p{} nem grupo nomeado (Safari 11)", () => {
    for (const arq of ["supabase/functions/ritual-writer/modulos/acabamento.ts"]) {
      // Só o código (o comentário do topo cita as proibições).
      const f = ler(arq).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(f).not.toMatch(/\(\?<[=!]/);
      expect(f).not.toMatch(/\\p\{/);
      expect(f).not.toMatch(/\(\?<[a-z]/i);
    }
  });
});
