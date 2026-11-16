-- 16/11/2026: arquivar e desarquivar campanha na aba Campanhas do Mês.
--
-- O que esta migration faz:
--
-- A) mesa_campanhas ganha duas colunas opcionais:
--    - arquivada_em timestamptz: quando a campanha foi arquivada (null = ativa);
--    - arquivada_por uuid: quem arquivou (profiles.id; some se o perfil sair).
--    O status (planejada, gravada, encerrada) fica intocado: desarquivar volta
--    a campanha ao estado que ela tinha.
--
-- B) Índice parcial em (client_id) só das não arquivadas, para a lista padrão
--    da Mesa, do MCP e o panorama.
--
-- O que esta migration NÃO faz: não muda status, período, briefing nem
-- nenhuma linha existente (todas nascem com arquivada_em null), não cria
-- política de RLS nem GRANT novo (authenticated já lê a tabela inteira; a
-- escrita das colunas novas é só pelo agente-calendario com a chave de
-- serviço), não apaga nada.
--
-- Migration nova e aditiva. Rollback em
-- supabase/rollback/20261116120000_mesa_campanhas_arquivar.down.sql.

ALTER TABLE public.mesa_campanhas
  ADD COLUMN IF NOT EXISTS arquivada_em timestamptz NULL,
  ADD COLUMN IF NOT EXISTS arquivada_por uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.mesa_campanhas.arquivada_em IS 'Quando a campanha foi arquivada; null = ativa. Status fica intocado.';
COMMENT ON COLUMN public.mesa_campanhas.arquivada_por IS 'Quem arquivou (profiles.id).';

CREATE INDEX IF NOT EXISTS mesa_campanhas_ativas_cliente_idx
  ON public.mesa_campanhas (client_id)
  WHERE arquivada_em IS NULL;
