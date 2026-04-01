
// Configuração inicial obrigatória do PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let state = {
    title: '',
    sentences: [],
    currentIdx: 0,
    rate: 1.0,
    playing: false
};

const STORAGE_KEY = 'audiolivro_v1';
const utter = new SpeechSynthesisUtterance();

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
    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            // O join com espaço evita que palavras no fim da linha fiquem grudadas
            fullText += content.items.map(item => item.str).join(" ") + " ";
        }

        if (fullText.trim().length < 5) throw new Error("PDF sem texto extraível.");
        processText(fullText, file.name);
    } catch (err) {
        console.error(err);
        alert("Erro ao ler o PDF: " + err.message);
    }
}

function loadTXT(file) {
    const reader = new FileReader();
    reader.onload = e => processText(e.target.result, file.name);
    reader.onerror = () => alert("Erro ao ler o arquivo TXT.");
    reader.readAsText(file);
}

function processText(text, title) {
    state.title = title;
    // Limpeza básica de espaços e quebras de linha antes do split
    const cleanText = text.replace(/\s+/g, ' ');
    state.sentences = cleanText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 2);

    if (state.sentences.length === 0) {
        alert('Não foi possível identificar frases no arquivo.');
        return;
    }

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
    document.getElementById('btn-spd').textContent = state.rate.toFixed(1) + 'x';

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
    window.speechSynthesis.cancel();
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
        list.innerHTML = `<p style="color:var(--text-muted); font-size:0.8rem;">Nenhum arquivo recente.</p>`;
        return;
    }

    list.innerHTML = items.slice(0, 5).map(item => `
            <div class="recent-item" onclick="alert('Como o arquivo original não fica guardado no navegador por segurança, por favor selecione o arquivo ${item.title} novamente para continuar de onde parou.')">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%;">
                    ${item.title}
                </div>
                <div style="font-size:0.7rem; color:var(--accent);">
                    ${Math.round((item.currentIdx / item.total) * 100)}% concluído
                </div>
            </div>
        `).join('');
}

function togglePlay() {
    if (state.playing) {
        window.speechSynthesis.cancel();
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

    window.speechSynthesis.cancel(); // Para qualquer fala anterior

    utter.text = state.sentences[state.currentIdx];

    // --- AS MELHORIAS DE VOZ ESTÃO AQUI ---
    utter.voice = getBestVoice(); // Escolhe a voz mais humana disponível
    utter.rate = state.rate * 1.0; // Deixa um tiquinho mais lento para parecer natural
    utter.pitch = 1.0;               // Ajuste entre 0.8 e 1.2 para mudar o tom
    utter.lang = 'pt-BR';
    // --------------------------------------

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
window.speechSynthesis.cancel(); // Limpa fila anterior


function next() {
    state.currentIdx = Math.min(state.sentences.length - 1, state.currentIdx + 1);
    highlight();
    if (state.playing) speak();
}

function prev() {
    state.currentIdx = Math.max(0, state.currentIdx - 1);
    highlight();
    if (state.playing) speak();
}

function cycleSpeed() {
    const speeds = [1.0, 1.5, 2.0, 0.7];
    let currentPos = speeds.indexOf(state.rate);
    state.rate = speeds[(currentPos + 1) % speeds.length];
    document.getElementById('btn-spd').textContent = state.rate.toFixed(1) + 'x';
    if (state.playing) speak();
}

function handleProgClick(e) {
    const track = document.getElementById('prog-track');
    const pct = e.offsetX / track.offsetWidth;
    state.currentIdx = Math.floor(pct * state.sentences.length);
    highlight();
    if (state.playing) speak();
}
