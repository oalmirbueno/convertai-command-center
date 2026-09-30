// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cacheValido,
  cnpjValido,
  cpfValido,
  documentoInvalido,
  erroDaConsulta,
  faltasNaFicha,
  fichaDaBrasilApi,
  fichaVazia,
  lerFicha,
  mesclarFicha,
  nomeLegivel,
  valoresDaFicha,
} from "../../supabase/functions/_shared/contrato-ficha";
import {
  diasEntre,
  efeitosDosAditivos,
  faltamAssinar,
  mensagemDeLembrete,
  montarAditivo,
  numeroDoAditivo,
  painelDosContratos,
  servicosDaFicha,
  somarMeses,
  validarSignatarios,
  valoresDaRenovacao,
  variaveisDoAditivo,
  vigenciaDoContrato,
  type LinhaDoPainel,
} from "../../supabase/functions/_shared/contrato-ciclo";
import { conferirRascunhoDoModelo, lerRascunhoDoModelo, resumoDaMudanca, revisaoDaVersaoNova } from "../../supabase/functions/_shared/contrato-editor";
import {
  lerDocumento,
  linhasDosSignatarios,
  montarContrato,
  podeCongelar,
  valoresComPadrao,
  valoresDoCliente,
  variaveisDoContrato,
  type DadosDaAgencia,
  type ServicoDoContrato,
  type Valores,
} from "../../supabase/functions/_shared/contrato-modelo";
import { MODELOS_V1, CONDICOES_GERAIS_V1 } from "../../supabase/functions/_shared/contrato-modelo-v1";
import { ADITIVO_V1, EXTRAS_V1, MODELOS_EXTRAS_V1 } from "../../supabase/functions/_shared/contrato-modelo-extras-v1";
import { dadosDaCapa, gerarPdfDoContrato, paginasDoPdf, textosDoPdf } from "../../supabase/functions/_shared/pdf-contrato";
import { quemAssinaNoPdf } from "../../supabase/functions/_shared/contrato-assinaturas";
import { alvosDoAgente, mapearProposta, normalizarAcoesDosContratos, regrasDasOperacoes, valorSemFonte, type ContextoDasRegras } from "../../supabase/functions/contratos/regras";
import { referenciaDas } from "../../supabase/functions/_shared/preencher-com-ia";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { campoDaClausula, camposDasVariaveis, valoresDaIA } from "@/lib/contratos/preencher";

/**
 * Frente CON2 (30/09): ficha fiscal com CNPJ pela BrasilAPI, gerar do
 * cliente, aditivo, renovação e vencimento, mais de um signatário e
 * testemunhas, biblioteca de cláusulas extras, editor de modelos, painel,
 * lembrete com mensagem pronta, PDF com capa e o "Preencher com IA" sem
 * inventar valor, prazo nem cláusula.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const CNPJ = "11222333000181";
const CPF = "52998224725";
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const CONTRATO = "22222222-2222-4222-8222-222222222222";

const AGENCIA: DadosDaAgencia = {
  razao_social: "Aceleriq Marketing Ltda",
  nome_fantasia: "Aceleriq",
  cnpj: "12.345.678/0001-90",
  endereco: "Rua das Flores, 100, Centro",
  cidade: "Londrina",
  uf: "PR",
  representante: "Almir Bueno",
  representante_cpf: "",
  email: "contato@aceleriq.com.br",
  foro: "Londrina/PR",
};

const MODELOS = MODELOS_V1.concat(MODELOS_EXTRAS_V1);

function completos(servicos: ServicoDoContrato[], extra: Valores = {}): Valores {
  const base: Valores = {
    ...valoresDoCliente({ nome: "Padaria Pão Bom Ltda", documento: CNPJ, endereco: "Av. Brasil, 500, Curitiba/PR", email: "dono@paobom.com.br", representante: "Maria Silva" }),
    inicio: "2026-10-01",
    valor_hora_extra: "180",
    valor_mensal: "3500",
    vencimento_dia: "10",
    vigencia_meses: "12",
    social_perfis: "@paobom no Instagram",
    social_pecas_mes: "8 carrosséis e 4 reels",
    ...extra,
  };
  return valoresComPadrao(variaveisDoContrato(MODELOS, servicos), base);
}

// ------------------------------------------------------------------ ficha fiscal

describe("CON2: ficha fiscal e CNPJ", () => {
  it("confere os dígitos de CNPJ e CPF (código, nunca o modelo)", () => {
    expect(cnpjValido(CNPJ)).toBe(true);
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
    expect(cpfValido(CPF)).toBe(true);
    expect(cpfValido("52998224726")).toBe(false);
    expect(documentoInvalido("123")).toBe("use 14 dígitos (CNPJ) ou 11 (CPF)");
    expect(documentoInvalido("")).toBeNull();
  });

  it("lê a resposta da BrasilAPI: representante do QSA, MEI, endereço e avisos; nada inventado", () => {
    const r = fichaDaBrasilApi({
      cnpj: CNPJ,
      razao_social: "PADARIA PAO BOM LTDA",
      nome_fantasia: "PAO BOM",
      descricao_tipo_de_logradouro: "AVENIDA",
      logradouro: "BRASIL",
      numero: "500",
      complemento: "SALA 2",
      bairro: "CENTRO",
      municipio: "CURITIBA",
      uf: "pr",
      cep: "80000-000",
      ddd_telefone_1: "4133334444",
      email: "Contato@PaoBom.com.br",
      descricao_situacao_cadastral: "ATIVA",
      opcao_pelo_mei: false,
      qsa: [{ nome_socio: "JOAO SOCIO", qualificacao_socio: "Sócio" }, { nome_socio: "MARIA SILVA", qualificacao_socio: "Sócio-Administrador" }],
    });
    expect(r.ficha.razao_social).toBe("Padaria Pao Bom Ltda");
    expect(r.ficha.logradouro).toBe("Avenida Brasil");
    expect(r.ficha.uf).toBe("PR");
    expect(r.ficha.cep).toBe("80000000");
    expect(r.ficha.representante_nome).toBe("Maria Silva");
    expect(r.ficha.representante_cpf).toBe("");
    expect(r.ficha.email_contrato).toBe("contato@paobom.com.br");
    expect(r.ficha.tipo_pessoa).toBe("pj");
    expect(r.ficha.telefone).toBe("(41) 3333-4444");
    expect(r.avisos).toEqual([]);
    const semSocio = fichaDaBrasilApi({ cnpj: CNPJ, razao_social: "X LTDA", opcao_pelo_mei: true, descricao_situacao_cadastral: "BAIXADA", qsa: [] });
    expect(semSocio.ficha.tipo_pessoa).toBe("mei");
    expect(semSocio.ficha.representante_nome).toBe("");
    expect(semSocio.avisos.join(" ")).toContain("sócio administrador");
    expect(semSocio.avisos.join(" ")).toContain("BAIXADA");
    expect(semSocio.avisos.join(" ")).toContain("e-mail");
  });

  it("mescla sem apagar o que a equipe escreveu (só completa o vazio, salvo substituir)", () => {
    const atual = lerFicha({ ...fichaVazia(), documento: CNPJ, razao_social: "Nome que a equipe escreveu", email_contrato: "financeiro@x.com" });
    const nova = lerFicha({ ...fichaVazia(), documento: CNPJ, razao_social: "Da Receita", cidade: "Curitiba" });
    const m = mesclarFicha(atual, nova);
    expect(m.ficha.razao_social).toBe("Nome que a equipe escreveu");
    expect(m.ficha.cidade).toBe("Curitiba");
    expect(m.mudaram).toEqual(["cidade"]);
    expect(mesclarFicha(atual, nova, true).ficha.razao_social).toBe("Da Receita");
  });

  it("a ficha vira os cliente_* do contrato, e diz o que falta", () => {
    const f = lerFicha({ ...fichaVazia(), tipo_pessoa: "pj", documento: CNPJ, razao_social: "Padaria Pão Bom Ltda", logradouro: "Av. Brasil", numero: "500", cidade: "Curitiba", uf: "PR", cep: "80000000", representante_nome: "Maria Silva", representante_cpf: CPF, representante_cargo: "Sócia-Administradora", email_contrato: "dono@paobom.com.br" });
    const v = valoresDaFicha(f);
    expect(v.cliente_documento).toBe("11.222.333/0001-81");
    expect(v.cliente_endereco).toBe("Av. Brasil, 500, Curitiba/PR, CEP 80000-000");
    expect(v.cliente_representante).toBe("Maria Silva, CPF 529.982.247-25, sócia-administradora");
    expect(v.cliente_tipo_pessoa).toBe("pj");
    expect(faltasNaFicha(f)).toEqual([]);
    expect(faltasNaFicha(fichaVazia())).toEqual(["CNPJ ou CPF", "razão social ou nome completo", "endereço", "representante legal", "e-mail para contrato"]);
    expect(nomeLegivel("SERVICOS DE DESIGN E MARKETING EIRELI")).toBe("Servicos de Design e Marketing EIRELI");
  });

  it("cache de 30 dias e erro claro para cada falha da consulta", () => {
    const agora = new Date("2026-09-30T12:00:00Z");
    expect(cacheValido("2026-09-10T12:00:00Z", agora)).toBe(true);
    expect(cacheValido("2026-08-01T12:00:00Z", agora)).toBe(false);
    expect(cacheValido(null, agora)).toBe(false);
    expect(erroDaConsulta(404).codigo).toBe("cnpj_nao_encontrado");
    expect(erroDaConsulta(429).mensagem).toContain("preencha à mão");
    expect(erroDaConsulta(500).http).toBe(503);
  });

  it("a consulta roda no servidor, com cache, e a ficha só é gravada pela função (RLS por cliente)", () => {
    const ficha = ler("supabase/functions/contratos/ficha.ts");
    expect(ficha).toContain("https://brasilapi.com.br/api/cnpj/v1/${cnpj}");
    expect(ficha).toContain('from("cnpj_consultas")');
    expect(ficha).toContain("AbortSignal.timeout(9000)");
    expect(ficha).toContain("await garantirGestao(ch, clientId);");
    const sql = ler("supabase/migrations/20260930195000_contratos_ficha_fiscal.sql");
    expect(sql).toContain("USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id))");
    expect(sql).toContain("REVOKE ALL ON public.cnpj_consultas FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|ALL) ON public\.cliente_dados_fiscais TO authenticated/);
    // A tela nunca chama a BrasilAPI direto.
    expect(ler("src/components/contratos/DadosFiscaisDoCliente.tsx")).not.toContain("brasilapi.com.br");
  });
});

// ------------------------------------------------------------------ biblioteca de cláusulas extras

describe("CON2: cláusulas extras que o dono liga ou desliga", () => {
  it("desligadas, o texto do contrato fica igual ao de antes (contratos já montados não mudam)", () => {
    const valores = completos(["social"]);
    const sem = montarContrato({ modelos: MODELOS_V1, servicos: ["social"], valores, agencia: AGENCIA, numero: "CT-2026-0001", versao: 1, data: "2026-09-30" });
    const com = montarContrato({ modelos: MODELOS, servicos: ["social"], valores, agencia: AGENCIA, numero: "CT-2026-0001", versao: 1, data: "2026-09-30" });
    expect(com.texto).toBe(sem.texto);
    expect(valores.extra_sla).toBe("nao");
  });

  it("ligada, entra em Cláusulas adicionais com a numeração seguindo as condições gerais e pede o parâmetro", () => {
    const valores = completos(["social"], { extra_sla: "sim", extra_exclusividade: "sim", extra_exclusividade_segmento: "padarias artesanais" });
    const m = montarContrato({ modelos: MODELOS, servicos: ["social"], valores, agencia: AGENCIA, numero: "CT-2026-0001", versao: 1, data: "2026-09-30" });
    const gerais = m.clausulas.filter((c) => c.modelo === "condicoes_gerais").length;
    const extras = m.clausulas.filter((c) => c.modelo === "clausulas_extras");
    expect(m.texto).toContain("## Cláusulas adicionais");
    expect(extras.map((c) => c.numero)).toEqual([`${gerais + 1}`, `${gerais + 2}`]);
    expect(m.faltando.map((f) => f.nome)).toEqual(expect.arrayContaining(["extra_sla_horas", "extra_exclusividade_regiao"]));
    expect(podeCongelar(m).pode).toBe(false);
    const ok = montarContrato({ modelos: MODELOS, servicos: ["social"], valores: { ...valores, extra_sla_horas: "4", extra_exclusividade_regiao: "Curitiba/PR" }, agencia: AGENCIA, numero: "CT-2026-0001", versao: 1, data: "2026-09-30" });
    expect(ok.texto).toContain("4 (quatro) horas úteis");
    expect(podeCongelar(ok).pode).toBe(true);
  });

  it("o seed da migration tem o mesmo texto do arquivo (fonte única)", () => {
    const sql = ler("supabase/migrations/20260930195200_contratos_extras_e_aditivo_v1.sql");
    for (const m of MODELOS_EXTRAS_V1) {
      expect(sql).toContain(`'${m.chave}'`);
      for (const c of m.clausulas) expect(sql, `${m.chave}:${c.chave}`).toContain(`'${c.texto.replace(/'/g, "''")}'`);
    }
    expect((sql.match(/ON CONFLICT \(chave, versao\) DO NOTHING;/g) || []).length).toBe(MODELOS_EXTRAS_V1.length);
    for (const m of MODELOS_EXTRAS_V1) for (const c of m.clausulas) expect(/[—–]/.test(c.texto), `${m.chave}:${c.chave}`).toBe(false);
  });
});

// ------------------------------------------------------------------ quem assina

describe("CON2: mais de um signatário e testemunhas", () => {
  it("valida a lista: e-mail, CPF da testemunha, principal e limites", () => {
    const ok = validarSignatarios([
      { papel: "contratante", nome: "Maria Silva", email: "maria@paobom.com.br" },
      { papel: "contratante", nome: "João Sócio", email: "joao@paobom.com.br", obrigatorio: false },
      { papel: "testemunha", nome: "Ana Testemunha", email: "ana@x.com", documento: CPF },
    ]);
    expect(ok.erros).toEqual([]);
    expect(ok.lista[0].principal).toBe(true);
    expect(ok.lista[1].obrigatorio).toBe(false);
    expect(faltamAssinar(ok.lista).map((s) => s.nome)).toEqual(["Maria Silva", "Ana Testemunha"]);
    const ruim = validarSignatarios([
      { papel: "testemunha", nome: "Só Testemunha", email: "a@x.com" },
      { papel: "testemunha", nome: "Outra", email: "a@x.com", documento: "11111111111" },
      { papel: "testemunha", nome: "Terceira", email: "b@x", documento: CPF },
    ]);
    expect(ruim.erros.join(" ")).toContain("testemunha precisa do CPF");
    expect(ruim.erros.join(" ")).toContain("e-mail repetido");
    expect(ruim.erros.join(" ")).toContain("CPF inválido");
    expect(ruim.erros.join(" ")).toContain("e-mail inválido");
    expect(ruim.erros.join(" ")).toContain("pelo menos uma pessoa que assina pelo contratante");
    expect(ruim.erros.join(" ")).toContain("No máximo 2 testemunhas");
  });

  it("a lista entra no texto (e no hash) e vira linhas de assinatura no PDF", () => {
    const linhas = linhasDosSignatarios([{ papel: "contratante", nome: "Maria Silva", email: "maria@x.com" }, { papel: "testemunha", nome: "Ana", documento: CPF }]);
    expect(linhas).toEqual(["- Pelo CONTRATANTE: Maria Silva, maria@x.com.", "- Testemunha: Ana, CPF 529.982.247-25."]);
    const q = quemAssinaNoPdf({ agencia: "Aceleriq", representanteDaAgencia: "Almir Bueno", signatarios: [{ papel: "contratante", nome: "Maria", email: "m@x.com", documento: null }, { papel: "testemunha", nome: "Ana", email: "a@x.com", documento: CPF }] });
    expect(q.map((x) => x.papel)).toEqual(["Pela contratada", "Pelo contratante", "Testemunha"]);
    expect(q[2].detalhe).toBe("CPF 529.982.247-25");
  });

  it("no banco: lista travada depois de congelar, assinatura única por pessoa, e-mail cadastrado e hash conferido", () => {
    const sql = ler("supabase/migrations/20260930195100_contratos_ciclo_e_signatarios.sql");
    expect(sql).toContain("contrato congelado: a lista de quem assina não muda");
    expect(sql).toContain("assinatura registrada não muda");
    expect(sql).toContain("use o e-mail cadastrado para esta assinatura");
    expect(sql).toContain("_c.documento_hash IS DISTINCT FROM lower(btrim(COALESCE(p_hash_visto, '')))");
    expect(sql).toContain("_file := public.complete_contract_signature(_c.sign_token, _p.assinatura_nome, COALESCE(_p.assinatura_ip, 'unknown'));");
    expect(sql).toContain("RAISE EXCEPTION 'faltam assinaturas';");
    for (const f of ["contrato_assinar_signatario(text, text, text, text, text, text, timestamptz)", "contrato_concluir_com_signatarios(uuid, text, text, text)", "contrato_modelo_publicar(text, text, jsonb, jsonb, text, uuid)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO service_role;`);
    }
    expect(sql).toContain("USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));");
  });

  it("o link público assina pela RPC e fecha com todos; nunca grava direto em contracts nem em files", () => {
    const pub = ler("supabase/functions/contract-public/index.ts");
    expect(pub).toContain('supabase.rpc("contrato_assinar_signatario"');
    expect(pub).toContain("fecharComSignatarios(supabase, contract.id");
    expect(pub).not.toMatch(/\.from\(\s*["']contracts["']\s*\)\s*\.update\s*\(/);
    const fechar = ler("supabase/functions/_shared/contrato-assinaturas.ts");
    expect(fechar).toContain('sb.rpc("contrato_concluir_com_signatarios"');
    expect(fechar).not.toMatch(/\.from\(\s*["'](contracts|files)["']\s*\)\s*\.(update|insert)\s*\(/);
  });
});

// ------------------------------------------------------------------ vigência, painel, lembrete, renovação

const linha = (x: Partial<LinhaDoPainel>): LinhaDoPainel => ({ id: "a", client_id: CLIENTE, title: "Social", numero: "CT-2026-0001", versao: 1, status: "completed", origem: "modelo", servicos: ["social"], variaveis: { inicio: "2025-10-01", vigencia_meses: "12", valor_mensal: "3500" }, ...x });

describe("CON2: vigência, painel e lembrete", () => {
  it("vigência de serviço mensal: do início até a véspera do mesmo dia N meses depois", () => {
    expect(vigenciaDoContrato({ inicio: "2026-10-01", vigencia_meses: "12" }, ["social"])).toEqual({ inicio: "2026-10-01", fim: "2027-09-30", recorrente: true });
    expect(vigenciaDoContrato({ inicio: "2026-10-01" }, ["site"]).fim).toBeNull();
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(diasEntre("2026-09-30", "2026-10-02")).toBe(2);
  });

  it("painel: a vencer (com renovação pronta), pendentes há N dias, assinados no mês e recorrente com o aditivo que mudou o valor", () => {
    const hoje = "2026-09-20";
    const lista: LinhaDoPainel[] = [
      linha({ id: "vence", client_signed_at: "2025-09-28T15:00:00Z" }),
      linha({ id: "longe", variaveis: { inicio: "2026-09-01", vigencia_meses: "12", valor_mensal: "2000" }, client_signed_at: "2026-09-02T15:00:00Z" }),
      linha({ id: "aditivo", tipo_documento: "aditivo", contrato_mae_id: "longe", variaveis: { aditivo_valor_mensal_novo: "2500", aditivo_inicio_efeitos: "2026-09-10" }, client_signed_at: "2026-09-09T15:00:00Z" }),
      linha({ id: "renov", status: "draft", renovacao_de: "vence", variaveis: {} }),
      linha({ id: "pendente", status: "sent", sent_at: "2026-09-15T12:00:00Z", variaveis: {} }),
      linha({ id: "site", servicos: ["site"], variaveis: { inicio: "2026-08-01", valor_total: "9000" }, client_signed_at: "2026-08-02T12:00:00Z" }),
    ];
    const p = painelDosContratos(lista, hoje, 30);
    expect(p.aVencer.map((x) => [x.id, x.dias, x.renovacao_id])).toEqual([["vence", 10, "renov"]]);
    expect(p.pendentes.map((x) => [x.id, x.dias])).toEqual([["pendente", 5]]);
    expect(p.assinadosNoMes).toBe(2);
    expect(p.recorrenteMensal).toBe(3500 + 2500);
    expect(p.ativos).toBe(3);
    expect(efeitosDosAditivos(lista[1], lista, hoje).mensal).toBe(2500);
  });

  it("lembrete: mensagem pronta com o link e há quantos dias; nada é enviado", () => {
    const m = mensagemDeLembrete({ nome: "Maria", titulo: "Contrato de Social", link: "https://painel/contrato/abc", dias: 5, agencia: "Aceleriq" });
    expect(m.whatsapp).toContain("https://painel/contrato/abc");
    expect(m.whatsapp).toContain("desde 5 dias atrás");
    expect(m.wa_me).toContain("https://wa.me/?text=");
    expect(m.email).toContain("Aceleriq");
  });

  it("renovação começa no dia seguinte ao fim, com o valor que vale hoje, e o quadro diz o que renova", () => {
    const v = valoresDaRenovacao({ valores: completos(["social"]), numero: "CT-2026-0001", fim: "2027-09-30", valorMensal: 3800 });
    expect(v.inicio).toBe("2027-10-01");
    expect(v.valor_mensal).toBe("3800");
    const m = montarContrato({ modelos: MODELOS, servicos: ["social"], valores: v, agencia: AGENCIA, numero: "CT-2027-0009", versao: 1, data: "2027-09-01" });
    expect(m.texto).toContain("| Renovação | Renova o contrato nº CT-2026-0001, que termina em 30 de setembro de 2027.");
  });

  it("a rotina diária roda pelo cron com segredo, prepara a renovação e avisa a equipe (nada vai ao cliente)", () => {
    const cron = ler("supabase/migrations/20260930195300_contratos_rotina_vencimentos.sql");
    expect(cron).toContain("'contratos-vencimentos-diario'");
    expect(cron).toContain("jsonb_build_object('acao', 'rotina_vencimentos')");
    const funcao = ler("supabase/functions/contratos/index.ts");
    expect(funcao).toContain('req.headers.get("x-cron-secret")');
    expect(funcao).toContain('String(c.acao ?? "") !== "rotina_vencimentos"');
    const ciclo = ler("supabase/functions/contratos/ciclo.ts");
    expect(ciclo).toContain("await renovarContrato(sistema, n, l.id)");
    expect(ciclo).toContain('notification_type: "contrato"');
    expect(ciclo).not.toMatch(/send-contract-email|sendResendEmail|wa\.me\/\d/);
  });
});

// ------------------------------------------------------------------ gerar do cliente

describe("CON2: da proposta aceita (com o pacote e a forma de pagamento da frente PRO2)", () => {
  it("o valor com o desconto da opção aceita e a frase das condições saem do código da proposta", () => {
    const p = mapearProposta({
      id: "p1", client_id: CLIENTE, numero: "PR-2026-0003", titulo: "Site e social", status: "aceita",
      itens: [{ nome: "Site institucional" }], valor_total: 10000, valor_mensal: 2000, condicoes_pagamento: null,
      pagamento: { opcoes: [{ id: "a_vista", tipo: "a_vista", desconto_pct: 5, parcelas: 1, entrada_pct: 100, observacao: "PIX na aprovação." }] },
      pagamento_aceito: "a_vista",
    }, []);
    expect(p!.valorTotal).toBe(9500);
    expect(p!.valorMensal).toBe(2000);
    expect(p!.condicoes).toContain("À vista com 5% de desconto");
    expect(p!.condicoes).toContain("PIX na aprovação");
    const semOpcao = mapearProposta({ id: "p2", client_id: CLIENTE, status: "aceita", valor_total: 800, pagamento: { opcoes: [] } }, []);
    expect(semOpcao!.condicoes).toBeNull();
    expect(semOpcao!.valorTotal).toBe(800);
  });
});

describe("CON2: gerar do cliente", () => {
  it("serviços ativos da ficha viram blocos por regra fixa; o que não tem anexo vira aviso", () => {
    const r = servicosDaFicha({ social: true, trafego: true, videos_ia: true, edicao_video: true, seo: true, site: false, internal_company: true });
    expect(r.servicos).toEqual(["social", "trafego", "video"]);
    expect(r.semBloco).toEqual(["seo"]);
  });
});

// ------------------------------------------------------------------ aditivo

describe("CON2: termo aditivo ligado ao contrato-mãe", () => {
  const mae = { numero: "CT-2026-0001", versao: 2, assinado_em: "2026-09-02T15:00:00Z", hash: "a".repeat(64) };
  it("numeração, variáveis sem as do quadro e o texto com o contrato original escrito pelo código", () => {
    expect(numeroDoAditivo("CT-2026-0001", 2)).toBe("CT-2026-0001-A2");
    const vars = variaveisDoAditivo(MODELOS, ["site"]).map((v) => v.nome);
    expect(vars).toEqual(expect.arrayContaining(["cliente_nome", "aditivo_descricao", "aditivo_inicio_efeitos", "site_tipo", "direitos_site"]));
    expect(vars).not.toContain("valor_total");
    expect(vars).not.toContain("inicio");
    const valores = { ...completos(["social"]), aditivo_descricao: "Inclui 4 reels por mês.", aditivo_inicio_efeitos: "2026-11-01", aditivo_valor_mensal_novo: "4200" };
    const m = montarAditivo({ modelos: MODELOS, servicos: [], valores, agencia: AGENCIA, numero: "CT-2026-0001-A1", versao: 1, data: "2026-10-20", mae });
    expect(m.texto).toContain("# Termo aditivo ao contrato de prestação de serviços");
    expect(m.texto).toContain("| Contrato original | nº CT-2026-0001, versão 2, assinado em 2 de setembro de 2026, código aaaaaaaaaaaaaaaa.");
    expect(m.texto).toContain("o valor mensal passa a ser R$ 4.200,00 (quatro mil e duzentos reais)");
    expect(m.texto).not.toContain("Serviços incluídos");
    expect(m.texto).toContain("### 3. O que continua valendo");
    expect(podeCongelar(m).pode).toBe(true);
    expect(lerDocumento(m.texto)[0]).toEqual({ tipo: "titulo", texto: "Termo aditivo ao contrato de prestação de serviços" });
  });

  it("serviço que entra vira anexo do aditivo; sem contrato-mãe assinado não congela", () => {
    const valores = { ...completos(["social"]), aditivo_descricao: "Inclui o site institucional.", aditivo_inicio_efeitos: "2026-11-01", site_tipo: "site institucional", site_plataforma: "Next.js", site_prazo_layout_dias: "20", site_prazo_dev_dias: "20" };
    const m = montarAditivo({ modelos: MODELOS, servicos: ["site"], valores, agencia: AGENCIA, numero: "CT-2026-0001-A1", versao: 1, data: "2026-10-20", mae });
    expect(m.texto).toContain("os serviços Sites e landing pages (Anexo A)");
    expect(m.texto).toContain("## Anexo A. Sites e landing pages");
    const semMae = montarAditivo({ modelos: MODELOS, servicos: [], valores, agencia: AGENCIA, numero: "X", versao: 1, data: "2026-10-20", mae: { numero: "", versao: 1, assinado_em: null, hash: null } });
    expect(semMae.faltando.map((f) => f.nome)).toContain("contrato_mae");
  });
});

// ------------------------------------------------------------------ editor de modelos

describe("CON2: editor de modelos (versão nova, nunca editar a publicada)", () => {
  it("confere variáveis, chaves, travessão, lei revogada e se algo mudou", () => {
    const base = CONDICOES_GERAIS_V1;
    const igual = lerRascunhoDoModelo({ clausulas: base.clausulas, variaveis: base.variaveis }, base);
    expect(conferirRascunhoDoModelo(igual, base, base).erros).toContain("Nada mudou em relação à versão publicada.");
    const r = lerRascunhoDoModelo({
      clausulas: base.clausulas.concat([
        { chave: "nova", titulo: "Nova", texto: "Vale a multa de {{multa_inventada}} conforme a Lei 5.988/73 — sempre." },
        { chave: "nova", titulo: "Repetida", texto: "Texto com tamanho suficiente." },
      ]),
      variaveis: base.variaveis,
    }, base);
    const c = conferirRascunhoDoModelo(r, base, base);
    expect(c.erros.join(" ")).toContain("{{multa_inventada}} não existe");
    expect(c.erros.join(" ")).toContain("chave repetida");
    expect(c.erros.join(" ")).toContain("sem travessão");
    expect(c.erros.join(" ")).toContain("5.988/73 foi revogada");
    const texto = base.clausulas.map((x) => (x.chave === "gerais" ? { ...x, texto: `${x.texto} Vale também por e-mail.` } : x));
    const ok = lerRascunhoDoModelo({ clausulas: texto, variaveis: base.variaveis }, base);
    const r2 = conferirRascunhoDoModelo(ok, base, base);
    expect(r2.erros).toEqual([]);
    expect(r2.avisos.join(" ")).toContain("revisão jurídica pendente");
    expect(resumoDaMudanca(base, ok).alteradas).toEqual(["gerais"]);
    expect(revisaoDaVersaoNova(2, true, "v1 revisada")).toBe("v2 · revisão jurídica pendente");
    // O termo aditivo aceita os valores que o código escreve (contrato_mae_*).
    const ad = lerRascunhoDoModelo({ clausulas: ADITIVO_V1.clausulas.map((x) => (x.chave === "ratificacao" ? { ...x, texto: `${x.texto} Fim.` } : x)), variaveis: ADITIVO_V1.variaveis }, ADITIVO_V1);
    expect(conferirRascunhoDoModelo(ad, ADITIVO_V1, base).erros).toEqual([]);
    expect(EXTRAS_V1.tipo).toBe("extras");
  });

  it("publicar é RPC que desliga a anterior no mesmo passo, só admin", () => {
    const sql = ler("supabase/migrations/20260930195100_contratos_ciclo_e_signatarios.sql");
    expect(sql).toContain("UPDATE public.contrato_modelos SET ativo = false, revogado_em = now() WHERE id = _atual.id;");
    expect(sql).toContain("CHECK (tipo IN ('condicoes_gerais', 'bloco', 'extras', 'aditivo'))");
    const modelos = ler("supabase/functions/contratos/modelos.ts");
    expect(modelos).toContain("await garantirAdmin(ch);");
    expect(modelos).toContain('if (corpo.confirmar !== true) throw new ErroHttp(400, "sem_confirmacao"');
  });
});

// ------------------------------------------------------------------ PDF

describe("CON2: PDF com capa e linhas de assinatura", () => {
  it("a capa repete título, partes e o código; as linhas de quem assina saem no fim", () => {
    const valores = completos(["social"]);
    const m = montarContrato({ modelos: MODELOS, servicos: ["social"], valores, agencia: AGENCIA, numero: "CT-2026-0001", versao: 1, data: "2026-09-30" });
    const capa = dadosDaCapa(m.texto);
    expect(capa.titulo).toBe("Contrato de prestação de serviços");
    expect(capa.linhas.map((l) => l.rotulo)).toEqual(expect.arrayContaining(["Contratante", "Contratada", "Serviços", "Valor"]));
    expect(capa.linhas.find((l) => l.rotulo === "Contratante")!.texto).toBe("Padaria Pão Bom Ltda");
    const quem = [{ papel: "Pela contratada", nome: "Almir Bueno" }, { papel: "Pelo contratante", nome: "Maria Silva", detalhe: "maria@x.com" }];
    const semCapa = gerarPdfDoContrato({ texto: m.texto, numero: "CT-2026-0001", versao: 1, hash: "b".repeat(64), capa: false, quemAssina: quem });
    const comCapa = gerarPdfDoContrato({ texto: m.texto, numero: "CT-2026-0001", versao: 1, hash: "b".repeat(64), quemAssina: quem });
    expect(paginasDoPdf(comCapa)).toBe(paginasDoPdf(semCapa) + 1);
    const t = textosDoPdf(comCapa).join(" ");
    expect(t).toContain("CÓDIGO DE INTEGRIDADE (SHA-256)");
    expect(t).toContain("QUEM ASSINA");
    expect(t).toContain("Maria Silva");
    expect(textosDoPdf(gerarPdfDoContrato({ texto: m.texto, numero: "X", versao: 1 })).join(" ")).toContain("PRÉVIA, SEM VALOR DE ASSINATURA");
  });
});

// ------------------------------------------------------------------ agente e Preencher com IA

function contexto(extra: Partial<ContextoDasRegras> = {}): ContextoDasRegras {
  const vars = variaveisDoContrato(MODELOS, ["social"]);
  const porNome: ContextoDasRegras["variaveis"] = {};
  vars.forEach((v) => (porNome[v.nome] = v));
  return { agenciaFaltando: [], rascunho: true, variaveis: porNome, servicosAtuais: ["social"], clausulas: {}, ...extra };
}

describe("CON2: agente de contratos (CNPJ, aditivo, renovação; sem inventar valor)", () => {
  const alvos = alvosDoAgente({
    clientId: CLIENTE,
    contratoId: CONTRATO,
    servicosAtuais: ["social"],
    variaveis: variaveisDoContrato(MODELOS, ["social"]),
    valores: {},
    faltando: [],
    clausulas: [],
    contratos: [
      { id: "c-assinado", titulo: "Social", numero: "CT-2026-0001", status: "completed", tipo: "contrato", fim: "2027-09-30" },
      { id: "c-rascunho", titulo: "Site", numero: "CT-2026-0002", status: "draft", tipo: "contrato" },
    ],
  });
  const ref = (titulo: string) => alvos.variaveis.find((v) => v.titulo === titulo)!.ref;

  it("valor, prazo ou data que não está no pedido nem nos dados não é preenchido", () => {
    const ctx = contexto({ fontes: referenciaDas(["Contrato de social, R$ 3.500 por mês, 12 meses"]) });
    const a = normalizarAcoesDosContratos({ itens: [
      { ref: ref("Valor mensal"), operacao: "preencher", para: "3500" },
      { ref: ref("Valor da hora técnica extra"), operacao: "preencher", para: "180" },
      { ref: ref("Vigência (meses)"), operacao: "preencher", para: "12" },
    ] }, alvos, ctx, { contratoId: CONTRATO, clientId: CLIENTE })!;
    expect(a.itens.map((i) => i.para)).toEqual(["3500", "12"]);
    expect(a.recusados.map((r) => r.motivo).join(" ")).toContain("180 não aparece no pedido nem nos dados");
    expect(valorSemFonte({ nome: "inicio", rotulo: "Início", tipo: "data" }, "2027-01-15", referenciaDas(["começa em 2026"]))).toContain("2027");
  });

  it("puxar pelo CNPJ: só o CNPJ que o dono escreveu, válido, e vem antes de criar o contrato", () => {
    const ctx = contexto({ textoDasFontes: "o CNPJ é 11.222.333/0001-81", contratos: {} });
    const a = normalizarAcoesDosContratos({ itens: [
      { ref: "n1", operacao: "criar_contrato", para: "social" },
      { ref: "f1", operacao: "puxar_cnpj", para: "11.222.333/0001-81" },
    ] }, alvos, ctx, { contratoId: null, clientId: CLIENTE })!;
    expect(a.itens.map((i) => i.operacao)).toEqual(["puxar_cnpj", "criar_contrato"]);
    expect(a.itens[0].para).toBe(CNPJ);
    expect(a.itens[0].para_rotulo).toBe("CNPJ 11.222.333/0001-81");
    const inventado = normalizarAcoesDosContratos({ itens: [{ ref: "f1", operacao: "puxar_cnpj", para: "11222333000181" }] }, alvos, contexto({ textoDasFontes: "puxa pelo CNPJ" }), { contratoId: null, clientId: CLIENTE })!;
    expect(inventado.recusados[0].motivo).toContain("O CNPJ não está na conversa");
    expect(normalizarAcoesDosContratos({ itens: [{ ref: "f1", operacao: "puxar_cnpj", para: "11222333000182" }] }, alvos, ctx, { contratoId: null, clientId: CLIENTE })).toBeNull();
  });

  it("aditivo e renovação só de contrato assinado; vão direto (sem custo, com Desfazer)", () => {
    const c = (id: string) => alvos.contratos!.find((x) => x.id === id)!.ref;
    const ctx = contexto({
      contratos: {
        "c-assinado": { assinado: true, aditivo: false, temRenovacao: false, temVigencia: true, modelo: true },
        "c-rascunho": { assinado: false, aditivo: false, temRenovacao: false, temVigencia: false, modelo: true },
      },
    });
    const a = normalizarAcoesDosContratos({ itens: [
      { ref: c("c-assinado"), operacao: "criar_aditivo", para: "Inclui 4 reels por mês a partir de novembro" },
      { ref: c("c-rascunho"), operacao: "renovar" },
    ] }, alvos, ctx, { contratoId: null, clientId: CLIENTE })!;
    expect(a.itens.map((i) => [i.operacao, i.alvo_id])).toEqual([["criar_aditivo", "c-assinado"]]);
    expect(a.recusados[0].motivo).toBe("Só contrato assinado é renovado.");
    const so = normalizarAcoesDosContratos({ itens: [{ ref: c("c-assinado"), operacao: "renovar" }] }, alvos, ctx, { contratoId: null, clientId: CLIENTE })!;
    expect(podeExecutarDireto(so, regrasDasOperacoes(ctx), { pedidoClaro: true }).direto).toBe(true);
    const ja = contexto({ contratos: { "c-assinado": { assinado: true, aditivo: false, temRenovacao: true, temVigencia: true, modelo: true } } });
    expect(normalizarAcoesDosContratos({ itens: [{ ref: c("c-assinado"), operacao: "renovar" }] }, alvos, ja, { contratoId: null, clientId: CLIENTE })!.recusados[0].motivo).toContain("já tem renovação");
  });

  it("Preencher com IA: campos com a regra de não inventar; extras ficam de fora; cláusula sugerida não grava", () => {
    const vars = variaveisDoContrato(MODELOS, ["social"]);
    const campos = camposDasVariaveis(vars, { valor_mensal: "3500" });
    expect(campos.some((c) => c.chave.indexOf("extra_") === 0)).toBe(false);
    const mensal = campos.find((c) => c.chave === "valor_mensal")!;
    expect(mensal.tipo).toBe("numero");
    expect(mensal.valorAtual).toBe("3500");
    expect(mensal.dica).toContain("nunca invente valor, prazo nem data");
    expect(campos.find((c) => c.chave === "social_ciclo")!.opcoes).toEqual(["mensal", "quinzenal"]);
    expect(valoresDaIA(vars, { social_ciclo: "semanal", social_pecas_mes: "8 carrosséis", valor_mensal: 3500, nada: "x" })).toEqual({ social_pecas_mes: "8 carrosséis", valor_mensal: "3500" });
    expect(campoDaClausula({ chave: "condicoes_gerais:revisoes", numero: "5", titulo: "Revisões" }, "texto").dica).toContain("Nunca crie obrigação, valor, prazo ou multa");
    const tela = ler("src/components/contratos/PartesDoContrato.tsx");
    expect(tela).toContain('papel="contrato"');
    expect(tela).toContain("Sugestão da IA. Nada foi gravado: confira a diferença.");
    expect(tela).toContain('preenchido_ia: { modelo_id: r.modelo_id, fontes: r.fontes }');
  });
});
