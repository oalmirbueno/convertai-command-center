# Mesa Identidade Visual: contrato (preparação)

Frente C, 26/09/2026. Pedido do dono: "vamos ter uma Mesa de Identidade Visual, onde vamos criar o brand book. Vamos importar o arquivo, gerado de outro lugar, mas antes a gente prepara tudo com base no contexto dos clientes. É projeto futuro; já dá para preparar a ideia inicial agora."

Este documento fixa o fluxo e o que já existe. A mesa inteira (rota própria, etapas, histórico de versões do brand book) fica para depois; o que está pronto mora na aba Contexto da Mesa do cliente, no hub "Plano do cliente", bloco "Identidade visual".

## Fluxo

1. **Contexto do cliente.** A fonte é o que o painel já tem: kit da marca (`cliente_kit_marca`: paleta, estilo, regras, logos, contexto consolidado com negócio, nicho, estágio, posicionamento, público, oferta, tom), fontes do cliente (`cliente_fontes`), leituras das referências (`cliente_referencias.leitura`) e o que o diretor de arte aprendeu (`agente_memoria`, agente `diretor_arte`). Nada é pedido de novo ao cliente.
2. **Briefing de identidade.** Botão "Preparar identidade visual" (ação `preparar_identidade` da função `agente-contexto`, sem IA). Monta o briefing em Markdown com `briefingDeIdentidade` (`supabase/functions/_shared/identidade-visual.ts`): essência, público, voz, o que já existe, referências, o que o cliente gosta ou evita, entregáveis do brand book e como devolver. O que falta vira "Perguntas para o dono antes de criar", nunca invenção. O briefing fica guardado em `cliente_kit_marca.contexto.identidade` (`briefing`, `lacunas`, `gerado_em`).
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
