/**
 * Kits de vídeo da Mesa Vídeos (frente V-A, 26/09/2026).
 *
 * Cada kit é um jeito pronto de fazer um material de um nicho: objetivo,
 * formatos, a estrutura de cenas (plano a plano), o prompt-base de cada cena
 * com lacunas ({produto}, {ambiente}...), o PAPEL do motor que serve melhor
 * àquela cena (o motor em si sai do catálogo em modelos-de-video.ts, pelo
 * papel), as regras de consistência e os erros a evitar.
 *
 * Nichos: os que a agência atende (móveis planejados, estética e clínicas,
 * automotivo, futebol e esporte, gastronomia, jardinagem e paisagismo,
 * jurídico, informática e assistência técnica, games e keys, imobiliário e
 * moda) e os formatos que servem a todos (UGC, antes e depois, produto e
 * filme curto com personagem).
 *
 * Os prompts-base ficam em inglês: os motores de vídeo seguem melhor o
 * inglês. O que a equipe lê (nome, objetivo, regras) fica em português.
 * Lacuna sem valor NUNCA é inventada: vira pergunta (preencherPrompt).
 *
 * Puro: sem Deno, sem banco. A tela, a função mesa-videos, o diretor e os
 * testes usam o mesmo arquivo. Sem travessão.
 */

/** O que a cena pede do motor (o catálogo escolhe o motor de cada papel). */
export type PapelDoMotor =
  | "hero" // qualidade máxima, luz e textura (plano principal)
  | "fala" // pessoa falando para a câmera, com áudio nativo
  | "transicao" // primeiro e último quadro (montagem, antes e depois)
  | "consistencia" // referências de personagem ou produto
  | "movimento" // câmera e física (carro, esporte)
  | "barato" // volume com qualidade boa
  | "rascunho" // prévia rápida antes de gastar
  | "imagem" // still ou packshot (modelo de imagem, não vídeo)
  | "angulo"; // o mesmo quadro visto de outro ângulo

/** Como a cena usa quadros de entrada. */
export type ModoDaCena = "texto" | "primeiro_quadro" | "primeiro_ultimo" | "referencia" | "estender" | "imagem";

export type FormatoDoKit = "9:16" | "1:1" | "16:9" | "4:5";

export interface LacunaDoKit {
  chave: string;
  rotulo: string;
  exemplo: string;
  /** Sem ela o kit não fecha (vira pergunta obrigatória). */
  obrigatoria: boolean;
}

export interface CenaDoKit {
  ref: string;
  nome: string;
  /** O que a cena precisa entregar (uma frase). */
  objetivo: string;
  duracao_s: number;
  enquadramento: string;
  camera: string;
  modo: ModoDaCena;
  papel: PapelDoMotor;
  /** Prompt-base com lacunas {chave}. */
  prompt: string;
  /** Quadro de entrada: "antes"/"depois" do par, "anterior" (último do plano anterior), "ancora" do cenário, "folha" do personagem. */
  quadro_inicial?: "antes" | "depois" | "anterior" | "ancora" | "folha" | "produto";
  quadro_final?: "antes" | "depois" | "ancora";
  /** Texto na tela sugerido (a edição coloca). */
  texto_na_tela?: string;
}

export interface VarianteDoKit {
  id: string;
  nome: string;
  /** Valores prontos das lacunas desta variante. */
  valores: Record<string, string>;
}

export interface KitDeVideo {
  id: string;
  nome: string;
  /** Uma linha curta para o cartão. */
  resumo: string;
  /** Explicação do "?". */
  ajuda: string;
  nichos: string[];
  objetivo: string;
  formatos: FormatoDoKit[];
  lacunas: LacunaDoKit[];
  cenas: CenaDoKit[];
  consistencia: string[];
  evitar: string[];
  variantes?: VarianteDoKit[];
  /** Kit pede pessoa (UGC, estética): exige autorização registrada de imagem. */
  pede_pessoa: boolean;
}

/** Regras que valem para todo kit (a bíblia do diretor começa com elas). */
export const REGRAS_GERAIS_DE_CONSISTENCIA = [
  "Mesma lente, mesma luz e mesma hora do dia em todos os planos do mesmo cenário.",
  "Personagem com folha de referência (frente, 3/4 e perfil) antes do primeiro plano em que aparece.",
  "Cada cenário tem um quadro âncora; planos no cenário partem dele ou do último quadro do plano anterior.",
  "Roupa, cabelo, acessórios e cores descritos igual em todos os prompts (copiar o trecho da bíblia, não reescrever).",
  "Um movimento de câmera por plano; ação simples e visível em até 5 s.",
  "Texto, logo e preço entram na edição, nunca no vídeo gerado.",
];

const L = (chave: string, rotulo: string, exemplo: string, obrigatoria = true): LacunaDoKit => ({ chave, rotulo, exemplo, obrigatoria });

export const KITS_DE_VIDEO: KitDeVideo[] = [
  {
    id: "mobiliario",
    nome: "Móveis planejados: construir e revelar",
    resumo: "Ambiente vazio, móveis surgindo peça a peça, ambiente pronto e acabamento.",
    ajuda: "Para marcenaria e planejados. Começa no ambiente vazio (foto real do cliente ou gerada), as peças montam em timelapse e termina no ambiente pronto, com detalhes de acabamento. O último quadro do vazio vira o primeiro da montagem, e o ambiente pronto é o quadro final: a sala não muda de lugar.",
    nichos: ["móveis planejados", "marcenaria", "decoração", "arquitetura"],
    objetivo: "Mostrar a transformação do ambiente e a qualidade do acabamento para gerar pedido de orçamento.",
    formatos: ["9:16", "4:5", "16:9"],
    lacunas: [
      L("ambiente", "Ambiente", "cozinha em L de apartamento, 12 m²"),
      L("moveis", "Móveis", "armários em MDF amadeirado freijó com portas brancas foscas"),
      L("acabamento", "Acabamento", "puxadores cava, iluminação LED embutida, bancada de quartzo branco"),
      L("luz", "Luz", "luz natural da manhã entrando pela janela à esquerda", false),
    ],
    cenas: [
      { ref: "c1", nome: "Ambiente vazio", objetivo: "O antes, limpo e real.", duracao_s: 3, enquadramento: "plano geral", camera: "câmera parada, leve push-in", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "antes", prompt: "Empty {ambiente}, bare walls and floor, {luz}, architectural photography, static tripod shot with a very slow push-in, photorealistic, no people, no text." },
      { ref: "c2", nome: "Montagem em timelapse", objetivo: "As peças surgem e se encaixam no lugar certo.", duracao_s: 6, enquadramento: "plano geral, mesma posição", camera: "câmera travada no tripé", modo: "primeiro_ultimo", papel: "transicao", quadro_inicial: "antes", quadro_final: "depois", prompt: "Timelapse of {moveis} being assembled piece by piece in the same {ambiente}, cabinets sliding into place, doors attached, {acabamento} appearing, locked-off tripod camera, same framing and light from start to end, photorealistic, no people." },
      { ref: "c3", nome: "Ambiente pronto", objetivo: "O depois, com a luz do ambiente.", duracao_s: 4, enquadramento: "plano geral", camera: "travelling lateral lento", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "depois", prompt: "Finished {ambiente} with {moveis}, {acabamento}, {luz}, slow lateral dolly, interior design magazine look, photorealistic, no people, no text." },
      { ref: "c4", nome: "Detalhe de acabamento", objetivo: "Prova de qualidade de perto.", duracao_s: 3, enquadramento: "close", camera: "macro, foco que corre", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "depois", prompt: "Macro close-up of {acabamento} on {moveis}, rack focus, soft highlights on the texture, photorealistic, shallow depth of field." },
      { ref: "c5", nome: "Fechamento", objetivo: "Plano limpo para o convite (texto na edição).", duracao_s: 3, enquadramento: "plano geral", camera: "câmera parada", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "depois", prompt: "Wide calm shot of the finished {ambiente}, static camera, gentle light change, clean negative space at the top for text, photorealistic.", texto_na_tela: "Peça seu projeto" },
    ],
    consistencia: [
      "O ambiente vazio e o pronto saem da MESMA foto (o pronto é a edição da foto do vazio), com a mesma câmera.",
      "Montagem com primeiro quadro = vazio e último quadro = pronto: o motor precisa aceitar último quadro.",
      "Cor e textura do material copiadas da amostra do cliente em todos os prompts.",
    ],
    evitar: [
      "Trocar a janela, a porta ou o piso entre o antes e o depois.",
      "Pessoas montando (mãos deformam); o timelapse é sem gente.",
      "Mais de um movimento de câmera no mesmo plano.",
    ],
    pede_pessoa: false,
  },
  {
    id: "antes_depois",
    nome: "Antes e depois",
    resumo: "Plano do antes, transição, plano do depois, detalhe e convite.",
    ajuda: "Serve para reforma, estética, jardim, carro e limpeza. Com uma foto só dá para gerar a outra versão (antes ou depois) com o modelo de imagem do painel, depois um vídeo curto de cada e a montagem lado a lado, em cortina ou em sequência na edição. Resultado prometido sem prova é proibido em estética e saúde.",
    nichos: ["reforma", "estética", "jardinagem", "automotivo", "limpeza"],
    objetivo: "Mostrar o resultado com o mesmo ponto de vista, sem exagero.",
    formatos: ["9:16", "1:1", "4:5"],
    lacunas: [
      L("assunto", "O que muda", "fachada da casa"),
      L("antes", "Como é o antes", "pintura descascada, portão enferrujado"),
      L("depois", "Como fica o depois", "pintura nova cinza claro, portão preto fosco"),
      L("lugar", "Onde", "rua residencial em Curitiba, fim de tarde", false),
    ],
    cenas: [
      { ref: "c1", nome: "Antes", objetivo: "O problema, sem dramatizar.", duracao_s: 3, enquadramento: "plano médio frontal", camera: "câmera parada", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "antes", prompt: "{assunto} before the service: {antes}, {lugar}, static camera, natural light, photorealistic documentary look, no text." },
      { ref: "c2", nome: "Transição", objetivo: "O antes vira o depois no mesmo quadro.", duracao_s: 4, enquadramento: "o mesmo do antes", camera: "câmera travada", modo: "primeiro_ultimo", papel: "transicao", quadro_inicial: "antes", quadro_final: "depois", prompt: "Smooth transformation of {assunto} from {antes} to {depois}, same camera position and framing, same light, locked-off camera, photorealistic, no people." },
      { ref: "c3", nome: "Depois", objetivo: "O resultado, com a mesma luz.", duracao_s: 3, enquadramento: "plano médio frontal", camera: "push-in lento", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "depois", prompt: "{assunto} after the service: {depois}, {lugar}, very slow push-in, natural light, photorealistic, no text." },
      { ref: "c4", nome: "Detalhe", objetivo: "Prova de perto.", duracao_s: 3, enquadramento: "close", camera: "macro lateral", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "depois", prompt: "Close-up detail of {depois} on {assunto}, slow lateral slide, crisp texture, photorealistic." },
      { ref: "c5", nome: "Convite", objetivo: "Quadro limpo para o texto.", duracao_s: 2, enquadramento: "plano médio", camera: "parada", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "depois", prompt: "Calm static shot of {assunto} after the service, clean area at the top for text, photorealistic.", texto_na_tela: "Agende a sua" },
    ],
    consistencia: [
      "Antes e depois com a MESMA câmera, altura, lente e luz (uma foto é a edição da outra).",
      "Na montagem lado a lado ou cortina, os dois vídeos com a mesma duração e o mesmo movimento.",
    ],
    evitar: [
      "Depois com outro ângulo ou outro fundo: parece montagem falsa.",
      "Em estética e saúde, prometer resultado ou mostrar corpo de pessoa real sem autorização.",
      "Filtro de beleza no depois que não existe no antes.",
    ],
    variantes: [
      { id: "reforma", nome: "Reforma", valores: { assunto: "the living room", antes: "old stained walls, broken ceramic floor", depois: "fresh white walls, light oak vinyl floor" } },
      { id: "estetica", nome: "Estética", valores: { assunto: "the treated skin area (with written consent)", antes: "uneven skin texture", depois: "smoother, even skin texture, realistic pores" } },
      { id: "jardim", nome: "Jardim", valores: { assunto: "the backyard garden", antes: "dry patchy lawn and bare soil", depois: "lush green lawn, flower beds with lavender and grasses" } },
      { id: "carro", nome: "Carro", valores: { assunto: "the car paint on the hood", antes: "dull oxidized paint with swirl marks", depois: "deep glossy paint with mirror reflections" } },
    ],
    pede_pessoa: false,
  },
  {
    id: "ugc",
    nome: "UGC: pessoa falando para a câmera",
    resumo: "Gancho na câmera, demonstração, prova e convite, jeito de celular.",
    ajuda: "Vídeo de pessoa comum falando do produto, gravado como selfie. Só com pessoa gerada (personagem da bíblia) ou com autorização registrada de pessoa real. Depoimento inventado como se fosse cliente real é proibido: a fala é opinião de personagem, nunca prova falsa.",
    nichos: ["todos", "e-commerce", "serviço local", "games e keys"],
    objetivo: "Parar a rolagem com fala natural e levar ao clique.",
    formatos: ["9:16"],
    lacunas: [
      L("personagem", "Quem fala", "mulher de 30 anos, cabelo castanho preso, camiseta verde lisa"),
      L("produto", "Produto ou serviço", "fone de ouvido sem fio preto"),
      L("gancho", "Frase do gancho", "Eu não acreditei no que esse fone faz"),
      L("lugar", "Onde grava", "quarto com luz de janela", false),
    ],
    cenas: [
      { ref: "c1", nome: "Gancho na câmera", objetivo: "Primeiros 2 s que seguram.", duracao_s: 4, enquadramento: "selfie, rosto e ombros", camera: "na mão, leve tremor", modo: "referencia", papel: "fala", quadro_inicial: "folha", prompt: "Handheld selfie video of {personagem} in {lugar}, looking into the phone camera and saying in Brazilian Portuguese: \"{gancho}\", natural expressions, casual smartphone look, native audio." },
      { ref: "c2", nome: "Demonstração", objetivo: "O produto em uso, de perto.", duracao_s: 5, enquadramento: "plano médio com o produto", camera: "na mão", modo: "referencia", papel: "consistencia", quadro_inicial: "anterior", prompt: "{personagem} shows {produto} to the phone camera and uses it, same room and light, handheld smartphone look, product clearly visible and identical to the reference." },
      { ref: "c3", nome: "Prova", objetivo: "O benefício visível.", duracao_s: 4, enquadramento: "close no produto", camera: "na mão, foco no produto", modo: "primeiro_quadro", papel: "consistencia", quadro_inicial: "produto", prompt: "Close-up of {produto} in use in {lugar}, handheld, natural light, the key benefit visible, realistic." },
      { ref: "c4", nome: "Convite", objetivo: "Fala curta com o próximo passo.", duracao_s: 3, enquadramento: "selfie", camera: "na mão", modo: "referencia", papel: "fala", quadro_inicial: "anterior", prompt: "{personagem} smiles at the phone camera and says in Brazilian Portuguese: \"Link aqui embaixo\", same room and outfit, handheld selfie, native audio.", texto_na_tela: "Link na bio" },
    ],
    consistencia: [
      "Folha do personagem pronta antes (frente, 3/4, perfil) e usada como referência em todos os planos.",
      "Mesma roupa, cabelo e cômodo; o plano seguinte parte do último quadro do anterior.",
      "Produto com foto real de referência; o motor precisa aceitar imagem de referência.",
    ],
    evitar: [
      "Rosto de pessoa real sem autorização registrada.",
      "Depoimento como se fosse cliente de verdade.",
      "Fala longa num plano só (mais de 12 palavras desincroniza).",
    ],
    pede_pessoa: true,
  },
  {
    id: "produto",
    nome: "Produto: still e packshot",
    resumo: "Imagens muito profissionais e um giro de produto em estúdio.",
    ajuda: "Fotos de produto com luz de estúdio (still), packshot em fundo limpo e um plano curto de giro. O produto sai da foto real do cliente: forma, rótulo e cor não podem mudar.",
    nichos: ["e-commerce", "alimentação", "moda", "games e keys", "informática"],
    objetivo: "Imagem de catálogo e anúncio que parece estúdio caro.",
    formatos: ["1:1", "4:5", "9:16"],
    lacunas: [
      L("produto", "Produto", "garrafa de azeite de vidro verde com rótulo branco"),
      L("superficie", "Superfície", "pedra travertino bege"),
      L("luz", "Luz", "luz lateral suave com sombra longa", false),
    ],
    cenas: [
      { ref: "c1", nome: "Still herói", objetivo: "A foto principal.", duracao_s: 0, enquadramento: "3/4 do produto", camera: "lente 100 mm", modo: "imagem", papel: "imagem", quadro_inicial: "produto", prompt: "Premium studio product photo of {produto} on {superficie}, {luz}, 100mm lens, crisp label, true colors, commercial advertising look, no text added." },
      { ref: "c2", nome: "Packshot", objetivo: "Fundo limpo para catálogo.", duracao_s: 0, enquadramento: "frontal", camera: "lente 85 mm", modo: "imagem", papel: "imagem", quadro_inicial: "produto", prompt: "Clean packshot of {produto}, pure seamless background, soft even light, sharp edges, true colors, no reflections on the label." },
      { ref: "c3", nome: "Giro", objetivo: "Movimento curto para anúncio.", duracao_s: 5, enquadramento: "3/4", camera: "órbita lenta de 30 graus", modo: "primeiro_quadro", papel: "consistencia", quadro_inicial: "produto", prompt: "Slow 30 degree orbit around {produto} on {superficie}, {luz}, studio commercial, product shape and label unchanged, photorealistic." },
      { ref: "c4", nome: "Detalhe", objetivo: "Textura e acabamento.", duracao_s: 3, enquadramento: "macro", camera: "slide lateral", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "produto", prompt: "Macro slide across the texture of {produto}, {luz}, shallow depth of field, photorealistic." },
    ],
    consistencia: ["Sempre a foto real do produto como entrada.", "A mesma luz no still, no packshot e no giro."],
    evitar: ["Rótulo reescrito pelo modelo (texto do rótulo vira borrão): prefira ângulos em que o rótulo aparece pouco ou recoloque o rótulo na edição.", "Mudar a cor do produto."],
    pede_pessoa: false,
  },
  {
    id: "imobiliario",
    nome: "Imobiliário: tour",
    resumo: "Fachada, entrada, sala, cozinha, quarto e vista, com travelling.",
    ajuda: "Tour do imóvel a partir das fotos reais de cada cômodo. Cada plano parte da foto do cômodo (não inventa planta). A ordem segue o caminho de quem entra.",
    nichos: ["imobiliário", "arquitetura", "hospedagem"],
    objetivo: "Fazer a pessoa querer visitar.",
    formatos: ["9:16", "16:9"],
    lacunas: [
      L("imovel", "Imóvel", "apartamento de 2 quartos com varanda"),
      L("bairro", "Bairro e cidade", "Batel, Curitiba"),
      L("luz", "Hora e luz", "fim de tarde, luz quente", false),
    ],
    cenas: [
      { ref: "c1", nome: "Fachada", objetivo: "Onde fica.", duracao_s: 4, enquadramento: "plano geral", camera: "subida lenta", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "ancora", prompt: "Exterior of the building of {imovel} in {bairro}, {luz}, slow crane up, real estate film, photorealistic." },
      { ref: "c2", nome: "Entrada e sala", objetivo: "A primeira impressão.", duracao_s: 5, enquadramento: "plano geral", camera: "travelling para frente (gimbal)", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "ancora", prompt: "Smooth gimbal walk-through entering the living room of {imovel}, {luz}, wide lens, same furniture as the photo, photorealistic." },
      { ref: "c3", nome: "Cozinha", objetivo: "Uso do dia a dia.", duracao_s: 4, enquadramento: "plano médio", camera: "travelling lateral", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "ancora", prompt: "Slow lateral dolly across the kitchen of {imovel}, {luz}, photorealistic, furniture unchanged." },
      { ref: "c4", nome: "Quarto", objetivo: "Conforto.", duracao_s: 4, enquadramento: "plano geral", camera: "push-in", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "ancora", prompt: "Gentle push-in into the bedroom of {imovel}, {luz}, cozy, photorealistic, furniture unchanged." },
      { ref: "c5", nome: "Vista", objetivo: "O que só este imóvel tem.", duracao_s: 4, enquadramento: "plano geral", camera: "pan lento", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "ancora", prompt: "Slow pan across the balcony view of {imovel} in {bairro}, {luz}, photorealistic.", texto_na_tela: "Agende sua visita" },
    ],
    consistencia: ["Cada cômodo parte da sua foto real (quadro âncora).", "Mesma hora do dia em todo o tour."],
    evitar: ["Inventar cômodo, vista ou acabamento que o imóvel não tem.", "Grande-angular exagerada que distorce as paredes."],
    pede_pessoa: false,
  },
  {
    id: "gastronomia",
    nome: "Gastronomia",
    resumo: "Ingrediente, preparo, prato pronto e a primeira garfada.",
    ajuda: "Para restaurante, confeitaria e delivery. O prato pronto sai da foto real do cardápio. Vapor, brilho e textura vendem; exagero de cor não.",
    nichos: ["alimentação", "restaurante", "confeitaria", "delivery"],
    objetivo: "Dar fome e levar ao pedido.",
    formatos: ["9:16", "1:1"],
    lacunas: [
      L("prato", "Prato", "hambúrguer artesanal com cheddar e bacon"),
      L("ingrediente", "Ingrediente herói", "carne grelhada na chapa"),
      L("mesa", "Mesa e ambiente", "mesa de madeira escura, luz quente de restaurante", false),
    ],
    cenas: [
      { ref: "c1", nome: "Ingrediente", objetivo: "Frescor.", duracao_s: 3, enquadramento: "close", camera: "slow motion", modo: "texto", papel: "barato", prompt: "Slow motion close-up of {ingrediente}, sizzling, steam, warm light, food commercial, photorealistic." },
      { ref: "c2", nome: "Preparo", objetivo: "O cuidado de quem faz.", duracao_s: 4, enquadramento: "close nas mãos", camera: "na mão, lento", modo: "texto", papel: "movimento", prompt: "Chef hands assembling {prato}, cheese melting, close-up, shallow depth of field, warm kitchen light, photorealistic food commercial." },
      { ref: "c3", nome: "Prato pronto", objetivo: "O herói do vídeo.", duracao_s: 4, enquadramento: "3/4 do prato", camera: "órbita lenta", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "produto", prompt: "Slow orbit around {prato} on {mesa}, steam rising, glossy textures, food commercial, photorealistic, the dish identical to the photo." },
      { ref: "c4", nome: "Primeira garfada", objetivo: "Desejo.", duracao_s: 3, enquadramento: "close", camera: "parada", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "produto", prompt: "A hand lifts a bite of {prato} towards the camera, stretchy cheese, slow motion, warm light, photorealistic.", texto_na_tela: "Peça agora" },
    ],
    consistencia: ["O prato pronto sempre da foto real (é o que o cliente recebe)."],
    evitar: ["Porção maior ou ingrediente que o prato não tem.", "Rosto de cliente comendo sem autorização."],
    pede_pessoa: false,
  },
  {
    id: "estetica",
    nome: "Estética e clínica",
    resumo: "Ambiente da clínica, atendimento, procedimento sem exagero e confiança.",
    ajuda: "Clínicas de estética e saúde. Mostra ambiente, cuidado e profissional. Nada de promessa de resultado, corpo de paciente sem consentimento escrito ou antes e depois que as regras do conselho da área proíbem.",
    nichos: ["estética", "clínica", "odontologia", "saúde"],
    objetivo: "Passar confiança e levar ao agendamento.",
    formatos: ["9:16", "4:5"],
    lacunas: [
      L("clinica", "Clínica", "clínica de estética facial com paredes brancas e detalhes em rosa claro"),
      L("profissional", "Profissional (personagem)", "esteticista de jaleco branco, cabelo loiro preso"),
      L("procedimento", "Procedimento", "limpeza de pele"),
    ],
    cenas: [
      { ref: "c1", nome: "Ambiente", objetivo: "Limpo e acolhedor.", duracao_s: 4, enquadramento: "plano geral", camera: "travelling lento", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "ancora", prompt: "Slow dolly through the reception of {clinica}, soft daylight, calm and clean, photorealistic, no text." },
      { ref: "c2", nome: "Profissional", objetivo: "Quem cuida.", duracao_s: 4, enquadramento: "plano médio", camera: "push-in", modo: "referencia", papel: "consistencia", quadro_inicial: "folha", prompt: "{profissional} prepares the room for {procedimento} in {clinica}, calm gestures, soft light, photorealistic." },
      { ref: "c3", nome: "Procedimento", objetivo: "O cuidado, sem mostrar resultado.", duracao_s: 4, enquadramento: "close nas mãos", camera: "parada", modo: "referencia", papel: "consistencia", quadro_inicial: "anterior", prompt: "Close-up of the gloved hands of {profissional} performing {procedimento} gently, soft light, clinical and calm, photorealistic, no before and after." },
      { ref: "c4", nome: "Confiança", objetivo: "Convite ao agendamento.", duracao_s: 3, enquadramento: "plano médio", camera: "parada", modo: "referencia", papel: "fala", quadro_inicial: "folha", prompt: "{profissional} smiles at the camera in {clinica} and says in Brazilian Portuguese: \"Agende sua avaliação\", soft light, native audio.", texto_na_tela: "Agende sua avaliação" },
    ],
    consistencia: ["Mesma profissional (folha) em todos os planos.", "Mesma paleta da clínica."],
    evitar: ["Promessa de resultado.", "Paciente real sem consentimento escrito.", "Pele de plástico: pedir poros e textura reais."],
    pede_pessoa: true,
  },
  {
    id: "automotivo",
    nome: "Automotivo",
    resumo: "Revelação do carro, detalhes, em movimento e o serviço.",
    ajuda: "Para revenda, estética automotiva e oficina. O carro vem da foto real (modelo, cor e rodas não mudam). Movimento de carro pede motor bom em física.",
    nichos: ["automotivo", "revenda", "estética automotiva", "oficina"],
    objetivo: "Desejo pelo carro ou confiança no serviço.",
    formatos: ["9:16", "16:9"],
    lacunas: [
      L("carro", "Carro", "SUV preto modelo 2024 com rodas escurecidas"),
      L("lugar", "Lugar", "estrada de serra ao pôr do sol"),
      L("servico", "Serviço (se houver)", "polimento e vitrificação", false),
    ],
    cenas: [
      { ref: "c1", nome: "Revelação", objetivo: "O carro aparece.", duracao_s: 4, enquadramento: "plano geral baixo", camera: "travelling lateral baixo", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "produto", prompt: "Low angle lateral tracking shot revealing {carro} in {lugar}, cinematic car commercial, photorealistic, car identical to the photo." },
      { ref: "c2", nome: "Detalhes", objetivo: "Farol, roda e acabamento.", duracao_s: 3, enquadramento: "close", camera: "slide", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "produto", prompt: "Close-up slide across the headlight and wheel of {carro}, light reflections, photorealistic." },
      { ref: "c3", nome: "Em movimento", objetivo: "Sensação de dirigir.", duracao_s: 5, enquadramento: "plano de acompanhamento", camera: "carro de apoio", modo: "primeiro_quadro", papel: "movimento", quadro_inicial: "produto", prompt: "Tracking shot from a follow car of {carro} driving on {lugar}, realistic physics and wheel motion, motion blur on the road, photorealistic." },
      { ref: "c4", nome: "Serviço ou convite", objetivo: "O que o cliente contrata.", duracao_s: 4, enquadramento: "close", camera: "parada", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "produto", prompt: "Close-up of {servico} being applied on {carro}, glossy finish appearing, photorealistic.", texto_na_tela: "Agende" },
    ],
    consistencia: ["Carro sempre da foto real; placa borrada ou fora de quadro.", "Mesma hora do dia na sequência."],
    evitar: ["Roda girando ao contrário ou carro deslizando sem rodar.", "Logo de fabricante inventado."],
    pede_pessoa: false,
  },
  {
    id: "esporte",
    nome: "Esporte e futebol",
    resumo: "Clima do jogo, lance, reação e o dado da análise.",
    ajuda: "Para conteúdo esportivo e análise de futebol. Sem jogador real reconhecível, escudo ou marca de clube sem licença: personagens e uniformes genéricos. O dado da análise vem de fonte e entra na edição.",
    nichos: ["futebol", "esporte", "academia"],
    objetivo: "Emoção com informação verdadeira.",
    formatos: ["9:16", "16:9"],
    lacunas: [
      L("atleta", "Atleta (personagem genérico)", "atacante de uniforme azul marinho liso, número 9"),
      L("lugar", "Lugar", "estádio lotado à noite, chuva fina"),
      L("lance", "Lance", "chute de fora da área no ângulo"),
    ],
    cenas: [
      { ref: "c1", nome: "Clima", objetivo: "Onde e quando.", duracao_s: 3, enquadramento: "plano geral", camera: "drone descendo", modo: "texto", papel: "barato", prompt: "Aerial shot descending into {lugar}, floodlights, crowd, cinematic sports broadcast look, no real club logos." },
      { ref: "c2", nome: "Lance", objetivo: "A jogada.", duracao_s: 5, enquadramento: "plano médio", camera: "acompanhando o atleta", modo: "referencia", papel: "movimento", quadro_inicial: "folha", prompt: "{atleta} performs {lance} in {lugar}, realistic ball physics, tracking camera, slow motion at the kick, photorealistic, no real logos." },
      { ref: "c3", nome: "Reação", objetivo: "Emoção.", duracao_s: 3, enquadramento: "close", camera: "na mão", modo: "referencia", papel: "consistencia", quadro_inicial: "anterior", prompt: "Close-up of {atleta} celebrating, rain drops, stadium lights, handheld, photorealistic." },
    ],
    consistencia: ["Mesmo uniforme e número em todos os planos.", "Chuva e luz iguais."],
    evitar: ["Jogador real, escudo ou patrocinador sem licença.", "Estatística inventada."],
    pede_pessoa: true,
  },
  {
    id: "filme",
    nome: "Filme curto com personagem",
    resumo: "História de 3 a 6 planos com o mesmo personagem e cenário.",
    ajuda: "O diretor pesquisa a região e a época (com fontes), monta a bíblia (personagens com folha, cenários com quadro âncora, paleta, lente e luz) e o roteiro plano a plano. Cada plano parte do último quadro do anterior ou do quadro âncora do cenário.",
    nichos: ["institucional", "marca", "todos"],
    objetivo: "Contar uma história curta com continuidade de cinema.",
    formatos: ["16:9", "9:16"],
    lacunas: [
      L("personagem", "Personagem", "senhor de 60 anos, barba grisalha, camisa xadrez vermelha"),
      L("regiao", "Região e época", "Campos Gerais do Paraná, inverno, geada de manhã"),
      L("historia", "História em uma frase", "ele abre a padaria da família antes do sol nascer"),
    ],
    cenas: [
      { ref: "c1", nome: "Estabelecimento", objetivo: "Onde a história acontece.", duracao_s: 5, enquadramento: "plano geral", camera: "drone lento", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "ancora", prompt: "Establishing shot of {regiao}, cinematic, 35mm anamorphic, natural light, photorealistic, no text." },
      { ref: "c2", nome: "Apresentação", objetivo: "Quem é.", duracao_s: 5, enquadramento: "plano médio", camera: "push-in", modo: "referencia", papel: "consistencia", quadro_inicial: "folha", prompt: "{personagem} in {regiao}, beginning the story: {historia}, 35mm anamorphic, same light as the establishing shot, photorealistic." },
      { ref: "c3", nome: "Ação", objetivo: "O que acontece.", duracao_s: 5, enquadramento: "plano médio", camera: "câmera na mão", modo: "primeiro_quadro", papel: "consistencia", quadro_inicial: "anterior", prompt: "{personagem} continues: {historia}, same outfit and place, handheld, 35mm anamorphic, photorealistic." },
      { ref: "c4", nome: "Detalhe", objetivo: "O gesto que importa.", duracao_s: 4, enquadramento: "close", camera: "parada", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "anterior", prompt: "Close-up of the hands of {personagem}, meaningful gesture from {historia}, shallow depth of field, same light, photorealistic." },
      { ref: "c5", nome: "Fecho", objetivo: "A imagem que fica.", duracao_s: 5, enquadramento: "plano geral", camera: "afastando", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "anterior", prompt: "Slow pull-back from {personagem} revealing {regiao}, end of the story, 35mm anamorphic, photorealistic." },
    ],
    consistencia: ["Folha do personagem e quadro âncora antes de gerar.", "Lente 35 mm anamórfica e a mesma luz em tudo.", "Encadear pelo último quadro do plano anterior."],
    evitar: ["Fato sobre a região sem fonte.", "Mudar a roupa ou a barba entre planos.", "Planos longos demais (mais de 8 s derrete o rosto)."],
    pede_pessoa: true,
  },
  {
    id: "paisagismo",
    nome: "Jardinagem e paisagismo",
    resumo: "Terreno, projeto crescendo, jardim pronto e manutenção.",
    ajuda: "Para paisagismo e jardinagem. O jardim pronto sai da foto real do terreno editada: mesmas árvores, muros e casa. Plantas que o clima da região suporta.",
    nichos: ["jardinagem", "paisagismo"],
    objetivo: "Mostrar o projeto possível e levar ao orçamento.",
    formatos: ["9:16", "4:5"],
    lacunas: [
      L("terreno", "Terreno", "quintal de 40 m² com grama falhada e muro de tijolo"),
      L("projeto", "Projeto", "caminho de pedra, canteiros de lavanda e grama esmeralda"),
      L("clima", "Clima da região", "subtropical, Curitiba", false),
    ],
    cenas: [
      { ref: "c1", nome: "Terreno hoje", objetivo: "O ponto de partida.", duracao_s: 3, enquadramento: "plano geral", camera: "parada", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "antes", prompt: "{terreno}, static wide shot, natural daylight, photorealistic." },
      { ref: "c2", nome: "Jardim crescendo", objetivo: "A transformação.", duracao_s: 6, enquadramento: "o mesmo", camera: "travada", modo: "primeiro_ultimo", papel: "transicao", quadro_inicial: "antes", quadro_final: "depois", prompt: "Timelapse of the garden growing in {terreno}: {projeto} appearing, plants growing, same camera and framing, photorealistic." },
      { ref: "c3", nome: "Jardim pronto", objetivo: "O resultado.", duracao_s: 4, enquadramento: "plano geral", camera: "travelling", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "depois", prompt: "Slow dolly through the finished garden with {projeto}, golden hour, photorealistic, plants suited to {clima}.", texto_na_tela: "Peça seu projeto" },
    ],
    consistencia: ["Muros, casa e árvores existentes iguais no antes e no depois."],
    evitar: ["Planta que não vive no clima da região.", "Aumentar o terreno."],
    pede_pessoa: false,
  },
  {
    id: "juridico",
    nome: "Jurídico: autoridade",
    resumo: "Escritório, profissional explicando e o convite para consulta.",
    ajuda: "Advocacia e consultoria. Sóbrio, sem promessa de resultado (regras da OAB). A fala é orientação geral; o caso concreto fica para a consulta.",
    nichos: ["jurídico", "contabilidade", "consultoria"],
    objetivo: "Passar autoridade e confiança.",
    formatos: ["9:16", "16:9"],
    lacunas: [
      L("profissional", "Profissional (personagem)", "advogada de 40 anos, blazer vinho, cabelo curto escuro"),
      L("escritorio", "Escritório", "escritório com estante de livros e mesa de madeira"),
      L("tema", "Tema da fala", "direito do consumidor em compras online"),
    ],
    cenas: [
      { ref: "c1", nome: "Escritório", objetivo: "Ambiente sério.", duracao_s: 3, enquadramento: "plano geral", camera: "travelling lento", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "ancora", prompt: "Slow dolly through {escritorio}, soft window light, calm, photorealistic, no text." },
      { ref: "c2", nome: "Explicação", objetivo: "Uma orientação clara.", duracao_s: 6, enquadramento: "plano médio", camera: "parada", modo: "referencia", papel: "fala", quadro_inicial: "folha", prompt: "{profissional} sitting in {escritorio}, speaking calmly to the camera in Brazilian Portuguese about {tema}, soft light, native audio, photorealistic." },
      { ref: "c3", nome: "Convite", objetivo: "Consulta.", duracao_s: 3, enquadramento: "plano médio", camera: "push-in", modo: "referencia", papel: "consistencia", quadro_inicial: "anterior", prompt: "{profissional} nods at the camera in {escritorio}, same light and outfit, photorealistic.", texto_na_tela: "Agende uma consulta" },
    ],
    consistencia: ["Mesma profissional e mesmo blazer.", "Luz de janela igual."],
    evitar: ["Promessa de ganho de causa.", "Martelo de juiz e clichês americanos."],
    pede_pessoa: true,
  },
  {
    id: "assistencia",
    nome: "Informática e assistência técnica",
    resumo: "Problema, bancada, conserto e o aparelho funcionando.",
    ajuda: "Assistência técnica e loja de informática. O aparelho vem da foto real. Mostra cuidado na bancada, sem peça inventada.",
    nichos: ["informática", "assistência técnica", "celulares"],
    objetivo: "Confiança no conserto e rapidez.",
    formatos: ["9:16", "1:1"],
    lacunas: [
      L("aparelho", "Aparelho", "notebook prata de 15 polegadas"),
      L("problema", "Problema", "tela que não liga"),
      L("bancada", "Bancada", "bancada antiestática azul com ferramentas organizadas", false),
    ],
    cenas: [
      { ref: "c1", nome: "Problema", objetivo: "A dor do cliente.", duracao_s: 3, enquadramento: "close", camera: "parada", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "produto", prompt: "{aparelho} with {problema} on a desk, static close-up, realistic." },
      { ref: "c2", nome: "Bancada", objetivo: "Cuidado técnico.", duracao_s: 5, enquadramento: "top shot", camera: "de cima, parada", modo: "primeiro_quadro", papel: "movimento", quadro_inicial: "produto", prompt: "Top-down shot of a technician's gloved hands opening {aparelho} on {bancada}, precise movements, realistic components, photorealistic." },
      { ref: "c3", nome: "Funcionando", objetivo: "Resolvido.", duracao_s: 3, enquadramento: "close", camera: "push-in", modo: "primeiro_quadro", papel: "barato", quadro_inicial: "produto", prompt: "{aparelho} turning on successfully, screen lights up, slow push-in, realistic.", texto_na_tela: "Orçamento no WhatsApp" },
    ],
    consistencia: ["Mesmo aparelho (foto real) do começo ao fim."],
    evitar: ["Tela com marca ou sistema inventado ligado (vira borrão): tela acesa lisa ou colocada na edição."],
    pede_pessoa: false,
  },
  {
    id: "games",
    nome: "Games e keys",
    resumo: "Setup, gancho do jogo, entrega da key e reação.",
    ajuda: "Loja de keys e jogos. Sem cena de jogo com marca registrada gerada: o jogo aparece por tela gravada de verdade na edição. O vídeo gerado mostra setup, pessoa e reação.",
    nichos: ["games", "keys", "tecnologia"],
    objetivo: "Desejo e confiança na entrega.",
    formatos: ["9:16"],
    lacunas: [
      L("setup", "Setup", "quarto gamer com LED roxo e monitor curvo"),
      L("personagem", "Jogador (personagem)", "jovem de 22 anos, moletom preto, headset branco"),
    ],
    cenas: [
      { ref: "c1", nome: "Setup", objetivo: "O clima.", duracao_s: 3, enquadramento: "plano geral", camera: "push-in", modo: "texto", papel: "barato", prompt: "Slow push-in on {setup}, LED glow, night, cinematic, no brand logos." },
      { ref: "c2", nome: "Recebe a key", objetivo: "Entrega rápida.", duracao_s: 4, enquadramento: "plano médio", camera: "na mão", modo: "referencia", papel: "consistencia", quadro_inicial: "folha", prompt: "{personagem} checks the phone and smiles, receiving a game code, in {setup}, handheld, realistic." },
      { ref: "c3", nome: "Reação", objetivo: "Emoção de jogar.", duracao_s: 4, enquadramento: "plano médio", camera: "parada", modo: "referencia", papel: "fala", quadro_inicial: "anterior", prompt: "{personagem} puts on the headset and reacts excited in {setup}, says in Brazilian Portuguese: \"Chegou em segundos\", native audio.", texto_na_tela: "Key na hora" },
    ],
    consistencia: ["Mesmo jogador e mesma luz roxa."],
    evitar: ["Tela de jogo gerada com marca; use a gravação real na edição."],
    pede_pessoa: true,
  },
  {
    id: "moda",
    nome: "Moda: lookbook",
    resumo: "Look inteiro, giro, detalhe do tecido e o look em movimento.",
    ajuda: "Loja de roupa e acessórios. A peça vem da foto real (cor, estampa e caimento). Modelo gerado com folha; o mesmo modelo em todos os looks do lote.",
    nichos: ["moda", "acessórios", "calçados"],
    objetivo: "Mostrar caimento e levar à compra.",
    formatos: ["9:16", "4:5"],
    lacunas: [
      L("modelo", "Modelo (personagem)", "mulher de 28 anos, cabelo cacheado, pele morena"),
      L("peca", "Peça", "vestido midi de linho verde oliva"),
      L("lugar", "Lugar", "rua de paralelepípedo com luz de fim de tarde", false),
    ],
    cenas: [
      { ref: "c1", nome: "Look inteiro", objetivo: "A peça no corpo.", duracao_s: 4, enquadramento: "corpo inteiro", camera: "travelling para trás", modo: "referencia", papel: "consistencia", quadro_inicial: "folha", prompt: "{modelo} wearing {peca} walks towards the camera on {lugar}, fashion film, fabric moving naturally, photorealistic, garment identical to the reference." },
      { ref: "c2", nome: "Giro", objetivo: "Caimento.", duracao_s: 4, enquadramento: "corpo inteiro", camera: "parada", modo: "referencia", papel: "consistencia", quadro_inicial: "anterior", prompt: "{modelo} turns around slowly showing {peca}, same place and light, photorealistic." },
      { ref: "c3", nome: "Detalhe", objetivo: "Tecido e acabamento.", duracao_s: 3, enquadramento: "close", camera: "slide", modo: "primeiro_quadro", papel: "hero", quadro_inicial: "produto", prompt: "Close-up slide across the fabric texture of {peca}, soft light, photorealistic.", texto_na_tela: "Compre pelo link" },
    ],
    consistencia: ["Mesmo modelo (folha) em todos os looks do lote.", "Peça sempre com a foto real como referência."],
    evitar: ["Estampa ou cor diferente da peça real.", "Modelo real sem autorização."],
    pede_pessoa: true,
  },
];

export const kitPorId = (id: string | null | undefined): KitDeVideo | null => (id ? KITS_DE_VIDEO.find((k) => k.id === id) || null : null);

/** Lacunas usadas nos prompts do kit (ordem de aparição). */
export function lacunasDoTexto(texto: string): string[] {
  const saida: string[] = [];
  const re = /\{([a-z_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(texto || "")))) if (saida.indexOf(m[1]) < 0) saida.push(m[1]);
  return saida;
}

/**
 * Preenche as lacunas. Lacuna sem valor NÃO é inventada: fica marcada e
 * volta em `faltando` (o diretor pergunta). Lacuna opcional vazia some da frase.
 */
export function preencherPrompt(prompt: string, valores: Record<string, string>, lacunas: LacunaDoKit[] = []): { texto: string; faltando: string[] } {
  const faltando: string[] = [];
  const texto = String(prompt || "").replace(/\{([a-z_]+)\}/g, (_t, chave: string) => {
    const v = String((valores && valores[chave]) || "").replace(/\s+/g, " ").trim();
    if (v) return v;
    const l = lacunas.find((x) => x.chave === chave);
    if (l && !l.obrigatoria) return "";
    if (faltando.indexOf(chave) < 0) faltando.push(chave);
    return `{${chave}}`;
  });
  return {
    texto: texto
      .replace(/\s+,/g, ",")
      .replace(/,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .replace(/,\s*\./g, ".")
      .trim(),
    faltando,
  };
}

/** Problemas de estrutura do kit (os testes conferem que a lista sai vazia). */
export function problemasDoKit(k: KitDeVideo): string[] {
  const p: string[] = [];
  if (!k.id || !/^[a-z_]+$/.test(k.id)) p.push(`${k.id}: id inválido`);
  if (!k.cenas.length) p.push(`${k.id}: sem cenas`);
  if (!k.formatos.length) p.push(`${k.id}: sem formato`);
  const refs: string[] = [];
  const chaves = k.lacunas.map((l) => l.chave);
  k.cenas.forEach((c) => {
    if (refs.indexOf(c.ref) >= 0) p.push(`${k.id}/${c.ref}: ref repetida`);
    refs.push(c.ref);
    if (c.modo !== "imagem" && !(c.duracao_s >= 2 && c.duracao_s <= 15)) p.push(`${k.id}/${c.ref}: duração fora de 2 a 15 s`);
    if (c.modo === "primeiro_ultimo" && (!c.quadro_inicial || !c.quadro_final)) p.push(`${k.id}/${c.ref}: primeiro e último quadro sem os dois quadros`);
    if (c.modo === "imagem" && c.papel !== "imagem") p.push(`${k.id}/${c.ref}: still sem papel de imagem`);
    lacunasDoTexto(c.prompt).forEach((l) => {
      if (chaves.indexOf(l) < 0) p.push(`${k.id}/${c.ref}: lacuna {${l}} não declarada`);
    });
    if (/[\u2014\u2013]/.test(c.nome + c.objetivo + (c.texto_na_tela || ""))) p.push(`${k.id}/${c.ref}: travessão`);
  });
  if (/[\u2014\u2013]/.test(k.nome + k.resumo + k.ajuda + k.consistencia.join("") + k.evitar.join(""))) p.push(`${k.id}: travessão`);
  (k.variantes || []).forEach((v) =>
    Object.keys(v.valores).forEach((c) => {
      if (chaves.indexOf(c) < 0) p.push(`${k.id}/${v.id}: valor de lacuna desconhecida ${c}`);
    }),
  );
  return p;
}

/** Duração total do kit em vídeo (stills não contam). */
export const duracaoDoKit = (k: KitDeVideo) => k.cenas.reduce((s, c) => s + (c.modo === "imagem" ? 0 : c.duracao_s), 0);
