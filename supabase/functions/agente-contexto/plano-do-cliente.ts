/**
 * Agente do cliente: o agente de contexto promovido a planejador de ponta a
 * ponta (frente C, 26/09). Pedido do dono: "o cliente entrou... atualizar o
 * agente para atualizar todo o contexto do cliente, para ver qual o melhor
 * nicho, que vai evoluir e ser realista dentro do nicho... gerar o caminho
 * certo para mim, um tech stack".
 *
 * Mesma conversa do agente de contexto (modo "plano"), mesmo contrato das
 * ações (../_shared/acoes-do-agente.ts): o agente propõe com apelidos, a
 * equipe confirma no cartão, só a confirmação executa, item a item, e o
 * Desfazer volta (o que foi criado vai para a lixeira: deleted_at, nunca
 * exclusão).
 *
 * Apelidos que o agente vê (nunca id):
 * - p1..pN projetos do cliente; o projeto novo do plano é "novo" (vira pn1).
 * - m1..mN marcos dos projetos listados; marco novo do plano: mn1..mnN.
 * - t1..tN tarefas abertas (para atualizar dono, prazo ou prioridade);
 *   tarefa nova do plano vira tn1..tnN na proposta.
 * - e1..eN pessoas da equipe (dono da tarefa).
 *
 * Operações: criar_projeto, atualizar_projeto, criar_marco, criar_tarefa,
 * atualizar_tarefa, preencher_contexto, gravar_decisao, gravar_caminho.
 * O valor de cada item fica em acao.contexto.dados["operacao:ref"]; o
 * executor (executor-do-plano.ts) confere de novo tudo no banco antes de
 * gravar.
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import { type AcaoDoAgente, type ItemDaAcaoDoAgente, type RecusaDoItem, resumoPadrao, TIPO_DA_ACAO } from "../_shared/acoes-do-agente.ts";
import { AREAS_DO_CEREBRO } from "../_shared/cerebro-do-cliente.ts";
import type { CaminhoDoCliente } from "../_shared/pacote-externo.ts";

export const OPERACOES_DO_PLANO = [
  "criar_projeto",
  "atualizar_projeto",
  "criar_marco",
  "criar_tarefa",
  "atualizar_tarefa",
  "preencher_contexto",
  "gravar_decisao",
  "gravar_caminho",
] as const;
export type OperacaoDoPlano = (typeof OPERACOES_DO_PLANO)[number];

export function ehOperacaoDoPlano(op: string): boolean {
  return (OPERACOES_DO_PLANO as readonly string[]).indexOf(op) >= 0;
}

/** Os mesmos valores dos checks do banco (tasks_workstream_check e tasks_delivery_type_check). */
export const FRENTES = ["general", "design", "content", "video", "traffic", "development", "operations"] as const;
export const ENTREGAS = [
  "unspecified", "design", "branding", "static", "carousel", "reel", "story", "video", "short", "article", "google_post",
  "planning", "copywriting", "website", "landing_page", "automation", "traffic", "seo", "document", "report", "other",
] as const;
export const PRIORIDADES = ["low", "medium", "high", "urgent"] as const;
export const TIPOS_DE_PROJETO = ["social_media", "marketing_digital", "branding", "website", "landing_page", "traffic", "automation", "design", "marketing", "other"] as const;
export const CAMPOS_DO_CONTEXTO_DO_PLANO = ["negocio", "publico", "oferta", "tom_de_voz", "nicho", "posicionamento", "estagio"] as const;
export const CATEGORIAS_DA_DECISAO = ["preferencia", "evitar", "aprendizado"] as const;

export const MAX_MARCOS_NO_PLANO = 12;
export const MAX_TAREFAS_NO_PLANO = 60;

const ROTULO_DO_CAMPO: Record<string, string> = {
  negocio: "Negócio",
  publico: "Público",
  oferta: "Oferta",
  tom_de_voz: "Tom de voz",
  nicho: "Nicho",
  posicionamento: "Posicionamento",
  estagio: "Estágio",
};

// ------------------------------------------------------------------ dados

export type ProjetoDoCliente = { id: string; name: string; status: string; project_type: string | null; start_date: string | null; deadline: string | null; objectives?: string | null; scope?: string | null };
export type MarcoDoCliente = { id: string; project_id: string; title: string; status: string; target_date: string | null };
export type TarefaDoCliente = { id: string; project_id: string; milestone_id: string | null; title: string; status: string; assigned_to: string | null; due_date: string | null; priority: string | null };
export type PessoaDaEquipe = { id: string; nome: string; papel: string };

export type DadosDoPlano = {
  /** Hoje em AAAA-MM-DD (fuso de São Paulo, calculado por quem chama). */
  hoje: string;
  projetos: ProjetoDoCliente[];
  marcos: MarcoDoCliente[];
  tarefas: TarefaDoCliente[];
  equipe: PessoaDaEquipe[];
  /** Contexto consolidado atual do kit (para dizer "estava vazio" ou "substitui"). */
  contexto: Record<string, unknown>;
};

const umaLinha = (v: unknown, max = 400) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

type ComApelido<T> = T & { ref: string };

export function apelidosDoPlano(d: DadosDoPlano) {
  const projetos: Array<ComApelido<ProjetoDoCliente>> = d.projetos.slice(0, 12).map((p, i) => ({ ...p, ref: `p${i + 1}` }));
  const idsDosProjetos = new Set(projetos.map((p) => p.id));
  const marcos: Array<ComApelido<MarcoDoCliente>> = d.marcos.filter((m) => idsDosProjetos.has(m.project_id)).slice(0, 60).map((m, i) => ({ ...m, ref: `m${i + 1}` }));
  const tarefas: Array<ComApelido<TarefaDoCliente>> = d.tarefas.filter((t) => idsDosProjetos.has(t.project_id)).slice(0, 60).map((t, i) => ({ ...t, ref: `t${i + 1}` }));
  const equipe: Array<ComApelido<PessoaDaEquipe>> = d.equipe.slice(0, 30).map((e, i) => ({ ...e, ref: `e${i + 1}` }));
  return { projetos, marcos, tarefas, equipe };
}

/** Bloco do prompt com os apelidos (nunca id). */
export function blocoDoPlanoParaPrompt(d: DadosDoPlano): string {
  const a = apelidosDoPlano(d);
  const refDoProjeto = new Map(a.projetos.map((p) => [p.id, p.ref]));
  const refDoMarco = new Map(a.marcos.map((m) => [m.id, m.ref]));
  const nomeDaPessoa = new Map(a.equipe.map((e) => [e.id, `${e.ref} ${e.nome}`]));
  const linhas: string[] = [`\nHOJE: ${d.hoje}`];
  linhas.push(
    a.projetos.length
      ? `PROJETOS DO CLIENTE (apelido | nome | situação | tipo | início > prazo):\n${a.projetos.map((p) => `${p.ref} | ${umaLinha(p.name, 120)} | ${p.status} | ${p.project_type || "?"} | ${p.start_date || "?"} > ${p.deadline || "?"}`).join("\n")}`
      : "PROJETOS DO CLIENTE: nenhum ainda.",
  );
  if (a.marcos.length) linhas.push(`MARCOS (apelido | projeto | título | situação | data):\n${a.marcos.map((m) => `${m.ref} | ${refDoProjeto.get(m.project_id)} | ${umaLinha(m.title, 120)} | ${m.status} | ${m.target_date || "?"}`).join("\n")}`);
  if (a.tarefas.length) linhas.push(`TAREFAS ABERTAS (apelido | projeto | marco | título | dono | prazo):\n${a.tarefas.map((t) => `${t.ref} | ${refDoProjeto.get(t.project_id)} | ${(t.milestone_id && refDoMarco.get(t.milestone_id)) || "-"} | ${umaLinha(t.title, 120)} | ${(t.assigned_to && nomeDaPessoa.get(t.assigned_to)) || "sem dono"} | ${t.due_date || "sem prazo"}`).join("\n")}`);
  linhas.push(a.equipe.length ? `EQUIPE (apelido | nome | papel):\n${a.equipe.map((e) => `${e.ref} | ${umaLinha(e.nome, 80)} | ${e.papel}`).join("\n")}` : "EQUIPE: ninguém listado (tarefa fica sem dono).");
  return `${linhas.join("\n")}\n`;
}

// ------------------------------------------------------------------ esquema da resposta

const texto = { type: "string" };
const textoOuNulo = { type: ["string", "null"] };

export const ESQUEMA_DO_PLANO = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["resumo", "projeto", "marcos", "tarefas", "atualizar_tarefas"],
  properties: {
    resumo: texto,
    projeto: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["ref", "nome", "tipo", "inicio", "prazo", "objetivos", "escopo", "descricao"],
      properties: { ref: texto, nome: textoOuNulo, tipo: textoOuNulo, inicio: textoOuNulo, prazo: textoOuNulo, objetivos: textoOuNulo, escopo: textoOuNulo, descricao: textoOuNulo },
    },
    marcos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "titulo", "prazo", "descricao"],
        properties: { ref: texto, titulo: texto, prazo: texto, descricao: textoOuNulo },
      },
    },
    tarefas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titulo", "descricao", "marco", "dono", "prazo", "frente", "entrega", "prioridade"],
        properties: {
          titulo: texto,
          descricao: textoOuNulo,
          marco: textoOuNulo,
          dono: textoOuNulo,
          prazo: textoOuNulo,
          frente: { type: "string", enum: [...FRENTES] },
          entrega: { type: "string", enum: [...ENTREGAS] },
          prioridade: { type: "string", enum: [...PRIORIDADES] },
        },
      },
    },
    atualizar_tarefas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "dono", "prazo", "prioridade"],
        properties: { ref: texto, dono: textoOuNulo, prazo: textoOuNulo, prioridade: textoOuNulo },
      },
    },
  },
};

export const ESQUEMA_DO_CONTEXTO_NOVO = {
  type: ["object", "null"],
  additionalProperties: false,
  required: [...CAMPOS_DO_CONTEXTO_DO_PLANO],
  properties: Object.fromEntries(CAMPOS_DO_CONTEXTO_DO_PLANO.map((k) => [k, textoOuNulo])),
};

export const ESQUEMA_DAS_DECISOES = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["area", "categoria", "texto"],
    properties: { area: { type: "string", enum: [...AREAS_DO_CEREBRO] }, categoria: { type: "string", enum: [...CATEGORIAS_DA_DECISAO] }, texto },
  },
};

export const ESQUEMA_DO_CAMINHO = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["resumo", "etapas", "stack", "cuidados"],
  properties: {
    resumo: texto,
    etapas: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["titulo", "porque", "quando"], properties: { titulo: texto, porque: texto, quando: textoOuNulo } },
    },
    stack: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ferramenta", "para_que", "custo", "fonte", "porque"],
        properties: { ferramenta: texto, para_que: texto, custo: textoOuNulo, fonte: textoOuNulo, porque: texto },
      },
    },
    cuidados: { type: "array", items: texto },
  },
};

// ------------------------------------------------------------------ normalização

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** AAAA-MM-DD de verdade (29/02 só em ano bissexto). */
export function dataValida(v: unknown): string | null {
  const s = umaLinha(v, 10);
  const m = DATA.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? s : null;
}

const dataCurta = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const umDe = <T extends string>(lista: readonly T[], v: unknown, padrao: T): T => {
  const s = umaLinha(v, 40).toLowerCase() as T;
  return lista.indexOf(s) >= 0 ? s : padrao;
};
const chaveDeTitulo = (s: string) => umaLinha(s, 200).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Caminho limpo (etapas, stack, cuidados); null quando não sobra nada. */
export function normalizarCaminho(bruto: unknown): CaminhoDoCliente | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const etapas = (Array.isArray(o.etapas) ? o.etapas : [])
    .map((e) => {
      const x = (e ?? {}) as Record<string, unknown>;
      return { titulo: umaLinha(x.titulo, 160), porque: umaLinha(x.porque, 400) || null, quando: umaLinha(x.quando, 60) || null };
    })
    .filter((e) => e.titulo)
    .slice(0, 12);
  const stack = (Array.isArray(o.stack) ? o.stack : [])
    .map((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      const fonte = umaLinha(x.fonte, 300) || null;
      const custoBruto = umaLinha(x.custo, 120);
      // Custo sem fonte não passa como fato: vira "a confirmar".
      const custo = custoBruto ? (fonte ? custoBruto : `${custoBruto} (a confirmar)`.replace(/\s*\(a confirmar\)\s*\(a confirmar\)$/, " (a confirmar)")) : null;
      return { ferramenta: umaLinha(x.ferramenta, 80), para_que: umaLinha(x.para_que, 200) || null, custo, fonte, porque: umaLinha(x.porque, 400) || null };
    })
    .filter((s) => s.ferramenta)
    .slice(0, 15);
  const cuidados = (Array.isArray(o.cuidados) ? o.cuidados : []).map((c) => umaLinha(c, 300)).filter(Boolean).slice(0, 8);
  const resumo = umaLinha(o.resumo, 800) || null;
  if (!etapas.length && !stack.length && !resumo) return null;
  return { resumo, etapas, stack, cuidados };
}

export type RespostaDoPlano = {
  plano?: unknown;
  contexto?: unknown;
  decisoes?: unknown;
  caminho?: unknown;
};

/**
 * Lê o que o modelo devolveu (plano, contexto, decisões, caminho) e monta a
 * proposta com os itens na ordem de execução: projeto, marcos, tarefas,
 * atualizações, contexto, decisões e caminho. Null quando não sobra nada.
 */
export function normalizarPlanoDoCliente(bruto: RespostaDoPlano | null | undefined, d: DadosDoPlano, clientId: string, id?: string): AcaoDoAgente | null {
  if (!bruto || typeof bruto !== "object") return null;
  const a = apelidosDoPlano(d);
  const projetoPorRef = new Map(a.projetos.map((p) => [p.ref, p]));
  const marcoPorRef = new Map(a.marcos.map((m) => [m.ref, m]));
  const tarefaPorRef = new Map(a.tarefas.map((t) => [t.ref, t]));
  const pessoaPorRef = new Map(a.equipe.map((e) => [e.ref, e]));
  const itens: ItemDaAcaoDoAgente[] = [];
  const recusados: RecusaDoItem[] = [];
  const ignorados: string[] = [];
  const dados: Record<string, Record<string, unknown>> = {};
  const hoje = dataValida(d.hoje) || "1970-01-01";
  const add = (item: Omit<ItemDaAcaoDoAgente, "para"> & { para?: string | null }, carga: Record<string, unknown>) => {
    itens.push({ ...item, para: item.para ?? null });
    dados[`${item.operacao}:${item.ref}`] = carga;
  };
  const recusar = (ref: string, titulo: string, operacao: string, motivo: string) => recusados.push({ ref, titulo: umaLinha(titulo, 200) || "sem título", operacao, motivo });

  const plano = (bruto.plano && typeof bruto.plano === "object" ? bruto.plano : null) as Record<string, unknown> | null;
  let resumo = plano ? umaLinha(plano.resumo, 600) : "";

  // Projeto de destino: novo (pn1) ou um existente (p#).
  let projetoAlvo: { novo: true; ref: "pn1" } | { novo: false; projeto: ComApelido<ProjetoDoCliente> } | null = null;
  let prazoDoProjeto: string | null = null;
  if (plano && plano.projeto && typeof plano.projeto === "object") {
    const p = plano.projeto as Record<string, unknown>;
    const ref = umaLinha(p.ref, 12).toLowerCase();
    const inicio = dataValida(p.inicio);
    const prazo = dataValida(p.prazo);
    if (ref === "novo" || ref === "pn1" || !ref) {
      const nome = umaLinha(p.nome, 200);
      const comeco = inicio || hoje;
      if (!nome) ignorados.push("pn1");
      else if (!prazo) recusar("pn1", nome, "criar_projeto", "Sem prazo final válido (AAAA-MM-DD).");
      else if (prazo < comeco) recusar("pn1", nome, "criar_projeto", "O prazo final vem antes do início.");
      else if (a.projetos.some((x) => chaveDeTitulo(x.name) === chaveDeTitulo(nome) && x.status !== "done")) recusar("pn1", nome, "criar_projeto", "Já existe um projeto com este nome: use o que existe.");
      else {
        projetoAlvo = { novo: true, ref: "pn1" };
        prazoDoProjeto = prazo;
        add(
          { ref: "pn1", alvo_id: "novo", titulo: nome, detalhe: `${dataCurta(comeco)} a ${dataCurta(prazo)}`, operacao: "criar_projeto", rotulo: "criar projeto" },
          {
            name: nome,
            project_type: umDe(TIPOS_DE_PROJETO, p.tipo, "marketing_digital"),
            start_date: comeco,
            deadline: prazo,
            objectives: umaLinha(p.objetivos, 4000) || null,
            scope: umaLinha(p.escopo, 4000) || null,
            description: umaLinha(p.descricao, 4000) || null,
          },
        );
      }
    } else {
      const existente = projetoPorRef.get(ref);
      if (!existente) ignorados.push(ref);
      else {
        projetoAlvo = { novo: false, projeto: existente };
        prazoDoProjeto = existente.deadline;
        const campos: Record<string, unknown> = {};
        const mudou: string[] = [];
        const obj = umaLinha(p.objetivos, 4000);
        const esc = umaLinha(p.escopo, 4000);
        const desc = umaLinha(p.descricao, 4000);
        if (obj && obj !== umaLinha(existente.objectives, 4000)) { campos.objectives = obj; mudou.push("objetivos"); }
        if (esc && esc !== umaLinha(existente.scope, 4000)) { campos.scope = esc; mudou.push("escopo"); }
        if (desc) { campos.description = desc; mudou.push("descrição"); }
        if (prazo && prazo !== existente.deadline) {
          if (existente.start_date && prazo < existente.start_date) recusar(ref, existente.name, "atualizar_projeto", "O prazo novo vem antes do início do projeto.");
          else { campos.deadline = prazo; mudou.push(`prazo ${dataCurta(prazo)}`); prazoDoProjeto = prazo; }
        }
        if (mudou.length) add({ ref, alvo_id: existente.id, titulo: umaLinha(existente.name, 200), detalhe: `muda ${mudou.join(", ")}`, operacao: "atualizar_projeto", rotulo: "atualizar projeto" }, { projeto_id: existente.id, campos });
      }
    }
  }
  // Sem projeto no pedido e um só projeto ativo: as tarefas vão para ele.
  if (!projetoAlvo) {
    const ativos = a.projetos.filter((p) => p.status !== "done" && p.status !== "cancelled");
    if (ativos.length === 1) projetoAlvo = { novo: false, projeto: ativos[0] };
  }
  const destino = projetoAlvo ? (projetoAlvo.novo ? { projeto_novo: "pn1" } : { projeto_id: projetoAlvo.projeto.id }) : null;
  const nomeDoDestino = projetoAlvo ? (projetoAlvo.novo ? "projeto novo" : umaLinha(projetoAlvo.projeto.name, 80)) : "";

  // Marcos novos.
  const marcosNovos = new Map<string, { titulo: string; prazo: string }>();
  const marcosBrutos = plano && Array.isArray(plano.marcos) ? plano.marcos : [];
  const usadosMn = new Set<string>();
  let n = 0;
  for (const mb of marcosBrutos.slice(0, MAX_MARCOS_NO_PLANO * 2)) {
    if (marcosNovos.size >= MAX_MARCOS_NO_PLANO) break;
    const m = (mb ?? {}) as Record<string, unknown>;
    const titulo = umaLinha(m.titulo, 200);
    const refPedida = umaLinha(m.ref, 12).toLowerCase();
    if (!titulo) continue;
    n++;
    let ref = /^mn\d+$/.test(refPedida) && !usadosMn.has(refPedida) ? refPedida : `mn${n}`;
    while (usadosMn.has(ref)) ref = `mn${++n}`;
    usadosMn.add(ref);
    const prazo = dataValida(m.prazo);
    if (!destino) { recusar(ref, titulo, "criar_marco", "Diga em qual projeto (ou crie um projeto novo no plano)."); continue; }
    if (!prazo) { recusar(ref, titulo, "criar_marco", "Sem data válida (AAAA-MM-DD)."); continue; }
    if (prazo < hoje) { recusar(ref, titulo, "criar_marco", "A data já passou."); continue; }
    if (!projetoAlvo!.novo && a.marcos.some((x) => x.project_id === (projetoAlvo as { projeto: ProjetoDoCliente }).projeto.id && chaveDeTitulo(x.title) === chaveDeTitulo(titulo))) {
      recusar(ref, titulo, "criar_marco", "Este marco já existe no projeto.");
      continue;
    }
    marcosNovos.set(ref, { titulo, prazo });
    add({ ref, alvo_id: "novo", titulo, detalhe: `${nomeDoDestino} · até ${dataCurta(prazo)}`, operacao: "criar_marco", rotulo: "criar marco" }, {
      ...destino,
      title: titulo,
      description: umaLinha(m.descricao, 2000) || null,
      target_date: prazo,
      ordem: marcosNovos.size,
    });
  }

  // Tarefas novas.
  const titulosExistentes = new Set(a.tarefas.filter((t) => !projetoAlvo || projetoAlvo.novo || t.project_id === projetoAlvo.projeto.id).map((t) => chaveDeTitulo(t.title)));
  const tarefasBrutas = plano && Array.isArray(plano.tarefas) ? plano.tarefas : [];
  let k = 0;
  for (const tb of tarefasBrutas.slice(0, MAX_TAREFAS_NO_PLANO * 2)) {
    if (k >= MAX_TAREFAS_NO_PLANO) break;
    const t = (tb ?? {}) as Record<string, unknown>;
    const titulo = umaLinha(t.titulo, 200);
    if (!titulo) continue;
    k++;
    const ref = `tn${k}`;
    if (!destino) { recusar(ref, titulo, "criar_tarefa", "Diga em qual projeto (ou crie um projeto novo no plano)."); continue; }
    const chave = chaveDeTitulo(titulo);
    if (titulosExistentes.has(chave)) { recusar(ref, titulo, "criar_tarefa", "Já existe uma tarefa com este título."); continue; }
    // Marco: novo (mn#) ou existente (m#) do mesmo projeto.
    const marcoRef = umaLinha(t.marco, 12).toLowerCase();
    let marco: Record<string, unknown> = {};
    let nomeDoMarco = "";
    let prazoDoMarco: string | null = null;
    if (marcoRef) {
      if (marcosNovos.has(marcoRef)) {
        marco = { marco_novo: marcoRef };
        nomeDoMarco = marcosNovos.get(marcoRef)!.titulo;
        prazoDoMarco = marcosNovos.get(marcoRef)!.prazo;
      } else if (marcoPorRef.has(marcoRef) && !projetoAlvo!.novo && marcoPorRef.get(marcoRef)!.project_id === (projetoAlvo as { projeto: ProjetoDoCliente }).projeto.id) {
        const mm = marcoPorRef.get(marcoRef)!;
        marco = { marco_id: mm.id };
        nomeDoMarco = mm.title;
        prazoDoMarco = mm.target_date;
      }
    }
    const prazo = dataValida(t.prazo) || prazoDoMarco || null;
    if (!prazo) { recusar(ref, titulo, "criar_tarefa", "Sem prazo (AAAA-MM-DD)."); continue; }
    if (prazo < hoje) { recusar(ref, titulo, "criar_tarefa", "O prazo já passou."); continue; }
    const donoRef = umaLinha(t.dono, 12).toLowerCase();
    const dono = pessoaPorRef.get(donoRef) || null;
    titulosExistentes.add(chave);
    const partes = [nomeDoMarco ? `marco ${umaLinha(nomeDoMarco, 60)}` : "", dono ? dono.nome : "sem dono", `até ${dataCurta(prazo)}`];
    if (prazoDoProjeto && prazo > prazoDoProjeto) partes.push("depois do prazo do projeto");
    add({ ref, alvo_id: "novo", titulo, detalhe: partes.filter(Boolean).join(" · "), operacao: "criar_tarefa", rotulo: "criar tarefa" }, {
      ...destino,
      ...marco,
      title: titulo,
      description: umaLinha(t.descricao, 4000) || null,
      assigned_to: dono ? dono.id : null,
      due_date: prazo,
      workstream: umDe(FRENTES, t.frente, "general"),
      delivery_type: umDe(ENTREGAS, t.entrega, "unspecified"),
      priority: umDe(PRIORIDADES, t.prioridade, "medium"),
    });
  }

  // Tarefas que já existem: dono, prazo, prioridade.
  const vistas = new Set<string>();
  for (const ub of plano && Array.isArray(plano.atualizar_tarefas) ? plano.atualizar_tarefas.slice(0, 60) : []) {
    const u = (ub ?? {}) as Record<string, unknown>;
    const ref = umaLinha(u.ref, 12).toLowerCase();
    const tarefa = tarefaPorRef.get(ref);
    if (!tarefa || vistas.has(ref)) { if (ref) ignorados.push(ref); continue; }
    vistas.add(ref);
    const campos: Record<string, unknown> = {};
    const mudou: string[] = [];
    const donoRef = umaLinha(u.dono, 12).toLowerCase();
    if (donoRef) {
      const dono = pessoaPorRef.get(donoRef);
      if (!dono) ignorados.push(donoRef);
      else if (dono.id !== tarefa.assigned_to) { campos.assigned_to = dono.id; mudou.push(`dono ${dono.nome}`); }
    }
    const prazo = dataValida(u.prazo);
    if (prazo && prazo !== tarefa.due_date) {
      if (prazo < hoje) { recusar(ref, tarefa.title, "atualizar_tarefa", "O prazo novo já passou."); continue; }
      campos.due_date = prazo;
      mudou.push(`prazo ${dataCurta(prazo)}`);
    }
    const prioridade = umaLinha(u.prioridade, 12).toLowerCase();
    if ((PRIORIDADES as readonly string[]).indexOf(prioridade) >= 0 && prioridade !== tarefa.priority) { campos.priority = prioridade; mudou.push(`prioridade ${prioridade}`); }
    if (!mudou.length) continue;
    add({ ref, alvo_id: tarefa.id, titulo: umaLinha(tarefa.title, 200), detalhe: mudou.join(" · "), operacao: "atualizar_tarefa", rotulo: "atualizar tarefa" }, { tarefa_id: tarefa.id, campos });
  }

  // Lacunas do contexto (nicho, posicionamento, estágio...).
  const ctx = (bruto.contexto && typeof bruto.contexto === "object" ? bruto.contexto : null) as Record<string, unknown> | null;
  if (ctx) {
    CAMPOS_DO_CONTEXTO_DO_PLANO.forEach((campo, i) => {
      const valor = umaLinha(ctx[campo], 1200);
      if (!valor) return;
      const atual = umaLinha(d.contexto[campo], 1200);
      if (atual === valor) return;
      add({ ref: `c${i + 1}`, alvo_id: campo, titulo: ROTULO_DO_CAMPO[campo], detalhe: atual ? "substitui o atual" : "estava vazio", operacao: "preencher_contexto", rotulo: "preencher", para_rotulo: umaLinha(valor, 140) }, { campo, valor });
    });
  }

  // Decisões para o cérebro do cliente.
  const decisoes = Array.isArray(bruto.decisoes) ? bruto.decisoes : [];
  let q = 0;
  for (const dec of decisoes.slice(0, 8)) {
    const x = (dec ?? {}) as Record<string, unknown>;
    const t = umaLinha(x.texto, 600);
    const area = umaLinha(x.area, 20);
    if (!t || (AREAS_DO_CEREBRO as readonly string[]).indexOf(area) < 0) continue;
    q++;
    add({ ref: `d${q}`, alvo_id: "cerebro", titulo: umaLinha(t, 200), detalhe: `área ${area}`, operacao: "gravar_decisao", rotulo: "guardar decisão" }, {
      area,
      categoria: umDe(CATEGORIAS_DA_DECISAO, x.categoria, "aprendizado"),
      texto: t,
    });
  }

  // Caminho e tech stack.
  const caminho = normalizarCaminho(bruto.caminho);
  if (caminho) {
    const partes = [caminho.etapas && caminho.etapas.length ? `${caminho.etapas.length} etapas` : "", caminho.stack && caminho.stack.length ? `${caminho.stack.length} ferramentas` : ""].filter(Boolean);
    add({ ref: "r1", alvo_id: "caminho", titulo: "Caminho e tech stack do cliente", detalhe: d.contexto.caminho ? "substitui o atual (fica no Desfazer)" : "primeiro caminho", operacao: "gravar_caminho", rotulo: "gravar", para_rotulo: partes.join(" e ") || umaLinha(caminho.resumo, 120) }, { caminho });
  }

  if (!itens.length && !recusados.length) return null;
  if (!resumo) resumo = resumoPadrao(itens);
  return {
    tipo: TIPO_DA_ACAO,
    agente: "contexto",
    id: id || `plano-${Date.now().toString(36)}`,
    resumo,
    itens,
    ignorados,
    recusados,
    contexto: { client_id: clientId, tipo: "plano", dados },
  };
}

/** A mensagem pede caminho, stack ou custo? Só então a pesquisa na web liga (custa mais). */
export function pedeCaminho(mensagem: string): boolean {
  return /(caminho|stack|ferrament|custo|pre[çc]o|plataforma|hospedagem|dom[íi]nio|quanto custa)/i.test(String(mensagem || ""));
}
