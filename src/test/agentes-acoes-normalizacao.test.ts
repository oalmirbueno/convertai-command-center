import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alvosDoTrabalho,
  arquivarVersoesDaLamina,
  blocoDasAcoesDoDiretor,
  comReservaDeTirarLaminas,
  devolverLaminaAoTrabalho,
  devolverVersoesDaLamina,
  MOTIVO_CONTINUO,
  MOTIVO_ENTREGUE,
  normalizarAcoesDoDiretor,
  ordemInversa,
  ordemPedida,
  ordensParaGerarDeNovo,
  reordenarTrabalho,
  tirarLaminaDoTrabalho,
  trocarTextoDaLamina,
  type TrabalhoParaAcoes,
} from "../../supabase/functions/estudio-arte/acoes-do-diretor";
import { alvosDoAcervo, etiquetaPedida, type FotoDoAcervo, pastaPedida } from "../../supabase/functions/_shared/acoes-do-acervo";
import { alvosDoWorkspace, type NoDoWorkspace, regrasDoWorkspace } from "../../supabase/functions/agente-contexto/modulos/acoes-do-workspace";
import { desfazerItemAItem, executarItemAItem, normalizarAcaoDoAgente, podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { regrasDoDiretor } from "../../supabase/functions/estudio-arte/acoes-do-diretor";
import { blocoDasAcoesDoContexto, normalizarAcoesDoContexto, pedeAcaoNoContexto } from "../../supabase/functions/agente-contexto/acoes-do-contexto";
import { blocoDasAcoesDaMesaFoto, normalizarAcoesDaMesaFoto, pedeAcaoNasFotos } from "../../supabase/functions/mesa-foto/acoes-da-mesa-foto";
import {
  campanhasComApelido,
  normalizarAcoesNaAgenda,
  normalizarGeracao,
  pecasComApelido,
  pedidoParaRefazer,
  type PecaDaAgenda,
} from "../../supabase/functions/agente-calendario/acoes-agenda";
import { ehPedidoNaAgenda, geracaoDaMensagem, pedidoParaRefazer as pedidoParaRefazerDaTela } from "@/components/mesa/planoDoMes";

const ID = (n: number) => `${String(n).repeat(8).slice(0, 8)}-0000-4000-8000-000000000000`;

// ------------------------------------------------------------------ Estúdio

function trabalho(extra: Partial<TrabalhoParaAcoes> = {}, direcao: Partial<TrabalhoParaAcoes["direcao"]> = {}): TrabalhoParaAcoes {
  return {
    id: "trab-1",
    status: "pronto",
    entrega_status: null,
    tipo: "social",
    direcao: {
      cards: [
        { ordem: 1, funcao: "capa", texto_exato: "Outono chegou com R$ 99" },
        { ordem: 2, funcao: "conteudo", texto_exato: "Mudas por R$ 99 cada" },
        { ordem: 3, funcao: "cta", texto_exato: "Chame no WhatsApp" },
      ],
      ...direcao,
    },
    cards: [
      { ordem: 1, versao: 1 },
      { ordem: 1, versao: 2 },
      { ordem: 2, versao: 1 },
      { ordem: 3, versao: 1 },
    ],
    ...extra,
  };
}

describe("diretor do Estúdio: ações nas lâminas", () => {
  it("t1 é o trabalho e l{ordem} é a lâmina; o bloco não leva id", () => {
    const alvos = alvosDoTrabalho(trabalho());
    expect(alvos.map((a) => a.ref)).toEqual(["t1", "l1", "l2", "l3"]);
    expect(alvos[1].detalhe).toContain("2 versões");
  });

  it("reordenar: citadas primeiro, resto na ordem; repetida ou inexistente não vale", () => {
    expect(ordemPedida("3,1", [1, 2, 3])).toEqual([3, 1, 2]);
    expect(ordemPedida("l2 l1", [1, 2, 3])).toEqual([2, 1, 3]);
    expect(ordemPedida("1,2,3", [1, 2, 3])).toBeNull();
    expect(ordemPedida("1,1", [1, 2, 3])).toBeNull();
    expect(ordemPedida("4", [1, 2, 3])).toBeNull();
    const a = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "reordenar", ref: "t1", para: "3,1,2" }] }, trabalho());
    expect(a!.itens[0]).toMatchObject({ operacao: "reordenar", para: "3,1,2", para_rotulo: "nova ordem 3,1,2" });
  });

  it("reordenar é travado no carrossel contínuo e em trabalho entregue", () => {
    const c = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "reordenar", ref: "t1", para: "2,1" }] }, trabalho({}, { carrossel_infinito: true }));
    expect(c!.itens).toEqual([]);
    expect(c!.recusados[0].motivo).toBe(MOTIVO_CONTINUO);
    const e = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "refazer", ref: "l1", para: "" }] }, trabalho({ entrega_status: "agendado" }));
    expect(e!.recusados[0].motivo).toBe(MOTIVO_ENTREGUE);
  });

  it("formato: 9:16 e stories viram o formato do post; anúncio não muda por aqui", () => {
    const a = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "mudar_formato", ref: "t1", para: "9:16" }] }, trabalho());
    expect(a!.itens[0]).toMatchObject({ para: "stories_9x16", para_rotulo: "9:16" });
    expect(normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "mudar_formato", ref: "t1", para: "4:5" }] }, trabalho())).toBeNull();
    const ads = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "mudar_formato", ref: "t1", para: "3:4" }] }, trabalho({ tipo: "ads" }));
    expect(ads!.recusados[0].motivo).toContain("Mesa Ads");
    expect(normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "mudar_formato", ref: "l1", para: "9:16" }] }, trabalho())).toBeNull();
  });

  it("trocar texto em várias lâminas só onde o trecho existe; troca antes de refazer", () => {
    const a = normalizarAcoesDoDiretor(
      {
        resumo: "",
        itens: [
          { operacao: "refazer", ref: "l1", para: "" },
          { operacao: "trocar_texto", ref: "l1", para: "R$ 99 => R$ 89" },
          { operacao: "trocar_texto", ref: "l2", para: "R$ 99 => R$ 89" },
          { operacao: "trocar_texto", ref: "l3", para: "R$ 99 => R$ 89" },
        ],
      },
      trabalho(),
    );
    expect(a!.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["trocar_texto:l1", "trocar_texto:l2", "refazer:l1"]);
    expect(a!.ignorados).toEqual(["l3"]);
    const t = trocarTextoDaLamina(trabalho(), 2, "R$ 99 => R$ 89");
    expect((t.patch.direcao.cards as any[])[1].texto_exato).toBe("Mudas por R$ 89 cada");
    expect(t.antes.texto_exato).toBe("Mudas por R$ 99 cada");
    expect(() => trocarTextoDaLamina(trabalho(), 3, "R$ 99 => R$ 89")).toThrow("não está mais no texto");
  });

  it("reordenar junto com ações nas lâminas não entra (a ordem mudaria no meio)", () => {
    const a = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "reordenar", ref: "t1", para: "2,1,3" }, { operacao: "refazer", ref: "l2", para: "" }] }, trabalho());
    expect(a!.itens.map((i) => i.operacao)).toEqual(["refazer"]);
    expect(a!.ignorados).toEqual(["t1"]);
    expect(a!.sem_desfazer).toBe(true);
  });

  it("reordenar e voltar dá o trabalho de antes; capa e fechamento acompanham", () => {
    const t = trabalho();
    const r = reordenarTrabalho(t, [3, 1, 2]);
    expect(r.direcao.cards.map((c) => [c.ordem, c.funcao, c.texto_exato])).toEqual([
      [1, "capa", "Chame no WhatsApp"],
      [2, "conteudo", "Outono chegou com R$ 99"],
      [3, "cta", "Mudas por R$ 99 cada"],
    ]);
    expect(r.cards.filter((v) => v.ordem === 2).length).toBe(2);
    const volta = reordenarTrabalho({ ...t, direcao: r.direcao, cards: r.cards }, ordemInversa([3, 1, 2]));
    expect(volta.direcao.cards.map((c) => c.texto_exato)).toEqual(t.direcao.cards.map((c) => c.texto_exato));
  });

  it("arquivar versões guarda as antigas e o desfazer devolve", () => {
    const t = trabalho();
    const a = arquivarVersoesDaLamina(t, 1);
    expect(a.versoes).toEqual([1]);
    expect(a.patch.cards.filter((v) => v.ordem === 1)).toEqual([{ ordem: 1, versao: 2 }]);
    expect((a.patch.direcao.versoes_arquivadas as any[]).length).toBe(1);
    const d = devolverVersoesDaLamina({ ...t, cards: a.patch.cards, direcao: a.patch.direcao }, 1, [1]);
    expect(d.cards.filter((v) => v.ordem === 1).length).toBe(2);
    expect(d.direcao.versoes_arquivadas).toEqual([]);
    const so1 = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "arquivar_versoes", ref: "l2", para: "" }] }, t);
    expect(so1!.recusados[0].motivo).toContain("só tem a versão atual");
  });

  it("as lâminas a gerar de novo são só as que deram certo", () => {
    const a = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "refazer", ref: "l1", para: "" }, { operacao: "refazer", ref: "l3", para: "" }] }, trabalho())!;
    expect(ordensParaGerarDeNovo({ ...a, resultados: [{ ref: "l1", alvo_id: "1", titulo: "", operacao: "refazer", ok: true }, { ref: "l3", alvo_id: "3", titulo: "", operacao: "refazer", ok: false }] })).toEqual([1]);
  });
});

// ------------------------------------------------------------------ Estúdio: várias lâminas no mesmo pedido

/** Carrossel de `n` lâminas, cada uma com uma versão. */
function carrossel(n: number, extra: Partial<TrabalhoParaAcoes> = {}): TrabalhoParaAcoes {
  const ordens = Array.from({ length: n }, (_, i) => i + 1);
  return {
    id: "trab-n",
    status: "pronto",
    entrega_status: null,
    tipo: "social",
    direcao: { cards: ordens.map((o) => ({ ordem: o, funcao: o === 1 ? "capa" : o === n ? "cta" : "conteudo", texto_exato: `Texto da lâmina ${o}` })) },
    cards: ordens.map((o) => ({ ordem: o, versao: 1 })),
    ...extra,
  };
}
const tirar = (...refs: string[]) => ({ resumo: "Tiro as lâminas; a lista aguarda confirmação.", itens: refs.map((ref) => ({ operacao: "tirar_lamina", ref, para: "" })) });

describe("diretor do Estúdio: tirar várias lâminas no mesmo pedido", () => {
  it("dois tirar_lamina (l6 e l7) ficam na proposta, da maior para a menor, e podem ir direto", () => {
    const t = carrossel(7);
    const a = normalizarAcoesDoDiretor(tirar("l6", "l7"), t)!;
    expect(a).not.toBeNull();
    expect(a.itens.map((i) => [i.operacao, i.ref])).toEqual([["tirar_lamina", "l7"], ["tirar_lamina", "l6"]]);
    expect(a.ignorados).toEqual([]);
    expect(a.recusados).toEqual([]);
    expect(podeExecutarDireto(a, regrasDoDiretor(t), { pedidoClaro: true, maxItens: 12 }).direto).toBe(true);
    // A ordem em que o modelo escreve não importa.
    expect(normalizarAcoesDoDiretor(tirar("l7", "l2", "l6"), t)!.itens.map((i) => i.ref)).toEqual(["l7", "l6", "l2"]);
  });

  it("um tirar_lamina sozinho continua igual", () => {
    const a = normalizarAcoesDoDiretor(tirar("l7"), carrossel(7))!;
    expect(a.itens.map((i) => [i.operacao, i.ref, i.alvo_id])).toEqual([["tirar_lamina", "l7", "7"]]);
    expect(a.ignorados).toEqual([]);
  });

  it("tirar_lamina com outra operação de lâmina no mesmo pedido: os de tirar continuam de fora", () => {
    const t = carrossel(7);
    const comTexto = normalizarAcoesDoDiretor({ resumo: "", itens: [...tirar("l6", "l7").itens, { operacao: "trocar_texto", ref: "l2", para: "lâmina 2 => segunda lâmina" }] }, t)!;
    expect(comTexto.itens.map((i) => i.operacao)).toEqual(["trocar_texto"]);
    expect(comTexto.ignorados.sort()).toEqual(["l6", "l7"]);
    const comRefazer = normalizarAcoesDoDiretor({ resumo: "", itens: [...tirar("l6").itens, { operacao: "refazer", ref: "l2", para: "" }] }, t)!;
    expect(comRefazer.itens.map((i) => i.operacao)).toEqual(["refazer"]);
    expect(comRefazer.ignorados).toEqual(["l6"]);
  });

  it("tipos diferentes de numeração no mesmo pedido (tirar + duplicar, tirar + adicionar): todos de fora", () => {
    const t = carrossel(7);
    expect(normalizarAcoesDoDiretor({ resumo: "", itens: [...tirar("l6").itens, { operacao: "duplicar_lamina", ref: "l2", para: "" }] }, t)).toBeNull();
    expect(normalizarAcoesDoDiretor({ resumo: "", itens: [...tirar("l6", "l7").itens, { operacao: "adicionar_lamina", ref: "l2", para: "Lâmina nova sobre preço" }] }, t)).toBeNull();
    // Com uma operação do trabalho junto, ela fica e as de numeração saem.
    const a = normalizarAcoesDoDiretor({ resumo: "", itens: [...tirar("l6").itens, { operacao: "duplicar_lamina", ref: "l2", para: "" }, { operacao: "mudar_qualidade", ref: "t1", para: "alta" }] }, t)!;
    expect(a.itens.map((i) => i.operacao)).toEqual(["mudar_qualidade"]);
    expect(a.ignorados.sort()).toEqual(["l2", "l6"]);
  });

  it("várias cópias ou lâminas novas da mesma operação também valem, da maior para a menor", () => {
    const t = carrossel(7);
    const dup = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "duplicar_lamina", ref: "l2", para: "" }, { operacao: "duplicar_lamina", ref: "l5", para: "" }] }, t)!;
    expect(dup.itens.map((i) => i.ref)).toEqual(["l5", "l2"]);
    // 9 lâminas: só cabe mais uma; a outra é recusada com o motivo.
    const cheio = normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "duplicar_lamina", ref: "l2", para: "" }, { operacao: "duplicar_lamina", ref: "l5", para: "" }] }, carrossel(9))!;
    expect(cheio.itens.map((i) => i.ref)).toEqual(["l2"]);
    expect(cheio.recusados.map((r) => r.ref)).toEqual(["l5"]);
  });

  it("tirar todas as lâminas: a de menor número fica, recusada com o motivo", () => {
    const a = normalizarAcoesDoDiretor(tirar("l1", "l2", "l3"), carrossel(3))!;
    expect(a.itens.map((i) => i.ref)).toEqual(["l3", "l2"]);
    expect(a.recusados).toEqual([expect.objectContaining({ ref: "l1", operacao: "tirar_lamina", motivo: "O trabalho precisa de pelo menos uma lâmina." })]);
  });

  it("tirar a 7 e depois a 6 deixa 5 lâminas; o Desfazer de cada uma devolve na ordem inversa", () => {
    const t0 = carrossel(7);
    const r7 = tirarLaminaDoTrabalho(t0, 7, "2026-01-01T00:00:00.000Z");
    const t1 = { ...t0, ...r7.patch } as TrabalhoParaAcoes;
    const r6 = tirarLaminaDoTrabalho(t1, 6, "2026-01-01T00:00:01.000Z");
    const t2 = { ...t1, ...r6.patch } as TrabalhoParaAcoes;
    expect(t2.direcao.cards.map((c) => c.ordem)).toEqual([1, 2, 3, 4, 5]);
    expect(t2.direcao.cards.map((c) => c.texto_exato)).toEqual([1, 2, 3, 4, 5].map((o) => `Texto da lâmina ${o}`));
    expect(t2.direcao.cards[4].funcao).toBe("cta");
    expect(t2.cards.map((v) => v.ordem)).toEqual([1, 2, 3, 4, 5]);
    expect((t2.direcao.laminas_arquivadas || []).map((a) => a.ordem_original)).toEqual([7, 6]);
    expect(r7.desfazer).toMatchObject({ ordem: 7, total_depois: 6 });
    expect(r6.desfazer).toMatchObject({ ordem: 6, total_depois: 5 });
    // Desfazer: primeiro a última tirada (a 6), depois a 7.
    const v6 = { ...t2, ...devolverLaminaAoTrabalho(t2, r6.desfazer.chave, r6.desfazer.total_depois) } as TrabalhoParaAcoes;
    const v7 = { ...v6, ...devolverLaminaAoTrabalho(v6, r7.desfazer.chave, r7.desfazer.total_depois) } as TrabalhoParaAcoes;
    expect(v7.direcao.cards.map((c) => [c.ordem, c.texto_exato])).toEqual(t0.direcao.cards.map((c) => [c.ordem, c.texto_exato]));
    expect(v7.cards.map((v) => v.ordem).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(v7.direcao.laminas_arquivadas).toEqual([]);
    // Na ordem errada (6 antes da 7), a 7 já teria virado 6: é o que a ordenação evita.
    const errado = { ...t0, ...tirarLaminaDoTrabalho(t0, 6).patch } as TrabalhoParaAcoes;
    expect(() => tirarLaminaDoTrabalho(errado, 7)).toThrow("não existe mais");
  });

  it("a proposta normalizada executa item a item (como o executor) e desfaz tudo pelo contrato", async () => {
    let t = carrossel(7);
    const a = normalizarAcoesDoDiretor(tirar("l6", "l7"), t)!;
    const resultados = await executarItemAItem(a.itens, async (item) => {
      const r = tirarLaminaDoTrabalho(t, Number(item.alvo_id));
      t = { ...t, ...r.patch } as TrabalhoParaAcoes;
      return { desfazer: r.desfazer };
    }, 1);
    expect(resultados.map((r) => [r.ref, r.ok])).toEqual([["l7", true], ["l6", true]]);
    expect(t.direcao.cards).toHaveLength(5);
    const volta = await desfazerItemAItem(resultados, async (r) => {
      const d = r.desfazer as { chave: string; total_depois: number };
      t = { ...t, ...devolverLaminaAoTrabalho(t, d.chave, d.total_depois) } as TrabalhoParaAcoes;
    });
    expect(volta).toEqual({ voltaram: 2, falharam: [] });
    expect(t.direcao.cards.map((c) => c.texto_exato)).toEqual(carrossel(7).direcao.cards.map((c) => c.texto_exato));
  });

  it("reserva em código: sem ação do modelo, a proposta sai dos números do pedido", () => {
    const t = carrossel(7);
    const a = comReservaDeTirarLaminas(null, "tirar lâmina 7 e tirar lâmina 6", t)!;
    expect(a.itens.map((i) => [i.operacao, i.ref])).toEqual([["tirar_lamina", "l7"], ["tirar_lamina", "l6"]]);
    expect(a.resumo).toBe("Tirar as lâminas 6 e 7 do carrossel (ficam guardadas; o Desfazer devolve).");
    expect(a.contexto).toMatchObject({ trabalho_id: "trab-n" });
    expect(podeExecutarDireto(a, regrasDoDiretor(t), { pedidoClaro: true, maxItens: 12 }).direto).toBe(true);
    const b = comReservaDeTirarLaminas(null, "Confirmo: pode tirar as lâminas 6 e 7 agora. Não gerar nada.", t)!;
    expect(b.itens.map((i) => i.ref)).toEqual(["l7", "l6"]);
    const uma = comReservaDeTirarLaminas(null, "tira a lâmina 3", t)!;
    expect(uma.itens.map((i) => i.ref)).toEqual(["l3"]);
    expect(uma.resumo).toBe("Tirar a lâmina 3 do carrossel (fica guardada; o Desfazer devolve).");
    // Lâmina que não existe fica de fora; sem nenhuma que exista, nada é montado.
    expect(comReservaDeTirarLaminas(null, "tira as lâminas 6 e 9", t)!.itens.map((i) => i.ref)).toEqual(["l6"]);
    expect(comReservaDeTirarLaminas(null, "tira a lâmina 9", t)).toBeNull();
    expect(comReservaDeTirarLaminas(null, "muda a cor da lâmina 3", t)).toBeNull();
    // O que o modelo devolveu de aproveitável vale: a reserva não mexe.
    const doModelo = normalizarAcoesDoDiretor(tirar("l2"), t)!;
    expect(comReservaDeTirarLaminas(doModelo, "tira a lâmina 3", t)).toBe(doModelo);
    // As travas de sempre continuam: trabalho entregue recusa com o motivo, nada entra na lista.
    const entregue = comReservaDeTirarLaminas(null, "tira a lâmina 3", carrossel(7, { status: "entregue" }))!;
    expect(entregue.itens).toEqual([]);
    expect(entregue.recusados[0].motivo).toBe(MOTIVO_ENTREGUE);
  });

  it("o prompt diz que tirar várias lâminas é um item por lâmina, sem misturar com outra operação", () => {
    const bloco = blocoDasAcoesDoDiretor(carrossel(3));
    expect(bloco).toContain("UM item por lâmina");
    expect(bloco).not.toContain("Sozinha no pedido");
    const fonte = readFileSync(resolve(process.cwd(), "supabase/functions/estudio-arte/index.ts"), "utf8");
    expect(fonte).toContain("comReservaDeTirarLaminas(acaoDoModelo, mensagem");
    expect(fonte).toContain("resumo: resumoDoQueFoiFeito(executada.resumo)");
  });
});

// ------------------------------------------------------------------ acervo, workspace, contexto e Mesa Foto

const fotos: FotoDoAcervo[] = [
  { id: ID(1), nome: "fachada.jpg", pasta: "Loja", tags: ["fachada"], ativa: true, aprovada: true, origem: "upload", gerada: false },
  { id: ID(2), nome: "ref-pinterest.jpg", pasta: null, tags: ["referencia_web"], ativa: true, aprovada: false, origem: "mesa_foto", gerada: false },
  { id: ID(3), nome: "gerada-1.png", pasta: "Mesa Foto / Ensaios", tags: ["mesa_foto", "gerada", "ensaio:abc"], ativa: true, aprovada: false, origem: "mesa_foto", gerada: true },
];

const nos: NoDoWorkspace[] = [
  { id: ID(4), parent_id: null, kind: "folder", name: "Marca" },
  { id: ID(5), parent_id: ID(4), kind: "folder", name: "Logos" },
  { id: ID(6), parent_id: null, kind: "file", name: "logo-final.png" },
  { id: ID(7), parent_id: null, kind: "folder", name: "Arquivados" },
  { id: ID(8), parent_id: null, kind: "folder", name: "Recebidos", inbox_token: "tok" },
];

describe("acervo e workspace", () => {
  it("pasta e etiqueta chegam limpas", () => {
    expect(pastaPedida("  /Produtos/ Outono / ")).toBe("Produtos / Outono");
    expect(etiquetaPedida("Fachada da Loja")).toBe("fachada_da_loja");
    expect(etiquetaPedida("Promoção")).toBe("promocao");
  });

  it("workspace: pastas primeiro; mover para pasta, raiz ou pasta nova; pasta não entra nela mesma", () => {
    const alvos = alvosDoWorkspace(nos);
    expect(alvos.map((a) => `${a.ref}:${a.titulo}`)).toEqual(["w1:Arquivados", "w2:Marca", "w3:Recebidos", "w4:Logos", "w5:logo-final.png"]);
    const regras = regrasDoWorkspace(alvos);
    const a = normalizarAcaoDoAgente(
      {
        resumo: "",
        itens: [
          { operacao: "mover", ref: "w5", para: "w4" },
          { operacao: "renomear", ref: "w5", para: "logo/principal.png" },
          { operacao: "mover", ref: "w2", para: "w4" },
          { operacao: "mover", ref: "w4", para: "raiz" },
          { operacao: "arquivar", ref: "w1", para: "" },
          { operacao: "arquivar", ref: "w3", para: "" },
          { operacao: "mover", ref: "w2", para: "nova: Clientes 2026" },
        ],
      },
      alvos,
      regras,
      { agente: "contexto" },
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.ref}:${i.para}`)).toEqual([
      `mover:w5:${ID(5)}`,
      "renomear:w5:logo-principal.png",
      "mover:w4:raiz",
      "mover:w2:nova:Clientes 2026",
    ]);
    expect(a.ignorados).toEqual(["w2"]);
    expect(a.recusados.map((r) => r.motivo)).toEqual(["A pasta Arquivados fica onde está.", "Esta pasta recebe os arquivos do cliente e fica onde está."]);
  });

  it("contexto: trocar a logo aponta para a imagem do acervo pelo apelido; lista só entra quando o pedido é de ação", () => {
    const dados = { kit: { logo_path: "c/marca/logo.png", logo_alt_path: null }, referencias: [{ id: ID(9), papel: "identidade", origem: "pinterest", tags: [], leitura: "Paleta terrosa" }], fotos, nos };
    const a = normalizarAcoesDoContexto(
      { resumo: "", itens: [{ operacao: "trocar_logo", ref: "k2", para: "i1" }, { operacao: "trocar_logo", ref: "i1", para: "i1" }, { operacao: "arquivar_referencia", ref: "r1", para: "" }, { operacao: "tirar_marca", ref: "i3", para: "gerada" }] },
      dados,
      "cliente-1",
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.alvo_id}:${i.para}`)).toEqual([`trocar_logo:alternativa:${ID(1)}`, `arquivar_referencia:${ID(9)}:null`]);
    expect(a.itens[0].para_rotulo).toBe("a imagem fachada.jpg");
    expect(a.recusados[0].motivo).toContain("etiqueta é da casa");
    expect(a.contexto).toEqual({ client_id: "cliente-1" });
    const bloco = blocoDasAcoesDoContexto(dados);
    expect(bloco).toContain("k1 | Logo principal do kit | definida");
    expect(bloco).toContain("w5 | logo-final.png");
    expect(bloco).not.toContain(ID(1));
    expect(pedeAcaoNoContexto("organize os arquivos do workspace em pastas")).toBe(true);
    expect(pedeAcaoNoContexto("o público são mães de 30 a 45 anos")).toBe(false);
  });

  it("Mesa Foto: aprovar e mandar para campanha travam referência da internet; campanha pelo apelido", () => {
    const campanhas = [{ id: ID(8), nome: "Dia dos Pais", status: "planejada" }, { id: ID(9), nome: "Antiga", status: "encerrada" }];
    const a = normalizarAcoesDaMesaFoto(
      {
        resumo: "",
        itens: [
          { operacao: "aprovar_foto", ref: "i3", para: "" },
          { operacao: "mandar_para_campanha", ref: "i3", para: "c1" },
          { operacao: "aprovar_foto", ref: "i2", para: "" },
          { operacao: "mandar_para_campanha", ref: "i1", para: "c2" },
          { operacao: "aprovar_foto", ref: "i1", para: "" },
        ],
      },
      fotos,
      campanhas,
      "cliente-1",
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["aprovar_foto:i3", "mandar_para_campanha:i3"]);
    expect(a.itens[1]).toMatchObject({ para: ID(8), para_rotulo: "Dia dos Pais" });
    expect(a.ignorados).toEqual(["i1"]);
    expect(a.recusados.map((r) => r.motivo)).toEqual(["Referência da internet não vira foto do cliente.", "Esta foto já está aprovada."]);
    expect(blocoDasAcoesDaMesaFoto(fotos, campanhas)).toContain("c1 | Dia dos Pais");
    expect(blocoDasAcoesDaMesaFoto(fotos, campanhas)).not.toContain("Antiga");
    expect(pedeAcaoNasFotos("aprove todas as fotos do ensaio")).toBe(true);
    expect(alvosDoAcervo(fotos)[1].detalhe).toContain("não aprovada");
  });
});

// ------------------------------------------------------------------ agente do mês (novas ações)

const tarefas: PecaDaAgenda[] = [
  { id: ID(1), title: "Carrossel outono", due_date: "2026-10-06", delivery_type: "carousel", status: "todo", campanha: "Outono" },
  { id: ID(2), title: "Estático promo", due_date: "2026-10-08", delivery_type: "static", status: "todo" },
  { id: ID(3), title: "Reels bastidor", due_date: "2026-10-10", delivery_type: "reel", status: "todo" },
];

describe("agente do mês: refazer, formato, campanhas e gerar meses", () => {
  it("mudar formato aceita nome em português e combina com mudar a data", () => {
    const pecas = pecasComApelido(tarefas);
    const a = normalizarAcoesNaAgenda(
      { resumo: "", apagar: [], refazer: [], mudar_data: [{ ref: "a2", data: "2026-10-09" }], mudar_formato: [{ ref: "a2", formato: "Carrossel" }, { ref: "a3", formato: "reels" }, { ref: "a1", formato: "podcast" }], editar_campanhas: [] },
      pecas,
    )!;
    expect(a.mudar_data.map((m) => m.task_id)).toEqual([ID(2)]);
    expect(a.mudar_formato.map((m) => [m.task_id, m.formato_para, m.formato_para_nome])).toEqual([[ID(2), "carousel", "carrossel"]]);
    expect(a.ignorados).toEqual(["a3", "a1"]);
  });

  it("refazer não divide a peça com outra ação e tem limite", () => {
    const pecas = pecasComApelido(tarefas);
    const a = normalizarAcoesNaAgenda({ resumo: "", apagar: ["a1"], refazer: ["a1", "a2"], mudar_data: [{ ref: "a2", data: "2026-10-20" }], mudar_formato: [], editar_campanhas: [] }, pecas)!;
    expect(a.apagar.map((i) => i.task_id)).toEqual([ID(1)]);
    expect(a.refazer.map((i) => i.task_id)).toEqual([ID(2)]);
    expect(a.mudar_data).toEqual([]);
    expect(a.resumo).toContain("refazer 1 peça");
  });

  it("editar campanha pelo apelido; período ao contrário não entra; campanha inventada é ignorada", () => {
    const campanhas = campanhasComApelido([
      { id: ID(5), nome: "Antiga", status: "encerrada", periodo_inicio: null, periodo_fim: null },
      { id: ID(6), nome: "Outono", status: "planejada", periodo_inicio: "2026-10-01", periodo_fim: "2026-10-31" },
    ]);
    expect(campanhas.map((c) => `${c.ref}:${c.nome}`)).toEqual(["c1:Outono", "c2:Antiga"]);
    const a = normalizarAcoesNaAgenda(
      {
        resumo: "",
        apagar: [],
        refazer: [],
        mudar_data: [],
        mudar_formato: [],
        editar_campanhas: [
          { ref: "c1", nome: "Outono 2026", status: "encerrada", periodo_inicio: "", periodo_fim: "2026-09-01" },
          { ref: "c9", nome: "X", status: "", periodo_inicio: "", periodo_fim: "" },
        ],
      },
      pecasComApelido(tarefas),
      campanhas,
    )!;
    expect(a.editar_campanhas).toEqual([{ campanha_id: ID(6), nome_atual: "Outono", campos: { nome: "Outono 2026", status: "encerrada" } }]);
    expect(a.ignorados).toEqual(["c9"]);
  });

  it("gerar meses: só de agora até 12 à frente, frequência de 1 a 14, projeto do servidor", () => {
    const g = normalizarGeracao({ resumo: "", meses: ["2026-10", "2026-09", "2026-10-01", "2025-12", "2028-01", "2026-13"], frequencia_semanal: 40 }, "2026-09", { id: "p1", nome: "Social" }, 3)!;
    expect(g.meses).toEqual(["2026-09", "2026-10"]);
    expect(g.frequencia_semanal).toBe(3);
    expect(g.project_id).toBe("p1");
    expect(normalizarGeracao({ resumo: "", meses: ["2025-01"], frequencia_semanal: 3 }, "2026-09", null)).toBeNull();
    expect(geracaoDaMensagem([{ tipo: "acao_agenda" }, g])!.meses).toEqual(["2026-09", "2026-10"]);
  });

  it("o texto do refazer é o mesmo na tela e no servidor, e o modo Criar manda estes pedidos para o agente do mês", () => {
    const itens = [{ titulo: "Carrossel  outono", data: "2026-10-06", formato: "carrossel" }];
    expect(pedidoParaRefazerDaTela(itens)).toBe(pedidoParaRefazer(itens));
    for (const t of ["Refaça os conteúdos da semana", "Crie todos os conteúdos de outubro", "mude o formato do reels para carrossel", "Gere de novo o post de sexta"]) {
      expect(ehPedidoNaAgenda(t)).toBe(true);
    }
    expect(ehPedidoNaAgenda("3 conteúdos para a campanha de outubro")).toBe(false);
  });

  it("o servidor de cada agente liga executar e desfazer", () => {
    const ler = (p: string) => readFileSync(resolve(__dirname, "../../supabase/functions", p), "utf8");
    expect(ler("estudio-arte/index.ts")).toContain("executar_acao_agente: executarAcaoDoDiretor");
    expect(ler("estudio-arte/index.ts")).toContain("desfazer_acao_agente: desfazerAcaoDoDiretor");
    // 29/09 (AG1): com fôlego (ler e montar pela conversa usam IA).
    expect(ler("agente-contexto/index.ts")).toContain("executar_acao_agente: (ch, corpo) => Promise.resolve(respostaComFolego(() => executarAcaoDoContexto(ch, corpo)");
    expect(ler("mesa-foto/index.ts")).toContain("executar_acao_agente: executarAcaoNasFotos");
    expect(ler("agente-calendario/index.ts")).toContain("registrar_geracao: registrarGeracao");
  });
});
