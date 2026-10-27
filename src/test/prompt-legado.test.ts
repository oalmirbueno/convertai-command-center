import { describe, expect, it } from "vitest";
import { direcaoCriativaParaImagem } from "../../supabase/functions/_shared/motor-criativo-campanha";
import { expectPromptLegado } from "./helpers/prompt-legado";

describe("comparação de prompts legados continua estrita", () => {
  const contexto = { anuncio: { formato: "stories_9x16" }, referencia: true };
  const bloco = direcaoCriativaParaImagem({ formato: "stories_9x16", referencia: true });
  const legado = "Cabeçalho\nTexto e marca\n\nRegras finais";
  const atual = `Cabeçalho\n${bloco}\nTexto e marca\n\nRegras finais`;

  it("aceita só um bloco completo novo no anúncio e nenhum no orgânico", () => {
    expectPromptLegado(atual, legado, contexto);
    expectPromptLegado(legado, legado, {});
  });

  it.each([
    ["ausente", legado],
    ["duplicado", atual.replace(bloco, `${bloco}\n${bloco}`)],
    ["alterado", atual.replace("Uma ideia", "Duas ideias")],
    ["texto fora do bloco alterado", atual.replace("Texto e marca", "Texto diferente")],
    ["separador alterado", atual.replace("\n\nRegras finais", "\nRegras finais")],
  ])("recusa bloco %s", (_nome, prompt) => {
    expect(() => expectPromptLegado(prompt, legado, contexto)).toThrow();
  });

  it("não permite o bloco de anúncios nem outras mudanças no orgânico", () => {
    expect(() => expectPromptLegado(atual, legado, {})).toThrow();
    expect(() => expectPromptLegado(`${legado}\n`, legado, {})).toThrow();
  });
});
