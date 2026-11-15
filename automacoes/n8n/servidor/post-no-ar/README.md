# Post no ar no grupo do cliente (servidor do Hermes)

O n8n (ACQ-03, "Aviso de post no ar para o cliente") vê o post publicado, confere no Instagram, escreve o aviso a
partir da legenda e prepara no painel, com canal `whatsapp` e o nome exato do grupo. Ele não decide nem envia.

Este script roda no servidor do Hermes porque a ponte do WhatsApp (3429) só aceita chamadas locais. A cada rodada:

1. lê `aceleriq_aviso_publicacao_fila`;
2. aprova, pela regra permanente do dono (09/11/2026: publicado = aprovado), só o aviso com o molde
   `*Post novo no ar*`, canal whatsapp e o nome exato de um dos grupos de `/etc/mercurio-pilot/allowed-groups.json`;
3. envia o texto ao grupo pela ponte (`POST 127.0.0.1:3049/send`), no máximo 3 por rodada;
4. registra com `aceleriq_aviso_publicacao_marcar_enviado`.

Envio com resultado incerto nunca é repetido sozinho (`envio_incerto_nao_repetido` no log).

## Modos

- `POST_NO_AR_MODO=previa` (padrão): manda cada aviso só ao dono, uma vez, sem aprovar nem marcar.
- `POST_NO_AR_MODO=grupos`: o real.

## Instalar

```bash
install -d -m 755 /opt/aceleriq-post-no-ar && install -d -m 700 /var/lib/aceleriq-post-no-ar
install -m 750 enviar.mjs /opt/aceleriq-post-no-ar/enviar.mjs
install -m 644 aceleriq-post-no-ar.service aceleriq-post-no-ar.timer /etc/systemd/system/
systemctl daemon-reload
POST_NO_AR_MODO=previa /opt/mercurio-pilot/node /opt/aceleriq-post-no-ar/enviar.mjs   # uma rodada de prévia
systemctl enable --now aceleriq-post-no-ar.timer                                        # liga (no modo da unidade)
```

Para o modo real, troque `Environment=POST_NO_AR_MODO=previa` por `grupos` na unidade e rode `systemctl daemon-reload`.
Log: `journalctl -u aceleriq-post-no-ar.service`. Estado: `/var/lib/aceleriq-post-no-ar/diario.jsonl`.

## Limites conhecidos

- A ponte só manda texto nos grupos (decisão do dono em 26/10): sem print. O link do post costuma virar cartão.
- O número da API da Meta (2161) não entra em grupos; por isso o envio é pelo 3429.
- Cliente sem grupo na lista da ponte não recebe aviso (evento `publicacao_aviso_descartada`, motivo `cliente_sem_grupo`).
