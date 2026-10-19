/**
 * 20/10: regras puras da aba Stories (supabase/functions/mesa-stories/modulos).
 *
 *   npx --yes deno test --no-lock --allow-env --allow-read supabase/testes-deno/mesa-stories_test.ts
 */
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CHAVES_DOS_MOLDES, MOLDES_DE_STORIES } from "../functions/mesa-stories/modulos/moldes-de-stories.ts";
import {
  adesivoLimpo,
  agendarUm,
  type ArquivoDoStory,
  avisoEm,
  caminhoDoAdesivo,
  type DependenciasDoAgendamento,
  emOrdem,
  horariosDaSequencia,
  melhorVersao,
  MOTIVO_ESPERANDO_APROVACAO,
  planoLimpo,
  pontosDoPlano,
  repeticaoDoPlano,
  roteiroDoAdesivo,
  type SequenciaRecente,
  situacaoPelaPublicacao,
  type Story,
} from "../functions/mesa-stories/modulos/regras-dos-stories.ts";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const ARQUIVO = "22222222-2222-4222-8222-222222222222";
const PROJETO = "33333333-3333-4333-8333-333333333333";
const CONTA = "44444444-4444-4444-8444-444444444444";
const POST = "55555555-5555-4555-8555-555555555555";
const PUB = "66666666-6666-4666-8666-666666666666";
const AGORA = new Date("2026-10-20T12:00:00Z");
const DAQUI_A_UMA_HORA = "2026-10-20T13:00:00.000Z";

Deno.test("o catálogo tem os 11 moldes do mapa mental, cada um com exemplo", () => {
  assertEquals(CHAVES_DOS_MOLDES, ["me_ajude", "convite_link", "caixinha", "lugares", "fofoca", "perrengue", "stories_awards", "geracao_valor", "ancoragem_lancamento", "opiniao", "palavra_no_direct"]);
  for (const m of MOLDES_DE_STORIES) {
    assert(m.exemplo.length >= 3, m.chave);
    assert(!/[\u2013\u2014]/.test(JSON.stringify(m)), `${m.chave} sem travessão`);
  }
});

Deno.test("caminho pelo adesivo: tem adesivo = pelo app; sem adesivo = automático", () => {
  assertEquals(caminhoDoAdesivo({ tipo: "nenhum" }), "automatico");
  for (const tipo of ["enquete", "caixinha", "quiz", "link", "contagem", "localizacao", "reacao", "mencao"] as const) {
    assertEquals(caminhoDoAdesivo({ tipo }), "pelo_app", tipo);
  }
  assertEquals(caminhoDoAdesivo(null), "automatico");
  // Tipo desconhecido vira nenhum (e o caminho, automático).
  assertEquals(adesivoLimpo({ tipo: "gif" }), { tipo: "nenhum" });
  // Link só https; enquete até 4 opções.
  assertEquals(adesivoLimpo({ tipo: "link", url: "javascript:alert(1)", texto_do_link: "Ver" }), { tipo: "link", texto_do_link: "Ver" });
  assertEquals(adesivoLimpo({ tipo: "enquete", pergunta: "Qual?", opcoes: ["a", "b", "c", "d", "e"] }).opcoes, ["a", "b", "c", "d"]);
});

Deno.test("roteiro do adesivo: a frase exata que a equipe põe no app", () => {
  assertEquals(roteiroDoAdesivo({ tipo: "nenhum" }), null);
  assertEquals(
    roteiroDoAdesivo({ tipo: "enquete", pergunta: "Qual sabor primeiro?", opcoes: ["Morango", "Pistache"] }),
    "Enquete \"Qual sabor primeiro?\" com as opções Morango | Pistache. Coloque no meio de baixo: a arte deixa essa área livre.",
  );
  assertMatch(roteiroDoAdesivo({ tipo: "link", url: "https://loja.com/kit", texto_do_link: "Ver o kit" })!, /^Link https:\/\/loja\.com\/kit com o texto "Ver o kit"/);
  assertMatch(roteiroDoAdesivo({ tipo: "contagem", pergunta: "Lançamento", quando: "25/10 19:00" })!, /até 25\/10 19:00, com lembrete ligado/);
});

Deno.test("ordem: 1..n estável, cortada na quantidade; o plano tira story vazio e calcula o caminho", () => {
  assertEquals(emOrdem([{ ordem: 3, k: "c" }, { ordem: 1, k: "a" }, { ordem: 3, k: "d" }, { ordem: 2, k: "b" }], 3).map((x) => [x.ordem, x.k]), [[1, "a"], [2, "b"], [3, "c"]]);
  const plano = planoLimpo({
    titulo: "Dia do sabor",
    gancho_de_amanha: "Amanhã eu conto qual ganhou",
    stories: [
      { molde: "me_ajude", papel: "gancho", texto_na_tela: "Preciso de vocês", adesivo: { tipo: "nenhum" }, fundo: "foto" },
      { molde: "inventado", papel: "interacao", texto_na_tela: "Qual primeiro?", adesivo: { tipo: "enquete", pergunta: "Qual?", opcoes: ["A", "B"] }, fundo: "cor" },
      { molde: "livre", papel: "convite", texto_na_tela: "", adesivo: { tipo: "nenhum" } },
    ],
  }, 5);
  assertEquals(plano.stories.length, 2);
  assertEquals(plano.stories[1].molde, "livre");
  assertEquals(plano.stories[1].caminho, "pelo_app");
  assertEquals(plano.stories[0].caminho, "automatico");
  assertEquals(plano.stories[0].fundo, { tipo: "foto" });
  assert(plano.stories[1].roteiro_do_adesivo?.startsWith("Enquete"));
});

const SEMANA: SequenciaRecente[] = [
  {
    data: "2026-10-18",
    titulo: "Bastidor da cozinha",
    gancho_de_amanha: "Amanhã eu mostro o prato novo",
    stories: [
      { ordem: 1, molde: "perrengue", texto_na_tela: "Hoje a cozinha parou às 11h" },
      { ordem: 2, molde: "geracao_valor", texto_na_tela: "Você sabia que o forno a lenha chega a 450 graus?" },
    ],
  },
];

const historia = (stories: Array<{ molde: string; texto: string; adesivo?: string; papel?: string }>) =>
  planoLimpo({
    titulo: "x",
    gancho_de_amanha: "amanhã tem mais",
    stories: stories.map((s) => ({ molde: s.molde, papel: s.papel ?? "desenvolvimento", texto_na_tela: s.texto, adesivo: { tipo: s.adesivo ?? "nenhum" } })),
  }, 8);

Deno.test("sem repetir a semana: molde e gancho usados perdem pontos; a versão nova ganha", () => {
  const repetida = historia([
    { molde: "perrengue", texto: "Hoje a cozinha parou às 11h de novo" },
    { molde: "geracao_valor", texto: "Forno a lenha: 450 graus", adesivo: "quiz" },
    { molde: "livre", texto: "Amanhã tem mais", papel: "gancho_de_amanha" },
  ]);
  const nova = historia([
    { molde: "me_ajude", texto: "O prato novo chegou e preciso de vocês" },
    { molde: "opiniao", texto: "Pagaria mais por massa de fermentação longa?", adesivo: "enquete" },
    { molde: "livre", texto: "Amanhã eu conto o resultado", papel: "gancho_de_amanha" },
  ]);
  const r = repeticaoDoPlano(repetida, SEMANA);
  assertEquals(r.moldes_repetidos.sort(), ["geracao_valor", "perrengue"]);
  assertEquals(r.gancho_repetido, true);
  assertEquals(repeticaoDoPlano(nova, SEMANA), { moldes_repetidos: [], gancho_repetido: false, frases_repetidas: 0 });
  const pontos = [pontosDoPlano(repetida, SEMANA), pontosDoPlano(nova, SEMANA)];
  assertEquals(melhorVersao(pontos), 1);
  // O Jev soma (novidade pesa 2, clareza 1), mas não salva a versão que repete a semana inteira.
  assertEquals(melhorVersao([pontosDoPlano(repetida, SEMANA, { novidade: 3, clareza: 3 }), pontosDoPlano(nova, SEMANA, { novidade: 2, clareza: 2 })]), 1);
  // Plano vazio nunca é escolhido.
  assertEquals(melhorVersao([pontosDoPlano(historia([]), []), pontosDoPlano(nova, [])]), 1);
});

Deno.test("horários: espalhados no dia de Brasília; hoje começa depois de agora; aviso 5 minutos antes", () => {
  assertEquals(horariosDaSequencia("2026-10-21", 3), ["2026-10-21T12:00:00.000Z", "2026-10-21T18:00:00.000Z", "2026-10-22T00:00:00.000Z"]);
  assertEquals(horariosDaSequencia("2026-10-21", 1), ["2026-10-21T12:00:00.000Z"]);
  // 20/10 às 12:00 UTC = 09:00 em Brasília: a primeira sai 30 minutos depois.
  const hoje = horariosDaSequencia("2026-10-20", 2, AGORA);
  assertEquals(hoje[0], "2026-10-20T12:30:00.000Z");
  assert(hoje[1] > hoje[0]);
  assertEquals(avisoEm("2026-10-21T18:00:00.000Z"), "2026-10-21T17:55:00.000Z");
});

Deno.test("a situação acompanha a publicação da Agenda", () => {
  assertEquals(situacaoPelaPublicacao("published", "agendado"), "publicado");
  assertEquals(situacaoPelaPublicacao("failed", "agendado"), "falhou");
  assertEquals(situacaoPelaPublicacao("scheduled", "arte_pronta"), "agendado");
  assertEquals(situacaoPelaPublicacao("cancelled", "agendado"), "arte_pronta");
  assertEquals(situacaoPelaPublicacao(undefined, "rascunho"), "rascunho");
});

// ------------------------------------------------------------------ agendamento com fakes

function story(extra: Partial<Story> = {}): Story {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    sequencia_id: null,
    client_id: CLIENTE,
    ordem: 2,
    molde: "geracao_valor",
    titulo: "Dica do forno",
    texto_na_tela: "O segredo da massa",
    adesivo: { tipo: "nenhum" },
    fundo: { tipo: "cor" },
    horario: DAQUI_A_UMA_HORA,
    caminho: "automatico",
    destaque_id: null,
    file_id: ARQUIVO,
    editorial_post_id: null,
    publicacao_id: null,
    situacao: "arte_pronta",
    roteiro_do_adesivo: null,
    motivo: null,
    ...extra,
  };
}

function arquivo(extra: Partial<ArquivoDoStory> = {}): ArquivoDoStory {
  return {
    id: ARQUIVO,
    client_id: CLIENTE,
    project_id: PROJETO,
    parent_file_id: null,
    archived_at: null,
    status: "ready",
    agency_approval_status: "approved",
    locked_at: "2026-10-20T10:00:00Z",
    visibility: "approval",
    approval_status: "approved",
    sha256: "a".repeat(64),
    storage_path: `${CLIENTE}/${ARQUIVO}/v1/1-story-2.png`,
    file_url: null,
    ...extra,
  };
}

function fakes(o: { arquivo?: ArquivoDoStory | null; conta?: { id: string; automatica: boolean } | null; status?: string; recusa?: string } = {}) {
  const chamadas: { payloads: Record<string, unknown>[]; ligados: string[] } = { payloads: [], ligados: [] };
  const deps: DependenciasDoAgendamento = {
    agora: AGORA,
    lerArquivo: () => Promise.resolve(o.arquivo === undefined ? arquivo() : o.arquivo),
    contaDoProjeto: () => Promise.resolve(o.conta === undefined ? { id: CONTA, automatica: true } : o.conta),
    projetoComConta: () => Promise.resolve({ projectId: PROJETO, conta: { id: CONTA, automatica: true } }),
    ligarArquivoAoProjeto: (fileId, projectId) => {
      chamadas.ligados.push(`${fileId}>${projectId}`);
      return Promise.resolve(null);
    },
    salvarPost: (payload) => {
      chamadas.payloads.push(payload);
      if (o.recusa) return Promise.reject(new Error(o.recusa));
      return Promise.resolve({ post_id: POST });
    },
    lerPublicacao: () => Promise.resolve({ id: PUB, status: o.status ?? "scheduled" }),
  };
  return { deps, chamadas };
}

Deno.test("agendar pelo app: sem post, situação, aviso 5 minutos antes e o roteiro do adesivo", async () => {
  const { deps, chamadas } = fakes();
  const m = await agendarUm(story({ adesivo: { tipo: "caixinha", pergunta: "O que você quer saber?" }, caminho: "pelo_app" }), deps);
  assertEquals(chamadas.payloads.length, 0);
  assertEquals(m.situacao, "postar_pelo_app");
  assertEquals(m.aviso_em, "2026-10-20T12:55:00.000Z");
  assertEquals(m.avisado_em, null);
  assertMatch(m.roteiro_do_adesivo!, /^Caixinha de perguntas "O que você quer saber\?"/);
  // Já com publicação automática na Agenda: não manda pelo app (o motor também postaria).
  const dupla = await agendarUm(story({ adesivo: { tipo: "enquete" }, caminho: "pelo_app", publicacao_id: PUB }), deps);
  assertEquals(dupla.situacao, undefined);
  assertMatch(dupla.motivo!, /Cancele por lá/);
});

Deno.test("agendar automático com arte aprovada: post story, publicação agendada, lâmina congelada", async () => {
  const { deps, chamadas } = fakes();
  const m = await agendarUm(story(), deps);
  assertEquals(m, { editorial_post_id: POST, publicacao_id: PUB, situacao: "agendado", motivo: null });
  const p = chamadas.payloads[0];
  assertEquals(p.content_type, "story");
  assertEquals(p.primary_file_id, ARQUIVO);
  assertEquals(p.project_id, PROJETO);
  assertEquals(p.task_id, null);
  const pub = (p.publications as Record<string, unknown>[])[0];
  assertEquals(pub.external_account_id, CONTA);
  assertEquals(pub.scheduled_at, DAQUI_A_UMA_HORA);
  assertEquals(pub.file_id, ARQUIVO);
  assertEquals(pub.delivery_mode, "automatic");
  assertEquals(pub.asset_file_ids, [ARQUIVO]);
  // A mesma entrega gera as mesmas chaves (repetir não duplica).
  const { deps: d2, chamadas: c2 } = fakes();
  await agendarUm(story(), d2);
  assertEquals(c2.payloads[0].idempotency_key, p.idempotency_key);
  assertMatch(String(p.idempotency_key), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

Deno.test("agendar automático sem aprovação: planejada na Agenda (o banco agenda quando aprovar), sem modo de entrega", async () => {
  const { deps, chamadas } = fakes({ arquivo: arquivo({ approval_status: "pending" }), status: "planned" });
  const m = await agendarUm(story(), deps);
  assertEquals(m.situacao, "arte_pronta");
  assertEquals(m.motivo, MOTIVO_ESPERANDO_APROVACAO);
  const pub = (chamadas.payloads[0].publications as Record<string, unknown>[])[0];
  assertEquals(pub.file_id, null);
  assertEquals("delivery_mode" in pub, false);
  assertEquals("asset_file_ids" in pub, false);
});

Deno.test("agendar automático: conta sem automação vai manual; sha inválido também", async () => {
  const { deps, chamadas } = fakes({ conta: { id: CONTA, automatica: false } });
  await agendarUm(story(), deps);
  assertEquals((chamadas.payloads[0].publications as Record<string, unknown>[])[0].delivery_mode, "manual");
  const { deps: d2, chamadas: c2 } = fakes({ arquivo: arquivo({ sha256: null }) });
  await agendarUm(story(), d2);
  assertEquals((c2.payloads[0].publications as Record<string, unknown>[])[0].delivery_mode, "manual");
});

Deno.test("agendar: o que não dá vira motivo, sem chamar a Agenda", async () => {
  const casos: Array<[Partial<Story>, ReturnType<typeof fakes>, RegExp]> = [
    [{ horario: "2026-10-20T11:00:00.000Z" }, fakes(), /2 minutos à frente/],
    [{ horario: null }, fakes(), /Escolha a data/],
    [{ file_id: null }, fakes(), /Gere a arte/],
    [{}, fakes({ arquivo: arquivo({ client_id: PROJETO }) }), /não está em Arquivos deste cliente/],
    [{}, fakes({ conta: null }), /não tem conta do Instagram/],
    [{ publicacao_id: PUB, situacao: "agendado" }, fakes(), /já está na Agenda/],
    [{ publicacao_id: PUB, situacao: "falhou" }, fakes(), /Tentar de novo/],
  ];
  for (const [extra, f, motivo] of casos) {
    const m = await agendarUm(story(extra), f.deps);
    assertMatch(m.motivo || "", motivo);
    assertEquals(f.chamadas.payloads.length, 0, String(motivo));
  }
  assertEquals(await agendarUm(story({ situacao: "publicado" }), fakes().deps), {});
});

Deno.test("agendar: arte sem projeto é ligada ao projeto da conta; recusa da Agenda vira motivo", async () => {
  const f = fakes({ arquivo: arquivo({ project_id: null }) });
  const m = await agendarUm(story(), f.deps);
  assertEquals(f.chamadas.ligados, [`${ARQUIVO}>${PROJETO}`]);
  assertEquals(m.situacao, "agendado");
  const recusa = fakes({ recusa: "Só admin ou gestor do cliente agenda publicação." });
  const r = await agendarUm(story(), recusa.deps);
  assertEquals(r.motivo, "Só admin ou gestor do cliente agenda publicação.");
  assertEquals(r.situacao, undefined);
});
