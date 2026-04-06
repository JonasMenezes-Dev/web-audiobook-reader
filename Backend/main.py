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

def limpar_texto_pdf(texto):
    texto = re.sub(r'^\d+[\s.]+', '', texto, flags=re.MULTILINE)
    texto = re.sub(r'^\s*\d+\s*$', '', texto, flags=re.MULTILINE)
    texto = re.sub(r'\n+', ' ', texto)
    texto = re.sub(r'\s+', ' ', texto).strip()
    return texto

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
        texto_bruto = ""
        for page in reader.pages:
            texto_bruto += (page.extract_text() or "") + " "
        
        texto_limpo = limpar_texto_pdf(texto_bruto)
        sentences = re.split(r'(?<=[.!?])\s+', texto_limpo)
        sentences = [s.strip() for s in sentences if len(s.strip()) > 10]
        
        return {
            "filename": file.filename, 
            "total_frases": len(sentences),
            "sentences": sentences
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)