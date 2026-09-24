# Claude Code: Mesa de Estúdio Fotográfico

## Finalidade deste pacote

Almir pediu uma pesquisa completa e a preparação da documentação para **você implementar** a nova mesa no Aceleriq OS. Codex fez pesquisa e organização; não implementou a funcionalidade. Este pacote não contém um aplicativo pronto nem um backend instalado.

A intenção é receber fotos dos clientes, organizar produtos/pessoas em kits de referência, preparar e melhorar imagens, remover fundos, criar cenários e novos ângulos, montar ensaios profissionais e devolver os ativos às mesas atuais. Deve atender produtos, celulares, alimentos, pessoas e outras categorias, com direção voltada à apresentação comercial.

## Ordem de leitura

1. `LEIA-ME.md`: mapa da entrega e limites de verificação.
2. `BRIEFING-E-EXPERIENCIA.md`: intenção, composição da área e jornadas.
3. `DOSSIE-ESTUDIO.md`: pesquisa, seleção de ferramentas, técnicas e limitações.
4. `ESPECIFICACAO-PARA-IMPLEMENTACAO.md`: integração, responsabilidades, filas, preservação e aceite.
5. `BACKLOG-E-ACEITE.md`: lotes implementáveis e evidências esperadas.
6. `CONTRATOS-EXEMPLO.json`, `receitas-ensaio.json` e `presets-angulos.json`: propostas estruturadas para adaptar ao projeto.
7. `PLANO-DE-AVALIACAO.csv`: matriz vazia para a comparação dos motores.
8. `repositorios-verificados.csv/json`, `licencas-consultadas.json` e `fontes-publicas.json`: trilha da pesquisa.

`LEIA-AQUI.html` é uma leitura navegável do dossiê e da especificação, com busca no catálogo e seletor ilustrativo de presets. Não executa geração e não se conecta ao painel.

## Contexto conhecido e fonte da verdade

- Projeto canônico identificado: `oalmirbueno/convertai-command-center`, Aceleriq Comando OS.
- Checkout consultado, somente para leitura: `C:/AI/lf-verify`, commit local `54dcbb00`, de 23/09/2026.
- Evidências locais: `docs/architecture/ACELERIQ-CONTEXTO-CANONICO.md`, `docs/mesa-do-cliente/SPEC.md`, `docs/mesa-do-cliente/CONTRATOS-V3.md`, `docs/mesa-ads/SPEC.md`, `src/App.tsx` e funções compartilhadas de imagem/IA.
- Foram observados `/mesa`, `/mesa-ads`, `cliente_imagens`, kit de marca, referências, motor e carteira de IA, máscaras e restauração de pixels protegidos.
- O checkout não foi atualizado e a produção não foi auditada nesta pesquisa. Conferir a main atual e a documentação canônica ao iniciar; não assumir que o estado congelado do pacote ainda é o mais recente.
- Ler o `AGENTS.md` e demais instruções do projeto, além do segundo cérebro conforme as regras da máquina. Não substituir o banco, o projeto Lovable ou o repositório existentes.

## Direção recomendada, ainda sujeita à implementação

Criar uma mesa própria, acessível também a partir das mesas atuais, usando o mesmo acervo por cliente. A foto aprovada deve poder ser usada numa arte, anúncio ou série sem upload duplicado nem perda da origem.

Começar com o motor já integrado e comparar seus resultados. Photoroom/Bria são candidatos para preparação de produto; Qwen Multi-Angles é candidato para vistas. Não instalar 32 projetos nem criar uma infraestrutura GPU antes de medir necessidade. As recomendações de prioridade são análise documental, não um benchmark de qualidade.

## Regras funcionais importantes

- Original imutável; toda alteração vira derivada rastreável.
- Identidade de produto/pessoa separada de referência de estilo, cenário ou pose.
- Embalagem não equivale a foto do produto. Sem evidência do item, não inventar detalhes para catálogo.
- Preservação de pixels, tratamento de luz e criação de novo ângulo são modos distintos.
- Novo ângulo pode inventar regiões ocultas. Não exibir garantia de fidelidade geométrica.
- Não transformar uma imagem gerada não revisada em verdade do kit.
- Texto, logo, portas, ingredientes e rosto precisam de critérios específicos de revisão.
- Pessoas usam imagens autorizadas, vinculadas ao cliente correto, com controle de exclusão e acesso.
- Jev/TypeSafe avalia texto; visão/OCR devem produzir as evidências visuais antes da decisão semântica.
- Jobs, custos, versões e aprovações devem manter o modelo operacional existente.
- Escolher capacidade por operação; fallback não pode degradar silenciosamente a preservação solicitada.

## Como usar este pacote na execução

Ao iniciar a implementação solicitada por Almir, faça primeiro o reconhecimento do estado atual e mapeie o que já existe. Atualize os contratos propostos com as interfaces reais. Converta o backlog em lotes pequenos, respeitando branch, coordenação de escrita, revisão, migrations e publicação do projeto.

Não trate arquivos JSON do pacote como payloads prontos de todos os provedores. São modelos internos ilustrativos, com status explícito. Os adapters devem traduzir para o contrato atual do endpoint e validar capacidades.

Critérios e dados de avaliação são propostas. Nenhuma foto foi gerada e nenhuma pontuação foi preenchida. Os modelos escolhidos, limites e orçamento do piloto precisam ser conferidos no ambiente real durante a execução.

## Entrega esperada do implementador

Fluxo completo demonstrado com produto e pessoa: selecionar fontes → montar kit → preparar → produzir tomadas → revisar versão → usar nas mesas existentes. Entregar evidência de funcionamento, custo, falhas tratadas e preservação, seguindo o processo do projeto. Não basta uma tela de upload ou um formulário genérico de prompt.

Os scripts Python anexos servem apenas para consultar metadados públicos e remontar a documentação. Não são o motor fotográfico e não são pré-requisitos para implementar a mesa.
