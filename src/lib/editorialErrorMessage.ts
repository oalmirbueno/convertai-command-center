// O banco protege a agenda com erros em inglês técnico. Quem opera o painel
// (muitas vezes no celular) precisa ler o que aconteceu e o que fazer, então
// os erros conhecidos viram frases em português com o próximo passo. Erro
// desconhecido mantém o texto original para não esconder informação.
const TRANSLATIONS: Array<{ test: RegExp; message: string }> = [
  {
    test: /already under review|create a revision/i,
    message:
      "Este material está em revisão. Atualize a página e tente de novo; se continuar, crie uma revisão do material.",
  },
  {
    test: /approved editorial version is immutable/i,
    message: "Este conteúdo já foi aprovado. Para trocar o material, crie uma revisão.",
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
