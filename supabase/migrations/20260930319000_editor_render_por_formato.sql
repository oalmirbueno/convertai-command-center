-- Frente EDT, rodada 2 (30/09): exportar o mesmo vídeo em vários formatos (9:16, 1:1, 4:5, 16:9).
--
-- A tela pede um render por formato (editor-video, render_pedir com `formato`; o
-- projeto vai para a fila já no formato pedido e o recorte segue o rosto na
-- composição). Antes: um pedido ativo por versão e tipo, então o segundo formato
-- esperava o primeiro acabar. Agora: um ativo por versão, tipo E formato.
--
-- Idempotente e só amplia (o índice novo é mais permissivo que o antigo; nenhuma
-- linha existente fica inválida). RLS e permissões da tabela não mudam.

DO $$
BEGIN
  IF to_regclass('public.render_pedidos') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP INDEX IF EXISTS public.render_pedidos_ativo_unico';
  EXECUTE $i$
    CREATE UNIQUE INDEX IF NOT EXISTS render_pedidos_ativo_por_formato
      ON public.render_pedidos (versao_id, tipo, (coalesce(entrada ->> 'formato', '')))
      WHERE estado IN ('fila', 'rodando')
  $i$;
  EXECUTE $c$
    COMMENT ON INDEX public.render_pedidos_ativo_por_formato IS
      'Frente EDT, rodada 2: no máximo um pedido ativo por versão, tipo e formato (entrada.formato; vazio = formato do projeto).'
  $c$;
END $$;
