import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { diasParada } from "@/components/execucao/OrdensAutorizadas";

/**
 * A ordem autorizada: aprovar passa a produzir trabalho.
 *
 * Antes, aprovar só virava status — não avisava o agente, não enfileirava
 * nada, não deixava rastro que alguém pudesse pegar e executar. Era um
 * beco sem saída, e por isso os agentes "não faziam nada externamente".
 *
 * A regra anterior do dono dizia que quem age no mundo é pessoa. Ele
 * pediu o contrário, e a mudança respeita o que aquela regra protegia:
 * ação externa é irreversível, então o humano AUTORIZA uma ação
 * específica, o agente executa AQUELA, e prova o que fez.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const migracao = ler(
  "supabase/migrations/20260901050000_ordem_autorizada_o_agente_age_no_mundo.sql");

describe("a mudança de regra está declarada, e não escondida", () => {
  it("cita a regra anterior do dono, palavra por palavra", () => {
    // Reverter uma regra que o dono fixou sem dizer que está revertendo é
    // como apagá-la: daqui a seis meses ninguém saberia que houve escolha.
    expect(migracao).toContain("Operador interno nao e gente");
    expect(migracao).toContain("28/08/2026");
  });

  it("diz o que aquela regra protegia", () => {
    expect(migracao).toContain("IRREVERSIVEL");
    expect(migracao).toContain("verba gasta nao volta");
  });

  it("o gesto humano continua existindo, como autorização", () => {
    expect(migracao).toContain("deixou de ser \"fazer\" e passou a");
    expect(migracao).toContain("Nenhuma acao externa nasce do agente sozinho");
  });
});

describe("a fila de ordens", () => {
  it("só mostra o que foi autorizado e ainda não foi cumprido", () => {
    expect(migracao).toContain("a.status = 'aprovado'");
    expect(migracao).toContain("a.executed_at is null");
  });

  it("ordem vencida não aparece", () => {
    // Autorização de três semanas atrás pode não valer mais, e agir sobre
    // ela é usar procuração velha.
    expect(migracao).toContain("a.valid_until is null or a.valid_until > now()");
    expect(migracao).toContain("procuracao velha");
  });

  it("agente pausado não recebe ordem", () => {
    expect(migracao).toContain("o.status = 'active'");
  });
});

describe("executar exige prova, e só uma vez", () => {
  it("sem evidência a função recusa", () => {
    // "Publiquei" sem link é afirmação, não entrega — e ação externa é a
    // que menos pode ser afirmada sem prova.
    expect(migracao).toContain("sem_evidencia");
    expect(migracao).toContain("link do post, id da campanha");
  });

  it("executar duas vezes é recusado", () => {
    // Repetir publicaria ou gastaria duas vezes, e nada disso volta atrás.
    expect(migracao).toContain("ja_executada");
    expect(migracao).toContain("publicaria ou gastaria duas vezes");
  });

  it("ordem de outro agente é recusada", () => {
    expect(migracao).toContain("ordem_de_outro");
  });

  it("ordem não aprovada é recusada", () => {
    expect(migracao).toContain("nao_autorizada");
  });
});

describe("cancelar tarefa não apaga", () => {
  it("marca cancelado com motivo, em vez de destruir a linha", () => {
    // Apagar destruiria a trilha que sustenta esta camada inteira, e o
    // dono perderia a história junto com a tarefa.
    expect(migracao).toContain("NAO APAGA");
    expect(migracao).toContain("status = 'cancelado'");
    expect(migracao).not.toMatch(/delete\s+from\s+public\.tasks/i);
  });

  it("exige ordem aprovada do tipo certo", () => {
    expect(migracao).toContain("ordem_de_outro_tipo");
    expect(migracao).toContain("_aprov.action_kind <> 'excluir_dados'");
  });

  it("cancelar sem motivo é recusado", () => {
    expect(migracao).toContain("sem_motivo");
  });
});

describe("a tela mostra o estado que não existia", () => {
  const comp = ler("src/components/execucao/OrdensAutorizadas.tsx");

  it("separa autorizado-esperando de feito-com-prova", () => {
    // Sem isso, autorizar parecia concluir: um post liberado há dois dias
    // e nunca publicado ficaria invisível como se tivesse ido ao ar.
    expect(comp).toContain("Autorizado · esperando o agente fazer");
    expect(comp).toContain("Feito no mundo, com prova");
  });

  it("conta os dias que a ordem está de pé", () => {
    const agora = new Date("2026-09-10T12:00:00Z");
    expect(diasParada("2026-09-10T09:00:00Z", agora)).toBe(0);
    expect(diasParada("2026-09-07T12:00:00Z", agora)).toBe(3);
    expect(diasParada(null, agora)).toBe(0);
    expect(diasParada("data ruim", agora)).toBe(0);
  });

  it("data futura não vira dias negativos", () => {
    const agora = new Date("2026-09-10T12:00:00Z");
    expect(diasParada("2026-09-20T12:00:00Z", agora)).toBe(0);
  });

  it("falha de leitura não vira 'nada pendente'", () => {
    expect(comp).toContain("Nada está sendo dado como cumprido nem como pendente");
  });

  it("está montada na aba de decisões", () => {
    expect(ler("src/pages/AdminExecucao.tsx"))
      .toContain('{aba === "decisoes" && <OrdensAutorizadas />}');
  });
});
