import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Contrato da versão 6 da aba Mês (24/09), pinado no código-fonte da função
// agente-calendario: planejar conversando, plano combinado que o gerador de
// meses segue, mudança só depois de aplicar e apagar sem perder aprovação.
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fonte = ler("supabase/functions/agente-calendario/index.ts");

/** Corpo de uma função de topo, do cabeçalho até a próxima função de topo. */
function corpoDe(nome: string): string {
  const ini = fonte.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = fonte.slice(ini + 1);
  const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}|\nconst ACOES|\nconst [A-Z_]+ = /);
  return fim < 0 ? resto : resto.slice(0, fim + 10);
}

const mapa = fonte.slice(fonte.indexOf("const ACOES:"), fonte.indexOf("Deno.serve("));

describe("agente-calendario v6: ações novas registradas", () => {
  it("as seis ações novas estão no mapa e só planejar_mes (com IA) responde com fôlego", () => {
    for (const acao of [
      "planejar_mes: planejarMes",
      "aplicar_mudanca: aplicarMudanca",
      "tirar_item: tirarItem",
      "repor_item: reporItem",
      "arquivar_item_agenda: arquivarItemDaAgenda",
      "restaurar_item_agenda: restaurarItemDaAgenda",
    ]) {
      expect(mapa).toContain(acao);
    }
    const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("Deno.serve("));
    expect(longas).toContain('"planejar_mes"');
    for (const rapida of ["aplicar_mudanca", "tirar_item", "repor_item", "arquivar_item_agenda", "restaurar_item_agenda"]) {
      expect(longas).not.toContain(`"${rapida}"`);
    }
  });

  it("toda ação nova confere o acesso ao cliente pelo JWT de quem chamou", () => {
    for (const f of ["planejarMes", "aplicarMudanca", "tirarItem", "reporItem", "arquivarItemDaAgenda", "restaurarItemDaAgenda"]) {
      expect(corpoDe(f), f).toContain("await exigirAcessoAoCliente(chamador,");
    }
  });
});

describe("agente-calendario v6: planejar_mes", () => {
  const planejar = corpoDe("planejarMes");

  it("uma chamada de texto com o tempo do calendário, esquema próprio e o contexto do cliente", () => {
    expect(planejar).toContain("timeoutMs: TIMEOUT_CALENDARIO_MS");
    expect(planejar).toContain("esquemaJson: ESQUEMA_PLANEJAMENTO");
    // Frente H: o mesmo prompt e as mesmas regras de saída, com a base de marketing do mês no meio.
    expect(planejar).toContain('sistema: sistemaDoCalendario(ctx, "mes")');
    // Marca por projeto (docs/marcas): o contexto do mês é o da marca escolhida no topo.
    expect(planejar).toContain("montarContexto(servico, clientId, inicio, fim, marcaDaChamada(servico, clientId, corpo))");
    expect(planejar).toContain("contextoDoPlanejamento(servico, clientId, mes)");
    expect(planejar).toContain("conversaDoAgenteDoMes(servico, clientId, chamador.userId)");
    expect(planejar).not.toContain("pesquisaWeb: true");
  });

  it("o contexto extra lê publicado, aprovado, campanhas, hypes e a agenda dos próximos meses", () => {
    const extra = corpoDe("contextoDoPlanejamento");
    expect(extra).toContain('from("editorial_publications")');
    expect(extra).toContain('.eq("status", "published")');
    expect(extra).toContain('.in("entrega_status", ["aprovado", "agendado"])');
    expect(extra).toContain('from("mesa_campanhas")');
    expect(extra).toContain('from("mesa_hypes")');
    expect(extra).toContain("somarMesesAoMes(mes, 3)");
  });

  it("o plano combinado vai para a memória do estrategista, um ativo por mês", () => {
    const salvar = corpoDe("salvarPlano");
    expect(salvar).toContain(".update({ ativa: false })");
    expect(salvar).toContain(".like(\"texto\", `${PREFIXO_PLANO}${mes}:%`)");
    expect(salvar).toContain('tipo: "preferencia", origem: "ajuste"');
    expect(fonte).toContain('export const PREFIXO_PLANO = "Plano do mês ";');
  });

  it("a mudança na proposta NÃO é gravada: volta como sugestão com a diferença", () => {
    expect(planejar).not.toContain("salvarProposta(");
    expect(planejar).not.toContain('from("calendario_propostas")');
    expect(planejar).toContain('tipo: "mudanca"');
    expect(planejar).toContain("diferenca: diferencaDaProposta(proposta, depois)");
    expect(planejar).toContain("base: proposta.atualizado_em ?? null");
  });

  it("aplicar_mudanca só vale sobre a versão que o agente leu e marca a sugestão", () => {
    const aplicar = corpoDe("aplicarMudanca");
    expect(aplicar).toContain('"proposta_mudou"');
    expect(aplicar).toContain("exigirEditavel(p)");
    expect(aplicar).toContain("salvarProposta(servico, p, depois)");
    expect(aplicar).toContain('marcar("aplicada_em")');
    expect(aplicar).toContain('marcar("descartada_em")');
  });

  it("item já na agenda nunca muda nem sai pela sugestão", () => {
    const patch = corpoDe("normalizarPatch");
    expect(patch).toContain("antigo && antigo.task_id");
    expect(patch).toContain("return !!i && !i.task_id;");
  });
});

describe("agente-calendario v6: o gerador de meses segue o plano combinado", () => {
  it("montarContexto lê os planos e contextoEmTexto os entrega a todas as ações", () => {
    const ctx = corpoDe("montarContexto");
    expect(ctx).toContain(".like(\"texto\", `${PREFIXO_PLANO}%`)");
    expect(ctx).toContain("planos: planosUnicos(");
    expect(corpoDe("contextoEmTexto")).toContain("planos_combinados_com_a_equipe: ctx.planos");
  });

  it("propor_temas e detalhar recebem o plano do mês em destaque", () => {
    expect(corpoDe("proporTemas")).toContain("${blocoDoPlano(ctx, inicio)}");
    expect(corpoDe("detalhar")).toContain("${blocoDoPlano(ctx, p.periodo_inicio)}");
    expect(corpoDe("blocoDoPlano")).toContain("PLANO COMBINADO COM A EQUIPE PARA ESTE MÊS");
  });
});

describe("agente-calendario v6: apagar sem perder o que importa", () => {
  it("tirar_item: só antes de a proposta entrar na agenda, tema deixa de ser escolhido e a memória guarda", () => {
    const tirar = corpoDe("tirarItem");
    expect(tirar).toContain("exigirEditavel(p)");
    expect(tirar).toContain("item.task_id || p.task_ids.length > 0");
    expect(tirar).toContain("escolhido: false");
    expect(tirar).toContain("lembrarDoApagado(");
    expect(corpoDe("lembrarDoApagado")).toContain('tipo: "evitar", origem: "ajuste"');
  });

  it("repor_item desfaz e apaga a memória do apagado", () => {
    const repor = corpoDe("reporItem");
    expect(repor).toContain("esquecerMemoria(servico, p.client_id, corpo.memoria_id)");
    expect(repor).toContain("itens.splice(indice, 0, item)");
  });

  it("arquivar_item_agenda: arquiva (deleted_at), nunca apaga de verdade, e recusa aprovado, agendado, publicado e pedido", () => {
    const arquivar = corpoDe("arquivarItemDaAgenda");
    expect(arquivar).toContain('.update({ deleted_at: new Date().toISOString() })');
    expect(arquivar).not.toContain(".delete(");
    expect(arquivar).toContain("requestIdFromTaskSource(t.source)");
    expect(arquivar).toContain('.in("status", ["scheduled", "published"])');
    expect(arquivar).toContain("ENTREGAS_QUE_TRAVAM.includes(w.entrega_status)");
    expect(fonte).toContain('const ENTREGAS_QUE_TRAVAM = ["aprovado", "agendado"];');
    expect(arquivar).toContain('"item_com_arte"');
    expect(arquivar).toContain("corpo.confirmar_arte !== true");
    expect(arquivar).toContain("auditLog(");
    expect(corpoDe("tarefaDoCliente")).toContain('"item_de_outro_cliente"');
  });

  it("restaurar_item_agenda devolve o item (deleted_at null)", () => {
    const restaurar = corpoDe("restaurarItemDaAgenda");
    expect(restaurar).toContain(".update({ deleted_at: null })");
    expect(restaurar).toContain("auditLog(");
  });

  it("sem travessão no código", () => {
    expect(fonte).not.toMatch(new RegExp("[\\u2013\\u2014]"));
  });
});
