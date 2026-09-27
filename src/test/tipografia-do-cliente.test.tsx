import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente T2 (26/09/2026), pedido do dono: "tem que seguir a tipografia correta
 * de cada cliente, e cada cliente sem misturar, e não inventar, e seguir a
 * consistência das fontes no carrossel."
 *
 * 1. Amostra da tipografia anexada com papel nomeado e prioridade.
 * 2. Âncora tipográfica da série nas lâminas 2+ (família, peso e caixa fixos).
 * 3. Cliente sem fonte: a geração bloqueia, com Sugerir da biblioteca e Definir no Contexto.
 * 4. Isolamento por cliente e por marca (Acerbi e CME).
 * 5. Trava da marca: a letra da referência nunca entra.
 */

const banco = vi.hoisted(() => ({
  fontes: [] as Record<string, unknown>[],
  apagadas: [] as unknown[],
  removidos: [] as string[][],
}));
const invocar = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: invocar },
    from: () => ({
      select: () => ({
        eq: (_c: string, cliente: string) => ({
          order: () => Promise.resolve({ data: banco.fontes.filter((f) => f.client_id === cliente), error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
      delete: () => ({ in: (_c: string, ids: unknown) => ({ eq: () => { banco.apagadas.push(ids); return Promise.resolve({ error: null }); } }) }),
    }),
    storage: {
      from: () => ({
        remove: (c: string[]) => { banco.removidos.push(c); return Promise.resolve({ error: null }); },
        createSignedUrl: () => Promise.resolve({ data: null, error: new Error("sem") }),
      }),
    },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }) }));
// O botão com custo de verdade estima pelo catálogo; aqui o clique executa e conclui.
vi.mock("@/components/mesa/Custo", () => ({
  useAvisarErro: () => vi.fn(),
  BotaoComCusto: (p: { rotulo: ReactNode; executar: () => Promise<unknown>; aoConcluir?: (d: unknown, c: number | null) => void; disabled?: boolean }) => (
    <button type="button" disabled={p.disabled} onClick={() => void p.executar().then((d) => p.aoConcluir && p.aoConcluir(d, 0))}>
      {p.rotulo}
    </button>
  ),
}));
const amostras = vi.hoisted(() => ({ geradas: [] as { clientId: string; ids: string[] }[] }));
vi.mock("@/lib/mesa/amostraDaFonte", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    gerarAmostrasDaTipografia: vi.fn(async (clientId: string, fontes: { id: string }[]) => {
      amostras.geradas.push({ clientId, ids: fontes.map((f) => f.id) });
      return { feitas: fontes.length, falhas: [] };
    }),
  };
});

import {
  ancoraDaSerie,
  anexosDaTipografia,
  amostraDoCliente,
  blocoDaTipografia,
  CAPA_PENDENTE,
  chaveDaTipografia,
  esperaACapa,
  type FonteDoKit,
  registroDaLamina,
  rotuloDaTipografia,
  SEM_TIPOGRAFIA,
  tipografiaDoKit,
  tipografiaQueCede,
} from "../../supabase/functions/estudio-arte/tipografia-do-cliente";
import { anexosDaLamina, MAX_ANEXOS_DA_LAMINA, promptDaLamina, type TipoDoAnexo } from "../../supabase/functions/_shared/direcao-arte";
import { fontesDaMarca } from "../../supabase/functions/_shared/marca";
import { blocoDaMarcaTravada, neutralizarMarcaDaReferencia } from "../../supabase/functions/_shared/trava-da-marca";
import { LIMITES_DA_FILA, proximoPasso, type ItemDaFila } from "../../supabase/functions/estudio-arte/fila-de-geracao";
import {
  ALTURA_DA_AMOSTRA,
  arquivoDeFonteLegivel,
  caminhoDaAmostraDaTipografia,
  ehAmostraDaTipografia,
  FRASE_DA_AMOSTRA,
  gerarAmostraDaTipografia,
  LARGURA_DA_AMOSTRA,
  linhasDaAmostra,
  pesoDaTipografia,
  TEXTO_DA_AMOSTRA,
  urlDoGoogleFonts,
  type DependenciasDaAmostra,
} from "@/lib/mesa/amostraDaFonte";
import { fontesDaMarcaNaTela, marcaParaGravarNaTela, temTipografia, usaFontesDoCliente } from "@/lib/mesa/tipografiaDoCliente";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EstudioSemTipografia, { TEXTO_SEM_TIPOGRAFIA } from "@/components/mesa/EstudioSemTipografia";
import { TEXTO_SEM_FONTE } from "@/components/mesa/EstudioAvisoSemFonte";
import { planejarTrocaDeFontes } from "@/components/mesa/ContextoBibliotecaDeFontes";
import { MARCA_CASO } from "./fixtures/replicarCasos";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const servidor = ler("supabase/functions/estudio-arte/index.ts");
const corpoDe = (nome: string) => {
  const i = servidor.indexOf(`async function ${nome}(`);
  const fim = servidor.indexOf("\nasync function ", i + 10);
  return servidor.slice(i, fim > 0 ? fim : undefined);
};

const CLIENTE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLIENTE_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ACERBI = { id: "11111111-0000-4000-8000-00000000000a", principal: true };
const CME = { id: "22222222-0000-4000-8000-00000000000c", principal: false };

const kitA: FonteDoKit[] = [
  { id: "fa-t", nome: "Abril Fatface", papel: "titulo", amostra_path: `${CLIENTE_A}/marca/tipografia-titulo-fat.png` },
  { id: "fa-x", nome: "Lato", papel: "texto", amostra_path: `${CLIENTE_A}/marca/tipografia-texto-fax.png` },
];
const kitB: FonteDoKit[] = [
  { id: "fb-t", nome: "Bebas Neue", papel: "titulo", amostra_path: "biblioteca/fontes/bebas-neue/amostra.png" },
  { id: "fb-x", nome: "Open Sans", papel: "texto", amostra_path: `${CLIENTE_B}/marca/tipografia-texto-fbx.png` },
];

// ------------------------------------------------------------ 1. amostra anexada

describe("1. Amostra da tipografia anexada com papel e prioridade", () => {
  it("título e texto do kit viram anexos com o papel TIPOGRAFIA DO CLIENTE", () => {
    const tip = tipografiaDoKit(kitA)!;
    const anexos = anexosDaTipografia(tip, CLIENTE_A);
    expect(anexos.map((a) => [a.tipo, a.papel, a.caminho])).toEqual([
      ["fonte", "titulo", `${CLIENTE_A}/marca/tipografia-titulo-fat.png`],
      ["fonte_texto", "texto", `${CLIENTE_A}/marca/tipografia-texto-fax.png`],
    ]);
    expect(anexos[0].rotulo).toBe(rotuloDaTipografia("titulo", "Abril Fatface"));
    expect(anexos[0].rotulo).toContain("TIPOGRAFIA DO CLIENTE");
    expect(anexos[0].rotulo).toContain("use exatamente estas letras (desenho, peso, proporção) no título; não use outra fonte");
    expect(anexos[1].rotulo).toContain("no texto de apoio e no CTA; não use outra fonte");
    for (const a of anexos) expect(a.rotulo).not.toMatch(/[—–]/);
  });

  it("texto da mesma família do título não repete a amostra", () => {
    const tip = tipografiaDoKit([{ nome: "Poppins", papel: "titulo", amostra_path: `${CLIENTE_A}/marca/t.png` }, { nome: "poppins", papel: "texto", amostra_path: `${CLIENTE_A}/marca/x.png` }])!;
    expect(anexosDaTipografia(tip, CLIENTE_A).map((a) => a.tipo)).toEqual(["fonte"]);
  });

  it("prioridade: lâmina (foto, referência, logo, capa, sequência) > TIPOGRAFIA > referência automática > selo, no limite de 6", () => {
    const tipos: TipoDoAnexo[] = ["selo", "identidade", "fonte_texto", "fonte", "sequencia", "capa", "logo"];
    expect(anexosDaLamina(tipos.map((tipo) => ({ tipo })), { base: false }).map((c) => c.tipo)).toEqual(["logo", "capa", "sequencia", "fonte", "fonte_texto", "identidade"]);
    // Com a imagem editada (base), a referência automática sai antes da tipografia.
    expect(anexosDaLamina(tipos.map((tipo) => ({ tipo })), { base: true }).map((c) => c.tipo)).toEqual(["logo", "capa", "sequencia", "fonte", "fonte_texto"]);
    expect(MAX_ANEXOS_DA_LAMINA).toBe(6);
    // Uma de cada: duas amostras de título não entram juntas.
    expect(anexosDaLamina([{ tipo: "fonte" as const }, { tipo: "fonte" as const }], { base: false })).toHaveLength(1);
  });

  it("rosto > TIPOGRAFIA: sem vaga, a amostra do texto cede primeiro, depois a do título", () => {
    const tipos = ["logo", "fonte", "fonte_texto"];
    expect(tipografiaQueCede({ anexos: 3, limiteDoModelo: 16, pedidas: 2, tipos })).toEqual([]);
    expect(tipografiaQueCede({ anexos: 3, limiteDoModelo: 4, pedidas: 2, tipos })).toEqual(["fonte_texto"]);
    expect(tipografiaQueCede({ anexos: 3, limiteDoModelo: 3, pedidas: 2, tipos })).toEqual(["fonte_texto", "fonte"]);
    expect(tipografiaQueCede({ anexos: 3, limiteDoModelo: 3, pedidas: 0, tipos })).toEqual([]);
  });

  it("no servidor: a amostra entra como candidata antes da referência automática e o prompt cita a imagem", () => {
    const g = corpoDe("gerarCard");
    expect(g).toContain("candidatos.push(...anexosDaTipografia(tipografia, t.client_id).map((a) => ({ tipo: a.tipo, rotulo: a.rotulo, carregar: () => baixarImagem(\"mesa\", a.caminho, a.nome) })));");
    expect(g).toContain('if (c.tipo === "fonte") indicesDaTipografia.titulo = indice;');
    expect(g).toContain('if (c.tipo === "fonte_texto") indicesDaTipografia.texto = indice;');
    expect(g.indexOf("anexosDaTipografia(tipografia, t.client_id)")).toBeLessThan(g.indexOf("await escolherReferencias(t, card, kit, ch.userId)"));
    // A referência automática cede ao rosto primeiro; depois a tipografia.
    expect(g.indexOf('candidatos[i].tipo === "identidade") candidatos.splice(i, 1)')).toBeLessThan(g.indexOf("const cedem = tipografiaQueCede({"));
    expect(g.indexOf("const cedem = tipografiaQueCede({")).toBeLessThan(g.indexOf("const escolhidosDaLamina = anexosDaLamina(candidatos, { base: temBase });"));
    // O bloco vai nos dois prompts (normal e replicar) e a versão guarda o registro.
    expect(g).toContain("    campanha ? blocoDaCampanha(campanha) : \"\",\n    // Frente T2: tipografia do cliente (amostras, família, peso e caixa por papel, âncora da série).\n    blocoDaTipografiaAqui,");
    expect(g).toContain("      continuidade,\n      // Frente T2: tipografia do cliente (vale sobre o desenho da letra da referência).\n      blocoDaTipografiaAqui,");
    expect(g).toContain("tipografia: registroDaTipografia,");
    expect(servidor).not.toContain("amostrasDasFontes(");
  });
});

// ------------------------------------------------------------ 2. âncora da série

describe("2. Consistência no carrossel: âncora tipográfica e família, peso e caixa fixos", () => {
  const tip = tipografiaDoKit(kitA)!;
  const chave = chaveDaTipografia(CLIENTE_A, null, tip);

  it("a capa vira a âncora; as lâminas 2+ repetem peso e caixa dela", () => {
    const capa = registroDaLamina({ tip, chave, ancora: null, tituloDoMolde: { caixa_alta: true, peso: "black" }, amostras: 2 });
    expect(capa).toMatchObject({ peso_titulo: "black", caixa_titulo: "alta", ancora: null, titulo: "Abril Fatface", texto: "Lato" });
    const versoes = [
      { ordem: 1, versao: 1, tipografia: { ...capa, peso_titulo: "negrito" } },
      { ordem: 1, versao: 2, tipografia: capa },
      { ordem: 3, versao: 1, tipografia: { ...capa, caixa_titulo: "como_escrito" } },
    ];
    const ancora = ancoraDaSerie(versoes, 2, chave)!;
    expect(ancora.ordem).toBe(1);
    expect(ancora.registro.peso_titulo).toBe("black");
    // Lâmina 2 com referência própria em caixa baixa: a série não varia, fica a da capa.
    const l2 = registroDaLamina({ tip, chave, ancora, tituloDoMolde: { caixa_alta: false, peso: "regular" }, amostras: 2 });
    expect(l2).toMatchObject({ peso_titulo: "black", caixa_titulo: "alta", ancora: 1 });
  });

  it("sem referência: peso da amostra e caixa como está no texto exato", () => {
    expect(registroDaLamina({ tip, chave, ancora: null, amostras: 1 })).toMatchObject({ peso_titulo: "amostra", caixa_titulo: "como_escrito" });
    expect(registroDaLamina({ tip, chave, ancora: null, amostras: 0 })).toMatchObject({ peso_titulo: "negrito" });
  });

  it("o bloco fixa família, peso e caixa por papel, igual em todas as lâminas; muda só a âncora e os números", () => {
    const capa = registroDaLamina({ tip, chave, ancora: null, amostras: 2 });
    const b1 = blocoDaTipografia({ registro: capa, indices: { titulo: 2, texto: 3 }, ordem: 1, total: 5 });
    const ancora = ancoraDaSerie([{ ordem: 1, versao: 1, tipografia: capa }], 3, chave);
    const b3 = blocoDaTipografia({ registro: registroDaLamina({ tip, chave, ancora, amostras: 2 }), indices: { titulo: 3, texto: 4 }, indiceDaCapa: 2, ordem: 3, total: 5 });
    const fixas = (b: string) => b.split("\n").filter((l) => /^- (Título|Apoio|CTA)/.test(l));
    expect(fixas(b1)).toEqual(fixas(b3));
    expect(fixas(b1)).toEqual([
      "- Título (headline e número): fonte Abril Fatface, no peso da amostra, caixa como está no texto exato.",
      "- Apoio (subtítulo e texto): fonte Lato, peso regular, caixa como está no texto exato.",
      "- CTA: fonte Lato, negrito, caixa como está no texto exato.",
    ]);
    expect(b1).toContain("- Letras: a imagem 2 é a amostra da fonte do título e a imagem 3 é a amostra da fonte do texto");
    expect(b1).toContain("Esta lâmina é a âncora tipográfica da série");
    expect(b3).toContain("- Âncora da série: o título desta lâmina tem a mesma fonte, o mesmo peso e a mesma caixa do título da capa (imagem 2).");
    expect(b3).toContain("- Não use outra fonte: nem a da referência, nem uma parecida, nem uma escolhida por conta própria.");
    // Capa não anexada (replicar Idêntica): âncora em texto, pela lâmina já gerada.
    const semImagem = blocoDaTipografia({ registro: registroDaLamina({ tip, chave, ancora, amostras: 1 }), indices: { titulo: 3 }, ordem: 3, total: 5 });
    expect(semImagem).toContain("do título da lâmina 1, já gerada.");
    for (const b of [b1, b3, semImagem]) expect(b).not.toMatch(/[—–]/);
    // Post único: sem linha de âncora.
    expect(blocoDaTipografia({ registro: capa, indices: {}, ordem: 1, total: 1 })).not.toContain("Âncora");
  });

  it("lâmina 2+ pedida junto com a capa espera por ela; a fila espera em vez de falhar", () => {
    expect(esperaACapa({ ordem: 2, total: 5, capaTemVersao: false, capaNaFila: true })).toBe(true);
    expect(esperaACapa({ ordem: 2, total: 5, capaTemVersao: true, capaNaFila: true })).toBe(false);
    expect(esperaACapa({ ordem: 2, total: 5, capaTemVersao: false, capaNaFila: false })).toBe(false);
    expect(esperaACapa({ ordem: 1, total: 5, capaTemVersao: false, capaNaFila: true })).toBe(false);
    const item: ItemDaFila = {
      id: "i2", client_id: CLIENTE_A, trabalho_id: "t", ordem: 2, lote_id: "l", status: "rodando", etapa: "gerar", paralelo: 2, corrigir_sozinho: false,
      rodadas: 0, tentativas: 0, max_tentativas: 3, passos: 0, versoes_antes: null, trava_token: "x", custo_usd: 0, pedido_por: null, marca_id: null,
    };
    const agora = new Date("2026-09-26T12:00:00Z");
    const r = proximoPasso(item, "gerar", { ok: false, codigo: CAPA_PENDENTE.codigo, mensagem: CAPA_PENDENTE.mensagem }, agora);
    expect(r.mudanca.status).toBe("fila");
    expect(r.mudanca.etapa).toBe("gerar");
    expect(new Date(r.mudanca.proxima_em).getTime() - agora.getTime()).toBe(LIMITES_DA_FILA.ESPERA_DA_CAPA_S * 1000);
    expect(r.pararLote).toBeNull();
    // Teto de passos: a espera não é infinita.
    const fim = proximoPasso({ ...item, passos: LIMITES_DA_FILA.MAX_PASSOS - 1 }, "gerar", { ok: false, codigo: "capa_pendente", mensagem: "" }, agora);
    expect(fim.mudanca.status).toBe("erro");
  });

  it("no servidor: a espera da capa vem antes de ler o kit; a tela gera a capa sozinha primeiro no caminho sem fila", () => {
    const g = corpoDe("gerarCard");
    expect(g.indexOf("if (esperaACapa({")).toBeGreaterThan(0);
    expect(g.indexOf("if (esperaACapa({")).toBeLessThan(g.indexOf("lerKit(t.client_id, t),"));
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain("const capaPrimeiro = ordens.length > 1 && ordens.indexOf(1) >= 0 && !ultimas.has(1);");
    expect(aba).toContain("if (capaPrimeiro) {\n        await trabalhador();\n        teto = ordens.length;\n      }");
    expect(aba).toContain("if (proximo >= teto) break;");
  });
});

// ------------------------------------------------------------ 3. não inventar

describe("3. Cliente sem fonte: não gera, com Sugerir da biblioteca e Definir no Contexto", () => {
  it("kit sem fonte (ou sem nome) não tem tipografia; o servidor recusa antes de qualquer custo", () => {
    expect(tipografiaDoKit([])).toBeNull();
    expect(tipografiaDoKit(null)).toBeNull();
    expect(tipografiaDoKit([{ nome: "  ", papel: "titulo" }])).toBeNull();
    expect(temTipografia([])).toBe(false);
    expect(temTipografia([{ nome: "Lato" }])).toBe(true);
    expect(SEM_TIPOGRAFIA.codigo).toBe("sem_tipografia");
    expect(SEM_TIPOGRAFIA.mensagem).not.toMatch(/[—–]/);
    const g = corpoDe("gerarCard");
    const recusa = g.indexOf("if (!tipografia) throw new ErroEstudio(SEM_TIPOGRAFIA.status, SEM_TIPOGRAFIA.codigo, SEM_TIPOGRAFIA.mensagem);");
    expect(recusa).toBeGreaterThan(0);
    for (const gasto of ["await escolherReferencias(", "chamarImagem(", "await direcaoPedePessoa(", "await serieDaReferenciaDaCapa("]) {
      expect(recusa, gasto).toBeLessThan(g.indexOf(gasto));
    }
  });

  it("só uma fonte no kit: título e texto saem dela (nunca da citada em documento nem da referência)", () => {
    const tip = tipografiaDoKit([{ nome: "Poppins", papel: "texto" }])!;
    expect(tip.fontes).toEqual([{ nome: "Poppins", papel: "texto" }, { nome: "Poppins", papel: "titulo" }]);
    // Kit com título e texto: a lista vai igual (o prompt de hoje não muda).
    expect(tipografiaDoKit(MARCA_CASO.fontes)!.fontes).toEqual(MARCA_CASO.fontes);
    const prompt = promptDaLamina(
      { ordem: 1, funcao: "capa", texto_exato: "Oi", composicao: "", ilustracao: "", prompt_imagem: "", blocos: [{ papel: "headline", texto: "Oi" }] },
      { ...MARCA_CASO, fontes: tip.fontes, tipografiaCitada: { titulo: "Fonte Citada" } },
      { total: 1, carrosselInfinito: false, levaLogo: false },
    );
    expect(prompt).toContain("Poppins");
    expect(prompt).not.toContain("Fonte Citada");
  });

  it("a tela bloqueia: aviso curto com as duas ações; Sugerir mostra o par e só grava ao confirmar", async () => {
    banco.fontes = [];
    invocar.mockReset();
    invocar
      .mockResolvedValueOnce({ data: { sugestao: { titulo: "Abril Fatface", texto: "Lato", titulo_id: "bib-t", texto_id: "bib-x", porque: "clássico e legível" }, custo_usd: 0.001 }, error: null })
      .mockImplementationOnce(async () => {
        banco.fontes = [
          { id: "n1", client_id: CLIENTE_A, nome: "Abril Fatface", papel: "titulo", storage_path: "biblioteca/fontes/abril/A.ttf", amostra_path: null, origem: "biblioteca", biblioteca_id: "bib-t", marca_id: null },
          { id: "n2", client_id: CLIENTE_A, nome: "Lato", papel: "texto", storage_path: "biblioteca/fontes/lato/L.ttf", amostra_path: null, origem: "biblioteca", biblioteca_id: "bib-x", marca_id: null },
        ];
        return { data: { fontes_escolhidas: { titulo: "Abril Fatface", texto: "Lato" } }, error: null };
      });
    const valor = { clientId: CLIENTE_A, clientName: "A", userId: "u", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() } as unknown as MesaValor;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tela = render(
      <QueryClientProvider client={qc}>
        <MesaProvider valor={valor}>
          <EstudioSemTipografia clientId={CLIENTE_A} />
        </MesaProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(TEXTO_SEM_TIPOGRAFIA)).toBeTruthy();
    expect(screen.getByText("Definir no Contexto").getAttribute("href")).toBe(`/mesa?client=${CLIENTE_A}&aba=contexto`);
    await act(async () => {
      fireEvent.click(screen.getByText("Sugerir da biblioteca"));
    });
    // Prévia: nada gravado ainda.
    expect(invocar.mock.calls[0][1].body).toMatchObject({ acao: "fontes_da_biblioteca", client_id: CLIENTE_A, previa: true });
    expect(await screen.findByText("Abril Fatface")).toBeTruthy();
    expect(screen.getByText("Confirmar e gravar no kit")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("Confirmar e gravar no kit"));
    });
    await waitFor(() => expect(invocar).toHaveBeenCalledTimes(2));
    expect(invocar.mock.calls[1][1].body).toMatchObject({ acao: "fontes_da_biblioteca", gravar: { titulo_id: "bib-t", texto_id: "bib-x" } });
    // A amostra da tipografia das duas fontes novas é desenhada logo depois, no cliente certo.
    await waitFor(() => expect(amostras.geradas.some((g) => g.clientId === CLIENTE_A && g.ids.join() === "n1,n2")).toBe(true));
    // Com a tipografia no kit, o aviso some.
    await waitFor(() => expect(screen.queryByText(TEXTO_SEM_TIPOGRAFIA)).toBeNull());
    tela.unmount();
  });

  it("aviso da referência não diz mais 'usando a da referência'; o Estúdio trava os botões e as funções", () => {
    expect(TEXTO_SEM_FONTE).not.toContain("usando a da referência");
    expect(TEXTO_SEM_FONTE).not.toMatch(/[—–]/);
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect((aba.match(/if \(semTipografia\) throw new ErroDaMesa\("sem_tipografia"/g) || []).length).toBe(2);
    expect(aba).toContain("disabled={ocupado || entregue || semTipografia}");
    expect(aba).toContain("disabled={laminaOcupada(c.ordem) || entregue || semTipografia}");
    expect((aba.match(/<EstudioSemTipografia clientId=\{clientId\} \/>/g) || []).length).toBe(2);
  });

  it("agente-contexto: prévia sem gravar e gravação do par confirmado na marca do pedido", () => {
    const ag = ler("supabase/functions/agente-contexto/index.ts");
    expect(ag).toContain("const previa = corpo.previa === true;");
    expect(ag).toContain("if (modo.gravar === false) return sugerida;");
    expect(ag).toContain("const daMarca = marcaParaGravar(marca);");
    expect(ag).toContain('.eq("ativa", true)\n      .in("id", ids);');
  });
});

// ------------------------------------------------------------ 4. isolamento

describe("4. Sem misturar clientes nem marcas", () => {
  it("dois clientes com fontes diferentes: cada um só com as dele (nome, amostra e chave)", () => {
    const a = tipografiaDoKit(kitA)!;
    const b = tipografiaDoKit(kitB)!;
    expect(chaveDaTipografia(CLIENTE_A, null, a)).not.toBe(chaveDaTipografia(CLIENTE_B, null, b));
    expect(anexosDaTipografia(a, CLIENTE_A).map((x) => x.caminho).every((c) => c.indexOf(`${CLIENTE_A}/`) === 0)).toBe(true);
    // Amostra de outro cliente nunca vai, nem por engano no kit.
    expect(anexosDaTipografia(a, CLIENTE_B)).toEqual([]);
    expect(amostraDoCliente(`${CLIENTE_B}/marca/x.png`, CLIENTE_A)).toBe(false);
    expect(amostraDoCliente(`${CLIENTE_A}/../${CLIENTE_B}/x.png`, CLIENTE_A)).toBe(false);
    // A da biblioteca é a mesma família para todos.
    expect(anexosDaTipografia(b, CLIENTE_B).map((x) => x.caminho)).toEqual(["biblioteca/fontes/bebas-neue/amostra.png", `${CLIENTE_B}/marca/tipografia-texto-fbx.png`]);
    const blocoA = blocoDaTipografia({ registro: registroDaLamina({ tip: a, chave: chaveDaTipografia(CLIENTE_A, null, a), ancora: null, amostras: 2 }), indices: { titulo: 1, texto: 2 }, ordem: 1, total: 3 });
    expect(blocoA).toContain("Abril Fatface");
    expect(blocoA).not.toContain("Bebas Neue");
    expect(blocoA).not.toContain("Open Sans");
  });

  it("âncora de outra marca ou de outro kit não vale (o trabalho que mudou de marca não herda a letra antiga)", () => {
    const a = tipografiaDoKit(kitA)!;
    const doAcerbi = registroDaLamina({ tip: a, chave: chaveDaTipografia(CLIENTE_A, ACERBI.id, a), ancora: null, tituloDoMolde: { caixa_alta: true }, amostras: 2 });
    const chaveCme = chaveDaTipografia(CLIENTE_A, CME.id, a);
    expect(ancoraDaSerie([{ ordem: 1, versao: 1, tipografia: doAcerbi }], 2, chaveCme)).toBeNull();
    expect(ancoraDaSerie([{ ordem: 1, versao: 1, tipografia: doAcerbi }], 2, doAcerbi.chave)).not.toBeNull();
    // Registro sem chave (versão antiga) não é âncora.
    expect(ancoraDaSerie([{ ordem: 1, versao: 1, tipografia: { titulo: "X" } }], 2, doAcerbi.chave)).toBeNull();
  });

  it("Acerbi e CME: a tela e o servidor escolhem as mesmas fontes; outra marca nunca entra", () => {
    const fontes = [
      { id: "c1", nome: "Abril Fatface", marca_id: null },
      { id: "c2", nome: "Lato", marca_id: null },
      { id: "m1", nome: "Montserrat", marca_id: CME.id },
      { id: "x1", nome: "De outra", marca_id: "33333333-0000-4000-8000-000000000003" },
    ];
    const leve = (m: { id: string; principal: boolean }) => ({ id: m.id, client_id: CLIENTE_A, project_id: null, nome: "M", principal: m.principal });
    for (const marca of [null, ACERBI, CME]) {
      const tela = fontesDaMarcaNaTela(fontes, marca).map((f) => f.id);
      const serv = fontesDaMarca(fontes, marca ? leve(marca) : null).map((f) => f.id);
      expect(tela, JSON.stringify(marca)).toEqual(serv);
    }
    expect(fontesDaMarcaNaTela(fontes, ACERBI).map((f) => f.id)).toEqual(["c1", "c2"]);
    expect(fontesDaMarcaNaTela(fontes, CME).map((f) => f.id)).toEqual(["m1"]);
    // CME sem fonte própria: usa as do cliente (a tela avisa), nunca a de outra marca.
    const semDaCme = fontes.filter((f) => f.id !== "m1");
    expect(fontesDaMarcaNaTela(semDaCme, CME).map((f) => f.id)).toEqual(["c1", "c2"]);
    expect(usaFontesDoCliente(semDaCme, CME)).toBe(true);
    expect(usaFontesDoCliente(fontes, CME)).toBe(false);
    expect(marcaParaGravarNaTela(CME)).toEqual({ marca_id: CME.id });
    expect(marcaParaGravarNaTela(ACERBI)).toEqual({});
  });

  it("biblioteca na CME grava a fonte nela; a amostra do cliente sai junto da linha trocada (a da biblioteca, nunca)", () => {
    const familia = { id: "fb1", familia: "Montserrat", slug: "montserrat", categoria: null, personalidade: [], usos: [], nichos: [], pareamentos: [], amostra_path: "biblioteca/fontes/montserrat/amostra.png", suporta_portugues: true, arquivos: [{ arquivo: "biblioteca/fontes/montserrat/M-Bold.ttf", peso: 700 }] };
    const atuais = [{ id: "old", nome: "Antiga", papel: "titulo", storage_path: "biblioteca/fontes/a/A.ttf", amostra_path: `${CLIENTE_A}/marca/${CME.id}/tipografia-titulo-old.png`, origem: "biblioteca", biblioteca_id: "fb0" }];
    const plano = planejarTrocaDeFontes(CLIENTE_A, atuais, { titulo: familia }, CME.id);
    expect(plano.inserir[0].marca_id).toBe(CME.id);
    expect(plano.arquivosParaRemover).toEqual([`${CLIENTE_A}/marca/${CME.id}/tipografia-titulo-old.png`]);
    const daBiblioteca = planejarTrocaDeFontes(CLIENTE_A, [{ ...atuais[0], amostra_path: "biblioteca/fontes/a/amostra.png" }], { titulo: familia });
    expect(daBiblioteca.arquivosParaRemover).toEqual([]);
    expect(daBiblioteca.inserir[0]).not.toHaveProperty("marca_id");
  });

  it("no servidor: fontes sempre de (client_id, marca do trabalho); nenhum cache sem cliente", () => {
    const g = corpoDe("gerarCard");
    expect(g).toContain("lerFontes(t.client_id, t),");
    expect(g).toContain("const tipografia = tipografiaDoKit(fontes);");
    expect(g).toContain("const chaveDaSerie = chaveDaTipografia(t.client_id, marcaDaTipografia ? marcaDaTipografia.id : null, tipografia);");
    expect(servidor).toContain('.from("cliente_fontes")\n    .select(colunasComMarca("id, nome, papel, amostra_path", marca))\n    .eq("client_id", clientId)');
    const modulo = ler("supabase/functions/estudio-arte/tipografia-do-cliente.ts");
    // Nenhum cache no módulo (só variáveis dentro das funções).
    expect(modulo).not.toMatch(/^(let|const) [a-zA-Z]+ = new Map/m);
  });
});

// ------------------------------------------------------------ 5. trava da marca

describe("5. Trava da marca: a letra da referência nunca entra", () => {
  it("fonte da referência sai do texto; a do kit fica e fecha a regra", () => {
    const kit = { fontes: [{ nome: "Abril Fatface", papel: "titulo" }, { nome: "Lato", papel: "texto" }] };
    const lido = neutralizarMarcaDaReferencia('Título em Montserrat Black, caixa alta; apoio em fonte "Gotham Book" e texto em Lato.', kit);
    expect(lido).not.toContain("Montserrat");
    expect(lido).not.toContain("Gotham");
    expect(lido).toContain("Lato");
    expect(blocoDaMarcaTravada(kit)).toContain("LETRA: Abril Fatface (titulo), Lato (texto)");
    const bloco = blocoDaTipografia({ registro: registroDaLamina({ tip: tipografiaDoKit(kit.fontes)!, chave: "k", ancora: null, amostras: 0 }), indices: {}, ordem: 1, total: 1 });
    expect(bloco).toContain("vale sobre o desenho de letra de qualquer referência");
    expect(bloco).toContain("nem a da referência");
    expect(bloco).not.toContain("Montserrat");
  });
});

// ------------------------------------------------------------ 6. amostra no navegador

describe("6. Amostra da tipografia no navegador", () => {
  beforeEach(() => {
    amostras.geradas = [];
  });

  it("pasta do cliente, marca própria e prancha 1600 x 900 com AaBbCc 123 e a frase em caixa alta e baixa", () => {
    expect([LARGURA_DA_AMOSTRA, ALTURA_DA_AMOSTRA]).toEqual([1600, 900]);
    expect(caminhoDaAmostraDaTipografia(CLIENTE_A, null, "titulo", "fa-t-123456789")).toBe(`${CLIENTE_A}/marca/tipografia-titulo-fat12345.png`);
    expect(caminhoDaAmostraDaTipografia(CLIENTE_A, CME.id, "texto", "abc")).toBe(`${CLIENTE_A}/marca/${CME.id}/tipografia-texto-abc.png`);
    expect(caminhoDaAmostraDaTipografia(CLIENTE_A, "../outro", "texto", "abc")).toBe(`${CLIENTE_A}/marca/tipografia-texto-abc.png`);
    expect(ehAmostraDaTipografia(`${CLIENTE_A}/marca/tipografia-titulo-x.png`, CLIENTE_A)).toBe(true);
    expect(ehAmostraDaTipografia("biblioteca/fontes/lato/amostra.png", CLIENTE_A)).toBe(false);
    expect(ehAmostraDaTipografia(`${CLIENTE_A}/marca/tipografia-titulo-x.png`, CLIENTE_B)).toBe(false);
    const linhas = linhasDaAmostra("Abril Fatface", "titulo", (t, px) => t.length * px * 0.6);
    expect(linhas.map((l) => l.texto)).toEqual(["Título · Abril Fatface", TEXTO_DA_AMOSTRA, FRASE_DA_AMOSTRA, FRASE_DA_AMOSTRA.toUpperCase()]);
    for (const l of linhas.slice(1)) expect(l.texto.length * l.px * 0.6).toBeLessThanOrEqual(1440);
    expect(linhas[0].letra).toBe("sistema");
    expect(linhas[linhas.length - 1].y + linhas[linhas.length - 1].px).toBeLessThan(ALTURA_DA_AMOSTRA);
    expect(FRASE_DA_AMOSTRA).toMatch(/[ãçáà]/);
  });

  it("lê o arquivo do cliente ou da biblioteca; sem arquivo, o Google Fonts no peso do papel", async () => {
    expect(arquivoDeFonteLegivel(`${CLIENTE_A}/fontes/x.woff2`, CLIENTE_A)).toBe(true);
    expect(arquivoDeFonteLegivel("biblioteca/fontes/lato/Lato.ttf", CLIENTE_A)).toBe(true);
    expect(arquivoDeFonteLegivel(`${CLIENTE_B}/fontes/x.ttf`, CLIENTE_A)).toBe(false);
    expect(arquivoDeFonteLegivel("biblioteca/fontes/lato/amostra.png", CLIENTE_A)).toBe(false);
    expect(urlDoGoogleFonts("Abril Fatface", 700)).toBe("https://fonts.googleapis.com/css2?family=Abril+Fatface:wght@700&display=block");
    expect(pesoDaTipografia("titulo")).toBe(700);
    expect(pesoDaTipografia("texto")).toBe(400);

    const baixados: string[] = [];
    const enviados: string[] = [];
    const registrados: string[][] = [];
    const removidos: string[][] = [];
    const google: [string, number][] = [];
    const deps: DependenciasDaAmostra = {
      baixar: async (c) => { baixados.push(c); return new Blob(["fonte"]); },
      enviar: async (c) => { enviados.push(c); },
      registrar: async (id, c) => { registrados.push([id, c]); },
      remover: async (c) => { removidos.push(c); },
      carregarArquivo: async () => ({ familia: "t2-x", peso: "normal", liberar: () => undefined }),
      carregarGoogle: async (f, p) => { google.push([f, p]); return { familia: f, peso: String(p), liberar: () => undefined }; },
      desenhar: async () => new Blob(["png"], { type: "image/png" }),
    };
    const r1 = await gerarAmostraDaTipografia(CLIENTE_A, { id: "fa-t", nome: "Abril Fatface", papel: "titulo", storage_path: "biblioteca/fontes/abril/A.ttf", amostra_path: "biblioteca/fontes/abril/amostra.png" }, deps);
    expect(r1).toEqual({ caminho: `${CLIENTE_A}/marca/tipografia-titulo-fat.png`, origem: "arquivo" });
    expect(baixados).toEqual(["biblioteca/fontes/abril/A.ttf"]);
    expect(registrados).toEqual([["fa-t", `${CLIENTE_A}/marca/tipografia-titulo-fat.png`]]);
    // A amostra da biblioteca é compartilhada: nunca sai.
    expect(removidos).toEqual([]);
    // Arquivo de outro cliente nunca é lido: vai pelo nome no Google Fonts; a amostra antiga do cliente sai.
    const r2 = await gerarAmostraDaTipografia(CLIENTE_A, { id: "fa-x", nome: "Lato", papel: "texto", storage_path: `${CLIENTE_B}/fontes/l.ttf`, amostra_path: `${CLIENTE_A}/fontes/amostra-fa-x.png` }, deps);
    expect(r2.origem).toBe("google");
    expect(baixados).toEqual(["biblioteca/fontes/abril/A.ttf"]);
    expect(google).toEqual([["Lato", 400]]);
    expect(removidos).toEqual([[`${CLIENTE_A}/fontes/amostra-fa-x.png`]]);
    expect(enviados.every((c) => c.indexOf(`${CLIENTE_A}/marca/`) === 0)).toBe(true);
  });

  it("arquivos novos: sem lookbehind, \\p{}, grupo nomeado, .at() ou travessão", () => {
    for (const rel of [
      "src/lib/mesa/amostraDaFonte.ts",
      "src/lib/mesa/tipografiaDoCliente.ts",
      "src/components/mesa/EstudioSemTipografia.tsx",
      "src/components/mesa/EstudioAvisoSemFonte.tsx",
      "src/components/mesa/ContextoFontes.tsx",
      "supabase/functions/estudio-arte/tipografia-do-cliente.ts",
    ]) {
      const t = ler(rel);
      expect(t, rel).not.toContain("(?<");
      expect(t, rel).not.toMatch(/\\p\{/);
      expect(t, rel).not.toContain(".at(");
      expect(t, rel).not.toContain("Object.hasOwn");
      expect(t, rel).not.toMatch(/[—–]/);
    }
  });
});

import { blocoDaTipografia as blocoDaTipografiaCaixa, palavraEmCaixaAlta } from "../../supabase/functions/estudio-arte/tipografia-do-cliente";

/**
 * Dono, 26/09: "era legal quando nos cards seguintes ele gerava uma palavra às
 * vezes em caixa alta; não tire, mas não sempre, só quando fica bacana".
 */
describe("destaque de caixa nas lâminas do meio", () => {
  const headline = "Seu site precisa explicar\no que você vende";
  it("só nas lâminas do meio, alternadas, e na palavra mais forte do título", () => {
    expect(palavraEmCaixaAlta({ headline, ordem: 1, total: 6, caixaTitulo: "como_escrito" })).toBeNull();
    expect(palavraEmCaixaAlta({ headline, ordem: 2, total: 6, caixaTitulo: "como_escrito" })).toBe("explicar");
    expect(palavraEmCaixaAlta({ headline, ordem: 3, total: 6, caixaTitulo: "como_escrito" })).toBeNull();
    expect(palavraEmCaixaAlta({ headline, ordem: 6, total: 6, caixaTitulo: "como_escrito" })).toBeNull();
  });
  it("não repete o recurso quando o título já é todo em caixa alta, nem em título curto ou post único", () => {
    expect(palavraEmCaixaAlta({ headline, ordem: 2, total: 6, caixaTitulo: "alta" })).toBeNull();
    expect(palavraEmCaixaAlta({ headline: "Site novo", ordem: 2, total: 6, caixaTitulo: "como_escrito" })).toBeNull();
    expect(palavraEmCaixaAlta({ headline, ordem: 2, total: 2, caixaTitulo: "como_escrito" })).toBeNull();
    expect(palavraEmCaixaAlta({ headline: "Você sabe quando anunciar?", ordem: 2, total: 5, caixaTitulo: "como_escrito" })).toBe("anunciar");
  });
  it("o bloco da tipografia pede a palavra em caixa alta na mesma fonte e peso, e sem ela fica igual", () => {
    const registro = { titulo: "Abril Fatface", texto: "Lato", peso_titulo: "700", caixa_titulo: "como_escrito", ancora: 1 } as any;
    const sem = blocoDaTipografiaCaixa({ registro, indices: {}, ordem: 2, total: 5 });
    const com = blocoDaTipografiaCaixa({ registro, indices: {}, ordem: 2, total: 5, destaqueDeCaixa: "explicar" });
    expect(sem).not.toContain("CAIXA ALTA");
    expect(com).toContain('a palavra "explicar" do título vem em CAIXA ALTA, na mesma fonte e no mesmo peso');
    expect(com).toContain("fora a palavra em destaque acima");
  });
  it("o Estúdio liga o destaque só fora da Mesa Ads", () => {
    const fonte = readFileSync(resolve(__dirname, "../../supabase/functions/estudio-arte/index.ts"), "utf8");
    expect(fonte).toContain("const destaqueDeCaixa = ads ? null : palavraEmCaixaAlta(");
  });
});
