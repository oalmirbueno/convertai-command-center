/**
 * Ficha fiscal do cliente na função contratos (frente CON2, 30/09/2026).
 *
 * - ficha_ler { client_id } -> { ficha, existe, faltas, valores, sugestao }
 * - ficha_salvar { client_id, ficha } -> { ficha, anterior, faltas } (gestão)
 * - cnpj_consultar { cnpj, client_id?, aplicar?, substituir? } -> { ficha, avisos, cache, consultado_em, salva? }
 *
 * A consulta pública (BrasilAPI) roda aqui, no servidor, com cache de 30 dias
 * em cnpj_consultas e erro claro para cada falha. Nada é inventado: campo que
 * a Receita não traz fica vazio e vira aviso. Sem travessão.
 */
import { registrarFalha } from "../_shared/falha-registrada.ts";
import {
  cacheValido,
  cnpjValido,
  cpfValido,
  documentoInvalido,
  erroDaConsulta,
  faltasNaFicha,
  type FichaFiscal,
  fichaDaBrasilApi,
  fichaVazia,
  lerFicha,
  mesclarFicha,
  soDigitos,
  valoresDaFicha,
} from "../_shared/contrato-ficha.ts";
import { type Chamador, ErroHttp, evento, garantirAcesso, garantirGestao, idDe, json, lerLinha, type Nucleo, semTabela, servico } from "./base.ts";

const CAMPOS_DA_LINHA = "client_id, tipo_pessoa, documento, razao_social, nome_fantasia, logradouro, numero, complemento, bairro, cidade, uf, cep, representante_nome, representante_cpf, representante_cargo, email_contrato, email_cobranca, telefone, situacao_cadastral, fonte, consultado_em, atualizado_em";
const AVISO_SEM_FICHA = "O banco ainda não tem a ficha fiscal do cliente (migration 20260930195000 pendente).";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function lerFichaDoCliente(clientId: string): Promise<{ ficha: FichaFiscal; existe: boolean; atualizado_em: string | null; fonte: string | null }> {
  const { data, error } = await servico().from("cliente_dados_fiscais").select(CAMPOS_DA_LINHA).eq("client_id", clientId).maybeSingle();
  if (error) {
    if (semTabela(error)) return { ficha: fichaVazia(), existe: false, atualizado_em: null, fonte: null };
    throw new ErroHttp(503, "ficha_indisponivel", "Não foi possível ler a ficha fiscal do cliente.");
  }
  const o = data as Record<string, unknown> | null;
  return { ficha: lerFicha(o), existe: !!o, atualizado_em: o ? String(o.atualizado_em || "") || null : null, fonte: o ? String(o.fonte || "") || null : null };
}

/** Sugestão para ficha vazia: o que o cadastro e a ficha da empresa do CRM já têm (a pessoa confere e salva). */
async function sugestaoDoCadastro(clientId: string): Promise<FichaFiscal> {
  const [perfil, empresa] = await Promise.all([
    servico().from("profiles").select("full_name, company_name, email, phone").eq("id", clientId).maybeSingle(),
    servico().from("commercial_organizations").select("*").eq("client_id", clientId).is("archived_at", null).order("created_at", { ascending: true }).limit(1),
  ]);
  if (empresa.error) registrarFalha("contratos: ficha da empresa do CRM não lida", empresa.error, { client_id: clientId });
  const p = (perfil.data || {}) as Record<string, unknown>;
  const org = (((empresa.data as unknown[] | null) ?? [])[0] || {}) as Record<string, unknown>;
  const doc = soDigitos(org.cnpj);
  return lerFicha({
    documento: doc.length === 14 || doc.length === 11 ? doc : "",
    razao_social: org.name || p.company_name || "",
    logradouro: org.address || "",
    cidade: org.city || "",
    representante_nome: p.company_name ? p.full_name : "",
    email_contrato: p.email || "",
    email_cobranca: p.email || "",
    telefone: p.phone || org.phone || "",
    tipo_pessoa: doc.length === 11 ? "pf" : doc.length === 14 ? "pj" : "",
  });
}

function conferirFicha(f: FichaFiscal): string[] {
  const erros: string[] = [];
  const doc = documentoInvalido(f.documento);
  if (doc) erros.push(`CNPJ ou CPF: ${doc}.`);
  if (f.representante_cpf && !cpfValido(f.representante_cpf)) erros.push("CPF do representante inválido.");
  if (f.email_contrato && !EMAIL.test(f.email_contrato)) erros.push("E-mail para contrato inválido.");
  if (f.email_cobranca && !EMAIL.test(f.email_cobranca)) erros.push("E-mail de cobrança inválido.");
  if (f.uf && !/^[A-Z]{2}$/.test(f.uf)) erros.push("UF com duas letras.");
  if (f.cep && f.cep.length !== 8) erros.push("CEP com 8 dígitos.");
  return erros;
}

export async function gravarFicha(ch: Chamador, clientId: string, f: FichaFiscal, fonte: "manual" | "brasilapi" | "agente", consultadoEm?: string | null): Promise<void> {
  const erros = conferirFicha(f);
  if (erros.length) throw new ErroHttp(400, "ficha_invalida", erros.join(" "), { erros });
  const nulo = (v: string) => (v ? v : null);
  const linha: Record<string, unknown> = {
    client_id: clientId,
    tipo_pessoa: nulo(f.tipo_pessoa),
    documento: nulo(f.documento),
    razao_social: nulo(f.razao_social),
    nome_fantasia: nulo(f.nome_fantasia),
    logradouro: nulo(f.logradouro),
    numero: nulo(f.numero),
    complemento: nulo(f.complemento),
    bairro: nulo(f.bairro),
    cidade: nulo(f.cidade),
    uf: nulo(f.uf),
    cep: nulo(f.cep),
    representante_nome: nulo(f.representante_nome),
    representante_cpf: nulo(f.representante_cpf),
    representante_cargo: nulo(f.representante_cargo),
    email_contrato: nulo(f.email_contrato),
    email_cobranca: nulo(f.email_cobranca),
    telefone: nulo(f.telefone),
    situacao_cadastral: nulo(f.situacao_cadastral),
    fonte,
    atualizado_por: ch.userId || null,
    atualizado_em: new Date().toISOString(),
    ...(consultadoEm ? { consultado_em: consultadoEm } : {}),
  };
  const { error } = await servico().from("cliente_dados_fiscais").upsert(linha, { onConflict: "client_id" });
  if (error) throw semTabela(error) ? new ErroHttp(503, "banco_sem_ficha", AVISO_SEM_FICHA) : new ErroHttp(409, "ficha_nao_gravada", "A ficha fiscal não foi gravada.", { detalhe: error.message });
}

/** Ficha vazia apaga a linha (desfazer de quem não tinha ficha). */
export async function restaurarFicha(ch: Chamador, clientId: string, anterior: FichaFiscal | null) {
  if (!anterior || !Object.keys(anterior).some((k) => (anterior as Record<string, string>)[k])) {
    const { error } = await servico().from("cliente_dados_fiscais").delete().eq("client_id", clientId);
    if (error) throw new Error(error.message);
    return;
  }
  await gravarFicha(ch, clientId, lerFicha(anterior), "manual");
}

// ------------------------------------------------------------------ consulta pública (BrasilAPI) com cache

export async function consultarCnpj(bruto: unknown): Promise<{ ficha: FichaFiscal; avisos: string[]; cache: boolean; consultado_em: string }> {
  const cnpj = soDigitos(bruto);
  if (!cnpjValido(cnpj)) throw new ErroHttp(400, "cnpj_invalido", "CNPJ inválido: confira os 14 números (o dígito verificador não bate).");
  const { data: guardada, error: erroCache } = await servico().from("cnpj_consultas").select("resposta, status, consultado_em").eq("cnpj", cnpj).maybeSingle();
  if (erroCache && !semTabela(erroCache)) registrarFalha("contratos: cache do CNPJ não lido", erroCache, { cnpj });
  const g = guardada as { resposta: unknown; status: number; consultado_em: string } | null;
  if (g && g.status === 200 && cacheValido(g.consultado_em)) {
    const r = fichaDaBrasilApi(g.resposta);
    return { ...r, cache: true, consultado_em: g.consultado_em };
  }
  let resposta: Response;
  try {
    resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { Accept: "application/json", "User-Agent": "AceleriqOS-Contratos/1.0" }, signal: AbortSignal.timeout(9000) });
  } catch (e) {
    registrarFalha("contratos: BrasilAPI não respondeu", e, { cnpj });
    // Sem a consulta, um cache vencido ainda serve (com aviso).
    if (g && g.status === 200) {
      const r = fichaDaBrasilApi(g.resposta);
      return { ficha: r.ficha, avisos: r.avisos.concat([`Consulta de ${String(g.consultado_em).slice(0, 10)}: a Receita não respondeu agora.`]), cache: true, consultado_em: g.consultado_em };
    }
    const x = erroDaConsulta(503);
    throw new ErroHttp(x.http, x.codigo, x.mensagem);
  }
  if (!resposta.ok) {
    const x = erroDaConsulta(resposta.status);
    if (resposta.status >= 500 || resposta.status === 429) registrarFalha("contratos: BrasilAPI recusou a consulta", new Error(`HTTP ${resposta.status}`), { cnpj });
    throw new ErroHttp(x.http, x.codigo, x.mensagem);
  }
  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch (e) {
    registrarFalha("contratos: resposta da BrasilAPI ilegível", e, { cnpj });
    const x = erroDaConsulta(503);
    throw new ErroHttp(x.http, x.codigo, x.mensagem);
  }
  const agora = new Date().toISOString();
  const { error: erroGravar } = await servico().from("cnpj_consultas").upsert({ cnpj, resposta: corpo && typeof corpo === "object" ? corpo : {}, status: 200, consultado_em: agora }, { onConflict: "cnpj" });
  if (erroGravar && !semTabela(erroGravar)) registrarFalha("contratos: cache do CNPJ não gravado", erroGravar, { cnpj });
  const r = fichaDaBrasilApi(corpo);
  if (r.ficha.documento !== cnpj) throw new ErroHttp(502, "consulta_divergente", "A consulta pública devolveu outro CNPJ. Tente de novo ou preencha à mão.");
  return { ...r, cache: false, consultado_em: agora };
}

/**
 * Puxa pelo CNPJ e grava na ficha do cliente (só o vazio, salvo `substituir`).
 * Com um rascunho aberto, completa também os cliente_* vazios dele.
 * Devolve o que o Desfazer precisa.
 */
export async function aplicarCnpjNoCliente(ch: Chamador, n: Nucleo, p: { clientId: string; cnpj: string; substituir?: boolean; contractId?: string | null }) {
  await garantirGestao(ch, p.clientId);
  const consulta = await consultarCnpj(p.cnpj);
  const atual = await lerFichaDoCliente(p.clientId);
  const { ficha, mudaram } = mesclarFicha(atual.ficha, consulta.ficha, !!p.substituir || (!!atual.ficha.documento && atual.ficha.documento !== consulta.ficha.documento));
  if (mudaram.length) await gravarFicha(ch, p.clientId, ficha, ch.sistema ? "agente" : "brasilapi", consulta.consultado_em);
  let contrato: { id: string; antes: Record<string, string | null> } | null = null;
  if (p.contractId) {
    const l = await lerLinha(ch, p.contractId, true);
    if (l.client_id === p.clientId && l.origem === "modelo" && l.status === "draft" && !l.congelado_em) {
      const vindos = valoresDaFicha(ficha);
      const antes: Record<string, string | null> = {};
      const valores = { ...l.variaveis };
      Object.keys(vindos).forEach((k) => {
        if (valores[k]) return;
        antes[k] = null;
        valores[k] = vindos[k];
      });
      if (Object.keys(antes).length) {
        const nova = await n.atualizarRascunho(l, { variaveis: valores });
        await evento(nova, "ficha_aplicada", `Dados do CNPJ ${consulta.ficha.documento} aplicados: ${Object.keys(antes).join(", ")}.`, { campos: Object.keys(antes) }, ch.userId || null);
        contrato = { id: l.id, antes };
      }
    }
  }
  return { consulta, ficha, anterior: atual.existe ? atual.ficha : null, mudaram, contrato };
}

// ------------------------------------------------------------------ ações

export function acoesDaFicha(n: Nucleo) {
  return {
    ficha_ler: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const clientId = idDe(corpo.client_id, "client_id");
      await garantirAcesso(ch, clientId);
      const f = await lerFichaDoCliente(clientId);
      const sugestao = f.existe ? null : await sugestaoDoCadastro(clientId);
      return json({ ficha: f.ficha, existe: f.existe, atualizado_em: f.atualizado_em, fonte: f.fonte, faltas: faltasNaFicha(f.ficha), valores: valoresDaFicha(f.ficha), sugestao, custo_usd: 0 });
    },
    ficha_salvar: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const clientId = idDe(corpo.client_id, "client_id");
      await garantirGestao(ch, clientId);
      const antes = await lerFichaDoCliente(clientId);
      const f = lerFicha(corpo.ficha);
      f.situacao_cadastral = antes.ficha.situacao_cadastral && antes.ficha.documento === f.documento ? antes.ficha.situacao_cadastral : f.situacao_cadastral;
      await gravarFicha(ch, clientId, f, corpo.fonte === "brasilapi" ? "brasilapi" : "manual");
      return json({ ficha: f, anterior: antes.existe ? antes.ficha : null, faltas: faltasNaFicha(f), valores: valoresDaFicha(f), custo_usd: 0 });
    },
    cnpj_consultar: async (ch: Chamador, corpo: Record<string, unknown>) => {
      if (corpo.aplicar === true) {
        const clientId = idDe(corpo.client_id, "client_id");
        const r = await aplicarCnpjNoCliente(ch, n, { clientId, cnpj: String(corpo.cnpj || ""), substituir: corpo.substituir === true, contractId: corpo.contract_id ? idDe(corpo.contract_id, "contract_id") : null });
        return json({ ficha: r.consulta.ficha, avisos: r.consulta.avisos, cache: r.consulta.cache, consultado_em: r.consulta.consultado_em, salva: r.ficha, anterior: r.anterior, mudaram: r.mudaram, contrato: r.contrato, custo_usd: 0 });
      }
      const r = await consultarCnpj(corpo.cnpj);
      return json({ ficha: r.ficha, avisos: r.avisos, cache: r.cache, consultado_em: r.consultado_em, valores: valoresDaFicha(r.ficha), custo_usd: 0 });
    },
  };
}
