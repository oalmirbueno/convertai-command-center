import { describe, expect, it } from "vitest";
import {
  criarContadorDeCusto,
  criarLimitador,
  efeitoDoParar,
  estimarTrabalho,
  juntarEventos,
  modeloParaOpencode,
  modeloServeParaCodigo,
  motivoParaRecusar,
  nomeDoProjeto,
  normalizarPedido,
  normalizarTrabalho,
  passouDoTeto,
  podeDesfazer,
  PROJETO_VALIDO,
  reservaAberta,
  resumirEventoDoOpencode,
  saldoLivre,
  TETO_MAXIMO_USD,
  transicaoValida,
} from "../../supabase/functions/_shared/motor-codigo";
import { criarTrabalho, ErroDoMotor, orcar, pararTrabalho } from "../../supabase/functions/_shared/motor-fila";

/**
 * Frente SIT (30/09): motor de código. Fila (pedido, reserva, Parar), estimativa
 * e teto, eventos (no máximo 1 por segundo) e o custo da sessão do opencode.
 */

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const BARATO = { id: "openrouter:deepseek/deepseek-v4-flash", provedor: "openrouter", modelo_api: "deepseek/deepseek-v4-flash", preco_entrada_1m: 0.0763, preco_saida_1m: 0.1526, preco_cache_1m: 0.01526, contexto_tokens: 1_048_576 };
const CARO = { id: "anthropic:claude-opus", provedor: "anthropic", modelo_api: "claude-opus-5-5", preco_entrada_1m: 4, preco_saida_1m: 20, preco_cache_1m: 0.4, contexto_tokens: 1_000_000 };

type Linha = Record<string, unknown>;

/** Banco falso do tamanho do que a fila usa (from/select/eq/in/contains/limit/insert/update). */
function bancoFalso(tabelas: Record<string, Linha[]>) {
  let n = 0;
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let patch: Linha = {};
    let novo: Linha | null = null;
    let limite = Infinity;
    const base = () => (tabelas[tabela] = tabelas[tabela] || []);
    const alvo = () => base().filter((l) => filtros.every((f) => f(l))).slice(0, limite);
    const fim = () => {
      if (op === "insert") return { data: novo, error: null };
      if (op === "update") {
        const a = alvo();
        a.forEach((l) => Object.assign(l, patch));
        return { data: a, error: null };
      }
      return { data: alvo(), error: null };
    };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.indexOf(l[c]) >= 0), q),
      contains: (c: string, v: unknown[]) => (filtros.push((l) => Array.isArray(l[c]) && v.every((x) => (l[c] as unknown[]).indexOf(x) >= 0)), q),
      gt: (c: string, v: number) => (filtros.push((l) => Number(l[c]) > v), q),
      order: () => q,
      limit: (k: number) => ((limite = k), q),
      insert: (p: Linha) => {
        op = "insert";
        novo = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, custo_usd: 0, resultado: {}, criado_em: new Date().toISOString(), ...p };
        base().push(novo);
        return q;
      },
      update: (p: Linha) => ((op = "update"), (patch = p), q),
      single: () => Promise.resolve(fim()),
      maybeSingle: () => {
        if (op !== "update") return Promise.resolve({ data: alvo()[0] ?? null, error: null });
        const r = fim().data as Linha[];
        return Promise.resolve({ data: r[0] ?? null, error: null });
      },
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(fim()).then(ok, erro),
    });
    return q;
  };
  return { from } as never;
}

const catalogo = () => [
  { ...BARATO, tipo: "texto", ativo: true, padrao_para: ["site"] },
  { ...CARO, tipo: "texto", ativo: true, padrao_para: ["estrategista"] },
  { id: "sem-preco", provedor: "openrouter", modelo_api: "x/y", tipo: "texto", ativo: true, preco_entrada_1m: null, preco_saida_1m: null, padrao_para: [] },
];

describe("estimativa e teto", () => {
  it("construir custa por seção; ajustar é uma passada; revisar, desfazer, zip e publicar não gastam modelo", () => {
    const tres = estimarTrabalho(CARO, "construir", 3);
    const uma = estimarTrabalho(CARO, "construir", 1);
    const ajuste = estimarTrabalho(CARO, "ajustar", 1);
    expect(tres.estimativa_usd).toBeGreaterThan(uma.estimativa_usd * 2);
    expect(ajuste.estimativa_usd).toBeLessThan(uma.estimativa_usd);
    expect(tres.passos).toBe(3);
    for (const t of ["revisar", "desfazer", "zip", "publicar"] as const) expect(estimarTrabalho(CARO, t, 3).estimativa_usd).toBe(0);
  });

  it("o teto sugerido é o dobro arredondado para cima em 5 centavos, com piso e com o máximo", () => {
    const e = estimarTrabalho(BARATO, "construir", 8);
    expect(e.teto_sugerido_usd).toBeGreaterThanOrEqual(e.estimativa_usd * 2);
    expect(Math.round(e.teto_sugerido_usd * 100) % 5).toBe(0);
    expect(estimarTrabalho(BARATO, "ajustar", 1).teto_sugerido_usd).toBeGreaterThanOrEqual(0.05);
    expect(estimarTrabalho({ ...CARO, preco_entrada_1m: 400, preco_saida_1m: 2000 }, "construir", 12).teto_sugerido_usd).toBe(TETO_MAXIMO_USD);
  });

  it("modelo sem preço não serve (o teto não valeria); modelo pelo OpenRouter vai com o preço do catálogo", () => {
    expect(modeloServeParaCodigo({ ...BARATO, tipo: "texto", ativo: true })).toBe(true);
    expect(modeloServeParaCodigo({ id: "x", provedor: "openrouter", modelo_api: "x", preco_entrada_1m: null, preco_saida_1m: null })).toBe(false);
    expect(modeloServeParaCodigo({ ...BARATO, contexto_tokens: 32_000 })).toBe(false);
    expect(modeloParaOpencode(BARATO)).toMatchObject({ providerID: "openrouter", modelID: "deepseek/deepseek-v4-flash", entrada1m: 0.0763, saida1m: 0.1526 });
    expect(modeloParaOpencode(CARO).providerID).toBe("anthropic");
  });

  it("passou do teto aborta; teto zero (trabalho sem modelo) nunca aborta", () => {
    expect(passouDoTeto(0.8, 0.8)).toBe(true);
    expect(passouDoTeto(0.79, 0.8)).toBe(false);
    expect(passouDoTeto(5, 0)).toBe(false);
  });
});

describe("reserva na carteira e recusa antes da fila", () => {
  it("a reserva soma teto menos gasto só dos trabalhos abertos", () => {
    const r = reservaAberta([
      { estado: "na_fila", teto_usd: 1, custo_usd: 0 },
      { estado: "executando", teto_usd: 2, custo_usd: 0.5 },
      { estado: "parando", teto_usd: 0.4, custo_usd: 0.6 },
      { estado: "feito", teto_usd: 9, custo_usd: 1 },
    ]);
    expect(r).toBe(2.5);
    expect(saldoLivre(3, r)).toBe(0.5);
  });

  it("recusa com motivo: teto abaixo da estimativa, saldo livre curto, credencial no pedido, seção faltando", () => {
    const base = normalizarPedido({ tipo: "construir", secoes: ["hero"], teto_usd: 1 });
    expect(motivoParaRecusar(base, { estimativaUsd: 0.2, saldoLivreUsd: 5, temModelo: true })).toBeNull();
    expect(motivoParaRecusar({ ...base, teto_usd: 0.1 }, { estimativaUsd: 0.2, saldoLivreUsd: 5, temModelo: true })!.codigo).toBe("teto_abaixo_da_estimativa");
    expect(motivoParaRecusar(base, { estimativaUsd: 0.2, saldoLivreUsd: 0.5, temModelo: true })!.codigo).toBe("saldo_insuficiente");
    expect(motivoParaRecusar(base, { estimativaUsd: 0.2, saldoLivreUsd: 5, temModelo: false })!.codigo).toBe("sem_modelo");
    expect(motivoParaRecusar(normalizarPedido({ tipo: "ajustar", secao: "hero", instrucao: "api_key: sk-abcdefghijklmnopqrstu", teto_usd: 1 }), { estimativaUsd: 0.1, saldoLivreUsd: 5, temModelo: true })!.codigo).toBe("credencial_no_pedido");
    expect(motivoParaRecusar(normalizarPedido({ tipo: "ajustar", instrucao: "mais contraste", teto_usd: 1 }), { estimativaUsd: 0.1, saldoLivreUsd: 5, temModelo: true })!.codigo).toBe("secao_vazia");
    // Sem custo de modelo (revisar), saldo e teto não contam.
    expect(motivoParaRecusar(normalizarPedido({ tipo: "revisar" }), { estimativaUsd: 0, saldoLivreUsd: 0, temModelo: false })).toBeNull();
  });

  it("o pedido é lido sem confiar: seção limpa, sem repetição, teto no máximo", () => {
    const p = normalizarPedido({ tipo: "construir", secoes: ["Hero", "hero", "faq<script>", ""], teto_usd: 999, alvo_trabalho_id: "nao-e-uuid" });
    expect(p.secoes).toEqual(["hero", "faqscript"]);
    expect(p.teto_usd).toBe(TETO_MAXIMO_USD);
    expect(p.alvo_trabalho_id).toBeNull();
    expect(normalizarPedido({ tipo: "rm -rf" }).tipo).toBe("construir");
  });
});

describe("fila no banco (motor-fila.ts)", () => {
  it("o pedido entra na fila com o teto reservado, o modelo do papel site e o pacote; o próximo que passa do saldo livre é recusado", async () => {
    const db = bancoFalso({ ia_modelos: catalogo(), ia_carteiras: [{ client_id: CLIENTE, saldo_usd: 1.5 }], motor_trabalhos: [], motor_eventos: [] });
    const { trabalho, orcamento } = await criarTrabalho(db, {
      clientId: CLIENTE, marcaId: null, mesa: "site", projeto: "aceleriq-4dd691a7", referencia: { tipo: "site", id: "11111111-1111-4111-8111-111111111111" },
      pedidoBruto: { tipo: "construir", secoes: ["hero", "faq"], teto_usd: 1 }, modeloId: null, pacote: { cliente: "AcelerIQ" }, userId: "u1",
    });
    expect(trabalho.estado).toBe("na_fila");
    expect(trabalho.modelo).toBe(BARATO.id);
    expect(trabalho.teto_usd).toBe(1);
    expect(orcamento.livre_usd).toBe(1.5);
    const o2 = await orcar(db, CLIENTE, { tipo: "ajustar", secao: "hero", instrucao: "x", teto_usd: 0.6 }, null);
    expect(o2.reservado_usd).toBe(1);
    await expect(
      criarTrabalho(db, { clientId: CLIENTE, marcaId: null, mesa: "site", projeto: "aceleriq-4dd691a7", referencia: null, pedidoBruto: { tipo: "ajustar", secao: "hero", instrucao: "mais respiro", teto_usd: 0.6 }, modeloId: null, pacote: {}, userId: "u1" }),
    ).rejects.toMatchObject({ codigo: "saldo_insuficiente", status: 402 });
  });

  it("modelo escolhido sem preço é recusado antes de gravar", async () => {
    const db = bancoFalso({ ia_modelos: catalogo(), ia_carteiras: [{ client_id: CLIENTE, saldo_usd: 10 }], motor_trabalhos: [] });
    await expect(orcar(db, CLIENTE, { tipo: "construir", secoes: ["hero"], teto_usd: 1 }, "sem-preco")).rejects.toBeInstanceOf(ErroDoMotor);
  });

  it("Parar: na fila vira cancelado na hora; rodando vira parando (o worker aborta a sessão)", async () => {
    const tabelas: Record<string, Linha[]> = {
      motor_trabalhos: [
        { id: "a0000000-0000-4000-8000-000000000001", client_id: CLIENTE, estado: "na_fila", tipo: "construir", projeto: "p-abc", teto_usd: 1, custo_usd: 0, resultado: {} },
        { id: "a0000000-0000-4000-8000-000000000002", client_id: CLIENTE, estado: "executando", tipo: "ajustar", projeto: "p-abc", teto_usd: 1, custo_usd: 0.1, resultado: {} },
      ],
      motor_eventos: [],
    };
    const db = bancoFalso(tabelas);
    const t1 = await pararTrabalho(db, normalizarTrabalho(tabelas.motor_trabalhos[0])!, "u1");
    const t2 = await pararTrabalho(db, normalizarTrabalho(tabelas.motor_trabalhos[1])!, "u1");
    expect(t1.estado).toBe("cancelado");
    expect(t2.estado).toBe("parando");
    expect(tabelas.motor_eventos.length).toBe(2);
    expect(efeitoDoParar("feito")).toBeNull();
    expect(transicaoValida("parando", "parado")).toBe(true);
    expect(transicaoValida("feito", "executando")).toBe(false);
  });

  it("Desfazer só vale para código terminado com commit", () => {
    expect(podeDesfazer({ estado: "feito", tipo: "ajustar", commit: "b", commit_anterior: "a" })).toBe(true);
    expect(podeDesfazer({ estado: "executando", tipo: "ajustar", commit: "b", commit_anterior: "a" })).toBe(false);
    expect(podeDesfazer({ estado: "feito", tipo: "revisar", commit: "b", commit_anterior: "a" })).toBe(false);
    expect(podeDesfazer({ estado: "feito", tipo: "ajustar", commit: "a", commit_anterior: "a" })).toBe(false);
  });

  it("o nome do projeto é seguro para pasta e para a Vercel", () => {
    const n = nomeDoProjeto("Café & Pão da Esquina!!", "4dd691a7-d481-451f-800b-5e6b6fdc8721");
    expect(n).toBe("cafe-pao-da-esquina-4dd691a7");
    expect(PROJETO_VALIDO.test(n)).toBe(true);
  });
});

describe("eventos resumidos e custo da sessão", () => {
  const ferramenta = (tool: string, input: Record<string, unknown>, status = "completed") => ({ type: "message.part.updated", properties: { part: { type: "tool", tool, sessionID: "s", state: { status, input, title: "" } } } });

  it("traduz o opencode em frases curtas e ignora o ruído", () => {
    expect(resumirEventoDoOpencode(ferramenta("write", { filePath: "C:\\AI\\p\\src\\secoes\\Hero.tsx" }))).toEqual({ tipo: "arquivo", resumo: "Escreveu src/secoes/Hero.tsx", dados: { arquivo: "src/secoes/Hero.tsx" } });
    expect(resumirEventoDoOpencode(ferramenta("bash", { command: "npm run checar" }))!.tipo).toBe("comando");
    expect(resumirEventoDoOpencode(ferramenta("read", { filePath: "x" }))).toBeNull();
    expect(resumirEventoDoOpencode(ferramenta("write", { filePath: "x" }, "running"))).toBeNull();
    expect(resumirEventoDoOpencode({ type: "message.part.delta", properties: {} })).toBeNull();
    expect(resumirEventoDoOpencode({ type: "session.error", properties: { error: { name: "ApiError", data: { message: "402" } } } })!.tipo).toBe("erro");
  });

  it("no máximo 1 evento por segundo: o que chega junto sai numa frase só, com o custo parcial", () => {
    const l = criarLimitador(1000);
    l.adicionar({ tipo: "arquivo", resumo: "Escreveu src/a.tsx", dados: { arquivo: "src/a.tsx" } });
    l.custo(0.0123);
    const primeiro = l.soltar(10_000);
    expect(primeiro!.resumo).toBe("Escreveu src/a.tsx");
    expect(primeiro!.dados!.custo_usd).toBe(0.0123);
    l.adicionar({ tipo: "arquivo", resumo: "Escreveu src/b.tsx", dados: { arquivo: "src/b.tsx" } });
    l.adicionar({ tipo: "arquivo", resumo: "Alterou src/c.tsx", dados: { arquivo: "src/c.tsx" } });
    l.adicionar({ tipo: "comando", resumo: "Rodou: npm run checar" });
    expect(l.soltar(10_500)).toBeNull();
    const junto = l.soltar(11_000)!;
    expect(junto.tipo).toBe("arquivo");
    expect(junto.resumo).toBe("Mexeu em 2 arquivos: src/b.tsx, src/c.tsx; Rodou: npm run checar");
    expect(l.soltar(12_500)).toBeNull();
    expect(juntarEventos([{ tipo: "arquivo", resumo: "x" }, { tipo: "erro", resumo: "falhou" }]).tipo).toBe("erro");
  });

  it("o custo da sessão soma a última versão de cada mensagem do assistente", () => {
    const c = criarContadorDeCusto();
    c.registrar({ id: "m1", role: "assistant", cost: 0.001, tokens: { input: 1000, output: 10, reasoning: 5, cache: { read: 200 } } });
    c.registrar({ id: "m1", role: "assistant", cost: 0.003, tokens: { input: 3000, output: 30, reasoning: 5, cache: { read: 600 } } });
    c.registrar({ id: "m1", role: "assistant", cost: 0, tokens: { input: 0, output: 0 } });
    c.registrar({ id: "m2", role: "assistant", cost: 0.002, tokens: { input: 100, output: 20 } });
    c.registrar({ id: "u1", role: "user", cost: 9 });
    expect(c.total()).toEqual({ custo_usd: 0.005, tokens_entrada: 3700, tokens_saida: 55, tokens_cache: 600 });
  });
});
