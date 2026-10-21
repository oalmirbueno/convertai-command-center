import type { ImagemDoAcervo } from "../SeletorDoAcervo";
import type { CardDaDirecao } from "../useItensDoMes";

type Fonte = { caminho: string; bucket: string };
export function fonteDoProfile(card: CardDaDirecao, acervo: ImagemDoAcervo[]): Fonte | null {
  const foto = card.fotos_livres?.find((f) => f.papel === "fundo" && f.uso !== "rosto") || card.fotos_livres?.find((f) => f.uso !== "rosto") || card.fotos_livres?.[0];
  if (foto?.caminho) return { caminho: foto.caminho, bucket: "mesa" };
  const imagem = card.imagens_ids?.map((id) => acervo.find((i) => i.id === id)).find((i) => !!i);
  return imagem ? { caminho: imagem.storage_path, bucket: imagem.storage_bucket || "mesa" } : null;
}
