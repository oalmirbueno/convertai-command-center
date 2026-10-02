/**
 * Quem aparece na Foto com modelo (02/10, dono: "escolher o modelo ou o
 * clone de uma lista pronta, ali mesmo"). A tela manda
 * pessoa_escolhida { tipo: "persona" | "clone", id, nome } no
 * campanha_planejar; o ensaio guarda em direcao.pessoa_escolhida e cada foto
 * com pessoa leva a folha dela como identidade (identidadeParaGeracao em
 * modelos.ts e o texto de textoDeIdentidadeParaGeracao em modelos-folha.ts).
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */

export type PessoaEscolhida = { tipo: "persona" | "clone"; id: string; nome: string };

/** Até quantas imagens da folha vão ao gerador por foto (âncora e vistas, ou fotos reais e vistas). */
export const MAX_FOTOS_DA_PESSOA = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerPessoaEscolhida(v: unknown): PessoaEscolhida | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const tipo = p.tipo === "clone" ? "clone" : p.tipo === "persona" ? "persona" : null;
  const id = String(p.id ?? "");
  if (!tipo || !UUID.test(id)) return null;
  return { tipo, id, nome: String(p.nome ?? "").replace(/\s+/g, " ").trim().slice(0, 120) };
}

/**
 * Etiquetas da foto aprovada: a pessoa escolhida fica rastreável (com_persona:<id>
 * ou com_clone:<id>; não clone:<id>, que é a etiqueta das variações do próprio clone) e a foto cai no lado Modelo das Fotos. Clone é pessoa real
 * (nunca "pessoa_sintetica"); sem escolha, vale a pessoa sintética de antes.
 */
export function tagsDaPessoaNaFoto(pessoa: PessoaEscolhida | null, comPessoa: boolean): string[] {
  if (!comPessoa) return [];
  if (!pessoa) return ["pessoa_sintetica"];
  return pessoa.tipo === "clone" ? ["pessoa_real_autorizada", `com_clone:${pessoa.id}`] : ["pessoa_sintetica", `com_persona:${pessoa.id}`];
}
