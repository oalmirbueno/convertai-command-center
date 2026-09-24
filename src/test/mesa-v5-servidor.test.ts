import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { juntarDitado } from "@/components/mesa/Ditado";

/**
 * Mesa v5 (23/09, noite): fotos da lâmina (fundo e elemento), referências em
 * destaque, referências escolhidas seguidas de perto, conversa da campanha e
 * o ditado grátis. Conferência pelo código das funções e do componente.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const calendario = ler("supabase/functions/agente-calendario/index.ts");
const direcao = ler("supabase/functions/_shared/direcao-arte.ts");
const migration = ler("supabase/migrations/20260923195925_mesa_referencias_destaque.sql");
const corpoDe = (fonte: string, nome: string) => {
  const i = fonte.indexOf(`function ${nome}(`);
  const j = fonte.indexOf("\nasync function ", i + 10);
  const k = fonte.indexOf("\nfunction ", i + 10);
  const fim = [j, k].filter((x) => x > 0).sort((a, b) => a - b)[0];
  return fonte.slice(i, fim);
};

describe("fotos da lâmina trazidas pela equipe", () => {
  it("só aceita caminho do próprio cliente no bucket mesa, 1 fundo e até 2 elementos", () => {
    const f = corpoDe(estudio, "lerFotosLivres");
    expect(f).toContain("caminho.startsWith(`${clientId}/`)");
    expect(f).toContain('caminho.indexOf("..") >= 0');
    expect(f).toContain('papel === "fundo" && saida.some((f) => f.papel === "fundo")');
    expect(f).toContain('saida.filter((f) => f.papel === "elemento").length >= 2');
    expect(direcao).toContain('export type FotoLivre = { caminho: string; papel: "fundo" | "elemento"; nota?: string };');
  });
  it("configurar grava as fotos e a direção refeita não as perde", () => {
    expect(corpoDe(estudio, "configurar")).toContain("mudou.fotos_livres = fotosLivres");
    expect(estudio).toContain("fotos_livres: velho?.fotos_livres,");
  });
  it("fundo com elementos vira edição sem máscara que mantém a foto e o rosto", () => {
    const g = corpoDe(estudio, "gerarCard");
    expect(g).toContain("if (baseFoto && elementos.length)");
    expect(g).toContain("editar: { bytes: baseFoto }, tamanho: quadro.tamanho");
    expect(g).toContain('modo: "foto_composta"');
    expect(g).toContain("mesmo rosto, feições");
  });
});

describe("referências", () => {
  it("destaque é coluna nova e entra sempre antes das outras", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS destaque boolean NOT NULL DEFAULT false");
    const e = corpoDe(estudio, "escolherReferencias");
    expect(e).toContain('.eq("destaque", true)');
    expect(e).toContain('jev: "destaque"');
    expect(e).toContain("[...destaques, ...resto]");
  });
  it("as escolhidas pela equipe são reproduzidas de perto com a identidade da marca", () => {
    expect(corpoDe(estudio, "gerarCard")).toContain("reproduza de perto esta peça");
  });
});

describe("conversa da campanha", () => {
  const c = corpoDe(calendario, "campanhaConversar");
  it("guarda a conversa presa à campanha e não mexe em conteúdo já gravado", () => {
    expect(calendario).toContain('const REF_CAMPANHA = "mesa_campanha";');
    expect(c).toContain('proposta.status !== "gravada"');
    expect(c).toContain("item.campanha_id = c.id;");
    expect(calendario).toContain("  campanha_conversar: campanhaConversar,");
  });
});

describe("ditado", () => {
  it("junta o falado ao que já estava no campo", () => {
    expect(juntarDitado("", "  quero três posts  ")).toBe("Quero três posts");
    expect(juntarDitado("Oi.", "quero três posts")).toBe("Oi. quero três posts");
    expect(juntarDitado("Oi. ", "tudo")).toBe("Oi. tudo");
    expect(juntarDitado("Oi", "   ")).toBe("Oi");
  });
});

describe("carrossel contínuo por panorama (dono, 23/09 noite)", () => {
  it("divide o panorama em trechos de até 3 lâminas ligados pela primeira de cada trecho", async () => {
    const { trechoDaLamina } = await import("../../supabase/functions/_shared/direcao-arte");
    expect(trechoDaLamina(1, 2)).toEqual({ inicio: 1, fim: 2 });
    expect(trechoDaLamina(3, 3)).toEqual({ inicio: 1, fim: 3 });
    expect(trechoDaLamina(2, 6)).toEqual({ inicio: 1, fim: 3 });
    expect(trechoDaLamina(4, 6)).toEqual({ inicio: 3, fim: 5 });
    expect(trechoDaLamina(5, 6)).toEqual({ inicio: 3, fim: 5 });
    expect(trechoDaLamina(6, 6)).toEqual({ inicio: 5, fim: 6 });
    expect(trechoDaLamina(4, 4)).toEqual({ inicio: 3, fim: 4 });
    expect(trechoDaLamina(7, 7)).toEqual({ inicio: 5, fim: 7 });
    // Todo trecho tem pelo menos 2 lâminas e no máximo 3.
    for (let total = 2; total <= 10; total++) {
      for (let o = 1; o <= total; o++) {
        const t = trechoDaLamina(o, total);
        expect(o >= t.inicio && o <= t.fim).toBe(true);
        expect(t.fim - t.inicio + 1).toBeGreaterThanOrEqual(2);
        expect(t.fim - t.inicio + 1).toBeLessThanOrEqual(3);
      }
    }
  });
  it("a lâmina contínua usa a fatia do panorama como base e só desenha o texto por cima", () => {
    const g = corpoDe(estudio, "gerarCard");
    expect(g).toContain("usaPanorama(t, card, modeloImagem.provedor)");
    expect(g).toContain("await garantirFundoContinuo(ch, t, ordem, kit)");
    expect(g).toContain('modo: panorama ? "panorama" : "foto_real"');
    // A continuidade antiga (tela dupla) só roda sem base: com panorama a base existe.
    expect(g.indexOf("await garantirFundoContinuo(")).toBeLessThan(g.indexOf("const continuar ="));
  });
  it("o trecho seguinte continua da lâmina de ligação e corrige o tom na emenda", () => {
    const f = corpoDe(estudio, "garantirFundoContinuo");
    expect(f).toContain("telaDoTrecho(k, await baixar(\"mesa\", ligacao))");
    expect(f).toContain("corrigirEmenda(await baixar(\"mesa\", ligacao), fatias[1])");
    expect(f).toContain("tamanhoFixo: true");
  });
  it("ligar, desligar ou refazer apaga o panorama; a tela prepara o fundo antes de cada lâmina", () => {
    expect(corpoDe(estudio, "configurar")).toContain("conjunto.refazer_fundo === true ? { panorama: null }");
    expect(estudio).toContain("  preparar_fundo: prepararFundo,");
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain('acao: "preparar_fundo"');
    expect(aba.indexOf('acao: "preparar_fundo"')).toBeLessThan(aba.indexOf('acao: "gerar_card"'));
  });
});

describe("refazer que refaz (dono, 23/09 noite)", () => {
  it("lâmina de direção antiga, sem layout, ganha o layout padrão com a cena do roteiro", () => {
    expect(corpoDe(estudio, "cardDaDirecao")).toContain("return comLayout(card, t.direcao.cards.length);");
    const c = corpoDe(estudio, "comLayout");
    expect(c).toContain("layoutPadrao(card.funcao, card.ordem, total)");
    expect(c).toContain("imagem: cena || padrao.imagem");
    expect(c).toContain("blocosDoTexto(card.texto_exato, card.funcao)");
  });
  it("sem logo cadastrada, a conferência não acusa logo faltando", () => {
    const v = corpoDe(estudio, "verificar");
    expect(v).toContain("levaLogo(t, card.ordem) && !!(await baixarLogoBruta(t.client_id, kit)");
    expect(v).toContain("!esperaLogo && !v.logo_presente ? null");
  });
  it("a Mesa usa a tela larga", () => {
    expect(ler("src/components/AppLayout.tsx")).toContain('location.pathname.indexOf("/mesa") === 0');
  });
});

describe("auditoria do servidor (23/09 noite)", () => {
  const contexto = ler("supabase/functions/agente-contexto/index.ts");
  const compartilhado = ler("supabase/functions/_shared/contexto-cliente.ts");
  it("conversa do agente de contexto grava com client_id e confere o erro", () => {
    expect(contexto).toContain('{ conversa_id: conversaId, client_id: clientId, papel: "usuario"');
    expect(contexto).toContain('console.error("agente-contexto: conversa nao gravada"');
  });
  it("atualizar o contexto não apaga o que a equipe ensinou (a menos que venha forcar)", () => {
    expect(contexto).toContain("const mesclado: ContextoConsolidado = forcar || !antigo ? contexto : {");
    expect(contexto).toContain("contexto: mesclado,");
  });
  it("logo gravada por caminho conta e SVG não é oferecido", () => {
    expect(compartilhado).toContain("temLogo: !!(k?.logo_path || k?.logo_file_id)");
    expect(compartilhado).toContain('!/svg/i.test(f.mime_type || "")');
  });
  it("estúdio: ler referência de Arquivos traz file_id; contínuo desligado não religa; custo inteiro", () => {
    expect(corpoDe(estudio, "lerReferencia")).toContain("file_id, papel, leitura");
    expect(estudio).toContain("? existente.direcao.carrossel_infinito === true");
    expect(corpoDe(estudio, "gravarVersao")).toContain("custo_usd: arred(custo + num(meta.custoExtraUsd))");
  });
  it("panorama: fatia gravada vence e um trecho por chamada", () => {
    const f = corpoDe(estudio, "garantirFundoContinuo");
    expect(f).toContain("{ ...novos, ...(x.direcao.panorama?.fundos ?? {}) }");
    expect(f).toContain('return { ...antes, caminho: "", pendente: true };');
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("if (!f || !f.pendente) break;");
  });
  it("campanha: tema_id não repete e a conversa mais recente é a usada", () => {
    const c = corpoDe(calendario, "campanhaConversar");
    expect(c).toContain('do item.tema_id = `c${++seq}`; while (usados.has(item.tema_id));');
    expect(corpoDe(calendario, "conversaDaCampanha")).toContain('.order("criado_em", { ascending: false })');
  });
});

describe("restante da auditoria (23/09 noite)", () => {
  const contexto = ler("supabase/functions/agente-contexto/index.ts");
  it("montar do roteiro sem roteiro avisa em vez de chamar o diretor pago; roteiro só de proposta gravada", () => {
    expect(estudio).toContain('throw new ErroEstudio(409, "sem_roteiro"');
    expect(estudio).toContain('.contains("task_ids", [taskId])\n    .eq("status", "gravada")');
  });
  it("o custo do Jev entra no custo mostrado dos temas", () => {
    expect(calendario).toContain("custo_usd: Math.round((saida.custoUsd + jev.custo) * 1e6) / 1e6");
    expect(calendario).toContain("custo_usd: Math.round((saida.custoUsd + custoJev) * 1e6) / 1e6");
  });
  it("temas acompanham a frequência pedida (até 30)", () => {
    expect(calendario).toContain("Math.min(30, Math.max(15, Math.round(Number(parametros.frequencia) || 0)))");
    expect(calendario).toContain("temasBrutos.slice(0, maxTemas)");
  });
  it("pedido livre ajusta a data dentro de hoje a +30 dias", () => {
    expect(corpoDe(calendario, "diasUteisDaProposta")).toContain("somarDias(fimBase, 30)");
    expect(corpoDe(calendario, "conversar")).toContain("const uteis = diasUteisDaProposta(p);");
    expect(corpoDe(calendario, "gravar")).toContain("const uteis = diasUteisDaProposta(p);");
  });
  it("mensagens em ordem e custo da campanha somado sem perder parcela", () => {
    expect(corpoDe(calendario, "registrarMensagens")).toContain("criado_em: new Date(base + i).toISOString()");
    expect(corpoDe(calendario, "somarCustoDaCampanha")).toContain('.eq("custo_usd", (data as { custo_usd: number | string }).custo_usd)');
  });
  it("criação da campanha: uso ligado à campanha, sem proposta órfã e primeira conversa guardada", () => {
    const c = corpoDe(calendario, "campanhaCriar");
    expect(c).toContain('referencia: { tipo: "mesa_campanha", id: campanhaId }');
    expect(c).toContain('update({ status: "descartada" })');
    expect(c).toContain("await conversaDaCampanha(servico, campanha as Campanha, chamador.userId)");
  });
  it("filas do contexto não travam em arquivo que não abre; contagem de artes igual", () => {
    expect(contexto).toContain('update({ ativa: false, tags: ["arquivo_indisponivel"] })');
    expect(contexto).toContain('descricao: "Arquivo indisponível: não foi possível abrir a imagem."');
    expect(contexto).not.toContain("...(imagens.length ? [`${imagens.length} artes publicadas`] : [])");
  });
});

describe("contínuo sem caixa de fundo e erro de crédito claro (Para Si Ótica, 23/09)", () => {
  it("no contínuo a lâmina inteira é redesenhada e só as bordas voltam do panorama", () => {
    const g = corpoDe(estudio, "gerarCard");
    expect(g).toContain("const areas = panorama ? [INTERIOR_DA_LAMINA] : areasDeDesenho(card, total, comLogo, quadro);");
    expect(estudio).toContain("const INTERIOR_DA_LAMINA: Area = { x0: 0.07, y0: 0, x1: 0.93, y1: 1 };");
    expect(g).toContain("devolverOriginalForaDasAreas(baseFoto, img.png, areas, panorama ? 40 : 28)");
  });
  it("texto sobre foto ou panorama nunca vem numa caixa, e a foto não é escurecida", () => {
    expect(corpoDe(estudio, "gerarCard")).toContain("SEM_CAIXA_ATRAS_DO_TEXTO,");
    expect(estudio).toContain("sem caixa, cartão, painel, faixa, retângulo, moldura, véu, desfoque ou área de cor atrás das letras");
    expect(estudio).toContain("Não escureça a foto.");
  });
  it("conta do provedor sem crédito vira mensagem clara com o caminho da recarga", () => {
    const motor = ler("supabase/functions/_shared/ia-motor.ts");
    expect(motor).toContain('"provedor_sem_credito"');
    expect(motor).toContain("provedor_sem_credito: 402,");
    expect(motor).toContain("/credit|quota|billing|insufficient|saldo/i");
  });
});

describe("conta direta sem crédito vai pelo OpenRouter (dono, 23/09)", () => {
  const motor = ler("supabase/functions/_shared/ia-motor.ts");
  it("o motor desvia a mesma chamada para o OpenRouter quando a conta direta está sem crédito", () => {
    expect(motor).toContain('export type ReservaUsada = "openrouter_sem_chave" | "openrouter_sem_credito" | "direto_sem_credito";');
    expect(motor).toContain("if (ehDiretoSemCredito(err, rota.m)) {");
    expect(motor).toContain('reserva: "direto_sem_credito",');
    // Mesmo modelo no OpenRouter; sem ele, gerador de imagem da mesma família (o mais barato).
    expect(motor).toContain('.eq("modelo_api", `${pedido.provedor}/${pedido.modelo_api}`)');
    expect(motor).toContain('.like("modelo_api", `${pedido.provedor}/%`)');
    expect(motor).toContain('resolverChave(clientId, "openrouter")');
  });
  it("proporção enviada ao OpenRouter é uma das aceitas (o panorama 12:5 vira 21:9)", () => {
    expect(motor).toContain('const PROPORCOES_ACEITAS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];');
    expect(motor).toContain("Math.abs(Math.log((x / y) / alvo))");
  });
  it("a tela avisa quando a chamada foi pelo OpenRouter e o estúdio devolve a rota usada", () => {
    expect(ler("src/lib/mesa/api.ts")).toContain("A conta direta do provedor está sem crédito. Esta chamada foi feita pelo OpenRouter.");
    expect(corpoDe(estudio, "gravarVersao")).toContain("reserva_usada: img.reservaUsada ?? null,");
  });
});

describe("GPT Image 2.5 pelo OpenRouter (dono, 23/09)", () => {
  const motor = ler("supabase/functions/_shared/ia-motor.ts");
  const migration = ler("supabase/migrations/20260924012047_mesa_gpt_image_pelo_openrouter.sql");
  it("GPT Image pelo OpenRouter usa a API dedicada de imagens com tamanho, qualidade e imagens de entrada", () => {
    expect(motor).toContain(String.raw`m.provedor === "openrouter" && /^openai\/gpt-image/.test(m.modelo_api)`);
    expect(motor).toContain('"https://openrouter.ai/api/v1/images"');
    expect(motor).toContain("corpo.input_references = imagens.map(");
    expect(motor).toContain("if (usaApiDeImagensDoOpenRouter(m)) return await imagemOpenRouterImages(m, chave, e);");
  });
  it("catálogo: Sunburst e Flare pelo OpenRouter, Sunburst vira o padrão e a sincronização não os derruba", () => {
    expect(migration).toContain("'openrouter:openai/gpt-image-2.5-sunburst'");
    expect(migration).toContain("'openrouter:openai/gpt-image-2.5-flare'");
    expect(migration).toContain("AND NOT (_provedor = 'openrouter' AND modelo_api LIKE 'openai/gpt-image%');");
    expect(migration).toContain("array_append(array_remove(padrao_para, 'imagem'), 'imagem') WHERE id = 'openrouter:openai/gpt-image-2.5-sunburst'");
  });
});
