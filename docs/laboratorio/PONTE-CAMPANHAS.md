# Ponte Laboratório ↔ Campanhas

25/10/2026. O dono pediu: "o laboratório do canvas sincronize com a área campanhas, lê e vê o funil e tudo e já puxa pra campanha com base naquilo e já monta, e vice-versa: gerou a campanha também gera e aparece no canvas; e atualizações e movimento de ambos os lados já atualiza as duas frentes, sempre melhorando e complementando e nunca substituindo".

## Peças

| Onde | O quê |
|---|---|
| `supabase/migrations/20261025160000_ponte_laboratorio_campanhas.sql` | Ligação (`lab_projetos.campanha_id`), `mesa_campanhas.sincronia`, `ponte_sugestoes`, gatilhos que avisam a ponte (pg_net com segredo no Vault), tempo real das quatro tabelas |
| `supabase/functions/ponte-lab-campanha/modulos/regras.ts` | As regras, puras (a função e as telas importam o mesmo arquivo) |
| `supabase/functions/ponte-lab-campanha/modulos/aplicar.ts` | Banco: ler, gravar, a vez de rodar, sugestões |
| `supabase/functions/ponte-lab-campanha/index.ts` | As ações |
| `src/lib/ponte/ponteApi.ts` | As chamadas das duas telas |

## Como funciona

1. Qualquer mudança na campanha (`mesa_campanhas`, menos a coluna `sincronia`), na série dela (`calendario_propostas.itens`) ou no canvas ligado (`lab_projetos.canvas`) dispara o gatilho, que chama a função `ponte-lab-campanha` (ação `aviso`) na hora.
2. Campanha nova também avisa: a ponte cria o canvas dela ("Campanha · nome"), já com a campanha desenhada.
3. Cada passada roda os dois sentidos, nesta ordem:
   - **Canvas → campanha.** O que a pessoa mudou num nó ligado vai para a campanha. Campo vazio é preenchido. Campo com valor vira **sugestão** para a campanha.
     - Nó de conteúdo sem marca (carrossel, imagem, template designer, filme, UGC, vídeo) vira **peça nova** na série, na fase da coluna em que está.
     - Oferta, público e funil avulsos são adotados.
     - As saídas da oferta, do funil e do anúncio complementam o briefing.
     - Produtos e canais só somam.
   - **Campanha → canvas.** A ponte desenha cliente, marca, produtos, público, oferta, funil (as fases da linha do tempo entram como saída do nó, sem custo), anúncio, uma peça por nó e os stories por fase.
     - Nó novo entra.
     - Nó que a pessoa não mexeu acompanha a campanha.
     - Campo que os dois lados mudaram vira **sugestão** para o canvas.
4. Nada é substituído:
   - Nó da pessoa nunca é apagado.
   - O nó que a pessoa apagou não volta (`sincronia.removidas`).
   - Peça que saiu da campanha fica no canvas marcada (`sinc.fora`).
   - Peça protegida (na agenda ou aprovada) não muda pelo canvas.
5. A passada é idempotente: só grava quando algo muda. O eco de cada escrita (que dispara o gatilho de novo) termina na passada seguinte.
6. Uma passada por campanha de cada vez, pela vez em `sincronia.rodando_ate`. Se o canvas mudou no meio, a ponte relê e refaz uma vez.

## A marca de cada nó

Os nós ligados à campanha levam `dados.sinc`:

```
{ campanha_id, chave, origem: "campanha" | "canvas", hash, base, fora? }
```

`base` é o valor que a campanha tinha em cada campo na última projeção. Com ela a ponte sabe quem mudou:

- o canvas diferente da base: a pessoa mudou;
- a campanha diferente da base: a campanha mudou.

As chaves são `cliente`, `marca`, `produto:<n>`, `oferta`, `publico`, `funil`, `anuncio`, `peca:<tema_id>`, `stories:<etapa>` e `fase:<n>` (grupo quando o canvas passa de 80 nós).

## O caminho de volta (canvas → campanha)

| Nó.campo | Campanha |
|---|---|
| oferta.titulo | nome |
| oferta.instrucao | briefing.oferta |
| oferta.produto / preco | briefing.produtos.0.nome / preco |
| publico.publico | briefing.publico |
| funil.objetivo | objetivo |
| produto:N.nome / preco / link_externo | briefing.produtos.N.* |
| peca:cN.titulo ou tema | itens.cN.tema |
| peca:cN.ideia | itens.cN.gancho |
| saída da oferta: promessa / publico | briefing.mensagem_central / publico |
| saída do funil: resumo | briefing.conducao |
| saída do anúncio: cta | briefing.cta |

## Ações da função

- `aviso { campanha_id, lado, novo }`: só o banco chama, com `x-ponte-segredo`.
- `estado { campanha_id | projeto_id }`.
- `sincronizar { campanha_id }`.
- `abrir_no_lab { campanha_id }`: devolve `{ projeto_id, criado }`.
- `ligar { projeto_id, campanha_id }` e `desligar { projeto_id }`.
- `montar_campanha { projeto_id, confirmado? }`:
  - sem `confirmado`, devolve 409 `confirmar_custo` com `estimativa_usd`;
  - com ele, chama o `agente-calendario campanha_criar` com o JWT de quem pediu e liga o canvas à campanha nova.
- `sugestao_decidir { id, aceitar }`.

As ações de tela pedem equipe (`is_staff`) com acesso ao cliente (`can_access_client`). A função fica com `verify_jwt = false` porque o aviso do banco chega sem JWT.

## Tempo real

`lab_projetos`, `mesa_campanhas`, `calendario_propostas` e `ponte_sugestoes` estão na publicação `supabase_realtime`. Cada tela escuta a linha aberta e relê. O editor do Laboratório mescla os nós da ponte no que está aberto.
