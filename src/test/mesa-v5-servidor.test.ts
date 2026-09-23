import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { juntarDitado } from "@/components/mesa/Ditado";

/**
 * Mesa v5 (23/09, noite): fotos da lâmina (fundo e elemento), referências em
 * destaque, referências escolhidas seguidas de perto, conversa da campanha e
 * o ditado grátis. Conferência pelo código das funções e do componente.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const calendario = ler("supabase/functions/agente-calendario/index.ts");
const direcao = ler("supabase/functions/_shared/direcao-arte.ts");
const migration = ler("supabase/migrations/20260923195925_mesa_referencias_destaque.sql");
const corpoDe = (fonte: string, nome: string) => {
  const i = fonte.indexOf(`function ${nome}(`);
  const j = fonte.indexOf("\nasync function ", i + 10);
  const k = fonte.indexOf("\nfunction ", i + 10);
  const fim = [j, k].filter((x) => x > 0).sort((a, b) => a - b)[0];
  return fonte.slice(i, fim);
};

describe("fotos da lâmina trazidas pela equipe", () => {
  it("só aceita caminho do próprio cliente no bucket mesa, 1 fundo e até 2 elementos", () => {
    const f = corpoDe(estudio, "lerFotosLivres");
    expect(f).toContain("caminho.startsWith(`${clientId}/`)");
    expect(f).toContain('caminho.indexOf("..") >= 0');
    expect(f).toContain('papel === "fundo" && saida.some((f) => f.papel === "fundo")');
    expect(f).toContain('saida.filter((f) => f.papel === "elemento").length >= 2');
    expect(direcao).toContain('export type FotoLivre = { caminho: string; papel: "fundo" | "elemento"; nota?: string };');
  });
  it("configurar grava as fotos e a direção refeita não as perde", () => {
    expect(corpoDe(estudio, "configurar")).toContain("mudou.fotos_livres = fotosLivres");
    expect(estudio).toContain("fotos_livres: velho?.fotos_livres,");
  });
  it("fundo com elementos vira edição sem máscara que mantém a foto e o rosto", () => {
    const g = corpoDe(estudio, "gerarCard");
    expect(g).toContain("if (baseFoto && elementos.length)");
    expect(g).toContain("editar: { bytes: baseFoto }, tamanho: TAMANHO_GERADOR");
    expect(g).toContain('modo: "foto_composta"');
    expect(g).toContain("mesmo rosto, feições");
  });
});

describe("referências", () => {
  it("destaque é coluna nova e entra sempre antes das outras", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS destaque boolean NOT NULL DEFAULT false");
    const e = corpoDe(estudio, "escolherReferencias");
    expect(e).toContain('.eq("destaque", true)');
    expect(e).toContain('jev: "destaque"');
    expect(e).toContain("[...destaques, ...resto]");
  });
  it("as escolhidas pela equipe são reproduzidas de perto com a identidade da marca", () => {
    expect(corpoDe(estudio, "gerarCard")).toContain("reproduza de perto esta peça");
  });
});

describe("conversa da campanha", () => {
  const c = corpoDe(calendario, "campanhaConversar");
  it("guarda a conversa presa à campanha e não mexe em conteúdo já gravado", () => {
    expect(calendario).toContain('const REF_CAMPANHA = "mesa_campanha";');
    expect(c).toContain('proposta.status !== "gravada"');
    expect(c).toContain("item.campanha_id = c.id;");
    expect(calendario).toContain("  campanha_conversar: campanhaConversar,");
  });
});

describe("ditado", () => {
  it("junta o falado ao que já estava no campo", () => {
    expect(juntarDitado("", "  quero três posts  ")).toBe("Quero três posts");
    expect(juntarDitado("Oi.", "quero três posts")).toBe("Oi. quero três posts");
    expect(juntarDitado("Oi. ", "tudo")).toBe("Oi. tudo");
    expect(juntarDitado("Oi", "   ")).toBe("Oi");
  });
});

describe("carrossel contínuo por panorama (dono, 23/09 noite)", () => {
  it("divide o panorama em trechos de até 3 lâminas ligados pela primeira de cada trecho", async () => {
    const { trechoDaLamina } = await import("../../supabase/functions/_shared/direcao-arte");
    expect(trechoDaLamina(1, 2)).toEqual({ inicio: 1, fim: 2 });
    expect(trechoDaLamina(3, 3)).toEqual({ inicio: 1, fim: 3 });
    expect(trechoDaLamina(2, 6)).toEqual({ inicio: 1, fim: 3 });
    expect(trechoDaLamina(4, 6)).toEqual({ inicio: 3, fim: 5 });
    expect(trechoDaLamina(5, 6)).toEqual({ inicio: 3, fim: 5 });
    expect(trechoDaLamina(6, 6)).toEqual({ inicio: 5, fim: 6 });
    expect(trechoDaLamina(4, 4)).toEqual({ inicio: 3, fim: 4 });
    expect(trechoDaLamina(7, 7)).toEqual({ inicio: 5, fim: 7 });
    // Todo trecho tem pelo menos 2 lâminas e no máximo 3.
    for (let total = 2; total <= 10; total++) {
      for (let o = 1; o <= total; o++) {
        const t = trechoDaLamina(o, total);
        expect(o >= t.inicio && o <= t.fim).toBe(true);
        expect(t.fim - t.inicio + 1).toBeGreaterThanOrEqual(2);
        expect(t.fim - t.inicio + 1).toBeLessThanOrEqual(3);
      }
    }
  });
  it("a lâmina contínua usa a fatia do panorama como base e só desenha o texto por cima", () => {
    const g = corpoDe(estudio, "gerarCard");
    expect(g).toContain("usaPanorama(t, card, modeloImagem.provedor)");
    expect(g).toContain("await garantirFundoContinuo(ch, t, ordem, kit)");
    expect(g).toContain('modo: panorama ? "panorama" : "foto_real"');
    // A continuidade antiga (tela dupla) só roda sem base: com panorama a base existe.
    expect(g.indexOf("await garantirFundoContinuo(")).toBeLessThan(g.indexOf("const continuar ="));
  });
  it("o trecho seguinte continua da lâmina de ligação e corrige o tom na emenda", () => {
    const f = corpoDe(estudio, "garantirFundoContinuo");
    expect(f).toContain("telaDoTrecho(k, await baixar(\"mesa\", ligacao))");
    expect(f).toContain("corrigirEmenda(await baixar(\"mesa\", ligacao), fatias[1])");
    expect(f).toContain("tamanhoFixo: true");
  });
  it("ligar, desligar ou refazer apaga o panorama; a tela prepara o fundo antes de cada lâmina", () => {
    expect(corpoDe(estudio, "configurar")).toContain("conjunto.refazer_fundo === true ? { panorama: null }");
    expect(estudio).toContain("  preparar_fundo: prepararFundo,");
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain('acao: "preparar_fundo"');
    expect(aba.indexOf('acao: "preparar_fundo"')).toBeLessThan(aba.indexOf('acao: "gerar_card"'));
  });
});
