#!/usr/bin/env node
/**
 * Gera UMA imagem de amostra para cada prompt da biblioteca da Mesa Foto que
 * ainda não tem imagem, com o gerador de imagem mais barato do catálogo e um
 * teto rígido de gasto (padrão US$ 3,00 no total).
 *
 * Simulação por padrão: lê o catálogo e a biblioteca, pede a estimativa ao
 * servidor (de graça) e mostra o plano. Só com --executar chama a geração,
 * uma imagem por vez, somando o custo real devolvido e parando antes de
 * passar do teto.
 *
 * Ações da função mesa-foto que usa (as mesmas da tela):
 *   - estimar { acao_alvo: "biblioteca_exemplo", modelo_imagem_id, qualidade } (grátis)
 *   - biblioteca_exemplo_gerar { client_id, item_id, modelo_imagem_id, qualidade } (paga, uma imagem)
 * Leitura direta (REST, pela RLS de quem chama): ia_modelos e foto_biblioteca.
 *
 * Ambiente (nunca é impresso):
 *   SUPABASE_URL          (ou VITE_SUPABASE_URL)
 *   SUPABASE_ANON_KEY     (ou VITE_SUPABASE_PUBLISHABLE_KEY): chave pública do projeto
 *   ACELERIQ_TOKEN        token de acesso de um admin logado (sem senha)
 *
 * Sem dependências: Node 18+ (fetch nativo).
 */

import { escolherModeloMaisBarato, custoPorImagemDoModelo, modeloDeImagemServe, pendentesSemImagem, planejarAmostras, podeGerarMais, lerTeto, custoValido, numeroOuNulo, usd, TETO_PADRAO_USD, QUALIDADE_PADRAO } from "./orcamento-das-amostras.mjs";

const AJUDA = `Uso: node scripts/gerar-amostras-da-biblioteca.mjs [opções]

Gera uma imagem de amostra por prompt da biblioteca sem imagem, com teto de gasto.
Sem --executar é só simulação (mostra o plano, não gera nada).

Opções:
  --cliente <uuid>   Carteira cobrada na geração (obrigatório com --executar).
                     Também entram os prompts próprios desse cliente sem imagem.
                     Sem ele, só a biblioteca da agência.
  --teto <usd>       Gasto máximo total em US$ (padrão ${TETO_PADRAO_USD.toFixed(2)}).
  --limite <n>       No máximo n imagens.
  --modelo <id>      Gerador de imagem do catálogo (padrão: o mais barato que serve).
  --qualidade <q>    baixa, media ou alta (padrão ${QUALIDADE_PADRAO}).
  --executar         Gera de verdade (pago). Sem isso, simulação.
  --help             Esta ajuda.

Ambiente: SUPABASE_URL, SUPABASE_ANON_KEY e ACELERIQ_TOKEN (token de acesso de um admin).
`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerArgumentos(argv) {
  const a = { cliente: null, teto: TETO_PADRAO_USD, limite: null, modelo: null, qualidade: QUALIDADE_PADRAO, executar: false, ajuda: false, erros: [] };
  for (let k = 0; k < argv.length; k++) {
    const arg = argv[k];
    const [nome, colado] = arg.indexOf("=") > 0 ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
    const valor = () => (colado !== null ? colado : argv[++k]);
    if (nome === "--help" || nome === "-h") a.ajuda = true;
    else if (nome === "--executar") a.executar = true;
    else if (nome === "--cliente") a.cliente = String(valor() || "").trim();
    else if (nome === "--teto") {
      const t = numeroOuNulo(valor());
      if (t === null || t < 0) a.erros.push("--teto precisa ser um número em US$ (ex.: 3.00).");
      else a.teto = lerTeto(t);
    } else if (nome === "--limite") {
      const n = numeroOuNulo(valor());
      if (n === null || n < 0) a.erros.push("--limite precisa ser um número inteiro.");
      else a.limite = Math.floor(n);
    } else if (nome === "--modelo") a.modelo = String(valor() || "").trim() || null;
    else if (nome === "--qualidade") {
      const q = String(valor() || "").trim();
      if (["baixa", "media", "alta"].indexOf(q) < 0) a.erros.push("--qualidade: baixa, media ou alta.");
      else a.qualidade = q;
    } else a.erros.push(`Opção desconhecida: ${arg}`);
  }
  if (a.cliente !== null && !UUID.test(a.cliente)) a.erros.push("--cliente precisa ser o uuid do cliente.");
  if (a.executar && !a.cliente) a.erros.push("--executar precisa de --cliente <uuid> (a carteira cobrada).");
  return a;
}

function ambiente() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const chave = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "");
  const token = String(process.env.ACELERIQ_TOKEN || "");
  const faltam = [];
  if (!url) faltam.push("SUPABASE_URL");
  if (!chave) faltam.push("SUPABASE_ANON_KEY");
  if (!token) faltam.push("ACELERIQ_TOKEN");
  return { url, chave, token, faltam };
}

function cabecalhos(env) {
  return { apikey: env.chave, Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" };
}

async function lerTabela(env, caminho) {
  const r = await fetch(`${env.url}/rest/v1/${caminho}`, { headers: cabecalhos(env) });
  const texto = await r.text();
  if (!r.ok) throw new Error(`Leitura falhou (${r.status}) em ${caminho.split("?")[0]}: ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : [];
}

async function chamarMesaFoto(env, corpo) {
  const r = await fetch(`${env.url}/functions/v1/mesa-foto`, { method: "POST", headers: cabecalhos(env), body: JSON.stringify(corpo) });
  const texto = await r.text();
  let data = null;
  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    data = null;
  }
  if (!r.ok || (data && typeof data.error === "string")) {
    const codigo = data && typeof data.error === "string" ? data.error : `http_${r.status}`;
    const msg = data && (data.message || data.mensagem) ? String(data.message || data.mensagem) : texto.slice(0, 200);
    const e = new Error(`${corpo.acao}: ${codigo}${msg ? ` (${msg})` : ""}`);
    e.codigo = codigo;
    throw e;
  }
  return data || {};
}

const COLUNAS_DO_CATALOGO = "id,provedor,modelo_api,tipo,rotulo,preco_entrada_1m,preco_imagem,ativo,disponivel,modalidades";
const COLUNAS_DA_BIBLIOTECA = "id,client_id,tipo,categoria,titulo,prompt_pt,prompt_en,imagem_url,miniatura_url,storage_path,destaque";

function linha(cols, larguras) {
  return cols.map((c, i) => String(c).slice(0, larguras[i]).padEnd(larguras[i])).join("  ");
}

async function principal() {
  const args = lerArgumentos(process.argv.slice(2));
  if (args.ajuda) {
    process.stdout.write(AJUDA);
    return 0;
  }
  if (args.erros.length) {
    for (const e of args.erros) console.error(`Erro: ${e}`);
    console.error("Veja --help.");
    return 2;
  }
  const env = ambiente();
  if (env.faltam.length) {
    console.error(`Erro: faltam variáveis de ambiente: ${env.faltam.join(", ")}. Veja --help.`);
    return 2;
  }

  // 1. Catálogo e o gerador.
  const catalogo = await lerTabela(env, `ia_modelos?select=${COLUNAS_DO_CATALOGO}&tipo=eq.imagem`);
  let escolha;
  if (args.modelo) {
    const m = catalogo.find((x) => x.id === args.modelo);
    if (!m || !modeloDeImagemServe(m)) {
      console.error(`Erro: o modelo ${args.modelo} não está ativo no catálogo como gerador de imagem.`);
      return 2;
    }
    escolha = { modelo: m, custoPorImagem: custoPorImagemDoModelo(m, { qualidade: args.qualidade }) };
  } else {
    escolha = escolherModeloMaisBarato(catalogo, { qualidade: args.qualidade });
  }
  if (!escolha) {
    console.error("Erro: nenhum gerador de imagem ativo com preço no catálogo.");
    return 2;
  }

  // 2. Estimativa do servidor (a mesma da tela; grátis). Vale a maior das duas.
  let porImagem = custoValido(escolha.custoPorImagem);
  try {
    const est = await chamarMesaFoto(env, { acao: "estimar", acao_alvo: "biblioteca_exemplo", modelo_imagem_id: escolha.modelo.id, qualidade: args.qualidade });
    const doServidor = custoValido(est.estimativa_usd);
    if (doServidor !== null) porImagem = porImagem === null ? doServidor : Math.max(porImagem, doServidor);
  } catch (e) {
    console.warn(`Aviso: estimativa do servidor indisponível (${e.codigo || e.message}); fica a do catálogo.`);
  }
  if (porImagem === null) {
    console.error(`Erro: o modelo ${escolha.modelo.id} não tem preço por imagem válido; sem preço não dá para garantir o teto.`);
    return 2;
  }

  // 3. Prompts sem imagem: agência (e os do cliente, com --cliente).
  const escopo = args.cliente ? `or=(client_id.is.null,client_id.eq.${args.cliente})` : "client_id=is.null";
  const biblioteca = await lerTabela(env, `foto_biblioteca?select=${COLUNAS_DA_BIBLIOTECA}&tipo=eq.prompt&${escopo}&order=destaque.desc,titulo.asc&limit=1000`);
  const pendentes = pendentesSemImagem(biblioteca);

  // 4. O plano.
  const plano = planejarAmostras({ pendentes, custoPorImagem: porImagem, tetoUsd: args.teto, limite: args.limite });
  console.log(`Gerador: ${escolha.modelo.rotulo || escolha.modelo.id} (${escolha.modelo.id}), qualidade ${args.qualidade}, ~${usd(porImagem)} por imagem.`);
  console.log(`Prompts sem imagem: ${pendentes.length}. Teto: ${usd(plano.tetoUsd)}.`);
  console.log("");
  const larguras = [4, 52, 8, 12, 12];
  console.log(linha(["#", "Prompt", "Origem", "Custo", "Acumulado"], larguras));
  plano.itens.forEach((p, n) => console.log(linha([n + 1, p.item.titulo, p.item.client_id ? "cliente" : "agência", usd(p.custoUsd), usd(p.acumuladoUsd)], larguras)));
  console.log("");
  console.log(`Plano: ${plano.itens.length} ${plano.itens.length === 1 ? "imagem" : "imagens"}, ~${usd(plano.totalUsd)} no total.`);
  if (plano.cortados) {
    const porque = plano.motivo === "teto" ? "pelo teto" : plano.motivo === "limite" ? "pelo --limite" : "sem preço válido";
    console.log(`Ficaram de fora: ${plano.cortados} (${porque}).`);
  }

  if (!args.executar) {
    console.log("");
    console.log("Simulação: nada foi gerado. Para gerar de verdade, rode de novo com --executar --cliente <uuid>.");
    return 0;
  }

  // 5. Execução real: uma por vez, com o custo real, parando antes do teto.
  let gasto = 0;
  let feitos = 0;
  // A previsão da próxima é a maior entre a estimativa e o maior custo real já visto (lado seguro).
  let previsao = porImagem;
  for (const p of plano.itens) {
    if (!podeGerarMais({ gastoUsd: gasto, proximoUsd: previsao, tetoUsd: args.teto })) {
      console.log(`Parou: a próxima (~${usd(previsao)}) passaria do teto com ${usd(gasto)} já gastos.`);
      break;
    }
    try {
      const r = await chamarMesaFoto(env, { acao: "biblioteca_exemplo_gerar", client_id: args.cliente, item_id: p.item.id, modelo_imagem_id: escolha.modelo.id, qualidade: args.qualidade });
      // Sem custo devolvido, conta a estimativa (lado seguro).
      const real = numeroOuNulo(r.custo_usd);
      const cobrado = real !== null && real >= 0 ? real : porImagem;
      gasto += cobrado;
      previsao = Math.max(previsao, cobrado);
      feitos++;
      console.log(`${feitos}. ${p.item.titulo}: ${usd(real !== null ? real : porImagem)} (total ${usd(gasto)})`);
    } catch (e) {
      console.error(`Parou em "${p.item.titulo}": ${e.message}`);
      break;
    }
  }
  console.log("");
  console.log(`Feito: ${feitos} ${feitos === 1 ? "imagem" : "imagens"}, custo real ${usd(gasto)} (teto ${usd(lerTeto(args.teto))}).`);
  return 0;
}

/** Rodado direto (node scripts/...), não importado por um teste. */
const direto = String(process.argv[1] || "").split("\\").join("/").endsWith("gerar-amostras-da-biblioteca.mjs");

if (direto) {
  principal().then(
    (codigo) => process.exit(codigo),
    (e) => {
      console.error(`Erro: ${e && e.message ? e.message : e}`);
      process.exit(1);
    },
  );
}
