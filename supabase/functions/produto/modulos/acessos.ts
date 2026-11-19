/**
 * Central de acessos (19/11/2026, pedido do dono): regras puras, sem rede e sem import, usadas pela
 * função produto, pela função produto-email e pela tela /produto/acessos/pessoas (o teste prova as duas
 * pontas com o mesmo código).
 *
 *   - senha forte: gerada com o sorteio criptográfico do navegador ou do Deno, conferida dos dois lados;
 *   - extra "crm" do cliente: quantos usuários e quanto custa quando a casa põe ou tira uma pessoa;
 *   - extra de e-mail: quanto muda quando a casa cria ou desativa uma caixa adicional;
 *   - envio do link por e-mail: a frase clara para o que a fila de e-mail respondeu.
 *
 * Nenhuma função aqui guarda, registra ou devolve senha para outro lugar além de quem chamou.
 */

// ------------------------------------------------------------------ senha

const MINUSCULAS = "abcdefghijkmnpqrstuvwxyz";
const MAIUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITOS = "23456789";
const SIMBOLOS = "!@#%*-_+=?";

/** Sorteio de 0 a n-1 sem viés, com bytes criptográficos de quem chama (crypto.getRandomValues). */
type Sorteio = (bytes: Uint8Array) => Uint8Array;

const sorteioPadrao: Sorteio = (b) => {
  const c = (globalThis as { crypto?: { getRandomValues?: (x: Uint8Array) => Uint8Array } }).crypto;
  if (!c || typeof c.getRandomValues !== "function") throw new Error("Sem sorteio seguro neste navegador.");
  return c.getRandomValues(b);
};

function indice(n: number, sortear: Sorteio): number {
  const limite = 256 - (256 % n);
  for (;;) {
    const b = sortear(new Uint8Array(1))[0];
    if (b < limite) return b % n;
  }
}

/** Senha forte para CRM ou caixa: 16 caracteres, com minúscula, maiúscula, número e símbolo, sem letra ambígua. */
export function gerarSenhaForte(tamanho = 16, sortear: Sorteio = sorteioPadrao): string {
  const n = Math.max(12, Math.min(64, Math.floor(tamanho) || 16));
  const todos = MINUSCULAS + MAIUSCULAS + DIGITOS + SIMBOLOS;
  const letras = [MINUSCULAS, MAIUSCULAS, DIGITOS, SIMBOLOS].map((g) => g[indice(g.length, sortear)]);
  while (letras.length < n) letras.push(todos[indice(todos.length, sortear)]);
  for (let i = letras.length - 1; i > 0; i--) {
    const j = indice(i + 1, sortear);
    const t = letras[i];
    letras[i] = letras[j];
    letras[j] = t;
  }
  return letras.join("");
}

/** O que falta numa senha digitada. null quando serve. A frase nunca repete a senha. */
export function problemaDaSenha(senha: unknown): string | null {
  if (typeof senha !== "string" || !senha) return "Digite ou gere a senha.";
  if (senha.length < 10) return "A senha precisa de pelo menos 10 caracteres.";
  if (senha.length > 72) return "A senha pode ter no máximo 72 caracteres.";
  if (/\s/.test(senha)) return "A senha não pode ter espaço.";
  const tipos = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(senha)).length;
  if (tipos < 3) return "Misture letras maiúsculas, minúsculas, números ou símbolos.";
  return null;
}

// ------------------------------------------------------------------ extra "crm" do cliente

export type MudancaNaEquipe = "entrou" | "saiu";

/**
 * Quantos usuários o extra "crm" cobra depois de uma pessoa entrar ou sair (cobrança pelo plano do cliente).
 * Entrou: só cresce quando não há lugar livre (lugar contratado e vazio não cobra de novo).
 * Saiu: tira um usuário da cobrança, sem ficar abaixo de quem continua na equipe nem de 1.
 */
export function quantidadeDoExtraCrm(p: { atual: number; pessoasDepois: number; mudanca: MudancaNaEquipe }): number {
  const atual = Math.max(1, Math.floor(Number(p.atual) || 1));
  const pessoas = Math.max(0, Math.floor(Number(p.pessoasDepois) || 0));
  const nova = p.mudanca === "entrou" ? Math.max(atual, pessoas) : Math.max(1, pessoas, atual - 1);
  return Math.min(500, nova);
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * O valor do extra para a quantidade nova. Mantém o preço por usuário que o extra já tinha (desconto dado
 * à mão continua); sem valor anterior, usa o preço por usuário do plano (49,90 no plano de hoje).
 */
export function valorDoExtraCrm(p: { quantidadeAtual: number; valorAtual: number; quantidadeNova: number; precoDoPlano: number }): number {
  const qa = Math.floor(Number(p.quantidadeAtual) || 0);
  const va = Number(p.valorAtual) || 0;
  const unitario = qa > 0 && va > 0 ? va / qa : Number(p.precoDoPlano) || 0;
  return centavos(Math.max(0, unitario * Math.max(0, Math.floor(Number(p.quantidadeNova) || 0))));
}

/** O que muda na cobrança, para a tela mostrar antes e o servidor gravar depois. null = nada muda. */
export function ajusteDoExtraCrm(p: { quantidadeAtual: number; valorAtual: number; pessoasDepois: number; mudanca: MudancaNaEquipe; precoDoPlano: number }): { quantidade: number; valor: number } | null {
  const quantidade = quantidadeDoExtraCrm({ atual: p.quantidadeAtual, pessoasDepois: p.pessoasDepois, mudanca: p.mudanca });
  const valor = valorDoExtraCrm({ quantidadeAtual: p.quantidadeAtual, valorAtual: p.valorAtual, quantidadeNova: quantidade, precoDoPlano: p.precoDoPlano });
  if (quantidade === Math.floor(Number(p.quantidadeAtual) || 0) && Math.abs(valor - (Number(p.valorAtual) || 0)) < 0.005) return null;
  return { quantidade, valor };
}

// ------------------------------------------------------------------ extra de e-mail

/**
 * O valor do extra de e-mail depois de uma caixa entrar ou sair. As caixas até o limite do mensal estão no
 * preço; cada caixa além disso soma (ou tira) o preço da caixa adicional. null = nada muda.
 */
export function valorDoExtraDeEmail(p: { valorAtual: number; caixasAntes: number; mudanca: MudancaNaEquipe; caixasNoMensal: number; precoDaCaixaExtra: number }): number | null {
  const antes = Math.max(0, Math.floor(Number(p.caixasAntes) || 0));
  const depois = p.mudanca === "entrou" ? antes + 1 : Math.max(0, antes - 1);
  const inclusas = Math.max(0, Math.floor(Number(p.caixasNoMensal) || 0));
  const extrasAntes = Math.max(0, antes - inclusas);
  const extrasDepois = Math.max(0, depois - inclusas);
  const preco = Math.max(0, Number(p.precoDaCaixaExtra) || 0);
  if (extrasAntes === extrasDepois || preco <= 0) return null;
  const valor = centavos((Number(p.valorAtual) || 0) + (extrasDepois - extrasAntes) * preco);
  return valor > 0 ? valor : null;
}

// ------------------------------------------------------------------ envio do link por e-mail

export type SituacaoDoEnvio = "enviado" | "na_fila" | "falhou" | "desconhecido";

/** O que a fila de e-mail (email_send_log) diz, numa frase para a casa. O erro técnico vira motivo claro. */
export function leituraDoEnvio(status: unknown, erro: unknown): { situacao: SituacaoDoEnvio; frase: string } {
  const s = String(status || "");
  const e = String(erro || "").toLowerCase();
  if (s === "sent") return { situacao: "enviado", frase: "E-mail enviado." };
  if (s === "pending" || s === "rate_limited") return { situacao: "na_fila", frase: "O e-mail está na fila de envio." };
  if (s === "failed" || s === "dlq" || s === "bounced" || s === "suppressed" || s === "complained") {
    let motivo = "o envio de e-mail recusou";
    if (/domain|domínio|verif/.test(e)) motivo = "o domínio de envio da Aceleriq ainda não está verificado no Resend";
    else if (s === "suppressed" || /suppress|unsubscrib/.test(e)) motivo = "esse endereço pediu para não receber e-mails";
    else if (/api key|unauthori|401|403/.test(e)) motivo = "a chave do envio de e-mail não foi aceita";
    else if (s === "bounced" || /bounce/.test(e)) motivo = "o endereço devolveu o e-mail";
    return { situacao: "falhou", frase: `O e-mail não saiu: ${motivo}. Copie o link e mande pelo WhatsApp.` };
  }
  return { situacao: "desconhecido", frase: "Não deu para confirmar o envio. Se a pessoa não receber, copie o link." };
}
