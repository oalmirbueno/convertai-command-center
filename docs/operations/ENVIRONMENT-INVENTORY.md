# Contrato público de configuração

Este repositório público não versiona o inventário real dos ambientes da
Aceleriq. Referências de projeto, domínios internos, identificadores
operacionais, valores de configuração, credenciais e registros de incidentes
permanecem no gerenciador privado aprovado.

## O que pode ficar no Git

- nomes de variáveis públicas do navegador em `.env.example`, sempre sem valor
  real;
- nomes de entradas exigidas pelos workflows, sem conteúdo;
- validações de formato, menor privilégio e ordem de release;
- placeholders neutros em documentação e testes.

## O que nunca deve ficar no Git

- valores de tokens, chaves, senhas, webhooks ou cabeçalhos de autenticação;
- referências e IDs reais usados em produção;
- URLs internas, allowlists reais ou dados de smoke;
- inventário de incidentes, credenciais afetadas ou evidências operacionais;
- exports do Vault, Auth, Storage, banco ou GitHub Environments.

## Fonte privada da verdade

Antes de qualquer release, o operador autorizado deve conferir no inventário
privado:

1. destino e SHA corretos;
2. backup restaurável confirmado;
3. credenciais exigidas válidas e com menor privilégio;
4. rotação ou aposentadoria de credenciais conforme o registro privado;
5. variáveis públicas coerentes com o domínio aprovado;
6. smoke dedicado sem imprimir valores ou identificadores.

Os workflows falham quando uma entrada obrigatória está ausente ou inválida.
Nunca copie um valor privado para commit, PR, issue, log ou documentação.
