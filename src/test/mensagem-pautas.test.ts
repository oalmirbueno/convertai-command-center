import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildGroupMessageText, type GroupMessageContext } from "@/lib/groupMessage";

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");
const central = ler("src/pages/AdminExperience.tsx");
const hook = ler("src/hooks/useClientGroupMessage.ts");
const ciclo = ler("src/pages/AdminCiclo.tsx");

/**
 * A mensagem continuava genérica, e medir a carteira explicou por quê: NENHUM
 * cliente tinha entrega na janela de 7 dias nem publicação agendada, então o
 * texto caía sempre no ramo "semana de construção". Mas vários tinham
 * carrossel PRONTO, com nome, parado no calendário editorial — uma fonte que
 * a mensagem não lia.
 */

const semNada: GroupMessageContext = {
  clientName: "Preserva Eco",
  greeting: "Bom dia",
  entregasSemana: [],
  entregasDesdeSegunda: [],
  aguardandoOk: [],
  publicadasSemana: 0,
  proximasAgendadas: [],
  cicloFeito: [],
  avulsosFeitos: [],
  frentes: ["Estruturação Digital Bacacheri"],
};

const comPautas: GroupMessageContext = {
  ...semNada,
  pautasProntas: ["Seu Vizinho vai te agradecer", "O que separar antes de sair de casa"],
};

describe("o calendário editorial tira a mensagem do genérico", () => {
  it("a abertura cita a peça pronta pelo nome", () => {
    const texto = buildGroupMessageText(comPautas, "abertura");
    expect(texto).toContain("Seu Vizinho vai te agradecer");
    expect(texto).toContain("prontos para entrar no ar");
  });

  it("a peça pronta substitui o genérico 'em produção nesta semana'", () => {
    // Era a linha que dominava o texto quando não havia entrega na janela.
    expect(buildGroupMessageText(semNada, "abertura")).toContain("Em produção nesta semana");
    expect(buildGroupMessageText(comPautas, "abertura")).not.toContain("Em produção nesta semana");
  });

  it("o meio da semana conta o que está pronto quando nada mais andou", () => {
    const texto = buildGroupMessageText(comPautas, "meio");
    expect(texto).toContain("aguardando a data no calendário");
    expect(texto).not.toContain("produção interna");
  });

  it("o fechamento inclui as peças no balanço", () => {
    const texto = buildGroupMessageText(comPautas, "fechamento");
    expect(texto).toContain("ficaram prontos");
    expect(texto).toContain("entrar no calendário");
  });

  it("sem pauta pronta, o texto antigo continua valendo", () => {
    expect(buildGroupMessageText(semNada, "meio")).toContain("produção interna");
  });

  it("os três momentos seguem diferentes entre si", () => {
    const corpo = (m: any) => buildGroupMessageText(comPautas, m).split("\n").slice(1).join("\n");
    expect(corpo("abertura")).not.toBe(corpo("meio"));
    expect(corpo("meio")).not.toBe(corpo("fechamento"));
  });

  it("continua sem jargão e sem cobrança", () => {
    for (const m of ["abertura", "meio", "fechamento"] as const) {
      const texto = buildGroupMessageText(comPautas, m);
      expect(texto).not.toMatch(/pendente|atrasad|production_status|ready/i);
    }
  });
});

describe("as duas telas leem a mesma fonte nova", () => {
  it("a Central busca o calendário editorial ao vivo", () => {
    expect(central).toContain('queryKey: ["exp-pautas"]');
    expect(central).toContain('from("editorial_posts")');
  });

  it("o Ciclo busca a mesma coisa para um cliente", () => {
    expect(hook).toContain('from("editorial_posts")');
  });

  it("só peça pronta entra: em produção ainda não é promessa", () => {
    expect(central).toMatch(/production_status === "ready"/);
    expect(hook).toMatch(/production_status === "ready"/);
  });
});

describe("a Central ganhou o botão de atualizar", () => {
  it("existe e recarrega as fontes que a mensagem lê", () => {
    expect(central).toContain("const atualizarMensagens");
    for (const chave of ["exp-released-files", "exp-memory", "exp-pautas", "weekly-cycle-ritual"]) {
      expect(central).toContain(`"${chave}"`);
    }
  });

  it("o botão fica junto do seletor de momento, onde a dúvida aparece", () => {
    expect(central).toMatch(/Mensagem do grupo · escolha o momento[\s\S]{0,600}atualizarMensagens/);
  });
});

describe("incluir no ciclo passou a oferecer todo mundo", () => {
  it("empresa do grupo e plano parado deixam de ser bloqueio", () => {
    // A flag de empresa interna serve para tirar da COBRANÇA, não da operação.
    // Ela escondia Stop Informática, Jalimpo, AcelerIQ e PlayBet até da lista.
    expect(ciclo).not.toMatch(/clientesDeFora[\s\S]{0,300}!isInternalClient\(client\) &&/);
    expect(ciclo).toContain('"empresa do grupo"');
    expect(ciclo).toContain("`plano ${client.plan_status}`");
  });

  it("o motivo de estar fora aparece ao lado do nome", () => {
    expect(ciclo).toContain("{nota}");
  });

  it("avulso continua fora, porque tem aba e régua próprias", () => {
    expect(ciclo).toMatch(/clientesDeFora[\s\S]{0,600}!ehAvulso\(client\)/);
  });
});
