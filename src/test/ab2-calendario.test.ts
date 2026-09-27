import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { diasDaPropostaLivre } from "../../supabase/functions/agente-calendario/acoes-agenda";
import {
  avisoDasImagensDeFora,
  avisoDoPeriodoCurto,
  IMAGENS_LIDAS_AO_MESMO_TEMPO,
  imagensNoTetoDaChamada,
  MAX_CONTEUDOS_POR_VEZ,
  MAX_PIXELS_ANEXO_NA_FUNCAO,
  MAX_PIXELS_FOTO_NA_FUNCAO,
  periodoDosConteudosDaCampanha,
  quantidadeDaCampanha,
  respostaComAvisos,
} from "../../supabase/functions/agente-calendario/tetos-do-pedido";
import { tamanhoEmBase64 } from "../../supabase/functions/_shared/capacidades-imagem";
import { AGENTES_DO_PAINEL, blocoDoMapaDoPainel } from "../../supabase/functions/_shared/mapa-do-painel";

/**
 * Anti-bug 26/09, segunda rodada (frente AB2), agente-calendario: CPU e memória
 * das imagens por chamada, janelas e tetos que cortavam calados, mapa do
 * painel nas conversas do agente do Mês e dossiê recortado pelo fim.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const fonte = ler("supabase/functions/agente-calendario/index.ts");

/** Corpo de uma função de topo (do cabeçalho até a chave que fecha na coluna 0). */
function corpoDe(nome: string): string {
  const ini = fonte.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const fim = fonte.indexOf("\n}\n", ini + 1);
  return fonte.slice(ini, fim > 0 ? fim : undefined);
}

const MB = 1024 * 1024;
const img = (mb: number) => ({ bytes: new Uint8Array(Math.round(mb * MB)) });

describe("A2: imagens por chamada no agente-calendario", () => {
  it("fotoParaLeitura pede a cópia leve e não abre mais o original na queda (foto que não cabe fica de fora com nota)", () => {
    const f = corpoDe("fotoParaLeitura");
    expect(f).toContain("pedirCopia: true");
    expect(f).toContain("maxPixels: MAX_PIXELS_FOTO_NA_FUNCAO");
    expect(f).toContain("r && r.cabe ? mimeDaImagem(r.bytes) : null");
    // A queda antiga (download do original + decodificar até 25 MP) saiu.
    expect(f).not.toContain(".download(");
    expect(f).not.toContain("decodificar(");
    expect(fonte).not.toMatch(/import \{[^}]*\bdecodificar\b/);
    expect(MAX_PIXELS_FOTO_NA_FUNCAO).toBe(700_000);
    // Poucas fotos ao mesmo tempo (12 originais de 30 MB juntos passavam dos 256 MB) e aviso das que ficaram de fora.
    expect(IMAGENS_LIDAS_AO_MESMO_TEMPO).toBe(3);
    expect(fonte).toContain("emParalelo(lista.length, IMAGENS_LIDAS_AO_MESMO_TEMPO, (i) => ler(lista[i], i))");
    expect(fonte).not.toContain("Promise.all(fotos.map((x, i) => fotoParaLeitura");
    expect(fonte).not.toContain("Promise.all(candidatas.map((x, i) => fotoParaLeitura");
    const criar = corpoDe("campanhaCriar");
    expect(criar).toContain("lerAosPoucos(fotos, (x, i) => fotoParaLeitura(servico, x.foto, `F${i + 1}`))");
    expect(criar).toContain('avisoDasImagensDeFora(fotosNoTeto, "foto")');
    const plano = corpoDe("campanhaPlanoImagens");
    expect(plano).toContain("lerAosPoucos(candidatas, (x, i) => fotoParaLeitura(servico, x.foto, `F${i + 1}`))");
    expect(plano).toContain("avisos: avisoDasFotos ? [avisoDasFotos] : []");
    expect(avisoDasImagensDeFora({ ilegiveis: 2, acimaDoTeto: 0 }, "foto")).toBe("2 fotos da campanha ficaram de fora: não deu para abrir agora. Tente de novo em instantes.");
  });

  it("baixarAnexos reduz (cópia leve) em vez de mandar o anexo cru e respeita o teto de 24 MB por chamada, com aviso", () => {
    const anexo = corpoDe("anexoParaLeitura");
    expect(anexo).toContain("reduzidaSemTransformacao(servico, \"mesa\", caminho, LADO_DO_ANEXO, LADO_DO_ANEXO");
    expect(anexo).toContain("pedirCopia: true");
    expect(anexo).toContain("maxPixels: MAX_PIXELS_ANEXO_NA_FUNCAO");
    expect(anexo).toContain("r.bytes.byteLength > MAX_BYTES_ANEXO");
    expect(MAX_PIXELS_ANEXO_NA_FUNCAO).toBe(1_500_000);
    const baixar = corpoDe("baixarAnexos");
    expect(baixar).toContain("lerAosPoucos(caminhos, (c) => anexoParaLeitura(servico, c))");
    expect(baixar).toContain("imagensNoTetoDaChamada(lidos)");
    expect(baixar).not.toContain(".download(c)");
    // Na campanha, os anexos vêm depois das fotos e usam só o que sobrou do teto.
    expect(corpoDe("campanhaCriar")).toContain("anexosDepoisDe(anexosLidos, base64DasImagens(imagensDaChamada))");
    // A equipe lê o aviso na resposta (e no JSON); o modelo também fica sabendo.
    const livre = corpoDe("pedidoLivre");
    expect(livre).toContain("respostaComAvisos(texto(r.resposta, 2000)");
    expect(livre).toContain("notaDoSistema(anexos.aviso)");
    expect(livre).toContain("avisos: anexos.aviso ? [anexos.aviso] : []");
    expect(corpoDe("planejarMes")).toContain('respostaComAvisos(texto(r.resposta, 6000) || "Anotado.", [imagens.aviso])');
    expect(corpoDe("campanhaConversar")).toContain("respostaComAvisos(texto(r.resposta, 2000)");

    // Seis prints de 5 MB (6,7 MB em base64 cada): três cabem, os outros três ficam de fora na ordem.
    const seis = imagensNoTetoDaChamada([img(5), img(5), img(5), img(5), img(5), img(5)]);
    expect(seis).toEqual({ ficam: [0, 1, 2], ilegiveis: 0, acimaDoTeto: 3 });
    // Depois da primeira que não cabe, a menor seguinte também fica (a ordem anexada não muda).
    expect(imagensNoTetoDaChamada([img(10), img(10), img(0.1)])).toEqual({ ficam: [0], ilegiveis: 0, acimaDoTeto: 2 });
    // Ilegível conta à parte; o que a mensagem já leva (fotos da campanha) entra na conta.
    expect(imagensNoTetoDaChamada([null, img(1)])).toEqual({ ficam: [1], ilegiveis: 1, acimaDoTeto: 0 });
    expect(imagensNoTetoDaChamada([img(4)], tamanhoEmBase64(15 * MB)).acimaDoTeto).toBe(1);
    const aviso = avisoDasImagensDeFora({ ilegiveis: 1, acimaDoTeto: 3 }, "anexo");
    expect(aviso).toBe("1 imagem anexada ficou de fora: não deu para abrir agora. Tente de novo em instantes. 3 imagens anexadas ficaram de fora: as imagens juntas passavam de 24 MB, o limite por pedido.");
    expect(aviso).not.toContain("—");
    expect(avisoDasImagensDeFora({ ilegiveis: 0, acimaDoTeto: 0 }, "anexo")).toBeNull();
    expect(respostaComAvisos("Preparei 2 conteúdos.", [null])).toBe("Preparei 2 conteúdos.");
    expect(respostaComAvisos("Preparei 2 conteúdos.", ["Aviso."])).toBe("Preparei 2 conteúdos.\n\nAviso.");
    expect(respostaComAvisos("", ["Aviso."])).toBe("Aviso.");
  });
});

describe("B: janelas e tetos que cortavam calados", () => {
  // 28/09/2026 é segunda-feira.
  const HOJE = "2026-09-28";

  it("diasUteisDaProposta usa a janela do pedido (hoje a +30, datas citadas) e não transborda 30 dias depois do fim", () => {
    expect(corpoDe("diasUteisDaProposta")).toContain("diasDaPropostaLivre({ periodo_inicio: p.periodo_inicio, periodo_fim: p.periodo_fim, mensagem: p.parametros.mensagem }, hojeSaoPaulo())");
    expect(corpoDe("diasUteisDaProposta")).not.toContain("somarDias(fimBase, 30)");

    // Refazer peças de dezembro: a janela acaba na última data citada (antes ia até 18/01) e o sábado citado vale.
    const dezembro = diasDaPropostaLivre({ periodo_inicio: "2026-12-18", periodo_fim: "2026-12-19", mensagem: "- 2026-12-18 · carrossel\n- 2026-12-19 · estatico" }, HOJE);
    expect(dezembro[0]).toBe(HOJE);
    expect(dezembro[dezembro.length - 1]).toBe("2026-12-19");
    expect(dezembro).toContain("2026-12-19");
    expect(dezembro).not.toContain("2026-12-21");
    expect(dezembro).not.toContain("2026-12-20");

    // Pedido sem data: de hoje a +30 dias (antes: 30 dias depois do último conteúdo, até 04/11).
    const semData = diasDaPropostaLivre({ periodo_inicio: "2026-10-01", periodo_fim: "2026-10-05", mensagem: "três conteúdos da promoção" }, HOJE);
    expect(semData[0]).toBe(HOJE);
    expect(semData[semData.length - 1]).toBe("2026-10-28");
    expect(semData).not.toContain("2026-11-02");
    expect(semData.every((d) => [1, 2, 3, 4, 5].includes(new Date(`${d}T12:00:00Z`).getUTCDay()))).toBe(true);

    // Proposta antiga ainda em aberto: começa no primeiro conteúdo e vai até hoje +30 (comportamento aprovado).
    const antiga = diasDaPropostaLivre({ periodo_inicio: "2026-08-03", periodo_fim: "2026-08-07", mensagem: "" }, HOJE);
    expect(antiga[0]).toBe("2026-08-03");
    expect(antiga).toContain("2026-09-15");
    expect(antiga[antiga.length - 1]).toBe("2026-10-28");

    // Conteúdo já além da janela (proposta de antes): continua valendo, sem somar mais 30 dias.
    const alem = diasDaPropostaLivre({ periodo_inicio: "2026-10-01", periodo_fim: "2026-11-20", mensagem: "" }, HOJE);
    expect(alem[alem.length - 1]).toBe("2026-11-20");
  });

  it("campanhaConteudos: campanha curta fica no período real dela (não estica para 14 dias)", () => {
    const c = corpoDe("campanhaConteudos");
    expect(c).toContain("periodoDosConteudosDaCampanha(c.periodo_inicio, c.periodo_fim, hoje)");
    expect(c).not.toContain("somarDias(inicio, 14)");
    expect(c).not.toContain("diasEntre(inicio, fim) < 5");
    expect(c).toContain("avisoDoPeriodoCurto(uteis.length, quantidade)");

    // Black Friday de 3 dias: antes os conteúdos iam até 10/12.
    expect(periodoDosConteudosDaCampanha("2026-11-26", "2026-11-28", HOJE)).toEqual({ inicio: "2026-11-26", fim: "2026-11-28" });
    // Campanha que acaba em 2 dias: antes ia até 12/10, depois do fim.
    expect(periodoDosConteudosDaCampanha("2026-09-20", "2026-09-30", HOJE)).toEqual({ inicio: HOJE, fim: "2026-09-30" });
    // Sem fim, ou já encerrada: 21 dias a partir do início, como sempre.
    expect(periodoDosConteudosDaCampanha(null, null, HOJE)).toEqual({ inicio: HOJE, fim: "2026-10-19" });
    expect(periodoDosConteudosDaCampanha("2026-09-01", "2026-09-10", HOJE)).toEqual({ inicio: HOJE, fim: "2026-10-19" });
    expect(avisoDoPeriodoCurto(2, 5)).toBe("A campanha tem 2 dias úteis até o fim: alguns conteúdos ficaram no mesmo dia.");
    expect(avisoDoPeriodoCurto(5, 5)).toBeNull();
  });

  it("teto de 8 conteúdos por vez: quando corta, avisa quantos ficaram de fora (resposta e JSON)", () => {
    expect(MAX_CONTEUDOS_POR_VEZ).toBe(8);
    const doze = quantidadeDaCampanha(12, 0);
    expect(doze.quantidade).toBe(8);
    expect(doze.ignorados).toBe(4);
    expect(doze.aviso).toBe("Foram pedidos 12 conteúdos e o máximo por vez é 8: 4 ficaram de fora. Gere de novo para completar.");
    expect(quantidadeDaCampanha(9, 0).aviso).toContain("1 ficou de fora");
    expect(quantidadeDaCampanha(8, 0)).toEqual({ quantidade: 8, ignorados: 0, aviso: null });
    expect(quantidadeDaCampanha("3", 0)).toEqual({ quantidade: 3, ignorados: 0, aviso: null });
    // Sem pedido: 5 (3 quando a campanha já tem conteúdos), como antes.
    expect(quantidadeDaCampanha(undefined, 0).quantidade).toBe(5);
    expect(quantidadeDaCampanha(undefined, 2).quantidade).toBe(3);
    expect(quantidadeDaCampanha(0, 0).quantidade).toBe(5);

    const c = corpoDe("campanhaConteudos");
    expect(c).toContain("quantidadeDaCampanha(corpo.quantidade, existentes.length)");
    expect(c).not.toContain("Math.min(MAX_CONTEUDOS_POR_VEZ, pedidoQtd)");
    expect(c).toContain("ignorados: pedidoDaQuantidade.ignorados, avisos, custo_usd: Math.round(custo * 1e6) / 1e6");
    expect(c).toContain("respostaComAvisos(");
  });
});

describe("F: mapa do painel só nas conversas do agente do Mês", () => {
  it('blocoDoMapaDoPainel("mes") entra no sistema das conversas e nunca nas gerações', () => {
    const mes = AGENTES_DO_PAINEL.find((a) => a.chave === "mes");
    expect(mes && mes.funcao).toBe("agente-calendario");
    const bloco = blocoDoMapaDoPainel("mes");
    expect(bloco).toContain("Você é o agente do Mês");
    expect(bloco).toContain("[você está aqui]");

    expect(fonte).toContain('const MAPA_DO_PAINEL_NA_CONVERSA = blocoDoMapaDoPainel("mes");');
    const sistema = corpoDe("sistemaDoCalendario");
    expect(sistema).toContain('if (uso === "conversa") return `${ctx.prompt}\\n\\n${CONHECIMENTO_DO_CALENDARIO[momento]}\\n\\n${MAPA_DO_PAINEL_NA_CONVERSA}\\n${REGRAS_DE_SAIDA}`;');
    // Geração continua igual (regras de saída por último, sem o mapa).
    expect(sistema).toContain("return `${ctx.prompt}\\n\\n${CONHECIMENTO_DO_CALENDARIO[momento]}\\n${REGRAS_DE_SAIDA}`;");

    expect(corpoDe("planejarMes")).toContain('sistema: sistemaDoCalendario(ctx, "mes", "conversa")');
    expect(corpoDe("planejarMes")).toContain('estimarTokens(sistemaDoCalendario(ctx, "mes", "conversa"))');
    expect(corpoDe("conversar")).toContain('sistema: sistemaDoCalendario(ctx, "mes", "conversa")');
    expect(corpoDe("campanhaConversar")).toContain('sistema: sistemaDoCalendario(ctx, "campanha", "conversa")');
    for (const g of ["proporTemas", "detalhar", "completarItens", "pedidoLivre", "conteudoRapido", "campanhaConteudos", "campanhaCriar", "buscarHypes"]) {
      expect(corpoDe(g), g).not.toContain('"conversa")');
    }
  });
});

describe("C: dossiê recortado pelo fim (as seções recentes ficam)", () => {
  it("o agente-calendario não corta mais o dossiê pelo começo", () => {
    expect(fonte).toContain('import { recortarDossie } from "../_shared/dossie-recortado.ts";');
    expect(fonte).toContain("recortarDossie(dossieDados.content, 14000)");
    expect(fonte).toContain("recortarDossie(ctx.dossie, 6000)");
    expect(fonte).toContain("recortarDossie(ctx.dossie, 1500)");
    const pasta = "supabase/functions/agente-calendario";
    for (const arq of readdirSync(resolve(process.cwd(), pasta)).filter((a) => a.endsWith(".ts"))) {
      const f = ler(`${pasta}/${arq}`);
      expect(f, arq).not.toMatch(/dossie\??\.slice\(0,/i);
      expect(f, arq).not.toMatch(/dossieDados\.content\.slice\(0,/);
    }
  });
});
