import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lerAmbiente } from "../../workers/render/principal";

// Render na nuvem pela Modal (02/10/2026): o PC é fraco; a Modal liga uma máquina
// forte só com pedido na fila e o PC fica de reserva.

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const sql = ler("supabase/migrations/20261002100000_render_na_nuvem.sql");
const app = ler("workers/render-nuvem/app.py");
const base = { SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40) };

describe("render na nuvem", () => {
  it("o worker sai sozinho com a fila vazia só quando RENDER_SAIR_OCIOSO_S vem", () => {
    expect(lerAmbiente(base).sairOciosoS).toBeNull();
    expect(lerAmbiente({ ...base, RENDER_SAIR_OCIOSO_S: "20" }).sairOciosoS).toBe(20);
    expect(lerAmbiente({ ...base, RENDER_SAIR_OCIOSO_S: "abc" }).sairOciosoS).toBeNull();
  });

  it("com a nuvem ligada, o PC só pega pedido com mais de 75 s ou render parado; a nuvem pega na hora", () => {
    expect(sql).toMatch(/_reservar boolean := coalesce\(_worker, ''\) NOT LIKE 'nuvem-%' AND EXISTS \(SELECT 1 FROM public\.render_nuvem WHERE id AND ligada\)/);
    expect(sql).toMatch(/AND \(NOT _reservar OR p\.estado = 'rodando' OR p\.criado_em < now\(\) - interval '75 seconds'\)/);
    // A assinatura não muda (os workers do PC continuam chamando igual).
    expect(sql).toMatch(/FUNCTION public\.render_pedidos_pegar\(_token uuid, _worker text, _trava_segundos integer DEFAULT 600, _versao text DEFAULT NULL\)/);
    expect(app).toMatch(/"RENDER_WORKER_NOME": "nuvem-render"/);
  });

  it("o aviso do banco nunca derruba o pedido e o segredo nasce no Vault", () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(sql).toMatch(/AFTER INSERT ON public\.render_pedidos\s+FOR EACH STATEMENT/);
    expect(sql).toMatch(/vault\.create_secret\(encode\(extensions\.gen_random_bytes\(32\), 'hex'\), 'render_nuvem_segredo'/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.render_nuvem_segredo\(\) TO service_role/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.render_nuvem_segredo\(\) FROM PUBLIC, anon, authenticated/);
    // Começa desligada: liga só depois de provar.
    expect(sql).toMatch(/ligada boolean NOT NULL DEFAULT false/);
  });

  it("a imagem da nuvem leva tudo que o worker lê fora de workers/ (02/10: faltava public/editor e o render final dava ENOENT)", () => {
    for (const pasta of ["workers/render", "workers/supervisor", "src", "supabase/functions", "public/editor"]) {
      expect(app).toContain(`RAIZ / "${pasta}"`);
    }
  });

  it("a Modal confere o segredo em tempo constante e nenhum valor mora no repositório", () => {
    expect(app).toMatch(/hmac\.compare_digest/);
    expect(app).toMatch(/modal\.Secret\.from_name\("aceleriq-render"\)/);
    expect(app).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(app).not.toMatch(/sk_[A-Za-z0-9]{20,}/);
  });
});
