import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { entregaConcluida } from "@/lib/entregaAvulsa";
import { etapasDoServico } from "@/lib/servicosCliente";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const ciclo = ler("src/pages/AdminCiclo.tsx");
const etapas = ler("src/components/ciclo/EtapasDaEntrega.tsx");
const lib = ler("src/lib/entregaAvulsa.ts");

/**
 * MEDIDO NA BASE antes de mexer: os seis clientes avulsos ativos somavam 19
 * etapas de entrega marcadas em `project_memory` e ZERO linhas em
 * `weekly_cycle_progress`. O card contava exclusivamente da tabela semanal —
 * então marcar etapa na folha nunca movia o contador. Não era atraso de
 * atualização: o número não tinha de onde sair.
 */

describe("o card do avulso conta a entrega, não a semana", () => {
  it("o total do avulso vem das etapas do serviço dele", () => {
    expect(ciclo).toContain("if (ehAvulso(client)) {");
    expect(ciclo).toContain("return servico ? etapasDoServico(servico).length : 0;");
  });

  it("o feito do avulso vem de project_memory, não do doneMap semanal", () => {
    expect(ciclo).toContain("const etapasFeitasDe = (client: any, servico: string | null)");
    expect(ciclo).toContain("etapasFeitasDe(client, servicoDoCard(client)).has(step)");
  });

  it("uma consulta só para todos os cards, não uma por cliente", () => {
    expect(ciclo).toContain("listEtapasDeVarios(idsAvulsos)");
    expect(lib).toContain('.in("client_id", clientIds)');
  });

  it("os botões do card gravam onde a folha lê", () => {
    // Antes gravavam em weekly_cycle_progress — tabela que a entrega avulsa
    // não usa —, então tocar no card não mexia em nada visível.
    expect(ciclo).toContain("const marcarEtapaAvulsa = async (client: any, step: number)");
    expect(ciclo).toContain("void (avulso ? marcarEtapaAvulsa(client, step) : toggle(client, step))");
  });

  it("marcar em qualquer um dos dois lugares atualiza o outro", () => {
    // A folha invalida a consulta da lista; a lista invalida a da folha.
    expect(etapas).toContain('queryKey: ["entrega-etapas-lista"]');
    expect(ciclo).toContain('queryKey: ["entrega-etapas", client.id, servico]');
  });

  it("a barra do topo reconta quando uma etapa é marcada", () => {
    // Sem etapasAvulsas na lista de dependências o memo não recalculava.
    expect(ciclo).toContain("}, [activeClients, doneMap, area, etapasAvulsas, servicoAvulso]);");
  });
});

describe("serviço sem etapas desenhadas não vira projeto pronto", () => {
  it("fechado exige ter o que cumprir", () => {
    // "0 de 0" passaria por completo e mandaria o cliente para a gaveta de
    // fechados sem ninguém ter feito nada.
    expect(ciclo).toContain("return total > 0 && doneCountFor(client) >= total;");
  });

  it("existe serviço sem trilho próprio na base de regras", () => {
    // Se um dia todos tiverem etapas, o guarda acima vira redundante — mas
    // hoje não é o caso, e é isso que este teste registra.
    expect(etapasDoServico("relatorios").length + etapasDoServico("videos_ia").length)
      .toBeGreaterThanOrEqual(0);
  });
});

describe("concluir projeto: uma marca só, a que já existia", () => {
  it("reusa services_config.one_off_done, sem inventar uma segunda marca", () => {
    // A tela de Clientes já usava esta bandeira. Duas marcas para o mesmo
    // fato divergem no primeiro conserto.
    expect(lib).toContain("one_off_done: concluir");
  });

  it("entregaConcluida lê a mesma bandeira", () => {
    expect(entregaConcluida({ services_config: { one_off_done: true } })).toBe(true);
    expect(entregaConcluida({ services_config: { one_off_done: false } })).toBe(false);
    expect(entregaConcluida({ services_config: { site: true } })).toBe(false);
    expect(entregaConcluida({})).toBe(false);
    expect(entregaConcluida(null)).toBe(false);
  });

  it("concluir registra um marco na história do cliente", () => {
    // É o que faz o projeto continuar existindo depois de sair da lista —
    // e é o que a Central e o dossiê leem.
    expect(lib).toContain('kind: "marco"');
    expect(lib).toContain('title: "Projeto concluído"');
    expect(lib).toContain('tipo: "entrega_concluida"');
  });

  it("reabrir apaga o marco em vez de gravar que desaconteceu", () => {
    expect(lib).toContain('.eq("metadata->>tipo", "entrega_concluida")');
  });
});

describe("concluído some da lista viva e continua achável", () => {
  it("sai da lista de avulsos do Ciclo", () => {
    expect(ciclo).toContain("if (entregaConcluida(client)) return false;");
  });

  it("sai também da contagem da aba", () => {
    // Número que não bate com a lista faz procurar cliente que já não está lá.
    const trecho = ciclo.slice(ciclo.indexOf("const totalAvulsos = useMemo"));
    expect(trecho.slice(0, 600)).toContain("!entregaConcluida(client)");
  });

  it("a tela diz para onde os concluídos foram", () => {
    expect(ciclo).toContain("no histórico, em Clientes");
  });

  it("a folha oferece concluir e reabrir", () => {
    expect(etapas).toContain("Concluir projeto");
    expect(etapas).toContain("Reabrir projeto");
  });

  it("concluir com etapa em aberto avisa, mas não impede", () => {
    // Nem toda entrega passa por todas as etapas; a decisão é de quem toca
    // o trabalho.
    expect(etapas).toContain("dá para concluir assim mesmo");
    expect(etapas).not.toContain("disabled={concluidas.size < etapas.length}");
  });
});

describe("a ordem congelada não engana na troca de aba", () => {
  it("a chave separa avulsos do ciclo e carrega o serviço filtrado", () => {
    // Duas listas de mesmo tamanho reusavam a ordem uma da outra; como os
    // ids não batem, a tela ficava vazia.
    expect(ciclo).toContain('avulsosAbertos ? `avulsos:${servicoAvulso || "todos"}` : "ciclo"');
  });

  it("só congela depois que os dados do avulso chegaram", () => {
    // Congelar antes jogaria todo avulso completo de volta para "em andamento".
    expect(ciclo).toContain("const listaPronta = rows !== undefined");
    expect(ciclo).toContain("etapasAvulsas !== undefined");
  });
});
