/**
 * Negrito e destaques do texto da lâmina (23/10/2026, dono: "selecionar a palavra pra ficar em negrito, e a IA
 * já gera, melhora e destaca as melhores palavras"). O formato é o de sempre: **trecho** em negrito, por
 * linha (um par de asteriscos não atravessa a quebra de linha). Puro: a tela (botão B e Ctrl+B) e o servidor
 * (o gerador e o "Destacar") usam as mesmas regras. Sem lookbehind, sem classe Unicode e sem grupo nomeado.
 */

/** O texto lido como letras com a marca de negrito de cada uma (as quebras de linha ficam como "\n"). */
export interface TextoMarcado { letras: string[]; negrito: boolean[] }

/**
 * Os trechos de uma linha, como o desenho de toda lâmina lê (24/10): "**" sem par é marca sobrando e sai
 * (o último da linha), e dois negritos separados só por espaço viram um ("**Separe** **atestados**").
 */
export function partesDaLinha(linha: string): Array<{ texto: string; negrito: boolean }> {
  const partes = linha.split("**");
  if (partes.length % 2 === 0) { const ultima = partes.pop() as string; partes[partes.length - 1] += ultima; }
  const brutas = partes.map((texto, i) => ({ texto, negrito: i % 2 === 1 })).filter((x) => x.texto);
  const saida: Array<{ texto: string; negrito: boolean }> = [];
  for (let i = 0; i < brutas.length; i++) {
    const p = brutas[i], antes = saida[saida.length - 1], depois = brutas[i + 1];
    if (!p.negrito && /^\s+$/.test(p.texto) && antes && antes.negrito && depois && depois.negrito) { antes.texto += p.texto + depois.texto; i++; continue; }
    if (antes && antes.negrito === p.negrito) antes.texto += p.texto; else saida.push({ ...p });
  }
  return saida;
}

/** Lê "**trecho**" por linha, pelas mesmas regras do desenho (partesDaLinha). */
export function lerNegrito(texto: string): TextoMarcado {
  const letras: string[] = [], negrito: boolean[] = [];
  texto.replace(/\r/g, "").split("\n").forEach((linha, i) => {
    if (i > 0) { letras.push("\n"); negrito.push(false); }
    for (const p of partesDaLinha(linha)) for (const c of Array.from(p.texto)) { letras.push(c); negrito.push(p.negrito); }
  });
  return { letras, negrito };
}

/** O texto com o negrito limpo: vizinhos juntos, sem espaço dentro das pontas e sem "**" sobrando. */
export const normalizarNegrito = (texto: string) => escreverNegrito(lerNegrito(texto)).replace(/[ \t]+(\n|$)/g, "$1").trim();

/** Escreve de volta: trechos em negrito sem espaço nas pontas (o espaço fica fora dos asteriscos). */
export function escreverNegrito(m: TextoMarcado): string {
  // Espaço entre dois negritos da mesma linha entra no negrito: um par de asteriscos só.
  const negrito = m.negrito.slice();
  for (let i = 0; i < m.letras.length; i++) {
    if (negrito[i] || !/^[ \t]$/.test(m.letras[i])) continue;
    let a = i - 1, b = i + 1;
    while (a >= 0 && /^[ \t]$/.test(m.letras[a])) a--;
    while (b < m.letras.length && /^[ \t]$/.test(m.letras[b])) b++;
    if (a >= 0 && b < m.letras.length && negrito[a] && negrito[b] && m.letras[a] !== "\n" && m.letras[b] !== "\n") negrito[i] = true;
  }
  m = { letras: m.letras, negrito };
  let saida = "";
  let i = 0;
  while (i < m.letras.length) {
    if (!m.negrito[i] || m.letras[i] === "\n") { saida += m.letras[i]; i++; continue; }
    let f = i;
    while (f < m.letras.length && m.negrito[f] && m.letras[f] !== "\n") f++;
    const trecho = m.letras.slice(i, f).join("");
    const antes = trecho.length - trecho.replace(/^\s+/, "").length;
    const depois = trecho.length - trecho.replace(/\s+$/, "").length;
    const meio = trecho.slice(antes, trecho.length - depois);
    saida += trecho.slice(0, antes) + (meio ? `**${meio}**` : "") + trecho.slice(trecho.length - depois);
    i = f;
  }
  return saida;
}

const ehLetra = (c: string) => !!c && !/\s/.test(c) && c !== "*";

/** Posição no texto marcado (com asteriscos) para posição nas letras, e o contrário. */
function mapaParaLetras(texto: string): number[] {
  // Para cada posição do texto marcado, a posição da letra correspondente (asterisco de marca: a próxima letra).
  const mapa: number[] = [];
  let letra = 0;
  texto.replace(/\r/g, "").split("\n").forEach((linha, i) => {
    if (i > 0) { mapa.push(letra); letra++; }
    // Todo "**" é marca (o que sobra sem par também sai na leitura).
    // Por letra (emoji ocupa duas posições no campo e uma letra).
    const cps = Array.from(linha);
    let k = 0;
    while (k < cps.length) {
      if (cps[k] === "*" && cps[k + 1] === "*") { mapa.push(letra, letra); k += 2; continue; }
      for (let u = 0; u < cps[k].length; u++) mapa.push(letra);
      letra++; k++;
    }
  });
  mapa.push(letra);
  return mapa;
}

/** Onde cada letra ficou no texto escrito (para a seleção voltar ao mesmo trecho). */
function posicoesNoEscrito(m: TextoMarcado, escrito: string): number[] {
  const pos: number[] = [];
  let j = 0;
  for (let i = 0; i < m.letras.length; i++) {
    while (j < escrito.length && escrito[j] === "*" && m.letras[i] !== "*") j++;
    pos.push(j);
    j += m.letras[i].length;
  }
  pos.push(escrito.length);
  return pos;
}

/**
 * O botão B e o Ctrl+B: a seleção (no texto como está no campo, com os asteriscos) vira negrito; se já está
 * toda em negrito, sai do negrito. Sem seleção, vale a palavra onde está o cursor. Devolve o texto novo e a
 * seleção sobre o mesmo trecho.
 */
export function alternarNegrito(texto: string, inicio: number, fim: number): { texto: string; inicio: number; fim: number } {
  const m = lerNegrito(texto);
  const mapa = mapaParaLetras(texto);
  let a = mapa[Math.max(0, Math.min(inicio, mapa.length - 1))];
  let b = mapa[Math.max(0, Math.min(Math.max(inicio, fim), mapa.length - 1))];
  if (a === b) {
    // Sem seleção: a palavra em volta do cursor.
    while (a > 0 && ehLetra(m.letras[a - 1])) a--;
    while (b < m.letras.length && ehLetra(m.letras[b])) b++;
  }
  while (a < b && /\s/.test(m.letras[a])) a++;
  while (b > a && /\s/.test(m.letras[b - 1])) b--;
  if (a >= b) return { texto, inicio, fim };
  const todas = m.negrito.slice(a, b).every((x, k) => x || m.letras[a + k] === "\n" || /\s/.test(m.letras[a + k]));
  for (let i = a; i < b; i++) m.negrito[i] = m.letras[i] === "\n" ? false : !todas;
  const novo = escreverNegrito(m);
  const pos = posicoesNoEscrito(m, novo);
  return { texto: novo, inicio: pos[a], fim: pos[b - 1] + m.letras[b - 1].length };
}

/** Os trechos em negrito do texto (sem as marcas), na ordem. */
export function trechosEmNegrito(texto: string): string[] {
  const m = lerNegrito(texto);
  const saida: string[] = [];
  let atual = "";
  m.letras.forEach((c, i) => {
    if (m.negrito[i] && c !== "\n") atual += c;
    else if (atual) { saida.push(atual.trim()); atual = ""; }
  });
  if (atual) saida.push(atual.trim());
  return saida.filter(Boolean);
}

const palavras = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Destaque bom (23/10): de 1 a 3 trechos curtos (até 5 palavras), nunca a frase inteira (no máximo 45% das
 * letras da lâmina). O que passa disso perde o negrito, do mais longo para o mais curto.
 */
export function limitarDestaques(texto: string, maximo = 3): string {
  const m = lerNegrito(texto);
  const total = m.letras.filter((c) => !/\s/.test(c)).length || 1;
  const trechos: Array<{ de: number; ate: number; tamanho: number; palavras: number }> = [];
  for (let i = 0; i < m.letras.length;) {
    if (!m.negrito[i]) { i++; continue; }
    let f = i;
    while (f < m.letras.length && m.negrito[f]) f++;
    const t = m.letras.slice(i, f).join("");
    trechos.push({ de: i, ate: f, tamanho: t.replace(/\s/g, "").length, palavras: palavras(t) });
    i = f;
  }
  const tirar = (x: { de: number; ate: number }) => { for (let k = x.de; k < x.ate; k++) m.negrito[k] = false; };
  trechos.filter((x) => x.palavras > 5).forEach(tirar);
  let ficam = trechos.filter((x) => x.palavras <= 5).sort((x, y) => y.tamanho - x.tamanho);
  while (ficam.length > maximo || (ficam.length && ficam.reduce((s, x) => s + x.tamanho, 0) > total * 0.45)) { tirar(ficam[0]); ficam = ficam.slice(1); }
  return escreverNegrito(m);
}

/**
 * Candidatos a destaque escolhidos pelo código (o Jev só escolhe entre eles): números com a unidade, valores
 * em reais, percentuais e as palavras fortes (longas ou com maiúscula no meio da frase). Até 6, sem repetir.
 */
export function candidatosDeDestaque(texto: string): string[] {
  const plano = lerNegrito(texto).letras.join("");
  const achados: string[] = [];
  const pegar = (re: RegExp) => { let m: RegExpExecArray | null; while ((m = re.exec(plano))) { const t = m[0].trim().replace(/[.,;:!?]+$/, ""); if (t && achados.indexOf(t) < 0) achados.push(t); } };
  pegar(/R\$\s?\d[\d.,]*(\s?(mil|mi|milhões|bi|bilhões))?/gi);
  pegar(/\d[\d.,]*\s?(%|x|mil|mi|milhões|bi|bilhões|dias|anos|meses|horas|minutos|vezes|pessoas|clientes)(?=[\s.,;:!?]|$)/gi);
  pegar(/\d[\d.,]*/g);
  const palavrasFortes = plano.split(/[\s.,;:!?()"“”→]+/).filter((p) => p.length >= 7 || /^[A-ZÀ-Ý][a-zà-ÿ]+[A-ZÀ-Ý]/.test(p) || (/^[A-ZÀ-Ý]/.test(p) && p.length >= 4));
  for (const p of palavrasFortes) if (achados.indexOf(p) < 0 && !achados.some((a) => a.indexOf(p) >= 0)) achados.push(p);
  return achados.filter((a) => !/^\d{1,2}$/.test(a) || /%|x/.test(a)).slice(0, 6);
}

/** Põe em negrito a primeira ocorrência de cada trecho (sem mexer no que já está em negrito). */
export function aplicarDestaques(texto: string, trechos: string[]): string {
  const m = lerNegrito(texto);
  const plano = m.letras.join("");
  for (const t of trechos) {
    const j = plano.indexOf(t);
    if (j < 0 || !t.trim()) continue;
    const i = Array.from(plano.slice(0, j)).length;
    for (let k = i; k < i + Array.from(t).length; k++) if (m.letras[k] !== "\n") m.negrito[k] = true;
  }
  return escreverNegrito(m);
}

/** Tira todo o negrito (o "Destacar" refaz do zero). */
export const semNegrito = (texto: string) => lerNegrito(texto).letras.join("");
