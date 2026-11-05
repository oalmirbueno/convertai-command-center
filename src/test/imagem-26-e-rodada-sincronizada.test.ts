import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aVersaoDoServidorGanha, OUTRO_APARELHO_PAROU_MS, rodadaDeOutroAparelho, type Rodada } from "@/components/central/rodadaDoAgente";

/** 05/11/2026 (dono): GPT Image 2.6 como padrão, e o Atualizar todos igual no celular e no computador. */
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");

const rodada = (m: Partial<Rodada> = {}, situacao = "aplicando") => ({
  ritual: "x", publicar: true, contextoGeral: "", iniciadaEm: "2026-11-05T10:00:00Z",
  itens: [{ cliente: { id: "c" }, incluir: true, situacao, preparo: {}, respostas: [], contexto: "", aplicado: null, reportId: null, publicado: false, tarefasCriadas: [], erro: null }],
  ...m,
}) as unknown as Rodada;

describe("rodada entre aparelhos", () => {
  it("vale a versão mais nova", () => {
    const velha = rodada({ atualizadaEm: "2026-11-05T10:00:00Z" });
    const nova = rodada({ atualizadaEm: "2026-11-05T11:00:00Z" });
    expect(aVersaoDoServidorGanha(velha, nova)).toBe(true);
    expect(aVersaoDoServidorGanha(nova, velha)).toBe(false);
    expect(aVersaoDoServidorGanha(null, velha)).toBe(true);
    expect(aVersaoDoServidorGanha(velha, null)).toBe(false);
    expect(aVersaoDoServidorGanha(rodada(), velha)).toBe(true);
  });

  it("o outro aparelho trabalhando continua Aplicando; parado há 5 minutos vira erro com Tentar de novo", () => {
    const agora = new Date("2026-11-05T11:00:00Z").getTime();
    const recente = rodada({ atualizadaEm: new Date(agora - 60_000).toISOString() });
    expect(rodadaDeOutroAparelho(recente, agora).itens[0].situacao).toBe("aplicando");
    const parada = rodada({ atualizadaEm: new Date(agora - OUTRO_APARELHO_PAROU_MS - 1000).toISOString() });
    expect(rodadaDeOutroAparelho(parada, agora).itens[0].situacao).toBe("erro");
  });

  it("a tela grava e confere no servidor, sem adotar nada enquanto ela mesma trabalha", () => {
    const s = ler("src/components/central/AgenteDaCentral.tsx");
    expect(s).toContain("gravarRodadaNoServidor(userId, atual)");
    expect(s).toContain("lerRodadaDoServidor(userId)");
    expect(s).toContain("if (Object.keys(ocupadosRef.current).length) return;");
  });

  it("cada pessoa só enxerga a própria rodada", () => {
    const sql = ler("supabase/migrations/20261105150100_agente_central_rodada_por_pessoa.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("USING (user_id = auth.uid() AND public.is_staff(auth.uid()))");
    expect(sql).toContain("REVOKE ALL ON public.agente_central_rodadas FROM anon;");
  });
});

describe("GPT Image 2.6", () => {
  it("vira o padrão pelo OpenRouter, sem desligar o 2.5", () => {
    const sql = ler("supabase/migrations/20261105150000_gpt_image_26_padrao.sql");
    expect(sql).toContain("'openrouter:openai/gpt-image-2.6-sunburst'");
    expect(sql).toContain("'openrouter:openai/gpt-image-2.6-flare'");
    expect(sql).toContain("array_append(array_remove(padrao_para, 'imagem'), 'imagem')");
    expect(sql).not.toMatch(/ativo = false/);
    expect(ler("src/lib/mesa/modelo-por-papel.ts")).toContain("candidatos: [GPT_IMAGE_26, GPT_IMAGE_25, GPT_IMAGE_25_DIRETO]");
    expect(ler("supabase/functions/mesa-foto/canvas.ts")).toContain('MOTOR_PADRAO_DO_CANVAS = "openrouter:openai/gpt-image-2.6-sunburst"');
  });
});
