from fastapi import FastAPI 
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import mysql.connector 

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
    'password': "",
    'database': "audiolivro_db"
}

class DadosProgresso(BaseModel):
    id_Livro: str
    indice_frase: int

@app.get("/")
def home():
    return {"status": "Online", "msg": "Backend do Audiolivro rodando!"}

@app.post("/salvar")
def salvar_progresso(progresso: DadosProgresso):
    try:
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()
        sql = """
            INSERT INTO progesso (id_Livro, indice_frase)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE indice_frase = VALUES(indice_frase)
            """
        cursor.execute(sql, (progresso.id_Livro, progresso.indice_frase))
        conn.commit()
        cursor.close()
        return {"status": "success", "message": "Progresso salvo com sucesso!"}
    except Exception as e:
        return {"status": "erro", "detalhes": str(e)}