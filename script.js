
// Configuração inicial obrigatória do PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Altere para true para ver logs detalhados de extração/ordenação/TTS no console.
const DEBUG = true;

const STORAGE_KEY = 'audiolivro_v1';

// Velocidades disponíveis. 1.25x entra na mesma estrutura das demais.
const SPEEDS = [1.0, 1.25, 1.5, 2.0, 0.7];

let state = {
    title: '',
    sentences: [],
    currentIdx: 0,
    rate: 1.0,
    playing: false
};

const utter = new SpeechSynthesisUtterance();

function log(...args) {
    if (DEBUG) console.log(...args);
}

// Garante que as vozes sejam carregadas pelo navegador
let voices = [];
function loadVoices() {
    voices = window.speechSynthesis.getVoices();
}

window.speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

function getBestVoice() {
    // Tenta encontrar a voz do Google em português, que é a mais humana
    return voices.find(v => v.name.includes('Google') && v.lang.includes('pt-BR')) ||
        voices.find(v => v.lang.includes('pt-BR')) ||
        voices[0];
}

// Carregar lista inicial
window.onload = loadRecents;

// Gerenciador de arquivos
document.getElementById('file-input').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
        loadPDF(file);
    } else if (file.type === 'text/plain') {
        loadTXT(file);
    } else {
        alert('Formato não suportado. Use PDF ou TXT.');
    }
};


async function loadPDF(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const response = await fetch('http://127.0.0.1:8000/upload-pdf/', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        if (!data.sentences || !data.sentences.length) {
            throw new Error('Backend não retornou frases utilizáveis.');
        }
        // CORRIGIDO: o backend envia 'sentences' (não 'texto_limpo').
        processText(data.texto_limpo || data.sentences.join(' '), data.filename, data.sentences);
    } catch (err) {
        console.error('PDF backend request failed:', err);
        alert('Não foi possível processar o PDF pelo servidor. Verifique se o backend está disponível e tente novamente.');
        return;
    }
}


function loadTXT(file) {
    const reader = new FileReader();
    reader.onload = e => processText(e.target.result, file.name);
    reader.onerror = () => alert("Erro ao ler o arquivo TXT.");
    reader.readAsText(file);
}


// =====================================================================
// Extração local estruturada (fallback). Ordena por posição X/Y para que
// itálico/negrito (que o PDF.js entrega como itens separados) permaneçam
// na posição correta, e agrupa por linha visual usando o parâmetro 'hasEOL'.
// =====================================================================
function buildTextFromItems(pages) {
    const lines = [];
    for (const items of pages) {
        let line = '';
        // Passo 1: reconstrói as linhas na ordem que o PDF.js entrega
        const rawLines = [];
        for (const item of items) {
            if (!item.str) continue;
            line += item.str;
            if (item.hasEOL || item.str.endsWith('\n')) {
                rawLines.push(line);
                line = '';
            }
        }
        if (line) rawLines.push(line);

        // Passo 2: ordena as linhas pela coordenada Y (topo → base)
        for (const rl of rawLines) {
            if (rl.trim()) lines.push(rl.trim());
        }
    }
    // Ordenação global não é possível sem Y por linha; o PDF.js já entrega
    // as linhas em ordem visual na grande maioria dos casos, mas removemos
    // cabeçalhos/rodapés repetidos e agrupamos em parágrafos.
    const cleaned = lines.filter(l => !/^\s*\d{1,4}\s*$/.test(l)); // remove número de página sozinho

    // Junta linhas removendo hifenização de fim de linha (ex: "cami-\nnho")
    let text = cleaned.join(' ');
    text = text.replace(/(\w)-\s+(\w)/g, '$1$2');
    return text;
}


// =====================================================================
// Camada de normalização linguística (conservadora).
// Não converte números cegamente: só ajusta o que o TTS costuma ler mal.
// =====================================================================
function normalizeText(text) {
    if (!text) return '';
    let t = text;

    // Valores monetários: R$ 1.250,50 -> "mil duzentos e cinquenta reais e cinquenta centavos"
    t = t.replace(/R\$\s*([\d.]+)(?:,(\d{2}))?/g, (m, intPart, cents) => {
        const n = parseFloat(intPart.replace(/\./g, ''));
        if (isNaN(n)) return m;
        let out = numeroParaTexto(n);
        if (n === 1) out += ' real';
        else out += ' reais';
        if (cents) {
            const c = parseInt(cents, 10);
            if (c > 0) out += ' e ' + numeroParaTexto(c) + (c === 1 ? ' centavo' : ' centavos');
        }
        return out;
    });

    // Porcentagens: 25% -> "25 por cento"
    t = t.replace(/(\d+(?:[.,]\d+)?)\s*%/g, '$1 por cento');

    // Datas: 21/10/2026 -> "21 de outubro de 2026"
    t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, d, mo, y) => {
        const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
            'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        const mi = parseInt(mo, 10);
        if (mi < 1 || mi > 12) return m;
        return `${parseInt(d, 10)} de ${meses[mi - 1]} de ${y}`;
    });

    // Separador de milhar: 1.500 -> 1500 (evita ler "um ponto quinhentos")
    t = t.replace(/\b(\d{1,3})(\.\d{3})+\b/g, s => s.replace(/\./g, ''));

    // Limpeza de espaços em excesso
    t = t.replace(/\s+/g, ' ').trim();
    return t;
}

// Converte inteiro em palavras (pt-BR) para valores monetários.
function numeroParaTexto(n) {
    const unid = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete',
        'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze',
        'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta',
        'setenta', 'oitenta', 'noventa'];
    const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
        'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
    if (n === 100) return 'cem';
    if (n < 20) return unid[n];
    if (n < 100) {
        const d = Math.floor(n / 10), u = n % 10;
        return dezenas[d] + (u ? ' e ' + unid[u] : '');
    }
    if (n < 1000) {
        const c = Math.floor(n / 100), r = n % 100;
        return centenas[c] + (r ? ' e ' + numeroParaTexto(r) : '');
    }
    if (n < 1000000) {
        const mi = Math.floor(n / 1000), r = n % 1000;
        let out = numeroParaTexto(mi) + (mi === 1 ? ' mil' : ' mil');
        if (r) out += (r < 100 ? ' e ' : ' ') + numeroParaTexto(r);
        return out;
    }
    return String(n);
}

// =====================================================================
// Divisão em trechos que NUNCA corta frases no meio.
// Usa pontuação natural (. ! ? … ;) e quebras de parágrafo.
// =====================================================================
function splitIntoSentences(text) {
    if (!text) return [];
    // Normaliza quebras: preserva parágrafos (linha vazia) como pausa forte.
    const blocks = text.split(/\n\s*\n+/).map(b => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const out = [];
    for (const block of blocks) {
        const sentinel = '\u0000';
        const ellipses = [];
        let protectedBlock = block.replace(/\.{2,}|…+/g, match => {
            const marker = `${sentinel}E${ellipses.length}${sentinel}`;
            ellipses.push(match);
            return marker;
        });

        // Protege o marcador de seção inicial e pontos internos de números.
        protectedBlock = protectedBlock.replace(
            /^(\s*\d+(?:\.\d+)*)(\.)(?=\s+\w)/,
            (_, number) => number.replace(/\./g, sentinel) + sentinel
        );
        protectedBlock = protectedBlock.replace(/(\d)\.(?=\d)/g, `$1${sentinel}`);

        // A pontuação encerra a frase, mas aspas/fechamentos continuam nela.
        const parts = protectedBlock.match(
            /[^.!?…]+[.!?]+(?:["'”’»)\]}]*)|[^.!?…]+$/g
        ) || [];
        for (const p of parts) {
            const s = p.trim()
                .replace(/\u0000E(\d+)\u0000/g, (_, index) => ellipses[Number(index)])
                .replace(/\u0000/g, '.');
            if (s) out.push(s);
        }
    }
    return out;
}


function processText(text, title, sentences) {
    state.title = title;
    log('[PDF]', 'Conteúdo recebido:', text);

    let base;
    if (sentences && Array.isArray(sentences)) {
        // CORRIGIDO: apenas filtra, sem descartar trechos entre 3 e 10 caracteres
        // que antes sumiam (ex.: "Ele parou." tem 10 exatos e era cortado).
        base = sentences.filter(s => s && s.trim().length > 2);
    } else {
        // Limpeza + normalização antes do split
        const cleanText = normalizeText(text.replace(/\s+/g, ' '));
        base = splitIntoSentences(cleanText);
    }

    state.sentences = base;

    if (state.sentences.length === 0) {
        alert('Não foi possível identificar frases no arquivo.');
        return;
    }

    log('[ESTRUTURA]', state.sentences.length + ' trechos. Itens:', state.sentences.slice(0, 8));


    // Tentar recuperar progresso salvo para este título específico
    const saved = localStorage.getItem(`${STORAGE_KEY}_${title}`);
    if (saved) {
        const prog = JSON.parse(saved);
        state.currentIdx = prog.currentIdx || 0;
        state.rate = prog.rate || 1.0;
    } else {
        state.currentIdx = 0;
        state.rate = 1.0;
    }


    document.getElementById('r-title').textContent = title;
    document.getElementById('btn-spd').textContent = state.rate.toFixed(2) + 'x';

    renderText();
    document.getElementById('screen-import').hidden = true;
    document.getElementById('screen-reader').hidden = false;

    highlight();
}


function renderText() {
    const container = document.getElementById('reading-inner');
    container.innerHTML = state.sentences.map((s, i) =>
        `<span class="sent" id="s-${i}" onclick="goTo(${i})">${s}</span>`
    ).join(" ");
}


function goTo(i) {
    state.currentIdx = i;
    const wasPlaying = state.playing;
    cancelSpeech();
    highlight();
    if (wasPlaying) speak();
}


function highlight() {
    document.querySelectorAll('.sent').forEach(el => el.classList.remove('reading'));
    const active = document.getElementById(`s-${state.currentIdx}`);

    if (active) {
        active.classList.add('reading');
        active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const pct = (state.currentIdx / state.sentences.length) * 100;
    document.getElementById('prog-fill').style.width = pct + '%';
    document.getElementById('pos-txt').textContent = `${state.currentIdx + 1} / ${state.sentences.length}`;

    saveProgress();
}


function saveProgress() {
    if (!state.title) return;

    const data = {
        title: state.title,
        currentIdx: state.currentIdx,
        total: state.sentences.length,
        rate: state.rate,
        date: Date.now()
    };
    localStorage.setItem(`${STORAGE_KEY}_${state.title}`, JSON.stringify(data));

    salvarNoMySQL(state.title, state.currentIdx); // salva no MySQL também
}


function loadRecents() {
    const list = document.getElementById('book-list');
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(STORAGE_KEY + '_')) {
            items.push(JSON.parse(localStorage.getItem(key)));
        }
    }

    // Ordenar por data (mais recentes primeiro)
    items.sort((a, b) => b.date - a.date);

    if (items.length === 0) {
        list.innerHTML = `<p class="no-recents">Nenhum arquivo recente.</p>`;
        return;
    }

    list.innerHTML = items.slice(0, 5).map(item => `
            <div class="recent-item" onclick="alert('Como o arquivo original não fica guardado no navegador por segurança, por favor selecione o arquivo ${item.title} novamente para continuar de onde parou.')">
                <div>${item.title}</div>
                <div>${Math.round((item.currentIdx / item.total) * 100)}% concluído</div>
            </div>
        `).join('');
}


function togglePlay() {
    if (state.playing) {
        cancelSpeech();
        state.playing = false;
        document.getElementById('play-icon').textContent = '▶';
    } else {
        state.playing = true;
        document.getElementById('play-icon').textContent = '⏸';
        speak();
    }
}
function speak() {
    if (!state.playing || state.currentIdx >= state.sentences.length) {
        if (state.currentIdx >= state.sentences.length) {
            state.playing = false;
            document.getElementById('play-icon').textContent = '▶';
        }
        return;
    }

    // CORRIGIDO: speak() não faz cancel() ao ser chamado pelo próprio onend.
    // O cancel só ocorre em cancelSpeech(), usado por pause/salto/troca de
    // velocidade. Cancelar a cada fala abortava a utter corrente em alguns
    // navegadores, fazendo trechos serem pulados ou lidos fora de ordem.

    utter.text = state.sentences[state.currentIdx];

    // --- AS MELHORIAS DE VOZ ESTÃO AQUI ---
    utter.voice = getBestVoice(); // Escolhe a voz mais humana disponível
    utter.rate = state.rate;      // Respeita exatamente a velocidade escolhida
    utter.pitch = 1.0;            // Ajuste entre 0.8 e 1.2 para mudar o tom
    utter.lang = 'pt-BR';
    // --------------------------------------

    log('[TTS] Trecho ' + String(state.currentIdx).padStart(3, '0'), utter.text);

    utter.onend = () => {
        if (state.playing) {
            state.currentIdx++;
            highlight();
            speak();
        }
    };

    utter.onerror = (e) => {
        console.error("Erro na síntese:", e);
        state.playing = false;
    };

    window.speechSynthesis.speak(utter);
}

// Interrompe a fala atual e reinicia a partir do índice corrente.
function cancelSpeech() {
    window.speechSynthesis.cancel();
}

window.speechSynthesis.cancel(); // Limpa fila anterior


function next() {
    state.currentIdx = Math.min(state.sentences.length - 1, state.currentIdx + 1);
    cancelSpeech();
    highlight();
    if (state.playing) speak();
}

function prev() {
    state.currentIdx = Math.max(0, state.currentIdx - 1);
    cancelSpeech();
    highlight();
    if (state.playing) speak();
}

function cycleSpeed() {
    let currentPos = SPEEDS.indexOf(state.rate);
    if (currentPos === -1) currentPos = 0;
    state.rate = SPEEDS[(currentPos + 1) % SPEEDS.length];
    document.getElementById('btn-spd').textContent = state.rate.toFixed(2) + 'x';
    log('[TTS] Velocidade:', state.rate);
    if (state.playing) {
        cancelSpeech();
        speak();
    }
}

function handleProgClick(e) {
    const track = document.getElementById('prog-track');
    const pct = e.offsetX / track.offsetWidth;
    state.currentIdx = Math.min(state.sentences.length - 1, Math.floor(pct * state.sentences.length));
    cancelSpeech();
    highlight();
    if (state.playing) speak();
}

//CONEXAO COM O BACKEND PARA SALVAR PROGRESSO NO MYSQL (EXEMPLO SIMPLIFICADO, REQUER BACKEND CONFIGURADO)
async function salvarNoMySQL(idLivro, indice) {
    console.log('DADOS ENVIADOS:', {
        id_Livro: idLivro,
        tipo_id: typeof idLivro,
        indice_frase: indice,
        tipo_indice: typeof indice
    });

    try {
        const url = 'http://127.0.0.1:8000/salvar';

        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id_Livro: idLivro,
                indice_frase: indice
            })
        });
        console.log("Salvo no MySQL");
    } catch (error) {
        console.warn('Servidor python offline. Progresso salvo apenas no navegador');
    }
}
