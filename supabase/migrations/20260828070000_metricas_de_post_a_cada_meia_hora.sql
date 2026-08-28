-- As metricas de post paravam de atualizar por tres dias.
--
-- O RELATO: "as metricas nao estao atualizando".
--
-- O QUE ACHEI: o robo roda de 10 em 10 minutos, mas so busca os posts de
-- uma conta se ela NAO tiver nenhum post colhido nos ultimos TRES DIAS.
-- Colheu hoje as 13:10? A proxima coleta daquela conta e dia 31.
--
--   SELECT public.social_metrics_tick();
--   -> {"dispatched": 0, "parsed": 0}
--
-- Zero despachado, com doze contas ativas. Nao ha falha nem erro: o robo
-- roda, olha, decide que esta tudo fresco o suficiente e volta a dormir.
-- De fora, "as metricas nao atualizam" — e e exatamente isso mesmo.
--
-- POR QUE ISSO FICOU PIOR AGORA: a reconciliacao que acabamos de ligar
-- descobre que um post ja foi ao ar OLHANDO essa mesma tabela. Ela roda
-- de 15 em 15 minutos sobre dados que so se renovam a cada tres dias. E
-- provavelmente e por isso que o post de 27/08 da Mirante Luz nao foi
-- encontrado: ele caiu na janela morta entre duas coletas.
--
-- A CORRECAO: meia hora em vez de tres dias.
--
-- Meia hora, e nao dez minutos, e uma escolha e nao um chute. Doze contas
-- a cada trinta minutos sao 24 chamadas por hora, folgadissimo para o
-- limite do Graph. A dez minutos seriam 72, ainda dentro do limite, mas
-- sem ganho real: o alarme de atraso so fala aos 90 minutos, entao meia
-- hora ja da tres coletas de folga antes de qualquer acusacao. Gastar
-- cota para adiantar um dado que ninguem le antes de 90 minutos e gastar
-- por nada — e cota gasta a toa e a que falta no dia de pico.
--
-- Patch textual VERIFICADO, no estilo que esta casa ja usa: se o trecho
-- esperado nao existir exatamente, nada e aplicado e o erro e alto. Isso
-- protege contra sobrescrever em silencio uma versao diferente da que eu
-- li. Idempotente: rodar de novo com o patch ja aplicado nao faz nada.

DO $patch$
DECLARE
  _fonte text;
  _velho text;
  _novo text;
  _remendado text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _fonte
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'social_metrics_tick';

  IF _fonte IS NULL THEN
    RAISE EXCEPTION 'social_metrics_tick nao encontrada; nada a aplicar';
  END IF;

  _velho := E'          AND p.captured_at > now() - interval \'3 days\'';
  _novo  := E'          AND p.captured_at > now() - interval \'30 minutes\'';

  IF position(_novo IN _fonte) > 0 THEN
    RAISE NOTICE 'coleta de posts ja esta em 30 minutos; nada a fazer';
    RETURN;
  END IF;

  IF position(_velho IN _fonte) = 0 THEN
    RAISE EXCEPTION
      'trecho da carencia de coleta nao encontrado; nada foi alterado';
  END IF;

  _remendado := replace(_fonte, _velho, _novo);

  IF _remendado = _fonte THEN
    RAISE EXCEPTION 'nenhuma alteracao produzida; nada foi aplicado';
  END IF;

  EXECUTE _remendado;
  RAISE NOTICE 'coleta de posts passou de 3 dias para 30 minutos';
END
$patch$;
