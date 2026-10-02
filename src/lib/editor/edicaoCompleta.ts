import type { ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { planoComPedido, type PlanoDaEdicao } from "../../../supabase/functions/editor-video/modulos/plano-da-edicao";
import { motivoDoPedido, pecaPermitida, type PecaDoPedido, type PedidoDoDono } from "../../../supabase/functions/editor-video/modulos/pedido-do-dono";
import { proporSkill, type IdDaSkill, type PropostaDaSkill, type ValorDoParametro } from "./skills";
import { Montador } from "./skills/tipos";
import { falaNaLinhaDoTempo, temFala } from "./transcricao";
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
  type FraseNaLinha,
  type ItemParaBroll,
} from "./skills/pecasDaEdicao";
import { CHAVE_DA_LOGO, porLogo, porPeca, porTrilha } from "./motion/aplicar";
import type { IdDaPeca } from "./motion/catalogo";
import { corteLimpoEm } from "./skills/corteLimpo";
import { cameraEm, momentosDaFala, ritmoEm, ROTULO_DO_MOVIMENTO } from "./skills/camera";
import { planoDoDiretor } from "./motion/diretor";
import { checklistDeEngajamento, REGRAS_DE_ENGAJAMENTO, type ChecklistDeEngajamento } from "./engajamento";
import { tempoFino } from "./tempo";

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
  /**
   * 02/10 (agente, EDIT IA PRO): o ritmo do Brabo depois do corte, batidas de
   * ~`batida_s` cortando nas pausas entre palavras e o punch-in alternado a
   * cada batida (corte seco). Sem ele, como antes.
   */
  ritmo?: { batida_s: number; zoom: number } | null;
  /**
   * 02/10 (auditoria: "pedi sem legenda e veio legenda"): o pedido do dono
   * lido (pedido-do-dono.ts). Toda etapa consulta; o que ficou de fora por
   * causa dele vai nos passos ("não feito: você pediu sem legenda").
   */
  pedido?: PedidoDoDono | null;
  /** Nome e cargo de quem fala (lower-third), quando o dono disse. */
  quemFala?: { nome: string; cargo?: string } | null;
}

export interface PassoDaEdicao {
  id: string;
  rotulo: string;
  feito: boolean;
  detalhe: string;
  /** Ficou de fora porque o dono pediu (o relatório lista à parte). */
  pedido?: boolean;
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

/** Fim da primeira frase (o "mantém o começo" protege até aqui). */
function fimDaPrimeiraFrase(p: ProjetoDeEdicao): number {
  const f = frasesDoProjeto(p);
  return f.length ? f[0].fim_s + 0.3 : 0;
}

function faseDeCorte(m: Montador, plano: PlanoDaEdicao, agora: string, passos: PassoDaEdicao[], pedido: PedidoDoDono | null) {
  const fala = temFala(m.projeto);
  const proteger = pedido && pedido.manter_comeco ? fimDaPrimeiraFrase(m.projeto) : 0;
  if (plano.cortar_erros) {
    rodar(m, passos, "tomadas", "Erros e repetições", (x) => (fala ? comSkill(x, "ficar_com_melhor_tomada", agora, {}) : "Sem fala marcada: marque no Timestamp para achar as tomadas."));
  }
  if (plano.cortar_pausas) {
    rodar(m, passos, "pausas", "Pausas e respiros", (x) => {
      // 02/10: com a fala por palavra, o corte limpo (sem picote, nunca dentro de palavra); a onda só sem fala.
      if (temFala(x.projeto)) {
        const r = corteLimpoEm(x, { proteger_ate_s: proteger });
        return r.cortes.length
          ? `${r.cortes.length} ${r.cortes.length === 1 ? "pausa cortada" : "pausas cortadas"} (${String(r.tirado_s).replace(".", ",")} s a menos), com respiro, sem picotar${proteger ? `; começo mantido até ${tempoFino(proteger)}` : ""}.`
          : "Nenhuma pausa longa para cortar.";
      }
      if (ondaNaPrincipal(x.projeto)) return comSkill(x, "cortar_pela_onda", agora, {});
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
export function projetoDepoisDoCorte(p: ProjetoDeEdicao, plano: PlanoDaEdicao, agora: string, pedido: PedidoDoDono | null = null): ProjetoDeEdicao {
  const m = new Montador(p);
  faseDeCorte(m, planoComPedido(plano, pedido).plano, agora, [], pedido);
  return m.projeto;
}

/** Passo que não entrou por causa do pedido do dono. */
function foraPeloPedido(passos: PassoDaEdicao[], pedido: PedidoDoDono | null, peca: PecaDoPedido, id: string, rotulo: string) {
  const m = motivoDoPedido(pedido, peca);
  if (m && !passos.some((x) => x.id === id)) passos.push({ id, rotulo, feito: false, detalhe: `Não feito: ${m.replace(": ", " (")}).`, pedido: true });
}

export function montarEdicaoCompleta(
  p: ProjetoDeEdicao,
  planoBruto: PlanoDaEdicao,
  dados: DadosDaEdicao,
): { proposta: PropostaDaSkill; passos: PassoDaEdicao[]; checklist: ChecklistDeEngajamento; foraPeloPedido: string[] } {
  const m = new Montador(p);
  const passos: PassoDaEdicao[] = [];
  const agora = dados.agora;
  const marca = dados.marca || null;
  const pedido = dados.pedido || null;
  // O pedido do dono por cima do plano: o que ele negou desliga ANTES de qualquer etapa.
  const { plano, fora } = planoComPedido(planoBruto, pedido);
  const pode = (peca: PecaDoPedido) => pecaPermitida(pedido, peca);

  if (marca && (marca.cor || marca.nome || marca.fonte)) {
    rodar(m, passos, "marca", "Identidade da marca", (x) => {
      const base = { nome: marca.nome || null, cor: marca.cor || null, cor2: marca.cor2 || null, fonte: marca.fonte || null };
      const nova = marca.fonte && marca.fonte_path ? { ...base, fonte_path: marca.fonte_path } : base;
      if (JSON.stringify(x.projeto.identidade) === JSON.stringify(nova)) return null;
      x.aplicar({ op: "identidade", identidade: nova });
      return `Cores${marca.fonte ? " e letra" : ""} de ${marca.nome || "marca aberta"} nas legendas, textos e animações.`;
    });
  }

  // "Refaz do zero": volta ao vídeo inteiro (cada fonte da trilha principal, na ordem) e tira as camadas
  // automáticas de antes (legenda, textos, sobreposições, ajustes e os efeitos sonoros da casa). Música e áudio
  // que a equipe pôs ficam. Sem isso, a edição nova cortava em cima dos cortes velhos (02/10, vídeo da Thainá).
  if (pedido && pedido.refazer) {
    rodar(m, passos, "bruto", "Voltar ao vídeo bruto", (x) => voltarAoBruto(x));
  }

  faseDeCorte(m, plano, agora, passos, pedido);
  foraPeloPedido(passos, pedido, "cortes", "pausas", "Pausas e respiros");

  // Ritmo (Brabo): planos de 2,4 a 3,8 s, sempre entre palavras. Só com câmera (sem câmera, a divisão não aparece).
  const querCamera = plano.zoom.ligado && pode("zoom");
  if (dados.ritmo && querCamera && pode("ritmo") && pode("cortes")) {
    const ritmo = dados.ritmo;
    rodar(m, passos, "ritmo", "Ritmo dinâmico (Brabo)", (x) => {
      const escala = Math.max(0.6, Math.min(2, (Number(ritmo.batida_s) || 3) / 3));
      const n = ritmoEm(x, { escala });
      return n ? `${n} ${n === 1 ? "divisão" : "divisões"} entre palavras: planos de 2,4 a 3,8 s, variando.` : "Os planos já estão no ritmo.";
    });
  } else if (dados.ritmo) foraPeloPedido(passos, pedido, pode("zoom") ? (pode("cortes") ? "ritmo" : "cortes") : "zoom", "ritmo", "Ritmo dinâmico (Brabo)");

  const frases: FraseNaLinha[] = frasesDoProjeto(m.projeto);
  const fala = frases.length > 0;

  // Câmera com motivo (substitui o zoom alternado e o empurrão 1,15 da camada de ajuste, que comia a cabeça).
  if (querCamera) {
    rodar(m, passos, "zoom", "Câmera nos momentos fortes", (x) => {
      if (!fala) return "Sem fala marcada: nada para medir.";
      const porJev = !!(dados.notas && dados.notas.length);
      const fortes = porJev ? frases.filter((f) => ((dados.notas || []).find((n) => n.k === f.k) || { nota: 0 }).nota >= 0.7).map((f) => f.inicio_s) : notasPorRegra(frases).filter((n) => n.nota >= 0.6).map((n) => (frases.find((f) => f.k === n.k) as FraseNaLinha).inicio_s);
      const cam = cameraEm(x, momentosDaFala(falaNaLinhaDoTempo(x.projeto), fortes));
      const tipos = cam.movimentos.map((y) => y.movimento).filter((y, i, l) => l.indexOf(y) === i);
      return cam.movimentos.length ? `${cam.movimentos.length} planos com ${tipos.length} movimentos (${tipos.map((y) => ROTULO_DO_MOVIMENTO[y]).join(", ")}), nunca dois iguais seguidos, sem cortar a cabeça${porJev ? "; força julgada pelo Jev" : ""}.` : "Nada a mudar na câmera.";
    });
  } else foraPeloPedido(passos, pedido, "zoom", "zoom", "Câmera nos momentos fortes");

  if (plano.broll.ligado && dados.broll && dados.broll.length) {
    rodar(m, passos, "broll", "B-roll do acervo", (x) => {
      const n = brollDoAcervoEm(x, (dados.broll || []).slice(0, plano.broll.maximo));
      return `${n} ${n === 1 ? "trecho coberto" : "trechos cobertos"} com vídeo do acervo.`;
    });
  } else foraPeloPedido(passos, pedido, "broll", "broll", "B-roll do acervo");

  if (plano.legenda.ligado) {
    rodar(m, passos, "legenda", "Legendas", (x) => (fala ? comSkill(x, "legendas", agora, { palavras_por_bloco: plano.legenda.palavras, estilo: plano.legenda.estilo, posicao: plano.legenda.posicao }) : "Sem fala marcada: marque no Timestamp."));
  } else {
    foraPeloPedido(passos, pedido, "legenda", "legenda", "Legendas");
    // A legenda que já estava na linha (de uma edição anterior) sai quando o dono pediu sem.
    if (!pode("legenda")) {
      rodar(m, passos, "sem_legenda", "Tirar a legenda", (x) => {
        const com = x.projeto.trilhas.filter((t) => t.tipo === "legenda" && t.clipes.length);
        com.forEach((t) => x.aplicar({ op: "limpar_trilha", trilha: t.id }));
        return com.length ? "A legenda que já estava saiu (você pediu sem legenda)." : null;
      });
    }
  }

  // Animações do Jev (quando respondeu) e o diretor de motion da casa (sempre, na marca).
  const ocupado: { de: number; ate: number }[] = [];
  if (plano.motion.ligado && pode("motion") && dados.animacoes && dados.animacoes.length) {
    rodar(m, passos, "motion", "Animações", (x) => {
      const postas: string[] = [];
      (dados.animacoes || []).forEach((a) => {
        try {
          const r = porPeca(x, { peca: a.peca, inicio_s: a.inicio_s, params: a.params });
          ocupado.push({ de: r.inicio_s, ate: r.inicio_s + r.duracao_s });
          postas.push(a.peca);
        } catch {
          /* peça que não coube fica de fora (dito no resumo) */
        }
      });
      return postas.length ? `${postas.length} ${postas.length === 1 ? "animação" : "animações"} na fala (${postas.join(", ")}).` : "Nenhuma animação coube.";
    });
  }
  // Gancho, destaque e nome são peças animadas: entram com as animações; "sem textos" tira só esses.
  const pecasDoDiretor = { motion: plano.motion.ligado && pode("motion"), textos: plano.motion.ligado && pode("motion") && pode("textos") };
  let chamadaDita: number | null = null;
  if (fala && pecasDoDiretor.motion) {
    rodar(m, passos, "diretor", "Motion graphics na marca", (x) => {
      const quem = dados.quemFala || (plano.textos.nome ? { nome: plano.textos.nome.split("|")[0].trim(), cargo: (plano.textos.nome.split("|")[1] || "").trim() } : null);
      const temLegenda = x.projeto.trilhas.some((t) => t.tipo === "legenda" && t.clipes.length > 0);
      const d = planoDoDiretor(x.projeto, {
        motion: pecasDoDiretor.motion,
        textos: pecasDoDiretor.textos,
        densidade: plano.motion.densidade,
        gancho: plano.textos.gancho || "",
        nome: quem ? quem.nome : "",
        cargo: quem ? quem.cargo || "" : "",
        comLegenda: temLegenda,
        ocupado,
      });
      const postas: string[] = [];
      d.pecas.forEach((pc) => {
        try {
          porPeca(x, { peca: pc.peca, inicio_s: pc.inicio_s, duracao_s: pc.duracao_s, params: { ...pc.params, ...(marca && marca.cor ? { cor: marca.cor } : {}) } });
          postas.push(`${pc.peca === "gancho" ? "gancho" : pc.peca === "destaque" ? `"${String(pc.params.texto)}"` : pc.peca === "lista" ? "lista" : pc.peca === "chamada" ? "chamada" : "nome"} em ${tempoFino(pc.inicio_s)}`);
          if (pc.peca === "chamada") chamadaDita = pc.inicio_s;
        } catch {
          /* peça que não coube fica de fora */
        }
      });
      d.fora.forEach((f) => x.avisar(`Motion: ${f}.`));
      return postas.length ? `${postas.length} peças desenhadas na letra e nas cores da marca: ${postas.join(", ")}.` : "Nenhuma peça coube.";
    });
  } else if (!pode("motion")) foraPeloPedido(passos, pedido, "motion", "diretor", "Motion graphics na marca");
  else if (!pode("textos")) foraPeloPedido(passos, pedido, "textos", "diretor", "Motion graphics na marca");

  // Textos simples só para o que o diretor não cobre (chamada escrita no plano, sem chamada dita).
  const textos = plano.textos;
  if (pode("textos") && !pecasDoDiretor.motion && (textos.gancho || textos.chamada || textos.nome)) {
    rodar(m, passos, "textos", "Gancho, nome e chamada", (x) => {
      const f = textosEm(x, { gancho: textos.gancho, chamada: textos.chamada, nome: textos.nome });
      return f.length ? `Na tela: ${f.join(", ")}.` : "Nada a pôr.";
    });
  }
  if (plano.transicoes.ligado) {
    rodar(m, passos, "transicoes", "Transições", (x) => comSkill(x, "transicoes_suaves", agora, { tipo: plano.transicoes.tipo, duracao_s: plano.transicoes.tipo === "whip" || plano.transicoes.tipo === "flash" ? 0.25 : 0.35 }));
  } else foraPeloPedido(passos, pedido, "transicoes", "transicoes", "Transições");
  if (plano.cor.look !== "natural" || plano.cor.intensidade !== 1) {
    rodar(m, passos, "cor", "Cor", (x) => (corEm(x, { look: plano.cor.look, intensidade: plano.cor.intensidade }) ? `Look ${plano.cor.look}.` : "A cor já está assim."));
  } else foraPeloPedido(passos, pedido, "cor", "cor", "Cor");
  if (plano.musica.ligado && plano.musica.fonte) {
    rodar(m, passos, "musica", "Música", (x) => {
      const r = porTrilha(x, plano.musica.fonte, null);
      return `Trilha de ${Math.round(r.duracao_s)} s abaixo da voz, subindo nas pausas.`;
    });
  } else foraPeloPedido(passos, pedido, "musica", "musica", "Música");
  if (plano.sons.ligado) {
    rodar(m, passos, "sons", "Efeitos sonoros", (x) => comSkill(x, "efeitos_sonoros", agora, { modo: plano.sons.modo }));
  } else foraPeloPedido(passos, pedido, "sons", "sons", "Efeitos sonoros");
  if (plano.logo !== "nenhum" && plano.logo !== "cartao_final") {
    rodar(m, passos, "logo", "Logo", (x) => {
      if (!marca || !marca.logo_path) return "A marca aberta não tem logo no kit.";
      porLogo(x, { storage_path: marca.logo_path, nome: marca.nome ? `Logo ${marca.nome}` : null }, plano.logo as "canto" | "sting");
      return plano.logo === "sting" ? "Logo na abertura." : "Logo no canto o vídeo todo.";
    });
  } else if (plano.logo === "nenhum") foraPeloPedido(passos, pedido, "logo", "logo", "Logo");
  if (plano.cartao_final.ligado && chamadaDita === null) {
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
  } else if (plano.cartao_final.ligado && chamadaDita !== null) {
    passos.push({ id: "cartao", rotulo: "Cartão final", feito: false, detalhe: "A chamada dita no fim já virou o cartão de chamada (sem tapar a pessoa); o cartão escuro por cima da fala ficou de fora." });
  } else foraPeloPedido(passos, pedido, "cartao_final", "cartao", "Cartão final");
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

  // Engajamento: confere antes de terminar; trecho parado demais ganha corte com câmera nova (se a câmera pode).
  let checklist = checklistDeEngajamento(m.projeto);
  if (checklist.maior_parado_s > REGRAS_DE_ENGAJAMENTO.max_parado_s && querCamera && pode("ritmo") && pode("cortes") && fala) {
    rodar(m, passos, "engajamento", "Engajamento (nada parado)", (x) => {
      const n = ritmoEm(x, { maximo_s: 3.4, escala: 0.9 });
      if (!n) return "Nenhum vão entre palavras para dividir o trecho parado.";
      cameraEm(x, momentosDaFala(falaNaLinhaDoTempo(x.projeto)));
      return `${n} ${n === 1 ? "corte novo" : "cortes novos"} com câmera nova no trecho parado.`;
    });
    checklist = checklistDeEngajamento(m.projeto);
  }

  const feitos = passos.filter((x) => x.feito);
  if (feitos.length) m.aplicar({ op: "registrar_skill", skill: "editar_com_ia", resumo: feitos.map((x) => x.rotulo).join(", ").slice(0, 190), em: agora });
  const resumo = feitos.length ? `${feitos.length} ${feitos.length === 1 ? "peça montada" : "peças montadas"}: ${feitos.map((x) => x.rotulo.toLowerCase()).join(", ")}.` : "Nada a montar com este plano.";
  return { proposta: m.proposta("editar_com_ia", "Editar com IA", resumo), passos, checklist, foraPeloPedido: fora };
}

/** Volta a trilha principal ao vídeo inteiro de cada fonte (na ordem em que aparecem) e limpa o automático de antes. */
function voltarAoBruto(x: Montador): string | null {
  const p = x.projeto;
  const principal = p.trilhas.find((t) => t.tipo === "video");
  if (!principal || !principal.clipes.length) return null;
  const fps = p.fps > 0 ? p.fps : 25;
  const ordem: string[] = [];
  principal.clipes
    .slice()
    .sort((a, b) => a.inicio_s - b.inicio_s)
    .forEach((c) => {
      if (c.fonte && ordem.indexOf(c.fonte) < 0 && p.fontes[c.fonte] && p.fontes[c.fonte].midia === "video") ordem.push(c.fonte);
    });
  const inteiras = ordem.filter((f) => Number(p.fontes[f].duracao_s) > 0);
  if (!inteiras.length) return null;
  const automatico = (c: { origem?: { tipo?: string } | null }) => !!c.origem && (c.origem.tipo === "skill" || c.origem.tipo === "diretor" || c.origem.tipo === "motion");
  let limpas = 0;
  p.trilhas.forEach((t) => {
    if (t.id === principal.id || !t.clipes.length) return;
    const tudoAutomatico = t.clipes.every((c) => automatico(c as { origem?: { tipo?: string } | null }));
    if (t.tipo === "legenda" || t.tipo === "texto" || t.tipo === "ajuste" || t.tipo === "sobreposicao" || (t.tipo === "audio" && tudoAutomatico)) {
      x.aplicar({ op: "limpar_trilha", trilha: t.id });
      limpas++;
    }
  });
  x.aplicar({ op: "limpar_trilha", trilha: principal.id });
  let cursor = 0;
  inteiras.forEach((f) => {
    const dur = Math.floor(Number(p.fontes[f].duracao_s) * fps) / fps;
    x.aplicar({ op: "inserir", trilha: principal.id, clipe: { fonte: f, inicio_s: cursor, entrada_s: 0, saida_s: dur, origem: { tipo: "manual", ref: "bruto" } } });
    cursor = Math.round((cursor + dur) * fps) / fps;
  });
  return `Voltei ao vídeo bruto (${inteiras.length === 1 ? "1 vídeo inteiro" : `${inteiras.length} vídeos inteiros`})${limpas ? ` e tirei ${limpas} ${limpas === 1 ? "camada automática" : "camadas automáticas"} de antes` : ""}.`;
}
