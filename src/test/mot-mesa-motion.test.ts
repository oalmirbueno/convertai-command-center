import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conferirEscrita,
  contraste,
  coresDaMarca,
  dadosDaCenaSobMedida,
  ESTADO_VAZIO_DA_CENA,
  fontesDaCena,
  lerEscrita,
  lerParametros,
  LISTA_DE_FORMATOS,
  montarDocumento,
  pecaPorId,
  PECAS_DO_KIT,
  tamanhoDoQuadro,
  tempoDoStill,
  type CenaDoFilme,
  type MarcaDaCena,
} from "../../supabase/functions/_shared/cena-hf";
import {
  assinaturaDaCena,
  brandMd,
  casarNoRitmo,
  cenaDaLinha,
  CRITERIOS_DA_CRITICA,
  ETAPAS_DO_MOTION,
  estadoDaCritica,
  lerBrand,
  lerCritica,
  lerEntrevista,
  normalizarFilme,
  normalizarStoryboards,
  numerosDasProvas,
  paramsDosCampos,
  perguntasDaCritica,
  projetoDoFilme,
  renderDaCena,
  SOM_PADRAO,
} from "../../supabase/functions/_shared/motion-metodo";
import { medirBatidas } from "../../supabase/functions/_shared/batidas-da-trilha";
import { normalizarProjeto } from "../../supabase/functions/_shared/projeto-de-edicao";
import { alvosDoMotion, normalizarAcoesDoMotion, regrasDoMotion, type ListasDoMotion } from "../../supabase/functions/mesa-motion/acoes-do-motion";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { MESAS } from "@/components/mesa-foto/TrocaDeMesas";
import { MESAS_DO_PAINEL } from "@/lib/mesa/preCarga";
import { entraPeloPadrao, NOME_DA_MESA } from "@/components/mesa/clientesDaMesa";
import { ROTULOS_DAS_AREAS } from "@/lib/cronometro/motor";
import { AREAS_DO_PAINEL, AGENTES_DO_PAINEL } from "../../supabase/functions/_shared/mapa-do-painel";
import { MESAS_QUE_APRENDEM } from "../../supabase/functions/_shared/aprendizado-das-mesas";
import { rotuloDoLugar } from "@/lib/navegacao/lugares";
import { ETAPAS_DA_MESA_MOTION, etapaValidaDoMotion } from "@/components/mesa-motion/motionApi";

/**
 * Frente MOT (30/09): Mesa Motion. Kit de cenas HyperFrames (documento,
 * conferência da escrita do modelo), método (entrevista, BRAND.md,
 * storyboards, ritmo, montagem na Mesa Edição, crítica), batidas da trilha,
 * ações do diretor de motion e o registro da mesa.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";

// Paleta e fontes do kit da AcelerIQ como estão no banco.
const PALETA = [
  { hex: "#00D52B", nome: "Verde vibrante", papel: "primária e destaque" },
  { hex: "#111111", nome: "Preto carvão", papel: "secundária e fundo" },
  { hex: "#F7F7F7", nome: "Branco suave", papel: "fundo e texto sobre" },
  { hex: "#E7E8E9", nome: "Cinza claro", papel: "fundo" },
  { hex: "#6B6F73", nome: "Cinza médio", papel: "texto secundário" },
];
const MARCA: MarcaDaCena = { nome: "AcelerIQ", cores: coresDaMarca(PALETA), fonte_titulo: "Montserrat-Variable.ttf", fonte_texto: "Figtree-Variable.ttf", tem_logo: true };

const PARAMS_DE_TESTE: Record<string, Record<string, unknown>> = {
  logo_sting: { tagline: "Marketing com método" },
  abertura: { titulo: "Seu marketing precisa de método", subtitulo: "Plano, conteúdo e anúncios" },
  passos: { itens: ["Plano", "Conteúdo", "Relatório"] },
  diagrama: { centro: "Painel", ramos: ["Conteúdo", "Anúncios", "Site"] },
  antes_depois: { antes: ["Post sem plano"], depois: ["Calendário aprovado"] },
  numeros: { itens: [{ valor: 120, rotulo: "lojas", fonte: "relatório 2025" }] },
  carrossel_provas: { textos: ["Calendário", "Relatório", "Site"] },
  depoimento: { texto: "Organizaram o nosso marketing.", nome: "Ana", fonte: "print do WhatsApp" },
  cartao_final: { chamada: "Vamos conversar?", botao: "Fale com a gente" },
  logo_3d: { tagline: "AcelerIQ" },
};

const cena = (p: Partial<CenaDoFilme>): CenaDoFilme => ({ ...ESTADO_VAZIO_DA_CENA("c1", 1), ...p });

describe("marca da cena pelo kit (cores, fontes livres, contraste)", () => {
  it("primária pelo papel, fundo escuro e texto claro da paleta; sem paleta, o padrão", () => {
    expect(MARCA.cores).toMatchObject({ primaria: "#00D52B", fundo: "#111111", texto: "#F7F7F7" });
    expect(coresDaMarca(PALETA, "claro")).toMatchObject({ fundo: "#F7F7F7", texto: "#111111" });
    expect(coresDaMarca([]).primaria).toBe("#00D52B");
    expect(contraste(MARCA.cores.texto, MARCA.cores.fundo)).toBeGreaterThan(15);
  });

  it("fonte do kit fora das livres vira Montserrat/Figtree com aviso; Montserrat do kit fica", () => {
    const f = fontesDaCena([{ nome: "Citrica", papel: "titulo" }, { nome: "Roboto", papel: "texto" }]);
    expect(f.titulo).toBe("Montserrat-Variable.ttf");
    expect(f.texto).toBe("Figtree-Variable.ttf");
    expect(f.avisos).toHaveLength(2);
    expect(fontesDaCena([{ nome: "Anton", papel: "titulo" }]).titulo).toBe("Anton-Regular.ttf");
  });

  it("o quadro tem lados pares em cada formato e na meia resolução", () => {
    LISTA_DE_FORMATOS.forEach((f) => {
      const q = tamanhoDoQuadro(f, 0.5);
      expect(q.largura % 2).toBe(0);
      expect(q.altura % 2).toBe(0);
    });
    expect(tamanhoDoQuadro("16:9")).toEqual({ largura: 1920, altura: 1080 });
  });
});

describe("kit 2D e 3D: documento HyperFrames de cada peça", () => {
  it("as 10 peças montam em todos os formatos, com raiz, linha do tempo e só arquivos locais", () => {
    expect(PECAS_DO_KIT.map((p) => p.id)).toEqual(Object.keys(PARAMS_DE_TESTE));
    PECAS_DO_KIT.forEach((p) =>
      LISTA_DE_FORMATOS.forEach((f) => {
        const d = montarDocumento(cena({ peca: p.id, params: PARAMS_DE_TESTE[p.id], duracao_s: 5 }), MARCA, { formato: f });
        expect(d.html).toContain('data-composition-id="cena"');
        expect(d.html).toContain(`data-width="${d.largura}"`);
        expect(d.html).toContain('window.__timelines["cena"] = tl;');
        expect(d.html).toContain('src="gsap.min.js"');
        expect(d.html).not.toMatch(/https?:\/\//);
        expect(d.html).not.toMatch(/Math\.random|Date\.now|repeat:\s*-1/);
        expect(d.duracao_s).toBe(5);
      }),
    );
    expect(PECAS_DO_KIT.filter((p) => p.dimensao === "3d").map((p) => p.id)).toEqual(["carrossel_provas", "logo_3d"]);
  });

  it("amostra corta em 5 s e pede meia resolução; a logo só quando a peça usa", () => {
    const d = montarDocumento(cena({ peca: "passos", params: PARAMS_DE_TESTE.passos, duracao_s: 8 }), MARCA, { formato: "9:16", escala: 0.5, duracao_s: 5 });
    expect(d.duracao_s).toBe(5);
    expect(d.largura).toBe(540);
    expect(montarDocumento(cena({ peca: "logo_sting", params: {} }), MARCA, { formato: "1:1" }).precisa_de_logo).toBe(true);
  });

  it("peça sem o obrigatório não monta; número sem fonte sai com aviso", () => {
    expect(() => montarDocumento(cena({ peca: "depoimento", params: { texto: "x" } }), MARCA, { formato: "9:16" })).toThrow(/Nome/);
    const l = lerParametros(pecaPorId("numeros")!, { itens: [{ valor: 10, rotulo: "clientes" }, { valor: 3, rotulo: "anos", fonte: "contrato" }] });
    expect((l.params.itens as unknown[]).length).toBe(1);
    expect(l.avisos[0]).toMatch(/sem a fonte/);
  });

  it("imagem de prova só da pasta do cliente", () => {
    const ok = `${CLIENTE}/video/motion/f/insumos/print.png`;
    const l = lerParametros(pecaPorId("carrossel_provas")!, { imagens: [ok, "outro/print.png", "https://x.com/a.png"] }, CLIENTE);
    expect(l.params.imagens).toEqual([ok]);
    const d = montarDocumento(cena({ peca: "carrossel_provas", params: { imagens: [ok] } }), MARCA, { formato: "9:16" });
    expect(d.imagens).toEqual([{ destino: "midia/prova-1.png", caminho: ok }]);
  });

  it("picos de movimento por peça (plano de sons) e o still depois da entrada", () => {
    const d = montarDocumento(cena({ peca: "passos", params: PARAMS_DE_TESTE.passos, duracao_s: 5 }), MARCA, { formato: "9:16" });
    expect(d.picos.length).toBe(3);
    expect(d.picos.every((p) => p.som === "tique" && p.t < 5)).toBe(true);
    expect(tempoDoStill(cena({ duracao_s: 5 }))).toBeGreaterThan(1.4);
  });
});

describe("cena sob medida: o modelo escreve só o miolo, a conferência decide (sem laço)", () => {
  const boa = { html: '<div id="c-t" class="t">Oi</div><img src="marca/logo.png">', css: ".t{font-size:calc(var(--u) * 6);}", js: 'tl.fromTo("#c-t", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.2);' };

  it("aceita a escrita limpa e monta dentro do invólucro", () => {
    expect(conferirEscrita(boa)).toEqual({ ok: true, problemas: [] });
    const d = montarDocumento(cena({ modo: "sob_medida", peca: null, escrita: { ...boa, picos: [{ t: 0.3, som: "pop" }], resumo: "x" } }), MARCA, { formato: "16:9" });
    expect(d.html).toContain('<div id="c-t" class="t">Oi</div>');
    expect(d.picos).toEqual([{ t: 0.3, som: "pop" }]);
    expect(d.precisa_de_logo).toBe(true);
  });

  it("recusa rede, relógio, sorteio, laço infinito, endereço externo, script e a classe clip", () => {
    const casos: Array<[Partial<typeof boa>, RegExp]> = [
      [{ js: "fetch('/x')" }, /rede/],
      [{ js: "tl.to('#a',{x: Date.now()},0)" }, /relógio/],
      [{ js: "tl.to('#a',{x: Math.random()},0)" }, /sorteio/],
      [{ js: "tl.to('#a',{x:1, repeat: -1},0)" }, /laço infinito/],
      [{ html: '<img src="https://x.com/a.png">' }, /endereço externo/],
      [{ html: "<script>alert(1)</script>" }, /tag proibida/],
      [{ html: '<div class="clip">x</div>' }, /classe clip/],
      [{ css: "@import url(x.css);" }, /@import/],
      [{ html: '<img src="midia/outra.png">' }, /imagem fora do kit/],
    ];
    casos.forEach(([muda, motivo]) => {
      const r = conferirEscrita({ ...boa, ...muda });
      expect(r.ok).toBe(false);
      expect(r.problemas.join(" ")).toMatch(motivo);
    });
    expect(() => montarDocumento(cena({ modo: "sob_medida", peca: null, escrita: { ...boa, js: "fetch('x')", picos: [], resumo: "" } }), MARCA, { formato: "9:16" })).toThrow(/recusada/);
  });

  it("lê a resposta do modelo e os DADOS levam marca, provas e BRAND.md", () => {
    const e = lerEscrita({ ...boa, picos: [{ t: 9, som: "pop" }, { t: 1, som: "inexistente" }, { t: 1, som: "swish" }], resumo: "Frase — com travessão" }, 5);
    expect(e!.picos).toEqual([{ t: 1, som: "swish" }]);
    expect(e!.resumo).not.toContain("—");
    const dados = dadosDaCenaSobMedida({ cena: cena({ titulo: "Método" }), marca: MARCA, formato: "9:16", provas: [{ texto: "fato", fonte: "dossiê" }], brand_md: "# BRAND", imagens: [] });
    expect(dados).toContain("TEM_LOGO: sim");
    expect(dados).toContain('"fonte":"dossiê"');
  });
});

describe("método: entrevista, BRAND.md, storyboards e renders", () => {
  it("entrevista só guarda opções válidas", () => {
    expect(lerEntrevista({ duracao: "30", prova: ["prints", "x"], clima: "nada", observacoes: " a " })).toEqual({ duracao: "30", prova: ["prints"], observacoes: "a" });
  });

  it("BRAND.md tem as seções e prova só com fonte; números das provas", () => {
    const b = lerBrand({ essencia: "E", provas: [{ texto: "1.250 clientes atendidos", fonte: "CRM" }, { texto: "sem fonte" }], beats: [{ momento: "gancho", texto: "abre", duracao_s: 30 }] });
    expect(b.provas).toHaveLength(1);
    expect(b.beats[0].duracao_s).toBe(12);
    expect(numerosDasProvas(b.provas)).toContain(1250);
    const md = brandMd("Filme", b, { nome: "AcelerIQ", paleta: PALETA, fontes: [{ nome: "Citrica", papel: "titulo" }] }, { logo: "sting" });
    ["## Essência", "## Provas reais", "## Cores", "## Beat sheet", "Animação da logo: Sting com rastro"].forEach((t) => expect(md).toContain(t));
  });

  it("3 storyboards viram cenas conferidas: número fora das provas sai, sob medida e plano gerado", () => {
    const provas = [{ texto: "120 lojas", fonte: "relatório" }];
    const sbs = normalizarStoryboards(
      {
        storyboards: [
          { conceito: "A", resumo: "r", cenas: [{ tipo: "hf", peca: "numeros", titulo: "N", ideia: "", movimento: "", duracao_s: 4, campos: [{ chave: "itens", valor: "120;lojas;relatório | 999;clientes;inventado" }], prompt: "", camera: "" }] },
          { conceito: "B", resumo: "r", cenas: [{ tipo: "hf", peca: "sob_medida", titulo: "S", ideia: "traço", movimento: "", duracao_s: 5, campos: [], prompt: "", camera: "" }] },
          { conceito: "C", resumo: "r", cenas: [{ tipo: "gerado", peca: "abertura", titulo: "G", ideia: "", movimento: "", duracao_s: 6, campos: [{ chave: "titulo", valor: "Oi" }], prompt: "escritório ao amanhecer", camera: "dolly-in" }] },
        ],
      },
      "filme_marca",
      provas,
    );
    expect(sbs).toHaveLength(3);
    expect((sbs[0].cenas[0].params.itens as Array<{ valor: number }>).map((i) => i.valor)).toEqual([120]);
    expect(sbs[0].avisos.join(" ")).toMatch(/fora das provas/);
    expect(sbs[1].cenas[0].modo).toBe("sob_medida");
    expect(sbs[2].cenas[0]).toMatchObject({ tipo_plano: "gerado", prompt: "escritório ao amanhecer", camera: "dolly-in" });
    // Na apresentação não há plano gerado.
    expect(normalizarStoryboards({ storyboards: [{ conceito: "x", resumo: "", cenas: [{ tipo: "gerado", peca: "abertura", titulo: "t", ideia: "", movimento: "", duracao_s: 4, campos: [], prompt: "p", camera: "" }] }] }, "apresentacao", [])[0].cenas[0].tipo_plano).toBe("hf");
    expect(paramsDosCampos("passos", [{ chave: "itens", valor: "a | b" }])).toEqual({ itens: ["a", "b"] });
  });

  it("assinatura muda com a cena e o render antigo fica desatualizado", () => {
    const c = cenaDaLinha({ ordem: 1, peca: "abertura", params: { titulo: "A" } }).cena;
    const filme = normalizarFilme({ id: "f", client_id: CLIENTE, renders: [{ pedido_id: "p1", cena_id: c.id, modo: "final", formato: "9:16", assinatura: assinaturaDaCena(c), estado: "pronto", saida_path: "x.webm", arquivo_id: null, folha_path: null, check: null, em: "2026-09-30T10:00:00Z" }] })!;
    expect(renderDaCena(filme, c, "final", "9:16")!.em_dia).toBe(true);
    const mudada = { ...c, params: { titulo: "B" } };
    expect(assinaturaDaCena(mudada)).not.toBe(assinaturaDaCena(c));
    expect(renderDaCena(filme, mudada, "final", "9:16")!.em_dia).toBe(false);
    expect(renderDaCena(filme, c, "final", "16:9")).toBeNull();
  });
});

describe("batidas e ritmo", () => {
  function trilha(bpm: number, dur: number, taxa: number, drop: number): Float32Array {
    const a = new Float32Array(Math.round(dur * taxa));
    const periodo = 60 / bpm;
    for (let i = 0; i < a.length; i++) {
      const t = i / taxa;
      const fase = t % periodo;
      a[i] = 0.8 * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-18 * fase) + 0.08 * Math.sin(2 * Math.PI * 220 * t) * (t > drop ? 2.2 : 1);
    }
    return a;
  }

  it("mede 120 BPM, as batidas no bumbo e o drop", () => {
    const m = medirBatidas(trilha(120, 14, 11025, 8), 11025);
    expect(Math.abs(m.bpm - 120)).toBeLessThanOrEqual(3);
    expect(m.batidas.length).toBeGreaterThan(24);
    expect(Math.abs((m.batidas[1] - m.batidas[0]) - 0.5)).toBeLessThan(0.03);
    expect(m.compassos.length).toBeGreaterThan(5);
    expect(m.drop_s).not.toBeNull();
    expect(Math.abs((m.drop_s as number) - 8)).toBeLessThanOrEqual(1.1);
  });

  it("casa os cortes na batida sem cena abaixo de 2 s", () => {
    const mapa = { bpm: 120, batidas: Array.from({ length: 40 }, (_, i) => 0.25 + i * 0.5), compassos: Array.from({ length: 10 }, (_, i) => 0.25 + i * 2), drop_s: 8.25, duracao_s: 20, energia: [], confianca: 1 };
    const r = casarNoRitmo([{ duracao_s: 4.1 }, { duracao_s: 1.2 }, { duracao_s: 5 }], mapa);
    let t = 0;
    r.slice(0, 2).forEach((c) => {
      t += c.duracao_s;
      expect(Math.abs(((t - 0.25) / 0.5) - Math.round((t - 0.25) / 0.5))).toBeLessThan(1e-6);
    });
    expect(r.every((c) => c.duracao_s >= 2)).toBe(true);
    expect(casarNoRitmo([{ duracao_s: 3 }], null)).toEqual([{ duracao_s: 3 }]);
  });
});

describe("montagem na Mesa Edição e crítica", () => {
  it("o projeto do filme é um projeto de edição válido: cenas em sequência, música sem duck e efeitos no pico", () => {
    const cenas = [cenaDaLinha({ ordem: 1, peca: "logo_sting", duracao_s: 5 }).cena, cenaDaLinha({ ordem: 2, peca: "cartao_final", params: { chamada: "Oi" }, duracao_s: 5 }).cena];
    const p = projetoDoFilme({
      titulo: "Filme",
      formato: "9:16",
      materiais: cenas.map((c, i) => ({ cena: c, caminho: `${CLIENTE}/video/motion/f/cenas/${c.id}/final.webm`, duracao_s: 5, picos: i === 0 ? [{ t: 0.4, som: "swish" }, { t: 0.75, som: "glitch" }] : [{ t: 0.35, som: "swish" }] })),
      som: { ...SOM_PADRAO(), trilha: { arquivo_id: null, path: `${CLIENTE}/video/brutos/t.wav`, nome: "T", duracao_s: 16 } },
    });
    const n = normalizarProjeto(p);
    expect(n).not.toBeNull();
    expect(n!.duracao_s).toBe(10);
    expect(n!.largura).toBe(1080);
    const video = n!.trilhas.find((t) => t.tipo === "video")!;
    expect(video.clipes.map((c) => c.inicio_s)).toEqual([0, 5]);
    expect(video.muda).toBe(true);
    const musica = n!.trilhas.find((t) => t.id === "audio-1")!.clipes[0];
    expect((musica.estilo as Record<string, unknown>).papel).toBe("musica");
    const efeitos = n!.trilhas.find((t) => t.id === "audio-2")!.clipes.map((c) => (c.estilo as { pico_s: number }).pico_s);
    // O glitch a 0,35 s do swish sai (0,65 s entre sons); o pico cai no quadro (30 fps).
    expect(efeitos.length).toBe(2);
    expect(efeitos[0]).toBe(0.4);
    expect(Math.abs(efeitos[1] - 5.35)).toBeLessThanOrEqual(1 / 30);
    expect(n!.mixagem.lufs_alvo).toBe(-14);
  });

  it("crítica: 5 Scores do Jev pelos fatos medidos e nota de 1 a 10 (abaixo de 6 é aviso)", () => {
    const q = perguntasDaCritica();
    expect(Object.keys(q)).toEqual(CRITERIOS_DA_CRITICA.map((c) => c.chave));
    expect(Object.keys(q).every((k) => q[k].type === "score" && q[k].criteria.length === 5)).toBe(true);
    const e = estadoDaCritica({ cena: cenaDaLinha({ ordem: 1, peca: "abertura", params: { titulo: "Um dois três" }, duracao_s: 3 }).cena, brand: lerBrand({}), marca: { nome: "A", cores: MARCA.cores }, formato: "9:16", check: { layout: { errorCount: 1 } }, contrasteTexto: 18.1 });
    expect(e).toMatchObject({ palavras_na_tela: 3, palavras_por_segundo: 1, conferencia_automatica: { layout_problemas: 1 } });
    const r = lerCritica({ legibilidade: { score: 5 }, hierarquia: { score: 1 }, ritmo: { score: 3 } });
    expect(r.notas).toEqual({ legibilidade: 10, hierarquia: 1, ritmo: 5.5 });
    expect(r.avisos).toHaveLength(2);
  });
});

describe("diretor de motion: ações com apelido, custo antes e o que é na hora", () => {
  const listas: ListasDoMotion = {
    filmeId: "f1",
    cenas: [
      { id: "cA", titulo: "Abertura", peca: "abertura", modo: "kit", tipo_plano: "hf", tem_still: true, still_aprovado: false },
      { id: "cB", titulo: "Plano", peca: null, modo: "kit", tipo_plano: "gerado", tem_still: false, still_aprovado: false },
    ],
    storyboards: [{ conceito: "Um", escolhido: false }, { conceito: "Dois", escolhido: true }],
    tem_trilha: true,
    tem_batidas: false,
  };
  const custos = { brand: 0.05, storyboards: 0.1, cena: 0.12, critica: 0.001 };

  it("apelidos c, b e x; id cru nunca vai para o modelo", () => {
    const refs = alvosDoMotion(listas).map((a) => a.ref);
    expect(refs).toEqual(["c1", "c2", "b1", "b2", "x1"]);
  });

  it("custo soma escrever cena e storyboards; travas de plano de vídeo e de batidas", () => {
    const a = normalizarAcoesDoMotion({ itens: [{ ref: "c1", operacao: "escrever_cena", para: "traço verde que cresce" }, { ref: "x1", operacao: "gerar_storyboards", para: "" }, { ref: "c2", operacao: "pedir_still" }, { ref: "x1", operacao: "casar_ritmo" }] }, listas, "cli", custos)!;
    expect(a.itens.map((i) => i.operacao)).toEqual(["escrever_cena", "gerar_storyboards"]);
    expect(a.custo_estimado_usd).toBeCloseTo(0.22, 6);
    expect(a.recusados.map((r) => r.motivo).join(" ")).toMatch(/plano de vídeo/);
    expect(a.recusados.map((r) => r.motivo).join(" ")).toMatch(/batidas/);
  });

  it("escolher storyboard, trocar peça e pedir amostra são na hora; montar pede Confirmar", () => {
    const direta = normalizarAcoesDoMotion({ itens: [{ ref: "b1", operacao: "escolher_storyboard" }, { ref: "c1", operacao: "usar_peca", para: "cartao final" }, { ref: "c1", operacao: "pedir_amostra" }] }, listas, "cli", custos)!;
    expect(direta.itens.find((i) => i.operacao === "usar_peca")!.para).toBe("cartao_final");
    expect(podeExecutarDireto(direta, regrasDoMotion(), { pedidoClaro: true }).direto).toBe(true);
    const montar = normalizarAcoesDoMotion({ itens: [{ ref: "x1", operacao: "montar_filme" }] }, listas, "cli", custos)!;
    expect(podeExecutarDireto(montar, regrasDoMotion(), { pedidoClaro: true }).direto).toBe(false);
    const peca = normalizarAcoesDoMotion({ itens: [{ ref: "c1", operacao: "usar_peca", para: "peça que não existe" }] }, listas, "cli", custos);
    expect(peca === null || peca.itens.length === 0).toBe(true);
  });
});

describe("registro da Mesa Motion no painel", () => {
  it("rota, troca de mesas, pré-carga, clientes, cronômetro, lugares e mapa do painel", () => {
    expect(MESAS.find((m) => m.valor === "motion")!.caminho).toBe("/mesa-motion");
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-motion"].etapas)).toEqual(ETAPAS_DO_MOTION.map((e) => e.valor));
    expect(NOME_DA_MESA.motion).toBe("Mesa Motion");
    expect(entraPeloPadrao("motion", { id: "x", plan_status: "inactive", client_type: "one_off" } as never).entra).toBe(true);
    expect(ROTULOS_DAS_AREAS["mesa-motion"]).toBe("Mesa Motion");
    expect(rotuloDoLugar("/mesa-motion", "?client=x&etapa=construcao")).toBe("Mesa Motion · Construção");
    expect(AREAS_DO_PAINEL.find((a) => a.chave === "mesa_motion")!.rota).toBe("/mesa-motion");
    expect(AGENTES_DO_PAINEL.find((a) => a.chave === "motion")!.funcao).toBe("mesa-motion");
    expect(MESAS_QUE_APRENDEM).toContain("motion");
    expect(ler("src/lib/mesa/marcas.ts")).toMatch(/FUNCOES_COM_MARCA = \[[\s\S]*"mesa-motion",[\s\S]*\];/);
    expect(ETAPAS_DA_MESA_MOTION).toHaveLength(9);
    expect(etapaValidaDoMotion("xyz")).toBe("insumos");
  });

  it("rota com trava de papel, função com JWT e o gancho do documento de entrega", () => {
    expect(ler("src/App.tsx")).toMatch(/path="\/mesa-motion" element=\{<>\{\["admin", "manager", "design"\]/);
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.mesa-motion\]\s*\n\s*verify_jwt = true/);
    expect(ler("supabase/functions/documentos/eventos.ts")).toContain("motion_filme_entregue");
    expect(ler("supabase/functions/mesa-motion/index.ts")).toContain('"motion_filme_entregue"');
  });

  it("migration: só amplia, RLS por cliente, escrita só pela service_role e portfólio com autorização", () => {
    const sql = ler("supabase/migrations/20260930180000_mesa_motion.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.motion_filmes");
    expect(sql).toMatch(/motion_filmes_equipe_le[\s\S]*is_staff[\s\S]*can_access_client\(client_id\)/);
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.motion_filmes FROM authenticated");
    expect(sql).toContain("'cena_hf', 'batidas'");
    expect(sql).toContain("render_pedidos_alvo_check");
    expect(sql).toMatch(/autorizacao->>'quem'/);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DISABLE ROW LEVEL/i);
  });
});
