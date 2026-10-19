import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adaptarAjuste,
  AJUSTES_DO_APP,
  ajustesParaOTipo,
  blocoDosAjustes,
  CHAVES_DOS_AJUSTES,
  GRUPOS_DOS_AJUSTES,
  lerEstadoDosAjustes,
  perguntaDoTipoDeNegocio,
  progressoDosAjustes,
  progressoDoEstado,
  tipoDaResposta,
  TIPOS_DE_NEGOCIO,
  type TipoDeNegocio,
} from "../functions/mesa-instagram/modulos/ajustes-do-app.ts";

const NEGOCIOS: TipoDeNegocio[] = ["negocio_local", "loja", "profissional_liberal"];
const item = (chave: string) => AJUSTES_DO_APP.find((a) => a.chave === chave)!;

Deno.test("catálogo: chaves únicas, no formato da migration, e cada item completo", () => {
  assertEquals(new Set(CHAVES_DOS_AJUSTES).size, CHAVES_DOS_AJUSTES.length);
  for (const a of AJUSTES_DO_APP) {
    assert(/^[a-z0-9_]{2,60}$/.test(a.chave), a.chave);
    assert(GRUPOS_DOS_AJUSTES.some((g) => g.grupo === a.grupo), a.chave);
    assert(a.titulo && a.fazer && a.caminho && a.porque, a.chave);
  }
});

Deno.test("catálogo: os quatro grupos do checklist têm itens", () => {
  for (const g of GRUPOS_DOS_AJUSTES) assert(AJUSTES_DO_APP.some((a) => a.grupo === g.grupo), g.grupo);
});

Deno.test("catálogo: cobre os itens do checklist original", () => {
  for (const chave of [
    "sugestoes_de_contas", "rotulo_de_categoria", "selo_do_threads", "exibicao_do_perfil", "opcoes_de_contato",
    "presentes", "conteudo_de_marca", "publicacao_cruzada", "sugestoes_de_resposta", "respostas_salvas", "perguntas_frequentes",
    "comentarios_gif", "compartilhamento_e_remixes", "permitir_baixar_reels", "interacoes_limitadas", "alta_qualidade",
    "foto_compartilhar_facebook", "foto_configuracoes_avancadas", "foto_texto_alternativo",
    "reels_marcar_pessoas", "reels_botao_mensagem", "reels_publico", "reels_topicos", "reels_renomear_audio", "reels_localizacao",
    "reels_lembrete", "reels_modelo", "reels_presentes", "reels_curtidas_visiveis", "reels_legendas_automaticas", "reels_permitir_baixar",
  ]) assert(CHAVES_DOS_AJUSTES.indexOf(chave) >= 0, chave);
});

Deno.test("nenhum texto do catálogo tem travessão", () => {
  for (const a of AJUSTES_DO_APP) {
    const textos = [a.titulo, a.fazer, a.caminho, a.porque, ...Object.values(a.por_tipo || {}).flatMap((r) => [r!.fazer, r!.porque])];
    for (const t of textos) assert(!/[–—]/.test(t), `${a.chave}: ${t}`);
  }
});

Deno.test("criador recebe o original: apagar o contato e esconder os botões", () => {
  const contato = adaptarAjuste(item("opcoes_de_contato"), "criador");
  assert(/Apague e-mail, telefone e WhatsApp/.test(contato.fazer));
  assertEquals(contato.mudou, false);
  assertEquals(contato.original, null);
  assert(/Desative/.test(adaptarAjuste(item("exibicao_do_perfil"), "criador").fazer));
});

Deno.test("negócio que atende mantém o contato, e a recomendação diz por quê", () => {
  for (const tipo of NEGOCIOS) {
    const contato = adaptarAjuste(item("opcoes_de_contato"), tipo);
    assert(/Mantenha/.test(contato.fazer), `${tipo}: ${contato.fazer}`);
    assert(contato.mudou, tipo);
    assert(contato.original && /Apague/.test(contato.original), tipo);
    assert(contato.porque.length > 20, tipo);
    const exibicao = adaptarAjuste(item("exibicao_do_perfil"), tipo);
    assert(exibicao.mudou && /Deixe/.test(exibicao.fazer), `${tipo}: ${exibicao.fazer}`);
  }
  assert(/WhatsApp Business/.test(adaptarAjuste(item("opcoes_de_contato"), "negocio_local").fazer));
});

Deno.test("localização: sempre para negócio local; loja só com loja física", () => {
  assert(/sempre/.test(adaptarAjuste(item("reels_localizacao"), "negocio_local").fazer));
  assert(/loja física/.test(adaptarAjuste(item("reels_localizacao"), "loja").fazer));
  assert(!/sempre/i.test(adaptarAjuste(item("reels_localizacao"), "criador").fazer));
});

Deno.test("perguntas frequentes e botão de ação: não contam para criador, contam para quem vende", () => {
  for (const chave of ["perguntas_frequentes", "botao_de_acao"]) {
    assertEquals(adaptarAjuste(item(chave), "criador").aplica, false, chave);
    for (const tipo of NEGOCIOS) assertEquals(adaptarAjuste(item(chave), tipo).aplica, true, `${chave} ${tipo}`);
  }
  assert(/agend/i.test(adaptarAjuste(item("perguntas_frequentes"), "profissional_liberal").fazer));
  assert(/entrega/i.test(adaptarAjuste(item("perguntas_frequentes"), "loja").fazer));
});

Deno.test("não sei: fica com o original e marca o que depende do tipo", () => {
  const lista = ajustesParaOTipo("nao_sei");
  const contato = lista.find((a) => a.chave === "opcoes_de_contato")!;
  assertEquals(contato.depende_do_tipo, true);
  assertEquals(contato.mudou, false);
  assertEquals(lista.find((a) => a.chave === "selo_do_threads")!.depende_do_tipo, false);
  // Tipo inválido vale como "não sei".
  assertEquals(ajustesParaOTipo("qualquer" as never).map((a) => a.fazer), lista.map((a) => a.fazer));
});

Deno.test("progresso: conta só o que se aplica e separa por grupo", () => {
  const criador = ajustesParaOTipo("criador");
  const local = ajustesParaOTipo("negocio_local");
  const total = AJUSTES_DO_APP.length;
  assertEquals(progressoDosAjustes(criador, {}).total, total - 2);
  assertEquals(progressoDosAjustes(local, {}).total, total);
  const itens = {
    selo_do_threads: { feito: true, quando: null, por: null },
    perguntas_frequentes: { feito: true, quando: null, por: null },
    presentes: { feito: false, quando: null, por: null },
  };
  const pc = progressoDosAjustes(criador, itens);
  assertEquals(pc.feitos, 1);
  assertEquals(pc.por_grupo.editar_perfil.feitos, 1);
  assertEquals(progressoDosAjustes(local, itens).feitos, 2);
});

Deno.test("lerEstadoDosAjustes: aceita o guardado e descarta o estranho", () => {
  const e = lerEstadoDosAjustes({
    tipo_de_negocio: { tipo: "loja", origem: "equipe", confianca: 0.9, probabilidades: { loja: 0.9, xyz: 0.1 }, quando: "2026-10-20T10:00:00Z", por: "u1" },
    itens: { selo_do_threads: { feito: true, quando: "2026-10-20T10:00:00Z", por: "u1" }, inventado: { feito: true }, presentes: "sim" },
  });
  assertEquals(e.tipo_de_negocio!.tipo, "loja");
  assertEquals(e.tipo_de_negocio!.origem, "equipe");
  assertEquals(Object.keys(e.tipo_de_negocio!.probabilidades), ["loja"]);
  assertEquals(Object.keys(e.itens), ["selo_do_threads"]);
  assertEquals(lerEstadoDosAjustes(null), { tipo_de_negocio: null, itens: {} });
  assertEquals(lerEstadoDosAjustes({ tipo_de_negocio: { tipo: "banco" } }).tipo_de_negocio, null);
  assertEquals(progressoDoEstado(e).total, AJUSTES_DO_APP.length);
});

Deno.test("Jev: uma pergunta Choice com os quatro tipos e o não sei, critérios que se separam", () => {
  const q = perguntaDoTipoDeNegocio();
  assertEquals(Object.keys(q), ["tipo_de_negocio"]);
  const p = q.tipo_de_negocio;
  assertEquals(p.type, "choice");
  const criterios = (p as { criteria: Record<string, unknown> }).criteria;
  assertEquals(Object.keys(criterios).sort(), TIPOS_DE_NEGOCIO.map((t) => t.valor).sort());
  for (const t of ["criador", "negocio_local", "loja", "profissional_liberal"]) {
    const c = criterios[t] as { o_que_e: string; nao_e: string };
    assert(c.o_que_e && c.nao_e, t);
  }
  assert(/`negocio`/.test(String(p.instructions)) && /`dossie`/.test(String(p.instructions)) && /`perfil`/.test(String(p.instructions)));
});

Deno.test("Jev: resposta firme vira o tipo; dúvida, não sei ou lixo viram não sei", () => {
  const agora = new Date("2026-10-20T12:00:00Z");
  const firme = tipoDaResposta({ choice: "negocio_local", confidence: 0.8, probabilities: { negocio_local: 0.86, loja: 0.1, criador: 0.04 } }, agora);
  assertEquals(firme.tipo, "negocio_local");
  assertEquals(firme.origem, "jev");
  assertEquals(firme.quando, "2026-10-20T12:00:00.000Z");
  assertEquals(tipoDaResposta({ choice: "loja", confidence: 0.1, probabilities: { loja: 0.4, negocio_local: 0.38, criador: 0.22 } }).tipo, "nao_sei");
  assertEquals(tipoDaResposta({ choice: "nao_sei", probabilities: { nao_sei: 0.9 } }).tipo, "nao_sei");
  assertEquals(tipoDaResposta({ choice: "padaria" }).tipo, "nao_sei");
  assertEquals(tipoDaResposta(undefined).tipo, "nao_sei");
});

Deno.test("bloco para os agentes: diz o tipo, o progresso e o que falta", () => {
  const b = blocoDosAjustes({ tipo_de_negocio: { tipo: "negocio_local", origem: "jev", confianca: 0.8, probabilidades: {}, quando: null, por: null }, itens: { selo_do_threads: { feito: true, quando: null, por: null } } });
  assert(b.startsWith(`AJUSTES DO APP (Negócio local, 1 de ${AJUSTES_DO_APP.length} feitos)`));
  assert(b.includes("- Opções de contato: Mantenha o WhatsApp Business"));
  assert(!b.includes("- Selo do Threads"));
});
