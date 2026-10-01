import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement as h, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * IDV3 (30/09): "Completar marca existente" na Mesa Identidade. Pedido do
 * dono: "criar o material completo usando tudo para marcas existentes que só
 * têm logo e nome, e deixar completa e profissional". Adendo: o vídeo da
 * marca sai na Mesa Motion no fim da identidade.
 *
 * Testa o plano (custo antes, só o que falta), a leitura das cores por
 * código, as versões feitas por código (e as que vão para o designer), o
 * checklist de completude, o pacote (índice), a rodada (andamento, Parar e
 * Desfazer), o vídeo da marca e a tela com a janela central.
 */

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];

vi.mock("@/integrations/supabase/client", () => {
  const resposta = { data: [], error: null };
  const q: any = new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok) : () => q),
    apply: () => q,
  });
  const bucket = { createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: null }), download: async () => ({ data: null, error: new Error("sem arquivo") }), upload: async () => ({ data: null, error: null }) };
  return { supabase: { from: () => q, rpc: () => q, storage: { from: () => bucket }, auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) } } };
});

let projetoNoBanco: any = null;
const chamadas: Array<{ f: string; corpo: Record<string, unknown> }> = [];
const chamar = vi.fn(async (f: string, corpo: Record<string, unknown>) => {
  chamadas.push({ f, corpo });
  if (f === "mesa-identidade" && corpo.acao === "projeto_salvar") {
    const parte = String(corpo.parte);
    const antes = projetoNoBanco.dados[parte] && typeof projetoNoBanco.dados[parte] === "object" && !Array.isArray(projetoNoBanco.dados[parte]) ? projetoNoBanco.dados[parte] : {};
    const valor = corpo.valor as Record<string, unknown>;
    projetoNoBanco = { ...projetoNoBanco, versao: projetoNoBanco.versao + 1, dados: { ...projetoNoBanco.dados, [parte]: corpo.substituir ? valor : { ...antes, ...valor } } };
    return { projeto: projetoNoBanco };
  }
  if (f === "mesa-identidade" && corpo.acao === "completar_registrar") return { projeto: projetoNoBanco };
  if (f === "mesa-motion" && corpo.acao === "filme_criar") return { filme: { id: `f-${String(corpo.tipo)}` } };
  if (f === "mesa-motion") return { filme: {} };
  if (f === "mesa-identidade" && corpo.acao === "video_registrar") {
    projetoNoBanco = { ...projetoNoBanco, versao: projetoNoBanco.versao + 1, dados: { ...projetoNoBanco.dados, videos: (projetoNoBanco.dados.videos || []).concat([{ filme_id: corpo.filme_id, tipo: "apresentacao", nome: "Apresentação" }]) } };
    return { projeto: projetoNoBanco };
  }
  return {};
});
vi.mock("@/lib/mesa/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/mesa/api")>("@/lib/mesa/api");
  return { ...real, chamarFuncao: (f: string, c: Record<string, unknown>) => chamar(f, c) };
});
vi.mock("@/components/mesa/kitDaMesa", () => ({ useKitDaMarca: () => ({ kit: null, marca: null, isLoading: false }) }));

import {
  analisarLogo,
  coresDoConteudo,
  fundoDaImagem,
  mascaraDoConteudo,
  normalizarLeituraPorVisao,
  recolorir,
  recortar,
  semFundo,
  svgDoPadraoDoSimbolo,
  svgMonocromatico,
  versoesPossiveis,
  type ImagemRGBA,
} from "../../supabase/functions/mesa-identidade/modulos/leitura-da-logo";
import {
  camposDoBriefing,
  checklistDaMarca,
  ehPasso,
  juntarPerguntas,
  manifestoDoPacote,
  normalizarExecucao,
  novaExecucao,
  paletaCompleta,
  PASSOS_DO_COMPLETAR,
  planoDeCompletar,
  proximoPasso,
  resumoDoChecklist,
  STORYBOARDS_DO_MOTION,
  tipografiaCompleta,
  totalDoPlano,
} from "../../supabase/functions/mesa-identidade/modulos/completar-marca";
import { brandDaEstrategia, caminhoDaIdentidade, cenasDaApresentacao, entrevistaDaEstrategia, insumosDaIdentidade, kitDaIdentidade } from "../../supabase/functions/mesa-motion/modulos/motion-da-identidade";
import { etapasDoProjeto, podeAbrir, precisaDeNaming, ROTULO_DO_MODO } from "../../supabase/functions/mesa-identidade/modulos/identidade-etapas";
import { roteiroDaApresentacao } from "../../supabase/functions/mesa-identidade/modulos/apresentacao-da-marca";
import { TAMANHOS_DO_MOTION } from "../../supabase/functions/_shared/motion-metodo";
import { luminanciaRelativa } from "../../supabase/functions/_shared/cores-da-marca";
import { regrasDoDiretor, normalizarAcoesDoDiretor, alvosDoDiretor, OPERACOES_COM_IA } from "../../supabase/functions/mesa-identidade/acoes-do-diretor";
import { andamentoDoFilme, videosProntos } from "@/components/mesa-identidade/videosDaMarca";
import { desfazerPasso, Rodada, rodarExecucao, criarVideosDaMarca } from "@/components/mesa-identidade/rodadaDoCompletar";
import { MesaProvider } from "@/components/mesa/MesaContexto";
import { ProjetoProvider, type ProjetoDaMesa } from "@/components/mesa-identidade/Comuns";
import CompletarMarca from "@/components/mesa-identidade/CompletarMarca";

const C = "11111111-1111-4111-8111-111111111111";
const P = "33333333-3333-4333-8333-333333333333";
const LOGO = { caminho: `${C}/marca/identidade/${P}/logos/principal-1.png`, mime: "image/png", rotulo: "", previa_png: `${C}/marca/identidade/${P}/logos/principal-1-previa.png`, largura: 800, altura: 300 };

/** Imagem sintética: fundo (transparente ou cor) e retângulos pintados. */
function imagem(w: number, hgt: number, fundo: [number, number, number, number], blocos: Array<{ x: number; y: number; w: number; h: number; cor: [number, number, number] }>): ImagemRGBA {
  const data = new Uint8ClampedArray(w * hgt * 4);
  for (let i = 0; i < w * hgt; i++) {
    data[i * 4] = fundo[0];
    data[i * 4 + 1] = fundo[1];
    data[i * 4 + 2] = fundo[2];
    data[i * 4 + 3] = fundo[3];
  }
  for (const b of blocos) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const i = (y * w + x) * 4;
        data[i] = b.cor[0];
        data[i + 1] = b.cor[1];
        data[i + 2] = b.cor[2];
        data[i + 3] = 255;
      }
    }
  }
  return { data, largura: w, altura: hgt };
}

const VERDE: [number, number, number] = [21, 115, 48];
const LARANJA: [number, number, number] = [240, 120, 20];

/** Logo horizontal: símbolo quadrado à esquerda, vão largo e 5 "letras" com vãos curtos. */
function logoHorizontal(fundo: [number, number, number, number] = [0, 0, 0, 0]) {
  const blocos = [{ x: 10, y: 10, w: 60, h: 60, cor: LARANJA }];
  for (let i = 0; i < 5; i++) blocos.push({ x: 100 + i * 34, y: 25, w: 26, h: 35, cor: VERDE });
  return imagem(300, 80, fundo, blocos);
}

describe("IDV3: modo e etapas da marca existente", () => {
  it("modo completar: sem Pesquisa, Naming e Conceito; rótulo próprio", () => {
    const p = { modo: "completar" as const, com_naming: true, concluidas: ["inicio"] };
    const etapas = etapasDoProjeto(p);
    expect(etapas).not.toContain("pesquisa");
    expect(etapas).not.toContain("naming");
    expect(etapas).not.toContain("conceito");
    expect(etapas).toContain("estrategia");
    expect(etapas[etapas.length - 1]).toBe("entrega");
    expect(precisaDeNaming(p)).toBe(false);
    expect(podeAbrir(p, "naming").motivo).toMatch(/já tem nome e logo/);
    expect(ROTULO_DO_MODO.completar).toBe("Completar marca existente");
  });

  it("apresentação da marca existente: o conceito é o significado da logo (sem caminhos)", () => {
    const dados = { sistema: { significado_do_logo: "O círculo é o forno." } };
    const conceito = roteiroDaApresentacao(dados, { comNaming: false, semCaminhos: true }).filter((s) => s.id === "conceito")[0];
    expect(conceito.falta).toEqual([]);
    const comCaminho = roteiroDaApresentacao(dados, { comNaming: false }).filter((s) => s.id === "conceito")[0];
    expect(comCaminho.falta.length).toBe(1);
  });
});

describe("IDV3: leitura das cores por código", () => {
  it("fundo transparente: cores do conteúdo com a parte de cada uma, sem franja", () => {
    const a = analisarLogo(logoHorizontal());
    expect(a.fundo).toBe("transparente");
    expect(a.cores.map((c) => c.hex)).toEqual(expect.arrayContaining(["#157330", "#F07814"]));
    const verde = a.cores.filter((c) => c.hex === "#157330")[0];
    expect(verde.parte).toBeGreaterThan(0.5);
    expect(a.orientacao).toBe("horizontal");
    expect(a.caixa).toEqual({ x: 10, y: 10, w: 252, h: 60 });
  });

  it("fundo branco sólido: o branco sai das cores e o fundo é lido como claro", () => {
    const img = logoHorizontal([255, 255, 255, 255]);
    const f = fundoDaImagem(img);
    expect(f.fundo).toBe("claro");
    const m = mascaraDoConteudo(img, f.fundo, f.cor);
    const cores = coresDoConteudo(img, m);
    expect(cores.map((c) => c.hex)).not.toContain("#FFFFFF");
    expect(cores.length).toBe(2);
  });

  it("fundo misto (degradê): nada de recorte por código", () => {
    const w = 60;
    const hgt = 40;
    const data = new Uint8ClampedArray(w * hgt * 4);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x * 4;
      data[i + 1] = y * 6;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    expect(fundoDaImagem({ data, largura: w, altura: hgt }).fundo).toBe("misto");
  });

  it("símbolo separável: bloco à esquerda com vão bem maior que o das letras", () => {
    const a = analisarLogo(logoHorizontal());
    expect(a.simbolo.separavel).toBe(true);
    expect(a.simbolo.lado).toBe("esquerda");
    expect(a.simbolo.caixa).toEqual({ x: 10, y: 10, w: 60, h: 60 });
  });

  it("logo só com o nome (vãos iguais): o símbolo não se separa", () => {
    const blocos = [];
    for (let i = 0; i < 6; i++) blocos.push({ x: 10 + i * 34, y: 20, w: 26, h: 35, cor: VERDE });
    const a = analisarLogo(imagem(230, 70, [0, 0, 0, 0], blocos));
    expect(a.simbolo.separavel).toBe(false);
  });
});

describe("IDV3: versões por código e as que precisam de designer", () => {
  it("PNG transparente horizontal com símbolo: mono, negativa e símbolo por código; vertical e vetor para o designer", () => {
    const a = analisarLogo(logoHorizontal());
    const v = versoesPossiveis(a, "image/png");
    expect(v.porCodigo).toEqual(["monocromatica", "negativa", "simbolo"]);
    expect(v.designer.map((d) => d.versao)).toEqual(expect.arrayContaining(["vertical", "vetor"]));
    expect(v.porCodigo).not.toContain("vertical");
  });

  it("fundo sólido ganha a versão sem fundo; SVG não pede vetor", () => {
    const a = analisarLogo(logoHorizontal([255, 255, 255, 255]));
    const v = versoesPossiveis(a, "image/svg+xml");
    expect(v.porCodigo[0]).toBe("sem_fundo");
    expect(v.designer.map((d) => d.versao)).not.toContain("vetor");
  });

  it("fundo misto: tudo para o designer (nada é recortado por palpite)", () => {
    const v = versoesPossiveis({ fundo: "misto", orientacao: "horizontal", simbolo: { separavel: true, caixa: { x: 0, y: 0, w: 10, h: 10 }, lado: "esquerda" }, caixa: { x: 0, y: 0, w: 100, h: 30 } }, "image/png");
    expect(v.porCodigo).toEqual([]);
    expect(v.designer.map((d) => d.versao)).toEqual(expect.arrayContaining(["sem_fundo", "monocromatica", "negativa", "simbolo"]));
  });

  it("recolorir: a forma fica, a cor vira uma só e o fundo some", () => {
    const img = logoHorizontal([255, 255, 255, 255]);
    const a = analisarLogo(img);
    const mono = recolorir(img, a, "#111111");
    const dentro = (15 * 300 + 15) * 4; // pixel do símbolo
    const fora = (2 * 300 + 2) * 4; // pixel do fundo
    expect([mono[dentro], mono[dentro + 1], mono[dentro + 2], mono[dentro + 3]]).toEqual([17, 17, 17, 255]);
    expect(mono[fora + 3]).toBe(0);
    const negativa = recolorir(img, a, "#FFFFFF");
    expect([negativa[dentro], negativa[dentro + 3]]).toEqual([255, 255]);
  });

  it("sem fundo: as cores da logo ficam; o branco vira transparente", () => {
    const img = logoHorizontal([255, 255, 255, 255]);
    const s = semFundo(img, analisarLogo(img));
    const dentro = (15 * 300 + 15) * 4;
    expect([s[dentro], s[dentro + 1], s[dentro + 2], s[dentro + 3]]).toEqual([240, 120, 20, 255]);
    expect(s[3]).toBe(0);
  });

  it("recorte do símbolo com margem, sem o fundo", () => {
    const img = logoHorizontal([255, 255, 255, 255]);
    const a = analisarLogo(img);
    const c = recortar(img, a, a.simbolo.caixa!);
    expect(c.largura).toBe(60 + 2 * 5);
    expect(c.altura).toBe(60 + 2 * 5);
    expect(c.data[3]).toBe(0);
  });

  it("SVG em uma cor: troca fill e stroke, mantém none, tira o fundo e põe o fill na raiz; imagem embutida não", () => {
    const svg = '<svg viewBox="0 0 100 40"><rect x="0" y="0" width="100" height="40" fill="#ffffff"/><path d="M0 0" fill="#157330" stroke="none"/><circle style="fill:rgb(240,120,20);stroke:#000" r="4"/><g><path d="M1 1"/></g></svg>';
    const mono = svgMonocromatico(svg, "#111111")!;
    expect(mono).not.toMatch(/#ffffff/i);
    expect(mono).toContain('fill="#111111"');
    expect(mono).toContain('stroke="none"');
    expect(mono).toContain("fill:#111111");
    expect(mono).toMatch(/<svg[^>]*fill="#111111"/);
    expect(svgMonocromatico('<svg><image href="x.png"/></svg>', "#111111")).toBeNull();
  });

  it("padrão com o símbolo: a imagem recortada repetida, com transparência", () => {
    const s = svgDoPadraoDoSimbolo({ href: "data:image/png;base64,AAA", proporcao: 1, fundo: "#F4F6F4", opacidade: 0.2 });
    expect(s).toContain("<pattern");
    expect(s).toContain('opacity="0.2"');
    expect(s).toContain("#F4F6F4");
  });
});

describe("IDV3: leitura por visão (só descreve; fonte é sugestão)", () => {
  it("famílias conferidas no catálogo; nome inventado vira aviso; formas filtradas", () => {
    const l = normalizarLeituraPorVisao({ tipo_de_logo: "simbolo_e_nome", forma: "círculo e cantos retos", estilo: "moderno", personalidade_visual: ["firme"], formas_para_grafismo: ["circulos", "estrela", "grade"], fonte: { tem_texto: true, descricao: "sem serifa geométrica", categoria: "sem_serifa", parecidas: ["montserrat", "Fonte Inventada", "Montserrat"] }, avisos: [], perguntas: ["Qual é a fonte original?"] }, "m1");
    expect(l.fonte.parecidas).toEqual([{ familia: "Montserrat", conferida: true }, { familia: "Fonte Inventada", conferida: false }]);
    expect(l.avisos.join(" ")).toMatch(/fora do catálogo/);
    expect(l.formas_para_grafismo).toEqual(["circulos", "grade"]);
    expect(l.perguntas).toEqual(["Qual é a fonte original?"]);
  });

  it("logo sem texto: nenhuma fonte sugerida", () => {
    const l = normalizarLeituraPorVisao({ fonte: { tem_texto: false, parecidas: ["Inter"] } }, null);
    expect(l.fonte.parecidas).toEqual([]);
  });
});

describe("IDV3: paleta e tipografia por regra", () => {
  it("paleta completa: primária da logo, apoio da mesma cor, neutras e contraste", () => {
    const p = paletaCompleta({ daLogo: [{ hex: "#157330", parte: 0.8 }, { hex: "#F07814", parte: 0.2 }] });
    expect(p.cores[0]).toMatchObject({ papel: "primaria", hex: "#157330" });
    expect(p.cores.some((c) => c.hex === "#F07814")).toBe(true);
    expect(p.cores.some((c) => c.papel === "neutra")).toBe(true);
    expect(p.cores.length).toBeGreaterThanOrEqual(4);
    expect(p.cores.some((c) => luminanciaRelativa(c.hex) < 0.05)).toBe(true);
    expect(p.cores.some((c) => luminanciaRelativa(c.hex) > 0.8)).toBe(true);
    expect(p.perguntas).toEqual([]);
    expect(p.fontes).toEqual(["pixels da logo"]);
  });

  it("logo só preta: vira pergunta, nenhuma cor inventada", () => {
    const p = paletaCompleta({ daLogo: [{ hex: "#111111", parte: 1 }] });
    expect(p.perguntas.join(" ")).toMatch(/preto e branco/);
    expect(p.cores.every((c) => c.papel === "primaria" || c.papel === "neutra")).toBe(true);
  });

  it("o kit vale antes da logo (cor parecida não repete)", () => {
    const p = paletaCompleta({ doKit: [{ nome: "Verde Forno", papel: "primaria", hex: "#167431" }], daLogo: [{ hex: "#157330", parte: 1 }] });
    expect(p.cores[0]).toMatchObject({ nome: "Verde Forno", hex: "#167431" });
    expect(p.cores.filter((c) => c.hex === "#157330").length).toBe(0);
  });

  it("tipografia: a parecida da leitura, com o aviso de que é sugestão; sem base, pergunta e par da personalidade", () => {
    const leitura = normalizarLeituraPorVisao({ fonte: { tem_texto: true, categoria: "sem_serifa", parecidas: ["Montserrat"] } }, "m");
    const t = tipografiaCompleta({ leitura });
    expect(t.tipografia[0]).toMatchObject({ familia: "Montserrat", uso: "titulo" });
    expect(t.tipografia[1].uso).toBe("texto");
    expect(t.avisos[0]).toMatch(/sugestão/);
    const sem = tipografiaCompleta({ leitura: null, estrategia: { arquetipo: { principal: "sabio" } } });
    expect(sem.perguntas[0]).toMatch(/fonte/);
    expect(sem.tipografia.length).toBe(2);
    const doKit = tipografiaCompleta({ doKit: { titulo: "Fraunces", texto: "Work Sans" }, leitura });
    expect(doKit.tipografia.map((x) => x.familia)).toEqual(["Fraunces", "Work Sans"]);
  });
});

describe("IDV3: o plano (custo antes, só o que falta)", () => {
  const estado = { temLogo: true, modo: "completar", comNaming: false };

  it("projeto novo com logo: todos os passos rodam, na ordem; o preço sai do modelo", () => {
    const plano = planoDeCompletar({ sistema: { logos: { principal: LOGO } } }, estado, {});
    expect(plano.map((p) => p.id)).toEqual(PASSOS_DO_COMPLETAR.map((p) => p.id));
    expect(plano.filter((p) => !p.roda).map((p) => p.id)).toEqual([]);
    const total = totalDoPlano(plano, (c) => (c.entrada + c.saida) / 1_000_000);
    expect(total.total).toBeGreaterThan(0);
    expect(total.semPreco).toBe(0);
    expect(plano.filter((p) => p.id === "leitura")[0].custos[0].papel).toBe("visao");
    expect(plano.filter((p) => p.id === "paleta")[0].custos).toEqual([]);
  });

  it("sem logo: só Briefing e Estratégia; o resto diz o motivo", () => {
    const plano = planoDeCompletar({}, { ...estado, temLogo: false }, {});
    expect(plano.filter((p) => p.roda).map((p) => p.id)).toEqual(["briefing", "estrategia"]);
    expect(plano.filter((p) => p.id === "paleta")[0].motivo).toMatch(/logo/);
  });

  it("o que já está feito fica fora (e volta com Refazer); escolher um passo roda só ele", () => {
    const dados = { sistema: { logos: { principal: LOGO }, cores: [1, 2, 3, 4].map((i) => ({ nome: `c${i}`, papel: "secundaria", hex: `#1${i}7330` })) } };
    expect(planoDeCompletar(dados, estado, {}).filter((p) => p.id === "paleta")[0].motivo).toBe("Já está feito");
    expect(planoDeCompletar(dados, estado, { refazer: true }).filter((p) => p.id === "paleta")[0].roda).toBe(true);
    const so = planoDeCompletar(dados, estado, { passos: ["grafismos"] });
    expect(so.filter((p) => p.roda).map((p) => p.id)).toEqual(["grafismos"]);
  });

  it("vídeo: apresentação sem IA; o filme cinematográfico cobra os storyboards (mesmos tokens do motion)", () => {
    const d = { sistema: { logos: { principal: LOGO } } };
    expect(planoDeCompletar(d, estado, { video: { apresentacao: true, filme: false } }).filter((p) => p.id === "video")[0].custos).toEqual([]);
    const comFilme = planoDeCompletar(d, estado, { video: { apresentacao: true, filme: true } }).filter((p) => p.id === "video")[0];
    expect(comFilme.custos[0].papel).toBe("motion");
    expect(STORYBOARDS_DO_MOTION).toEqual(TAMANHOS_DO_MOTION.storyboards);
  });

  it("briefing: só os campos vazios vão para o Preencher com IA", () => {
    const campos = camposDoBriefing({ briefing: { negocio: "Padaria" } });
    expect(campos.map((c) => c.chave)).not.toContain("negocio");
    expect(campos.map((c) => c.chave)).toContain("publico");
    expect(campos[0].dica).toMatch(/sem base/);
  });
});

describe("IDV3: checklist de completude", () => {
  it("marca só com logo: quase tudo falta, cada item com o passo que completa", () => {
    const itens = checklistDaMarca({ sistema: { logos: { principal: LOGO } } });
    const r = resumoDoChecklist(itens);
    expect(itens.filter((i) => i.tem).map((i) => i.id)).toEqual(["logo"]);
    expect(r.faltam).toEqual(expect.arrayContaining(["leitura", "versoes", "estrategia", "paleta", "tipografia", "grafismos", "aplicacoes", "mockups", "guideline", "video"]));
    expect(itens.filter((i) => i.id === "aprovacao")[0].passo).toBeNull();
  });

  it("marca completa: os itens viram feitos", () => {
    const dados = {
      sistema: {
        logos: { principal: LOGO, alternativas: [LOGO, LOGO], icone: [] },
        cores: [
          { nome: "Verde", papel: "primaria", hex: "#157330" },
          { nome: "Laranja", papel: "destaque", hex: "#F07814" },
          { nome: "Tinta", papel: "neutra", hex: "#111111" },
          { nome: "Papel", papel: "neutra", hex: "#F7F7F5" },
        ],
        tipografia: [{ familia: "Montserrat", uso: "titulo" }, { familia: "Inter", uso: "texto" }],
        grafismos: [{ tipo: "pattern" }, { tipo: "pattern" }],
      },
      leitura_da_logo: { cores: [{ hex: "#157330", parte: 1 }], visao: { em: "2026-09-30", estilo: "moderno" } },
      estrategia: { proposito: "Pão", arquetipo: { principal: "cuidador" }, posicionamento: { publico: "bairro", diferencial: "na hora", declaracao: "x" }, tom: { atributos: ["calorosa"], fala_assim: ["Oi"] } },
      videos: [{ filme_id: "f1", tipo: "apresentacao" }],
    };
    const itens = checklistDaMarca(dados, { brandbook: { versao: 2, enviado: true, aprovado: true } });
    const tem = (id: string) => itens.filter((i) => i.id === id)[0].tem;
    ["logo", "leitura", "versoes", "estrategia", "tom", "paleta", "tipografia", "grafismos", "brandbook", "video", "aprovacao"].forEach((id) => expect(tem(id)).toBe(true));
  });
});

describe("IDV3: o pacote e as perguntas", () => {
  it("índice do pacote: pastas, o que precisa de designer e as perguntas em aberto", () => {
    const m = manifestoDoPacote({ marca: "Forno", logos: [{ rotulo: "Principal", formato: "SVG e PNG" }, { rotulo: "Negativa (branca)", formato: "PNG" }], cores: 6, fontes: ["Montserrat (titulo)"], grafismos: 3, pecas: 8, mockups: 3, videos: ["Apresentação (9:16)"], pdf: true, paginaWeb: true, designer: [{ versao: "vertical", motivo: "redesenho" }], perguntas: ["Qual é a fonte original?"] });
    expect(m.pastas).toEqual(["logos/", "cores/", "fontes/", "grafismos/", "aplicacoes/", "mockups/", "videos/", "./"]);
    expect(m.texto).toMatch(/HEX, RGB e CMYK/);
    expect(m.texto).toMatch(/Precisa de designer/);
    expect(m.texto).toMatch(/Qual é a fonte original/);
    expect(m.texto).toMatch(/brandbook\.html/);
  });

  it("perguntas sem repetir e com o passo", () => {
    const p = juntarPerguntas([{ texto: "A", passo: "leitura" }], [{ texto: "A", passo: "leitura" }, { texto: "B", passo: "paleta" }]);
    expect(p).toEqual([{ texto: "A", passo: "leitura" }, { texto: "B", passo: "paleta" }]);
  });

  it("execução: normaliza e diz o próximo passo", () => {
    const plano = planoDeCompletar({ sistema: { logos: { principal: LOGO } } }, { temLogo: true, modo: "completar" }, { passos: ["paleta", "tipografia"] });
    const e = novaExecucao("e1", plano, {}, "mesa");
    expect(e.passos.map((p) => p.id)).toEqual(["paleta", "tipografia"]);
    expect(proximoPasso(e)).toBe("paleta");
    expect(normalizarExecucao({ ...e, passos: [{ id: "xxx" }, ...e.passos] })!.passos.length).toBe(2);
    expect(ehPasso("video")).toBe(true);
  });
});

describe("IDV3: vídeo da marca (Mesa Motion)", () => {
  const dados = {
    naming: { nome: "Forno", slogan: "Pão de verdade" },
    estrategia: { proposito: "Pão de verdade no bairro", valores: [{ nome: "Calor" }, { nome: "Ofício" }], arquetipo: { principal: "cuidador" }, personalidade: { eixos: { energia: -1 } }, tom: { atributos: ["calorosa"] }, posicionamento: { declaracao: "Para o bairro, Forno é a padaria que assa na hora." } },
    sistema: {
      logos: { principal: LOGO },
      cores: [{ nome: "Verde", papel: "primaria", hex: "#157330" }, { nome: "Laranja", papel: "destaque", hex: "#F07814" }, { nome: "Papel", papel: "neutra", hex: "#F7F7F5" }],
      tipografia: [{ familia: "Montserrat", uso: "titulo" }, { familia: "Inter", uso: "texto" }],
      grafismos: [{ tipo: "pattern", imagem: `${C}/marca/identidade/${P}/grafismos/a.png` }],
    },
    aplicacoes: { itens: [{ tipo: "Post", imagem: `${C}/marca/identidade/${P}/aplicacoes/post.png` }], assinatura: { site: "forno.com.br", instagram: "forno" } },
  };

  it("os slides viram cenas do kit, sem IA e sem número inventado", () => {
    const cenas = cenasDaApresentacao(dados, { nome: "Forno", clientId: C });
    expect(cenas.map((c) => c.peca)).toEqual(["logo_sting", "abertura", "passos", "diagrama", "abertura", "carrossel_provas", "cartao_final"]);
    expect(cenas[0].params).toEqual({ tagline: "Pão de verdade" });
    expect(cenas[3].params.ramos).toHaveLength(3);
    expect((cenas[5].params.imagens as string[])[0]).toContain("/aplicacoes/post.png");
    expect(cenas.some((c) => c.peca === "numeros" || c.peca === "depoimento")).toBe(false);
  });

  it("entrevista pela estratégia (pula a etapa) e BRAND.md por código", () => {
    const e = entrevistaDaEstrategia(dados.estrategia, dados.sistema.cores, 7);
    expect(e).toMatchObject({ objetivo: "apresentar", logo: "sting", ritmo: "calmo", clima: "calma", prova: ["sem_prova"], duracao: "30" });
    const b = brandDaEstrategia(dados.estrategia, "Pão de verdade");
    expect(b.essencia).toBe("Pão de verdade no bairro");
    expect(b.provas).toEqual([]);
  });

  it("insumos e o kit do filme: paleta, fontes e logo do projeto; caminho de fora recusado", () => {
    const ins = insumosDaIdentidade(dados, { projetoId: P, clientId: C });
    expect(ins.logo_path).toBe(LOGO.previa_png);
    const kit = kitDaIdentidade({ identidade: ins }, C)!;
    expect(kit.paleta[0].hex).toBe("#157330");
    expect(kit.fontes).toEqual([{ nome: "Montserrat", papel: "titulo" }, { nome: "Inter", papel: "texto" }]);
    expect(kitDaIdentidade({}, C)).toBeNull();
    expect(caminhoDaIdentidade(`99999999-9999-4999-8999-999999999999/marca/x.png`, C)).toBeNull();
    expect(caminhoDaIdentidade(`${C}/marca/../x.png`, C)).toBeNull();
  });

  it("andamento e vídeos prontos (link de 1 h, nome no pacote)", () => {
    const f = { id: "f1", nome: "Apresentação da marca Forno", tipo: "apresentacao", etapa: "render", formatos: ["9:16"], cenas: [{ id: "c1" }, { id: "c2" }], renders: [{ cena_id: "c1", modo: "final", formato: "9:16", estado: "pronto", saida_path: "a" }], montagem: {}, entrega: { renders: [{ formato: "9:16", saida_path: `${C}/video/x.mp4` }] }, arquivado_em: null };
    expect(andamentoDoFilme(f)).toMatchObject({ cenas: 2, comFinal: 1, montado: false, entregue: 1, faltaFinal: ["c2"] });
    expect(videosProntos(f, { [`${C}/video/x.mp4`]: "https://assinado" })).toEqual([{ formato: "9:16", url: "https://assinado", arquivo: "videos/apresentacao-da-marca-forno-9x16.mp4", titulo: "Apresentação da marca Forno (9:16)" }]);
  });
});

describe("IDV3: agente diretor de marca (completar_marca)", () => {
  it("é ação com IA, com Confirmar (nunca direta) e trava sem logo", () => {
    expect(OPERACOES_COM_IA).toContain("completar_marca");
    const regra = regrasDoDiretor().completar_marca;
    expect(regra.direta).toBeFalsy();
    const semLogo = alvosDoDiretor({ projeto: { id: P, titulo: "Forno", etapa: "inicio", tem_logo: false }, caminhos: [], rodada: null, brandbook: null });
    const acao = normalizarAcoesDoDiretor({ itens: [{ operacao: "completar_marca", ref: "p1", para: "tudo" }] }, semLogo, { completar_marca: 0.12 });
    expect(acao === null || acao.itens.length === 0 || JSON.stringify(acao).indexOf("logo principal") >= 0).toBe(true);
    const comLogo = alvosDoDiretor({ projeto: { id: P, titulo: "Forno", etapa: "inicio", tem_logo: true }, caminhos: [], rodada: null, brandbook: null });
    const ok = normalizarAcoesDoDiretor({ itens: [{ operacao: "completar_marca", ref: "p1", para: "tudo" }] }, comLogo, { completar_marca: 0.12 });
    expect(ok && ok.itens[0].operacao).toBe("completar_marca");
    expect(ok && ok.custo_estimado_usd).toBe(0.12);
  });

  it("a função registra as ações novas e a migration só amplia", () => {
    const idx = readFileSync(resolve(__dirname, "../../supabase/functions/mesa-identidade/index.ts"), "utf8");
    ["logo_ler", "video_registrar", "completar_registrar"].forEach((a) => expect(idx).toContain(`${a}:`));
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20260930200000_mesa_identidade_completar.sql"), "utf8");
    expect(sql).toContain("'completar'");
    expect(sql).toContain("'marca_completada', 'video_da_marca'");
    expect(sql).not.toMatch(/DROP TABLE|DISABLE ROW LEVEL|DROP POLICY/i);
  });
});

function projetoBase(dados: Record<string, unknown>) {
  return { id: P, client_id: C, marca_id: null, modo: "completar", com_naming: false, titulo: "Marca completa: Forno", etapa: "briefing", concluidas: ["inicio"], dados, versao: 1, estado: "ativo", custo_usd: 0, criado_em: "", atualizado_em: "" } as any;
}

describe("IDV3: a rodada (andamento, Parar e Desfazer)", () => {
  const ctx = (guardar = vi.fn()) => ({ clientId: C, marcaId: null, nomeDaMarca: "Forno", modelos: {}, opcoes: {}, kit: null, guardar });

  it("roda os passos por código, grava o estado a cada um e registra o fim", async () => {
    chamadas.length = 0;
    projetoNoBanco = projetoBase({ sistema: { logos: { principal: LOGO } }, leitura_da_logo: { cores: [{ hex: "#157330", parte: 0.8 }, { hex: "#F07814", parte: 0.2 }], visao: { em: "x", fonte: { tem_texto: true, parecidas: [{ familia: "Montserrat", conferida: true }] }, formas_para_grafismo: [] } } });
    const r = new Rodada(projetoNoBanco, ctx());
    const plano = planoDeCompletar(projetoNoBanco.dados, { temLogo: true, modo: "completar" }, { passos: ["paleta", "tipografia"] });
    const estados: string[] = [];
    const fim = await rodarExecucao(r, novaExecucao("e1", plano, {}, "mesa"), { parar: () => false, aoMudar: (x) => estados.push(x.passos.map((p) => p.estado).join(",")), textoDoErro: (e) => String(e) });
    expect(fim.passos.map((p) => p.estado)).toEqual(["feito", "feito"]);
    expect(estados).toContain("rodando,pendente");
    expect(r.projeto.dados.sistema.cores[0]).toMatchObject({ papel: "primaria", hex: "#157330" });
    expect(r.projeto.dados.sistema.tipografia[0].familia).toBe("Montserrat");
    expect(r.projeto.dados.completar.execucao.terminada_em).toBeTruthy();
    expect(chamadas.some((c) => c.corpo.acao === "completar_registrar")).toBe(true);
  });

  it("Parar: o passo atual termina e os outros ficam parados para retomar", async () => {
    projetoNoBanco = projetoBase({ sistema: { logos: { principal: LOGO } }, leitura_da_logo: { cores: [{ hex: "#157330", parte: 1 }] } });
    const r = new Rodada(projetoNoBanco, ctx());
    const plano = planoDeCompletar(projetoNoBanco.dados, { temLogo: true, modo: "completar" }, { passos: ["paleta", "tipografia"] });
    let n = 0;
    const fim = await rodarExecucao(r, novaExecucao("e2", plano, {}, "mesa"), { parar: () => n++ >= 1, aoMudar: () => undefined, textoDoErro: (e) => String(e) });
    expect(fim.passos.map((p) => p.estado)).toEqual(["feito", "parado"]);
    expect(fim.parada_em).toBeTruthy();
  });

  it("Desfazer: a paleta volta como estava", async () => {
    projetoNoBanco = projetoBase({ sistema: { logos: { principal: LOGO }, cores: [{ nome: "Velha", papel: "primaria", hex: "#222222" }] }, leitura_da_logo: { cores: [{ hex: "#157330", parte: 1 }] } });
    const r = new Rodada(projetoNoBanco, ctx());
    const plano = planoDeCompletar(projetoNoBanco.dados, { temLogo: true, modo: "completar" }, { passos: ["paleta"] });
    const fim = await rodarExecucao(r, novaExecucao("e3", plano, {}, "mesa"), { parar: () => false, aoMudar: () => undefined, textoDoErro: (e) => String(e) });
    expect(r.projeto.dados.sistema.cores.length).toBeGreaterThan(1);
    await desfazerPasso(r, fim.passos[0]);
    expect(r.projeto.dados.sistema.cores).toEqual([{ nome: "Velha", papel: "primaria", hex: "#222222" }]);
  });

  it("vídeo: cria o filme na Mesa Motion com entrevista, BRAND.md, cenas e insumos, e registra no projeto", async () => {
    chamadas.length = 0;
    projetoNoBanco = projetoBase({ naming: { nome: "Forno" }, sistema: { logos: { principal: LOGO }, cores: [{ nome: "Verde", papel: "primaria", hex: "#157330" }] } });
    const r = new Rodada(projetoNoBanco, ctx());
    const v = await criarVideosDaMarca(r, { apresentacao: true, filme: false });
    expect(v.filmes).toEqual([{ id: "f-apresentacao", tipo: "apresentacao" }]);
    const salvar = chamadas.filter((c) => c.f === "mesa-motion" && c.corpo.acao === "filme_salvar")[0];
    expect(salvar.corpo.etapa).toBe("stills");
    expect((salvar.corpo.insumos as any).identidade.logo_path).toBe(LOGO.previa_png);
    expect((salvar.corpo.cenas as unknown[]).length).toBeGreaterThan(1);
    expect(chamadas.some((c) => c.corpo.acao === "video_registrar")).toBe(true);
    expect(chamadas.some((c) => c.corpo.acao === "storyboards_gerar")).toBe(false);
  });
});

function montar(dados: Record<string, unknown>, filho: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const projeto = projetoBase(dados);
  const valor: ProjetoDaMesa = { projeto, salvarParte: vi.fn(async () => projeto), concluir: vi.fn(), reabrir: vi.fn(), irPara: vi.fn(), guardar: vi.fn() };
  const catalogo = [{ id: "m-texto", provedor: "openai", modelo_api: "gpt", tipo: "texto", rotulo: "Texto", preco_entrada_1m: 2, preco_saida_1m: 8, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: ["identidade", "leitura", "motion"], ativo: true }];
  return render(
    h(MemoryRouter, null,
      h(QueryClientProvider, { client: qc },
        h(MesaProvider, { valor: { clientId: C, clientName: "Forno", userId: null, isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: catalogo as any, catalogoCarregando: false, atualizarCusto: () => undefined, abrirRecarga: () => undefined, abrirChaves: () => undefined, abrirModelos: () => undefined } },
          h(ProjetoProvider, { valor }, filho)))),
  );
}

describe("IDV3: a tela (checklist e janela central)", () => {
  it("mostra o checklist e abre o plano numa janela central com o custo total e Confirmar", async () => {
    const { container } = montar({ sistema: { logos: { principal: LOGO } } }, h(CompletarMarca));
    expect(container.querySelector('[data-checklist-da-marca]')).toBeTruthy();
    expect(container.querySelector('[data-item-do-checklist="logo"]')!.getAttribute("data-tem")).toBe("sim");
    fireEvent.click(screen.getByRole("button", { name: /Completar tudo/ }));
    const janela = await screen.findByRole("dialog");
    expect(janela.getAttribute("data-janela-do-completar")).toBe("plano");
    expect(within(janela).getAllByRole("checkbox", { name: /Ler a logo|Paleta completa|Vídeo da marca/ }).length).toBe(3);
    expect(within(janela).getByRole("button", { name: /Confirmar \(US\$/ })).toBeTruthy();
    expect(janela.querySelector('[data-seletor-de-modelo="visao"]')).toBeTruthy();
  });

  it("o Completar do item abre o plano só com aquele passo", async () => {
    montar({ sistema: { logos: { principal: LOGO } } }, h(CompletarMarca));
    const linha = document.querySelector('[data-item-do-checklist="grafismos"]') as HTMLElement;
    fireEvent.click(within(linha).getByRole("button", { name: /Completar/ }));
    const janela = await screen.findByRole("dialog");
    await waitFor(() => expect(janela.querySelectorAll('[data-roda="sim"]').length).toBe(1));
    expect(within(janela).getByRole("button", { name: /sem custo de IA/ })).toBeTruthy();
  });

  it("a regra do dono: janela central (Dialog), nunca gaveta lateral", () => {
    const fonte = ["CompletarMarca.tsx", "VideoDaMarca.tsx", "ResultadoDaMarca.tsx"].map((f) => readFileSync(resolve(__dirname, `../components/mesa-identidade/${f}`), "utf8")).join("\n");
    expect(fonte).not.toMatch(/Sheet|Drawer|JanelaDoCelular/);
    expect(fonte).toMatch(/DialogContent/);
  });
});
