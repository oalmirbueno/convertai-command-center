/**
 * A cara do cliente no painel, como uma LISTA de candidatas em ordem: a foto
 * de cadastro, a logo dos arquivos (miniatura leve) e a foto do perfil do
 * Instagram. Quem desenha tenta a primeira e, se a imagem nao abrir, passa
 * para a seguinte; sem nenhuma, as iniciais.
 *
 * 26/10/2026: a logo subiu para antes do Instagram. O link da foto do perfil
 * vem da CDN da Meta e vence em cerca de 4 dias (parametro `oe=`), enquanto a
 * recaptura roda a cada 7: 12 de 16 fotos estavam vencidas e 11 clientes com
 * logo nos arquivos caiam nas iniciais. Link vencido nem entra na lista.
 */

export interface FotoDoCliente {
  url: string;
  tipo: "foto" | "instagram" | "logo";
}

export interface ArquivoDeLogo {
  id: string;
  client_id: string;
  file_name: string;
  file_url: string;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  created_at?: string | null;
}

const PESOS: Array<[RegExp, number]> = [
  [/perfil|instagram|avatar|redond|circul/i, 50],
  [/reduzid|simplificad|icone|ícone|simbolo|símbolo|marca[_ -]?d[’']?agua/i, 40],
  [/principal|oficial|aprovad/i, 30],
  [/colorid|cores/i, 20],
  [/transparente|sem[_ -]?fundo/i, 10],
  [/horizontal|completa|slogan|assinatura/i, -15],
  [/vertical/i, -10],
  [/branc|white|negativ|fundo[_ -]?escuro|invertid/i, -40],
  [/pret[ao]\b|black|monocrom/i, -25],
];

/** Quanto mais alto, melhor esta logo serve como foto redonda no painel. */
export function pontuarLogo(nome: string): number {
  let total = 0;
  for (const [re, peso] of PESOS) if (re.test(nome)) total += peso;
  if (/\.png$/i.test(nome)) total += 5;
  if (/\.svg$/i.test(nome)) total -= 100; // nao renderiza em <img> com seguranca em todo lugar
  return total;
}

export function escolherArquivoDeLogo(arquivos: readonly ArquivoDeLogo[]): ArquivoDeLogo | null {
  const imagens = arquivos.filter((a) => !a.mime_type || /^image\//i.test(a.mime_type));
  if (imagens.length === 0) return null;
  return [...imagens].sort((a, b) => {
    const d = pontuarLogo(b.file_name) - pontuarLogo(a.file_name);
    if (d !== 0) return d;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  })[0];
}

/**
 * Quando o link da Meta (fbcdn / cdninstagram) deixa de abrir: o parametro
 * `oe=` e o vencimento em segundos desde 1970, escrito em hexadecimal.
 * Link de outro lugar, ou sem `oe=`, devolve null (nao sabemos).
 */
export function vencimentoDoLinkDaMeta(url?: string | null): number | null {
  const u = String(url ?? "");
  if (!/^https?:\/\/[^/?#]*(fbcdn\.net|cdninstagram\.com|facebook\.com)(?=[/?#:]|$)/i.test(u)) return null;
  const m = /[?&]oe=([0-9a-f]{6,12})(?=&|#|$)/i.exec(u);
  if (!m) return null;
  const segundos = parseInt(m[1], 16);
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : null;
}

export function linkDaMetaVencido(url?: string | null, agora: number = Date.now()): boolean {
  const vence = vencimentoDoLinkDaMeta(url);
  return vence !== null && vence <= agora;
}

/** Junta listas de candidatas: tira vazio, link da Meta vencido e repetido, mantendo a ordem. */
export function juntarCandidatas(
  listas: ReadonlyArray<ReadonlyArray<FotoDoCliente | null | undefined> | null | undefined>,
  agora: number = Date.now(),
): FotoDoCliente[] {
  const vistas = new Set<string>();
  const saida: FotoDoCliente[] = [];
  for (const lista of listas) {
    for (const f of lista ?? []) {
      const url = f?.url?.trim();
      if (!f || !url || vistas.has(url) || linkDaMetaVencido(url, agora)) continue;
      vistas.add(url);
      saida.push(url === f.url ? f : { ...f, url });
    }
  }
  return saida;
}

/** As candidatas em ordem: cadastro, logo leve, Instagram (so se o link ainda abre). */
export function candidatasDaFoto(input: {
  avatarUrl?: string | null;
  logoUrl?: string | null;
  instagramUrl?: string | null;
  agora?: number;
}): FotoDoCliente[] {
  return juntarCandidatas([[
    input.avatarUrl ? { url: input.avatarUrl, tipo: "foto" } : null,
    input.logoUrl ? { url: input.logoUrl, tipo: "logo" } : null,
    input.instagramUrl ? { url: input.instagramUrl, tipo: "instagram" } : null,
  ]], input.agora);
}

/** A primeira candidata (quem so guarda uma foto). */
export function fotoDoCliente(input: { avatarUrl?: string | null; instagramUrl?: string | null; logoUrl?: string | null; agora?: number }): FotoDoCliente | null {
  return candidatasDaFoto(input)[0] ?? null;
}

/** Duas letras para o circulo sem foto: "Mirante Luz Floripa" -> "ML". */
export function iniciaisDoCliente(nome?: string | null): string {
  const partes = String(nome ?? "").trim().split(/\s+/).filter((p) => p && !/^[-–·|]$/.test(p));
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}
