/**
 * Tipos de cena que a equipe pede na hora no estúdio de mockups (a IA desenha a superfície lisa;
 * a marca entra pelo código). Módulo puro, sem rede: a tela e os testes leem daqui.
 */
export type TipoDeCena = "fachada" | "social" | "papelaria" | "embalagem" | "veiculo" | "vestuario" | "sinalizacao" | "digital";

export const TIPOS_DE_CENA: Array<{ id: TipoDeCena; rotulo: string }> = [
  { id: "fachada", rotulo: "Fachada" },
  { id: "sinalizacao", rotulo: "Sinalização" },
  { id: "veiculo", rotulo: "Veículo" },
  { id: "embalagem", rotulo: "Embalagem" },
  { id: "papelaria", rotulo: "Papelaria" },
  { id: "vestuario", rotulo: "Vestuário" },
  { id: "digital", rotulo: "Tela digital" },
  { id: "social", rotulo: "Redes sociais" },
];

export const rotuloDoTipoDeCena = (t: string) => (TIPOS_DE_CENA.find((x) => x.id === t) || { rotulo: "Cena" }).rotulo;
