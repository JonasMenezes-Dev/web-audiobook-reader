// Preferences affect only the book surface; the narration engine stays independent.
(() => {
    'use strict';

    const STORAGE_KEY = 'audiolivro_reading_preferences_v1';
    const DEFAULTS = { version: 1, fontSize: null, lineSpacing: 'comfortable', width: 'standard' };
    const LINE_HEIGHTS = { compact: 1.65, comfortable: 1.95, wide: 2.25 };
    const WIDTHS = { narrow: 680, standard: 820, wide: 960 };
    const reader = document.getElementById('screen-reader');
    const page = document.getElementById('reading-inner');
    const trigger = document.getElementById('btn-appearance');
    const panel = document.getElementById('reading-appearance');
    const fontInput = document.getElementById('reading-font-size');
    const fontValue = document.getElementById('reading-font-value');
    const status = document.getElementById('appearance-storage-status');
    let preferences = { ...DEFAULTS };
    let alignFrame;

    function validate(data) {
        if (!data || Array.isArray(data) || data.version !== 1) return { ...DEFAULTS };
        return {
            version: 1,
            // null preserves the approved responsive default (18px mobile / 20px desktop).
            fontSize: Number.isInteger(data.fontSize) && data.fontSize >= 16 && data.fontSize <= 28 ? data.fontSize : null,
            lineSpacing: typeof data.lineSpacing === 'string' && Object.hasOwn(LINE_HEIGHTS, data.lineSpacing) ? data.lineSpacing : DEFAULTS.lineSpacing,
            width: typeof data.width === 'string' && Object.hasOwn(WIDTHS, data.width) ? data.width : DEFAULTS.width,
        };
    }

    function storageStatus(saved) {
        status.textContent = saved ? 'As preferências ficam neste navegador.' :
            'Ajustes disponíveis nesta sessão. Não foi possível acessar as preferências salvas neste navegador.';
    }

    function syncControls() {
        const size = parseFloat(getComputedStyle(page).fontSize);
        fontInput.value = size;
        fontValue.textContent = `${size} px`;
        panel.querySelectorAll('[name="reading-line-spacing"]').forEach(input => {
            input.checked = input.value === preferences.lineSpacing;
        });
        panel.querySelectorAll('[name="reading-width"]').forEach(input => {
            input.checked = input.value === preferences.width;
        });
    }

    function apply(followActive = false) {
        if (preferences.fontSize === null) page.style.removeProperty('--reading-font-size');
        else page.style.setProperty('--reading-font-size', `${preferences.fontSize}px`);
        page.style.setProperty('--reading-line-height', LINE_HEIGHTS[preferences.lineSpacing]);
        page.style.setProperty('--reading-page-width', `${WIDTHS[preferences.width]}px`);
        syncControls();
        if (followActive && !reader.hidden) {
            cancelAnimationFrame(alignFrame);
            alignFrame = requestAnimationFrame(() => {
                // Reuse the existing immediate scroll without changing playback or progress.
                if (!reader.hidden) scrollToActive('auto');
            });
        }
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
            storageStatus(true);
        } catch {
            storageStatus(false);
        }
    }

    function close(restoreFocus = true) {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus) trigger.focus();
    }

    trigger.addEventListener('click', () => {
        if (!panel.hidden) return close();
        syncControls();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        fontInput.focus();
    });
    document.getElementById('appearance-close').addEventListener('click', () => close());
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) {
            event.preventDefault();
            close();
        }
    });
    document.addEventListener('click', event => {
        if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close(false);
    });
    fontInput.addEventListener('input', () => {
        preferences = validate({ ...preferences, fontSize: Number(fontInput.value) });
        apply(true);
        save();
    });
    panel.addEventListener('change', event => {
        if (event.target.name === 'reading-line-spacing') preferences.lineSpacing = event.target.value;
        else if (event.target.name === 'reading-width') preferences.width = event.target.value;
        else return;
        preferences = validate(preferences);
        apply(true);
        save();
    });
    document.getElementById('appearance-reset').addEventListener('click', () => {
        preferences = { ...DEFAULTS };
        apply(true);
        try {
            localStorage.removeItem(STORAGE_KEY);
            storageStatus(true);
        } catch {
            storageStatus(false);
        }
    });
    window.matchMedia('(max-width: 600px)').addEventListener('change', syncControls);

    try {
        preferences = validate(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch {
        storageStatus(false);
    }
    apply();
})();
