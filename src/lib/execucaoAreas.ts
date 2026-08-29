/**
 * Quais áreas da Execução começam recolhidas.
 *
 * Catorze agentes em nove áreas viravam uma tela que não acabava, e a
 * maior parte dela mostrando bloco vazio: hoje só o Registro tem tarefa.
 * Rolar oito áreas paradas para chegar na que está andando é o oposto de
 * organizar.
 *
 * A regra do padrão é uma só: **área sem tarefa nenhuma nasce fechada**.
 * Não é esconder trabalho — é não gastar tela com quem não tem nada.
 *
 * Duas decisões que valem explicar:
 *
 * 1. Guardo as FECHADAS, e não as abertas. Uma área que o Hermes cadastrar
 *    amanhã nasce visível, em vez de sumir por causa de um estado gravado
 *    que não a conhecia.
 *
 * 2. Depois do primeiro clique, manda a escolha da pessoa — inclusive para
 *    deixar aberta uma área vazia. O padrão serve à primeira visita, não
 *    para brigar com quem já decidiu.
 */

export interface AreaDaExecucao {
  area: string;
  /** Quantas tarefas os agentes daquela área têm, somadas. */
  tarefas: number;
}

export function areaComecaFechada(
  area: string,
  areas: AreaDaExecucao[],
  fechadasPelaPessoa: ReadonlySet<string>,
  aPessoaJaEscolheu: boolean,
): boolean {
  if (fechadasPelaPessoa.has(area)) return true;
  if (aPessoaJaEscolheu) return false;
  const alvo = areas.find((a) => a.area === area);
  // Área desconhecida fica aberta: é mais fácil recolher o que apareceu do
  // que descobrir que existia algo escondido.
  if (!alvo) return false;
  return alvo.tarefas === 0;
}

/**
 * O próximo conjunto de fechadas, ao alternar.
 *
 * Com `todas`, funciona como o botão de recolher tudo: se já está tudo
 * fechado, abre tudo; senão, fecha tudo. Um botão que só fecha obrigaria a
 * abrir nove áreas no clique a clique.
 */
export function alternarFechadas(
  atuais: ReadonlySet<string>,
  area: string,
  todas?: readonly string[],
): Set<string> {
  const proximo = new Set(atuais);
  if (todas) {
    if (todas.every((a) => proximo.has(a))) todas.forEach((a) => proximo.delete(a));
    else todas.forEach((a) => proximo.add(a));
    return proximo;
  }
  if (proximo.has(area)) proximo.delete(area);
  else proximo.add(area);
  return proximo;
}
