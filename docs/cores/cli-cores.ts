import * as ok from "../../supabase/functions/_shared/cores/oklch.ts";
import * as pal from "../../supabase/functions/_shared/cores/paleta.ts";
import * as sai from "../../supabase/functions/_shared/cores/saidas.ts";
import { NICHOS } from "../../supabase/functions/_shared/cores/nichos.ts";
import * as pp from "../../supabase/functions/_shared/cores/papeis-da-peca.ts";
export { ok, pal, sai, NICHOS, pp };

const AJUDA = `cores.mjs: motor de paleta da Aceleriq (OKLCH, WCAG 2.2, APCA, 60-30-10).
Uso:
  node cores.mjs propostas '<briefing JSON>'      3 propostas + conferências (JSON)
  node cores.mjs contraste <texto> <fundo>          razão WCAG, nível e APCA
  node cores.mjs tons <hex>                         escala 50-950 em OKLCH
  node cores.mjs harmonia <hex> <tipo>              complementar|dividida|analoga|triadica|tetradica|monocromatica
  node cores.mjs ajustar <cor> <outra> [4.5]        tom mais próximo que passa no contraste
  node cores.mjs daltonismo <hex> [<hex>...]        protanopia, deuteranopia e tritanopia
  node cores.mjs tokens '<briefing JSON>' [css|tailwind|json]   tokens da proposta recomendada
  node cores.mjs nichos                             nichos da casa
  node cores.mjs peca '[{"hex":"#002893","papel":"primaria"},...]'   papéis de uma peça (fundo, texto, apoio, destaque) a partir da paleta da marca
Briefing: {"marca":"X","nicho":"academia","preco":"premium","personalidade":["Natural"],"corPrincipal":"#7A8B6F","preferidas":["Terracota"],"evitar":["Vermelho"],"quantas":3}`;

const [cmd, ...a] = (globalThis as any).process.argv.slice(2);
const sair = (x: unknown) => console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2));
if (cmd === "propostas") {
  const b = JSON.parse(a[0] || "{}");
  const r = pal.gerarPropostas(b, Number(a[1] || 0));
  sair({ propostas: r.propostas.map((p) => ({ estrutura: p.estrutura, titulo: p.titulo, cores: p.cores.map((c) => ({ papel: c.papel, nome: c.nome, hex: c.hex, texto: c.texto, contraste_texto: c.razaoTexto, porque: c.porque })), neutros: p.neutros, etiquetas: p.etiquetas, orientacoes: p.orientacoes })), conferencias: pal.conferir(r.propostas, b) });
} else if (cmd === "contraste") {
  const r = ok.contraste(a[0], a[1]);
  sair({ razao: Number(r.toFixed(2)), wcag: ok.nivelWcag(r), apca_lc: Math.round(ok.apca(a[0], a[1])), apca: ok.nivelApca(ok.apca(a[0], a[1])) });
} else if (cmd === "tons") sair(ok.escala(a[0]));
else if (cmd === "harmonia") sair(ok.harmonia(a[0], (a[1] || "complementar") as any).map((h) => ({ hex: h, nome: ok.nomeDaCor(h) })));
else if (cmd === "ajustar") sair({ hex: ok.ajustarAteContraste(a[0], a[1], Number(a[2] || 4.5)) });
else if (cmd === "daltonismo") sair(a.map((h) => ({ hex: h, protanopia: ok.simularDaltonismo(h, "protanopia"), deuteranopia: ok.simularDaltonismo(h, "deuteranopia"), tritanopia: ok.simularDaltonismo(h, "tritanopia") })));
else if (cmd === "tokens") {
  const b = JSON.parse(a[0] || "{}");
  const p = pal.gerarPropostas(b).propostas[0];
  const f = a[1] || "css";
  sair(f === "tailwind" ? sai.tokensTailwind(p) : f === "json" ? sai.tokensJson(p, b.marca || "Marca") : sai.tokensCss(p));
} else if (cmd === "peca") {
  const r = pp.papeisDaPeca(JSON.parse(a[0] || "[]"));
  sair(r ? { ...r, linha: pp.linhaDosPapeis(r) } : { erro: "paleta sem cor válida" });
} else if (cmd === "nichos") sair(NICHOS.map((n) => ({ id: n.id, nome: n.nome, contexto: n.contexto, comum: n.comum, diferenciar: n.diferenciar })));
else sair(AJUDA);
