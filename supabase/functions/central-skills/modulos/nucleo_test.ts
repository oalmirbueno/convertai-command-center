import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { categoriaDaSkill, juntarOrigens, lerFrontmatter, montarConector, montarPublicacao, normalizarSlug, temSegredo } from './nucleo.ts';
import { caminhoSeguro, filtrarSkills, hashDosArquivos } from '../../mcp-server/modulos/central-de-skills.ts';
import { assertWritableNote } from '../../_shared/second-brain-github.ts';

Deno.test('frontmatter: linha simples e bloco dobrado', () => {
  assertEquals(lerFrontmatter('---\nname: ffmpeg-skill\ndescription: "corta"\n---\n# x').name, 'ffmpeg-skill');
  const f = lerFrontmatter('---\nname: x\ndescription: >-\n  linha um\n  linha dois\nother: 1\n---\n');
  assertEquals(f.description, 'linha um linha dois');
  assertEquals(lerFrontmatter('sem frontmatter').name, null);
});

Deno.test('slug e categoria por regra fixa e pela pasta do Hermes', () => {
  assertEquals(normalizarSlug('Minimalist UI!'), 'minimalist-ui');
  assertEquals(categoriaDaSkill('ads-meta'), 'trafego');
  assertEquals(categoriaDaSkill('ig-caption-writer'), 'instagram');
  assertEquals(categoriaDaSkill('hyperframes-core'), 'video');
  assertEquals(categoriaDaSkill('n8n-agents'), 'automacao');
  assertEquals(categoriaDaSkill('vendedor-whatsapp'), 'aceleriq');
  assertEquals(categoriaDaSkill('qualquer', ['/root/.hermes/skills/design-taste/qualquer']), 'design');
  assertEquals(categoriaDaSkill('zzz'), 'outros');
});

Deno.test('publicação: completa pelo frontmatter e recusa segredo e hash ruim', () => {
  const ok = montarPublicacao({ skill_md: '---\nname: Teste\ndescription: faz x\n---\n', hash: 'a'.repeat(64) });
  assert(ok.ok);
  if (ok.ok) { assertEquals(ok.pedido.slug, 'teste'); assertEquals(ok.pedido.descricao, 'faz x'); assertEquals(ok.pedido.runtimes.length, 4); }
  const seg = montarPublicacao({ skill_md: '---\nname: t\n---\nchave mcp_live_abcdefghijklmnopqrstu', hash: 'a'.repeat(64) });
  assert(!seg.ok);
  assert(!montarPublicacao({ skill_md: '---\nname: t\n---\n', hash: 'xyz' }).ok);
  assert(temSegredo('ghp_' + 'A'.repeat(36)));
  assert(!temSegredo('use a variável GITHUB_TOKEN'));
});

Deno.test('conector: só nome de variável, nunca valor', () => {
  assert(montarConector({ slug: 'mcp:composio', tipo: 'composio', instalar: { claude: 'claude mcp add composio' }, requer: ['composio_api_key'] }).ok);
  assert(!montarConector({ slug: 'mcp:x', tipo: 'mcp', instalar: { claude: 'x --key sk-ant-' + 'a'.repeat(30) } }).ok);
});

Deno.test('origens: não repete a mesma máquina e caminho', () => {
  const o = { runtime: 'codex', caminho: 'tdd', maquina: 'pc' };
  assertEquals(juntarOrigens(juntarOrigens([], o), o).length, 1);
});

Deno.test('hash do servidor bate com o do central.py (sem re-download sem fim)', async () => {
  const enc = new TextEncoder();
  const h = await hashDosArquivos({ 'SKILL.md': enc.encode('---\nname: teste\ndescription: x\n---\nOlá\n'), 'scripts/a.py': enc.encode('print(1)\n') });
  assertEquals(h, '6798e9608a10000b1557f9e672e5a60d32a2646db740f4f7ffbcf114dc8ed32e');
});

Deno.test('MCP: caminho de arquivo e filtro do catálogo', () => {
  assertEquals(caminhoSeguro('../x'), null);
  assertEquals(caminhoSeguro('SKILL.md'), null);
  assertEquals(caminhoSeguro('refs/a.md'), 'refs/a.md');
  const lista = [{ slug: 'ads-meta', nome: 'ads-meta', descricao: 'Meta', categoria: 'trafego', runtimes: ['claude'] }];
  assertEquals(filtrarSkills(lista, { busca: 'meta' }).length, 1);
  assertEquals(filtrarSkills(lista, { runtime: 'hermes' }).length, 0);
});

Deno.test('segundo cérebro: agente não edita memória consolidada; admin sim; código nunca', () => {
  assertEquals(assertWritableNote('obsidian-vault/10-Notas/x.md', { admin: false }), 'obsidian-vault/10-Notas/x.md');
  assertThrows(() => assertWritableNote('MEMORY.md', { admin: false }));
  assertThrows(() => assertWritableNote('memory/projects/a.md', { admin: false }));
  assertEquals(assertWritableNote('memory/projects/a.md', { admin: true }), 'memory/projects/a.md');
  assertThrows(() => assertWritableNote('scripts/claude-sync.ps1', { admin: true }));
  assertThrows(() => assertWritableNote('obsidian-vault/x.exe', { admin: false }));
  assertThrows(() => assertWritableNote('../fora.md', { admin: false }));
});
