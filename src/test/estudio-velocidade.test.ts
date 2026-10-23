import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cronometro,
  emParalelo,
  falhaDoMoldeGuardada,
  falhaDoMoldeParaGuardar,
  MOLDE_FALHO_VALE_MS,
  MOLDE_SEM_RESPOSTA_VALE_MS,
} from "../../supabase/functions/estudio-arte/velocidade";
import { proximoPasso, type ItemDaFila } from "../../supabase/functions/estudio-arte/fila-de-geracao";

/**
 * Velocidade da lâmina (23/10). Medição em produção: a lâmina que replica
 * referência levava 110 a 220 s porque o molde da referência (~95 s) falhava
 * sempre nas mesmas referências e era lido de novo a cada geração, e o
 * inventário esperava o molde sem depender dele. Fixa: a falha guardada por
 * referência e modelo, as etapas juntas sem mudar o resultado, o cronômetro
 * e que a autocorreção só roda com erro.
 */

const fonte = readFileSync(resolve(__dirname, "../../supabase/functions/estudio-arte/index.ts"), "utf8");
const corpoDe = (nome: string) => {
  const i = fonte.indexOf(`async function ${nome}(`);
  const fim = fonte.indexOf("\n}\n", i);
  return fonte.slice(i, fim);
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("tempo por etapa (cronômetro com relógio de mentira)", () => {
  it("mede cada etapa desde a anterior e o total", () => {
    let agora = 1_000;
    const c = cronometro(() => agora);
    agora += 9_000;
    c.marcar("preparo_e_texto_enxuto");
    agora += 47_000;
    c.marcar("referencia_molde_e_preenchimento");
    expect(c.tempos()).toEqual({
      total_ms: 56_000,
      etapas: [
        { etapa: "preparo_e_texto_enxuto", ms: 9_000 },
        { etapa: "referencia_molde_e_preenchimento", ms: 47_000 },
      ],
    });
  });

  it("molde (95 s) e inventário + preenchimento (50 s) juntos custam o maior, não a soma", async () => {
    // Relógio virtual: cada etapa "dura" o que a produção mediu; em paralelo, o tempo é o máximo.
    let relogio = 0;
    const etapa = <T>(dura: number, valor: T) => new Promise<T>((r) => setTimeout(() => { relogio = Math.max(relogio, dura); r(valor); }, dura / 1000));
    const c = cronometro(() => relogio);
    const [[logo, moldes], preench] = await emParalelo(
      Promise.all([etapa(2_000, "logo"), Promise.all([etapa(95_000, null)])]),
      etapa(50_000, { elementos: 3 }),
    );
    c.marcar("referencia_molde_e_preenchimento");
    expect(logo).toBe("logo");
    expect(moldes).toEqual([null]);
    expect(preench).toEqual({ elementos: 3 });
    expect(c.tempos().total_ms).toBe(95_000);
  });
});

describe("etapas em paralelo sem mudar o resultado", () => {
  it("devolve os dois resultados como antes (em sequência)", async () => {
    const ordem: string[] = [];
    const a = (async () => { await espera(20); ordem.push("molde"); return "molde"; })();
    const b = (async () => { ordem.push("preenchimento-comecou"); await espera(5); ordem.push("preenchimento"); return 7; })();
    const r = await emParalelo(a, b);
    expect(r).toEqual(["molde", 7]);
    // O preenchimento começou e terminou enquanto o molde rodava.
    expect(ordem).toEqual(["preenchimento-comecou", "preenchimento", "molde"]);
  });

  it("a falha do principal sobe primeiro e a do lado não fica solta", async () => {
    const soltas: unknown[] = [];
    const ouvir = (e: unknown) => soltas.push(e);
    process.on("unhandledRejection", ouvir);
    try {
      await expect(emParalelo(Promise.reject(new Error("saldo")), Promise.reject(new Error("lado")))).rejects.toThrow("saldo");
      await espera(10);
      expect(soltas).toEqual([]);
    } finally {
      process.off("unhandledRejection", ouvir);
    }
  });

  it("a falha do lado sobe depois do principal terminar", async () => {
    await expect(emParalelo(Promise.resolve(1), Promise.reject(new Error("cota")))).rejects.toThrow("cota");
  });

  it("no gerarCard o preenchimento roda junto com o molde e a logo, e os avisos dele vêm depois", () => {
    const g = corpoDe("gerarCard");
    const i = g.indexOf("await emParalelo(");
    expect(i).toBeGreaterThan(0);
    const bloco = g.slice(i, g.indexOf("avisosDaGeracao.push(...avisosDoPreenchimento);"));
    expect(bloco).toContain("moldeDaReferencia(t, refDoMolde(refsDaEquipe[i]), img, ch.userId, avisosDaGeracao)");
    expect(bloco).toContain("anexoDaLogo(t, logo, marca.nomeCliente, ch.userId, avisosDaGeracao)");
    expect(bloco).toContain("preenchimentoNaGeracao(t, card, {");
    expect(bloco).toContain("avisos: avisosDoPreenchimento,");
    // Uma só chamada ao preenchimento, e nenhuma espera sequencial depois do molde.
    expect(g.match(/preenchimentoNaGeracao\(/g) ?? []).toHaveLength(1);
    expect(g).not.toContain("const doPreenchimento = await preenchimentoNaGeracao(");
  });

  it("a conferência baixa a logo e lê as regras EVITAR junto com a leitura (mesmo julgamento)", () => {
    const v = corpoDe("verificar");
    expect(v.indexOf("const logoDaConferenciaP")).toBeLessThan(v.indexOf("await laminaFinal("));
    expect(v.indexOf("const regrasDaConferenciaP")).toBeLessThan(v.indexOf("await laminaFinal("));
    expect(v).toContain("const esperaLogo = levaLogo(t, card.ordem) && !!(await logoDaConferenciaP);");
    expect(v).toContain('const regrasEvitar = (await regrasDaConferenciaP).filter((r) => r.tipo === "evitar").slice(0, 3);');
    // A leitura da conferência continua com a mesma imagem e o mesmo teto (sem reduzir a arte para ler).
    expect(v).toContain("maxTokensSaida: 6_000,");
  });
});

describe("cache por referência: a falha do molde guardada", () => {
  const agora = new Date("2026-10-23T12:00:00Z");
  const modelo = "openrouter:openai/gpt-6.1-sol";

  it("guarda só a falha que se repete com a mesma imagem", () => {
    expect(falhaDoMoldeParaGuardar({ versao: 2, refId: "r1", modeloId: modelo, codigo: "json_invalido", agora })).toEqual({
      versao: 2, falhou: true, referencia_id: "r1", modelo, codigo: "json_invalido", lido_em: agora.toISOString(),
    });
    expect(falhaDoMoldeParaGuardar({ versao: 2, refId: "r1", modeloId: modelo, codigo: "provedor_timeout", agora })).not.toBeNull();
    // Saldo, cota, chave, rede e erro desconhecido: lê de novo da próxima vez.
    for (const codigo of ["saldo_insuficiente", "cota_da_chave_esgotada", "erro_desconhecido", "provedor_erro"]) {
      expect(falhaDoMoldeParaGuardar({ versao: 2, refId: "r1", modeloId: modelo, codigo, agora })).toBeNull();
    }
    // Sem saber o modelo (falhou antes de escolher o leitor): não guarda.
    expect(falhaDoMoldeParaGuardar({ versao: 2, refId: "r1", modeloId: "", codigo: "json_invalido", agora })).toBeNull();
  });

  it("vale para a mesma versão e o mesmo leitor, dentro do prazo", () => {
    const g = falhaDoMoldeParaGuardar({ versao: 2, refId: "r1", modeloId: modelo, codigo: "json_invalido", agora })!;
    const depois = (ms: number) => new Date(agora.getTime() + ms);
    expect(falhaDoMoldeGuardada(g, { versao: 2, modeloId: modelo, agora: depois(60_000) })).toBe("json_invalido");
    expect(falhaDoMoldeGuardada(g, { versao: 2, modeloId: modelo, agora: depois(MOLDE_FALHO_VALE_MS - 1) })).toBe("json_invalido");
    expect(falhaDoMoldeGuardada(g, { versao: 2, modeloId: modelo, agora: depois(MOLDE_FALHO_VALE_MS + 1) })).toBeNull();
    // Leitor novo ou versão nova do molde: lê de novo (pode dar certo).
    expect(falhaDoMoldeGuardada(g, { versao: 2, modeloId: "openrouter:outro", agora })).toBeNull();
    expect(falhaDoMoldeGuardada(g, { versao: 3, modeloId: modelo, agora })).toBeNull();
    // O molde que deu certo nunca é tratado como falha.
    expect(falhaDoMoldeGuardada({ versao: 2, molde: { blocos: [] } }, { versao: 2, modeloId: modelo, agora })).toBeNull();
    expect(falhaDoMoldeGuardada(null, { versao: 2, modeloId: modelo, agora })).toBeNull();
  });

  it("o tempo esgotado vale só 6 h", () => {
    const g = falhaDoMoldeParaGuardar({ versao: 2, refId: "r1", modeloId: modelo, codigo: "provedor_timeout", agora })!;
    expect(falhaDoMoldeGuardada(g, { versao: 2, modeloId: modelo, agora: new Date(agora.getTime() + MOLDE_SEM_RESPOSTA_VALE_MS - 1) })).toBe("provedor_timeout");
    expect(falhaDoMoldeGuardada(g, { versao: 2, modeloId: modelo, agora: new Date(agora.getTime() + MOLDE_SEM_RESPOSTA_VALE_MS + 1) })).toBeNull();
  });

  it("no servidor: com a falha guardada, segue sem o molde e com o mesmo aviso, sem chamar o leitor", () => {
    const m = corpoDe("moldeDaReferencia");
    expect(m).toContain('guardado.versao === VERSAO_DO_MOLDE && guardado.falhou !== true) return normalizarMolde(guardado.molde);');
    expect(m.indexOf("falhaDoMoldeGuardada(")).toBeLessThan(m.indexOf("await chamarTexto("));
    expect(m).toContain("O layout da referência não foi medido (");
    expect(m).toContain("if (falha) await guardarLeitura(caminho, falha);");
    // Saldo, cota e chave continuam subindo antes de guardar qualquer falha.
    expect(m.indexOf("if (erroQueSobe(e)) throw e;")).toBeLessThan(m.indexOf("falhaDoMoldeParaGuardar("));
    // O modelo, o teto e a imagem do molde não mudaram.
    expect(m).toContain("maxTokensSaida: 6_000,");
  });
});

describe("autocorreção só com erro da conferência", () => {
  const item: ItemDaFila = {
    id: "i", client_id: "c", trabalho_id: "t", ordem: 1, lote_id: "l", status: "rodando", etapa: "conferir", paralelo: 2,
    corrigir_sozinho: true, rodadas: 0, tentativas: 0, max_tentativas: 3, passos: 1, versoes_antes: 0, trava_token: "x",
    custo_usd: 0, pedido_por: "u", marca_id: null,
  };
  const agora = new Date("2026-10-23T12:00:00Z");

  it("conferência sem erro termina a lâmina (nenhuma 2ª geração)", () => {
    expect(proximoPasso(item, "conferir", { ok: true, corpo: { autocorrecao: { precisa: false } } }, agora).mudanca.status).toBe("feito");
    expect(proximoPasso(item, "conferir", { ok: true, corpo: {} }, agora).mudanca.status).toBe("feito");
  });

  it("com erro objetivo corrige uma vez, e só com Corrigir sozinho ligado", () => {
    const comErro = { ok: true as const, corpo: { autocorrecao: { precisa: true } } };
    expect(proximoPasso(item, "conferir", comErro, agora).mudanca.etapa).toBe("corrigir");
    expect(proximoPasso({ ...item, corrigir_sozinho: false }, "conferir", comErro, agora).mudanca.status).toBe("feito");
    expect(proximoPasso({ ...item, rodadas: 1 }, "conferir", comErro, agora).mudanca.status).toBe("feito");
  });
});
