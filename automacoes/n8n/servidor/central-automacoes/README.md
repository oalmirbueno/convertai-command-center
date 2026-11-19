# Central de Automações: coletor do VPS

O painel (tela `/automacoes`, ferramentas `aceleriq_automacoes_*` do MCP) mostra o n8n de produção sem nunca
entrar no servidor. Este coletor roda no VPS a cada minuto, lê **só para leitura** o SQLite do n8n
(`n8n-recovery_n8n_data`) e o estado do systemd, e manda um retrato para a função `automacoes-n8n`.

- Das execuções vão só o caminho (nomes dos nós), o estado, o horário e o erro curto **mascarado**. Nada de corpo
  de pedido, cabeçalho ou credencial. Execução com mais de 4 MB não é aberta.
- O desenho de um fluxo só vai quando a versão dele muda (ou com `--tudo`).
- Ligar e desligar NÃO passa por aqui: a função chama a API pública do n8n com o segredo `N8N_API_KEY`.

Instalar ou atualizar (no VPS, pasta com estes arquivos): `sh instalar.sh` e depois
`systemctl enable --now aceleriq-automacoes-coletor.timer`. Testar sem enviar: `python3 coletor.py --mostrar`.

Arquivos no servidor: `/opt/aceleriq-automacoes/coletor.py`, `/etc/aceleriq-automacoes/{chave,coletor.json}` (600),
estado em `/var/lib/aceleriq-automacoes/estado.json` (apagar faz reenviar tudo). Logs:
`journalctl -u aceleriq-automacoes-coletor -n 20`.
