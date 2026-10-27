# Verificação do refinamento do Bolso

Data: 27/10/2026. PR: https://github.com/oalmirbueno/convertai-command-center/pull/104.

## Escopo conferido

Prévia autenticada em `http://127.0.0.1:4187/membros`, usando a API atual. A capacidade nova de servidor permanece desativada até a implantação aprovada. Nenhum pagamento foi habilitado; a conferência visual não criou campanhas definitivas nem consumiu créditos.

## Navegação e apresentação

- Larguras de 390, 1024, 1440 e 1920 pixels verificadas. Sem transbordamento horizontal da página.
- Desktop com documento fixo e rolagem interna na área principal. Cabeçalho, menu e retorno permanecem estáveis.
- Menu de tablet recolhe de 190 para 74 pixels e volta a expandir; controle acessível junto ao conteúdo.
- Formulário com quatro etapas e CTA WhatsApp preservado na revisão. Cancelamento não salva a campanha.
- Em 390 × 844, o botão Continuar permanece visível no primeiro passo, sem precisar procurar o rodapé.
- Galeria com rolagem própria, download alcançável e arte em tamanho natural. Ampliação, Escape e retorno de foco conferidos.
- Vitrine usa licenças existentes, sem liberar produtos por parâmetro de URL. Boas-vindas gratuitas e UGC identificado como Em breve.
- Administração com largura consistente e atalho para o painel Aceleriq.
- Landing com hero integrado, comparação, capturas reais, criativos originais, modal por teclado, barras mobile sem sobreposição e respeito a movimento reduzido.

## Testes executados

- UI local: 104 testes aprovados nos grupos estúdio, biblioteca, administração, recargas e vitrine.
- Motor: 91 testes aprovados na rodada inicial; após a última correção de mensagens de upload, os 12 testes de referências passaram novamente.
- Banco efêmero PGlite: 51 cenários aprovados, incluindo créditos, idempotência, isolamento, referências e ajustes. Nenhuma conexão ao banco de produção.
- Contratos do ledger: 51 cenários passaram na primeira rodada e o cenário restante passou após corrigir a contagem da nova migration. Houve um timeout interno de transporte do Vitest sob carga nessa rodada local.
- CI de membros no código `b8cff212`: 146 testes aprovados, tipos de membros/CRM aprovados e 451 fontes SQL verificadas. Run `40570448886`, job `122422906642`.
- Verificações TypeScript de aplicação, Node e testes aprovadas localmente. A verificação final de testes já inclui a correção dos seletores de Testing Library.
- Integridade e append-only da migration aprovados, preservando todos os hashes históricos.
- Build de produção aprovado em 2 min 47 s e repetido após a correção visual final, aprovado em 1 min 54 s. Permanecem avisos de chunks grandes e base Browserslist antiga; não impedem a compilação.
- Compatibilidade Lovable MCP: `verify` e `generate` aprovados, sem alteração dos artefatos versionados.
- A suíte global do código `b8cff212` registrou 11.589 testes aprovados, 6 falhas e 1 ignorado. Cinco falhas são iguais às do PR 103: `avisos-acento`, `estudio-arte`, `mes-semanas-e-refazer-interno`, `mesa-auditoria-defeitos` e `mesa-videos-diretor`.
- A sexta falha era nova, na catraca visual. Foi corrigida usando o token de fonte do sistema e explicação recolhida no cartão, sem aumentar os tetos nem alterar o teste. A rodada posterior passou 72/72: catraca 16, estúdio 46 e administração de acesso 10.
- CI Supabase no código `b8cff212`: aplicação de todas as migrations, pgTAP, contratos SQL de membros e contratos sintéticos isolados aprovados. Restauração, integridade das fontes e matriz Auth/E2E também aprovadas. Run `40570448829`, job `122422906446`. A nova migration foi executada no banco descartável, sem alteração em produção.

A suíte global não está inteiramente verde. As falhas históricas foram registradas separadamente da regressão introduzida e corrigida por esta entrega.

## Limites de homologação

A geração real da nova proposta por Sol, da copy por Terra e do ajuste com referência ainda depende da implantação autorizada. Os testes locais confirmam contratos e fluxos, mas não substituem a verificação real do provedor e do Storage hospedado.

A landing foi publicada no projeto privado existente do Sites. Sua abertura remota exige autenticação do proprietário; a composição foi conferida no servidor local com os mesmos arquivos. Checkout e domínio comercial público não foram ativados.

O produto de demonstração existente foi retirado da vitrine pelo filtro de apresentação. Nenhum registro ou direito foi apagado. O documento de catálogo contém somente preflight de leitura; qualquer arquivamento cadastral exige revisar os identificadores e direitos reais.
