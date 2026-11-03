"""Preview de auditoria: API local e frontend original, sem alterar config.js."""
import sys
from pathlib import Path

from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from Backend.main import app


@app.get('/config.js')
def local_config():
    return Response("window.AUDIOLIVRO_API_URL = 'http://127.0.0.1:8767';", media_type='text/javascript')


app.mount('/', StaticFiles(directory=ROOT, html=True), name='audit-preview')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8767)
