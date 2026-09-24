-- Mesa Ads: o estrategista de ads também guarda memória (aprendizados dos testes).
ALTER TABLE public.agente_memoria DROP CONSTRAINT IF EXISTS agente_memoria_agente_check;
ALTER TABLE public.agente_memoria ADD CONSTRAINT agente_memoria_agente_check CHECK (agente = ANY (ARRAY['estrategista', 'diretor_arte', 'estrategista_ads']));
