# Ferramentas profissionais de imagem: Ampliar (upscale) e Tirar fundo

Pedido do dono (26/09): "colocar upscale da imagem ... repositório de removedor de fundo ... dentro do Estúdio e das Fotos. Upscale profissional, completo mesmo."

Pesquisa feita em 25/09/2026 nas páginas oficiais dos modelos e em comparativos de 2025 e 2026 (fontes no fim). Preços em dólar, por imagem, sem imposto.

## Por que API externa

As funções rodam no Supabase Edge (Deno): 2 s de CPU por chamada e 504 se a resposta não começar em 150 s. Upscale e recorte de qualidade (Topaz, BiRefNet, BRIA RMBG 2.0, SUPIR, SeedVR2) precisam de GPU. A função só faz rede: envia para a fila do provedor, consulta o andamento, baixa o resultado, confere e grava. O "Tirar fundo" de hoje (GPT Image com fundo transparente e alfa levado para a foto original, `mesa-foto/recorte.ts`) falha quando o gerador redesenha o assunto; um modelo de segmentação não redesenha nada: devolve a própria foto com o canal alfa.

## Remoção de fundo

| Serviço / modelo | Onde roda por API | Preço por imagem | Cabelo e bordas finas | Produto | Observações |
|---|---|---|---|---|---|
| BRIA RMBG 2.0 | fal.ai `fal-ai/bria/background/remove`; Replicate; API própria da Bria | US$ 0,018 (fal) | Muito bom; benchmark da Bria: 90% contra 85% do BiRefNet e 46% do Photoshop | Muito bom, inclusive em fundo complexo | Treinado só com dados licenciados (uso comercial seguro). Saída PNG com alfa na resolução da entrada. |
| BiRefNet v2 | fal.ai `fal-ai/birefnet/v2`; Replicate; código aberto (rembg) | US$ 0,0008 por segundo de GPU (cerca de US$ 0,002 a 0,005 por foto) | Muito bom com a variante Matting ou Heavy em 2048 px | Bom | Variantes: Light, Light 2K, Heavy, Matting, Portrait, Dynamic; resolução de trabalho 1024, 2048 ou 2304. |
| Ideogram Remove Background | fal.ai `fal-ai/ideogram/remove-background` | US$ 0,01 | Bom (fibras finas preservadas) | Bom | Sem controle de resolução documentado. |
| Pixelcut | fal.ai `pixelcut/background-removal` | US$ 0,016 | Bom | Pensado para e-commerce | Pode deixar leve cor nas bordas. |
| rembg (U2Net, ISNet, BiRefNet) | fal.ai `fal-ai/imageutils/rembg` (US$ 0,00111 por segundo); código aberto | frações de centavo | Médio | Médio | Base barata; bordas complexas escapam. |
| remove.bg | API própria (Kaleido/Canva) | US$ 0,13 a 0,23 (créditos; alta resolução gasta 1 a 5 créditos) | Excelente | Excelente | Mais cara; assinatura mensal. |
| Photoroom | API própria | US$ 0,02 + plano de US$ 20/mês | Excelente | Excelente (foco em produto) | Exige plano mensal. |
| Clipdrop (Jasper) | API própria | cerca de US$ 0,07 a 0,09 (1 crédito) | Bom | Bom | A Clipdrop foi absorvida pela Jasper; a compra de créditos virou formulário de contato. |

## Upscale (ampliar)

| Serviço / modelo | Onde roda por API | Preço | Fiel ou criativo | Rosto e pele | Texto | Produto | Observações |
|---|---|---|---|---|---|---|---|
| Topaz (Standard V2, High Fidelity V2, Text Refine, CGI, Redefine...) | fal.ai `fal-ai/topaz/upscale/image`; Replicate `topazlabs/image-upscale` | Faixa pela saída: até 24 MP US$ 0,08; até 48 MP US$ 0,16; até 96 MP US$ 0,32; até 512 MP US$ 1,36 | Fiel (Standard V2); criativo nos modelos Redefine e Wonder | Recuperação de rosto com força e criatividade ajustáveis (criatividade 0 = sem inventar traço) | Modelo próprio Text Refine | Muito bom | Fator de 1 a 4 (aceita decimal), saída JPEG ou PNG. Referência de mercado. |
| Recraft Crisp Upscale | fal.ai `fal-ai/recraft/upscale/crisp`; Replicate | US$ 0,004 | Fiel | Bom (otimizado para rosto) | Bom | Bom | Entrada até 16 MP, 4096 px e 10 MB; saída até cerca de 4K; fator não escolhível. Ótimo custo para web. |
| SeedVR2 | fal.ai `fal-ai/seedvr/upscale/image` | US$ 0,001 por megapixel | Fiel (restauração de um passo) | Bom | Médio | Bom | Fator livre ou alvo 720p a 2160p. Muito barato. |
| DRCT / AuraSR / Real-ESRGAN | fal.ai `fal-ai/drct-super-resolution` (US$ 0,0045/MP), `fal-ai/aura-sr` e `fal-ai/esrgan` (por segundo); Replicate `nightmareai/real-esrgan` (cerca de US$ 0,0025) | frações de centavo | Fiel (clássicos, sem difusão) | Médio (ESRGAN com GFPGAN altera rosto) | Bom (DRCT) | Médio | Rápidos e baratos; menos detalhe que Topaz. |
| Clarity Upscaler | fal.ai `fal-ai/clarity-upscaler`; Replicate `philz1337x/clarity-upscaler` | US$ 0,03 por megapixel da saída (fal) | Criativo controlado (creativity 0,35 e resemblance 0,6) | Pode mudar pele e rosto | Pode deformar letras | Bom para textura | Alternativa aberta ao Magnific. Fator de 1 a 4. |
| Recraft Creative Upscale | fal.ai `fal-ai/recraft/upscale/creative` | US$ 0,25 | Criativo | Otimizado | Médio | Bom | Preço fixo; sem escolha de fator. |
| Bria Creative Upscale | fal.ai `bria/upscale/creative` | US$ 0,04 | Criativo | Otimizado | Médio | Bom | Fator 2x fixo. |
| Ideogram Upscale | fal.ai `fal-ai/ideogram/upscale` | US$ 0,06 | Criativo leve (até 2x, com prompt opcional) | Bom | Bom | Bom | Até 2x. |
| SUPIR | fal.ai e Replicate | cerca de US$ 0,10 | Criativo (difusão pesada) | Muito detalhe, risco de alucinar | Fraco | Bom | Lento; bom para foto muito degradada. |
| Magnific (Freepik) | API própria (Magnific API) | Pela área de saída: cerca de EUR 0,10 (640x480 a 2x) a EUR 0,50 (a 8x); 4x perto de EUR 0,20 | Criativo (Creative) e fiel (Precision) | Excelente no Creative, mas alucina | Precision indicado para texto, logo e produto | Excelente | Até 16x. Conta e créditos separados; desde abril de 2026 o Freepik virou Magnific. |

Tempo típico (comparativos e páginas dos modelos): recorte de 2 a 10 s; upscale fiel de 5 a 60 s; criativo de 20 s a 2 min. Todos os provedores trabalham com fila assíncrona (enviar, consultar o status, buscar o resultado) ou webhook.

## Fila da fal.ai (o que a função usa)

- Enviar: `POST https://queue.fal.run/{modelo}` com `Authorization: Key $FAL_KEY` e o JSON de entrada; volta `request_id`, `status_url`, `response_url`.
- Consultar: `GET status_url` até `status` = `COMPLETED` (antes: `IN_QUEUE` ou `IN_PROGRESS`).
- Resultado: `GET response_url` volta `{ image: { url, width, height, content_type } }`; a URL é pública (`*.fal.media`) e expira.
- Retenção: o cabeçalho `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": 86400}` faz o provedor apagar entrada e saída depois de 1 dia.

## Recomendação

**Provedor principal: fal.ai.** Uma conta e uma chave para os dois tipos de modelo (Topaz, SeedVR2, Clarity, BRIA RMBG 2.0, BiRefNet e outros), pagamento por uso sem mensalidade, fila assíncrona padronizada e preços publicados por modelo. Replicate tem quase os mesmos modelos, mas preço por tempo de GPU (menos previsível). remove.bg, Photoroom e Magnific são bons, mas cada um pede conta e plano próprios.

Padrões implementados (`supabase/functions/mesa-foto/modulos/ferramentas-imagem.ts`, `MOTOR_PADRAO`):

| Tarefa | Motor padrão | Custo típico | Por quê | Alternativa no código |
|---|---|---|---|---|
| Ampliar fiel (foto real e produto) | Topaz Standard V2, recuperação de rosto com criatividade 0 (Text Refine quando `conteudo: 'texto'`, CGI quando `'arte'`) | US$ 0,08 até 24 MP de saída; US$ 0,16 até 40 MP | Referência de fidelidade, fator 2 ou 4, texto com modelo próprio | SeedVR2 (`motor: 'seedvr'`, cerca de US$ 0,02 a 0,04) |
| Ampliar criativo (opcional) | Clarity Upscaler (creativity 0,35, resemblance 0,6) | US$ 0,03 por MP de saída (2x de 1024 px: US$ 0,13; teto de 16 MP: US$ 0,48) | Reconstrói textura; marcado como gerado e com aviso | |
| Tirar fundo (cabelo e produto) | BRIA RMBG 2.0 | US$ 0,018 | Melhor resultado medido em fundo complexo e cabelo, licença comercial limpa, preço fixo | BiRefNet v2 Heavy 2048 (`motor: 'birefnet'`, cerca de US$ 0,002 a 0,012) |

### Borda sem halo (frente IDR, 30/09/2026)

Dono: "retira o fundo, mas ainda fica recorte branco". O halo não é só a máscara: é a cor da borda, que guarda a mistura com o fundo antigo. Pesquisa de 30/09 (fal.ai, páginas dos modelos e comparativos de 2026): BRIA RMBG 2.0 continua com a melhor máscara medida, mas a saída na fal traz a cor original na borda; o BiRefNet v2 tem `refine_foreground` (estimativa da cor do assunto na GPU) e variantes Heavy e Matting em 2048 px; BEN2 e Pixelcut (produto, sem franja, US$ 0,016) ficam como candidatos, sem motor no código ainda.

Decisão implementada:

- **Sem motor escolhido** (`motorDoFundoPara`): até 1 MP, BRIA RMBG 2.0 e depois a borda refeita pelo código com a foto original atrás; acima de 1 MP vai o BiRefNet v2 Heavy 2K com `refine_foreground`. A equipe ainda escolhe o motor pelo `motor`.
- **A borda do recorte pro é um passo à parte** (revisão de 01/10): o resultado pago entra no acervo primeiro; a tela chama depois `ferramenta_borda_limpa` (sem custo), que grava a versão limpa como derivada nova (tag `borda_limpa`, id fixo) e arquiva o recorte do provedor. Estourar a CPU nesse passo não perde nada, e `ferramenta_retomar` nunca refaz a borda. Medido no Deno local, em duas sessões (uma com a máquina carregada): abrir JPEG e PNG, limpar, gravar PNG e sha256 levaram de 0,26 a 0,93 s em 1 MP e de 0,58 a 1,42 s em 1,8 MP; a primeira chamada (sem JIT) é a mais lenta. Daí o teto de 1 MP (`MP_DA_BORDA_LIMPA`).
- **Borda pelo código** (sem IA e sem custo): o alfa sai da projeção C = aF + (1 - a)B entre a cor do assunto (F, o miolo perto) e a do fundo naquele ponto (B, a foto original sob a máscara); a cor perde a mistura; máscara macia longe do assunto com a cor do fundo vira fundo; com fundo claro a borda cede 1 px; o transparente em volta recebe a cor da borda (reduzir sem pré-multiplicar não puxa o fundo).
- **Logo e arte chapada** não precisam de IA: fundo liso pela borda (cor e tolerância pelo ruído), vãos fechados da cor do fundo tirados ou mantidos (escolha da equipe) e a mesma projeção na faixa da borda. PNG já transparente com franja: só na janela "Limpar fundo", com prévia (nunca sozinho no Estúdio, no selo ou nas versões da logo). Só sai o anel de até 2 px que contorna 60% ou mais da borda externa das formas vizinhas e é mistura (não branco chapado); a ponta clara da bússola da VIFUT e o anel branco da CME ficam.
- O "Tirar fundo" da Mesa Foto (máscara do gerador alinhada à foto original) passa pela mesma borda (`recorte.ts`). Custo medido de novo em 01/10 (caneca de 1600 x 1120, 8 rodadas por processo, 4 processos, Deno local, com e sem carga na máquina): a mediana do recorte inteiro em regime foi de 0,55 a 0,76 s sem a limpeza para 0,92 a 0,96 s com ela (+0,2 a 0,4 s), e a primeira chamada (sem JIT) foi de 0,93 a 1,17 s para 1,32 a 1,74 s. Por isso a limpeza é pulada quando a CPU do pedido (abrir a foto, a tela, abrir a máscara, alinhar, compor) já passou de 1,2 s (`ORCAMENTO_DA_BORDA_MS`) ou acima de 2 MP: fica a borda da máscara, como antes.
- Medidas da borda (0 a 255; acima de 12 aparece): na caneca, o halo claro caiu de 83 para 11,9, e o escuro subiu de 2,7 para 12,9 (a silhueta real da caneca, mais escura, aparece onde a mistura clara saiu; a cor limpa agora não passa da cor de dentro). As provas acompanham as duas medidas.

Provas com imagens reais (antes x depois, sobre escuro, cor e xadrez, com a medida do halo) na entrega da frente IDR.

## O que o dono precisa fazer

1. Criar a conta em https://fal.ai (login com Google ou GitHub) e pôr crédito em Billing (US$ 10 dá cerca de 120 ampliações fiéis 2x ou 550 recortes).
2. Criar a chave em https://fal.ai/dashboard/keys (escopo API).
3. Guardar a chave como segredo das funções no Supabase com o nome **`FAL_KEY`** (painel: Project Settings > Edge Functions > Secrets; ou `supabase secrets set FAL_KEY=...`). Não colar a chave em arquivo, código nem conversa.
4. Publicar a função `mesa-foto` de novo. Sem a chave, as ações respondem `ferramenta_sem_chave` e a tela mostra "configure FAL_KEY".

## Contrato (função mesa-foto)

- `ferramentas_estimar { client_id, imagem_id }` -> `{ configurada, segredo, provedor, aviso, imagem, saldo_usd, opcoes[], padroes, motores[] }`. Sem custo. Cada opção (`upscale_2x_fiel`, `upscale_4x_fiel`, `upscale_2x_criativo`, `upscale_4x_criativo`, `remover_fundo`) traz `estimativa_usd`, `fator_efetivo`, `saida`, `avisos`, `impedimento` e `ja_existe`.
- `upscale { client_id, imagem_id, fator: 2|4, modo: 'fiel'|'criativo', motor?, conteudo?: 'foto'|'texto'|'arte', refazer? }`
- `remover_fundo { client_id, imagem_id, motor?: 'bria'|'birefnet', refazer? }`
- `ferramenta_retomar { client_id, ficha }`
- Resposta pronta: `{ situacao: 'pronto', imagem (linha do acervo com url), url, custo_usd, saldo_usd, uso_id, cobrado, ja_existia, motor, fator, fator_efetivo, modo, entrada, saida, avisos }`.
- Resposta lenta (passou de 200 s): `{ situacao: 'em_andamento', ficha, andamento, posicao, custo_usd: 0 }`. A tela chama `ferramenta_retomar` com a ficha (assinada no servidor, vale 24 h) e nada é cobrado duas vezes: o id da derivada e a referência do uso são o `request_id` do provedor.
- A derivada entra em `cliente_imagens` com `derivada_de`, `modo` `detalhe` (ampliada) ou `preservar` (sem fundo), tags `upscale` ou `sem_fundo` mais a etiqueta da ferramenta (`upscale:2x:fiel:topaz`, `sem_fundo:bria`), `gerada` só no criativo, `aprovada: false`, pasta "Mesa Foto / Ferramentas". Pedir a mesma ferramenta de novo devolve a derivada existente sem custo (a não ser com `refazer: true`).
- Custo: estimativa antes, `garantirSaldo` antes de enviar e o valor da tabela registrado na carteira do cliente por `registrarUso` do motor (tarefa `estudio`, agente `gerador_imagem`, provedor `fal`, modelo `fal:<id do modelo>`, referência `ferramenta_imagem`). O BiRefNet é cobrado pelo tempo real de GPU quando o provedor informa.
- Erros próprios: `ferramenta_sem_chave`, `ferramenta_chave_recusada`, `provedor_sem_credito`, `provedor_recusou`, `provedor_ocupado`, `imagem_ja_grande`, `imagem_grande_demais`, `imagem_pequena_demais`, `ja_e_recorte`, `ampliacao_nao_aconteceu`, `recorte_sem_transparencia`, `resultado_deformado`, `resultado_grande_demais`, `ficha_invalida`, `ficha_vencida`, `gravacao_falhou` (com ficha para retomar sem nova cobrança).

## Limites

- Entrada: lado menor de pelo menos 64 px; lado maior até 8192 px (Topaz) ou 4096 px (SeedVR2 e Clarity); tirar fundo até 6000 px e 25 MP; arquivo até 30 MB.
- Saída do upscale: até 8192 px no lado maior e 40 MP (JPEG), 24 MP (PNG) ou 16 MP (criativo). O fator é reduzido para caber e a tela avisa; abaixo de 1,2x a ação é recusada (`imagem_ja_grande`).
- Resultado baixado até 45 MB; tipo conferido pelo conteúdo; upscale precisa sair maior e com a mesma proporção; recorte precisa ter canal alfa. Resultado errado não é cobrado nem gravado.
- A função espera até 200 s por chamada (resposta com fôlego); a tela retoma até 3 vezes (cerca de 10 min no total).
- A imagem vai ao provedor por URL assinada do armazenamento (1 h) e o provedor apaga entrada e saída em 1 dia.
- Preços da tabela do código conferidos em 25/09/2026; se a fal.ai mudar, atualizar `MOTORES` em `_shared/ferramentas-imagem.ts`.

## Onde ligar nas telas (outras frentes)

- Componente: `src/components/ferramentas/FerramentasDaImagem.tsx` (`<FerramentasDaImagem clientId imagemId mostrarCriativo aoConcluir />`). API: `src/components/ferramentas/ferramentasApi.ts` (`estimarFerramentas`, `ampliarImagem`, `tirarFundoPro`, `retomarFerramenta`, `ehSemChave`).
- Mesa Foto: no `DetalheDaFoto` de `src/components/mesa-foto/EtapaAcervo.tsx`, abaixo da `FotoInteira`, com `aoConcluir` invalidando `["mesa", "acervo", clientId]` e `chaveDaMesaFoto(clientId)` e abrindo a derivada (`onAbrir(r.imagem.id)`).
- Estúdio: em `src/components/mesa/EstudioFotos.tsx`, `tirarFundo` pode trocar `chamarFuncao("mesa-foto", corpoDoTirarFundo(...))` por `tirarFundoPro({ clientId, imagemId: imagem.id })` e usar `r.imagem.storage_path` em `adicionarRecorte`; o código `ja_e_recorte` continua o mesmo. Para ampliar a foto da lâmina, o mesmo componente no painel da foto escolhida.

## Fontes

- fal.ai, BRIA RMBG 2.0: https://fal.ai/models/fal-ai/bria/background/remove
- fal.ai, BiRefNet v2 (preço e esquema): https://fal.ai/models/fal-ai/birefnet/v2 e https://fal.ai/models/fal-ai/birefnet/v2/llms.txt
- fal.ai, Topaz (faixas de preço e esquema): https://fal.ai/models/fal-ai/topaz/upscale/image e https://fal.ai/models/fal-ai/topaz/upscale/image/llms.txt
- fal.ai, Clarity Upscaler: https://fal.ai/models/fal-ai/clarity-upscaler e https://fal.ai/models/fal-ai/clarity-upscaler/llms.txt
- fal.ai, SeedVR2: https://fal.ai/models/fal-ai/seedvr/upscale/image e https://fal.ai/models/fal-ai/seedvr/upscale/image/api
- fal.ai, Recraft Crisp e Creative: https://fal.ai/models/fal-ai/recraft/upscale/crisp e https://fal.ai/models/fal-ai/recraft/upscale/creative
- fal.ai, Ideogram Upscale: https://fal.ai/models/fal-ai/ideogram/upscale
- fal.ai, ESRGAN: https://fal.ai/models/fal-ai/esrgan
- fal.ai, comparativo de removedores 2026: https://fal.ai/learn/tools/best-background-remover-apis-2026
- fal.ai, comparativo de upscalers: https://fal.ai/learn/tools/image-to-image-upscalers
- fal.ai, fila: https://fal.ai/docs/model-apis/model-endpoints/queue ; retenção: https://fal.ai/docs/documentation/model-apis/media-expiration
- Bria, benchmark do RMBG 2.0: https://blog.bria.ai/benchmarking-blog/brias-new-state-of-the-art-remove-background-2.0-outperforms-the-competition e https://huggingface.co/briaai/RMBG-2.0
- remove.bg, API e preços: https://www.remove.bg/api e https://costbench.com/software/ai-media-apis/remove-bg-api/
- Photoroom, preços da API: https://www.photoroom.com/api/pricing
- Clipdrop, preços: https://clipdrop.co/apis/pricing
- Magnific, API do upscaler: https://docs.magnific.com/api-reference/image-upscaler-creative/image-upscaler e https://www.myarchitectai.com/blog/magnific-ai-pricing
- Recraft, limites da API: https://www.recraft.ai/docs/api-reference/endpoints
- Replicate, super-resolução (Real-ESRGAN, Clarity, Topaz, Recraft): https://replicate.com/collections/super-resolution e https://replicate.com/philz1337x/clarity-upscaler
- Comparativo de SUPIR e outros: https://medium.com/code-canvas/testing-different-upscalers-paid-vs-free-options-1260ab82d403
