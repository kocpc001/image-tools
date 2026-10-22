/* YouTube cover loading and image export. No API key or third-party proxy. */
(function (root) {
    'use strict';
    function parseVideoId(value) {
        const input = value.trim();
        const valid = id => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
        if (valid(input)) return input;
        let url;
        try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
        catch { throw new Error('請輸入有效的 YouTube 影片連結或 11 碼影片 ID。'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
            throw new Error('請使用有效的 YouTube 影片網址。');
        }
        const host = url.hostname.toLowerCase();
        const parts = url.pathname.split('/').filter(Boolean);
        let id;
        if (host === 'youtu.be' && parts.length === 1) id = parts[0];
        else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
            if (url.pathname === '/watch') id = url.searchParams.get('v');
            else if (['shorts', 'embed', 'live'].includes(parts[0]) && parts.length === 2) id = parts[1];
        } else if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host) && parts[0] === 'embed' && parts.length === 2) id = parts[1];
        if (!valid(id)) throw new Error('找不到影片 ID，請貼上單支 YouTube 影片的連結。');
        return id;
    }
    function fitDimensions(width, height, maxSide) {
        if (![width, height, maxSide].every(n => Number.isFinite(n) && n > 0)) throw new Error('圖片尺寸無效。');
        const ratio = Math.min(1, maxSide / Math.max(width, height));
        return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
    }
    function logoPlacement(width, height, logoWidth, logoHeight, position) {
        const margin = Math.min(15, Math.min(width, height) * 0.05);
        const scale = Math.min(0.7, (width - 2 * margin) / logoWidth, (height - 2 * margin) / logoHeight);
        const w = logoWidth * scale, h = logoHeight * scale;
        return { x: position.endsWith('left') ? margin : width - w - margin,
            y: position.startsWith('top') ? margin : height - h - margin, width: w, height: h };
    }
    function loadRemoteImage(url, signal) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            let timer;
            const finish = (error) => {
                clearTimeout(timer);
                image.onload = image.onerror = null;
                signal?.removeEventListener('abort', abort);
                if (error) { image.src = ''; reject(error); } else resolve(image);
            };
            const abort = () => finish(new DOMException('已取消', 'AbortError'));
            if (signal?.aborted) { abort(); return; }
            signal?.addEventListener('abort', abort, { once: true });
            image.crossOrigin = 'anonymous';
            image.onload = () => finish();
            image.onerror = () => finish(new Error('無法讀取封面圖片。'));
            timer = setTimeout(() => finish(new Error('封面讀取逾時。')), 12000);
            image.src = url;
        });
    }
    async function fetchThumbnail(id, signal, loader = loadRemoteImage) {
        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('影片 ID 無效。');
        for (const size of ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault']) {
            if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
            try {
                const image = await loader(`https://i.ytimg.com/vi/${id}/${size}.jpg`, signal);
                // YouTube sometimes returns a 120 × 90 placeholder with HTTP 200.
                if (image.naturalWidth > 120 && image.naturalHeight > 90) return image;
            } catch (error) {
                if (error.name === 'AbortError' || signal?.aborted) throw error;
            }
        }
        throw new Error('無法取得封面，請確認影片存在且可公開觀看，或稍後重試（網路／跨來源限制）。');
    }
    function mount(options) {
        const el = id => document.getElementById(`youtube${id}`);
        const url = el('Url'), form = el('Form'), fetchButton = el('Fetch');
        const addWatermark = el('AddWatermark'), source = el('LogoSource'), file = el('LogoFile');
        const position = el('Position'), opacity = el('Opacity'), status = el('Status');
        const preview = el('Preview'), download = el('Download');
        let original = null, customLogo = null, controller = null, request = 0, renderVersion = 0, fileVersion = 0;
        let downloading = false, renderedQuality = null;
        el('SizeLimit').textContent = options.maxSide;
        function clearResult() { preview.hidden = true; download.disabled = true; renderedQuality = null; }
        function cancel() {
            request++; renderVersion++;
            controller?.abort(); controller = null;
            fetchButton.disabled = false;
            fetchButton.textContent = '取得封面';
        }
        async function render() {
            const version = ++renderVersion;
            clearResult();
            el('WatermarkOptions').hidden = !addWatermark.checked;
            el('OpacityValue').textContent = `${opacity.value}%`;
            if (!original) return;
            try {
                let logo;
                if (addWatermark.checked) {
                    logo = source.value === 'custom' ? customLogo : options.getLogo(source.value);
                    if (!logo) throw new Error('請先上傳自訂 Logo，或在原有浮水印工具中設定 Logo。');
                    if (!logo.complete) await logo.decode();
                    if (!logo.naturalWidth) throw new Error('Logo 無法載入，請重新上傳。');
                }
                if (version !== renderVersion) return;
                const size = fitDimensions(original.naturalWidth, original.naturalHeight, options.maxSide);
                const canvas = options.scale(original, size.width, size.height);
                preview.width = size.width; preview.height = size.height;
                const ctx = preview.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.width, size.height);
                ctx.drawImage(canvas, 0, 0);
                if (logo) {
                    const p = logoPlacement(size.width, size.height, logo.naturalWidth, logo.naturalHeight, position.value);
                    ctx.save(); ctx.globalAlpha = Number(opacity.value) / 100;
                    ctx.drawImage(logo, p.x, p.y, p.width, p.height); ctx.restore();
                }
                // Check export permissions before offering a download.
                ctx.getImageData(0, 0, 1, 1);
                renderedQuality = options.quality();
                preview.hidden = false; download.disabled = downloading;
                status.textContent = `原圖 ${original.naturalWidth} × ${original.naturalHeight} → 輸出 ${size.width} × ${size.height}px・JPG${logo ? '・已加入浮水印' : ''}`;
            } catch (error) {
                if (version === renderVersion) {
                    clearResult();
                    status.textContent = error.name === 'SecurityError' ? '圖片來源不允許下載，請重新取得封面或上傳本機 Logo。' : error.message;
                }
            }
        }
        form.addEventListener('submit', async event => {
            event.preventDefault(); cancel(); clearResult(); original = null;
            let id;
            try { id = parseVideoId(url.value); } catch (error) { status.textContent = error.message; return; }
            const current = request;
            controller = new AbortController();
            fetchButton.disabled = true; fetchButton.textContent = '讀取中…';
            status.textContent = '正在取得最高解析度封面，若未提供則依序嘗試其他尺寸…';
            try {
                const image = await fetchThumbnail(id, controller.signal);
                if (current !== request) return;
                original = image; await render();
            } catch (error) {
                if (current === request && error.name !== 'AbortError') status.textContent = error.message;
            } finally {
                if (current === request) { fetchButton.disabled = false; fetchButton.textContent = '取得封面'; controller = null; }
            }
        });
        url.addEventListener('input', () => {
            cancel(); original = null; clearResult(); status.textContent = '連結已變更，請按「取得封面」。';
        });
        [addWatermark, source, position, opacity].forEach(control => control.addEventListener('input', render));
        file.addEventListener('change', async () => {
            const selected = file.files[0];
            if (!selected) return;
            const version = ++fileVersion;
            customLogo = null; source.value = 'custom'; addWatermark.checked = true;
            render();
            if (!selected.type.startsWith('image/')) { status.textContent = '請選擇圖片檔作為 Logo。'; return; }
            const objectUrl = URL.createObjectURL(selected);
            try {
                const logo = new Image(); logo.src = objectUrl; await logo.decode();
                if (version !== fileVersion) return;
                customLogo = logo; await render();
            } catch { status.textContent = 'Logo 圖片無法讀取，請選擇另一個檔案。'; }
            finally { URL.revokeObjectURL(objectUrl); }
        });
        download.addEventListener('click', () => {
            if (preview.hidden || download.disabled) return;
            downloading = true; download.disabled = true;
            const version = renderVersion;
            try {
                preview.toBlob(blob => {
                    downloading = false;
                    if (version !== renderVersion) { download.disabled = preview.hidden; return; }
                    download.disabled = false;
                    if (!blob) { status.textContent = '圖片轉換失敗，請重新取得封面。'; return; }
                    options.save(new File([blob], options.filename(), { type: 'image/jpeg' }));
                }, 'image/jpeg', renderedQuality);
            } catch (error) { downloading = false; download.disabled = false; status.textContent = `下載失敗：${error.message}`; }
        });
        return { cancel, render };
    }
    const api = { parseVideoId, fitDimensions, logoPlacement, fetchThumbnail, mount };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.YouTubeThumbnail = api;
})(typeof window === 'object' ? window : globalThis);
