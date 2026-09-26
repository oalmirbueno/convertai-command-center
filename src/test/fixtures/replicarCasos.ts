/**
 * Casos do prompt do modo replicar referência (promptDoReplicar) e do bloco
 * da série (blocoDaSerie), usados para provar que o nível "Idêntica" (o padrão)
 * continua byte a byte igual ao prompt aprovado pelo dono em 25/09 à noite.
 * A saída de hoje está em replicar-identica-hoje.json (gerada antes da
 * mudança). Não mude estes casos sem gerar de novo a partir do código antigo.
 */
import type { MarcaParaDirecao, MoldeDaReferencia } from "../../../supabase/functions/_shared/direcao-arte";

export const MARCA_CASO: MarcaParaDirecao = {
  nomeCliente: "Cliente sintético",
  paleta: [{ nome: "Verde", hex: "#1f6f43", papel: "fundo" }, { nome: "Creme", hex: "#f5f0e6", papel: "texto" }, { nome: "Laranja", hex: "#e8742a", papel: "destaque" }],
  estilo: "fotografia natural, luz de manhã",
  regras: "Nunca usar vermelho.\nSempre com respiro.",
  fontes: [{ nome: "Fonte Título", papel: "titulo" }, { nome: "Fonte Texto", papel: "texto" }],
  temLogo: true,
};

export const MOLDE_CASO: MoldeDaReferencia = {
  versao: 1,
  proporcao: "4:5",
  fundo: "cor lisa clara",
  cor_do_fundo: "#F2F2EE",
  grade: "Título enorme na faixa de cima; pessoa centralizada embaixo; textos pequenos nos cantos.",
  assunto: { tipo: "pessoa", descricao: "pessoa olhando para a câmera", enquadramento: "plano médio frontal", x0: 24, y0: 30, x1: 76, y1: 100 },
  blocos: [
    { papel: "titulo", x0: 6, y0: 6, x1: 94, y1: 27, altura_da_letra: 9.5, linhas: 2, caixa_alta: true, familia: "sem serifa", largura_da_letra: "condensada", peso: "black", cor: "#1E4FD8", alinhamento: "centro" },
    { papel: "rotulo", x0: 5, y0: 2, x1: 30, y1: 4.5, altura_da_letra: 1.4, linhas: 1, caixa_alta: true, familia: "sem serifa", largura_da_letra: "normal", peso: "medio", cor: "#111111", alinhamento: "esquerda" },
    { papel: "texto", x0: 5, y0: 88, x1: 32, y1: 96, altura_da_letra: 1.6, linhas: 3, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "regular", cor: "#111111", alinhamento: "esquerda" },
    { papel: "cta", x0: 60, y0: 80, x1: 92, y1: 86, altura_da_letra: 2.2, linhas: 1, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "negrito", cor: "#FF5500", alinhamento: "direita" },
    { papel: "perfil", x0: 70, y0: 92, x1: 95, y1: 95.5, altura_da_letra: 1.5, linhas: 1, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "medio", cor: "#111111", alinhamento: "direita" },
  ],
  elementos: [
    { descricao: "celulares inclinados em volta da pessoa", cor: "#1E4FD8", x0: 4, y0: 35, x1: 96, y1: 85 },
    { descricao: "fio fino sob o título", cor: "#FF5500", x0: 30, y0: 28, x1: 70, y1: 29 },
  ],
  tratamento: "Luz de estúdio frontal, cores chapadas, acabamento de pôster editorial.",
};

export const MOLDE_CENA: MoldeDaReferencia = {
  ...MOLDE_CASO,
  assunto: { tipo: "cena", descricao: "cozinha iluminada", enquadramento: "plano aberto", x0: 0, y0: 40, x1: 100, y1: 100 },
  elementos: [],
  grade: "",
  tratamento: "",
};

const CAPA = {
  ordem: 1,
  funcao: "capa",
  texto_exato: "Seu sorriso merece cuidado",
  blocos: [{ papel: "headline" as const, texto: "Seu sorriso merece cuidado" }],
};
const MEIO = {
  ordem: 2,
  funcao: "conteudo",
  texto_exato: "Vale a pena?\nConsulta de rotina evita dor e gasto com tratamento maior, porque o problema aparece cedo e sai mais barato.",
  blocos: [
    { papel: "headline" as const, texto: "Vale a pena?" },
    { papel: "apoio" as const, texto: "Consulta de rotina evita dor e gasto com tratamento maior, porque o problema aparece cedo e sai mais barato." },
  ],
};
const FINAL = {
  ordem: 4,
  funcao: "cta",
  texto_exato: "Agende hoje\nLink na bio",
  blocos: [{ papel: "headline" as const, texto: "Agende hoje" }, { papel: "cta" as const, texto: "Link na bio" }, { papel: "selo" as const, texto: "Novo" }],
};

type Entrada = Parameters<typeof import("../../../supabase/functions/_shared/direcao-arte").promptDoReplicar>[0];

const LOGO = { leva: true, indice: 3, medida: { tom: "#FFFFFF", clara: true, aspecto: 3 }, descricao: 'As letras da logo formam exatamente "Sorria".' };

/** Entradas cobrindo capa, miolo, final, foto, sem molde, 2 referências, anúncio e post fora do 4:5. */
export const CASOS_DO_REPLICAR: { nome: string; entrada: Entrada }[] = [
  { nome: "capa editando com molde", entrada: { card: CAPA, marca: MARCA_CASO, total: 4, referencias: [{ indice: 1, molde: MOLDE_CASO }], editando: true, fotos: [], logo: LOGO, quadro: { largura: 1080, altura: 1350 } } },
  { nome: "miolo com foto e duas referências", entrada: { card: MEIO, marca: MARCA_CASO, total: 4, referencias: [{ indice: 1, molde: MOLDE_CASO }, { indice: 2, molde: null }], editando: false, fotos: [{ indice: 3, papel: "fundo", descricao: "dentista" }, { indice: 4, papel: "elemento" }], logo: { leva: false, indice: null, medida: null, descricao: null }, quadro: { largura: 1080, altura: 1350 } } },
  { nome: "sem molde", entrada: { card: MEIO, marca: MARCA_CASO, total: 1, referencias: [{ indice: 1, molde: null }], editando: false, fotos: [], logo: { leva: true, indice: null, medida: null, descricao: null }, quadro: { largura: 1080, altura: 1350 } } },
  { nome: "final com cta e selo, cena", entrada: { card: FINAL, marca: MARCA_CASO, total: 4, referencias: [{ indice: 1, molde: MOLDE_CENA }], editando: true, fotos: [], logo: LOGO, quadro: { largura: 1080, altura: 1350 } } },
  { nome: "anúncio 9:16", entrada: { card: CAPA, marca: { ...MARCA_CASO, fontes: [], regras: null }, total: 1, referencias: [{ indice: 1, molde: MOLDE_CASO }], editando: true, fotos: [], logo: LOGO, quadro: { largura: 1080, altura: 1920 }, anuncio: { formato: "stories_9x16" } } },
  { nome: "post 1:1 sem paleta", entrada: { card: MEIO, marca: { ...MARCA_CASO, paleta: [] }, total: 3, referencias: [{ indice: 2, molde: MOLDE_CASO }], editando: false, fotos: [{ indice: 1, papel: "fundo" }], logo: LOGO, quadro: { largura: 1080, altura: 1080 }, post: "quadrado_1x1" } },
  { nome: "sem referência", entrada: { card: CAPA, marca: MARCA_CASO, total: 1, referencias: [], editando: false, fotos: [], logo: LOGO, quadro: { largura: 1080, altura: 1350 } } },
];

/** Entradas do bloco da série (lâmina 2 em diante segue a capa). */
export const CASOS_DA_SERIE = [
  { ordem: 1, total: 4, capa: null },
  { ordem: 2, total: 4, capa: 3 },
  { ordem: 4, total: 4, capa: 2 },
  { ordem: 3, total: 5, capa: null, cenaFixa: true },
  { ordem: 2, total: 1, capa: 2 },
];
