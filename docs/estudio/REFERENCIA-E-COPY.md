# Referência e copy (frente R, 26/09/2026)

Pedido do dono: da referência vem o ESTILO (estratégia, layout, estética); a
imagem é montada com o CONTEXTO DA COPY e do roteiro da lâmina e com o design
do cliente. A imagem reforça a mensagem do texto. É complemento: o que já
funciona não muda.

## Como funciona (modo replicar referência, só no Estúdio)

1. **Leitura** (uma vez por referência, guardada em
   `<cliente>/estudio/leituras/conteudo-<ref>.json`, modelo de leitura do
   catálogo): ESTÉTICA (layout, tipografia, cores, luz, tratamento,
   composição, enquadramento, elementos, gancho) separada do CONTEÚDO
   (assunto, objetos, pessoas, cenário, texto escrito e sentido). O molde
   (layout medido) continua o mesmo arquivo de antes.
2. **Julgamento** (Jev, `_shared/jev.ts`): Noul "o assunto da referência serve
   para transmitir esta lâmina?" e Choice do que aproveitar (`tudo`,
   `estetica_e_tipo_de_cena`, `so_estetica`). Estado em campos nomeados:
   `lamina` (copy, função, posição), `post` (conceito, roteiro, ideia do
   diretor), `cliente` (negócio, público, oferta) e `referencia` (conteúdo).
   **Limiar: serve com 0,75 ou mais.** Abaixo disso adapta; na dúvida (meio)
   adapta com a troca conservadora (mesmo tipo de cena). O gasto vai à
   carteira por `cobrarJev`.
3. **Cena** (só quando não serve): o diretor de arte (modelo padrão
   `diretor_arte`) escreve UMA cena que transmite a copy, na mesma composição.
   Ela entra num bloco curto logo depois do `promptDoReplicar`:
   `ADAPTAR O CONTEÚDO À MENSAGEM`. Idêntica: composição quase exata com o
   assunto trocado. Próxima: composição parecida. Inspirada e Criativa: só
   reforça que a imagem transmite a copy.
4. **Guardado**: julgamento e cena ficam em `adapta-<ref>-<chave>.json`
   (chave do texto da lâmina). Refazer a lâmina com o mesmo texto não paga de
   novo. Sem laço de correção: uma leitura, um julgamento, uma cena.

**Fica igual a hoje, byte a byte** (fixture `replicar-identica-hoje.json`):
conteúdo que serve, lâmina sem copy, lâmina com foto do cliente (o assunto já
é dela), interruptor desligado, criativo de anúncio (Mesa Ads) e qualquer
falha da leitura, do Jev ou do diretor. Fixture do caminho adaptado:
`src/test/fixtures/replicar-adaptado.json`.

## Trava da marca (regra dura do dono)

Letra, cores (na função que a referência dá) e logo são sempre os do kit. A
cena passa por `neutralizarMarcaDaReferencia` (`_shared/trava-da-marca.ts`,
da frente T) antes de ir ao gerador, e o diretor nem recebe a tipografia e as
cores da referência.

Cor dos elementos gráficos: o molde guarda a cor da referência sempre como
hex, e `corDaMarcaNoPapel` sempre acha par quando o kit tem ao menos uma cor
válida (neutro vai ao neutro mais perto em luminância; colorida vai ao
destaque do kit, senão à primeira colorida). O fallback `|| x.cor` só dispara
com o kit SEM nenhuma cor (fixture aprovado `post 1:1 sem paleta`). Decisão
do dono (26/09): fica como está, porque não há cor do cliente para usar; um
teste trava esse comportamento. A tela avisa "Cliente sem cores no kit:
usando as da referência." com o link para o Contexto
(`EstudioAvisoSemFonte.tsx`, export `EstudioAvisoDoKit`).

Kit sem fonte: continua como hoje (o `promptDoReplicar` usa o desenho da
letra da referência, porque não há fonte do cliente). A tela da referência
mostra "Cliente sem fonte no kit: usando a da referência." com o link
"Definir fonte" para o Contexto, onde "Sugerir automaticamente"
(`agente-contexto`, ação `fontes_da_biblioteca`, escolha pelo Jev) sugere o
par de fontes (`src/components/mesa/ContextoCartaoMarca.tsx`).

## Rosto escolhido (acréscimo do dono)

Seletor **Rosto** (Nenhum, Cliente, Equipe, Fotos), por trabalho
(`direcao.rosto`):

- Cliente: rostos autorizados do Contexto (`cliente_rostos`, ativos) e clones
  da Mesa Foto (`foto_modelos`, origem `clone_de_foto_real`, autorização
  válida; fotos reais de `identidade_real`, a principal primeiro).
- Equipe: os mesmos, das empresas internas
  (`profiles.services_config.internal_company`).
- Fotos: até 2 enviadas na hora (`<cliente>/estudio/rostos/`), com a
  confirmação de autorização.

Até 2 fotos entram depois dos anexos da lâmina e antes das do estilo do
cliente, no limite de imagens do modelo, com a legenda "identidade do rosto:
manter os traços; não copiar pose, fundo, roupa nem luz". O bloco
`ROSTO ESCOLHIDO` vem logo depois do bloco da copy: identidade muito fiel,
pose e enquadramento da arte, no lugar da pessoa da referência. "Destacar o
rosto" põe o rosto como ponto focal. Rosto escolhido que sumiu ou perdeu a
autorização: a geração recusa com aviso (409 `rosto_indisponivel`). Sem rosto:
nada é lido e nada muda.

Fora por agora: a conferência de identidade depois de gerar (o Jev não vê
imagem; precisaria de leitura por visão dos dois rostos, como a conferência
dos clones). Se entrar, só como aviso.

## Onde está

| Peça | Arquivo |
| --- | --- |
| Leitura, Jev, cena e bloco | `supabase/functions/estudio-arte/referencia-adapta-copy.ts` |
| Rosto (normalização, vagas, bloco) | `supabase/functions/estudio-arte/rosto-na-geracao.ts` |
| Ligação, `configurar` e ação `rostos` | `supabase/functions/estudio-arte/index.ts` |
| Tela | `src/components/mesa/EstudioAdaptarConteudo.tsx`, `EstudioRostoDaReferencia.tsx` (em `ReferenciasDoEstudio.tsx`) |
| Testes | `src/test/referencia-adapta-copy.test.ts`, `src/test/referencia-rosto.test.ts` |
| Registro | `_shared/motores.ts` (`referencia_adapta_copy`, `rosto_na_referencia`) |
