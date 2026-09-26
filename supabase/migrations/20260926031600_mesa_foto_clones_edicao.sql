-- Frente Z (25/09 à noite): Clones editáveis depois de criados (fotos de origem, apagar com desfazer, duplicar).
-- Só amplia e é idempotente. NÃO aplicado. A função mesa-foto já funciona sem isto (degradado):
--   * vista apagada: marca "arquivada_em:<data>" em foto_modelo_imagens.avisos (lida junto com a coluna nova);
--   * clone apagado: status 'arquivada' (já existia); quando/quem só ficam gravados com as colunas abaixo;
--   * "feita com as fotos antigas": calculada pelas fontes da vista e pela data em que cada foto entrou
--     (identidade_real[].adicionada_em, jsonb que já existe), sem coluna nova.
-- RLS: nenhuma tabela nova; as colunas herdam as políticas atuais (equipe lê via is_staff + can_access_client,
-- só service_role escreve pela função).

alter table public.foto_modelos add column if not exists arquivado_em timestamptz;
alter table public.foto_modelos add column if not exists arquivado_por uuid;
alter table public.foto_modelo_imagens add column if not exists arquivada_em timestamptz;

comment on column public.foto_modelos.arquivado_em is 'Clone apagado (arquivado) em; restaurar limpa. Nada é excluído de vez.';
comment on column public.foto_modelos.arquivado_por is 'Quem apagou (arquivou) o clone.';
comment on column public.foto_modelo_imagens.arquivada_em is 'Vista apagada (arquivada) em; fora do status e da identidade; restaurar limpa.';

-- Traz para a coluna o que a função marcou em avisos antes do SQL.
update public.foto_modelo_imagens i
   set arquivada_em = m.quando
  from (
    select x.id, max(substring(a from '^arquivada_em:(.+)$'))::timestamptz as quando
      from public.foto_modelo_imagens x, unnest(x.avisos) as a
     where a like 'arquivada_em:%'
     group by x.id
  ) m
 where i.id = m.id
   and i.arquivada_em is null;

-- Clones já arquivados antes do SQL: a última atualização serve de data.
update public.foto_modelos
   set arquivado_em = atualizado_em
 where origem = 'clone_de_foto_real'
   and status = 'arquivada'
   and arquivado_em is null;

create index if not exists foto_modelos_clones_status_idx
  on public.foto_modelos (client_id, status)
  where origem = 'clone_de_foto_real';

create index if not exists foto_modelo_imagens_arquivadas_idx
  on public.foto_modelo_imagens (modelo_id)
  where arquivada_em is not null;

-- Conferência (só leitura):
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name in ('foto_modelos', 'foto_modelo_imagens')
--    and column_name in ('arquivado_em', 'arquivado_por', 'arquivada_em');
