"""Nicho escrito pela equipe -> etiquetas do OpenStreetMap (Máquina de leads, 25/10/2026).

O OpenStreetMap marca o tipo do negócio com pares chave=valor (amenity=restaurant, shop=hairdresser...).
A equipe escreve do jeito dela ("restaurante", "salão de beleza", "dentista"); aqui o texto vira as
etiquetas. Sem nicho conhecido, a busca cai na procura pelo nome (qualquer negócio com o termo no nome).
"""

import re
import unicodedata

# (rótulo, sinônimos, etiquetas). Os sinônimos são comparados sem acento e em minúsculas.
NICHOS = [
    ("Restaurante", ["restaurante", "restaurantes", "comida", "gastronomia"], [("amenity", "restaurant")]),
    ("Pizzaria", ["pizzaria", "pizza"], [("amenity", "restaurant", "pizza"), ("amenity", "fast_food", "pizza")]),
    ("Hamburgueria", ["hamburgueria", "hamburguer", "burger", "lanchonete", "lanche"], [("amenity", "fast_food")]),
    ("Cafeteria", ["cafeteria", "cafe", "café", "coffee"], [("amenity", "cafe")]),
    ("Padaria", ["padaria", "panificadora", "confeitaria"], [("shop", "bakery"), ("shop", "pastry")]),
    ("Bar", ["bar", "pub", "boteco", "cervejaria"], [("amenity", "bar"), ("amenity", "pub")]),
    ("Academia", ["academia", "academias", "crossfit", "pilates", "musculacao"], [("leisure", "fitness_centre"), ("leisure", "sports_centre")]),
    ("Clínica médica", ["clinica", "clinicas", "clinica medica", "consultorio", "medico"], [("amenity", "clinic"), ("amenity", "doctors"), ("healthcare", "clinic"), ("healthcare", "doctor")]),
    ("Dentista", ["dentista", "odontologia", "odontologico", "clinica odontologica", "ortodontia"], [("amenity", "dentist"), ("healthcare", "dentist")]),
    ("Fisioterapia", ["fisioterapia", "fisioterapeuta"], [("healthcare", "physiotherapist")]),
    ("Psicologia", ["psicologo", "psicologa", "psicologia", "terapia"], [("healthcare", "psychotherapist")]),
    ("Clínica de estética", ["estetica", "clinica de estetica", "harmonizacao", "depilacao"], [("shop", "beauty"), ("amenity", "beauty")]),
    ("Salão de beleza", ["salao", "salao de beleza", "cabeleireiro", "cabeleireira", "barbearia", "barbeiro"], [("shop", "hairdresser"), ("shop", "beauty")]),
    ("Advocacia", ["advogado", "advogada", "advocacia", "escritorio de advocacia", "juridico"], [("office", "lawyer")]),
    ("Contabilidade", ["contador", "contadora", "contabilidade", "escritorio contabil"], [("office", "accountant"), ("office", "tax_advisor")]),
    ("Imobiliária", ["imobiliaria", "imoveis", "corretor de imoveis", "corretora"], [("office", "estate_agent"), ("shop", "estate_agent")]),
    ("Oficina mecânica", ["oficina", "oficina mecanica", "mecanica", "auto center", "funilaria"], [("shop", "car_repair")]),
    ("Concessionária", ["concessionaria", "loja de carros", "revenda de veiculos", "seminovos"], [("shop", "car")]),
    ("Pet shop", ["pet shop", "petshop", "pet", "banho e tosa"], [("shop", "pet"), ("shop", "pet_grooming")]),
    ("Veterinária", ["veterinario", "veterinaria", "clinica veterinaria"], [("amenity", "veterinary")]),
    ("Loja de roupas", ["loja de roupas", "roupas", "moda", "boutique", "vestuario"], [("shop", "clothes"), ("shop", "boutique")]),
    ("Calçados", ["calcados", "sapataria", "tenis"], [("shop", "shoes")]),
    ("Ótica", ["otica", "oculos"], [("shop", "optician")]),
    ("Farmácia", ["farmacia", "drogaria"], [("amenity", "pharmacy"), ("shop", "chemist")]),
    ("Supermercado", ["supermercado", "mercado", "mercearia", "hortifruti"], [("shop", "supermarket"), ("shop", "convenience"), ("shop", "greengrocer")]),
    ("Móveis", ["moveis", "loja de moveis", "planejados", "marcenaria"], [("shop", "furniture"), ("craft", "carpenter")]),
    ("Material de construção", ["material de construcao", "construcao", "home center"], [("shop", "hardware"), ("shop", "doityourself")]),
    ("Informática", ["informatica", "assistencia tecnica", "computador", "celular", "eletronicos"], [("shop", "computer"), ("shop", "mobile_phone"), ("shop", "electronics")]),
    ("Escola", ["escola", "colegio", "curso", "cursos", "escola de idiomas", "idiomas"], [("amenity", "school"), ("amenity", "language_school"), ("amenity", "college")]),
    ("Hotel e pousada", ["hotel", "pousada", "hostel", "hospedagem"], [("tourism", "hotel"), ("tourism", "guest_house"), ("tourism", "hostel")]),
    ("Floricultura", ["floricultura", "flores"], [("shop", "florist")]),
    ("Joalheria", ["joalheria", "joias", "relojoaria"], [("shop", "jewelry")]),
    ("Papelaria e gráfica", ["papelaria", "grafica", "copiadora"], [("shop", "stationery"), ("shop", "copyshop"), ("craft", "printer")]),
    ("Lavanderia", ["lavanderia"], [("shop", "laundry"), ("shop", "dry_cleaning")]),
    ("Arquitetura", ["arquiteto", "arquiteta", "arquitetura", "design de interiores"], [("office", "architect")]),
    ("Engenharia", ["engenharia", "engenheiro", "construtora"], [("office", "engineer"), ("office", "construction_company")]),
    ("Agência de viagens", ["agencia de viagens", "turismo", "viagens"], [("shop", "travel_agency"), ("office", "travel_agent")]),
    ("Seguros", ["seguros", "corretora de seguros", "seguradora"], [("office", "insurance")]),
]


def sem_acento(texto):
    t = unicodedata.normalize("NFD", str(texto or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t.lower()).strip()


def nicho_do_texto(texto):
    """O nicho conhecido mais parecido com o texto (sinônimo inteiro), ou None."""
    # Pontuação vira espaço: "loja (eletronicos, perfumaria)" casa "eletronicos".
    alvo = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", sem_acento(texto))).strip()
    if not alvo:
        return None
    melhor = None
    for rotulo, sinonimos, etiquetas in NICHOS:
        for s in sinonimos:
            s2 = sem_acento(s)
            if alvo == s2 or re.search(r"(^| )" + re.escape(s2) + r"( |$)", alvo):
                # O sinônimo mais longo vence ("clinica odontologica" ganha de "clinica").
                if melhor is None or len(s2) > melhor[0]:
                    melhor = (len(s2), rotulo, etiquetas)
    if melhor is None:
        return None
    return {"rotulo": melhor[1], "etiquetas": melhor[2]}


def _escapar(valor):
    return str(valor).replace("\\", "\\\\").replace('"', '\\"')


_VARIANTES = {"a": "[aáàâã]", "e": "[eéê]", "i": "[ií]", "o": "[oóôõ]", "u": "[uúü]", "c": "[cç]"}


def regex_do_nome(termo):
    """O termo sem acento vira uma regex que casa com e sem acento ("salao" casa "Salão")."""
    saida = []
    for ch in sem_acento(termo):
        if ch in _VARIANTES:
            saida.append(_VARIANTES[ch])
        elif ch.isalnum() or ch == " ":
            saida.append(ch)
        else:
            saida.append(".")
    return "".join(saida)


def consulta_overpass(texto, area_id, limite):
    """A consulta Overpass do nicho dentro da área (id de área do OSM). Sempre inclui a busca pelo nome."""
    n = nicho_do_texto(texto)
    partes = []
    if n:
        for et in n["etiquetas"]:
            filtro = '["%s"="%s"]' % (_escapar(et[0]), _escapar(et[1]))
            if len(et) > 2:
                filtro += '["cuisine"~"%s",i]' % _escapar(et[2])
            partes.append("nwr%s(area.a);" % filtro)
    termo = sem_acento(texto)
    if termo:
        # Pelo nome, só negócio (tem shop, amenity, office, craft, healthcare, leisure ou tourism).
        partes.append('nwr[~"^(shop|amenity|office|craft|healthcare|leisure|tourism)$"~"."]["name"~"%s",i](area.a);' % _escapar(regex_do_nome(termo)))
    limite = max(1, min(int(limite or 50), 300))
    # Pede mais que o limite: muitos não têm telefone nem site e ficam para trás.
    return "[out:json][timeout:90];area(id:%d)->.a;(%s);out center tags %d;" % (int(area_id), "".join(partes), min(limite * 3, 900))
