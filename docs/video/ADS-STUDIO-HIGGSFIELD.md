# Estúdio Ads: arte e vídeo

Atualização de 06/10/2026. Escopo exclusivo da Mesa Ads; preserva a Mesa Estúdio e a Mesa Foto.

## Pesquisa e escolha de integração

Os posts https://x.com/gpumaxxer/status/2107214393406796234 e https://x.com/axultan/status/2107272058501796220 apresentam o Higgsfield Ads Studio de anúncios estáticos. A recomendação aproveitada é variar conceitos de venda, mensagens e demonstrações, em vez de apenas fundos e personagens. Não assumimos promessas de ROAS ou eliminação de testes.

Para vídeo usamos a API pública Cinema Studio 4.0 já integrada ao executor da Mesa Vídeos. Não foi encontrada documentação pública de um endpoint equivalente ao fluxo completo Ads Studio mostrado nos posts; a interface não se apresenta como integração daquele produto completo.

Fontes conferidas:
- https://docs.higgsfield.ai/docs/models/cinema-studio-4/generate.md
- https://docs.higgsfield.ai/docs/authentication.md
- https://open.higgsfield.ai/quick-start
- https://open.higgsfield.ai/models/higgsfield/cinema-studio/4.0/playground

## Contrato e continuidade

- `gerar_video` aceita `ads_criativo_id` opcional. O servidor valida UUID e vínculo ao cliente autorizado antes de gerar. Não usa tarefa fictícia.
- Histórico e resultados usam `video_pedidos.parametros.ads_criativo_id`, além do cliente e pedido. Rascunhos locais usam cliente + criativo.
- Higgsfield: Authorization Key com o par de credenciais, somente no servidor; Idempotency-Key por pedido/variação. Tela mantém UID quando a resposta se perde.
- Duração 4–30 s; 480p/720p. Formato 3:4 explícito, mantendo compatibilidade do antigo 4:5 convertido para 3:4.
- Custo estimado sem vídeo de entrada: 0,2057 USD/s em 480p e 0,4623 USD/s em 720p. A API cobra tokens; o preço segue sinalizado como estimativa.
- Referências: arte atual, acervo, upload ou Workspace. Imagens orientam o modelo; não garantem quadro exato. Áudio/narração são gerados pelo modelo e exigem conferência humana.
- Entrega de vídeo: arquivo gerado → Workspace → Arquivos → revisão da agência. Não publica no Meta nem aprova em nome do cliente.
- Nenhuma migração ou alteração de credencial faz parte deste lote.

## Verificação e limite

Testes cobrem conceitos, isolamento, custo por resolução, payload do provedor, idempotência, geração com vínculo e bloqueio sem chave. Rodar também testes existentes de Ads/provedores, typecheck, build, Deno e compatibilidade MCP.

No início da implementação não havia chave Higgsfield no cofre nem nos secrets. Almir informou que irá cadastrá-la no painel. Até a conexão ser confirmada, o botão Gerar fica bloqueado; não declarar geração real validada. Após cadastrar, usar Conferir conexão e validar um vídeo com custo confirmado, prévia, persistência e revisão.

Rollback: reverter o commit do lote e republicar o frontend; restaurar o bundle anterior de mesa-videos se necessário. Os campos opcionais são compatíveis com pedidos antigos.
