import { describe, expect, it, vi } from "vitest";

/**
 * Frente OR (29/09): o "Organizar" do Workspace passa a ver as imagens.
 * Estes testes provam, sem provedor nem banco:
 * - carrossel agrupado numa pasta por tema e ordenado pela numeração e pelo texto;
 * - par de antes e depois junto, com o Jev escolhendo quando há mais de um;
 * - duplicata exata em "Duplicadas", sem apagar;
 * - imagem quebrada fora da leitura, com o motivo, antes de gastar;
 * - prévia, confirmar e desfazer (volta tudo como estava) e nada apagado;
 * - o que a pessoa já organizou em pasta própria fica onde está.
 */

import {
  type Candidato,
  comExtensao,
  type Leitura,
  montarPrevia,
  nomeGenerico,
  normalizarConfirmacao,
  normalizarLeitura,
  type Perguntar,
} from "../../supabase/functions/workspace-organizar/organizador";
import { aplicarOrganizacao, type BancoDoWorkspace, desfazerOrganizacao, type NoDoIndice, normalizarRegistro } from "../../supabase/functions/workspace-organizar/aplicar";
import { arquivosParaOrganizar, chamadasPorRajada, type NoCompleto } from "../../supabase/functions/workspace-organizar/candidatos";
import { type ItemParaLer, lerArquivos, pedidoDoLote } from "../../supabase/functions/workspace-organizar/leitura";

// ------------------------------------------------------------ fábrica

let seq = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function leitura(p: Partial<Leitura>): Leitura {
  return {
    tipo: "post",
    confianca: 0.9,
    tema: "",
    texto: "",
    descricao: "",
    identidade: "",
    serie: "",
    fixos: "",
    paleta: [],
    numero: null,
    total: null,
    capa: false,
    fechamento: false,
    objeto: "",
    ...p,
  };
}

function cand(nome: string, l: Partial<Leitura> | null, extra: Partial<Candidato> = {}): Candidato {
  seq++;
  return {
    id: uuid(seq),
    nome,
    mime: "image/png",
    tamanho: 1000 + seq,
    duracao: null,
    largura: 1080,
    altura: 1350,
    caminho: [],
    hash: `hash-${seq}`,
    criado_em: `2026-09-29T10:${String(seq % 60).padStart(2, "0")}:00Z`,
    storage_path: `cliente/${nome}`,
    leitura: l ? leitura(l) : null,
    falha: null,
    situacao: null,
    ...extra,
  };
}

const AZUL = ["#0a2540", "#ffffff", "#00d4ff"];
const VERDE = ["#1f5f3a", "#f2f2f2", "#9be15d"];
const ID_AZUL = "fundo azul escuro, letra sans bold branca, logo no canto";
const ID_VERDE = "fundo verde, serifada preta, fotos recortadas";

/** Jev de mentira: responde pelo id da pergunta, com a função dada. */
function jevFalso(responder: (id: string, pergunta: any, state: any) => any): { perguntar: Perguntar; chamadas: any[] } {
  const chamadas: any[] = [];
  const perguntar: Perguntar = async (state, questions) => {
    chamadas.push({ state, questions });
    const out: Record<string, any> = {};
    for (const id of Object.keys(questions)) out[id] = responder(id, questions[id], state);
    return out;
  };
  return { perguntar, chamadas };
}

// ------------------------------------------------------------ carrossel

describe("carrossel agrupado e ordenado", () => {
  it("junta as lâminas do mesmo card numa pasta com o tema e ordena pela numeração da arte", async () => {
    const l3 = cand("IMG_2231.png", { tipo: "carrossel", tema: "erros no tráfego pago", texto: "Erro 2: não medir", identidade: ID_AZUL, paleta: AZUL, numero: 3, total: 4 });
    const l1 = cand("IMG_2229.png", { tipo: "carrossel", tema: "erros no tráfego pago", texto: "3 erros no tráfego pago", identidade: ID_AZUL, paleta: AZUL, numero: 1, total: 4, capa: true });
    const l4 = cand("IMG_2232.png", { tipo: "carrossel", tema: "erros no tráfego pago", texto: "Salve este post", identidade: ID_AZUL, paleta: AZUL, numero: 4, total: 4, fechamento: true });
    const l2 = cand("IMG_2230.png", { tipo: "carrossel", tema: "erros no tráfego pago", texto: "Erro 1: público amplo", identidade: ID_AZUL, paleta: AZUL, numero: 2, total: 4 });
    // Outro carrossel da mesma marca, outra identidade e outro tema.
    const b1 = cand("dicas-jardim-1.png", { tipo: "carrossel", tema: "cuidados com o jardim", texto: "Seu jardim no verão", identidade: ID_VERDE, paleta: VERDE, capa: true });
    const b2 = cand("dicas-jardim-2.png", { tipo: "carrossel", tema: "cuidados com o jardim", texto: "Regue cedo", identidade: ID_VERDE, paleta: VERDE });

    const previa = await montarPrevia([l3, l1, l4, l2, b1, b2]);
    const carrosseis = previa.grupos.filter((g) => g.categoria === "carrosseis");
    expect(carrosseis.map((g) => g.caminho)).toEqual([
      ["Carrosséis", "Cuidados com o jardim"],
      ["Carrosséis", "Erros no tráfego pago"],
    ]);
    const trafego = carrosseis[1];
    expect(trafego.itens.map((i) => i.id)).toEqual([l1.id, l2.id, l3.id, l4.id]);
    expect(trafego.itens.map((i) => i.nome_novo)).toEqual([
      "01 - capa.png",
      "02 - Erro 1 público amplo.png",
      "03 - Erro 2 não medir.png",
      "04 - fechamento.png",
    ]);
    expect(trafego.ideia).toContain("numeração");
    // Jardim: sem número na arte, a ordem vem do número no nome do arquivo.
    expect(carrosseis[0].itens.map((i) => i.id)).toEqual([b1.id, b2.id]);
    expect(previa.resumo).toContain("2 carrosséis");
  });

  it("pergunta ao Jev 'mesmo carrossel?' no par duvidoso e a ordem pelo texto quando a arte não tem número", async () => {
    // Enviadas no mesmo segundo (envio em lote): a ordem de envio não diz nada, vale o texto.
    const lote = { criado_em: "2026-09-29T09:00:00Z" };
    const a = cand("Captura de tela 1.png", { tipo: "carrossel", tema: "como vender mais", texto: "Como vender mais no Instagram", identidade: ID_AZUL, paleta: AZUL }, lote);
    const b = cand("Captura de tela 2.png", { tipo: "carrossel", tema: "stories que vendem", texto: "Comente QUERO e receba", identidade: "fundo azul, letra grande", paleta: AZUL }, lote);
    const { perguntar, chamadas } = jevFalso((id, q, state) => {
      if (q.type === "noul") return { noul: 0.83 };
      if (q.type === "score") return { score: /Como vender/.test(JSON.stringify(state.laminas[Number(id.slice(1))])) ? 0.2 : 3.9, confidence: 0.8 };
      return { choice: "post", confidence: 0.9 };
    });
    const previa = await montarPrevia([b, a], { perguntar });
    const grupo = previa.grupos.find((g) => g.categoria === "carrosseis")!;
    expect(grupo.itens).toHaveLength(2);
    // O Jev colocou "a" na abertura e "b" no fechamento.
    expect(grupo.itens[0].id).toBe(a.id);
    expect(grupo.itens[0].nome_novo).toBe("01 - capa.png");
    expect(grupo.itens[1].motivo).toContain("Jev");
    expect(chamadas.some((c) => Object.values(c.questions).some((q: any) => q.type === "noul"))).toBe(true);
    expect(previa.decisoes_do_jev).toBeGreaterThan(0);
  });

  it("sem número na arte, lâminas coladas uma a uma saem na ordem em que foram enviadas (capa vista na arte vai primeiro)", async () => {
    const serie = { tipo: "carrossel" as const, serie: "trabalha enquanto você dorme", identidade: ID_AZUL, paleta: AZUL };
    const s2 = cand("Colado 16.31.06.png", { ...serie, tema: "perfil mal feito", texto: "Se seu perfil está mal" }, { criado_em: "2026-09-26T19:31:06Z" });
    const s3 = cand("Colado 16.31.14.png", { ...serie, tema: "quem entra no perfil", texto: "Quem entra no seu perfil" }, { criado_em: "2026-09-26T19:31:14Z" });
    const s1 = cand("Colado 16.30.57.png", { ...serie, tema: "trabalho e descanso", texto: "Trabalha enquanto você dorme", capa: true }, { criado_em: "2026-09-26T19:30:57Z" });
    const s4 = cand("Colado 16.31.28.png", { ...serie, tema: "vista o perfil", texto: "Vista seu perfil para o cliente" }, { criado_em: "2026-09-26T19:31:28Z" });
    const previa = await montarPrevia([s3, s4, s1, s2]);
    const g = previa.grupos.find((x) => x.categoria === "carrosseis")!;
    // Temas diferentes por lâmina, mas a mesma série: um carrossel só, com o nome da série.
    expect(g.caminho).toEqual(["Carrosséis", "Trabalha enquanto você dorme"]);
    expect(g.itens.map((i) => i.id)).toEqual([s1.id, s2.id, s3.id, s4.id]);
    expect(g.ideia).toContain("na ordem em que foram enviadas");
  });

  it("a última lâmina lida como capa de reel entra no carrossel só com o sim do Jev (mesma rajada de envio e mesmos textos fixos)", async () => {
    const serie = { serie: "perfil profissional", fixos: "Designer Gráfico | Social Media | Estrategista", identidade: ID_AZUL, paleta: AZUL };
    const c1 = cand("Colado 1.png", { ...serie, tipo: "carrossel", tema: "trabalha enquanto dorme", capa: true }, { criado_em: "2026-09-26T19:30:57Z" });
    const c2 = cand("Colado 2.png", { ...serie, tipo: "carrossel", tema: "como se apresenta" }, { criado_em: "2026-09-26T19:31:06Z" });
    const fim = cand("Colado 3.png", { ...serie, tipo: "reel", tema: "quem sou eu" }, { criado_em: "2026-09-26T19:31:37Z" });
    const outroPost = cand("Promo.png", { tipo: "post", tema: "promoção de natal", identidade: ID_VERDE, paleta: VERDE }, { criado_em: "2026-09-20T10:00:00Z" });
    const { perguntar, chamadas } = jevFalso((id, q, state) => {
      if (q.type !== "noul") return { choice: "post", confidence: 0.9 };
      // Etapa dos conjuntos: o Jev vê o carrossel inteiro e a arte solta.
      if (id.startsWith("g")) {
        const conjunto = state.conjuntos[Number(id.slice(1))];
        return { noul: conjunto.artes_b[0].tipo_que_a_visao_leu === "reel" ? 0.8 : 0.1 };
      }
      return { noul: 0.9 };
    });
    const previa = await montarPrevia([c1, c2, fim, outroPost], { perguntar });
    const g = previa.grupos.find((x) => x.categoria === "carrosseis")!;
    expect(g.itens.map((i) => i.id)).toEqual([c1.id, c2.id, fim.id]);
    expect(g.itens[2].duvida).toContain("a leitura viu reel");
    // O post de outra identidade nem foi perguntado.
    expect(JSON.stringify(chamadas.map((c) => c.state))).not.toContain("promoção de natal");
    expect(previa.grupos.find((x) => x.categoria === "posts")!.itens.map((i) => i.id)).toEqual([outroPost.id]);
  });

  it("mesma marca e mesmo total não bastam: dois carrosséis de assuntos diferentes vão ao Jev", async () => {
    const a1 = cand("IMG_31.png", { tipo: "carrossel", tema: "promoção de verão", texto: "Verão", identidade: ID_AZUL, paleta: AZUL, numero: 1, total: 3, capa: true });
    const b2 = cand("IMG_32.png", { tipo: "carrossel", tema: "equipe nova", texto: "Conheça a Ana", identidade: ID_AZUL, paleta: AZUL, numero: 2, total: 3 });
    const { perguntar, chamadas } = jevFalso((_, q) => (q.type === "noul" ? { noul: 0.05 } : { choice: "post", confidence: 0.9 }));
    const previa = await montarPrevia([a1, b2], { perguntar });
    expect(chamadas.length).toBeGreaterThan(0);
    const carrosseis = previa.grupos.filter((g) => g.categoria === "carrosseis");
    expect(carrosseis).toHaveLength(2);
    expect(carrosseis.every((g) => g.itens.length === 1 && g.itens[0].duvida === "lâmina sem o resto do carrossel")).toBe(true);
  });

  it("não junta carrosséis diferentes quando o Jev diz que não", async () => {
    const a = cand("IMG_1.png", { tipo: "carrossel", tema: "promoção de verão", texto: "Tudo com 20%", identidade: ID_AZUL, paleta: AZUL });
    const b = cand("IMG_9.png", { tipo: "carrossel", tema: "equipe nova", texto: "Conheça a Ana", identidade: ID_AZUL, paleta: AZUL });
    const { perguntar } = jevFalso((_, q) => (q.type === "noul" ? { noul: 0.1 } : { choice: "post", confidence: 0.9 }));
    const previa = await montarPrevia([a, b], { perguntar });
    expect(previa.grupos.filter((g) => g.categoria === "carrosseis")).toHaveLength(0);
    // Lâmina sozinha sem número vira post, com dúvida para a pessoa conferir.
    const posts = previa.grupos.find((g) => g.categoria === "posts")!;
    expect(posts.itens).toHaveLength(2);
    expect(posts.itens.every((i) => i.duvida)).toBe(true);
  });
});

// ------------------------------------------------------------ antes e depois

describe("par de antes e depois", () => {
  it("junta a foto antes com a depois do mesmo objeto numa pasta com a ideia", async () => {
    const antes = cand("WhatsApp Image 2026-09-01.jpeg", { tipo: "antes", tema: "limpeza de sofá", objeto: "sofá cinza de 3 lugares", descricao: "sofá manchado" });
    const depois = cand("WhatsApp Image 2026-09-02.jpeg", { tipo: "depois", tema: "limpeza de sofá", objeto: "sofá cinza de 3 lugares", descricao: "sofá limpo" });
    const previa = await montarPrevia([depois, antes]);
    const g = previa.grupos.find((x) => x.categoria === "antes_depois")!;
    expect(g.caminho).toEqual(["Antes e depois", "Sofá cinza de 3 lugares"]);
    expect(g.itens.map((i) => i.nome_novo)).toEqual(["antes - sofá cinza de 3 lugares.jpeg", "depois - sofá cinza de 3 lugares.jpeg"]);
  });

  it("com vários candidatos, o Jev escolhe o par e ninguém fica com o par de outro", async () => {
    const aSofa = cand("a1.jpg", { tipo: "antes", objeto: "sofá cinza", tema: "sofá" });
    const aTapete = cand("a2.jpg", { tipo: "antes", objeto: "tapete bege redondo", tema: "tapete" });
    const dTapete = cand("d1.jpg", { tipo: "depois", objeto: "tapete redondo claro", tema: "tapete" });
    const dSofa = cand("d2.jpg", { tipo: "depois", objeto: "sofá de três lugares", tema: "sofá" });
    const { perguntar } = jevFalso((id, q, state) => {
      if (q.type !== "choice") return {};
      const k = Number(id.slice(1));
      const antes = state.fotos_antes[k];
      const alvo = state.fotos_depois.find((d: any) => d.tema === antes.tema);
      return { choice: alvo.id, confidence: 0.9 };
    });
    const previa = await montarPrevia([aSofa, aTapete, dTapete, dSofa], { perguntar });
    const grupos = previa.grupos.filter((g) => g.categoria === "antes_depois" && g.caminho.length === 2);
    expect(grupos).toHaveLength(2);
    const sofa = grupos.find((g) => g.itens.some((i) => i.id === aSofa.id))!;
    expect(sofa.itens.map((i) => i.id).sort()).toEqual([aSofa.id, dSofa.id].sort());
    const tapete = grupos.find((g) => g.itens.some((i) => i.id === aTapete.id))!;
    expect(tapete.itens.map((i) => i.id).sort()).toEqual([aTapete.id, dTapete.id].sort());
  });

  it("foto antes sem par fica em Antes e depois com dúvida", async () => {
    const a = cand("x.jpg", { tipo: "antes", objeto: "piso de madeira" });
    const previa = await montarPrevia([a]);
    const g = previa.grupos.find((x) => x.categoria === "antes_depois")!;
    expect(g.caminho).toEqual(["Antes e depois"]);
    expect(g.itens[0].duvida).toContain("sem par");
  });
});

// ------------------------------------------------------------ duplicata, versões, resto

describe("duplicatas, versões e o resto", () => {
  it("duplicata exata vai para Duplicadas com o nome do original; nada some da prévia", async () => {
    const original = cand("Promo outubro.png", { tipo: "post", tema: "promoção de outubro" }, { hash: "igual", criado_em: "2026-09-01T10:00:00Z" });
    const copia = cand("IMG_9981.png", { tipo: "post", tema: "promoção de outubro" }, { hash: "igual", criado_em: "2026-09-05T10:00:00Z" });
    const previa = await montarPrevia([copia, original]);
    const dup = previa.grupos.find((g) => g.categoria === "duplicadas")!;
    expect(dup.itens.map((i) => i.id)).toEqual([copia.id]);
    expect(dup.itens[0].nome_novo).toBe("Promo outubro (cópia 1).png");
    expect(dup.itens[0].motivo).toContain("nada foi apagado");
    const posts = previa.grupos.find((g) => g.categoria === "posts")!;
    expect(posts.itens.map((i) => i.id)).toEqual([original.id]);
    // O nome escrito pela pessoa fica.
    expect(posts.itens[0].nome_novo).toBe("Promo outubro.png");
    expect(previa.duplicadas).toBe(1);
  });

  it("versões da mesma arte ficam juntas, da mais antiga para a mais nova", async () => {
    const v2 = cand("banner black friday v2.png", { tipo: "post", tema: "black friday" });
    const v1 = cand("banner black friday v1.png", { tipo: "post", tema: "black friday" });
    const previa = await montarPrevia([v2, v1]);
    const g = previa.grupos.find((x) => x.caminho[1] && /versões/.test(x.caminho[1]))!;
    expect(g.caminho[0]).toBe("Posts");
    expect(g.itens.map((i) => i.id)).toEqual([v1.id, v2.id]);
  });

  it("fotos com o mesmo tema ganham subpasta a partir de 3; stories, logos e documentos vão para a pasta do tipo", async () => {
    const fotos = [1, 2, 3].map((i) => cand(`DSC_00${i}.jpg`, { tipo: "foto", tema: "cozinha planejada", objeto: `armário ${i}` }));
    const story = cand("story.png", { tipo: "story", tema: "enquete de sábado" }, { largura: 1080, altura: 1920 });
    const logo = cand("marca.png", { tipo: "logo", tema: "logo" });
    const pdf = cand("contrato.pdf", null, { mime: "application/pdf", hash: null });
    const previa = await montarPrevia([...fotos, story, logo, pdf]);
    const caminhos = previa.grupos.map((g) => g.caminho.join(" / "));
    expect(caminhos).toContain("Fotos / Cozinha planejada");
    expect(caminhos).toContain("Stories");
    expect(caminhos).toContain("Logos e marca");
    expect(caminhos).toContain("Documentos");
    const st = previa.grupos.find((g) => g.categoria === "stories")!;
    // Nome genérico troca pelo tema e mantém a extensão.
    expect(st.itens[0].nome_novo).toBe("Enquete de sábado.png");
  });

  it("tipo em dúvida vai ao Jev (Choice) e o que ninguém sabe fica onde está", async () => {
    const duvida = cand("IMG_5.png", { tipo: "post", confianca: 0.3, tema: "bastidores" });
    const nada = cand("IMG_6.png", { tipo: "outro", confianca: 0.2 });
    const { perguntar } = jevFalso((id) => (id === "t0" ? { choice: "story", confidence: 0.8 } : { choice: "outro", confidence: 0.9 }));
    const previa = await montarPrevia([duvida, nada], { perguntar });
    expect(previa.grupos.find((g) => g.categoria === "stories")!.itens[0].id).toBe(duvida.id);
    expect(previa.ficam.map((f) => f.id)).toEqual([nada.id]);
  });

  it("se o Jev cair, a prévia sai assim mesmo, com dúvida", async () => {
    const duvida = cand("IMG_7.png", { tipo: "post", confianca: 0.3, tema: "sorteio" });
    const aviso = vi.fn();
    const previa = await montarPrevia([duvida], {
      perguntar: async () => {
        throw new Error("typesafe_529");
      },
      aoFalharOJev: aviso,
    });
    expect(aviso).toHaveBeenCalled();
    expect(previa.grupos[0].itens[0].duvida).toContain("Jev");
  });
});

// ------------------------------------------------------------ leitura (imagem quebrada)

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function png(inteiro = true, tamanho = 200): Uint8Array {
  const b = new Uint8Array(tamanho);
  b.set(PNG, 0);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  if (inteiro) b.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], tamanho - 12);
  return b;
}
const paraLer = (id: string, bytes: Uint8Array, video = false): ItemParaLer => ({ id, nome: `${id}.png`, video, duracao: video ? 20 : null, largura: 1080, altura: 1920, imagem: { bytes, mime: "image/png" } });

describe("leitura por visão em lotes", () => {
  const base = {
    erroQueParaTudo: (e: any) => e?.codigo === "saldo_insuficiente",
    recusouImagem: (e: any) => e?.recusou === true,
    descrever: (e: any) => String(e?.message || e),
    log: () => {},
  };

  it("imagem quebrada sai antes de gastar, com o motivo, e não derruba as outras", async () => {
    const lerLote = vi.fn(async (lote: ItemParaLer[]) => ({ leituras: lote.map((_, i) => ({ imagem: i + 1, tipo: "post", confianca: 0.9, tema: "t" })), custo: 0.001 }));
    const r = await lerArquivos([paraLer("a", png()), paraLer("quebrada", png(false)), paraLer("b", png())], { ...base, lerLote });
    expect(r.falhas).toEqual([{ id: "quebrada", motivo: expect.stringContaining("PNG está cortado") }]);
    expect(r.leituras.map((l) => l.id)).toEqual(["a", "b"]);
    // A quebrada nunca foi ao leitor.
    expect(lerLote.mock.calls.flatMap((c) => c[0].map((i: ItemParaLer) => i.id))).not.toContain("quebrada");
    expect(r.custo).toBeCloseTo(0.001);
  });

  it("provedor recusou o lote: relê uma a uma e só a recusada fica de fora", async () => {
    const lerLote = vi.fn(async (lote: ItemParaLer[]) => {
      if (lote.some((i) => i.id === "ruim")) throw Object.assign(new Error("invalid image"), { recusou: true });
      return { leituras: lote.map((_, i) => ({ imagem: i + 1, tipo: "foto", confianca: 0.9 })), custo: 0 };
    });
    const r = await lerArquivos([paraLer("a", png()), paraLer("ruim", png()), paraLer("b", png())], { ...base, lerLote });
    expect(r.leituras.map((l) => l.id).sort()).toEqual(["a", "b"]);
    expect(r.falhas.map((f) => f.id)).toEqual(["ruim"]);
  });

  it("saldo acabou: para tudo e devolve o que não foi tentado", async () => {
    const lerLote = vi.fn(async () => {
      throw { codigo: "saldo_insuficiente", message: "sem saldo" };
    });
    const r = await lerArquivos([paraLer("a", png()), paraLer("b", png())], { ...base, lerLote, paralelos: 1 });
    expect(r.erroQueParou).toBeTruthy();
    expect(r.restantes.sort()).toEqual(["a", "b"]);
  });

  it("quadro de vídeo nunca vira lâmina: é reel (vertical e curto) ou vídeo", async () => {
    const lerLote = vi.fn(async () => ({ leituras: [{ imagem: 1, tipo: "carrossel", confianca: 0.9 }], custo: 0 }));
    const r = await lerArquivos([paraLer("v", png(), true)], { ...base, lerLote });
    expect(r.leituras[0].leitura.tipo).toBe("reel");
    expect(pedidoDoLote([paraLer("v", png(), true)])).toContain("VÍDEO");
  });

  it("leitura estranha do modelo é conferida campo a campo", () => {
    expect(normalizarLeitura({ tipo: "qualquer" })).toBeNull();
    const l = normalizarLeitura({ tipo: "carrossel", confianca: 7, paleta: ["#FFF", "00ff00", "#123456"], numero: 9, total: 5, tema: "a/b" })!;
    expect(l.confianca).toBe(1);
    expect(l.paleta).toEqual(["#00ff00", "#123456"]);
    expect(l.total).toBeNull();
    expect(l.tema).toBe("a b");
  });
});

// ------------------------------------------------------------ quem entra

function no(id: number, nome: string, pai: number | null, extra: Partial<NoCompleto> = {}): NoCompleto {
  return {
    id: uuid(id),
    parent_id: pai === null ? null : uuid(pai),
    kind: extra.kind ?? "file",
    name: nome,
    sort_index: 0,
    inbox_token: null,
    inbox_scan_status: null,
    mime: extra.kind === "folder" ? null : "image/png",
    size_bytes: 10,
    storage_path: extra.kind === "folder" ? null : `c/${nome}`,
    duration_sec: null,
    created_at: "2026-09-29T10:00:00Z",
    sent_for_approval_file_id: null,
    ...extra,
  };
}

describe("quem entra na organização", () => {
  const indice = [
    no(1, "solta.png", null),
    no(2, "Nova pasta", null, { kind: "folder" }),
    no(3, "dentro-da-generica.png", 2),
    no(4, "Campanha Natal", null, { kind: "folder" }),
    no(5, "organizada.png", 4),
    no(6, "Arquivados", null, { kind: "folder" }),
    no(7, "velha.png", 6),
    no(8, "Recebidos", null, { kind: "folder", inbox_token: "tok" }),
    no(9, "do-cliente.png", 8),
    no(10, "em-verificacao.png", null, { inbox_scan_status: "pending" }),
    no(11, "video.mp4", null, { mime: "video/mp4" }),
    no(12, "briefing.pdf", null, { mime: "application/pdf" }),
  ];

  it("padrão: soltos e pasta genérica; pasta com nome próprio, Arquivados, recebimento e quarentena ficam", () => {
    const r = arquivosParaOrganizar(indice, null, false);
    expect(r.map((c) => c.nome).sort()).toEqual(["briefing.pdf", "dentro-da-generica.png", "solta.png", "video.mp4"]);
    expect(r.find((c) => c.nome === "dentro-da-generica.png")!.caminho).toEqual(["Nova pasta"]);
    expect(r.find((c) => c.nome === "video.mp4")!.leitura).toBe("video");
    expect(r.find((c) => c.nome === "briefing.pdf")!.leitura).toBe("nome");
  });

  it("as chamadas de leitura não partem uma rajada de envio (o leitor vê o card inteiro junto)", () => {
    const t = (s: number) => new Date(Date.UTC(2026, 8, 26, 19, 0, s)).toISOString();
    const c = (id: string, s: number, caminho: string[] = []) => ({ id, caminho, criado_em: t(s) });
    // 3 soltos em lote (mesmo segundo), um carrossel de 7 colado lâmina a lâmina, outro de 5 minutos depois.
    const lista = [c("l1", 0), c("l2", 0), c("l3", 0), ...[1, 2, 3, 4, 5, 6, 7].map((i) => c(`m${i}`, 600 + i * 9)), ...[1, 2, 3, 4, 5].map((i) => c(`t${i}`, 1600 + i * 9))];
    const chamadas = chamadasPorRajada(lista, 8);
    expect(chamadas).toEqual([["l1", "l2", "l3"], ["m1", "m2", "m3", "m4", "m5", "m6", "m7"], ["t1", "t2", "t3", "t4", "t5"]]);
    expect(chamadas.every((ch) => ch.length <= 8)).toBe(true);
  });

  it("reorganizar tudo entra nas pastas da pessoa, mas nunca em Arquivados nem na de recebimento", () => {
    const r = arquivosParaOrganizar(indice, null, true);
    expect(r.map((c) => c.nome)).toContain("organizada.png");
    expect(r.map((c) => c.nome)).not.toContain("velha.png");
    expect(r.map((c) => c.nome)).not.toContain("do-cliente.png");
    expect(r.find((c) => c.nome === "organizada.png")!.caminho).toEqual(["Campanha Natal"]);
  });
});

// ------------------------------------------------------------ prévia, confirmar e desfazer

class BancoFalso implements BancoDoWorkspace {
  nos: NoDoIndice[];
  apagados: string[] = [];
  criadas = 0;
  constructor(nos: NoDoIndice[]) {
    this.nos = nos.map((n) => ({ ...n }));
  }
  async indice() {
    return this.nos.map((n) => ({ ...n }));
  }
  async criarPasta(nome: string, parentId: string | null) {
    this.criadas++;
    const id = uuid(9000 + this.criadas);
    this.nos.push({ id, parent_id: parentId, kind: "folder", name: nome, sort_index: 0 });
    return id;
  }
  async atualizar(id: string, campos: any) {
    const n = this.nos.find((x) => x.id === id);
    if (!n) throw new Error("não existe");
    Object.assign(n, campos);
  }
  async tirarPastaVazia(id: string) {
    if (this.nos.some((n) => n.parent_id === id)) return false;
    this.apagados.push(id);
    this.nos = this.nos.filter((n) => n.id !== id);
    return true;
  }
}

describe("prévia, confirmar e desfazer", () => {
  it("confirma o que a pessoa editou, guarda o antes, desfaz tudo e nunca apaga arquivo", async () => {
    const lamina1 = cand("IMG_1.png", { tipo: "carrossel", tema: "dicas de sofá", identidade: ID_AZUL, paleta: AZUL, numero: 1, total: 2, capa: true, texto: "Dicas" });
    const lamina2 = cand("IMG_2.png", { tipo: "carrossel", tema: "dicas de sofá", identidade: ID_AZUL, paleta: AZUL, numero: 2, total: 2, texto: "Aspire toda semana" });
    const post = cand("IMG_3.png", { tipo: "post", tema: "promoção" });
    const fica = cand("IMG_4.png", { tipo: "post", tema: "outra" });
    const previa = await montarPrevia([lamina2, lamina1, post, fica]);

    // A pessoa tira "fica" da prévia e muda o nome da pasta do carrossel.
    const grupos = previa.grupos
      .map((g) => ({ caminho: g.caminho[0] === "Carrosséis" ? ["Carrosséis", "Sofá sempre limpo"] : g.caminho, itens: g.itens.filter((i) => i.id !== fica.id).map((i) => ({ id: i.id, nome: i.nome_novo.replace(/\.png$/, ""), ordem: i.ordem })) }))
      .filter((g) => g.itens.length);
    const confirmados = normalizarConfirmacao(grupos);

    const pai = uuid(500);
    const banco = new BancoFalso([
      { id: pai, parent_id: null, kind: "folder", name: "Cliente", sort_index: 0 },
      ...[lamina1, lamina2, post, fica].map((c, i) => ({ id: c.id, parent_id: pai, kind: "file", name: c.nome, sort_index: i })),
      // Pasta "Posts" já existe: é reaproveitada.
      { id: uuid(600), parent_id: pai, kind: "folder", name: "posts", sort_index: 0 },
    ]);
    const antes = JSON.parse(JSON.stringify(banco.nos));
    const r = await aplicarOrganizacao(banco, "cliente-x", pai, confirmados, () => "2026-09-29T12:00:00Z");
    expect(r.falhas).toEqual([]);
    expect(r.movidos).toBe(3);
    // Carrosséis e a pasta do carrossel nasceram; Posts foi reaproveitada.
    expect(r.pastas_criadas).toBe(2);
    const porId = new Map(banco.nos.map((n) => [n.id, n]));
    const pastaDoCarrossel = porId.get(porId.get(lamina1.id)!.parent_id!)!;
    expect(pastaDoCarrossel.name).toBe("Sofá sempre limpo");
    expect(porId.get(pastaDoCarrossel.parent_id!)!.name).toBe("Carrosséis");
    expect(porId.get(lamina1.id)!.name).toBe("01 - capa.png");
    expect(porId.get(lamina2.id)!.sort_index).toBe(2);
    expect(porId.get(post.id)!.parent_id).toBe(uuid(600));
    // Tirado da prévia: não mexeu.
    expect(porId.get(fica.id)).toEqual(antes.find((n: any) => n.id === fica.id));
    // Nenhum nó sumiu.
    expect(banco.apagados).toEqual([]);
    expect(antes.every((n: any) => porId.has(n.id))).toBe(true);

    // O registro passa pela tela (JSON) e volta conferido.
    const registro = normalizarRegistro(JSON.parse(JSON.stringify(r.registro)), "cliente-x")!;
    expect(registro.itens).toHaveLength(3);
    const d = await desfazerOrganizacao(banco, registro);
    expect(d.restaurados).toBe(3);
    expect(d.pulados).toEqual([]);
    expect(d.pastas_tiradas).toBe(2);
    // Voltou exatamente como estava (a pasta Posts, que já existia, ficou).
    const ordena = (x: any[]) => x.slice().sort((a, b) => a.id.localeCompare(b.id));
    expect(ordena(banco.nos)).toEqual(ordena(antes));
    // Só as pastas vazias que a organização criou saíram; nenhum arquivo.
    expect(banco.apagados.every((id) => !antes.some((n: any) => n.id === id))).toBe(true);
  });

  it("desfazer não passa por cima do que a pessoa mexeu depois e mantém a pasta que ganhou arquivo", async () => {
    const a = cand("IMG_10.png", { tipo: "post", tema: "natal" });
    const banco = new BancoFalso([{ id: a.id, parent_id: null, kind: "file", name: a.nome, sort_index: 0 }]);
    const r = await aplicarOrganizacao(banco, "c", null, [{ caminho: ["Posts"], itens: [{ id: a.id, nome: "Natal", ordem: null }] }]);
    expect(banco.nos.find((n) => n.id === a.id)!.name).toBe("Natal.png");
    // Depois da organização, a pessoa renomeia e sobe outro arquivo na pasta nova.
    await banco.atualizar(a.id, { name: "Natal final.png" });
    banco.nos.push({ id: uuid(777), parent_id: r.registro.pastas_criadas[0], kind: "file", name: "novo.png", sort_index: 0 });
    const d = await desfazerOrganizacao(banco, r.registro);
    expect(d.restaurados).toBe(0);
    expect(d.pulados[0].motivo).toContain("mexido depois");
    expect(d.pastas_mantidas).toBe(1);
    expect(banco.apagados).toEqual([]);
  });

  it("trava: arquivo em Arquivados, na pasta de recebimento ou de outro cliente não se move", async () => {
    const arq = uuid(801);
    const inbox = uuid(802);
    const banco = new BancoFalso([
      { id: arq, parent_id: null, kind: "folder", name: "Arquivados", sort_index: 0 },
      { id: uuid(803), parent_id: arq, kind: "file", name: "velho.png", sort_index: 0 },
      { id: inbox, parent_id: null, kind: "folder", name: "Recebidos", sort_index: 0, inbox_token: "t" },
      { id: uuid(804), parent_id: inbox, kind: "file", name: "cliente.png", sort_index: 0 },
    ]);
    const r = await aplicarOrganizacao(banco, "c", null, [{ caminho: ["Posts"], itens: [{ id: uuid(803), nome: "x" }, { id: uuid(804), nome: "y" }, { id: uuid(805), nome: "z" }] }]);
    expect(r.movidos).toBe(0);
    expect(r.falhas.map((f) => f.motivo)).toEqual([
      "está em Arquivados",
      "está na pasta que recebe arquivos do cliente",
      "o arquivo não está mais no workspace deste cliente",
    ]);
  });

  it("nome confirmado sem extensão ganha a extensão original; nome repetido na pasta ganha número", async () => {
    expect(comExtensao("Capa", "IMG_1.PNG")).toBe("Capa.png");
    expect(comExtensao("Capa.jpg", "IMG_1.png")).toBe("Capa.png");
    const a = cand("IMG_20.png", { tipo: "post" });
    const pasta = uuid(900);
    const banco = new BancoFalso([
      { id: pasta, parent_id: null, kind: "folder", name: "Posts", sort_index: 0 },
      { id: uuid(901), parent_id: pasta, kind: "file", name: "Natal.png", sort_index: 0 },
      { id: a.id, parent_id: null, kind: "file", name: a.nome, sort_index: 0 },
    ]);
    await aplicarOrganizacao(banco, "c", null, [{ caminho: ["Posts"], itens: [{ id: a.id, nome: "Natal" }] }]);
    expect(banco.nos.find((n) => n.id === a.id)!.name).toBe("Natal (2).png");
  });

  it("nome da pessoa fica; nome de câmera e print é genérico", () => {
    expect(nomeGenerico("IMG_20240912_101010.jpg")).toBe(true);
    expect(nomeGenerico("WhatsApp Image 2026-09-01 at 10.22.11.jpeg")).toBe(true);
    expect(nomeGenerico("Captura de tela 2026-09-01 101010.png")).toBe(true);
    expect(nomeGenerico("Design sem nome (3).png")).toBe(true);
    expect(nomeGenerico("Logo principal.png")).toBe(false);
    expect(nomeGenerico("Promo outubro.png")).toBe(false);
  });
});
