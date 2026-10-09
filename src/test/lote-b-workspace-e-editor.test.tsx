import { describe, expect, it, vi } from "vitest";

// A tela do editor só precisa do cliente do banco para importar (o teste não chama nada).
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), functions: { invoke: vi.fn() }, rpc: vi.fn(), storage: { from: () => ({}) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { calcularContagens, pedeContagemPorPalavras, quadroDasContagens, blocoDasContagens, semNumerosDoModelo } from "../../supabase/functions/workspace-agent/contagens-do-workspace";
import { barradaPeloManter, conferirManter, operacoesDoManter, pedeManterSomente, selecionarParaManter } from "../../supabase/functions/editor-video/modulos/manter-somente";
import { NOMES_DAS_FERRAMENTAS, sistemaDoAgente } from "../../supabase/functions/editor-video/ferramentas";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import { aplicarOperacoes, trilhaPrincipal } from "@/lib/editor/operacoes";
import { executarFerramenta, rodarAgente } from "@/lib/editor/agente";
import { apelidosDoProjeto } from "@/lib/editor/apelidos";
import { respostaAPergunta } from "@/components/mesa-edicao/editor/AgenteEditor";

/**
 * Lote B, correções finais (09/10/2026). Testes isolados (não são produção):
 * 1. Workspace: "qual pasta tem mais itens" respondeu "materiais (38)" quando a maior
 *    era "Referencias de Design" (108). A contagem agora é do código, na regra da tela.
 * 2. Editor: "deixe só um" + a opção "Vídeo sobre prazo (0:00 a 1:12)" virou reenquadrar.
 *    Agora manter_somente escolhe e confere os clipes; reenquadrar é recusado.
 */

// O retrato do Workspace da AcelerIQ em 09/10 (mesmos números da tela).
function workspaceDaAceleriq() {
  const nos: { id: string; parent_id: string | null; kind: string; name: string; storage_path?: string | null }[] = [
    { id: "ref", parent_id: null, kind: "folder", name: "Referencias de Design" },
    { id: "site", parent_id: null, kind: "folder", name: "Referencias de Design Sitebolt" },
    { id: "exec", parent_id: null, kind: "folder", name: "Execução" },
    { id: "est", parent_id: null, kind: "folder", name: "Estáticos" },
    { id: "est-sub", parent_id: "est", kind: "folder", name: "vazia" },
  ];
  // Referências: 92 diretos (89 arquivos + 3 subpastas com 19 arquivos) = 108 arquivos dentro.
  for (let i = 0; i < 89; i++) nos.push({ id: `r${i}`, parent_id: "ref", kind: "file", name: `ref-${i}.png`, storage_path: `ws/ref-${i}.png` });
  ["c1", "c2", "c3"].forEach((c, k) => {
    nos.push({ id: c, parent_id: "ref", kind: "folder", name: `Carrossel ${k + 1}` });
    for (let i = 0; i < [5, 7, 7][k]; i++) nos.push({ id: `${c}-${i}`, parent_id: c, kind: "file", name: `${c}-${i}.png` });
  });
  for (let i = 0; i < 12; i++) nos.push({ id: `s${i}`, parent_id: "site", kind: "file", name: `site-${i}.png` });
  nos.push({ id: "exec-a", parent_id: "exec", kind: "folder", name: "a" }, { id: "exec-b", parent_id: "exec", kind: "folder", name: "b" });
  nos.push({ id: "x1", parent_id: "exec-a", kind: "file", name: "x1.pdf" }, { id: "x2", parent_id: "exec-b", kind: "file", name: "x2.pdf" });
  const arquivos: { folder: string | null; parent_file_id: string | null; storage_bucket: string | null; storage_path: string | null }[] = [];
  const secao = (nome: string, n: number) => {
    for (let i = 0; i < n; i++) arquivos.push({ folder: nome, parent_file_id: null, storage_bucket: "client-files", storage_path: `${nome}/${i}` });
  };
  secao("materiais", 38);
  secao("estrategicos", 17);
  secao("operacionais", 13);
  secao("relatorios", 2);
  // Slides de carrossel e espelhos do Workspace não contam (a tela também não conta).
  for (let i = 0; i < 100; i++) arquivos.push({ folder: "materiais", parent_file_id: "pai", storage_bucket: "client-files", storage_path: `slide/${i}` });
  for (let i = 0; i < 5; i++) arquivos.push({ folder: "materiais", parent_file_id: null, storage_bucket: "workspace", storage_path: `ws/ref-${i}.png` });
  return { nos, arquivos };
}

describe("Workspace: contagem e ranking calculados pelo código", () => {
  it("na regra da tela: Referências de Design 108 é a maior; materiais 38 é seção de Arquivos, não pasta", () => {
    const { nos, arquivos } = workspaceDaAceleriq();
    const c = calcularContagens(nos, arquivos, "AcelerIQ");
    expect(c.raiz.map((r) => [r.nome, r.tipo, r.itens])).toEqual([
      ["Referencias de Design", "pasta", 108],
      ["materiais", "secao", 38],
      ["estrategicos", "secao", 17],
      ["operacionais", "secao", 13],
      ["Referencias de Design Sitebolt", "pasta", 12],
      ["Execução", "pasta", 2],
      ["relatorios", "secao", 2],
      ["Estáticos", "pasta", 0],
    ]);
    const q = quadroDasContagens(c);
    expect(q).toContain("fonte: Workspace e Arquivos de AcelerIQ; escopo: raiz do cliente");
    expect(q).toContain("| Referencias de Design | pasta do Workspace | 108 |");
    expect(q).toContain("| materiais | seção de Arquivos | 38 |");
    expect(q).toContain('Na raiz: 8 itens (4 pastas do Workspace, 4 seções de Arquivos). Com mais itens: "Referencias de Design" (108).');
    expect(q).toContain('Pastas do Workspace: 4. Maior: "Referencias de Design" (108). Menor: "Estáticos" (0).');
    expect(q).toContain('Seções de Arquivos: 4. Maior: "materiais" (38). Menor: "relatorios" (2).');
  });

  it("o modelo recebe o quadro como fonte de verdade e, quando o quadro já abriu a resposta, não escreve outro número", () => {
    const { nos, arquivos } = workspaceDaAceleriq();
    const b = blocoDasContagens(calcularContagens(nos, arquivos, "AcelerIQ"), true);
    expect(b).toContain("use SÓ este quadro");
    expect(b).toContain("Pasta do Workspace e seção de Arquivos são coisas diferentes");
    expect(b).toContain("JÁ MOSTROU este quadro");
    expect(blocoDasContagens(calcularContagens(nos, arquivos, "AcelerIQ"), false)).not.toContain("JÁ MOSTROU");
  });

  it("depois do quadro, frase do modelo com número sai (o caso real: '8 pastas' quando eram 4 pastas e 4 seções)", () => {
    expect(semNumerosDoModelo("Entendi.\n\n8 pastas. A com mais itens é “Referencias de Design” (108).")).toBe("Entendi.");
    expect(semNumerosDoModelo("A maior concentra as referências visuais. Quer que eu organize as subpastas?")).toBe("A maior concentra as referências visuais. Quer que eu organize as subpastas?");
    expect(semNumerosDoModelo("Foram 3 itens.")).toBe("");
  });

  it("empate e leitura incompleta ficam escritos; as palavras de contagem valem sem o Jev", () => {
    const c = calcularContagens([{ id: "a", parent_id: null, kind: "folder", name: "A" }, { id: "b", parent_id: null, kind: "folder", name: "B" }, { id: "a1", parent_id: "a", kind: "file", name: "1" }, { id: "b1", parent_id: "b", kind: "file", name: "1" }], [], "X", false);
    const q = quadroDasContagens(c);
    expect(q).toContain('Com mais itens: "A" e "B" (1).');
    expect(q).toContain("a leitura parou no limite de páginas");
    expect(pedeContagemPorPalavras("Quantas pastas há na raiz e qual tem mais itens?")).toBe(true);
    expect(pedeContagemPorPalavras("qual seção é a maior?")).toBe(true);
    expect(pedeContagemPorPalavras("Crie uma pasta chamada Teste")).toBe(false);
  });
});

// Projeto com dois vídeos em sequência (t01 0 a 72 s; t02 72 a 148 s) e legendas, uma no limite.
function projetoDeDoisVideos(): ProjetoDeEdicao {
  const take = (id: string, nome: string, duracao_s: number) => ({ id, nome, tipo: "bruto", storage_bucket: "mesa", storage_path: `c/video/brutos/${id}.mov`, cena_ref: null, melhor: true, duracao_s, largura: 1080, altura: 1920 });
  const p = projetoDosTakes({ titulo: "Vídeo", fps: 25, takes: [take("a1", "take_t01.mp4", 72), take("a2", "take_t02.mp4", 76)] });
  const leg = p.trilhas.find((t) => t.tipo === "legenda")!;
  return aplicarOperacoes(p, [
    { op: "inserir", trilha: leg.id, clipe: { id: "l1", inicio_s: 10, entrada_s: 0, saida_s: 3, texto: "prazo de entrega" } },
    { op: "inserir", trilha: leg.id, clipe: { id: "l2", inicio_s: 70, entrada_s: 0, saida_s: 4, texto: "no limite" } },
    { op: "inserir", trilha: leg.id, clipe: { id: "l3", inicio_s: 100, entrada_s: 0, saida_s: 3, texto: "teste da compra" } },
  ]);
}

const AGORA = "2026-10-09T12:00:00Z";
const passo = (x: Record<string, unknown>) => ({ passo: { plano: "", chamadas: [], resposta: "", terminou: true, recusadas: [], opcoes: [], ...x }, gasto_usd: 0.001 });
const idsDe = (p: ProjetoDeEdicao) => p.trilhas.flatMap((t) => t.clipes.map((c) => c.id));

describe("Editor: manter só o vídeo escolhido", () => {
  it("lê o pedido e a resposta à pergunta (frases reais do histórico); 'mantém o começo' não é manter só", () => {
    expect(pedeManterSomente("tem videos demais ali deixe so um organzie pra mi e apague o que nao faz sentido")).toBe(true);
    expect(pedeManterSomente(respostaAPergunta("Preciso saber qual dos dois assuntos manter. Qual vídeo você quer manter?", "Vídeo sobre prazo de entrega e marketing (0:00 a 1:12)"))).toBe(true);
    expect(pedeManterSomente("mantém só o segundo vídeo")).toBe(true);
    expect(pedeManterSomente("apaga o resto")).toBe(true);
    expect(pedeManterSomente("legende e mantém o começo")).toBe(false);
    expect(pedeManterSomente("agora melhore a qualidade do video")).toBe(false);
  });

  it("a opção volta com a pergunta; sem pergunta, vai só a opção", () => {
    expect(respostaAPergunta("Preciso saber antes. Qual vídeo você quer manter?", "c2")).toBe('Resposta à sua pergunta "Qual vídeo você quer manter?": c2');
    expect(respostaAPergunta("Feito.", "ok")).toBe("ok");
  });

  it("reenquadrar e formato são recusados enquanto o pedido é manter só; fora dele, seguem livres", () => {
    expect(barradaPeloManter(true, "aplicar_skill", { skill: "reenquadrar" })).toMatch(/^Recusado: .*manter_somente/);
    expect(barradaPeloManter(true, "formato", { formato: "9:16" })).toMatch(/^Recusado/);
    expect(barradaPeloManter(true, "aplicar_skill", { skill: "legendas" })).toBeNull();
    expect(barradaPeloManter(false, "aplicar_skill", { skill: "reenquadrar" })).toBeNull();
    expect(NOMES_DAS_FERRAMENTAS).toContain("manter_somente");
    expect(sistemaDoAgente()).toContain("Nunca troque isso por formato ou reenquadrar");
  });

  it("seleção do primeiro vídeo: tira o t02 e a legenda dele; a do limite fica pela maior parte; conferido", () => {
    const p = projetoDeDoisVideos();
    const s = selecionarParaManter(p.trilhas, { de_s: 0, ate_s: 72 });
    expect(s.erro).toBeNull();
    expect(s.cruzam).toEqual([]);
    expect(s.remover.map((x) => x.clipe).sort()).toEqual([trilhaPrincipal(p)!.clipes[1].id, "l3"].sort());
    expect(s.decididosPelaMaiorParte.map((x) => x.clipe)).toEqual(["l2"]);
    const depois = aplicarOperacoes(p, operacoesDoManter(s) as never);
    expect(conferirManter(depois.trilhas, s)).toBeNull();
    expect(trilhaPrincipal(depois)!.clipes.map((c) => depois.fontes[c.fonte as string].nome)).toEqual(["take_t01.mp4"]);
  });

  it("seleção do segundo vídeo pela fonte: fica o t02, puxado para o zero; a legenda que cruza o começo sai", () => {
    const p = projetoDeDoisVideos();
    const chave = Object.keys(p.fontes).find((k) => p.fontes[k].nome === "take_t02.mp4")!;
    const s = selecionarParaManter(p.trilhas, { fonte: chave });
    expect([s.de_s, s.ate_s]).toEqual([72, 148]);
    expect(s.remover.map((x) => x.clipe)).toEqual(expect.arrayContaining(["l1", "l2"]));
    const depois = aplicarOperacoes(p, operacoesDoManter(s) as never);
    expect(conferirManter(depois.trilhas, s)).toBeNull();
    const v = trilhaPrincipal(depois)!.clipes;
    expect(v.map((c) => [depois.fontes[c.fonte as string].nome, c.inicio_s])).toEqual([["take_t02.mp4", 0]]);
    expect(depois.trilhas.find((t) => t.tipo === "legenda")!.clipes.map((c) => [c.id, c.inicio_s])).toEqual([["l3", 28]]);
  });

  it("dado real: vizinhos sobrepostos em 1 quadro (as skills de corte deixam assim) não travam o puxar para o zero", () => {
    const p0 = projetoDeDoisVideos();
    const v = trilhaPrincipal(p0)!;
    const fonteT02 = v.clipes[1].fonte as string;
    // O t02 vira dois clipes que se sobrepõem em 0,02 s (como v59/v25 no projeto 858e09b3).
    const p = aplicarOperacoes(p0, [
      { op: "remover", clipe: v.clipes[1].id },
      { op: "inserir", trilha: v.id, clipe: { id: "x1", fonte: fonteT02, inicio_s: 72, entrada_s: 0, saida_s: 40 } },
    ]);
    const comSobreposicao: ProjetoDeEdicao = { ...p, trilhas: p.trilhas.map((t) => (t.id !== v.id ? t : { ...t, clipes: t.clipes.concat([{ ...t.clipes.find((c) => c.id === "x1")!, id: "x2", inicio_s: 111.96, entrada_s: 40, saida_s: 76 }]) })) };
    const s = selecionarParaManter(comSobreposicao.trilhas, { fonte: fonteT02 });
    const ops = operacoesDoManter(s);
    expect(ops.filter((o) => o.op === "deslocar_trilha").map((o) => (o as { delta_s: number }).delta_s)).toEqual([-72, -72]);
    const depois = aplicarOperacoes(comSobreposicao, ops as never);
    expect(conferirManter(depois.trilhas, s)).toBeNull();
    expect(trilhaPrincipal(depois)!.clipes.map((c) => [c.id, c.inicio_s])).toEqual([["x1", 0], ["x2", 39.96]]);
  });

  it("limite que corta um clipe de vídeo ao meio: nada muda e volta a pergunta com o clipe e os tempos", () => {
    const p = projetoDeDoisVideos();
    const ap = apelidosDoProjeto(p);
    const x = executarFerramenta(p, { ferramenta: "manter_somente", argumentos: { de_s: 0, ate_s: 60 } }, AGORA, null, { apelidos: ap });
    expect(x.ok).toBe(false);
    expect(x.operacoes).toEqual([]);
    expect(x.projeto).toBe(p);
    expect(x.texto).toMatch(/^Nada mudou: o limite de 0:00,0 a 1:00,0 corta um clipe ao meio: c1 \(0:00,0 a 1:12,0/);
    expect(x.texto).toContain("Pergunte ao dono, com opções");
  });

  it("o caso do histórico: o modelo tenta reenquadrar, é recusado, usa manter_somente e só o vídeo escolhido fica", async () => {
    const p = projetoDeDoisVideos();
    const antes = idsDe(p);
    const chamar = vi.fn()
      .mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "aplicar_skill", argumentos: { skill: "reenquadrar" } }], terminou: false }))
      .mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "manter_somente", argumentos: { de_s: 0, ate_s: 72 } }], terminou: true }));
    const pedido = respostaAPergunta("Qual vídeo você quer manter?", "Vídeo sobre prazo de entrega e marketing (0:00 a 1:12)");
    const r = await rodarAgente({ chamar, clientId: "c", sessao: "s", pedido, projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA });
    // O resultado da recusa voltou ao modelo no passo 2.
    const segundo = chamar.mock.calls[1][0] as { historico: unknown };
    expect(JSON.stringify(segundo.historico)).toContain("Recusado: o dono pediu para ficar só com um trecho");
    expect(r.operacoes.some((o) => (o as { op: string }).op === "remover")).toBe(true);
    const depois = idsDe(r.resultado);
    expect(depois.length).toBe(antes.length - 2);
    expect(trilhaPrincipal(r.resultado)!.clipes.map((c) => r.resultado.fontes[c.fonte as string].nome)).toEqual(["take_t01.mp4"]);
    expect(r.resultado.formato).toBe(p.formato);
  });
});
