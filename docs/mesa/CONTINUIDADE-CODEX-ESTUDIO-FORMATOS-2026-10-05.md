# Continuidade complementar — estúdio da Mesa e Mesa Fotos

Origem: Codex. Máquina: almir-notebook-andar-de-cima. Data: 2026-10-05.
Base: origin/main c9df2b8e. Branch: codex/mesa-estudio-formatos.

## Aviso explícito ao Claude

Almir pediu continuar, complementar e melhorar a base existente, preservando seu trabalho. Não copiar diretórios por cima, não fazer reset/stash das alterações dele e não implementar uma segunda versão dos mesmos recursos. Leia o diff desta branch antes de retomar. Integre os commits somente após revisão, resolvendo qualquer mudança posterior por intenção de cada trecho.

O checkout original é C:/Users/Usuario/Desktop/Projeto Aceleriq/Claude/convertai-command-center. As alterações preexistentes em src/components/publico/CascaPublica.tsx e src/pages/BriefingPublic.tsx foram preservadas e não entram neste lote. A implementação está no worktree isolado C:/Users/Usuario/Documents/Codex/2026-10-05/quero-que-voce-fale-pro-claude/work/aceleriq.

O aplicativo Claude estava fechado na consulta inicial. CLAUDE.md e CODEX-CONTINUIDADE-MESA.md, na raiz original, são avisos persistentes; não há confirmação de leitura pelo Claude.

## Publicação atual confirmada por Almir

A publicação é DIRETA. O workflow .github/workflows/deploy-cloudflare-pages.yml publica o frontend ao receber push em main, usando Wrangler e wrangler.jsonc. Não usar Publish no Lovable. Nenhum workflow, configuração Cloudflare, segredo, domínio ou destino de publicação foi alterado.

Este lote é uma branch para revisão, sem merge nem deploy. O frontend e as Edge Functions são entregas diferentes. Antes de disponibilizar a nova UI em produção, revisar/publicar mesa-foto e mesa-videos pelo procedimento Supabase já adotado, no projeto atual, com os módulos importados. O deploy Cloudflare sozinho não publica essas funções. Não aplicar migrações: este lote não contém SQL nem mudança de schema.

## Implementado

- EstudioDaPauta mantém a faixa mensal e escolhe ferramentas pelos dados do trabalho/pauta: so_fotos, tipos canônicos reel/video/short ou arte. Permite escolha persistente em pauta vazia; trabalho existente bloqueia conversão por acidente. Não infere formato por palavras do título.
- EstudioDeFotosDaPauta embute as ferramentas existentes, montagem de fotos/carrossel, legenda e entrega. Rascunhos centrais, seleção, kit e conversa são próprios da pauta. Acervo, modelos e clones continuam sendo a biblioteca compartilhada do cliente; a Mesa Fotos independente mantém sua rota e seus rascunhos.
- ComposicaoRapida: pessoa/modelo/clone à esquerda, composição no centro, produto à direita. Foco fluido, proporção, motor de imagem, ambiente real, ferramentas pro e encaminhamento ao post. Cada geração salva Canvas próprio. As versões da composição se separam por produto e pessoa. Aplicar um produto tratado exige conferência e cria um kit derivado, preservando o original.
- Estúdio de foto permite escolher o motor para novas versões; aproveita o conjunto já existente de ajustes, realismo, upscale, remoção de fundo e versões dos modelos.
- SeletorDeFotos filtra por caminho/pasta real do Workspace e descendentes, busca e classe; pagina a exibição sem esconder definitivamente as fotos restantes.
- Diretor consulta pastas explicitamente citadas e só retorna seleções de fotos reais presentes no pacote. A tela relê e aplica a seleção, com erro visível se não puder confirmar. Nomes ambíguos precisam de caminho completo. Não há busca semântica inventando IDs. Pauta recebida é conferida contra cliente no servidor e destinos para outros posts/pautas são recusados.
- EstudioDeVideoDaPauta reúne bases de produto, imóvel, jardim, móveis e materiais. Usa o gerador real existente, fotos do Workspace, quadros inicial/final, referências, áudio/narração quando suportados pelo motor e acompanhamento do pedido. Resultados são filtrados por pauta. O diretor pode preencher uma foto por vez no campo escolhido.
- Legendas dos vídeos gerados reutilizam transcrição, versão derivada e fila de render existentes, preservando áudio/proporção/fontes. Não introduz timeline de edição nem Mesa Motion.
- EntregaDoVideoDaPauta usa Workspace -> Arquivos -> editor editorial -> revisão/Agenda. Arquivo diferente em post existente abre revisão. Mantém as duas aprovações e não publica automaticamente.

## Arquivos para retomar

- src/components/mesa/EstudioDaPauta.tsx, EstudioDeFotosDaPauta.tsx, EstudioDeVideoDaPauta.tsx, EntregaDoVideoDaPauta.tsx, modoDaPauta.ts: coordenação da pauta.
- src/components/mesa/AbaEstudio.tsx e useItensDoMes.ts: integração e inclusão opt-in dos vídeos na faixa.
- src/components/mesa-foto/ComposicaoRapida.tsx, SeletorDeFotos.tsx, EtapaEstudio.tsx e AgenteDiretor.tsx: novas ferramentas e seleção real.
- src/components/mesa-videos/GeradorLivre.tsx, GeracoesRecentes.tsx e src/components/mesa-edicao/Finais.tsx: geração e legendagem reutilizadas.
- supabase/functions/mesa-foto/{index.ts,diretor.ts,modulos/selecao-do-workspace.ts}: seleção e isolamento da pauta.
- supabase/functions/mesa-videos/{index.ts,geracao.ts,edicao.ts,modulos/video-rapido-legendado.ts}: vínculo da geração e legenda derivada.
- Demais alterações são adaptações opcionais dos componentes existentes e expectativas dos testes. Consultar git diff --stat para o inventário integral.

## Não feito / limites de validação

- Sem deploy, merge, mudanças no banco ou geração paga com material real de clientes.
- A narração é solicitada ao motor de vídeo compatível com áudio; a fala resultante precisa ser conferida. Não é um serviço novo de dublagem.
- O reconhecimento de formato usa metadados já persistidos. Pauta vazia sem identificação de fotos permite escolher Fotos e mantém a escolha local até criar o post.
- Recuperação do Workspace trabalha com imagens já indexadas no acervo do cliente, não lê diretórios do computador local. Permissões e disponibilidade dos provedores continuam valendo.
- Verificação visual local usa dados fictícios; não demonstra autorização, qualidade de geração ou funcionamento dos provedores em produção.

## Validação e continuação

Verificações executadas:

- 70 testes focados de composição/formatos/linha de fotos; depois, 143 testes de integração dos estúdios, geração, legendas e caminhos: passaram. As 3 suites de contratos atualizados totalizam 117 testes; as duas de esteira/UI passaram e os 17 do diretor passaram após atualizar a expectativa da seleção comprovada.
- Typecheck app e node: passaram. Typecheck test: 134 erros no lote e os mesmos 134 no baseline limpo, comparados sem número de linha; nenhum erro novo.
- Deno check de mesa-foto e mesa-videos: passou. Build de produção: passou (avisos existentes de chunks grandes e Browserslist antigo).
- Lint de todos os novos arquivos TypeScript da UI e testes: passou. git diff --check: passou.
- Verificação/geração da compatibilidade MCP: passou. O artefato regenerado mostrou uma diferença preexistente fora do escopo e foi restaurado, sem incluir alteração no MCP.
- A suíte completa executou 576 arquivos / 8.618 testes: 8.533 passaram e 85 falharam. As quatro falhas relacionadas ao lote foram corrigidas e reexecutadas com sucesso. As restantes foram reproduzidas no mesmo commit limpo (66 suites, 81 testes). Não declarar suíte global verde.
- Verificação visual em navegador isolado (1440 px e 390 px), com dados fictícios: sem erros de página e sem overflow horizontal no celular.

Os resultados também estão no PR e no aviso da raiz. A suíte geral do Windows contém falhas de baseline, principalmente contratos que comparam texto com LF em arquivos CRLF e suites com requisitos de ambiente. Comparar com o checkout limpo do mesmo commit; não reescrever código alheio para forçar esses testes a passar.

Antes do merge: conferir o diff; validar no ambiente integrado com cliente de teste autorizado; percorrer pauta de arte, fotos e vídeo; conferir troca de cliente/pauta; gerar uma composição, produto tratado e duas variações; pedir pasta real/ambígua ao diretor; confirmar antes/depois, narração, SRT e render legendado; abrir revisão, verificar arquivo ligado à pauta e os gates da agência/cliente. Verificar também sem saldo e provedor indisponível. Nunca tomar apenas uma resposta textual como prova de geração.

Rollback: reverter apenas o commit deste lote pelo fluxo de revisão; republicar o frontend pelo fluxo Cloudflare existente. Se necessário, retornar mesa-foto/mesa-videos à versão anterior pelo mesmo processo de Edge Functions. Fontes e versões antigas são mantidas; nenhuma limpeza de dados é necessária.

Sem segredos, credenciais, transcrições ou dumps de sessão.
