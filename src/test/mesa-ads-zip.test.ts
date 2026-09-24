// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), storage: { from: vi.fn() }, functions: { invoke: vi.fn() } } }));

import {
  copiesEmCsv,
  copiesEmMd,
  estrategiaEmMd,
  gerarZipDoGestor,
  imagensDoTrabalho,
  leiaMe,
  montarItens,
  semTravessao,
  type DadosDoZip,
} from "@/components/mesa-ads/zipDoGestor";
import { briefingVazio, type CriativoAds, type PlanoAds } from "@/components/mesa-ads/adsApi";

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");

function plano(): PlanoAds {
  return {
    id: "p1",
    client_id: "c1",
    briefing_id: "b1",
    nome: "Teste de setembro",
    status: "aprovado",
    angulos: [
      {
        id: "a1",
        nome: "Dor da conta alta",
        hipotese: "Quem vê a conta alta para de rolar",
        mecanismo: "Conta real na mão",
        prova: "Depoimento autorizado",
        metrica: "Custo por conversa",
        janela_dias: 7,
        pontuacao: 8.4,
        aprovado: true,
        motivos: ["Claro e seguro"],
        jev: { clareza: 8, relevancia: 9, risco_politica: 9, parada: 7, diferenciacao: 7 },
      },
    ],
    estrutura: {
      objetivo: "mensagens",
      oferta_id: "o1",
      conjuntos: [{ nome: "Público aberto", angulo_ids: ["a1"], verba_diaria_brl: null, observacao: "Deixe o criativo filtrar" }],
      verba_diaria_total_brl: null,
      janela_dias: 7,
      observacoes: "",
      lacunas: ["Preço não confirmado"],
      descartados: [{ id: "d1", nome: "Antes e depois", motivos: ["Antes e depois fere a política"] }],
      qualidade: { rodadas: 1, aprovados: 1, reprovados: 1 },
      resumo: "Teste de dois caminhos",
    },
    pedido: null,
    conversa_id: null,
    custo_usd: 0.1,
    criado_em: "2026-09-20T10:00:00Z",
    atualizado_em: "2026-09-20T10:00:00Z",
  };
}

function criativo(id: string, extra: Partial<CriativoAds> = {}): CriativoAds {
  return {
    id,
    client_id: "c1",
    plano_id: "p1",
    angulo_id: "a1",
    trabalho_id: `t-${id}`,
    nome: null,
    formato: "feed_4x5",
    copy: {
      texto_principal: "Sua conta de luz veio alta? A gente mostra onde está o gasto.",
      titulo: "Descubra o gasto escondido",
      descricao: "Orçamento sem custo",
      cta_meta: "SEND_WHATSAPP_MESSAGE",
      pacote: {
        textos_principais: [
          { estilo: "curto", texto: "Conta alta? Fale com a gente." },
          { estilo: "longo", texto: "Texto longo — com travessão que precisa sair." },
        ],
        titulos: ["Descubra o gasto escondido", "Conta menor já"],
        descricoes: ["Sem custo"],
        ctas: [{ cta: "SEND_WHATSAPP_MESSAGE", porque: "Conversa direta" }],
        ganchos: ["Sua conta subiu de novo?"],
        gestor: {
          objetivo_meta: "Engajamento com Apps de mensagem",
          evento_otimizacao: "Conversas iniciadas",
          publico_sugerido: "Aberto, Curitiba",
          regras_de_corte: "Pausar com 2x o custo tolerável sem conversa",
          regras_de_escala: "Subir 20% a cada 3 dias",
        },
      },
    },
    status: "pronto",
    ad_id: null,
    evidencia: "E0",
    criado_em: "2026-09-20T11:00:00Z",
    atualizado_em: "2026-09-20T11:00:00Z",
    ...extra,
  };
}

function dados(extra: Partial<DadosDoZip> = {}): DadosDoZip {
  const b = briefingVazio();
  b.oferta.produto = "Energia solar";
  b.destino.tipo = "whatsapp";
  b.destino.url = "https://wa.me/5541999999999";
  b.objetivo.acao = "mensagens";
  b.objetivo.custo_toleravel_brl = "15";
  return {
    cliente: "Solar Curitiba",
    geradoEm: "2026-09-24T09:30",
    briefing: b,
    ofertas: [
      {
        id: "o1",
        nome: "Diagnóstico da conta",
        para_quem: "Casas com conta acima de R$ 300",
        promessa: "Mostrar onde está o gasto",
        mecanismo: "Leitura da conta",
        entregaveis: ["Relatório"],
        bonus: [],
        garantia: null,
        urgencia_real: null,
        ancoragem: null,
        cta: "Chamar no WhatsApp",
        provas_necessarias: ["Conta real"],
        riscos: ["Promessa de economia"],
        status: "escolhida",
        jev: { clareza: 8, forca: 7, risco_politica: 9, alerta_politica: null },
        conversa_id: null,
        criado_em: "2026-09-19T10:00:00Z",
      },
    ],
    planos: [plano()],
    criativos: [criativo("k1"), criativo("k2", { formato: "carrossel", nome: "Carrossel da conta" })],
    trabalhos: [
      {
        id: "t-k1",
        status: "entregue",
        cards: [{ ordem: 1, versao: 3, storage_path: "c1/estudio/k1-v3.png" }],
        direcao: { cards: [{ ordem: 1 }], entrega_ads: { arquivos: [{ ordem: 1, versao: 3, storage_path: "c1/g/v1/1-final.png" }] } },
      },
      {
        id: "t-k2",
        status: "pronto",
        cards: [
          { ordem: 1, versao: 1, storage_path: "c1/estudio/k2-1-v1.png" },
          { ordem: 1, versao: 2, storage_path: "c1/estudio/k2-1-v2.jpg" },
          { ordem: 2, versao: 1, storage_path: "c1/estudio/k2-2-v1.png" },
        ],
        direcao: { cards: [{ ordem: 1 }, { ordem: 2 }] },
      },
    ] as DadosDoZip["trabalhos"],
    ...extra,
  };
}

describe("arte de cada criativo", () => {
  it("entregue em Arquivos vale mais; sem entrega, a versão mais recente de cada lâmina", () => {
    const d = dados();
    expect(imagensDoTrabalho(d.trabalhos[0])).toEqual({ fonte: "entregue", refs: [{ bucket: "files", caminho: "c1/g/v1/1-final.png", ordem: 1 }] });
    const estudio = imagensDoTrabalho(d.trabalhos[1]);
    expect(estudio.fonte).toBe("estudio");
    expect(estudio.refs.map((r) => r.caminho)).toEqual(["c1/estudio/k2-1-v2.jpg", "c1/estudio/k2-2-v1.png"]);
    expect(imagensDoTrabalho(null).fonte).toBe("sem_arte");
  });

  it("os nomes dos arquivos casam com o nome do anúncio e com o CSV", () => {
    const itens = montarItens(dados());
    expect(itens[0].nomeDoAnuncio).toBe("01-dor-da-conta-alta-4x5");
    expect(itens[0].imagens.map((i) => i.arquivo)).toEqual(["criativos/01-dor-da-conta-alta-4x5.png"]);
    expect(itens[1].imagens.map((i) => i.arquivo)).toEqual([
      "criativos/02-carrossel-da-conta-carrossel-1de2.jpg",
      "criativos/02-carrossel-da-conta-carrossel-2de2.png",
    ]);
    const csv = copiesEmCsv(itens);
    itens.forEach((it) => it.imagens.forEach((i) => expect(csv).toContain(i.arquivo)));
  });
});

describe("copies.csv abre certo no Excel", () => {
  it("BOM, ponto e vírgula, CRLF e uma linha por criativo", () => {
    const csv = copiesEmCsv(montarItens(dados()));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).split("\r\n").filter(Boolean);
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toBe(
      ['"numero"', '"nome_do_anuncio"', '"criativo"', '"formato"', '"arquivos"', '"texto_principal"', '"texto_longo"', '"titulos"', '"descricoes"', '"cta"', '"ganchos"', '"destino"', '"utm"', '"angulo"', '"plano"'].join(";"),
    );
    expect(linhas[1]).toContain('"Enviar mensagem pelo WhatsApp (SEND_WHATSAPP_MESSAGE)"');
    expect(linhas[1]).toContain('"Descubra o gasto escondido | Conta menor já"');
  });

  it("aspas dobradas e nenhum travessão", () => {
    const d = dados();
    d.criativos[0].copy.texto_principal = 'Diga "sim" — agora';
    const csv = copiesEmCsv(montarItens(d));
    expect(csv).toContain('"Diga ""sim"", agora"');
    expect(csv).not.toMatch(/[–—]/);
  });
});

describe("LEIA-ME e estratégia", () => {
  it("passo a passo com objetivo, evento, conjuntos, anúncios, UTM e regras de corte e escala", () => {
    const d = dados();
    const itens = montarItens(d);
    const t = leiaMe(d, itens);
    expect(t).toContain("Objetivo da campanha: Engajamento com Apps de mensagem");
    expect(t).toContain("Evento de otimização: Conversas iniciadas");
    expect(t).toContain("Conjunto 1: Público aberto");
    expect(t).toContain("01-dor-da-conta-alta-4x5");
    expect(t).toContain("Quando cortar: Pausar com 2x o custo tolerável sem conversa");
    expect(t).toContain("Quando escalar: Subir 20% a cada 3 dias");
    expect(t).toContain("Público sugerido");
    // Destino WhatsApp: UTM não se aplica, e isso é dito.
    expect(t).toContain("Não se aplica ao destino WhatsApp");
    expect(t).not.toMatch(/[–—]/);
  });

  it("orçamento só se houver: sem verba, manda combinar em vez de inventar", () => {
    const d = dados();
    expect(leiaMe(d, montarItens(d))).toContain("não tem verba definida");
    d.briefing!.objetivo.verba_diaria_brl = "50";
    expect(leiaMe(d, montarItens(d))).toContain("R$ 50,00 por dia (do briefing)");
  });

  it("destino em página ganha a UTM padrão com o nome do anúncio", () => {
    const d = dados();
    d.briefing!.destino.tipo = "pagina";
    d.briefing!.destino.url = "https://exemplo.com.br";
    const itens = montarItens(d);
    expect(itens[0].utm).toBe("utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content=01-dor-da-conta-alta-4x5");
  });

  it("estratégia traz briefing, oferta, porquê de cada ângulo, notas do Jev, descartados e lacunas", () => {
    const d = dados();
    const t = estrategiaEmMd(d, montarItens(d));
    expect(t).toContain("Produto ou serviço: Energia solar");
    expect(t).toContain("### Diagnóstico da conta");
    expect(t).toContain("Por que este ângulo (hipótese): Quem vê a conta alta para de rolar");
    expect(t).toContain("Notas do Jev (0 a 10): clareza 8, relevância 9");
    expect(t).toContain("Antes e depois: Antes e depois fere a política");
    expect(t).toContain("- Preço não confirmado");
    expect(t).toContain("Conjunto 1: Público aberto");
    expect(t).not.toMatch(/[–—]/);
  });

  it("copies.md tem todas as variações e sai sem travessão", () => {
    const d = dados();
    const t = copiesEmMd(d, montarItens(d));
    expect(t).toContain("Texto longo, com travessão que precisa sair.");
    expect(t).toContain("Sua conta subiu de novo?");
    expect(t).not.toMatch(/[–—]/);
  });

  it("semTravessao troca o travessão entre espaços por vírgula e o colado por hífen", () => {
    expect(semTravessao("a — b")).toBe("a, b");
    expect(semTravessao("10–20")).toBe("10-20");
  });
});

describe("o .zip inteiro", () => {
  it("tem LEIA-ME, estratégia, copies e as artes com os nomes do CSV; mostra o progresso", async () => {
    const d = dados();
    const baixar = vi.fn(async (_bucket: string, caminho: string) => new TextEncoder().encode(`img:${caminho}`).buffer as ArrayBuffer);
    const passos: string[] = [];
    const r = await gerarZipDoGestor(d, { baixar, aoProgredir: (p) => passos.push(`${p.etapa}:${p.feitas}/${p.total}`) });
    expect(baixar).toHaveBeenCalledWith("files", "c1/g/v1/1-final.png");
    expect(baixar).toHaveBeenCalledWith("mesa", "c1/estudio/k2-1-v2.jpg");
    expect(r.imagens).toBe(3);
    expect(r.faltando).toEqual([]);
    expect(r.nome).toBe("pacote-gestor-solar-curitiba-teste-de-setembro-2026-09-24.zip");
    expect(passos[0]).toBe("imagens:0/3");
    expect(passos).toContain("imagens:3/3");
    expect(passos[passos.length - 1]).toBe("pronto:3/3");

    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());
    const nomes = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(nomes).toEqual([
      "LEIA-ME.md",
      "copies.csv",
      "copies.md",
      "criativos/01-dor-da-conta-alta-4x5.png",
      "criativos/02-carrossel-da-conta-carrossel-1de2.jpg",
      "criativos/02-carrossel-da-conta-carrossel-2de2.png",
      "estrategia.md",
    ]);
    expect(await zip.file("criativos/02-carrossel-da-conta-carrossel-1de2.jpg")!.async("string")).toBe("img:c1/estudio/k2-1-v2.jpg");
  });

  it("um criativo só funciona, e imagem que não baixa vira aviso no LEIA-ME", async () => {
    const d = dados();
    d.criativos = [d.criativos[1]];
    const r = await gerarZipDoGestor(d, {
      baixar: async (_b, caminho) => {
        if (caminho.indexOf("k2-2") >= 0) throw new Error("403");
        return new Uint8Array([1, 2, 3]).buffer as ArrayBuffer;
      },
    });
    expect(r.faltando).toEqual(["criativos/01-carrossel-da-conta-carrossel-2de2.png"]);
    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());
    const leia = await zip.file("LEIA-ME.md")!.async("string");
    expect(leia).toContain("Imagens que não baixaram");
    expect(leia).toContain("criativos/01-carrossel-da-conta-carrossel-2de2.png");
  });
});

describe("a tela oferece o zip ao lado do envio ao gestor", () => {
  const tela = ler("src/components/mesa-ads/PacoteDaCopy.tsx");
  const zip = ler("src/components/mesa-ads/zipDoGestor.ts");

  it("o botão existe, mostra custo zero e progresso, e mantém criar tarefa", () => {
    expect(tela).toContain("Baixar pacote completo (.zip)");
    expect(tela).toContain('"sem custo"');
    expect(tela).toContain("textoDoProgresso(progresso)");
    expect(tela).toContain("<BaixarZipDoGestor corpo={corpo}");
    expect(tela).toContain("criar tarefa para o gestor");
  });

  it("jszip fica sob demanda e o arquivo respeita Safari 11 e Chrome 64", () => {
    expect(zip).toContain('await import("jszip")');
    expect(zip).not.toMatch(/^import .*jszip/m);
    expect(zip).not.toMatch(/\(\?<[=!]/); // lookbehind
    expect(zip).not.toMatch(/\(\?<[a-zA-Z]/); // grupo nomeado
    expect(zip).not.toMatch(/\\p\{/);
    expect(zip).not.toMatch(/\.at\(/);
    expect(zip).not.toContain("Object.hasOwn");
    expect(zip).not.toContain("replaceAll(");
  });
});
