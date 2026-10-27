# Experiência visual da área de membros

O portal passa a reunir biblioteca, leitor, comunidade e ferramentas sob a mesma aparência. A biblioteca tem destaque amplo, capas alinhadas, acesso rápido e busca no cabeçalho. O leitor mantém o índice ao lado do conteúdo em telas grandes e organiza as duas regiões verticalmente no celular.

## Identidade e comportamento

- Verde da marca: `#00A500`. Botões em superfícies claras usam um tom mais escuro para preservar o contraste com letras brancas.
- Aparência clara por padrão, com opção escura. A preferência `aceleriq_membros_aparencia` é independente da aparência do painel operacional.
- O provider aplica os tokens também aos diálogos e restaura o atributo anterior ao sair da área.
- Busca e clique na marca retornam à biblioteca, preservando os parâmetros de visualização e teste.
- Capas próprias de produtos e ferramentas usam `object-fit: contain`. Imagens indisponíveis têm uma composição de fallback.
- Entradas, hover e prateleiras têm movimento discreto. `prefers-reduced-motion` desativa as animações.
- Nenhuma alteração de licença, pagamento, saldo, política de geração ou API faz parte desta revisão.

## Imagens próprias

As duas capas de ferramentas foram geradas para a Aceleriq, sem fotografias ou materiais dos portais de referência. Arquivos entregues em WebP, com carregamento sob demanda:

| Arquivo público | Direção visual |
| --- | --- |
| `/membros/capas/relacionamento-v1.webp` | Cartões em suportes verde floresta conectados por uma fita, mão organizando um cartão, luz natural e sombras de folhagem. |
| `/membros/capas/comunicacao-v1.webp` | Telefone verde floresta sobre caderno claro, envelopes, caneta e luz natural. |

As duas imagens usam composição editorial horizontal de 3:2, sem texto incorporado. Marca e categoria permanecem em HTML para manter legibilidade e tradução. Os originais PNG ficam fora do repositório; somente os WebP otimizados são publicados.

## Revisão

Validar `/membros` em aparência clara e escura, com conta autorizada e catálogo real. Conferir biblioteca, busca a partir de ferramenta, favoritos, leitor, comunidade, CRM, Próxima Resposta, Pomodoro, Estúdio e créditos. Repetir em celular, incluindo navegação horizontal, modal do curso e visualização integral das artes.

A prévia local usa dados de teste identificados e não faz chamadas a produção nem gera imagens reais. Ela serve para revisão de interface; não comprova a liberação de uma conta ou o funcionamento do provedor de IA.

Rollback: reverter o commit desta revisão visual e recompilar o frontend. Não há migração ou alteração de banco a desfazer.
