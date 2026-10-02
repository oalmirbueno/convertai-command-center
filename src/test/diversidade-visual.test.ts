import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCO_DE_COR_E_REALISMO_NA_IMAGEM,
  blocoDaDiversidadeVisual,
  familiaDaCor,
  NEGATIVO_DE_CARA_DE_IA,
  oQueVariarAgora,
  type PecaRecente,
  pedidoExplicitoDeCor,
  TITULO_DA_DIVERSIDADE,
  TITULO_DO_VARIAR_AGORA,
} from "../../supabase/functions/_shared/diversidade-visual";
import { promptDaLamina, PADRAO_DA_LAMINA, type MarcaParaDirecao } from "../../supabase/functions/_shared/direcao-arte";
import { CONHECIMENTO_DIRETOR, PADRAO_NA_IMAGEM } from "../../supabase/functions/estudio-arte/modulos/conhecimento-design";
import { pecaDoTrabalho, variarAgoraNoEstudio } from "../../supabase/functions/estudio-arte/modulos/diversidade-do-estudio";
import { pecaDoEnsaio } from "../../supabase/functions/mesa-foto/modulos/diversidade-da-foto";
import { pecaDoProjeto } from "../../supabase/functions/mesa-videos/modulos/diversidade-do-video";
import { pecaDoFilme } from "../../supabase/functions/mesa-motion/modulos/diversidade-do-motion";
import { DIVERSIDADE_NO_PLANO, variarAgoraNoMes } from "../../supabase/functions/agente-calendario/modulos/diversidade-do-mes";
import { sistemaDoDiretor } from "../../supabase/functions/mesa-videos/modulos/diretor-de-video";
import { sistemaDoPrompt } from "../../supabase/functions/mesa-videos/modulos/prompt-do-motor";
import { MOTORES_DE_VIDEO } from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { kitPorId } from "../../supabase/functions/mesa-videos/modulos/video-kits";
import { SISTEMA_DOS_STORYBOARDS } from "../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { SISTEMA_DA_CENA } from "../../supabase/functions/mesa-motion/modulos/cena-hf";

/**
 * Diversidade visual (02/10/2026). Dono: "o perfil da cliente está todo roxo:
 * a pessoa, o cenário, o texto e a logo. Siga a identidade, mas mescle; não
 * repita; menos cara de IA". Regras puras em _shared/diversidade-visual.ts e
 * ligação em todos os diretores (Estúdio, Mesa Foto, Vídeos, Motion,
 * Publicidade e o agente do Mês).
 */

const fonte = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");

const ROXO = "#6B2FA3";
const LILAS = "#9B6BD1";

describe("regras fixas da diversidade visual", () => {
  it("o bloco do diretor diz que a cor da marca é acento, proíbe tudo na mesma cor e pede realismo", () => {
    for (const mesa of ["arte", "foto", "video", "motion", "campanha", "mes"] as const) {
      const b = blocoDaDiversidadeVisual(mesa);
      expect(b.startsWith(TITULO_DA_DIVERSIDADE)).toBe(true);
      expect(b).toContain("ACENTO, não filtro");
      expect(b).toContain("20 a 30%");
      expect(b).toContain("pessoa, roupa, cenário, fundo, texto e logo nunca ficam todos na cor da marca");
      expect(b).toContain("Roupa natural e variada");
      expect(b).toContain("Não repita a receita");
      expect(b).toContain("nunca cara de IA");
      expect(b).toContain("Identidade visual é a base reconhecível");
      expect(b).not.toMatch(/[—–]/);
    }
    expect(blocoDaDiversidadeVisual("mes")).toContain("No plano do mês");
    expect(blocoDaDiversidadeVisual("video")).toContain("No vídeo");
    expect(blocoDaDiversidadeVisual("arte")).not.toBe(blocoDaDiversidadeVisual("foto"));
  });

  it("o bloco curto do gerador e o negativo cobrem cor, roupa e cara de IA", () => {
    expect(BLOCO_DE_COR_E_REALISMO_NA_IMAGEM).toContain("a marca é acento, não filtro");
    expect(BLOCO_DE_COR_E_REALISMO_NA_IMAGEM).toContain("não a cor da marca");
    expect(BLOCO_DE_COR_E_REALISMO_NA_IMAGEM).toContain("pele com textura");
    expect(NEGATIVO_DE_CARA_DE_IA).toContain("plastic or waxy skin");
    expect(NEGATIVO_DE_CARA_DE_IA).toContain("everything in one brand color");
  });

  it("família da cor: roxo e lilás são roxo; neutros saem marcados", () => {
    expect(familiaDaCor(ROXO)).toEqual({ nome: "roxo", neutra: false });
    expect(familiaDaCor(LILAS)!.nome).toBe("roxo");
    expect(familiaDaCor("#F5F1EA")!.neutra).toBe(true);
    expect(familiaDaCor("#111111")!.neutra).toBe(true);
    expect(familiaDaCor("#1F4D3A")!.nome).toBe("verde");
    expect(familiaDaCor("nada")).toBeNull();
  });
});

describe("pedido explícito de cor (o pedido vence a regra)", () => {
  it("roupa ou uniforme na cor da marca", () => {
    expect(pedidoExplicitoDeCor("Quero a equipe com o uniforme da marca").roupa).toBe(true);
    expect(pedidoExplicitoDeCor("modelo de camiseta roxa segurando o produto").roupa).toBe(true);
    expect(pedidoExplicitoDeCor("pessoa com roupa na cor da marca").roupa).toBe(true);
    expect(pedidoExplicitoDeCor("equipe uniformizada na recepção").roupa).toBe(true);
  });
  it("fundo na cor da marca e peça monocromática", () => {
    expect(pedidoExplicitoDeCor("fundo roxo com o texto branco").fundo).toBe(true);
    expect(pedidoExplicitoDeCor("cenário na cor da marca").fundo).toBe(true);
    expect(pedidoExplicitoDeCor("arte monocromática").monocromatico).toBe(true);
  });
  it("pedido comum não liga nada", () => {
    expect(pedidoExplicitoDeCor("post sobre os 3 erros ao contratar advogado")).toEqual({ roupa: false, fundo: false, monocromatico: false });
    expect(pedidoExplicitoDeCor(null)).toEqual({ roupa: false, fundo: false, monocromatico: false });
  });
});

describe("o que variar agora (derivado das últimas peças)", () => {
  const roxas: PecaRecente[] = [
    { cores: [ROXO], layout: "texto na base", cenario: "Mulher no escritório roxo com notebook", roupa: "blusa roxa", pessoa: "Ana", formato: "carrossel" },
    { cores: [LILAS], layout: "texto na base", cenario: "Escritório moderno, notebook na mesa", roupa: "vestido lilás", pessoa: "Ana", formato: "carrossel" },
    { cores: ["#5A2390"], layout: "texto na base", cenario: "Notebook sobre a mesa do escritório", roupa: "camisa roxa", pessoa: "Ana", formato: "carrossel" },
    { cores: ["#F5F1EA"], layout: "texto no topo", cenario: "Café com janela", roupa: "jeans", pessoa: "Bia", formato: "post único" },
  ];
  const paleta = [{ hex: ROXO }, { hex: "#F5F1EA" }];

  it("cor dominante da marca em quase tudo vira instrução de base neutra com a marca só no acento", () => {
    const t = oQueVariarAgora(roxas, { paleta });
    expect(t.startsWith(TITULO_DO_VARIAR_AGORA)).toBe(true);
    expect(t).toContain("últimas 4 peças");
    expect(t).toContain("- Cor: roxo (a cor da marca) dominou 3 das últimas 4 peças");
    expect(t).toContain("roxo só como acento");
  });

  it("layout, cenário, pessoa e roupa repetidos viram instruções de variar", () => {
    const t = oQueVariarAgora(roxas, { paleta, familias: ["texto na base", "tipográfica sem foto", "vista de cima"] });
    expect(t).toContain('- Layout: "texto na base" se repetiu em 3 das últimas 4');
    expect(t).toContain("tipográfica sem foto; vista de cima");
    expect(t).toMatch(/- Cenário: .*(escritorio|notebook)/);
    expect(t).toContain('- Pessoa: "ana" apareceu em 3 das últimas 4');
    expect(t).toContain("faça uma peça sem pessoa");
    expect(t).toContain("- Roupa: as últimas peças vestiram a pessoa de roxo, a cor da marca");
  });

  it("com mais de uma pessoa disponível, manda trocar de pessoa", () => {
    expect(oQueVariarAgora(roxas, { paleta, pessoasDisponiveis: 3 })).toContain("Use outra pessoa disponível agora");
  });

  it("formato repetido em 70% ou mais", () => {
    const t = oQueVariarAgora([{ formato: "carrossel" }, { formato: "carrossel" }, { formato: "carrossel" }, { formato: "estatico" }]);
    expect(t).toContain("- Formato: 3 das últimas 4 foram carrossel");
  });

  it("pedido explícito tira a regra de cor e de roupa e diz para seguir o pedido", () => {
    const t = oQueVariarAgora(roxas, { paleta, pedido: "fundo roxo e a modelo com camiseta roxa da marca" });
    expect(t).not.toContain("- Cor:");
    expect(t).not.toContain("- Roupa:");
    expect(t).toContain("O pedido define a roupa ou o uniforme");
    expect(t).toContain("O pedido define o fundo ou a peça na cor da marca");
  });

  it("sem metadado, regras gerais; histórico variado não inventa repetição", () => {
    const vazio = oQueVariarAgora([]);
    expect(vazio).toContain("sem histórico lido");
    expect(vazio).toContain("cor da marca só como acento");
    expect(oQueVariarAgora([{}, { cores: [null] }])).toContain("sem histórico lido");
    const variado = oQueVariarAgora([
      { cores: ["#1F4D3A"], layout: "texto na base", cenario: "padaria de manhã" },
      { cores: ["#C8643B"], layout: "texto no topo", cenario: "praia ao entardecer" },
      { cores: ["#F5F1EA"], layout: "coluna lateral", cenario: "jardim com flores" },
    ]);
    expect(variado).not.toContain("- Cor:");
    expect(variado).not.toContain("- Layout:");
    expect(variado).toContain('a última peça usou "padaria de manha"');
  });

  it("é determinístico e respeita o teto", () => {
    expect(oQueVariarAgora(roxas, { paleta })).toBe(oQueVariarAgora(roxas, { paleta }));
    expect(oQueVariarAgora(roxas, { paleta, familias: ["a", "b"], teto: 300 }).length).toBeLessThanOrEqual(300);
  });
});

describe("leitura das peças de cada mesa", () => {
  it("Estúdio: cor do fundo, zona do texto da capa, cena, roupa e formato", () => {
    const p = pecaDoTrabalho({
      tipo: "social",
      direcao: {
        fio_visual: "Mulher de 30 anos vestindo blazer roxo, escritório claro.",
        cards: [
          { ordem: 1, layout: { zona_texto: "base-esquerda", imagem: "mulher no escritório", fundo: "parede roxa", cor_fundo: ROXO } },
          { ordem: 2, layout: { zona_texto: "topo-centro", cor_fundo: LILAS } },
        ],
      },
    });
    expect(p.cores).toEqual([ROXO, LILAS]);
    expect(p.layout).toBe("texto na base");
    expect(p.cenario).toContain("mulher no escritório");
    expect(p.roupa).toContain("blazer roxo");
    expect(p.formato).toBe("carrossel");
    expect(pecaDoTrabalho({ direcao: null })).toEqual({ cores: [null], layout: null, cenario: null, roupa: null, formato: null });
  });

  it("Estúdio: lê o banco, tira o trabalho aberto e a outra marca, e nunca lança", async () => {
    const linhas = [
      { id: "aberto", tipo: "social", direcao: { cards: [{ layout: { cor_fundo: ROXO, zona_texto: "base-esquerda" } }] } },
      { id: "t1", tipo: "social", direcao: { cards: [{ layout: { cor_fundo: ROXO, zona_texto: "base-esquerda" } }] } },
      { id: "t2", tipo: "social", direcao: { cards: [{ layout: { cor_fundo: LILAS, zona_texto: "base-centro" } }] } },
      { id: "t3", tipo: "social", direcao: { marca_id: "outra", cards: [{ layout: { cor_fundo: "#00AA00", zona_texto: "topo-centro" } }] } },
    ];
    const consulta = { select: () => consulta, eq: () => consulta, order: () => consulta, limit: async () => ({ data: linhas, error: null }) };
    const db = { from: (t: string) => (expect(t).toBe("estudio_trabalhos"), consulta) };
    const t = await variarAgoraNoEstudio(db, "c1", { excluirId: "aberto", marca: { id: "principal", principal: true }, paleta: [{ hex: ROXO }] });
    expect(t).toContain("últimas 2 peças");
    expect(t).toContain("- Cor: roxo (a cor da marca) dominou 2 das últimas 2");
    const quebrado = { from: () => { throw new Error("sem banco"); } };
    expect(await variarAgoraNoEstudio(quebrado, "c1", {})).toContain("sem histórico lido");
  });

  it("Mesa Foto: paleta do guia, cenário e luz das tomadas, modelo e figurino", () => {
    const p = pecaDoEnsaio({
      tomadas: [{ cenario: "bancada de travertino", luz: "janela lateral", campanha: { figurino: "camisa de linho roxa" } }],
      direcao: { guia_de_estilo: { paleta: ["lavanda #9B6BD1", "areia #E8DCC4"], luz: "sol das 17h", cenarios: ["cozinha clara"], figurino: "tons roxos" }, modelo: { perfil: "mulher de 35 anos" } },
    });
    expect(p.cores).toEqual(["#9B6BD1", "#E8DCC4"]);
    expect(p.cenario).toContain("bancada de travertino");
    expect(p.luz).toBe("sol das 17h");
    expect(p.pessoa).toBe("mulher de 35 anos");
    expect(p.roupa).toContain("camisa de linho roxa");
  });

  it("Mesa Vídeos: paleta, cenários, luz, personagem e roupa da bíblia", () => {
    const p = pecaDoProjeto({
      biblia: { formato: "9:16", estilo: { paleta: [ROXO, "#FFFFFF"], luz: "neon" }, personagens: [{ nome: "Carla", aparencia: "30 anos", roupa: "jaqueta roxa" }], cenarios: [{ nome: "Loja", descricao: "loja de roupas" }] },
    });
    expect(p.cores).toEqual([ROXO, "#FFFFFF"]);
    expect(p.pessoa).toBe("Carla");
    expect(p.roupa).toBe("jaqueta roxa");
    expect(p.cenario).toContain("Loja: loja de roupas");
    expect(p.formato).toBe("9:16");
  });

  it("Motion: sequência de peças, conceito do storyboard escolhido e tema de cor", () => {
    const p = pecaDoFilme({
      tipo: "apresentacao",
      storyboard_escolhido: 1,
      storyboards: [{ conceito: "A" }, { conceito: "Do caos à ordem", resumo: "tela dividida" }],
      cenas: [{ peca: "titulo_grande", tema: "escuro" }, { peca: "numeros", tema: "escuro" }, { peca: "logo", tema: "escuro" }],
    });
    expect(p.layout).toBe("titulo_grande > numeros > logo");
    expect(p.cenario).toContain("Do caos à ordem");
    expect(p.luz).toBe("tema escuro em todas as cenas");
  });

  it("Mês: formato das últimas pautas; sem memória, vazio", () => {
    expect(variarAgoraNoMes(null)).toBe("");
    const temas = ["carrossel", "carrossel", "carrossel", "carrossel"].map((formato) => ({ formato })) as never;
    expect(variarAgoraNoMes({ temas, melhores: [], formatosAbaixo: [] })).toContain("- Formato: 4 das últimas 4 foram carrossel");
  });
});

describe("todo diretor recebe a diversidade", () => {
  const marca = (): MarcaParaDirecao => ({
    nomeCliente: "Cliente Teste",
    paleta: [{ nome: "Roxo", hex: ROXO, papel: "primaria" }, { nome: "Off", hex: "#F5F1EA", papel: "fundo" }, { nome: "Ouro", hex: "#D9A441", papel: "destaque" }],
    estilo: null,
    regras: null,
    fontes: [],
    temLogo: true,
  });

  it("Estúdio de arte: a base do diretor fecha com a seção 20 e o prompt da lâmina leva cor e realismo", () => {
    expect(CONHECIMENTO_DIRETOR).toContain(`20. ${TITULO_DA_DIVERSIDADE}`);
    expect(CONHECIMENTO_DIRETOR).toContain("monocromia só em peça tipográfica");
    const p = promptDaLamina({ ordem: 1, funcao: "capa", texto_exato: "Três erros\nque custam caro", ilustracao: "advogada no escritório" }, marca(), { total: 3, carrosselInfinito: false, levaLogo: true });
    expect(p).toContain(BLOCO_DE_COR_E_REALISMO_NA_IMAGEM);
    expect(p).toContain("a foto, a pessoa e a roupa ficam com as cores naturais da cena");
    expect(p).not.toContain("use só estas cores");
    expect(PADRAO_DA_LAMINA).not.toContain("cores da foto puxadas para a paleta");
    expect(PADRAO_NA_IMAGEM).not.toContain("cores da foto puxadas para a paleta");
    const idx = fonte("supabase/functions/estudio-arte/index.ts");
    expect(idx).toContain("variar_agora: await variarAgoraP");
    expect(idx).toContain("variarAgoraNoEstudio(db, clientId");
  });

  it("Mesa Foto: o padrão publicitário leva o bloco e os três planejamentos leem o histórico", () => {
    const idx = fonte("supabase/functions/mesa-foto/index.ts");
    expect(idx).toContain('${blocoDaDiversidadeVisual("foto")}');
    expect(idx.split("variar_agora: await variarAgoraNaFoto(").length - 1).toBe(3);
    const calc = fonte("supabase/functions/mesa-foto/calculos.ts");
    expect(calc).not.toContain("no cenário, no figurino e nos objetos de cena");
    expect(calc).toContain("figurino em tons naturais e variados");
  });

  it("Mesa Vídeos: o diretor (GPT-6 Luna) e o diretor de prompt", () => {
    const s = sistemaDoDiretor({ fase: "biblia", kit: kitPorId("filme"), contexto: "Cliente: Loja" });
    expect(s).toContain(blocoDaDiversidadeVisual("video"));
    expect(s).toContain("personagens[].roupa natural");
    const motor = MOTORES_DE_VIDEO.find((m) => m.familia === "video")!;
    const p = sistemaDoPrompt(motor, "Cliente: Loja");
    expect(p).toContain(blocoDaDiversidadeVisual("video"));
    expect(p).toContain(NEGATIVO_DE_CARA_DE_IA);
    expect(p).toContain("a paleta só como acento");
    expect(fonte("supabase/functions/mesa-videos/diretor.ts")).toContain("variarAgoraNoVideo(b.servico(), clientId");
  });

  it("Mesa Motion: storyboards, cena e agente", () => {
    expect(SISTEMA_DOS_STORYBOARDS).toContain(blocoDaDiversidadeVisual("motion"));
    expect(SISTEMA_DOS_STORYBOARDS).toContain("VARIAR_AGORA");
    expect(SISTEMA_DA_CENA).toContain("Cor sem monocromia");
    const idx = fonte("supabase/functions/mesa-motion/index.ts");
    expect(idx).toContain('${blocoDaDiversidadeVisual("motion")}');
    expect(idx).toContain("VARIAR_AGORA: variarAgora");
  });

  it("Campanhas (Mesa Publicidade) e agente do Mês", () => {
    const pub = fonte("supabase/functions/mesa-publicidade/index.ts");
    expect(pub).toContain('${blocoDaDiversidadeVisual("campanha")}');
    expect(pub).toContain("com a cor da marca como acento");
    expect(DIVERSIDADE_NO_PLANO).toBe(blocoDaDiversidadeVisual("mes"));
    const cal = fonte("supabase/functions/agente-calendario/index.ts");
    expect(cal).toContain("${DIVERSIDADE_NO_PLANO}\n- Responda somente com o JSON pedido.");
    expect(cal).toContain("const variar = variarAgoraNoMes(ctx.memoriaEditorial);");
  });
});
