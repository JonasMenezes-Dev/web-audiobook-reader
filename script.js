
// Altere para true para ver logs detalhados de extração/ordenação/TTS no console.
const DEBUG = false;

const STORAGE_KEY = 'audiolivro_v1';

const THEME_STORAGE_KEY = 'audiolivro_theme_v1';
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let hasSavedTheme = false;

function applyTheme(theme) {
    const normalizedTheme = theme === 'light' ? 'light' : 'dark';
    document.body.dataset.theme = normalizedTheme;

    const button = document.getElementById('theme-toggle');
    if (button) {
        const isLight = normalizedTheme === 'light';
        button.innerHTML = isLight
            ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span>Modo escuro</span>'
            : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span>Modo claro</span>';
        button.setAttribute('aria-label', isLight ? 'Ativar modo escuro' : 'Ativar modo claro');
        button.setAttribute('title', isLight ? 'Ativar modo escuro' : 'Ativar modo claro');
    }

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', normalizedTheme === 'light' ? '#f6f2e9' : '#24211e');
}

function toggleTheme() {
    const nextTheme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    hasSavedTheme = true;
    applyTheme(nextTheme);
    try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (_) {
        // A troca de tema continua funcionando se o armazenamento estiver indisponível.
    }
}

try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    hasSavedTheme = savedTheme === 'light' || savedTheme === 'dark';
    applyTheme(hasSavedTheme ? savedTheme : systemTheme.matches ? 'dark' : 'light');
} catch (_) {
    applyTheme(systemTheme.matches ? 'dark' : 'light');
}
systemTheme.addEventListener('change', () => {
    if (!hasSavedTheme) applyTheme(systemTheme.matches ? 'dark' : 'light');
});

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
let speechPauseTimer = null;
let pendingDocumentId = null;
let requestedResumeId = null;
let activeImport = null;
let importGeneration = 0;
let fileSelectionGeneration = 0;
let sentenceElements = [];
let lastHighlightedIndex = -1;

let state = {
    title: '',
    sentences: [],
    currentIdx: 0,
    rate: 1.0,
    playing: false,
    chapters: [],
    blocks: [],
    structured: false,
    sentenceBlocks: [],
    documentId: null,
    storageKey: null,
    speechOffset: 0,
    boundaryKnown: false,
    storageAvailable: null
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
        const shortName = voice.name.replace(/^(?:Microsoft|Google)\s+/i, '').replace(/\s+[-—]\s+.*$/, '');
        const region = (voice.lang || '').split('-')[1] || voice.lang || '?';
        option.textContent = `${shortName} · ${region.toUpperCase()}`;
        option.title = `${voice.name} — ${voice.lang || 'idioma desconhecido'}`;
        select.appendChild(option);
    });

    const preferred = getPreferredVoice();
    const availableKeys = new Set(voices.map(voiceKey));
    select.value = availableKeys.has(savedVoiceKey) ? savedVoiceKey :
        availableKeys.has(previousKey) ? previousKey :
        preferred ? voiceKey(preferred) : voiceKey(voices[0]);
    updateVoiceDescription();
}

function updateVoiceDescription() {
    const select = document.getElementById('voice-select');
    const voice = voices.find(value => voiceKey(value) === select?.value);
    if (select && voice) {
        const description = `${voice.name} — ${voice.lang || 'idioma desconhecido'}`;
        select.title = description;
        select.setAttribute('aria-description', description);
    }
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
        updateVoiceDescription();
        try {
            localStorage.setItem(VOICE_STORAGE_KEY, voiceSelect.value);
        } catch (_) {
            // Não impede a leitura se o armazenamento estiver indisponível.
        }

        // Se estiver lendo, aplica a nova voz imediatamente na frase atual.
        if (state.playing) {
            cancelSpeech(false);
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
const dropZone = document.getElementById('drop-zone');

dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    dropZone.classList.add('is-dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragover'));
dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
    if (!event.dataTransfer || !event.dataTransfer.files.length) return;
    fileInput.files = event.dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
});
fileInput.addEventListener('cancel', () => { requestedResumeTitle = ''; requestedResumeId = null; });

async function identifyFile(file) {
    try {
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    } catch {
        return null; // Sem identidade segura, não compartilhar progresso pelo nome.
    }
}

function anchorHash(value) {
    let a = 2166136261, b = 5381;
    for (const char of String(value).replace(/\s+/g, ' ').trim()) {
        a = Math.imul(a ^ char.charCodeAt(0), 16777619);
        b = Math.imul(b, 33) ^ char.charCodeAt(0);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

fileInput.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const selection = ++fileSelectionGeneration;
    let handedOff = false;

    try {
        const expectedId = requestedResumeId;
        requestedResumeId = null;
        if (requestedResumeTitle) {
            const expectedTitle = requestedResumeTitle;
            requestedResumeTitle = '';
            if (file.name !== expectedTitle) {
                alert(`Para retomar “${expectedTitle}”, selecione esse mesmo arquivo.`);
                return;
            }
        }
        const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isTXT = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
        if (!isPDF && !isTXT) {
            alert('Formato não suportado. Use PDF ou TXT.');
            return;
        }
        showLoading('Identificando arquivo', 'Conferindo a identidade local para recuperar o progresso…', null);
        document.getElementById('cancel-import').onclick = () => {
            fileSelectionGeneration++;
            fileInput.value = '';
            pendingDocumentId = null;
            hideLoading();
        };
        const identity = await identifyFile(file);
        if (selection !== fileSelectionGeneration) return;
        if (expectedId && identity !== expectedId) {
            alert('Este arquivo tem o mesmo nome, mas seu conteúdo é diferente. Selecione o original para retomar.');
            return;
        }
        pendingDocumentId = identity;
        handedOff = true;
        if (isPDF) {
            await loadPDF(file);
        } else if (isTXT) {
            loadTXT(file);
        }
    } finally {
        // Permite selecionar o mesmo arquivo novamente caso seja necessário.
        if (selection === fileSelectionGeneration) {
            fileInput.value = '';
            pendingDocumentId = null;
            if (!handedOff) hideLoading();
        }
    }
};

let loadingPreviousFocus = null;

function showLoading(title, message, progress = null) {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    if (overlay.hidden) loadingPreviousFocus = document.activeElement;
    document.getElementById('loading-title').textContent = title;
    document.getElementById('loading-message').textContent = message;
    setLoadingProgress(progress);
    overlay.hidden = false;
    document.body.setAttribute('aria-busy', 'true');
    document.querySelectorAll('.screen, #theme-toggle').forEach(screen => { screen.inert = true; });
    overlay.focus({ preventScroll: true });
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
    document.querySelectorAll('.screen, #theme-toggle').forEach(screen => { screen.inert = false; });
    const fallback = document.getElementById(document.getElementById('screen-reader').hidden ? 'drop-zone' : 'reading-area');
    const target = loadingPreviousFocus && loadingPreviousFocus !== document.body &&
        loadingPreviousFocus.isConnected && !loadingPreviousFocus.closest('[hidden]') ? loadingPreviousFocus : fallback;
    target.focus({ preventScroll: true });
    loadingPreviousFocus = null;
}

function loadPDF(file) {
    const documentId = pendingDocumentId;
    if (!API_BASE_URL) {
        alert('O servidor de PDFs ainda não foi configurado. Configure a URL pública em config.js.');
        hideLoading();
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        const xhr = new XMLHttpRequest();
        activeImport = xhr;
        let cancelled = false;
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
                const sentences = Array.isArray(data?.sentences) ? data.sentences :
                    Array.isArray(data?.blocos_leitura) ? data.blocos_leitura.flatMap(block =>
                        block.segmentos.filter(segment => Number.isInteger(segment.indice_frase)).map(segment => segment.texto)) : [];
                if (!data || !sentences.length) {
                    throw new Error('O servidor não retornou frases utilizáveis.');
                }
                resultReceived = true;
                updateLoading('Audiolivro pronto', 'Abrindo o leitor…', 100);
                processText('', data.filename || file.name, sentences, data.blocos_leitura, documentId);
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
            if (xhr.status < 200 || xhr.status >= 300) return;
            try {
                consumeResponseChunk();
            } catch (err) {
                reject(err);
                xhr.abort();
            }
        };

        xhr.onerror = () => reject(new Error('Falha de conexão com o servidor. Verifique a conexão e tente selecionar o arquivo novamente.'));
        xhr.onabort = () => { const error = new Error('Importação cancelada.'); error.cancelled = cancelled; reject(error); };
        xhr.timeout = 180000;
        xhr.ontimeout = () => reject(new Error('O servidor demorou mais de 3 minutos. Tente novamente ou divida o PDF.'));
        document.getElementById('cancel-import').onclick = () => { cancelled = true; xhr.abort(); };
        xhr.onload = () => {
            try {
                if (xhr.status < 200 || xhr.status >= 300) {
                    let detail = '';
                    try { detail = JSON.parse(xhr.responseText).detail || ''; } catch { /* erro sem JSON */ }
                    throw new Error(typeof detail === 'string' && detail ? detail : `O servidor respondeu com status ${xhr.status}.`);
                }
                consumeResponseChunk();
                if (pendingText.trim()) handleEvent(JSON.parse(pendingText));
                if (!resultReceived) {
                    throw new Error('O servidor encerrou a resposta sem retornar o PDF processado.');
                }
                resolve();
            } catch (err) {
                reject(err);
            }
        };

        xhr.open('POST', `${API_BASE_URL}/upload-pdf-progress/?compact=true`);
        xhr.setRequestHeader('Accept', 'application/x-ndjson');
        xhr.send(formData);
    }).catch(err => {
        if (!err.cancelled) alert(`Não foi possível processar o PDF pelo servidor. ${err.message}`);
    }).finally(() => { activeImport = null; hideLoading(); });
}

function loadTXT(file) {
    const documentId = pendingDocumentId;
    const generation = ++importGeneration;
    showLoading('Abrindo seu texto', 'Preparando a leitura do arquivo…', 0);
    const reader = new FileReader();
    activeImport = reader;
    document.getElementById('cancel-import').onclick = () => reader.abort();

    reader.onprogress = event => {
        if (event.lengthComputable) {
            const pct = event.total ? (event.loaded / event.total) * 100 : 0;
            updateLoading('Abrindo seu texto', `${Math.round(pct)}% do arquivo lido`, pct);
        }
    };

    reader.onload = e => {
        if (generation !== importGeneration) return;
        try {
            updateLoading('Preparando a leitura', 'Texto carregado. Organizando o conteúdo…', null);
            processText(e.target.result, file.name, undefined, null, documentId);
        } catch (err) {
            console.error('TXT processing failed:', err);
            alert('Não foi possível abrir este arquivo TXT.');
        } finally {
            hideLoading();
            activeImport = null;
        }
    };

    reader.onerror = () => {
        activeImport = null;
        hideLoading();
        alert('Erro ao ler o arquivo TXT.');
    };
    reader.onabort = () => { importGeneration++; activeImport = null; hideLoading(); };

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

    // Números e marcadores de seção permanecem intactos sem contexto inequívoco.

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
        const addresses = [];
        let protectedBlock = block.replace(/\.{2,}|…+/g, match => {
            const marker = `${sentinel}E${ellipses.length}${sentinel}`;
            ellipses.push(match);
            return marker;
        });
        protectedBlock = protectedBlock.replace(
            /(?:https?:\/\/|www\.)[^\s<>]+|\b10\.\d{4,9}\/[^\s<>]+/gi,
            value => {
                const core = value.replace(/[.,;:!?)\]}]+$/, '');
                const marker = `${sentinel}U${addresses.length}${sentinel}`;
                addresses.push(core);
                return marker + value.slice(core.length);
            }
        );
        protectedBlock = protectedBlock.replace(
            /\b(?:profa?|dr[ae]?|sra?|srta|pp?|figs?|vols?|eds?|orgs?|art|arts|cap|pág|págs)\.(?=\s+\S)/gi,
            value => value.replace(/\./g, sentinel)
        );
        protectedBlock = protectedBlock.replace(/\bet\s+al\.(?=\s+[([])/gi, value => value.replace(/\./g, sentinel));
        protectedBlock = protectedBlock.replace(/\b[A-ZÀ-Ý]\.(?=\s+[A-ZÀ-Ý])/g, value => value.replace(/\./g, sentinel));

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
                .replace(/\u0000U(\d+)\u0000/g, (_, index) => addresses[Number(index)])
                .replace(/\u0000E(\d+)\u0000/g, (_, index) => ellipses[Number(index)])
                .replace(/\u0000/g, '.');
            if (s) out.push(s);
        }
    }
    return out;
}


function processText(text, title, sentences, blocks = null, documentId = null) {
    cancelSpeech();
    state.playing = false;
    state.title = title;
    state.documentId = documentId;
    state.storageAvailable = null;
    state.storageKey = documentId ? `${STORAGE_KEY}_sha256:${documentId}` : null;

    // O backend (PDF) já envia as frases filtradas. O TXT é dividido aqui.
    // Filtra apenas trechos vazios/curtos demais (ex.: "Ele parou." continua).
    const base = sentences && Array.isArray(sentences)
        ? sentences.map(s => String(s || '').trim()).filter(Boolean)
        : splitIntoSentences(text);

    state.sentences = base;
    state.structured = Array.isArray(blocks);
    state.blocks = state.structured ? blocks : [];
    if (!state.structured && !Array.isArray(sentences)) {
        let index = 0;
        state.blocks = String(text).replace(/\r\n?/g, '\n').split(/\n\s*\n+/).filter(b => b.trim()).map((block, position) => {
            const parts = splitIntoSentences(block);
            const heading = detectChapters([block.trim()]).length > 0;
            return { id: `texto-${position}`, tipo: heading ? 'titulo' : 'paragrafo', nivel: 1, pagina: null,
                segmentos: parts.map(value => ({ texto: value, indice_frase: index++, trechos: [] })) };
        });
        state.structured = true;
    }
    if (!state.blocks.length) {
        // Compatibilidade: só as frases aprovadas, nunca a estrutura bruta da API.
        state.blocks = [{ id: 'texto-aprovado', tipo: 'paragrafo', pagina: null,
            segmentos: base.map((value, index) => ({ texto: value, indice_frase: index, trechos: [] })) }];
    }
    state.sentenceBlocks = [];
    state.blocks.forEach(block => block.segmentos.forEach(segment => {
        if (Number.isInteger(segment.indice_frase)) state.sentenceBlocks[segment.indice_frase] = block;
    }));

    if (state.sentences.length === 0) {
        alert('Não foi possível identificar frases no arquivo.');
        return;
    }

    log('[ESTRUTURA]', state.sentences.length + ' trechos.');

    // Recupera o progresso salvo sem deixar dados locais corrompidos travarem a leitura.
    let prog = null;
    try {
        const saved = state.storageKey ? localStorage.getItem(state.storageKey) : null;
        prog = saved ? JSON.parse(saved) : null;
        if (prog && (prog.version !== 2 || prog.documentId !== documentId)) prog = null;
        if (!prog && documentId) {
            const legacy = JSON.parse(localStorage.getItem(`${STORAGE_KEY}_${title}`) || 'null');
            if (legacy && Number.isInteger(legacy.currentIdx) &&
                confirm('Há um progresso antigo salvo apenas pelo nome. Confirma que este é o mesmo arquivo e deseja reutilizar a posição aproximada?')) prog = legacy;
        }
    } catch (err) {
        state.storageAvailable = false;
        console.warn('Progresso salvo inválido; iniciando do começo.');
    }

    let savedIndex = prog && Number.isInteger(prog.currentIdx) ? prog.currentIdx : 0;
    let anchorMatched = false;
    if (prog?.version === 2 && prog.anchor?.hash) {
        const matches = state.sentences.map((sentence, index) => ({ index, hash: anchorHash(sentence) }))
            .filter(item => item.hash === prog.anchor.hash);
        const contextual = matches.filter(item =>
            (!prog.anchor.previous || anchorHash(state.sentences[item.index - 1] || '') === prog.anchor.previous) &&
            (!prog.anchor.next || anchorHash(state.sentences[item.index + 1] || '') === prog.anchor.next));
        if (contextual.length === 1) { savedIndex = contextual[0].index; anchorMatched = true; }
        else if (matches.length === 1) { savedIndex = matches[0].index; anchorMatched = true; }
        else savedIndex = 0; // Não adivinhar a posição se o conteúdo mudou ou a âncora for ambígua.
    }
    state.currentIdx = Math.max(0, Math.min(savedIndex, state.sentences.length - 1));
    state.rate = prog && SPEEDS.includes(prog.rate) ? prog.rate : 1.0;
    const speechLength = normalizeText(state.sentences[state.currentIdx]).length;
    state.speechOffset = anchorMatched && Number.isInteger(prog.speechOffset) &&
        prog.speechOffset >= 0 && prog.speechOffset < speechLength ? prog.speechOffset : 0;
    state.boundaryKnown = state.speechOffset > 0;

    document.getElementById('r-title').textContent = title;
    document.getElementById('btn-spd').value = String(state.rate);

    renderText();
    renderChapterOptions();
    document.getElementById('screen-import').hidden = true;
    document.getElementById('screen-reader').hidden = false;
    const headerActions = document.querySelector('.reader-header-actions') || document.querySelector('.reader-header');
    headerActions.appendChild(document.getElementById('theme-toggle'));
    if (window.updateLiquidGlass) window.updateLiquidGlass();

    highlight();
    updatePlaybackUI(documentId ? 'Leitura pronta. Alt e setas para cima ou baixo navegam pelos parágrafos.' :
        'Leitura pronta. A identidade do arquivo não pôde ser verificada; o progresso desta sessão não será salvo.');
}


// Identifica títulos comuns sem depender do formato original do PDF.
function detectChapters(sentences) {
    const chapters = [];
    sentences.forEach((raw, index) => {
        const title = String(raw || '').trim();
        if (!title || title.length > 100 || /[.!?]$/.test(title)) return;
        const namedHeading = /^(?:cap[ií]tulo|chapter|parte|se[cç][aã]o|unidade|m[oó]dulo|ap[eê]ndice|introdu[cç][aã]o|conclus[aã]o|refer[eê]ncias|bibliografia)\b/i.test(title);
        const numberedHeading = /^\d+(?:\.\d+){1,4}\.?\s+\S|^\d+\.\s+\S/.test(title);
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
    state.chapters = state.structured ? state.blocks.filter(block => block.tipo === 'titulo').flatMap(block => {
        const segment = block.segmentos.find(s => Number.isInteger(s.indice_frase));
        return segment ? [{ index: segment.indice_frase, title: block.segmentos.map(s => s.texto).join(' '), level: block.nivel || 1 }] : [];
    }) : detectChapters(state.sentences);
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
        option.textContent = chapter.title;
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
    const fragment = document.createDocumentFragment();
    sentenceElements = [];
    lastHighlightedIndex = -1;

    state.blocks.forEach(block => {
        const tag = block.tipo === 'titulo' ? `h${Math.min(4, (block.nivel || 1) + 1)}` : 'p';
        const element = document.createElement(tag);
        element.className = 'reader-block';
        element.id = block.id;
        element.tabIndex = -1;
        block.segmentos.forEach((segment, position) => {
            if (position) element.appendChild(document.createTextNode(' '));
            const span = document.createElement('span');
            if (Number.isInteger(segment.indice_frase)) {
                span.className = 'sent';
                span.id = `s-${segment.indice_frase}`;
                sentenceElements[segment.indice_frase] = span;
            } else span.className = 'reference-text';
            if (segment.trechos?.length && segment.trechos.map(t => t.texto).join('') === segment.texto) {
                segment.trechos.forEach(trecho => {
                    let part = document.createTextNode(trecho.texto);
                    if (trecho.italico) { const em = document.createElement('em'); em.appendChild(part); part = em; }
                    if (trecho.negrito) { const strong = document.createElement('strong'); strong.appendChild(part); part = strong; }
                    span.appendChild(part);
                });
            } else {
                const sentence = segment.texto;
                span.textContent = sentence;
            }
            element.appendChild(span);
        });
        fragment.appendChild(element);
    });
    container.replaceChildren(fragment);
}

document.getElementById('reading-inner').addEventListener('click', event => {
    const container = event.currentTarget;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && container.contains(selection.anchorNode)) return;
    const sentence = event.target.closest('.sent');
    if (sentence && container.contains(sentence)) goTo(Number(sentence.id.slice(2)));
});


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

    // 'auto' follows the CSS scroll-behavior; temporarily override it so clicks,
    // chapter jumps and appearance adjustments remain immediate.
    const previous = area.style.scrollBehavior;
    if (behavior === 'auto') area.style.scrollBehavior = 'auto';
    area.scrollTo({ top: Math.max(0, targetTop), behavior });
    area.style.scrollBehavior = previous;
}


function highlight(scroll = true, instant = false) {
    sentenceElements[lastHighlightedIndex]?.classList.remove('reading');
    const from = Math.max(0, Math.min(lastHighlightedIndex, state.currentIdx));
    const to = Math.min(sentenceElements.length, Math.max(lastHighlightedIndex, state.currentIdx));
    for (let index = from; index <= to; index++) {
        sentenceElements[index]?.classList.toggle('already-read', index < state.currentIdx);
    }
    const active = sentenceElements[state.currentIdx];
    lastHighlightedIndex = state.currentIdx;

    if (active) {
        active.classList.add('reading');
        if (scroll) {
            instant = instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            scrollToActive(instant ? 'auto' : 'smooth');
        }
    }

    const pct = state.sentences.length > 1 ? Math.min(100, (state.currentIdx / (state.sentences.length - 1)) * 100) : 100;
    document.getElementById('prog-fill').style.width = pct + '%';
    const progressTrack = document.getElementById('prog-track');
    if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (progressTrack) progressTrack.setAttribute('aria-valuetext', `Frase ${Math.min(state.currentIdx + 1, state.sentences.length)} de ${state.sentences.length}`);
    document.getElementById('pos-txt').textContent = `${Math.min(state.currentIdx + 1, state.sentences.length)} / ${state.sentences.length}`;
    updateChapterSelection();
    const source = document.getElementById('source-page');
    const page = state.sentenceBlocks[state.currentIdx]?.pagina;
    if (source) source.textContent = Number.isInteger(page) ? `PDF · p. ${page + 1}` : 'Texto';
    saveProgress();
}


function saveProgress() {
    if (!state.title || !state.storageKey) return;
    const anchorIndex = Math.min(state.currentIdx, state.sentences.length - 1);

    const data = {
        title: state.title,
        currentIdx: state.currentIdx,
        total: state.sentences.length,
        rate: state.rate,
        date: Date.now(),
        version: 2,
        documentId: state.documentId,
        speechOffset: state.speechOffset,
        anchor: {
            hash: anchorHash(state.sentences[anchorIndex] || ''),
            previous: anchorIndex > 0 ? anchorHash(state.sentences[anchorIndex - 1]) : null,
            next: anchorIndex + 1 < state.sentences.length ? anchorHash(state.sentences[anchorIndex + 1]) : null
        }
    };
    // O progresso fica somente neste navegador/dispositivo.
    try {
        localStorage.setItem(state.storageKey, JSON.stringify(data));
        state.storageAvailable = true;
    } catch {
        state.storageAvailable = false;
        updatePlaybackUI('A leitura continua. O progresso não pôde ser salvo neste navegador.');
        // Armazenamento bloqueado ou cheio não deve interromper a leitura.
    }
}


function loadRecents() {
    document.querySelector('.library-header').appendChild(document.getElementById('theme-toggle'));
    const list = document.getElementById('book-list');
    if (!list) return;

    const items = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(STORAGE_KEY + '_')) continue;

            try {
                const item = JSON.parse(localStorage.getItem(key));
                if (item && typeof item.title === 'string' && item.title.trim() && Number.isFinite(item.date)) {
                    items.push(item);
                }
            } catch (err) {
                // Ignora registros locais corrompidos sem impedir a abertura do app.
            }
        }
    } catch (err) {
        // A biblioteca continua disponível quando o navegador bloqueia o armazenamento.
    }

    // Ordenar por data (mais recentes primeiro)
    items.sort((a, b) => b.date - a.date);
    const savedSection = document.getElementById('saved-section');
    const importSection = document.querySelector('.library-import');
    if (items.length) {
        importSection.before(savedSection);
        document.getElementById('library-title').textContent = 'Continue seus estudos.';
    } else importSection.after(savedSection);
    list.replaceChildren();

    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'no-recents';
        const ornament = document.createElement('span');
        ornament.className = 'empty-ornament';
        ornament.setAttribute('aria-hidden', 'true');
        ornament.textContent = '❧';
        const heading = document.createElement('h3');
        heading.textContent = 'Seu primeiro material começa aqui.';
        const hint = document.createElement('p');
        hint.textContent = 'Selecione um PDF ou TXT acima. Quando houver leituras salvas neste navegador, elas aparecerão aqui.';
        empty.append(ornament, heading, hint);
        list.appendChild(empty);
        return;
    }

    items.filter(item => item.version === 2 || !items.some(other => other.version === 2 && other.title === item.title))
    .slice(0, 5).forEach(item => {
        const recent = document.createElement('button');
        recent.type = 'button';
        recent.className = 'recent-item';
        recent.title = item.title;
        recent.setAttribute('aria-label', `${item.title}. Selecionar novamente o arquivo original para continuar.`);

        const cover = document.createElement('span');
        cover.className = 'book-cover';
        cover.setAttribute('aria-hidden', 'true');
        const format = document.createElement('span');
        format.className = 'book-format';
        const extension = item.title.split('.').pop().toUpperCase();
        format.textContent = ['PDF', 'TXT'].includes(extension) ? extension : 'TEXTO';
        const coverTitle = document.createElement('span');
        coverTitle.className = 'book-cover-title';
        coverTitle.textContent = item.title.replace(/\.(pdf|txt)$/i, '');
        const mark = document.createElement('span');
        mark.className = 'book-cover-mark';
        mark.textContent = 'AudioLivro';
        cover.append(format, coverTitle, mark);
        const title = document.createElement('span');
        title.className = 'book-title';
        title.textContent = item.title;
        recent.append(cover, title);

        const hasProgress = Number.isInteger(item.currentIdx) && Number.isInteger(item.total) &&
            item.total > 0 && item.currentIdx >= 0 && item.currentIdx <= item.total;
        if (hasProgress) {
            const pct = Math.round((item.currentIdx / item.total) * 100);
            const progress = document.createElement('progress');
            progress.className = 'book-progress';
            progress.max = 100;
            progress.value = pct;
            progress.setAttribute('aria-label', `Posição salva em ${item.title}`);
            const status = document.createElement('span');
            status.className = 'book-status';
            status.textContent = `${pct}% da leitura · posição salva`;
            recent.append(progress, status);
        }
        const reopen = document.createElement('span');
        reopen.className = 'book-reopen';
        reopen.textContent = 'Selecionar original ↗';
        recent.append(reopen);

        const resumeMessage = () => {
            requestedResumeTitle = item.title;
            requestedResumeId = item.documentId || null;
            fileInput.click();
        };
        recent.addEventListener('click', resumeMessage);
        list.appendChild(recent);
    });
}


function togglePlay() {
    if (state.playing) {
        state.playing = false;
        cancelSpeech(false);
        updatePlaybackUI(state.boundaryKnown ? 'Pausado. A retomada começa na última palavra acompanhada.' :
            'Pausado. Esta voz não informou a posição das palavras; ao retomar, a frase atual será reiniciada.');
    } else {
        if (state.currentIdx >= state.sentences.length) {
            state.currentIdx = 0;
            state.speechOffset = 0;
            state.boundaryKnown = false;
            highlight(true, true);
        }
        state.playing = true;
        updatePlaybackUI('Reproduzindo.');
        speak();
    }
    saveProgress();
}

function updatePlaybackUI(message = '') {
    document.getElementById('play-icon').textContent = state.playing ? '⏸' : '▶';
    const button = document.getElementById('btn-play');
    button.setAttribute('aria-pressed', String(state.playing));
    button.title = state.playing ? 'Pausar narração' : 'Reproduzir narração';
    const status = document.getElementById('playback-status');
    if (status && message) status.textContent = message +
        (state.storageAvailable === false && !/progresso/i.test(message) ? ' O progresso não pôde ser salvo neste navegador.' : '');
}

function speak() {
    if (state.currentIdx >= state.sentences.length) {
        // Fim do livro: encerra a reprodução.
        state.playing = false;
        updatePlaybackUI('Leitura concluída. Reproduza para ouvir novamente desde o início.');
        return;
    }
    if (!state.playing) return;

    // Nova instância por fala: evita que eventos de falas canceladas
    // reatribuam os handlers da fala corrente (causa do travamento).
    const generation = ++speechGeneration;
    const normalized = normalizeText(state.sentences[state.currentIdx]);
    const offset = state.speechOffset < normalized.length ? state.speechOffset : 0;
    const utter = new SpeechSynthesisUtterance(normalized.slice(offset));
    utter.voice = getBestVoice(); // Escolhe a voz mais humana disponível
    utter.rate = state.rate;      // Respeita exatamente a velocidade escolhida
    utter.pitch = 1.0;            // Ajuste entre 0.8 e 1.2 para mudar o tom
    utter.lang = utter.voice?.lang || 'pt-BR';

    log('[TTS] Trecho ' + String(state.currentIdx).padStart(3, '0'));
    utter.onboundary = event => {
        if (generation !== speechGeneration || !state.playing || event.name !== 'word') return;
        if (Number.isInteger(event.charIndex) && event.charIndex >= 0 && event.charIndex < utter.text.length) {
            state.speechOffset = offset + event.charIndex;
            state.boundaryKnown = true;
        }
    };

    utter.onend = () => {
        if (generation !== speechGeneration || !state.playing) return;
        const previousBlock = state.sentenceBlocks[state.currentIdx];
        speechGeneration++; // O mesmo evento de fim não pode avançar duas vezes durante a pausa.
        state.currentIdx++;
        state.speechOffset = 0;
        state.boundaryKnown = false;
        highlight();
        const nextBlock = state.sentenceBlocks[state.currentIdx];
        if (nextBlock && previousBlock !== nextBlock) {
            const nextGeneration = speechGeneration;
            const delay = (previousBlock?.tipo === 'titulo' ? 320 : 220) / state.rate;
            speechPauseTimer = setTimeout(() => {
                speechPauseTimer = null;
                if (nextGeneration === speechGeneration && state.playing) speak();
            }, delay);
        } else speak();
    };

    utter.onerror = (e) => {
        // 'interrupted'/'canceled' são esperados ao pausar/saltar: ignorar.
        if (generation !== speechGeneration) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        console.error("Erro na síntese:", e);
        state.playing = false;
        updatePlaybackUI('A voz não conseguiu continuar. Tente reproduzir novamente ou selecione outra voz.');
    };

    window.speechSynthesis.speak(utter);
}

// Interrompe a fala atual invalidando os callbacks pendentes.
function cancelSpeech(resetPosition = true) {
    speechGeneration++;
    clearTimeout(speechPauseTimer);
    speechPauseTimer = null;
    window.speechSynthesis.cancel();
    if (resetPosition) {
        state.speechOffset = 0;
        state.boundaryKnown = false;
    }
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
    setSpeed(SPEEDS[(currentPos + 1) % SPEEDS.length]);
}

function setSpeed(value) {
    const rate = Number(value);
    if (!SPEEDS.includes(rate)) return;
    state.rate = rate;
    document.getElementById('btn-spd').value = String(rate);
    log('[TTS] Velocidade:', state.rate);
    if (state.playing) {
        cancelSpeech(false);
        speak();
    }
    saveProgress();
}

function handleProgClick(e) {
    const track = document.getElementById('prog-track');
    const pct = e.offsetX / track.offsetWidth;
    const alvo = Math.min(state.sentences.length - 1, Math.floor(pct * state.sentences.length));
    jumpTo(alvo, true);
}

document.getElementById('prog-track').addEventListener('keydown', event => {
    const last = state.sentences.length - 1;
    const targets = { Home: 0, End: last, ArrowLeft: Math.max(0, state.currentIdx - 1),
        ArrowRight: Math.min(last, state.currentIdx + 1), ArrowDown: Math.max(0, state.currentIdx - 1),
        ArrowUp: Math.min(last, state.currentIdx + 1) };
    if (!(event.key in targets) || last < 0) return;
    event.preventDefault();
    jumpTo(targets[event.key], true);
});
document.getElementById('reading-area').addEventListener('keydown', event => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const current = state.sentenceBlocks[state.currentIdx];
    const blocks = state.blocks.filter(block => block.segmentos.some(s => Number.isInteger(s.indice_frase)));
    const index = blocks.indexOf(current) + (event.key === 'ArrowDown' ? 1 : -1);
    const target = blocks[Math.max(0, Math.min(blocks.length - 1, index))];
    if (!target) return;
    event.preventDefault();
    jumpTo(target.segmentos.find(s => Number.isInteger(s.indice_frase)).indice_frase, true);
});
