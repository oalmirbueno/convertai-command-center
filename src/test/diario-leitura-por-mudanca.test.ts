import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 19/10: o leitor do Hermes (diary_consumer.py) abria o diário dos 73 vínculos a cada 2 minutos, cerca de
// 2.000 chamadas por hora ao aceleriq_operator_diary desde 08/10. O quadro passou a dizer quando cada
// vínculo recebeu a última entrada humana, e o leitor só abre o diário que mudou.
const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("diário lido só quando muda", () => {
  it("o quadro e o leitor usam o mesmo campo e o mesmo critério de entrada humana", () => {
    const quadro = ler("supabase/functions/_shared/aceleriq-operators-services.ts");
    const leitor = ler("integrations/hermes-operational/diary_consumer.py");
    expect(quadro).toContain("ultima_entrada_humana_em: ultimaHumana.get(String(l.id)) ?? null");
    expect(quadro).toContain(".or('author_kind.eq.humano,entry_type.in.(instrucao,decisao,correcao)')");
    expect(leitor).toContain('SEEN_FIELD = "ultima_entrada_humana_em"');
    expect(leitor).toContain('HUMAN_ENTRY_TYPES = {"instrucao", "decisao", "correcao"}');
    // Sem o campo (painel antigo ou falha de leitura), o leitor lê tudo, como antes.
    expect(leitor).toContain("if seen is None or SEEN_FIELD not in link:");
    expect(quadro).toContain("...(ultimaHumana ? { ultima_entrada_humana_em:");
  });
});
