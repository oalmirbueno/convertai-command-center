/**
 * Jeitos de gerar na etapa Gerar da Mesa Vídeos (frente V-A, 26/09/2026).
 * "cena" é o formulário da frente E2 (cena da História ou de roteiro
 * aprovado); os outros entraram com o gerador novo. Mais de 4: seletor.
 */
export const MODOS_DO_GERAR = [
  { valor: "cena", rotulo: "Cena do roteiro", titulo: "Gerar vídeo", descricao: "Cena da História ou de roteiro aprovado.", ajuda: "" },
  { valor: "livre", rotulo: "Livre", titulo: "Gerar livre", descricao: "Qualquer motor, quadro inicial e final, referências.", ajuda: "Escolha o motor (Normal, Top ou Rápido), o quadro inicial, o final e referências quando o motor aceita, e de 1 a 4 variações. O custo aparece antes e só é cobrado o que ficar pronto." },
  { valor: "angulo", rotulo: "Trocar ângulo", titulo: "Trocar o ângulo", descricao: "A mesma pessoa e o mesmo lugar de outro ponto.", ajuda: "Escolha uma imagem e leve a câmera em volta da pessoa: de frente, 3/4, perfil, costas, de cima ou de baixo, perto ou longe. Gera de 1 a 4 variações do mesmo personagem." },
  { valor: "continuar", rotulo: "Continuar ou transição", titulo: "Continuar vídeo", descricao: "Continua a história ou emenda A com B.", ajuda: "Continuar usa a extensão nativa do motor quando existe; senão, o último quadro do vídeo vira o começo do próximo. Transição: primeiro quadro = fim de A e último quadro = começo de B." },
  { valor: "antes_depois", rotulo: "Antes e depois", titulo: "Antes e depois de uma foto", descricao: "Gera o antes ou o depois, os vídeos e a montagem.", ajuda: "A partir de uma foto, o modelo de imagem do painel gera a outra versão com a mesma câmera e luz. Depois, um vídeo curto de cada e a montagem lado a lado, em cortina ou em sequência na Mesa Edição." },
  // Frente V-C (26/09): HeyGen.
  { valor: "avatar", rotulo: "Avatar falando", titulo: "Avatar falando", descricao: "Roteiro vira uma pessoa falando, com voz em português.", ajuda: "Escreva o roteiro e escolha quem fala: um avatar de estoque da HeyGen ou a foto de um clone da Mesa Foto (só com a autorização de imagem válida). Escolha a voz, o formato e se quer legenda no vídeo. O custo aparece antes e é cobrado pela duração real, até o valor confirmado." },
] as const;

export type ModoDoGerar = (typeof MODOS_DO_GERAR)[number]["valor"];

export const modoDoGerarValido = (v: string | null | undefined): ModoDoGerar => (MODOS_DO_GERAR.some((m) => m.valor === v) ? (v as ModoDoGerar) : "cena");
