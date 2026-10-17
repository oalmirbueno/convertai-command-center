-- Pedidos de acesso dos agentes (17/10/2026, pedido do dono).
--
-- Quando um agente (Paperclip, Hermes ou outro) chega num login e precisa de
-- senha, código de verificação ou outra confirmação, ele abre um pedido pelo
-- MCP (aceleriq_acesso_pedir) com o print da tela. O dono recebe um aviso,
-- abre o formulário seguro e responde; a senha fica no cofre do cliente e,
-- se ele marcar "lembrar", o agente usa sozinho dali em diante.
--
-- Regras do dono:
-- 1) O agente recebe a senha na hora do login, uma vez por chamada, com
--    registro de quem pediu e quando. A senha nunca vai para diário, aviso,
--    notificação, relatório ou log. Este gatilho de aviso não lê senha nem
--    código.
-- 2) Facebook, Instagram, Meta e Google nunca por senha: o agente pede
--    "conectar" com o link oficial (Composio/OAuth). A recusa mora no MCP.
--
-- Segurança do código de verificação: a coluna `codigo` não é legível pelo
-- front (GRANT por coluna). O MCP entrega o código UMA vez, pela função
-- pedido_acesso_retirar_codigo (só chave de serviço), que apaga o código e
-- marca o pedido como usado na mesma transação.
--
-- Só amplia, idempotente.

-- ─── 1) Cofre: o dono diz se os agentes podem usar o item sozinhos ──────────
ALTER TABLE public.client_vault
  ADD COLUMN IF NOT EXISTS agentes_podem_usar boolean NOT NULL DEFAULT false;

-- ─── 2) Tabela dos pedidos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedidos_de_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  operador_slug text NOT NULL,
  client_id uuid,
  kanban_task_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('senha', 'codigo', 'conectar', 'outro')),
  site text NOT NULL,
  url text,
  conta text,
  mensagem text NOT NULL,
  link_para_conectar text,
  print_path text,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'respondido', 'usado', 'cancelado', 'expirado')),
  vault_item_id uuid REFERENCES public.client_vault(id) ON DELETE SET NULL,
  codigo text,
  expira_em timestamptz,
  respondido_por uuid,
  respondido_em timestamptz,
  usado_em timestamptz
);

CREATE INDEX IF NOT EXISTS pedidos_de_acesso_status_idx ON public.pedidos_de_acesso (status, created_at DESC);
CREATE INDEX IF NOT EXISTS pedidos_de_acesso_vault_idx ON public.pedidos_de_acesso (vault_item_id) WHERE vault_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pedidos_de_acesso_client_idx ON public.pedidos_de_acesso (client_id) WHERE client_id IS NOT NULL;

ALTER TABLE public.pedidos_de_acesso ENABLE ROW LEVEL SECURITY;

-- Leitura só para admin e gestor. Escrita direta não existe: só as RPCs
-- abaixo (equipe) e a função do MCP (chave de serviço).
DROP POLICY IF EXISTS pedidos_de_acesso_select ON public.pedidos_de_acesso;
CREATE POLICY pedidos_de_acesso_select ON public.pedidos_de_acesso
  FOR SELECT TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'manager'::public.app_role)
  );

-- A coluna `codigo` fica fora do alcance do front: SELECT por coluna, sem ela.
-- Consulta com `*` falha de propósito; o front nomeia as colunas.
REVOKE ALL ON public.pedidos_de_acesso FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, created_at, operador_slug, client_id, kanban_task_id, tipo, site, url,
  conta, mensagem, link_para_conectar, print_path, status, vault_item_id,
  expira_em, respondido_por, respondido_em, usado_em
) ON public.pedidos_de_acesso TO authenticated;
GRANT ALL ON public.pedidos_de_acesso TO service_role;

-- ─── 3) Bucket privado dos prints: só a chave de serviço grava ──────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pedidos-de-acesso', 'pedidos-de-acesso', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'pedidos-de-acesso: admin e gestor leem'
  ) THEN
    CREATE POLICY "pedidos-de-acesso: admin e gestor leem"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      storage.objects.bucket_id = 'pedidos-de-acesso'
      AND (
        COALESCE(public.has_role((select auth.uid()), 'admin'::public.app_role), false)
        OR COALESCE(public.has_role((select auth.uid()), 'manager'::public.app_role), false)
      )
    );
  END IF;
END $$;

-- ─── 4) Ajudantes ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_private.pedido_acesso_exigir_equipe()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT (
    COALESCE(public.has_role(_uid, 'admin'::public.app_role), false)
    OR COALESCE(public.has_role(_uid, 'manager'::public.app_role), false)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Só admin ou gestor responde pedido de acesso.';
  END IF;
  RETURN _uid;
END;
$body$;
REVOKE ALL ON FUNCTION app_private.pedido_acesso_exigir_equipe() FROM PUBLIC, anon, authenticated;

-- "https://www.Site.com.br/login?x=1" -> "site.com.br". Sem endereço, vazio.
CREATE OR REPLACE FUNCTION app_private.acesso_host(_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $body$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(lower(trim(COALESCE(_url, ''))), '^[a-z][a-z0-9+.-]*://', ''),
      '[/:?#].*$', ''),
    '^www\.', '');
$body$;
REVOKE ALL ON FUNCTION app_private.acesso_host(text) FROM PUBLIC, anon, authenticated;

-- ─── 5) RPCs da equipe ─────────────────────────────────────────────────────

-- a) Senha: cria ou atualiza o item do cofre e liga ao pedido.
CREATE OR REPLACE FUNCTION public.pedido_acesso_responder_senha(
  p_pedido uuid,
  p_client_id uuid,
  p_titulo text,
  p_usuario text,
  p_senha text,
  p_lembrar boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
  _pedido public.pedidos_de_acesso%rowtype;
  _cliente uuid;
  _titulo text;
  _usuario text;
  _host text;
  _item uuid;
BEGIN
  _uid := app_private.pedido_acesso_exigir_equipe();

  SELECT * INTO _pedido FROM public.pedidos_de_acesso WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de acesso não encontrado.';
  END IF;
  IF _pedido.tipo <> 'senha' THEN
    RAISE EXCEPTION 'Este pedido não é de senha.';
  END IF;
  IF _pedido.status NOT IN ('aberto', 'respondido') THEN
    RAISE EXCEPTION 'Este pedido já foi encerrado (%).', _pedido.status;
  END IF;
  IF COALESCE(p_senha, '') = '' THEN
    RAISE EXCEPTION 'Informe a senha.';
  END IF;

  _cliente := COALESCE(_pedido.client_id, p_client_id);
  IF _cliente IS NULL THEN
    RAISE EXCEPTION 'Escolha o cliente dono deste acesso.';
  END IF;

  _titulo := left(COALESCE(NULLIF(trim(p_titulo), ''), _pedido.site), 200);
  _usuario := NULLIF(trim(COALESCE(p_usuario, '')), '');
  _host := app_private.acesso_host(COALESCE(_pedido.url, _pedido.site));

  IF _pedido.vault_item_id IS NOT NULL THEN
    SELECT v.id INTO _item FROM public.client_vault v
     WHERE v.id = _pedido.vault_item_id AND v.client_id = _cliente;
  END IF;

  IF _item IS NULL THEN
    SELECT v.id INTO _item FROM public.client_vault v
     WHERE v.client_id = _cliente
       AND lower(COALESCE(v.username, '')) = lower(COALESCE(_usuario, ''))
       AND (
         (_host <> '' AND app_private.acesso_host(v.url) = _host)
         OR lower(trim(v.title)) = lower(_titulo)
       )
     ORDER BY v.updated_at DESC
     LIMIT 1;
  END IF;

  IF _item IS NOT NULL THEN
    UPDATE public.client_vault SET
      title = _titulo,
      url = COALESCE(_pedido.url, url),
      username = _usuario,
      password = p_senha,
      agentes_podem_usar = COALESCE(p_lembrar, false)
    WHERE id = _item;
  ELSE
    INSERT INTO public.client_vault (client_id, category, title, url, username, password, agentes_podem_usar, created_by)
    VALUES (_cliente, 'acesso', _titulo, _pedido.url, _usuario, p_senha, COALESCE(p_lembrar, false), _uid)
    RETURNING id INTO _item;
  END IF;

  UPDATE public.pedidos_de_acesso SET
    client_id = _cliente,
    vault_item_id = _item,
    status = 'respondido',
    respondido_por = _uid,
    respondido_em = now()
  WHERE id = p_pedido;

  RETURN _item;
END;
$function$;

-- b) Código: vale por 10 minutos e o agente retira uma vez só.
CREATE OR REPLACE FUNCTION public.pedido_acesso_responder_codigo(p_pedido uuid, p_codigo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
  _pedido public.pedidos_de_acesso%rowtype;
  _codigo text := NULLIF(trim(COALESCE(p_codigo, '')), '');
BEGIN
  _uid := app_private.pedido_acesso_exigir_equipe();

  SELECT * INTO _pedido FROM public.pedidos_de_acesso WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de acesso não encontrado.';
  END IF;
  IF _pedido.tipo <> 'codigo' THEN
    RAISE EXCEPTION 'Este pedido não é de código.';
  END IF;
  IF _pedido.status NOT IN ('aberto', 'respondido') THEN
    RAISE EXCEPTION 'Este pedido já foi encerrado (%).', _pedido.status;
  END IF;
  IF _codigo IS NULL THEN
    RAISE EXCEPTION 'Informe o código.';
  END IF;
  IF length(_codigo) > 64 THEN
    RAISE EXCEPTION 'Código longo demais.';
  END IF;

  UPDATE public.pedidos_de_acesso SET
    codigo = _codigo,
    status = 'respondido',
    expira_em = now() + interval '10 minutes',
    respondido_por = _uid,
    respondido_em = now()
  WHERE id = p_pedido;
END;
$function$;

-- c) Conectar / outro: o dono fez o que o agente pediu.
CREATE OR REPLACE FUNCTION public.pedido_acesso_marcar_feito(p_pedido uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
  _pedido public.pedidos_de_acesso%rowtype;
BEGIN
  _uid := app_private.pedido_acesso_exigir_equipe();

  SELECT * INTO _pedido FROM public.pedidos_de_acesso WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de acesso não encontrado.';
  END IF;
  IF _pedido.tipo NOT IN ('conectar', 'outro') THEN
    RAISE EXCEPTION 'Senha e código se respondem pelo formulário próprio.';
  END IF;
  IF _pedido.status <> 'aberto' THEN
    RAISE EXCEPTION 'Este pedido não está aberto (%).', _pedido.status;
  END IF;

  UPDATE public.pedidos_de_acesso SET
    status = 'respondido',
    respondido_por = _uid,
    respondido_em = now()
  WHERE id = p_pedido;
END;
$function$;

-- d) Cancelar: some da fila e o código, se houver, é apagado.
CREATE OR REPLACE FUNCTION public.pedido_acesso_cancelar(p_pedido uuid)
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
    status = 'cancelado',
    codigo = NULL,
    respondido_por = COALESCE(respondido_por, _uid),
    respondido_em = COALESCE(respondido_em, now())
  WHERE id = p_pedido;
END;
$function$;

-- e) Liga/desliga o uso do item do cofre pelos agentes.
CREATE OR REPLACE FUNCTION public.cofre_agentes_podem_usar(p_item uuid, p_pode boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
BEGIN
  _uid := app_private.pedido_acesso_exigir_equipe();

  UPDATE public.client_vault SET
    agentes_podem_usar = COALESCE(p_pode, false)
  WHERE id = p_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item do cofre não encontrado.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.pedido_acesso_responder_senha(uuid, uuid, text, text, text, boolean),
  public.pedido_acesso_responder_codigo(uuid, text),
  public.pedido_acesso_marcar_feito(uuid),
  public.pedido_acesso_cancelar(uuid),
  public.cofre_agentes_podem_usar(uuid, boolean)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.pedido_acesso_responder_senha(uuid, uuid, text, text, text, boolean),
  public.pedido_acesso_responder_codigo(uuid, text),
  public.pedido_acesso_marcar_feito(uuid),
  public.pedido_acesso_cancelar(uuid),
  public.cofre_agentes_podem_usar(uuid, boolean)
TO authenticated, service_role;

-- ─── 6) Entrega do código ao agente (só a chave de serviço do MCP) ──────────
-- Devolve o código uma vez e, na mesma transação, apaga e marca 'usado'.
-- Vencido: apaga, marca 'expirado' e devolve NULL.
CREATE OR REPLACE FUNCTION public.pedido_acesso_retirar_codigo(p_pedido uuid, p_operador text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _pedido public.pedidos_de_acesso%rowtype;
  _codigo text;
BEGIN
  SELECT * INTO _pedido FROM public.pedidos_de_acesso WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND OR _pedido.tipo <> 'codigo' OR _pedido.status <> 'respondido' OR _pedido.codigo IS NULL THEN
    RETURN NULL;
  END IF;
  IF _pedido.operador_slug IS DISTINCT FROM lower(trim(COALESCE(p_operador, ''))) THEN
    RETURN NULL;
  END IF;

  IF _pedido.expira_em IS NOT NULL AND _pedido.expira_em <= now() THEN
    UPDATE public.pedidos_de_acesso SET codigo = NULL, status = 'expirado' WHERE id = p_pedido;
    RETURN NULL;
  END IF;

  _codigo := _pedido.codigo;
  UPDATE public.pedidos_de_acesso SET
    codigo = NULL,
    status = 'usado',
    usado_em = now()
  WHERE id = p_pedido;
  RETURN _codigo;
END;
$function$;

REVOKE ALL ON FUNCTION public.pedido_acesso_retirar_codigo(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedido_acesso_retirar_codigo(uuid, text) TO service_role;

-- ─── 7) Aviso ao dono (sem senha e sem código, nunca) ──────────────────────
CREATE OR REPLACE FUNCTION public.pedido_acesso_avisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _agente text;
  _site text;
  _frase text;
BEGIN
  SELECT NULLIF(trim(o.display_name), '') INTO _agente
    FROM public.internal_operators o WHERE o.slug = NEW.operador_slug;
  _agente := COALESCE(_agente, initcap(NULLIF(trim(NEW.operador_slug), '')), 'Um agente');
  _site := left(COALESCE(NULLIF(trim(NEW.site), ''), 'um site'), 80);
  _frase := CASE NEW.tipo
    WHEN 'senha' THEN ' precisa da senha de '
    WHEN 'codigo' THEN ' precisa do código de '
    WHEN 'conectar' THEN ' precisa que você conecte '
    ELSE ' precisa de você em '
  END;

  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT DISTINCT ur.user_id,
         left(_agente || _frase || _site, 500),
         'acesso_pedido',
         '/execucao?acesso=' || NEW.id::text
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role = 'admin'
     AND p.deleted_at IS NULL
     AND COALESCE(p.email, '') NOT ILIKE 'n8n@%';
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pedido_acesso_avisar ON public.pedidos_de_acesso;
CREATE TRIGGER trg_pedido_acesso_avisar
  AFTER INSERT ON public.pedidos_de_acesso
  FOR EACH ROW EXECUTE FUNCTION public.pedido_acesso_avisar();

REVOKE EXECUTE ON FUNCTION public.pedido_acesso_avisar() FROM PUBLIC, anon, authenticated;

-- O pedido de acesso também sai por e-mail para o administrador humano
-- (mesma lista de 20260927020100, mais 'acesso_pedido').
CREATE OR REPLACE FUNCTION public.notificacao_merece_email(_tipo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT _tipo IN ('approval', 'request', 'aprovacao_necessaria', 'central_review_pendente', 'central_review_decidida', 'central_review_enviada', 'responsavel_designado', 'agendamento_atrasado', 'teste', 'acesso_pedido');
$function$;

-- ─── 8) Ao vivo: a tela escuta os pedidos (RLS e GRANT por coluna valem) ────
DO $rt$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pedidos_de_acesso') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos_de_acesso;
    END IF;
  END IF;
END
$rt$;

-- Conferir depois de aplicar (só leitura):
-- select has_column_privilege('authenticated', 'public.pedidos_de_acesso', 'codigo', 'SELECT');  -- false
-- select has_column_privilege('authenticated', 'public.pedidos_de_acesso', 'status', 'SELECT');  -- true
-- select proname, prosecdef from pg_proc where proname like 'pedido_acesso_%' or proname = 'cofre_agentes_podem_usar';
-- select id, public from storage.buckets where id = 'pedidos-de-acesso';
