import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { provaDaEtapa } from "@/lib/cycleEvidencia";
import { situacaoVazia } from "@/lib/cycleSituation";
import { pendenciasVisiveis, textoDaEtapa, type Pendencia } from "@/lib/cycleSuggest";

/**
 * O alerta que vira tarefa, e o painel que fecha a etapa sozinho.
 *
 * O relato do dono, em duas frases: "quando gero a tarefa, ele tem que
 * sumir dali e tirar o vermelho, senão fica um monte de vermelho"; e "se
 * for atualizado tudo lá dentro pelo painel, o ciclo já reconhece e coloca
 * como concluído, sem precisar; senão fica pendente, e eu não quero".
 *
 * As duas coisas têm o mesmo inimigo: o falso positivo. Calar um alerta é
 * fácil; calar sem mentir é o que estes testes protegem.
 */

const raiz = resolve(__dirname, "../..");

const pendencia = (chave: string): Pendencia => ({
  chave,
  texto: `problema ${chave}`,
  gravidade: "urgente",
  viraEtapa: true,
});

describe("alerta que virou tarefa sai do vermelho", () => {
  it("some da vista, mas continua existindo na lista real", () => {
    const reais = [pendencia("sem-arte"), pendencia("sem-agenda")];
    const vista = pendenciasVisiveis(reais, ["sem-arte"]);

    expect(vista.map((p) => p.chave)).toEqual(["sem-agenda"]);
    // A lista real nao e tocada: e ela que prova a etapa e que faz o
    // alerta voltar se a tarefa fechar sem o problema sumir.
    expect(reais).toHaveLength(2);
  });

  it("sem encaminhamento nenhum, a lista passa inteira", () => {
    const reais = [pendencia("sem-arte")];
    expect(pendenciasVisiveis(reais, [])).toHaveLength(1);
    expect(pendenciasVisiveis(reais, undefined)).toHaveLength(1);
  });

  it("a tarefa carrega a chave do alerta, e a situacao le de volta", () => {
    const folha = readFileSync(
      resolve(raiz, "src/components/ciclo/ClientCycleSheet.tsx"), "utf8",
    );
    const situacao = readFileSync(resolve(raiz, "src/lib/cycleSituation.ts"), "utf8");

    // Escrita: source = "ciclo:<chave>".
    expect(folha).toContain("source: `${MARCA_DE_ENCAMINHAMENTO}${p.chave}`");
    // Leitura: a mesma marca, na consulta que ja existia (sem coluna nova).
    expect(situacao).toContain('export const MARCA_DE_ENCAMINHAMENTO = "ciclo:"');
    expect(situacao).toContain("title, source)");
    expect(situacao).toContain("s.pendenciasEncaminhadas.push(chave)");
    // So tarefa ABERTA cala o alerta: o laco ja pula o que nao esta aberto.
    const trecho = situacao.slice(situacao.indexOf("const ABERTAS = new Set"));
    expect(trecho.indexOf('if (!ABERTAS.has(String(t.status ?? ""))) continue;'))
      .toBeLessThan(trecho.indexOf("MARCA_DE_ENCAMINHAMENTO"));
  });

  it("o encaminhamento entra na historia, como passo do crescimento", () => {
    const folha = readFileSync(
      resolve(raiz, "src/components/ciclo/ClientCycleSheet.tsx"), "utf8",
    );
    expect(folha).toContain("Alerta virou tarefa: ");
    expect(folha).toContain('registro: "encaminhada"');
    // E a situacao recarrega, senao o vermelho so sumiria na proxima abertura.
    expect(folha).toContain('invalidateQueries({ queryKey: ["ciclo-situacao"] })');
  });
});

describe("o painel prova a etapa, e o ciclo para de cobrar", () => {
  const agoraMs = new Date("2026-08-25T12:00:00Z").getTime();

  const provaDe = (step: number, ajustes: Record<string, unknown>, extras = {}) =>
    provaDaEtapa({
      area: "social",
      step,
      rotulo: "",
      fatos: { ...situacaoVazia("c1"), ...ajustes },
      agoraMs,
      ...extras,
    });

  it("arte pronta fecha a etapa de conteudo; sem arte, segue pendente", () => {
    expect(provaDe(1, { artesProntas: 2 })).toContain("2 artes prontas");
    expect(provaDe(1, { artesProntas: 0 })).toBeNull();
  });

  it("diario recente fecha o painel atualizado; diario velho nao", () => {
    // O passo 4 virou girante em 2026-09-01, entao a prova dele passou a
    // depender do ROTULO: o diario so fecha a etapa quando ela AINDA e a
    // do painel atualizado.
    const painel = { rotulo: "Painel atualizado (arquivos, agenda e diário)" };
    expect(provaDe(4, { ultimoDiario: "2026-08-24T10:00:00Z" }, painel))
      .toContain("diário escrito");
    // Duas semanas parado nao prova nada: o painel esta desatualizado.
    expect(provaDe(4, { ultimoDiario: "2026-08-05T10:00:00Z" }, painel)).toBeNull();
    expect(provaDe(4, { ultimoDiario: null }, painel)).toBeNull();
  });

  it("com outro rotulo, o passo 4 NAO e fechado pelo diario", () => {
    // Sem esta checagem, "Escalar o criativo campeao" seria dado como
    // feito porque alguem escreveu no diario — o falso positivo silencioso
    // que derruba a confianca em todas as outras provas da tela.
    expect(provaDe(4, { ultimoDiario: "2026-08-24T10:00:00Z" },
      { rotulo: "Escalar o criativo campeão para novos públicos" })).toBeNull();
  });

  it("post agendado ou ja publicado fecha a etapa de publicacao", () => {
    expect(provaDe(6, { agendados: 3 })).toContain("3 posts agendados");
    // Semana que ja publicou nao pode cobrar agendamento.
    expect(provaDe(6, { agendados: 0, publicadosNaSemana: 2 })).toContain("2 posts publicados");
    expect(provaDe(6, {})).toBeNull();
  });

  it("no trafego, campanha no ar fecha a etapa de anuncios", () => {
    const prova = provaDaEtapa({
      area: "trafego", step: 6, rotulo: "",
      fatos: { ...situacaoVazia("c1"), campanhasAtivas: 1 },
      agoraMs,
    });
    expect(prova).toContain("1 campanha no ar");
  });

  it("sem dados nao se afirma nada: silencio e pendente, nunca feito", () => {
    expect(provaDaEtapa({ area: "social", step: 1, rotulo: "", fatos: null, agoraMs })).toBeNull();
    expect(provaDaEtapa({ area: "social", step: 6, rotulo: "", agoraMs })).toBeNull();
  });

  it("etapa vinda de pendencia fecha quando o problema some do painel", () => {
    const rotulo = textoDaEtapa(pendencia("sem-agenda"));
    const fatos = situacaoVazia("c1");

    // Enquanto a pendencia existe, nada de prova.
    expect(provaDaEtapa({
      area: "social", step: 2, rotulo, fatos,
      pendenciasReais: [pendencia("sem-agenda")], agoraMs,
    })).toBeNull();

    // Sumiu do painel: resolvido de verdade.
    expect(provaDaEtapa({
      area: "social", step: 2, rotulo, fatos, pendenciasReais: [], agoraMs,
    })).toBe("o painel mostra isso resolvido");
  });

  it("etapa do acervo nunca e provada: espera a mao de quem fez", () => {
    // Trabalho que o painel nao registra nao pode ser dado por feito.
    expect(provaDaEtapa({
      area: "social", step: 2,
      rotulo: "Mapear os 3 concorrentes que mais aparecem no nicho",
      fatos: situacaoVazia("c1"), pendenciasReais: [], agoraMs,
    })).toBeNull();
  });

  it("alerta encaminhado NAO conta como resolvido - o falso positivo", () => {
    // A folha cala o alerta encaminhado, mas a prova le a lista REAL. Se a
    // prova lesse a lista filtrada, criar a tarefa marcaria a etapa como
    // feita sozinha - exatamente a mentira que derruba a confianca.
    const pagina = readFileSync(resolve(raiz, "src/pages/AdminCiclo.tsx"), "utf8");
    const trecho = pagina.slice(
      pagina.indexOf("const provaDaEtapaDe"),
      pagina.indexOf("const doneCountFor"),
    );
    expect(trecho).toContain("pendenciasReaisPorCliente.get(String(client.id))");
    expect(trecho).not.toContain("pendenciasPorCliente.get(");

    // E a semana tambem se monta da lista real: o que virou tarefa continua
    // sendo trabalho da semana, nao desaparece do plano.
    expect(pagina).toContain("const pend = pendenciasReaisPorCliente.get(id);");
  });

  it("a etapa provada conta no card e na folha, sem ninguem marcar", () => {
    const pagina = readFileSync(resolve(raiz, "src/pages/AdminCiclo.tsx"), "utf8");
    const folha = readFileSync(
      resolve(raiz, "src/components/ciclo/ClientCycleSheet.tsx"), "utf8",
    );
    // Contador do card e etapa do card.
    expect(pagina).toContain("|| provaDaEtapaDe(client, step)");
    expect(pagina).toContain("|| Boolean(provaDaEtapaDe(client, step))");
    // Fila e historico da folha.
    expect(folha).toContain("const fechada = (step: number) =>");
    expect(folha).toContain("grupo.steps.filter((s2) => !fechada(s2))");
    expect(folha).toContain("reconhecido pelo painel");
  });

  it("na semana anterior a prova nao vale: la e conserto, nao fila", () => {
    const folha = readFileSync(
      resolve(raiz, "src/components/ciclo/ClientCycleSheet.tsx"), "utf8",
    );
    expect(folha).toContain("editandoAnterior ? null : provaDaEtapa?.(step)");
  });
});
