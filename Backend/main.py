from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import mysql.connector
import re
import io
import uvicorn

# Tentativa de importação do pypdf
try:
    from pypdf import PdfReader
    PYPDF_AVAILABLE = True
except ImportError:
    PdfReader = None
    PYPDF_AVAILABLE = False

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

db_config = {
    'host': 'localhost',
    'user': "root",
    'password': "", # Verifique se sua senha é vazia mesmo
    'database': "audiolivro_db"
}

def limpar_texto_pdf(texto, paginas=None):
    """Limpa o texto bruto do PDF preservando parágrafos.

    Args:
        texto: texto bruto completo.
        paginas: lista opcional com o texto de cada página. Quando fornecida,
            permite detectar cabeçalho/rodapé por POSIÇÃO (mesma linha no topo
            ou na base de várias páginas), que é o critério correto. Sem ela,
            cai no critério por frequência.

    Remove números de página isolados, cabeçalhos/rodapés repetidos e normaliza
    espaços sem colar tudo em uma única linha (antes, o re.sub(r'\n+', ' ')
    destruía a estrutura de parágrafos).
    """
    if not texto:
        return ""

    repetidas = set()
    if paginas:
        repetidas = _detectar_cabecalho_rodape(paginas)

    linhas = texto.split('\n')
    resultado = []
    for linha in linhas:
        stripped = linha.strip()
        if not stripped:
            resultado.append('')
            continue
        # Remove números de página isolados ("12", "12.", "- 12 -", "Página 12")
        if re.fullmatch(r'[\-\u2013\u2014]?\s*(?:[Pp][áa]g(?:ina)?\.?\s*)?\d{1,4}\s*[\.\-\u2013\u2014]?', stripped):
            continue
        if stripped in repetidas:
            continue
        resultado.append(stripped)

    # Fallback por frequência: só quando não recebemos as páginas separadas.
    if not paginas:
        from collections import Counter
        contagem = Counter(l for l in resultado if l)
        total_linhas = sum(1 for l in resultado if l)
        # Um cabeçalho/rodapé se repete uma vez por página. Estimando ~20 linhas
        # úteis por página, esperamos repetição em >= ~5% das linhas.
        limite = max(2, int(total_linhas * 0.05))
        repetidas_freq = {
            l for l, c in contagem.items()
            if c >= limite and len(l) <= 80 and not l.endswith(('.', '!', '?', ':'))
        }
        resultado = [l for l in resultado if l not in repetidas_freq]

    # Reagrupa em parágrafos. Uma linha que PARECE TÍTULO (curta, sem
    # pontuação final de frase, em CAIXA ALTA ou iniciando com "Capítulo") vira
    # sempre um parágrafo próprio — inclusive quando é a primeira linha da
    # página — para não colar no texto seguinte.
    paragrafos = []
    buffer = []
    for l in resultado:
        if not l:
            if buffer:
                paragrafos.append(' '.join(buffer))
                buffer = []
            continue
        if _parece_titulo(l):
            if buffer:
                paragrafos.append(' '.join(buffer))
                buffer = []
            paragrafos.append(l.strip())
            continue
        buffer.append(l)
    if buffer:
        paragrafos.append(' '.join(buffer))

    # Junta hifenização de fim de linha ("cami-" + "nho" -> "caminho")
    texto_final = '\n\n'.join(paragrafos)
    texto_final = re.sub(r'(\w)-\s+(\w)', r'\1\2', texto_final)
    texto_final = re.sub(r'[ \t]+', ' ', texto_final)
    return texto_final.strip()


def _parece_titulo(linha):
    """Heurística conservadora para identificar linha de título.

    Sinais: curta (<= 60 chars), sem pontuação final de frase, e ou totalmente
    em caixa alta (>= 4 letras), ou começando por "Capítulo"/"CAPÍTULO".
    Não é usado para descartar nada — apenas para quebrar parágrafo.
    """
    s = linha.strip()
    if not s or len(s) > 60:
        return False
    if s.endswith(('.', ',', ';', ':', '!', '?')):
        return False
    letras = [c for c in s if c.isalpha()]
    if len(letras) < 4:
        return False
    if s.upper() == s:
        return True
    return bool(re.match(r'^(cap[íi]tulo|se[çc][ãa]o|parte)\b', s, re.IGNORECASE))


def _detectar_cabecalho_rodape(paginas):
    """Detecta linhas repetidas nas MARGENS (topo/base) de várias páginas.

    Olha as N primeiras e N últimas linhas de cada página — não apenas a
    primeira e a última — porque extratores como o pypdf podem emitir o rodapé
    logo após o cabeçalho, antes do corpo (ex.: cabeçalho, rodapé, nº de página,
    só então o texto). Compara as margens entre páginas e marca como
    cabeçalho/rodapé o que se repete nelas.
    """
    if len(paginas) < 2:
        return set()

    MARGEM = 3  # quantas linhas do topo e da base considerar
    from collections import Counter

    contagem = Counter()
    paginas_validas = 0
    for pag in paginas:
        linhas = [l.strip() for l in pag.split('\n') if l.strip()]
        # Número de página puro não entra como candidato (já é removido antes)
        linhas = [l for l in linhas if not re.fullmatch(r'\d{1,4}', l)]
        if not linhas:
            continue
        paginas_validas += 1
        candidatos = set(linhas[:MARGEM]) | set(linhas[-MARGEM:])
        for l in candidatos:
            contagem[l] += 1

    if paginas_validas < 2:
        return set()

    # Precisa aparecer nas margens de, no mínimo, 2 páginas (ou de todas,
    # quando o documento tem só 2 páginas).
    minimo = 2
    return {
        l for l, c in contagem.items()
        if c >= min(minimo, paginas_validas) and len(l) <= 80
    }


def dividir_em_frases(texto):
    """Divide em frases sem cortar no meio, usando pontuação natural.

    Protege números com separadores (R$ 1.250,50 / 1.500 / 2.5 / 3,14) para que
    o ponto de milhar ou de decimal NÃO seja confundido com fim de frase.
    """
    if not texto:
        return []

    # Marco sentinela que substitui separadores internos de números.
    SENT = '\x00'

    def proteger(m):
        return m.group(0).replace('.', SENT)

    frases = []
    for paragrafo in texto.split('\n\n'):
        paragrafo = paragrafo.replace('\n', ' ').strip()
        if not paragrafo:
            continue

        # 1.250,50 -> 1\x00250,50   |   1.500 -> 1\x00500   |   2.5 -> 2\x005
        paragrafo = re.sub(r'\d\.\d', proteger, paragrafo)
        # 3,14 (vírgula decimal em pt-BR já é preservada, mas barramos "x,y")
        paragrafo = re.sub(r'R\$\s*\d[\d\x00]*(?:,\d{2})?', lambda m: m.group(0), paragrafo)

        partes = re.findall(r'[^.!?\u2026]+[.!?\u2026]+|[^.!?\u2026]+$', paragrafo)
        for p in partes:
            s = p.strip().replace(SENT, '.')
            if len(s) > 2:
                frases.append(s)
    return frases

class DadosProgresso(BaseModel):
    id_Livro: str
    indice_frase: int

@app.get("/")
def home():
    return {"status": "Online", "msg": "Backend AudioLivro ready"}

@app.post("/salvar")
def salvar_progresso(progresso: DadosProgresso):
    conn = None
    try:
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()
        # CORRIGIDO: nome da tabela para 'progresso'
        sql = """
            INSERT INTO progresso (id_Livro, indice_frase)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE indice_frase = VALUES(indice_frase)
            """
        cursor.execute(sql, (progresso.id_Livro, progresso.indice_frase))
        conn.commit()
        cursor.close()
        return {"status": "success", "message": "Progresso salvo!"}
    except Exception as e:
        return {"status": "erro", "detalhes": str(e)}
    finally:
        if conn and conn.is_connected():
            conn.close() # GARANTE que a conexão feche

@app.post("/upload-pdf/")
async def processar_pdf(file: UploadFile = File(...)):
    if not PYPDF_AVAILABLE:
        raise HTTPException(status_code=400, detail="Instale pypdf: pip install pypdf")

    try:
        contents = await file.read()
        reader = PdfReader(io.BytesIO(contents))
        paginas = [(page.extract_text() or "") for page in reader.pages]
        texto_bruto = "\n".join(paginas)

        texto_limpo = limpar_texto_pdf(texto_bruto, paginas=paginas)
        sentences = dividir_em_frases(texto_limpo)

        return {
            "filename": file.filename,
            "total_frases": len(sentences),
            "texto_limpo": texto_limpo,
            "sentences": sentences
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)