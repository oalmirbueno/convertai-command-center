// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Frente CON (30/09): contratos de leitura do código e das migrations. O
 * banco guarda as travas (hash conferido, texto congelado imutável, versão
 * nova mata o link, só o servidor escreve); as funções usam as RPCs.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const guarda = ler("supabase/migrations/20260930030100_contratos_congelados.sql");
const tabelas = ler("supabase/migrations/20260930030000_contratos_modelos.sql");
const funcao = ler("supabase/functions/contratos/index.ts");
const publico = ler("supabase/functions/contract-public/index.ts");
const email = ler("supabase/functions/send-contract-email/index.ts");
const config = ler("supabase/config.toml");

describe("contratos: hash e congelamento no banco", () => {
  it("congelar exige o hash conferido pelo próprio banco (sha256 do texto em UTF-8)", () => {
    expect(guarda).toContain("encode(sha256(convert_to(NEW.documento_texto, 'UTF8')), 'hex')");
    expect(guarda).toContain("congelar exige o texto, o hash conferido e o PDF congelado");
    expect(guarda).toContain("contrato de modelo só é enviado congelado");
  });

  it("o texto congelado não muda nem por RPC; mudar é versão nova", () => {
    const i = guarda.indexOf("O texto congelado não muda, nem por RPC.");
    const j = guarda.indexOf("IF _trusted THEN");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(guarda).toContain("contrato congelado não muda: crie uma versão nova");
  });

  it("pela tela, contrato de modelo só muda título e descrição; o resto passa pela função", () => {
    expect(guarda).toContain("contrato de modelo é criado pela função contratos");
    expect(guarda).toContain("(to_jsonb(NEW) - 'title' - 'description' - 'updated_at')");
  });

  it("versão nova invalida o link antigo (status substituido, que o link público recusa)", () => {
    expect(guarda).toContain("SET status = 'substituido', substituido_por = _n.id");
    expect(guarda).toContain("só contrato enviado e ainda não assinado pelo cliente é substituído");
    expect(funcao).toContain('servico().rpc("contrato_substituir"');
    expect(publico).toContain('contract.status === "substituido"');
    expect(publico).toContain(', 410);');
  });

  it("assinatura do cliente confere o hash que ele viu e vai para Arquivos pelo caminho de sempre", () => {
    expect(guarda).toContain("_c.documento_hash IS DISTINCT FROM lower(btrim(COALESCE(p_hash_visto, '')))");
    expect(guarda).toContain("_file := public.complete_contract_signature(p_token, _nome, p_ip);");
    expect(publico).toContain('"contrato_concluir_assinatura"');
    expect(publico).toContain("hashVisto !== contract.documento_hash");
    // O caminho antigo (PDF enviado) continua igual.
    expect(publico).toContain('"complete_contract_signature"');
  });

  it("RPCs só para o servidor; trilha só de acréscimo; leitura por can_access_client", () => {
    for (const f of ["contrato_substituir(uuid, uuid, uuid)", "contrato_arquivar(uuid, uuid, text)"]) {
      expect(guarda).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`);
      expect(guarda).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO service_role;`);
    }
    expect(guarda).toContain("a trilha do contrato só recebe eventos novos");
    expect(guarda).toContain("USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id))");
    expect(tabelas).toContain("ENABLE ROW LEVEL SECURITY");
    expect(tabelas).toContain("cláusula publicada não muda: publique uma versão nova do modelo");
    // Apagar é arquivar: cancelar mata o link, o assinado só arquiva.
    expect(guarda).toContain("_cancelar := _c.status IN ('draft', 'sent') AND _c.client_signed_at IS NULL;");
  });
});

describe("contratos: a função", () => {
  it("sem os dados da agência não gera contrato", () => {
    expect(funcao).toContain("Sem os dados da agência o contrato não é gerado.");
    // Frente BASE: a ficha da agência e a qualificação da contratada vêm de _shared/dados-da-agencia.ts.
    expect(funcao).toContain('await exigirDadosDaAgencia(servico(), "contrato");');
    expect(funcao).toContain("qualificacao: qualificacaoDaContratada(base)");
    expect(funcao.split("await exigirAgencia();").length).toBe(3);
    // Papel "contrato" da frente BASE: modelo, tarefa e agente.
    expect(funcao).toContain('modeloDoPapel("contrato"');
    expect(funcao).toContain('const AGENTE = "contrato" as const;');
  });

  it("variável faltando bloqueia o congelamento", () => {
    expect(funcao).toContain("const pode = podeCongelar(montado);");
    expect(funcao).toContain('"variaveis_faltando"');
  });

  it("gera do aceite lendo proposta_eventos, sem duplicar contrato", () => {
    expect(funcao).toContain('.from("proposta_eventos")');
    expect(funcao).toContain('throw new ErroHttp(409, "proposta_nao_aceita"');
    expect(funcao).toContain("ja_existia: true");
  });

  it("reescrita de cláusula só com a diferença do cartão", () => {
    expect(funcao).toContain("Sem a diferença mostrada no cartão, a cláusula não muda.");
    expect(funcao).toContain("A cláusula mudou depois do cartão.");
  });

  it("nada é enviado sozinho: o agente não congela, não assina e não envia", () => {
    expect(funcao).not.toContain("send-contract-email");
    expect(funcao).not.toMatch(/sendResendEmail|api\.autentique/);
    expect(funcao).toContain("Você não assina, não congela, não envia e não cancela contrato");
  });

  it("registrada com JWT e o envio por e-mail entra na trilha", () => {
    expect(config).toMatch(/\[functions\.contratos\]\s+verify_jwt = true/);
    expect(email).toContain('tipo: "enviado_email"');
    expect(email).toContain('"contract must be frozen before sending"');
  });

  it("o link público não expõe IP nem e-mail de quem assinou no contrato de arquivo", () => {
    const antigo = publico.slice(publico.indexOf("// Só os campos de sempre"));
    expect(antigo.slice(0, 800)).not.toContain("admin_signature_ip");
    expect(antigo.slice(0, 800)).not.toContain("admin_signature_email");
  });
});
