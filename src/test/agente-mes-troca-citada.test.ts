/**
 * Frente AM (28/09): pedido de trocar um conteúdo citado pelo texto.
 *
 * Caso real (Mirante Luz Floripa, conversa fa6a5bab): "os conteudos que falam
 * de quartos corrija e mude os temas", "mude todos esses também" foram para o
 * pedido livre, que só cria: 15 pautas novas, nenhuma peça mudada, e o aviso
 * "parece repetir um post já feito" no lugar da troca. Aqui: o roteamento
 * (Jev + reserva em código), a peça citada com e sem par igual ou parecido, o
 * "Qual delas?" e a execução só da escolhida. As respostas do Jev são as que
 * ele deu ao vivo para estas mensagens (28/09, jev-latest).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizarAcoesNaAgenda, pecasComApelido, type PecaDaAgenda } from "../../supabase/functions/agente-calendario/acoes-agenda";
import {
  acaoComEscolha,
  blocoDoAlvo,
  candidatasDoPedido,
  decidirRoteamento,
  juntarAlvoNaAcao,
  opcoesDoAlvo,
  pareceTroca,
  perguntasDoPedido,
  resolverAlvo,
} from "../../supabase/functions/agente-calendario/alvo-citado";
import { acaoComEscolha as acaoComEscolhaDaTela, type AcaoNaAgenda as AcaoDaTela } from "@/components/mesa/planoDoMes";
import { corpoDoPedidoLivre } from "@/components/mesa/mesaV4Api";

const id = (n: number) => `${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

// Recorte da agenda real do Mirante Luz (títulos e datas como estão no banco).
const tarefas: PecaDaAgenda[] = [
  { id: id(1), title: "Carrossel | Você reconheceria Florianópolis só por esta silhueta?", due_date: "2026-09-25", delivery_type: "carousel", status: "done" },
  { id: id(2), title: "Carrossel | Você reconheceria Florianópolis só por esta silhueta?", due_date: "2026-09-25", delivery_type: "carousel", status: "done" },
  { id: id(3), title: "Fenaostra em Floripa: onde você vai dormir?", due_date: "2026-09-25", delivery_type: "carousel", status: "review" },
  { id: id(4), title: "Vai ao Folianópolis? Resolva sua volta antes da festa", due_date: "2026-10-30", delivery_type: "carousel", status: "backlog" },
  { id: id(5), title: "Café da manhã incluso, com composição variável", due_date: "2026-10-16", delivery_type: "static", status: "backlog" },
  { id: id(6), title: "Café da manhã incluso? Confirme assim", due_date: "2026-11-10", delivery_type: "carousel", status: "backlog" },
  { id: id(7), title: "Quarto com sacada ou praticidade?", due_date: "2026-11-06", delivery_type: "carousel", status: "backlog" },
  { id: id(8), title: "Quarto 01 por dentro, com o que importa", due_date: "2026-12-04", delivery_type: "carousel", status: "backlog" },
];
const pecas = pecasComApelido(tarefas, 600);
const refDe = (n: number) => pecas.find((p) => p.id === id(n))!.ref;
const jevEscolhe = (probs: Record<string, number>) => ({ type: "choice", choice: Object.keys(probs)[0], probabilities: probs });

describe("roteamento: mudar o que existe vai ao agente que mexe na agenda", () => {
  it("o Jev decide (as seis mensagens reais deram mudar_existente com 0,99 a 1,0)", () => {
    expect(decidirRoteamento(jevEscolhe({ mudar_existente: 1, criar_novo: 0, outro: 0 }), "x")).toEqual({ mudar: true, por: "jev", prob: 1 });
    expect(decidirRoteamento(jevEscolhe({ criar_novo: 0.96, mudar_existente: 0.04, outro: 0 }), "x").mudar).toBe(false);
  });

  it("sem Jev, a reserva em código pega os pedidos reais e deixa criar em paz", () => {
    for (const t of [
      "os conteudos que falam de quartos corrija e mude os temas seguindo a logica ja enviada anteiormente ta muito repetitivo a ideia de quartos vamos mudar todos",
      "tem variso que fala quarto 01, quarto 02 e etc. mude todos esses tmabem",
      "Agora eu quero que você atualize o calendário com base no que eu já te mandei. Atualize todos os conteúdos, ok?",
      'quero que você mude o conteúdo "Você reconheceria Florianópolis só por esta silhueta?"',
    ]) {
      expect(pareceTroca(t)).toBe(true);
      expect(decidirRoteamento(null, t)).toEqual({ mudar: true, por: "reserva", prob: null });
    }
    for (const t of ["Prepare um post estático para hoje aproveitando o começo da primavera em Floripa.", "Prepare 3 conteúdos para a campanha Até a Próxima Vista.", "Um conteúdo sobre o hype da semana"]) {
      expect(pareceTroca(t)).toBe(false);
    }
  });

  it("só a mensagem digitada pede roteamento (o refazer e o criar em lotes não)", () => {
    expect(corpoDoPedidoLivre({ clientId: "c", mensagem: "m", rotear: true }).rotear).toBe(true);
    expect(corpoDoPedidoLivre({ clientId: "c", mensagem: "m" })).not.toHaveProperty("rotear");
    const tela = readFileSync(resolve(__dirname, "../components/mesa/AgenteDoMes.tsx"), "utf8");
    expect(tela).toContain("campanhaId: campanhaEscolhida ? campanhaEscolhida.id : null, rotear: true");
    expect(tela.match(/rotear: true/g)!.length).toBe(1);
    const servidor = readFileSync(resolve(__dirname, "../../supabase/functions/agente-calendario/index.ts"), "utf8");
    expect(servidor).toContain("if (corpo.rotear === true)");
    expect(servidor).toContain('roteado_para: "planejar_mes"');
    expect(servidor).toContain("julgarPedidoNaAgenda(mensagem, pecasDaAgenda");
    expect(servidor).toContain("acaoComEscolha(lida.acao");
  });
});

describe("peça citada pelo texto", () => {
  it("candidatas: o texto entre aspas acha a peça, e as iguais vão juntas numa opção só do Jev", () => {
    const msg = 'quero que você mude o conteúdo "Você reconheceria Florianópolis só por esta silhueta?", troca por algo de reserva';
    const c = candidatasDoPedido(msg, pecas);
    expect(c.slice(0, 2).map((p) => p.id).sort()).toEqual([id(1), id(2)]);
    const opcoes = opcoesDoAlvo(c);
    expect(opcoes[0].pecas).toHaveLength(2);
    const { questions } = perguntasDoPedido(msg, c);
    const criterios = Object.keys((questions.alvo as { criteria: Record<string, unknown> }).criteria);
    expect(criterios).toContain("varias");
    expect(criterios).toContain("nenhuma");
    expect(criterios.filter((k) => k === refDe(1) || k === refDe(2))).toHaveLength(1);
    expect(questions.intencao.type).toBe("choice");
    expect(questions.uma_so.type).toBe("noul");
  });

  it("sem par: a peça citada é a única alvo e a troca do agente fica como está", () => {
    const msg = "mude o carrossel Vai ao Folianópolis? Resolva sua volta antes da festa, quero falar do feriado";
    const c = candidatasDoPedido(msg, pecas);
    expect(c[0].id).toBe(id(4));
    const alvo = resolverAlvo(jevEscolhe({ [refDe(4)]: 1, varias: 0, nenhuma: 0 }), c, pecas, { noul: 0.81 }, { noul: 0.88 });
    expect(alvo.tipo).toBe("um");
    expect(blocoDoAlvo(alvo)).toContain(refDe(4));

    const doAgente = normalizarAcoesNaAgenda(
      { resumo: "Reescrevo o carrossel da volta do Folianópolis.", editar_textos: [{ ref: refDe(4), titulo: "Folianópolis cai no feriado: fique mais uma noite", gancho: "Segunda é feriado." }] },
      pecas,
    );
    const a = juntarAlvoNaAcao(doAgente, alvo, pecas, msg)!;
    expect(a.editar_textos.map((e) => e.task_id)).toEqual([id(4)]);
    expect(a.escolher_um).toBeUndefined();
    expect(a.avisos).toBeUndefined();
    expect(acaoComEscolha(a, undefined)).toEqual({ ok: true, acao: a });
  });

  it("sem par e o agente não mexeu na peça: a troca vira refazer dela, com Confirmar (nunca só texto)", () => {
    const alvo = resolverAlvo(jevEscolhe({ [refDe(4)]: 1, varias: 0, nenhuma: 0 }), pecas, pecas, { noul: 0.8 }, { noul: 0.9 });
    const a = juntarAlvoNaAcao(null, alvo, pecas, "mude o carrossel do Folianópolis")!;
    expect(a.tipo).toBe("acao_agenda");
    expect(a.refazer.map((r) => r.task_id)).toEqual([id(4)]);
    expect(a.alvo_por).toBe("jev");
    expect(a.resumo).toContain("Vai ao Folianópolis?");
  });

  it("com par igual (as duas 'Você reconheceria Florianópolis' de 25/09): pergunta qual e só a escolhida muda", () => {
    const msg = 'quero que você mude o conteúdo "Você reconheceria Florianópolis só por esta silhueta?", troca por algo de reserva';
    const c = candidatasDoPedido(msg, pecas);
    const alvo = resolverAlvo(jevEscolhe({ [refDe(1)]: 1, varias: 0, nenhuma: 0 }), c, pecas, { noul: 0.82 }, { noul: 0.93 });
    expect(alvo.tipo).toBe("qual");
    if (alvo.tipo !== "qual") return;
    expect(alvo.motivo).toBe("iguais");
    expect(alvo.opcoes.map((o) => o.id).sort()).toEqual([id(1), id(2)]);

    // O agente preparou a troca numa só; a mesma troca vale para cada opção, e o cartão pergunta.
    const doAgente = normalizarAcoesNaAgenda({ resumo: "Troco o texto.", editar_textos: [{ ref: refDe(1), titulo: "Reserve a vista da Ponte antes do verão" }] }, pecas);
    const a = juntarAlvoNaAcao(doAgente, alvo, pecas, msg)!;
    expect(a.editar_textos.map((e) => e.task_id).sort()).toEqual([id(1), id(2)]);
    expect(a.editar_textos.every((e) => e.campos.titulo === "Reserve a vista da Ponte antes do verão")).toBe(true);
    expect(a.escolher_um!.task_ids.sort()).toEqual([id(1), id(2)]);
    expect(a.escolher_um!.opcoes[0].detalhe).toContain("id final");
    // Duplicado é aviso, nunca motivo para não fazer.
    expect(a.avisos![0]).toContain("aparece 2 vezes");
    expect(a.avisos![0]).toContain("Escolha qual muda");

    // Execução: sem escolha, recusa; escolha de fora, recusa; escolha certa, só ela fica.
    expect(acaoComEscolha(a, undefined).ok).toBe(false);
    expect(acaoComEscolha(a, id(7)).ok).toBe(false);
    const r = acaoComEscolha(a, id(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.acao.editar_textos.map((e) => e.task_id)).toEqual([id(2)]);
    expect((r.acao as unknown as { escolhida: string }).escolhida).toBe(id(2));

    // A tela mostra a mesma lista que o servidor executa.
    const tela = acaoComEscolhaDaTela(a as unknown as AcaoDaTela, id(2));
    expect(tela.editar_textos.map((e) => e.task_id)).toEqual([id(2)]);
  });

  it("com par igual e o agente sem ação: vira refazer da escolhida", () => {
    const alvo = resolverAlvo(jevEscolhe({ [refDe(2)]: 1, varias: 0, nenhuma: 0 }), pecas, pecas, { noul: 0.8 }, { noul: 0.9 });
    const a = juntarAlvoNaAcao(null, alvo, pecas, "mude esse")!;
    expect(a.refazer.map((i) => i.task_id).sort()).toEqual([id(1), id(2)]);
    const r = acaoComEscolha(a, id(1));
    expect(r.ok && r.acao.refazer.map((i) => i.task_id)).toEqual([id(1)]);
  });

  it("com par parecido ('aquele do café da manhã'): o Jev diz que não está claro e as duas viram opção", () => {
    const msg = "aquele do café da manhã tá com o texto errado, muda";
    const c = candidatasDoPedido(msg, pecas);
    expect(c.slice(0, 2).map((p) => p.id).sort()).toEqual([id(5), id(6)]);
    const alvo = resolverAlvo(jevEscolhe({ [refDe(5)]: 0.6, nenhuma: 0.15, varias: 0.13, [refDe(6)]: 0.05 }), c, pecas, { noul: 0.26 }, { noul: 0.91 });
    expect(alvo.tipo).toBe("qual");
    if (alvo.tipo === "qual") {
      expect(alvo.motivo).toBe("parecidas");
      expect(alvo.opcoes.map((o) => o.id)).toEqual([id(5), id(6)]);
    }
  });

  it("pedido de grupo ('todos os que falam de quartos') nunca vira escolha de uma peça", () => {
    const msg = "os conteudos que falam de quartos corrija e mude os temas, vamos mudar todos";
    const c = candidatasDoPedido(msg, pecas);
    // Ao vivo o Jev pôs 0,83 numa peça, mas uma_so = 0,08: é pedido amplo.
    const alvo = resolverAlvo(jevEscolhe({ [c[0].ref]: 0.83, varias: 0.17, nenhuma: 0 }), c, pecas, { noul: 0.83 }, { noul: 0.08 });
    expect(alvo.tipo).toBe("varias");
    const doAgente = normalizarAcoesNaAgenda({ resumo: "Reescrevo as peças de quarto.", editar_textos: [{ ref: refDe(7), tema: "Reserve pela agenda da viagem" }, { ref: refDe(8), tema: "O que confirmar antes de reservar" }] }, pecas);
    const a = juntarAlvoNaAcao(doAgente, alvo, pecas, msg)!;
    expect(a.editar_textos.map((e) => e.task_id)).toEqual([id(7), id(8)]);
    expect(a.escolher_um).toBeUndefined();
  });

  it("'daquele post' sem saber qual: as mais prováveis viram opção", () => {
    const alvo = resolverAlvo(jevEscolhe({ varias: 0.77, [refDe(5)]: 0.09, nenhuma: 0.08, [refDe(6)]: 0.04 }), pecas, pecas, { noul: 0.13 }, { noul: 0.78 });
    expect(alvo.tipo === "qual" && alvo.opcoes.map((o) => o.id)).toEqual([id(5), id(6)]);
  });

  it("peça repetida numa ação comum: só aviso, a ação segue inteira", () => {
    const doAgente = normalizarAcoesNaAgenda({ resumo: "Apago.", apagar: [refDe(1)] }, pecas);
    const a = juntarAlvoNaAcao(doAgente, { tipo: "nenhum" }, pecas, "apague o de 25/09")!;
    expect(a.apagar.map((i) => i.task_id)).toEqual([id(1)]);
    expect(a.avisos![0]).toContain("Só a peça da lista muda");
    expect(acaoComEscolha(a, undefined).ok).toBe(true);
  });
});
