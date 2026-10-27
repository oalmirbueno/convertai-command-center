import { describe, expect, it } from "vitest";
import {
  chaveDaCena, CRITERIOS_DO_PAPEL, descricaoParaOAcervo, lerLeituraDasReferencias, lerPapeis, parearEOrdenar, pedidoDaLeitura, perguntasDosPapeis,
} from "../../supabase/functions/mesa-foto/referencias-organizar";
import { ordenarReferencias, paresDeTransformacao } from "../../supabase/functions/mesa-foto/foto-da-pauta-regras";
import { aplicarOrganizacao, corpoDoOrganizar, gruposDasReferencias } from "@/components/mesa-foto/fotoDaPautaApi";

const leitura = (descricao: string, cena: string, estado: string) => ({ descricao, cena, estado, externa: false });

describe("Entender as referências: leitura de visão", () => {
  it("lê uma descrição por imagem pela numeração, e a que faltar vem vazia", () => {
    const l = lerLeituraDasReferencias({ fotos: [
      { imagem: 2, descricao: "Sofá limpo", cena: "Sofá cinza", estado: "limpo, resultado", e_referencia_externa: false },
      { imagem: 1, descricao: "Sofá manchado", cena: "Sofá cinza", estado: "sujo, antes do serviço", e_referencia_externa: false },
    ] }, 3);
    expect(l.map((x) => x.descricao)).toEqual(["Sofá manchado", "Sofá limpo", ""]);
    expect(lerLeituraDasReferencias(null, 2)).toHaveLength(2);
    expect(descricaoParaOAcervo(l[0])).toBe("Sofá manchado (sujo, antes do serviço)");
    expect(descricaoParaOAcervo(l[2])).toBeNull();
  });

  it("o pedido da leitura numera as imagens e leva a pauta", () => {
    const t = pedidoDaLeitura({ titulo: "Limpeza de sofá", pedido: "antes e depois", fotos: [{ nome: "IMG_1.jpg" }, { nome: "IMG_2.jpg", gerada: true }] });
    expect(t).toMatch(/Pauta: Limpeza de sofá/);
    expect(t).toMatch(/Imagem 1: arquivo "IMG_1.jpg"/);
    expect(t).toMatch(/Imagem 2: arquivo "IMG_2.jpg"; imagem gerada por IA/);
  });

  it("a cena compara sem acento, caixa ou pontuação", () => {
    expect(chaveDaCena("Sofá  Cinza!")).toBe(chaveDaCena("sofa cinza"));
  });
});

describe("O papel é do Jev, com piso de confiança", () => {
  it("uma pergunta choice por foto, com os 5 papéis e as descrições no estado", () => {
    const { state, questions } = perguntasDosPapeis({ titulo: "Sofá", pedido: "", fotos: [
      { nome: "a.jpg", leitura: leitura("Sofá manchado", "sofá cinza", "sujo") },
      { nome: "b.jpg", leitura: leitura("Sofá limpo", "Sofá Cinza", "limpo") },
    ] });
    expect(Object.keys(questions)).toEqual(["f0", "f1"]);
    expect(questions.f0.type).toBe("choice");
    expect(Object.keys(questions.f0.criteria).sort()).toEqual(Object.keys(CRITERIOS_DO_PAPEL).sort());
    expect((state.fotos as { fotos_da_mesma_cena: number }[]).map((f) => f.fotos_da_mesma_cena)).toEqual([2, 2]);
    // O papel que a equipe marcou não entra no estado (não enviesa o Jev).
    expect(JSON.stringify(state)).not.toMatch(/papel/);
  });

  it("confiança baixa ou escolha inválida mantém o papel atual", () => {
    const d = lerPapeis(["produto", "produto", "estilo", "cenario"], {
      f0: { choice: "antes", confidence: 0.9 },
      f1: { choice: "depois", confidence: 0.4 },
      f2: { choice: "logo", confidence: 0.99 },
    });
    expect(d.map((x) => x.papel)).toEqual(["antes", "produto", "estilo", "cenario"]);
    expect(d.map((x) => x.trocou)).toEqual([true, false, false, false]);
    expect(lerPapeis(["antes"], null)[0]).toEqual({ papel: "antes", confianca: null, trocou: false });
  });
});

describe("Pares antes e depois pela cena", () => {
  it("cada antes fica logo antes do depois da mesma cena, e o gerador pareia igual", () => {
    const refs = [
      { imagem_id: "d-cozinha", papel: "depois" as const, cena: "Cozinha" },
      { imagem_id: "prod", papel: "produto" as const, cena: "frasco" },
      { imagem_id: "a-sofa", papel: "antes" as const, cena: "sofá cinza" },
      { imagem_id: "d-sofa", papel: "depois" as const, cena: "Sofa cinza" },
      { imagem_id: "a-cozinha", papel: "antes" as const, cena: "cozinha" },
    ];
    const { ordem, avisos } = parearEOrdenar(refs);
    expect(ordem.map((r) => r.imagem_id)).toEqual(["a-sofa", "d-sofa", "a-cozinha", "d-cozinha", "prod"]);
    expect(ordem.find((r) => r.imagem_id === "a-sofa")!.par).toBe("d-sofa");
    expect(ordem.find((r) => r.imagem_id === "prod")!.par).toBeNull();
    expect(avisos).toEqual([]);
    // O motor ordena por papel e pareia o 1º antes com o 1º depois: os pares batem com as cenas.
    const doMotor = ordenarReferencias(ordem);
    expect(paresDeTransformacao(doMotor).map((p) => [doMotor[p.antes].imagem_id, doMotor[p.depois].imagem_id])).toEqual([["a-sofa", "d-sofa"], ["a-cozinha", "d-cozinha"]]);
  });

  it("sem cena em comum pareia pela ordem e avisa; sobra sem par também avisa", () => {
    const { ordem, avisos } = parearEOrdenar([
      { imagem_id: "a1", papel: "antes" as const, cena: "pia" },
      { imagem_id: "d1", papel: "depois" as const, cena: "fogão" },
      { imagem_id: "a2", papel: "antes" as const, cena: "" },
    ]);
    expect(ordem.map((r) => [r.imagem_id, r.par])).toEqual([["a1", "d1"], ["d1", "a1"], ["a2", null]]);
    expect(avisos.join(" ")).toMatch(/pareados pela ordem/);
    expect(avisos.join(" ")).toMatch(/antes sem depois/);
  });
});

describe("Na tela: aplicar e agrupar", () => {
  it("aplica papel, descrição e ordem; o que entrou enquanto lia continua no fim", () => {
    const atuais = [{ imagem_id: "x", papel: "produto" as const }, { imagem_id: "y", papel: "produto" as const }, { imagem_id: "nova", papel: "estilo" as const }];
    const r = aplicarOrganizacao(atuais, [
      { imagem_id: "y", papel: "antes", descricao: "Pia suja", cena: "pia", confianca: 0.9, par: "x" },
      { imagem_id: "x", papel: "depois", descricao: "Pia limpa", cena: "pia", confianca: 0.8, par: "y" },
      { imagem_id: "saiu", papel: "produto", descricao: null, cena: null, confianca: null, par: null },
    ]);
    expect(r).toEqual([
      { imagem_id: "y", papel: "antes", descricao: "Pia suja", cena: "pia" },
      { imagem_id: "x", papel: "depois", descricao: "Pia limpa", cena: "pia" },
      { imagem_id: "nova", papel: "estilo" },
    ]);
    const grupos = gruposDasReferencias(r);
    expect(grupos[0]).toMatchObject({ tipo: "par", antes: { imagem_id: "y" }, depois: { imagem_id: "x" } });
    expect(grupos[1]).toMatchObject({ tipo: "solta", referencia: { imagem_id: "nova" } });
  });

  it("o corpo da ação leva só id e papel", () => {
    expect(corpoDoOrganizar({ clientId: "c1", taskId: "t1", titulo: "Pauta", pedido: " sofá ", referencias: [{ imagem_id: "a", papel: "antes", descricao: "x", cena: "y" }] }))
      .toEqual({ acao: "referencias_organizar", client_id: "c1", task_id: "t1", titulo: "Pauta", pedido: "sofá", referencias: [{ imagem_id: "a", papel: "antes" }] });
  });
});
