-- A pagina publica de venda do E-mail profissional (/email) mostra a mensalidade,
-- a caixa adicional e a migracao a quem ainda nao tem login.
-- produto_precos() devolve so precos e prazos de venda (nenhum custo da casa,
-- nenhuma chave): abrir a leitura para o visitante nao expoe nada alem do que a
-- propria pagina mostra. Sem este grant a pagina abre, mas sem os valores.
grant execute on function public.produto_precos() to anon;
