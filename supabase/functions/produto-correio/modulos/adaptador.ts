/**
 * O contrato do correio (18/11/2026). A tela e a função produto-correio só falam com este contrato;
 * o provedor (Migadu, Zoho pago ou qualquer IMAP) entra como um adaptador que o implementa.
 *
 * Hoje nenhum provedor está contratado: todo domínio nasce com correio_provedor = 'nenhum' e o
 * adaptador "desligado" responde que o correio está em preparação. Para ligar um provedor:
 *   1. escrever o adaptador (listar pastas, listar mensagens, ler, enviar) em modulos/<provedor>.ts;
 *   2. registrá-lo em ADAPTADORES abaixo;
 *   3. no domínio: correio_provedor e correio_ligado; em cada caixa: o segredo no Vault.
 * Nada na tela muda. Sem import: roda na função (Deno) e no vitest.
 */

export type ProvedorDeCorreio = "nenhum" | "zoho" | "migadu" | "imap";

export interface CaixaAberta {
  id: string;
  endereco: string;
  dominio: string;
  provedor: ProvedorDeCorreio;
  /** A senha de aplicativo da caixa, vinda do Vault. Nunca sai da função. */
  segredo: string;
}

export interface Pasta {
  id: string;
  nome: string;
  nao_lidas: number;
}

export interface ResumoDaMensagem {
  id: string;
  de: string;
  para: string;
  assunto: string;
  resumo: string;
  recebida_em: string | null;
  lida: boolean;
  tem_anexo: boolean;
  /** Quem deve o próximo passo na conversa: é o que separa a caixa por prioridade e move o quadro. */
  aguardando?: "voce" | "outro" | null;
  /** Boletim, aviso de sistema ou lista: ninguém espera resposta. */
  automatica?: boolean;
  arquivada?: boolean;
}

export interface Mensagem extends ResumoDaMensagem {
  /** Só texto: o HTML do remetente nunca é devolvido cru para a tela. */
  texto: string;
  anexos: Array<{ nome: string; tamanho: number }>;
}

export interface Envio {
  para: string[];
  assunto: string;
  texto: string;
  em_resposta_a?: string | null;
}

export interface AdaptadorDeCorreio {
  pastas(caixa: CaixaAberta): Promise<Pasta[]>;
  listar(caixa: CaixaAberta, p: { pasta: string; pagina: number; busca?: string }): Promise<ResumoDaMensagem[]>;
  ler(caixa: CaixaAberta, p: { pasta: string; id: string }): Promise<Mensagem>;
  enviar(caixa: CaixaAberta, envio: Envio): Promise<{ id: string }>;
}

export class CorreioDesligado extends Error {
  constructor(mensagem = "O correio desta caixa ainda não foi ligado. A Aceleriq avisa quando estiver pronto.") {
    super(mensagem);
  }
}

/** Os adaptadores que existem. Provedor sem adaptador responde como desligado, nunca como erro calado. */
export const ADAPTADORES: Partial<Record<ProvedorDeCorreio, AdaptadorDeCorreio>> = {};

export function adaptadorPara(provedor: ProvedorDeCorreio, ligado: boolean, temSegredo: boolean): AdaptadorDeCorreio {
  if (!ligado || provedor === "nenhum") throw new CorreioDesligado();
  if (!temSegredo) throw new CorreioDesligado("Falta guardar a senha de aplicativo desta caixa. Fale com quem administra a empresa.");
  const a = ADAPTADORES[provedor];
  if (!a) throw new CorreioDesligado("O provedor desta caixa ainda não está conectado ao painel.");
  return a;
}

const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

/** O envio como a função aceita: destinatários válidos (até 20), assunto e texto com limite. */
export function envioValido(bruto: unknown): Envio | { erro: string } {
  const b = (bruto || {}) as Record<string, unknown>;
  const para = (Array.isArray(b.para) ? b.para : typeof b.para === "string" ? b.para.split(/[,;\s]+/) : [])
    .map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (!para.length) return { erro: "Diga para quem vai o e-mail." };
  if (para.length > 20) return { erro: "No máximo 20 destinatários por envio." };
  const ruim = para.filter((x) => !EMAIL.test(x))[0];
  if (ruim) return { erro: `Endereço inválido: ${ruim.slice(0, 80)}` };
  const assunto = typeof b.assunto === "string" ? b.assunto.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";
  const texto = typeof b.texto === "string" ? b.texto.slice(0, 50_000) : "";
  if (!assunto && !texto.trim()) return { erro: "Escreva o assunto ou a mensagem." };
  const resp = typeof b.em_resposta_a === "string" && b.em_resposta_a.length <= 300 ? b.em_resposta_a : null;
  return { para: Array.from(new Set(para)), assunto, texto, em_resposta_a: resp };
}

/**
 * Minha caixa (19/11/2026): a casa (admin do painel) abre uma caixa com a senha que digitou, para ver o
 * correio como o cliente vê. A senha vem em cada pedido, vale só para ele e nunca é guardada nem logada.
 * O provedor de leitura é o do correio; com o correio ainda não marcado, um domínio do Migadu lê pelo Migadu.
 */
export function provedorPelaCasa(correioProvedor: string | null | undefined, provedor: string | null | undefined): ProvedorDeCorreio {
  const c = String(correioProvedor || "nenhum") as ProvedorDeCorreio;
  if (c !== "nenhum") return c;
  return provedor === "migadu" ? "migadu" : "nenhum";
}

/** A senha digitada pela casa, quando o pedido traz uma (texto de 1 a 200 caracteres); senão, vazio. */
export function senhaDaCasa(v: unknown): string {
  return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : "";
}

/** A frase para a casa quando o provedor recusa a senha digitada. */
export const SENHA_DA_CASA_RECUSADA = "A senha não confere com esta caixa. Confira e tente de novo.";
