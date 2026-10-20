# Biblioteca — teste como cliente e apresentação

Em 20/10/2026, complemento da área já publicada, no mesmo projeto e domínio.

## Como testar

1. Abra `/membros/administrar` e escolha **Testar como cliente**.
2. A biblioteca usa apenas seus direitos de membro: concessão manual, compra confirmada,
   benefício vigente ou gratuidade. O privilégio administrativo não libera o conteúdo nesse modo.
3. Assista, pause e reabra a aula. O teste preserva a posição e a conclusão em uma tabela própria.
4. Abra o material de apoio e escolha **Baixar arquivo**. A aula demonstrativa não permite download.
5. Volte à biblioteca e use **Simular bloqueio**. O servidor recusa materiais, progresso e novas
   URLs de arquivo nesse contexto, inclusive se o pedido for feito diretamente à API.
6. Em **Reiniciar teste**, apague somente seu progresso de teste. A concessão manual continua válida.
7. **Sair do teste** devolve à administração. O papel da conta nunca é alterado.

O modo é uma simulação funcional autenticada, vinculada ao próprio administrador. Não é outra
conta, nem uma troca global de papel: a conta original continua autorizada a administrar fora
do modo. O controle não substitui os testes RLS com identidades realmente sem papel administrativo.
A prévia de outra pessoa permanece separada, somente leitura e sem alterar o progresso dela.

Links assinados têm validade de 60 segundos. Um link já emitido não é revogado instantaneamente
ao ligar a simulação; nenhum novo link é emitido no modo bloqueado. O leitor é desmontado na troca
de modo, e suas consultas incluem usuário, contexto e estado do bloqueio.

## Organização

- Administração em seções: produtos/capas, aulas/materiais, pessoas/acessos, visão do cliente e pagamentos.
- Formulários permanecem montados ao trocar de seção, preservando rascunhos ainda não salvos.
- Navegação e conteúdo têm rolagem própria; produtos possuem lista independente no desktop.
  No celular, a navegação é horizontal, evitando espremer os formulários.
- Leitor com lista de materiais, conclusão visível e rolagem independente em telas maiores.
- Biblioteca com capa cinematográfica, trilhos horizontais e conquistas calculadas por conclusões
  persistidas. Sem sequência diária, pontos ou certificados inventados.
- Tema escuro, verde, Outfit, Lucide e componentes do painel preservados. Sem novas dependências.

## Banco e pagamentos

Migração incremental `20261020180001_membros_experiencia_cliente.sql`: direitos de membro sem
atalho administrativo, RPCs autenticadas e progresso de teste privado, sem acesso direto por API.
Não muda papéis, concessões existentes, integrações ou contratos.

Kiwify e Asaas continuam impedidos de conceder novos direitos. A função
`membros_pagamentos_habilitados()` permanece `false`; conciliação/reivindicação continuam travadas.

Arquivo criado primeiro com `supabase migration new`. O fonte já publicado das 18h estava adiante
do relógio da máquina; a versão nova foi ajustada mecanicamente para a última versão publicada
mais um segundo, preservando o verificador de ordem crescente e todos os fontes antigos.
O ensaio isolado reproduz essa ordem, sem acessar produção. A aplicação remota recebe a versão real atribuída pelo conector,
registrada no snapshot; não reaplicar para igualar o nome local.

## Capa e procedência

Ativo: `public/membros/capas/boas-vindas-v2.webp`. Gerado com a ferramenta de imagens do Codex,
a pedido de uso de GPT Image 2. A ferramenta não retornou um identificador verificável do modelo;
não inferir uma versão a partir do aspecto da imagem. Original preservado em generated_images
na máquina; a versão WebP do projeto é uma conversão de formato, sem edição semântica.

Direção usada: fotografia cinematográfica de um estúdio criativo brasileiro ao entardecer,
notebook com montagem de vídeo não legível, caderno e livro verde, materiais táteis e iluminação
natural. Objetos à direita, sombras escuras à esquerda para o título HTML. Reflexos discretos
em verde, sem palavras, marca, botões ou interface desenhada sobre a imagem.

## Verificações e limites

Os testes cobrem identidades e isolamento no PostgreSQL, contratos do endpoint, navegação,
bloqueio, posição do vídeo, conclusão, download e cinco larguras de tela. Capturas locais usam
fixtures explicitamente sintéticas, sem criar clientes ou concessões em produção.
O teste ao vivo usa somente o produto demonstrativo já autorizado e a própria conta de Almir.

O baseline de tipagem global dos testes e o hash histórico do replay do banco vazio descritos em
`TESTE-NO-PAINEL.md` continuam preexistentes. Não afirmar que toda a suíte histórica está verde.

## Retorno lógico

Reverter o frontend restaura a biblioteca anterior. O endpoint continua compatível com pedidos
sem `teste_cliente`. Não remover a tabela de teste nem dados; simplesmente deixar as novas RPCs
sem consumidores. Manter a trava de pagamentos em `false`. Nenhuma reversão requer alterar
papéis ou retirar a concessão manual do produto demonstrativo.

## Registro do complemento

- Backup físico restaurável conferido: 20/10/2026, 03:58:41 UTC. Objetos de Storage preservados.
- Preflight: 386 versões anteriores conferidas, sem divergência; somente a nova migração pendente.
- Migração aplicada pelo conector oficial autorizado: `20261020173752`, nome
  `membros_experiencia_cliente`, correspondente ao fonte `20261020180001_membros_experiencia_cliente.sql`.
  SHA-256 integral: `71c37b7eba4f70d0c0a9b064aa3923eb0534c592b9bfedbf3e949dd8c76938eb`.
- `area-membros` versão 2, com JWT obrigatório e validação adicional dos direitos no teste.
- Conferência no banco real: direito `manual`, 2 materiais permitidos, origens vazias no bloqueio,
  papel administrativo preservado e pagamentos `false`.
- 68 verificações SQL em PostgreSQL isolado; 32 testes Vitest; 10 testes Deno;
  30 estados de interface em 360, 390, 768, 1280 e 1440 pixels.
- Advisors: a tabela de teste intencionalmente não possui política permissiva ou grants de leitura
  direta. As quatro RPCs autenticadas possuem conferência explícita de identidade/escopo e
  `search_path` vazio. Avisos preexistentes do projeto não foram tratados como erros desta entrega.
