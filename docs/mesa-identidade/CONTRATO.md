# Mesa Identidade Visual: contrato (preparação)

Frente C, 26/09/2026. Pedido do dono: "vamos ter uma Mesa de Identidade Visual, onde vamos criar o brand book. Vamos importar o arquivo, gerado de outro lugar, mas antes a gente prepara tudo com base no contexto dos clientes. É projeto futuro; já dá para preparar a ideia inicial agora."

Este documento fixa o fluxo e o que já existe. A mesa inteira (rota própria, etapas, histórico de versões do brand book) fica para depois; o que está pronto mora na aba Contexto da Mesa do cliente, no hub "Plano do cliente", bloco "Identidade visual".

## Fluxo

1. **Contexto do cliente.** A fonte é o que o painel já tem: kit da marca (`cliente_kit_marca`: paleta, estilo, regras, logos, contexto consolidado com negócio, nicho, estágio, posicionamento, público, oferta, tom), fontes do cliente (`cliente_fontes`), leituras das referências (`cliente_referencias.leitura`) e o que o diretor de arte aprendeu (`agente_memoria`, agente `diretor_arte`). Nada é pedido de novo ao cliente.
2. **Briefing de identidade.** Botão "Preparar identidade visual" (ação `preparar_identidade` da função `agente-contexto`, sem IA). Monta o briefing em Markdown com `briefingDeIdentidade` (`supabase/functions/agente-contexto/modulos/identidade-visual.ts`): essência, público, voz, o que já existe, referências, o que o cliente gosta ou evita, entregáveis do brand book e como devolver. O que falta vira "Perguntas para o dono antes de criar", nunca invenção. O briefing fica guardado em `cliente_kit_marca.contexto.identidade` (`briefing`, `lacunas`, `gerado_em`).
3. **Pacote para o gerador externo.** A mesma ação devolve o pacote (`montarPacoteExterno`, tipo `identidade_visual`, em `supabase/functions/_shared/pacote-externo.ts`): Markdown para colar no ChatGPT ou no Claude e JSON para guardar. O pacote também sai pelo bloco "Pacote para LLM externo" com o tipo Identidade visual.
4. **Geração fora do painel.** A equipe gera o brand book onde quiser (LLM externo, designer, ferramenta de marca). O painel não automatiza login nem conta de terceiros.
5. **Importar o brand book.** Botão "Importar brand book" (PDF e imagens PNG, JPG ou WEBP, até 12 arquivos):
   - a tela guarda os arquivos em `mesa/<cliente>/marca/brandbook/` (bucket `mesa`, política da equipe que já existe), extrai o texto do PDF no navegador (`readFileContext`) e desenha as 4 primeiras páginas em JPEG;
   - a ação `importar_brand_book` faz uma leitura só (modelo de leitura do catálogo, com as imagens reduzidas e o texto do PDF) no esquema `ESQUEMA_DO_BRAND_BOOK`: paleta, tipografia, quais imagens são logo, estilo, regras, tom e observações;
   - `propostaDoKitPeloBrandBook` transforma a leitura em uma proposta no contrato comum (`_shared/acoes-do-agente.ts`), guardada como mensagem do agente de contexto, com o cartão Confirmar ou Cancelar.
6. **Kit atualizado pelo brand book.** Só a confirmação grava, item a item (`agente-contexto/executor-do-plano.ts`):
   - `kit_paleta`: 2 a 8 cores com hex válido, sem repetir;
   - `kit_tipografia`: nomes de título e texto em `contexto.tipografia` (a fonte com arquivo continua na parte Fontes; se a família estiver na biblioteca da agência, a equipe escolhe lá);
   - `kit_logo` (principal e alternativa): só imagem enviada como PNG, JPG ou WEBP de dentro da pasta do brand book deste cliente, até 16 MP; página inteira do PDF não vira logo;
   - `kit_estilo` e `kit_regras`.
   Cada item guarda o valor de antes e o Desfazer volta. O registro do import fica em `contexto.identidade.brand_book` (arquivos, data, observações).

## Regras que não mudam

- Nada muda no kit sem a confirmação da equipe.
- Nenhum pacote leva senha, token, chave, cofre, e-mail pessoal, CPF, CNPJ ou cartão (três camadas em `pacote-externo.ts`, testadas em `src/test/agente-do-cliente.test.ts`).
- Google Meu Negócio segue o mesmo caminho: tarefa do plano com pacote externo pronto (dados de cadastro); o cadastro é feito com o dono, na conta dele.
- Texto de interface sem travessão; fotos nunca escurecidas.

## O que falta para a mesa inteira (futuro)

- Rota própria da Mesa Identidade Visual no esqueleto das mesas (App.tsx, `MESAS_DO_PAINEL`, troca de mesas, seletor de clientes com valor próprio em `clientesDaMesa.ts` e no check do banco).
- Versões do brand book (hoje só o último import fica registrado; os arquivos antigos continuam na pasta).
- Leitura de mais de 4 páginas do PDF e das logos em SVG.
- Fonte com arquivo vinda do brand book (hoje entra o nome; o arquivo vai pela parte Fontes).

## A mesa inteira (frente IDV, 30/09/2026)

Rota `/mesa-identidade` (admin, gestor e design), função `mesa-identidade`, migration `20260930060000_mesa_identidade.sql`.

- **Etapas em sequência** (`_shared/identidade-etapas.ts`): Início (marca do zero ou rebranding), Briefing, Pesquisa, Naming (do zero, ou rebranding com troca de nome), Conceito, Sistema, Mockups, Guideline, Entrega. A próxima abre quando a de antes fecha; concluir exige o mínimo da etapa.
- **Tudo por marca**: `idv_projetos`, `idv_naming_rodadas` e `idv_brandbooks` levam `marca_id` (nulo = principal). RLS: equipe lê com `can_access_client`; só a função grava.
- **Naming** (`_shared/naming.ts`): técnicas, domínio pelo RDAP público (registro.br e Verisign), @ e INPI a conferir com link pronto, ranking do Jev (Score), 3 a 5 finalistas, PDF para aprovação no painel e mensagem pronta para o grupo (o Hermes envia; o painel registra). Também na Mesa → Campanhas.
- **Logo pelo código**: a logo final é o arquivo da equipe (SVG ou PNG, com prévia PNG feita no navegador); a imagem de IA do conceito é só inspiração. Vetorizar PNG no painel ainda não existe (sem biblioteca leve).
- **Brandbook como dado** (`_shared/brandbook.ts`): prancha-resumo vertical ou 24 páginas; JSON versionado (uma linha por versão). CMYK por perfil de papel revestido (`_shared/cores-da-marca.ts`). PDF próprio (`_shared/pdf-identidade.ts`), página pública `/marca/:token` (RPC `idv_brandbook_publico`, revogável) e pacote .zip (logos, cores e fontes).
- **Kit da marca**: o aprovado vira sugestão com Confirmar e Desfazer (`kit_sugerir`).
- **Ganchos**: conselho de agentes (`mesa-identidade/conselho-gancho.ts`, hoje o Jev recomenda como aviso), documento de entrega (`idv_eventos`) e estúdio de mockups da frente MCK (`EstudioDeMockups.tsx`).

## A evolução (frente IDV2, 30/09/2026)

Migration `20260930150000_mesa_identidade_v2.sql` (etapas e eventos novos, votação dos nomes).

- **Etapas**: Início, Briefing, Pesquisa (com moodboard), **Estratégia**, Naming, Conceito, Sistema, **Aplicações** (o valor segue `mockups`), Guideline, **Apresentação** e Entrega. Projeto antigo que já fechou uma etapa depois de uma nova conta a nova como feita (`ETAPAS_NOVAS`).
- **Estratégia** (`_shared/estrategia-de-marca.ts`): propósito, missão, visão, valores, os 12 arquétipos (principal, apoio e justificativa), personalidade em 6 eixos, posicionamento (frase no molde clássico), proposta de valor, público e persona, tom com "fala assim / não fala assim" e exemplos. `estrategia_propor` traz a proposta inteira (não grava; a tela mostra antes x depois e aplica tudo ou campo a campo, com Desfazer).
- **Preencher com IA** (peça comum da frente PIA) em todo campo e seção: briefing, estratégia, pesquisa, conceito, sistema (significado do logo e fotografia), naming (critérios e pedido), guideline (conteúdo), aplicações (contato) e apresentação (falas). O projeto vai no `contexto` (`contextoParaPreencher`).
- **Modelo na hora**: `SeletorDoModelo` (padrão do papel, trocável por qualquer modelo de texto do catálogo) em toda ação de IA da mesa; o custo sai do modelo escolhido.
- **Naming**: 16 técnicas; teste de pronúncia e sentido em 5 idiomas (`naming_idiomas`: o modelo descreve, o Jev Noul avalia o risco, só aviso); links do @ em 4 redes e do INPI; votação da equipe (`naming_votar`) e do cliente por link `/nomes/:token` (RPCs `idv_naming_votacao_publica` e `idv_naming_votar_publico`); slogans e taglines (`slogans_gerar`, ranking do Jev por Score, `slogan_escolher`).
- **Sistema**: gerador de paleta por harmonia (6), neutras tingidas, escala de apoio e contraste WCAG (`_shared/paleta-da-marca.ts`); 3 paletas do diretor (`paletas_propor`); pares do Google Fonts por personalidade com prévia carregada sob demanda (`_shared/tipografia-da-marca.ts`, `src/lib/identidade/fontesGoogle.ts`) e pares do diretor (`fontes_propor`); padrões em SVG por código (`_shared/grafismos-da-marca.ts`).
- **Aplicações**: peças de redes e papelaria e assinatura de e-mail em HTML por código (`_shared/aplicacoes-da-marca.ts`); o estúdio de mockups abre com as cores, as logos e a tipografia do projeto e lembra onde parou em cada projeto.
- **Apresentação** (`_shared/apresentacao-da-marca.ts`): 19 slides do desafio à revelação, com o que falta e a fala; tela cheia e página web exportada.
- **Brandbook**: 5 modelos visuais (`tema`), estratégia no rascunho, página web (HTML que abre sem o painel) e pacote completo (logos, cores, fontes, grafismos com SVG, peças, estratégia em texto, PDF e a página web).
- **Diretor de marca**: `montar_estrategia`, `propor_paletas`, `sugerir_fontes` e `gerar_taglines`, sempre com Confirmar, custo no cartão e Desfazer.

## Completar marca existente (frente IDV3, 30/09/2026)

Pedido do dono: "na identidade visual, também criar o material completo usando tudo para marcas existentes que só têm logo e nome, e deixar completa e profissional". Adendo: "o Motion também se complementa no final da identidade visual, onde ele também gera os vídeos da marca e a apresentação". Migration `20260930200000_mesa_identidade_completar.sql` (modo `completar` e eventos `marca_completada` e `video_da_marca`).

- **Modo novo** "Completar marca existente" no Início, ao lado de marca do zero e rebranding. Entrada mínima: a logo (arquivo real do kit da marca aberta ou enviado) e o nome. Etapas sem Pesquisa, Naming e Conceito; o slide do conceito usa o significado da logo.
- **Leitura da logo** (`_shared/leitura-da-logo.ts`, puro e testado): fundo, caixa, orientação, cores com a parte de cada uma e se o símbolo se separa do nome, tudo por código nos pixels (`src/lib/identidade/versoesDaLogo.ts` desenha no canvas). Forma, estilo, tipo e a letra por visão (`logo_ler`, modelo escolhido na hora; padrão de leitura), com famílias do Google Fonts parecidas conferidas no catálogo: é sugestão, não a fonte original.
- **Versões por código**: monocromática e negativa (PNG; do SVG original também sai o SVG recolorido), sem fundo (quando o fundo é liso) e o recorte do símbolo (quando separável). Horizontal e vertical, símbolo colado no nome, fundo com foto e vetor a partir de PNG vão para "precisa de designer", com o motivo. A logo nunca é redesenhada.
- **Completar tudo** (`_shared/completar-marca.ts` e `src/components/mesa-identidade/rodadaDoCompletar.ts`): plano de 13 passos com o custo total antes e Confirmar numa janela central; roda em passos com andamento e Parar (vale depois do passo atual); cada passo usa a ação da mesa (`estrategia_propor`, `brandbook_montar`, `logo_ler`), o Preencher com IA (`preencher-ia`) ou conta por código (paleta da logo com apoio, neutras e contraste WCAG; tipografia pela leitura; padrões SVG com as formas e o próprio símbolo; peças; mockups sugeridos pelo Jev). Só preenche o que está vazio, o que não tem base vira pergunta (`dados.completar.perguntas`), e cada passo guarda o que o Desfazer precisa (`dados.completar.execucao`).
- **Checklist de completude** no Início (18 itens), cada item com "Completar" do passo que falta, e a leitura da logo à vista.
- **Resultado**: pacote .zip com LEIA-PRIMEIRO (logos em todas as versões, cores em HEX, RGB e CMYK, fontes, grafismos, peças, mockups, vídeos, PDF e a página web com os vídeos), envio para aprovação (PDF e vídeos em Arquivos com a revisão da agência) e o kit da marca depois da aprovação, com Confirmar.
- **Vídeo da marca** (`_shared/motion-da-identidade.ts`): `filme_criar` e `filme_salvar` da Mesa Motion com a entrevista tirada da estratégia (pula a etapa), o BRAND.md por código, as cenas do kit a partir dos slides (logo sting, abertura, valores, paleta, tipografia, aplicações, cartão final) e `insumos.identidade` (paleta, fontes e logo do projeto, que a Mesa Motion usa no lugar do kit). O filme cinematográfico, se pedido, sai com os 3 storyboards (IA, custo antes). `video_registrar` confere o filme no banco. Render pela fila (cena_pedir, montar, entregar); o vídeo pronto entra no pacote e na aprovação.
- **Diretor de marca**: ação `completar_marca` (Confirmar e custo no cartão): lê a logo por visão e monta a estratégia na função; os passos por código ficam pendentes e a mesa retoma sem custo (`&completar=1`).
