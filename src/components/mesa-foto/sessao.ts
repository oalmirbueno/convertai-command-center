/**
 * Guardado na sessão do navegador, por cliente (só JSON): a identificação
 * do produto, as propostas e o kit novo sobrevivem à troca de etapa. Fotos e
 * Produto leem a mesma chave (a identificação feita em Fotos aparece em
 * Produto e vice-versa).
 */
const chaveDaSessao = (clientId: string, nome: string) => `mesa-foto:${nome}:${clientId}`;

export function lerDaSessao<T>(clientId: string, nome: string): T | null {
  try {
    const bruto = window.sessionStorage.getItem(chaveDaSessao(clientId, nome));
    return bruto ? (JSON.parse(bruto) as T) : null;
  } catch {
    return null;
  }
}

export function gravarNaSessao(clientId: string, nome: string, valor: unknown) {
  try {
    if (valor === null || valor === undefined || (Array.isArray(valor) && !valor.length)) window.sessionStorage.removeItem(chaveDaSessao(clientId, nome));
    else window.sessionStorage.setItem(chaveDaSessao(clientId, nome), JSON.stringify(valor));
  } catch {
    /* sem armazenamento: vale só nesta tela */
  }
}
