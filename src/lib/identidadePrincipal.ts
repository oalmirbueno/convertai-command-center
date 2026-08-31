/**
 * Qual das contas do cliente representa a marca dele.
 *
 * Um cliente pode ter mais de um perfil no Instagram. A AcelerIQ tem
 * @aceleriq e @sitebolt, capturados no MESMO segundo — e a regra anterior
 * ("a mais recente vence") não tinha desempate: a ordem virava sorteio, e
 * a logo do sitebolt apareceu como se fosse a da AcelerIQ.
 *
 * Mostrar a marca errada é pior que não mostrar marca nenhuma: quem olha
 * confia no que vê e não tem como desconfiar.
 *
 * A escolha agora sai de dois sinais reais, nesta ordem:
 *
 *  1. O handle CONVERSA com o nome do cliente. É o sinal mais forte que
 *     existe sem ninguém marcar nada à mão — @aceleriq para "AcelerIQ",
 *     @verzelo.jardins para "Verzelo - Jardins e Poda de árvores".
 *  2. Quantos posts a conta tem no painel. Entre dois perfis do mesmo
 *     dono, o principal é onde se posta.
 */

export interface IdentidadeCandidata {
  external_account_id?: string | null;
  client_id: string;
  username: string | null;
  profile_picture_url: string | null;
  captured_at?: string | null;
  /** Quantos posts do painel pertencem a esta conta. */
  posts?: number;
}

/** Só letras e números, minúsculo: acento e pontuação não decidem nada. */
export function normalizar(texto?: string | null): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * O handle conversa com o nome do cliente?
 *
 * Contenção nos dois sentidos: "acerbispc" contém "acerbi", e
 * "verzelojardinsepodadearvores" contém "verzelojardins". Exigir
 * igualdade exata reprovaria os dois, e é justamente o caso comum.
 *
 * O mínimo de 4 caracteres impede que um handle curto case com metade dos
 * clientes por acidente.
 */
export function handleCombina(handle?: string | null, nomeDoCliente?: string | null): boolean {
  const h = normalizar(handle);
  const n = normalizar(nomeDoCliente);
  if (h.length < 4 || n.length < 4) return false;
  return h.includes(n) || n.includes(h);
}

export function escolherIdentidadePrincipal(
  candidatas: readonly IdentidadeCandidata[],
  nomeDoCliente?: string | null,
): IdentidadeCandidata | null {
  if (candidatas.length === 0) return null;
  if (candidatas.length === 1) return candidatas[0];

  const pontuar = (c: IdentidadeCandidata) => {
    // O nome pesa mais que qualquer volume: uma conta secundária muito
    // ativa não vira a cara da marca.
    const nome = handleCombina(c.username, nomeDoCliente) ? 1_000_000 : 0;
    // Sem foto não serve para o que a escolha existe.
    const temFoto = c.profile_picture_url ? 1000 : 0;
    return nome + temFoto + Math.min(Number(c.posts) || 0, 999);
  };

  return [...candidatas].sort((a, b) => {
    const d = pontuar(b) - pontuar(a);
    if (d !== 0) return d;
    // Empate real: a mais recente, e depois o username, para a escolha ser
    // ESTÁVEL entre recargas em vez de mudar sozinha.
    const t = String(b.captured_at ?? "").localeCompare(String(a.captured_at ?? ""));
    if (t !== 0) return t;
    return String(a.username ?? "").localeCompare(String(b.username ?? ""));
  })[0];
}
