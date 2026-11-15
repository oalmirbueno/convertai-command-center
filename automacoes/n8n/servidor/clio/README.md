# Clio — agente do Hermes para as conversas dos clientes

Criada em 10/11/2026 a pedido do Almir. Transforma o que os clientes dizem nos grupos de WhatsApp em tarefa interna do painel, com dono e prazo, sem duplicar.

## Mapa do fluxo

```
grupos (3429, só leitura)
   └─ leitor no VPS (aceleriq-leitor-grupos) ── áudio transcrito
        └─ n8n ACQ-04: guarda e classifica cada mensagem
             └─ n8n ACQ-09 (20h30): resumo do dia por cliente, conferido pelo Jev
                  ├─ dossiê do cliente no painel (seção "Conversas do grupo de WhatsApp")
                  └─ banco: fila de pendências (pedido do cliente, promessa nossa, resposta que esperamos)
                       └─ n8n ACQ-10 (webhook com segredo): entrega a fila
                            └─ Hermes, perfil clio (20h45): abre tarefa interna e registra no cérebro do cliente
                                 └─ relato no Bot Chat da Clio
```

## Peças
- **Banco:** `acq_n8n.pendencias_conversa` e `acq_n8n.pendencias_fila()` (migration `20261110200000`). A fila já leva os projetos e as tarefas abertas de cada cliente, porque a listagem do painel é grande demais para a agente ler.
- **n8n:** "Clientes: fila de pendências das conversas (Clio)" (ACQ-10), caminho `acq10-fila-conversas`. Só responde com o cabeçalho `x-acq-segredo`; o banco guarda o SHA-256 em `acq_n8n.cursores` (ACQ-10 / webhook_segredo_sha256).
- **VPS:** segredo em `/etc/aceleriq-clio/fila.segredo`; fontes em `/opt/aceleriq-clio`; perfil em `/root/.hermes/profiles/clio` (SOUL.md, skill `clio-conversas-dos-grupos`, script `scripts/clio_fila_conversas.py`).
- **Painel:** operador `clio`, área Clientes, abaixo do Atlas; ligado à chave "Hermes Agent MCP" em `operator_key_bindings`.

## Sem duplicar
- Cada item tem uma chave fixa. A tarefa nasce com `origem_externa = grupo:<chave>` (única por cliente no painel) e cita `Ref: grupo:<chave>` de tudo que cobre.
- Quem dá baixa é o banco: o item sai da fila quando existe tarefa do cliente citando a chave.
- Item que não vira tarefa é entregue no máximo 2 vezes e depois é encerrado.
- Teto de 3 tarefas novas por cliente por rodada e uma só "Cobrar retorno" por cliente.

## Instalar ou atualizar
```bash
scp -r servidor/clio/* root@ssh.aceleriq.com.br:/opt/aceleriq-clio/
ssh root@ssh.aceleriq.com.br 'cd /opt/aceleriq-clio && bash instalar.sh perfil && bash instalar.sh rotina && bash instalar.sh estado'
```
Depois de mudar as ferramentas no `config.yaml`, o gateway precisa recarregar a lista: `hermes -p clio chat -Q -q "/reload-mcp"`. Não reiniciar o `hermes-gateway`: a ponte do painel e a central caem junto e não voltam sozinhas.

## Conferir
```bash
ssh root@ssh.aceleriq.com.br 'python3 /opt/aceleriq-clio/clio_fila_conversas.py --espiar | head -5'
ssh root@ssh.aceleriq.com.br 'hermes -p clio cron list'
```
`--espiar` olha a fila sem contar entrega. `prova_um_cliente.py "Nome"` monta uma rodada com um cliente só.

## O que a Clio não faz
Não fala com cliente, não manda mensagem em grupo, não mexe em post, calendário, anúncio, verba, contrato, financeiro ou aprovação, e não edita tarefa de ninguém. Só tem 7 ferramentas do painel liberadas (5 de leitura, criar tarefa e registrar no cérebro).
