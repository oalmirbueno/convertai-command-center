import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A mesma lógica de normalizarTipoDeDossie (mcp-write-services roda em Deno
// e importa de URL, então não é importável aqui). O teste de sincronia por
// string, mais abaixo, garante que as listas de sinônimos não divergem.
const normalizarTipoDeDossie = (tipo: string): string => {
  const limpo = tipo.trim().toLowerCase();
  if (["context", "contexto geral", "geral", "general"].includes(limpo)) return "contexto";
  return limpo;
};

/**
 * O dossiê fragmentado: fresco num balde, "há 2 dias" no outro.
 *
 * O relato do dono: "tem mais clientes que não puxa o dossiê, o caso do
 * Mirante Luz, fica há 2 dias atrás e não atualiza igual os outros". O
 * banco mostrou o que era: o dossiê GERAL do Mirante parou em 24/08
 * (semeado pela migração) enquanto os agentes atualizavam o dossiê DO
 * PROJETO todo dia — cada chave (tipo, projeto) tem o próprio "atual", e o
 * painel e o leitor MCP só olhavam a geral. E na Thainá um agente gravou
 * com o tipo "context" (inglês), criando um balde paralelo ao "contexto"
 * — justamente o mais novo, invisível para quem lia o outro.
 *
 * A resposta não é fundir os baldes (dossiê por projeto é um recurso), é
 * NUNCA LER UM BALDE ÀS CEGAS: quem lê um, fica sabendo dos irmãos.
 */

const raiz = resolve(__dirname, "../..");
const leitura = readFileSync(
  resolve(raiz, "supabase/functions/_shared/aceleriq-read-services.ts"), "utf8",
);
const escrita = readFileSync(
  resolve(raiz, "supabase/functions/_shared/mcp-write-services.ts"), "utf8",
);
const painel = readFileSync(
  resolve(raiz, "src/components/admin/DossieDoCliente.tsx"), "utf8",
);

describe("quem le um dossie fica sabendo dos irmaos", () => {
  it("o leitor MCP devolve os outros dossies atuais do cliente", () => {
    const trecho = leitura.slice(
      leitura.indexOf("export async function getCurrentDossier"),
      leitura.indexOf("// ─── Auditoria global de integridade"),
    );
    expect(trecho).toContain("outros_dossies_atuais");
    // A lista vem de TODOS os atuais, sem filtrar por tipo nem projeto.
    expect(trecho).toContain(".eq('is_current', true)");
    expect(trecho).toContain("project:projects(name)");
  });

  it("avisa quando existe um dossie MAIS NOVO em outra chave", () => {
    // O aviso e o que mata o "ha 2 dias" enganoso: sem ele, o agente le o
    // geral velho e conclui que o cliente parou.
    expect(leitura).toContain("mas existe um mais novo em outra chave");
    // E balde vazio com irmaos cheios tambem avisa, em vez de dizer que o
    // cliente nao tem contexto nenhum.
    expect(leitura).toContain("TEM ");
    expect(leitura).toContain("outros_dossies_atuais antes de concluir");
  });

  it("o painel mostra os outros dossies e destaca o mais novo", () => {
    expect(painel).toContain("Outros dossiês atuais");
    expect(painel).toContain("irmaoMaisNovo");
    expect(painel).toContain("foi");
    // O aviso nomeia o projeto, para nao ser um alerta generico.
    expect(painel).toContain("do projeto ");
  });
});

describe("o tipo do dossie e chave: grafia nao cria balde", () => {
  it("a escrita normaliza os sinonimos do tipo padrao", () => {
    // O caso real: "context" criou uma historia paralela a "contexto".
    expect(normalizarTipoDeDossie("context")).toBe("contexto");
    expect(normalizarTipoDeDossie(" Contexto ")).toBe("contexto");
    expect(normalizarTipoDeDossie("GERAL")).toBe("contexto");
    // Tipo legitimamente diferente passa intacto.
    expect(normalizarTipoDeDossie("estrategia")).toBe("estrategia");
  });

  it("a normalizacao roda antes do RPC, e o RPC recebe o normalizado", () => {
    const trecho = escrita.slice(
      escrita.indexOf("export async function upsertCurrentDossier"),
      escrita.indexOf("_dossier_type:"),
    );
    expect(trecho).toContain("normalizarTipoDeDossie(input.dossier_type)");
    expect(escrita).toContain("_dossier_type: dossierType,");
  });

  it("a leitura normaliza IGUAL a escrita - as listas nao podem divergir", () => {
    // Se um lado normalizar e o outro nao, escrita e leitura falam de
    // baldes diferentes e o dossie "some". As duas listas de sinonimos
    // ficam identicas por este teste.
    const sinonimos = "['context', 'contexto geral', 'geral', 'general']";
    expect(escrita).toContain(sinonimos);
    expect(leitura).toContain(sinonimos);
  });
});
