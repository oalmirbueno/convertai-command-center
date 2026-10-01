import type { ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import type { PlanoDaEdicao } from "../../../supabase/functions/editor-video/modulos/plano-da-edicao";
import { proporSkill, type IdDaSkill, type PropostaDaSkill, type ValorDoParametro } from "./skills";
import { Montador } from "./skills/tipos";
import { temFala } from "./transcricao";
import { fimDoClipe, trilhaPrincipal } from "./operacoes";
import {
  brollDoAcervoEm,
  capitulosEm,
  corEm,
  frasesDoProjeto,
  notasPorRegra,
  reenquadrarEm,
  textosEm,
  viraisEm,
  zoomNosMomentosEm,
  type FraseNaLinha,
  type ItemParaBroll,
} from "./skills/pecasDaEdicao";
import { CHAVE_DA_LOGO, porLogo, porPeca, porTrilha } from "./motion/aplicar";
import type { IdDaPeca } from "./motion/catalogo";

/**
 * "Editar com IA" (frente EDT, rodada 2): monta a edição inteira a partir do
 * plano, peça por peça, com as skills determinísticas. PURO: o que é
 * julgamento (força das frases, B-roll do acervo, capítulos, virais,
 * animações) chega pronto em `dados` (Jev no servidor).
 *
 * Duas fases, as duas nesta mesma conta:
 * 1. corte e formato (projetoDepoisDoCorte): tomadas, pausas, reenquadrar.
 *    A tela manda a fala DESTE projeto ao Jev (os tempos já são os do corte);
 * 2. estilo: zoom, B-roll, legenda, textos, animações, transições, cor,
 *    música, sons, logo, cartão final, capítulos e virais.
 *
 * Cada peça roda numa cópia: se falhar, fica de fora com o motivo e nada
 * entra pela metade. No fim sai UMA proposta (Confirmar e Desfazer), e cada
 * peça fica na linha do tempo para ajustar.
 */

export interface MarcaDaEdicao {
  nome: string | null;
  cor: string | null;
  cor2?: string | null;
  fonte?: string | null;
  /** Arquivo da letra da marca (bucket mesa), carregado pela prévia e pelo worker. */
  fonte_path?: string | null;
  logo_path: string | null;
}

export interface AnimacaoEscolhida {
  inicio_s: number;
  peca: IdDaPeca;
  params: Record<string, unknown>;
}

export interface DadosDaEdicao {
  agora: string;
  marca?: MarcaDaEdicao | null;
  /** Nota de força (0 a 1) por frase de `frasesDoProjeto(projetoDepoisDoCorte)`. Sem nota: regra da casa. */
  notas?: { k: string; nota: number }[] | null;
  broll?: { inicio_s: number; fim_s: number; item: ItemParaBroll }[] | null;
  animacoes?: AnimacaoEscolhida[] | null;
  capitulos?: { inicio_s: number; titulo: string }[] | null;
  virais?: { inicio_s: number; fim_s: number; nota: number; texto: string }[] | null;
}

export interface PassoDaEdicao {
  id: string;
  rotulo: string;
  feito: boolean;
  detalhe: string;
}

type Etapa = (m: Montador) => string | null;

function rodar(m: Montador, passos: PassoDaEdicao[], id: string, rotulo: string, f: Etapa) {
  const copia = new Montador(m.projeto);
  try {
    const detalhe = f(copia);
    if (detalhe === null) return;
    if (!copia.operacoes.length) {
      passos.push({ id, rotulo, feito: false, detalhe: detalhe || "Nada a mudar." });
      return;
    }
    m.projeto = copia.projeto;
    copia.operacoes.forEach((o) => m.operacoes.push(o));
    copia.avisos.forEach((a) => m.avisar(a));
    passos.push({ id, rotulo, feito: true, detalhe });
  } catch (e) {
    passos.push({ id, rotulo, feito: false, detalhe: e instanceof Error ? e.message : "Não deu." });
  }
}

/** Roda uma skill na cópia e junta a proposta dela (as operações e os avisos). */
function comSkill(m: Montador, id: IdDaSkill, agora: string, params: Record<string, ValorDoParametro>): string {
  const prop: PropostaDaSkill = proporSkill(id, m.projeto, { agora }, params);
  prop.operacoes.forEach((o) => m.aplicar(o));
  prop.avisos.forEach((a) => m.avisar(a));
  return prop.resumo;
}

const ondaNaPrincipal = (p: ProjetoDeEdicao) => {
  const t = trilhaPrincipal(p);
  return !!t && t.clipes.some((c) => c.fonte && p.ondas && p.ondas[c.fonte]);
};

function faseDeCorte(m: Montador, plano: PlanoDaEdicao, agora: string, passos: PassoDaEdicao[]) {
  const fala = temFala(m.projeto);
  if (plano.cortar_erros) {
    rodar(m, passos, "tomadas", "Erros e repetições", (x) => (fala ? comSkill(x, "ficar_com_melhor_tomada", agora, {}) : "Sem fala marcada: marque no Timestamp para achar as tomadas."));
  }
  if (plano.cortar_pausas) {
    rodar(m, passos, "pausas", "Pausas e respiros", (x) => {
      if (ondaNaPrincipal(x.projeto)) return comSkill(x, "cortar_pela_onda", agora, {});
      if (temFala(x.projeto)) return `${comSkill(x, "cortar_silencios", agora, {})} (pela fala; a onda medida corta mais fino)`;
      return "Sem fala nem onda: nada para medir.";
    });
  }
  if (plano.formato !== "manter" || !plano.seguir_rosto) {
    rodar(m, passos, "formato", "Formato", (x) => (reenquadrarEm(x, plano.formato, plano.seguir_rosto) ? `Vídeo em ${x.projeto.formato}${plano.seguir_rosto ? ", seguindo o rosto" : ""}.` : "Já está assim."));
  }
}

/**
 * O cartão final é a assinatura da marca: nada de legenda nem texto por cima
 * dele. A legenda que passa do começo do cartão é aparada nele; a que começa
 * depois sai. O texto (ex.: a chamada do fim) vai para logo antes do cartão,
 * se couber; senão sai (o botão do cartão já faz a chamada). Devolve quantos
 * mexeu. Peça de motion na trilha (o próprio cartão) não é tocada.
 */
export function liberarOCartao(m: Montador, inicioDoCartao: number): number {
  const ini = Math.max(0, inicioDoCartao);
  const alvos: { id: string; tipo: string; inicio_s: number; dur: number }[] = [];
  m.projeto.trilhas.forEach((t) => {
    if (t.tipo !== "legenda" && t.tipo !== "texto") return;
    t.clipes.forEach((c) => {
      if (c.estilo && typeof (c.estilo as Record<string, unknown>).peca === "string") return;
      const fim = fimDoClipe(c);
      if (fim <= ini + 1e-3) return;
      alvos.push({ id: c.id, tipo: t.tipo, inicio_s: c.inicio_s, dur: fim - c.inicio_s });
    });
  });
  let mexidos = 0;
  alvos.forEach((a) => {
    try {
      if (a.inicio_s < ini - 0.3) m.aplicar({ op: "aparar", clipe: a.id, lado: "fim", tempo_s: ini });
      else if (a.tipo === "texto" && ini - a.dur >= 0) {
        try {
          m.aplicar({ op: "mover", clipe: a.id, inicio_s: Math.max(0, ini - a.dur) });
        } catch {
          m.aplicar({ op: "remover", clipe: a.id });
        }
      } else m.aplicar({ op: "remover", clipe: a.id });
      mexidos++;
    } catch {
      try {
        m.aplicar({ op: "remover", clipe: a.id });
        mexidos++;
      } catch {
        /* o clipe já não existe: nada a fazer */
      }
    }
  });
  return mexidos;
}

/** Fase 1 sozinha: a fala deste projeto é a que vai ao Jev (os tempos já são os do corte). */
export function projetoDepoisDoCorte(p: ProjetoDeEdicao, plano: PlanoDaEdicao, agora: string): ProjetoDeEdicao {
  const m = new Montador(p);
  faseDeCorte(m, plano, agora, []);
  return m.projeto;
}

export function montarEdicaoCompleta(p: ProjetoDeEdicao, plano: PlanoDaEdicao, dados: DadosDaEdicao): { proposta: PropostaDaSkill; passos: PassoDaEdicao[] } {
  const m = new Montador(p);
  const passos: PassoDaEdicao[] = [];
  const agora = dados.agora;
  const marca = dados.marca || null;

  if (marca && (marca.cor || marca.nome || marca.fonte)) {
    rodar(m, passos, "marca", "Identidade da marca", (x) => {
      const base = { nome: marca.nome || null, cor: marca.cor || null, cor2: marca.cor2 || null, fonte: marca.fonte || null };
      const nova = marca.fonte && marca.fonte_path ? { ...base, fonte_path: marca.fonte_path } : base;
      if (JSON.stringify(x.projeto.identidade) === JSON.stringify(nova)) return null;
      x.aplicar({ op: "identidade", identidade: nova });
      return `Cores${marca.fonte ? " e letra" : ""} de ${marca.nome || "marca aberta"} nas legendas e textos.`;
    });
  }

  faseDeCorte(m, plano, agora, passos);

  const frases: FraseNaLinha[] = frasesDoProjeto(m.projeto);
  const fala = frases.length > 0;

  if (plano.zoom.ligado) {
    rodar(m, passos, "zoom", "Zoom nos momentos fortes", (x) => {
      if (!fala) return "Sem fala marcada: nada para medir.";
      const porJev = !!(dados.notas && dados.notas.length);
      const n = zoomNosMomentosEm(x, frases, porJev ? (dados.notas as { k: string; nota: number }[]) : notasPorRegra(frases), plano.zoom.intensidade);
      return n ? `${n} ${n === 1 ? "zoom" : "zooms"} ${plano.zoom.intensidade}${porJev ? " (força julgada pelo Jev)" : " (pela regra da casa)"}.` : "Nenhuma frase forte o bastante.";
    });
  }
  if (plano.broll.ligado && dados.broll && dados.broll.length) {
    rodar(m, passos, "broll", "B-roll do acervo", (x) => {
      const n = brollDoAcervoEm(x, (dados.broll || []).slice(0, plano.broll.maximo));
      return `${n} ${n === 1 ? "trecho coberto" : "trechos cobertos"} com vídeo do acervo.`;
    });
  }
  if (plano.legenda.ligado) {
    rodar(m, passos, "legenda", "Legendas", (x) => (fala ? comSkill(x, "legendas", agora, { palavras_por_bloco: plano.legenda.palavras, estilo: plano.legenda.estilo, posicao: plano.legenda.posicao }) : "Sem fala marcada: marque no Timestamp."));
  }
  const textos = plano.textos;
  if (textos.gancho || textos.chamada || textos.nome) {
    rodar(m, passos, "textos", "Gancho, nome e chamada", (x) => {
      const f = textosEm(x, { gancho: textos.gancho, chamada: textos.chamada, nome: textos.nome });
      return f.length ? `Na tela: ${f.join(", ")}.` : "Nada a pôr.";
    });
  }
  if (plano.motion.ligado && dados.animacoes && dados.animacoes.length) {
    rodar(m, passos, "motion", "Animações", (x) => {
      const postas: string[] = [];
      (dados.animacoes || []).forEach((a) => {
        try {
          porPeca(x, { peca: a.peca, inicio_s: a.inicio_s, params: a.params });
          postas.push(a.peca);
        } catch {
          /* peça que não coube fica de fora (dito no resumo) */
        }
      });
      return postas.length ? `${postas.length} ${postas.length === 1 ? "animação" : "animações"} na fala (${postas.join(", ")}).` : "Nenhuma animação coube.";
    });
  }
  if (plano.transicoes.ligado) {
    rodar(m, passos, "transicoes", "Transições", (x) => comSkill(x, "transicoes_suaves", agora, { tipo: plano.transicoes.tipo, duracao_s: plano.transicoes.tipo === "whip" || plano.transicoes.tipo === "flash" ? 0.25 : 0.35 }));
  }
  if (plano.cor.look !== "natural" || plano.cor.intensidade !== 1) {
    rodar(m, passos, "cor", "Cor", (x) => (corEm(x, { look: plano.cor.look, intensidade: plano.cor.intensidade }) ? `Look ${plano.cor.look}.` : "A cor já está assim."));
  }
  if (plano.musica.ligado && plano.musica.fonte) {
    rodar(m, passos, "musica", "Música", (x) => {
      const r = porTrilha(x, plano.musica.fonte, null);
      return `Trilha de ${Math.round(r.duracao_s)} s abaixo da voz, subindo nas pausas.`;
    });
  }
  if (plano.sons.ligado) {
    rodar(m, passos, "sons", "Efeitos sonoros", (x) => comSkill(x, "efeitos_sonoros", agora, { modo: plano.sons.modo }));
  }
  if (plano.logo !== "nenhum" && plano.logo !== "cartao_final") {
    rodar(m, passos, "logo", "Logo", (x) => {
      if (!marca || !marca.logo_path) return "A marca aberta não tem logo no kit.";
      porLogo(x, { storage_path: marca.logo_path, nome: marca.nome ? `Logo ${marca.nome}` : null }, plano.logo as "canto" | "sting");
      return plano.logo === "sting" ? "Logo na abertura." : "Logo no canto o vídeo todo.";
    });
  }
  if (plano.cartao_final.ligado) {
    rodar(m, passos, "cartao", "Cartão final", (x) => {
      const total = x.projeto.duracao_s;
      if (total < 2) return "Vídeo curto demais para o cartão final.";
      if (marca && marca.logo_path && (!x.projeto.fontes[CHAVE_DA_LOGO] || x.projeto.fontes[CHAVE_DA_LOGO].storage_path !== marca.logo_path)) {
        x.aplicar({ op: "fonte", fonte: { chave: CHAVE_DA_LOGO, arquivo_id: null, nome: marca.nome ? `Logo ${marca.nome}` : "Logo do cliente", tipo: "quadro", storage_bucket: "mesa", storage_path: marca.logo_path, duracao_s: null, largura: null, altura: null, midia: "imagem" } });
      }
      const titulo = plano.cartao_final.titulo || (marca && marca.nome) || "";
      if (!titulo) return "Sem título para o cartão final (nem nome da marca).";
      const inicioDoCartao = Math.max(0, total - 3.5);
      porPeca(x, { peca: "cartao_final", inicio_s: inicioDoCartao, duracao_s: Math.min(3.5, total), params: { titulo, botao: plano.cartao_final.botao, ...(marca && marca.cor ? { cor: marca.cor } : {}) }, fonte: x.projeto.fontes[CHAVE_DA_LOGO] ? CHAVE_DA_LOGO : null });
      const liberados = liberarOCartao(x, inicioDoCartao);
      return `Cartão final "${titulo}"${x.projeto.fontes[CHAVE_DA_LOGO] ? " com a logo" : ""}${liberados ? ", sem legenda nem texto por cima" : ""}.`;
    });
  }
  if (plano.capitulos && dados.capitulos && dados.capitulos.length) {
    rodar(m, passos, "capitulos", "Capítulos", (x) => {
      const n = capitulosEm(x, dados.capitulos || []);
      return `${n} ${n === 1 ? "capítulo" : "capítulos"} marcados na régua.`;
    });
  }
  if (plano.virais && dados.virais) {
    rodar(m, passos, "virais", "Momentos virais", (x) => {
      if (!(dados.virais || []).length) return "Nenhum trecho passou da nota para corte viral.";
      const n = viraisEm(x, dados.virais || []);
      return `${n} ${n === 1 ? "momento viral marcado" : "momentos virais marcados"} (vire corte em Capítulos).`;
    });
  }
  const feitos = passos.filter((x) => x.feito);
  if (feitos.length) m.aplicar({ op: "registrar_skill", skill: "editar_com_ia", resumo: feitos.map((x) => x.rotulo).join(", ").slice(0, 190), em: agora });
  const resumo = feitos.length ? `${feitos.length} ${feitos.length === 1 ? "peça montada" : "peças montadas"}: ${feitos.map((x) => x.rotulo.toLowerCase()).join(", ")}.` : "Nada a montar com este plano.";
  return { proposta: m.proposta("editar_com_ia", "Editar com IA", resumo), passos };
}
