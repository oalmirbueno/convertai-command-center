import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { parametrosPelaFidelidade, type Fidelidade, type ReceitaDeEdicao } from "../../../../supabase/functions/editor-video/receita";
import { temFala } from "../transcricao";
import { tempoFino } from "../tempo";
import { batidasEm, zoomAlternadoEm } from "./brabo";
import { cortarSilenciosEm } from "./cortarSilencios";
import { legendasEm } from "./legendas";
import { transicoesEm } from "./organizar";
import { Montador, type ContextoDaSkill, type PropostaDaSkill } from "./tipos";

/**
 * Aplicar a receita de uma referência no vídeo do cliente (frente V-B), no
 * nível de fidelidade escolhido. Só a EDIÇÃO da referência vem junto (ritmo,
 * zoom, transição, estilo de legenda); o conteúdo é o do vídeo do cliente. O
 * código calcula todos os tempos com as mesmas skills do painel.
 */

const NOME: Record<Fidelidade, string> = { identica: "Idêntica", proxima: "Próxima", inspirada: "Inspirada", criativa: "Criativa" };

export function proporReceita(p: ProjetoDeEdicao, receita: ReceitaDeEdicao, fidelidade: Fidelidade, ctx: ContextoDaSkill, nome = "referência"): PropostaDaSkill {
  const par = parametrosPelaFidelidade(receita, fidelidade);
  const m = new Montador(p);
  const partes: string[] = [];
  if (par.cortar) {
    if (temFala(p)) {
      const r = cortarSilenciosEm(m, { limiar_s: 0.3, respiro_depois_s: 0.1, respiro_antes_s: 0.08 });
      if (r.cortes) partes.push(`${r.cortes} pausas cortadas`);
    } else m.avisar("Sem transcrição: as pausas ficam (use Timestamp para cortar).");
  }
  if (par.batida_s) {
    const n = batidasEm(m, par.batida_s);
    if (n) partes.push(`planos de ~${tempoFino(par.batida_s)}`);
  }
  if (par.zoom) {
    const z = zoomAlternadoEm(m, par.zoom);
    if (z) partes.push(`punch-in ${par.zoom}`);
  }
  if (par.transicao) {
    const t = transicoesEm(m, { tipo: par.transicao, duracao_s: 0.3 });
    if (t) partes.push(`${t} transições`);
  }
  if (par.legendar) {
    const n = legendasEm(m, { palavras_por_bloco: par.palavras_por_bloco, estilo: par.estilo_legenda, posicao: par.posicao_legenda || "" });
    if (n) partes.push(`legenda de ${par.palavras_por_bloco} palavras`);
  }
  if (!receita.analise.visao) m.avisar("Estilo de legenda e textos não foram vistos (a receita tem só a medida). Use Ler a edição para completar.");
  if (m.operacoes.length) m.aplicar({ op: "registrar_skill", skill: "referencia", resumo: `${nome} (${NOME[fidelidade]})`, em: ctx.agora });
  return m.proposta("brabo", `Edição de ${nome} (${NOME[fidelidade]})`, partes.length ? `${partes.join(", ")}.` : "Nada a mudar com esta receita.");
}
