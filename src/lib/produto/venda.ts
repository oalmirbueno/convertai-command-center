/**
 * Página de venda do CRM e caminho de compra direto (13/11/2026).
 * Regras sem rede, para o teste provar: o endereço que leva a escolha da
 * página de venda até o cadastro, a leitura dessa escolha e a conferência do
 * CPF ou CNPJ antes de mandar a pessoa para o checkout.
 */

export interface EscolhaDeCompra {
  plano: string;
  usuarios: number;
}

const PLANO_VALIDO = /^[a-z0-9_]{2,40}$/;

export const usuariosValidos = (n: unknown, minimo = 1): number => Math.max(minimo, Math.min(500, Math.floor(Number(n) || minimo)));

/** O endereço do cadastro com a escolha feita na página de venda. */
export function enderecoDeCompra(e: EscolhaDeCompra, origem = ""): string {
  const plano = PLANO_VALIDO.test(e.plano) ? e.plano : "starter";
  const partes = [`plano=${plano}`, `usuarios=${usuariosValidos(e.usuarios)}`];
  // A origem do anúncio (utm_*) segue junto, para o cadastro saber de onde a pessoa veio.
  origem.replace(/^\?/, "").split("&").forEach((par) => {
    const chave = par.split("=")[0];
    if (/^utm_[a-z]{2,12}$/.test(chave) && par.length <= 160) partes.push(par);
  });
  return `/crm/comecar?${partes.join("&")}`;
}

/** A escolha que veio no endereço, ou nada quando a pessoa chegou sem escolher. */
export function lerEscolhaDeCompra(busca: string): EscolhaDeCompra | null {
  let plano = "";
  let usuarios = "";
  busca.replace(/^\?/, "").split("&").forEach((par) => {
    const i = par.indexOf("=");
    if (i < 0) return;
    const chave = par.slice(0, i);
    let valor = par.slice(i + 1);
    try {
      valor = decodeURIComponent(valor);
    } catch {
      valor = "";
    }
    if (chave === "plano") plano = valor;
    if (chave === "usuarios") usuarios = valor;
  });
  if (!PLANO_VALIDO.test(plano)) return null;
  return { plano, usuarios: usuariosValidos(usuarios) };
}

export const soDigitos = (v: string) => String(v || "").replace(/\D/g, "");

function cpfConfere(d: string): boolean {
  if (/^(\d)\1{10}$/.test(d)) return false;
  const digito = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

function cnpjConfere(d: string): boolean {
  if (/^(\d)\1{13}$/.test(d)) return false;
  const digito = (ate: number) => {
    let soma = 0;
    let peso = ate - 7;
    for (let i = 0; i < ate; i++) {
      soma += Number(d[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

/** CPF (11) ou CNPJ (14) com os dígitos de conferência certos. Devolve só os números, ou vazio. */
export function documentoConferido(v: string): string {
  const d = soDigitos(v);
  if (d.length === 11) return cpfConfere(d) ? d : "";
  if (d.length === 14) return cnpjConfere(d) ? d : "";
  return "";
}

/** O documento como a pessoa lê enquanto digita. */
export function documentoLegivel(v: string): string {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/**
 * O que acontece depois de criar a empresa pelo caminho direto.
 * Cobrança desligada: a empresa entra em teste, sem cartão.
 * Cobrança ligada: a pessoa vai para o checkout; sem documento válido não dá
 * para abrir o checkout, então ela cai no teste e assina depois em Conta, Plano.
 */
export function destinoDaCompra(p: { pagamentosAtivos: boolean; documento: string }): "teste" | "checkout" {
  return p.pagamentosAtivos && !!documentoConferido(p.documento) ? "checkout" : "teste";
}

/** Onde o produto mora. A página de venda também abre num subdomínio só dela. */
export const ENDERECO_DO_APP = "https://aceleriq.online";
export const SUBDOMINIO_DE_VENDA = "crm.aceleriq.online";

export const ehSubdominioDeVenda = (host: string) => String(host || "").toLowerCase() === SUBDOMINIO_DE_VENDA;

/** No subdomínio de venda, cadastro, login e produto abrem no endereço do produto; fora dele, o caminho é relativo. */
export const baseDoApp = (host: string) => (ehSubdominioDeVenda(host) ? ENDERECO_DO_APP : "");
