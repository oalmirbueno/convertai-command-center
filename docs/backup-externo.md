# Backup externo do painel

O Supabase Pro já guarda 7 dias de cópia do banco, mas dentro do próprio Supabase. Este backup fica fora dele, no Cloudflare R2 (balde `aceleriq-backup`), e roda toda madrugada às 03h15 de Brasília pelo workflow `.github/workflows/backup-externo.yml`.

## O que ele faz

1. **Banco:** copia papéis, estrutura e dados da produção (`supabase db dump`).
2. **Teste de restauração:** restaura a cópia num Supabase local vazio e confere, tabela por tabela do `public`, se o número de linhas é o mesmo da cópia. Se não bater, o workflow falha e o GitHub avisa por email.
3. **Guarda:** criptografa com AES-256 (senha `BACKUP_PASSPHRASE`) e sobe em `banco/`. Cópias com mais de 30 dias são apagadas.
4. **Arquivos:** copia os arquivos novos de todos os baldes do Storage para `arquivos/<balde>/`. É cópia, não espelho: um arquivo apagado no painel continua no backup.

O workflow só lê a produção.

## Segredos (Settings > Secrets and variables > Actions > Repository secrets)

| Nome | Onde pegar |
|---|---|
| `SUPABASE_DB_URL` | Supabase > Connect > Session pooler (porta 5432), com a senha do banco |
| `SUPABASE_S3_ACCESS_KEY_ID` / `SUPABASE_S3_SECRET_ACCESS_KEY` | Supabase > Storage > Settings > S3 access keys |
| `R2_ACCOUNT_ID` | Cloudflare > R2 (ID da conta) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare > R2 > Manage API tokens, "Object Read & Write" só no balde `aceleriq-backup` |
| `BACKUP_PASSPHRASE` | Senha longa criada pelo dono e guardada no gerenciador de senhas. Sem ela a cópia do banco não abre. |

## Como restaurar

1. Baixe a cópia: `rclone copy r2:aceleriq-backup/banco/<arquivo> .`
2. Abra: `gpg --decrypt <arquivo> | tar -xzf -` (pede a `BACKUP_PASSPHRASE`). Saem `roles.sql`, `schema.sql` e `data.sql`.
3. Num projeto Supabase novo e vazio:
   `psql "<url do banco novo>" -v ON_ERROR_STOP=1 --single-transaction -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql`
4. Arquivos: `rclone copy r2:aceleriq-backup/arquivos/<balde> <remoto do Storage novo>:<balde>` para cada balde.
5. Depois: publicar as Edge Functions, recadastrar os segredos das funções e apontar o site para o projeto novo.
