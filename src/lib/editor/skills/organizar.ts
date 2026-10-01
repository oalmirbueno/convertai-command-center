import { duracaoDoClipe, type ClipeDoProjeto, type ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, trilhaPrincipal } from "../operacoes";
import { Montador, parametrosComPadrao, type CenaDoRoteiro, type Skill, type ValorDoParametro } from "./tipos";

/**
 * Organizar e arrumar (sem inventar nada):
 * - organizar_por_roteiro: a trilha de vídeo na ordem das cenas do roteiro
 *   (cena_ref de cada clipe); sem roteiro, ordem natural de cena_ref ("c2"
 *   antes de "c10") e depois pelo nome da fonte. Clipe sem cena fica no fim,
 *   na ordem em que estava. Fecha os buracos.
 * - fechar_buracos: cada trilha com clipes encostados, na mesma ordem.
 * - transicoes_suaves: fade curto só onde muda de fonte (plano novo); jump cut
 *   da mesma fonte fica seco.
 */

const natural = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

export function ordemPorRoteiro(p: ProjetoDeEdicao, clipes: ClipeDoProjeto[], cenas: CenaDoRoteiro[] | null | undefined): ClipeDoProjeto[] {
  const pos = (c: ClipeDoProjeto) => {
    if (!c.cena_ref) return Infinity;
    if (cenas && cenas.length) {
      const i = cenas.findIndex((x) => String(x.ref).toLowerCase() === String(c.cena_ref).toLowerCase());
      return i >= 0 ? i : cenas.length;
    }
    return -1;
  };
  const original = clipes.map((c) => c.id);
  return clipes.slice().sort((a, b) => {
    const pa = pos(a);
    const pb = pos(b);
    if (pa !== pb) return pa - pb;
    if (a.cena_ref && b.cena_ref && a.cena_ref !== b.cena_ref && (!cenas || !cenas.length)) return natural(a.cena_ref, b.cena_ref);
    if (!a.cena_ref && !b.cena_ref) return original.indexOf(a.id) - original.indexOf(b.id);
    const fa = a.fonte && p.fontes[a.fonte] ? p.fontes[a.fonte].nome : "";
    const fb = b.fonte && p.fontes[b.fonte] ? p.fontes[b.fonte].nome : "";
    if (fa !== fb) return natural(fa, fb);
    return a.entrada_s - b.entrada_s || original.indexOf(a.id) - original.indexOf(b.id);
  });
}

export const SKILL_ORGANIZAR: Skill = {
  id: "organizar_por_roteiro",
  rotulo: "Organizar clipes por roteiro",
  descricao: "Põe os clipes na ordem das cenas do roteiro e fecha os buracos.",
  referencia: "organizador de takes (Mesa Edição) / pacote-de-edicao",
  precisaDeFala: false,
  parametros: [],
  propor(p, ctx) {
    const m = new Montador(p);
    const t = trilhaPrincipal(p);
    if (!t || t.clipes.length < 2) return m.proposta("organizar_por_roteiro", "Organizar por roteiro", "Precisa de pelo menos dois clipes.");
    const atual = emOrdem(t).map((c) => c.id);
    const nova = ordemPorRoteiro(p, emOrdem(t), ctx.cenas).map((c) => c.id);
    const semCena = t.clipes.filter((c) => !c.cena_ref).length;
    if (semCena === t.clipes.length) m.avisar("Nenhum clipe tem cena marcada. Marque cena e tomada em Organizar.");
    else if (semCena) m.avisar(`${semCena} ${semCena === 1 ? "clipe sem cena foi" : "clipes sem cena foram"} para o fim.`);
    const buraco = emOrdem(t).some((c, k, l) => k > 0 && c.inicio_s - (l[k - 1].inicio_s + duracaoDoClipe(l[k - 1])) > 0.001);
    if (atual.join() === nova.join() && !buraco) return m.proposta("organizar_por_roteiro", "Organizar por roteiro", "Já está na ordem do roteiro.");
    m.aplicar({ op: "reordenar", trilha: t.id, ordem: nova });
    m.aplicar({ op: "registrar_skill", skill: "organizar_por_roteiro", resumo: `${nova.length} clipes`, em: ctx.agora });
    return m.proposta("organizar_por_roteiro", "Organizar por roteiro", `${nova.length} clipes na ordem ${ctx.cenas && ctx.cenas.length ? "do roteiro" : "das cenas"}.`);
  },
};

export const SKILL_FECHAR_BURACOS: Skill = {
  id: "fechar_buracos",
  rotulo: "Fechar buracos",
  descricao: "Encosta os clipes de cada trilha, sem mudar a ordem.",
  referencia: "montagem determinística (EDL)",
  precisaDeFala: false,
  parametros: [],
  propor(p, ctx) {
    const m = new Montador(p);
    let n = 0;
    p.trilhas.forEach((t) => {
      if (t.tipo === "legenda" || t.tipo === "texto") return;
      const l = emOrdem(t);
      const temBuraco = l.some((c, k) => k > 0 && c.inicio_s - (l[k - 1].inicio_s + duracaoDoClipe(l[k - 1])) > 0.001);
      if (!temBuraco) return;
      m.aplicar({ op: "ondular", trilha: t.id });
      n++;
    });
    if (n) m.aplicar({ op: "registrar_skill", skill: "fechar_buracos", resumo: `${n} trilhas`, em: ctx.agora });
    return m.proposta("fechar_buracos", "Fechar buracos", n ? `${n} ${n === 1 ? "trilha encostada" : "trilhas encostadas"}.` : "Sem buracos.");
  },
};

export function transicoesEm(m: Montador, params: Record<string, ValorDoParametro>): number {
  const t = trilhaPrincipal(m.projeto);
  if (!t) return 0;
  const tipo = (["fade", "dissolver", "whip", "flash", "desfoque", "zoom", "deslizar"].indexOf(String(params.tipo)) >= 0 ? String(params.tipo) : "fade") as "fade";
  const d = Number(params.duracao_s);
  let n = 0;
  const l = emOrdem(t);
  l.forEach((c, k) => {
    if (k === 0) return;
    const a = l[k - 1];
    if (!a.fonte || a.fonte === c.fonte) return;
    m.aplicar({ op: "propriedades", clipe: a.id, campos: { transicao_saida: { tipo, duracao_s: d } } });
    m.aplicar({ op: "propriedades", clipe: c.id, campos: { transicao_entrada: { tipo, duracao_s: d } } });
    n++;
  });
  return n;
}

export const SKILL_TRANSICOES: Skill = {
  id: "transicoes_suaves",
  rotulo: "Transições na troca de plano",
  descricao: "Fade curto só onde o plano muda; jump cut continua seco.",
  referencia: "hyperframes-animation (transições)",
  precisaDeFala: false,
  parametros: [
    {
      chave: "tipo",
      rotulo: "Tipo",
      tipo: "escolha",
      padrao: "fade",
      opcoes: [
        { valor: "fade", rotulo: "Fade" },
        { valor: "dissolver", rotulo: "Dissolver" },
        { valor: "whip", rotulo: "Chicote (whip)" },
        { valor: "flash", rotulo: "Flash" },
        { valor: "desfoque", rotulo: "Desfoque" },
        { valor: "zoom", rotulo: "Zoom" },
        { valor: "deslizar", rotulo: "Deslizar" },
      ],
    },
    { chave: "duracao_s", rotulo: "Duração (s)", tipo: "numero", padrao: 0.3, min: 0.1, max: 1.5, passo: 0.1 },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_TRANSICOES, dados);
    const m = new Montador(p);
    const n = transicoesEm(m, params);
    if (n) m.aplicar({ op: "registrar_skill", skill: "transicoes_suaves", resumo: `${n} trocas`, em: ctx.agora });
    return m.proposta("transicoes_suaves", "Transições", n ? `${n} ${n === 1 ? "troca de plano ganha" : "trocas de plano ganham"} transição.` : "Nenhuma troca de plano.");
  },
};
