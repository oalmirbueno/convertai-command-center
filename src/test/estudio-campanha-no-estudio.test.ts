import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aplicarFotosDoPlano, fotoNaoPublicavel, pecasDoPlanoGravado } from "../../supabase/functions/_shared/fotos-do-plano";

/**
 * 25/09: imagens da campanha no Estúdio (pedido da frente de campanhas) e os
 * dois pedidos da Mesa Ads para o estudio-arte (conferência do criativo julga
 * a imagem genérica e o tom; ajuste usa as referências escolhidas).
 * Conferência pelo código da função e pelas funções puras compartilhadas.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const calendario = ler("supabase/functions/agente-calendario/index.ts");
const corpoDe = (fonte: string, nome: string) => {
  const i = fonte.indexOf(`function ${nome}(`);
  const j = fonte.indexOf("\nasync function ", i + 10);
  const k = fonte.indexOf("\nfunction ", i + 10);
  const fim = [j, k].filter((x) => x > 0).sort((a, b) => a - b)[0];
  return fonte.slice(i, fim);
};

const ID1 = "11111111-1111-1111-1111-111111111111";
const ID2 = "22222222-2222-2222-2222-222222222222";
const foto = (id: string, bucket = "mesa") => ({ id, storage_bucket: bucket, storage_path: `cli/${id}.jpg`, nome: `foto ${id.slice(0, 2)}` });

describe("fotos do plano de imagens: módulo compartilhado", () => {
  it("lê o plano gravado com cuidado (só peças com tema, ordem e id válidos)", () => {
    const pecas = pecasDoPlanoGravado({
      pecas: [
        { tema_id: "c1", ordem: 1, imagem_id: ID1, uso: "fundo", por_que: "capa com o produto" },
        { tema_id: "c1", ordem: 2, imagem_id: ID2, uso: "elemento" },
        { tema_id: "c1", ordem: 0, imagem_id: ID1 },
        { tema_id: "", ordem: 3, imagem_id: ID1 },
        { tema_id: "c1", ordem: 4, imagem_id: "nao-e-uuid" },
      ],
    });
    expect(pecas).toEqual([
      { tema_id: "c1", ordem: 1, imagem_id: ID1, uso: "fundo", por_que: "capa com o produto" },
      { tema_id: "c1", ordem: 2, imagem_id: ID2, uso: "elemento", por_que: "" },
    ]);
    expect(pecasDoPlanoGravado(null)).toEqual([]);
  });

  it("fundo vira imagens_ids (sem repetir foto), elemento vira fotos_livres; contínuo não recebe foto", () => {
    const pecas = pecasDoPlanoGravado({
      pecas: [
        { tema_id: "c1", ordem: 1, imagem_id: ID1, uso: "fundo" },
        { tema_id: "c1", ordem: 2, imagem_id: ID1, uso: "fundo" },
        { tema_id: "c1", ordem: 3, imagem_id: ID2, uso: "elemento", por_que: "produto recortado" },
        { tema_id: "outro", ordem: 1, imagem_id: ID2, uso: "fundo" },
      ],
    });
    const fotos = new Map([[ID1, foto(ID1)], [ID2, foto(ID2)]]);
    const direcao = { carrossel_infinito: false, cards: [{ ordem: 1 }, { ordem: 2 }, { ordem: 3 }] as any[] };
    expect(aplicarFotosDoPlano(direcao, "c1", pecas, fotos)).toBe(2);
    expect(direcao.cards[0].imagens_ids).toEqual([ID1]);
    expect(direcao.cards[1].imagens_ids).toBeUndefined();
    expect(direcao.cards[2].fotos_livres).toEqual([{ caminho: `cli/${ID2}.jpg`, papel: "elemento", nota: "foto 22: produto recortado" }]);
    const continuo = { carrossel_infinito: true, cards: [{ ordem: 1 }] as any[] };
    expect(aplicarFotosDoPlano(continuo, "c1", pecas, fotos)).toBe(0);
    expect(continuo.cards[0].imagens_ids).toBeUndefined();
  });

  it("referência baixada da internet não é publicável", () => {
    expect(fotoNaoPublicavel({ tags: ["referencia_web"] })).toBe(true);
    expect(fotoNaoPublicavel({ tags: ["nao_publicar"] })).toBe(true);
    expect(fotoNaoPublicavel({ tags: ["produto"] })).toBe(false);
    expect(fotoNaoPublicavel({})).toBe(false);
  });

  it("o agente-calendario usa o mesmo módulo (não tem mais cópia própria)", () => {
    expect(calendario).toContain('import { aplicarFotosDoPlano, pecasDoPlanoGravado } from "../_shared/fotos-do-plano.ts";');
    expect(calendario).not.toContain("export function aplicarFotosDoPlano(");
    expect(calendario).not.toContain("export function pecasDoPlanoGravado(");
  });
});

describe("imagens da campanha no Estúdio", () => {
  it("lerCampanha usa select(*): traz briefing, imagens e plano_imagens sem quebrar antes do SQL", () => {
    const c = corpoDe(estudio, "lerCampanha");
    expect(c).toContain('.select("*")');
    expect(c).toContain('.eq("client_id", clientId)');
  });

  it("blocoDaCampanha leva produto em foco, oferta e mensagem central", () => {
    const b = corpoDe(estudio, "blocoDaCampanha");
    expect(b).toContain("- Produto em foco");
    expect(b).toContain("- Oferta da campanha");
    expect(b).toContain("- Mensagem central");
    expect(corpoDe(estudio, "briefingDaCampanha")).toContain("mensagem_central: texto(b.mensagem_central, 400)");
  });

  it("o plano é achado pelo tema_id do item e as fotos vêm do acervo do cliente (ativas e publicáveis)", () => {
    const p = corpoDe(estudio, "planoDaCampanhaNoItem");
    expect(p).toContain("pecasDoPlanoGravado(c.plano_imagens).filter((p) => p.tema_id === tema)");
    expect(p).toContain('.eq("client_id", clientId).eq("ativa", true)');
    expect(p).toContain("!fotoNaoPublicavel(f)");
    expect(corpoDe(estudio, "preparar")).toContain("await planoDaCampanhaNoItem(clientId, campanha, item.itemProposta?.tema_id)");
  });

  it("modo roteiro aplica as fotos do plano como o gravar", () => {
    expect(corpoDe(estudio, "preparar")).toContain("if (campanha && plano.pecas.length) aplicarFotosDoPlano(direcao, plano.tema, plano.pecas, plano.fotos);");
  });

  it("modo diretor recebe briefing, imagens da campanha e peças do plano, e as fotos entram no acervo", () => {
    const p = corpoDe(estudio, "preparar");
    expect(p).toContain("briefing: campanha.briefing && Object.keys(campanha.briefing).length ? campanha.briefing : null,");
    expect(p).toContain("imagens_da_campanha: imagensDaCampanha(campanha)");
    expect(p).toContain("pecas_do_plano: plano.pecas.map((p) => ({ ordem: p.ordem, imagem_acervo: p.imagem_id, uso: p.uso, por_que: p.por_que || null })),");
    expect(p).toContain("for (const f of plano.fotos.values()) if (!junto.some((a) => a.id === f.id)) junto.push(f);");
    expect(estudio).toContain("use imagem_acervo = esse id nessa lâmina");
  });
});

describe("pedidos da Mesa Ads ao estudio-arte", () => {
  it("conferência do criativo julga a imagem genérica (Noul) e o tom pedido (Score), como aviso", () => {
    const v = corpoDe(estudio, "verificar");
    expect(v).toContain("const tomPedido = ads ? tomValido(t.direcao.tom) : null;");
    expect(v).toContain('type: "noul"');
    expect(v).toContain("criteria: TONS[tomPedido].niveis_jev,");
    expect(v).toContain("v.generico = { probabilidade:");
    expect(v).toContain("tom: tomPedido } as Verificacao[\"tom\"]");
    // Sem laço: a autocorreção não lê genérico nem tom.
    const auto = ler("supabase/functions/estudio-arte/autocorrecao.ts");
    expect(auto).not.toContain("generico");
    expect(auto).not.toMatch(/v\.tom\b/);
  });

  it("ajustar_card anexa as referências escolhidas pela equipe (fora do contínuo e da autocorreção)", () => {
    const a = corpoDe(estudio, "ajustarCard");
    expect(a).toContain("for (const ref of await referenciasDaEquipe(base, card)) {");
    expect(a).toContain("referência ESCOLHIDA PELA EQUIPE");
    expect(a).toContain("if (!auto && !naEmenda) {");
    expect(a).toContain("referencias: idsReferencias,");
  });
});

describe("sem travessão nos textos novos", () => {
  it("módulos novos e o estudio-arte", () => {
    for (const f of [
      "supabase/functions/_shared/carrossel-continuo.ts",
      "supabase/functions/_shared/fotos-do-plano.ts",
      "src/components/mesa/EstudioBaseDaLamina.tsx",
    ]) expect(ler(f)).not.toContain("—");
    expect(corpoDe(estudio, "garantirFundoContinuo")).not.toContain("—");
  });
});
