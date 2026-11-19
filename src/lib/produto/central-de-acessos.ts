import { supabase } from "@/integrations/supabase/client";
import { ErroDoProduto, type CaixaDeEmail, type ContaNaCasa, type DominioDeEmail, type PapelNaConta } from "./api";
import { provedorDeLeitura } from "./acessos";
import { gerarSenhaForte, leituraDoEnvio, problemaDaSenha, type SituacaoDoEnvio } from "../../../supabase/functions/produto/modulos/acessos";

export { gerarSenhaForte, problemaDaSenha, leituraDoEnvio, type SituacaoDoEnvio };

/**
 * Central de acessos (19/11/2026, pedido do dono): todas as pessoas do CRM e todas as caixas de e-mail
 * numa visão, com as ações de quando algo acontece (senha nova, link, desativar) e o "Adicionar".
 *
 * Senha: a do CRM não é recuperável e nunca aparece; a casa define uma nova (função produto) e ela
 * aparece UMA vez na tela. A da caixa mora no Vault e só volta pela função produto-email, para o dono,
 * com registro no histórico. Nada aqui grava senha em armazenamento do navegador, URL ou log: a senha só
 * existe no estado da janela aberta e no corpo do pedido à função.
 */

const db = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

export interface PessoaNaCentral {
  id: string;
  conta_id: string;
  empresa: string;
  nome: string;
  email: string;
  papel: PapelNaConta;
  estado: "convidado" | "ativo";
  convidado_em: string | null;
  entrou_em: string | null;
  tem_login: boolean;
  ultimo_acesso: string | null;
}

export interface CaixaNaCentral {
  id: string;
  conta_id: string;
  empresa: string;
  dominio_id: string;
  dominio: string;
  endereco: string;
  pessoa: string;
  estado: CaixaDeEmail["estado"];
  provedor: string;
  /** A senha está guardada no cofre (Vault). */
  guardada: boolean;
  /** O correio da casa consegue abrir a caixa (Minha caixa). */
  pronta: boolean;
}

export type TipoNaCentral = "todos" | "crm" | "email";

const texto = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** Lê o que produto_admin_pessoas devolveu, sem confiar no formato. */
export function lerPessoas(d: unknown): PessoaNaCentral[] {
  return (Array.isArray(d) ? d : [])
    .filter((x) => x && typeof x === "object" && (x as { estado?: unknown }).estado !== "removido")
    .map((x) => {
      const r = x as Record<string, unknown>;
      return {
        id: texto(r.id),
        conta_id: texto(r.conta_id),
        empresa: texto(r.empresa) || "Sem empresa",
        nome: texto(r.nome),
        email: texto(r.email),
        papel: (r.papel === "admin" || r.papel === "gerente" ? r.papel : "usuario") as PapelNaConta,
        estado: r.estado === "ativo" ? "ativo" : "convidado",
        convidado_em: r.convidado_em ? texto(r.convidado_em) : null,
        entrou_em: r.entrou_em ? texto(r.entrou_em) : null,
        tem_login: r.tem_login === true,
        ultimo_acesso: r.ultimo_acesso ? texto(r.ultimo_acesso) : null,
      };
    });
}

/** As caixas de verdade (não apelido nem grupo), de todas as empresas, com o que a central precisa. */
export function caixasDaCentral(caixas: CaixaDeEmail[], dominios: DominioDeEmail[], nomes: Record<string, string>): CaixaNaCentral[] {
  const porId: Record<string, DominioDeEmail> = {};
  dominios.forEach((d) => {
    porId[d.id] = d;
  });
  return caixas
    .filter((c) => c.tipo === "caixa" && c.estado !== "removida")
    .map((c) => {
      const d = porId[c.dominio_id];
      return {
        id: c.id,
        conta_id: c.conta_id,
        empresa: nomes[c.conta_id] || "Sem empresa",
        dominio_id: c.dominio_id,
        dominio: d ? d.dominio : c.endereco.split("@")[1] || "",
        endereco: c.endereco,
        pessoa: c.pessoa || "",
        estado: c.estado,
        provedor: d ? d.provedor : "",
        guardada: (c as CaixaDeEmail & { tem_segredo?: boolean }).tem_segredo === true,
        pronta: c.estado !== "pedida" && provedorDeLeitura(d as { provedor?: string; correio_provedor?: string } | undefined) !== "nenhum",
      };
    })
    .sort((a, b) => a.empresa.localeCompare(b.empresa, "pt-BR") || a.endereco.localeCompare(b.endereco));
}

/** Busca (nome, e-mail, empresa, endereço) e filtro por empresa. */
export function filtrarNaCentral<T extends { conta_id: string; empresa: string }>(linhas: T[], p: { busca: string; empresa: string; campos: (l: T) => string[] }): T[] {
  const termo = p.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (p.empresa && l.conta_id !== p.empresa) return false;
    if (!termo) return true;
    return [l.empresa].concat(p.campos(l)).join(" ").toLowerCase().indexOf(termo) >= 0;
  });
}

/** "Hoje", "Ontem", "há 5 dias", "12/10" ou "Nunca entrou". */
export function ultimoAcessoLegivel(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return "Nunca entrou";
  const t = Date.parse(iso);
  if (!isFinite(t)) return "Nunca entrou";
  const dia = (x: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(x));
  if (dia(t) === dia(agora)) return "Hoje";
  if (dia(t) === dia(agora - 86400000)) return "Ontem";
  const dias = Math.floor((agora - t) / 86400000);
  if (dias > 1 && dias < 7) return `Há ${dias} dias`;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(t));
}

/** O endereço novo: a parte antes do @ (só letras, números, ponto, hífen) + o domínio. null se não serve. */
export function enderecoNoDominio(parte: string, dominio: string): string | null {
  const local = String(parte || "").trim().toLowerCase().replace(/@.*$/, "");
  if (!/^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$/.test(local) || !dominio) return null;
  return `${local}@${dominio.toLowerCase()}`;
}

// ------------------------------------------------------------------ pedidos (montados aqui, o teste confere)

export const pedidoConvidar = (p: { conta_id: string; email: string; nome: string; papel: PapelNaConta }) => ({
  acao: "admin_convidar",
  conta_id: p.conta_id,
  email: p.email.trim().toLowerCase(),
  nome: p.nome.trim(),
  papel: p.papel,
  // O e-mail sai só quando a casa pedir (o envio pode estar falhando); o link volta para copiar.
  enviar: false,
  com_link: true,
});
export const pedidoDefinirSenha = (membroId: string, senha: string) => ({ acao: "admin_definir_senha", membro_id: membroId, senha });
export const pedidoEnviarLink = (membroId: string) => ({ acao: "admin_enviar_link", membro_id: membroId });
export const pedidoRemoverPessoa = (membroId: string) => ({ acao: "admin_remover_membro", membro_id: membroId });
export const pedidoCriarCaixa = (p: { dominio_id: string; endereco: string; senha: string; pessoa: string }) => ({ acao: "caixa_criar", dominio_id: p.dominio_id, endereco: p.endereco, senha: p.senha, pessoa: p.pessoa.trim() });
export const pedidoMostrarSenha = (caixaId: string) => ({ acao: "caixa_mostrar_senha", caixa_id: caixaId });
export const pedidoRedefinirSenhaDaCaixa = (caixaId: string, senha: string, soGuardar = false) => ({ acao: "caixa_redefinir_senha", caixa_id: caixaId, senha, ...(soGuardar ? { so_guardar: true } : {}) });
export const pedidoDesativarCaixa = (caixaId: string) => ({ acao: "caixa_desativar", caixa_id: caixaId });

// ------------------------------------------------------------------ rede

/** Chama a função e transforma o erro na frase dela. O corpo (que pode ter senha) nunca vai para o erro. */
async function chamarFuncao<T>(funcao: "produto" | "produto-email", corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(funcao, { body: corpo });
  if (error) {
    let resposta: { error?: string; mensagem?: string } | null = null;
    try {
      const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context;
      resposta = ctx && typeof ctx.clone === "function" ? ((await ctx.clone().json()) as { error?: string; mensagem?: string }) : null;
    } catch {
      resposta = null;
    }
    if (resposta && resposta.mensagem) throw new ErroDoProduto(String(resposta.error || "erro"), resposta.mensagem);
    throw new ErroDoProduto("servico_indisponivel", "O serviço não respondeu agora. Tente de novo em instantes.");
  }
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    throw new ErroDoProduto(String((data as { error: string }).error), String((data as { mensagem?: string }).mensagem || "Não foi possível concluir."));
  }
  return data as T;
}

export async function listarPessoasDaCasa(): Promise<PessoaNaCentral[]> {
  const { data, error } = await db.rpc("produto_admin_pessoas");
  if (error) throw error;
  return lerPessoas(data);
}

export type ExtraQueAcompanhou = { extra_id: string; quantidade?: number; valor: number } | null;

export const central = {
  convidar: (p: Parameters<typeof pedidoConvidar>[0]) => chamarFuncao<{ membro_id: string; link: string | null; extra: ExtraQueAcompanhou }>("produto", pedidoConvidar(p)),
  definirSenha: (membroId: string, senha: string) => chamarFuncao<{ definida: boolean; email: string; login_criado: boolean }>("produto", pedidoDefinirSenha(membroId, senha)),
  enviarLink: (membroId: string) => chamarFuncao<{ enviado: boolean; message_id: string | null }>("produto", pedidoEnviarLink(membroId)),
  estadoDoEnvio: (messageId: string) => chamarFuncao<{ situacao: SituacaoDoEnvio; frase: string }>("produto", { acao: "admin_estado_do_envio", message_id: messageId }),
  removerPessoa: (membroId: string) => chamarFuncao<{ removido: boolean; extra: ExtraQueAcompanhou; aviso: string | null }>("produto", pedidoRemoverPessoa(membroId)),
  criarCaixa: (p: Parameters<typeof pedidoCriarCaixa>[0]) => chamarFuncao<{ caixa_id: string; endereco: string; guardada: boolean; extra: ExtraQueAcompanhou; aviso: string | null }>("produto-email", pedidoCriarCaixa(p)),
  mostrarSenha: (caixaId: string) => chamarFuncao<{ senha: string; endereco: string }>("produto-email", pedidoMostrarSenha(caixaId)),
  redefinirSenhaDaCaixa: (caixaId: string, senha: string, soGuardar = false) => chamarFuncao<{ redefinida: boolean; guardada: boolean }>("produto-email", pedidoRedefinirSenhaDaCaixa(caixaId, senha, soGuardar)),
  desativarCaixa: (caixaId: string) => chamarFuncao<{ desativada: boolean; extra: ExtraQueAcompanhou; aviso: string | null }>("produto-email", pedidoDesativarCaixa(caixaId)),
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Manda o link por e-mail e espera a fila responder (até ~9 s): o envio é assíncrono, e hoje o domínio de
 * envio pode recusar. Devolve a frase clara para a tela (enviado, na fila ou o motivo da falha).
 */
export async function mandarLinkPorEmail(membroId: string, pausa = 3000, tentativas = 3): Promise<{ situacao: SituacaoDoEnvio; frase: string }> {
  const r = await central.enviarLink(membroId);
  if (!r.enviado) return leituraDoEnvio("failed", "");
  if (!r.message_id) return leituraDoEnvio("", "");
  let ultima = leituraDoEnvio("pending", "");
  for (let i = 0; i < tentativas; i++) {
    await esperar(pausa);
    ultima = await central.estadoDoEnvio(r.message_id);
    if (ultima.situacao !== "na_fila") return ultima;
  }
  return ultima;
}

/** A frase do que o Financeiro acompanhou (extra do cliente), ou null. */
export function fraseDoExtra(extra: ExtraQueAcompanhou, tipo: "crm" | "email"): string | null {
  if (!extra) return null;
  const valor = extra.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (tipo === "crm" && extra.quantidade) return `Extra de CRM do cliente: ${extra.quantidade} ${extra.quantidade === 1 ? "usuário" : "usuários"}, ${valor} por mês.`;
  return `Extra de e-mail do cliente: ${valor} por mês.`;
}

/** As empresas que podem receber caixa nova pela central: domínio do Migadu. */
export function dominiosParaCaixaNova(dominios: DominioDeEmail[], nomes: Record<string, string>): Array<{ id: string; dominio: string; conta_id: string; empresa: string }> {
  return dominios
    .filter((d) => d.provedor === "migadu")
    .map((d) => ({ id: d.id, dominio: d.dominio, conta_id: d.conta_id, empresa: nomes[d.conta_id] || "Sem empresa" }))
    .sort((a, b) => a.empresa.localeCompare(b.empresa, "pt-BR") || a.dominio.localeCompare(b.dominio));
}

/** Empresa sem cliente ligado: o Financeiro e a ficha do cliente não acompanham. */
export const semCliente = (c: Pick<ContaNaCasa, "client_id"> | null | undefined) => !!c && !c.client_id;

// ------------------------------------------------------------------ todos os clientes no "Adicionar pessoa" (19/11)

/** O que acontece ao escolher a empresa no "Adicionar pessoa". */
export type DestinoDaPessoa =
  | { tipo: "conta"; conta_id: string }
  | { tipo: "ativar"; conta_id: string }
  | { tipo: "plano"; extra_id: string; client_id: string }
  | { tipo: "nova"; client_id: string };

export type OpcaoDeEmpresa = { valor: string; nome: string; rotulo: string; grupo: "crm" | "clientes"; destino: DestinoDaPessoa };

/**
 * Dono (19/11): "puxar todos os clientes em selecionar a empresa". Primeiro as empresas que já têm CRM; depois
 * cada cliente do painel que ainda não tem: empresa existente só com e-mail (liga o CRM), cliente com o extra
 * de CRM no plano (liga pelo plano, o Financeiro já cobra) ou cliente sem nada (nasce a empresa ligada a ele).
 */
export function opcoesDeEmpresaParaPessoa(
  contas: Array<Pick<ContaNaCasa, "id" | "nome" | "crm_ativo" | "client_id">>,
  clientes: Array<{ id: string; nome: string }>,
  extrasDeCrm: Array<{ id: string; client_id: string }>,
): OpcaoDeEmpresa[] {
  const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, "pt-BR");
  const comCrm: OpcaoDeEmpresa[] = contas
    .filter((c) => c.crm_ativo)
    .map((c) => ({ valor: `conta:${c.id}`, nome: c.nome, rotulo: c.nome, grupo: "crm" as const, destino: { tipo: "conta" as const, conta_id: c.id } }))
    .sort(porNome);
  const resto: OpcaoDeEmpresa[] = [];
  for (const cliente of clientes) {
    const nome = (cliente.nome || "").trim() || "Cliente";
    const contasDoCliente = contas.filter((c) => c.client_id === cliente.id);
    if (contasDoCliente.some((c) => c.crm_ativo)) continue;
    const semCrm = contasDoCliente[0];
    if (semCrm) {
      resto.push({ valor: `ativar:${semCrm.id}`, nome: semCrm.nome, rotulo: `${semCrm.nome} (ligar o CRM)`, grupo: "clientes", destino: { tipo: "ativar", conta_id: semCrm.id } });
      continue;
    }
    const extra = extrasDeCrm.filter((e) => e.client_id === cliente.id)[0];
    if (extra) {
      resto.push({ valor: `plano:${extra.id}`, nome, rotulo: `${nome} (CRM do plano)`, grupo: "clientes", destino: { tipo: "plano", extra_id: extra.id, client_id: cliente.id } });
    } else {
      resto.push({ valor: `nova:${cliente.id}`, nome, rotulo: `${nome} (nova no CRM)`, grupo: "clientes", destino: { tipo: "nova", client_id: cliente.id } });
    }
  }
  return comCrm.concat(resto.sort(porNome));
}

/** Os extras de CRM vivos dos clientes (para ligar o CRM pelo plano). */
export async function extrasDeCrmVivos(): Promise<Array<{ id: string; client_id: string }>> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => any })
    .from("client_extras")
    .select("id, client_id, status")
    .eq("categoria", "crm")
    .neq("status", "encerrado");
  if (error) throw error;
  return ((data || []) as Array<{ id: string; client_id: string }>).map((e) => ({ id: e.id, client_id: e.client_id }));
}
