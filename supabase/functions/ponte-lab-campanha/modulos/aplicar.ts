/**
 * Ponte Laboratório ↔ Campanhas: o banco (ler, gravar, sugestões e a vez de rodar). As regras ficam em
 * regras.ts (puro). Escreve só quando algo muda: o eco dos gatilhos (cada escrita avisa a ponte de novo)
 * termina na passada seguinte, que não acha nada a fazer.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  aplicarSugestaoNoCanvas,
  canvasDoBanco,
  escreverCaminho,
  estavel,
  etapasDoFunil,
  iguais,
  sincDoNo,
  sincronizar,
  type CampanhaDaPonte,
  type CanvasDaPonte,
  type ItemDaPonte,
  type ResumoDaSincronia,
  type SaidasDosNos,
  type SugestaoDaPonte,
} from "./regras.ts";

export class ErroDaPonte extends Error {
  status: number;
  codigo: string;
  extra: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CampanhaLida {
  campanha: CampanhaDaPonte;
  propostaId: string | null;
  itens: ItemDaPonte[];
}

export interface ProjetoLido {
  id: string;
  nome: string;
  client_id: string | null;
  campanha_id: string | null;
  versao: number;
  canvas: CanvasDaPonte;
}

const COLUNAS_DA_CAMPANHA = "id, client_id, nome, objetivo, conceito, periodo_inicio, periodo_fim, identidade, briefing, sincronia, proposta_id";

export async function lerCampanha(db: SupabaseClient, campanhaId: string): Promise<CampanhaLida> {
  const { data, error } = await db.from("mesa_campanhas").select(COLUNAS_DA_CAMPANHA).eq("id", campanhaId).maybeSingle();
  if (error) throw new ErroDaPonte(503, "campanha_indisponivel", "Não foi possível ler a campanha agora.");
  if (!data) throw new ErroDaPonte(404, "campanha_inexistente", "Campanha não encontrada.");
  const c = data as Record<string, unknown>;
  const propostaId = typeof c.proposta_id === "string" ? c.proposta_id : null;
  let itens: ItemDaPonte[] = [];
  if (propostaId) {
    const { data: p, error: e2 } = await db.from("calendario_propostas").select("itens").eq("id", propostaId).maybeSingle();
    if (e2) throw new ErroDaPonte(503, "serie_indisponivel", "Não foi possível ler a série da campanha agora.");
    itens = (Array.isArray(p && (p as Record<string, unknown>).itens) ? ((p as Record<string, unknown>).itens as ItemDaPonte[]) : []).filter((i) => i && typeof i.tema_id === "string");
  }
  return {
    campanha: {
      id: String(c.id),
      client_id: String(c.client_id),
      nome: String(c.nome || ""),
      objetivo: (c.objetivo as string) ?? null,
      conceito: (c.conceito as string) ?? null,
      periodo_inicio: (c.periodo_inicio as string) ?? null,
      periodo_fim: (c.periodo_fim as string) ?? null,
      identidade: obj(c.identidade),
      briefing: obj(c.briefing),
      sincronia: obj(c.sincronia),
    },
    propostaId,
    itens,
  };
}

const COLUNAS_DO_PROJETO = "id, nome, client_id, campanha_id, versao, canvas";

function projetoDe(d: Record<string, unknown>): ProjetoLido {
  return {
    id: String(d.id),
    nome: String(d.nome || ""),
    client_id: (d.client_id as string) ?? null,
    campanha_id: (d.campanha_id as string) ?? null,
    versao: Number(d.versao) || 1,
    canvas: canvasDoBanco(d.canvas),
  };
}

export async function lerProjeto(db: SupabaseClient, projetoId: string): Promise<ProjetoLido> {
  const { data, error } = await db.from("lab_projetos").select(COLUNAS_DO_PROJETO).eq("id", projetoId).maybeSingle();
  if (error) throw new ErroDaPonte(503, "projeto_indisponivel", "Não foi possível ler o projeto do Laboratório agora.");
  if (!data) throw new ErroDaPonte(404, "projeto_inexistente", "Projeto do Laboratório não encontrado.");
  return projetoDe(data as Record<string, unknown>);
}

export async function projetoDaCampanha(db: SupabaseClient, campanhaId: string): Promise<ProjetoLido | null> {
  const { data, error } = await db.from("lab_projetos").select(COLUNAS_DO_PROJETO).eq("campanha_id", campanhaId).eq("status", "ativo").maybeSingle();
  if (error) throw new ErroDaPonte(503, "projeto_indisponivel", "Não foi possível ler o canvas da campanha agora.");
  return data ? projetoDe(data as Record<string, unknown>) : null;
}

/** As últimas saídas prontas de cada nó do projeto. */
export async function lerSaidas(db: SupabaseClient, projetoId: string): Promise<SaidasDosNos> {
  const { data } = await db
    .from("lab_execucoes")
    .select("no_id, saida, entrada, status, created_at")
    .eq("projeto_id", projetoId)
    .eq("status", "pronto")
    .order("created_at", { ascending: false })
    .limit(400);
  const saidas: SaidasDosNos = {};
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const no = String(r.no_id);
    if (saidas[no]) continue;
    saidas[no] = { saida: obj(r.saida), da_ponte: obj(r.entrada).ponte === true };
  }
  return saidas;
}

/** A vez de rodar (uma passada por campanha de cada vez): marca sincronia.rodando_ate e espera a outra acabar. */
async function pegarVez(db: SupabaseClient, campanhaId: string): Promise<boolean> {
  for (let tentativa = 0; tentativa < 16; tentativa++) {
    const agora = new Date().toISOString();
    const { data: atual } = await db.from("mesa_campanhas").select("sincronia").eq("id", campanhaId).maybeSingle();
    const s = obj(atual && (atual as Record<string, unknown>).sincronia);
    const ocupada = typeof s.rodando_ate === "string" && s.rodando_ate > agora;
    if (!ocupada) {
      const ate = new Date(Date.now() + 60_000).toISOString();
      // Troca condicional: só pega se ninguém pegou entre a leitura e agora.
      let q = db.from("mesa_campanhas").update({ sincronia: { ...s, rodando_ate: ate } }).eq("id", campanhaId);
      q = typeof s.rodando_ate === "string" ? q.eq("sincronia->>rodando_ate", s.rodando_ate) : q.is("sincronia->>rodando_ate", null);
      const { data } = await q.select("id");
      if (Array.isArray(data) && data.length) return true;
    }
    await espera(1200);
  }
  return false;
}

async function soltarVez(db: SupabaseClient, campanhaId: string, sincronia: Record<string, unknown>) {
  const s = { ...sincronia };
  delete s.rodando_ate;
  await db.from("mesa_campanhas").update({ sincronia: s }).eq("id", campanhaId);
}

async function gravarCanvas(db: SupabaseClient, projeto: ProjetoLido, canvas: CanvasDaPonte): Promise<boolean> {
  const { data, error } = await db
    .from("lab_projetos")
    .update({ canvas, versao: projeto.versao + 1, updated_at: new Date().toISOString() })
    .eq("id", projeto.id)
    .eq("versao", projeto.versao)
    .select("id");
  if (error) throw new ErroDaPonte(503, "canvas_nao_gravado", "Não foi possível atualizar o canvas agora.");
  return Array.isArray(data) && data.length > 0;
}

/** A fase da linha do tempo como saída do nó Funil (sem custo), só quando mudou. */
async function gravarFunil(db: SupabaseClient, projeto: ProjetoLido, canvas: CanvasDaPonte, campanha: CampanhaDaPonte, saidas: SaidasDosNos): Promise<void> {
  const no = canvas.nos.filter((n) => {
    const s = sincDoNo(n);
    return !!s && s.campanha_id === campanha.id && s.chave === "funil";
  })[0];
  if (!no) return;
  const etapas = etapasDoFunil(campanha);
  if (!etapas.length) return;
  const anterior = saidas[no.id];
  // Saída que a pessoa gerou no nó (com IA) não é trocada pela da ponte.
  if (anterior && !anterior.da_ponte) return;
  const resumo = `Fases da campanha: ${etapas.map((e) => e.nome).join("; ")}.`;
  const saida = { texto: resumo, json: { etapas, upsell: "", downsell: "", metas: [], resumo, blocos_sem_fonte: [] } };
  if (anterior && iguais(obj(anterior.saida).json, saida.json)) return;
  await db.from("lab_execucoes").insert({
    projeto_id: projeto.id,
    no_id: no.id,
    tipo: "funil",
    status: "pronto",
    entrada: { ponte: true, campanha_id: campanha.id },
    saida,
    custo_usd: 0,
    finished_at: new Date().toISOString(),
  });
}

/** Grava as sugestões abertas (sem repetir) e marca como superadas as que não valem mais. */
async function gravarSugestoes(db: SupabaseClient, campanhaId: string, projetoId: string | null, lista: SugestaoDaPonte[]): Promise<void> {
  const { data } = await db.from("ponte_sugestoes").select("id, destino, chave, valor_sugerido").eq("campanha_id", campanhaId).eq("situacao", "aberta");
  const abertas = (data || []) as Array<{ id: string; destino: string; chave: string; valor_sugerido: unknown }>;
  const agora = new Date().toISOString();
  for (const s of lista) {
    const ja = abertas.filter((a) => a.destino === s.destino && a.chave === s.chave)[0];
    if (ja && iguais(ja.valor_sugerido, s.valor_sugerido)) continue;
    if (ja) {
      await db.from("ponte_sugestoes").update({ valor_atual: s.valor_atual ?? null, valor_sugerido: s.valor_sugerido, rotulo: s.rotulo, updated_at: agora }).eq("id", ja.id);
    } else {
      await db.from("ponte_sugestoes").insert({ campanha_id: campanhaId, projeto_id: projetoId, destino: s.destino, chave: s.chave, rotulo: s.rotulo, valor_atual: s.valor_atual ?? null, valor_sugerido: s.valor_sugerido });
    }
  }
  const valem = lista.map((s) => `${s.destino}|${s.chave}`);
  const superadas = abertas.filter((a) => valem.indexOf(`${a.destino}|${a.chave}`) < 0).map((a) => a.id);
  if (superadas.length) await db.from("ponte_sugestoes").update({ situacao: "superada", updated_at: agora }).in("id", superadas);
}

export interface ResultadoDaPassada {
  projeto_id: string;
  resumo: ResumoDaSincronia;
  avisos: string[];
  gravou: { canvas: boolean; campanha: boolean; serie: boolean };
}

/** Uma passada completa da ponte para a campanha (os dois sentidos), com a vez e uma nova tentativa no canvas. */
export async function rodarPonte(db: SupabaseClient, campanhaId: string, lado: "campanha" | "canvas" | "ambos"): Promise<ResultadoDaPassada | null> {
  const projetoInicial = await projetoDaCampanha(db, campanhaId);
  if (!projetoInicial) return null;
  const temVez = await pegarVez(db, campanhaId);
  let sincroniaFinal: Record<string, unknown> | null = null;
  try {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const projeto = tentativa === 0 ? projetoInicial : await lerProjeto(db, projetoInicial.id);
      const lida = await lerCampanha(db, campanhaId);
      const saidas = await lerSaidas(db, projeto.id);
      const r = sincronizar(projeto.canvas, lida.campanha, lida.itens, saidas);
      const gravou = { canvas: false, campanha: false, serie: false };
      if (r.canvasMudou) {
        const ok = await gravarCanvas(db, projeto, r.canvas);
        if (!ok) continue; // a pessoa salvou no meio: relê e refaz uma vez
        gravou.canvas = true;
      }
      if (r.itensMudaram && lida.propostaId) {
        const { error } = await db.from("calendario_propostas").update({ itens: r.itens }).eq("id", lida.propostaId);
        if (error) throw new ErroDaPonte(503, "serie_nao_gravada", "Não foi possível atualizar a série da campanha agora.");
        gravou.serie = true;
      }
      await gravarFunil(db, projeto, r.canvas, r.campanha, saidas);
      await gravarSugestoes(db, campanhaId, projeto.id, r.sugestoes);
      const s = obj(r.campanha.sincronia);
      const algoMudou = gravou.canvas || gravou.serie || r.campanhaMudou;
      const novaSincronia: Record<string, unknown> = {
        ...s,
        projeto_id: projeto.id,
        ...(algoMudou || !s.ultima_em ? { ultima_em: new Date().toISOString(), lado, resumo: r.resumo } : {}),
        avisos: r.avisos.slice(0, 10),
      };
      if (r.campanhaMudou) {
        const { error } = await db
          .from("mesa_campanhas")
          .update({ nome: r.campanha.nome, objetivo: r.campanha.objetivo, briefing: r.campanha.briefing, sincronia: { ...novaSincronia, rodando_ate: obj(lida.campanha.sincronia).rodando_ate } })
          .eq("id", campanhaId);
        if (error) throw new ErroDaPonte(503, "campanha_nao_gravada", "Não foi possível atualizar a campanha agora.");
        gravou.campanha = true;
      }
      sincroniaFinal = novaSincronia;
      return { projeto_id: projeto.id, resumo: r.resumo, avisos: r.avisos, gravou };
    }
    throw new ErroDaPonte(409, "canvas_mudou", "O canvas mudou durante a sincronia. Tente de novo.");
  } finally {
    if (temVez) {
      const { data } = await db.from("mesa_campanhas").select("sincronia").eq("id", campanhaId).maybeSingle();
      const atual = obj(data && (data as Record<string, unknown>).sincronia);
      await soltarVez(db, campanhaId, sincroniaFinal ? { ...atual, ...sincroniaFinal } : atual);
    }
  }
}

/** Garante o canvas da campanha (cria com a campanha projetada) e devolve o projeto. */
export async function garantirProjeto(db: SupabaseClient, campanhaId: string, criadoPor: string | null): Promise<{ projeto: ProjetoLido; criado: boolean }> {
  const existente = await projetoDaCampanha(db, campanhaId);
  if (existente) return { projeto: existente, criado: false };
  const lida = await lerCampanha(db, campanhaId);
  const vazio: CanvasDaPonte = { nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 0.7 } };
  const r = sincronizar(vazio, lida.campanha, lida.itens, {});
  const { data, error } = await db
    .from("lab_projetos")
    .insert({
      nome: `Campanha · ${lida.campanha.nome || "sem nome"}`.slice(0, 200),
      client_id: lida.campanha.client_id,
      campanha_id: campanhaId,
      canvas: r.canvas,
      contexto: `Canvas da campanha "${lida.campanha.nome}". O que muda aqui complementa a campanha, e o que muda na campanha aparece aqui.`,
      created_by: criadoPor,
    })
    .select(COLUNAS_DO_PROJETO)
    .single();
  if (error || !data) {
    // Outro aviso criou ao mesmo tempo (um por campanha): usa o dele.
    const outro = await projetoDaCampanha(db, campanhaId);
    if (outro) return { projeto: outro, criado: false };
    throw new ErroDaPonte(503, "projeto_nao_criado", "Não foi possível criar o canvas da campanha agora.");
  }
  const projeto = projetoDe(data as Record<string, unknown>);
  await db.from("mesa_campanhas").update({ sincronia: { ...obj(lida.campanha.sincronia), projeto_id: projeto.id, chaves: r.chaves, ultima_em: new Date().toISOString(), lado: "campanha", resumo: r.resumo } }).eq("id", campanhaId);
  return { projeto, criado: true };
}

export interface EstadoDaPonte {
  ligada: boolean;
  campanha: { id: string; nome: string; client_id: string } | null;
  projeto: { id: string; nome: string; versao: number } | null;
  sincronia: Record<string, unknown>;
  sugestoes: Array<Record<string, unknown>>;
}

export async function estadoDaPonte(db: SupabaseClient, alvo: { campanhaId?: string | null; projetoId?: string | null }): Promise<EstadoDaPonte> {
  let campanhaId = alvo.campanhaId || null;
  let projeto: ProjetoLido | null = null;
  if (alvo.projetoId) {
    projeto = await lerProjeto(db, alvo.projetoId);
    campanhaId = projeto.campanha_id;
  } else if (campanhaId) {
    projeto = await projetoDaCampanha(db, campanhaId);
  }
  if (!campanhaId) {
    return { ligada: false, campanha: null, projeto: projeto ? { id: projeto.id, nome: projeto.nome, versao: projeto.versao } : null, sincronia: {}, sugestoes: [] };
  }
  const { data: c } = await db.from("mesa_campanhas").select("id, nome, client_id, sincronia").eq("id", campanhaId).maybeSingle();
  const { data: sug } = await db
    .from("ponte_sugestoes")
    .select("id, campanha_id, projeto_id, destino, chave, rotulo, valor_atual, valor_sugerido, situacao, created_at")
    .eq("campanha_id", campanhaId)
    .eq("situacao", "aberta")
    .order("created_at", { ascending: false })
    .limit(50);
  const cc = obj(c);
  const sincronia = obj(cc.sincronia);
  delete sincronia.rodando_ate;
  delete sincronia.chaves;
  delete sincronia.removidas;
  return {
    ligada: !!projeto,
    campanha: c ? { id: String(cc.id), nome: String(cc.nome || ""), client_id: String(cc.client_id) } : null,
    projeto: projeto ? { id: projeto.id, nome: projeto.nome, versao: projeto.versao } : null,
    sincronia,
    sugestoes: (sug || []) as Array<Record<string, unknown>>,
  };
}

/** Aceita (aplica no destino) ou recusa uma sugestão. */
export async function decidirSugestao(db: SupabaseClient, id: string, aceitar: boolean, userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db.from("ponte_sugestoes").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new ErroDaPonte(404, "sugestao_inexistente", "Esta sugestão não existe mais.");
  const s = data as Record<string, unknown>;
  if (s.situacao !== "aberta") throw new ErroDaPonte(409, "sugestao_decidida", "Esta sugestão já foi decidida.");
  const campanhaId = String(s.campanha_id);
  if (aceitar) {
    if (s.destino === "campanha") {
      const lida = await lerCampanha(db, campanhaId);
      const caminho = String(s.chave).replace(/^campanha:/, "");
      const r = escreverCaminho(lida.campanha, lida.itens, caminho, s.valor_sugerido);
      if (!r.ok) throw new ErroDaPonte(409, "peca_protegida", "Esta peça está na agenda ou aprovada; mude pela própria peça.");
      if (caminho.indexOf("itens.") === 0) {
        if (lida.propostaId) await db.from("calendario_propostas").update({ itens: r.itens }).eq("id", lida.propostaId);
      } else {
        await db.from("mesa_campanhas").update({ nome: r.campanha.nome, objetivo: r.campanha.objetivo, briefing: r.campanha.briefing }).eq("id", campanhaId);
      }
    } else {
      const projeto = await projetoDaCampanha(db, campanhaId);
      if (!projeto) throw new ErroDaPonte(409, "sem_canvas", "A campanha não tem mais canvas ligado.");
      const r = aplicarSugestaoNoCanvas(projeto.canvas, campanhaId, String(s.chave), s.valor_sugerido);
      if (!r.ok) throw new ErroDaPonte(409, "no_inexistente", "O nó desta sugestão saiu do canvas.");
      if (!(await gravarCanvas(db, projeto, r.canvas))) throw new ErroDaPonte(409, "canvas_mudou", "O canvas mudou agora. Tente de novo.");
    }
  }
  const { data: feita } = await db
    .from("ponte_sugestoes")
    .update({ situacao: aceitar ? "aceita" : "recusada", decidida_por: userId, decidida_em: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  return obj(feita);
}

/** Para os testes e para a tela: o canvas mudou de verdade? */
export const canvasDiferente = (a: CanvasDaPonte, b: CanvasDaPonte) => estavel(a) !== estavel(b);
