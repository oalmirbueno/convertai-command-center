/**
 * Agente DIRETOR de vídeo (frente V-A, 26/09/2026).
 *
 * Fluxo: Briefing -> Pesquisa (busca na web do motor, fontes guardadas) ->
 * BÍBLIA (personagens com folha, cenários com quadro âncora, paleta, lente,
 * luz, clima, regras de continuidade) -> ROTEIRO (planos com duração, ângulo,
 * movimento, motor, prompt final, quadros e custo) -> Gerar (a equipe clica,
 * ou o diretor propõe e a equipe confirma o custo) -> Avaliar (Jev) ->
 * Mandar ao editor (projeto de edição inicial).
 *
 * Modelo: GPT-6 Luna com raciocínio "max" (openrouter:openai/gpt-6-luna), pelo
 * motor _shared/ia-motor.ts e a carteira do cliente. O modelo só PROPÕE em
 * JSON; aqui o código normaliza, confere continuidade e monta as ações do
 * contrato comum (apelidos p1.., Confirmar/Cancelar, Desfazer quando há).
 *
 * "Sem alucinar": fato só entra com fonte da pesquisa (f1, f2...) ou do
 * contexto do cliente ("cliente"). Fato sem fonte vira pergunta. Lacuna sem
 * valor vira pergunta. Número de custo e duração é conta do código.
 *
 * Puro: sem Deno, sem banco. A função, a tela e os testes usam o mesmo.
 */

import { type AcaoDoAgente, type Alvo, comApelido, normalizarAcaoDoAgente, type RegraDaOperacao } from "./acoes-do-agente.ts";
import { type CenaDoKit, type KitDeVideo, kitPorId, lacunasDoTexto, preencherPrompt, REGRAS_GERAIS_DE_CONSISTENCIA } from "./video-kits.ts";
import { custoDoMotor, duracaoNoMotor, type MotorDeVideo, motorDoPapel, MOTORES_DE_VIDEO, motorPorId } from "./modelos-de-video.ts";
import { clipeNovo, projetoDosTakes, type ProjetoDeEdicao, type TakeParaProjeto } from "./projeto-de-edicao.ts";

export const MODELO_DO_DIRETOR = "openrouter:openai/gpt-6-luna";
export const RACIOCINIO_DO_DIRETOR = "max";
export const AGENTE_DO_DIRETOR = "diretor_de_video";
export const FASES_DO_DIRETOR = ["briefing", "pesquisa", "biblia", "roteiro", "livre"] as const;
export type FaseDoDiretor = (typeof FASES_DO_DIRETOR)[number];

export const MAX_PLANOS = 24;
export const MAX_PERSONAGENS = 8;
export const MAX_CENARIOS = 8;
export const MAX_FONTES = 20;
export const MAX_FATOS = 40;
export const MAX_PERGUNTAS = 8;

// ------------------------------------------------------------------ tipos

export interface FonteDaPesquisa {
  id: string;
  titulo: string;
  url: string;
}

export interface FatoDaPesquisa {
  texto: string;
  /** "f1".. (fonte da pesquisa) ou "cliente" (contexto do cliente). */
  fonte: string;
}

export interface PersonagemDaBiblia {
  id: string;
  nome: string;
  /** Aparência fixa, copiada igual em todos os prompts. */
  aparencia: string;
  roupa: string;
  /** Imagem da folha de referência (Storage do cliente, bucket mesa). */
  folha_path: string | null;
  pessoa_real: boolean;
  /** Autorização de imagem registrada (pessoa real). */
  autorizado: boolean;
}

export interface CenarioDaBiblia {
  id: string;
  nome: string;
  descricao: string;
  /** Quadro âncora (Storage do cliente). */
  ancora_path: string | null;
  hora: string;
}

export interface EstiloDaBiblia {
  paleta: string[];
  lente: string;
  luz: string;
  clima: string;
  textura: string;
}

export interface Biblia {
  titulo: string;
  objetivo: string;
  publico: string;
  formato: string;
  estilo: EstiloDaBiblia;
  personagens: PersonagemDaBiblia[];
  cenarios: CenarioDaBiblia[];
  regras: string[];
  fatos: FatoDaPesquisa[];
  fontes: FonteDaPesquisa[];
  perguntas: string[];
}

export type ModoDoPlano = "texto" | "primeiro_quadro" | "primeiro_ultimo" | "referencia" | "estender" | "imagem";

/** De onde vem um quadro de entrada do plano. */
export interface QuadroDoPlano {
  tipo: "arquivo" | "anterior" | "ancora" | "folha";
  /** arquivo: storage_path; ancora/folha: id do cenário/personagem; anterior: vazio. */
  ref: string | null;
}

export interface PlanoDoRoteiro {
  ref: string;
  ordem: number;
  titulo: string;
  cena_do_kit: string | null;
  duracao_s: number;
  personagens: string[];
  cenario: string | null;
  enquadramento: string;
  angulo: string;
  movimento: string;
  acao: string;
  fala: string | null;
  texto_na_tela: string | null;
  motor: string;
  modo: ModoDoPlano;
  prompt: string;
  quadro_inicial: QuadroDoPlano | null;
  quadro_final: QuadroDoPlano | null;
  /** Conta do código (motor x duração x resolução), nunca do modelo. */
  custo_usd: number | null;
  /** Arquivo escolhido para a montagem (video_arquivos.id). */
  escolhido: string | null;
  pedidos: string[];
}

export interface RoteiroDoDiretor {
  planos: PlanoDoRoteiro[];
  notas: string;
}

export interface ProjetoDoDiretor {
  id: string | null;
  titulo: string;
  kit_id: string | null;
  template_id: string | null;
  fase: FaseDoDiretor;
  briefing: { texto: string; valores: Record<string, string> };
  biblia: Biblia;
  roteiro: RoteiroDoDiretor;
  versao: number;
  atualizado_em: string | null;
}

// ------------------------------------------------------------------ utilidades

const linha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const semTravessao = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, ", ");
const idCurto = (v: unknown, prefixo: string, i: number) => {
  const s = linha(v, 12).toLowerCase().replace(/[^a-z0-9]/g, "");
  return s || `${prefixo}${i + 1}`;
};

export function bibliaVazia(): Biblia {
  return {
    titulo: "",
    objetivo: "",
    publico: "",
    formato: "9:16",
    estilo: { paleta: [], lente: "", luz: "", clima: "", textura: "" },
    personagens: [],
    cenarios: [],
    regras: REGRAS_GERAIS_DE_CONSISTENCIA.slice(),
    fatos: [],
    fontes: [],
    perguntas: [],
  };
}

export function projetoVazio(titulo = "Vídeo"): ProjetoDoDiretor {
  return {
    id: null,
    titulo,
    kit_id: null,
    template_id: null,
    fase: "briefing",
    briefing: { texto: "", valores: {} },
    biblia: bibliaVazia(),
    roteiro: { planos: [], notas: "" },
    versao: 0,
    atualizado_em: null,
  };
}

// ------------------------------------------------------------------ bíblia

/**
 * Normaliza a bíblia. Fontes: só http(s). Fato sem fonte conhecida (nem f#
 * da lista nem "cliente") sai dos fatos e vira pergunta: o diretor não afirma
 * o que não pesquisou.
 */
export function normalizarBiblia(bruto: unknown): { biblia: Biblia; avisos: string[] } {
  const o = obj(bruto);
  const avisos: string[] = [];
  const fontes: FonteDaPesquisa[] = [];
  lista(o.fontes).slice(0, MAX_FONTES * 2).forEach((f, i) => {
    const x = obj(f);
    const url = linha(x.url, 500);
    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) return;
    if (fontes.some((y) => y.url === url)) return;
    let id = idCurto(x.id, "f", i);
    if (fontes.some((y) => y.id === id)) id = `f${fontes.length + 1}`;
    fontes.push({ id, titulo: semTravessao(linha(x.titulo, 160)) || url, url });
  });
  const idsDasFontes = fontes.slice(0, MAX_FONTES).map((f) => f.id);
  const perguntas: string[] = lista(o.perguntas).map((p) => semTravessao(linha(p, 240))).filter(Boolean);
  const fatos: FatoDaPesquisa[] = [];
  lista(o.fatos).forEach((f) => {
    const x = obj(f);
    const texto = semTravessao(linha(x.texto, 300));
    const fonte = linha(x.fonte, 12).toLowerCase();
    if (!texto) return;
    if (fonte === "cliente" || idsDasFontes.indexOf(fonte) >= 0) {
      if (fatos.length < MAX_FATOS) fatos.push({ texto, fonte });
    } else {
      avisos.push(`Fato sem fonte virou pergunta: ${texto}`);
      perguntas.push(`Confirma? ${texto}`);
    }
  });
  const personagens: PersonagemDaBiblia[] = [];
  lista(o.personagens).slice(0, MAX_PERSONAGENS).forEach((p, i) => {
    const x = obj(p);
    const nome = semTravessao(linha(x.nome, 80));
    if (!nome) return;
    let id = idCurto(x.id, "pe", i);
    if (personagens.some((y) => y.id === id)) id = `pe${i + 1}`;
    personagens.push({
      id,
      nome,
      aparencia: semTravessao(linha(x.aparencia, 400)),
      roupa: semTravessao(linha(x.roupa, 240)),
      folha_path: linha(x.folha_path, 400) || null,
      pessoa_real: x.pessoa_real === true,
      autorizado: x.autorizado === true,
    });
  });
  const cenarios: CenarioDaBiblia[] = [];
  lista(o.cenarios).slice(0, MAX_CENARIOS).forEach((c, i) => {
    const x = obj(c);
    const nome = semTravessao(linha(x.nome, 80));
    if (!nome) return;
    let id = idCurto(x.id, "ce", i);
    if (cenarios.some((y) => y.id === id)) id = `ce${i + 1}`;
    cenarios.push({ id, nome, descricao: semTravessao(linha(x.descricao, 400)), ancora_path: linha(x.ancora_path, 400) || null, hora: semTravessao(linha(x.hora, 80)) });
  });
  const e = obj(o.estilo);
  const regras = lista(o.regras).map((r) => semTravessao(linha(r, 240))).filter(Boolean).slice(0, 20);
  return {
    biblia: {
      titulo: semTravessao(linha(o.titulo, 120)),
      objetivo: semTravessao(linha(o.objetivo, 300)),
      publico: semTravessao(linha(o.publico, 200)),
      formato: ["9:16", "1:1", "4:5", "16:9"].indexOf(String(o.formato)) >= 0 ? String(o.formato) : "9:16",
      estilo: {
        paleta: lista(e.paleta).map((c) => linha(c, 40)).filter(Boolean).slice(0, 8),
        lente: semTravessao(linha(e.lente, 80)),
        luz: semTravessao(linha(e.luz, 160)),
        clima: semTravessao(linha(e.clima, 120)),
        textura: semTravessao(linha(e.textura, 120)),
      },
      personagens,
      cenarios,
      regras: regras.length ? regras : REGRAS_GERAIS_DE_CONSISTENCIA.slice(),
      fatos,
      fontes: fontes.slice(0, MAX_FONTES),
      perguntas: perguntas.filter((p, i) => perguntas.indexOf(p) === i).slice(0, MAX_PERGUNTAS),
    },
    avisos,
  };
}

// ------------------------------------------------------------------ roteiro

const MODOS: ModoDoPlano[] = ["texto", "primeiro_quadro", "primeiro_ultimo", "referencia", "estender", "imagem"];

function quadro(v: unknown): QuadroDoPlano | null {
  const x = obj(v);
  const tipo = String(x.tipo || "");
  if (tipo !== "arquivo" && tipo !== "anterior" && tipo !== "ancora" && tipo !== "folha") return null;
  return { tipo, ref: tipo === "anterior" ? null : linha(x.ref, 400) || null };
}

/** O motor faz o que o plano pede? null quando sim; senão o motivo. */
export function motorServeAoModo(m: MotorDeVideo | null, modo: ModoDoPlano): string | null {
  if (!m) return "Motor desconhecido.";
  if (modo === "imagem") return m.familia === "imagem" || m.familia === "angulo" ? null : `${m.rotulo} gera vídeo, não imagem.`;
  if (m.familia === "imagem" || m.familia === "angulo") return `${m.rotulo} gera imagem, não vídeo.`;
  if (modo === "texto" && !m.cap.texto) return `${m.rotulo} precisa de quadro inicial.`;
  if (modo === "primeiro_quadro" && !m.cap.primeiro_quadro) return `${m.rotulo} não parte de imagem.`;
  if (modo === "primeiro_ultimo" && !m.cap.ultimo_quadro) return `${m.rotulo} não aceita último quadro.`;
  if (modo === "referencia" && m.cap.referencias < 1 && !m.cap.primeiro_quadro) return `${m.rotulo} não aceita referência.`;
  if (modo === "estender" && !m.cap.estender) return `${m.rotulo} não estende vídeo.`;
  return null;
}

/**
 * Normaliza o roteiro: refs p1..pN na ordem, personagem e cenário só da
 * bíblia, motor do catálogo (desconhecido: o do papel "barato"), duração presa
 * ao que o motor aceita e custo calculado aqui.
 */
export function normalizarRoteiro(bruto: unknown, biblia: Biblia, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): { roteiro: RoteiroDoDiretor; avisos: string[] } {
  const o = obj(bruto);
  const avisos: string[] = [];
  const idsP = biblia.personagens.map((p) => p.id);
  const idsC = biblia.cenarios.map((c) => c.id);
  const planos: PlanoDoRoteiro[] = [];
  lista(o.planos)
    .slice(0, MAX_PLANOS)
    .forEach((p, i) => {
      const x = obj(p);
      const ref = `p${planos.length + 1}`;
      const modo = MODOS.indexOf(x.modo as ModoDoPlano) >= 0 ? (x.modo as ModoDoPlano) : "primeiro_quadro";
      let motor = motorPorId(linha(x.motor, 60), motores);
      const falha = motorServeAoModo(motor, modo);
      if (!motor || falha) {
        const trocado = motorDoPapel(modo === "imagem" ? "imagem" : modo === "primeiro_ultimo" ? "transicao" : modo === "referencia" ? "consistencia" : "barato", motores, modo);
        avisos.push(`${ref}: ${falha || "motor desconhecido"} Usei ${trocado ? trocado.rotulo : "nenhum"}.`);
        motor = trocado;
      }
      const personagens = lista(x.personagens).map((v) => linha(v, 12).toLowerCase()).filter((v, k, a) => a.indexOf(v) === k);
      personagens.filter((v) => idsP.indexOf(v) < 0).forEach((v) => avisos.push(`${ref}: personagem ${v} não está na bíblia (tirei).`));
      const cen = linha(x.cenario, 12).toLowerCase();
      if (cen && idsC.indexOf(cen) < 0) avisos.push(`${ref}: cenário ${cen} não está na bíblia (tirei).`);
      const dPedida = Number(x.duracao_s);
      const duracao = modo === "imagem" || !motor ? 0 : duracaoNoMotor(motor, isFinite(dPedida) && dPedida > 0 ? dPedida : 5);
      const prompt = semTravessao(String(x.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 1800));
      const plano: PlanoDoRoteiro = {
        ref,
        ordem: planos.length + 1,
        titulo: semTravessao(linha(x.titulo, 100)) || `Plano ${i + 1}`,
        cena_do_kit: linha(x.cena_do_kit, 12) || null,
        duracao_s: duracao,
        personagens: personagens.filter((v) => idsP.indexOf(v) >= 0),
        cenario: cen && idsC.indexOf(cen) >= 0 ? cen : null,
        enquadramento: semTravessao(linha(x.enquadramento, 80)),
        angulo: semTravessao(linha(x.angulo, 80)),
        movimento: semTravessao(linha(x.movimento, 80)),
        acao: semTravessao(linha(x.acao, 300)),
        fala: semTravessao(linha(x.fala, 200)) || null,
        texto_na_tela: semTravessao(linha(x.texto_na_tela, 80)) || null,
        motor: motor ? motor.id : "",
        modo,
        prompt,
        quadro_inicial: quadro(x.quadro_inicial),
        quadro_final: quadro(x.quadro_final),
        custo_usd: null,
        escolhido: linha(x.escolhido, 40) || null,
        pedidos: lista(x.pedidos).map((v) => linha(v, 40)).filter(Boolean).slice(0, 20),
      };
      plano.custo_usd = custoDoPlano(plano, motores);
      planos.push(plano);
    });
  return { roteiro: { planos, notas: semTravessao(linha(o.notas, 1200)) }, avisos };
}

export function custoDoPlano(p: Pick<PlanoDoRoteiro, "motor" | "duracao_s" | "fala" | "modo">, motores: MotorDeVideo[] = MOTORES_DE_VIDEO, variacoes = 1): number | null {
  const m = motorPorId(p.motor, motores);
  if (!m) return null;
  return custoDoMotor(m, { duracao_s: p.duracao_s, audio: !!p.fala && m.cap.audio, variacoes }).usd;
}

/** Soma do roteiro (null nas partes sem cotação: o total diz "incompleto"). */
export function custoDoRoteiro(r: RoteiroDoDiretor, motores: MotorDeVideo[] = MOTORES_DE_VIDEO, variacoes = 1): { usd: number; incompleto: boolean; segundos: number } {
  let usd = 0;
  let incompleto = false;
  let segundos = 0;
  r.planos.forEach((p) => {
    const c = custoDoPlano(p, motores, variacoes);
    if (c === null) incompleto = true;
    else usd += c;
    segundos += p.duracao_s;
  });
  return { usd: Math.round(usd * 10000) / 10000, incompleto, segundos };
}

// ------------------------------------------------------------------ continuidade (conta do código)

export interface AvisoDeContinuidade {
  ref: string | null;
  nivel: "erro" | "aviso";
  texto: string;
}

/**
 * Conferência determinística: o que se sabe sem olhar a imagem. O que precisa
 * olhar (é o mesmo rosto?) vai para o Jev depois de gerar.
 */
export function conferirContinuidade(b: Biblia, r: RoteiroDoDiretor, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): AvisoDeContinuidade[] {
  const s: AvisoDeContinuidade[] = [];
  const porPersonagem: Record<string, number> = {};
  r.planos.forEach((p, i) => {
    const m = motorPorId(p.motor, motores);
    const falha = motorServeAoModo(m, p.modo);
    if (falha) s.push({ ref: p.ref, nivel: "erro", texto: falha });
    if (!p.prompt) s.push({ ref: p.ref, nivel: "erro", texto: "Sem prompt." });
    if (lacunasDoTexto(p.prompt).length) s.push({ ref: p.ref, nivel: "erro", texto: `Lacuna sem valor: ${lacunasDoTexto(p.prompt).join(", ")}.` });
    if ((p.modo === "primeiro_quadro" || p.modo === "primeiro_ultimo") && !p.quadro_inicial) s.push({ ref: p.ref, nivel: "erro", texto: "Falta o quadro inicial." });
    if (p.modo === "primeiro_ultimo" && !p.quadro_final) s.push({ ref: p.ref, nivel: "erro", texto: "Falta o último quadro." });
    if (p.quadro_inicial && p.quadro_inicial.tipo === "anterior" && i === 0) s.push({ ref: p.ref, nivel: "erro", texto: "O primeiro plano não tem plano anterior." });
    if (p.quadro_inicial && p.quadro_inicial.tipo === "ancora") {
      const c = b.cenarios.find((x) => x.id === p.quadro_inicial!.ref);
      if (!c || !c.ancora_path) s.push({ ref: p.ref, nivel: "erro", texto: `Cenário ${c ? c.nome : p.quadro_inicial.ref || ""} sem quadro âncora.` });
    }
    if (p.quadro_inicial && p.quadro_inicial.tipo === "folha") {
      const pe = b.personagens.find((x) => x.id === p.quadro_inicial!.ref);
      if (!pe || !pe.folha_path) s.push({ ref: p.ref, nivel: "erro", texto: `Personagem ${pe ? pe.nome : p.quadro_inicial.ref || ""} sem folha de referência.` });
    }
    if (p.fala && m && !m.cap.audio) s.push({ ref: p.ref, nivel: "aviso", texto: `${m.rotulo} não gera áudio: a fala entra na edição.` });
    if (p.fala && p.fala.split(" ").length > Math.max(8, Math.round(p.duracao_s * 2.5))) s.push({ ref: p.ref, nivel: "aviso", texto: "Fala longa para a duração do plano." });
    if (p.duracao_s > 10) s.push({ ref: p.ref, nivel: "aviso", texto: "Plano longo: rosto e mãos derretem com mais facilidade." });
    p.personagens.forEach((id) => {
      porPersonagem[id] = (porPersonagem[id] || 0) + 1;
      const pe = b.personagens.find((x) => x.id === id);
      if (pe && pe.pessoa_real && !pe.autorizado) s.push({ ref: p.ref, nivel: "erro", texto: `${pe.nome} é pessoa real sem autorização registrada.` });
      if (pe && pe.pessoa_real && m && !m.cap.pessoa_real) s.push({ ref: p.ref, nivel: "erro", texto: `${m.rotulo} não aceita rosto de pessoa real.` });
      if (pe && pe.aparencia && p.prompt && p.prompt.toLowerCase().indexOf(pe.aparencia.toLowerCase().slice(0, 24)) < 0 && p.modo !== "referencia") {
        s.push({ ref: p.ref, nivel: "aviso", texto: `O prompt não repete a aparência de ${pe.nome} como está na bíblia.` });
      }
    });
    if (p.modo !== "imagem" && !p.cenario && b.cenarios.length) s.push({ ref: p.ref, nivel: "aviso", texto: "Plano sem cenário da bíblia." });
  });
  Object.keys(porPersonagem).forEach((id) => {
    const pe = b.personagens.find((x) => x.id === id);
    if (pe && porPersonagem[id] > 1 && !pe.folha_path) s.push({ ref: null, nivel: "aviso", texto: `${pe.nome} aparece em ${porPersonagem[id]} planos e ainda não tem folha de referência.` });
  });
  if (b.estilo && !b.estilo.lente) s.push({ ref: null, nivel: "aviso", texto: "A bíblia não fixou a lente." });
  if (b.estilo && !b.estilo.luz) s.push({ ref: null, nivel: "aviso", texto: "A bíblia não fixou a luz." });
  return s;
}

export const temErroDeContinuidade = (a: AvisoDeContinuidade[], ref?: string) => a.some((x) => x.nivel === "erro" && (!ref || x.ref === ref || x.ref === null));

// ------------------------------------------------------------------ do kit para o projeto

/** Primeiro rascunho do projeto a partir do kit e dos valores (sem IA). Lacuna vazia vira pergunta. */
export function projetoDoKit(kit: KitDeVideo, valores: Record<string, string>, formato: string, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): { projeto: ProjetoDoDiretor; faltando: string[] } {
  const p = projetoVazio(kit.nome);
  p.kit_id = kit.id;
  p.fase = "biblia";
  p.briefing = { texto: kit.objetivo, valores: { ...valores } };
  p.biblia.objetivo = kit.objetivo;
  p.biblia.formato = kit.formatos.indexOf(formato as never) >= 0 ? formato : kit.formatos[0];
  p.biblia.regras = REGRAS_GERAIS_DE_CONSISTENCIA.concat(kit.consistencia);
  const faltando: string[] = [];
  const planos = kit.cenas.map((c: CenaDoKit, i) => {
    const f = preencherPrompt(c.prompt, valores, kit.lacunas);
    f.faltando.forEach((x) => faltando.indexOf(x) < 0 && faltando.push(x));
    const m = motorDoPapel(c.papel, motores, c.modo);
    const q = (tipo: string | undefined): QuadroDoPlano | null =>
      !tipo ? null : tipo === "anterior" ? { tipo: "anterior", ref: null } : tipo === "ancora" ? { tipo: "ancora", ref: null } : tipo === "folha" ? { tipo: "folha", ref: null } : { tipo: "arquivo", ref: null };
    return {
      ref: `p${i + 1}`,
      titulo: c.nome,
      cena_do_kit: c.ref,
      duracao_s: c.duracao_s,
      personagens: [],
      cenario: null,
      enquadramento: c.enquadramento,
      angulo: "",
      movimento: c.camera,
      acao: c.objetivo,
      fala: null,
      texto_na_tela: c.texto_na_tela || null,
      motor: m ? m.id : "",
      modo: c.modo,
      prompt: f.texto,
      quadro_inicial: q(c.quadro_inicial),
      quadro_final: q(c.quadro_final),
    };
  });
  p.roteiro = normalizarRoteiro({ planos, notas: "" }, p.biblia, motores).roteiro;
  const nomes = faltando.map((k) => {
    const l = kit.lacunas.find((x) => x.chave === k);
    return l ? l.rotulo : k;
  });
  p.biblia.perguntas = nomes.map((n) => `Qual é ${n.toLowerCase()}?`);
  return { projeto: p, faltando };
}

// ------------------------------------------------------------------ conversa com o modelo

/** O que o diretor pode pedir em `acao` (a equipe confirma o que custa; o editor tem Desfazer). */
export const TIPOS_DA_ACAO_DO_DIRETOR = ["gerar", "refazer", "mandar_ao_editor"] as const;
export type TipoDaAcaoDoDiretor = (typeof TIPOS_DA_ACAO_DO_DIRETOR)[number];

/** Esquema JSON da resposta do diretor (o motor pede saída estruturada). */
export function esquemaDoDiretor() {
  const texto = { type: "string" };
  const listaDeTexto = { type: "array", items: texto };
  const quadroS = { type: ["object", "null"], additionalProperties: false, required: ["tipo", "ref"], properties: { tipo: { type: "string", enum: ["arquivo", "anterior", "ancora", "folha"] }, ref: { type: ["string", "null"] } } };
  return {
    nome: "diretor_de_video",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["resposta", "perguntas", "fontes", "fatos", "biblia", "roteiro", "acao"],
      properties: {
        resposta: texto,
        perguntas: listaDeTexto,
        fontes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "titulo", "url"], properties: { id: texto, titulo: texto, url: texto } } },
        fatos: { type: "array", items: { type: "object", additionalProperties: false, required: ["texto", "fonte"], properties: { texto, fonte: texto } } },
        biblia: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["titulo", "objetivo", "publico", "formato", "estilo", "personagens", "cenarios", "regras"],
          properties: {
            titulo: texto,
            objetivo: texto,
            publico: texto,
            formato: { type: "string", enum: ["9:16", "1:1", "4:5", "16:9"] },
            estilo: { type: "object", additionalProperties: false, required: ["paleta", "lente", "luz", "clima", "textura"], properties: { paleta: listaDeTexto, lente: texto, luz: texto, clima: texto, textura: texto } },
            personagens: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "nome", "aparencia", "roupa"], properties: { id: texto, nome: texto, aparencia: texto, roupa: texto } } },
            cenarios: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "nome", "descricao", "hora"], properties: { id: texto, nome: texto, descricao: texto, hora: texto } } },
            regras: listaDeTexto,
          },
        },
        roteiro: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["planos", "notas"],
          properties: {
            notas: texto,
            planos: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["titulo", "cena_do_kit", "duracao_s", "personagens", "cenario", "enquadramento", "angulo", "movimento", "acao", "fala", "texto_na_tela", "motor", "modo", "prompt", "quadro_inicial", "quadro_final"],
                properties: {
                  titulo: texto,
                  cena_do_kit: { type: ["string", "null"] },
                  duracao_s: { type: "number" },
                  personagens: listaDeTexto,
                  cenario: { type: ["string", "null"] },
                  enquadramento: texto,
                  angulo: texto,
                  movimento: texto,
                  acao: texto,
                  fala: { type: ["string", "null"] },
                  texto_na_tela: { type: ["string", "null"] },
                  motor: texto,
                  modo: { type: "string", enum: MODOS },
                  prompt: texto,
                  quadro_inicial: quadroS,
                  quadro_final: quadroS,
                },
              },
            },
          },
        },
        acao: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["tipo", "planos", "variacoes"],
          // AG2 (29/09): "refazer" (mesmo plano com composição nova; o roteiro volta com o plano mudado) e variações.
          properties: { tipo: { type: "string", enum: TIPOS_DA_ACAO_DO_DIRETOR }, planos: listaDeTexto, variacoes: { type: ["integer", "null"] } },
        },
      },
    },
  };
}

function motoresParaOPrompt(motores: MotorDeVideo[]): string {
  return motores
    .filter((m) => m.familia === "video" && !m.situacao)
    .map((m) => {
      const c = m.cap;
      const cap = [c.texto && "texto", c.primeiro_quadro && "primeiro quadro", c.ultimo_quadro && "último quadro", c.referencias ? `${c.referencias} referências` : "", c.estender && "estende", c.audio && "áudio"].filter(Boolean).join(", ");
      const d = Array.isArray(m.duracoes) ? m.duracoes.join("/") : `${m.duracoes.min}-${m.duracoes.max}`;
      return `- ${m.id}: ${m.rotulo}; ${d} s; ${cap}; papéis ${m.papeis.join("/")}`;
    })
    .join("\n");
}

/** Instruções do sistema (o que o diretor pode e não pode). */
export function sistemaDoDiretor(e: { fase: FaseDoDiretor; kit: KitDeVideo | null; contexto: string; motores?: MotorDeVideo[] }): string {
  const motores = e.motores || MOTORES_DE_VIDEO;
  const kit = e.kit
    ? `\nKIT: ${e.kit.nome}. Objetivo: ${e.kit.objetivo}\nCenas do kit (ref | nome | duração | modo | papel):\n${e.kit.cenas.map((c) => `${c.ref} | ${c.nome} | ${c.duracao_s} s | ${c.modo} | ${c.papel}`).join("\n")}\nConsistência: ${e.kit.consistencia.join(" ")}\nEvitar: ${e.kit.evitar.join(" ")}`
    : "";
  const tarefa: Record<FaseDoDiretor, string> = {
    briefing: "Entenda o pedido. Liste em `perguntas` só o que falta para montar a bíblia (no máximo 5). Não invente o que não foi dito.",
    pesquisa: "Pesquise na web o que o pedido exige (região, locação, época, costumes, arquitetura, vegetação, clima). Cada fato vai em `fatos` com a fonte (id f1.. em `fontes`, com a URL real que você abriu). Sem fonte, não afirme: pergunte.",
    biblia: "Monte ou ajuste a BÍBLIA: personagens (aparência e roupa fixas, escritas para copiar igual nos prompts), cenários (descrição e hora), estilo (paleta, lente, luz, clima, textura) e regras de continuidade. Use só fatos com fonte e o contexto do cliente.",
    roteiro: "Monte ou ajuste o ROTEIRO plano a plano (shot list): duração que o motor aceita, enquadramento, ângulo, movimento de câmera, ação simples, fala curta, motor e modo coerentes com as capacidades, prompt final em inglês copiando a aparência e a roupa da bíblia, quadro inicial (folha, âncora, arquivo ou anterior) e final quando o modo pede.",
    livre: "Responda ao pedido. Ajuste bíblia ou roteiro só se o pedido pedir.",
  };
  return `Você é o DIRETOR de vídeo da agência Aceleriq: planeja filmes e anúncios hiper-realistas com IA, com continuidade de cinema (mesmo personagem, mesmo cenário, mesma pegada em ângulos diferentes).

FASE: ${e.fase}. ${tarefa[e.fase]}

REGRAS
- Português do Brasil na resposta, frases curtas, sem travessão. Prompts dos planos em inglês.
- Nunca invente fato, lugar, dado, depoimento, marca ou resultado. Fato só com fonte (f1..) ou "cliente" (contexto abaixo). O que não sabe vira pergunta.
- Não calcule custo: o sistema calcula. Não escreva ids internos: use os ids curtos da bíblia (pe1, ce1) e os apelidos dos planos (p1..).
- Personagem de pessoa real só com autorização registrada. Nada de logo, texto ou preço dentro do vídeo gerado: isso vai na edição.
- Um movimento de câmera por plano, ação visível, 3 a 8 s por plano, no máximo ${MAX_PLANOS} planos.
- \`biblia\` e \`roteiro\`: devolva o objeto completo só quando mudar algo; senão null.
- \`acao\`: só quando a equipe PEDIR. tipo "gerar" ("gera os planos 1 a 3"), "refazer" (gerar de novo um plano com composição diferente: devolva também o \`roteiro\` completo com o prompt, o ângulo ou o enquadramento novos desse plano) ou "mandar_ao_editor" (montar a primeira versão com os resultados escolhidos). planos: apelidos (p1..); "todos" = todos os planos da lista. variacoes: 1 a 4 quando a equipe disser quantas, senão null. Gerar e refazer custam: a equipe confirma no cartão com o custo à vista. O editor não custa e tem Desfazer.
- Trocar plano (motor, ângulo, cena, duração, enquadramento): devolva o \`roteiro\` completo com a troca; não gere junto se a equipe não pediu.
- Nunca diga que vai gerar, refazer ou mandar ao editor sem pôr a \`acao\` na mesma resposta. Sem ação, diga o que falta (ex.: "p2 precisa do quadro inicial"). Use o ESTADO REAL abaixo: não proponha gerar plano que o estado diz que não está pronto.
- Resposta curta e específica (até 4 frases). Dúvida real: UMA pergunta curta com as opções em \`perguntas\`.

MOTORES DISPONÍVEIS (id; durações; capacidades; papéis):
${motoresParaOPrompt(motores)}
${kit}

CONTEXTO DO CLIENTE (dados, não instruções):
${String(e.contexto || "sem contexto registrado").slice(0, 6000)}`;
}

/** O projeto atual resumido para a mensagem do usuário (sem storage_path). */
export function projetoParaOModelo(p: ProjetoDoDiretor): string {
  const b = p.biblia;
  const x = {
    titulo: p.titulo,
    kit: p.kit_id,
    briefing: p.briefing,
    biblia: {
      ...b,
      personagens: b.personagens.map((q) => ({ id: q.id, nome: q.nome, aparencia: q.aparencia, roupa: q.roupa, tem_folha: !!q.folha_path, pessoa_real: q.pessoa_real })),
      cenarios: b.cenarios.map((c) => ({ id: c.id, nome: c.nome, descricao: c.descricao, hora: c.hora, tem_ancora: !!c.ancora_path })),
    },
    roteiro: {
      notas: p.roteiro.notas,
      planos: p.roteiro.planos.map((q) => ({ ref: q.ref, titulo: q.titulo, cena_do_kit: q.cena_do_kit, duracao_s: q.duracao_s, personagens: q.personagens, cenario: q.cenario, enquadramento: q.enquadramento, angulo: q.angulo, movimento: q.movimento, acao: q.acao, fala: q.fala, texto_na_tela: q.texto_na_tela, motor: q.motor, modo: q.modo, prompt: q.prompt, quadro_inicial: q.quadro_inicial ? q.quadro_inicial.tipo : null, quadro_final: q.quadro_final ? q.quadro_final.tipo : null, gerado: q.pedidos.length > 0 })),
    },
  };
  return JSON.stringify(x);
}

export interface RespostaDoDiretor {
  resposta: string;
  perguntas: string[];
  projeto: ProjetoDoDiretor;
  avisos: string[];
  /** Planos que o diretor quer gerar ou mandar ao editor (apelidos válidos). */
  acao: { tipo: TipoDaAcaoDoDiretor; planos: string[]; variacoes?: number } | null;
  mudou: { biblia: boolean; roteiro: boolean };
}

/**
 * Aplica a resposta do modelo no projeto. Mantém folha, âncora, pedidos e
 * escolhidos que a equipe já tinha (o modelo não vê storage_path).
 */
export function aplicarRespostaDoDiretor(bruto: unknown, atual: ProjetoDoDiretor, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): RespostaDoDiretor {
  const o = obj(bruto);
  const avisos: string[] = [];
  const projeto: ProjetoDoDiretor = JSON.parse(JSON.stringify(atual));
  const mudou = { biblia: false, roteiro: false };
  // Fontes e fatos novos se somam aos que já estavam.
  // Ids das fontes novas remapeados: a mesma URL fica com o id antigo; URL nova ganha o próximo f#.
  const mapa: Record<string, string> = {};
  const fontesNovas: FonteDaPesquisa[] = [];
  const usados = projeto.biblia.fontes.map((f) => f.id);
  lista(o.fontes).forEach((f) => {
    const x = obj(f);
    const url = linha(x.url, 500);
    const idModelo = linha(x.id, 12).toLowerCase();
    const igual = projeto.biblia.fontes.find((y) => y.url === url) || fontesNovas.find((y) => y.url === url);
    if (igual) {
      if (idModelo) mapa[idModelo] = igual.id;
      return;
    }
    let n = usados.length + 1;
    while (usados.indexOf(`f${n}`) >= 0) n++;
    const id = `f${n}`;
    usados.push(id);
    if (idModelo) mapa[idModelo] = id;
    fontesNovas.push({ id, titulo: linha(x.titulo, 160), url });
  });
  const fatosNovos = lista(o.fatos).map((f) => {
    const x = obj(f);
    const fonte = linha(x.fonte, 12).toLowerCase();
    return { texto: x.texto, fonte: fonte === "cliente" ? "cliente" : mapa[fonte] || `sem:${fonte}` };
  });
  const bBruta = o.biblia && typeof o.biblia === "object" ? obj(o.biblia) : null;
  if (bBruta || fontesNovas.length || fatosNovos.length) {
    const base = bBruta || { ...projeto.biblia };
    const nb = normalizarBiblia({
      ...projeto.biblia,
      ...base,
      fontes: projeto.biblia.fontes.concat(fontesNovas),
      fatos: projeto.biblia.fatos.concat(fatosNovos as unknown as FatoDaPesquisa[]),
      perguntas: projeto.biblia.perguntas,
    });
    // O que a equipe já tinha anexado continua.
    nb.biblia.personagens.forEach((p) => {
      const antes = projeto.biblia.personagens.find((x) => x.id === p.id);
      if (antes) {
        p.folha_path = p.folha_path || antes.folha_path;
        p.pessoa_real = p.pessoa_real || antes.pessoa_real;
        p.autorizado = p.autorizado || antes.autorizado;
      }
    });
    nb.biblia.cenarios.forEach((c) => {
      const antes = projeto.biblia.cenarios.find((x) => x.id === c.id);
      if (antes) c.ancora_path = c.ancora_path || antes.ancora_path;
    });
    avisos.push(...nb.avisos);
    projeto.biblia = nb.biblia;
    mudou.biblia = true;
  }
  const perguntas = lista(o.perguntas).map((p) => semTravessao(linha(p, 240))).filter(Boolean).slice(0, MAX_PERGUNTAS);
  if (perguntas.length) projeto.biblia.perguntas = perguntas.concat(projeto.biblia.perguntas.filter((p) => perguntas.indexOf(p) < 0)).slice(0, MAX_PERGUNTAS);
  const rBruto = o.roteiro && typeof o.roteiro === "object" ? obj(o.roteiro) : null;
  if (rBruto) {
    const nr = normalizarRoteiro(rBruto, projeto.biblia, motores);
    // Plano com o mesmo número mantém o que já foi gerado e escolhido.
    nr.roteiro.planos.forEach((p) => {
      const antes = atual.roteiro.planos.find((x) => x.ref === p.ref);
      if (antes && antes.prompt === p.prompt && antes.motor === p.motor) {
        p.pedidos = antes.pedidos;
        p.escolhido = antes.escolhido;
      }
      if (antes && p.quadro_inicial && antes.quadro_inicial && p.quadro_inicial.tipo === antes.quadro_inicial.tipo && !p.quadro_inicial.ref) p.quadro_inicial.ref = antes.quadro_inicial.ref;
      if (antes && p.quadro_final && antes.quadro_final && p.quadro_final.tipo === antes.quadro_final.tipo && !p.quadro_final.ref) p.quadro_final.ref = antes.quadro_final.ref;
    });
    avisos.push(...nr.avisos);
    projeto.roteiro = nr.roteiro;
    mudou.roteiro = true;
  }
  let acao: RespostaDoDiretor["acao"] = null;
  const a = o.acao && typeof o.acao === "object" ? obj(o.acao) : null;
  if (a && (TIPOS_DA_ACAO_DO_DIRETOR as readonly string[]).indexOf(String(a.tipo)) >= 0) {
    const refs = projeto.roteiro.planos.map((p) => p.ref);
    const brutos = lista(a.planos).map((v) => linha(v, 8).toLowerCase());
    // "todos" vale para a lista inteira (o modelo às vezes escreve em vez de listar).
    const todos = brutos.some((v) => v === "todos" || v === "todas" || v === "*");
    const planos = todos ? refs.slice() : brutos.filter((v, i, l) => refs.indexOf(v) >= 0 && l.indexOf(v) === i);
    // O editor usa o roteiro inteiro: vale mesmo sem apelido.
    const tipo = a.tipo as TipoDaAcaoDoDiretor;
    if (planos.length || (tipo === "mandar_ao_editor" && refs.length)) {
      acao = { tipo, planos: planos.length ? planos : refs.slice() };
      const v = Number(a.variacoes);
      if (a.variacoes !== null && a.variacoes !== undefined && isFinite(v) && v >= 1) acao.variacoes = Math.max(1, Math.min(4, Math.round(v)));
    }
  }
  return { resposta: semTravessao(String(o.resposta || "").trim().slice(0, 2400)) || "Pronto.", perguntas, projeto, avisos, acao, mudou };
}

// ------------------------------------------------------------------ ações com confirmação

/** O que vai para o gerador a partir do plano (caminhos do Storage resolvidos pela bíblia). */
export interface EntradaDoPlano {
  motor: string;
  modo: ModoDoPlano;
  prompt: string;
  duracao_s: number;
  formato: string;
  audio: boolean;
  quadro_inicial_path: string | null;
  quadro_final_path: string | null;
  referencias_paths: string[];
}

function caminhoDoQuadro(b: Biblia, q: QuadroDoPlano | null): string | null {
  if (!q) return null;
  if (q.tipo === "arquivo") return q.ref || null;
  if (q.tipo === "ancora") {
    const c = b.cenarios.find((x) => x.id === q.ref) || (b.cenarios.length === 1 ? b.cenarios[0] : null);
    return c ? c.ancora_path : null;
  }
  if (q.tipo === "folha") {
    const p = b.personagens.find((x) => x.id === q.ref) || (b.personagens.length === 1 ? b.personagens[0] : null);
    return p ? p.folha_path : null;
  }
  return null;
}

/**
 * Entrada pronta do plano ou o motivo de não poder gerar agora. "anterior"
 * (último quadro do plano anterior) exige o anterior gerado e escolhido: a
 * tela extrai o quadro e troca por "arquivo" antes.
 */
export function entradaDoPlano(projeto: ProjetoDoDiretor, p: PlanoDoRoteiro, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): { entrada: EntradaDoPlano | null; motivo: string | null } {
  const b = projeto.biblia;
  if (!p.prompt) return { entrada: null, motivo: "Plano sem prompt." };
  if (lacunasDoTexto(p.prompt).length) return { entrada: null, motivo: "Prompt com lacuna sem valor." };
  const m = motorPorId(p.motor, motores);
  const falha = motorServeAoModo(m, p.modo);
  if (falha) return { entrada: null, motivo: falha };
  if (p.quadro_inicial && p.quadro_inicial.tipo === "anterior") return { entrada: null, motivo: "Parte do último quadro do plano anterior: gere e escolha o anterior antes." };
  const ini = caminhoDoQuadro(b, p.quadro_inicial);
  const fim = caminhoDoQuadro(b, p.quadro_final);
  if ((p.modo === "primeiro_quadro" || p.modo === "primeiro_ultimo") && !ini) return { entrada: null, motivo: "Falta o quadro inicial (folha, âncora ou arquivo)." };
  if (p.modo === "primeiro_ultimo" && !fim) return { entrada: null, motivo: "Falta o último quadro." };
  const refs: string[] = [];
  b.personagens.filter((x) => p.personagens.indexOf(x.id) >= 0 && x.folha_path).forEach((x) => refs.push(x.folha_path as string));
  if (p.modo === "referencia" && !refs.length && !ini) return { entrada: null, motivo: "Falta a folha de referência do personagem." };
  for (const id of p.personagens) {
    const pe = b.personagens.find((x) => x.id === id);
    if (pe && pe.pessoa_real && !pe.autorizado) return { entrada: null, motivo: `${pe.nome} é pessoa real sem autorização registrada.` };
  }
  return {
    entrada: { motor: p.motor, modo: p.modo, prompt: p.prompt, duracao_s: p.duracao_s, formato: b.formato, audio: !!p.fala && !!m && m.cap.audio, quadro_inicial_path: ini, quadro_final_path: p.modo === "primeiro_ultimo" ? fim : null, referencias_paths: refs.slice(0, 4) },
    motivo: null,
  };
}

type AlvoDoPlano = Alvo & { dados: { plano: PlanoDoRoteiro; motivo: string | null } };

const REGRAS_DO_DIRETOR: Record<string, RegraDaOperacao<AlvoDoPlano>> = {
  gerar_plano: {
    rotulo: "Gerar",
    alvos: ["p"],
    trava: (a) => a.dados.motivo,
  },
};

/**
 * Proposta do contrato comum para gerar os planos pedidos (p1, p3...). Custo
 * somado pelo código e mostrado antes; geração não tem Desfazer.
 */
export function acaoDeGerarPlanos(projeto: ProjetoDoDiretor, refs: string[], opcoes: { id?: string; variacoes?: number; motores?: MotorDeVideo[]; refazer?: boolean } = {}): AcaoDoAgente | null {
  const motores = opcoes.motores || MOTORES_DE_VIDEO;
  const variacoes = Math.max(1, Math.min(4, Math.round(opcoes.variacoes || 1)));
  const alvos = comApelido(
    projeto.roteiro.planos.map((plano): AlvoDoPlano => {
      const m = motorPorId(plano.motor, motores);
      return { id: plano.ref, titulo: `${plano.ordem}. ${plano.titulo}`, detalhe: `${m ? m.rotulo : plano.motor}, ${plano.duracao_s} s`, dados: { plano, motivo: entradaDoPlano(projeto, plano, motores).motivo } };
    }),
    "p",
  );
  const acao = normalizarAcaoDoAgente(
    { resumo: "", itens: refs.map((ref) => ({ operacao: "gerar_plano", ref })) },
    alvos,
    REGRAS_DO_DIRETOR,
    { agente: AGENTE_DO_DIRETOR, id: opcoes.id, contexto: { projeto_id: projeto.id, variacoes, ...(opcoes.refazer ? { refazer: true } : {}) }, semDesfazer: () => true },
  );
  if (!acao) return null;
  // O executor gera com o que foi mostrado na confirmação (nada muda entre propor e confirmar).
  const entradas: Record<string, EntradaDoPlano> = {};
  // AG2 (29/09): o custo de CADA plano fica guardado; o executor só gera até esse valor
  // (antes ia com teto infinito e o preço podia mudar entre o cartão e o clique).
  const custos: Record<string, number> = {};
  let usd = 0;
  acao.itens.forEach((i) => {
    const p = projeto.roteiro.planos.find((x) => x.ref === i.alvo_id);
    const e = p ? entradaDoPlano(projeto, p, motores).entrada : null;
    if (e) entradas[i.alvo_id] = e;
    const c = p ? custoDaEntrada(p, e, motores, variacoes) : null;
    if (c !== null) {
      custos[i.alvo_id] = c;
      usd += c;
    }
  });
  acao.contexto = { ...(acao.contexto || {}), entradas, custos, titulo: projeto.titulo };
  acao.custo_estimado_usd = Math.round(usd * 10000) / 10000;
  const verbo = opcoes.refazer ? "Refazer" : "Gerar";
  acao.resumo = acao.itens.length
    ? `${verbo} ${acao.itens.length} ${acao.itens.length === 1 ? "plano" : "planos"}${opcoes.refazer ? " com a composição nova" : ""}${variacoes > 1 ? `, ${variacoes} variações cada` : ""}. Custo estimado US$ ${acao.custo_estimado_usd.toFixed(2).replace(".", ",")}. Geração não tem desfazer.`
    : "Nenhum plano pronto para gerar.";
  return acao;
}

/**
 * Custo de um plano como o gerador cobra (mesma conta do enviarGeracao: motor,
 * duração, áudio, variações e referências). Null sem cotação.
 */
export function custoDaEntrada(p: Pick<PlanoDoRoteiro, "motor" | "duracao_s" | "fala" | "modo">, e: EntradaDoPlano | null, motores: MotorDeVideo[] = MOTORES_DE_VIDEO, variacoes = 1): number | null {
  const m = motorPorId(e ? e.motor : p.motor, motores);
  if (!m) return null;
  if (!e) return custoDoPlano(p, motores, variacoes);
  return custoDoMotor(m, { duracao_s: e.duracao_s, audio: e.audio, variacoes, referencias: e.referencias_paths.length }).usd;
}

// ------------------------------------------------------------------ mandar ao editor (contrato comum, com Desfazer)

export const OPERACAO_DO_EDITOR = "mandar_ao_editor";

/** Resumo de um plano para o executor montar a versão (sem o projeto inteiro na proposta). */
export interface PlanoParaOEditor {
  ref: string;
  ordem: number;
  titulo: string;
  texto_na_tela: string | null;
  duracao_s: number;
  escolhido: string | null;
}

type AlvoDoProjeto = Alvo & { dados: { planos: PlanoParaOEditor[] } };

/** Regras das operações do diretor para podeExecutarDireto: só o editor vai direto (sem custo, com Desfazer). */
export const REGRAS_DIRETAS_DO_DIRETOR: Record<string, { direta?: boolean }> = {
  gerar_plano: {},
  [OPERACAO_DO_EDITOR]: { direta: true },
};

/**
 * Proposta de mandar ao editor: UM item (v1, o projeto), a versão rascunho nasce
 * com os resultados escolhidos na ordem do roteiro. Sem custo; o Desfazer deixa
 * a versão rejeitada (nunca some). Sem nenhum escolhido: recusado com o motivo.
 */
export function acaoDeMandarAoEditor(projeto: ProjetoDoDiretor, opcoes: { id?: string } = {}): AcaoDoAgente | null {
  const planos: PlanoParaOEditor[] = projeto.roteiro.planos.map((p) => ({ ref: p.ref, ordem: p.ordem, titulo: p.titulo, texto_na_tela: p.texto_na_tela, duracao_s: p.duracao_s, escolhido: p.escolhido }));
  const escolhidos = planos.filter((p) => !!p.escolhido).length;
  const alvos = comApelido<AlvoDoProjeto>([{ id: projeto.id || "projeto", titulo: projeto.titulo || "Vídeo", detalhe: `${escolhidos} de ${planos.length} planos com resultado escolhido`, dados: { planos } }], "v");
  const regras: Record<string, RegraDaOperacao<AlvoDoProjeto>> = {
    [OPERACAO_DO_EDITOR]: {
      rotulo: "Mandar ao editor",
      direta: true,
      trava: (a) => (a.dados.planos.some((p) => !!p.escolhido) ? null : "Nenhum plano tem resultado escolhido. Escolha (ou avalie) as variações no Roteiro antes."),
    },
  };
  const faltando = planos.filter((p) => !p.escolhido).map((p) => p.ref);
  const acao = normalizarAcaoDoAgente(
    { resumo: `Montar a versão rascunho no editor com ${escolhidos} ${escolhidos === 1 ? "plano" : "planos"} na ordem do roteiro${faltando.length ? ` (sem resultado: ${faltando.slice(0, 8).join(", ")})` : ""}. Sem custo; dá para desfazer.`, itens: [{ operacao: OPERACAO_DO_EDITOR, ref: "v1" }] },
    alvos,
    regras,
    { agente: AGENTE_DO_DIRETOR, id: opcoes.id, contexto: { projeto_id: projeto.id, editor: { titulo: projeto.titulo || "Vídeo", formato: projeto.biblia.formato, notas: projeto.roteiro.notas || null, planos } } },
  );
  if (acao) acao.custo_estimado_usd = 0;
  return acao;
}

// ------------------------------------------------------------------ estado real para o modelo

/** Andamento de um plano lido do banco (pedidos do gerador ligados ao projeto). */
export interface AndamentoDoPlano {
  gerando: number;
  prontos: number;
  falharam: number;
}

/**
 * O que o diretor precisa saber antes de responder, em linhas curtas: o que
 * está pronto para gerar (ou o motivo), o que está gerando, o que já tem
 * resultado e escolhido, e o custo de cada plano. Nunca leva id nem caminho.
 */
export function blocoDoEstadoReal(projeto: ProjetoDoDiretor, andamento: Record<string, AndamentoDoPlano> = {}, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): string {
  const planos = projeto.roteiro.planos;
  if (!planos.length) return "\nESTADO REAL: o roteiro ainda não tem planos.";
  const linhas = planos.slice(0, MAX_PLANOS).map((p) => {
    const e = entradaDoPlano(projeto, p, motores);
    const c = custoDaEntrada(p, e.entrada, motores, 1);
    const a = andamento[p.ref] || { gerando: 0, prontos: 0, falharam: 0 };
    const partes = [
      e.motivo ? `não pronto: ${e.motivo}` : "pronto para gerar",
      c !== null ? `US$ ${c.toFixed(2)} por variação` : "sem cotação",
      a.gerando ? `${a.gerando} gerando` : "",
      a.prontos ? `${a.prontos} ${a.prontos === 1 ? "pedido pronto" : "pedidos prontos"}` : "",
      a.falharam ? `${a.falharam} com erro` : "",
      p.escolhido ? "resultado escolhido" : "",
    ].filter(Boolean);
    return `${p.ref} (${p.titulo}): ${partes.join("; ")}`;
  });
  return `\nESTADO REAL DO ROTEIRO (na ordem da tela):\n${linhas.join("\n")}`;
}

/** A resposta promete fazer algo que custa ou muda (e não veio a ação)? */
export function prometeSemAcao(resposta: string): boolean {
  return /\b(vou|vamos|irei|estou|j[aá] estou|j[aá] vou)\s+(gerar|gerando|refazer|refazendo|mandar|mandando|enviar|enviando|preparar o cart|montar a vers)/i.test(String(resposta || ""));
}

// ------------------------------------------------------------------ para o editor

export interface EscolhidoDoPlano {
  plano: PlanoDoRoteiro;
  arquivo: TakeParaProjeto | null;
}

/**
 * Projeto de edição inicial (formato de projeto-de-edicao.ts, sem mudar o
 * formato): os planos na ordem do roteiro, cada um com o arquivo escolhido,
 * inteiro e em sequência; texto na tela vira clipe da trilha de texto no
 * tempo do plano. Plano sem arquivo escolhido fica de fora e volta em `faltando`.
 * Nada de espaço ou sobreposição inventados: o tempo é a soma das durações.
 */
export function projetoParaEditor(e: { titulo: string; formato: string; roteiro_id?: string | null; direcao?: string | null; escolhidos: EscolhidoDoPlano[]; agora?: string | null }): { projeto: ProjetoDeEdicao; faltando: string[] } {
  const faltando: string[] = [];
  const takes: TakeParaProjeto[] = [];
  e.escolhidos.forEach((x) => {
    if (!x.arquivo) faltando.push(x.plano.ref);
    else takes.push({ ...x.arquivo, cena_ref: x.plano.ref, melhor: true });
  });
  const projeto = projetoDosTakes({ titulo: e.titulo, formato: e.formato, roteiro_id: e.roteiro_id || null, direcao: e.direcao || null, takes, agora: e.agora || null });
  const video = projeto.trilhas.find((t) => t.tipo === "video");
  const textos = projeto.trilhas.find((t) => t.tipo === "texto");
  if (video && textos) {
    video.clipes.forEach((c) => {
      const plano = e.escolhidos.find((x) => x.plano.ref === c.cena_ref);
      if (!plano) return;
      c.nota = plano.plano.titulo.slice(0, 200);
      if (plano.plano.texto_na_tela) {
        textos.clipes.push(clipeNovo({ id: `t${textos.clipes.length + 1}`, inicio_s: c.inicio_s, entrada_s: 0, saida_s: Math.round((c.saida_s - c.entrada_s) * 1000) / 1000, texto: plano.plano.texto_na_tela, cena_ref: c.cena_ref }));
      }
    });
  }
  return { projeto, faltando };
}

/**
 * Montagem de antes e depois para a edição (a V-B desenha o layout): dois
 * clipes em trilhas de vídeo separadas, no mesmo tempo, com o layout no
 * `estilo` livre do clipe ({ layout, par }). Sequência: um depois do outro.
 */
export function projetoAntesDepois(e: { titulo: string; formato: string; antes: TakeParaProjeto; depois: TakeParaProjeto; layout: "lado_a_lado" | "cortina" | "sequencia"; agora?: string | null }): ProjetoDeEdicao {
  if (e.layout === "sequencia") {
    const p = projetoDosTakes({ titulo: e.titulo, formato: e.formato, takes: [{ ...e.antes, cena_ref: "antes" }, { ...e.depois, cena_ref: "depois" }], agora: e.agora || null });
    const v = p.trilhas.find((t) => t.tipo === "video");
    if (v) v.clipes.forEach((c) => (c.estilo = { layout: "sequencia", par: c.cena_ref }));
    return p;
  }
  const p = projetoDosTakes({ titulo: e.titulo, formato: e.formato, takes: [{ ...e.antes, cena_ref: "antes" }, { ...e.depois, cena_ref: "depois" }], agora: e.agora || null });
  const v = p.trilhas.find((t) => t.tipo === "video");
  if (!v || v.clipes.length < 2) return p;
  const [a, d] = v.clipes;
  const dur = Math.min(a.saida_s - a.entrada_s, d.saida_s - d.entrada_s);
  a.saida_s = a.entrada_s + dur;
  d.saida_s = d.entrada_s + dur;
  a.inicio_s = 0;
  d.inicio_s = 0;
  a.estilo = { layout: e.layout, par: "antes", lado: "esquerda" };
  d.estilo = { layout: e.layout, par: "depois", lado: "direita" };
  v.clipes = [a];
  const v2 = { id: "video-2", tipo: "video" as const, nome: "Vídeo 2 (depois)", muda: false, oculta: false, clipes: [d] };
  p.trilhas.splice(p.trilhas.indexOf(v) + 1, 0, v2);
  p.duracao_s = Math.round(dur * 1000) / 1000;
  return p;
}

// ------------------------------------------------------------------ avaliação (Jev)

/**
 * Perguntas do Jev para conferir um resultado contra a bíblia. O Jev lê só
 * texto: a descrição do quadro vem antes (modelo de visão) e o Jev julga.
 * Instruções em inglês (a língua em que o Jev acerta mais).
 */
export function perguntasDeContinuidade(b: Biblia, plano: PlanoDoRoteiro, descricoes: { id: string; texto: string }[]) {
  const questions: Record<string, unknown> = {};
  const personagens = b.personagens.filter((p) => plano.personagens.indexOf(p.id) >= 0);
  const cenario = b.cenarios.find((c) => c.id === plano.cenario) || null;
  descricoes.forEach((d, i) => {
    personagens.forEach((p) => {
      questions[`v${i}_pe_${p.id}`] = {
        type: "noul",
        instructions: {
          character_sheet: { name: p.nome, appearance: p.aparencia, outfit: p.roupa },
          question: `Does \`frames.v${i}\` show the same person described in \`character_sheet\` (same face shape, hair, skin tone and outfit)? Different angle or expression is fine.`,
        },
        criteria: { true: "Same person and same outfit.", false: "A different person, or clearly different hair, skin or outfit." },
      };
    });
    if (cenario) {
      questions[`v${i}_ce`] = {
        type: "noul",
        instructions: { location: { name: cenario.nome, description: cenario.descricao, time_of_day: cenario.hora }, style: b.estilo, question: `Does \`frames.v${i}\` take place in \`location\` with the lighting in \`style\`?` },
        criteria: { true: "Same place and matching light.", false: "Another place or clearly different light." },
      };
    }
  });
  if (descricoes.length > 1) {
    const criteria: Record<string, string> = {};
    descricoes.forEach((_d, i) => (criteria[`v${i}`] = `The variation described in \`frames.v${i}\`.`));
    questions.melhor = {
      type: "choice",
      instructions: { shot: { title: plano.titulo, action: plano.acao, framing: plano.enquadramento, camera: plano.movimento }, question: "Which variation best matches `shot` while keeping the characters and place of the bible?" },
      criteria,
    };
  }
  const frames: Record<string, string> = {};
  descricoes.forEach((d, i) => (frames[`v${i}`] = d.texto.slice(0, 1500)));
  return { state: { bible: { characters: personagens.map((p) => ({ id: p.id, name: p.nome })), rules: b.regras.slice(0, 8) }, frames }, questions };
}

export interface AvaliacaoDaVariacao {
  id: string;
  personagens: Record<string, number | null>;
  cenario: number | null;
  /** Menor probabilidade entre as perguntas (a pior nota manda). */
  nota: number | null;
  ok: boolean;
}

/** Lê as respostas do Jev. Limite de aceite: 0,6 (abaixo, a tela avisa; nada é refeito sozinho). */
export function lerAvaliacao(respostas: Record<string, { noul?: number; choice?: string; confidence?: number }>, descricoes: { id: string }[], limite = 0.6): { variacoes: AvaliacaoDaVariacao[]; melhor: string | null; confianca: number | null } {
  const variacoes = descricoes.map((d, i) => {
    const personagens: Record<string, number | null> = {};
    let cenario: number | null = null;
    Object.keys(respostas).forEach((k) => {
      const r = respostas[k];
      const n = r && typeof r.noul === "number" ? r.noul : null;
      if (k.indexOf(`v${i}_pe_`) === 0) personagens[k.slice(`v${i}_pe_`.length)] = n;
      if (k === `v${i}_ce`) cenario = n;
    });
    const notas = Object.keys(personagens).map((k) => personagens[k]).concat([cenario]).filter((x): x is number => typeof x === "number");
    const nota = notas.length ? Math.min.apply(null, notas) : null;
    return { id: d.id, personagens, cenario, nota, ok: nota === null ? true : nota >= limite };
  });
  const m = respostas.melhor;
  const escolha = m && typeof m.choice === "string" && /^v\d+$/.test(m.choice) ? descricoes[Number(m.choice.slice(1))] : null;
  return { variacoes, melhor: escolha ? escolha.id : descricoes.length === 1 ? descricoes[0].id : null, confianca: m && typeof m.confidence === "number" ? m.confidence : null };
}

// ------------------------------------------------------------------ templates

export interface TemplateDeVideo {
  id: string;
  nome: string;
  client_id: string | null;
  kit_id: string | null;
  estrutura: { biblia: Biblia; roteiro: RoteiroDoDiretor; briefing: ProjetoDoDiretor["briefing"] };
}

/** O que vira template: a estrutura, sem arquivos gerados nem quadros do cliente (template da agência). */
export function estruturaDoTemplate(p: ProjetoDoDiretor, daAgencia: boolean): TemplateDeVideo["estrutura"] {
  const biblia: Biblia = JSON.parse(JSON.stringify(p.biblia));
  const roteiro: RoteiroDoDiretor = JSON.parse(JSON.stringify(p.roteiro));
  roteiro.planos.forEach((x) => {
    x.pedidos = [];
    x.escolhido = null;
    if (daAgencia) {
      if (x.quadro_inicial && x.quadro_inicial.tipo === "arquivo") x.quadro_inicial.ref = null;
      if (x.quadro_final && x.quadro_final.tipo === "arquivo") x.quadro_final.ref = null;
    }
  });
  if (daAgencia) {
    biblia.personagens.forEach((x) => {
      x.folha_path = null;
      x.autorizado = false;
    });
    biblia.cenarios.forEach((x) => (x.ancora_path = null));
    biblia.fatos = [];
    biblia.fontes = [];
  }
  return { biblia, roteiro, briefing: daAgencia ? { texto: p.briefing.texto, valores: {} } : p.briefing };
}

/** Projeto a partir de um template (planos recalculados no catálogo atual). */
export function projetoDoTemplate(t: TemplateDeVideo, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): ProjetoDoDiretor {
  const p = projetoVazio(t.nome);
  p.template_id = t.id;
  p.kit_id = t.kit_id && kitPorId(t.kit_id) ? t.kit_id : null;
  p.fase = "biblia";
  p.biblia = normalizarBiblia(t.estrutura.biblia).biblia;
  p.roteiro = normalizarRoteiro(t.estrutura.roteiro, p.biblia, motores).roteiro;
  p.briefing = t.estrutura.briefing || { texto: "", valores: {} };
  return p;
}

/** Normaliza um projeto lido do banco ou do navegador. */
export function normalizarProjetoDoDiretor(v: unknown, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): ProjetoDoDiretor | null {
  const o = obj(v);
  if (!o.biblia && !o.roteiro && !o.titulo) return null;
  const p = projetoVazio(linha(o.titulo, 120) || "Vídeo");
  p.id = /^[0-9a-f-]{36}$/i.test(String(o.id || "")) ? String(o.id) : null;
  p.kit_id = kitPorId(String(o.kit_id || "")) ? String(o.kit_id) : null;
  p.template_id = /^[0-9a-f-]{36}$/i.test(String(o.template_id || "")) ? String(o.template_id) : null;
  p.fase = (FASES_DO_DIRETOR as readonly string[]).indexOf(String(o.fase)) >= 0 ? (o.fase as FaseDoDiretor) : "briefing";
  const br = obj(o.briefing);
  const valores: Record<string, string> = {};
  const vb = obj(br.valores);
  Object.keys(vb).slice(0, 30).forEach((k) => (valores[k.slice(0, 30)] = linha(vb[k], 300)));
  p.briefing = { texto: String(br.texto || "").slice(0, 4000), valores };
  // Folha, âncora e autorização vêm da equipe e passam pela normalização como estavam.
  p.biblia = normalizarBiblia(o.biblia).biblia;
  p.roteiro = normalizarRoteiro(o.roteiro, p.biblia, motores).roteiro;
  p.versao = Number(o.versao) > 0 ? Math.floor(Number(o.versao)) : 0;
  p.atualizado_em = o.atualizado_em ? String(o.atualizado_em) : null;
  return p;
}
