import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Frente R (26/09): estética da referência, conteúdo da copy.
 * 1. Caminho de hoje byte a byte: interruptor desligado, sem copy, foto do
 *    cliente, conteúdo que serve e falha da leitura, do Jev ou do diretor
 *    deixam o bloco vazio, e o prompt do replicar é o do fixture.
 * 2. Caminho adaptado: o bloco entra logo depois do promptDoReplicar, com o
 *    texto do nível (fixture novo replicar-adaptado.json).
 * 3. Jev: estado com campos nomeados, limiar e dúvida (adapta).
 * 4. Trava da marca: a cena só leva a letra e as cores do cliente.
 * 5. Uma leitura, um julgamento, uma cena: tudo guardado, sem laço.
 * 6. Ligação no servidor, registro em motores e a tela.
 */

const fontesMock = vi.hoisted(() => ({ linhas: [] as unknown[], kit: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: fontesMock.linhas, error: null }),
          maybeSingle: () => Promise.resolve({ data: fontesMock.kit, error: null }),
        }),
      }),
    }),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: new Error("sem") }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { promptDoReplicar } from "../../supabase/functions/_shared/direcao-arte";
import type { FidelidadeDaReferencia } from "../../supabase/functions/_shared/fidelidade-da-referencia";
import type { ResultadoJev } from "../../supabase/functions/_shared/jev";
import { MUDANCAS_DO_GERADOR_DO_ESTUDIO } from "../../supabase/functions/_shared/motores";
import {
  adaptacaoDaReferencia,
  adaptarConteudoLigado,
  blocoAdaptarConteudo,
  caminhoDaAdaptacao,
  type ContextoDaLamina,
  copyDaLamina,
  decidirAdaptacao,
  type DepsDaAdaptacao,
  esteticaSemMarca,
  estadoDoJev,
  LIMIAR_SERVE,
  type LeituraDoConteudo,
  leituraDoConteudo,
  normalizarCena,
  normalizarLeituraDoConteudo,
  pedidoDaCena,
  PERGUNTAS_DA_ADAPTACAO,
  tentaAdaptar,
} from "../../supabase/functions/estudio-arte/referencia-adapta-copy";
import EstudioAdaptarConteudo, { adaptarLigado, AJUDA_DO_ADAPTAR, corpoDoAdaptar } from "@/components/mesa/EstudioAdaptarConteudo";
import EstudioAvisoSemFonte, { EstudioAvisoDoKit, kitSemCor, TEXTO_SEM_CORES, TEXTO_SEM_FONTE } from "@/components/mesa/EstudioAvisoSemFonte";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { corDaMarcaNoPapel } from "../../supabase/functions/_shared/direcao-arte";
import { CASOS_DO_REPLICAR, MARCA_CASO, MOLDE_CASO } from "./fixtures/replicarCasos";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const HOJE = JSON.parse(ler("src/test/fixtures/replicar-identica-hoje.json")) as { replicar: { nome: string; prompt: string }[] };
const servidor = ler("supabase/functions/estudio-arte/index.ts");

const LEITURA: LeituraDoConteudo = {
  estetica: {
    layout: "Título enorme no topo, pessoa no centro embaixo",
    tipografia: "Título em Montserrat Black, caixa alta",
    cores: "Azul #1E4FD8 dominante, laranja #FF5500 no destaque",
    luz: "Luz de estúdio frontal, suave",
    tratamento_de_foto: "Cores chapadas, contraste alto",
    composicao: "Simétrica, assunto centralizado",
    enquadramento: "Plano médio frontal",
    elementos_graficos: "Celulares inclinados em volta da pessoa, fio fino sob o título",
    estrategia_do_gancho: "Promessa grande no título e rosto olhando para a câmera",
  },
  conteudo: {
    assunto: "Homem segurando um celular com um aplicativo de carros",
    objetos: "Celulares, chave de carro",
    pessoas: "Um homem adulto de camisa azul",
    cenario: "Fundo liso de estúdio",
    texto_escrito: "Venda seu carro em 24 horas",
    sentido: "Anúncio de aplicativo de venda de carros",
  },
  tipo_de_cena: "retrato de pessoa em estúdio",
  tem_assunto_visual: true,
};

const CTX: ContextoDaLamina = {
  copy: "Seu sorriso merece cuidado",
  funcao: "capa",
  ordem: 1,
  total: 4,
  conceito: "Prevenção na odontologia",
  roteiro: "Carrossel sobre consulta de rotina no dentista",
  ideia_da_imagem: "dentista atendendo paciente sorrindo",
  cliente: { nome: "Clínica Sorriso", negocio: "clínica odontológica", publico: "famílias do bairro", oferta: "avaliação gratuita" },
};

const CENA = "Mulher adulta sorrindo na cadeira do dentista, dentista de jaleco ao lado segurando um espelho, consultório claro.";

function resultadoJev(p: number | null, choice = "so_estetica"): ResultadoJev {
  return {
    answers: { serve: p === null ? {} : { noul: p }, aproveitar: { choice, confidence: 0.8 } },
    usage: { input_tokens: 800, output_tokens: 0 },
    modelo: "jev-latest",
  };
}

function depsFalsas(o: { jev?: () => Promise<ResultadoJev>; cena?: unknown; visao?: () => Promise<unknown>; guardado?: Record<string, Record<string, unknown>> } = {}) {
  const arquivos: Record<string, Record<string, unknown>> = { ...(o.guardado || {}) };
  const chamadas = { jev: 0, cena: 0, visao: 0, cobrou: 0, guardou: 0 };
  const deps: DepsDaAdaptacao = {
    pasta: "cli/estudio/leituras",
    lerGuardado: async (c) => arquivos[c] ?? null,
    guardar: async (c, v) => {
      chamadas.guardou++;
      arquivos[c] = JSON.parse(JSON.stringify(v));
    },
    lerPorVisao: async () => {
      chamadas.visao++;
      return o.visao ? o.visao() : LEITURA;
    },
    perguntarJev: async () => {
      chamadas.jev++;
      return o.jev ? o.jev() : resultadoJev(0.1);
    },
    cobrarJev: async () => {
      chamadas.cobrou++;
      return null;
    },
    escreverCena: async () => {
      chamadas.cena++;
      return o.cena === undefined ? { cena: CENA } : o.cena;
    },
  };
  return { deps, chamadas, arquivos };
}

const KIT = { fontes: MARCA_CASO.fontes, paleta: MARCA_CASO.paleta };
const REGRAS = "REGRAS DE RENDER (sintético)";
/** Como gerarCard compõe o replicar (os blocos do meio vazios aqui): prompt, copy, rosto, preferências, variedade, continuidade, variação, estilo, regras. */
const compoe = (prompt: string, blocoDaCopia: string, blocoDoRosto = "") => [prompt, blocoDaCopia, blocoDoRosto, "", "", "", "", "", REGRAS].filter(Boolean).join("\n\n");

// ------------------------------------------------------------------ 1. hoje

describe("1. Caminho de hoje: nenhum bloco e o prompt byte a byte", () => {
  it("promptDoReplicar continua o do fixture em todos os casos (a frente não mexe nele)", () => {
    expect(HOJE.replicar.length).toBe(CASOS_DO_REPLICAR.length);
    CASOS_DO_REPLICAR.forEach((c, i) => expect(promptDoReplicar(c.entrada).prompt, c.nome).toBe(HOJE.replicar[i].prompt));
  });

  it("só tenta no replicar, com o interruptor ligado, com copy e sem foto do cliente", () => {
    const base = { replicar: true, direcao: {}, copy: "Texto", fotosDoCliente: 0, temImagemDaReferencia: true };
    expect(tentaAdaptar(base)).toBe(true);
    expect(tentaAdaptar({ ...base, direcao: { adaptar_conteudo_a_copy: false } })).toBe(false);
    expect(tentaAdaptar({ ...base, direcao: { adaptar_conteudo_a_copy: true } })).toBe(true);
    expect(tentaAdaptar({ ...base, replicar: false })).toBe(false);
    expect(tentaAdaptar({ ...base, copy: "" })).toBe(false);
    expect(tentaAdaptar({ ...base, fotosDoCliente: 1 })).toBe(false);
    expect(tentaAdaptar({ ...base, temImagemDaReferencia: false })).toBe(false);
    expect(adaptarConteudoLigado(null)).toBe(true);
    expect(adaptarConteudoLigado({ adaptar_conteudo_a_copy: "false" })).toBe(true);
    expect(copyDaLamina({ texto_exato: "  Vale — a pena?  " })).toBe("Vale , a pena?");
  });

  it("conteúdo que serve: bloco vazio, sem cena e o prompt igual ao de hoje", async () => {
    const { deps, chamadas } = depsFalsas({ jev: async () => resultadoJev(0.92, "tudo") });
    const r = await adaptacaoDaReferencia({ refId: "r1", fidelidade: "identica", indice: 1, ctx: CTX, molde: MOLDE_CASO, leitura: LEITURA, kit: KIT }, deps);
    expect(r.bloco).toBe("");
    expect(r.registro).toMatchObject({ adaptou: false, motivo: "serve", serve: 0.92 });
    expect(chamadas.cena).toBe(0);
    for (const c of HOJE.replicar) expect(compoe(c.prompt, r.bloco)).toBe(`${c.prompt}\n\n${REGRAS}`);
  });

  it("falhas (leitura, Jev fora, Jev sem resposta, diretor sem cena, sem assunto visual): bloco vazio", async () => {
    const semLeitura = await adaptacaoDaReferencia({ refId: "r1", fidelidade: "identica", indice: 1, ctx: CTX, molde: null, leitura: null }, depsFalsas().deps);
    expect(semLeitura).toEqual({ bloco: "", registro: { versao: 1, adaptou: false, motivo: "sem_leitura" } });
    const jevFora = depsFalsas({ jev: async () => { throw new Error("typesafe_529"); } });
    expect((await adaptacaoDaReferencia({ refId: "r1", fidelidade: "identica", indice: 1, ctx: CTX, molde: null, leitura: LEITURA }, jevFora.deps)).registro.motivo).toBe("jev_falhou");
    expect(jevFora.chamadas.cena).toBe(0);
    const jevVazio = depsFalsas({ jev: async () => resultadoJev(null) });
    expect((await adaptacaoDaReferencia({ refId: "r1", fidelidade: "identica", indice: 1, ctx: CTX, molde: null, leitura: LEITURA }, jevVazio.deps)).bloco).toBe("");
    const semCena = depsFalsas({ cena: { cena: "" } });
    const r = await adaptacaoDaReferencia({ refId: "r1", fidelidade: "identica", indice: 1, ctx: CTX, molde: null, leitura: LEITURA }, semCena.deps);
    expect(r.bloco).toBe("");
    expect(r.registro.motivo).toBe("sem_cena");
    const diretorQuebrado = depsFalsas();
    diretorQuebrado.deps.escreverCena = async () => { throw new Error("fora"); };
    expect((await adaptacaoDaReferencia({ refId: "r1", fidelidade: "identica", indice: 1, ctx: CTX, molde: null, leitura: LEITURA }, diretorQuebrado.deps)).bloco).toBe("");
    const soTipografia = await adaptacaoDaReferencia({ refId: "r1", fidelidade: "identica", indice: 1, ctx: CTX, molde: null, leitura: { ...LEITURA, tem_assunto_visual: false } }, depsFalsas().deps);
    expect(soTipografia.registro.motivo).toBe("sem_assunto");
  });

  it("leitura por visão que falha ou vem vazia: null (a lâmina segue como hoje)", async () => {
    expect(await leituraDoConteudo("r1", depsFalsas({ visao: async () => { throw new Error("x"); } }).deps)).toBeNull();
    expect(await leituraDoConteudo("r1", depsFalsas({ visao: async () => ({ estetica: {}, conteudo: {} }) }).deps)).toBeNull();
    expect(normalizarLeituraDoConteudo(null)).toBeNull();
  });
});

// ------------------------------------------------------------------ 2. adaptado

const NIVEIS: FidelidadeDaReferencia[] = ["identica", "proxima", "inspirada", "criativa"];
const FIXTURE_ADAPTADO = "src/test/fixtures/replicar-adaptado.json";
const casoAdaptado = (f: FidelidadeDaReferencia) => {
  const c = CASOS_DO_REPLICAR[0];
  const prompt = promptDoReplicar({ ...c.entrada, fidelidade: f }).prompt;
  const bloco = blocoAdaptarConteudo({ fidelidade: f, indice: 1, cena: CENA, aproveitar: "estetica_e_tipo_de_cena", kit: KIT });
  return { nome: `${c.nome}, ${f}`, prompt: compoe(prompt, bloco), base: prompt, bloco };
};
if (process.env.GERAR_FIXTURE_R === "1") {
  writeFileSync(resolve(process.cwd(), FIXTURE_ADAPTADO), JSON.stringify({ gerado_em: "2026-09-26", adaptado: NIVEIS.map((f) => { const x = casoAdaptado(f); return { nome: x.nome, prompt: x.prompt }; }) }, null, 1));
}

describe("2. Caminho adaptado: bloco logo depois do promptDoReplicar, pelo nível", () => {
  it("fixture novo do caminho adaptado (os 4 níveis)", () => {
    const f = JSON.parse(ler(FIXTURE_ADAPTADO)) as { adaptado: { nome: string; prompt: string }[] };
    expect(f.adaptado.length).toBe(NIVEIS.length);
    NIVEIS.forEach((n, i) => expect(casoAdaptado(n).prompt, n).toBe(f.adaptado[i].prompt));
  });

  it("o que vinha antes fica igual (prefixo) e o bloco vem logo depois, antes das regras", () => {
    for (const n of NIVEIS) {
      const x = casoAdaptado(n);
      expect(x.prompt.startsWith(`${x.base}\n\n${x.bloco}\n\n`)).toBe(true);
      expect(x.prompt.endsWith(REGRAS)).toBe(true);
    }
    // Idêntica: o prompt de hoje do fixture é o prefixo exato.
    const identica = casoAdaptado("identica");
    expect(identica.base).toBe(HOJE.replicar[0].prompt);
  });

  it("texto por nível: Idêntica quase exata, Próxima parecida, Inspirada e Criativa só reforçam", () => {
    const b = (f: FidelidadeDaReferencia, a: "so_estetica" | "estetica_e_tipo_de_cena" = "estetica_e_tipo_de_cena") => blocoAdaptarConteudo({ fidelidade: f, indice: 2, cena: CENA, aproveitar: a });
    expect(b("identica")).toContain("Mantenha a estética e a composição da imagem 2 quase exatas");
    expect(b("identica")).toContain(`- Troque o assunto por: ${CENA}`);
    expect(b("identica")).toContain("Mesmo tipo de cena da referência");
    expect(b("identica", "so_estetica")).toContain("O tipo de cena pode mudar");
    expect(b("proxima")).toContain("uma composição parecida");
    expect(b("proxima")).toContain("pose e enquadramento podem mudar");
    expect(b("inspirada")).toContain("Da imagem 2 ficam a família visual");
    expect(b("criativa")).toContain("Da imagem 2 fica só o clima");
    for (const n of NIVEIS) {
      const x = b(n);
      expect(x.startsWith("ADAPTAR O CONTEÚDO À MENSAGEM")).toBe(true);
      expect(x).toContain("o texto exato, a marca e a logo seguem as regras acima");
      expect(x).not.toMatch(/[—–]/);
      expect(x.length).toBeLessThanOrEqual(1200);
    }
    expect(blocoAdaptarConteudo({ fidelidade: "identica", indice: 1, cena: "", aproveitar: "so_estetica" })).toBe("");
  });

  it("adapta de ponta a ponta: um Jev, uma cena, cobra o Jev e guarda tudo", async () => {
    const { deps, chamadas, arquivos } = depsFalsas({ jev: async () => resultadoJev(0.12, "so_estetica") });
    const r = await adaptacaoDaReferencia({ refId: "r1", fidelidade: "identica", indice: 1, ctx: CTX, molde: MOLDE_CASO, leitura: LEITURA, kit: KIT }, deps);
    expect(r.registro).toMatchObject({ adaptou: true, motivo: "adaptou", aproveitar: "so_estetica", serve: 0.12 });
    expect(r.bloco).toContain(CENA);
    expect(chamadas).toMatchObject({ jev: 1, cena: 1, cobrou: 1 });
    expect(arquivos[caminhoDaAdaptacao(deps.pasta, "r1", CTX)]).toMatchObject({ serve: 0.12, aproveitar: "so_estetica", cena: CENA });
  });
});

// ------------------------------------------------------------------ 3. Jev

describe("3. Jev: estado nomeado, limiar e dúvida", () => {
  it("estado com a lâmina, o post, o cliente e o conteúdo da referência", () => {
    const e = estadoDoJev(CTX, LEITURA) as any;
    expect(Object.keys(e)).toEqual(["lamina", "post", "cliente", "referencia"]);
    expect(e.lamina.copy).toBe(CTX.copy);
    expect(e.post.roteiro_e_objetivo).toBe(CTX.roteiro);
    expect(e.cliente.negocio).toBe("clínica odontológica");
    expect(e.referencia.assunto).toBe(LEITURA.conteudo.assunto);
    expect(PERGUNTAS_DA_ADAPTACAO.serve.type).toBe("noul");
    expect(PERGUNTAS_DA_ADAPTACAO.aproveitar.type).toBe("choice");
    expect(Object.keys((PERGUNTAS_DA_ADAPTACAO.aproveitar as any).criteria)).toEqual(["tudo", "estetica_e_tipo_de_cena", "so_estetica"]);
  });

  it("serve a partir do limiar; dúvida adapta com a troca conservadora", () => {
    expect(LIMIAR_SERVE).toBe(0.75);
    expect(decidirAdaptacao({ serve: { noul: 0.75 }, aproveitar: { choice: "tudo" } })).toMatchObject({ serve: true, aproveitar: "tudo" });
    expect(decidirAdaptacao({ serve: { noul: 0.5 }, aproveitar: { choice: "tudo" } })).toMatchObject({ serve: false, aproveitar: "estetica_e_tipo_de_cena" });
    expect(decidirAdaptacao({ serve: { noul: 0.3 } })).toMatchObject({ serve: false, aproveitar: "estetica_e_tipo_de_cena" });
    expect(decidirAdaptacao({ serve: { noul: 0.05 }, aproveitar: { choice: "so_estetica" } })).toMatchObject({ serve: false, aproveitar: "so_estetica" });
    expect(decidirAdaptacao({ aproveitar: { choice: "tudo" } })).toBeNull();
    expect(decidirAdaptacao(null)).toBeNull();
  });
});

// ------------------------------------------------------------------ 4. trava da marca

describe("4. Trava da marca: fonte, cor e logo sempre do cliente", () => {
  it("referência com fonte X e cor Y: a cena que vai ao modelo só tem as do cliente", () => {
    const suja = "Mulher sorrindo em fundo azul #1E4FD8, título em Montserrat Black. Luz suave com a Fonte Título.";
    const b = blocoAdaptarConteudo({ fidelidade: "identica", indice: 1, cena: suja, aproveitar: "so_estetica", kit: KIT });
    expect(b).not.toContain("Montserrat");
    expect(b).not.toContain("#1E4FD8");
    expect(b).not.toMatch(/\bazul\b/i);
    expect(b).toContain("Fonte Título");
    expect(b).toContain("Mulher sorrindo");
  });

  it("o diretor não recebe a tipografia nem as cores da referência", () => {
    const e = esteticaSemMarca(LEITURA);
    expect(e.tipografia).toBeUndefined();
    expect(e.cores).toBeUndefined();
    const pedido = pedidoDaCena(CTX, LEITURA, MOLDE_CASO, "so_estetica");
    const estetica = JSON.parse(pedido.slice(pedido.indexOf("{"))).estetica_da_referencia;
    expect(JSON.stringify(estetica)).not.toMatch(/Montserrat|#1E4FD8|#FF5500/);
    expect(pedido).toContain(CTX.copy);
  });

  it("cena longa é cortada no teto e sem travessão", () => {
    expect(normalizarCena({ cena: `${"Cena longa. ".repeat(60)}` })!.length).toBeLessThanOrEqual(360);
    expect(normalizarCena({ cena: "Pessoa — sorrindo no consultório claro" })).toBe("Pessoa , sorrindo no consultório claro");
    expect(normalizarCena({ cena: "curta" })).toBeNull();
  });
});

// ------------------------------------------------------------------ 5. sem laço

describe("5. Uma leitura, um julgamento, uma cena (guardados)", () => {
  it("a leitura é guardada por referência e lida de novo sem visão", async () => {
    const f = depsFalsas();
    expect(await leituraDoConteudo("r1", f.deps)).toEqual(LEITURA);
    expect(await leituraDoConteudo("r1", f.deps)).toEqual(LEITURA);
    expect(f.chamadas.visao).toBe(1);
  });

  it("refazer a lâmina com o mesmo texto não chama o Jev nem o diretor de novo; texto novo, sim", async () => {
    const f = depsFalsas({ jev: async () => resultadoJev(0.2) });
    const e = { refId: "r1", fidelidade: "proxima" as const, indice: 1, ctx: CTX, molde: MOLDE_CASO, leitura: LEITURA, kit: KIT };
    const a = await adaptacaoDaReferencia(e, f.deps);
    const b = await adaptacaoDaReferencia(e, f.deps);
    expect(b.bloco).toBe(a.bloco);
    expect(b.registro.guardada).toBe(true);
    expect(f.chamadas).toMatchObject({ jev: 1, cena: 1 });
    await adaptacaoDaReferencia({ ...e, ctx: { ...CTX, copy: "Outro texto da lâmina" } }, f.deps);
    expect(f.chamadas).toMatchObject({ jev: 2, cena: 2 });
  });
});

// ------------------------------------------------------------------ 6. servidor, registro e tela

describe("6. Ligação no servidor, registro e tela", () => {
  it("o bloco entra logo depois do promptDoReplicar e só no replicar", () => {
    expect(servidor).toContain("      replica.prompt,\n      adaptacao ? adaptacao.bloco : \"\",\n      blocoDoRostoAqui,\n      preferencias ?");
    // Só no Estúdio: o criativo de anúncio (Mesa Ads) fica como está.
    expect(servidor).toContain("const querAdaptar = tentaAdaptar({\n    replicar: replicar && !ads,");
    expect(servidor).toContain("fotosDoCliente: candidatos.filter((c) => !!c.fotoReplicar).length,");
    expect(servidor).toContain("kit: { fontes: marca.fontes, paleta: marca.paleta },");
    expect(servidor).toContain("...(adaptacao ? { adaptacao_da_copy: adaptacao.registro } : {}),");
    // O interruptor: true volta ao padrão (tira o campo), false grava.
    expect(servidor).toContain("if (adaptarConteudo === true) delete direcaoAntes.adaptar_conteudo_a_copy;");
    // Modelos: leitura pelo papel "leitura", cena pelo "diretor_arte"; o de imagem não muda.
    const i = servidor.indexOf("function depsDaAdaptacao(");
    const trecho = servidor.slice(i, servidor.indexOf("async function contextoDaAdaptacao(", i));
    expect(trecho).toContain('modeloDoPapel("leitura")');
    expect(trecho).toContain('modeloDoPapel("diretor_arte")');
    expect(trecho).not.toMatch(/modelo_imagem_id|chamarImagem/);
  });

  it("registro em _shared/motores.ts", () => {
    const m = MUDANCAS_DO_GERADOR_DO_ESTUDIO.find((x) => x.id === "referencia_adapta_copy")!;
    expect(m).toBeTruthy();
    for (const t of m.ligacao.trechos) expect(servidor).toContain(t);
    expect(`${m.pedido} ${m.o_que} ${m.intocado}`).not.toMatch(/[—–]/);
  });

  it("tela: ligado por padrão, aviso curto, desligar grava false e religar grava true", async () => {
    expect(adaptarLigado(undefined)).toBe(true);
    expect(adaptarLigado({ adaptar_conteudo_a_copy: false })).toBe(false);
    expect(corpoDoAdaptar(false)).toEqual({ conjunto: { adaptar_conteudo_a_copy: false } });
    expect(AJUDA_DO_ADAPTAR).not.toMatch(/[—–]/);
    const onSalvar = vi.fn(() => Promise.resolve());
    const { container, unmount } = render(h(EstudioAdaptarConteudo, { direcao: {}, onSalvar }));
    expect(screen.getByText("Estética da referência, conteúdo da sua copy.")).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Adaptar conteúdo à copy" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ conjunto: { adaptar_conteudo_a_copy: false } }));
    expect(container.textContent).not.toMatch(/[—–]/);
    unmount();
    const onReligar = vi.fn(() => Promise.resolve());
    render(h(EstudioAdaptarConteudo, { direcao: { adaptar_conteudo_a_copy: false }, onSalvar: onReligar }));
    expect(screen.getByText("Copia também o conteúdo da referência.")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Adaptar conteúdo à copy" }));
    await waitFor(() => expect(onReligar).toHaveBeenCalledWith({ conjunto: { adaptar_conteudo_a_copy: true } }));
  });
});

// ------------------------------------------------------------------ 7. rodada 2: cor do elemento e kit sem fonte

describe("7. Cor do elemento e kit sem fonte (rodada 2)", () => {
  const hexDe = (paleta: { hex?: string }[]) => paleta.map((p) => String(p.hex || "").toUpperCase()).filter(Boolean);

  it("com paleta, a cor do elemento é sempre uma do kit (a da referência nunca passa), em todos os níveis", () => {
    for (const c of CASOS_DO_REPLICAR) {
      if (!c.entrada.marca.paleta.length) continue;
      const kit = hexDe(c.entrada.marca.paleta);
      for (const f of NIVEIS) {
        const p = promptDoReplicar({ ...c.entrada, fidelidade: f }).prompt;
        const linha = p.split("\n").find((l) => l.indexOf("- Elementos gr") === 0) || "";
        for (const h of linha.match(/#[0-9A-F]{6}/gi) || []) expect(kit, `${c.nome} ${f}`).toContain(h.toUpperCase());
      }
    }
  });

  it("mapeamento determinístico: neutro vai ao neutro mais perto, colorida ao destaque do kit", () => {
    const paleta = [{ nome: "Creme", hex: "#F5F0E6", papel: "fundo" }, { nome: "Grafite", hex: "#222222", papel: "texto" }, { nome: "Laranja", hex: "#E8742A", papel: "destaque" }];
    expect(corDaMarcaNoPapel("#FFFFFF", paleta)).toBe("#F5F0E6");
    expect(corDaMarcaNoPapel("#101010", paleta)).toBe("#222222");
    expect(corDaMarcaNoPapel("#1E4FD8", paleta)).toBe("#E8742A");
    expect(corDaMarcaNoPapel("#1E4FD8", paleta)).toBe(corDaMarcaNoPapel("#1E4FD8", paleta));
  });

  it("kit sem nenhuma cor: fica o comportamento de hoje (decisão do dono), as cores da referência nos elementos", () => {
    // Não há cor do cliente para usar: sem par, o elemento leva a cor da referência, como no fixture aprovado.
    expect(corDaMarcaNoPapel("#1E4FD8", [])).toBeNull();
    expect(corDaMarcaNoPapel("#1E4FD8", [{ nome: "sem hex", hex: "azul" }])).toBeNull();
    const caso = CASOS_DO_REPLICAR.find((x) => x.nome === "post 1:1 sem paleta")!;
    const hoje = HOJE.replicar.find((x) => x.nome === "post 1:1 sem paleta")!.prompt;
    expect(promptDoReplicar(caso.entrada).prompt).toBe(hoje);
    const linha = hoje.split("\n").find((l) => l.indexOf("- Elementos gr") === 0) || "";
    expect(linha).toContain("#1E4FD8");
    expect(linha).toContain("#FF5500");
  });

  it("aviso na referência: sem fonte e sem cor mostra as duas linhas com o link; kit completo, nada", async () => {
    expect(EstudioAvisoSemFonte).toBe(EstudioAvisoDoKit);
    expect(kitSemCor(null)).toBe(true);
    expect(kitSemCor({ paleta: [{ hex: "azul" }, { hex: "#12345" }] })).toBe(true);
    expect(kitSemCor({ paleta: [{ hex: "#1F6F43" }] })).toBe(false);
    const montar = () => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, h(EstudioAvisoSemFonte, { clientId: "c1" })));
    fontesMock.linhas = [];
    fontesMock.kit = { paleta: [] };
    const a = montar();
    expect(await screen.findByText(TEXTO_SEM_FONTE)).toBeTruthy();
    expect(await screen.findByText(TEXTO_SEM_CORES)).toBeTruthy();
    for (const l of screen.getAllByText("Definir no Contexto")) expect(l.getAttribute("href")).toBe("/mesa?client=c1&aba=contexto");
    expect(`${TEXTO_SEM_FONTE} ${TEXTO_SEM_CORES}`).not.toMatch(/[—–]/);
    a.unmount();
    fontesMock.linhas = [];
    fontesMock.kit = { paleta: [{ hex: "#1F6F43" }] };
    const so = montar();
    expect(await screen.findByText(TEXTO_SEM_FONTE)).toBeTruthy();
    expect(screen.queryByText(TEXTO_SEM_CORES)).toBeNull();
    so.unmount();
    fontesMock.linhas = [{ id: "f1", nome: "Fonte Título", papel: "titulo" }];
    const b = montar();
    await new Promise((r) => setTimeout(r, 20));
    expect(b.container.textContent).toBe("");
  });
});
