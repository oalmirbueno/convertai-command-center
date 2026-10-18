/**
 * O guarda do link_id: recusa o vinculo fantasma ANTES do banco e ensina o
 * certo.
 *
 * O caso real (log de 24h, 18/10/2026): 68 chamadas de operator_participar
 * voltaram 400 com "link_not_found". Nenhuma era defeito do RPC. O agente
 * escrevia no diario com um link_id que nao existe, de dois jeitos:
 *
 *   1. mandava o id da TAREFA (kanban_task_id) no lugar do id do vinculo;
 *   2. emendava pedacos de dois uuids (comeco de um vinculo, fim de uma
 *      tarefa), o que passa na leitura humana e no regex de uuid.
 *
 * O erro do RPC so dizia "nao existe", o agente tentava de novo com outro id
 * remendado e falhava de novo. Erro que nao ensina vira laco.
 *
 * Aqui a funcao e pura (sem banco), para o teste conferir o caso real.
 * O que NAO se faz: adivinhar e gravar assim mesmo. Sugestao e so sugestao.
 */

export interface VinculoCandidato {
  id: string;
  kanban_task_id?: string | null;
  painel_task_id?: string | null;
  titulo?: string | null;
}

export type SugestaoDeVinculo =
  | { tipo: 'id_da_tarefa'; vinculo: VinculoCandidato }
  | { tipo: 'parecido'; vinculo: VinculoCandidato }
  | null;

const blocos = (id: string) => id.toLowerCase().split('-');

/** Quantos dos 5 blocos do uuid batem na mesma posicao. */
function blocosIguais(a: string, b: string): number {
  const x = blocos(a);
  const y = blocos(b);
  if (x.length !== 5 || y.length !== 5) return 0;
  return x.reduce((n, parte, i) => n + (parte === y[i] ? 1 : 0), 0);
}

/** Mesmos caracteres em ordem trocada, em poucas posicoes. */
function ehTransposicao(errado: string, certo: string): boolean {
  const a = errado.toLowerCase();
  const b = certo.toLowerCase();
  if (a.length !== b.length || a === b) return false;
  let diferentes = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diferentes += 1;
    if (diferentes > 6) return false;
  }
  if (diferentes < 2) return false;
  const ordenado = (s: string) => [...s].sort().join('');
  return ordenado(a) === ordenado(b);
}

/**
 * Procura, entre vinculos reais, o que o agente provavelmente quis dizer.
 *
 * Ordem: id da tarefa (exato) primeiro, porque e o erro mais comum e nao
 * tem ambiguidade; depois o vinculo com mais blocos iguais (minimo 2) ou
 * transposto. Empate no topo nao sugere ninguem: sugerir errado e pior
 * que mandar listar.
 */
export function sugerirVinculo(errado: string, candidatos: VinculoCandidato[]): SugestaoDeVinculo {
  const alvo = errado.toLowerCase();
  const pelaTarefa = candidatos.filter((c) =>
    (c.kanban_task_id ?? '').toLowerCase() === alvo || (c.painel_task_id ?? '').toLowerCase() === alvo);
  if (pelaTarefa.length === 1) return { tipo: 'id_da_tarefa', vinculo: pelaTarefa[0] };

  const pontuados = candidatos
    .map((c) => ({ c, pontos: ehTransposicao(alvo, c.id) ? 5 : blocosIguais(alvo, c.id) }))
    .filter((p) => p.pontos >= 2)
    .sort((a, b) => b.pontos - a.pontos);
  if (pontuados.length === 0) return null;
  if (pontuados.length > 1 && pontuados[1].pontos === pontuados[0].pontos) return null;
  return { tipo: 'parecido', vinculo: pontuados[0].c };
}

const rotulo = (v: VinculoCandidato) => (v.titulo ? `"${v.titulo}"` : 'sem titulo');

/** A mensagem de recusa: diz onde errou e qual id usar. */
export function mensagemVinculoInexistente(
  errado: string,
  candidatos: VinculoCandidato[],
  operador?: string | null,
): string {
  const sugestao = sugerirVinculo(errado, candidatos);
  const partes = [`link_id ${errado} nao existe: nada foi gravado.`];
  if (sugestao?.tipo === 'id_da_tarefa') {
    partes.push(
      `Esse e o id da TAREFA ${rotulo(sugestao.vinculo)}, nao do vinculo. `
      + `O link_id do vinculo dela e ${sugestao.vinculo.id}. Grave de novo com esse id.`,
    );
  } else if (sugestao?.tipo === 'parecido') {
    partes.push(
      `O id parece o do vinculo ${sugestao.vinculo.id} (tarefa ${rotulo(sugestao.vinculo)}), `
      + 'com partes trocadas. Confira caractere a caractere e grave de novo com o id certo.',
    );
  }
  const consulta = operador
    ? `aceleriq_operator_queue com operator=${operador}`
    : 'aceleriq_operator_queue';
  partes.push(`Copie o link_id exato de ${consulta}, sem remontar o id.`);
  const amostra = candidatos.slice(0, 8).map((c) => `${rotulo(c)} = ${c.id}`).join('; ');
  if (amostra && !sugestao) partes.push(`Vinculos abertos: ${amostra}`);
  return partes.join(' ');
}
