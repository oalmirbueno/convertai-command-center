import { chaveDaFonte, duracaoDoClipe, midiaDaFonte, type CorDoProjeto, type FonteDoProjeto, type ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { colide, emOrdem, fimDoClipe } from "../operacoes";
import { arred } from "../tempo";
import { falaNaLinhaDoTempo, type PalavraNaLinha } from "../transcricao";
import { clipeDeZoom, type ModoDeZoom } from "../efeitos";
import { LOOKS } from "../cor";
import { presetDoTextoValido } from "../estilosDeTexto";
import { trilhaLivre } from "../motion/aplicar";
import { Montador, parametrosComPadrao, type Skill } from "./tipos";

/**
 * Peças do editor completo (frente EDT, rodada 2): reenquadrar, cor, zoom nos
 * momentos fortes, textos (gancho, nome, chamada), B-roll do acervo,
 * capítulos e momentos virais. Funções puras sobre um Montador (a mesma porta
 * das skills): o painel, o "Editar com IA" e o agente usam as mesmas.
 * Quem julga (força da frase, B-roll, capítulo) é o Jev no servidor; aqui só
 * entra a resposta, e o código põe no tempo medido.
 */

export const NOME_DA_TRILHA_DE_AJUSTE = "Câmera e cor";
export const NOME_DA_TRILHA_DE_TEXTO = "Textos";
export const NOME_DA_TRILHA_DE_BROLL = "B-roll";

// ------------------------------------------------------------------ frases

export interface FraseNaLinha {
  k: string;
  inicio_s: number;
  fim_s: number;
  texto: string;
}

/** Frases da fala na linha do tempo: fecha na pontuação, em pausa de 0,6 s ou em 16 palavras. */
export function frasesDaFala(fala: PalavraNaLinha[]): FraseNaLinha[] {
  const saida: FraseNaLinha[] = [];
  let atual: PalavraNaLinha[] = [];
  const fechar = () => {
    if (!atual.length) return;
    saida.push({ k: `f${saida.length + 1}`, inicio_s: arred(atual[0].i), fim_s: arred(atual[atual.length - 1].f), texto: atual.map((w) => w.t).join(" ") });
    atual = [];
  };
  fala.forEach((w, i) => {
    const ant = i > 0 ? fala[i - 1] : null;
    if (ant && (w.i - ant.f > 0.6 || /[.!?…]$/.test(ant.t) || atual.length >= 16)) fechar();
    atual.push(w);
  });
  fechar();
  return saida;
}

export const frasesDoProjeto = (p: ProjetoDeEdicao) => frasesDaFala(falaNaLinhaDoTempo(p));

// ------------------------------------------------------------------ reenquadrar

export function reenquadrarEm(m: Montador, formato: string, seguirRosto: boolean): boolean {
  let mudou = false;
  if (formato && formato !== "manter" && formato !== m.projeto.formato) {
    m.aplicar({ op: "formato", formato });
    mudou = true;
  }
  if (m.projeto.enquadramento.seguir_rosto !== seguirRosto) {
    m.aplicar({ op: "enquadramento", campos: { seguir_rosto: seguirRosto } });
    mudou = true;
  }
  return mudou;
}

export const SKILL_REENQUADRAR: Skill = {
  id: "reenquadrar",
  rotulo: "Reenquadrar (9:16, 1:1, 16:9)",
  descricao: "Troca o formato do vídeo; o recorte segue o rosto rastreado (Formato > Rastrear o rosto) ou o foco de cada clipe.",
  referencia: "EDIT IA PRO (rosto e zona segura) / reframe dos editores de corte",
  precisaDeFala: false,
  parametros: [
    { chave: "formato", rotulo: "Formato", tipo: "escolha", padrao: "9:16", opcoes: ["9:16", "1:1", "4:5", "16:9"].map((f) => ({ valor: f, rotulo: f })) },
    { chave: "seguir_rosto", rotulo: "Seguir o rosto", tipo: "sim_nao", padrao: true },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_REENQUADRAR, dados);
    const m = new Montador(p);
    const mudou = reenquadrarEm(m, String(params.formato), params.seguir_rosto === true);
    const semRosto = !Object.keys(p.rostos || {}).length;
    if (mudou && semRosto && params.seguir_rosto) m.avisar("Nenhum rosto rastreado ainda: o recorte fica no centro até você rastrear (painel Formato).");
    if (mudou) m.aplicar({ op: "registrar_skill", skill: "reenquadrar", resumo: String(params.formato), em: ctx.agora });
    return m.proposta("reenquadrar", "Reenquadrar", mudou ? `Vídeo em ${params.formato}${params.seguir_rosto ? ", seguindo o rosto" : ""}.` : "Já está assim.");
  },
};

// ------------------------------------------------------------------ cor

export function corEm(m: Montador, campos: Partial<CorDoProjeto>): boolean {
  const atual = m.projeto.cor;
  const muda = Object.keys(campos).some((k) => JSON.stringify((atual as unknown as Record<string, unknown>)[k]) !== JSON.stringify((campos as Record<string, unknown>)[k]));
  if (!muda) return false;
  m.aplicar({ op: "cor", campos });
  return true;
}

export const SKILL_COR: Skill = {
  id: "cor",
  rotulo: "Cor e look",
  descricao: "Aplica um look pronto (vivo, quente, frio, cinema, suave, vintage, noite, preto e branco) no vídeo inteiro. Ajuste fino e LUT no painel Cor.",
  referencia: "correção de cor dos editores (curvas, saturação, temperatura) e LUT .cube",
  precisaDeFala: false,
  parametros: [
    { chave: "look", rotulo: "Look", tipo: "escolha", padrao: "vivo", opcoes: LOOKS.map((l) => ({ valor: l.id, rotulo: l.rotulo })) },
    { chave: "intensidade", rotulo: "Força (0 a 1)", tipo: "numero", padrao: 0.8, min: 0, max: 1, passo: 0.1 },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_COR, dados);
    const m = new Montador(p);
    const mudou = corEm(m, { look: String(params.look), intensidade: Number(params.intensidade) });
    if (mudou) m.aplicar({ op: "registrar_skill", skill: "cor", resumo: String(params.look), em: ctx.agora });
    return m.proposta("cor", "Cor e look", mudou ? `Look ${String(params.look)} na força ${String(params.intensidade).replace(".", ",")}.` : "A cor já está assim.");
  },
};

// ------------------------------------------------------------------ zoom nos momentos fortes

export const ESCALA_POR_INTENSIDADE: Record<string, number> = { suave: 1.08, media: 1.15, forte: 1.25 };

/**
 * Frases que pedem ênfase sem o Jev (reserva por regra, dita no cartão):
 * número dito, exclamação, pergunta, e palavras de peso.
 */
export function notasPorRegra(frases: FraseNaLinha[]): { k: string; nota: number }[] {
  const peso = /\b(nunca|sempre|ningu[eé]m|todo mundo|segredo|erro|verdade|mentira|resultado|gr[aá]tis|agora|importante|principal|problema|dinheiro|vend[ae]|dobr|triplic)/i;
  return frases.map((f) => {
    let n = 0.3;
    if (/\d/.test(f.texto)) n += 0.3;
    if (/!/.test(f.texto)) n += 0.2;
    if (/\?/.test(f.texto)) n += 0.1;
    if (peso.test(f.texto)) n += 0.25;
    return { k: f.k, nota: Math.min(1, Math.round(n * 1000) / 1000) };
  });
}

/**
 * Zoom na camada de ajuste nas frases com nota alta: punch-in nas curtas
 * (entra rápido e segura), empurrão nas longas. Espaço mínimo de 3,5 s entre
 * zooms e no máximo um a cada 6 s de vídeo, das mais fortes para as menos.
 */
export function zoomNosMomentosEm(m: Montador, frases: FraseNaLinha[], notas: { k: string; nota: number }[], intensidade: string, limiar = 0.6): number {
  const escala = ESCALA_POR_INTENSIDADE[intensidade] || ESCALA_POR_INTENSIDADE.media;
  const total = Math.max(1, m.projeto.duracao_s);
  const teto = Math.max(1, Math.floor(total / 6));
  const escolhidas: FraseNaLinha[] = [];
  notas
    .filter((n) => n.nota >= limiar)
    .sort((a, b) => b.nota - a.nota)
    .forEach((n) => {
      if (escolhidas.length >= teto) return;
      const f = frases.find((x) => x.k === n.k);
      if (!f || f.fim_s - f.inicio_s < 0.4) return;
      if (escolhidas.some((x) => f.inicio_s < x.fim_s + 3.5 && f.fim_s > x.inicio_s - 3.5)) return;
      escolhidas.push(f);
    });
  let n = 0;
  escolhidas
    .sort((a, b) => a.inicio_s - b.inicio_s)
    .forEach((f) => {
      const dur = Math.max(0.6, Math.min(6, f.fim_s - f.inicio_s + 0.2));
      const modo: ModoDeZoom = dur > 3 ? "empurrao" : "punch";
      const ini = Math.max(0, f.inicio_s - 0.05);
      const trilha = trilhaLivre(m, "ajuste", NOME_DA_TRILHA_DE_AJUSTE, ini, ini + dur);
      m.aplicar({ op: "inserir", trilha, clipe: clipeDeZoom(Math.round(ini * m.projeto.fps) / m.projeto.fps, dur, escala, modo, "zoom_nos_momentos") });
      n++;
    });
  return n;
}

export const SKILL_ZOOM_NOS_MOMENTOS: Skill = {
  id: "zoom_nos_momentos",
  rotulo: "Zoom nos momentos fortes",
  descricao: "Punch-in nas frases de impacto (número dito, exclamação, palavra de peso). No painel Zoom, o Jev julga a força de cada frase; aqui vale a regra.",
  referencia: "EDIT IA PRO (zoom nas ênfases) / Brabo",
  precisaDeFala: true,
  parametros: [
    { chave: "intensidade", rotulo: "Intensidade", tipo: "escolha", padrao: "media", opcoes: [{ valor: "suave", rotulo: "Suave (1,08x)" }, { valor: "media", rotulo: "Média (1,15x)" }, { valor: "forte", rotulo: "Forte (1,25x)" }] },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_ZOOM_NOS_MOMENTOS, dados);
    const m = new Montador(p);
    const frases = frasesDoProjeto(p);
    if (!frases.length) return m.proposta("zoom_nos_momentos", "Zoom nos momentos fortes", "Sem fala marcada: nada para medir.");
    const n = zoomNosMomentosEm(m, frases, notasPorRegra(frases), String(params.intensidade));
    if (n) m.aplicar({ op: "registrar_skill", skill: "zoom_nos_momentos", resumo: `${n} zooms`, em: ctx.agora });
    return m.proposta("zoom_nos_momentos", "Zoom nos momentos fortes", n ? `${n} ${n === 1 ? "zoom" : "zooms"} na camada Câmera e cor.` : "Nenhuma frase forte o bastante.");
  },
};

// ------------------------------------------------------------------ textos

export interface TextosDaEdicao {
  gancho?: string;
  chamada?: string;
  nome?: string;
  titulo?: string;
}

/** Um texto na trilha "Textos" (cria a trilha se preciso). */
export function textoEm(m: Montador, texto: string, inicio_s: number, duracao_s: number, preset: string, extra: Record<string, unknown> = {}): string {
  const t = String(texto || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!t) throw new Error("Texto vazio.");
  const p = presetDoTextoValido(preset) ? preset : "simples";
  const ini = Math.max(0, Math.round(inicio_s * m.projeto.fps) / m.projeto.fps);
  const dur = Math.max(0.5, duracao_s);
  const trilha = trilhaLivre(m, "texto", NOME_DA_TRILHA_DE_TEXTO, ini, ini + dur);
  m.aplicar({ op: "inserir", trilha, clipe: { inicio_s: ini, entrada_s: 0, saida_s: arred(dur), texto: t, estilo: { preset: p, ...extra }, origem: { tipo: "skill", ref: `texto:${p}` } } });
  return trilha;
}

/** Gancho no começo (manchete), nome da pessoa (canto de baixo) e chamada antes do fim. */
export function textosEm(m: Montador, t: TextosDaEdicao): string[] {
  const feitos: string[] = [];
  const total = m.projeto.duracao_s;
  if (total <= 0) return feitos;
  if (t.gancho) {
    textoEm(m, t.gancho, 0, Math.min(3.2, total), "manchete");
    feitos.push("gancho");
  }
  if (t.titulo) {
    textoEm(m, t.titulo, t.gancho ? Math.min(3.3, total - 0.6) : 0, Math.min(2.5, total), "titulo");
    feitos.push("título");
  }
  if (t.nome && total > 4) {
    textoEm(m, t.nome, Math.min(1, total - 3), Math.min(4, total - 1), "nome");
    feitos.push("nome");
  }
  if (t.chamada && total > 6) {
    const fim = Math.max(0, total - 3.8);
    textoEm(m, t.chamada, Math.max(0, fim - 3), 3, "chamada");
    feitos.push("chamada");
  }
  return feitos;
}

// ------------------------------------------------------------------ B-roll do acervo

export interface ItemParaBroll {
  id: string;
  arquivo_id: string | null;
  nome: string;
  tipo: string;
  storage_bucket: string;
  storage_path: string;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
}

/**
 * B-roll do acervo no trecho da frase: numa trilha de vídeo "B-roll" sem som
 * por cima da principal (a voz continua). Até 4 s por inserção; pega o meio
 * do vídeo do acervo (costuma ser o melhor pedaço).
 */
export function brollDoAcervoEm(m: Montador, escolhas: { inicio_s: number; fim_s: number; item: ItemParaBroll }[]): number {
  let n = 0;
  escolhas.forEach((e) => {
    const it = e.item;
    const midia = midiaDaFonte(it.tipo, it.nome, it.storage_path);
    if (midia === "audio") return;
    let chave = Object.keys(m.projeto.fontes).find((k) => m.projeto.fontes[k].storage_path === it.storage_path) || "";
    if (!chave) {
      chave = chaveDaFonte(it.nome || it.id);
      let k = 2;
      while (m.projeto.fontes[chave]) chave = `${chaveDaFonte(it.nome || it.id).slice(0, 34)}-${k++}`;
      const fonte: FonteDoProjeto = { chave, arquivo_id: it.arquivo_id, nome: it.nome, tipo: it.tipo, storage_bucket: it.storage_bucket, storage_path: it.storage_path, duracao_s: it.duracao_s, largura: it.largura, altura: it.altura, midia };
      m.aplicar({ op: "fonte", fonte });
    }
    const quer = Math.max(1.2, Math.min(4, e.fim_s - e.inicio_s));
    const fonteDur = midia === "imagem" ? Infinity : it.duracao_s || 0;
    if (midia === "video" && fonteDur < 0.8) return;
    const dur = Math.min(quer, fonteDur);
    const entrada = midia === "video" ? Math.max(0, Math.min(fonteDur - dur, fonteDur / 2 - dur / 2)) : 0;
    const ini = Math.round(Math.max(0, e.inicio_s + 0.15) * m.projeto.fps) / m.projeto.fps;
    const antes = m.projeto.trilhas.map((t) => t.id);
    let trilha = m.projeto.trilhas.find((t) => t.tipo === "video" && t.nome.indexOf(NOME_DA_TRILHA_DE_BROLL) === 0 && !colide(t, ini, ini + dur));
    if (!trilha) {
      m.aplicar({ op: "trilha_nova", tipo: "video" });
      const nova = m.projeto.trilhas.find((t) => antes.indexOf(t.id) < 0);
      if (!nova) return;
      m.aplicar({ op: "trilha", trilha: nova.id, campos: { nome: NOME_DA_TRILHA_DE_BROLL, muda: true } });
      trilha = m.projeto.trilhas.find((t) => t.id === nova.id);
    }
    if (!trilha) return;
    m.aplicar({ op: "inserir", trilha: trilha.id, clipe: { inicio_s: ini, entrada_s: arred(entrada), saida_s: arred(entrada + dur), fonte: chave, volume: 0, transicao_entrada: { tipo: "fade", duracao_s: 0.15 }, transicao_saida: { tipo: "fade", duracao_s: 0.15 }, origem: { tipo: "skill", ref: "broll_acervo" } } });
    n++;
  });
  return n;
}

// ------------------------------------------------------------------ capítulos e momentos virais

export function capitulosEm(m: Montador, capitulos: { inicio_s: number; titulo: string }[]): number {
  const lista = capitulos.filter((c) => c.titulo && isFinite(c.inicio_s)).map((c) => ({ tempo_s: Math.max(0, c.inicio_s), rotulo: c.titulo }));
  if (!lista.length) return 0;
  m.aplicar({ op: "marcadores", tipo: "capitulo", lista });
  return lista.length;
}

export function viraisEm(m: Montador, virais: { inicio_s: number; fim_s: number; nota: number; texto: string }[]): number {
  const lista = virais.map((v, i) => ({ tempo_s: v.inicio_s, fim_s: v.fim_s, nota: v.nota, rotulo: `Viral ${i + 1}: ${v.texto.split(" ").slice(0, 6).join(" ")}` }));
  m.aplicar({ op: "marcadores", tipo: "viral", lista });
  return lista.length;
}

/** Capítulos no formato do YouTube ("0:00 Título"); o primeiro precisa começar em 0:00. */
export function capitulosParaYoutube(p: ProjetoDeEdicao): string {
  const caps = p.marcadores.filter((m) => m.tipo === "capitulo").sort((a, b) => a.tempo_s - b.tempo_s);
  if (!caps.length) return "";
  const tc = (s: number) => {
    const t = Math.max(0, Math.floor(s));
    const h = Math.floor(t / 3600);
    const mm = Math.floor((t % 3600) / 60);
    const ss = t % 60;
    return h ? `${h}:${mm < 10 ? "0" : ""}${mm}:${ss < 10 ? "0" : ""}${ss}` : `${mm}:${ss < 10 ? "0" : ""}${ss}`;
  };
  return caps.map((c, i) => `${tc(i === 0 ? 0 : c.tempo_s)} ${c.rotulo}`).join("\n");
}

/**
 * Projeto só com o trecho [de, ate) da linha do tempo (o "Criar corte" de um
 * momento viral): clipes recortados e trazidos para o zero; marcadores fora.
 */
export function projetoDoTrecho(p: ProjetoDeEdicao, de: number, ate: number, titulo: string): ProjetoDeEdicao {
  const trilhas = p.trilhas.map((t) => ({
    ...t,
    clipes: emOrdem(t)
      .filter((c) => fimDoClipe(c) > de + 1e-6 && c.inicio_s < ate - 1e-6)
      .map((c) => {
        const ini = Math.max(c.inicio_s, de);
        const fim = Math.min(fimDoClipe(c), ate);
        const entrada = arred(c.entrada_s + (ini - c.inicio_s) * c.velocidade);
        const saida = arred(entrada + (fim - ini) * c.velocidade);
        const estilo = c.estilo && Array.isArray((c.estilo as Record<string, unknown>).palavras)
          ? { ...(c.estilo as Record<string, unknown>), palavras: ((c.estilo as Record<string, unknown>).palavras as { t: string; i: number; f: number }[]).map((w) => ({ ...w, i: arred(w.i - (ini - c.inicio_s)), f: arred(w.f - (ini - c.inicio_s)) })) }
          : c.estilo;
        return { ...c, inicio_s: arred(ini - de), entrada_s: entrada, saida_s: saida, estilo };
      })
      .filter((c) => duracaoDoClipe(c) > 0.02),
  }));
  const duracao = trilhas.reduce((d, t) => t.clipes.reduce((x, c) => Math.max(x, c.inicio_s + duracaoDoClipe(c)), d), 0);
  return { ...p, titulo: titulo.slice(0, 120), trilhas, duracao_s: arred(duracao), marcadores: [], revisao: 0, skills_aplicadas: p.skills_aplicadas.concat([{ skill: "corte_viral", em: "", resumo: `${arred(de)} a ${arred(ate)} s` }]).slice(-40) };
}

