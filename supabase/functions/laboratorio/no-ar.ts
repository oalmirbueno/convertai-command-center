/**
 * laboratorio: nó "Pôr no ar" (v2, ESPEC-LABORATORIO-v2.md). NÃO executa nada no mundo.
 *
 * Usa o mecanismo de aprovações dos operadores (operator_approvals, migrations 20260829010000 e
 * 20260901050000 "ordem autorizada"):
 *  1. Rodar o nó cria a tarefa no Kanban (projeto "Laboratório" do cliente) com o pacote, e o pedido
 *     de aprovação do dono em operator_approvals (status 'pendente', origin 'operator', o operador
 *     que vai fazer, action_kind do vocabulário fechado, payload com o pacote). A tarefa AINDA NÃO vai
 *     para a fila do agente: aparece em Execução / "Precisa de você" (MesaDeDecisao) e avisa os admins.
 *  2. O dono decide pelo operator_approval_decidir de sempre. Aprovado, o gatilho da migration
 *     20261019233000 entrega a tarefa ao operador (operator_assign_task) e põe a instrução no diário;
 *     a ordem aparece em operator_ordens_abertas e o agente só fecha com prova (operator_ordem_executada).
 *  3. O nó acompanha o estado (aguardando aprovação → com o agente → feito com prova, ou recusado).
 *
 * Anúncio sobe sempre PAUSADO; verba e ativação são só do dono. Acesso a Facebook, Instagram e Google
 * só pelo Conectar (Composio/OAuth) ou pelo pedido de acesso (aceleriq_acesso_pedir), nunca senha.
 */
import { ErroHttp } from "./comum.ts";
import { ACAO_DO_ALVO, type AlvoNoAr, alvoValido, type NoDoCanvas, ROTULO_DO_TIPO } from "./modulos/regras.ts";

export const OPERADOR_PADRAO = "default";
/** Pedido de aprovação vale 14 dias (ordem vencida não aparece para o agente). */
export const VALIDADE_DO_PEDIDO_DIAS = 14;

export type Operador = { id: string; slug: string; display_name: string; role?: string | null; scope?: string | null };
export type EstadoNoAr = "aguardando_aprovacao" | "com_agente" | "feito" | "recusado";

/** Tudo que o nó toca no banco (a função usa o Supabase; o teste usa uma porta falsa). */
export interface PortaDoNoAr {
  operadoresAtivos(): Promise<Operador[]>;
  pedidoAberto(projetoId: string, noId: string): Promise<{ id: string; status: string } | null>;
  projetoDoKanban(): Promise<string>;
  criarTarefa(t: { project_id: string; title: string; description: string }): Promise<string>;
  apagarTarefa(id: string): Promise<void>;
  criarAprovacao(a: Record<string, unknown>): Promise<string>;
  registrar(acao: string, o: { operatorId: string; taskId: string }): Promise<void>;
  avisarAdmins(mensagem: string, link: string): Promise<void>;
  lerAprovacao(id: string): Promise<AprovacaoLida | null>;
  entregarAoOperador(slug: string, taskId: string, nota: string): Promise<string | null>;
  ligarAprovacao(aprovacaoId: string, linkId: string): Promise<void>;
  instruir(linkId: string, taskId: string, corpo: string): Promise<void>;
  statusDoVinculo(linkId: string): Promise<string | null>;
}

export type AprovacaoLida = {
  id: string;
  status: string;
  executed_at: string | null;
  execution_evidence: string | null;
  decision_note: string | null;
  task_link_id: string | null;
  kanban_task_id: string | null;
  operator_slug: string | null;
  payload: Record<string, unknown>;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const txt = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ------------------------------------------------------------------ quem faz

const TRAFEGO = /tr[aá]fego|traffic|gestor de an[uú]ncios/i;
const PAPERCLIP = /paperclip|peperclip/i;

/**
 * Quem põe no ar: o operador pedido no nó (ativo); anúncio vai ao gestor de tráfego do Paperclip quando
 * ele existe em internal_operators (senão a qualquer gestor de tráfego ativo); o resto, ao Hermes ('default').
 */
export function operadorParaOAlvo(ativos: Operador[], alvo: AlvoNoAr, pedido: string | null): Operador {
  if (pedido) {
    const o = ativos.find((x) => x.slug === pedido);
    if (!o) throw new ErroHttp(409, "operador_inativo", `O operador "${pedido}" não existe ou está desligado.`);
    return o;
  }
  if (alvo === "subir_anuncio_pausado") {
    const descr = (o: Operador) => [o.slug, o.display_name, o.role || "", o.scope || ""].join(" ");
    const trafego = ativos.filter((o) => TRAFEGO.test(descr(o)));
    const doPaperclip = trafego.find((o) => PAPERCLIP.test(descr(o)));
    if (doPaperclip) return doPaperclip;
    if (trafego[0]) return trafego[0];
  }
  const hermes = ativos.find((o) => o.slug === OPERADOR_PADRAO);
  if (!hermes) throw new ErroHttp(409, "sem_operador", "O Hermes (operador default) está desligado: ligue-o ou escolha outro operador no nó.");
  return hermes;
}

// ------------------------------------------------------------------ o pacote

export type EntradaDoPacote = { no: NoDoCanvas; saida: Record<string, unknown> | null };
export type Pacote = {
  paginas: Array<{ titulo: string; path: string; url: string | null; workspace_id: string | null }>;
  criativos: Array<{ titulo: string; path: string; url: string | null }>;
  anuncios: Array<{ titulo: string; pacote: Record<string, unknown> }>;
  copies: Array<{ titulo: string; texto: string }>;
  filmes: Array<{ titulo: string; formato: string; path: string; url: string | null }>;
  ofertas: Array<{ titulo: string; resumo: string }>;
};

const rotulo = (n: NoDoCanvas) => (typeof n.dados.titulo === "string" && n.dados.titulo.trim() ? n.dados.titulo.trim() : ROTULO_DO_TIPO[n.tipo] || n.tipo);

/** O que entra no Pôr no ar, separado por tipo, com os links do Workspace (válidos por 7 dias). */
export function montarPacote(entradas: EntradaDoPacote[]): Pacote {
  const p: Pacote = { paginas: [], criativos: [], anuncios: [], copies: [], filmes: [], ofertas: [] };
  for (const { no, saida } of entradas) {
    const s = obj(saida);
    const t = rotulo(no);
    if (no.tipo === "landing" && txt(s.html_path)) p.paginas.push({ titulo: t, path: txt(s.html_path), url: txt(s.html_url) || null, workspace_id: txt(s.no_workspace_id) || null });
    for (const i of Array.isArray(s.imagens) ? s.imagens : []) {
      const im = obj(i);
      if (txt(im.path)) p.criativos.push({ titulo: t, path: txt(im.path), url: txt(im.url) || null });
    }
    if (no.tipo === "anuncio" && s.json) p.anuncios.push({ titulo: t, pacote: { ...obj(s.json), status: "pausado", publicado: false } });
    if (["copy", "agente", "contexto"].indexOf(no.tipo) >= 0) {
      const texto = no.tipo === "contexto" ? txt(no.dados.texto) : txt(s.texto, 6000);
      if (texto) p.copies.push({ titulo: t, texto });
    }
    if ((no.tipo === "oferta" || no.tipo === "funil") && (txt(s.texto) || s.json)) p.ofertas.push({ titulo: t, resumo: txt(s.texto, 3000) || JSON.stringify(s.json).slice(0, 3000) });
    if (no.tipo === "filme") {
      for (const v of Array.isArray(s.videos) ? s.videos : []) {
        const vv = obj(v);
        if (txt(vv.path)) p.filmes.push({ titulo: t, formato: txt(vv.formato, 10), path: txt(vv.path), url: txt(vv.url) || null });
      }
    }
  }
  return p;
}

export const pacoteVazio = (p: Pacote) => !p.paginas.length && !p.criativos.length && !p.anuncios.length && !p.copies.length && !p.filmes.length && !p.ofertas.length;

const DESTINO: Record<AlvoNoAr, string> = {
  publicar_site: "Publicar a página no ar (domínio ou hospedagem do cliente) e devolver o link público.",
  subir_anuncio_pausado: "Criar o anúncio na conta de anúncios do cliente (Meta Ads) PAUSADO, sem verba nova e sem ativar.",
  conectar_pagina: "Ligar a página do Facebook/Instagram do cliente à BM da Aceleriq pelo Conectar ou pelo pedido de acesso.",
  outro: "Executar o que a instrução pede, só o que está no pacote.",
};

const REGRAS_DO_PEDIDO = [
  "Nada vai ao ar antes desta aprovação; depois dela, só ESTE pacote.",
  "Anúncio sobe sempre PAUSADO; verba, orçamento e ativação são só do dono.",
  "Acesso a Facebook, Instagram e Google só pelo Conectar (Composio/OAuth) ou pelo pedido de acesso (aceleriq_acesso_pedir); nunca senha.",
  "Feito só com prova: link público, id do anúncio ou print (operator_ordem_executada exige evidência).",
];

function pacoteEmTexto(p: Pacote): string {
  const linhas: string[] = [];
  if (p.paginas.length) linhas.push("Páginas:", ...p.paginas.map((x) => `- ${x.titulo}: ${x.url || x.path} (Workspace: ${x.path})`));
  if (p.anuncios.length) linhas.push("Anúncios (sobem PAUSADOS):", ...p.anuncios.map((x) => `- ${x.titulo}: ${JSON.stringify(x.pacote).slice(0, 1500)}`));
  if (p.criativos.length) linhas.push("Criativos:", ...p.criativos.map((x) => `- ${x.titulo}: ${x.url || x.path} (Workspace: ${x.path})`));
  if (p.filmes.length) linhas.push("Filmes:", ...p.filmes.map((x) => `- ${x.titulo} ${x.formato}: ${x.url || x.path}`));
  if (p.copies.length) linhas.push("Textos:", ...p.copies.map((x) => `- ${x.titulo}: ${x.texto.slice(0, 1500)}`));
  if (p.ofertas.length) linhas.push("Oferta e funil:", ...p.ofertas.map((x) => `- ${x.titulo}: ${x.resumo.slice(0, 1000)}`));
  return linhas.join("\n");
}

// ------------------------------------------------------------------ pedir (rodar o nó)

export type SaidaDoNoAr = {
  texto: string;
  estado: EstadoNoAr;
  alvo: AlvoNoAr;
  action_kind: string;
  aprovacao_id: string;
  link_aprovacao: string;
  operador: string;
  operador_nome: string;
  tarefa_id: string;
  link_id: string | null;
  prova: string;
  link_no_ar: string;
  pacote: Pacote;
  [extra: string]: unknown;
};

export async function pedirNoAr(porta: PortaDoNoAr, o: {
  projetoId: string;
  projetoNome: string;
  nomeDoCliente: string | null;
  execucaoId: string;
  no: NoDoCanvas;
  entradas: EntradaDoPacote[];
  userId: string;
}): Promise<SaidaDoNoAr> {
  const alvo = alvoValido(o.no.dados.alvo) ?? "publicar_site";
  const instrucao = txt(o.no.dados.instrucao, 3000);
  const pacote = montarPacote(o.entradas);
  if (pacoteVazio(pacote) && !instrucao) throw new ErroHttp(400, "no_sem_entrada", "Ligue a página, o anúncio ou os criativos (ou escreva a instrução) no Pôr no ar antes de rodar.");
  if (alvo === "publicar_site" && !pacote.paginas.length) throw new ErroHttp(400, "sem_pagina", "Para publicar o site, ligue uma Landing page já rodada no Pôr no ar.");
  if (alvo === "subir_anuncio_pausado" && !pacote.anuncios.length) throw new ErroHttp(400, "sem_anuncio", "Para subir o anúncio, ligue um Anúncio já rodado no Pôr no ar.");

  const aberto = await porta.pedidoAberto(o.projetoId, o.no.id);
  if (aberto) throw new ErroHttp(409, "ja_pedido", "Este Pôr no ar já tem um pedido aberto (aguardando o dono ou com o agente). Acompanhe por ele.", { aprovacao_id: aberto.id, status: aberto.status });

  const operador = operadorParaOAlvo(await porta.operadoresAtivos(), alvo, txt(o.no.dados.operador, 80) || null);
  const acao = ACAO_DO_ALVO[alvo];
  const quem = o.nomeDoCliente || "Livre (Aceleriq)";
  const titulo = rotulo(o.no);
  const oQue = `${titulo}: ${DESTINO[alvo]} Cliente: ${quem}. Projeto do Laboratório "${o.projetoNome}".`.slice(0, 900);
  const corpoDoPacote = pacoteEmTexto(pacote);
  const instrucaoDoAgente = [
    `Ordem do Laboratório (só depois da aprovação do dono): ${DESTINO[alvo]}`,
    instrucao ? `Instrução da equipe: ${instrucao}` : "",
    corpoDoPacote ? `Pacote:\n${corpoDoPacote}` : "",
    `Regras:\n${REGRAS_DO_PEDIDO.map((r) => `- ${r}`).join("\n")}`,
  ].filter(Boolean).join("\n\n").slice(0, 8000);

  const projetoKanban = await porta.projetoDoKanban();
  const tarefaId = await porta.criarTarefa({
    project_id: projetoKanban,
    title: `Pôr no ar: ${titulo} (${o.projetoNome})`.slice(0, 160),
    description: `${instrucaoDoAgente}\n\nAguardando a aprovação do dono (Execução, "Precisa de você"). Laboratório: projeto ${o.projetoId} · nó ${o.no.id} · execução ${o.execucaoId}.`,
  });
  let aprovacaoId: string;
  try {
    aprovacaoId = await porta.criarAprovacao({
      operator_id: operador.id,
      task_link_id: null,
      kanban_task_id: tarefaId,
      action_kind: acao,
      o_que: oQue,
      por_que: `A equipe montou e rodou o fluxo no Laboratório e pede para pôr no ar. ${operador.display_name} executa só depois do seu sim, com prova.`,
      dados_usados: corpoDoPacote.slice(0, 4000) || null,
      destino: DESTINO[alvo],
      impacto: alvo === "subir_anuncio_pausado" ? "O anúncio fica na conta PAUSADO: não gasta até você ativar." : "Fica visível para o público assim que for feito.",
      risco: alvo === "subir_anuncio_pausado" ? "Baixo: sobe pausado e sem verba nova." : "Público: confira textos, links e imagens antes de aprovar.",
      custo_previsto: 0,
      reversivel: alvo !== "outro",
      payload: {
        origem: "laboratorio",
        projeto_id: o.projetoId,
        no_id: o.no.id,
        execucao_id: o.execucaoId,
        alvo,
        operador: operador.slug,
        instrucao: instrucaoDoAgente,
        pacote,
        anuncio_pausado: alvo === "subir_anuncio_pausado" ? true : undefined,
        pedido_por: o.userId,
      },
      payload_version: 1,
      status: "pendente",
      valid_until: new Date(Date.now() + VALIDADE_DO_PEDIDO_DIAS * 86_400_000).toISOString(),
    });
  } catch (err) {
    await porta.apagarTarefa(tarefaId).catch(() => null);
    throw err;
  }
  await porta.registrar(`pedido de aprovacao (Laboratório): ${acao} [${alvo}]`, { operatorId: operador.id, taskId: tarefaId }).catch(() => null);
  const link = `/execucao?aprovacao=${aprovacaoId}`;
  await porta.avisarAdmins(`Laboratório pede aprovação para pôr no ar: ${oQue.slice(0, 140)}`, link).catch(() => null);
  return {
    texto: `Pedido de aprovação criado: nada foi ao ar. Aprovado em Execução, vai para o ${operador.display_name} executar e provar.`,
    estado: "aguardando_aprovacao",
    alvo,
    action_kind: acao,
    aprovacao_id: aprovacaoId,
    link_aprovacao: link,
    operador: operador.slug,
    operador_nome: operador.display_name,
    tarefa_id: tarefaId,
    link_id: null,
    prova: "",
    link_no_ar: "",
    pacote,
  };
}

// ------------------------------------------------------------------ acompanhar

export function estadoDoPedido(a: { status: string; executed_at: string | null }): EstadoNoAr {
  if (a.executed_at) return "feito";
  if (["rejeitado", "alteracoes_pedidas", "expirado"].indexOf(a.status) >= 0) return "recusado";
  if (a.status === "aprovado") return "com_agente";
  return "aguardando_aprovacao";
}

export const primeiroLink = (t: string | null | undefined) => {
  const m = String(t || "").match(/https?:\/\/[^\s)"'<>]+/i);
  return m ? m[0] : "";
};

/**
 * Relê o pedido e devolve o estado do nó. Aprovado sem vínculo (o gatilho não pôde entregar): entrega
 * agora pela mesma operator_assign_task. Nunca executa a ação: só a fila do agente.
 */
export async function acompanharNoAr(porta: PortaDoNoAr, saida: SaidaDoNoAr): Promise<{ saida: SaidaDoNoAr; status: "aguardando" | "pronto" | "erro"; erro?: string }> {
  if (!saida.aprovacao_id) throw new ErroHttp(409, "sem_pedido", "Este Pôr no ar ainda não tem pedido de aprovação; rode o nó.");
  const a = await porta.lerAprovacao(saida.aprovacao_id);
  if (!a) throw new ErroHttp(404, "pedido_inexistente", "O pedido de aprovação deste nó não existe mais.");
  let linkId = a.task_link_id;
  const avisos: string[] = [];
  if (a.status === "aprovado" && !a.executed_at && !linkId && a.kanban_task_id && a.operator_slug) {
    try {
      linkId = await porta.entregarAoOperador(a.operator_slug, a.kanban_task_id, `Aprovado pelo dono: ${txt(a.payload.alvo, 40)}`);
      if (linkId) {
        await porta.ligarAprovacao(a.id, linkId);
        await porta.instruir(linkId, a.kanban_task_id, txt(a.payload.instrucao, 8000) || "Pôr no ar o pacote aprovado, com prova.");
      }
    } catch (err) {
      avisos.push(`Aprovado, mas a fila do agente recusou a entrega: ${err instanceof Error ? err.message : "falha"}`);
    }
  }
  const estado = estadoDoPedido(a);
  const vinculo = linkId ? await porta.statusDoVinculo(linkId) : null;
  const nota = txt(a.decision_note, 300);
  const texto = estado === "feito"
    ? `Feito pelo ${saida.operador_nome}, com prova.`
    : estado === "recusado"
    ? `O dono não aprovou (${a.status === "alteracoes_pedidas" ? "pediu alterações" : a.status})${nota ? `: ${nota}` : ""}. Ajuste e rode o nó de novo.`
    : estado === "com_agente"
    ? `Aprovado. Está com o ${saida.operador_nome}${vinculo ? ` (${vinculo})` : ""}; o feito chega com prova.`
    : "Aguardando a sua aprovação em Execução (Precisa de você). Nada foi ao ar.";
  const nova: SaidaDoNoAr = {
    ...saida,
    estado,
    link_id: linkId,
    vinculo_status: vinculo,
    aprovacao_status: a.status,
    prova: txt(a.execution_evidence, 4000),
    link_no_ar: primeiroLink(a.execution_evidence),
    texto,
    ...(avisos.length ? { avisos } : {}),
  };
  return { saida: nova, status: estado === "feito" ? "pronto" : estado === "recusado" ? "erro" : "aguardando", ...(estado === "recusado" ? { erro: texto } : {}) };
}
