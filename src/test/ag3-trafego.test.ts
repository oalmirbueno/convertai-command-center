/**
 * Frente AG3 (29/09): agentes de tráfego (Mesa Ads) sem bug e com a segurança
 * da Meta inegociável: verba, ativar e criar campanha só com Confirmar.
 * Evidência real: em 28/09 a campanha pausada "[NÃO ATIVAR] Tentativa técnica
 * incompleta | Reel Direct | 15 SET" tinha homônimo e "não aparecia nos alvos".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { acaoSemRisco, alvosComApelido, alvosComNomeRepetido, blocoDosAlvos } from "../../supabase/functions/mesa-ads/acoes-conta";
import { valorDaMensagem } from "../../supabase/functions/mesa-ads/ordem-direta";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const NOME = "[NÃO ATIVAR] Tentativa técnica incompleta | Reel Direct | 15 SET";

describe("segurança da Meta", () => {
  it("verba (subir ou baixar), ativar e montar nunca vão sozinhos; pausar, renomear e ligar criativo vão", () => {
    const i = (tipo: string, extra: Record<string, unknown> = {}) => ({ tipo, variacao_pct: null, para: null, de: null, ...extra }) as never;
    expect(acaoSemRisco(i("pausar"))).toBe(true);
    expect(acaoSemRisco(i("renomear"))).toBe(true);
    expect(acaoSemRisco(i("orcamento", { variacao_pct: -20 }))).toBe(false);
    expect(acaoSemRisco(i("orcamento", { de: { orcamento_diario_brl: 50 }, para: { orcamento_diario_brl: 30 } }))).toBe(false);
    for (const t of ["ativar", "montar_campanha_do_plano", "duplicar_anuncio", "trocar_criativo", "trocar_anuncio"]) expect(acaoSemRisco(i(t))).toBe(false);
  });

  it("o plano mandado ao agente não monta campanha sozinho", () => {
    const fonte = ler("supabase/functions/mesa-ads/index.ts");
    const inicio = fonte.indexOf("async function fazerOQueESeguro(");
    const corpo = fonte.slice(inicio, fonte.indexOf("\n}\n", inicio));
    expect(corpo).toContain("const candidato = (i: ItemDaAcaoNaConta) => !i.resultado && !i.ensaio && !i.indisponivel && acaoSemRisco(i);");
    expect(corpo).not.toMatch(/e\.montar && i\.tipo === "montar_campanha_do_plano"/);
  });

  it("verba em percentual ou número do nome não vira valor em reais", () => {
    expect(valorDaMensagem("sobe 20% a verba da campanha X")).toBeNull();
    expect(valorDaMensagem("aumenta a verba da campanha Promo 15 SET em 20%")).toBeNull();
    expect(valorDaMensagem("baixa 10 por cento a verba")).toBeNull();
    expect(valorDaMensagem("muda a verba da campanha X para R$ 1.234,50")).toBe(1234.5);
    expect(valorDaMensagem("coloca a verba do conjunto em 40 reais")).toBe(40);
    expect(valorDaMensagem("verba da Promo 15 SET para 35")).toBe(35);
    expect(valorDaMensagem("R$ 25 na campanha Promo 15 SET")).toBe(25);
    expect(valorDaMensagem("aumenta a verba")).toBeNull();
  });
});

describe("alvos do agente sênior", () => {
  const alvos = alvosComApelido({
    campanhas: [
      { campaign_id: "120247390733120137", nome: NOME, status: "PAUSED", orcamento_diario: null },
      { campaign_id: "120247390720470137", nome: `  ${NOME} `, status: "PAUSED", orcamento_diario: null },
      { campaign_id: "120247390700000001", nome: "Mensagens | Direct", status: "ACTIVE", orcamento_diario: 10 },
    ],
    conjuntos: [],
    anuncios: [],
  });

  it("homônimos são marcados com o final do id e não vão sozinhos", () => {
    const repetidos = alvosComNomeRepetido(alvos);
    // Os dois ids reais da Verzelo terminam em 0137: o final mostrado tem 8 dígitos.
    expect([...repetidos].sort()).toEqual(["120247390720470137", "120247390733120137"]);
    const bloco = blocoDosAlvos(alvos, []);
    expect(bloco).toContain("[nome repetido; final 33120137]");
    expect(bloco).toContain("[nome repetido; final 20470137]");
    expect(bloco).not.toContain("Mensagens | Direct [nome repetido");
    expect(bloco).not.toContain("120247390733120137");
    const fonte = ler("supabase/functions/mesa-ads/index.ts");
    expect(fonte).toContain("Há mais de um item com este nome: fica para você confirmar que é este.");
    expect(fonte).toContain("repetidos: alvosComNomeRepetido(alvos)");
  });

  it("campanha pausada sem gasto entra nos alvos do modelo (depois das citadas e das ativas)", () => {
    const fonte = ler("supabase/functions/mesa-ads/index.ts");
    expect(fonte).toContain("async function campanhasRecentesDaConta(");
    expect(fonte).toMatch(/orcamento_diario: x\.orcamento_diario \}\)\), \.\.\.recentes\]/);
  });
});

describe("confirmar, desfazer e conversa sem bug", () => {
  const fonte = ler("supabase/functions/mesa-ads/index.ts");

  it("dois cliques não executam duas vezes: trava condicional no banco antes de executar", () => {
    const i = fonte.indexOf("async function contaAcaoExecutar(");
    const corpo = fonte.slice(i, fonte.indexOf("\n}\n", i));
    expect(corpo).toContain("await travarConfirmacao(servico, m.id, m.client_id);");
    expect(fonte).toContain('.not("anexos", "cs", JSON.stringify([{ tipo: "acoes_conta", travada: true }]))');
    expect(fonte).toContain("acao_em_andamento");
  });

  it("o cartão só vira desfeito quando nada ficou com volta; o Desfazer de O que foi feito confere o resultado", () => {
    expect(fonte).toContain("const inteiro = !itens.some(temReverso);");
    expect(fonte).toContain("nao_voltaram");
    expect(fonte).toContain('if (!d.voltaram) throw new ErroHttp(409, "nao_desfeito"');
  });

  it("mensagem sempre com id; falha ao gravar tenta sem anexos e avisa a tela", () => {
    expect(fonte).toContain("id: m.id || crypto.randomUUID(),");
    expect(fonte).toContain("const semAnexos = linhas.map((l) => ({ ...l, anexos: [] }));");
    expect(fonte).toContain("aviso_da_conversa");
  });

  it("plano e oferta não perdem a mensagem do dono quando o modelo falha; a oferta não apaga a conversa", () => {
    expect(fonte).toContain("Não consegui responder: ${motivo}. O plano ficou como estava.");
    expect(fonte).toContain("Não consegui responder: ${motivo}. Nenhuma oferta foi criada.");
    expect(fonte).not.toContain('if (conversaNova) await servico.from("agente_conversas").delete()');
  });

  it("os três agentes aprendem, obedecem e sabem a data de hoje; regras_seguidas está nos esquemas", () => {
    expect((fonte.match(/aprenderNoServidor\(servico as never, \{ texto: mensagem, agente: "trafego"/g) || []).length).toBe(3);
    expect(fonte).toContain("sistemaDoAgenteSenior(objetivo) + blocoDasRegras(regrasEnsinadas)");
    expect(fonte).toContain("HOJE: hojeSaoPaulo(),");
    expect(fonte).toContain("esquecer_regra: esquecerRegraDoTrafego,");
    expect((fonte.match(/regras_seguidas: lista\(S\("string"\)\)/g) || []).length).toBe(2);
    expect(ler("supabase/functions/mesa-ads/agente-senior.ts")).toContain('regras_seguidas: lista(S("string")),');
  });
});
