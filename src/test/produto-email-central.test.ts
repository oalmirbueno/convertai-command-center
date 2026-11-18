import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { diasAteODia, lerCliente, proximoVencimento, resumoDaCentral, saudeDoCliente, type ClienteNaCentral } from "@/lib/produto/email-central";
import { agruparCaixa, colunaDaMensagem, fraseDoDia, grupoDaMensagem, horaDoCompromisso, iniciais, type MensagemDaCaixa } from "@/lib/produto/correio-dia";
import { ADAPTADORES, adaptadorPara, CorreioDesligado, envioValido } from "../../supabase/functions/produto-correio/modulos/adaptador";

/**
 * Central de e-mail e correio (18/11/2026). O banco é testado em PGlite
 * (supabase/testes/email_rota_unica_runner.mjs, 70 cenários); aqui ficam a nota de saúde,
 * os vencimentos, o contrato do correio e as convenções.
 */

const HOJE = "2026-11-18";
const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

const dominio = (x: Record<string, unknown> = {}) => ({
  id: "d1", dominio: "prix.com.br", provedor: "zoho", estado: "concluido", dns_pronto: true, dns_faltas: 0, checado_em: "2026-11-17T12:00:00Z",
  zoho_plano: "gratuito", zoho_conectado: false, cloudflare: true, dominio_vence_em: "2027-06-01", provedor_vence_em: null, provedor_custo_mensal: null,
  correio_provedor: "nenhum", correio_ligado: false, etapas_feitas: 8, etapas_total: 8, ...x,
});
const cliente = (x: Record<string, unknown> = {}): ClienteNaCentral =>
  lerCliente({
    conta_id: "c1", empresa: "Imobiliária Prix", estado_da_conta: "ativa", client_id: "cl1", email_ativo: true, liberado: true, caixas_contratadas: 5, caixas: 4, apelidos: 2,
    caixas_pedidas: 0, caixas_sem_dono: 0, dominios: [dominio()], pedido: { id: "p1", estado: "concluido", tipo: "migracao", pago_em: "2026-11-05T12:00:00Z", criado_em: "2026-11-01T12:00:00Z", valor_mensal: "39.90", extra_id: null },
    cobranca: { por: "extra", mensal: "39.90", proximo_vencimento: "2026-12-05", em_atraso: 0 }, assinatura: null, ...x,
  });

describe("dias até o dia", () => {
  it("conta dias inteiros, sem fuso", () => {
    expect(diasAteODia("2026-11-18", HOJE)).toBe(0);
    expect(diasAteODia("2026-12-18", HOJE)).toBe(30);
    expect(diasAteODia("2026-11-15", HOJE)).toBe(-3);
    expect(diasAteODia(null, HOJE)).toBeNull();
    expect(diasAteODia("amanhã", HOJE)).toBeNull();
  });
});

describe("saúde do e-mail do cliente", () => {
  it("cliente em dia é saudável e sem aviso", () => {
    const s = saudeDoCliente(cliente(), HOJE);
    expect(s.estado).toBe("saudavel");
    expect(s.avisos).toEqual([]);
  });

  it("cobrança em atraso e acesso fechado são críticos", () => {
    expect(saudeDoCliente(cliente({ cobranca: { por: "extra", mensal: 39.9, proximo_vencimento: "2026-11-05", em_atraso: 1 } }), HOJE).estado).toBe("critico");
    expect(saudeDoCliente(cliente({ liberado: false }), HOJE).avisos[0].texto).toMatch(/acesso do cliente está fechado/);
  });

  it("vencimento do domínio: aviso em 45 dias, crítico em 7 e depois de vencido", () => {
    expect(saudeDoCliente(cliente({ dominios: [dominio({ dominio_vence_em: "2026-12-28" })] }), HOJE).estado).toBe("atencao");
    expect(saudeDoCliente(cliente({ dominios: [dominio({ dominio_vence_em: "2026-11-22" })] }), HOJE).estado).toBe("critico");
    const vencido = saudeDoCliente(cliente({ dominios: [dominio({ dominio_vence_em: "2026-11-10" })] }), HOJE);
    expect(vencido.estado).toBe("critico");
    expect(vencido.avisos[0].texto).toBe("O registro de prix.com.br venceu há 8 dias.");
    expect(saudeDoCliente(cliente({ dominios: [dominio({ dominio_vence_em: "2027-03-01" })] }), HOJE).estado).toBe("saudavel");
  });

  it("plano de e-mail vencendo avisa com 30 dias", () => {
    const s = saudeDoCliente(cliente({ dominios: [dominio({ provedor_vence_em: "2026-12-10" })] }), HOJE);
    expect(s.estado).toBe("atencao");
    expect(s.avisos[0].texto).toBe("O plano de e-mail de prix.com.br vence em 22 dias.");
  });

  it("DNS com item faltando em domínio no ar é crítico; nunca conferido é atenção", () => {
    expect(saudeDoCliente(cliente({ dominios: [dominio({ dns_pronto: false, dns_faltas: 1 })] }), HOJE).estado).toBe("critico");
    expect(saudeDoCliente(cliente({ dominios: [dominio({ dns_pronto: null, checado_em: null })] }), HOJE).estado).toBe("atencao");
    // Em migração o DNS ainda aponta para o provedor antigo: não é alarme.
    expect(saudeDoCliente(cliente({ dominios: [dominio({ estado: "preparando", dns_pronto: false, dns_faltas: 3, etapas_feitas: 2 })] }), HOJE).estado).toBe("migrando");
  });

  it("Zoho gratuito: mais de 5 caixas é crítico, 5 é só um lembrete", () => {
    expect(saudeDoCliente(cliente({ caixas: 6, caixas_contratadas: 6 }), HOJE).estado).toBe("critico");
    const noLimite = saudeDoCliente(cliente({ caixas: 5 }), HOJE);
    expect(noLimite.estado).toBe("saudavel");
    expect(noLimite.avisos[0].gravidade).toBe("info");
    expect(saudeDoCliente(cliente({ caixas: 9, caixas_contratadas: 9, dominios: [dominio({ zoho_plano: "lite" })] }), HOJE).estado).toBe("saudavel");
  });

  it("caixa pedida pelo cliente e caixas acima do contratado pedem atenção", () => {
    expect(saudeDoCliente(cliente({ caixas_pedidas: 2 }), HOJE).avisos[0].texto).toBe("2 caixas pedidas pelo cliente esperando.");
    expect(saudeDoCliente(cliente({ caixas: 5, caixas_contratadas: 3 }), HOJE).estado).toBe("atencao");
  });

  it("pedido sem pagamento fica aguardando; o crítico vem antes", () => {
    const aguardando = cliente({ email_ativo: false, liberado: false, dominios: [], cobranca: null, pedido: { id: "p", estado: "novo", tipo: "migracao", pago_em: null, criado_em: "2026-11-18", valor_mensal: 39.9, extra_id: null } });
    expect(saudeDoCliente(aguardando, HOJE).estado).toBe("aguardando");
  });

  it("os avisos saem do mais grave para o mais leve e sem travessão", () => {
    const s = saudeDoCliente(cliente({ caixas: 5, caixas_pedidas: 1, dominios: [dominio({ dominio_vence_em: "2026-11-20", checado_em: "2026-09-01T00:00:00Z" })] }), HOJE);
    expect(s.avisos.map((a) => a.gravidade)).toEqual(["critico", "atencao", "info", "info"]);
    expect(s.avisos.map((a) => a.texto).join(" ")).not.toMatch(/[—–]/);
  });
});

describe("vencimentos e resumo", () => {
  it("o próximo vencimento é o mais perto entre mensalidade, domínio e plano", () => {
    expect(proximoVencimento(cliente())).toEqual({ dia: "2026-12-05", oQue: "Mensalidade" });
    expect(proximoVencimento(cliente({ dominios: [dominio({ provedor_vence_em: "2026-11-30" })] }))).toEqual({ dia: "2026-11-30", oQue: "Plano de e-mail" });
    expect(proximoVencimento(cliente({ cobranca: null, dominios: [dominio({ dominio_vence_em: null })] }))).toBeNull();
  });

  it("soma clientes, caixas, receita, custo e margem", () => {
    const r = resumoDaCentral([cliente(), cliente({ conta_id: "c2", caixas: 3, dominios: [dominio({ provedor_custo_mensal: "9.50", dns_pronto: false, dns_faltas: 2 })] })], HOJE);
    expect(r).toMatchObject({ clientes: 2, caixas: 7, receita: 79.8, custo: 9.5, margem: 70.3, vencendo: 2 });
    expect(r.por).toMatchObject({ saudavel: 1, critico: 1 });
  });
});

describe("contrato do correio", () => {
  it("sem provedor contratado, tudo responde desligado", () => {
    expect(Object.keys(ADAPTADORES)).toEqual([]);
    expect(() => adaptadorPara("nenhum", false, false)).toThrow(CorreioDesligado);
    expect(() => adaptadorPara("migadu", true, false)).toThrow(/senha de aplicativo/);
    expect(() => adaptadorPara("migadu", true, true)).toThrow(/ainda não está conectado/);
  });

  it("valida o envio: destinatários, limite e injeção de cabeçalho", () => {
    expect(envioValido({ para: "a@b.com, C@D.com; a@b.com", assunto: "Oi", texto: "x" })).toMatchObject({ para: ["a@b.com", "c@d.com"] });
    expect(envioValido({ para: [], assunto: "Oi", texto: "x" })).toEqual({ erro: "Diga para quem vai o e-mail." });
    expect(envioValido({ para: "nao-e-email", assunto: "Oi", texto: "x" })).toMatchObject({ erro: expect.stringMatching(/inválido/) });
    expect(envioValido({ para: Array.from({ length: 21 }, (_, i) => `p${i}@x.com`), assunto: "a", texto: "b" })).toMatchObject({ erro: expect.stringMatching(/20/) });
    const limpo = envioValido({ para: "a@b.com", assunto: "Oi\r\nBcc: espiao@x.com", texto: "x" });
    expect("assunto" in limpo && limpo.assunto).toBe("Oi Bcc: espiao@x.com");
    expect(envioValido({ para: "a@b.com", assunto: "", texto: "  " })).toMatchObject({ erro: expect.stringMatching(/assunto ou a mensagem/) });
  });
});

describe("convenções", () => {
  it("o correio confere a permissão no banco antes de tocar no provedor e nunca devolve o segredo", () => {
    const fn = ler("supabase/functions/produto-correio/index.ts");
    expect(fn.indexOf("produto_email_pode_abrir")).toBeGreaterThan(0);
    expect(fn.indexOf("produto_email_pode_abrir")).toBeLessThan(fn.indexOf("produto_email_ler_segredo_da_caixa"));
    expect(fn).not.toMatch(/json\([^)]*segredo:/);
  });

  it("o correio tem link próprio, protegido, e pede a senha de novo", () => {
    expect(ler("src/App.tsx")).toContain('<Route path="/correio" element={<ProtectedRoute><Correio /></ProtectedRoute>} />');
    const tela = ler("src/pages/Correio.tsx");
    expect(tela).toContain("signInWithPassword");
    expect(tela).toContain("portaAberta");
    for (const area of ["caixa", "quadro", "dia", "campanhas", "ferramentas"]) expect(tela).toContain(`id: "${area}"`);
  });

  it("nenhum segredo em coluna e as telas novas sem travessão nem gap em flex", () => {
    const sql = ler("supabase/migrations/20261118200000_produto_email_central_e_correio.sql");
    expect(sql).toContain("vault.create_secret");
    expect(sql).not.toMatch(/add column if not exists \w*(senha|token|secret)\w* (text|varchar)/i);
    for (const p of ["src/components/produto/casa/CentralDeEmail.tsx", "src/pages/Correio.tsx", "src/lib/produto/email-central.ts", "src/lib/produto/correio-dia.ts", "src/components/correio/CaixaPorPrioridade.tsx", "src/components/correio/AreasDoCorreio.tsx", "src/components/correio/PainelDoDia.tsx"]) {
      const t = ler(p);
      expect(t).not.toMatch(/[—–]/);
      for (const classe of t.match(/"[^"\n]*\bflex\b[^"\n]*"/g) || []) {
        if (/\bgrid\b/.test(classe)) continue;
        expect(/(^|[\s"])gap-/.test(classe), `${p}: ${classe}`).toBe(false);
      }
    }
  });
});

describe("caixa por prioridade e quadro", () => {
  const m = (x: Partial<MensagemDaCaixa>): MensagemDaCaixa => ({ id: "m", de: "marcos@exemplo.com.br", para: "eu@x.com", assunto: "Oi", resumo: "", recebida_em: "2026-11-18T12:00:00Z", lida: false, tem_anexo: false, ...x });

  it("separa por quem espera quem, sem ler o texto", () => {
    expect(grupoDaMensagem(m({}))).toBe("responder");
    expect(grupoDaMensagem(m({ lida: true, aguardando: "voce" }))).toBe("responder");
    expect(grupoDaMensagem(m({ lida: true, aguardando: "outro" }))).toBe("acompanhar");
    expect(grupoDaMensagem(m({ automatica: true }))).toBe("esperar");
    expect(grupoDaMensagem(m({ lida: true }))).toBe("esperar");
  });

  it("em Responder, quem espera há mais tempo vem primeiro; arquivada sai da caixa", () => {
    const g = agruparCaixa([m({ id: "novo", recebida_em: "2026-11-18T12:00:00Z" }), m({ id: "velho", recebida_em: "2026-11-16T12:00:00Z" }), m({ id: "fora", arquivada: true })]);
    expect(g.responder.map((x) => x.id)).toEqual(["velho", "novo"]);
    expect(g.esperar).toEqual([]);
  });

  it("o cartão do quadro anda sozinho com o estado da conversa", () => {
    expect(colunaDaMensagem(m({}))).toBe("chegou");
    expect(colunaDaMensagem(m({ aguardando: "voce" }))).toBe("responder");
    expect(colunaDaMensagem(m({ aguardando: "outro" }))).toBe("aguardando");
    expect(colunaDaMensagem(m({ lida: true }))).toBe("concluido");
    expect(colunaDaMensagem(m({ arquivada: true }))).toBe("concluido");
  });

  it("iniciais, hora de Brasília e a frase do dia", () => {
    expect(iniciais("Marcos Andrade <m@x.com>")).toBe("MA");
    expect(iniciais("financeiro@empresa.com.br")).toBe("FI");
    expect(horaDoCompromisso("2026-11-18T13:30:00Z")).toBe("10:30");
    expect(fraseDoDia({ responder: 3, compromissos: 1, tarefasAbertas: 2 })).toBe("3 e-mails pedem resposta, 1 compromisso e 2 tarefas abertas.");
    expect(fraseDoDia({ responder: 0, compromissos: 0, tarefasAbertas: 0 })).toBe("Dia livre: nada pendente por aqui.");
  });

  it("tarefas e compromissos são só da própria pessoa (RLS), e a tela não inventa mensagem", () => {
    const sql = ler("supabase/migrations/20261118210000_produto_correio_meu_dia.sql");
    expect(sql).toContain('"correio da propria pessoa"');
    expect(sql).toContain("produto_correio_sou(membro_id, conta_id)");
    for (const p of ["src/components/correio/CaixaPorPrioridade.tsx", "src/components/correio/AreasDoCorreio.tsx"]) expect(ler(p)).not.toMatch(/exemplo\.com/);
  });
});
