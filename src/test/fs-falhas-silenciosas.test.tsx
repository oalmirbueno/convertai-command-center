import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente FS (29/09): fim das falhas silenciosas. Regra do dono: nenhuma ação
 * termina "com sucesso" quando a parte importante falhou.
 *
 * O caso mais sério era a leitura da prancha no estudio-arte: engolia QUALQUER
 * erro (até saldo e cota) e respondia 200 como se a referência fosse uma arte
 * só. Estes testes provam que:
 * - saldo, cota e chave sobem como erro;
 * - a falha do provedor vira aviso com o motivo (e vai para o log);
 * - a imagem quebrada é pulada antes de gastar, com o motivo;
 * - a tela do Estúdio mostra o aviso e o erro;
 * - a geração guarda os avisos do que falhou no caminho (logo, referência, molde).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: new Error("sem") }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import { CODIGOS_QUE_SOBEM, erroQueSobe, motivoDaFalha, nuloComLog, nuloComLogOuSobe, registrarFalha } from "../../supabase/functions/_shared/falha-registrada";
import {
  abrirImagemDaPrancha,
  avisoDaPrancha,
  camposDaFalhaDaPrancha,
  lerPranchaComMotivo,
} from "../../supabase/functions/estudio-arte/leitura-da-prancha";
import { enxugarMiolo } from "../../supabase/functions/estudio-arte/composicao-dinamica";
import EstudioPranchaDaReferencia from "@/components/mesa/EstudioPranchaDaReferencia";
import { avisosDaVersao, EstudioAvisosDaGeracao } from "@/components/mesa/EstudioAvisoDoRosto";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Erro no formato do motor (IaMotorErro), sem importar o Deno. */
class ErroDoMotor extends Error {
  constructor(public codigo: string, mensagem: string, public detalhes: Record<string, unknown> = {}) {
    super(mensagem);
    this.name = "IaMotorErro";
  }
}
class ErroDoJev extends Error {
  constructor(public codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "JevErro";
  }
}

const PNG_ASSINATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG sintético: inteiro (com IEND) ou cortado no envio (sem o fim, como o do Rd Ar). */
function png(tamanho = 200, inteiro = true): Uint8Array {
  const b = new Uint8Array(tamanho);
  b.set(PNG_ASSINATURA, 0);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  if (inteiro) b.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], tamanho - 12);
  return b;
}

let erroNoConsole: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  erroNoConsole = vi.spyOn(console, "error").mockImplementation(() => {});
  Object.values(toasts).forEach((f) => f.mockReset());
  mock.invoke.mockReset();
});
afterEach(() => {
  erroNoConsole.mockRestore();
});

// ------------------------------------------------------------ módulo comum

describe("falha registrada: saldo, cota e chave nunca são engolidos", () => {
  it("erroQueSobe reconhece saldo, cota e chave do motor; o resto (e o Jev) não", () => {
    for (const c of ["saldo_insuficiente", "cota_da_chave_esgotada", "cliente_sem_chave", "provedor_sem_chave", "provedor_sem_credito", "openrouter_sem_credito", "chave_indisponivel"]) {
      expect(CODIGOS_QUE_SOBEM.has(c), c).toBe(true);
      expect(erroQueSobe(new ErroDoMotor(c, "x")), c).toBe(true);
    }
    expect(erroQueSobe(new ErroDoMotor("provedor_erro", "openrouter respondeu 400"))).toBe(false);
    expect(erroQueSobe(new ErroDoJev("saldo_insuficiente", "não é do motor"))).toBe(false);
    expect(erroQueSobe(new Error("qualquer"))).toBe(false);
    expect(erroQueSobe(null)).toBe(false);
  });

  it("motivoDaFalha é curto e legível para Error, erro do banco em objeto e texto", () => {
    expect(motivoDaFalha(new ErroDoMotor("provedor_erro", "openrouter respondeu 400: imagem inválida"))).toBe("provedor_erro: openrouter respondeu 400: imagem inválida");
    expect(motivoDaFalha({ message: "permission denied for table x", code: "42501" })).toBe("permission denied for table x");
    expect(motivoDaFalha("caiu")).toBe("caiu");
    expect(motivoDaFalha(undefined)).toBe("falha desconhecida");
    expect(motivoDaFalha(new Error("a".repeat(500))).length).toBe(300);
  });

  it("registrarFalha e nuloComLog vão para o console.error com o motivo", () => {
    expect(registrarFalha("teste: passo", new Error("quebrou"), { id: 1 })).toBe("quebrou");
    expect(erroNoConsole).toHaveBeenCalledWith("teste: passo", { id: 1, motivo: "quebrou" });
    expect(nuloComLog("teste: opcional")(new Error("sem arquivo"))).toBeNull();
    expect(erroNoConsole).toHaveBeenLastCalledWith("teste: opcional", { motivo: "sem arquivo" });
    expect(() => nuloComLogOuSobe("teste: pago")(new ErroDoMotor("saldo_insuficiente", "sem saldo"))).toThrow("sem saldo");
    expect(nuloComLogOuSobe("teste: pago")(new Error("rede"))).toBeNull();
  });
});

// ------------------------------------------------------------ prancha

describe("prancha: o mais sério (estudio-arte engolia até saldo e respondia 200)", () => {
  it("saldo insuficiente na leitura sobe como erro (a função responde 402, não 'arte só')", async () => {
    await expect(lerPranchaComMotivo(async () => { throw new ErroDoMotor("saldo_insuficiente", "Saldo insuficiente"); })).rejects.toThrow("Saldo insuficiente");
    await expect(lerPranchaComMotivo(async () => { throw new ErroDoMotor("cota_da_chave_esgotada", "cota"); })).rejects.toThrow("cota");
    await expect(lerPranchaComMotivo(async () => { throw new ErroDoMotor("cliente_sem_chave", "sem chave"); })).rejects.toThrow("sem chave");
    // Nada foi para o log como "falha opcional": o erro sobe inteiro.
    expect(erroNoConsole).not.toHaveBeenCalled();
  });

  it("saldo ao abrir a imagem também sobe", async () => {
    await expect(abrirImagemDaPrancha(async () => { throw new ErroDoMotor("saldo_insuficiente", "Saldo insuficiente"); })).rejects.toThrow("Saldo insuficiente");
  });

  it("provedor falha: vira aviso claro com o motivo, vai para o log e a resposta diz falhou", async () => {
    const r = await lerPranchaComMotivo(async () => {
      throw new ErroDoMotor("provedor_erro", "openrouter respondeu 400: Provider returned error (The image data you provided does not represent a valid image)");
    }, { trabalho_id: "t1", referencia_id: "r1" });
    expect(r.leitura).toBeNull();
    expect(r.falha).toMatchObject({ codigo: "leitura_falhou", arquivo: false });
    expect(r.falha!.motivo).toContain("does not represent a valid image");
    expect(erroNoConsole).toHaveBeenCalledWith("estudio-arte: leitura da prancha falhou", expect.objectContaining({ trabalho_id: "t1", referencia_id: "r1", codigo: "provedor_erro" }));
    const campos = camposDaFalhaDaPrancha(r.falha);
    expect(campos.falhou).toBe(true);
    expect(campos.prancha_erro).toBe("leitura_falhou");
    expect(String(campos.aviso_da_acao)).toMatch(/^A prancha não pôde ser lida: .*does not represent a valid image.*A arte sai sem os quadros da prancha/);
  });

  it("imagem quebrada (PNG cortado no envio) é pulada ANTES de gastar, com o motivo", async () => {
    const leitor = vi.fn(async () => ({ prancha: true }));
    const aberta = await abrirImagemDaPrancha(async () => ({ bytes: png(4096, false), mime: "image/png", nome: "ref.png" }), { referencia_id: "r1" });
    if (aberta.imagem) await lerPranchaComMotivo(leitor);
    expect(aberta.imagem).toBeNull();
    expect(aberta.falha).toMatchObject({ codigo: "png_truncado", arquivo: true });
    expect(aberta.falha!.motivo).toContain("PNG está cortado");
    expect(leitor).not.toHaveBeenCalled();
    expect(erroNoConsole).toHaveBeenCalledWith("estudio-arte: imagem da prancha com defeito, pulada", expect.objectContaining({ defeito: "png_truncado" }));
    expect(avisoDaPrancha(aberta.falha!)).toContain("troque o arquivo desta referência");
  });

  it("arquivo que não abre (sumiu do armazenamento) vira falha com motivo, sem lançar", async () => {
    const aberta = await abrirImagemDaPrancha(async () => { throw new Error("A imagem desta referência não está mais no workspace."); });
    expect(aberta.imagem).toBeNull();
    expect(aberta.falha).toMatchObject({ codigo: "arquivo_indisponivel", arquivo: true });
    expect(aberta.falha!.motivo).toContain("não está mais no workspace");
  });

  it("imagem inteira e leitura boa: sem falha e sem campos extras na resposta", async () => {
    const aberta = await abrirImagemDaPrancha(async () => ({ bytes: png(), mime: "image/png", nome: "ref.png" }));
    expect(aberta.falha).toBeNull();
    const r = await lerPranchaComMotivo(async () => ({ prancha: true, quadros: [] }));
    expect(r.falha).toBeNull();
    expect(camposDaFalhaDaPrancha(null)).toEqual({});
  });

  it("o servidor usa o caminho novo: lerPrancha sem catch, a ação 'prancha' com motivo e aviso", () => {
    const f = ler("supabase/functions/estudio-arte/index.ts");
    const lerPrancha = f.slice(f.indexOf("async function lerPrancha("), f.indexOf("/** Os ajustes de prancha do trabalho"));
    expect(lerPrancha).not.toContain("catch");
    const acao = f.slice(f.indexOf("async function pranchaDaReferencia("), f.indexOf("async function variedadeDaCapa("));
    expect(acao).toContain("abrirImagemDaPrancha(() => imagemDaReferenciaCrua(ref), log)");
    expect(acao).toContain("lerPranchaComMotivo(() => lerPrancha(t, ref, imagem, ch.userId), log)");
    expect(acao).toContain("...camposDaFalhaDaPrancha(falha)");
    expect(acao).not.toContain(".catch(() => null)");
  });
});

// ------------------------------------------------------------ geração e ajuste

describe("geração: o que falhou no caminho e mudou a arte vira aviso na versão", () => {
  const f = ler("supabase/functions/estudio-arte/index.ts");

  it("referência com arquivo quebrado é pega antes do gerador (422 com o motivo)", () => {
    const bloco = f.slice(f.indexOf("async function imagemDaReferencia("), f.indexOf("async function imagemDaReferenciaCrua("));
    expect(bloco).toContain("defeitoDaImagem(imagem.bytes)");
    expect(bloco).toContain('new ErroEstudio(422, "referencia_quebrada"');
  });

  it("logo, molde, série da capa e Jev do rosto: saldo sobe, o resto vai para o log e para os avisos", () => {
    for (const [ini, fim] of [
      ["async function leituraDaLogo(", "async function moldeDaReferencia("],
      ["async function moldeDaReferencia(", "type SerieDaReferencia"],
      ["async function serieDaReferenciaDaCapa(", "async function separacaoDaCapaGerada("],
      ["async function separacaoDaCapaGerada(", "// ------------------------------------ estética da referência"],
    ]) {
      const b = f.slice(f.indexOf(ini), f.indexOf(fim));
      expect(b, ini).toContain("if (erroQueSobe(e)) throw e;");
      expect(b, ini).toContain("registrarFalha(");
      expect(b, ini).toContain("avisos?.push(");
      expect(b, ini).not.toMatch(/catch \{\s*return null;/);
    }
    const pessoa = f.slice(f.indexOf("async function direcaoPedePessoa("), f.indexOf("// ------------------------------------------------ prancha de referências"));
    expect(pessoa).toContain("a arte saiu sem o rosto escolhido");
  });

  it("gravarVersao guarda avisos_da_geracao na versão e devolve aviso_da_acao; gerar e ajustar passam os avisos", () => {
    const g = f.slice(f.indexOf("async function gravarVersao("), f.indexOf("// ------------------------------------------------------------ ajustar card"));
    expect(g).toContain("avisos_da_geracao: avisos");
    expect(g).toContain('aviso_da_acao: avisos.join(" ")');
    expect(f.split("avisos: avisosDaGeracao,").length - 1).toBe(5);
    expect(f).toContain("avisos: avisosDoAjuste,");
  });

  it("anexo que não abre deixa aviso (antes: 'Arquivo sumido fica de fora' em silêncio)", () => {
    expect(f).toContain('registrarFalha("estudio-arte: anexo da lâmina não abriu"');
    expect(f).toContain("ficou de fora desta lâmina.");
  });

  it("erro do motor, do Jev e 5xx ficam no log do dispatcher (o 4xx de validação só volta para a tela)", () => {
    expect(f).toContain('registrarFalha("estudio-arte: ação falhou", e, { acao })');
  });
});

describe("miolo e texto na geração: a falha do redator tem motivo", () => {
  it("enxugarMiolo devolve o motivo em erro (a direção avisa a equipe)", async () => {
    const cards = [
      { ordem: 1, funcao: "capa", texto_exato: "Capa", blocos: [{ papel: "headline" as const, texto: "Capa" }] },
      { ordem: 2, funcao: "conteudo", texto_exato: "palavra ".repeat(80).trim(), blocos: [{ papel: "headline" as const, texto: "Título" }, { papel: "apoio" as const, texto: "palavra ".repeat(80).trim() }] },
    ];
    const r = await enxugarMiolo(cards as never, null, async () => { throw new Error("provedor fora do ar"); });
    expect(r.longas).toEqual([2]);
    expect(r.erro).toContain("provedor fora do ar");
    expect(erroNoConsole).toHaveBeenCalledWith("estudio-arte: miolo não enxuto", expect.objectContaining({ motivo: "provedor fora do ar" }));
    expect(r.mudou).toEqual([]);
    expect(ler("supabase/functions/estudio-arte/index.ts")).toContain("if (enxuto.erro) avisosDoDiretor = [...avisosDoDiretor,");
  });
});

// ------------------------------------------------------------ fora do Estúdio

describe("fora do Estúdio: só log (e o motivo na resposta da Central)", () => {
  it("agente-central: JSON inválido da IA tem motivo no log e na resposta (ia_erro)", () => {
    const c = ler("supabase/functions/agente-central/index.ts");
    const p = c.slice(c.indexOf("async function perguntarIA("), c.indexOf("type Dossie ="));
    expect(p).toContain('console.error("[agente-central] JSON inválido da IA"');
    expect(p).not.toMatch(/catch \{\s*return null;/);
    expect(c).toContain("ia_erro: iaErro,");
    expect(ler("src/components/central/AgenteDaCentral.tsx")).toContain("if (ap.ia_erro) toast.warning(");
  });

  it("os pontos listados deixaram de ser catch vazio", () => {
    const casos: Array<[string, string]> = [
      ["supabase/functions/agente-calendario/mesa-do-item.ts", "agente-calendario: jev da mesa do item falhou"],
      ["supabase/functions/agente-calendario/index.ts", "agente-calendario: jev dos hypes falhou"],
      ["supabase/functions/agente-estilo/templates.ts", "agente-estilo: teste do template falhou"],
      ["supabase/functions/agente-estilo/templates.ts", "agente-estilo: leitura do carrossel falhou"],
      ["supabase/functions/mesa-foto/clones.ts", "mesa-foto: jev do sorriso falhou"],
      ["supabase/functions/_shared/aprendizado-das-entregas.ts", "aprendizado-das-entregas: leitura por visão da entrega falhou"],
      ["supabase/functions/_shared/ordem-clara.ts", "ordem-clara: jev falhou"],
      ["supabase/functions/mesa-publicidade/index.ts", "mesa-publicidade: jev falhou"],
      ["supabase/functions/mesa-videos/diretor.ts", "mesa-videos: jev da continuidade falhou"],
      ["supabase/functions/estudio-arte/composicao-dinamica.ts", "estudio-arte: jev do termo decorativo falhou"],
      ["supabase/functions/estudio-arte/referencia-adapta-copy.ts", "estudio-arte: jev da adaptação falhou"],
      ["supabase/functions/estudio-arte/texto-da-lamina.ts", "estudio-arte: redator do texto na geração falhou"],
    ];
    for (const [arq, log] of casos) expect(ler(arq), arq).toContain(log);
    // A mesa-foto não repete o log onde o código já vai para a tela sem motivo.
    expect(ler("supabase/functions/mesa-foto/index.ts")).toContain('console.error("[mesa-foto] ação falhou"');
  });
});

// ------------------------------------------------------------ tela

const valorDaMesa = (): MesaValor => ({
  clientId: "11111111-1111-1111-1111-111111111111",
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
}

describe("tela do Estúdio mostra o que falhou", () => {
  it("prancha que não foi lida: aviso com o motivo e 'Ler de novo' (antes: nada)", async () => {
    mock.invoke.mockResolvedValue({
      data: {
        referencia_id: "r1", lida: false, prancha: null, falhou: true, prancha_erro: "leitura_falhou",
        motivo: "provedor_erro: openrouter respondeu 400",
        aviso_da_acao: "A prancha não pôde ser lida: provedor_erro: openrouter respondeu 400. A arte sai sem os quadros da prancha (usa a imagem inteira como referência). Tente ler de novo.",
      },
      error: null,
    });
    const { container } = montar(h(EstudioPranchaDaReferencia, { trabalhoId: "t1", referenciaId: "r1", rotulo: "referência", onSalvar: vi.fn() }));
    await waitFor(() => expect(container.querySelector("[data-prancha='aviso']")).toBeTruthy());
    expect(screen.getByText(/A prancha não pôde ser lida: provedor_erro/)).toBeTruthy();
    // Ler de novo que falha de novo: toast de erro, nunca "É uma arte só".
    fireEvent.click(container.querySelector("[data-prancha='ler-de-novo']")!);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("A prancha não foi lida", expect.objectContaining({ description: expect.stringContaining("A prancha não pôde ser lida") })));
    expect(toasts.message).not.toHaveBeenCalled();
  });

  it("saldo insuficiente na prancha aparece como erro na tela (antes: return null)", async () => {
    mock.invoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsHttpError", context: { status: 402, clone: () => ({ json: async () => ({ error: "saldo_insuficiente", mensagem: "Saldo insuficiente na carteira de IA do cliente. Recarregue antes de gerar." }) }) } },
    });
    const { container } = montar(h(EstudioPranchaDaReferencia, { trabalhoId: "t1", referenciaId: "r9", rotulo: "referência", onSalvar: vi.fn() }));
    await waitFor(() => expect(container.querySelector("[data-prancha='erro']")).toBeTruthy());
    expect(container.textContent).toMatch(/Não deu para conferir se a referência tem várias artes/);
  });

  it("avisos da geração aparecem na lâmina (e só os textos válidos)", () => {
    expect(avisosDaVersao({ avisos_da_geracao: ["A logo não pôde ser lida (x)", "", 3] })).toEqual(["A logo não pôde ser lida (x)"]);
    expect(avisosDaVersao(null)).toEqual([]);
    const { container } = render(h(EstudioAvisosDaGeracao, { versao: { avisos_da_geracao: ["A referência 1 não abriu (arquivo sumiu): a lâmina saiu sem ela."] } }));
    expect(container.querySelector("[data-aviso='geracao']")!.textContent).toContain("A referência 1 não abriu");
    const vazio = render(h(EstudioAvisosDaGeracao, { versao: {} }));
    expect(vazio.container.querySelector("[data-aviso='geracao']")).toBeNull();
  });

  it("AbaEstudio e o criativo de anúncio avisam quando gerar ou ajustar volta com aviso_da_acao", () => {
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain("<EstudioAvisosDaGeracao versao={versaoNaTela as any} />");
    expect(aba).toContain("gerada com aviso");
    expect(aba).toContain("ajustada com aviso");
    expect(ler("src/components/mesa-ads/ArteDoCriativo.tsx")).toContain('toast.warning("Arte gerada com aviso"');
  });
});
