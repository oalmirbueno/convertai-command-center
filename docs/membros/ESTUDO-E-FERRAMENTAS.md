# Evolução da biblioteca e das ferramentas

Estado em 20/10/2026: Almir autorizou aplicar a migração e publicar para teste. Banco e funções de membros atualizados; interface em preparação para publicação. Kiwify e Asaas continuam desligados.

A migração `membros_estudo_ferramentas` foi aplicada uma única vez no projeto canônico, com versão remota `20261020201456`. O provedor registrou o SQL inteiro, com SHA-256 `d22cd2cd6339e893560a56ad7f52dd8d18d103d2fada402033d442cfe204d96f`. A fonte aprovada permanece intacta. As 388 entradas anteriores foram conferidas e preservadas; não houve replay nem reparo da ledger. Backup físico concluído em 20/10, às 03:58 UTC, disponível no Supabase; não foi executada restauração em produção.

O pós-teste confirmou nove tabelas com RLS, sem acesso direto de `anon` ou `authenticated`, nenhuma licença emitida e o gate de pagamentos em `false`. Os avisos informativos de tabelas sem políticas são esperados neste contrato: as operações passam pelas funções autorizadas, que verificam titular e licença. O histórico de segurança preexistente foi preservado. As funções `area-membros` e `area-membros-kiwify` mantêm verificação de JWT e autenticação interna; a atualização da segunda acrescenta somente o cache do preflight, sem ativar pagamentos.

Correções do PR87: incluídas as quatro fontes de membros ausentes do manifesto legado, sem modificar seus bytes; testes do cenário histórico 206 + 3 isolados em uma fixture, e contrato atual conferido separadamente. Títulos e ajudas usam os componentes do painel. Verificação local após os ajustes: 104 testes, 156 verificações SQL, 53 estados visuais, tipos da aplicação/Node e Deno aprovados. A checagem global permanece distinta dos testes deste lote; não considerar seu resultado aprovado sem a confirmação do CI.

## Base e decisões

Continuar `/membros` e `/membros/administrar`, mantendo autenticação, aulas, arquivos privados, progresso e identidade visual existentes. A comunidade possui um limite de 800 px que deixa espaço sem uso. O Pomodoro já mantém o relógio, mas falta acesso compacto durante o estudo. O PDF já usa PDF.js e precisa de tela cheia e navegação mais clara.

As tabelas `commercial_*` do CRM existente são internas da agência. A versão dos membros reaproveitará o vocabulário e as etapas do funil, com armazenamento e permissões separados por titular. Não expor a rota interna nem ampliar suas permissões.

Decisão de Almir: após o vencimento, guardar os dados privados do CRM até o cliente pedir exclusão. Não criar rotina de exclusão automática.

Novas licenças de ferramentas têm 12 meses de calendário a partir do pagamento confirmado, calculados em UTC no servidor. Não alterar compras, acessos manuais e benefícios antigos. Não renovar automaticamente. Upgrade mensal permanece independente; escopo e preço comerciais precisam ser definidos, sem cobranças neste lote.

## Lotes

1. Estudo: Pomodoro minimizável, leitura de PDF em tela cheia, controles laterais consistentes, navegação entre aulas e complementos, explicações no `?`.
2. Administração: capa por URL ou arquivo validado, comunidade com canais autorizados por produto, pessoas e esteira com organização mais limpa. Links externos abrem dentro apenas quando o destino permite; oferecer saída clara se houver bloqueio.
3. Ferramentas: contrato de licença anual e sessão própria, uma sessão de ferramenta por titular e produto, reutilizada entre abas do mesmo navegador. Troca de dispositivo explícita, sem encerrar aulas ou autenticação do painel. Todas as operações verificam identidade, direito, prazo e sessão no servidor.
4. CRM: contatos e oportunidades privados, etapas, próxima ação e acompanhamento pela administração com identidade do titular visível. Vencimento bloqueia operações e preserva os registros. Sem vincular automaticamente contrato de marketing a assinatura da ferramenta.
5. Próxima Resposta: ferramenta protegida para apoio após orçamento, com situações estruturadas, texto editável, orientação e próximo passo. Recusa encerra, data futura aguarda e insistência pede revisão. Sem envio externo, importação de conversas, dados pessoais, descontos ou resultados inventados. Sem chamadas pagas neste lote.

## Conteúdo e integração

Preservar o fluxo editorial: rascunho, revisão, versão aprovada. Nenhum agente ganha publicação direta ou execução remota. Kiwify e Asaas continuam desativados; pagamento futuro somente por confirmação autenticada no servidor, sem confiar no navegador. Arquivos aceitos possuem tipo, tamanho e destino validados; capas não aceitam SVG/HTML executável.

## Validação

- Regressão de aulas, progresso separado de teste, favoritos, prévia e bloqueio.
- PDF real, tela cheia, troca de página e retorno à aula; Pomodoro compacto sem bloquear controles.
- Comunidade e administração em 360, 390, 768, 1280 e 1440 px, sem recorte horizontal.
- Sem compra, licença vencida/revogada, acesso direto às operações e tentativa entre titulares devem falhar.
- Fim de mês, ano bissexto, UTC, dois produtos independentes, duas abas, troca de dispositivo e sessão expirada.
- CRM continua armazenado após vencer; outro cliente não consegue consultar ou alterar.
- Tipos, build, testes locais SQL e de interface, compatibilidade e diff revisado.

## Entrega e reversão

Entregar branch e PR de revisão com evidência local e instruções de teste. SQL incremental fica preparado e não aplicado ao backend `jjjtkowvxemvituvywvf`. Reverter código pelo commit do lote; desabilitar novas entradas de ferramentas sem apagar licenças, histórico ou dados. Publicação e ativação dos pagamentos são etapas futuras separadas.

## Implementação preparada

- Rotas preservadas: `/membros` e `/membros/administrar`.
- Estudo: `FocoDeEstudo.tsx`, `PdfSeguro.tsx` e `LeitorDeProduto.tsx`. O compacto do relógio fica dentro do leitor para continuar acessível com a aula aberta. PDF em tela cheia mantém documento e página; Escape retorna à aula.
- Comunidade: `ComunidadeDoCurso.tsx`, `CanaisDoProduto.tsx` e `src/lib/membros/canais.ts`. Convites ficam fora do catálogo público e passam pela autorização do acervo. Nenhum grupo real foi inventado ou cadastrado.
- Capas: `src/lib/membros/capas.ts` decodifica e reencoda imagens; o bucket limita tamanho e formatos e restringe escrita à administração. Arquivos de curso passam por `arquivos.ts`, com tipo, extensão, assinatura de PDF e conferência do diretório de ZIP sem executar conteúdo.
- Ferramentas: `FerramentasDoMembro.tsx`, `AdminFerramentas.tsx`, `CrmDoMembro.tsx` e `src/lib/membros/ferramentas.ts`. As etapas compartilhadas do CRM estão em `src/lib/comercial/estagios.ts`; o serviço do CRM interno mantém suas permissões e exportações.
- Editorial: `VersoesDoConteudo.tsx` e `editorial.ts`. Salvar uma alteração cria rascunho, sem trocar a aula atual. Revisão, aprovação e publicação são ações separadas. O arquivo de uma versão pode ser conferido pela nova ação `arquivo_versao` da função existente `area-membros`, exclusiva da administração.

Migration nova: `supabase/migrations/20261020190625_membros_estudo_ferramentas.sql`. O manifesto foi estendido somente para esse fonte. O catálogo do projeto conserva as 388 entradas revisadas e registra uma migration pendente. Nenhum histórico antigo foi reexecutado ou reparado. A regra `eol=lf` mantém os bytes novos estáveis no Windows e no Git.

As tabelas novas guardam canais, vínculos de ferramentas, licenças, sessões, contatos, negócios, histórico, pedidos de exclusão e versões editoriais. Elas têm RLS e não permitem acesso REST direto por membros. Operações passam por funções com identidade, autorização e caminho de busca fixo. A prova de sessão vai no corpo da chamada e seu resumo criptográfico fica no servidor. Não há credencial compartilhada no navegador.

O upgrade mensal guarda apenas um rascunho por produto. Não há preço, plano comercial publicado, limite comercial inventado, assinatura ativa ou cobrança. A Próxima Resposta usa regras estruturadas e modelos de mensagem no servidor; não chama uma IA paga, não guarda o formulário e não envia mensagens. O campo da oferta é texto de contexto, não instrução de execução.

## Retenção e exclusão

O vencimento e a revogação impedem novas operações, mantendo os registros privados. A administração acompanha um titular e produto identificados, em leitura. O titular pode pedir exclusão mesmo depois do vencimento ou se a ferramenta tiver saído do catálogo. A administração confere pessoa, produto, data e quantidade de registros antes de atender o pedido. A exclusão remove somente contatos e negócios desse CRM; outras compras, licenças e aulas não são apagadas. O histórico registra a ação sem copiar o conteúdo removido.

## Verificação para a revisão

Dados de interface são sintéticos, usados exclusivamente no navegador de teste. O PostgreSQL é temporário, local, com acesso apenas por `127.0.0.1`, e é encerrado pelo verificador. Isso não equivale a um teste de pagamento ou de produção.

```powershell
node node_modules/vitest/vitest.mjs run src/test/membros-biblioteca.test.tsx src/test/membros-identidade.test.tsx src/test/membros-foco.test.tsx src/test/membros-ferramentas.test.tsx src/test/membros-arquivos.test.ts src/lib/membros/modelo.test.ts --maxWorkers=1 --no-file-parallelism
./scripts/testar-membros-local.ps1 -PostgresBin <runtime-postgres-local>
node scripts/testar-membros-visual.mjs
node scripts/verificar-tipos-membros.mjs
deno check supabase/functions/area-membros/index.ts
```

O teste visual usa a aplicação e o PDF.js reais, um PDF de duas páginas gerado pelo próprio verificador, APIs substituídas apenas no teste e bloqueio de conexões externas. Verifica largura total da comunidade, navegação, teclado, modo foco, PDF em tela cheia, relógio compacto e rolagem independente das colunas. Capturas em `docs/membros/evidencias/` acompanham o PR; os logs completos ficam no diretório local `outputs/`.

Para o teste visual, inicie antes o Vite local em outra janela com `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4178 --strictPort`.

Resultados locais: 45 testes de membros, 81 de regressão de CRM, 156 verificações SQL e 53 estados visuais em cinco larguras. Deno passou em 14 testes existentes e na análise da função de arquivos. Build, tipos de aplicação, tipos Node e compatibilidade Lovable passaram. A checagem global de testes apontou 159 diagnósticos: o único novo era uma opção incorreta do Testing Library, já corrigida e conferida por `verificar-tipos-membros.mjs`; os outros 158 estão em arquivos inalterados. Não declarar essa checagem global como aprovada. O build também conserva avisos de tamanho de bundle e um seletor CSS originado em uma expressão regular antiga de `CadernoDoDossie.tsx`, que não foi alterado.

Dois testes antigos de CRM normalizam CRLF ao ler fontes, mantendo as mesmas asserções. Nenhuma função ou migration antiga de CRM foi alterada para fazê-los passar.

## Ordem de uma futura ativação

1. Revisar o PR, a migration incremental e o estado real do backend, sem replay do histórico.
2. Com autorização específica para esse ambiente, aplicar a migration e publicar a atualização de `area-membros` antes da interface.
3. Conferir com contas comuns distintas: sessão, isolamento, versão de arquivo, PDF, progresso e grupos. Validar o caminho da função de arquivo em um ambiente integrado.
4. Manter Kiwify e Asaas desligados. Antes de ativar vendas, definir oferta e plano, configurar credenciais no cofre, ligar a emissão de licença ao pagamento autenticado e testar confirmação, duplicidade, estorno, cancelamento e renovação.
5. Só depois autorizar vendas reais. Não conceder licença por retorno do navegador, mensagem do checkout ou relatório de agente.

Reversão do código não deve apagar tabelas de clientes. A exclusão de dados solicitada pelo titular, quando atendida, é irreversível e precisa de revisão do escopo exibido.
