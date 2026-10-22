// With Playwright available in NODE_PATH: node --test tests/reader.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { chromium } = require('playwright');

let browser, server, url;
before(async () => {
    server = createServer(async (req, res) => {
        const name = req.url === '/' ? 'index.html' : req.url.slice(1);
        if (!['index.html', 'style.css', 'script.js', 'config.js', 'reading-preferences.js'].includes(name)) {
            res.writeHead(404).end();
            return;
        }
        res.setHeader('Content-Type', (name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html') + '; charset=utf-8');
        res.end(await readFile(join(__dirname, '..', name)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
});
after(async () => {
    await browser?.close();
    await new Promise(resolve => server?.close(resolve));
});

async function openReader() {
    const page = await browser.newPage();
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.addInitScript(() => {
        // Deliver onend manually so narration advances deterministically without audio.
        speechSynthesis.speak = utterance => { window.testUtterance = utterance; };
        speechSynthesis.cancel = () => {};
    });
    await page.goto(url);
    const text = Array.from({ length: 100 }, (_, i) => `Trecho ${i + 1}: uma passagem demonstrativa para verificar a leitura contínua, o ritmo do texto e o acompanhamento da narração.`).join(' ');
    await page.locator('#file-input').setInputFiles({ name: 'Leitura demonstrativa com um título extenso.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await page.locator('#reading-area').waitFor({ state: 'visible' });
    return page;
}

async function waitForActiveVisible(page) {
    await page.waitForFunction(() => {
        const active = document.querySelector('.sent.reading').getBoundingClientRect();
        const area = document.getElementById('reading-area').getBoundingClientRect();
        const player = document.querySelector('.player').getBoundingClientRect();
        return active.top >= area.top && active.bottom <= Math.min(area.bottom, player.top);
    }, null, { timeout: 5000 }).catch(async error => {
        const bounds = await page.evaluate(() => {
            const rect = selector => {
                const r = document.querySelector(selector).getBoundingClientRect();
                return { top: r.top, bottom: r.bottom, height: r.height };
            };
            return { active: rect('.sent.reading'), area: rect('#reading-area'), player: rect('.player'),
                viewport: innerWidth, scroll: document.getElementById('reading-area').scrollTop };
        });
        throw new Error(`${error.message}; bounds=${JSON.stringify(bounds)}`);
    });
}

test('reader themes, continuous page and player clearance at mobile and desktop sizes', async () => {
    const page = await openReader();
    const themes = [];
    for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        for (const width of [320, 375, 390, 768, 1024, 1440]) {
            await page.setViewportSize({ width, height: 812 });
            await page.evaluate(() => goTo(50));
            await waitForActiveVisible(page);
            const metrics = await page.evaluate(() => {
                const area = document.getElementById('reading-area');
                const active = document.querySelector('.sent.reading');
                const read = document.getElementById('s-49');
                const unread = document.getElementById('s-51');
                return {
                    overflow: area.scrollWidth > area.clientWidth || document.body.scrollWidth > innerWidth,
                    scroll: area.scrollTop,
                    areaBottom: area.getBoundingClientRect().bottom,
                    playerTop: document.querySelector('.player').getBoundingClientRect().top,
                    activeColor: getComputedStyle(active).color,
                    activeBackground: getComputedStyle(active).backgroundColor,
                    readColor: getComputedStyle(read).color,
                    unreadColor: getComputedStyle(unread).color,
                    paper: getComputedStyle(document.getElementById('reading-inner')).backgroundColor,
                    font: getComputedStyle(active).fontFamily,
                };
            });
            assert.equal(metrics.overflow, false, `${colorScheme} ${width}px overflow`);
            assert.ok(metrics.areaBottom <= metrics.playerTop, 'scroll viewport is above the fixed player');
            assert.ok(metrics.scroll > 0, 'navigation follows the selected sentence');
            assert.notEqual(metrics.activeBackground, 'rgba(0, 0, 0, 0)');
            assert.notEqual(metrics.readColor, metrics.unreadColor, 'read sentences have a distinct tone');
            assert.match(metrics.font, /Lora/);
            if (width === 1440) themes.push(metrics.paper);
            if (process.env.SCREENSHOT_DIR && [375, 1440].includes(width)) {
                await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `reader-${colorScheme}-${width}.png`), timeout: 5000 });
            }
            await page.evaluate(() => goTo(state.sentences.length - 1));
            await waitForActiveVisible(page);
            await page.evaluate(() => goTo(0));
            await waitForActiveVisible(page);
        }
    }
    assert.notEqual(themes[0], themes[1], 'page follows the system theme');
    await page.close();
});

test('narration advancement keeps one current sentence visible; keyboard and reduced motion remain usable', async () => {
    const page = await openReader();
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => goTo(60));
    await page.locator('#btn-play').click();
    await page.evaluate(() => window.testUtterance.onend());
    await page.waitForFunction(() => document.getElementById('s-61').classList.contains('reading'));
    await waitForActiveVisible(page);
    assert.equal(await page.locator('.sent.reading').count(), 1);
    await page.locator('#btn-play').click();
    await page.keyboard.press('Tab');
    await page.locator('#reading-area').focus();
    assert.notEqual(await page.locator('#reading-area').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    const beforeScroll = await page.locator('#reading-area').evaluate(el => el.scrollTop);
    await page.keyboard.press('PageDown');
    await page.waitForFunction(y => document.getElementById('reading-area').scrollTop > y, beforeScroll);
    await page.getByRole('button', { name: 'Sair da leitura e voltar à biblioteca', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.locator('#screen-import').waitFor({ state: 'visible' });
    await page.close();
});

test('editorial player keeps playback, seeking, speeds and keyboard controls', async () => {
    const page = await openReader();
    const play = page.getByRole('button', { name: 'Reproduzir ou pausar a narração', exact: true });
    await play.focus();
    await page.keyboard.press('Enter');
    assert.equal((await page.locator('#play-icon').textContent()).trim(), '⏸');
    assert.equal(await page.evaluate(() => window.testUtterance.rate), 1);
    await page.getByRole('button', { name: 'Próxima frase', exact: true }).click();
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-1');
    await page.getByRole('button', { name: 'Frase anterior', exact: true }).click();
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-0');
    for (const rate of [1.25, 1.5, 2, 0.7, 1]) {
        await page.locator('#btn-spd').click();
        assert.equal(await page.locator('#btn-spd').textContent(), rate.toFixed(2) + 'x');
        // The native SpeechSynthesisUtterance rate is stored as a float32.
        assert.ok(Math.abs(await page.evaluate(() => window.testUtterance.rate) - rate) < 1e-6);
    }
    await play.focus();
    await page.keyboard.press('Space');
    assert.equal((await page.locator('#play-icon').textContent()).trim(), '▶');
    const track = page.locator('#prog-track');
    const bounds = await track.boundingBox();
    await track.click({ position: { x: bounds.width * 0.75, y: bounds.height / 2 } });
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-75');
    // Clicking inside the filled section must still use the full track coordinates.
    await track.click({ position: { x: bounds.width * 0.25, y: bounds.height / 2 } });
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-25');
    assert.equal(await page.locator('#pos-txt').textContent(), '26 / 100');
    await page.getByRole('button', { name: 'Próxima frase', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-26');
    const fill = await page.locator('#prog-fill').evaluate(el => parseFloat(el.style.width));
    assert.ok(Math.abs(fill - (26 / 99) * 100) < 0.001);
    await page.close();
});

test('player touch targets, focus, themes and reduced motion fit the reserved space', async () => {
    const page = await openReader();
    const backgrounds = [];
    for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        for (const width of [320, 375, 390, 768, 1024, 1440]) {
            await page.setViewportSize({ width, height: 812 });
            const metrics = await page.locator('.player').evaluate(el => {
                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                    areaBottom: document.getElementById('reading-area').getBoundingClientRect().bottom,
                    background: style.backgroundColor, overflow: el.scrollWidth > el.clientWidth };
            });
            assert.ok(metrics.left >= 0 && metrics.right <= width);
            assert.ok(metrics.top >= metrics.areaBottom && metrics.bottom <= 812);
            assert.equal(metrics.overflow, false);
            for (const button of await page.locator('.player button, #voice-select, #chapter-select, #btn-appearance, #theme-toggle').all()) {
                const rect = await button.boundingBox();
                assert.ok(rect.width >= 44 && rect.height >= 44, 'each button has a 44px touch target');
            }
            const appearance = await page.locator('#btn-appearance').boundingBox();
            const theme = await page.locator('#theme-toggle').boundingBox();
            assert.ok(appearance.x + appearance.width <= theme.x, 'header controls do not overlap');
            if (width === 1440) backgrounds.push(metrics.background);
        }
    }
    assert.notEqual(backgrounds[0], backgrounds[1]);
    await page.keyboard.press('Tab');
    await page.locator('#btn-play').focus();
    assert.notEqual(await page.locator('#btn-play').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    assert.equal(await page.locator('#prog-fill').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.close();
});

test('appearance disclosure, font limits, persistence and reset work by keyboard', async () => {
    const page = await openReader();
    const trigger = page.getByRole('button', { name: 'Aparência da leitura', exact: true });
    const panel = page.locator('#reading-appearance');
    await trigger.focus();
    await page.keyboard.press('Enter');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await panel.isVisible(), true);
    const size = page.getByLabel('Tamanho do texto', { exact: true });
    await size.focus();
    await page.keyboard.press('Home');
    assert.equal(await size.inputValue(), '16');
    assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).fontSize), '16px');
    await page.keyboard.press('End');
    assert.equal(await size.inputValue(), '28');
    await panel.getByLabel('Amplo', { exact: true }).check();
    await panel.getByLabel('Estreita', { exact: true }).check();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('audiolivro_reading_preferences_v1')));
    assert.deepEqual(saved, { version: 1, fontSize: 28, lineSpacing: 'wide', width: 'narrow' });
    await page.keyboard.press('Escape');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    await page.reload();
    // Preferences restore even before the original book is selected again.
    assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).fontSize), '28px');
    assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).maxWidth), '680px');
    await page.locator('#file-input').setInputFiles({ name: 'Retomada demonstrativa.txt', mimeType: 'text/plain', buffer: Buffer.from('Uma frase demonstrativa para retomar a leitura. Outra frase demonstrativa.') });
    await trigger.click();
    await panel.getByRole('button', { name: 'Restaurar padrão', exact: true }).click();
    assert.equal(await size.inputValue(), '20');
    assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).fontSize), '20px');
    assert.equal(await page.evaluate(() => localStorage.getItem('audiolivro_reading_preferences_v1')), null);
    await panel.getByRole('button', { name: 'Fechar ajustes de aparência' }).click();
    assert.equal(await panel.isVisible(), false);
    await trigger.click();
    await page.locator('#reading-area').click({ position: { x: 5, y: 5 } });
    assert.equal(await panel.isVisible(), false);
    await page.close();
});

test('appearance ignores invalid stored data and survives denied reads and writes', async () => {
    const page = await openReader();
    for (const value of ['{', 'null', '[]', JSON.stringify({ version: 9, fontSize: 24 }), JSON.stringify({ version: 1, fontSize: 1000, lineSpacing: 'invalid', width: '__proto__' }), JSON.stringify({ version: 1, fontSize: '24', lineSpacing: ['compact'], width: ['narrow'] })]) {
        await page.evaluate(value => localStorage.setItem('audiolivro_reading_preferences_v1', value), value);
        await page.reload();
        assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).fontSize), '20px');
        assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).maxWidth), '820px');
    }
    await page.addInitScript(() => {
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        const remove = Storage.prototype.removeItem;
        // Deny only preference storage; the existing progress engine is outside this change.
        Storage.prototype.getItem = function(key) { if (key === 'audiolivro_reading_preferences_v1') throw new DOMException('Blocked', 'SecurityError'); return get.call(this, key); };
        Storage.prototype.setItem = function(key, value) { if (key === 'audiolivro_reading_preferences_v1') throw new DOMException('Full', 'QuotaExceededError'); return set.call(this, key, value); };
        Storage.prototype.removeItem = function(key) { if (key === 'audiolivro_reading_preferences_v1') throw new DOMException('Blocked', 'SecurityError'); return remove.call(this, key); };
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.reload();
    await page.locator('#file-input').setInputFiles({ name: 'Sessão demonstrativa.txt', mimeType: 'text/plain', buffer: Buffer.from('Uma frase demonstrativa para esta sessão. Outra frase para esta sessão.') });
    await page.locator('#btn-appearance').click();
    await page.getByLabel('Tamanho do texto', { exact: true }).focus();
    await page.keyboard.press('End');
    assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).fontSize), '28px');
    assert.match(await page.locator('#appearance-storage-status').textContent(), /sessão/);
    await page.getByRole('button', { name: 'Restaurar padrão', exact: true }).click();
    assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).fontSize), '20px');
    assert.deepEqual(errors, []);
    await page.close();
});

test('appearance remains above player and preserves active narration through reflow', async () => {
    const page = await openReader();
    const waitForAdjustedActive = () => page.waitForFunction(() => {
        const active = document.querySelector('.sent.reading').getBoundingClientRect();
        const area = document.getElementById('reading-area').getBoundingClientRect();
        // At 28px and wide spacing a sentence can be taller than the viewport.
        // Its midpoint must remain in view, without requiring the whole sentence to fit.
        const midpoint = (active.top + active.bottom) / 2;
        return midpoint > area.top && midpoint < area.bottom;
    }, null, { timeout: 5000 });
    await page.locator('#btn-play').click();
    await page.evaluate(() => goTo(50));
    const surfaces = await page.evaluate(() => ({
        playerFont: getComputedStyle(document.querySelector('.player')).fontSize,
        headerFont: getComputedStyle(document.getElementById('r-title')).fontSize,
    }));
    for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        for (const width of [320, 375, 390, 768, 1024, 1440]) {
            await page.setViewportSize({ width, height: width === 320 ? 568 : 812 });
            await page.locator('#btn-appearance').click();
            const panel = page.locator('#reading-appearance');
            await panel.getByLabel('Tamanho do texto', { exact: true }).focus();
            await page.keyboard.press('Home');
            await page.keyboard.press('End');
            await panel.getByLabel('Amplo', { exact: true }).check();
            await panel.getByLabel('Ampla', { exact: true }).check();
            const metrics = await panel.evaluate(el => {
                const r = el.getBoundingClientRect();
                return { left: r.left, right: r.right, bottom: r.bottom, playerTop: document.querySelector('.player').getBoundingClientRect().top,
                    overflow: el.scrollWidth > el.clientWidth || document.getElementById('reading-area').scrollWidth > innerWidth };
            });
            assert.ok(metrics.left >= 0 && metrics.right <= width);
            assert.ok(metrics.bottom <= metrics.playerTop);
            assert.equal(metrics.overflow, false);
            if (process.env.SCREENSHOT_DIR && [375, 1440].includes(width)) {
                await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `appearance-${colorScheme}-${width}.png`), timeout: 5000 });
            }
            await page.keyboard.press('Escape');
            await waitForAdjustedActive();
            assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-50');
            assert.equal((await page.locator('#play-icon').textContent()).trim(), '⏸');
        }
    }
    await page.evaluate(() => window.testUtterance.onend());
    await waitForAdjustedActive();
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-51');
    assert.equal(await page.locator('.player').evaluate(el => getComputedStyle(el).fontSize), surfaces.playerFont);
    assert.equal(await page.locator('#r-title').evaluate(el => getComputedStyle(el).fontSize), surfaces.headerFont);
    await page.close();
});

test('storage failure never interrupts TXT import, navigation or narration callbacks', async () => {
    const page = await openReader();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
        speechSynthesis.speak = utterance => { window.testUtterance = utterance; };
        speechSynthesis.cancel = () => {};
    });
    await page.reload();
    await page.locator('#file-input').setInputFiles({ name: 'Sem armazenamento.txt', mimeType: 'text/plain', buffer: Buffer.from('Primeira frase demonstrativa. Segunda frase demonstrativa. Terceira frase demonstrativa.') });
    await page.locator('#reading-area').waitFor({ state: 'visible' });
    await page.locator('#btn-play').click();
    await page.evaluate(() => window.testUtterance.onend());
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-1');
    await page.getByRole('button', { name: 'Próxima frase', exact: true }).click();
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-2');
    assert.deepEqual(errors, []);
    assert.deepEqual(dialogs, []);
    // Quota exhaustion also happens in otherwise available storage.
    await page.evaluate(() => {
        Object.defineProperty(window, 'localStorage', { configurable: true, value: {
            setItem() { throw new DOMException('Full', 'QuotaExceededError'); }
        } });
    });
    await page.getByRole('button', { name: 'Frase anterior', exact: true }).click();
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-1');
    assert.deepEqual(errors, []);
    await page.close();
});

test('reduced motion disables automatic smooth scrolling and loading animation', async () => {
    const page = await openReader();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const behavior = await page.evaluate(() => {
        let behavior;
        const area = document.getElementById('reading-area');
        const original = area.scrollTo;
        area.scrollTo = options => { behavior = options?.behavior; };
        try { state.currentIdx = 50; highlight(); } finally { area.scrollTo = original; }
        return behavior;
    });
    assert.notEqual(behavior, 'smooth');
    await page.evaluate(() => showLoading('Preparando leitura', 'Aguarde', null));
    assert.equal(await page.locator('.loading-spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await page.locator('#loading-progress span').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.evaluate(hideLoading => window[hideLoading](), 'hideLoading');
    await page.close();
});

test('loading feedback prevents keyboard interaction with covered controls and restores focus', async () => {
    const page = await openReader();
    await page.locator('#btn-play').focus();
    await page.evaluate(() => showLoading('Preparando leitura', 'Aguarde', null));
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.screen')), false);
    await page.evaluate(() => hideLoading());
    assert.equal(await page.locator('#btn-play').evaluate(el => el === document.activeElement), true);
    await page.close();
});

test('completed narration never displays a sentence count beyond the total', async () => {
    const page = await openReader();
    await page.evaluate(() => goTo(state.sentences.length - 1));
    await page.locator('#btn-play').click();
    await page.evaluate(() => window.testUtterance.onend());
    assert.equal(await page.locator('#pos-txt').textContent(), '100 / 100');
    assert.equal(await page.locator('#prog-fill').evaluate(el => el.style.width), '100%');
    assert.equal((await page.locator('#play-icon').textContent()).trim(), '▶');
    await page.close();
});

test('merged voice, chapters and manual theme remain compatible with editorial appearance', async () => {
    const page = await browser.newPage({ colorScheme: 'light' });
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.addInitScript(() => {
        // Native voices are platform-dependent; use deterministic descriptors and utterances.
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        speechSynthesis.getVoices = () => [
            { name: 'English', lang: 'en-US' },
            { name: 'Ana', lang: 'pt-BR' },
            { name: 'Google Português', lang: 'pt-BR' },
        ];
        speechSynthesis.speak = utterance => { window.testUtterance = utterance; };
        speechSynthesis.cancel = () => {};
    });
    await page.goto(url);
    assert.equal(await page.locator('body').getAttribute('data-theme'), 'light');
    await page.locator('#file-input').setInputFiles({ name: 'Capítulos demonstrativos.txt', mimeType: 'text/plain', buffer: Buffer.from('CAPÍTULO 1\n\nPrimeira frase demonstrativa.\n\nCAPÍTULO 2\n\nSegunda frase demonstrativa.') });
    await page.locator('#reading-area').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#chapter-select option').count(), 2);
    assert.equal(await page.locator('#voice-select').inputValue(), 'Google Português::pt-BR');
    await page.locator('#btn-play').click();
    await page.evaluate(() => { window.previousUtterance = window.testUtterance; });
    await page.locator('#voice-select').selectOption('Ana::pt-BR');
    assert.equal(await page.evaluate(() => window.testUtterance.voice.name), 'Ana');
    assert.equal(await page.evaluate(() => window.testUtterance.lang), 'pt-BR');
    await page.evaluate(() => window.previousUtterance.onend());
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-0');
    await page.locator('#chapter-select').selectOption('2');
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-2');
    assert.equal((await page.locator('#play-icon').textContent()).trim(), '⏸');
    await waitForActiveVisible(page);
    await page.locator('#btn-appearance').click();
    await page.getByLabel('Tamanho do texto', { exact: true }).focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    await waitForActiveVisible(page);
    assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).fontSize), '28px');
    assert.equal(await page.locator('#chapter-select').inputValue(), '2');
    const lightPaper = await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).backgroundColor);
    await page.locator('#theme-toggle').click();
    assert.notEqual(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).backgroundColor), lightPaper);
    assert.equal(await page.evaluate(() => localStorage.getItem('audiolivro_theme_v1')), 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.locator('body').getAttribute('data-theme'), 'dark');
    await page.reload();
    assert.equal(await page.locator('body').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('#voice-select').inputValue(), 'Ana::pt-BR');
    assert.equal(await page.locator('#reading-inner').evaluate(el => getComputedStyle(el).fontSize), '28px');
    await page.close();
});
