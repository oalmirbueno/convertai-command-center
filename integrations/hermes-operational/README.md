# Continuidade operacional Hermes / caderno

O painel e o MCP continuam sendo a fonte dos registros. `operational_mirror.py` guarda somente atualizações públicas depois de uma chamada MCP com `link_id` explícito. O consumidor valida vínculo, cliente e operador no quadro antes de escrever no diário, confirma a escrita por leitura e evita duplicar após falha de transporte. Conversas sem vínculo e respostas que misturam várias tarefas não são copiadas para um cliente arbitrário. Raciocínio, argumentos e resultados brutos das ferramentas não são exportados.

`install_hooks.py` instala duas chamadas aditivas no gateway e guarda backups. Não reinicia serviços: os hooks entram em processos novos do gateway. A confirmação em sessão Desktop existente é uma verificação separada; não confundir testes do transportador com uma conversa real do usuário.

`diary_consumer.py` contém a revisão do consumidor já instalado: limite global de leitura de 50 s, quatro leituras concorrentes, trava não bloqueante por execução e reserva de 15 min. O token de reserva continua disponível para renovação por executores mais longos. Resposta confirmada no diário encerra a reserva.

Teste local sem API: `python integrations/hermes-operational/test_operational_mirror.py`.
Rollback: restaurar os arquivos `server.before-caderno-20261007.py` e `tool_progress.before-caderno-20261007.py`, reiniciar somente um gateway ocioso e preservar o SQLite de pendências. O consumidor anterior está em `aceleriq_panel_diary_consumer.before-caderno-20261007.py` no servidor.

Não incluir arquivos de configuração, SQLite operacional, credenciais ou históricos de sessão no Git.
