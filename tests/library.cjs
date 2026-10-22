// Run with Playwright available in NODE_PATH: node --test tests/library.cjs
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
        const mime = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html';
        res.setHeader('Content-Type', `${mime}; charset=utf-8`);
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

async function openLibrary(options = {}) {
    const page = await browser.newPage(options);
    // Keep checks local; no external fonts or backend calls.
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    return page;
}

test('recent books show only valid progress and tolerate damaged records', async () => {
    const page = await openLibrary();
    await page.addInitScript(() => {
        const records = [
            { title: 'Livro longo ' + 'palavras '.repeat(25) + '.txt', date: 5, currentIdx: 4, total: 10 },
            { title: 'Sem progresso.pdf', date: 4 },
            { title: 'Indice invalido.txt', date: 3, currentIdx: -1, total: 10 },
            { title: '<img src=x onerror=alert(1)>.txt', date: 2, currentIdx: 0, total: 10 },
        ];
        records.forEach(item => localStorage.setItem('audiolivro_v1_' + item.title, JSON.stringify(item)));
        localStorage.setItem('audiolivro_v1_corrompido', '{');
    });
    await page.goto(url);
    assert.equal(await page.locator('.recent-item').count(), 4);
    assert.equal(await page.locator('.book-progress').count(), 2);
    assert.equal(await page.locator('.book-progress').first().getAttribute('value'), '40');
    assert.equal(await page.locator('#book-list img').count(), 0);
    await page.locator('.recent-item').first().focus();
    const [resumeChooser] = await Promise.all([
        page.waitForEvent('filechooser'), page.keyboard.press('Enter'),
    ]);
    assert.equal(resumeChooser.isMultiple(), false);
    for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        for (const width of [320, 375, 390, 768, 1024, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.evaluate(() => {
                const screen = document.getElementById('screen-import');
                return screen.scrollWidth <= screen.clientWidth;
            }), true, `${colorScheme} ${width}px has no overflow`);
            const target = await page.locator('#drop-zone').boundingBox();
            assert.ok(target.height >= 44 && target.width >= 44);
            if (process.env.SCREENSHOT_DIR && [375, 1440].includes(width)) {
                await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
                await page.locator('#screen-import').evaluate(el => { el.scrollTop = 0; });
                await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `library-${colorScheme}-${width}.png`) });
                await page.locator('#saved-section').screenshot({ path: join(process.env.SCREENSHOT_DIR, `shelf-${colorScheme}-${width}.png`) });
            }
        }
    }
    await page.close();
});

test('empty shelf survives unavailable local storage', async () => {
    const page = await openLibrary();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    });
    await page.goto(url);
    assert.equal(await page.locator('.no-recents').count(), 1);
    assert.deepEqual(errors, []);
    await page.close();
});

test('TXT drop, player controls and original-file reselection restore progress', async () => {
    const page = await openLibrary({ viewport: { width: 375, height: 812 } });
    // Deterministic speech stub: check control state, not audible speech quality.
    await page.addInitScript(() => {
        speechSynthesis.speak = () => {};
        speechSynthesis.cancel = () => {};
    });
    await page.goto(url);
    assert.equal(await page.locator('.no-recents').count(), 1);
    await page.locator('#drop-zone').focus();
    assert.notEqual(await page.locator('#drop-zone').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'), page.keyboard.press('Enter'),
    ]);
    assert.equal(chooser.isMultiple(), false);
    await page.locator('#drop-zone').evaluate(el => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File(['Primeira frase para leitura. Segunda frase para ouvir. Terceira frase para continuar.'], 'leitura.txt', { type: 'text/plain' }));
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    });
    await page.waitForFunction(() => !document.getElementById('screen-reader').hidden);
    await page.locator('#btn-play').click();
    assert.equal((await page.locator('#play-icon').textContent()).trim(), '⏸');
    await page.locator('#btn-play').click();
    assert.equal((await page.locator('#play-icon').textContent()).trim(), '▶');
    await page.locator('#btn-play').click();
    await page.locator('button[onclick="next()"]').click();
    await page.locator('#btn-play').click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('audiolivro_v1_leitura.txt')));
    assert.ok(saved.currentIdx > 0);
    assert.deepEqual(Object.keys(saved).sort(), ['currentIdx', 'date', 'rate', 'title', 'total']);
    const readerBefore = await page.locator('#pos-txt').textContent();
    await page.getByRole('button', { name: 'Sair da leitura e voltar à biblioteca', exact: true }).click();
    await page.waitForFunction(() => !document.getElementById('screen-import').hidden);
    const [resumeChooser] = await Promise.all([
        page.waitForEvent('filechooser'), page.locator('.recent-item').first().click(),
    ]);
    await resumeChooser.setFiles({ name: 'leitura.txt', mimeType: 'text/plain', buffer: Buffer.from('Primeira frase para leitura. Segunda frase para ouvir. Terceira frase para continuar.') });
    await page.waitForFunction(() => !document.getElementById('screen-reader').hidden);
    assert.equal(await page.locator('#pos-txt').textContent(), readerBefore);
    assert.equal(await page.locator('.player').evaluate(el => getComputedStyle(el).position), 'fixed');
    await page.close();
});

test('unavailable PDF backend shows an error without bypassing its filter', async () => {
    const page = await openLibrary();
    let requests = 0;
    await page.route('**/upload-pdf-progress/', route => {
        requests++;
        return route.abort('connectionfailed');
    });
    let errorMessage;
    page.once('dialog', async dialog => {
        errorMessage = dialog.message();
        await dialog.dismiss();
    });
    await page.goto(url);
    await page.locator('#file-input').setInputFiles({ name: 'indisponivel.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
    await page.waitForFunction(() => document.getElementById('loading-overlay').hidden);
    assert.match(errorMessage, /Não foi possível processar o PDF pelo servidor/);
    assert.equal(requests, 1);
    assert.equal(await page.locator('#screen-reader').evaluate(el => el.hidden), true);
    assert.equal(await page.locator('#reading-inner').textContent(), '');
    await page.close();
});

test('real PDF backend imports the filtered sentences and rejects an invalid PDF', {
    skip: !process.env.AUDIOLIVRO_TEST_API_URL && 'Set AUDIOLIVRO_TEST_API_URL to a running local backend',
}, async () => {
    const page = await openLibrary();
    await page.route('**/config.js', route => route.fulfill({
        contentType: 'text/javascript', body: `window.AUDIOLIVRO_API_URL = ${JSON.stringify(process.env.AUDIOLIVRO_TEST_API_URL)};`,
    }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const resultResponse = page.waitForResponse(response => response.url().endsWith('/upload-pdf-progress/'));
    await page.locator('#file-input').setInputFiles(join(__dirname, 'fixtures', 'regressao.pdf'));
    const response = await resultResponse;
    assert.equal(response.status(), 200);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.some(event => event.type === 'progress'));
    const result = events.find(event => event.type === 'result').data;
    await page.waitForFunction(() => !document.getElementById('screen-reader').hidden && document.getElementById('loading-overlay').hidden);
    assert.ok(result.sentences.length > 0);
    assert.deepEqual(await page.locator('.sent').allTextContents(), result.sentences);
    await page.getByRole('button', { name: 'Sair da leitura e voltar à biblioteca', exact: true }).click();
    await page.locator('#drop-zone').waitFor({ state: 'visible' });
    let message;
    page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); });
    const errorResponse = page.waitForResponse(response => response.url().endsWith('/upload-pdf-progress/'));
    await page.locator('#file-input').setInputFiles({ name: 'invalido.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
    assert.ok((await errorResponse).status() >= 400);
    await page.waitForFunction(() => document.getElementById('loading-overlay').hidden);
    assert.match(message, /Não foi possível processar o PDF pelo servidor/);
    assert.equal(await page.locator('#screen-reader').evaluate(el => el.hidden), true);
    assert.deepEqual(errors, []);
    await page.close();
});

test('recent-book resume rejects a different file and restores the matching original', async () => {
    const page = await openLibrary();
    await page.goto(url);
    const file = { name: 'Original demonstrativo.txt', mimeType: 'text/plain', buffer: Buffer.from('Primeira frase demonstrativa. Segunda frase demonstrativa. Terceira frase demonstrativa.') };
    await page.locator('#file-input').setInputFiles(file);
    await page.locator('#reading-area').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Próxima frase', exact: true }).click();
    await page.reload();
    const [wrongChooser] = await Promise.all([
        page.waitForEvent('filechooser'), page.locator('.recent-item').first().click(),
    ]);
    let message;
    page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); });
    await wrongChooser.setFiles({ ...file, name: 'Outro arquivo.txt' });
    assert.match(message, /selecione esse mesmo arquivo/);
    assert.equal(await page.locator('#screen-reader').evaluate(el => el.hidden), true);
    const [correctChooser] = await Promise.all([
        page.waitForEvent('filechooser'), page.locator('.recent-item').first().click(),
    ]);
    await correctChooser.setFiles(file);
    await page.locator('#reading-area').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.sent.reading').getAttribute('id'), 's-1');
    await page.close();
});
