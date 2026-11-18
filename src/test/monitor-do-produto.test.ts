import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { haQuanto } from "@/components/produto/casa/MonitorDoProduto";

const raiz = resolve(__dirname, "../..");
const sql = readFileSync(resolve(raiz, "supabase/migrations/20261118190000_monitor_do_produto.sql"), "utf8");
const pagina = readFileSync(resolve(raiz, "src/pages/AdminProduto.tsx"), "utf8");

describe("monitor do produto", () => {
  const agora = new Date("2026-11-18T15:00:00Z").getTime();

  it("diz há quanto tempo em palavras curtas", () => {
    expect(haQuanto(null, agora)).toBe("nunca");
    expect(haQuanto("2026-11-18T14:59:40Z", agora)).toBe("agora");
    expect(haQuanto("2026-11-18T14:56:00Z", agora)).toBe("há 4 min");
    expect(haQuanto("2026-11-18T12:00:00Z", agora)).toBe("há 3 h");
    expect(haQuanto("2026-11-17T12:00:00Z", agora)).toBe("há 1 dia");
    expect(haQuanto("2026-11-13T12:00:00Z", agora)).toBe("há 5 dias");
  });

  it("as duas leituras são só da administração e não gravam nada", () => {
    expect(sql.match(/if not public\.produto_dono\(\) then/g)).toHaveLength(2);
    expect(sql.match(/security definer\s+set search_path = ''/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(insert into|update public|delete from)\b/i);
    expect(sql).toMatch(/revoke all on function public\.produto_admin_monitor\(\) from public, anon/);
  });

  it("não devolve nome nem contato de lead", () => {
    expect(sql).not.toMatch(/x\.(name|email|whatsapp|company)\b/);
  });

  it("o monitor é a primeira aba da administração do produto", () => {
    expect(pagina).toMatch(/\(consulta as Area\) : "monitor"/);
    expect(pagina).toMatch(/area === "monitor" && <MonitorDoProduto \/>/);
  });
});
