import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Achado E02 (30/09): a migration 20260929010000 foi salva com dupla
// codificação (UTF-8 lido como Latin-1) e os avisos da equipe saíam com "Ã"
// mais um símbolo no lugar do acento. O arquivo fica congelado (hash no
// manifesto de produção) e 20260930294000 regrava as duas funções certas.

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const CONGELADO = "20260929010000_aviso_abre_o_conteudo.sql";
const CONSERTO = "supabase/migrations/20260930294000_avisos_acento_corrigido.sql";

// "Ã" (U+00C3) ou "Â" (U+00C2) seguido de um byte de continuação lido como
// Latin-1 (U+0080..U+00BF). "CONSIDERAÇÃO" (Ã seguido de O) não casa.
const PAR_QUEBRADO = /[ÂÃ][\u0080-¿]/;
const PARES_QUEBRADOS = /[ÂÃ][\u0080-¿]/g;

function arquivos(dir: string, extensoes: string[]): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho, extensoes));
    else if (extensoes.some((e) => nome.endsWith(e))) saida.push(caminho);
  }
  return saida;
}

function consertar(texto: string): string {
  return texto.replace(PARES_QUEBRADOS, (par) => {
    const bytes = new Uint8Array([par.charCodeAt(0), par.charCodeAt(1)]);
    return new TextDecoder("utf-8").decode(bytes);
  });
}

function corpos(sql: string): string[] {
  const re = /AS \$function\$([\s\S]*?)\$function\$/g;
  const saida: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) saida.push(m[1]);
  return saida;
}

describe("acento dos avisos (E02)", () => {
  it("nenhuma migration nova tem texto com dupla codificação", () => {
    const quebrados = arquivos(resolve(raiz, "supabase/migrations"), [".sql"])
      .filter((arq) => !arq.endsWith(CONGELADO))
      .filter((arq) => PAR_QUEBRADO.test(readFileSync(arq, "utf8")))
      .map((arq) => arq.slice(raiz.length + 1));
    expect(quebrados).toEqual([]);
  });

  it("nenhuma Edge Function nem tela tem texto com dupla codificação", () => {
    const quebrados = [
      ...arquivos(resolve(raiz, "supabase/functions"), [".ts"]),
      ...arquivos(resolve(raiz, "src"), [".ts", ".tsx"]),
    ]
      .filter((arq) => PAR_QUEBRADO.test(readFileSync(arq, "utf8")))
      .map((arq) => arq.slice(raiz.length + 1));
    expect(quebrados).toEqual([]);
  });

  it("a migration de conserto tem os textos certos", () => {
    const sql = ler(CONSERTO);
    expect(sql).toContain("Aprovação recebida: ");
    expect(sql).toContain("não entrou sozinho na Agenda");
    expect(sql).toContain('DD/MM "às" HH24:MI');
    expect(sql).toContain("Ajustes solicitados: ");
    expect(sql).toContain("pediu mudanças em");
    expect(sql).toContain("O item já tem um post na Agenda. Ligue a arte aprovada por lá.");
  });

  it("regrava as duas funções com o mesmo corpo do arquivo congelado, só com o acento consertado", () => {
    const congelado = ler(`supabase/migrations/${CONGELADO}`);
    const conserto = ler(CONSERTO);
    const antes = corpos(congelado);
    const depois = corpos(conserto);
    expect(antes).toHaveLength(2);
    expect(depois).toHaveLength(2);
    expect(depois[0]).toBe(consertar(antes[0]));
    expect(depois[1]).toBe(consertar(antes[1]));
    expect(conserto).toContain("CREATE OR REPLACE FUNCTION public.mesa_agendar_aprovados()\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''");
    expect(conserto).toContain("CREATE OR REPLACE FUNCTION public.file_approval_avisa_equipe()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'");
  });

  it("mantém os privilégios de produção e não reenvia aviso", () => {
    const sql = ler(CONSERTO);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.mesa_agendar_aprovados() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mesa_agendar_aprovados() TO service_role;");
    expect(sql).not.toMatch(/GRANT[^;]*file_approval_avisa_equipe[^;]*TO (anon|authenticated|PUBLIC)/i);
    const reparo = sql.slice(sql.indexOf("DO $reparo$"));
    expect(reparo.length).toBeGreaterThan(100);
    expect(reparo).not.toMatch(/INSERT\s+INTO/i);
    expect(reparo).not.toMatch(/avisar_equipe|notificar|net\.http_post/i);
  });

  it("o reparo dos dados só troca pares quebrados e preserva o atualizado_em do trabalho", () => {
    const sql = ler(CONSERTO);
    expect(sql).toContain("UPDATE public.notifications SET message = _txt WHERE id = _l.id;");
    expect(sql).toContain("ALTER TABLE public.estudio_trabalhos DISABLE TRIGGER estudio_trabalhos_tocar;");
    expect(sql).toContain("ALTER TABLE public.estudio_trabalhos ENABLE TRIGGER estudio_trabalhos_tocar;");
    const reparo = sql.slice(sql.indexOf("DO $reparo$"));
    expect(reparo.indexOf("DISABLE TRIGGER")).toBeGreaterThan(0);
    expect(reparo.indexOf("DISABLE TRIGGER")).toBeLessThan(reparo.indexOf("UPDATE public.estudio_trabalhos"));
    expect(reparo.indexOf("UPDATE public.estudio_trabalhos")).toBeLessThan(reparo.indexOf("ENABLE TRIGGER"));
  });

  it("a regra de conserto é a mesma do SQL (Ã + byte vira o caractere certo)", () => {
    // Monta os pares como o SQL faz: chr(195) || chr(c - 64) -> chr(c).
    for (let c = 192; c <= 255; c++) {
      const par = String.fromCharCode(195) + String.fromCharCode(c - 64);
      expect(consertar(par)).toBe(String.fromCharCode(c));
    }
    for (let c = 160; c <= 191; c++) {
      const par = String.fromCharCode(194) + String.fromCharCode(c);
      expect(consertar(par)).toBe(String.fromCharCode(c));
    }
    expect(consertar("CONSIDERAÇÃO")).toBe("CONSIDERAÇÃO");
  });
});
