import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import { FERRAMENTAS_DO_AGENTE, FERRAMENTAS_DO_SERVIDOR, NOMES_DAS_FERRAMENTAS, PAINEIS_DO_EDITOR, podeAplicarDireto, sistemaDoAgente } from "../../supabase/functions/editor-video/ferramentas";
import { receitaDaMedida } from "../../supabase/functions/editor-video/receita";
import { aplicarOperacao, aplicarOperacoes, assinaturaDoProjeto, trilhaPrincipal } from "@/lib/editor/operacoes";
import { conferencia, contextoDoAgente, executarFerramenta, mensagemFinalDoAgente, pedidoDeEdicao, pedidoDeEdicaoCompleta, rodarAgente } from "@/lib/editor/agente";
import { apelidosDoProjeto } from "@/lib/editor/apelidos";
import { criarFerramentasDoServidor, edicaoCompletaDoAgente } from "@/lib/editor/ferramentasDoServidor";
import { entendimentoDoVideo, textoDoEntendimento } from "@/lib/editor/entendimento";
import { itensDoQueMudou, mensagemDoQueMudou, retratoDoProjeto } from "@/lib/editor/relatorio";
import { CAPACIDADES_DO_EDITOR } from "@/lib/editor/capacidades";
import { projetoDoZero } from "@/lib/editor/doZero";
import { SKILLS_DO_EDITOR } from "@/lib/editor/skills";
import { PECAS_DE_MOTION } from "@/lib/editor/motion/catalogo";
import type { ItemDaBiblioteca } from "@/lib/editor/biblioteca";

/**
 * 02/10, dono (editando a Thainá, advogada, falando para a câmera): "o agente
 * não edita de verdade: alucina, não faz o que eu falo, é limitado, só edita o
 * básico; não edita como as skills nem com o motor por baixo". Causas raiz
 * reproduzidas e cobertas aqui:
 * 1. a resposta final era o texto livre do modelo ("apliquei a edição"), mesmo
 *    quando nada tinha entrado; agora é o relatório do código (antes e depois);
 * 2. o agente não tinha o motor (EDIT IA PRO): o sistema mandava "sugira o
 *    painel Editar com IA" e a dica da tela levava todo "edita" para a skill
 *    de ritmo (Brabo só corta, alterna o zoom e legenda);
 * 3. faltavam ferramentas para o que a tela faz (referência, transição,
 *    mixagem, editar peça, cena do zero, trocar cenário, pesquisa);
 * 4. o contexto não dizia nada do vídeo além da fala crua (sem seções,
 *    ênfases, dados ditos);
 * 5. o laço parava no "terminei" do modelo mesmo com ferramenta que falhou, e
 *    uma falha no caminho mandava tudo para o Confirmar; 6 passos e 12
 *    ferramentas não davam para a edição inteira.
 */

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const AGORA = "2026-10-02T15:00:00.000Z";

/** Thainá falando para a câmera, 1080x1920, fala palavra por palavra com pausas e uma tomada repetida. */
function projetoDaThaina(): ProjetoDeEdicao {
  const p = projetoDosTakes({
    titulo: "Thainá: rescisão",
    fps: 30,
    takes: [{ id: "t1", nome: "thaina-fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/t1.mp4`, cena_ref: null, melhor: true, duracao_s: 40, largura: 1080, altura: 1920 }],
    agora: AGORA,
  });
  const frases = [
    "Você foi demitido e não sabe o que receber?",
    "Presta atenção!",
    "Existem 3 erros que as empresas cometem.",
    "Aviso prévio, férias e multa.",
    "O primeiro erro é o mais comum.",
    "Agora o segundo ponto é o prazo.",
    "Você tem 10 dias para receber tudo.",
    "Comenta DIREITOS que eu te explico.",
  ];
  const segmentos: { t: string; i: number; f: number }[] = [];
  let t = 0.4;
  frases.forEach((f, k) => {
    f.split(" ").forEach((w) => {
      segmentos.push({ t: w, i: Math.round(t * 1000) / 1000, f: Math.round((t + 0.3) * 1000) / 1000 });
      t += 0.36;
    });
    t += k === 4 ? 1.6 : 0.8;
  });
  return aplicarOperacao(p, { op: "transcricao", fonte: "thaina-fala", transcricao: { segmentos, por_palavra: true, origem: "teste", versao: 1, em: AGORA } });
}

const MIDIAS: ItemDaBiblioteca[] = [
  { id: "a1", arquivo_id: "a1", nome: "trilha-calma.mp3", tipo: "audio", storage_bucket: "mesa", storage_path: `${CLIENTE}/audio/trilha-calma.mp3`, duracao_s: 120, largura: null, altura: null, origem: "enviado" },
  { id: "b1", arquivo_id: "b1", nome: "escritorio-advocacia.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/b1.mp4`, duracao_s: 12, largura: 1080, altura: 1920, origem: "enviado" },
];
const MARCA = { nome: "Thainá Lima Rosa Advocacia", cor: "#880516", cor2: "#f2e6e8", fonte: null, fonte_path: null, logo_path: null };

/** O servidor de mentira: o Jev escolhe a primeira peça candidata de cada frase; momentos e B-roll não respondem (regra da casa). */
function servidorFalso(passos: unknown[] = []) {
  const corpos: Record<string, unknown>[] = [];
  const chamar = vi.fn(async (corpo: Record<string, unknown>) => {
    corpos.push(corpo);
    if (corpo.acao === "agente_passo") {
      const r = passos.shift();
      if (!r) return { passo: { plano: "", chamadas: [], resposta: "", terminou: true, recusadas: [], opcoes: [] }, gasto_usd: 0.003 };
      return r;
    }
    if (corpo.acao === "animacoes_sugerir") {
      const frases = (corpo.frases || []) as { k: string; candidatas: string[] }[];
      return { sugestoes: frases.map((f) => ({ k: f.k, peca: f.candidatas[0], probabilidade: 0.9 })) };
    }
    if (corpo.acao === "agente_ordem_clara") return { clara: true };
    throw new Error("Jev fora do ar no teste");
  });
  return { chamar, corpos };
}

const passo = (x: Record<string, unknown>) => ({ passo: { plano: "", chamadas: [], resposta: "", terminou: true, recusadas: [], opcoes: [], ...x }, gasto_usd: 0.004 });

// ---------------------------------------------------------------- 1. cobertura

describe("cobertura: tudo o que a tela faz tem ferramenta do agente", () => {
  it("toda capacidade aponta para uma ferramenta que existe e todo painel do editor está coberto", () => {
    CAPACIDADES_DO_EDITOR.forEach((c) => expect(NOMES_DAS_FERRAMENTAS, c.capacidade).toContain(c.ferramenta));
    const fonte = fs.readFileSync(path.resolve(__dirname, "../components/mesa-edicao/editor/EditorDeVideo.tsx"), "utf8");
    const bloco = fonte.slice(fonte.indexOf("const ABAS_ESQUERDA"), fonte.indexOf("];", fonte.indexOf("const ABAS_ESQUERDA")));
    const abas = Array.from(bloco.matchAll(/valor: "([a-z]+)"/g)).map((m) => m[1]);
    expect(abas.length).toBeGreaterThan(12);
    abas.forEach((a) => {
      expect(PAINEIS_DO_EDITOR, `painel ${a}`).toContain(a);
      expect(CAPACIDADES_DO_EDITOR.some((c) => c.painel === a), `capacidade do painel ${a}`).toBe(true);
    });
  });

  it("toda ferramenta que roda na tela tem caminho no executor (nenhuma cai em 'desconhecida')", () => {
    const p = projetoDaThaina();
    FERRAMENTAS_DO_AGENTE.filter((f) => FERRAMENTAS_DO_SERVIDOR.indexOf(f.nome) < 0 && f.nome.indexOf("gerar_") !== 0).forEach((f) => {
      const r = executarFerramenta(p, { ferramenta: f.nome, argumentos: {} }, AGORA, null, { midias: MIDIAS });
      expect(r.texto, f.nome).not.toMatch(/Ferramenta desconhecida/);
    });
  });

  it("as do servidor também (com o servidor da tela)", async () => {
    const { chamar } = servidorFalso();
    const servidor = criarFerramentasDoServidor({ chamarEditor: chamar, chamarVideos: vi.fn().mockRejectedValue(new Error("sem motor")), clientId: CLIENTE, versaoId: null, marca: MARCA, midias: () => MIDIAS, agora: () => AGORA });
    for (const nome of FERRAMENTAS_DO_SERVIDOR) {
      const r = await servidor({ ferramenta: nome, argumentos: {} }, projetoDaThaina()).catch((e: Error) => ({ texto: e.message }));
      expect(r.texto, nome).not.toMatch(/Ferramenta desconhecida/);
    }
  });

  it("toda skill e toda peça de motion entram pelo agente", () => {
    const p = projetoDaThaina();
    SKILLS_DO_EDITOR.forEach((s) => {
      const r = executarFerramenta(p, { ferramenta: "aplicar_skill", argumentos: { skill: s.id } }, AGORA);
      expect(r.texto, s.id).not.toMatch(/Skill desconhecida/);
    });
    PECAS_DE_MOTION.filter((x) => x !== "logo").forEach((peca) => {
      const r = executarFerramenta(p, { ferramenta: "animar", argumentos: { peca, inicio_s: 2, params: {} } }, AGORA);
      expect(r.texto, peca).not.toMatch(/Peça desconhecida/);
    });
  });

  it("o sistema manda a edição inteira para o motor (e não para o painel)", () => {
    const s = sistemaDoAgente();
    expect(s).toContain("Edição dinâmica ou completa = edicao_completa");
    expect(s).not.toContain("sugira o painel Editar com IA");
    expect(s).toMatch(/Não descreva na resposta o que fez/);
  });
});

// ---------------------------------------------------------------- 2. entender o vídeo

describe("entendimento do vídeo (código, sem custo)", () => {
  it("acha o tipo, as seções, as ênfases, os dados ditos e as perguntas", () => {
    const e = entendimentoDoVideo(projetoDaThaina());
    expect(e.tipo).toBe("fala_para_camera");
    expect(e.secoes.length).toBeGreaterThanOrEqual(2);
    expect(e.dados.some((d) => /3 erros/.test(d.texto) && d.pecas.indexOf("contador") >= 0)).toBe(true);
    expect(e.dados.some((d) => /Aviso prévio, férias e multa/.test(d.texto) && d.pecas.indexOf("lista") >= 0)).toBe(true);
    expect(e.enfases.some((m) => /Presta atenção/.test(m.texto))).toBe(true);
    expect(e.perguntas[0].texto).toMatch(/demitido/);
    const texto = textoDoEntendimento(e);
    expect(texto).toMatch(/talking head/);
    expect(contextoDoAgente(projetoDaThaina()).indexOf("Entendimento do vídeo")).toBe(0);
  });
});

// ---------------------------------------------------------------- 3. edita completo, ponta a ponta

describe("'edita completo e dinâmico' monta a edição inteira na linha do tempo", () => {
  it("cortes, ritmo, legendas na cor da marca, punch-ins, motion e música com ducking, num passo do Ctrl+Z", async () => {
    const base = projetoDaThaina();
    const { chamar, corpos } = servidorFalso([
      passo({ plano: "Edição completa da casa.", chamadas: [{ ferramenta: "edicao_completa", argumentos: { receita: "dinamico" } }], resposta: "Editei tudo, pus B-roll e logo animada." }),
    ]);
    const servidor = criarFerramentasDoServidor({ chamarEditor: chamar, chamarVideos: vi.fn(), clientId: CLIENTE, versaoId: null, marca: MARCA, midias: () => MIDIAS, agora: () => AGORA });
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s1", pedido: "edita completo e dinâmico", projeto: base, modeloId: "m", tetoUsd: 1, agora: AGORA, midias: MIDIAS, servidor });
    const antes = retratoDoProjeto(base);
    const depois = retratoDoProjeto(r.resultado);
    expect(depois.duracao_s).toBeLessThan(antes.duracao_s); // pausas e respiros cortados
    expect(depois.clipesNaPrincipal).toBeGreaterThan(4); // ritmo do Brabo (batidas)
    expect(depois.legendas).toBeGreaterThan(10);
    expect(depois.zooms).toBeGreaterThan(2); // punch-in alternado e zoom nos momentos
    expect(Object.keys(depois.pecas).length).toBeGreaterThan(1); // motion (lista, contador, comentário...) e cartão final
    expect(depois.musica).toBe("trilha-calma.mp3");
    expect(r.resultado.mixagem.duck).toBe(true);
    expect(r.resultado.identidade && r.resultado.identidade.cor).toBe("#880516");
    // Um passo do desfazer: as operações aplicadas no projeto de antes dão exatamente o resultado.
    expect(assinaturaDoProjeto(aplicarOperacoes(base, r.operacoes))).toBe(assinaturaDoProjeto(r.resultado));
    expect(corpos.filter((c) => c.acao === "agente_passo")).toHaveLength(1);
    // A mensagem final é o que mudou de verdade (o código conta), e o "pus B-roll e logo" do modelo não entra.
    const msg = mensagemFinalDoAgente(r, true);
    expect(msg.indexOf(`Mudei: ${[r.mudancas].concat(itensDoQueMudou(base, r.resultado)).filter(Boolean).join(" ")} O Desfazer volta tudo.`)).toBe(0);
    // 02/10: o checklist de engajamento vai junto (gancho, ritmo, interrupções, chamada).
    expect(msg).toMatch(/Engajamento: gancho/);
    expect(msg).not.toMatch(/B-roll e logo animada/);
    expect(msg).toMatch(/legendas/);
    expect(msg).toMatch(/Música: trilha-calma\.mp3/);
    expect(r.log[r.log.length - 1]).toEqual({ tipo: "resposta", texto: msg });
  });

  it("o atalho sem modelo (Edição completa) faz o mesmo e o resumo do cartão é o relatório", async () => {
    const base = projetoDaThaina();
    const { chamar } = servidorFalso();
    const r = await edicaoCompletaDoAgente(chamar, { clientId: CLIENTE, projeto: base, args: { receita: "dinamico" }, marca: MARCA, midias: MIDIAS, agora: AGORA });
    expect(r.operacoes.length).toBeGreaterThan(10);
    expect(r.texto).toMatch(/EDIT IA PRO \(receita dinamico\)/);
    // 02/10: câmera com motivo no lugar do zoom alternado; o ritmo só divide plano acima de 4 s.
    expect(r.texto).toMatch(/feito Câmera nos momentos fortes/);
    expect(r.texto).toMatch(/feito Motion graphics na marca/);
    expect(r.texto).toMatch(/engajamento: /);
    expect(mensagemDoQueMudou(base, r.projeto)).toMatch(/Corte: duração/);
  });

  it("o plano do agente muda as peças (legenda impacto, sem música, look quente) e o código limpa o resto", async () => {
    const { chamar } = servidorFalso();
    const r = await edicaoCompletaDoAgente(chamar, { clientId: CLIENTE, projeto: projetoDaThaina(), args: { receita: "dinamico", musica: "nenhuma", plano: { legenda: { estilo: "impacto", palavras: 2 }, cor: { look: "quente" }, formato: "quadrado-errado" } }, marca: MARCA, midias: MIDIAS, agora: AGORA });
    expect(r.plano.legenda.estilo).toBe("impacto");
    expect(r.plano.legenda.palavras).toBe(2);
    expect(r.plano.cor.look).toBe("quente");
    expect(r.plano.formato).toBe("manter");
    expect(retratoDoProjeto(r.projeto).musica).toBeNull();
  });

  it("modelo que não edita um pedido de edição completa: lembrete, depois a regra da casa roda o EDIT IA PRO", async () => {
    const base = projetoDaThaina();
    const { chamar, corpos } = servidorFalso([passo({ resposta: "Claro, vou editar com calma." }), passo({ resposta: "Pronto, editei." })]);
    const servidor = criarFerramentasDoServidor({ chamarEditor: chamar, chamarVideos: vi.fn(), clientId: CLIENTE, versaoId: null, marca: MARCA, midias: () => MIDIAS, agora: () => AGORA });
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s2", pedido: "edita esse vídeo completo", projeto: base, modeloId: "m", tetoUsd: 1, agora: AGORA, midias: MIDIAS, servidor });
    const passos = corpos.filter((c) => c.acao === "agente_passo");
    expect(passos).toHaveLength(2);
    expect(JSON.stringify(passos[1].historico)).toMatch(/nada mudou na linha do tempo/);
    expect(r.regraDaCasa).toBe(true);
    expect(r.operacoes.length).toBeGreaterThan(10);
    const msg = mensagemFinalDoAgente(r, true);
    expect(msg).toMatch(/rodei a edição completa da casa/);
    expect(msg).not.toMatch(/editei/);
  });
});

// ---------------------------------------------------------------- 4. sem afirmar o que não fez

describe("nada de afirmar sem mudar", () => {
  it("modelo diz que pôs legenda e cortou, sem ferramenta: a mensagem diz que nada mudou", async () => {
    const { chamar } = servidorFalso([passo({ resposta: "Pus legendas e cortei os silêncios." }), passo({ resposta: "Pus legendas e cortei os silêncios." })]);
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s3", pedido: "deixa a cor mais quente", projeto: projetoDaThaina(), modeloId: "m", tetoUsd: 1, agora: AGORA });
    expect(r.operacoes).toHaveLength(0);
    expect(r.pergunta).toBeNull();
    const msg = mensagemFinalDoAgente(r, false);
    expect(msg).toMatch(/^Nada mudou na linha do tempo\./);
    expect(msg).not.toMatch(/Pus legendas/);
  });

  it("pergunta de verdade (dúvida) passa, com as opções", async () => {
    const { chamar } = servidorFalso([passo({ resposta: "Qual trecho, o do c1 ou o do c2?", opcoes: ["c1", "c2"] })]);
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s4", pedido: "corta aquele pedaço", projeto: projetoDaThaina(), modeloId: "m", tetoUsd: 1, agora: AGORA });
    expect(r.pergunta).toBe("Qual trecho, o do c1 ou o do c2?");
    expect(mensagemFinalDoAgente(r, false)).toMatch(/Qual trecho/);
  });

  it("a conferência do código conta o que entrou de verdade", () => {
    const p = projetoDaThaina();
    const r = executarFerramenta(p, { ferramenta: "legendar", argumentos: {} }, AGORA);
    expect(conferencia(p, r.projeto, r).texto).toMatch(/^Conferido: \d+ legendas\./);
    const nada = executarFerramenta(p, { ferramenta: "animar", argumentos: { peca: "contador", palavra_ref: "mil reais", params: { ate: 1000 } } }, AGORA);
    expect(conferencia(p, nada.projeto, nada)).toEqual({ texto: "Conferido: não entrou nada (veja o erro e corrija, ou diga ao dono).", falhou: true });
  });
});

// ---------------------------------------------------------------- 5. o laço confere e segue

describe("laço: executar, conferir, seguir", () => {
  it("ferramenta que falhou com 'terminei': mais um passo para corrigir, e a falha corrigida sai da lista", async () => {
    const { chamar, corpos } = servidorFalso([
      passo({ chamadas: [{ ferramenta: "animar", argumentos: { peca: "contador", palavra_ref: "mil reais", params: { ate: 1000 } } }] }),
      passo({ chamadas: [{ ferramenta: "animar", argumentos: { peca: "contador", palavra_ref: "3 erros", params: { ate: 3, sufixo: " erros" } } }] }),
    ]);
    const base = projetoDaThaina();
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s5", pedido: "anima o número de erros", projeto: base, modeloId: "m", tetoUsd: 1, agora: AGORA });
    const passos = corpos.filter((c) => c.acao === "agente_passo");
    expect(passos).toHaveLength(2);
    const hist = JSON.stringify(passos[1].historico);
    expect(hist).toMatch(/Conferido: não entrou nada/);
    expect(hist).toMatch(/Conferência do código: alguma ferramenta não entrou/);
    expect(retratoDoProjeto(r.resultado).pecas.contador).toBe(1);
    expect(r.naoEntrou).toEqual([]);
    expect(mensagemFinalDoAgente(r, true)).toMatch(/1 animação nova: contador/);
  });

  it("falha no caminho não manda mais a edição inteira para o Confirmar (recusa e parada ainda mandam)", () => {
    const ok = { operacoes: 3, falhas: 0, recusadas: 0, parado: false, ordemClara: true };
    expect(podeAplicarDireto({ ...ok, falhas: 2 }).direto).toBe(true);
    expect(podeAplicarDireto({ ...ok, recusadas: 1 }).direto).toBe(false);
    expect(podeAplicarDireto({ ...ok, parado: true }).direto).toBe(false);
  });

  it("pedidos: o que é edição, o que é a edição completa", () => {
    expect(pedidoDeEdicaoCompleta("edita completo e dinâmico")).toBe(true);
    expect(pedidoDeEdicaoCompleta("Edita esse vídeo completo")).toBe(true);
    expect(pedidoDeEdicaoCompleta("pode editar ele")).toBe(true);
    expect(pedidoDeEdicaoCompleta("faz a edição com a skill do Brabo")).toBe(true);
    expect(pedidoDeEdicaoCompleta("só o ritmo do brabo")).toBe(false);
    expect(pedidoDeEdicaoCompleta("tira o c3")).toBe(false);
    expect(pedidoDeEdicao("deixa a cor mais quente")).toBe(true);
    expect(pedidoDeEdicao("quantos clipes tem?")).toBe(false);
  });
});

// ---------------------------------------------------------------- 6. o resto do editor pelo agente

describe("referência, transição, mixagem, peça editável, trocar cenário", () => {
  it("aplica a edição de uma referência medida (r1)", () => {
    const receita = receitaDaMedida({ duracao_s: 20, largura: 1080, altura: 1920, cortes: [1.5, 3, 4.2, 6, 7.5, 9, 11, 13, 15, 17], suaves: [2, 8], quadros: 80, passo_s: 0.25, brilho: 0.5, contraste: 0.4, saturacao: 0.4, musica: null });
    const p = aplicarOperacao(projetoDaThaina(), { op: "referencias", lista: [{ id: "r-a", nome: "Reels do Dr. Exemplo", origem: "link", storage_bucket: null, storage_path: null, url: "https://example.com/v", rede: "instagram", miniatura: null, receita: receita as unknown as Record<string, unknown>, fidelidade: "proxima", template_id: null, em: AGORA }] });
    expect(contextoDoAgente(p)).toMatch(/r1: Reels do Dr\. Exemplo \(medida\)/);
    const r = executarFerramenta(p, { ferramenta: "aplicar_referencia", argumentos: { referencia: "r1" } }, AGORA);
    expect(r.ok).toBe(true);
    expect(r.operacoes.length).toBeGreaterThan(0);
    const sem = executarFerramenta(projetoDaThaina(), { ferramenta: "aplicar_referencia", argumentos: {} }, AGORA);
    expect(sem.ok).toBe(false);
    expect(sem.texto).toMatch(/Nenhuma referência/);
  });

  it("transição em todos, mixagem, texto e peça editados (parâmetro inválido não grava)", () => {
    let p = executarFerramenta(projetoDaThaina(), { ferramenta: "aplicar_skill", argumentos: { skill: "brabo" } }, AGORA).projeto;
    // Brabo divide a mesma fonte: a transição em todos vale na troca de clipe.
    const t = executarFerramenta(p, { ferramenta: "transicao", argumentos: { clipe: "todos", tipo: "whip" } }, AGORA);
    expect(t.ok).toBe(true);
    expect(trilhaPrincipal(t.projeto)!.clipes.filter((c) => c.transicao_entrada && c.transicao_entrada.tipo === "whip").length).toBe(trilhaPrincipal(p)!.clipes.length - 1);
    const mx = executarFerramenta(p, { ferramenta: "mixagem", argumentos: { abaixo_da_voz_db: 40, lufs_alvo: -16 } }, AGORA);
    expect(mx.projeto.mixagem.trilha_abaixo_da_voz_db).toBe(36);
    expect(mx.projeto.mixagem.lufs_alvo).toBe(-16);
    p = executarFerramenta(p, { ferramenta: "animar", argumentos: { peca: "lista", palavra_ref: "Aviso prévio", params: { titulo: "Erros", itens: ["Aviso prévio", "Férias", "Multa"] } } }, AGORA).projeto;
    const a = apelidosDoProjeto(p);
    const peca = a.lista.find((x) => /Animação: lista/.test(x.rotulo))!.apelido;
    expect(contextoDoAgente(p)).toMatch(/params \{"titulo":"Erros"/);
    const e = executarFerramenta(p, { ferramenta: "editar_clipe", argumentos: { clipe: peca, params: { titulo: "3 erros", modo: "riscada" } } }, AGORA, null, { apelidos: a });
    expect(e.ok).toBe(true);
    const clipe = e.projeto.trilhas.reduce((l, tr) => l.concat(tr.clipes), [] as ProjetoDeEdicao["trilhas"][number]["clipes"]).find((c) => c.id === a.porApelido[peca])!;
    expect((clipe.estilo as { params: Record<string, unknown> }).params).toMatchObject({ titulo: "3 erros", modo: "riscada" });
    const ruim = executarFerramenta(p, { ferramenta: "editar_clipe", argumentos: { clipe: peca, params: { itens: [] } } }, AGORA, null, { apelidos: a });
    expect(ruim.ok).toBe(false);
    expect(ruim.texto).toMatch(/falta itens/);
  });

  it("trocar cenário abre o painel com o clipe e o cenário (nada pago roda); painel desconhecido é recusado", () => {
    const p = projetoDaThaina();
    const r = executarFerramenta(p, { ferramenta: "trocar_cenario", argumentos: { clipe: "c1", cenario: "escritório de advocacia com estante de livros" } }, AGORA);
    expect(r.ok).toBe(true);
    expect(r.operacoes).toHaveLength(0);
    expect(r.painel).toEqual({ aba: "cenario", clipe: trilhaPrincipal(p)!.clipes[0].id, cenario: "escritório de advocacia com estante de livros" });
    expect(executarFerramenta(p, { ferramenta: "abrir_painel", argumentos: { painel: "nada" } }, AGORA).ok).toBe(false);
    expect(executarFerramenta(p, { ferramenta: "abrir_painel", argumentos: { painel: "timestamp" } }, AGORA).painel).toEqual({ aba: "timestamp" });
  });
});

// ---------------------------------------------------------------- 7. do zero

describe("começar um vídeo do zero", () => {
  it("projeto vazio vira vídeo com cenas, título, motion, texto e música do acervo", () => {
    let p = projetoDoZero("Do zero", "9:16", AGORA);
    expect(p.trilhas.every((t) => !t.clipes.length)).toBe(true);
    expect(entendimentoDoVideo(p).tipo).toBe("vazio");
    const marca = { logo_path: null, cor: "#880516", nome: "Thainá" };
    const passos: [string, Record<string, unknown>][] = [
      ["cena", { duracao_s: 3, fundo: "marca", fundo2: "#1a1a1a", titulo: "Seus direitos na rescisão", estilo: "manchete" }],
      ["cena", { duracao_s: 4, fundo: "#111111", peca: "lettering", params: { palavras: ["Aviso prévio", "Férias", "Multa"] } }],
      ["inserir_texto", { inicio_s: 3.5, duracao_s: 2, texto: "Comenta DIREITOS", estilo: "chamada" }],
      ["musica", { fonte: "m1" }],
    ];
    passos.forEach(([ferramenta, argumentos]) => {
      const r = executarFerramenta(p, { ferramenta, argumentos }, AGORA, marca, { midias: MIDIAS });
      expect(r.ok, `${ferramenta}: ${r.texto}`).toBe(true);
      p = r.projeto;
    });
    const v = retratoDoProjeto(p);
    expect(v.cenas).toBe(2);
    expect(v.duracao_s).toBe(7);
    expect(v.textos).toBe(2);
    expect(v.pecas.lettering).toBe(1);
    expect(v.musica).toBe("trilha-calma.mp3");
    const primeira = trilhaPrincipal(p)!.clipes.find((c) => c.inicio_s === 0)!;
    expect(primeira.estilo).toEqual({ fundo: "#880516", fundo2: "#1a1a1a" });
    // A cena posta no começo empurra o resto, com as outras trilhas juntas.
    const r = executarFerramenta(p, { ferramenta: "cena", argumentos: { duracao_s: 2, inicio_s: 0, fundo: "#000000" } }, AGORA, marca, { midias: MIDIAS });
    expect(r.ok).toBe(true);
    expect(retratoDoProjeto(r.projeto).duracao_s).toBe(9);
    const textos = r.projeto.trilhas.filter((t) => t.tipo === "texto").reduce((l, t) => l.concat(t.clipes), [] as ProjetoDeEdicao["trilhas"][number]["clipes"]);
    expect(textos.map((c) => c.inicio_s).sort((x, y) => x - y)[0]).toBeGreaterThanOrEqual(2);
  });
});
