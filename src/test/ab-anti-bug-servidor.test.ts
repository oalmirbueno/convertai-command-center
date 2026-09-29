import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { datasComMesSeguinte } from "../../supabase/functions/_shared/perfis-instagram";
import { blocoDasAcoesDosRoteiros, janelaDasPecas, normalizarAcoesDosRoteiros } from "../../supabase/functions/mesa-roteiros/acoes-dos-roteiros";

/**
 * Anti-bug 26/09 (frente AB), servidor: CPU das imagens por chamada, histórico
 * que perdia a conversa recente e o classificador de materiais que pagava o
 * Jev para arquivos que o banco não deixa gravar.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("CPU: várias fotos por chamada pedem a cópia leve em vez de abrir aqui", () => {
  it("imagem-reduzida usa a miniatura que a copias-leves gravou quando a caixa é pequena", () => {
    const f = ler("supabase/functions/_shared/imagem-reduzida.ts");
    const pedir = f.indexOf("if (opcoes.pedirCopia && (await pedirCopiaLeve(bucket, caminho)))");
    expect(pedir).toBeGreaterThan(0);
    const trecho = f.slice(pedir, f.indexOf("return { cabe: false", pedir));
    expect(trecho).toContain('copiasParaACaixa(maxL, maxA)[0] === "miniatura"');
    expect(trecho).toContain("caminhoDaMiniatura(caminho)");
    expect(trecho.indexOf("caminhoDaMiniatura")).toBeLessThan(trecho.indexOf("caminhoDaMedia"));
  });

  it("agente-contexto (12 fotos) e perfis-instagram (12 posts) pedem a cópia e não abrem foto grande", () => {
    const contexto = ler("supabase/functions/agente-contexto/index.ts");
    expect(contexto).toContain("reduzidaSemTransformacao(servico(), bucket, caminho, 640, 640, { maxBytes: 30 * 1024 * 1024, pedirCopia: true, maxPixels: 700_000 })");
    const perfis = ler("supabase/functions/perfis-instagram/index.ts");
    const i = perfis.indexOf("async function imagemDoPost(");
    const corpo = perfis.slice(i, perfis.indexOf("\n}\n", i));
    expect(corpo).toContain("pedirCopia: true");
    expect(corpo).toContain("maxPixels: 1_500_000");
    expect(corpo).toContain("aceitarCopiaMaiorAte: MAX_BYTES_ANEXO_DO_ESTILO");
  });

  it("mesa-foto: na queda sem cópia, foto acima de 6 MP não abre na função", () => {
    const f = ler("supabase/functions/mesa-foto/index.ts");
    const i = f.indexOf("async function baixarReduzida(");
    const corpo = f.slice(i, f.indexOf("\n}\n", i));
    expect(corpo).toContain("dim.largura * dim.altura > MAX_PIXELS_ABRIR_NA_QUEDA");
    expect(corpo.indexOf("MAX_PIXELS_ABRIR_NA_QUEDA")).toBeLessThan(corpo.indexOf("await reduzir(original, lado)"));
    expect(corpo).toContain('"imagem_grande_demais"');
    expect(f).toContain("const MAX_PIXELS_ABRIR_NA_QUEDA = 6_000_000;");
  });
});

describe("histórico das conversas: as mais recentes, na ordem", () => {
  it("agente-contexto devolve as 60 últimas mensagens (não as 60 primeiras)", () => {
    const f = ler("supabase/functions/agente-contexto/index.ts");
    const i = f.indexOf('.from("agente_mensagens")\n    .select("id, papel, conteudo, criado_em, anexos")');
    expect(i).toBeGreaterThan(0);
    const trecho = f.slice(i, i + 500);
    expect(trecho).toContain('.order("criado_em", { ascending: false })');
    expect(trecho).toContain(".slice().reverse()");
  });

  it("workspace-agent manda ao modelo as 30 últimas mensagens", () => {
    const f = ler("supabase/functions/workspace-agent/index.ts");
    // Frente AG3 (29/09): a pergunta de agora é gravada antes do modelo; o histórico lê 31 e tira ela (vai uma vez só, no fim).
    expect(f).toContain('.eq("thread_id", thread_id).order("created_at", { ascending: false }).limit(31);');
    expect(f).toContain("historicoRecente.slice(1).reverse()");
    expect(f).not.toContain('.eq("thread_id", thread_id).order("created_at", { ascending: true }).limit(30)');
  });
});

describe("perfis do Instagram: pautas do fim do mês passam para o mês seguinte", () => {
  it("sem dia útil sobrando no mês, as datas vêm do mês seguinte (antes a proposta sumia)", () => {
    const d = datasComMesSeguinte("2026-09", "2026-09-30", 3);
    expect(d).toHaveLength(3);
    expect(d.every((x) => x.slice(0, 7) === "2026-10")).toBe(true);
  });
  it("mais pautas que dias úteis: nenhuma data repetida no último dia", () => {
    // 28/09 (seg) a 30/09 (qua): 3 dias úteis depois de 27/09; 6 pautas.
    const d = datasComMesSeguinte("2026-09", "2026-09-27", 6);
    expect(d).toHaveLength(6);
    expect(new Set(d).size).toBe(6);
    expect(d.slice(0, 3)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(d.slice(3).every((x) => x.slice(0, 7) === "2026-10")).toBe(true);
  });
  it("dezembro vira janeiro do ano seguinte", () => {
    expect(datasComMesSeguinte("2026-12", "2026-12-31", 1)[0].slice(0, 7)).toBe("2027-01");
  });
  it("o pedido de ideias e a rodada do cron usam o mês seguinte", () => {
    const f = ler("supabase/functions/perfis-instagram/index.ts");
    expect(f.split("datasComMesSeguinte(mes, hojeEmSaoPaulo(),").length - 1).toBe(2);
  });
});

describe("Mesa Roteiros: pedido de mês à frente estica a janela das peças", () => {
  const peca = (i: number, data: string) => ({ id: `t${i}`, titulo: `Peça ${i}`, formato: "reels", data, roteiro_status: null });
  it("sem mês citado, a janela é a de sempre (7 dias atrás a 40 à frente)", () => {
    expect(janelaDasPecas("gere os roteiros da semana", "2026-09-26")).toEqual({ de: "2026-09-19", ate: "2026-11-05", estendida: false });
  });
  it("dezembro citado vai até o fim de dezembro", () => {
    const j = janelaDasPecas("gere os roteiros de dezembro", "2026-09-26");
    expect(j.ate).toBe("2027-01-01");
    expect(j.estendida).toBe(true);
  });
  it("mês que já passou sem ano é o do ano seguinte; com ano, respeita o ano (até um ano à frente)", () => {
    expect(janelaDasPecas("roteiros de março", "2026-09-26").ate).toBe("2027-04-01");
    expect(janelaDasPecas("mês que vem", "2026-12-10").ate).toBe("2027-02-01");
    expect(janelaDasPecas("peça de 2026-11-20", "2026-09-26").ate).toBe("2026-11-21");
  });
  it("o bloco diz o período e o apelido das peças além da 40ª resolve na janela estendida", () => {
    const j = janelaDasPecas("roteiros de novembro e dezembro", "2026-09-26");
    const pecas = Array.from({ length: 60 }, (_, i) => peca(i + 1, "2026-11-10"));
    const bloco = blocoDasAcoesDosRoteiros([], pecas, j, 60);
    expect(bloco).toContain("p60");
    expect(bloco).toContain("(Peças com data de ");
    expect(bloco).not.toContain("Mostrando");
    // Mais peças no período do que cabem: o agente fica sabendo quantas ficaram de fora.
    expect(blocoDasAcoesDosRoteiros([], pecas, j, 200)).toContain("Mostrando 120 de 200 peças");
    const vazio = blocoDasAcoesDosRoteiros([], [], j);
    expect(vazio).toContain("nenhuma de ");
    const acao = normalizarAcoesDosRoteiros({ resumo: "gerar", itens: [{ ref: "p55", operacao: "gerar_roteiro", para: "tutorial" }] }, [], pecas, "c1", 0.01);
    expect(acao && acao.itens.map((i) => i.alvo_id)).toEqual(["t55"]);
  });
  it("a função passa a janela do pedido às listas e ao bloco", () => {
    const f = ler("supabase/functions/mesa-roteiros/index.ts");
    expect(f).toContain("const janela = janelaDasPecas(mensagem, hojeDoPedido);");
    expect(f).toContain("listasParaOAgente(clientId, janela)");
    // AG2: o bloco também leva os comentários do roteiro aberto (c1..); a janela continua passando.
    expect(f).toContain("blocoDasAcoesDosRoteiros(roteirosOrdenados, listas.pecas, janela, listas.totalDePecas, comentarios)");
  });
});

describe("materiais-classificar só julga o que o banco deixa gravar", () => {
  const f = ler("supabase/functions/materiais-classificar/index.ts");
  it("filtra os arquivos editáveis pela guarda (interno, sem revisão, sem aprovação, sem trava)", () => {
    for (const filtro of ['.eq("visibility", "internal")', '.eq("agency_approval_status", "not_requested")', '.eq("approval_status", "none")', '.is("locked_at", null)']) {
      expect(f).toContain(filtro);
    }
  });
  it("lote inteiro recusado pelo banco para a rodada (não paga o Jev de novo)", () => {
    expect(f).toContain("falhasDoLote === julgamentos.length");
    expect(f).toContain('error: "gravacao_recusada"');
    // Falha ao gravar não conta como classificado.
    const i = f.indexOf("if (upErr) {");
    expect(f.slice(i, i + 300)).toContain("continue;");
  });
});
