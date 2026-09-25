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
    expect(direcao).toContain('export type FotoLivre = { caminho: string; papel: "fundo" | "elemento"; nota?: string; recortada?: boolean };');
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
    // 25/09: o que já está na agenda fica protegido item a item (task_id), o resto pode mudar.
    expect(c).toContain("const naAgenda = proposta.itens.filter((i) => i.task_id);");
    expect(c).toContain("naAgenda.concat(livres)");
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
    expect(g).toContain("usaPanorama(t, card, modeloImagem)");
    // gerar_card nunca gera o trecho: sem a fatia, 409 fundo_pendente e a tela prepara.
    expect(g).not.toContain("garantirFundoContinuo(");
    expect(g).toContain('throw new ErroEstudio(409, "fundo_pendente"');
    expect(g).toContain('modo: panorama ? "panorama" : "foto_real"');
    // A tela dupla antiga saiu (código morto desde o panorama).
    expect(g).not.toContain("const continuar =");
    expect(estudio).not.toContain("telaDupla");
  });
  it("o trecho seguinte continua da lâmina de ligação, alinhado a ela, e corrige o tom na emenda", () => {
    const f = corpoDe(estudio, "garantirFundoContinuo");
    expect(f).toContain("await telaDoTrecho(k, bytesDaLigacao)");
    expect(f).toContain("await fatiarTrecho(img.png, k, bytesDaLigacao)");
    expect(f).toContain("corrigirEmenda(bytesDaLigacao, fatias[1])");
    expect(f).toContain("tamanhoFixo: true");
  });
  it("ligar, desligar ou refazer apaga o panorama; a tela prepara o fundo antes de cada lâmina", () => {
    expect(corpoDe(estudio, "configurar")).toContain("conjunto.refazer_fundo === true ? { panorama: panoramaApagado(x.direcao.panorama) }");
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
    // A tela repete o preparo até não haver pendência, com limite pelo número de trechos.
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain("const limite = limiteDePreparos(cardsDaDirecao.length);");
    expect(aba).toContain("if (!f || !f.pendente) {");
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
    expect(calendario).toContain("custo_usd: Math.round((custo + jev.custo) * 1e6) / 1e6");
    expect(calendario).toContain("custo_usd: Math.round((saida.custoUsd + custoJev) * 1e6) / 1e6");
  });
  it("temas acompanham a frequência pedida (até 30)", () => {
    expect(calendario).toContain("Math.min(30, Math.max(15, Math.round(Number(parametros.frequencia) || 0)))");
    // 25/09: três frentes em paralelo, cada uma com a sua parte dos temas.
    expect(calendario).toContain("const frentes = temasPorFrente(maxTemas);");
    expect(calendario).toContain("brutos.slice(0, f.max)");
  });
  it("pedido livre ajusta a data dentro de hoje a +30 dias", () => {
    expect(corpoDe(calendario, "diasUteisDaProposta")).toContain("somarDias(fimBase, 30)");
    expect(corpoDe(calendario, "conversar")).toContain("const uteis = diasUteisDaProposta(p);");
    expect(corpoDe(calendario, "gravarItens")).toContain("const uteis = diasUteisDaProposta(p);");
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
    // Desde 25/09 a fatia nunca é reenquadrada: só as letras são coladas nela (sem faixa dupla na borda).
    expect(g).toContain("await colarMudancasNaBase(baseFoto, img.png, areasDoTexto, {");
    expect(g).toContain("devolverOriginalAlinhado(baseFoto, img.png, areas, 28, { texto: fotoFixa })");
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

/**
 * Auditoria do contínuo (dono, 25/09: "o carrossel contínuo não está
 * funcionando, é muito bugado"). Regras puras em _shared/carrossel-continuo.ts.
 */
describe("carrossel contínuo: auditoria de 25/09", () => {
  const motor = ler("supabase/functions/_shared/ia-motor.ts");
  const imagem = ler("supabase/functions/_shared/imagem-local.ts");
  const aba = ler("src/components/mesa/AbaEstudio.tsx");

  it("1: vale a capacidade do modelo (GPT Image direto ou pelo OpenRouter), não o provedor openai", async () => {
    const { modeloFazPanorama } = await import("../../supabase/functions/_shared/carrossel-continuo");
    expect(modeloFazPanorama({ provedor: "openai", modelo_api: "gpt-image-2" })).toBe(true);
    expect(modeloFazPanorama({ provedor: "openrouter", modelo_api: "openai/gpt-image-2.5-sunburst" })).toBe(true);
    expect(modeloFazPanorama({ provedor: "openrouter", modelo_api: "google/gemini-3-pro-image" })).toBe(false);
    expect(modeloFazPanorama({ provedor: "openai", modelo_api: "gpt-6-sol" })).toBe(false);
    expect(modeloFazPanorama(null)).toBe(false);
    expect(corpoDe(estudio, "usaPanorama")).toContain("modeloFazPanorama(modelo)");
    expect(corpoDe(estudio, "usaPanorama")).not.toContain('provedor === "openai"');
    // A tela espelha a regra e avisa quando o modelo não faz o contínuo.
    const { modeloFazContinuo } = await import("@/components/mesa/estudioUtil");
    for (const m of [
      { provedor: "openai", modelo_api: "gpt-image-2" },
      { provedor: "openrouter", modelo_api: "openai/gpt-image-2.5-flare" },
      { provedor: "openrouter", modelo_api: "google/gemini-3-pro-image" },
    ]) expect(modeloFazContinuo(m)).toBe(modeloFazPanorama(m));
    expect(aba).toContain("const comFundoContinuo = ordemTravada && modeloFazContinuo(modeloDoFundo);");
    expect(aba).toContain("{AVISO_CONTINUO_SEM_MODELO}");
  });

  it("2: o trecho só é atendido pelo mesmo modelo e a proporção real é conferida antes de fatiar", async () => {
    const f = corpoDe(estudio, "garantirFundoContinuo");
    expect(f).toContain("mesmoModelo: true,");
    expect(f).toContain('"panorama_fora_do_formato"');
    expect(motor).toContain("mesmoModelo?: boolean;");
    expect(motor).toContain('if (!achado && pedido.tipo === "imagem" && !soOMesmo) {');
    expect(motor).toContain("imagemOpenRouter(mod, segredo, e), !!e.mesmoModelo");
    expect(imagem).toContain("if (!proporcaoDoTrechoConfere(largura, altura, k)) {");
    const { proporcaoDoTrechoConfere } = await import("../../supabase/functions/_shared/carrossel-continuo");
    expect(proporcaoDoTrechoConfere(3264, 1360, 3)).toBe(true);
    expect(proporcaoDoTrechoConfere(2176, 1360, 2)).toBe(true);
    // 21:9 de outro gerador (2688 x 1152) cortaria com zoom: recusado.
    expect(proporcaoDoTrechoConfere(2688, 1152, 3)).toBe(false);
    expect(proporcaoDoTrechoConfere(1024, 1536, 3)).toBe(false);
  });

  it("3: no panorama a fatia fica intacta: letras coladas por cima e logo pelo código", () => {
    const g = corpoDe(estudio, "gerarCard");
    // Desde 25/09 a logo entra pelo código em todos os modos; no panorama, na mesma passada do recorte das letras.
    expect(g).toContain("logosNoCodigo = daMarca.logos;");
    expect(g).toContain("logo: logoNoCodigo ? { bytes: logosNoCodigo[0].bytes, caixa: areaDaLogo, clara: logosNoCodigo[0].clara } : null,");
    expect(imagem).toContain("export async function colarMudancasNaBase(");
    // O gerado vai para o enquadramento da base (inverso do devolverOriginalAlinhado).
    expect(imagem).toContain("const xg = (x: number) => (((x + 0.5) / W - al.cu) * al.escala + 0.5) * W - 0.5;");
  });

  it("4: a emenda entre trechos alinha o trecho novo à ligação e recusa quando a cena mudou", () => {
    expect(imagem).toContain("const est = estimarAlinhamento(lig, img.clone().crop(0, 0, W, H), []);");
    expect(imagem).toContain("if (!(erro <= LIMITE_CENA_MUDADA)) return { fatias: [], largura, altura, proporcaoOk: true, erro, alinhou, cenaMudada: true };");
    expect(corpoDe(estudio, "garantirFundoContinuo")).toContain('"emenda_recusada"');
  });

  it("5: a versão grava o fundo usado e a tela mostra 'fora do fundo'", async () => {
    expect(corpoDe(estudio, "gerarCard")).toContain("fundo: fundoUsado, fundo_geracao: geracaoDoPanorama(t.direcao.panorama)");
    const { versaoForaDoFundo } = await import("../../supabase/functions/_shared/carrossel-continuo");
    const tela = await import("@/components/mesa/estudioUtil");
    const casos: [unknown, unknown][] = [
      [{ ordem: 2, modo: "panorama", fundo: "a.png" }, { fundos: { "2": "a.png" } }],
      [{ ordem: 2, modo: "panorama", fundo: "a.png" }, { fundos: { "2": "b.png" } }],
      [{ ordem: 2, modo: "panorama", fundo: "a.png" }, { fundos: {} }],
      [{ ordem: 2, modo: "normal" }, { fundos: {} }],
    ];
    const esperado = [false, true, true, false];
    casos.forEach(([v, p], i) => {
      expect(versaoForaDoFundo(v as never, p as never)).toBe(esperado[i]);
      expect(tela.versaoForaDoFundo(v as never, p as never)).toBe(esperado[i]);
    });
    expect(aba).toContain("foraDoFundo={versaoForaDoFundo(versaoNaTela as any, (trabalho.direcao as any)?.panorama)}");
  });

  it("6: fundo apagado sobe a geração; o trecho atrasado é descartado", async () => {
    const { panoramaApagado, geracaoDoPanorama } = await import("../../supabase/functions/_shared/carrossel-continuo");
    expect(panoramaApagado(null)).toEqual({ fundos: {}, geracao: 1, em_andamento: null });
    expect(panoramaApagado({ geracao: 4 }).geracao).toBe(5);
    expect(geracaoDoPanorama(undefined)).toBe(0);
    const f = corpoDe(estudio, "garantirFundoContinuo");
    expect(f).toContain("descartado = !x.direcao.carrossel_infinito || geracaoDoPanorama(p) !== geracao;");
    expect(f).toContain('"fundo_descartado"');
    expect(estudio).toContain("panorama: panoramaApagado(anterior.panorama),");
  });

  it("7: trava de ~6 min por trecho e 409 fundo_em_andamento", async () => {
    const { travaDoTrecho, semATrava, ESPERA_DO_FUNDO_MS } = await import("../../supabase/functions/_shared/carrossel-continuo");
    expect(ESPERA_DO_FUNDO_MS).toBe(6 * 60 * 1000);
    const agora = Date.parse("2026-09-25T12:00:00Z");
    const p = { fundos: {}, em_andamento: { "1": { token: "t1", desde: "2026-09-25T11:57:00Z" }, "3": { token: "t3", desde: "2026-09-25T11:50:00Z" } } };
    expect(travaDoTrecho(p, 1, agora)?.token).toBe("t1");
    // Vencida: livre de novo.
    expect(travaDoTrecho(p, 3, agora)).toBeNull();
    // Só quem travou solta.
    expect(semATrava(p.em_andamento, 1, "outro")).toEqual(p.em_andamento);
    expect(semATrava(p.em_andamento, 1, "t1")).toEqual({ "3": p.em_andamento["3"] });
    expect(corpoDe(estudio, "garantirFundoContinuo")).toContain('"fundo_em_andamento"');
    expect(aba).toContain('e.codigo === "fundo_em_andamento" && esperas < ESPERAS_DO_FUNDO');
  });

  it("8: a tela repete o preparo com limite e trata 409 fundo_pendente do gerar_card", async () => {
    const { limiteDePreparos } = await import("@/components/mesa/estudioUtil");
    expect(limiteDePreparos(2)).toBe(3);
    expect(limiteDePreparos(6)).toBe(5);
    expect(limiteDePreparos(40)).toBe(10);
    expect(aba).toContain('if (!(infinito && e instanceof ErroDaMesa && e.codigo === "fundo_pendente")) throw e;');
  });

  it("9: o prompt do panorama não pede pose nova nem fundo claro atrás da logo", () => {
    const g = corpoDe(estudio, "gerarCard");
    expect(g).toContain("carrosselInfinito: infinito && !panorama,");
    expect(g).toContain("if (capa && ordem > 2 && !replicar) {");
    expect(g).toContain("NÃO copie a cena dele, a cena desta lâmina é a imagem 1 e já está pronta");
    expect(g).toContain("NÃO copie a cena nem a foto dela");
    expect(corpoDe(estudio, "regrasDeRender")).toContain("t.direcao.carrossel_infinito && !ehAds(t) && !cenaPronta");
  });

  it("10: ajuste no contínuo não reenquadra, devolve as bordas do fundo e não troca o fundo", () => {
    const a = corpoDe(estudio, "ajustarCard");
    expect(a).toContain('throw new ErroEstudio(409, "fundo_no_continuo"');
    expect(a).toContain("bordasDe: fundoGravado,");
    expect(a).toContain("colarMudancasNaBase(atual, gerado.png, areasDoAjuste, {");
    expect(ler("src/components/mesa/CardDoEstudio.tsx")).toContain('semTrocaDeFundo ? MODOS_DE_AJUSTE.filter((m) => m.valor !== "fundo")');
  });

  it("12: mudar a zona do texto no contínuo refaz o fundo", () => {
    expect(ler("supabase/functions/estudio-arte/conversa-do-diretor.ts")).toContain('"cor_fundo", "foto_acervo", "zona_texto"];');
  });
});
