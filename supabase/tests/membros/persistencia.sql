-- Executado em nova conexão após reiniciar o servidor descartável.
DO $$ BEGIN IF current_database()<>'membros_test' THEN RAISE EXCEPTION 'Banco de teste obrigatório'; END IF; END $$;
SELECT public.testar((SELECT count(*) FROM public.membros_checklist WHERE estado='em_andamento')=1,'checklist persiste após reiniciar servidor e reconectar');
SELECT public.testar((SELECT count(*) FROM public.membros_checklist_historico)=2,'histórico persiste após reiniciar servidor');
SELECT public.testar((SELECT count(*) FROM public.membros_progresso WHERE concluido)=1,'progresso persiste após reiniciar servidor');
