-- Central de Automações (19/11/2026). Dono: "uma central das automações onde podemos ver tudo: saúde, os próprios
-- workflows de forma mais dinâmica e interativa, e ver eles funcionando... com botão ligar e desligar".
--
-- O n8n de produção roda no VPS do Hermes. O painel nunca fala SSH: um coletor no servidor (só leitura do SQLite
-- do n8n e do systemd) manda, a cada minuto, um retrato para a função automacoes-n8n, que grava aqui com a chave
-- de serviço. O ligar/desligar sai da mesma função (só admin), pela API pública do n8n, e fica registrado em
-- automacao_acoes. Nenhuma tabela guarda segredo: das execuções só o caminho (nomes dos nós), o estado e o erro curto.
--
-- Leitura da tela e do MCP: public.automacoes_painel() e public.automacoes_fluxo(id). Ninguém escreve direto.

CREATE TABLE IF NOT EXISTS public.automacao_fluxos (
  id text PRIMARY KEY,
  nome text NOT NULL,
  grupo text NOT NULL DEFAULT 'Outros',
  ativo boolean NOT NULL DEFAULT false,
  arquivado boolean NOT NULL DEFAULT false,
  versao text,
  atualizado_no_n8n timestamptz,
  gatilhos jsonb NOT NULL DEFAULT '[]'::jsonb,
  proxima_execucao timestamptz,
  total_24h integer NOT NULL DEFAULT 0,
  erros_24h integer NOT NULL DEFAULT 0,
  ultima_execucao jsonb,
  qtd_nos integer NOT NULL DEFAULT 0,
  desenho jsonb,
  visto_em timestamptz NOT NULL DEFAULT now(),
  sumiu_em timestamptz
);

CREATE TABLE IF NOT EXISTS public.automacao_execucoes (
  id bigint PRIMARY KEY,
  fluxo_id text NOT NULL,
  modo text,
  status text NOT NULL,
  inicio timestamptz,
  fim timestamptz,
  caminho jsonb NOT NULL DEFAULT '[]'::jsonb,
  parou_em text,
  erro text,
  erro_no text,
  grande boolean NOT NULL DEFAULT false,
  recebido_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automacao_execucoes_fluxo_idx ON public.automacao_execucoes (fluxo_id, id DESC);

CREATE TABLE IF NOT EXISTS public.automacao_saude (
  chave text PRIMARY KEY,
  nome text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('ok', 'atencao', 'falha')),
  detalhe text,
  info jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordem integer NOT NULL DEFAULT 0,
  coletado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.automacao_coletas (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  coletado_em timestamptz NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  fluxos integer NOT NULL DEFAULT 0,
  execucoes integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.automacao_acoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fluxo_id text NOT NULL,
  fluxo_nome text,
  acao text NOT NULL CHECK (acao IN ('ligar', 'desligar')),
  pedido_por uuid,
  pedido_por_nome text,
  via text NOT NULL DEFAULT 'painel' CHECK (via IN ('painel', 'mcp')),
  motivo text,
  efeito_no_cliente boolean NOT NULL DEFAULT false,
  resultado text NOT NULL DEFAULT 'pedido' CHECK (resultado IN ('pedido', 'feito', 'falhou')),
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS automacao_acoes_fluxo_idx ON public.automacao_acoes (fluxo_id, created_at DESC);

ALTER TABLE public.automacao_fluxos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automacao_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automacao_saude ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automacao_coletas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automacao_acoes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.automacao_fluxos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.automacao_execucoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.automacao_saude FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.automacao_coletas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.automacao_acoes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.automacao_fluxos, public.automacao_execucoes, public.automacao_saude,
  public.automacao_coletas, public.automacao_acoes TO service_role;

-- Fluxo que fala com cliente ou lead: desligar tem efeito fora da casa. Regra única, usada pela tela, pela função
-- e pelo MCP (a confirmação do botão diz isso).
CREATE OR REPLACE FUNCTION public.automacao_efeito_no_cliente(_grupo text, _nome text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT coalesce(_grupo, '') IN ('Clientes', 'Comercial', 'Instagram', 'Grupos DK')
      OR coalesce(_nome, '') ~* '(cliente|grupo|whatsapp|lead|instagram|direct)';
$function$;

-- Retrato da tela: fluxos (sem o desenho), saúde, última coleta e as últimas ações.
CREATE OR REPLACE FUNCTION public.automacoes_painel()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.is_staff(_uid), false) THEN
    RAISE EXCEPTION 'Somente a equipe vê as automações.' USING errcode = '42501';
  END IF;
  RETURN jsonb_build_object(
    'coleta', (SELECT jsonb_build_object('coletado_em', c.coletado_em, 'recebido_em', c.recebido_em,
                 'atrasada', c.recebido_em < now() - interval '5 minutes') FROM public.automacao_coletas c WHERE c.id = 1),
    'pode_ligar', coalesce(auth.role(), '') = 'service_role' OR coalesce(public.has_role(_uid, 'admin'::public.app_role), false),
    'fluxos', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'nome', f.nome, 'grupo', f.grupo, 'ativo', f.ativo, 'arquivado', f.arquivado,
        'gatilhos', f.gatilhos, 'proxima_execucao', f.proxima_execucao, 'total_24h', f.total_24h,
        'erros_24h', f.erros_24h, 'ultima_execucao', f.ultima_execucao, 'qtd_nos', f.qtd_nos,
        'atualizado_no_n8n', f.atualizado_no_n8n,
        'efeito_no_cliente', public.automacao_efeito_no_cliente(f.grupo, f.nome)
      ) ORDER BY f.grupo, f.nome) FROM public.automacao_fluxos f WHERE f.sumiu_em IS NULL), '[]'::jsonb),
    'saude', coalesce((SELECT jsonb_agg(jsonb_build_object('chave', s.chave, 'nome', s.nome, 'estado', s.estado,
        'detalhe', s.detalhe, 'info', s.info, 'coletado_em', s.coletado_em) ORDER BY s.ordem, s.chave)
      FROM public.automacao_saude s), '[]'::jsonb),
    'acoes', coalesce((SELECT jsonb_agg(a ORDER BY a->>'created_at' DESC) FROM (
        SELECT jsonb_build_object('fluxo_id', x.fluxo_id, 'fluxo_nome', x.fluxo_nome, 'acao', x.acao,
          'pedido_por_nome', x.pedido_por_nome, 'via', x.via, 'resultado', x.resultado, 'erro', x.erro,
          'created_at', x.created_at) AS a
        FROM public.automacao_acoes x ORDER BY x.created_at DESC LIMIT 20) t), '[]'::jsonb)
  );
END;
$function$;

-- Um fluxo: desenho, últimas execuções (com o caminho) e as ações registradas nele.
CREATE OR REPLACE FUNCTION public.automacoes_fluxo(_id text, _limite integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _f public.automacao_fluxos;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.is_staff(auth.uid()), false) THEN
    RAISE EXCEPTION 'Somente a equipe vê as automações.' USING errcode = '42501';
  END IF;
  SELECT * INTO _f FROM public.automacao_fluxos WHERE id = _id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', _f.id, 'nome', _f.nome, 'grupo', _f.grupo, 'ativo', _f.ativo, 'gatilhos', _f.gatilhos,
    'proxima_execucao', _f.proxima_execucao, 'total_24h', _f.total_24h, 'erros_24h', _f.erros_24h,
    'efeito_no_cliente', public.automacao_efeito_no_cliente(_f.grupo, _f.nome),
    'desenho', coalesce(_f.desenho, '{}'::jsonb),
    'execucoes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'modo', e.modo, 'status', e.status,
        'inicio', e.inicio, 'fim', e.fim, 'caminho', e.caminho, 'parou_em', e.parou_em, 'erro', e.erro,
        'erro_no', e.erro_no, 'grande', e.grande) ORDER BY e.id DESC)
      FROM (SELECT * FROM public.automacao_execucoes WHERE fluxo_id = _id ORDER BY id DESC
            LIMIT greatest(1, least(coalesce(_limite, 30), 100))) e), '[]'::jsonb),
    'acoes', coalesce((SELECT jsonb_agg(jsonb_build_object('acao', a.acao, 'pedido_por_nome', a.pedido_por_nome,
        'via', a.via, 'resultado', a.resultado, 'erro', a.erro, 'created_at', a.created_at) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.automacao_acoes WHERE fluxo_id = _id ORDER BY created_at DESC LIMIT 10) a), '[]'::jsonb)
  );
END;
$function$;

-- Guarda só as últimas N execuções de cada fluxo (o coletor manda as novas a cada minuto).
CREATE OR REPLACE FUNCTION public.automacoes_podar(_por_fluxo integer DEFAULT 30)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH velhas AS (
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY fluxo_id ORDER BY id DESC) AS n FROM public.automacao_execucoes
    ) r WHERE r.n > greatest(5, coalesce(_por_fluxo, 30))
  ), apagadas AS (
    DELETE FROM public.automacao_execucoes e USING velhas v WHERE e.id = v.id RETURNING 1
  )
  SELECT count(*)::integer FROM apagadas;
$function$;

REVOKE ALL ON FUNCTION public.automacoes_painel() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.automacoes_fluxo(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.automacoes_podar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automacoes_painel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.automacoes_fluxo(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.automacoes_podar(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automacao_efeito_no_cliente(text, text) TO authenticated, service_role;
