import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 2026-09-22: base de banco da Mesa do cliente (docs/mesa-do-cliente/SPEC.md,
 * secao 2). Regras que este teste segura: toda tabela nova com RLS de equipe
 * (is_staff + can_access_client) e nada para o cliente final; carteira,
 * movimentos e usos so mudam por RPC; recarga so por admin ou manager;
 * registro de uso so pelo backend; prompts globais v1 semeados com o texto
 * exato dos arquivos de docs; o catalogo ia_modelos e semeado em outra
 * migration.
 */

const raiz = resolve(__dirname, "../..");
// O checkout do Windows pode vir com CRLF; o conteudo comparado e o LF.
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const migracao = ler("supabase/migrations/20260922120000_mesa_do_cliente_base.sql");

const TABELAS = [
  "ia_modelos",
  "ia_carteiras",
  "ia_carteira_movimentos",
  "ia_usos",
  "cliente_kit_marca",
  "cliente_fontes",
  "cliente_referencias",
  "cliente_rostos",
  "agente_prompts",
  "agente_memoria",
  "agente_conversas",
  "agente_mensagens",
  "calendario_propostas",
  "estudio_trabalhos",
];

const TABELAS_DA_EQUIPE = [
  "cliente_kit_marca",
  "cliente_fontes",
  "cliente_referencias",
  "cliente_rostos",
  "agente_memoria",
  "agente_conversas",
  "agente_mensagens",
  "calendario_propostas",
  "estudio_trabalhos",
];

const LIVRO_CAIXA = ["ia_carteiras", "ia_carteira_movimentos", "ia_usos"];

function funcao(nome: string): string {
  const inicio = migracao.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, `funcao ${nome} ausente`).toBeGreaterThanOrEqual(0);
  const fim = migracao.indexOf("$body$;", inicio);
  return migracao.slice(inicio, fim);
}

function promptSemeado(agente: string): string {
  const marca = `SELECT '${agente}', NULL, 1, $prompt$`;
  const inicio = migracao.indexOf(marca);
  expect(inicio, `prompt ${agente} ausente`).toBeGreaterThanOrEqual(0);
  const corpo = inicio + marca.length;
  const fim = migracao.indexOf("$prompt$, true", corpo);
  return migracao.slice(corpo, fim);
}

describe("mesa do cliente: base de banco", () => {
  it("cria as 14 tabelas, todas com RLS ligado", () => {
    for (const tabela of TABELAS) {
      expect(migracao).toContain(`CREATE TABLE public.${tabela} (`);
      expect(migracao).toContain(`ALTER TABLE public.${tabela} ENABLE ROW LEVEL SECURITY;`);
    }
    const criadas = migracao.match(/CREATE TABLE public\.\w+/g) ?? [];
    expect(criadas).toHaveLength(TABELAS.length);
  });

  it("toda tabela de cliente tem client_id ligado ao perfil com cascata", () => {
    for (const tabela of TABELAS.filter((t) => t !== "ia_modelos")) {
      const inicio = migracao.indexOf(`CREATE TABLE public.${tabela} (`);
      const bloco = migracao.slice(inicio, migracao.indexOf("\n);", inicio));
      expect(bloco, tabela).toMatch(/client_id uuid (NOT NULL |PRIMARY KEY )?REFERENCES public\.profiles\(id\) ON DELETE CASCADE/);
    }
    // A mensagem nunca troca de cliente: vinculo composto com a conversa.
    expect(migracao).toContain("FOREIGN KEY (conversa_id, client_id)\n    REFERENCES public.agente_conversas (id, client_id)");
  });

  it("equipe com acesso ao cliente le e escreve; anon e cliente final nao recebem nada", () => {
    const loop = migracao.slice(
      migracao.indexOf("FOREACH _tabela IN ARRAY ARRAY["),
      migracao.indexOf("] LOOP", migracao.indexOf("FOREACH _tabela IN ARRAY ARRAY[")),
    );
    for (const tabela of TABELAS_DA_EQUIPE) {
      expect(loop).toContain(`'${tabela}'`);
    }
    for (const sufixo of ["_equipe_le", "_equipe_insere", "_equipe_altera", "_equipe_apaga"]) {
      expect(migracao).toContain(`_tabela || '${sufixo}'`);
    }
    expect(migracao).toContain(
      "public.is_staff((select auth.uid()))\n        AND public.can_access_client(client_id)",
    );
    expect(migracao).toContain("FROM PUBLIC, anon, authenticated, service_role;");
    expect(migracao).not.toMatch(/GRANT [^;]* TO [^;]*\banon\b/);
    expect(migracao).not.toMatch(/'client'::public\.app_role/);
  });

  it("carteira, movimentos e usos: equipe so le, escrita so pelas RPCs", () => {
    for (const tabela of LIVRO_CAIXA) {
      expect(migracao).toContain(`CREATE POLICY ${tabela}_equipe_le\nON public.${tabela}\nFOR SELECT TO authenticated`);
      expect(migracao).not.toMatch(new RegExp(`CREATE POLICY \\w+\\s+ON public\\.${tabela}\\s+FOR (INSERT|UPDATE|DELETE|ALL)`));
    }
    expect(migracao).toContain(
      "GRANT SELECT ON public.ia_carteiras, public.ia_carteira_movimentos, public.ia_usos\n  TO authenticated, service_role;",
    );
    expect(migracao).not.toMatch(/GRANT [^;]*(INSERT|UPDATE|DELETE)[^;]* ON public\.(ia_carteiras|ia_carteira_movimentos|ia_usos)\b/);
  });

  it("catalogo: equipe le, so admin escreve, e esta migration nao semeia modelos", () => {
    expect(migracao).toContain("USING (public.is_staff((select auth.uid())));");
    for (const acao of ["insere", "altera", "apaga"]) {
      expect(migracao).toContain(`CREATE POLICY ia_modelos_admin_${acao}`);
    }
    expect(migracao).not.toContain("INSERT INTO public.ia_modelos");
  });

  it("recarga so por admin ou manager (com acesso ao cliente), valor positivo", () => {
    const corpo = funcao("ia_carteira_recarregar");
    expect(corpo).toContain("COALESCE(public.has_role(_ator, 'admin'::public.app_role), false)");
    expect(corpo).toContain("COALESCE(public.has_role(_ator, 'manager'::public.app_role), false)");
    expect(corpo).toContain("AND COALESCE(public.can_access_client(_client_id), false)");
    expect(corpo).toContain("IA_RECARGA_SO_ADMIN_OU_MANAGER");
    expect(corpo).toContain("IF _valor_usd IS NULL OR _valor_usd <= 0 THEN");
    // Nem o backend recarrega sozinho: toda recarga tem uma pessoa.
    expect(corpo).not.toContain("rpc_trusted_backend");
    expect(corpo.indexOf("IA_RECARGA_SO_ADMIN_OU_MANAGER")).toBeLessThan(corpo.indexOf("INSERT INTO"));
  });

  it("registro de uso so pelo backend: uso, debito negativo e saldo na mesma chamada", () => {
    const corpo = funcao("ia_registrar_uso");
    expect(corpo).toContain("IF NOT app_private.rpc_trusted_backend() THEN");
    expect(corpo.indexOf("rpc_trusted_backend")).toBeLessThan(corpo.indexOf("INSERT INTO"));
    expect(corpo).toContain("INSERT INTO public.ia_usos (");
    expect(corpo).toContain("VALUES (_client_id, 'debito', -_custo, _uso_id,");
    expect(corpo).toContain("ON CONFLICT (client_id) DO UPDATE\n  SET saldo_usd = carteira.saldo_usd + EXCLUDED.saldo_usd");
    expect(corpo).toContain("jsonb_build_object('uso_id', _uso_id, 'saldo_usd', _saldo)");
    expect(migracao).toMatch(/REVOKE ALL ON FUNCTION public\.ia_registrar_uso\([^)]*\) FROM PUBLIC, anon, authenticated;/);
    expect(migracao).toMatch(/GRANT EXECUTE ON FUNCTION public\.ia_registrar_uso\([^)]*\) TO service_role;/);
  });

  it("saldo e consumo exigem equipe com acesso ao cliente", () => {
    expect(funcao("ia_saldo")).toContain("PERFORM app_private.require_rpc_client_staff(_client_id);");
    const consumo = funcao("ia_consumo_cliente");
    expect(consumo).toContain("PERFORM app_private.require_rpc_client_staff(_client_id);");
    expect(consumo).toContain("'por_modelo'");
    expect(consumo).toContain("'por_tarefa'");
    expect(consumo).toContain("AT TIME ZONE 'America/Sao_Paulo'");
    for (const nome of ["ia_carteira_recarregar", "ia_saldo", "ia_consumo_cliente", "mesa_storage_acesso"]) {
      expect(migracao).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${nome}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
    for (const nome of ["ia_carteira_recarregar", "ia_registrar_uso", "ia_saldo", "ia_consumo_cliente", "mesa_storage_acesso"]) {
      expect(funcao(nome)).toContain("SECURITY DEFINER\nSET search_path TO ''");
    }
  });

  it("bucket mesa privado, com acesso pela primeira pasta (id do cliente)", () => {
    expect(migracao).toContain("VALUES ('mesa', 'mesa', false)\nON CONFLICT (id) DO UPDATE\nSET public = false;");
    const acesso = funcao("mesa_storage_acesso");
    expect(acesso).toContain("public.is_staff(auth.uid())");
    expect(acesso).toContain("public.try_uuid((storage.foldername(_name))[1])");
    expect(acesso).toContain("public.can_access_client(_client_id)");
    for (const politica of ["mesa: equipe le", "mesa: equipe envia", "mesa: equipe altera", "mesa: equipe apaga"]) {
      expect(migracao).toContain(`CREATE POLICY "${politica}"\nON storage.objects`);
    }
    const politicasMesa = migracao.match(/storage\.objects\.bucket_id = 'mesa'\n  AND public\.mesa_storage_acesso\(storage\.objects\.name\)/g) ?? [];
    expect(politicasMesa).toHaveLength(5);
  });

  it("semeia os dois prompts globais v1 ativos com o texto exato de docs", () => {
    // O hash e o do arquivo de docs no dia da semeadura (LF, UTF-8). Enquanto
    // o arquivo existir no checkout, o texto tambem e comparado inteiro.
    const semeados: Array<[string, string, string]> = [
      ["estrategista", "docs/mesa-do-cliente/prompts/estrategista-editorial.md",
        "9e99e2ed537f3779345964d2a850c25e475c844ecf043523349c96662f6975bf"],
      ["diretor_arte", "docs/mesa-do-cliente/prompts/diretor-de-arte.md",
        "65beb454494c259cd2b6b994da8547e6569d1f558bfd4e642b325c49e76dc736"],
    ];
    for (const [agente, arquivo, sha256] of semeados) {
      const texto = promptSemeado(agente);
      expect(createHash("sha256").update(texto, "utf8").digest("hex"), agente).toBe(sha256);
      if (existsSync(resolve(raiz, arquivo))) {
        expect(texto, agente).toBe(ler(arquivo));
      }
    }
    expect(migracao).toContain("WHERE agente = 'estrategista' AND client_id IS NULL AND versao = 1");
    expect(migracao).toContain("WHERE agente = 'diretor_arte' AND client_id IS NULL AND versao = 1");
    // Um ativo por agente e escopo; o global usa o uuid zero no indice.
    expect(migracao).toContain("CREATE UNIQUE INDEX agente_prompts_um_ativo");
  });

  it("sem travessao na migration", () => {
    expect(migracao).not.toMatch(/[–—]/);
  });
});

/**
 * 2026-09-22, secao 2.1 do SPEC: chave de API propria por cliente, com cota
 * do mes. O segredo mora so no Vault; resolver a chave e so do backend; salvar,
 * trocar cota, desativar, listar e configurar e so de admin ou manager.
 */
const chaves = ler("supabase/migrations/20260922122000_ia_chaves_por_cliente.sql");

function funcaoChaves(nome: string): string {
  const inicio = chaves.search(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${nome}\\(`));
  expect(inicio, `funcao ${nome} ausente`).toBeGreaterThanOrEqual(0);
  const fim = chaves.indexOf("$body$;", inicio);
  return chaves.slice(inicio, fim);
}

const GESTAO = ["ia_chave_salvar", "ia_chave_cota", "ia_chave_desativar", "ia_chaves_listar", "ia_cliente_config_salvar"];

describe("mesa do cliente: chaves de API por cliente e cotas", () => {
  it("segredo so no Vault: a tabela guarda ponteiro e final, nunca a chave", () => {
    const inicio = chaves.indexOf("CREATE TABLE public.ia_chaves_cliente (");
    const tabela = chaves.slice(inicio, chaves.indexOf("\n);", inicio));
    expect(tabela).toContain("vault_secret_id uuid NOT NULL UNIQUE");
    expect(tabela).toContain("final_chave text NOT NULL CHECK (char_length(final_chave) BETWEEN 1 AND 4)");
    expect(tabela).not.toMatch(/\b(segredo|chave|api_key|secret)\s+text\b/);

    const salvar = funcaoChaves("ia_chave_salvar");
    expect(salvar).toContain("SELECT vault.create_secret(");
    expect(salvar).toContain("PERFORM vault.update_secret(_atual.vault_secret_id, _segredo, NULL, NULL, NULL);");
    expect(salvar).toContain("SET final_chave = right(_segredo, 4)");
    // O retorno de salvar nao carrega o segredo.
    expect(salvar.slice(salvar.indexOf("RETURN ("))).not.toContain("_segredo");

    // Nem o ponteiro do Vault vai ao navegador: grant por coluna sem ele.
    expect(chaves).toMatch(/GRANT SELECT \(\n  id, client_id, provedor, rotulo, final_chave, cota_mensal_usd,\n  ativa, criado_por, criado_em, atualizado_em\n\) ON public\.ia_chaves_cliente TO authenticated;/);
    expect(chaves).toContain("FROM PUBLIC, anon, authenticated, service_role;");

    // Desativar inutiliza o segredo; apagar a linha apaga o segredo.
    expect(funcaoChaves("ia_chave_desativar")).toContain("'revogada:' || gen_random_uuid()::text");
    expect(chaves).toContain("DELETE FROM vault.secrets WHERE id = OLD.vault_secret_id;");
  });

  it("resolver e o unico caminho que le o segredo, e e so do backend", () => {
    expect(chaves.split("vault.decrypted_secrets").length - 1).toBe(1);
    const resolver = funcaoChaves("ia_chave_resolver");
    expect(resolver).toContain("JOIN vault.decrypted_secrets AS segredo ON segredo.id = chave.vault_secret_id");
    expect(resolver).toContain("IF NOT app_private.rpc_trusted_backend() THEN");
    expect(resolver.indexOf("rpc_trusted_backend")).toBeLessThan(resolver.indexOf("decrypted_secret"));
    expect(resolver).toContain("RETURN COALESCE(_resultado, '{}'::jsonb);");
    expect(chaves).toContain("REVOKE ALL ON FUNCTION public.ia_chave_resolver(uuid, text) FROM PUBLIC, anon, authenticated;");
    expect(chaves).toContain("GRANT EXECUTE ON FUNCTION public.ia_chave_resolver(uuid, text) TO service_role;");
    // Nenhuma RPC de gestao (acessivel a authenticated) devolve o segredo.
    for (const nome of GESTAO) {
      const corpo = funcaoChaves(nome);
      expect(corpo, nome).not.toContain("decrypted_secret");
      expect(corpo, nome).not.toContain("'segredo'");
    }
  });

  it("salvar, cota, desativar, listar e configurar: so admin ou manager, nunca o backend sozinho", () => {
    const guarda = chaves.slice(
      chaves.indexOf("CREATE OR REPLACE FUNCTION app_private.ia_exigir_gestor_de_chaves"),
      chaves.indexOf("$body$;", chaves.indexOf("CREATE OR REPLACE FUNCTION app_private.ia_exigir_gestor_de_chaves")),
    );
    expect(guarda).toContain("COALESCE(public.has_role(_ator, 'admin'::public.app_role), false)");
    expect(guarda).toContain("COALESCE(public.has_role(_ator, 'manager'::public.app_role), false)");
    expect(guarda).toContain("AND COALESCE(public.can_access_client(_client_id), false)");
    expect(guarda).toContain("IA_CHAVES_SO_ADMIN_OU_MANAGER");
    expect(guarda).not.toContain("rpc_trusted_backend");
    for (const nome of GESTAO) {
      const corpo = funcaoChaves(nome);
      expect(corpo, nome).toContain("PERFORM app_private.ia_exigir_gestor_de_chaves(");
      expect(corpo, nome).not.toContain("rpc_trusted_backend");
      expect(corpo, nome).toContain("SECURITY DEFINER\nSET search_path TO ''");
    }
    expect(chaves).toContain("CREATE UNIQUE INDEX ia_chaves_cliente_uma_ativa\n  ON public.ia_chaves_cliente (client_id, provedor)\n  WHERE ativa;");
    // Leitura direta da tabela tambem so para admin e manager.
    expect(chaves).toContain("CREATE POLICY ia_chaves_cliente_gestor_le");
    expect(chaves).not.toMatch(/CREATE POLICY \w+\s+ON public\.ia_chaves_cliente\s+FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("uso registra a origem da chave e nunca aceita chave de outro cliente", () => {
    expect(chaves).toContain("ADD COLUMN chave_origem text CHECK (chave_origem IN ('cliente', 'agencia'))");
    expect(chaves).toContain("ADD COLUMN chave_id uuid REFERENCES public.ia_chaves_cliente(id) ON DELETE SET NULL");
    const uso = funcaoChaves("ia_registrar_uso");
    expect(uso).toContain("IF NOT app_private.rpc_trusted_backend() THEN");
    expect(uso).toContain("IA_CHAVE_DE_OUTRO_CLIENTE");
    expect(uso).toContain("WHERE chave.id = _chave_id AND chave.client_id = _client_id");
    expect(chaves).toMatch(/REVOKE ALL ON FUNCTION public\.ia_registrar_uso\([^)]*text, uuid\n\) FROM PUBLIC, anon, authenticated;/);
    expect(chaves).toMatch(/GRANT EXECUTE ON FUNCTION public\.ia_registrar_uso\([^)]*text, uuid\n\) TO service_role;/);
  });

  it("sem travessao na migration", () => {
    expect(chaves).not.toMatch(/[–—]/);
  });
});
