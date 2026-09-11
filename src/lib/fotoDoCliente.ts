/**
 * A cara do cliente no painel: a foto de cadastro, senao a foto do perfil
 * do Instagram (a mesma que /metricas mostra), senao a logo mais
 * "de perfil" que existe nos arquivos dele. Sem nada, as iniciais.
 *
 * A ordem importa: o cadastro e o que alguem escolheu a mao; o Instagram e
 * a marca como o mundo a ve; a logo dos arquivos e um palpite bem feito.
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

export function fotoDoCliente(input: { avatarUrl?: string | null; instagramUrl?: string | null; logoUrl?: string | null }): FotoDoCliente | null {
  if (input.avatarUrl && input.avatarUrl.trim()) return { url: input.avatarUrl, tipo: "foto" };
  if (input.instagramUrl && input.instagramUrl.trim()) return { url: input.instagramUrl, tipo: "instagram" };
  if (input.logoUrl && input.logoUrl.trim()) return { url: input.logoUrl, tipo: "logo" };
  return null;
}

/** Duas letras para o circulo sem foto: "Mirante Luz Floripa" -> "ML". */
export function iniciaisDoCliente(nome?: string | null): string {
  const partes = String(nome ?? "").trim().split(/\s+/).filter((p) => p && !/^[-–·|]$/.test(p));
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}
