
// Altere para true para ver logs detalhados de extração/ordenação/TTS no console.
const DEBUG = false;

const STORAGE_KEY = 'audiolivro_v1';

// Em produção, substitua pela URL pública do backend hospedado.
// O endereço local continua como padrão para desenvolvimento no PC.
const API_BASE_URL = window.AUDIOLIVRO_API_URL ||
    (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'http://127.0.0.1:8000' : '');

// Velocidades disponíveis. 1.25x entra na mesma estrutura das demais.
const SPEEDS = [1.0, 1.25, 1.5, 2.0, 0.7];

// Cada fala usa uma instância própria de SpeechSynthesisUtterance.
// Reutilizar um único objeto global fazia o navegador entregar eventos
// onend/onerror de falas canceladas DEPOIS do próximo speak(), travando
// o player após algumas pausas (o handler antigo reatribuía o novo).
// A geração invalida callbacks obsoletos: só quem a criou pode reagir.
let speechGeneration = 0;

let state = {
    title: '',
    sentences: [],
    currentIdx: 0,
    rate: 1.0,
    playing: false,
    chapters: []
};

function log(...args) {
    if (DEBUG) console.log(...args);
}

// As vozes disponíveis variam conforme o navegador e o dispositivo.
const VOICE_STORAGE_KEY = 'audiolivro_voice_v1';
let voices = [];

function voiceKey(voice) {
    return `${voice.name}::${voice.lang}`;
}

function isBrazilianPortuguese(voice) {
    return (voice.lang || '').toLowerCase() === 'pt-br';
}

function getPreferredVoice() {
    return voices.find(v => isBrazilianPortuguese(v) && /google/i.test(v.name)) ||
        voices.find(isBrazilianPortuguese) ||
        voices.find(v => (v.lang || '').toLowerCase().startsWith('pt-')) ||
        voices[0];
}

function loadVoices() {
    voices = window.speechSynthesis.getVoices();
    const select = document.getElementById('voice-select');
    if (!select || voices.length === 0) return;

    let savedVoiceKey = '';
    try {
        savedVoiceKey = localStorage.getItem(VOICE_STORAGE_KEY) || '';
    } catch (_) {
        // A seleção continua funcionando mesmo se o armazenamento estiver indisponível.
    }

    const previousKey = select.value;
    const sortedVoices = [...voices].sort((a, b) => {
        const aPortuguese = (a.lang || '').toLowerCase().startsWith('pt-');
        const bPortuguese = (b.lang || '').toLowerCase().startsWith('pt-');
        if (aPortuguese !== bPortuguese) return aPortuguese ? -1 : 1;
        if (isBrazilianPortuguese(a) !== isBrazilianPortuguese(b)) {
            return isBrazilianPortuguese(a) ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    select.replaceChildren();
    sortedVoices.forEach(voice => {
        const option = document.createElement('option');
        option.value = voiceKey(voice);
        option.textContent = `${voice.name} — ${voice.lang || 'idioma desconhecido'}`;
        select.appendChild(option);
    });

    const preferred = getPreferredVoice();
    const availableKeys = new Set(voices.map(voiceKey));
    select.value = availableKeys.has(savedVoiceKey) ? savedVoiceKey :
        availableKeys.has(previousKey) ? previousKey :
        preferred ? voiceKey(preferred) : voiceKey(voices[0]);
}

window.speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

function getBestVoice() {
    const select = document.getElementById('voice-select');
    const selectedKey = select ? select.value : '';
    return voices.find(voice => voiceKey(voice) === selectedKey) || getPreferredVoice();
}

const voiceSelect = document.getElementById('voice-select');
if (voiceSelect) {
    voiceSelect.addEventListener('change', () => {
        try {
            localStorage.setItem(VOICE_STORAGE_KEY, voiceSelect.value);
        } catch (_) {
            // Não impede a leitura se o armazenamento estiver indisponível.
        }

        // Se estiver lendo, aplica a nova voz imediatamente na frase atual.
        if (state.playing) {
            cancelSpeech();
            speak();
        }
    });
}

// Carregar lista inicial
window.onload = loadRecents;

// Ao retomar um livro recente, o navegador pede o arquivo original; o conteúdo não é armazenado.
let requestedResumeTitle = '';

// Salva novamente quando a página vai para segundo plano ou é fechada.
window.addEventListener('pagehide', saveProgress);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveProgress();
});

// Gerenciador de arquivos
const fileInput = document.getElementById('file-input');
fileInput.addEventListener('cancel', () => { requestedResumeTitle = ''; });

fileInput.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        if (requestedResumeTitle) {
            const expectedTitle = requestedResumeTitle;
            requestedResumeTitle = '';
            if (file.name !== expectedTitle) {
                alert(`Para retomar “${expectedTitle}”, selecione esse mesmo arquivo.`);
                return;
            }
        }
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            await loadPDF(file);
        } else if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
            loadTXT(file);
        } else {
            alert('Formato não suportado. Use PDF ou TXT.');
        }
    } finally {
        // Permite selecionar o mesmo arquivo novamente caso seja necessário.
        fileInput.value = '';
    }
};

function showLoading(title, message, progress = null) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    document.getElementById('loading-title').textContent = title;
    document.getElementById('loading-message').textContent = message;
    setLoadingProgress(progress);
    overlay.hidden = false;
    document.body.setAttribute('aria-busy', 'true');
}

function setLoadingProgress(progress) {
    const bar = document.querySelector('#loading-progress span');
    const value = document.getElementById('loading-percent');
    const container = document.getElementById('loading-progress');
    if (progress === null || progress === undefined || !Number.isFinite(progress)) {
        if (value) value.hidden = true;
        if (container) container.classList.add('is-indeterminate');
        if (bar) bar.style.width = '35%';
        return;
    }

    const bounded = Math.max(0, Math.min(100, progress));
    if (value) {
        value.hidden = false;
        value.textContent = Math.round(bounded) + '%';
    }
    if (container) container.classList.remove('is-indeterminate');
    if (bar) bar.style.width = bounded + '%';
}

function updateLoading(title, message, progress = null) {
    const titleEl = document.getElementById('loading-title');
    const messageEl = document.getElementById('loading-message');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    setLoadingProgress(progress);
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.hidden = true;
    document.body.removeAttribute('aria-busy');
}

function loadPDF(file) {
    if (!API_BASE_URL) {
        alert('O servidor de PDFs ainda não foi configurado. Configure a URL pública em config.js.');
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        const xhr = new XMLHttpRequest();
        let responseOffset = 0;
        let pendingText = '';
        let resultReceived = false;

        showLoading('Enviando seu PDF', '0% do arquivo enviado', 0);

        function handleEvent(event) {
            if (!event || typeof event !== 'object') return;
            if (event.type === 'progress') {
                if (event.stage === 'extracting') {
                    if (event.total_pages > 0) {
                        const pagePct = (event.page / event.total_pages) * 100;
                        updateLoading(
                            'Extraindo texto do PDF',
                            `Página ${event.page} de ${event.total_pages} processada`,
                            pagePct
                        );
                    } else {
                        updateLoading('Analisando PDF', 'Preparando a extração das páginas…', null);
                    }
                } else if (event.stage === 'rebuilding') {
                    updateLoading(
                        'Organizando o conteúdo',
                        'A extração das páginas terminou. Reconstruindo parágrafos e títulos…',
                        null
                    );
                } else if (event.stage === 'filtering') {
                    updateLoading(
                        'Finalizando o audiolivro',
                        'Aplicando os filtros de leitura e preparando as frases…',
                        null
                    );
                }
                return;
            }

            if (event.type === 'error') {
                throw new Error(event.message || 'Falha ao processar o PDF.');
            }

            if (event.type === 'result') {
                const data = event.data;
                if (!data || !data.sentences || !data.sentences.length) {
                    throw new Error('O servidor não retornou frases utilizáveis.');
                }
                resultReceived = true;
                updateLoading('Audiolivro pronto', 'Abrindo o leitor…', 100);
                processText(data.texto_limpo || data.sentences.join(' '), data.filename || file.name, data.sentences);
            }
        }

        function consumeResponseChunk() {
            const chunk = xhr.responseText.slice(responseOffset);
            responseOffset = xhr.responseText.length;
            pendingText += chunk;
            const lines = pendingText.split('\n');
            pendingText = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) continue;
                handleEvent(JSON.parse(line));
            }
        }

        xhr.upload.onprogress = event => {
            if (event.lengthComputable) {
                const pct = event.total ? (event.loaded / event.total) * 100 : 0;
                updateLoading('Enviando seu PDF', `${Math.round(pct)}% do arquivo enviado`, pct);
            }
        };

        xhr.upload.onload = () => {
            updateLoading('PDF enviado', 'Aguardando o servidor iniciar a extração…', null);
        };

        xhr.onprogress = () => {
            try {
                consumeResponseChunk();
            } catch (err) {
                xhr.abort();
                reject(err);
            }
        };

        xhr.onerror = () => reject(new Error('Falha de conexão com o servidor.'));
        xhr.onabort = () => reject(new Error('O processamento do PDF foi interrompido.'));
        xhr.onload = () => {
            try {
                consumeResponseChunk();
                if (pendingText.trim()) handleEvent(JSON.parse(pendingText));
                if (xhr.status < 200 || xhr.status >= 300) {
                    throw new Error(`O servidor respondeu com status ${xhr.status}`);
                }
                if (!resultReceived) {
                    throw new Error('O servidor encerrou a resposta sem retornar o PDF processado.');
                }
                resolve();
            } catch (err) {
                reject(err);
            }
        };

        xhr.open('POST', `${API_BASE_URL}/upload-pdf-progress/`);
        xhr.setRequestHeader('Accept', 'application/x-ndjson');
        xhr.send(formData);
    }).catch(err => {
        console.error('PDF backend request failed:', err);
        alert('Não foi possível processar o PDF pelo servidor. Verifique sua conexão e tente novamente.');
    }).finally(hideLoading);
}

function loadTXT(file) {
    showLoading('Abrindo seu texto', 'Preparando a leitura do arquivo…', 0);
    const reader = new FileReader();

    reader.onprogress = event => {
        if (event.lengthComputable) {
            const pct = event.total ? (event.loaded / event.total) * 100 : 0;
            updateLoading('Abrindo seu texto', `${Math.round(pct)}% do arquivo lido`, pct);
        }
    };

    reader.onload = e => {
        try {
            updateLoading('Preparando a leitura', 'Texto carregado. Organizando o conteúdo…', null);
            processText(e.target.result, file.name);
        } catch (err) {
            console.error('TXT processing failed:', err);
            alert('Não foi possível abrir este arquivo TXT.');
        } finally {
            hideLoading();
        }
    };

    reader.onerror = () => {
        hideLoading();
        alert('Erro ao ler o arquivo TXT.');
    };

    reader.readAsText(file);
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
    // Mantém quebras de parágrafo para que a leitura preserve pausas naturais.
    t = t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
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

    // O backend (PDF) já envia as frases filtradas. O TXT é dividido aqui.
    // Filtra apenas trechos vazios/curtos demais (ex.: "Ele parou." continua).
    const base = sentences && Array.isArray(sentences)
        ? sentences.filter(s => s && s.trim().length > 2)
        : splitIntoSentences(normalizeText(text));

    state.sentences = base;

    if (state.sentences.length === 0) {
        alert('Não foi possível identificar frases no arquivo.');
        return;
    }

    log('[ESTRUTURA]', state.sentences.length + ' trechos. Itens:', state.sentences.slice(0, 8));

    // Recupera o progresso salvo sem deixar dados locais corrompidos travarem a leitura.
    let prog = null;
    try {
        const saved = localStorage.getItem(`${STORAGE_KEY}_${title}`);
        prog = saved ? JSON.parse(saved) : null;
    } catch (err) {
        console.warn('Progresso salvo inválido; iniciando do começo.');
    }

    const savedIndex = prog && Number.isInteger(prog.currentIdx) ? prog.currentIdx : 0;
    state.currentIdx = Math.max(0, Math.min(savedIndex, state.sentences.length - 1));
    state.rate = prog && SPEEDS.includes(prog.rate) ? prog.rate : 1.0;

    document.getElementById('r-title').textContent = title;
    document.querySelector('#btn-spd span').textContent = state.rate.toFixed(2) + 'x';

    renderText();
    renderChapterOptions();
    document.getElementById('screen-import').hidden = true;
    document.getElementById('screen-reader').hidden = false;

    highlight();
}


// Identifica títulos comuns sem depender do formato original do PDF.
function detectChapters(sentences) {
    const chapters = [];
    sentences.forEach((raw, index) => {
        const title = String(raw || '').trim();
        if (!title || title.length > 100) return;
        const namedHeading = /^(?:cap[ií]tulo|chapter|parte|se[cç][aã]o|unidade|m[oó]dulo|ap[eê]ndice|introdu[cç][aã]o|conclus[aã]o|refer[eê]ncias|bibliografia)\b/i.test(title);
        const numberedHeading = /^\d+(?:\.\d+){0,4}\.?\s+\S/.test(title);
        const letters = title.match(/[A-Za-zÀ-ÿ]/g) || [];
        const uppercaseHeading = title.length <= 65 && letters.length >= 4 &&
            title === title.toLocaleUpperCase('pt-BR') && !/[.!?]$/.test(title);
        if (namedHeading || numberedHeading || uppercaseHeading) {
            chapters.push({ index, title });
        }
    });
    return chapters;
}

function renderChapterOptions() {
    const select = document.getElementById('chapter-select');
    if (!select) return;
    state.chapters = detectChapters(state.sentences);
    select.replaceChildren();
    if (state.chapters.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Nenhuma seção detectada';
        select.appendChild(option);
        select.disabled = true;
        return;
    }
    select.disabled = false;
    state.chapters.forEach((chapter, position) => {
        const option = document.createElement('option');
        option.value = String(chapter.index);
        const label = chapter.title.length > 54 ? chapter.title.slice(0, 51) + '…' : chapter.title;
        option.textContent = `${position + 1}. ${label}`;
        select.appendChild(option);
    });
    updateChapterSelection();
}

function updateChapterSelection() {
    const select = document.getElementById('chapter-select');
    if (!select || !state.chapters.length) return;
    let active = state.chapters[0];
    for (const chapter of state.chapters) {
        if (chapter.index > state.currentIdx) break;
        active = chapter;
    }
    select.value = String(active.index);
}

function goToChapter(value) {
    const index = Number(value);
    if (Number.isInteger(index) && state.chapters.some(chapter => chapter.index === index)) {
        jumpTo(index, true);
    }
}

function renderText() {
    const container = document.getElementById('reading-inner');
    container.replaceChildren();

    state.sentences.forEach((sentence, index) => {
        const span = document.createElement('span');
        span.className = 'sent';
        span.id = `s-${index}`;
        span.textContent = sentence;
        span.addEventListener('click', () => goTo(index));
        container.appendChild(span);
        container.appendChild(document.createTextNode(' '));
    });
}


// Salta para um índice mantendo a reprodução se ela estava ativa.
// instant=true rola direto para o trecho (clique); false anima (avanço do áudio).
function jumpTo(i, instant = false) {
    state.currentIdx = i;
    const wasPlaying = state.playing;
    cancelSpeech();
    highlight(true, instant);
    if (wasPlaying) speak();
}


function goTo(i) {
    // Salto por clique: rola imediatamente para o trecho, sem animação.
    jumpTo(i, true);
}


function scrollToActive(behavior = 'smooth') {
    const active = document.getElementById(`s-${state.currentIdx}`);
    const area = document.getElementById('reading-area');
    if (!active || !area) return;

    // Rola apenas a área do texto e mantém a frase atual no centro da tela.
    const areaRect = area.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const targetTop = area.scrollTop
        + activeRect.top - areaRect.top
        - (area.clientHeight / 2)
        + (activeRect.height / 2);

    area.scrollTo({ top: Math.max(0, targetTop), behavior });
}


function highlight(scroll = true, instant = false) {
    document.querySelectorAll('.sent').forEach(el => el.classList.remove('reading'));
    const active = document.getElementById(`s-${state.currentIdx}`);

    if (active) {
        active.classList.add('reading');
        if (scroll) {
            // Acompanhar cada frase lida automaticamente, sem exigir rolagem manual.
            // Em saltos de seção, a rolagem é imediata; durante a narração, é suave.
            scrollToActive(instant ? 'auto' : 'smooth');
        }
    }

    const pct = state.sentences.length > 1 ? (state.currentIdx / (state.sentences.length - 1)) * 100 : 100;
    document.getElementById('prog-fill').style.width = pct + '%';
    const progressTrack = document.getElementById('prog-track');
    if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(Math.round(pct)));
    document.getElementById('pos-txt').textContent = `${state.currentIdx + 1} / ${state.sentences.length}`;
    updateChapterSelection();
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
    // O progresso fica somente neste navegador/dispositivo.
    try {
        localStorage.setItem(`${STORAGE_KEY}_${state.title}`, JSON.stringify(data));
    } catch (err) {
        console.warn('Não foi possível salvar o progresso neste navegador.');
    }
}


function loadRecents() {
    const list = document.getElementById('book-list');
    if (!list) return;

    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(STORAGE_KEY + '_')) continue;

        try {
            const item = JSON.parse(localStorage.getItem(key));
            if (
                item &&
                typeof item.title === 'string' &&
                Number.isFinite(item.date) &&
                Number.isInteger(item.currentIdx) &&
                Number.isInteger(item.total) &&
                item.total > 0
            ) {
                items.push(item);
            }
        } catch (err) {
            // Ignora registros locais corrompidos sem impedir a abertura do app.
        }
    }

    // Ordenar por data (mais recentes primeiro)
    items.sort((a, b) => b.date - a.date);
    list.replaceChildren();

    if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'no-recents';
        empty.textContent = 'Nenhum arquivo recente.';
        list.appendChild(empty);
        return;
    }

    items.slice(0, 5).forEach(item => {
        const recent = document.createElement('div');
        recent.className = 'recent-item';
        recent.tabIndex = 0;
        recent.setAttribute('role', 'button');

        const title = document.createElement('div');
        title.textContent = item.title;

        const progress = document.createElement('div');
        const pct = Math.max(0, Math.min(100, Math.round((item.currentIdx / item.total) * 100)));
        progress.textContent = `${pct}% concluído`;

        const resumeMessage = () => {
            requestedResumeTitle = item.title;
            fileInput.click();
        };
        recent.addEventListener('click', resumeMessage);
        recent.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                resumeMessage();
            }
        });

        recent.append(title, progress);
        list.appendChild(recent);
    });
}


function togglePlay() {
    if (state.playing) {
        state.playing = false;
        document.getElementById('play-icon').textContent = '▶';
        cancelSpeech();
    } else {
        state.playing = true;
        document.getElementById('play-icon').textContent = '⏸';
        speak();
    }
}

function speak() {
    if (state.currentIdx >= state.sentences.length) {
        // Fim do livro: encerra a reprodução.
        state.playing = false;
        document.getElementById('play-icon').textContent = '▶';
        return;
    }
    if (!state.playing) return;

    // Nova instância por fala: evita que eventos de falas canceladas
    // reatribuam os handlers da fala corrente (causa do travamento).
    const generation = ++speechGeneration;
    const utter = new SpeechSynthesisUtterance(state.sentences[state.currentIdx]);
    utter.voice = getBestVoice(); // Escolhe a voz mais humana disponível
    utter.rate = state.rate;      // Respeita exatamente a velocidade escolhida
    utter.pitch = 1.0;            // Ajuste entre 0.8 e 1.2 para mudar o tom
    utter.lang = utter.voice?.lang || 'pt-BR';

    log('[TTS] Trecho ' + String(state.currentIdx).padStart(3, '0'), utter.text);

    utter.onend = () => {
        if (generation !== speechGeneration || !state.playing) return;
        state.currentIdx++;
        highlight();
        speak();
    };

    utter.onerror = (e) => {
        // 'interrupted'/'canceled' são esperados ao pausar/saltar: ignorar.
        if (generation !== speechGeneration) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        console.error("Erro na síntese:", e);
        state.playing = false;
        document.getElementById('play-icon').textContent = '▶';
    };

    window.speechSynthesis.speak(utter);
}

// Interrompe a fala atual invalidando os callbacks pendentes.
function cancelSpeech() {
    speechGeneration++;
    window.speechSynthesis.cancel();
}


function next() {
    jumpTo(Math.min(state.sentences.length - 1, state.currentIdx + 1));
}

function prev() {
    jumpTo(Math.max(0, state.currentIdx - 1));
}

function cycleSpeed() {
    let currentPos = SPEEDS.indexOf(state.rate);
    if (currentPos === -1) currentPos = 0;
    state.rate = SPEEDS[(currentPos + 1) % SPEEDS.length];
    document.querySelector('#btn-spd span').textContent = state.rate.toFixed(2) + 'x';
    log('[TTS] Velocidade:', state.rate);
    if (state.playing) {
        cancelSpeech();
        speak();
    }
}

function handleProgClick(e) {
    const track = document.getElementById('prog-track');
    const pct = e.offsetX / track.offsetWidth;
    const alvo = Math.min(state.sentences.length - 1, Math.floor(pct * state.sentences.length));
    jumpTo(alvo, true);
}
