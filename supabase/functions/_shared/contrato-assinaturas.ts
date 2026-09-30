/**
 * Fechamento do contrato com mais de um signatário (frente CON2, 30/09/2026).
 *
 * Quando a última assinatura obrigatória entra (contract-public) ou quando a
 * equipe ou a rotina pede de novo (função contratos), este passo monta o PDF
 * final com a página de carimbo (todas as assinaturas e a trilha), sobe para
 * o Storage e chama a RPC contrato_concluir_com_signatarios, que registra em
 * Arquivos pelo complete_contract_signature de sempre (avisa a equipe).
 *
 * Nunca escreve direto em contracts nem em files: só Storage e RPC.
 * Recebe o cliente do Supabase (service_role) por parâmetro. Sem travessão.
 */
import { hashDosBytes, nomeDoArquivoDoContrato } from "./contrato-modelo.ts";
import { type AssinaturaNoCarimbo, type EventoNoCarimbo, gerarPdfDoContrato, type QuemAssinaNoPdf } from "./pdf-contrato.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

export type SignatarioDoBanco = {
  id: string;
  papel: "contratante" | "testemunha";
  principal: boolean;
  ordem: number;
  nome: string;
  email: string;
  documento: string | null;
  obrigatorio: boolean;
  token: string;
  assinado_em: string | null;
  assinatura_nome: string | null;
  assinatura_email: string | null;
  assinatura_ip: string | null;
  assinatura_user_agent: string | null;
};

export const CAMPOS_DO_SIGNATARIO = "id, papel, principal, ordem, nome, email, documento, obrigatorio, token, assinado_em, assinatura_nome, assinatura_email, assinatura_ip, assinatura_user_agent";

export async function lerSignatariosDoContrato(sb: Cliente, contractId: string): Promise<{ lista: SignatarioDoBanco[]; erro: string | null }> {
  const { data, error } = await sb.from("contrato_signatarios").select(CAMPOS_DO_SIGNATARIO).eq("contract_id", contractId).is("removido_em", null).order("ordem", { ascending: true });
  if (error) {
    // Banco sem a tabela (migration 20260930195100 pendente): segue como assinatura única.
    if (error.code === "42P01" || error.code === "PGRST205" || /contrato_signatarios/.test(String(error.message || ""))) return { lista: [], erro: null };
    return { lista: [], erro: error.message };
  }
  return { lista: (data as SignatarioDoBanco[] | null) ?? [], erro: null };
}

/** Linhas de assinatura do PDF: a contratada, cada pessoa do contratante e as testemunhas. */
export function quemAssinaNoPdf(p: { agencia: string; representanteDaAgencia: string; signatarios: Array<Pick<SignatarioDoBanco, "papel" | "nome" | "email" | "documento">>; contratanteSemLista?: string | null }): QuemAssinaNoPdf[] {
  const lista: QuemAssinaNoPdf[] = [];
  if (p.representanteDaAgencia) lista.push({ papel: "Pela contratada", nome: p.representanteDaAgencia, detalhe: p.agencia || null });
  const contratantes = p.signatarios.filter((s) => s.papel === "contratante");
  if (contratantes.length) contratantes.forEach((s) => lista.push({ papel: "Pelo contratante", nome: s.nome, detalhe: s.email }));
  else if (p.contratanteSemLista) lista.push({ papel: "Pelo contratante", nome: p.contratanteSemLista });
  p.signatarios.filter((s) => s.papel === "testemunha").forEach((s) => lista.push({ papel: "Testemunha", nome: s.nome, detalhe: s.documento ? `CPF ${s.documento.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}` : s.email }));
  return lista;
}

export type ResultadoDoFechamento = { ok: true; file_id: string | null; pdf_path: string; pdf_hash: string } | { ok: false; motivo: string; faltam?: number };

/**
 * Fecha o contrato quando todas as assinaturas obrigatórias entraram.
 * Idempotente do lado do banco (a RPC recusa contrato já fechado).
 */
export async function fecharComSignatarios(sb: Cliente, contractId: string, opcoes: { verificacao: string; cliente: string; agencia?: string; representanteDaAgencia?: string }): Promise<ResultadoDoFechamento> {
  const { data: c, error } = await sb.from("contracts").select("id, client_id, status, numero, versao, documento_texto, documento_hash, admin_signature_name, admin_signature_email, admin_signature_ip, admin_signed_at, client_signed_at, congelado_em").eq("id", contractId).maybeSingle();
  if (error || !c) return { ok: false, motivo: "contrato não encontrado" };
  if (c.status !== "sent" || c.client_signed_at || !c.documento_texto) return { ok: false, motivo: "contrato não está esperando assinatura" };
  const { lista, erro } = await lerSignatariosDoContrato(sb, contractId);
  if (erro) return { ok: false, motivo: erro };
  if (!lista.length) return { ok: false, motivo: "contrato sem lista de signatários" };
  const faltam = lista.filter((s) => s.obrigatorio && !s.assinado_em).length;
  if (faltam) return { ok: false, motivo: "faltam assinaturas", faltam };

  const { data: evs } = await sb.from("contrato_eventos").select("tipo, resumo, criado_em").eq("contract_id", contractId).order("criado_em", { ascending: true }).limit(120);
  const eventos: EventoNoCarimbo[] = ((evs as Array<{ tipo: string; resumo: string; criado_em: string }> | null) ?? []).map((e) => ({ quando: String(e.criado_em), texto: String(e.resumo || e.tipo) }));
  const assinaturas: AssinaturaNoCarimbo[] = [
    { papel: "Pela contratada", nome: String(c.admin_signature_name || ""), email: c.admin_signature_email, quando: String(c.admin_signed_at), ip: c.admin_signature_ip },
  ];
  lista.filter((s) => s.assinado_em).forEach((s) => assinaturas.push({
    papel: s.papel === "testemunha" ? "Testemunha" : "Pelo contratante",
    nome: String(s.assinatura_nome || s.nome),
    email: s.assinatura_email || s.email,
    quando: String(s.assinado_em),
    ip: s.assinatura_ip,
    navegador: s.assinatura_user_agent ? String(s.assinatura_user_agent).slice(0, 200) : null,
  }));
  const pdf = gerarPdfDoContrato({
    texto: String(c.documento_texto),
    numero: String(c.numero || ""),
    versao: Number(c.versao) || 1,
    hash: c.documento_hash,
    quemAssina: quemAssinaNoPdf({ agencia: opcoes.agencia || "", representanteDaAgencia: String(opcoes.representanteDaAgencia || c.admin_signature_name || ""), signatarios: lista }),
    carimbo: { assinaturas, eventos, verificacao: opcoes.verificacao },
  });
  const pdfHash = await hashDosBytes(pdf);
  const arquivo = nomeDoArquivoDoContrato(String(c.numero || ""), opcoes.cliente, Number(c.versao) || 1, true);
  const caminho = `contracts/${c.client_id}/${c.id}/v${Number(c.versao) || 1}/${arquivo}`;
  const { error: erroUpload } = await sb.storage.from("files").upload(caminho, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
  if (erroUpload) return { ok: false, motivo: `PDF final não subiu: ${erroUpload.message}` };
  const { data: file, error: erroRpc } = await sb.rpc("contrato_concluir_com_signatarios", { p_contract: contractId, p_pdf_path: caminho, p_pdf_nome: arquivo, p_pdf_hash: pdfHash });
  if (erroRpc) {
    const { error: limpeza } = await sb.storage.from("files").remove([caminho]);
    if (limpeza) console.error("contratos: PDF final sem fechamento ficou no Storage", { caminho, message: limpeza.message });
    return { ok: false, motivo: erroRpc.message };
  }
  return { ok: true, file_id: file ? String(file) : null, pdf_path: caminho, pdf_hash: pdfHash };
}
