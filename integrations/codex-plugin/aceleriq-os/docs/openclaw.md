# OpenClaw

## Papel
Fonte oficial da memória (Segundo Cérebro). É a **única** entidade autorizada
a promover propostas dos inboxes para diretórios canônicos
(`memory/decisions/`, `memory/projects/`, `memory/context/`, etc.).

## Origem
`X-Agent-Origin: openclaw`

## Escopos recomendados
`memory:read` (obrigatório) + acesso direto ao repo via ferramentas próprias
para promoção — **não** via MCP. O MCP nunca abre escrita fora do inbox.

## Fluxo de curadoria
1. `memory_list_pending_proposals` para ver propostas ativas.
2. `memory_fetch` para ler cada uma.
3. Fora do MCP: OpenClaw revisa, promove/descarta manualmente no repo.

## Restrições
- MCP **não** possui tool para "aprovar" proposta — decisão é humana.
- MCP **não** possui tool para mover arquivos entre pastas.
