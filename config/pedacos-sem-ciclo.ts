/**
 * Rede de segurança do fatiamento: o build falha se dois pedaços se importam
 * em círculo (A importa B, B importa A, direto ou por um caminho maior).
 *
 * Por quê: um grupo manual novo em config/chunk-strategy.ts pode puxar para
 * dentro dele um módulo de que outro pedaço precisa primeiro. O build passa,
 * mas no navegador um pedaço começa a rodar antes do outro terminar e o painel
 * não abre (erro de variável usada antes de existir). Aconteceu no ensaio do
 * grupo "base" em 30/09/2026, com o ajudante de CommonJS do React. Falhar aqui
 * troca a tela de erro em produção por um erro no build.
 *
 * Só olha os imports ESTÁTICOS entre pedaços: import() dinâmico não roda na
 * carga e não causa esse problema.
 */

/** Grupos de pedaços que se importam em círculo (cada grupo com 2 ou mais). */
export function ciclosEntrePedacos(grafo: Record<string, readonly string[]>): string[][] {
  let contador = 0;
  const pilha: string[] = [];
  const naPilha = new Set<string>();
  const indice: Record<string, number> = {};
  const menor: Record<string, number> = {};
  const ciclos: string[][] = [];

  // Tarjan em versão iterativa: o grafo tem centenas de pedaços e a versão
  // recursiva pode estourar a pilha num caminho longo.
  for (const inicio of Object.keys(grafo)) {
    if (inicio in indice) continue;
    const trabalho: Array<{ no: string; proximo: number }> = [{ no: inicio, proximo: 0 }];
    indice[inicio] = menor[inicio] = contador++;
    pilha.push(inicio);
    naPilha.add(inicio);

    while (trabalho.length > 0) {
      const topo = trabalho[trabalho.length - 1];
      const vizinhos = (grafo[topo.no] || []).filter((v) => v in grafo);
      if (topo.proximo < vizinhos.length) {
        const w = vizinhos[topo.proximo++];
        if (!(w in indice)) {
          indice[w] = menor[w] = contador++;
          pilha.push(w);
          naPilha.add(w);
          trabalho.push({ no: w, proximo: 0 });
        } else if (naPilha.has(w)) {
          menor[topo.no] = Math.min(menor[topo.no], indice[w]);
        }
        continue;
      }
      trabalho.pop();
      if (trabalho.length > 0) {
        const pai = trabalho[trabalho.length - 1].no;
        menor[pai] = Math.min(menor[pai], menor[topo.no]);
      }
      if (menor[topo.no] === indice[topo.no]) {
        const grupo: string[] = [];
        let w: string | undefined;
        do {
          w = pilha.pop();
          if (w === undefined) break;
          naPilha.delete(w);
          grupo.push(w);
        } while (w !== topo.no);
        if (grupo.length > 1) ciclos.push(grupo.sort());
      }
    }
  }
  return ciclos;
}

type PedacoDoBundle = { type: string; imports?: readonly string[] };

/** Plugin do Vite: chama this.error no fim do build se houver ciclo. */
export function pluginPedacosSemCiclo() {
  return {
    name: "aceleriq-pedacos-sem-ciclo",
    apply: "build" as const,
    generateBundle(this: { error: (msg: string) => never }, _opcoes: unknown, bundle: Record<string, PedacoDoBundle>) {
      const grafo: Record<string, readonly string[]> = {};
      for (const [arquivo, item] of Object.entries(bundle)) {
        if (item.type === "chunk") grafo[arquivo] = item.imports || [];
      }
      const ciclos = ciclosEntrePedacos(grafo);
      if (ciclos.length > 0) {
        this.error(
          "Pedaços do build se importam em círculo e o painel pode não abrir no navegador: " +
            ciclos.map((c) => c.join(" <-> ")).join("; ") +
            ". Confira os grupos manuais em config/chunk-strategy.ts.",
        );
      }
    },
  };
}
