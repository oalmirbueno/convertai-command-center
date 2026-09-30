import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fecharComMetodo, limparCacheDosSuperpoderes, superpoderesPara, AVISO_SEM_PROVA } from "../../supabase/functions/_shared/superpoderes";
import { comMetodosUsados, juntarMetodoAoSistema, TEXTOS_DO_ENTENDER } from "../../supabase/functions/_shared/superpoderes-catalogo";
import { gravarTroca } from "../../supabase/functions/_shared/conversa-das-mesas";

/**
 * Frente SPP (30/09/2026): a Mesa Roteiros é o molde. Os 4 passos:
 * 1) superpoderesPara no Promise.all, ao lado do contexto e das regras;
 * 2) metodo: sp na chamada ao modelo;
 * 3) metodos_usados no JSON pedido;
 * 4) fecharComMetodo antes do gravarTroca, e o anexo "metodo_usado" junto de
 *    "Aprendi" e "Segui".
 * Aqui o caminho roda de ponta a ponta com Jev, modelo e banco falsos.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const fonte = ler("supabase/functions/mesa-roteiros/index.ts");
const corpoDe = (nome: string) => {
  const i = fonte.indexOf(`async function ${nome}(`);
  const fim = fonte.indexOf("\nasync function ", i + 10);
  return fonte.slice(i, fim < 0 ? undefined : fim);
};

afterEach(() => {
  limparCacheDosSuperpoderes();
  vi.restoreAllMocks();
});

describe("o molde no código da Mesa Roteiros", () => {
  const conversa = corpoDe("agenteConversar");

  it("1) o método é escolhido em paralelo com o contexto e as regras", () => {
    const pAll = conversa.indexOf("await Promise.all([");
    const fimDoAll = conversa.indexOf("]);", pAll);
    const trecho = conversa.slice(pAll, fimDoAll);
    expect(trecho).toContain("CONTEXTO_DO_AGENTE.ler(");
    expect(trecho).toContain('regrasDaMesa(servico(), { clientId, mesa: "roteiro"');
    expect(trecho).toContain("superpoderesPara(servico(), {");
    expect(trecho).toContain('agente: "roteiros.agente"');
  });

  it("2) e 3) metodo: sp na chamada e metodos_usados no esquema do agente", () => {
    const chamada = conversa.slice(conversa.indexOf("const saida = await chamarTexto({"), conversa.indexOf("const j = (saida.json"));
    expect(chamada).toContain("metodo: sp,");
    expect(chamada).toContain("esquemaJson: ESQUEMA_AGENTE,");
    expect(fonte).toContain("const ESQUEMA_AGENTE = comMetodosUsados({");
  });

  it("4) fecharComMetodo antes do gravarTroca, com o anexo ao lado de Aprendi e Segui", () => {
    const fechar = conversa.indexOf("const fechado = await fecharComMetodo(servico(), { usoId: saida.usoId, metodo: sp, resposta, declarados: j.metodos_usados");
    const segui = conversa.indexOf("if (seguidas) anexos.push(seguidas);");
    const anexo = conversa.indexOf("if (fechado.anexo) anexos.push(fechado.anexo);");
    const gravar = conversa.indexOf("const troca = await gravarTroca(servico(), {");
    expect(fechar).toBeGreaterThan(0);
    expect(anexo).toBeGreaterThan(segui);
    expect(gravar).toBeGreaterThan(anexo);
    expect(conversa).toContain("acaoFeita: !!(acao && acao.executada_em)");
  });

  it("o roteirista recebe o método do código (gerar, ajustar o tom, refazer gancho)", () => {
    const escrever = corpoDe("escreverRoteiro");
    expect(escrever).toContain('superpoderesPara(servico(), { agente: "roteiros.roteirista", momento: p.tom ? "ajustar" : "gerar" })');
    expect(escrever).toContain("metodo: sp,");
    const gancho = corpoDe("refazerGancho");
    expect(gancho).toContain('superpoderesPara(servico(), { agente: "roteiros.roteirista", momento: "ajustar" })');
    expect(gancho).toContain("metodo: sp,");
  });
});

describe("o molde de ponta a ponta (Jev, modelo e banco falsos)", () => {
  function banco() {
    const inseridas: Array<Record<string, unknown>> = [];
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const db = {
      from: (tabela: string) => ({
        select: async () => ({ data: tabela === "superpoderes_das_mesas" ? [] : [], error: null }),
        insert: (linhas: Array<Record<string, unknown>>) => {
          inseridas.push(...linhas);
          return { select: async () => ({ data: linhas.map((l, i) => ({ id: `m${i + 1}`, papel: l.papel })), error: null }) };
        },
      }),
      rpc,
    };
    return { db, inseridas, rpc };
  }

  it("pedido grande: o Jev escolhe, o sistema leva o método, o anexo metodo_usado sai gravado pelo gravarTroca", async () => {
    const { db, inseridas, rpc } = banco();
    const perguntar = vi.fn(async () => ({
      answers: {
        caminho: { choice: "grande", confidence: 0.92 },
        falhou: { noul: 0.02 }, ajuste_recebido: { noul: 0.03 }, revisar: { noul: 0.1 }, varias_frentes: { noul: 0.1 }, acao_cara: { noul: 0.85 },
      },
    }));
    // 1) superpoderesPara (em paralelo com o contexto, na função de verdade).
    const sp = await superpoderesPara(db, { agente: "roteiros.agente", pedido: "Gera os roteiros da campanha de outubro, 4 vídeos.", ultimaResposta: null }, { perguntar });
    expect(sp).not.toBeNull();
    expect(sp!.ids).toEqual(["prova", "entender", "plano", "aceite"]);
    expect(sp!.texto).toContain(TEXTOS_DO_ENTENDER.grande);
    // 2) o sistema que vai ao modelo (chamarTexto faz esta junção com metodo: sp).
    const SISTEMA = "Você é o agente da Mesa Roteiros.";
    const enviado = juntarMetodoAoSistema(SISTEMA, sp);
    expect(enviado.endsWith(sp!.texto)).toBe(true);
    // 3) o modelo falso responde o JSON do esquema, com metodos_usados.
    const esquema = comMetodosUsados({ nome: "x", schema: { type: "object", additionalProperties: false, required: ["resposta"], properties: { resposta: { type: "string" } } } });
    expect(esquema.schema.required).toContain("metodos_usados");
    const modelo = vi.fn(async (sistema: string) => ({ texto: "", json: { resposta: sistema.indexOf("[plano]") >= 0 ? "Montei o cartão com os 4 roteiros; o custo aparece nele." : "?", metodos_usados: ["entender", "plano", "aceite"] }, usoId: "uso-9" }));
    const saida = await modelo(enviado);
    const j = saida.json;
    // 4) fechar e gravar.
    const fechado = await fecharComMetodo(db, { usoId: saida.usoId, metodo: sp, resposta: j.resposta, declarados: j.metodos_usados, acaoFeita: false }, { perguntar });
    expect(fechado.resposta).toBe("Montei o cartão com os 4 roteiros; o custo aparece nele.");
    const anexos: unknown[] = [{ tipo: "regras_seguidas", regras: [] }];
    if (fechado.anexo) anexos.push(fechado.anexo);
    const troca = await gravarTroca(db as never, { conversaId: "c1", clientId: "cl1", usuario: { conteudo: "Gera os roteiros", anexos: [] }, agente: { conteudo: fechado.resposta, anexos, uso_id: saida.usoId }, onde: "teste" });
    expect(troca.agenteId).toBe("m2");
    const doAgente = inseridas.find((l) => l.papel === "agente")!;
    expect(doAgente.anexos).toEqual(expect.arrayContaining([
      expect.objectContaining({ tipo: "metodo_usado", ids: ["entender", "plano", "aceite"], fonte: "declarado", caminho: "grande", prova: "nao_se_aplica" }),
    ]));
    // A prova foi gravada no uso (sem esperar).
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).toHaveBeenCalledWith("ia_uso_marcar_metodo", expect.objectContaining({ _uso_id: "uso-9", _prova: "nao_se_aplica" }));
    // O Jev foi chamado uma vez (a escolha), e não na prova (não houve suspeita).
    expect(perguntar).toHaveBeenCalledTimes(1);
  });

  it("resposta que diz 'gerei' sem ação feita: o aviso vai na mensagem gravada e a verificação fica pendente", async () => {
    const { db, inseridas } = banco();
    const perguntar = vi.fn(async (a: { questions: Record<string, unknown> }) => (a.questions.afirma_feito
      ? { answers: { afirma_feito: { noul: 0.95 } } }
      : { answers: { caminho: { choice: "pequeno", confidence: 0.9 }, falhou: { noul: 0 }, ajuste_recebido: { noul: 0.9 }, revisar: { noul: 0 }, varias_frentes: { noul: 0 }, acao_cara: { noul: 0 } } }));
    const sp = await superpoderesPara(db, { agente: "roteiros.agente", pedido: "Não gostei do gancho do r1, refaz." }, { perguntar });
    expect(sp!.ids).toEqual(["prova", "entender", "receber"]);
    const fechado = await fecharComMetodo(db, { usoId: "uso-1", metodo: sp, resposta: "Pronto, refiz o gancho do r1.", declarados: ["receber"], acaoFeita: false }, { perguntar });
    expect(fechado.resposta).toBe(`Pronto, refiz o gancho do r1. ${AVISO_SEM_PROVA}`);
    await gravarTroca(db as never, { conversaId: "c1", clientId: "cl1", usuario: { conteudo: "x", anexos: [] }, agente: { conteudo: fechado.resposta, anexos: [fechado.anexo], uso_id: "uso-1" }, onde: "teste" });
    const doAgente = inseridas.find((l) => l.papel === "agente")!;
    expect(String(doAgente.conteudo)).toContain("Ainda não fiz");
    expect(doAgente.anexos).toEqual([expect.objectContaining({ tipo: "metodo_usado", ids: ["receber"], prova: "faltou" })]);
  });
});
