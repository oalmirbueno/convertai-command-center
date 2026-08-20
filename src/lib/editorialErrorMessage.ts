// O banco protege a agenda com erros em inglês técnico. Quem opera o painel
// (muitas vezes no celular) precisa ler o que aconteceu e o que fazer, então
// os erros conhecidos viram frases em português com o próximo passo. Erro
// desconhecido mantém o texto original para não esconder informação.
const TRANSLATIONS: Array<{ test: RegExp; message: string }> = [
  // A ordem importa: o primeiro padrão que casa vence, e vários erros do
  // banco terminam em "create a revision". Com o genérico no topo, TODOS
  // viravam "está em revisão" — foi assim que um conteúdo APROVADO apareceu
  // para o dono como "em revisão" na hora de agendar. Específicos primeiro;
  // o genérico é o último recurso.
  {
    test: /publication requires ready content and approved immutable files/i,
    message:
      "O material desta publicação não está no estado exigido (aprovado e travado). Se é um carrossel já liberado ao cliente, aplique a correção pendente do banco; senão, confira a aprovação do material.",
  },
  {
    test: /publication changed; refresh before transitioning/i,
    message: "Esta publicação mudou desde que a tela carregou. Recarregue e tente de novo.",
  },
  {
    test: /publication account is inactive, changed or unlinked/i,
    message: "A conta desta publicação está inativa ou foi desvinculada do projeto. Revise em Contas.",
  },
  {
    test: /automatic delivery requires an enabled official connection/i,
    message:
      "Esta conta não tem a publicação automática ligada. O agendamento fica registrado e a publicação sai manualmente — ou ligue a automação em Contas para sair sozinha.",
  },
  {
    test: /automatic delivery requires sha256/i,
    message:
      "Um dos arquivos ainda está sendo processado. Aguarde alguns segundos e agende de novo.",
  },
  {
    test: /automatic delivery requires an ordered approved asset snapshot/i,
    message:
      "A lista de arquivos desta publicação não está completa. Atualize a página e agende de novo.",
  },
  {
    test: /approved editorial snapshot is immutable/i,
    message:
      "O registro de aprovação deste conteúdo não bate com o material atual. Recarregue a página e tente de novo; persistindo, crie uma revisão.",
  },
  {
    test: /approved editorial copy is immutable/i,
    message:
      "Este conteúdo aprovado teve o texto ou o plano alterado por fora. Recarregue a página e tente de novo; persistindo, crie uma revisão.",
  },
  {
    test: /approved editorial version is immutable/i,
    message: "Este conteúdo já foi aprovado. Para trocar o material, crie uma revisão.",
  },
  {
    test: /already under review|create a revision/i,
    message:
      "Este material está em revisão. Atualize a página e tente de novo; se continuar, crie uma revisão do material.",
  },
  {
    test: /scheduled or terminal publications cannot be edited/i,
    message: "Esta publicação já está agendada ou concluída. Cancele o agendamento antes de editar.",
  },
  {
    test: /changed; refresh before saving/i,
    message: "Este conteúdo foi atualizado por outra pessoa. A tela recarrega e é só tentar de novo.",
  },
  {
    test: /terminal file versions are immutable/i,
    message:
      "Este material já está em estado final (aprovado, rejeitado ou disponibilizado). Se foi disponibilizado ao cliente, já vale como aprovado; para mudar a arte, crie uma revisão.",
  },
  {
    test: /must be readable root files|file must match the client and project/i,
    message: "O material escolhido não pertence a este cliente e projeto.",
  },
  {
    test: /one or more editorial files are unavailable/i,
    message: "Um dos materiais não está mais disponível. Atualize a página e tente de novo.",
  },
  {
    test: /requires an active publishable account/i,
    message: "A conta escolhida não está ativa para publicar. Revise a conexão em Contas.",
  },
  {
    test: /account must be linked to the project/i,
    message: "A conta escolhida não está vinculada a este projeto.",
  },
  {
    test: /published editorial records are immutable/i,
    message: "Esta publicação já saiu no ar e não pode mais ser alterada.",
  },
  {
    test: /client access denied|not found or access denied|unauthenticated editorial/i,
    message: "Sessão expirada ou sem acesso. Atualize a página e entre de novo.",
  },
];

export function editorialErrorMessage(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : String((error as { message?: string } | null)?.message || "");
  for (const item of TRANSLATIONS) {
    if (raw && item.test.test(raw)) return item.message;
  }
  return raw || fallback;
}
