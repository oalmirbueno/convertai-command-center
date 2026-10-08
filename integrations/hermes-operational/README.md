# Continuidade operacional Hermes / caderno

O painel e o MCP continuam sendo a fonte dos registros. `operational_mirror.py` guarda somente atualizações públicas depois de uma chamada MCP com `link_id` explícito. O consumidor valida vínculo, cliente e operador no quadro antes de escrever no diário, confirma a escrita por leitura e evita duplicar após falha de transporte. Conversas sem vínculo e respostas que misturam várias tarefas não são copiadas para um cliente arbitrário. Raciocínio, argumentos e resultados brutos das ferramentas não são exportados.

`install_hooks.py` instala duas chamadas aditivas no gateway e guarda backups. Não reinicia serviços: os hooks entram em processos novos do gateway. A confirmação em sessão Desktop existente é uma verificação separada; não confundir testes do transportador com uma conversa real do usuário.

`diary_consumer.py` contém a revisão do consumidor já instalado: limite global de leitura de 50 s, quatro leituras concorrentes, trava não bloqueante por execução e reserva de 15 min. O token de reserva continua disponível para renovação por executores mais longos. Resposta confirmada no diário encerra a reserva.

Teste local sem API: `python integrations/hermes-operational/test_operational_mirror.py`.
Rollback: restaurar os arquivos `server.before-caderno-20261007.py` e `tool_progress.before-caderno-20261007.py`, reiniciar somente um gateway ocioso e preservar o SQLite de pendências. O consumidor anterior está em `aceleriq_panel_diary_consumer.before-caderno-20261007.py` no servidor.

Não incluir arquivos de configuração, SQLite operacional, credenciais ou históricos de sessão no Git.

## Carteira e comunicação na central

`portfolio_scope.py` lê a seleção versionada em `projects.scope` da frente Meta. O bloco `operacao_carteira_v1` conserva o restante do texto. Ausência do bloco mantém a carteira anterior; lista vazia significa nenhum cliente. Registro inválido ou resposta MCP sem `scope` interrompe a consulta antes de buscar clientes individualmente. A seleção nunca altera restrições Ads, campanhas, orçamento ou histórico.

`meta_ads_collector.py` é a fonte revisável do `coletar.py` da rotina existente. Continua respeitando Ajenda excluída, Para Si restrita e flags de acesso. Não criar outra agenda de coleta. Instalar `portfolio_scope.py` no mesmo diretório de `coletar.py` após disponibilizar `scope` no `aceleriq_get_project`.

O consumidor do diário inclui cliente do projeto, tarefa e projeto, além da mensagem original. Um pedido da carteira pode citar outro cliente atendido; o agente deve conferir sua referência no painel, consultar os materiais disponíveis nas Mesas e responder com **cliente/tarefa, o que fez, o que falta e próximo passo**. Não interpretar análise como execução, nem texto como autorização genérica.

Após revisão consultiva do Hermes, o contrato separa `target_client_id` de `project_client_id`. Conversa geral da carteira tem `target_scope=portfolio`, nunca a agência como destino implícito. Referências inválidas ou conflitantes são substituídas na saída do gate por um pedido de esclarecimento (`clarification_only`), preservando o original no diário e a reserva/idempotência. IDs válidos ainda precisam ser conferidos no MCP; estes campos não concedem autorização. Respostas distinguem o que foi conferido, o que foi feito, próximo passo e eventual decisão necessária.

Quando há alvo explícito, o consumidor confirma sua existência e papel na lista de clientes do MCP antes de reservar a mensagem. Cadastro incompleto ou falha de leitura interrompe a rodada, mantendo a mensagem para retry; alvo desconhecido vira esclarecimento. A coordenação geral da carteira segue sem presumir um cliente único. Autorização da ação permanece nas verificações existentes de cada ferramenta.

Testes sem API: `python -m unittest test_portfolio_scope test_diary_context` neste diretório (Linux para o lock do consumidor). Rollback: restaurar o `coletar.py` e consumidor anteriores, preservando bancos de pendências. A seleção gravada pode ficar no projeto para retomada futura.
