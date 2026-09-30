import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 30/09: a publicação do Lovable sobe o App MCP (/functions/v1/mcp) levando junto TUDO o que em
// supabase/functions não é pasta de função (_shared inteiro e arquivos soltos na raiz) e recusa acima
// de ~4,4 MB (SUPABASE_EDGE_FUNCTION_TOO_LARGE). Com 4,55 MB o front ficou 7 publicações sem sair.
// Módulo usado por uma função só mora em supabase/functions/<funcao>/modulos/, não em _shared.
const TETO = 4_000_000;
const RAIZ = resolve(process.cwd(), "supabase/functions");

function tamanho(caminho: string): { bytes: number; arquivos: number } {
  const st = statSync(caminho);
  if (st.isFile()) return { bytes: st.size, arquivos: 1 };
  return readdirSync(caminho).reduce(
    (acc, nome) => {
      const t = tamanho(join(caminho, nome));
      return { bytes: acc.bytes + t.bytes, arquivos: acc.arquivos + t.arquivos };
    },
    { bytes: 0, arquivos: 0 },
  );
}

describe("compartilhados das funções dentro do limite da publicação do Lovable", () => {
  it("o que não é pasta de função soma menos de 4 MB", () => {
    const fora = readdirSync(RAIZ).filter((nome) => !existsSync(join(RAIZ, nome, "index.ts")));
    const total = fora.map((nome) => tamanho(join(RAIZ, nome))).reduce((a, b) => ({ bytes: a.bytes + b.bytes, arquivos: a.arquivos + b.arquivos }));
    expect(total.bytes, `compartilhado com ${total.arquivos} arquivos e ${total.bytes} bytes: mova para <funcao>/modulos/ o que só uma função usa`).toBeLessThan(TETO);
  });

  it("nenhum arquivo solto na raiz de supabase/functions", () => {
    const soltos = readdirSync(RAIZ).filter((nome) => statSync(join(RAIZ, nome)).isFile() && !/^(deno\.json|import_map\.json|\.env\.example)$/.test(nome));
    expect(soltos).toEqual([]);
  });
});
