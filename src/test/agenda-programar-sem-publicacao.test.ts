import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Agenda: "Programar publicação" pela ficha de um conteúdo SEM publicação nenhuma (o post que nasce de uma
 * tarefa). A Frente AP levou as lâminas e o modo de entrega da arte aprovada só para a publicação planejada que
 * já existia; no ramo `!active` a publicação nova ia com `asset_file_ids: []` fixo. Como a chave existe, o banco
 * segue o caminho aprovado e congela 0 lâminas em modo manual: fica "agendada", mas o motor não publica.
 * O caminho equivalente do vídeo da pauta (videoDaPauta.ts) já espalhava a entrega aprovada.
 */

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

function blocoDaPublicacaoNova(fonte: string): string {
  const inicio = fonte.indexOf("if (!active) {\n          publications.push({");
  expect(inicio).toBeGreaterThan(-1);
  const fim = fonte.indexOf("});", inicio);
  return fonte.slice(inicio, fim);
}

describe("programar pela ficha sem publicação leva a arte aprovada", () => {
  it("a publicação nova espalha a entrega aprovada (lâminas + modo) em vez de lâminas vazias fixas", () => {
    const bloco = blocoDaPublicacaoNova(ler("src/components/editorial/EditorialDetailSheet.tsx"));
    expect(bloco).toMatch(/\.\.\.\(entregaAprovada \|\| \{ asset_file_ids: \[\] \}\)/);
    // Nenhuma chave fixa depois do espalhamento pode sobrescrever as lâminas.
    expect(bloco).not.toMatch(/^\s*asset_file_ids: \[\],/m);
    expect(bloco).not.toMatch(/^\s*delivery_mode:/m);
  });

  it("a entrega aprovada é calculada antes de montar as publicações", () => {
    const fonte = ler("src/components/editorial/EditorialDetailSheet.tsx");
    const calculo = fonte.indexOf("const entregaAprovada = scheduledAtIso");
    const push = fonte.indexOf("if (!active) {\n          publications.push({");
    expect(calculo).toBeGreaterThan(-1);
    expect(calculo).toBeLessThan(push);
  });
});
