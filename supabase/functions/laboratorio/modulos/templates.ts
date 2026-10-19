/**
 * Os 6 templates oficiais do Laboratório (semente da migration 20261019180000_laboratorio.sql).
 * O teste confere que cada um é um canvas válido e que a migration semeia exatamente estes.
 */
import type { Canvas } from "./regras.ts";

export type TemplateOficial = { id: string; nome: string; descricao: string; icone: string; canvas: Canvas };

const vp = { x: 0, y: 0, zoom: 1 };

export const TEMPLATES_OFICIAIS: TemplateOficial[] = [
  {
    id: "6c0a1b10-0000-4000-8000-000000000001",
    nome: "Carrossel",
    descricao: "Pedido e base comum entram no Construtor de carrossel: o agente planeja as lâminas e gera as artes em ordem.",
    icone: "layers",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Pedido", texto: "Tema do carrossel, público e o que a pessoa deve sentir ou fazer no fim." } },
        { id: "gravity_1", tipo: "gravity", x: 80, y: 260, dados: { titulo: "Base comum", prompt_base: "Mesma família visual em todas as lâminas: paleta, tipografia e luz iguais." } },
        { id: "config_1", tipo: "config", x: 80, y: 440, dados: { titulo: "Formato", proporcao: "4:5", qualidade: "media" } },
        { id: "carrossel_1", tipo: "carrossel", x: 400, y: 260, dados: { titulo: "Carrossel", laminas: 5 } },
      ],
      ligacoes: [
        { id: "lig_1", de: "contexto_1", para: "carrossel_1" },
        { id: "lig_2", de: "gravity_1", para: "carrossel_1" },
        { id: "lig_3", de: "config_1", para: "carrossel_1" },
      ],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000002",
    nome: "Criativos de anúncio",
    descricao: "Copy de anúncio e duas artes com a mesma base comum, fechando num pacote de anúncio que nasce pausado.",
    icone: "megaphone",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Oferta", texto: "Produto, oferta, público e objetivo da campanha." } },
        { id: "copy_1", tipo: "copy", x: 400, y: 80, dados: { titulo: "Copy do anúncio", formato: "anuncio" } },
        { id: "gravity_1", tipo: "gravity", x: 80, y: 280, dados: { titulo: "Base comum", prompt_base: "Criativo de anúncio limpo, produto em destaque, uma mensagem curta por arte." } },
        { id: "imagem_1", tipo: "imagem", x: 400, y: 280, dados: { titulo: "Criativo A", proporcao: "4:5", quantidade: 1 } },
        { id: "imagem_2", tipo: "imagem", x: 400, y: 460, dados: { titulo: "Criativo B", proporcao: "9:16", quantidade: 1 } },
        { id: "anuncio_1", tipo: "anuncio", x: 720, y: 280, dados: { titulo: "Pacote do anúncio" } },
      ],
      ligacoes: [
        { id: "lig_1", de: "contexto_1", para: "copy_1" },
        { id: "lig_2", de: "contexto_1", para: "imagem_1" },
        { id: "lig_3", de: "contexto_1", para: "imagem_2" },
        { id: "lig_4", de: "gravity_1", para: "imagem_1" },
        { id: "lig_5", de: "gravity_1", para: "imagem_2" },
        { id: "lig_6", de: "copy_1", para: "anuncio_1" },
        { id: "lig_7", de: "imagem_1", para: "anuncio_1" },
        { id: "lig_8", de: "imagem_2", para: "anuncio_1" },
      ],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000003",
    nome: "Logo",
    descricao: "Nome, conceito e paleta viram variações de logo (símbolo + logotipo, fundo liso); o Jev aponta a melhor e explica.",
    icone: "pen-tool",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Briefing da marca", texto: "O que a marca faz, para quem, e as palavras que ela precisa transmitir." } },
        { id: "logo_1", tipo: "logo", x: 400, y: 80, dados: { titulo: "Logo", nome: "", conceito: "", paleta: "", estilo: "minimalista", n: 4 } },
      ],
      ligacoes: [{ id: "lig_1", de: "contexto_1", para: "logo_1" }],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000004",
    nome: "Landing page",
    descricao: "Contexto e copy de landing entram no Construtor de página: sai um HTML único (Tailwind) salvo nos arquivos, com prévia.",
    icone: "layout",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Oferta e público", texto: "Produto, promessa, público, prova e chamada para ação." } },
        { id: "copy_1", tipo: "copy", x: 400, y: 80, dados: { titulo: "Copy da página", formato: "landing" } },
        { id: "landing_1", tipo: "landing", x: 720, y: 80, dados: { titulo: "Landing page", objetivo: "captar contato" } },
      ],
      ligacoes: [
        { id: "lig_1", de: "contexto_1", para: "copy_1" },
        { id: "lig_2", de: "copy_1", para: "landing_1" },
        { id: "lig_3", de: "contexto_1", para: "landing_1" },
      ],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000005",
    nome: "Post + legenda",
    descricao: "Uma arte de feed e a legenda escrita a partir do mesmo pedido.",
    icone: "image",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Pedido do post", texto: "Assunto do post, tom e chamada." } },
        { id: "config_1", tipo: "config", x: 80, y: 260, dados: { titulo: "Formato", proporcao: "4:5", quantidade: 1, qualidade: "media" } },
        { id: "imagem_1", tipo: "imagem", x: 400, y: 80, dados: { titulo: "Arte do post" } },
        { id: "copy_1", tipo: "copy", x: 400, y: 260, dados: { titulo: "Legenda", formato: "legenda" } },
      ],
      ligacoes: [
        { id: "lig_1", de: "contexto_1", para: "imagem_1" },
        { id: "lig_2", de: "config_1", para: "imagem_1" },
        { id: "lig_3", de: "contexto_1", para: "copy_1" },
      ],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000006",
    nome: "Variação de criativos",
    descricao: "Uma mídia de referência e uma base comum geram três variações do mesmo criativo de uma vez.",
    icone: "copy",
    canvas: {
      nos: [
        { id: "midia_1", tipo: "midia", x: 80, y: 80, dados: { titulo: "Criativo de referência", imagens: [] } },
        { id: "gravity_1", tipo: "gravity", x: 80, y: 260, dados: { titulo: "Base comum", prompt_base: "Manter produto, marca e mensagem; variar cena, enquadramento e cor de fundo." } },
        { id: "imagem_1", tipo: "imagem", x: 400, y: 80, dados: { titulo: "Variação 1", prompt: "Cena em ambiente claro." } },
        { id: "imagem_2", tipo: "imagem", x: 400, y: 260, dados: { titulo: "Variação 2", prompt: "Close no produto, fundo de cor sólida." } },
        { id: "imagem_3", tipo: "imagem", x: 400, y: 440, dados: { titulo: "Variação 3", prompt: "Produto em uso, luz natural." } },
      ],
      ligacoes: [
        { id: "lig_1", de: "midia_1", para: "imagem_1" },
        { id: "lig_2", de: "midia_1", para: "imagem_2" },
        { id: "lig_3", de: "midia_1", para: "imagem_3" },
        { id: "lig_4", de: "gravity_1", para: "imagem_1" },
        { id: "lig_5", de: "gravity_1", para: "imagem_2" },
        { id: "lig_6", de: "gravity_1", para: "imagem_3" },
      ],
      viewport: vp,
    },
  },
];
