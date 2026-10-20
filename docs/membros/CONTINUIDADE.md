# Área de membros Aceleriq — continuidade, 20/10/2026

## Estado

**Atualização autorizada em 20/10/2026:** migrações aplicadas no backend atual e `area-membros`
publicada, com Kiwify e Asaas bloqueados no servidor. Acrescentada a prévia administrativa da mesma
biblioteca, calculada com direitos reais e sem gravar progresso. Instruções e registro da aplicação:
[`TESTE-NO-PAINEL.md`](TESTE-NO-PAINEL.md). O relato abaixo preserva a fotografia do desenvolvimento
anterior à autorização; suas referências a “não publicado” foram superadas por essa atualização.

Implementação de desenvolvimento na branch `codex/area-membros`, partindo do main `00d55d38`.
Nenhuma aplicação de schema, publicação de função, cobrança ou publicação do frontend foi realizada
em produção. O ambiente de teste usa PostgreSQL 17.11 já instalado no notebook; os processos foram
encerrados ao final. Não foram instaladas novas dependências ou serviços.

O documento anterior do Claude foi encontrado em
`C:/Users/Usuario/Desktop/Projeto Aceleriq/Claude/convertai-command-center/CODEX-CONTINUIDADE-MESA.md`.
Não foi encontrado plano específico da biblioteca. A descoberta, fontes oficiais e decisões ficam
em `DESCOBERTA-E-ENTREGA.md` nesta pasta. O código recente do Claude no Laboratório/Canvas e nos
gateways foi reutilizado. Nenhum arquivo com alterações locais do checkout Claude foi sobreposto.

## Funcionalidade implementada

- `/membros`: catálogo por trilhos, busca/categoria, destaque, biblioteca, benefícios e progresso.
  Não mostra trilhos vazios. Dados e capas vêm do cadastro; sem capa, fallback explícito da marca.
- `/membros?produto=<UUID>`: detalhes, acesso bloqueado, pagamento pendente e leitor. Texto Markdown,
  áudio, vídeo, PDF e arquivos conforme o cadastro. Progresso gravado por identidade/material.
- `/membros/administrar`: somente administrador, com cadastro de produtos e materiais privados,
  concessões manuais, revogação dessa origem, benefícios de plano e vínculo de produtos do gateway.
- Modal `Preparar lançamento`: 29 itens, guia contextual, estado manual, observação, evidência,
  autor/data reais e histórico no backend. Desktop em duas colunas; celular alterna Checklist/Guia.
- `/solucoes`: destino comercial discreto para membro sem autorização operacional, sem preços,
  promessas ou destinos externos inventados. Quem já é operacional segue ao próprio painel.
- Atalho de biblioteca no menu existente; proteção operacional antes de montar o AppLayout.

## Modelo de acesso e aplicação

Migração preparada: `supabase/migrations/20261020150633_area_membros_biblioteca.sql`.
Aplicada **somente** no banco local descartável. Não executar no Supabase real sem autorização.
Preflight somente de leitura: `PREFLIGHT.sql`. Contingência sem exclusão: `ROLLBACK-LOGICO.sql`.

Compras e concessões são direitos por usuário/produto/origem/referência; assinatura é calculada
separadamente pelo contrato vigente em `financial_client_terms` e pelo benefício explícito em
`membros_beneficios_plano`. Nenhum plano foi alterado ou recebeu produtos por padrão. Duração de
compra é configuração explícita do vínculo. Reembolso/contestação só revogam aquela compra quando
essa regra é marcada pelo administrador; caso contrário, a conciliação exige decisão.

Novo cadastro não recebe papel operacional pelo gatilho `handle_new_user`. Ausência de papel é
representada como `member` **somente no app**, sem acrescentar enum ou apagar papéis existentes.
O fluxo `manage-team` já concede explicitamente o papel de cliente/equipe e foi preservado.
Políticas restritivas adicionais para identidades sem papel mantêm as políticas antigas como
limite dos clientes e da equipe. Nenhum grant global de operação foi adicionado.

O catálogo expõe metadados. Conteúdo só vem da tabela protegida após verificação do direito.
Bucket `membros-materiais` privado, barreiras adicionais contra políticas permissivas antigas e
arquivos lidos por JWT real. Links de arquivo duram 60 s; download é validado no endpoint e nos
controles de interface. Isso não é DRM: conteúdo já entregue pode ser copiado por quem o recebeu.

## Pagamentos

`vendas-webhook` continua o receptor e registro de CRM existentes. A nova migração apenas prepara
conferências para produtos explicitamente vinculados da própria agência; não dispara cobrança nem
concede direito pelo aviso. `area-membros`, ação `conciliar`, exige admin, lê o evento existente,
confere o Asaas por GET no servidor e só então chama a função de conciliação, exclusiva de serviço.
O produto e comprador vêm dessa consulta, não do navegador. O pedido deve coincidir com o evento.
E-mail confirmado é necessário para ligar a compra a uma identidade; não são criadas contas.
Eventos duplicados e reembolso terminal não reativam a compra; outras origens permanecem válidas.

Kiwify está **pendente**: a confirmação oficial da assinatura/API ainda não foi validada. Seu evento
não libera conteúdo. A conexão Supabase foi restaurada por Almir e inspecionada somente em leitura:
as tabelas de dependência e políticas existem; não há tabelas `membros_%` nem integração ativa da
agência para Kiwify/Asaas. Nenhuma credencial foi solicitada ou alterada.

## Evidências executadas

- 27 testes novos de modelo/interface/identidade: aprovados.
- 7 testes Deno da confirmação e regra de download: aprovados; `deno check` da função aprovado.
- 34 verificações SQL reais, com RLS, vigência, isolamento, origens independentes, idempotência,
  reembolso e persistência de checklist/histórico/progresso após reiniciar o PostgreSQL: aprovadas.
  O bootstrap é um recorte isolado de dependências estruturais; não é cópia de dados de produção.
- Navegador real em 360, 390, 768, 1280 e 1440 px: biblioteca, leitor e checklist sem transbordamento
  da página. Busca, conclusão, gravação do checklist e bloqueio por URL exercitados. APIs do navegador
  foram substituídas por fixtures sintéticas somente no teste. Isso não comprova pagamento real.
- Tipagem app e Node: aprovadas. Build Vite: aprovado, com avisos preexistentes de chunks grandes.
- Rodada ampliada Vitest: 52/53 aprovados. Falha no teste antigo `api-gateway-authorization`, na leitura
  documental de ApiDocs por regex de quebras de linha. Teste, ApiDocs e gateway são idênticos ao main.
  Não declarar suíte geral verde.
- Manifesto de migrations verificado em cópia canônica dos objetos Git (LF): 412 arquivos, append-only.
  O verificador direto no Windows acusa hash antigo de `legacy_prerequisites.sql` pela cópia CRLF,
  sem diferença Git desse arquivo. Não reescrever a baseline histórica para contornar isso.
- Lint dos módulos novos de frontend e compatibilidade MCP (verificação e geração): aprovados.

Comandos reproduzíveis:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/membros/modelo.test.ts src/test/membros-biblioteca.test.tsx --maxWorkers=1
deno test supabase/functions/area-membros/confirmacao_test.ts
deno check supabase/functions/area-membros/index.ts
./scripts/testar-membros-local.ps1 -PostgresBin '<runtime PostgreSQL existente>/bin'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4178 --strictPort
# Em outro terminal, para o teste visual com APIs isoladas:
node scripts/testar-membros-visual.mjs
```

Capturas locais: `outputs/membros-visual/` (biblioteca nas cinco larguras; leitor e checklist em
390/1440). Logs revisados em `outputs/membros-*`. São evidências de teste, sem catálogo fictício
em produção e sem dados reais de compradores.

## Antes da produção

1. Rever esta proposta, migração, gatilho de cadastro e barreiras de acesso. Autorizar explicitamente
   a aplicação do schema e a publicação — inclusive a nova Edge Function `area-membros`.
2. Conferir o schema integral no ambiente de ensaio, backup restaurável e preflight vigente; os testes
   locais usam as dependências necessárias e não substituem regressão de todos os módulos históricos.
3. Cadastrar somente produtos, capas, duração e benefícios comerciais confirmados. Não preencher
   produção com as fixtures dos testes. Conferir contratos financeiros realmente vinculados ao plano.
4. Configurar/validar a integração de agência pelo cofre existente. Kiwify continua sem concessão
   automática até prova oficial e compra de teste apropriada. Asaas ainda exige teste do provedor real.
5. Publicar backend e frontend de forma coordenada: o novo modelo de cadastro precisa dos dois.
   Não fazer merge em main como atalho: há publicação automática do frontend no push ao main.

Ao reverter, manter a barreira de identidade e os arquivos privados. Não devolver concessão
operacional automática a novos compradores nem apagar suas compras.
