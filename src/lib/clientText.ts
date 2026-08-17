/**
 * Traduções para a linguagem do cliente.
 *
 * O painel guarda nomes de organização interna: arquivos com data e underline,
 * projetos prefixados com o nome do cliente. Quando isso vazava para a
 * mensagem do grupo, o cliente lia "SKC | Marketing, Presença Digital e
 * Aquisição" e não entendia o que aquilo tinha a ver com ele.
 */

/** Nome de arquivo vira algo legível: sem extensão, código ou underline. */
export function readableFileName(fileName: string): string {
  return String(fileName)
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\d{6,}/g, "")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O nome da frente sem o prefixo do cliente.
 *
 * "SKC | Marketing, Presença Digital e Aquisição" vira "Marketing, Presença
 * Digital e Aquisição": o cliente já sabe que a conversa é sobre ele.
 */
export function readableProjectName(projectName: string, clientName: string): string {
  const primeiro = String(clientName).trim().split(/\s+/)[0] || "";
  // Caractere especial no nome (ponto, parêntese) quebraria a expressão.
  const seguro = primeiro.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const semPrefixo = seguro
    ? String(projectName).replace(new RegExp(`^\\s*${seguro}\\s*[|:·-]\\s*`, "i"), "")
    : String(projectName);
  return semPrefixo.replace(/^\s*[|:·-]\s*/, "").trim();
}

/** "a, b e c" — do jeito que se fala, não "a, b, c". */
export function listInWords(items: string[], max = 2): string {
  const usados = items.filter(Boolean).slice(0, max);
  if (usados.length === 0) return "";
  if (usados.length === 1) return usados[0];
  return `${usados.slice(0, -1).join(", ")} e ${usados[usados.length - 1]}`;
}
