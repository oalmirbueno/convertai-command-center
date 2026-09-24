# Mesa Ads v2: contrato entre as frentes

Data: 2026-09-24. Pedido do dono (resumo fiel):
- criativo mais agressivo, estratégico, focado em venda e conversão, que pare a rolagem e não seja "mais do mesmo", com copy boa;
- agente conversacional na aba Oferta que cria ofertas específicas a partir do que a equipe fala e cria criativos novos a partir de uma oferta ou de exemplos;
- conta de anúncios do cliente sincronizada "em tempo real": puxar tudo que está rodando (campanhas, anúncios, criativos, métricas), ler e ajudar a otimizar criativos e estratégia de copy;
- referências: item do catálogo da agência abre DENTRO do painel com abas, imagens e contexto (hoje só mostra o link); anúncio próprio do cliente abre vazio e tem que trazer imagem, copy, métricas, destino e original, e completar a ficha com inteligência; referências por nicho e biblioteca muito maior;
- plano de teste: evitar risco de política, respeitar as notas do Jev e só entregar ângulos completos e com as melhores pontuações; objetivos como vendas e seguidores do perfil; sempre chamar atenção;
- Estúdio Ads mais organizado; entregar ao cliente (sem aprovação, mas o cliente vê em Documentos > Criativos de anúncio);
- muitas variações de copy (título, descrição, CTA, texto longo) e pacote completo para o gestor de tráfego;
- a conferência do Jev vem ANTES de mostrar: se o texto, a identidade ou a política estiverem errados, o agente corrige sozinho antes de entregar (na imagem e no plano), para não gastar crédito entregando erro.

Regras duras que continuam valendo:
- honestidade: nunca inventar prova, número, depoimento ou urgência; E3 só com gasto e resultado reais;
- políticas da Meta (atributo pessoal, promessa de resultado, antes e depois, imitar interface, sensacionalismo) são regra dura;
- sem travessão (— ou –) em texto que a equipe ou o cliente lê;
- nunca escurecer a foto ou a capa para dar destaque; destaque vem de contraste, composição, tipografia, escala e cor;
- a chave do TypeSafe/Jev fica só no servidor;
- compatibilidade Safari 11 / Chrome 64 no front (sem lookbehind, \p{}, grupo nomeado, `.at()`, `aspect-ratio` CSS, `:has`, min()/max() em classe arbitrária);
- queries do TanStack guardam só JSON (cache persistido);
- português claro em tudo que aparece na tela.

## Donos de arquivo (ninguém edita arquivo de outra frente)

| Frente | Arquivos |
| --- | --- |
| A. Servidor Mesa Ads | `supabase/functions/mesa-ads/**`, `src/test/mesa-ads-servidor.test.ts` (e testes novos `src/test/mesa-ads-v2-*.test.ts` do servidor), SQL novo em `docs/mesa-ads/v2/migrations/` |
| B. Estúdio (autocorreção) | `supabase/functions/estudio-arte/**`, `src/components/mesa-ads/ArteDoCriativo.tsx`, `src/components/mesa/**` que fazem gerar/conferir (PranchetaDoEstudio e afins), `src/test/estudio-*.test.ts` |
| C. Front Mesa Ads | `src/pages/MesaAds.tsx`, `src/components/mesa-ads/**` EXCETO `ArteDoCriativo.tsx`, `src/test/mesa-ads-ui*.test.tsx` |
| D. Pesquisa e conhecimento | `supabase/functions/_shared/conhecimento-ads.ts`, `docs/mesa-ads/pesquisa/**`, `docs/mesa-ads/v2/biblioteca-padroes.json`, `docs/mesa-ads/v2/migrations/seed_biblioteca_padroes.sql` |

Migrations: ninguém aplica no banco. Cada frente escreve o SQL em `docs/mesa-ads/v2/migrations/<nome>.sql`; o coordenador aplica, renomeia para a versão e registra no manifesto. Ninguém faz commit, push ou deploy.

## Nomes que a frente D exporta de `_shared/conhecimento-ads.ts` (a frente A importa)

Tudo aditivo; nada existente muda de nome ou assinatura.

```ts
export const VERSAO_CONHECIMENTO_ADS = "2026-09-24.2";
export type EstiloVisual = { id: string; nome: string; quando_usar: string; como_fazer: string; risco_politica: "baixo" | "medio" | "alto"; };
export const ESTILOS_VISUAIS: EstiloVisual[];            // >= 14 estilos de criativo estático realmente diferentes
export const ESTILOS_VISUAIS_IDS: readonly string[];     // ids de ESTILOS_VISUAIS
export const NIVEIS_PARADA: string[];                    // 5 níveis (0 a 4): poder de parar a rolagem no feed
export const NIVEIS_DIFERENCIACAO: string[];             // 5 níveis: quanto foge do "mais do mesmo" do nicho
export const NIVEIS_FORCA_OFERTA: string[];              // 5 níveis: força da oferta (valor percebido x risco x esforço)
export type ObjetivoCampanha = { id: "vendas" | "mensagens" | "leads" | "seguidores" | "agendamento" | "trafego" | "reconhecimento"; nome: string; objetivo_meta: string; evento_otimizacao: string; metrica_que_decide: string; ctas: string[]; como_o_criativo_muda: string; };
export const OBJETIVOS_DE_CAMPANHA: ObjetivoCampanha[];
export type Nicho = { id: string; nome: string; dores: string[]; desejos: string[]; ganchos: string[]; provas_tipicas: string[]; riscos_de_politica: string[]; estilos_que_funcionam: string[]; };
export const NICHOS: Nicho[];                            // >= 18 nichos
export const CONHECIMENTO_OFERTA: string;                // montagem de oferta (equação de valor, bônus, garantia, urgência real, nome, ancoragem, reversão de risco) com as regras de honestidade
export const CONHECIMENTO_AGRESSIVO: string;             // como ser agressivo e vendedor DENTRO da política e sem escurecer a foto
export const CONHECIMENTO_CONTA: string;                 // leitura de conta: fadiga, escala, pausa, renovação, estratégia de copy, era Andromeda (diversidade de criativo)
export const CONHECIMENTO_COPY_PACOTE: string;           // regras do pacote de copy (limites de caracteres da Meta, estilos de texto principal, títulos, descrições, CTAs)
// CONHECIMENTO_ESTRATEGISTA_ADS e regrasDoCriativo(formato) continuam com o mesmo nome e assinatura, mais fortes.
```

## Ações novas e mudadas da função `mesa-ads` (frente A implementa, frente C consome)

Toda resposta com IA devolve `custo_usd` e `saldo_usd`. Erros no formato já usado (`{ erro, codigo, ... }` via `ErroHttp`).

### Oferta
- `oferta_conversar { client_id, mensagem, conversa_id?, anexos?: string[] (caminhos no bucket mesa), modelo_id?, raciocinio? }`
  -> `{ conversa_id, resposta: string, ofertas: Oferta[], briefing_sugerido: Record<string, unknown> | null, ideias: Ideia[], custo_usd, saldo_usd }`
  - O agente conversa (histórico da conversa no banco), usa briefing atual, contexto do cliente, aprendizados e CONHECIMENTO_OFERTA.
  - Ofertas novas são gravadas em `ads_ofertas` e conferidas pelo Jev (clareza, forca, risco_politica) antes de voltar; oferta com alerta de política é reescrita uma vez antes de responder.
  - `Oferta = { id, nome, para_quem, promessa, mecanismo, entregaveis: string[], bonus: string[], garantia: string|null, urgencia_real: string|null, ancoragem: string|null, cta, provas_necessarias: string[], riscos: string[], status: "rascunho"|"escolhida"|"arquivada", jev: { clareza, forca, risco_politica, alerta_politica } | null }`
  - `Ideia = { titulo, gancho_verbal, gancho_visual, estilo_visual, formato }`
- `oferta_salvar { client_id, oferta_id, campos?, status? }` -> `{ oferta }` (editar à mão, escolher, arquivar; sem IA).
- A tela lê `ads_ofertas` direto pelo Supabase (RLS da equipe) ou por `oferta_listar { client_id } -> { ofertas }`.

### Plano
- `plano_gerar` ganha `oferta_id?`, `objetivo?` (id de OBJETIVOS_DE_CAMPANHA), `referencia_ids?` (exemplos escolhidos, inclusive anúncio próprio vencedor) e `modo?: "novo" | "variar_vencedor"`.
- Laço de qualidade no servidor ANTES de devolver: o Jev pontua clareza, relevancia, prova, risco_politica, parada e diferenciacao (0 a 10). Ângulo aprovado quando `clareza >= 7`, `relevancia >= 7`, `parada >= 6`, `diferenciacao >= 6`, `risco_politica >= 7` (a escala vai de 0 = viola a 10 = sem risco) e sem alerta. Reprovados são reescritos pelo estrategista com os motivos e repontuados (até 2 rodadas, respeitando o tempo da função). Ordem final por `pontuacao`. O que continua reprovado vai para `estrutura.descartados` com os motivos (só fica na lista principal se sobrarem menos de 3 aprovados, marcado `reprovado: true`).
- Ângulo ganha: `estilo_visual`, `objetivo`, `pontuacao` (0 a 10), `rodadas`, `aprovado`, `motivos` (string[]), e `jev.parada`, `jev.diferenciacao`.
- `estrutura` ganha `objetivo`, `oferta_id`, `descartados`, `qualidade: { rodadas, aprovados, reprovados }`.

### Conta ao vivo
- `conta_ao_vivo { client_id, dias?: 7|14|30 }` -> sem IA, grátis:
  `{ conectada, atualizado_em, periodo: { inicio, fim }, totais, campanhas: [{ campaign_id, nome, status, objetivo, orcamento_diario, metricas }], anuncios: [{ ad_id, nome, status, campaign_id, campanha, imagem_url, titulo, corpo, descricao, cta, destino, metricas, diagnostico, tendencia: { ctr_var_pct, custo_resultado_var_pct, frequencia }, sinal: "escalar"|"manter"|"observar"|"renovar"|"pausar"|"sem_dados", referencia_id|null }] }`
  - `sinal` é regra em código (calculos.ts), nunca IA.
- `conta_sincronizar { client_id }` -> chama `collect_ads_now()` como o usuário; devolve o que a função devolveu. A tela lê `conta_ao_vivo` de novo depois de uns segundos.
- `conta_analisar { client_id, dias?, modelo_id?, raciocinio? }` -> estrategista lê os dados (números vêm do código) e devolve `{ analise: { resumo, escalar: [{ ad_id, porque }], pausar: [...], renovar: [{ ad_id, porque, sugestao }], copy: [{ achado, recomendacao }], proximos_testes: [{ titulo, hipotese, estilo_visual, objetivo }] }, analise_id, custo_usd, saldo_usd }`, gravada em `ads_analises`.

### Referências
- `referencia_abrir { client_id, referencia_id }` -> sem IA de texto; enriquece uma vez e devolve tudo para a janela de detalhe:
  `{ referencia, galeria: [{ url (assinada), legenda }], pagina: { titulo, descricao, site, tipo, extra } | null, anuncio: { ad_id, status, campanha, titulo, corpo, descricao, cta, destino, metricas, serie: [{ dia, gasto, impressoes, cliques, ctr, resultados }], diagnostico } | null, aviso: string | null }`
  - Link de catálogo/URL: busca a página no servidor (og:title, og:description, og:image; YouTube pela miniatura do id; GitHub pela API pública com descrição, estrelas, tópicos e começo do README; Behance pelas imagens dos módulos do projeto; Instagram pelo og:image) e baixa até 12 imagens para o bucket `mesa` (`biblioteca/<ref_id>/...` na biblioteca da agência, `<client_id>/referencias/<ref_id>/...` no cliente). Grava em `ficha.galeria` e `ficha.pagina`.
  - Anúncio próprio: baixa a imagem da Meta para o storage (o link expira), puxa copy, título, descrição, CTA e destino do `raw` do criativo, a série diária e o diagnóstico.
- `referencia_ler` passa a aceitar referência da biblioteca da agência (grava a ficha nela) e usa galeria + página + copy + métricas para completar a ficha.
- `referencias_importar_proprias` passa a baixar as imagens e preencher copy, CTA e destino.
- `referencia_importar_url { client_id, url, titulo? }` -> cria referência do cliente a partir de qualquer link (Pinterest, Instagram, Behance, imagem direta, página) e já abre (`referencia_abrir`).
- `biblioteca_do_nicho { client_id, nicho?, quantidade? (6 a 16) }` -> o estrategista cria padrões de criativo do nicho do cliente (E0, `origem = 'padrao'`, ficha completa) usando NICHOS e ESTILOS_VISUAIS; conferidos pelo Jev (risco de política).
- A biblioteca da agência ganha a semente `origem = 'padrao'` (frente D) com padrões por nicho.

### Copy e pacote
- `copy_pacote { criativo_id? , plano_id?, modelo_id? }` -> gera para cada criativo: `textos_principais: [{ estilo, texto }]` (>= 6: curto, medio, longo, pas, historia, prova/objecao), `titulos` (>= 8, até 40 caracteres), `descricoes` (>= 5, até 30 caracteres), `ctas: [{ cta, porque }]` (da lista CTAS_META), `ganchos` (>= 5 primeiras linhas), `gestor: { objetivo_meta, evento_otimizacao, publico_sugerido, conjuntos, utm, regras_de_corte, regras_de_escala, verba: string|null }`. Jev confere política de todos os textos numa chamada; texto com alerta é reescrito uma vez ou sai. Grava em `ads_criativos.copy.pacote`. Com `plano_id`, faz os criativos do plano até o tempo acabar e devolve `pendentes`.
- `pacote_enviar { client_id, plano_id?, criativo_ids?, criar_tarefa?: boolean }` -> monta o pacote do gestor (Markdown), grava em Arquivos (pasta `criativos`, tipo `documento` ou o permitido) e, com `criar_tarefa`, abre tarefa para o gestor de tráfego do cliente. `-> { file_id, tarefa_id|null, markdown }`.

## Estúdio: autocorreção antes de mostrar (frente B)

- Função pura `decidirAutocorrecao(verificacao, { ads, textoExato })` em `supabase/functions/estudio-arte/autocorrecao.ts` -> `{ precisa, motivos: string[], instrucao: string | null }`. Corrige quando: texto com palavra faltando ou sobrando (ortografia_ok === false), logo esperada ausente (logo_ok === false), identidade baixa, e em anúncio risco de política alto ou clareza baixa.
- `conferir_card` passa a devolver também `autocorrecao`.
- Ação nova `corrigir_card { trabalho_id, ordem }` -> usa a instrução da decisão e o mesmo caminho do ajuste; a versão nova leva `autocorrecao: { rodada, motivos }`. No máximo 2 rodadas automáticas seguidas por lâmina (o servidor recusa a terceira com `codigo: "limite_de_autocorrecao"`).
- Front (ArteDoCriativo e o Estúdio da Mesa do cliente): depois de gerar, confere; se `autocorrecao.precisa`, corrige e confere de novo (até 2 vezes) ANTES de revelar a arte. Enquanto isso a lâmina fica velada com a etapa ("Conferindo", "Corrigindo o texto"...). Chave "Corrigir sozinho" ligada por padrão. Se continuar errado, mostra o motivo e o botão "Corrigir de novo".
- Props públicas de `ArteDoCriativo` não mudam (a frente C a renderiza).

## Banco (frente A escreve o SQL em docs/mesa-ads/v2/migrations/)

- `ads_ofertas` (id, client_id, briefing_id, conversa_id, nome, oferta jsonb, jev jsonb, status check rascunho/escolhida/arquivada, criado_por, criado_em, atualizado_em) com RLS da equipe igual às outras tabelas ads_*.
- `ads_analises` (id, client_id, periodo_inicio, periodo_fim, dados jsonb, analise jsonb, custo_usd, criado_por, criado_em) com RLS da equipe.
- `ads_referencias.origem` aceita também `'padrao'` e `'url'`.
- `agente_conversas.referencia_tipo` (se tiver check) aceita `'ads_oferta'` e `'cliente'` conforme o que a oferta usar.
- `ads_briefings.objetivo` já é jsonb; o id do objetivo segue OBJETIVOS_DE_CAMPANHA.
