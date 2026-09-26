/**
 * Receitas de campanha por categoria da Mesa Publicidade (frente P, 26/09/2026):
 * DADO que o diretor de campanha recebe na mensagem e que a tela mostra.
 * Destilado de kits/publicidade/receitas-campanhas.json e RECEITAS-E-PROMPTS.md
 * (texto próprio). Nenhuma receita é campanha vencedora.
 *
 * Sem import nenhum: a tela importa este arquivo sem levar o conhecimento
 * dos agentes para o pacote do navegador. Compatível com Safari 11. Sem travessão.
 */

export type FuncaoDaTomada = "atrair" | "apresentar_produto" | "contextualizar_uso" | "mostrar_detalhe" | "expressar_conceito" | "apoiar_acao";

export const FUNCOES_DAS_TOMADAS: { id: FuncaoDaTomada; rotulo: string; dica: string }[] = [
  { id: "atrair", rotulo: "Atrair", dica: "Abre a sequência e para o dedo." },
  { id: "apresentar_produto", rotulo: "Apresentar o produto", dica: "Produto legível na miniatura." },
  { id: "contextualizar_uso", rotulo: "Contexto de uso", dica: "O produto na rotina de quem compra." },
  { id: "mostrar_detalhe", rotulo: "Detalhe", dica: "Acabamento, material, o que prova qualidade." },
  { id: "expressar_conceito", rotulo: "Conceito", dica: "A ideia do território em uma imagem." },
  { id: "apoiar_acao", rotulo: "Apoiar a ação", dica: "Espaço limpo para a chamada, sem tapar o produto." },
];

export type ReceitaDePublicidade = {
  id: string;
  categoria: string;
  /** Tipos de kit da Mesa Foto que costumam cair nesta receita. */
  tipos_de_kit: string[];
  /** Palavras no nome do produto que puxam esta receita. */
  palavras: string[];
  territorios: string[];
  invariantes: string[];
  foco_da_revisao: string;
  /** O que cada função de tomada costuma ser nesta categoria. */
  tomadas: Record<FuncaoDaTomada, string>;
  cuidados: string[];
};

export const RECEITAS_DE_PUBLICIDADE: ReceitaDePublicidade[] = [
  {
    id: "oculos",
    categoria: "Óculos",
    tipos_de_kit: ["produto"],
    palavras: ["oculos", "armacao", "lente", "solar"],
    territorios: ["Expressão pessoal", "Rotina urbana", "Presente com escolha assistida"],
    invariantes: ["formato do aro", "ponte", "espessura", "cor da variante", "hastes", "lente"],
    foco_da_revisao: "Geometria da armação e contato com o rosto (ponte no nariz, haste atrás da orelha, oclusão).",
    tomadas: {
      atrair: "Retrato de abertura com os óculos, olhar e gesto do território.",
      apresentar_produto: "Armação isolada, de frente, legível na miniatura.",
      contextualizar_uso: "Cena cotidiana do território com a pessoa usando os óculos.",
      mostrar_detalhe: "Close da haste, dobradiça ou acabamento documentado nas fontes.",
      expressar_conceito: "Três quartos usando os óculos, com a luz e a paleta do território.",
      apoiar_acao: "Composição com espaço limpo para a chamada, óculos em destaque.",
    },
    cuidados: ["Pessoa sintética usando a armação não prova conforto, tamanho ou resultado clínico.", "Vista lateral sem foto lateral nas fontes é lacuna."],
  },
  {
    id: "cosmeticos",
    categoria: "Cosméticos e perfumes",
    tipos_de_kit: ["cosmetico"],
    palavras: ["perfume", "creme", "serum", "batom", "cosmetico", "hidratante", "shampoo"],
    territorios: ["Ritual cotidiano", "Textura e materialidade", "Presente"],
    invariantes: ["rótulo", "tampa", "volume", "transparência", "cor", "variante"],
    foco_da_revisao: "Texto pequeno do rótulo e materiais (vidro, tampa, transparência).",
    tomadas: {
      atrair: "Frasco principal em luz marcante do território.",
      apresentar_produto: "Frasco de frente com rótulo legível.",
      contextualizar_uso: "Produto na mão ou na bancada do ritual.",
      mostrar_detalhe: "Macro da textura ou do material real do produto.",
      expressar_conceito: "Cena sensorial do território, com ingredientes só se forem verdadeiros.",
      apoiar_acao: "Embalagem e produto com espaço limpo para a chamada.",
    },
    cuidados: ["Sem resultado de pele nem alegação de eficácia sem evidência.", "Texto pequeno: prefira preservar a foto original do rótulo."],
  },
  {
    id: "moda",
    categoria: "Bolsas, roupas e calçados",
    tipos_de_kit: ["moda"],
    palavras: ["bolsa", "vestido", "camisa", "calca", "tenis", "sapato", "sandalia", "jaqueta", "roupa"],
    territorios: ["Detalhe de design", "Combinações de look", "Ocasião de uso"],
    invariantes: ["costuras", "ferragens", "estampa", "escala", "caimento", "sola"],
    foco_da_revisao: "Construção visível (costura, ferragem, fecho) e contato com o corpo.",
    tomadas: {
      atrair: "Corpo em contexto com o produto em movimento editorial.",
      apresentar_produto: "Produto isolado, construção visível.",
      contextualizar_uso: "Look completo na ocasião do território.",
      mostrar_detalhe: "Material, costura ou ferragem em close.",
      expressar_conceito: "Variação de enquadramento que traduz a ideia.",
      apoiar_acao: "Produto com espaço limpo para a chamada.",
    },
    cuidados: ["Caimento gerado não prova tamanho.", "Manter alça, ferragens, fecho e quantidade de compartimentos."],
  },
  {
    id: "alimentos",
    categoria: "Alimentos e bebidas",
    tipos_de_kit: ["alimento", "bebida"],
    palavras: ["bolo", "pizza", "lanche", "cafe", "cerveja", "suco", "doce", "prato", "pernil", "hamburguer"],
    territorios: ["Pausa cotidiana", "Compartilhar", "Preparo e ingrediente real"],
    invariantes: ["porção", "ingredientes", "embalagem", "quantidade", "cor"],
    foco_da_revisao: "Aparência igual ao que o cliente entrega (porção, recheio, embalagem).",
    tomadas: {
      atrair: "Prato ou embalagem principal com apetite plausível.",
      apresentar_produto: "Produto de frente, porção real.",
      contextualizar_uso: "Mesa com contexto do momento do território.",
      mostrar_detalhe: "Macro de textura ou recheio real.",
      expressar_conceito: "Mão, serviço ou partilha que traduz a ideia.",
      apoiar_acao: "Composição para a oferta com espaço limpo.",
    },
    cuidados: ["Nunca aumentar a porção nem inventar ingrediente.", "Ingrediente de cena só se estiver no produto."],
  },
  {
    id: "joias",
    categoria: "Joias e relógios",
    tipos_de_kit: ["produto"],
    palavras: ["anel", "colar", "brinco", "pulseira", "relogio", "joia", "aliança"],
    territorios: ["Expressão discreta", "Ocasião de presente", "Detalhe de fabricação"],
    invariantes: ["pedras", "cravação", "metal", "marcações", "fecho", "número de elos"],
    foco_da_revisao: "Detalhes pequenos e reflexos do metal.",
    tomadas: {
      atrair: "Uso em mão, pescoço ou pulso com luz do território.",
      apresentar_produto: "Macro frontal da peça.",
      contextualizar_uso: "Ocasião de uso ou de presente.",
      mostrar_detalhe: "Cravação, fecho ou marcação documentados.",
      expressar_conceito: "Composição editorial com textura de apoio.",
      apoiar_acao: "Peça no estojo com espaço para a chamada.",
    },
    cuidados: ["Não inferir quilate, pureza ou resistência pela aparência.", "Geometria crítica pode pedir foto real."],
  },
  {
    id: "decoracao",
    categoria: "Casa e decoração",
    tipos_de_kit: ["produto"],
    palavras: ["vaso", "luminaria", "almofada", "quadro", "mesa", "cadeira", "decoracao", "tapete"],
    territorios: ["Atmosfera", "Rotina no espaço", "Detalhe de material"],
    invariantes: ["dimensões informadas", "acabamento", "quantidade de peças", "escala", "cor"],
    foco_da_revisao: "Proporção da peça no ambiente.",
    tomadas: {
      atrair: "Ambiente amplo com a peça como protagonista.",
      apresentar_produto: "Peça principal isolada.",
      contextualizar_uso: "Interação de uso no espaço.",
      mostrar_detalhe: "Material e acabamento em close.",
      expressar_conceito: "Composição lateral com a atmosfera do território.",
      apoiar_acao: "Cenário limpo para a chamada.",
    },
    cuidados: ["Ambientação é ilustrativa: não promete escala para um cômodo real."],
  },
  {
    id: "eletronicos",
    categoria: "Eletrônicos e acessórios",
    tipos_de_kit: ["tecnologia"],
    palavras: ["fone", "celular", "capinha", "carregador", "notebook", "caixa de som", "smartwatch", "cabo"],
    territorios: ["Organização da rotina", "Detalhe de design", "Compatibilidade confirmada"],
    invariantes: ["portas", "botões", "recortes", "tela", "itens inclusos", "cor"],
    foco_da_revisao: "Função e configuração (portas, botões, câmera, itens inclusos).",
    tomadas: {
      atrair: "Produto em uso documentado na rotina do território.",
      apresentar_produto: "Vista do produto com design legível.",
      contextualizar_uso: "Uso real, sem prometer função inexistente.",
      mostrar_detalhe: "Portas, conectores ou material em close.",
      expressar_conceito: "Kit de acessórios na composição do território.",
      apoiar_acao: "Produto com espaço para a chamada.",
    },
    cuidados: ["Tela só com conteúdo autorizado.", "Em capa, manter desenho e posição dos recortes."],
  },
  {
    id: "esporte",
    categoria: "Esporte e lazer",
    tipos_de_kit: ["produto", "moda"],
    palavras: ["bola", "raquete", "bicicleta", "academia", "halter", "chuteira", "esporte", "garrafa"],
    territorios: ["Momento antes da atividade", "Rotina com o produto", "Detalhe construtivo"],
    invariantes: ["ajuste", "desenho", "pontos de contato", "variante", "cor"],
    foco_da_revisao: "Plausibilidade do uso e pontos de contato.",
    tomadas: {
      atrair: "Pessoa em ação plausível com o produto.",
      apresentar_produto: "Produto isolado, desenho legível.",
      contextualizar_uso: "Preparação ou rotina do território.",
      mostrar_detalhe: "Detalhe construtivo documentado.",
      expressar_conceito: "Ambiente que traduz a ideia.",
      apoiar_acao: "Composição de encerramento com espaço para a chamada.",
    },
    cuidados: ["Imagem de ação não prova segurança, resistência nem performance."],
  },
];

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function receitaDaCategoria(id: unknown): ReceitaDePublicidade | null {
  const s = String(id || "");
  return RECEITAS_DE_PUBLICIDADE.find((r) => r.id === s) || null;
}

/** Receita sugerida pelo produto: palavra no nome primeiro, depois o tipo do kit; null quando não dá para dizer. */
export function receitaParaProduto(nome: unknown, tipoDoKit: unknown): ReceitaDePublicidade | null {
  const n = semAcento(String(nome || ""));
  if (n) {
    for (const r of RECEITAS_DE_PUBLICIDADE) {
      if (r.palavras.some((p) => n.indexOf(semAcento(p)) >= 0)) return r;
    }
  }
  const tipo = String(tipoDoKit || "");
  // "produto" é genérico demais: só decide quando o nome já decidiu.
  if (!tipo || tipo === "produto" || tipo === "outro" || tipo === "pessoa") return null;
  return RECEITAS_DE_PUBLICIDADE.find((r) => r.tipos_de_kit.indexOf(tipo) >= 0) || null;
}

/** A receita como dado para a mensagem do diretor (JSON curto). */
export function receitaComoDado(r: ReceitaDePublicidade | null): Record<string, unknown> | null {
  if (!r) return null;
  return {
    categoria: r.categoria,
    territorios_de_partida: r.territorios,
    invariantes_da_categoria: r.invariantes,
    foco_da_revisao: r.foco_da_revisao,
    tomadas_por_funcao: r.tomadas,
    cuidados: r.cuidados,
    aviso: "Receita de partida, não campanha vencedora: adapte ao produto, à marca e ao briefing.",
  };
}

