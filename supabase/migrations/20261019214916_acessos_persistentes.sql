-- 19/10/2026 (dono, com o print de "Acessos pedidos": "melhore essa parte de acesso, que
-- funcione melhor, fique persistente e cuide para não cair, e opção de concluir para ele sair
-- dali"). Dois pedidos de código da Kiwify ficaram abertos para sempre: o de 02:20 já tinha
-- sido substituído (o agente pediu de novo às 12:26 e às 13:09), mas código não vencia e pedido
-- novo não fechava o antigo.

-- 1) Concluir: o dono tira o pedido da lista com um toque, de qualquer tipo (antes só "conectar"
--    e "outro" tinham "Já fiz"). Fica como 'usado' (encerrado) e sem código guardado; o agente lê
--    "já foi usado; se precisar de novo, abra outro pedido".
CREATE OR REPLACE FUNCTION public.pedido_acesso_concluir(p_pedido uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
  _status text;
BEGIN
  _uid := app_private.pedido_acesso_exigir_equipe();

  SELECT status INTO _status FROM public.pedidos_de_acesso WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de acesso não encontrado.';
  END IF;
  IF _status NOT IN ('aberto', 'respondido') THEN
    RETURN;
  END IF;

  UPDATE public.pedidos_de_acesso SET
    status = 'usado',
    codigo = NULL,
    respondido_por = COALESCE(respondido_por, _uid),
    respondido_em = COALESCE(respondido_em, now()),
    usado_em = now()
  WHERE id = p_pedido;
END;
$function$;

REVOKE ALL ON FUNCTION public.pedido_acesso_concluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_acesso_concluir(uuid) TO authenticated;

-- 2) Pedido de código vence em 2 horas (o código que o site manda vale minutos; depois disso o
--    agente precisa pedir outro). Responder o código continua dando 10 minutos para o uso.
CREATE OR REPLACE FUNCTION app_private.pedido_acesso_prazo_do_codigo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.tipo = 'codigo' AND NEW.expira_em IS NULL THEN
    NEW.expira_em := now() + interval '2 hours';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pedido_acesso_prazo_do_codigo ON public.pedidos_de_acesso;
CREATE TRIGGER trg_pedido_acesso_prazo_do_codigo
  BEFORE INSERT ON public.pedidos_de_acesso
  FOR EACH ROW EXECUTE FUNCTION app_private.pedido_acesso_prazo_do_codigo();

-- 3) Pedido novo do mesmo agente, tipo, cliente, site e conta fecha o antigo (vence). Código já
--    respondido e não usado também vence: se o agente pediu outro, o anterior não serviu.
CREATE OR REPLACE FUNCTION app_private.pedido_acesso_substitui_antigos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.pedidos_de_acesso p SET
    status = 'expirado',
    codigo = NULL
  WHERE p.id <> NEW.id
    AND (p.status = 'aberto' OR (p.status = 'respondido' AND p.tipo = 'codigo'))
    AND p.tipo = NEW.tipo
    AND p.operador_slug IS NOT DISTINCT FROM NEW.operador_slug
    AND p.client_id IS NOT DISTINCT FROM NEW.client_id
    AND lower(coalesce(p.site, '')) = lower(coalesce(NEW.site, ''))
    AND lower(coalesce(p.conta, '')) = lower(coalesce(NEW.conta, ''));
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.pedido_acesso_substitui_antigos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pedido_acesso_substitui_antigos ON public.pedidos_de_acesso;
CREATE TRIGGER trg_pedido_acesso_substitui_antigos
  AFTER INSERT ON public.pedidos_de_acesso
  FOR EACH ROW EXECUTE FUNCTION app_private.pedido_acesso_substitui_antigos();

-- 4) Limpeza de hoje: abertos repetidos ficam só no mais novo; código aberto há mais de 2 horas
--    vence; o que sobra de código aberto ganha o prazo de 2 horas a partir de quando foi pedido.
WITH ordem AS (
  SELECT id, row_number() OVER (
    PARTITION BY operador_slug, tipo, client_id, lower(coalesce(site, '')), lower(coalesce(conta, ''))
    ORDER BY created_at DESC) AS n
  FROM public.pedidos_de_acesso
  WHERE status = 'aberto'
)
UPDATE public.pedidos_de_acesso p SET status = 'expirado', codigo = NULL
FROM ordem WHERE p.id = ordem.id AND ordem.n > 1;

UPDATE public.pedidos_de_acesso SET status = 'expirado', codigo = NULL
WHERE status = 'aberto' AND tipo = 'codigo' AND expira_em IS NULL AND created_at < now() - interval '2 hours';

UPDATE public.pedidos_de_acesso SET expira_em = created_at + interval '2 hours'
WHERE status = 'aberto' AND tipo = 'codigo' AND expira_em IS NULL;
