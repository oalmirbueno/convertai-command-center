import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estúdio da Mesa, frente A (pedidos do dono em 25/09):
 * 1. trabalho entregue ou reprovado: "Reabrir para corrigir"; fotos, pastas e
 *    referências dizem o que impede em vez de travar calados; tirar foto e
 *    referência da lâmina com um X;
 * 2. logo sem caixa branca: aplicada pelo código em todos os modos;
 * 3. Tirar fundo: a foto sai sem fundo (mesa-foto preparar) e entra como elemento;
 * 4. série do carrossel guiada pela capa, sem precisar do contínuo;
 * 5. formatos do Instagram: 4:5, 3:4 (1080 x 1440), 1:1 e 9:16;
 * 6. designer mais forte e regras aprendidas com o cliente no prompt.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const imagemLocal = ler("supabase/functions/_shared/imagem-local.ts");
const corpoDe = (nome: string) => {
  const i = estudio.indexOf(`function ${nome}(`);
  const fins = [estudio.indexOf("\nasync function ", i + 10), estudio.indexOf("\nfunction ", i + 10), estudio.indexOf("\n// ----", i + 10)].filter((x) => x > 0);
  return estudio.slice(i, Math.min(...fins));
};

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, any[]> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    from: (tabela: string) => {
      const filtros: ((r: any) => boolean)[] = [];
      const b: any = {
        select: () => b,
        order: () => b,
        limit: () => b,
        range: () => b,
        is: () => b,
        in: () => b,
        eq: (c: string, v: unknown) => {
          filtros.push((r) => r[c] === v);
          return b;
        },
        then: (ok: any, erro: any) => Promise.resolve({ data: (mock.tabelas[tabela] || []).filter((r) => filtros.every((f) => f(r))), error: null }).then(ok, erro),
      };
      return b;
    },
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.png" }, error: null })),
        upload: vi.fn(),
        download: vi.fn(),
      })),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EstudioFotos, { fotosParaSalvar, type FotoLivre } from "@/components/mesa/EstudioFotos";
import EstudioEntrega from "@/components/mesa/EstudioEntrega";
import { SeletorDeFormato } from "@/components/mesa/EstudioPreparar";
import { baseDaLamina } from "@/components/mesa/EstudioBaseDaLamina";
import {
  corpoDoPreparar,
  corpoDoReabrir,
  corpoDoTirarFundo,
  FORMATOS_DO_POST as FORMATOS_DA_TELA,
  formatoDoTrabalho,
  jaSemFundo,
  proporcaoDoFormato,
  versaoForaDoFormato,
} from "@/components/mesa/estudioUtil";
import {
  blocoDaSerie,
  blocoDasPreferencias,
  blocoReplicarReferencia,
  caixaDaLogo,
  caixaDaZona,
  formatoDoPost,
  FORMATOS_DO_POST,
  lugarDoRecorte,
  margensDoPost,
  promptDaLamina,
  QUADRO_DO_POST,
  type MarcaParaDirecao,
} from "../../supabase/functions/_shared/direcao-arte";
import { CONHECIMENTO_DIRETOR, PADRAO_NA_IMAGEM } from "../../supabase/functions/_shared/conhecimento-design";

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
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
  return render(h(MemoryRouter, { initialEntries: ["/mesa?aba=estudio"] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

const marca = (): MarcaParaDirecao => ({
  nomeCliente: "Cliente",
  paleta: [{ nome: "Azul", hex: "#0B2A4A", papel: "primaria" }, { nome: "Laranja", hex: "#F28C28", papel: "destaque" }],
  estilo: null,
  regras: null,
  fontes: [{ nome: "Inter", papel: "titulo" }],
  temLogo: true,
});

const card = (ordem = 1) => ({
  ordem,
  funcao: ordem === 1 ? "capa" : "conteudo",
  texto_exato: "Seu site vende\nou só existe?",
  blocos: [{ papel: "headline" as const, texto: "Seu site vende\nou só existe?" }],
  layout: { zona_texto: "base-esquerda" as const, alinhamento: "esquerda" as const, imagem: "mesa", ponto_focal: "mesa", fundo: "parede", tratamento: "editorial" },
  ilustracao: "mesa",
});

const ACERVO = {
  id: "a1",
  client_id: CLIENTE,
  ativa: true,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/ensaios/a1.png`,
  nome: "Foto a1",
  pasta: "Mesa Foto / Ensaios",
  categoria: "produto",
  tags: ["mesa_foto"],
  descricao: null,
  origem: "mesa_foto",
  aprovada: true,
  gerada: true,
  modo: "ensaio",
  criado_em: "2026-09-24T10:00:00Z",
};

beforeEach(() => {
  mock.invoke.mockReset();
  mock.tabelas = { cliente_imagens: [ACERVO] };
  (toast.error as any).mockClear();
  (toast.success as any).mockClear();
});

// ------------------------------------------------------------ 1. reabrir

describe("1. trabalho entregue: reabrir para corrigir", () => {
  it("o servidor tem a ação reabrir: nova rodada, histórico da entrega e mesmas lâminas", () => {
    expect(estudio).toContain("  reabrir,\n};");
    const r = corpoDe("reabrir");
    expect(r).toContain("if (!estaEntregue(t)) return json({ trabalho: t, ja_aberto: true, custo_usd: 0 });");
    expect(r).toContain("entrega_rodada: rodada + 1,");
    expect(r).toContain('entrega_status: x.entrega_status === "reprovado" ? "reprovado" : null,');
    expect(r).toContain("reaberturas: [...(x.direcao.reaberturas ?? []), historico].slice(-20),");
    // Não apaga versões nem arquivos: as lâminas continuam, a entrega anterior fica em Arquivos.
    expect(r).not.toContain("cards: []");
    expect(r).not.toContain("file_ids: []");
  });

  it("o erro de trabalho entregue aponta o Reabrir e vale também para o agendado", () => {
    expect(corpoDe("erroTrabalhoEntregue")).toContain("Reabrir para corrigir");
    expect(corpoDe("erroTrabalhoEntregue")).toContain("{ pode_reabrir: true }");
    expect(estudio).toContain('t.status === "entregue" || t.entrega_status === "agendado";');
    expect(estudio).not.toContain("Prepare um novo para refazer as artes.");
    for (const f of ["garantirEditavel", "configurar", "aplicarMudancas"]) expect(corpoDe(f)).toContain("estaEntregue(");
  });

  it("corpo do reabrir e botão na ferramenta Entrega", () => {
    expect(corpoDoReabrir("t-1")).toEqual({ acao: "reabrir", trabalho_id: "t-1" });
    expect(corpoDoReabrir("t-1", "  cliente pediu outra capa ")).toEqual({ acao: "reabrir", trabalho_id: "t-1", motivo: "cliente pediu outra capa" });
    const onReabrir = vi.fn();
    render(
      h(MemoryRouter, null, h(EstudioEntrega, {
        trabalho: { id: "t", task_id: "k", status: "entregue", direcao: {}, modelo_imagem_id: null, qualidade: null, cards: [], legenda: null, file_ids: ["f"], custo_usd: 0, conversa_id: null, atualizado_em: "", entrega_status: "reprovado" } as any,
        laminasFeitas: 3,
        laminasTotal: 3,
        legendaEscrita: true,
        ehDesign: false,
        entregando: false,
        enviando: false,
        ocupado: false,
        erroDoEnvio: null,
        linkArquivos: "/arquivos",
        linkAgenda: null,
        onEntregar: vi.fn(),
        onEnviar: vi.fn(),
        onReabrir,
      })),
    );
    fireEvent.click(screen.getByRole("button", { name: /Reabrir para corrigir/ }));
    expect(onReabrir).toHaveBeenCalled();
  });

  it("Fotos com o trabalho entregue: as pastas abrem, o clique explica e oferece Reabrir", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    const onReabrir = vi.fn();
    const { container } = montar(h(EstudioFotos, { card: { ordem: 1, fotos_livres: [] }, ocupado: false, entregue: true, onReabrir, temArte: true, onSalvar }));
    // Antes: pointer-events-none no acervo inteiro (nem as pastas abriam).
    expect(container.querySelector("div.pointer-events-none")).toBeNull();
    expect(screen.getByText(/Trabalho entregue: as fotos não mudam/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
    expect(onReabrir).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: /Mesa Foto/ }));
    const usar = await screen.findByRole("button", { name: "Usar nesta lâmina: Foto a1" });
    expect((usar as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(usar);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String((toast.error as any).mock.calls[0][0])).toContain("Reabrir para corrigir");
    expect(onSalvar).not.toHaveBeenCalled();
  });

  it("foto já na lâmina: o clique tira (antes ficava desabilitada sem dizer nada)", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    montar(h(EstudioFotos, { card: { ordem: 2, fotos_livres: [{ caminho: ACERVO.storage_path, papel: "fundo" }] }, ocupado: false, temArte: false, onSalvar }));
    fireEvent.click(screen.getByRole("tab", { name: /Mesa Foto/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Tirar da lâmina: Foto a1" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ card: { ordem: 2, fotos_livres: [] } }));
  });

  it("a faixa da lâmina tem o X de tirar foto e referência (e o servidor liga tirar pelo configurar)", () => {
    const faixa = ler("src/components/mesa/EstudioBaseDaLamina.tsx");
    expect(faixa).toContain("onTirarFoto(f.caminho)");
    expect(faixa).toContain("onTirarReferencia(id)");
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain("fotos_livres: (cardSelecionado.fotos_livres || []).filter((f) => f.caminho !== caminho)");
    expect(aba).toContain("referencias_ids: (cardSelecionado.referencias_ids || []).filter((r) => r !== id)");
    // Referências: com o trabalho entregue a tela diz por quê em vez de marcar e o servidor recusar calado.
    const refs = ler("src/components/mesa/ReferenciasDoEstudio.tsx");
    expect(refs).toContain("Trabalho entregue: as referências não mudam");
  });
});

// ------------------------------------------------------------ 2. logo

describe("2. logo sem caixa branca, pelo código em todos os modos", () => {
  it("o prompt nunca pede fundo claro atrás da logo e proíbe caixa", () => {
    for (const clara of [true, false]) {
      const p = promptDaLamina(card(), marca(), { total: 1, carrosselInfinito: false, levaLogo: true, logo: { tom: "#0B2A4A", clara } });
      expect(p).not.toContain("claro e liso");
      expect(p).toContain("sem caixa, cartão, faixa, retângulo ou fundo branco atrás");
    }
    const noCodigo = promptDaLamina(card(), marca(), { total: 1, carrosselInfinito: false, levaLogo: true, logoNoCodigo: true });
    expect(noCodigo).toContain("NÃO desenhe logo");
    expect(noCodigo).toContain("sem caixa, cartão, faixa ou mancha clara reservando lugar para ela");
  });

  it("gerar_card: logo limpa aplicada pelo código em todos os modos, com a versão que contrasta", () => {
    const g = corpoDe("gerarCard");
    expect(g).toContain("const daMarca = await logosDaMarca(t.client_id, kit);");
    expect(g).toContain("logosNoCodigo = daMarca.logos;");
    // replicar, foto composta, foto real, recorte e normal passam pelo acabamento.
    expect((g.match(/await acabar\(/g) ?? []).length).toBe(5);
    expect(corpoDe("logosDaMarca")).toContain("tomAlt.clara !== tom.clara");
    expect(estudio).toContain("logoNoCodigo }),");
    expect(blocoReplicarReferencia({ referencias: [{ indice: 1 }], fotos: [], logoNoCodigo: true })).toContain("não desenhe logo nem caixa para ela");
  });

  it("o ajuste não redesenha a logo do código: fica fixa e volta pelo código", () => {
    const a = corpoDe("ajustarCard");
    expect(a).toContain('const logoDoCodigo = !naEmenda && levaLogo(t, ordem) && marcaDaVersao.logo_no_codigo === true;');
    expect(a).toContain('(naEmenda || logoDoCodigo) && levaLogo(base, ordem) ? "fixa"');
    expect(a).toContain("await acabamentoDaLamina(img.png, {");
  });

  it("logoLimpa tira fundo branco, creme e a franja; a logo grande chega reduzida", () => {
    expect(imagemLocal).toContain("(temCorDeFundo && min >= 170 && distancia(i) <= 26)");
    expect(imagemLocal).toContain("if (limpos < W * H * 0.005 || limpos > W * H * 0.97) return bytes;");
    expect(imagemLocal).toContain("const a = Math.min(1, distancia(i) / 70);");
    expect(corpoDe("baixarLogoReduzida")).toContain('transform: { width: 1024, height: 1024, resize: "contain", format: "origin" }');
    // A caixa da logo vai para dentro do recorte central quando a arte volta em 2:3.
    expect(imagemLocal).toContain("export function caixaNoQuadroCentral(");
  });
});

// ------------------------------------------------------------ 3. tirar fundo

describe("3. Tirar fundo: a foto entra sem fundo como elemento", () => {
  it("corpo da mesa-foto e foto que já é recorte", () => {
    expect(corpoDoTirarFundo(CLIENTE, "a1")).toEqual({ acao: "preparar", client_id: CLIENTE, imagem_id: "a1", modo: "fundo_transparente" });
    expect(jaSemFundo({ tags: ["mesa_foto", "preparo:fundo_transparente"] })).toBe(true);
    expect(jaSemFundo({ tags: ["mesa_foto"] })).toBe(false);
  });

  it("recortada só vale no elemento e é gravada", () => {
    const lista: FotoLivre[] = [
      { caminho: "c/f.png", papel: "fundo", recortada: true },
      { caminho: "c/e.png", papel: "elemento", recortada: true },
    ];
    expect(fotosParaSalvar(lista)).toEqual([{ caminho: "c/f.png", papel: "fundo" }, { caminho: "c/e.png", papel: "elemento", recortada: true }]);
    expect(corpoDe("lerFotosLivres")).toContain('if (papel === "elemento" && o.recortada === true) saida[saida.length - 1].recortada = true;');
  });

  it("com Tirar fundo ligado, a foto escolhida passa pela Mesa Foto e entra como elemento sem fundo", async () => {
    const derivada = `${CLIENTE}/foto/derivadas/x.png`;
    mock.invoke.mockResolvedValue({ data: { imagem: { storage_path: derivada } }, error: null });
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    montar(h(EstudioFotos, { card: { ordem: 1, fotos_livres: [] }, ocupado: false, temArte: false, onSalvar }));
    fireEvent.click(screen.getByRole("tab", { name: /Mesa Foto/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Tirar fundo/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Usar nesta lâmina: Foto a1" }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("mesa-foto", { body: corpoDoTirarFundo(CLIENTE, "a1") }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ card: { ordem: 1, fotos_livres: [{ caminho: derivada, papel: "elemento", recortada: true }] } }));
  });

  it("no servidor, o recorte entra do lado oposto ao texto, protegido na máscara e colado de novo", () => {
    const g = corpoDe("gerarCard");
    expect(g).toContain("const recortado = !baseFoto && !panorama && !replicar ? elementos.find((e) => e.recortada) ?? null : null;");
    expect(g).toContain("const lugar = lugarDoRecorte(layoutAtual.zona_texto);");
    expect(g).toContain("editar: { bytes: tela.tela, mascara: tela.mascara },");
    expect(g).toContain('modo: "recorte",');
    expect(g).toContain("Sem caixa, moldura, borda, contorno branco, halo ou brilho em volta do recorte");
    // O recorte nunca fica sob o texto: a caixa dele não cruza a zona do texto.
    for (const z of ["topo-esquerda", "topo-centro", "centro", "base-centro", "base-esquerda", "centro-esquerda", "coluna-esquerda", "coluna-direita", "base-direita"] as const) {
      const { zona, caixa } = lugarDoRecorte(z);
      const t = caixaDaZona(zona, true, true);
      const cruza = caixa.x0 * 100 < t.x1 && t.x0 < caixa.x1 * 100 && caixa.y0 * 100 < t.y1 && t.y0 < caixa.y1 * 100;
      expect(cruza).toBe(false);
    }
    expect(baseDaLamina({ fotos_livres: [{ caminho: "c/e.png", papel: "elemento", recortada: true } as any] }, [], false).modo).toBe("recorte");
  });
});

// ------------------------------------------------------------ 4. série

describe("4. série do carrossel guiada pela capa, sem o contínuo", () => {
  it("blocoDaSerie: nada na capa; do miolo em diante segue a capa; o final fecha nela", () => {
    expect(blocoDaSerie({ ordem: 1, total: 5, capa: null })).toBe("");
    expect(blocoDaSerie({ ordem: 2, total: 1, capa: 3 })).toBe("");
    const miolo = blocoDaSerie({ ordem: 3, total: 5, capa: 4 });
    expect(miolo).toContain("a capa (imagem 4)");
    expect(miolo).toContain("as mesmas linhas, formas e elementos gráficos");
    expect(miolo).toContain("Não reinvente o estilo");
    expect(miolo).not.toContain("FECHAMENTO");
    expect(blocoDaSerie({ ordem: 5, total: 5, capa: 4 })).toContain("FECHAMENTO");
    expect(blocoDaSerie({ ordem: 2, total: 4, capa: 3, cenaFixa: true })).toContain("A cena desta lâmina já está decidida");
  });

  it("gerar_card anexa a capa atual e põe o bloco da série fora do replicar", () => {
    const g = corpoDe("gerarCard");
    expect(g).toContain("const capa = ordem > 1 && total > 1 ? versaoAtual(t, 1) : null;");
    expect(g).toContain("if (capa && ordem > 2 && !replicar) {");
    expect(g).toContain('replicar ? "" : blocoDaSerie({ ordem, total, capa: posicaoDaCapa === null ? null : posicaoDaCapa + 1 + deslocamento, cenaFixa }),');
    expect(g).toContain("CAPA desta série (lâmina 1), já aprovada: é o guia do sistema visual");
    // O contínuo continua igual: fatia do panorama e letras coladas por cima.
    expect(g).toContain("const colado = await colarMudancasNaBase(baseFoto, img.png, areasDoTexto, {");
  });
});

// ------------------------------------------------------------ 5. formatos

describe("5. formatos do Instagram", () => {
  it("quatro formatos, gerador em múltiplos de 16 e na proporção do final (menos de 1%)", () => {
    expect(FORMATOS_DO_POST).toEqual(["feed_4x5", "retrato_3x4", "quadrado_1x1", "stories_9x16"]);
    expect(QUADRO_DO_POST.retrato_3x4.final).toEqual({ largura: 1080, altura: 1440 });
    for (const f of FORMATOS_DO_POST) {
      const q = QUADRO_DO_POST[f];
      expect(q.gerador.largura % 16).toBe(0);
      expect(q.gerador.altura % 16).toBe(0);
      const erro = Math.abs(q.gerador.largura / q.gerador.altura - q.final.largura / q.final.altura) / (q.final.largura / q.final.altura);
      expect(erro).toBeLessThan(0.01);
    }
    expect(formatoDoPost("qualquer")).toBe("feed_4x5");
    // A fonte do 3:4 está citada no código.
    expect(ler("supabase/functions/_shared/direcao-arte.ts")).toContain("https://nealschaffer.com/instagram-post-size/");
  });

  it("4:5 fica exatamente como era; 3:4, 1:1 e 9:16 levam o quadro e as margens do formato", () => {
    const antes = promptDaLamina(card(), marca(), { total: 3, carrosselInfinito: false, levaLogo: true });
    expect(promptDaLamina(card(), marca(), { total: 3, carrosselInfinito: false, levaLogo: true, post: "feed_4x5" })).toBe(antes);
    expect(promptDaLamina(card(), marca(), { total: 3, carrosselInfinito: false, levaLogo: true, post: "retrato_3x4" })).toContain("(1080 x 1440)");
    const stories = promptDaLamina(card(), marca(), { total: 1, carrosselInfinito: false, levaLogo: true, post: "stories_9x16" });
    expect(stories).toContain("(1080 x 1920)");
    expect(stories).toContain("Stories e Reels");
    expect(margensDoPost("stories_9x16")).toMatchObject({ topo: 14, base: 20 });
    expect(margensDoPost("quadrado_1x1").capaExtra).toBe(12.5);
    for (const f of FORMATOS_DO_POST) {
      for (const z of ["topo-esquerda", "base-esquerda", "coluna-direita", "centro"] as const) {
        const c = caixaDaZona(z, true, true, null, f);
        expect(c.x0).toBeGreaterThanOrEqual(0);
        expect(c.x1).toBeLessThanOrEqual(100);
        expect(c.y0).toBeGreaterThanOrEqual(0);
        expect(c.y1).toBeLessThanOrEqual(100);
        const l = caixaDaLogo(z, true, null, f);
        expect(l.y1).toBeLessThanOrEqual(100);
      }
    }
  });

  it("servidor: quadro do formato, contínuo só no 4:5, entrega recusa lâmina de outro formato", () => {
    expect(corpoDe("quadroDoCard")).toContain("const post = formatoDoPost(t.direcao?.formato);");
    expect(corpoDe("usaPanorama")).toContain('if (formatoDoPost(t.direcao.formato) !== "feed_4x5") return false;');
    expect(corpoDe("entregar")).toContain('"laminas_em_outro_formato"');
    expect(corpoDe("entregar")).toContain("const lamina = await laminaFinal(versao!.storage_path, quadroFinal);");
    expect(corpoDe("configurar")).toContain("formatoNovo = conjunto.formato as FormatoDoPost;");
    expect(corpoDe("preparar")).toContain('if (formato !== "feed_4x5") direcao.formato = formato;');
  });

  it("tela: seletor com os quatro, corpo do preparar e versão de outro formato", () => {
    expect(FORMATOS_DA_TELA.map((f) => f.valor)).toEqual(FORMATOS_DO_POST);
    expect(proporcaoDoFormato("retrato_3x4")).toBe(0.75);
    expect(formatoDoTrabalho({ formato: "quadrado_1x1" })).toBe("quadrado_1x1");
    expect(formatoDoTrabalho(null)).toBe("feed_4x5");
    expect(versaoForaDoFormato({}, "feed_4x5")).toBe(false);
    expect(versaoForaDoFormato({}, "retrato_3x4")).toBe(true);
    expect(versaoForaDoFormato({ formato_post: "retrato_3x4" }, "retrato_3x4")).toBe(false);
    expect(corpoDoPreparar("t", { modo: "diretor", laminas: null, continuo: false, pedido: "", formato: "retrato_3x4" }).formato).toBe("retrato_3x4");
    expect(corpoDoPreparar("t", { modo: "diretor", laminas: null, continuo: false, pedido: "", formato: "feed_4x5" }).formato).toBeUndefined();
    const onMudar = vi.fn();
    render(h(SeletorDeFormato, { valor: "feed_4x5", onMudar }));
    expect(screen.getAllByRole("radio").map((b) => b.getAttribute("data-formato"))).toEqual(FORMATOS_DO_POST);
    fireEvent.click(screen.getByRole("radio", { name: /3:4/ }));
    expect(onMudar).toHaveBeenCalledWith("retrato_3x4");
  });
});

// ------------------------------------------------------------ 6. designer

describe("6. designer mais forte e memória do cliente", () => {
  it("a base ganhou logo sem caixa, série pela capa, recorte e variedade, sem perder regras", () => {
    for (const t of ["15. LOGO SEM CAIXA", "16. SÉRIE A PARTIR DA CAPA", "17. PESSOA OU PRODUTO SEM FUNDO", "18. TÉCNICA E VARIEDADE", "19. O QUE O CLIENTE JÁ PEDIU", "90 px", "60-30-10", "14. NOME DA MARCA"]) {
      expect(CONHECIMENTO_DIRETOR).toContain(t);
    }
    expect(PADRAO_NA_IMAGEM).toContain("Logo sem caixa");
    for (const t of [CONHECIMENTO_DIRETOR, PADRAO_NA_IMAGEM]) expect(t).not.toMatch(/[—–]/);
  });

  it("preferências do cliente: sem repetir, até o teto, e evitar marcado", () => {
    const b = blocoDasPreferencias([
      { tipo: "preferencia", texto: "Capa sempre com foto real" },
      { tipo: "preferencia", texto: "capa sempre com foto real" },
      { tipo: "evitar", texto: "Fundo roxo" },
    ]);
    expect(b).toContain("REGRAS DA MARCA APRENDIDAS COM ESTE CLIENTE");
    expect(b.match(/Capa sempre/gi)).toHaveLength(1);
    expect(b).toContain("- Evitar: Fundo roxo");
    expect(blocoDasPreferencias([])).toBe("");
    expect(blocoDasPreferencias(Array.from({ length: 20 }, (_, i) => ({ tipo: "preferencia", texto: `regra ${i}` })), 5).split("\n")).toHaveLength(6);
  });

  it("as regras do cliente entram no preparo, na geração e no ajuste, pelo cérebro do cliente", () => {
    expect(estudio).toContain('import { AREAS_DO_AGENTE, contextoParaAgente, lerCerebro, resumoParaPrompt } from "../_shared/cerebro-do-cliente.ts";');
    expect(corpoDe("preferenciasDaArte")).toContain("areas: AREAS_DO_AGENTE.diretor_arte,");
    expect(corpoDe("preferenciasDaArte")).toContain("return blocoDasPreferencias(memoria ?? await memoriaDoDiretor(clientId));");
    expect(corpoDe("gerarCard")).toContain("preferenciasDaArte(t.client_id).catch(() => \"\"),");
    expect(corpoDe("ajustarCard")).toContain('auto ? Promise.resolve("") : preferenciasDaArte(t.client_id).catch(() => ""),');
    // Chamadas longas do diretor com 5 min.
    expect((estudio.match(/timeoutMs: 300_000,/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("refazer gira técnicas diferentes por lâmina e fica dentro da série", () => {
    expect(estudio).toContain("const i = versoesAntes - 1 + Math.max(0, ordem - 1);");
    expect(estudio).toContain("cor seletiva: a cena mais neutra");
    expect(estudio).toContain("A mudança fica dentro do sistema visual da capa");
  });
});
