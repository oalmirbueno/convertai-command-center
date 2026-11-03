-- Liga a credencial MCP "Grok Bot" aos operadores que a Jori precisa assinar.
-- Motivo: depoisDaAutoria só cria vínculos se a chave já tem pelo menos um;
-- a chave nasceu sem vínculos, então o cadastro da Jori não se auto-ligou.
-- Idempotente (PK principal+operator_slug).

insert into public.operator_key_bindings (principal, operator_slug, padrao, rotulo)
values
  ('key:18f75399-8f15-454c-ba72-5d4ae6f97817', 'jori', true, 'Grok Bot'),
  ('key:18f75399-8f15-454c-ba72-5d4ae6f97817', 'default', false, 'Grok Bot'),
  ('key:18f75399-8f15-454c-ba72-5d4ae6f97817', 'gestor-trafego', false, 'Grok Bot'),
  ('key:18f75399-8f15-454c-ba72-5d4ae6f97817', 'sentinela', false, 'Grok Bot'),
  ('key:18f75399-8f15-454c-ba72-5d4ae6f97817', 'otimizador', false, 'Grok Bot'),
  ('key:18f75399-8f15-454c-ba72-5d4ae6f97817', 'paperclip', false, 'Grok Bot')
on conflict (principal, operator_slug) do nothing;

update public.operator_key_bindings b
set padrao = true
where b.principal = 'key:18f75399-8f15-454c-ba72-5d4ae6f97817'
  and b.operator_slug = 'jori'
  and not exists (
    select 1 from public.operator_key_bindings x
    where x.principal = b.principal and x.padrao and x.operator_slug <> 'jori'
  );
