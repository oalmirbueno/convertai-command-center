-- ============================================================================
-- Aceleriq OS - legenda publicada com acentos e emojis corretos
-- ============================================================================
--
-- O sintoma real: o post saiu no Instagram com a legenda "cheia de caracteres"
-- estranhos. Causa: o codificador de URL do motor juntava os bytes de um
-- caractere multi-byte num único "%": "é" virava "%C3A9" em vez de "%C3%A9".
-- O Instagram decodificava o primeiro byte e deixava o resto solto na legenda,
-- quebrando acento, cedilha e emoji.
--
-- Correção: cada BYTE ganha o próprio "%XX", como manda o padrão. "é" vira
-- "%C3%A9", emoji vira os 4 bytes certos, e a legenda chega intacta.
-- ============================================================================

CREATE OR REPLACE FUNCTION social_private.autopublish_urlencode(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    string_agg(
      CASE
        WHEN piece ~ '^[A-Za-z0-9_.~-]$' THEN piece
        -- Um "%XX" por BYTE: acento e emoji têm vários bytes e cada um
        -- precisa do próprio par, senão a legenda chega quebrada.
        ELSE regexp_replace(
          upper(encode(convert_to(piece, 'UTF8'), 'hex')),
          '(..)', '%\1', 'g'
        )
      END,
      ''
    ),
    ''
  )
  FROM regexp_split_to_table(COALESCE(_value, ''), '') AS piece;
$function$;

-- Prova rápida no próprio banco: deve devolver TRUE, TRUE.
DO $$
BEGIN
  IF social_private.autopublish_urlencode('é') <> '%C3%A9' THEN
    RAISE EXCEPTION 'urlencode ainda quebra acentos: %',
      social_private.autopublish_urlencode('é');
  END IF;
  IF social_private.autopublish_urlencode('a b#') <> 'a%20b%23' THEN
    RAISE EXCEPTION 'urlencode quebrou o caso simples: %',
      social_private.autopublish_urlencode('a b#');
  END IF;
  RAISE NOTICE 'Codificacao de legenda corrigida: acentos e emojis chegam intactos.';
END;
$$;
