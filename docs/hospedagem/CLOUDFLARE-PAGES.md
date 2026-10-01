# Hospedagem do painel na Cloudflare Pages

Desde 30/09/2026 o front do painel (o `dist/` do Vite) é publicado na Cloudflare, no Worker `aceleriq-painel` com arquivos estáticos (a Pages nova roda dentro de Workers). A configuração fica em `wrangler.jsonc`. O backend continua no Supabase próprio (`jjjtkowvxemvituvywvf`) e não muda.

O Lovable continua conectado ao GitHub como editor, se o dono quiser, mas a publicação não depende mais dele. O motivo: em 30/09 o deploy do Lovable recusou 7 publicações seguidas porque reenviava o App MCP com o `_shared` inteiro (limite de ~4,4 MB), e o bundle ficou preso na CDN dele mais de uma vez.

## Publicar

- **Daqui (máquina com `wrangler login`):** `npm run publicar`. Faz o build e roda `wrangler deploy`, que publica de forma atômica em uns 2 minutos.
- **Pelo GitHub:** um push no `main` dispara `.github/workflows/deploy-cloudflare-pages.yml`. Precisa dos segredos do repositório `CLOUDFLARE_API_TOKEN` (modelo "Edit Cloudflare Workers") e `CLOUDFLARE_ACCOUNT_ID`. Sem eles o job só avisa e não falha.
- **Conferir:** `https://aceleriq.online/version.json` mostra o `sourceRevision`, que tem que bater com o commit publicado.

## Voltar uma versão

No painel da Cloudflare, abra Workers & Pages › aceleriq-painel › Deployments, escolha a versão anterior › Rollback (ou `npx wrangler rollback`). Leva segundos e não precisa de build.

## Cache e rotas

- `public/_headers`:
  - `/assets/*` é imutável por 1 ano, porque os nomes têm hash;
  - `version.json` vai sem cache;
  - o HTML usa o padrão da Pages, que revalida a cada visita.
- **Rotas do painel** (`/mesa`, `/proposta/:token`...): `not_found_handling: "single-page-application"` no `wrangler.jsonc` devolve o `index.html` para qualquer caminho que não é arquivo.
- **Deploy atômico:** os arquivos da versão anterior continuam servidos, então a aba aberta antes da publicação não fica em tela branca.

## Domínio

- O `aceleriq.online` aponta para a Pages pelo DNS na Cloudflare.
- Para virar:
  1. trocar os nameservers na Hostinger para os dois que a Cloudflare indicar;
  2. conferir os registros (MX e TXT do Resend, SPF, DKIM) importados;
  3. em aceleriq-painel › Settings › Domains & Routes, adicionar `aceleriq.online` (e `www`).
- O endereço de teste é `https://aceleriq-painel.almirbarrosbueno.workers.dev`.
