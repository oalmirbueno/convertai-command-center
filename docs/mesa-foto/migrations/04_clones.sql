-- ═══════════════════════════════════════════════════════════════════════
-- MESA FOTO: área "Clones" (pessoa REAL do cliente, com autorização) e
-- "Tirar fundo" marcado no acervo (docs/mesa-foto/CLONES.md).
--
-- NÃO APLICADA. Aplicar só com o ok do dono, validando antes com
-- begin; ... rollback; no SQL Editor (regra da casa: migration em arquivo não
-- chega ao banco sozinha).
--
-- 1) foto_modelos ganha origem ('sintetica' | 'clone_de_foto_real'),
--    autorizacao (termo de uso de imagem da pessoa retratada) e
--    identidade_real (1 a 4 fotos reais do acervo). As checagens de ficha e
--    ética passam a valer por origem: persona sintética continua sintética,
--    adulta (21+) e sem semelhança; clone é pessoa real, adulta (18+),
--    autorizada, sempre de um cliente (nunca da biblioteca da agência).
-- 2) cliente_imagens.modo aceita também 'clone' (variações do clone no acervo).
--
-- Idempotente. As personas que já existem ficam com origem 'sintetica'.
-- Escrita só pela função mesa-foto (chave de serviço); leitura pela equipe
-- pelas políticas que a migration 03 já criou.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Clones em foto_modelos ────────────────────────────────────────

ALTER TABLE public.foto_modelos ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'sintetica';
ALTER TABLE public.foto_modelos ADD COLUMN IF NOT EXISTS autorizacao jsonb;
ALTER TABLE public.foto_modelos ADD COLUMN IF NOT EXISTS identidade_real jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.foto_modelos.origem IS
  'sintetica = persona gerada (aba Modelos); clone_de_foto_real = pessoa real do cliente recriada por IA com autorização (aba Clones).';
COMMENT ON COLUMN public.foto_modelos.autorizacao IS
  'Clone: { confirmada, quem, data, forma (termo_assinado|contrato|email|mensagem|outro), finalidade, escopo, validade, observacao, sabe_que_e_ia, adulta, registrada_por, registrada_em, revogada_em, revogada_por }.';
COMMENT ON COLUMN public.foto_modelos.identidade_real IS
  'Clone: [{ imagem_id (cliente_imagens, foto real, nunca gerada), client_id, principal }], de 1 a 4.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'foto_modelos_origem_valida') THEN
    ALTER TABLE public.foto_modelos
      ADD CONSTRAINT foto_modelos_origem_valida CHECK (origem IN ('sintetica', 'clone_de_foto_real'));
  END IF;
END $$;

-- Ficha: idade mínima por origem (a checagem antiga exigia 21 para todas).
ALTER TABLE public.foto_modelos DROP CONSTRAINT IF EXISTS foto_modelos_ficha_check;
ALTER TABLE public.foto_modelos DROP CONSTRAINT IF EXISTS foto_modelos_ficha_valida;
ALTER TABLE public.foto_modelos
  ADD CONSTRAINT foto_modelos_ficha_valida CHECK (
    jsonb_typeof(ficha) = 'object'
    AND jsonb_typeof(ficha -> 'idade_aparente') = 'number'
    AND (
      (origem = 'clone_de_foto_real' AND (ficha ->> 'idade_aparente')::numeric >= 18)
      OR (ficha ->> 'idade_aparente')::numeric >= 21
    )
  );

-- Ética: sintética (sintetica, adulta, sem_semelhanca) ou clone (clone_de_pessoa_real, adulta, autorizada).
ALTER TABLE public.foto_modelos DROP CONSTRAINT IF EXISTS foto_modelos_etica_check;
ALTER TABLE public.foto_modelos DROP CONSTRAINT IF EXISTS foto_modelos_etica_valida;
ALTER TABLE public.foto_modelos
  ADD CONSTRAINT foto_modelos_etica_valida CHECK (
    jsonb_typeof(etica) = 'object'
    AND (etica ->> 'adulta') = 'true'
    AND (
      (origem = 'sintetica' AND (etica ->> 'sintetica') = 'true' AND (etica ->> 'sem_semelhanca') = 'true')
      OR (origem = 'clone_de_foto_real' AND (etica ->> 'clone_de_pessoa_real') = 'true' AND (etica ->> 'autorizada') = 'true')
    )
  );

-- Clone: sempre de um cliente, com autorização confirmada e de 1 a 4 fotos reais.
ALTER TABLE public.foto_modelos DROP CONSTRAINT IF EXISTS foto_modelos_clone_autorizado;
ALTER TABLE public.foto_modelos
  ADD CONSTRAINT foto_modelos_clone_autorizado CHECK (
    jsonb_typeof(identidade_real) = 'array'
    AND (
      origem <> 'clone_de_foto_real'
      OR (
        client_id IS NOT NULL
        AND jsonb_typeof(autorizacao) = 'object'
        AND (autorizacao ->> 'confirmada') = 'true'
        AND jsonb_array_length(identidade_real) BETWEEN 1 AND 4
      )
    )
  );

CREATE INDEX IF NOT EXISTS foto_modelos_origem_idx ON public.foto_modelos (client_id, origem, atualizado_em DESC);

-- ─── 2) Acervo: modo 'clone' ──────────────────────────────────────────

ALTER TABLE public.cliente_imagens DROP CONSTRAINT IF EXISTS cliente_imagens_modo_check;
ALTER TABLE public.cliente_imagens
  ADD CONSTRAINT cliente_imagens_modo_check
  CHECK (modo IS NULL OR modo IN ('preservar', 'luz_cor', 'cenario', 'angulo', 'ensaio', 'canvas', 'detalhe', 'clone'));

-- Conferência (rodar depois de aplicar):
-- select origem, count(*) from public.foto_modelos group by origem;
-- select conname from pg_constraint where conname in ('foto_modelos_origem_valida', 'foto_modelos_ficha_valida', 'foto_modelos_etica_valida', 'foto_modelos_clone_autorizado', 'cliente_imagens_modo_check');
-- Deve falhar (clone sem autorização):
-- begin; insert into public.foto_modelos (client_id, nome, ficha, etica, origem) select id, 'x', '{"idade_aparente": 30}', '{"adulta": true, "clone_de_pessoa_real": true, "autorizada": true}', 'clone_de_foto_real' from public.profiles limit 1; rollback;
