# Central de domínios e sites (19/11/2026)

Tela da casa em `/produto/dominios` (Domínios) e `/produto/dominios/sites` (Sites), no menu "Domínios e sites". Só o admin da Aceleriq vê.

## O que mostra

**Domínios**: todos os domínios dos clientes num lugar só. Entram de três jeitos: cadastro manual, leitura da Cloudflare da casa (cada zona vira um domínio) e o domínio do e-mail profissional (`produto_email_dominios`, aparece mesmo sem cadastro e vira cadastro ao salvar). Para cada um: cliente, registrador, titular, nameservers, onde está o DNS (Cloudflare da casa, Hostinger, Registro.br...), zona ativa ou pendente, vencimento (RDAP: `rdap.registro.br` para .br, `rdap.org` para o resto), DNS do e-mail (MX, SPF, DKIM, DMARC pelo DNS público, a mesma regra de `supabase/functions/produto/modulos/dns.ts`), custo e preço.

**Sites**: Workers e Pages da conta da Aceleriq (com domínios próprios, rotas e o endereço `.workers.dev`/`.pages.dev` quando não há domínio) e os cadastrados à mão. Para cada um: endereço, cliente (o do site ou, sem ele, o do domínio ligado), resposta (código e tempo), SSL, última publicação, domínio ligado, custo e preço.

**Topo**: quantos domínios e sites, quantos precisam de você, receita por mês, custo e margem (anual dividido por 12).

**Filtros**: saúde (com aviso, vence em 30 dias, DNS com falta, fora do ar, sem cliente), cliente e busca. Arquivar tira da lista e guarda.

## Regras

- O que é da casa (cliente, preço, custo, observação) nunca é mudado pela leitura. O RDAP manda no vencimento; sem resposta dele vale o anotado à mão.
- O vencimento lido pelo RDAP também preenche `produto_email_dominios.dominio_vence_em` quando ele está vazio (a Central de E-mail passa a avisar).
- DNS do e-mail só conta como falta em domínio com e-mail (do produto ou com MX publicado).
- Site fora do ar: não abriu (tempo de 8 s, certificado recusado) ou respondeu 5xx. 4xx e mais de 3 s de resposta são atenção.

## Onde está

| Parte | Arquivo |
| --- | --- |
| Banco | `supabase/migrations/20261119120000_casa_dominios_e_sites.sql` (tabelas `casa_dominios` e `casa_sites`, RLS só leitura da casa, RPCs security definer) |
| Função | `supabase/functions/casa-dominios/index.ts` e `modulos/leitura.ts` (ações `estado`, `ler_cloudflare`, `conferir`) |
| Tela | `src/components/produto/casa/CentralDeDominios.tsx`, regra em `src/lib/produto/dominios-sites.ts` |
| Testes | `src/test/casa-dominios-sites.test.ts` (vitest), `supabase/testes/dominios_sites_runner.mjs` (PGlite), telas `27-*` em `scripts/testar-produto-visual.mjs` |

## Publicar (precisa do ok do Almir em cada passo)

1. **Migration** `20261119120000_casa_dominios_e_sites.sql` no projeto `jjjtkowvxemvituvywvf` (já está no manifesto). Só acrescenta: duas tabelas novas e funções novas, não redefine nada que já existe.
2. **Função** `casa-dominios`: `supabase functions deploy casa-dominios --project-ref jjjtkowvxemvituvywvf` (verify_jwt = true no `config.toml`).
3. **Token da Cloudflare** (opcional, liga a leitura da conta): criar no painel da Cloudflare um token **só de leitura** na conta da Aceleriq com Zone:Read, DNS:Read, Workers Scripts:Read, Workers Routes:Read e Cloudflare Pages:Read. Colar como segredo da função: `supabase secrets set CLOUDFLARE_API_TOKEN=... --project-ref jjjtkowvxemvituvywvf`. A conta padrão é `f1a32e14e962f68134a06c0370e45e0e` (troca com `CLOUDFLARE_ACCOUNT_ID`). O token nunca vai para o banco nem para o front. O token da função `produto-email` pode ser o mesmo se tiver essas permissões.
4. **Painel**: `npm run publicar` com o lote junto.
5. **Primeiro uso**: abrir `/produto/dominios`, clicar na nuvem (Ler Cloudflare), depois em atualizar (Conferir agora) nas duas abas, e ligar cada domínio e site a um cliente com custo e preço.

Sem o token, a tela funciona com o banco e o cadastro manual, e "Conferir agora" lê RDAP, DNS e sites do mesmo jeito.

## O que fica para depois

- Rotina automática (cron) que roda "conferir" uma vez por dia e avisa no sino quando um domínio vai vencer ou um site cai. Hoje é pelo botão.
- Ligar o preço cobrado ao extra da ficha do cliente (`client_extras`) para cobrar pelo Financeiro. Hoje o preço é só para a conta da margem.
- Registro e renovação no Registro.br continuam manuais (a API de registro do Registro.br exige convênio de provedor).
