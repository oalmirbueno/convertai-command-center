import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aprovado,
  areaLivreParaOSelo,
  avisosDoTexto,
  caixaDoSelo,
  conferirTextoDoSelo,
  DEFINICAO_DO_ESTILO,
  direcaoDoSelo,
  ESTILOS_DE_SELO,
  falaDoSelo,
  impactoDaTroca,
  intencaoPelaResposta,
  palavrasDoSelo,
  papelPelaResposta,
  PAPEIS_DA_REFERENCIA,
  periodoEmTexto,
  perguntaDoPapelDaReferencia,
  perguntaDoPedidoDoSelo,
  planoDasOpcoes,
  quantidadeDeOpcoes,
  referenciasDoSelo,
  SELO_GENERICO,
  textoDoSelo,
  type ContextoDoSelo,
} from "../../supabase/functions/_shared/selo-da-campanha";
import { acaoDoSeloNaConversa, blocoDoSeloParaOEstrategista } from "../../supabase/functions/agente-calendario/selo-na-conversa";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";

/**
 * Frente SEL (30/09): selo da campanha. Pedido do dono (29/09): "quero
 * escolher um selo pronto, pedir para melhorar, enviar uma referência, tudo;
 * está gerando muitos selos genéricos". Aqui: a direção com o contexto da
 * campanha e da marca, os estilos, a conferência do texto, o lugar do selo
 * na arte (colado pelo código), as perguntas do Jev, o impacto da troca e o
 * cartão do agente. E os contratos do servidor e do SQL.
 */

const fonte = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");

const contexto = (extra: Partial<ContextoDoSelo> = {}): ContextoDoSelo => ({
  texto: "Promoção do Amor",
  estilo: "fita",
  variacao: 1,
  campanha: {
    nome: "Promoção do Amor",
    tipo: "data_comemorativa",
    tipoRotulo: "Data comemorativa",
    direcaoDoTipo: "Emblema da data com um único elemento simbólico discreto.",
    objetivo: "Fomentar o comércio local em outubro",
    conceito: "Quem compra aqui apoia a causa",
    periodo_inicio: "2026-10-02",
    periodo_fim: "2026-10-30",
    tema_visual: "Rosa suave e fotografia real dos parceiros",
    elementos: "Laço rosa desenhado à mão",
    tom: "Acolhedor",
    paleta_apoio: [{ nome: "Rosa claro", hex: "#F7ABB7" }],
    selo_descricao: "Lettering com laço",
    oferta: "Cada parceiro define a sua",
    publico: "Associados e compradores do comércio local",
    mensagem_central: "Compre de quem apoia",
  },
  marca: {
    nome: "CME",
    paleta: [{ nome: "CME 1", hex: "#F296A9", papel: "principal" }, { nome: "CME 2", hex: "#E9DDE0", papel: "secundaria" }],
    fontes: [{ nome: "Poppins", papel: "texto" }, { nome: "Playfair Display", papel: "titulo" }],
    estilo: "Elegante e delicado",
    tom: null,
    regras: null,
  },
  referencias: [{ papel: "estilo", nota: "nesse lettering" }, { papel: "cor", nota: null }],
  evitar: ["nada de selo genérico dourado"],
  preferir: ["letra da marca"],
  pedido: null,
  fundoTransparente: true,
  melhorar: null,
  ...extra,
});

describe("selo da campanha: direção menos genérica", () => {
  it("a direção leva a campanha inteira, a marca (paleta com papel e fonte de título), o estilo, as referências pelo papel e as regras do dono", () => {
    const d = direcaoDoSelo(contexto());
    expect(d).toContain('TEXTO EXATO do selo, com a grafia e os acentos certos, e nenhuma outra palavra, número ou símbolo escrito: "Promoção do Amor"');
    expect(d).toContain("marca CME");
    expect(d).toContain("- Tipo: Data comemorativa.");
    expect(d).toContain("Conceito: Quem compra aqui apoia a causa");
    expect(d).toContain("Público: Associados e compradores do comércio local");
    expect(d).toContain("Período: outubro de 2026");
    expect(d).toContain("Oferta (só contexto; não escreva no selo)");
    expect(d).toContain("CME 1 #F296A9 (principal)");
    expect(d).toContain('a família "Playfair Display" da marca');
    expect(d).toContain(DEFINICAO_DO_ESTILO.fita.direcao);
    expect(d).toContain("Composição: composição empilhada e centrada");
    expect(d).toContain("Imagem 1: referência de ESTILO");
    expect(d).toContain("Imagem 2: referência de COR");
    expect(d).toContain("nada de selo genérico dourado (o dono já pediu)");
    expect(d).toContain("O DONO PREFERE:\n- letra da marca");
    for (const g of SELO_GENERICO) expect(d).toContain(g);
    expect(d).toContain("Fundo transparente.");
    expect(d).not.toContain("—");
  });

  it("Melhorar edita a imagem 1 (o selo de hoje) com o pedido; as referências começam na imagem 2", () => {
    const d = direcaoDoSelo(contexto({ melhorar: { pedido: "menos genérico, sem dourado" } }));
    expect(d.indexOf("EDITE a imagem 1")).toBe(0);
    expect(d).toContain("Pedido da equipe: menos genérico, sem dourado");
    expect(d).toContain("Imagem 2: referência de ESTILO");
    expect(d).not.toContain("Imagem 1: referência");
  });

  it("marca sem paleta não inventa cores; sem fonte cadastrada usa a tipografia da campanha", () => {
    const d = direcaoDoSelo(contexto({ marca: { nome: null, paleta: [], fontes: [] }, campanha: { ...contexto().campanha, tipografia: "Serifada elegante" } }));
    expect(d).toContain("A marca não tem paleta cadastrada");
    expect(d).toContain("- Letra: Serifada elegante");
  });

  it("estilos nomeados: automático varia pelo tipo sem repetir; estilo escolhido muda só a composição", () => {
    expect(ESTILOS_DE_SELO.length).toBeGreaterThanOrEqual(8);
    const auto = planoDasOpcoes("automatico", "promocao", 4).map((o) => o.estilo);
    expect(new Set(auto).size).toBe(4);
    expect(auto).not.toContain("3d_sutil");
    const fixo = planoDasOpcoes("carimbo", "promocao", 3);
    expect(fixo.map((o) => o.estilo)).toEqual(["carimbo", "carimbo", "carimbo"]);
    expect(fixo.map((o) => o.variacao)).toEqual([0, 1, 2]);
    expect(planoDasOpcoes("qualquer", null, 2).length).toBe(2);
    expect(quantidadeDeOpcoes(9)).toBe(4);
    expect(quantidadeDeOpcoes(undefined)).toBe(3);
  });

  it("texto do selo: o da identidade, senão o nome; avisa preço em selo de promoção", () => {
    expect(textoDoSelo({ nome: "Oferta Stop", identidade: { selo: { texto: "Semana do Mouse" } } })).toBe("Semana do Mouse");
    expect(textoDoSelo({ nome: "Oferta Stop", identidade: {} })).toBe("Oferta Stop");
    expect(textoDoSelo({ nome: "X", identidade: {} }, "Pedido da tela")).toBe("Pedido da tela");
    expect(avisosDoTexto("R$ 9,90", "promocao")[0]).toContain("cara de encarte");
    expect(avisosDoTexto("Semana do Mouse", "promocao")).toEqual([]);
    expect(avisosDoTexto("um dois três quatro cinco seis", null)[0]).toContain("6 palavras");
    expect(periodoEmTexto("2026-09-28", "2026-10-05")).toBe("de 28/09 a 05/10");
  });
});

describe("selo da campanha: texto conferido (só aviso)", () => {
  it("o caso real 'Por R$ 9,90': palavra a mais vira aviso; acento errado também; sem leitura avisa", () => {
    const certo = conferirTextoDoSelo("R$ 9,90", "R$ 9,90");
    expect(certo.ok).toBe(true);
    expect(certo.aviso).toBeNull();
    const amais = conferirTextoDoSelo("R$ 9,90", "Por R$ 9,90");
    expect(amais.ok).toBe(false);
    expect(amais.sobrando).toEqual(["por"]);
    expect(amais.aviso).toContain('escreveu a mais "por"');
    const acento = conferirTextoDoSelo("Promoção do Amor", "Promocao do Amor");
    expect(acento.ok).toBe(false);
    expect(acento.faltando).toEqual(["promoção"]);
    // A ordem num selo circular varia: não é erro.
    expect(conferirTextoDoSelo("Até a próxima vista", "próxima vista até a").ok).toBe(true);
    const semLeitura = conferirTextoDoSelo("X", null);
    expect(semLeitura.ok).toBeNull();
    expect(semLeitura.aviso).toContain("não foi conferido");
    expect(palavrasDoSelo("Até, a PRÓXIMA!")).toEqual(["até", "a", "próxima"]);
  });
});

describe("selo da campanha: colado pelo código, no lado oposto ao da logo", () => {
  it("texto na base: em cima à direita (no carrossel abaixo do contador); coluna da direita: em cima à esquerda; demais: embaixo à direita", () => {
    const base = caixaDoSelo({ zona: "base-esquerda" });
    expect(base.x0).toBeGreaterThan(0.5);
    expect(base.y0).toBeLessThan(0.2);
    const serie = caixaDoSelo({ zona: "base-centro", serie: true });
    expect(serie.y0).toBeGreaterThan(base.y0);
    const coluna = caixaDoSelo({ zona: "coluna-direita" });
    expect(coluna.x1).toBeLessThan(0.5);
    const topo = caixaDoSelo({ zona: "topo-esquerda", largura: 1080, altura: 1920 });
    expect(topo.x0).toBeGreaterThan(0.5);
    expect(topo.y1).toBeLessThanOrEqual(1);
    expect(topo.y0).toBeGreaterThan(0.8);
    for (const c of [base, serie, coluna, topo]) {
      expect(c.x0).toBeGreaterThanOrEqual(0);
      expect(c.x1).toBeLessThanOrEqual(1);
      expect(c.x1 - c.x0).toBeGreaterThan(0.1);
    }
    const livre = areaLivreParaOSelo(base);
    expect(livre).toContain("colado pelo código, em cima à direita");
    expect(livre).toContain("Não desenhe selo");
  });
});

describe("selo da campanha: Jev (referências e pedido do agente)", () => {
  it("o papel da referência é um Choice com os 4 papéis; confiança baixa vira só inspiração", () => {
    const q = perguntaDoPapelDaReferencia();
    expect(q.type).toBe("choice");
    expect(Object.keys(q.criteria).sort()).toEqual([...PAPEIS_DA_REFERENCIA].sort());
    expect(papelPelaResposta({ choice: "forma", confidence: 0.8 })).toEqual({ papel: "forma", confianca: 0.8 });
    expect(papelPelaResposta({ choice: "forma", confidence: 0.3 }).papel).toBe("inspiracao");
    expect(papelPelaResposta(null).papel).toBe("inspiracao");
    expect(referenciasDoSelo([{ caminho: "a/b.png", papel: "cor" }, { caminho: "../x" }, { caminho: "c/d.png", papel: "outro" }])).toEqual([
      { caminho: "a/b.png", papel: "cor", confianca: null, nota: null, descricao: null },
      { caminho: "c/d.png", papel: "inspiracao", confianca: null, nota: null, descricao: null },
    ]);
  });

  it("o pedido do agente: filtro barato antes do Jev e intenção só com confiança; usar anexo sem anexo não vale", () => {
    expect(falaDoSelo("melhora o selo, está genérico")).toBe(true);
    expect(falaDoSelo("usa a logo como selo")).toBe(true);
    expect(falaDoSelo("esse seleo aqui")).toBe(true);
    expect(falaDoSelo("muda o tom para divertido")).toBe(false);
    expect(Object.keys(perguntaDoPedidoDoSelo().criteria)).toEqual(["nenhuma", "melhorar", "usar_logo", "usar_anexo", "gerar"]);
    expect(intencaoPelaResposta({ choice: "melhorar", confidence: 0.9 }, 0)).toBe("melhorar");
    expect(intencaoPelaResposta({ choice: "melhorar", confidence: 0.4 }, 0)).toBe("nenhuma");
    expect(intencaoPelaResposta({ choice: "usar_anexo", confidence: 0.9 }, 0)).toBe("nenhuma");
    expect(intencaoPelaResposta({ choice: "usar_anexo", confidence: 0.9 }, 1)).toBe("usar_anexo");
  });
});

describe("selo da campanha: atualizar de forma completa", () => {
  const trabalhos = [
    { id: "t-aprovado", entrega_status: "aprovado", total: 4, cards: [{ ordem: 1, versao: 1, selo_da_campanha: { caminho: "velho.png" } }, { ordem: 4, versao: 1 }] },
    { id: "t-enviado", entrega_status: "aguardando_cliente", modelo_imagem_id: "m", qualidade: "alta", total: 3, cards: [{ ordem: 1, versao: 2, selo_da_campanha: { caminho: "velho.png" } }, { ordem: 1, versao: 1 }, { ordem: 2, versao: 1 }, { ordem: 3, versao: 1, selo_da_campanha: { caminho: "novo.png" } }] },
    { id: "t-producao", entrega_status: null, total: 1, cards: [{ ordem: 1, versao: 1 }] },
    { id: "t-sem-gerar", entrega_status: null, total: 5, cards: [] },
  ];
  it("aprovadas ficam (só contadas); as não aprovadas com outro selo entram no refazer, só capa e fechamento", () => {
    const i = impactoDaTroca(trabalhos, "novo.png");
    expect(i.aprovadas).toEqual({ trabalhos: 1, laminas: 2 });
    expect(i.com_o_atual).toBe(1);
    expect(i.refazer).toEqual([
      { trabalho_id: "t-enviado", titulo: null, ordens: [1], modelo_imagem_id: "m", qualidade: "alta", enviada: true },
      { trabalho_id: "t-producao", titulo: null, ordens: [1], modelo_imagem_id: null, qualidade: "media", enviada: false },
    ]);
    expect(aprovado({ entrega_status: "agendado" })).toBe(true);
    expect(aprovado({ entrega_status: null, post_id: "p" })).toBe(true);
  });
});

describe("selo da campanha: o agente entende o selo", () => {
  const campanha = { id: "c1", nome: "Promoção do Amor", client_id: "cli", selo_id: "s-hoje" };
  it("usar a logo: cartão já feito, sem custo, com o Desfazer para o selo de antes", () => {
    const a = acaoDoSeloNaConversa(campanha, { intencao: "usar_logo", pedido: "usa a logo como selo", anexos: [] }, { userId: "u", feito: { versao_id: "s-logo", rotulo: "Logo da marca", selo_id_antes: "s-hoje" } })!;
    expect(a.executada_direto).toBe(true);
    expect(a.itens[0].operacao).toBe("selo_trocar");
    expect(a.resultados![0].desfazer).toEqual({ selo_id_antes: "s-hoje" });
    expect(a.agente).toBe("mes");
  });
  it("melhorar: custa, então pede Confirmar com o custo antes; sem selo, não há o que melhorar", () => {
    const a = acaoDoSeloNaConversa(campanha, { intencao: "melhorar", pedido: "nada de selo genérico dourado", anexos: ["cli/pedidos/x.png"], custoUsd: 0.05 }, { userId: "u" })!;
    expect(a.executada_em).toBeUndefined();
    expect(a.custo_estimado_usd).toBe(0.05);
    expect(a.itens[0]).toMatchObject({ operacao: "selo_melhorar", para: "nada de selo genérico dourado" });
    expect(a.contexto).toMatchObject({ selo_id: "s-hoje", referencias: ["cli/pedidos/x.png"] });
    expect(podeExecutarDireto(a, { selo_melhorar: {} }, { pedidoClaro: true }).direto).toBe(false);
    expect(acaoDoSeloNaConversa({ ...campanha, selo_id: null }, { intencao: "melhorar", pedido: "x", anexos: [] }, { userId: "u" })).toBeNull();
    expect(blocoDoSeloParaOEstrategista("melhorar")).toContain("escreva essa regra");
    expect(blocoDoSeloParaOEstrategista("nenhuma")).toBe("");
  });
});

describe("selo da campanha: servidor, Estúdio e SQL", () => {
  const selo = fonte("supabase/functions/agente-calendario/selo-da-campanha.ts");
  const cal = fonte("supabase/functions/agente-calendario/index.ts");
  const estudio = fonte("supabase/functions/estudio-arte/index.ts");
  const sql = fonte("supabase/migrations/20260930100000_selo_da_campanha.sql");

  it("a direção nasce da marca DA CAMPANHA (identidade.marca_id), com kit, fontes e regras do dono; modelo escolhido na hora e referências anexadas", () => {
    expect(selo).toContain("(c.identidade as Record<string, unknown>).marca_id");
    expect(selo).toContain("kitComMarca(");
    expect(selo).toContain("fontesDaMarca(");
    expect(selo).toContain('lerRegrasDoDono(servico as never, c.client_id, { areas: ["arte", "campanha", "geral"]');
    expect(selo).toContain("const modelo = await modeloDeImagem(corpo.modelo_id);");
    expect(selo).toContain("referencias: imagens,");
    expect(selo).toContain("prompt: direcaoDoSelo(ctx),");
    expect(selo).toContain("conferirTextoDoSelo(texto, leitura.lido)");
    // O caso da CME: antes a marca vinha só do corpo e o kit era o da principal.
    expect(cal).not.toContain('await marcaDaChamada(servico, c.client_id, corpo));\n  const paleta');
  });

  it("selo pronto não passa pelo gerador; referências têm o papel pelo Jev; apagar é arquivar", () => {
    const pronto = selo.slice(selo.indexOf("async function usarPronto("), selo.indexOf("// ---------------------------------------------------------------- ações"));
    expect(pronto).not.toContain("chamarImagem(");
    expect(pronto).toContain("seloLimpo(bruta.bytes, removerFundo)");
    expect(selo).toContain("questions: { papel: perguntaDoPapelDaReferencia()");
    expect(selo).toContain('update({ arquivado_em: volta ? null : new Date().toISOString() })');
    expect(selo).not.toMatch(/\.from\("mesa_campanha_selos"\)\s*\.delete\(/);
  });

  it("a função registra as ações do selo (com fôlego nas que usam IA) e o agente executa e desfaz o selo", () => {
    expect(cal).toContain("...selo.acoes,");
    expect(cal).toContain('"trocar_angulo", "executar_acao_agente", ...selo.longas]);');
    expect(cal).toContain('if (item.operacao === "selo_melhorar") return await melhorarSeloConfirmado(');
    expect(cal).toContain('if (x.operacao === "selo_trocar" || x.operacao === "selo_melhorar") {');
    expect(cal).toContain("falaDoSelo(mensagem)");
    expect(cal).toContain("blocoDoSeloParaOEstrategista(intencaoDoSelo)");
  });

  it("o Estúdio cola o selo pelo código, intacto, e o ajuste cola o mesmo selo de novo; o leitor ignora o selo", () => {
    expect(estudio).not.toContain('anexoLeve("mesa", selo, "selo-da-campanha", true)');
    expect(estudio).toContain("pngFinal = await colarSeloNaArte(img.png, seloPedido);");
    expect(estudio).toContain("return await aplicarSelo(png, bytes, caixa, medida ? medida.clara : false);");
    expect(estudio).not.toContain("aplicarLogo(");
    expect(estudio).toContain("seloAqui ? areaLivreParaOSelo(seloAqui.caixa) : \"\"");
    expect(estudio).toContain("...(seloDaVersao(atualVersao) ? { selo_da_campanha: seloDaVersao(atualVersao) } : {}),");
    expect(estudio).toContain("é o selo da campanha: não transcreva o texto dele.");
  });

  it("SQL: versões com RLS por cliente, escrita só pelo serviço, o selo de hoje vira a primeira versão", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mesa_campanha_selos");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).toContain("REVOKE ALL ON TABLE public.mesa_campanha_selos FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT SELECT ON public.mesa_campanha_selos TO authenticated;");
    expect(sql).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO authenticated/);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS selo_id uuid");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS selo_referencias jsonb");
    expect(sql).toContain("INSERT INTO public.mesa_campanha_selos");
    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM public.mesa_campanha_selos s WHERE s.campanha_id = c.id AND s.caminho = c.selo_path)");
  });
});
