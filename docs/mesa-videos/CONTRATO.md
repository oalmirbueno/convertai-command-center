# Mesa Vídeos: contrato (preparação, sem construir)

Data: 2026-09-25. Pedido do dono: "Vamos criar a Mesa Vídeos; o Canvas também pode ser sincronizado com os vídeos, o mesmo Canvas com opções a mais na área do vídeo. Na Mesa Vídeos a gente pode usar todas as fotos: não puxa artes e carrosséis, mas puxa fotos de personagens e toda a base de produtos, para gerar UGC, histórias, narrativas."

Nada da Mesa Vídeos foi construído. Este contrato diz o que ela lê e o que já está reservado. Pesquisa em `docs/mesa-foto/cenas/PESQUISA.md`. Os repositórios de vídeo que o dono vai mandar entram depois e não mudam este contrato; se algum pedir campo novo, ele vai dentro de `animacao`.

## 1. O mesmo Canvas

- A Mesa Vídeos abre **o mesmo canvas** (`foto_canvas`, mesmo id, mesmos nós, ligações, versão e trava otimista `versao_esperada`). Não há cópia nem sincronização: é o mesmo registro.
- Os nós e as ligações são os da Mesa Foto (`supabase/functions/mesa-foto/canvas-regras.ts`): `produto`, `modelo` (Pessoa), `ambiente`, `estilo`, `prompt`, `agente`, `saida` (Resultado). A ligação de Resultado para Resultado leva `papel` (`personagem | produto | cenario | estilo`) e `imagem_id` (foto escolhida ou `null`).
- **Cena** = nó `saida` com `dados.cena` preenchido:

```ts
dados.cena = {
  ordem: number,            // posição gravada; a posição real sai da ordenação abaixo
  titulo: string | null,
  acao: string | null,      // o que acontece, numa frase
  enquadramento: "livre" | "plano_geral" | "plano_americano" | "plano_medio" | "close" | "detalhe" | "sobre_o_ombro" | "pov",
  cenario: string | null,
  narrativa: string | null, // texto da história nesta cena (locução ou legenda na Mesa Vídeos)
  seed: number | null,
  imagem_id: string | null, // foto da cena (1º quadro); null = a mais nova aprovada, senão a mais nova
  animacao: AnimacaoDaCena | null, // RESERVADO para a Mesa Vídeos
}
```

- **História** = as cenas do canvas ordenadas por `cena.ordem`, depois `y`, `x` e `id` (funções `historiaDoCanvas` na função e `cenasDaHistoria` na tela; as duas dão a mesma ordem e o número 1, 2, 3 sem buraco). Metadados em `foto_canvas.historia = { sinopse, formato, animacao: null }` (coluna do SQL V-01; sem ela, a sinopse fica só na tela).
- Pacote pronto para ler (tela, sem IA): `pacoteDaHistoria(canvas)` em `src/components/mesa-foto/canvas/historia.ts` devolve `{ canvas_id, client_id, nome, sinopse, formato, cenas: [{ numero, no_id, titulo, acao, enquadramento, cenario, narrativa, imagem_id, storage_bucket, storage_path, personagens[], produtos[], animacao }], sem_foto }`.
- Leitura pelo banco (SQL V-01): view `foto_cenas_da_historia` (security_invoker, RLS de `foto_canvas`) com uma linha por cena e o número na ordem.

## 2. Animação reservada (em breve)

```ts
type AnimacaoDaCena = {
  duracao_s: number | null,      // por cena; o motor limita (Veo 4/6/8 s, Seedance 4 a 15 s, Kling até 15 s)
  movimento: string | null,      // câmera: travelling, pan, órbita, zoom, câmera na mão...
  ultimo_quadro_id: string | null, // opcional: último quadro (emenda com a próxima cena)
  audio: { fala: string | null, trilha: string | null, efeitos: string | null } | null,
  motor_video: string | null,    // id do catálogo ia_modelos quando existir
  status: "em_breve",            // até a Mesa Vídeos existir, nada gera vídeo
}
```

- A função já guarda esse objeto só com estes campos (`lerAnimacao`), sem gerar nada. A tela mostra "Vídeo da cena (Mesa Vídeos, em breve)" com os nós abaixo desligados.
- A foto da cena é o 1º quadro. A próxima cena pode usar `ultimo_quadro_id` da anterior como 1º quadro dela (emenda).

## 3. Nós extras de vídeo (em breve, não existem no tipo de nó)

| Nó | O que faz | Dados previstos |
| --- | --- | --- |
| Animar cena | Liga numa cena e anima a foto dela | grava em `dados.cena.animacao` da cena ligada |
| Duração | Segundos da cena | `animacao.duracao_s` |
| Câmera | Movimento de câmera | `animacao.movimento` |
| Áudio | Fala, trilha e efeitos | `animacao.audio` |

Estão em `NOS_DE_VIDEO_EM_BREVE` (`src/components/mesa-foto/canvasApi.ts`) e aparecem desligados na cena e na História. Não entram em `TIPOS_DE_NO` da função até existir código: canvas com esses cartões seria recusado. Ações previstas (sem código): `video_cena_gerar { canvas_id, no_saida_id }` -> `{ job_id }` e `video_cena_status { job_id }`, uma cena por chamada, custo à vista antes, sem laço de correção.

## 4. Acervo da Mesa Vídeos

Regra única, igual na tela e na função: `grupoNaMesaDeVideos` (`canvas/historia.ts` e `canvas-regras.ts`).

| Entra | Como reconhece |
| --- | --- |
| Cena | etiqueta `cena` ou `cena:<no_id>` (toda foto gerada num Resultado marcado como cena; também `historia:<canvas_id>`) |
| Clone e pessoa real autorizada | `modo = 'clone'`, etiqueta `clone:<id>` ou `pessoa_real_autorizada` |
| Personagem | etiqueta `personagem:<id>`, `persona:<id>` ou `pessoa_sintetica` |
| Produto | `kit_id` preenchido ou categoria `produto`, `detalhe`, `embalagem` |

| Fica fora | Por quê |
| --- | --- |
| categoria `arte`, `logo`, `antes_depois` | pedido do dono (não puxa artes) |
| etiqueta `carrossel` ou `arte` | pedido do dono (não puxa carrosséis) |
| pessoa sem autorização e arquivo sem grupo | regra da casa (pessoa real só com autorização) |
| foto inativa | fora do acervo |

`acervoDaMesaDeVideos(fotos)` devolve `{ cena, personagem, clone, produto }`.

## 5. Personagens

- Personagem = `foto_modelos` com `origem = 'personagem'` (SQL V-01) ou `origem = 'sintetica'` com a marca "Personagem do Canvas" no início de `ficha.notas` (sem o SQL). Âncora = cópia da foto da cena; folha pelas vistas (`modelo_vista_gerar`, mesmo motor da âncora).
- Clone de pessoa real continua em `foto_modelos` com `origem = 'clone_de_foto_real'` e o pacote `clone_pacote` (docs/mesa-foto/CLONES.md).
- Para vídeo, a identidade vai como no Kling Elements, Veo Ingredients ou Seedance @Image: âncora + 2 a 3 vistas aprovadas, no máximo 3 a 4 referências por clipe.

## 6. Regras que valem na Mesa Vídeos

- Custo sempre à vista antes de gerar (BotaoComCusto); uma geração por chamada.
- Sem laço de correção: o que falha fica escrito; tentar de novo é da equipe.
- Nunca trocar o motor que o dono escolheu; a rota (OpenRouter ou outra) é só caminho.
- Tudo o que sai é gerado e entra no acervo marcado como gerado; pessoa sintética pede o rótulo de IA ao publicar.
- Pessoa real só com autorização registrada; nunca menor, nunca semelhança com pessoa pública.
