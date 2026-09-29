import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente R, acréscimo do dono (26/09): rosto escolhido na referência.
 * 1. Sem rosto (o padrão): nada é lido, nenhuma imagem entra e o prompt é o
 *    de hoje, byte a byte.
 * 2. Com rosto: fotos com papel nomeado, no limite do modelo, e o bloco curto
 *    ROSTO ESCOLHIDO (destacar opcional), logo depois do bloco da copy.
 * 3. Só rosto autorizado; fotos na hora só da pasta do cliente.
 * 4. Tela: seletor de 4 opções, Nenhum tira, miniaturas próprias.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }), upload: () => Promise.resolve({ error: null }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { promptDoReplicar } from "../../supabase/functions/_shared/direcao-arte";
import { MUDANCAS_DO_GERADOR_DO_ESTUDIO } from "../../supabase/functions/_shared/motores";
import {
  autorizacaoDoCloneValida,
  blocoDoRosto,
  lerRostoDoTrabalho,
  normalizarRosto,
  ROTULO_DA_FOTO_DO_ROSTO,
  vagasDoRosto,
} from "../../supabase/functions/estudio-arte/rosto-na-geracao";
import EstudioRostoDaReferencia, { AJUDA_DO_ROSTO, corpoDoRosto, OPCOES_DO_ROSTO, rostoDoTrabalho } from "@/components/mesa/EstudioRostoDaReferencia";
import { CASOS_DO_REPLICAR } from "./fixtures/replicarCasos";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const HOJE = JSON.parse(ler("src/test/fixtures/replicar-identica-hoje.json")) as { replicar: { nome: string; prompt: string }[] };
const servidor = ler("supabase/functions/estudio-arte/index.ts");

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const ROSTO = "22222222-2222-2222-2222-222222222222";
const REGRAS = "REGRAS DE RENDER (sintético)";
const compoe = (prompt: string, blocoDaCopia: string, blocoDoRosto: string) => [prompt, blocoDaCopia, blocoDoRosto, "", "", "", "", "", REGRAS].filter(Boolean).join("\n\n");

describe("1. Sem rosto: o de hoje, byte a byte", () => {
  it("direcao sem rosto, nula ou inválida: null", () => {
    for (const d of [{}, null, undefined, { rosto: null }, { rosto: { fonte: "outra" } }, { rosto: { fonte: "cliente" } }, { rosto: { fonte: "cliente", id: "x" } }, { rosto: { fonte: "fotos", fotos: [] } }]) {
      expect(lerRostoDoTrabalho(d, CLIENTE)).toBeNull();
    }
  });

  it("sem rosto o bloco é vazio e o prompt do replicar é o do fixture", () => {
    expect(blocoDoRosto({ indices: [], destacar: true, pessoaNaReferencia: true })).toBe("");
    CASOS_DO_REPLICAR.forEach((c, i) => {
      const p = promptDoReplicar(c.entrada).prompt;
      expect(p).toBe(HOJE.replicar[i].prompt);
      expect(compoe(p, "", "")).toBe(`${HOJE.replicar[i].prompt}\n\n${REGRAS}`);
    });
  });

  it("no servidor o rosto só é lido no replicar, sem foto do cliente, e nada entra sem ele", () => {
    // Frente RO: sem foto da lâmina em "Usar o rosto" (rostoDaFotoNoReplicar null), o rosto do trabalho, como antes.
    expect(servidor).toContain("const rostoEscolhido = replicar && fotosReplicar.length === 0 ? rostoDaFotoNoReplicar || lerRostoDoTrabalho(t.direcao, t.client_id) : null;");
    expect(servidor).toContain("if (rostoEscolhido) {\n    const fotosDoRosto = rostoDaFotoNoReplicar\n      ? fotosDeIdentidade\n      : await fotosDoRostoEscolhido(t, rostoEscolhido)");
    expect(servidor).toContain("const blocoDoRostoAqui = indicesDoRosto.length\n");
    // As fotos do rosto entram depois dos anexos da lâmina e antes do estilo (que conta com elas no teto).
    const i = servidor.indexOf("const rostoEscolhido = replicar");
    expect(i).toBeGreaterThan(servidor.indexOf("for (const c of escolhidosDaLamina) {"));
    expect(i).toBeLessThan(servidor.indexOf("const estiloDoCliente = await estiloNaGeracao(t, {"));
    expect(servidor).toContain("const rotuloDoRosto = rostoVeioDaFoto ? ROTULO_DA_FOTO_DE_IDENTIDADE : ROTULO_DA_FOTO_DO_ROSTO;");
    expect(servidor).toContain("rotulos.push(rotuloDoRosto);");
  });
});

describe("2. Com rosto: fotos nomeadas, limite do modelo e bloco curto", () => {
  it("vagas: até 2, dentro do limite do modelo (lâmina primeiro, estilo fica com o que sobrar)", () => {
    expect(vagasDoRosto({ usadas: 4, limiteDoModelo: 16, pedidas: 2 })).toBe(2);
    expect(vagasDoRosto({ usadas: 6, limiteDoModelo: 7, pedidas: 2 })).toBe(1);
    expect(vagasDoRosto({ usadas: 8, limiteDoModelo: 8, pedidas: 2 })).toBe(0);
    expect(vagasDoRosto({ usadas: 1, limiteDoModelo: 16, pedidas: 4 })).toBe(2);
  });

  it("bloco: identidade muito fiel, pose e enquadramento da arte, lugar da pessoa da referência e destacar", () => {
    const b = blocoDoRosto({ indices: [5, 6], destacar: false, pessoaNaReferencia: true });
    expect(b.startsWith("ROSTO ESCOLHIDO PELA EQUIPE")).toBe(true);
    expect(b).toContain("A pessoa desta lâmina é a das imagens 5 e 6");
    expect(b).toContain("A pose, o ângulo, a expressão, o enquadramento, a roupa, o fundo e a luz seguem a arte");
    expect(b).toContain("a pessoa da referência nunca aparece");
    expect(b).toContain("sem escurecer a foto");
    expect(b).not.toContain("ROSTO EM EVIDÊNCIA");
    const um = blocoDoRosto({ indices: [3], destacar: true, pessoaNaReferencia: false });
    expect(um).toContain("A pessoa desta lâmina é a da imagem 3");
    expect(um).toContain("no lugar e na escala do assunto da referência");
    expect(um).toContain("ROSTO EM EVIDÊNCIA");
    for (const x of [b, um, ROTULO_DA_FOTO_DO_ROSTO, AJUDA_DO_ROSTO]) expect(x).not.toMatch(/[—–]/);
    expect(ROTULO_DA_FOTO_DO_ROSTO).toContain("não copiar a pose, o fundo, a roupa nem a luz");
  });

  it("com rosto, o prompt de hoje fica como prefixo e o bloco vem depois do da copy", () => {
    const b = blocoDoRosto({ indices: [4], destacar: true, pessoaNaReferencia: true });
    const p = HOJE.replicar[0].prompt;
    expect(compoe(p, "", b)).toBe(`${p}\n\n${b}\n\n${REGRAS}`);
    expect(compoe(p, "COPIA", b)).toBe(`${p}\n\nCOPIA\n\n${b}\n\n${REGRAS}`);
  });

  it("registro em _shared/motores.ts", () => {
    const m = MUDANCAS_DO_GERADOR_DO_ESTUDIO.find((x) => x.id === "rosto_na_referencia")!;
    expect(m).toBeTruthy();
    for (const t of m.ligacao.trechos) expect(servidor).toContain(t);
  });
});

describe("3. Só rosto autorizado", () => {
  it("normaliza: cliente e equipe por r: ou c: com uuid; fotos só da pasta do cliente, até 2", () => {
    expect(normalizarRosto({ fonte: "cliente", id: `r:${ROSTO}`, destacar: true }, CLIENTE)).toEqual({ fonte: "cliente", id: `r:${ROSTO}`, destacar: true });
    expect(normalizarRosto({ fonte: "equipe", id: `c:${ROSTO}` }, CLIENTE)).toEqual({ fonte: "equipe", id: `c:${ROSTO}` });
    expect(normalizarRosto({ fonte: "equipe", id: ROSTO }, CLIENTE)).toBeNull();
    const fotos = normalizarRosto({ fonte: "fotos", fotos: [`${CLIENTE}/estudio/rostos/a.jpg`, "outro/estudio/b.jpg", `${CLIENTE}/../x.jpg`, `${CLIENTE}/estudio/rostos/c.png`, `${CLIENTE}/estudio/rostos/d.png`] }, CLIENTE);
    expect(fotos).toEqual({ fonte: "fotos", fotos: [`${CLIENTE}/estudio/rostos/a.jpg`, `${CLIENTE}/estudio/rostos/c.png`] });
    expect(normalizarRosto({ fonte: "fotos", fotos: ["outro/a.jpg"] }, CLIENTE)).toBeNull();
  });

  it("clone: autorização confirmada, sem revogação e dentro da validade", () => {
    expect(autorizacaoDoCloneValida({ confirmada: true }, "2026-09-26")).toBe(true);
    expect(autorizacaoDoCloneValida({ confirmada: false }, "2026-09-26")).toBe(false);
    expect(autorizacaoDoCloneValida({ confirmada: true, revogada_em: "2026-09-01" }, "2026-09-26")).toBe(false);
    expect(autorizacaoDoCloneValida({ confirmada: true, validade: "2026-09-25" }, "2026-09-26")).toBe(false);
    expect(autorizacaoDoCloneValida(null)).toBe(false);
  });

  it("servidor: rosto do contexto só ativo; clone só com autorização válida; indisponível recusa com mensagem", () => {
    expect(servidor).toContain("return r && r.ativa ? [{ bucket: \"mesa\", caminho: r.storage_path, nome: \"rosto-1\" }] : [];");
    expect(servidor).toContain("!autorizacaoDoCloneValida(c.autorizacao)) return [];");
    expect(servidor).toContain('"rosto_indisponivel"');
    // Miniatura própria, nunca a transformação do Storage.
    const i = servidor.indexOf("async function rostosDisponiveis(");
    const trecho = servidor.slice(i, servidor.indexOf("// ------------------------------------------------ prancha de referências", i));
    expect(trecho).toContain(".mini.jpg");
    expect(trecho).not.toMatch(/transform\s*:/);
  });
});

describe("4. Tela", () => {
  beforeEach(() => mock.invoke.mockReset());
  const montar = (filho: any) => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, filho));

  it("lê e grava o rosto do trabalho", () => {
    expect(rostoDoTrabalho({})).toBeNull();
    expect(rostoDoTrabalho({ rosto: { fonte: "cliente", id: `r:${ROSTO}`, destacar: true } })).toEqual({ fonte: "cliente", id: `r:${ROSTO}`, destacar: true });
    expect(corpoDoRosto(null)).toEqual({ conjunto: { rosto: null } });
    expect(OPCOES_DO_ROSTO.map((o) => o.rotulo)).toEqual(["Nenhum", "Cliente", "Equipe", "Fotos"]);
  });

  it("Nenhum marcado por padrão, sem chamar o servidor", () => {
    montar(h(EstudioRostoDaReferencia, { trabalhoId: "t1", clientId: CLIENTE, direcao: {}, onSalvar: vi.fn() }));
    const radios = screen.getAllByRole("radio");
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(screen.queryByText("Destacar o rosto")).toBeNull();
  });

  it("Cliente lista os rostos e escolher grava; Nenhum tira", async () => {
    mock.invoke.mockResolvedValue({ data: { cliente: [{ id: `r:${ROSTO}`, nome: "Ana", url: "https://x/mini.jpg" }], equipe: [] }, error: null });
    const onSalvar = vi.fn(() => Promise.resolve());
    montar(h(EstudioRostoDaReferencia, { trabalhoId: "t1", clientId: CLIENTE, direcao: {}, onSalvar }));
    fireEvent.click(screen.getByRole("radio", { name: "Cliente" }));
    const botao = await screen.findByTitle("Ana");
    fireEvent.click(botao);
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ conjunto: { rosto: { fonte: "cliente", id: `r:${ROSTO}`, destacar: false } } }));
    expect(mock.invoke.mock.calls[0][1].body).toMatchObject({ acao: "rostos", trabalho_id: "t1" });
  });

  it("com rosto salvo: Destacar grava e Nenhum tira", async () => {
    const onSalvar = vi.fn(() => Promise.resolve());
    mock.invoke.mockResolvedValue({ data: { cliente: [], equipe: [] }, error: null });
    montar(h(EstudioRostoDaReferencia, { trabalhoId: "t1", clientId: CLIENTE, direcao: { rosto: { fonte: "cliente", id: `r:${ROSTO}` } }, onSalvar }));
    fireEvent.click(screen.getByRole("switch", { name: "Destacar o rosto" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ conjunto: { rosto: { fonte: "cliente", id: `r:${ROSTO}`, destacar: true } } }));
    fireEvent.click(screen.getByRole("radio", { name: "Nenhum" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ conjunto: { rosto: null } }));
  });
});
