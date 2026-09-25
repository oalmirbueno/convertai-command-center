# Mesa Ads v5: resultados claros, vínculo automático, agente sênior e pacote do agente externo

Data: 2026-09-26. Frente M. Pedido do dono (resumo): resultados mais claros; "anúncios sem vínculo" reconhecidos sozinhos; corrigir a rolagem que movia a tela inteira; um agente sênior de tráfego (foco em mensagem e vendas, especialista no nicho, Pedro Sobral e Natália Torres, pesquisa e Biblioteca de Anúncios); baixar o pacote completo para o agente externo e importar o retorno no Estúdio Ads.

SQL novo: `docs/mesa-ads/v5/01_vinculos_e_biblioteca.sql` (NÃO aplicado). A função funciona sem ele, em modo reduzido (ver o cabeçalho do SQL).

## Ações da função `mesa-ads`

Erros no formato de sempre (`{ error, mensagem, ... }`). Ações longas respondem com fôlego.

### `conta_ao_vivo` (ampliada, grátis)
Cada anúncio ganha `peca` (a mesma arte em vários anúncios: hash da imagem, vídeo, id do criativo ou URL sem assinatura), `grupo` (`mensagem | vendas | cadastro | trafego | engajamento | alcance`, pelo resultado que o anúncio busca) e `criativo: { id, nome, origem: "ligado" | "mesma_peca" } | null`. Cada campanha ganha `grupo`. A resposta ganha `mix_objetivos: { total, por_grupo: [{ grupo, rotulo, gasto, pct, resultados, custo_por_resultado, resultado_rotulo }], perto_da_venda_pct, alertas: string[] }` (alerta em código quando 50% ou mais do investimento está em engajamento ou alcance, ou nada otimiza para mensagem, venda ou cadastro).

### `vinculos_automaticos { client_id, jev? = true }`
Casa anúncios da conta (90 dias, até 150) com os criativos da Mesa Ads (até 80) por impressão digital da imagem (dHash 64 bits, recorte quadrado do centro), `utm_content` e nome do anúncio do pacote do gestor, texto principal, título, campanha com o nome do plano e datas (anúncio que rodou antes do criativo existir não pode ser dele). Confiança >= 0,8 sem rival a menos de 0,12 liga sozinho (`ads_criativos.ad_id` = anúncio de maior gasto da peça, só onde `ad_id` está vazio). Entre 0,45 e 0,8, ou com rival perto: Jev (Choice com "nenhum", uma chamada para até 20 peças); confiança do Jev >= 0,6 liga ou recusa; senão fica para a equipe.
-> `{ itens: [{ peca, estado, origem: "ja_ligado" | "automatico" | "jev" | "confirmar" | "sem_par", confianca, sinais, anuncio, criativo, candidatos }], resumo, impressoes: { novas, pendentes }, historico_disponivel, jev_erro, custo_usd }`.

### `vinculo_confirmar { client_id, criativo_id, ad_id }` e `vinculo_desfazer { client_id, criativo_id, ad_id, recusar? = true }`
Sem IA. Confirmar recusa anúncio já ligado a outro criativo (409). Desfazer com `recusar` grava "não é este" (não volta como sugestão).

### `conta_conversar { client_id, mensagem, conversa_id?, plano_id?, dias? = 30, pesquisar? = true, nicho?, modelo_id?, raciocinio? }`
O agente sênior de tráfego: uma chamada por mensagem (sem laço), `timeoutMs` 300 s, pesquisa web do motor quando `pesquisar`, e a Biblioteca de Anúncios da Meta (`ads_archive`, só leitura) quando o token do cofre permite. Contexto: conta ao vivo, mix de objetivos, evolução (código), criativos da Mesa Ads, oferta escolhida, briefing, contexto consolidado e da marca, dossiê, cérebro do cliente, planos recentes, o plano aberto e o nicho (Jev). Sistema: `CONHECIMENTO_ESTRATEGISTA_ADS` + blocos dos especialistas com teto (`ESTRATEGIA_SENIOR_DE_CONTA`, estrutura, plano de teste, corte e escala, ganchos, erros, orçamento, Natália, checklist do objetivo) + regras da execução.
-> `{ conversa_id, resposta, estrategia, markdown, mix_objetivos, nicho, pesquisa: { web, biblioteca: { consultada, motivo, anuncios } }, custo_usd, saldo_usd, jev_erro }`.
`estrategia = { resposta, diagnostico: [{ titulo, detalhe, gravidade }], manter, cortar, escalar: [{ ad_id, porque, como }], reestruturacao: { objetivo, porque, evento_otimizacao, campanhas: [{ nome, objetivo, orcamento_diario_brl, conjuntos: [{ nome, publico, orcamento_diario_brl, anuncios }] }], verba_total_diaria_brl, passos }, proximos_criativos: [{ titulo, angulo, gancho_verbal, gancho_visual, formato, estilo_visual, objetivo, cta_meta, base_ad_id, porque }], pesquisa: [{ achado, fonte }], perguntas }`. Só ad_id da conta; escalar só com resultado real; cada anúncio em um grupo só.
A conversa fica em `agente_conversas` (`referencia_tipo = 'ads_conta'`, `referencia_id = client_id`); a estratégia vai em `agente_mensagens.anexos[{ tipo: "estrategia", estrategia }]`.

### `conta_conversa_ler { client_id }` -> `{ conversa_id, mensagens: [{ id, papel, conteudo, criado_em, estrategia }], custo_usd: 0 }`

### `pacote_otimizacao_dados { client_id, dias? }` -> grátis
`{ cliente, periodo, contexto (o mesmo JSON do agente sênior), estrategia, estrategia_markdown, estrategia_em, regras: { politicas_meta, honestidade, ctas_meta, estilos_visuais, objetivos, estrategia_de_conta, corte_e_escala, formato_do_criativo } }`.

### `pacote_importar { client_id, pacote, confirmar?, tom? }`
Sem `confirmar`: só valida (grátis) -> `{ entendido: { plano, aceitos, recusados, avisos } }`. Com `confirmar: true`: cria o plano (`estrutura.origem = "agente_externo"`, um ângulo por criativo), confere a política pelo Jev (aviso, sem reescrever) e cria `estudio_trabalhos` tipo `ads` já dirigidos e `ads_criativos` (mesma direção em código do `criativos_produzir`) -> `{ plano, criativos, entendido, avisos, custo_usd, jev_erro }`.

## Pacote do agente externo (.zip, montado no navegador)

`LEIA-ME.md`, `PROMPT-COMPLETO.md`, `estrategia.md`, `dados/{campanhas,anuncios,pecas,criativos-mesa,serie-diaria}.csv` (Excel: BOM, ponto e vírgula), `dados/contexto.json`, `miniaturas/<ad_id>.<ext>` (até 40), `criativos-mesa/<nn>-<nome>.<ext>` (até 20), `MODELO-DE-RETORNO.json`.

## Contrato do retorno (`mesa-ads-retorno`, versão 1)

```json
{ "formato": "mesa-ads-retorno", "versao": 1,
  "plano": { "nome": "...", "objetivo": "mensagens", "resumo": "..." },
  "criativos": [{ "titulo": "...", "angulo": "...", "formato": "feed_4x5", "gancho_visual": "...", "headline_arte": "...",
    "texto_principal": "...", "titulo_anuncio": "até 40", "hipotese": "...", "objetivo": "mensagens", "estilo_visual": null,
    "apoio_arte": "...", "cta_arte": "...", "texto_principal_longo": "...", "descricao": "até 30", "cta_meta": "Enviar mensagem",
    "carrossel": [{ "texto": "...", "ilustracao": "..." }], "base_ad_id": null }] }
```
Obrigatórios por criativo: `titulo`, `angulo`, `formato` (`feed_4x5 | quadrado_1x1 | stories_9x16 | carrossel`, aceita 4:5, 1:1, 9:16, stories), `gancho_visual`, `headline_arte`, `texto_principal`, `titulo_anuncio`. Até 12 por importação. O que falta é recusado com o motivo; objetivo, estilo e botão desconhecidos viram aviso com o padrão honesto. Aceita o JSON puro, um bloco ```json no texto ou um `retorno.json` dentro do .zip.

## Tela

- Resultados e Conta: resumo no topo (investimento, resultado principal, custo por resultado, tendência, ativos), barra "onde está o investimento" com os alertas, filtro por objetivo e abas Ativos agora, Melhores anúncios (custo abaixo da mediana do mesmo tipo de resultado, com volume), Melhores criativos (peça somada), Todos, Para descartar (sinal pausar).
- Resultados: "Anúncios e criativos da Mesa Ads" (vínculo automático) no lugar de "anúncios sem vínculo".
- Conta: agente sênior, "Baixar pacote de otimização (.zip)" e "Importar pacote no Estúdio Ads"; os números extras ficam em "Mais números do período".
- Plano: "Revisar com o agente sênior de tráfego" (abre sob demanda). Estúdio Ads: "Importar pacote no Estúdio Ads".
- Rolagem: sem tabela larga (a rolagem de lado no fim da tabela movia a tela inteira); caixas com rolagem própria só do tablet para cima e com `overscroll-contain`.
