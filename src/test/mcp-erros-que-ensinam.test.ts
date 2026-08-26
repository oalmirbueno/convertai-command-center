import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dois defeitos que o log de auditoria do MCP entregou, e as regras que
 * impedem a volta deles.
 *
 * O dono relatou um: "ao atualizar o dossiê ele não reconhece o client id
 * da Verzelo e dá erro ao registrar". O log confirmou — e mostrou um
 * segundo, muito maior, que ninguém tinha notado porque falha em silêncio
 * dentro do agente:
 *
 *   aceleriq_search   203 falhas · "limit_per_entity must be <= 10"
 *   memory_search      94 falhas · "limit must be <= 25"
 *   get_file_content   20 falhas · "limit must be <= 200"
 *   Verzelo (memória)  12 falhas · client_id com dois caracteres trocados
 *   Verzelo (dossiê)   10 falhas · o mesmo id fantasma
 *
 * 317 chamadas perdidas por pedir acima do teto, contra 22 do caso
 * relatado. O defeito que ninguém vê é sempre o maior.
 */

const raiz = resolve(__dirname, "../..");
const ferramentas = readFileSync(
  resolve(raiz, "supabase/functions/_shared/mcp-tools.ts"), "utf8",
);
const guarda = readFileSync(
  resolve(raiz, "supabase/functions/_shared/mcp-client-id-guard.ts"), "utf8",
);

describe("pedir acima do teto devolve o teto, nao um erro", () => {
  it("o ajudante existe e acomoda em vez de recusar", () => {
    expect(ferramentas).toContain("function limite(max: number, min = 1)");
    // Acomodar e cortar no maximo, nunca devolver mais que ele.
    expect(ferramentas).toContain("Math.min(Math.max(Math.floor(n), min), max)");
    // Texto que nao e numero continua sendo recusado: ali o pedido e
    // ambiguo de verdade, e adivinhar seria pior.
    expect(ferramentas).toContain("if (!Number.isFinite(n)) return valor;");
  });

  it("as tres buscas que mais falharam passam a acomodar", () => {
    // aceleriq_search: 203 falhas.
    expect(ferramentas).toContain("limit_per_entity: limite(10)");
    // memory_search: 94 falhas.
    expect(ferramentas).toContain("limit: limite(25)");
    // get_file_content: 20 falhas.
    expect(ferramentas).toContain("limit: limite(200)");
  });

  it("nenhum teto de pagina voltou a recusar por excesso", () => {
    // A regressao seria silenciosa: alguem escreve o padrao antigo numa
    // ferramenta nova e ela volta a falhar em vez de acomodar.
    expect(ferramentas).not.toMatch(/z\.number\(\)\.int\(\)\.min\(1\)\.max\(\d+\)\.optional\(\)/);
  });

  it("o maximo continua declarado no schema, ensinando o agente", () => {
    // Acomodar nao e esconder o limite: o JSON Schema segue dizendo qual e.
    expect(ferramentas).toContain("maximum: 10");
    expect(ferramentas).toContain("maximum: 500");
  });
});

describe("o id fantasma e recusado E o certo e ensinado", () => {
  it("detecta os caracteres trocados de lugar", () => {
    // O caso da Verzelo: b8f2 digitado como 8b2f. Sem isto, o agente
    // repetia o mesmo id e falhava de novo, 22 vezes.
    expect(guarda).toContain("function ehTransposicao");
    expect(guarda).toContain("ordenado(errado) === ordenado(certo)");
    expect(guarda).toContain("voce trocou dois caracteres de lugar");
    expect(guarda).toContain("O id correto de");
  });

  it("o detector pega o caso REAL da Verzelo, sem confundir clientes", () => {
    // A primeira versao so aceitava UMA troca de vizinhos e nao teria pegado
    // 8b2f/b8f2, que sao duas trocas e quatro posicoes diferentes. Este
    // teste roda a mesma logica do guarda contra os uuids de verdade —
    // detector que nao pega o caso que existe e teatro.
    const ehTransposicao = (errado: string, certo: string): boolean => {
      if (errado.length !== certo.length || errado === certo) return false;
      let diferentes = 0;
      for (let i = 0; i < errado.length; i += 1) {
        if (errado[i] !== certo[i]) diferentes += 1;
        if (diferentes > 6) return false;
      }
      if (diferentes < 2) return false;
      const ordenado = (s: string) => [...s].sort().join("");
      return ordenado(errado) === ordenado(certo);
    };

    const verzelo = "e590497e-f985-47be-b8f2-493bae1da7df";
    const oQueOAgenteMandou = "e590497e-f985-47be-8b2f-493bae1da7df";
    expect(ehTransposicao(oQueOAgenteMandou, verzelo)).toBe(true);

    // E nao pode achar parentesco entre clientes diferentes: sugerir o
    // cliente errado seria pior que nao sugerir nada.
    const acerbi = "39ebda82-637c-498b-a23a-b622f645e852";
    const jalimpo = "0eca58cf-b6fd-4c16-9956-b58e2ae93a54";
    expect(ehTransposicao(acerbi, verzelo)).toBe(false);
    expect(ehTransposicao(jalimpo, verzelo)).toBe(false);
    expect(ehTransposicao(verzelo, verzelo)).toBe(false);
  });

  it("quando nao e transposicao, usa o nome escrito no proprio texto", () => {
    // O nome do cliente quase sempre esta no conteudo que ele tentou
    // gravar; e a pista mais barata que existe.
    expect(guarda).toContain("pista.includes(c.nome.toLowerCase())");
    expect(guarda).toContain("O texto fala de");
  });

  it("em ultimo caso lista clientes ativos com nome e id", () => {
    expect(guarda).toContain("Alguns ativos:");
    expect(guarda).toContain("aceleriq_list_clients");
  });

  it("NUNCA adivinha e grava assim mesmo", () => {
    // Escrever no cliente errado e pior que falhar: a falha aparece na
    // hora, o dado no cliente errado aparece semanas depois como confusao.
    // O guarda so devolve em silencio quando o cliente existe de verdade.
    expect(guarda).toContain("if (perfil && !(perfil as { deleted_at: string | null }).deleted_at) return;");
    expect(guarda).not.toMatch(/return\s+transposto\.id|clientId = /);
    // E nao escreve nada: guarda nao grava.
    expect(guarda).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("vale nos DOIS caminhos que falharam: memoria e dossie", () => {
    const memoria = readFileSync(
      resolve(raiz, "supabase/functions/_shared/project-memory-services.ts"), "utf8",
    );
    const escrita = readFileSync(
      resolve(raiz, "supabase/functions/_shared/mcp-write-services.ts"), "utf8",
    );
    expect(memoria).toContain("await exigirClienteExistente(sb, input.client_id");
    expect(escrita).toContain("await exigirClienteExistente(db(), input.client_id");

    // No dossie o guarda roda ANTES do RPC: o RPC continua validando (e e a
    // ultima palavra), mas quem fala com o agente e a mensagem que ensina.
    const trecho = escrita.slice(
      escrita.indexOf("export async function upsertCurrentDossier"),
      escrita.indexOf("rpc('upsert_current_dossier'"),
    );
    expect(trecho).toContain("exigirClienteExistente");
  });

  it("cliente novo nao esbarra no guarda", () => {
    // A regra e existir e nao estar removido - nada de lista fixa, nada de
    // cadastro previo. Cliente criado hoje grava hoje.
    expect(guarda).toContain(".is('deleted_at', null)");
    expect(guarda).not.toContain("ALLOWLIST");
  });
});
