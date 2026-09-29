import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente R2 (26/09), pedido do dono: rosto de qualquer foto com pessoa (pastas
 * do cliente e clones, inclusive os gerados), "como a pessoa aparece", variar e
 * compor na luz da arte, lâmina normal quando a direção pede pessoa, e a
 * conferência depois de gerar só como aviso.
 * 1. Escolher foto do acervo e de clone gerado entra na direção.
 * 2. Detalhe de pose no bloco, recriar e integrar na luz da arte.
 * 3. Prioridade de imagens (lâmina > rosto até 3 > referência > estilo e template).
 * 4. Sem rosto = hoje (fixtures da lâmina normal e do replicar).
 * 5. Tela: seletor, pílulas, filtro, estado lembrado e o aviso.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown[]> }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const q: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit", "range", "neq", "contains", "overlaps"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: mock.tabelas[tabela] || [], error: null }).then(ok, erro);
    return q;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      from: (t: string) => consulta(t),
      storage: {
        from: () => ({
          createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://assinada/${p}`, error: null })), error: null }),
          createSignedUrl: (p: string) => Promise.resolve({ data: { signedUrl: `https://assinada/${p}` }, error: null }),
          upload: () => Promise.resolve({ error: null }),
        }),
      },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { promptDoReplicar } from "../../supabase/functions/_shared/direcao-arte";
import { MUDANCAS_DO_GERADOR_DO_ESTUDIO } from "../../supabase/functions/_shared/motores";
import {
  avisoDaConferencia,
  blocoDoRosto,
  clonesNasTags,
  cloneUsavel,
  estadoDaPessoaNaLamina,
  fotoDoAcervoLiberada,
  laminaPedePessoa,
  leiturasDePessoas,
  lerComoDoRosto,
  lerItemEscolhido,
  lerRostoDoTrabalho,
  maxFotosDoRosto,
  normalizarRosto,
  PERGUNTA_PEDE_PESSOA,
  referenciaCedeAoRosto,
  SUGESTOES_DO_COMO as SUGESTOES_DO_SERVIDOR,
  vagasDoRosto,
  vistaDoCloneArquivada,
} from "../../supabase/functions/estudio-arte/rosto-na-geracao";
import EstudioRostoDaReferencia, { alternarNoComo, rostoDoTrabalho, segmentoDoRosto, SUGESTOES_DO_COMO } from "@/components/mesa/EstudioRostoDaReferencia";
import { alternarEscolha, chaveDoNavegadorDoRosto, filtrarFotos, pessoaPelosMetadados, precisaDeAutorizacao, type FotoParaRosto } from "@/components/mesa/EstudioEscolherFotoDoRosto";
import EstudioAvisoDoRosto, { deveConferirORosto } from "@/components/mesa/EstudioAvisoDoRosto";
import { CASOS_DO_REPLICAR } from "./fixtures/replicarCasos";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const servidor = ler("supabase/functions/estudio-arte/index.ts");
const HOJE_REPLICAR = JSON.parse(ler("src/test/fixtures/replicar-identica-hoje.json")) as { replicar: { nome: string; prompt: string }[] };
const HOJE_NORMAL = JSON.parse(ler("src/test/fixtures/lamina-normal-hoje.json")) as { normal: { nome: string; prompt: string }[] };

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const IMG = "33333333-3333-4333-8333-333333333333";
const IMG2 = "44444444-4444-4444-8444-444444444444";
const CLONE = "55555555-5555-4555-8555-555555555555";
const GERADA = "66666666-6666-4666-8666-666666666666";
const REGRAS = "REGRAS DE RENDER (sintético)";
const HOJE_DATA = "2026-09-26";

// ------------------------------------------------------------------ 1

describe("1. Escolher foto do acervo e de clone gerado entra na direção", () => {
  it("normaliza a fonte escolhidas: acervo, Workspace, Arquivos e clone; até 3; inválidos fora", () => {
    const r = normalizarRosto({ fonte: "escolhidas", itens: [`i:${IMG}`, `k:${CLONE}:${GERADA}`, "i:x", `w:${IMG2}`, `a:${IMG2}`, `i:${IMG}`], destacar: true, como: "  sorrindo —  de perfil \n" }, CLIENTE);
    expect(r).toEqual({ fonte: "escolhidas", itens: [`i:${IMG}`, `k:${CLONE}:${GERADA}`, `w:${IMG2}`], como: "sorrindo , de perfil", destacar: true });
    expect(lerRostoDoTrabalho({ rosto: { fonte: "escolhidas", itens: [`k:${CLONE}:${GERADA}`] } }, CLIENTE)).toEqual({ fonte: "escolhidas", itens: [`k:${CLONE}:${GERADA}`] });
    expect(normalizarRosto({ fonte: "escolhidas", itens: [] }, CLIENTE)).toBeNull();
    expect(normalizarRosto({ fonte: "escolhidas", itens: ["k:1:2"] }, CLIENTE)).toBeNull();
    expect(lerItemEscolhido(`k:${CLONE}:${GERADA}`)).toEqual({ tipo: "clone", clone: CLONE, id: GERADA });
    expect(lerItemEscolhido(`w:${IMG}`)).toEqual({ tipo: "workspace", id: IMG });
    expect(maxFotosDoRosto({ fonte: "escolhidas" })).toBe(3);
    expect(maxFotosDoRosto({ fonte: "fotos" })).toBe(2);
    // "como" também nas outras fontes, sem mudar o que já era gravado sem ele.
    expect(normalizarRosto({ fonte: "cliente", id: `r:${IMG}`, como: "séria confiante" }, CLIENTE)).toEqual({ fonte: "cliente", id: `r:${IMG}`, como: "séria confiante" });
    expect(lerComoDoRosto("x".repeat(400)).length).toBe(160);
  });

  it("autorização do clone conferida como hoje; foto do acervo ligada a clone revogado não entra", () => {
    const valido = { origem: "clone_de_foto_real", status: "pronta", autorizacao: { confirmada: true } };
    const revogado = { ...valido, autorizacao: { confirmada: true, revogada_em: "2026-09-01" } };
    expect(cloneUsavel(valido, HOJE_DATA)).toBe(true);
    expect(cloneUsavel({ ...valido, status: "arquivada" }, HOJE_DATA)).toBe(false);
    expect(cloneUsavel(revogado, HOJE_DATA)).toBe(false);
    expect(cloneUsavel({ ...valido, origem: "sintetica" }, HOJE_DATA)).toBe(false);
    expect(fotoDoAcervoLiberada([], HOJE_DATA)).toBe(true);
    expect(fotoDoAcervoLiberada([revogado], HOJE_DATA)).toBe(false);
    expect(fotoDoAcervoLiberada([revogado, valido], HOJE_DATA)).toBe(true);
    expect(clonesNasTags(["mesa_foto", `clone:${CLONE}`, "clone:x"])).toEqual([CLONE]);
    expect(vistaDoCloneArquivada({ arquivada_em: null, avisos: ["arquivada_em:2026-09-20"] })).toBe(true);
    expect(vistaDoCloneArquivada({ arquivada_em: null, avisos: [] })).toBe(false);
  });

  it("servidor: cada item conferido na geração e ao salvar; clone só usável; ações registradas", () => {
    const i = servidor.indexOf("async function localDoItemEscolhido(");
    const corpo = servidor.slice(i, servidor.indexOf("async function urlsDasMiniaturas(", i));
    expect(corpo).toContain('.eq("client_id", t.client_id)');
    expect(corpo).toContain("if (!ligados || !fotoDoAcervoLiberada(ligados)) return null;");
    expect(corpo).toContain("if (!c || !cloneUsavel(c)) return null;");
    expect(corpo).toContain("!vistaDoCloneArquivada(vista)");
    expect(servidor).toContain('if (rosto.fonte === "escolhidas") {');
    expect(servidor).toContain('if (rostoPedido && rostoPedido.fonte === "escolhidas" && !(await fotosDoRostoEscolhido(t, rostoPedido)');
    for (const a of ["rostos_fotos: fotosParaORosto,", "rostos_marcar: marcarPessoasNasFotos,", "conferir_rosto: conferirRosto,"]) expect(servidor).toContain(a);
    // Miniatura própria, nunca a transformação do Storage.
    const fotos = servidor.slice(servidor.indexOf("async function urlsDasMiniaturas("), servidor.indexOf("const caminhoDasPessoas"));
    expect(fotos).toContain(".mini.jpg");
    expect(fotos).not.toMatch(/transform\s*:/);
  });

  it("leitura tem pessoa: uma chamada para até 12, guardada, e as já lidas não pagam", () => {
    expect(leiturasDePessoas({ fotos: [{ imagem: 1, pessoa: true, rosto_visivel: true }, { imagem: 2, pessoa: false, rosto_visivel: true }, { imagem: 9, pessoa: true }] }, [`i:${IMG}`, `w:${IMG2}`], "agora")).toEqual({
      [`i:${IMG}`]: { pessoa: true, rosto: true, lido_em: "agora" },
      [`w:${IMG2}`]: { pessoa: false, rosto: false, lido_em: "agora" },
    });
    const m = servidor.slice(servidor.indexOf("async function marcarPessoasNasFotos("), servidor.indexOf("async function conferirRosto("));
    expect(m).toContain(".slice(0, MAX_FOTOS_POR_LEITURA)");
    expect(m).toContain("const faltam = pedidos.filter((id) => !guardadas[id]);");
    expect(m).toContain("if (!faltam.length) return json({ leituras: guardadas, lidas: 0, custo_usd: 0 });");
    expect(m).toContain("await guardarLeitura(caminhoDasPessoas(t.client_id)");
  });
});

// ------------------------------------------------------------------ 2

describe("2. Detalhe de pose no bloco; recriar e integrar na luz da arte", () => {
  it("bloco com o como, na ordem: identidade, só identidade, pose pedida, recriar, lugar, luz da arte, destacar", () => {
    const b = blocoDoRosto({ indices: [3, 4, 5], destacar: true, pessoaNaReferencia: true, como: "sorrindo, apontando para o título" });
    expect(b).toContain("A pessoa desta lâmina é a das imagens 3, 4 e 5");
    const ordem = ["ROSTO ESCOLHIDO PELA EQUIPE", "Dessas fotos vem só a identidade", "COMO ELA APARECE (pedido da equipe): sorrindo, apontando para o título.", "RECRIE a pessoa dentro da composição", "a pessoa da referência nunca aparece", "INTEGRADA NA LUZ DA ARTE, não na da foto", "sombra de contato", "sem escurecer a foto", "ROSTO EM EVIDÊNCIA"];
    let ultimo = -1;
    for (const t of ordem) {
      const i = b.indexOf(t);
      expect(i, t).toBeGreaterThan(ultimo);
      ultimo = i;
    }
    expect(b).not.toMatch(/[—–]/);
    // Sem como: nada de pose pedida; o resto igual.
    expect(blocoDoRosto({ indices: [2], destacar: false, pessoaNaReferencia: false })).not.toContain("COMO ELA APARECE");
    // Lâmina normal: a direção da lâmina, não a referência.
    const n = blocoDoRosto({ indices: [4], destacar: false, pessoaNaReferencia: false, modo: "lamina", como: "de perfil" });
    expect(n).toContain("seguem a arte (a direção desta lâmina)");
    expect(n).toContain("no lugar e na escala que a direção pede para a pessoa");
    expect(n).not.toContain("referência");
  });

  it("servidor passa o como ao bloco do replicar e guarda na versão o como e as fotos usadas", () => {
    expect(servidor).toContain('pessoaNaReferencia: !!(refsNoPrompt[0].molde && refsNoPrompt[0].molde.assunto && refsNoPrompt[0].molde.assunto.tipo === "pessoa"), como: rostoEscolhido ? rostoEscolhido.como : undefined, daFoto: rostoVeioDaFoto })');
    expect(servidor).toContain("...registroDoRosto(rostoEscolhido, fotosUsadasDoRosto)");
    expect(servidor).toContain("...(usadas.length ? { fotos_usadas: usadas.slice(0, MAX_FOTOS_ESCOLHIDAS) } : {}),");
  });
});

// ------------------------------------------------------------------ 3

describe("3. Prioridade de imagens", () => {
  it("rosto até 3 dentro do limite do modelo; a referência automática cede a vaga", () => {
    expect(vagasDoRosto({ usadas: 4, limiteDoModelo: 16, pedidas: 3, max: 3 })).toBe(3);
    expect(vagasDoRosto({ usadas: 4, limiteDoModelo: 16, pedidas: 3 })).toBe(2);
    expect(vagasDoRosto({ usadas: 6, limiteDoModelo: 8, pedidas: 3, max: 3 })).toBe(2);
    expect(referenciaCedeAoRosto({ anexos: 6, limiteDoModelo: 8, pedidas: 3 })).toBe(true);
    expect(referenciaCedeAoRosto({ anexos: 4, limiteDoModelo: 16, pedidas: 3 })).toBe(false);
    expect(referenciaCedeAoRosto({ anexos: 8, limiteDoModelo: 8, pedidas: 0 })).toBe(false);
  });

  it("no gerarCard: lâmina (anexos) > rosto > estilo e template; a referência automática sai antes dos anexos", () => {
    const i = (t: string) => {
      const k = servidor.indexOf(t);
      expect(k, t).toBeGreaterThan(0);
      return k;
    };
    const cede = i('for (let i = candidatos.length - 1; i >= 0; i--) if (candidatos[i].tipo === "identidade") candidatos.splice(i, 1);');
    expect(cede).toBeLessThan(i("const escolhidosDaLamina = anexosDaLamina(candidatos, { base: temBase });"));
    const normal = i("  if (rostoDaNormal) {\n    const vagas = vagasDoRosto(");
    expect(normal).toBeGreaterThan(i("for (const c of escolhidosDaLamina) {"));
    expect(normal).toBeLessThan(i("const estiloDoCliente = await estiloNaGeracao(t, {"));
    expect(i("const blocoDoRostoNaNormal = rostoDaNormal && indicesDoRosto.length")).toBeLessThan(i("const blocoDoTemplate = await templateNaLamina("));
    expect(servidor).toContain("max: maxFotosDoRosto(rostoEscolhido) });");
  });
});

// ------------------------------------------------------------------ 4

describe("4. Sem rosto = hoje", () => {
  const REPLICAR = (p: string, rosto: string) => [p, "", rosto, "", "", "", "", "", REGRAS].filter(Boolean).join("\n\n");
  const NORMAL = (base: string, rosto: string) => `${[base, rosto, "", "", "", "", "", "", "", ""].filter(Boolean).join("\n\n")}\n\n${REGRAS}`;

  it("replicar: o rosto não entra no promptDoReplicar e, vazio, não acrescenta nada ao fixture", () => {
    // O byte a byte do promptDoReplicar contra o fixture é cobrado em referencia-rosto.test.ts (frente R).
    expect(HOJE_REPLICAR.replicar.length).toBe(CASOS_DO_REPLICAR.length);
    HOJE_REPLICAR.replicar.forEach((c) => expect(REPLICAR(c.prompt, "")).toBe(`${c.prompt}\n\n${REGRAS}`));
    CASOS_DO_REPLICAR.forEach((c) => expect(promptDoReplicar(c.entrada).prompt).not.toContain("ROSTO ESCOLHIDO"));
    const chamada = servidor.slice(servidor.indexOf("const replica = promptDoReplicar({"), servidor.indexOf("// Frente E: variedade com memória"));
    expect(chamada).not.toMatch(/rosto/i);
  });

  it("lâmina normal: bloco vazio, o prompt do fixture fica igual; com rosto é só acréscimo depois da base", () => {
    const bloco = blocoDoRosto({ indices: [5], destacar: false, pessoaNaReferencia: false, modo: "lamina", como: "sorrindo" });
    for (const c of HOJE_NORMAL.normal) {
      expect(NORMAL(c.prompt, "")).toBe(`${c.prompt}\n\n${REGRAS}`);
      expect(NORMAL(c.prompt, bloco)).toBe(`${c.prompt}\n\n${bloco}\n\n${REGRAS}`);
    }
    expect(servidor).toContain("  const baseComCampanha = [\n    base,\n    // Frente R2: rosto escolhido na lâmina normal que pede pessoa (vazio sem rosto: o de hoje).\n    blocoDoRostoNaNormal,\n    campanha ? blocoDaCampanha(campanha) : \"\",");
  });

  it("sem rosto o Jev nem é chamado; fora do normal (foto, recorte, elementos, anúncio, replicar) também não", () => {
    // Frente RO (29/09): a foto da lâmina em "Usar o rosto" entra na frente; sem ela (rostoDaFotoNaNormal null), o de antes.
    expect(servidor).toContain("const rostoNaNormal = rostoDaFotoNaNormal || (!replicar && !ads && !baseFoto && !recorteNaLamina && elementos.length === 0 ? lerRostoDoTrabalho(t.direcao, t.client_id) : null);");
    expect(servidor).toContain("const pedePessoa = rostoNaNormal && !rostoDaFotoNaNormal ? await direcaoPedePessoa(t, cardDoPrompt, rostoNaNormal, ch.userId, avisosDaGeracao) : null;");
    expect(servidor).toContain("const rostoDaNormal = rostoDaFotoNaNormal || (rostoNaNormal && laminaPedePessoa(pedePessoa) ? rostoNaNormal : null);");
    // Replicar: sem foto em "Usar o rosto", a linha da frente R (lerRostoDoTrabalho) vale.
    expect(servidor).toContain("const rostoEscolhido = replicar && fotosReplicar.length === 0 ? rostoDaFotoNoReplicar || lerRostoDoTrabalho(t.direcao, t.client_id) : null;");
    for (const d of [{}, null, { rosto: null }, { rosto: { fonte: "escolhidas", itens: [] } }]) expect(lerRostoDoTrabalho(d, CLIENTE)).toBeNull();
    // Jev falhou (null) ou abaixo do limiar: sem rosto.
    expect(laminaPedePessoa(null)).toBe(false);
    expect(laminaPedePessoa(0.49)).toBe(false);
    expect(laminaPedePessoa(0.5)).toBe(true);
    const e = estadoDaPessoaNaLamina({ funcao: "capa", texto_exato: "Olá", composicao: "retrato da dentista sorrindo", destacar: true, como: "sorrindo" });
    expect(e.lamina.composicao).toBe("retrato da dentista sorrindo");
    expect(e.pedido_da_equipe).toEqual({ rosto_em_destaque: true, como_a_pessoa_aparece: "sorrindo" });
    expect(PERGUNTA_PEDE_PESSOA.type).toBe("noul");
  });

  it("registro em _shared/motores.ts (rosto_v2) com trechos que existem", () => {
    const m = MUDANCAS_DO_GERADOR_DO_ESTUDIO.find((x) => x.id === "rosto_v2")!;
    expect(m).toBeTruthy();
    for (const t of m.ligacao.trechos) expect(servidor).toContain(t);
    expect(`${m.pedido} ${m.o_que} ${m.intocado}`).not.toContain("—");
  });
});

// ------------------------------------------------------------------ 5

const montar = (filho: any) => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, filho));

const ACERVO = [
  { id: IMG, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/ana.jpg`, nome: "Ana na recepção", pasta: "Mesa Foto", categoria: "pessoa", tags: [], descricao: null, origem: "mesa_foto", workspace_node_id: null },
  { id: IMG2, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/ana-fachada.jpg`, nome: "Ana fachada", pasta: "Mesa Foto", categoria: "fachada", tags: [], descricao: null, origem: "mesa_foto", workspace_node_id: null },
];
const RESPOSTA_FOTOS = {
  escolhidas: [],
  leituras: { [`i:${IMG2}`]: { pessoa: false, rosto: false } },
  clones: [{ id: CLONE, nome: "Ana clone", grupo: "cliente", fotos: [{ id: `k:${CLONE}:${GERADA}`, nome: "Ana (variação: sorrindo)", papel: "gerada", url: "https://assinada/gerada.mini.jpg" }] }],
};

describe("5. Tela", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
    mock.tabelas = { cliente_imagens: ACERVO, workspace_nodes: [], files: [] };
    try {
      window.localStorage.clear();
    } catch {
      /* sem armazenamento */
    }
    mock.invoke.mockImplementation((_f: string, o: { body: Record<string, unknown> }) => {
      if (o.body.acao === "rostos_fotos") return Promise.resolve({ data: RESPOSTA_FOTOS, error: null });
      return Promise.resolve({ data: { cliente: [], equipe: [] }, error: null });
    });
  });
  afterEach(() => vi.useRealTimers());

  it("helpers: rosto escolhido lido pela tela, segmento Fotos, pílulas, filtro e máximo de 3", () => {
    expect(rostoDoTrabalho({ rosto: { fonte: "escolhidas", itens: [`i:${IMG}`], como: "sorrindo" } })).toEqual({ fonte: "escolhidas", itens: [`i:${IMG}`], destacar: false, como: "sorrindo" });
    expect(segmentoDoRosto({ fonte: "escolhidas", itens: [`i:${IMG}`] })).toBe("fotos");
    expect(SUGESTOES_DO_COMO).toEqual(SUGESTOES_DO_SERVIDOR);
    expect(alternarNoComo("", "sorrindo")).toBe("sorrindo");
    expect(alternarNoComo("sorrindo", "de perfil")).toBe("sorrindo, de perfil");
    expect(alternarNoComo("sorrindo, de perfil", "Sorrindo")).toBe("de perfil");
    expect(pessoaPelosMetadados({ categoria: "equipe" })).toBe(true);
    expect(pessoaPelosMetadados({ categoria: "produto", tags: ["tipo:pessoa"] })).toBe(true);
    expect(pessoaPelosMetadados({ categoria: "logo" })).toBe(false);
    expect(pessoaPelosMetadados({ categoria: "ambiente" })).toBeNull();
    const f = (id: string, pessoa: boolean | null, busca: string): FotoParaRosto => ({ id, nome: id, pasta: "", bucket: "mesa", caminho: "x", pessoa, busca });
    const lista = [f("a", true, "Ana"), f("b", false, "Ana fachada"), f("c", null, "Bruno")];
    expect(filtrarFotos(lista, { soPessoas: true, busca: "" }).map((x) => x.id)).toEqual(["a", "c"]);
    expect(filtrarFotos(lista, { soPessoas: false, busca: "ana" }).map((x) => x.id)).toEqual(["a", "b"]);
    expect(alternarEscolha(["1", "2", "3"], "4")).toEqual({ lista: ["1", "2", "3"], cheio: true });
    expect(alternarEscolha(["1", "2"], "1")).toEqual({ lista: ["2"], cheio: false });
    expect(precisaDeAutorizacao([`k:${CLONE}:${GERADA}`])).toBe(false);
    expect(precisaDeAutorizacao([`k:${CLONE}:${GERADA}`, `i:${IMG}`])).toBe(true);
  });

  it("Fotos > Escolher foto: acervo (com filtro de pessoa) e clone gerado; autorização; grava escolhidas", async () => {
    const onSalvar = vi.fn(() => Promise.resolve());
    montar(h(EstudioRostoDaReferencia, { trabalhoId: "t1", clientId: CLIENTE, direcao: {}, onSalvar }));
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Nenhum", "Cliente", "Equipe", "Fotos"]);
    fireEvent.click(screen.getByRole("radio", { name: "Fotos" }));
    fireEvent.click(screen.getByRole("button", { name: /Escolher foto/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Acervo", "Workspace", "Arquivos", "Clones"]);
    // Busca em todas as pastas: a foto sem pessoa (leitura guardada) some com o filtro ligado.
    fireEvent.change(screen.getByLabelText("Buscar foto"), { target: { value: "ana" } });
    const ana = await screen.findByTitle("Ana na recepção");
    expect(screen.queryByTitle("Ana fachada")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Só com pessoa" }));
    expect(await screen.findByTitle("Ana fachada")).toBeTruthy();
    fireEvent.click(ana);
    // Clones: a foto GERADA do clone.
    fireEvent.click(screen.getByRole("tab", { name: "Clones" }));
    fireEvent.click(await screen.findByTitle("Ana (variação: sorrindo)"));
    const usar = screen.getByRole("button", { name: "Usar fotos" }) as HTMLButtonElement;
    expect(usar.disabled).toBe(true); // falta a autorização (a do acervo não é de clone)
    fireEvent.click(screen.getByRole("checkbox", { name: "Tenho a autorização de uso da imagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar fotos" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ conjunto: { rosto: { fonte: "escolhidas", itens: [`i:${IMG}`, `k:${CLONE}:${GERADA}`], destacar: false } } }));
    // O que a tela grava o servidor aceita como está (entra na direção).
    const gravado = (onSalvar.mock.calls[0] as any)[0].conjunto.rosto;
    expect(normalizarRosto(gravado, CLIENTE)).toEqual({ fonte: "escolhidas", itens: [`i:${IMG}`, `k:${CLONE}:${GERADA}`] });
    expect(mock.invoke.mock.calls.some((c: any[]) => c[1].body.acao === "rostos_fotos")).toBe(true);
  });

  it("aba, pasta, filtro e busca lembrados por trabalho", async () => {
    const primeiro = montar(h(EstudioRostoDaReferencia, { trabalhoId: "t9", clientId: CLIENTE, direcao: {}, onSalvar: vi.fn() }));
    fireEvent.click(screen.getByRole("radio", { name: "Fotos" }));
    fireEvent.click(screen.getByRole("button", { name: /Escolher foto/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("tab", { name: "Clones" }));
    fireEvent.click(screen.getByRole("switch", { name: "Só com pessoa" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const guardado = Object.keys(window.localStorage).find((k) => k.indexOf(chaveDoNavegadorDoRosto("t9")) >= 0);
    expect(guardado).toBeTruthy();
    primeiro.unmount();
    montar(h(EstudioRostoDaReferencia, { trabalhoId: "t9", clientId: CLIENTE, direcao: {}, onSalvar: vi.fn() }));
    fireEvent.click(screen.getByRole("radio", { name: "Fotos" }));
    fireEvent.click(screen.getByRole("button", { name: /Escolher foto/ }));
    await screen.findByRole("dialog");
    expect(screen.getByRole("tab", { name: "Clones" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("switch", { name: "Só com pessoa" }).getAttribute("aria-checked")).toBe("false");
  });

  it("Como a pessoa aparece: pílula grava no rosto; texto livre grava ao sair do campo; Nenhum sem o campo", async () => {
    const onSalvar = vi.fn(() => Promise.resolve());
    const { unmount } = montar(h(EstudioRostoDaReferencia, { trabalhoId: "t1", clientId: CLIENTE, direcao: { rosto: { fonte: "cliente", id: `r:${IMG}` } }, onSalvar }));
    expect(screen.getByText("Como a pessoa aparece")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sorrindo" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ conjunto: { rosto: { fonte: "cliente", id: `r:${IMG}`, destacar: false, como: "sorrindo" } } }));
    unmount();
    const onSalvar2 = vi.fn(() => Promise.resolve());
    montar(h(EstudioRostoDaReferencia, { trabalhoId: "t2", clientId: CLIENTE, direcao: { rosto: { fonte: "cliente", id: `r:${IMG}`, como: "sorrindo" } }, onSalvar: onSalvar2 }));
    const campo = screen.getByLabelText("Como a pessoa aparece") as HTMLInputElement;
    expect(campo.value).toBe("sorrindo");
    expect(screen.getByRole("button", { name: "sorrindo" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(campo, { target: { value: "rindo com a mão no rosto" } });
    fireEvent.blur(campo);
    await waitFor(() => expect(onSalvar2).toHaveBeenCalledWith({ conjunto: { rosto: { fonte: "cliente", id: `r:${IMG}`, destacar: false, como: "rindo com a mão no rosto" } } }));
  });

  it("Nenhum por padrão: nada de campo, nada de servidor", () => {
    montar(h(EstudioRostoDaReferencia, { trabalhoId: "t1", clientId: CLIENTE, direcao: {}, onSalvar: vi.fn() }));
    expect(screen.queryByText("Como a pessoa aparece")).toBeNull();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
});

describe("6. Conferência depois de gerar: só aviso", () => {
  beforeEach(() => mock.invoke.mockReset());
  const versao = (extra: Record<string, unknown> = {}) => ({ ordem: 2, versao: 3, storage_path: "c/estudio/t/2-3.png", verificacao: { pendente: false }, rosto: { fotos_usadas: [{ bucket: "mesa", caminho: "c/foto.jpg" }] }, ...extra });

  it("só pede com rosto usado, sem conferência guardada e depois da conferência da lâmina", () => {
    expect(deveConferirORosto(null)).toBe(false);
    expect(deveConferirORosto(versao({ rosto: null }))).toBe(false);
    expect(deveConferirORosto(versao())).toBe(true);
    expect(deveConferirORosto(versao({ conferencia_rosto: { aviso: false } }))).toBe(false);
    expect(deveConferirORosto(versao({ verificacao: { pendente: true }, criado_em: new Date().toISOString() }))).toBe(false);
    expect(deveConferirORosto(versao({ verificacao: { pendente: true }, criado_em: "2026-09-26T10:00:00Z" }), Date.parse("2026-09-26T10:05:00Z"))).toBe(true);
  });

  it("chama conferir_rosto uma vez e mostra o aviso discreto; guardado não chama", async () => {
    mock.invoke.mockResolvedValue({ data: { conferencia: { aviso: true, resumo: "O rosto pode não ser o da pessoa escolhida. Confira antes de aprovar." } }, error: null });
    const { unmount } = montar(h(EstudioAvisoDoRosto, { trabalhoId: "t1", versao: versao() }));
    expect(await screen.findByText(/O rosto pode não ser o da pessoa escolhida/)).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke.mock.calls[0][1].body).toMatchObject({ acao: "conferir_rosto", trabalho_id: "t1", ordem: 2, versao: 3 });
    unmount();
    mock.invoke.mockClear();
    montar(h(EstudioAvisoDoRosto, { trabalhoId: "t1", versao: versao({ conferencia_rosto: { aviso: false, resumo: "Rosto conferido" } }) }));
    expect(screen.queryByText(/Rosto conferido/)).toBeNull();
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("servidor: guardada não paga de novo, sem laço de regerar, Jev só como aviso", () => {
    const c = servidor.slice(servidor.indexOf("async function conferirRosto("), servidor.indexOf("function registroDoRosto("));
    expect(c).toContain("if (ja && typeof ja === \"object\") return json(");
    expect(c).toContain("questions: { outra_pessoa: PERGUNTA_OUTRA_PESSOA }");
    expect(c).not.toContain("gerarCard(");
    expect(c).not.toContain("corrigirCard(");
    expect(avisoDaConferencia({ pessoaNaArte: true, outraPessoa: 0.8 }).aviso).toBe(true);
    expect(avisoDaConferencia({ pessoaNaArte: false, outraPessoa: null }).aviso).toBe(true);
    expect(avisoDaConferencia({ pessoaNaArte: true, outraPessoa: 0.2 }).aviso).toBe(false);
    expect(avisoDaConferencia({ pessoaNaArte: null, outraPessoa: null }).aviso).toBe(false);
  });
});
