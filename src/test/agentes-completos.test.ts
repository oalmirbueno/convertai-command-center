import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executarDireto,
  MAX_ITENS_DIRETOS,
  normalizarAcaoDoAgente,
  pareceOrdem,
  podeExecutarDireto,
  type AcaoDoAgente,
  type RegraDaOperacao,
} from "../../supabase/functions/_shared/acoes-do-agente";
import {
  AGENTES_DO_PAINEL,
  AREAS_DO_PAINEL,
  areaDaRota,
  areaPorPalavras,
  blocoDoMapaDoPainel,
  destinoDoPedido,
  destinoNaResposta,
  lerRoteamento,
  linkDaArea,
  OPCAO_AQUI,
  pedeParaAbrir,
  perguntasDoRoteador,
  rotasNoTexto,
  TITULO_DO_MAPA,
} from "../../supabase/functions/_shared/mapa-do-painel";
import {
  alvosDoLancador,
  blocoDasAcoesDoLancador,
  dataValida,
  executarItemDoLancador,
  lerLembreteDoPara,
  lerTarefaDoPara,
  normalizarAcoesDoLancador,
  regrasDoLancador,
  reverterItemDoLancador,
  type DadosDoLancador,
} from "../../supabase/functions/voice-assistant-agent/acoes-do-lancador";
import { acaoDoKitNaConversa, MAX_ITENS_DO_KIT, REGRAS_DO_KIT_NA_CONVERSA } from "../../supabase/functions/agente-contexto/kit-na-conversa";
import { lerEdicaoDoBriefing, normalizarAcoesDaPublicidade, REGRAS_DA_PUBLICIDADE } from "../../supabase/functions/mesa-publicidade/acoes-da-publicidade";
import { campanhaVazia, type CampanhaDePublicidade } from "../../supabase/functions/mesa-publicidade/regras";
import { conteudoEditado, lerEdicaoDeTexto, regrasDeEdicao } from "../../supabase/functions/mesa-roteiros/acoes-de-edicao";
import { normalizarAcoesDosRoteiros, OPERACOES_DOS_ROTEIROS, regrasDosRoteiros, type RoteiroParaAcao } from "../../supabase/functions/mesa-roteiros/acoes-dos-roteiros";
import { normalizarRoteiro } from "../../supabase/functions/_shared/roteiro-modelo";
import { destinoDoAgente, pedacosComLinks } from "@/lib/agentes/mapaDoPainel";

/**
 * Frente AG (26/09): "deixar todos os agentes fazerem as coisas. Eu peço, ele
 * já vai fazendo. Ele já conhece todo o painel". Confere:
 * 1. o mapa do painel no sistema de cada agente (e o bloco curto);
 * 2. as ações novas com apelidos (lançador, contexto, Publicidade, Roteiros);
 * 3. execução direta só quando é sem custo e com Desfazer (e pedido claro);
 * 4. o roteamento para outra área (link com o cliente, Jev e reserva sem IA).
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const U = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const CLIENTE = U(900);
const HOJE = "2026-09-26";

// ------------------------------------------------------------------ 1. mapa do painel

describe("mapa do painel no sistema de cada agente", () => {
  it("o bloco compacto lista todas as áreas com a rota, marca onde o agente está e cabe no teto", () => {
    const b = blocoDoMapaDoPainel("aceleriq");
    expect(b.indexOf(TITULO_DO_MAPA)).toBe(0);
    for (const a of AREAS_DO_PAINEL) expect(b).toContain(`${a.nome} ${a.rota}`);
    expect(b).toContain("[você está aqui]");
    expect(b).toContain("Abro para você?");
    expect(b.length).toBeLessThan(5000); // 30/09: +Mesa Proposta, Identidade, Site, Contratos e Motion no mapa (antes 3600)
    expect(b).not.toContain("—");
    const minimo = blocoDoMapaDoPainel("central", { nivel: "minimo" });
    expect(minimo.length).toBeLessThan(1300); // 30/09: 4 mesas novas no mapa (antes 1200)
    // Texto que pode chegar ao cliente: só nomes, nenhuma rota.
    const semRota = blocoDoMapaDoPainel("central", { nivel: "minimo", semRota: true });
    expect(semRota).not.toMatch(/\/[a-z]/);
    expect(semRota).not.toContain("Financeiro");
  });

  it("todo agente do mapa tem área existente e cada função de agente desta frente monta o bloco", () => {
    for (const g of AGENTES_DO_PAINEL) expect(AREAS_DO_PAINEL.some((a) => a.chave === g.area), g.chave).toBe(true);
    const funcoes: Array<[string, string]> = [
      ["supabase/functions/voice-assistant-agent/index.ts", "blocoDoMapaDoPainel(AGENTE_DO_LANCADOR)"],
      ["supabase/functions/agente-contexto/index.ts", 'blocoDoMapaDoPainel("contexto")'],
      ["supabase/functions/agente-estilo/index.ts", 'blocoDoMapaDoPainel("estilo")'],
      ["supabase/functions/mesa-publicidade/index.ts", 'blocoDoMapaDoPainel("publicidade")'],
      ["supabase/functions/mesa-roteiros/index.ts", 'blocoDoMapaDoPainel("roteiros")'],
      ["supabase/functions/perfis-instagram/index.ts", 'blocoDoMapaDoPainel("perfis")'],
      ["supabase/functions/mesa-ads/index.ts", 'return `\\n\\n${blocoDoMapaDoPainel("ads")}`;'],
      ["supabase/functions/mesa-foto/index.ts", 'blocoDoMapaDoPainel("foto")'],
      ["supabase/functions/mesa-foto/canvas.ts", 'blocoDoMapaDoPainel("foto", { nivel: "minimo" })'],
      ["supabase/functions/workspace-agent/index.ts", 'blocoDoMapaDoPainel("workspace")'],
      ["supabase/functions/agente-central/index.ts", 'blocoDoMapaDoPainel("central", { nivel: "minimo", semRota: true })'],
      ["supabase/functions/cycle-coach/index.ts", 'blocoDoMapaDoPainel("ciclo", { nivel: "minimo" })'],
    ];
    for (const [arq, trecho] of funcoes) expect(ler(arq), arq).toContain(trecho);
    // Os três agentes de conversa da Mesa Ads (plano, oferta e sênior) recebem o mapa; as gerações não.
    const ads = ler("supabase/functions/mesa-ads/index.ts");
    // Frente AG3: depois do mapa vêm as regras que o dono ensinou.
    // Lote B: o núcleo comum (instrução e leituras) entra depois do mapa e das regras.
    expect(ads).toContain('sistema: sistemaDoEstrategista("oferta") + mapaDoPainelNaConversa() + blocoDasRegras(regrasDaOferta) + `\\n\\n${INSTRUCAO_DO_NUCLEO_DAS_MESAS}');
    expect(ads).toContain('sistema: sistemaDoEstrategista("angulos", p.estrutura.objetivo) + mapaDoPainelNaConversa() + blocoDasRegras(regrasDoPlano) + `\\n\\n${INSTRUCAO_DO_NUCLEO_DAS_MESAS}');
    expect(ads).toContain("${REGRAS_DA_EXECUCAO}${mapaDoPainelNaConversa()}");
  });

  it("os trechos que o índice de motores cobra continuam no lugar (o mapa só se soma)", () => {
    expect(ler("supabase/functions/mesa-publicidade/index.ts")).toContain("sistema: sistemaDoAgente(c, comAcoes)");
    expect(ler("supabase/functions/mesa-ads/index.ts")).toContain("sistema: sistemaDoAgenteSenior(objetivo)");
    expect(ler("supabase/functions/agente-estilo/index.ts")).toContain("sistema: `${SISTEMA_DO_ESTILO}\\n\\n${CONHECIMENTO_DO_ESTILO}");
    expect(ler("supabase/functions/mesa-roteiros/index.ts")).toContain("sistema: `${SISTEMA_AGENTE}\\n\\n${CONHECIMENTO_DO_ROTEIRO}");
  });

  it("contexto do cliente com cache (padrão do diretor de fotografia) onde faltava", () => {
    for (const arq of ["supabase/functions/mesa-publicidade/index.ts", "supabase/functions/mesa-roteiros/index.ts", "supabase/functions/workspace-agent/index.ts"]) {
      const f = ler(arq);
      expect(f, arq).toContain("criarContextoDoAgente()");
      expect(f, arq).toContain("CONTEXTO_DO_AGENTE.ler(");
    }
  });
});

// ------------------------------------------------------------------ 2. ações novas com apelidos

const DADOS: DadosDoLancador = {
  cliente: { id: CLIENTE, nome: "Mirante" },
  projetos: [
    { id: U(1), name: "Social de outubro", status: "active", deadline: "2026-10-31" },
    { id: U(2), name: "Tráfego", status: "active", deadline: null },
  ],
  tarefas: [
    { id: U(11), title: "Revisar artes", status: "todo", due_date: "2026-09-30", project_id: U(1), projeto: "Social de outubro" },
    { id: U(12), title: "Subir campanha", status: "done", due_date: null, project_id: U(2), projeto: "Tráfego" },
  ],
};

describe("lançador: ações com apelidos (c1, p1, t1), nunca UUID", () => {
  const alvos = alvosDoLancador(DADOS);

  it("o bloco do prompt tem apelidos e não tem id", () => {
    const b = blocoDasAcoesDoLancador(alvos);
    expect(b).toContain("c1 | Mirante");
    expect(b).toContain("p1 | Social de outubro");
    expect(b).toContain("t1 | Revisar artes");
    for (const x of [CLIENTE, U(1), U(11)]) expect(b).not.toContain(x);
  });

  it("normaliza tarefa, lembrete, nota, concluir e prazo; repete no mesmo projeto com apelido próprio", () => {
    const a = normalizarAcoesDoLancador(
      {
        resumo: "Crio duas tarefas, lembro e anoto.",
        itens: [
          { operacao: "criar_tarefa", ref: "p1", para: "Gravar reels | 2026-10-02 | alta" },
          { operacao: "criar_tarefa", ref: "p1", para: "Aprovar legendas" },
          // Repetição idêntica é engano do modelo: fica de fora (não cria duas tarefas iguais).
          { operacao: "criar_tarefa", ref: "p1", para: "Gravar reels | 2026-10-02 | alta" },
          { operacao: "agendar_lembrete", ref: "c1", para: "2026-10-01 | ligar para o dono" },
          { operacao: "registrar_nota", ref: "c1", para: "O cliente prefere vídeo curto." },
          { operacao: "concluir_tarefa", ref: "t1", para: "" },
          { operacao: "concluir_tarefa", ref: "t2", para: "" },
          { operacao: "mudar_prazo", ref: "t1", para: "amanhã" },
          { operacao: "criar_tarefa", ref: U(1), para: "Inventada" },
        ],
      },
      alvos,
      { clientId: CLIENTE, hoje: HOJE },
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual([
      "criar_tarefa:p1",
      "criar_tarefa:p1.2",
      "agendar_lembrete:c1",
      "registrar_nota:c1",
      "concluir_tarefa:t1",
    ]);
    expect(a.itens[0].para).toBe("Gravar reels | 2026-10-02 | high");
    expect(a.itens[0].alvo_id).toBe(U(1));
    expect(a.recusados.map((r) => r.motivo)).toEqual(["A tarefa já está concluída."]);
    // Prazo "amanhã" não é data: fora da lista. Apelido inventado (UUID) também.
    expect(a.ignorados).toEqual(expect.arrayContaining(["t1", "p1"]));
    expect(a.ignorados.length).toBe(3);
    expect(a.contexto).toEqual(expect.objectContaining({ client_id: CLIENTE, projeto_padrao: U(1) }));
    expect(a.itens.every((i) => !i.titulo.includes(i.alvo_id))).toBe(true);
  });

  it("travas: lembrete e prazo no passado; lembrete no cliente sem projeto", () => {
    const passado = normalizarAcoesDoLancador({ resumo: "", itens: [{ operacao: "agendar_lembrete", ref: "c1", para: "2026-09-01 | algo" }, { operacao: "mudar_prazo", ref: "t1", para: "2026-09-02" }] }, alvos, { clientId: CLIENTE, hoje: HOJE })!;
    expect(passado.recusados.map((r) => r.motivo)).toEqual(["A data do lembrete já passou.", "A data nova já passou."]);
    const semProjeto = alvosDoLancador({ ...DADOS, projetos: [], tarefas: [] });
    const r = normalizarAcoesDoLancador({ resumo: "", itens: [{ operacao: "agendar_lembrete", ref: "c1", para: "2026-10-05 | reunião" }] }, semProjeto, { clientId: CLIENTE, hoje: HOJE })!;
    expect(r.recusados[0].motivo).toContain("não tem projeto aberto");
  });

  it("lê tarefa, lembrete e data com calma (31/02 não passa)", () => {
    expect(lerTarefaDoPara("Rever | baixa")).toEqual({ titulo: "Rever", prazo: null, prioridade: "low" });
    expect(lerTarefaDoPara("ab")).toBeNull();
    expect(lerLembreteDoPara("2026-10-10 | cobrar o briefing")).toEqual({ data: "2026-10-10", texto: "cobrar o briefing" });
    expect(lerLembreteDoPara("amanhã | x")).toBeNull();
    expect(dataValida("2026-02-31")).toBeNull();
  });
});

describe("agente de contexto: o que a equipe ensina vira ação já feita com Desfazer", () => {
  it("monta itens só do que mudou, com a carga no contexto, e pode ir direto", () => {
    const r = acaoDoKitNaConversa(
      {
        estilo: "Fotos claras, muito respiro.",
        regras: null,
        paleta: [{ nome: "Verde", hex: "#1a7f3c", papel: "primaria" }, { nome: "ruim", hex: "verde", papel: "" }],
        contexto: { negocio: "Padaria de bairro", publico: "igual", oferta: null, tom_de_voz: "" },
        memoria: [{ agente: "diretor_arte", tipo: "evitar", texto: "Nunca fundo preto." }, { agente: "outro", tipo: "evitar", texto: "x" }],
      },
      { estilo: null, regras: "Sem emoji.", contexto: { publico: "igual" } },
      CLIENTE,
    )!;
    expect(r.acao.itens.map((i) => i.operacao)).toEqual(["kit_estilo", "kit_paleta", "preencher_contexto", "gravar_decisao"]);
    expect(r.mudou).toEqual(["estilo", "paleta", "negocio"]);
    expect(r.memorias).toBe(1);
    const dados = (r.acao.contexto as { dados: Record<string, Record<string, unknown>> }).dados;
    expect(dados["kit_paleta:a1"].paleta).toEqual([{ nome: "Verde", hex: "#1A7F3C", papel: "primaria" }]);
    expect(dados["gravar_decisao:d1"]).toEqual({ area: "arte", categoria: "evitar", texto: "Nunca fundo preto." });
    expect(podeExecutarDireto(r.acao, REGRAS_DO_KIT_NA_CONVERSA, { pedidoClaro: true, maxItens: MAX_ITENS_DO_KIT }).direto).toBe(true);
    expect(acaoDoKitNaConversa({ estilo: "", regras: null, paleta: null, contexto: null, memoria: [] }, { estilo: "a" }, CLIENTE)).toBeNull();
  });
});

function campanha(parcial: Partial<CampanhaDePublicidade> = {}): CampanhaDePublicidade {
  return {
    ...campanhaVazia(CLIENTE),
    id: U(50),
    nome: "Óculos de sol",
    kit_id: U(51),
    kit_nome: "Óculos",
    territorios: [
      { id: U(60), nome: "Verão", status: "proposto" },
      { id: U(61), nome: "Cidade", status: "aprovado" },
    ] as CampanhaDePublicidade["territorios"],
    ...parcial,
  } as CampanhaDePublicidade;
}

describe("Publicidade: briefing, nome e território pelo agente", () => {
  it("editar o briefing (vários campos), renomear e aprovar território entram com apelidos; campo inventado não", () => {
    const a = normalizarAcoesDaPublicidade(
      {
        resumo: "",
        itens: [
          { operacao: "editar_briefing", ref: "k1", para: "publico: mulheres de 30 a 45" },
          { operacao: "editar_briefing", ref: "k1", para: "tom: leve" },
          { operacao: "editar_briefing", ref: "k1", para: "preco: 10 reais" },
          { operacao: "renomear_campanha", ref: "k1", para: "Verão 2027" },
          { operacao: "aprovar_territorio", ref: "t1", para: "" },
          { operacao: "aprovar_territorio", ref: "t2", para: "" },
        ],
      },
      campanha(),
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["editar_briefing:k1", "editar_briefing:k1.2", "renomear_campanha:k1", "aprovar_territorio:t1"]);
    expect(a.recusados.map((r) => r.motivo)).toEqual(["Este território já está aprovado."]);
    expect(lerEdicaoDoBriefing("oferta: 20% na primeira compra")).toEqual({ campo: "oferta", valor: "20% na primeira compra" });
    expect(lerEdicaoDoBriefing("preco: 10")).toBeNull();
  });
});

describe("Roteiros: editar sem IA, aprovar e marcar gravado", () => {
  const roteiros: RoteiroParaAcao[] = [
    { id: U(70), titulo: "Salário-maternidade", tipo: "fala_camera", status: "rascunho", versao_atual: 2, arquivado: false },
    { id: U(71), titulo: "BPC", tipo: "fala_camera", status: "aprovado", versao_atual: 3, arquivado: false },
    { id: U(72), titulo: "Gravado", tipo: "fala_camera", status: "gravado", versao_atual: 1, arquivado: false },
  ];

  it("as operações novas estão na lista e nas regras, com travas por status", () => {
    for (const op of ["editar_texto", "aprovar_roteiro", "marcar_gravado"]) {
      expect(OPERACOES_DOS_ROTEIROS).toContain(op);
      expect(Object.keys(regrasDosRoteiros())).toContain(op);
    }
    const a = normalizarAcoesDosRoteiros(
      {
        resumo: "",
        itens: [
          { operacao: "editar_texto", ref: "r1", para: "cta: Chame no WhatsApp" },
          { operacao: "editar_texto", ref: "r1", para: "gancho: Você sabia disso?" },
          { operacao: "aprovar_roteiro", ref: "r1", para: "" },
          { operacao: "marcar_gravado", ref: "r2", para: "" },
          { operacao: "editar_texto", ref: "r3", para: "titulo: Novo" },
          { operacao: "marcar_gravado", ref: "r1", para: "" },
        ],
      },
      roteiros,
      [],
      CLIENTE,
      0.02,
    )!;
    expect(a.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["editar_texto:r1", "editar_texto:r1.2", "aprovar_roteiro:r1", "marcar_gravado:r2"]);
    expect(a.recusados.map((r) => r.motivo)).toEqual(["Roteiro já gravado. Volte para aprovado antes de mexer."]);
    expect(a.custo_estimado_usd || 0).toBe(0);
  });

  it("editar troca só o trecho pedido (o gancho escolhido) e normaliza", () => {
    expect(lerEdicaoDeTexto("cta: Fale com a gente")).toEqual({ campo: "cta", texto: "Fale com a gente" });
    expect(lerEdicaoDeTexto("cenario: praia")).toBeNull();
    const base = normalizarRoteiro({ titulo: "T", ganchos: [{ texto: "a", mecanismo: "", promessa: "", motivo: "" }, { texto: "b", mecanismo: "", promessa: "", motivo: "" }], gancho_escolhido: 1, cta: "velho" }, { tipo: "fala_camera" });
    const novo = conteudoEditado(base, "gancho", "Novo gancho");
    expect(novo.ganchos[1].texto).toBe("Novo gancho");
    expect(novo.ganchos[0].texto).toBe(base.ganchos[0].texto);
    expect(conteudoEditado(base, "cta", "Novo CTA").cta).toBe("Novo CTA");
  });
});

// ------------------------------------------------------------------ 3. execução direta

const regraDireta: Record<string, RegraDaOperacao> = { fazer: { rotulo: "fazer", direta: true }, pagar: { rotulo: "pagar" } };
const acaoBase = (itens: Array<{ operacao: string; ref: string }>, extra: Partial<AcaoDoAgente> = {}): AcaoDoAgente => ({
  tipo: "acao_agente",
  agente: "teste",
  id: "a1",
  resumo: "",
  itens: itens.map((i) => ({ ...i, alvo_id: U(1), titulo: "x", detalhe: null, rotulo: i.operacao, para: null })),
  ignorados: [],
  recusados: [],
  ...extra,
});

describe("execução direta só para pedido claro, sem custo e com Desfazer", () => {
  it("a regra única do contrato", () => {
    const ok = acaoBase([{ operacao: "fazer", ref: "x1" }]);
    expect(podeExecutarDireto(ok, regraDireta, { pedidoClaro: true }).direto).toBe(true);
    expect(podeExecutarDireto(ok, regraDireta, { pedidoClaro: false }).direto).toBe(false);
    expect(podeExecutarDireto(acaoBase([{ operacao: "pagar", ref: "x1" }]), regraDireta, { pedidoClaro: true }).direto).toBe(false);
    expect(podeExecutarDireto(acaoBase([{ operacao: "fazer", ref: "x1" }], { custo_estimado_usd: 0.04 }), regraDireta, { pedidoClaro: true }).motivo).toBe("tem custo");
    expect(podeExecutarDireto(acaoBase([{ operacao: "fazer", ref: "x1" }], { sem_desfazer: true }), regraDireta, { pedidoClaro: true }).direto).toBe(false);
    expect(podeExecutarDireto(acaoBase([{ operacao: "fazer", ref: "x1" }], { recusados: [{ ref: "x2", titulo: "y", operacao: "fazer", motivo: "m" }] }), regraDireta, { pedidoClaro: true }).direto).toBe(false);
    const muitos = acaoBase(Array.from({ length: MAX_ITENS_DIRETOS + 1 }, (_, i) => ({ operacao: "fazer", ref: `x${i + 1}` })));
    expect(podeExecutarDireto(muitos, regraDireta, { pedidoClaro: true }).direto).toBe(false);
    expect(podeExecutarDireto(acaoBase([{ operacao: "fazer", ref: "x1" }], { executada_em: "2026-09-26" }), regraDireta, { pedidoClaro: true }).direto).toBe(false);
  });

  it("lançador: tudo é direto (sem custo e com Desfazer); Publicidade: aprovar território e propor pedem Confirmar; Roteiros: gerar com IA pede Confirmar", () => {
    expect(Object.values(regrasDoLancador(HOJE)).every((r) => r.direta === true)).toBe(true);
    expect(REGRAS_DA_PUBLICIDADE.editar_briefing.direta).toBe(true);
    expect(REGRAS_DA_PUBLICIDADE.renomear_campanha.direta).toBe(true);
    for (const op of ["aprovar_territorio", "propor_territorios", "pedir_tomadas", "reprovar_foto", "mandar_para_ads"]) expect(REGRAS_DA_PUBLICIDADE[op].direta, op).toBeFalsy();
    const misto = normalizarAcoesDaPublicidade({ resumo: "", itens: [{ operacao: "editar_briefing", ref: "k1", para: "tom: leve" }, { operacao: "aprovar_territorio", ref: "t1", para: "" }] }, campanha())!;
    expect(podeExecutarDireto(misto, REGRAS_DA_PUBLICIDADE, { pedidoClaro: true }).direto).toBe(false);
    expect(Object.values(regrasDeEdicao()).every((r) => r.direta === true)).toBe(true);
    for (const op of ["refazer_gancho", "mudar_tom", "gerar_roteiro"]) expect(regrasDosRoteiros()[op].direta, op).toBeFalsy();
  });

  it("executarDireto grava o resultado e marca feita na hora; o item que falha volta com o motivo", async () => {
    const a = acaoBase([{ operacao: "fazer", ref: "x1" }, { operacao: "fazer", ref: "x2" }]);
    const feita = await executarDireto(a, async (i) => {
      if (i.ref === "x2") throw new Error("Sem acesso.");
      return { desfazer: { antes: 1 } };
    }, { userId: U(9) });
    expect(feita.executada_direto).toBe(true);
    expect(feita.executada_em).toBeTruthy();
    expect(feita.resultados!.map((r) => [r.ref, r.ok, r.motivo || null])).toEqual([["x1", true, null], ["x2", false, "Sem acesso."]]);
  });

  it("pedido claro sem o Jev: verbo de ordem no começo", () => {
    expect(pareceOrdem("Crie uma tarefa para amanhã")).toBe(true);
    expect(pareceOrdem("marque como concluída")).toBe(true);
    expect(pareceOrdem("Será que vale criar uma tarefa?")).toBe(false);
    expect(pareceOrdem("o que você acha do briefing")).toBe(false);
  });
});

// ------------------------------------------------------------------ executor do lançador (banco falso)

type Linha = Record<string, unknown>;
function bancoFalso(tabelas: Record<string, Linha[]>) {
  const log: Array<{ tabela: string; op: string; dados?: unknown; filtros: Array<[string, unknown]> }> = [];
  const consulta = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let op = "select";
    let dados: unknown = null;
    const linhas = () => (tabelas[tabela] || []).filter((l) => filtros.every(([c, v]) => (Array.isArray(v) ? v.indexOf(l[c]) >= 0 : l[c] === v)));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
      in: (c: string, v: unknown[]) => (filtros.push([c, v]), q),
      insert: (d: Linha) => ((op = "insert"), (dados = d), q),
      update: (d: Linha) => ((op = "update"), (dados = d), q),
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      single: async () => {
        log.push({ tabela, op, dados, filtros });
        if (op === "insert") {
          const nova = { id: U(500 + log.length), ...(dados as Linha) };
          (tabelas[tabela] = tabelas[tabela] || []).push(nova);
          return { data: { id: nova.id }, error: null };
        }
        return { data: linhas()[0] ?? null, error: null };
      },
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => {
        log.push({ tabela, op, dados, filtros });
        if (op === "update") for (const l of linhas()) Object.assign(l, dados as Linha);
        return Promise.resolve({ data: null, error: null }).then(ok, erro);
      },
    };
    return q;
  };
  return { db: { from: consulta }, log, tabelas };
}

describe("lançador: executa item a item e desfaz", () => {
  it("cria tarefa no projeto do cliente e o Desfazer põe na lixeira; muda prazo e volta", async () => {
    const f = bancoFalso({
      projects: [{ id: U(1), client_id: CLIENTE, deleted_at: null }],
      tasks: [{ id: U(11), project_id: U(1), status: "todo", due_date: "2026-09-30", deleted_at: null }],
    });
    const deps = { userId: U(9), gravarNota: async () => ({ id: U(80), situacao: "criado", reforcos: 1, substituidos: [], erro: null }), agora: () => "2026-09-26T12:00:00.000Z" };
    const criada = await executarItemDoLancador(f.db, CLIENTE, { operacao: "criar_tarefa", alvo_id: U(1), para: "Gravar reels | 2026-10-02 | high", titulo: "Social" }, { contexto: {} }, deps);
    const tarefa = f.tabelas.tasks[1];
    expect(tarefa).toEqual(expect.objectContaining({ project_id: U(1), title: "Gravar reels", due_date: "2026-10-02", priority: "high", source: "agente:aceleriq" }));
    await reverterItemDoLancador(f.db, CLIENTE, { operacao: "criar_tarefa", desfazer: criada.desfazer }, deps);
    expect(tarefa.deleted_at).toBe("2026-09-26T12:00:00.000Z");

    const prazo = await executarItemDoLancador(f.db, CLIENTE, { operacao: "mudar_prazo", alvo_id: U(11), para: "2026-10-09", titulo: "Revisar" }, { contexto: {} }, deps);
    expect(f.tabelas.tasks[0].due_date).toBe("2026-10-09");
    await reverterItemDoLancador(f.db, CLIENTE, { operacao: "mudar_prazo", desfazer: prazo.desfazer }, deps);
    expect(f.tabelas.tasks[0].due_date).toBe("2026-09-30");

    const lembrete = await executarItemDoLancador(f.db, CLIENTE, { operacao: "agendar_lembrete", alvo_id: CLIENTE, para: "2026-10-01 | ligar", titulo: "Mirante" }, { contexto: { projeto_padrao: U(1) } }, deps);
    expect(f.tabelas.tasks[2]).toEqual(expect.objectContaining({ title: "Lembrete: ligar", assigned_to: U(9), due_date: "2026-10-01" }));
    expect(lembrete.desfazer.tarefa_id).toBe(f.tabelas.tasks[2].id);

    const nota = await executarItemDoLancador(f.db, CLIENTE, { operacao: "registrar_nota", alvo_id: CLIENTE, para: "Prefere vídeo curto", titulo: "Mirante" }, { contexto: {} }, deps);
    expect(nota.desfazer).toEqual({ memoria_id: U(80), substituidos: [] });
  });

  it("projeto de outro cliente não recebe tarefa", async () => {
    const f = bancoFalso({ projects: [{ id: U(1), client_id: U(999), deleted_at: null }], tasks: [] });
    const deps = { userId: U(9), gravarNota: async () => ({ id: null, situacao: null, reforcos: null, substituidos: [], erro: "x" }) };
    await expect(executarItemDoLancador(f.db, CLIENTE, { operacao: "criar_tarefa", alvo_id: U(1), para: "Tarefa x", titulo: "P" }, { contexto: {} }, deps)).rejects.toThrow("não está mais com o cliente");
    expect(f.tabelas.tasks.length).toBe(0);
  });
});

// ------------------------------------------------------------------ 4. roteamento para outra área

describe("roteamento: pedido de outra área vira link com o cliente", () => {
  it("link da área com cliente e etapa válida; etapa inventada e área inventada ficam de fora", () => {
    expect(linkDaArea("mesa_ads", { clientId: CLIENTE, etapa: "conta" })).toBe(`/mesa-ads?client=${CLIENTE}&etapa=conta`);
    expect(linkDaArea("mesa", { clientId: CLIENTE, etapa: "estudio" })).toBe(`/mesa?client=${CLIENTE}&aba=estudio`);
    expect(linkDaArea("mesa_ads", { clientId: CLIENTE, etapa: "inventada" })).toBe(`/mesa-ads?client=${CLIENTE}`);
    expect(linkDaArea("central", { clientId: CLIENTE })).toBe("/central");
    expect(destinoDoPedido("mesa_foto:ensaio", CLIENTE)).toEqual(expect.objectContaining({ area: "mesa_foto", nome: "Mesa Foto", etapa: "ensaio" }));
    expect(destinoDoPedido("mesa_de_verdade", CLIENTE)).toBeNull();
    expect(destinoDoPedido("/financeiro", CLIENTE)).toEqual(expect.objectContaining({ area: "financeiro", soPessoa: true }));
    expect(areaDaRota("/ciclo/revisao")!.chave).toBe("ciclo");
  });

  it("a resposta do agente que cita a rota vira destino; na tela, vira link só para rota do mapa", () => {
    expect(rotasNoTexto("Isso é na Mesa Ads (/mesa-ads). Depois veja /inexistente.").map((r) => r.area.chave)).toEqual(["mesa_ads"]);
    expect(destinoNaResposta("Isso é na Mesa Roteiros (/mesa-roteiros?etapa=revisao). Abro para você?", CLIENTE)).toEqual(expect.objectContaining({ link: `/mesa-roteiros?client=${CLIENTE}&etapa=revisao` }));
    const pedacos = pedacosComLinks("Isso é na /mesa-foto. Abro?", CLIENTE);
    expect(pedacos.map((p) => p.tipo)).toEqual(["texto", "link", "texto"]);
    expect(pedacos[1]).toEqual(expect.objectContaining({ link: `/mesa-foto?client=${CLIENTE}`, nome: "Mesa Foto" }));
    expect(destinoDoAgente({ nome: "X", link: "https://evil.example/mesa-ads", direto: true })).toBeNull();
    expect(destinoDoAgente({ nome: "Mesa Ads", link: "/mesa-ads?client=x", direto: true })).toEqual(expect.objectContaining({ area: "mesa_ads", direto: true }));
  });

  it("o Jev decide a área, a ordem e o abrir numa chamada; sem Jev, as palavras e o verbo decidem", () => {
    const q = perguntasDoRoteador("o próprio agente faz");
    expect(q.area.type).toBe("choice");
    expect(Object.keys((q.area as { criteria: Record<string, string> }).criteria)).toEqual(expect.arrayContaining([OPCAO_AQUI, "mesa_ads", "nenhuma"]));
    expect(q.ordem.type).toBe("noul");
    expect(q.abrir.type).toBe("noul");
    const r = lerRoteamento({ area: { choice: "mesa_foto", probabilities: { mesa_foto: 0.82 } }, ordem: { noul: 0.9 }, abrir: { noul: 0.1 } });
    expect(r).toEqual({ area: "mesa_foto", probabilidade: 0.82, ordem: 0.9, abrir: 0.1 });
    expect(lerRoteamento({ area: { choice: "mesa_foto", probabilities: { mesa_foto: 0.3 } } }).area).toBeNull();
    expect(lerRoteamento({ area: { choice: "inventada", probabilities: { inventada: 0.99 } } }).area).toBeNull();
    expect(areaPorPalavras("pausa a campanha de anúncio do Mirante")!.area).toBe("mesa_ads");
    expect(areaPorPalavras("gera um roteiro de vídeo")!.area).toBe("mesa_roteiros");
    expect(areaPorPalavras("bom dia")).toBeNull();
    expect(pedeParaAbrir("Abre a Mesa Foto do Mirante")).toBe(true);
    expect(pedeParaAbrir("gere 3 fotos")).toBe(false);
  });

  it("o lançador liga tudo: agir só no pedido explícito, cartão do servidor com Desfazer e caminho para a área", () => {
    const tela = ler("src/components/admin/VoiceAssistant.tsx");
    expect(tela).toContain("agir: !opts?.silent,");
    expect(tela).toContain("onPedido={(p) => chamarAcaoDoLancador(a.mensagemId, a.acao.id, p)}");
    expect(tela).toContain("navigate(destinoNovo.link)");
    // O fluxo antigo continua (cartão local do projeto do contrato).
    expect(tela).toContain("<CartaoDeAcao acao={acaoAberta} onPedido={onPedidoDaAcao}");
    const servidor = ler("supabase/functions/voice-assistant-agent/index.ts");
    expect(servidor).toContain('body.acao === "executar_acao_agente" || body.acao === "desfazer_acao_agente"');
    expect(servidor).toContain("const agir = body.agir === true && body.text.trim().length > 0;");
    expect(servidor).toContain("podeExecutarDireto(acao, regrasDoLancador(hoje), { pedidoClaro })");
    expect(servidor).toContain("rotearComJev(");
    expect(servidor).toContain('toolName: "aceleriq_acao_direta"');
  });
});
