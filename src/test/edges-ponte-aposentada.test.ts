import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A ponte Ops aposentada: desligada não é quebrada.
 *
 * A auditoria das 55 edge functions contra o servidor no ar acusou seis
 * "falhando" com WORKER_ERROR 500:
 *
 *   sync-to-ops, notify-ops, portal-to-ops, pull-ops-nodes,
 *   backfill-to-ops, backfill-clients-to-ops
 *
 * Nenhuma tinha defeito. Todas resolviam a URL da ponte no TOPO do módulo,
 * e o resolvedor LANÇA quando a ponte legada está desligada — que é o
 * padrão, de propósito, desde que a integração foi aposentada. A função
 * morria antes de existir, e o Supabase respondia um erro genérico
 * indistinguível de bug real.
 *
 * O conserto não é religar a ponte (isso ressuscitaria uma integração
 * aposentada de propósito): é a função subir, responder e explicar o
 * próprio estado. Auditoria só serve quando consegue diferenciar
 * "desligado por decisão" de "quebrado por acidente".
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

const PONTE = [
  "sync-to-ops",
  "notify-ops",
  "portal-to-ops",
  "backfill-to-ops",
  "backfill-clients-to-ops",
  "pull-ops-nodes",
];

describe("as funcoes da ponte sobem mesmo com ela desligada", () => {
  it("nenhuma resolve a URL de um jeito que derrube o modulo", () => {
    for (const funcao of PONTE) {
      const codigo = ler(`supabase/functions/${funcao}/index.ts`);
      // O resolvedor tolerante devolve null; o direto lança na carga.
      expect(codigo, `${funcao} ainda resolve de forma que lanca`)
        .toContain("resolveOpsUrlOrNull(");
      expect(codigo, `${funcao} tem chamada direta no topo`)
        .not.toMatch(/^const \w+ = resolveOps\w+\(\);$/m);
    }
  });

  it("todas respondem explicando, em vez de tentar enviar para lugar nenhum", () => {
    for (const funcao of PONTE) {
      const codigo = ler(`supabase/functions/${funcao}/index.ts`);
      expect(codigo, `${funcao} sem guarda`).toContain("opsBridgeRetiredResponse(");
      // A guarda mora DENTRO do handler, antes do trabalho. Comparar a
      // posicao do fetch nao serve: helpers sao declarados antes do
      // handler e chamados depois dele — a primeira versao deste teste
      // acusou pull-ops-nodes por isso, sem haver defeito ali.
      const handler = codigo.indexOf("serve(");
      expect(codigo.indexOf("opsBridgeRetiredResponse("), `${funcao}: guarda fora do handler`)
        .toBeGreaterThan(handler);
    }
  });

  it("pull-ops-nodes segue funcionando quando tem URL propria", () => {
    // Ela aceita OPS_NODES_LIST_URL, que NAO depende da ponte. Recusar so
    // porque a ponte esta desligada quebraria um caminho que funciona — foi
    // o que a primeira versao da guarda fez.
    const codigo = ler("supabase/functions/pull-ops-nodes/index.ts");
    expect(codigo).toContain("if (getOpsEndpoints().length === 0)");
    // E os destinos derivados da ponte nao sao montados sem ela: sem isto
    // virariam "null/ops-nodes-list", uma URL de lixo.
    expect(codigo).toContain("if (OPS_FUNCTIONS_BASE) {");
  });

  it("o OPTIONS continua respondendo, para a auditoria enxergar a funcao viva", () => {
    for (const funcao of PONTE) {
      const codigo = ler(`supabase/functions/${funcao}/index.ts`);
      const options = codigo.indexOf('req.method === "OPTIONS"');
      const guarda = codigo.indexOf("opsBridgeRetiredResponse(");
      expect(options, `${funcao} sem OPTIONS`).toBeGreaterThan(0);
      expect(options, `${funcao}: guarda antes do OPTIONS`).toBeLessThan(guarda);
    }
  });
});

describe("o resolvedor tolerante nao esconde erro de verdade", () => {
  const config = ler("supabase/functions/_shared/ops-config.ts");

  it("engole SO o erro de ponte desligada, e relanca o resto", () => {
    // Um catch que engole tudo transformaria erro de configuracao real
    // (URL malformada, por exemplo) em silencio.
    expect(config).toContain("if (error instanceof OpsConfigurationError) return null");
    expect(config).toContain("throw error");
  });

  it("a resposta diz o que aconteceu e como religar", () => {
    expect(config).toContain("ops_bridge_retired");
    expect(config).toContain("OPS_LEGACY_BRIDGE_ENABLED=true");
    // 503: desligada e reversivel, nao removida para sempre.
    expect(config).toContain("status: 503");
  });
});
