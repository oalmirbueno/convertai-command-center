# Release e7b5984 pelo ambiente Lovable: o que é possível e o que não é

Resposta objetiva: **não é possível executar a release inteira "sem edição" a partir deste ambiente.** As Edge Functions podem ser implantadas; as 12 migrations **não** podem ser aplicadas pelo runner de arquivos versionados. Nada foi alterado nesta verificação.

## Estado verificado agora (somente leitura)

- Os 12 arquivos de migration existem no projeto: `20260807210000`, `211000`, `212000`, `213000`, `215000`, `216000`, `217000`, `219000`, `220000`, `221000`, `222000`, `223000`.
- As 7 funções existem em `supabase/functions/`: `admin-reset-client-access`, `client-first-access`, `submit-quiz`, `workspace-inbox`, `api-gateway`, `mcp-server`, `mcp-oauth-metadata`. Todas já têm `verify_jwt` definido em `supabase/config.toml`.
- Banco vinculado: `public.mcp_oauth_clients` **não existe** e a RPC `issue_first_access_token_service` **não existe** — indicativo de que o lote de 07/08 ainda não foi aplicado.
- O ledger `supabase_migrations.schema_migrations` é inacessível pelo papel de leitura deste ambiente (permission denied), então a confirmação definitiva de pendência depende do runner oficial.
- **HEAD do checkout deste ambiente é `d89dfec3`, não `e7b5984a`.** O ambiente não está sincronizado no commit da release.

## Bloqueios (ações externas indispensáveis)

1. **Sincronizar o projeto Lovable no commit `e7b5984a`.** Enquanto o checkout estiver em `d89dfec3`, qualquer deploy publicaria bytes diferentes do commit aprovado. Isso é uma ação de plataforma (sync/merge da main), não executável por edição de arquivo.
2. **Runner de migrations por arquivo não existe aqui.** O ambiente Lovable só aplica SQL pela ferramenta de migration, que recebe SQL inline e é aprovada uma a uma pelo usuário; ela grava no ledger, mas registra a versão gerada pela plataforma, não os 12 timestamps versionados. Aplicar os arquivos com `20260807210000...223000` preservando versão, ordem e ledger exige o caminho externo já existente no repositório: o workflow **`.github/workflows/deploy-supabase-database.yml`** (`supabase db push --linked`, forward-only), disparado manualmente no GitHub.

## O que este ambiente consegue fazer sem editar arquivos

Deploy das 7 Edge Functions, exatamente como estão no checkout, via a ferramenta de deploy do backend vinculado (`ref` atual do projeto), preservando o `verify_jwt` já declarado em `config.toml`:

| Função | verify_jwt (config.toml) |
| --- | --- |
| admin-reset-client-access | true |
| client-first-access | false |
| submit-quiz | false |
| workspace-inbox | false |
| api-gateway | false |
| mcp-server | false |
| mcp-oauth-metadata | false |

Gates que se aplicam a esse deploy: código idêntico ao checkout (sem reescrita), dependências relativas de `_shared` incluídas no bundle, nenhuma migration/secret/bucket tocado, e smoke test somente leitura após o deploy.

## Sequência correta da release

```text
1. Sync do projeto Lovable -> commit e7b5984a            [externo: plataforma]
2. GitHub Actions: Deploy Supabase Database              [externo: manual]
   inputs: target_sha=e7b5984a, APPLY_DATABASE_PRODUCTION,
           BACKUP_VERIFIED, PRIVATE_SECURITY_CHECKLIST_VERIFIED
   -> aplica as 12 migrations em ordem, ledger registrado
3. Aqui: deploy das 7 Edge Functions                     [posso executar]
4. Publish do frontend                                   [externo: manual]
```

A ordem importa: `admin-reset-client-access`, `client-first-access`, `submit-quiz`, `workspace-inbox` e `api-gateway` dependem de objetos criados pelas migrations do passo 2 (tokens de primeiro acesso, quiz invitations, escopo de tenant do gateway). Implantá-las antes deixaria as funções falhando em runtime.

## Se preferir sem o workflow do GitHub

Alternativa única disponível aqui: aplicar o mesmo SQL pela ferramenta de migration da Lovable, em 12 chamadas aprovadas por você. Consequência aceita explicitamente: os arquivos não são executados por caminho e o ledger receberá versões geradas pela plataforma, divergindo dos timestamps `20260807*`. Isso quebra a verificação append-only de `scripts/verify-migration-integrity.mjs` e o gate de baseline do workflow. Não recomendo, e não farei sem sua autorização explícita.

## Próximo passo que peço

Confirme qual caminho quer: (A) você dispara o workflow do banco e eu faço só o passo 3, ou (B) autoriza as 12 migrations inline com a divergência de ledger acima.
