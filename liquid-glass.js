// Liquid Glass optical refraction engine (SVG feDisplacementMap + chromatic dispersion)
// Inspirado em https://github.com/deepika-builds/liquid-glass
(function () {
    'use strict';

    function initLiquidGlass() {
        const player = document.querySelector('.player');
        if (!player) return;

        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Cria o filtro SVG de refração se ainda não existir
        let svg = document.getElementById('liquid-glass-svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.id = 'liquid-glass-svg';
            svg.setAttribute('aria-hidden', 'true');
            svg.style.cssText = 'position:fixed;width:0;height:0;top:-9999px;left:-9999px;pointer-events:none;overflow:hidden;';
            svg.innerHTML = `
                <defs>
                    <filter id="liquid-glass-refraction" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
                        <feImage id="liquid-glass-feimage" result="lens_map" preserveAspectRatio="none"/>
                        <!-- Refração vermelha -->
                        <feDisplacementMap in="SourceGraphic" in2="lens_map" scale="-34" xChannelSelector="R" yChannelSelector="G" result="disp_r"/>
                        <feColorMatrix in="disp_r" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red_only"/>
                        <!-- Refração verde -->
                        <feDisplacementMap in="SourceGraphic" in2="lens_map" scale="-30" xChannelSelector="R" yChannelSelector="G" result="disp_g"/>
                        <feColorMatrix in="disp_g" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green_only"/>
                        <!-- Refração azul -->
                        <feDisplacementMap in="SourceGraphic" in2="lens_map" scale="-26" xChannelSelector="R" yChannelSelector="G" result="disp_b"/>
                        <feColorMatrix in="disp_b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue_only"/>
                        <!-- Recombina dispersão cromática -->
                        <feBlend in="red_only" in2="green_only" mode="screen" result="rg_blend"/>
                        <feBlend in="rg_blend" in2="blue_only" mode="screen" result="liquid_glass_out"/>
                    </filter>
                </defs>
            `;
            document.body.appendChild(svg);
        }

        const feImage = document.getElementById('liquid-glass-feimage');

        function updateDisplacementMap() {
            const rect = player.getBoundingClientRect();
            const w = Math.max(120, Math.round(rect.width || 340));
            const h = Math.max(48, Math.round(rect.height || 68));
            const r = Math.min(w / 2, h / 2);
            const rim = Math.min(18, Math.max(10, Math.round(h * 0.24)));

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const imgData = ctx.createImageData(w, h);
            const data = imgData.data;

            const halfW = w / 2;
            const halfH = h / 2;
            const innerStraightW = Math.max(0, halfW - r);
            const innerStraightH = Math.max(0, halfH - r);

            for (let y = 0; y < h; y++) {
                const dy = y - halfH;
                const absY = Math.abs(dy);
                const qy = Math.max(0, absY - innerStraightH);

                for (let x = 0; x < w; x++) {
                    const dx = x - halfW;
                    const absX = Math.abs(dx);
                    const qx = Math.max(0, absX - innerStraightW);

                    let dist = 0;
                    let nx = 0;
                    let ny = 0;

                    if (qx > 0 || qy > 0) {
                        const cornerDist = Math.sqrt(qx * qx + qy * qy);
                        dist = r - cornerDist;
                        if (cornerDist > 0.0001) {
                            nx = (qx / cornerDist) * (dx < 0 ? -1 : 1);
                            ny = (qy / cornerDist) * (dy < 0 ? -1 : 1);
                        }
                    } else {
                        dist = r;
                    }

                    const idx = (y * w + x) * 4;

                    if (dist < 0) {
                        data[idx] = 128;
                        data[idx + 1] = 128;
                        data[idx + 2] = 128;
                        data[idx + 3] = 255;
                    } else if (dist >= rim) {
                        data[idx] = 128;
                        data[idx + 1] = 128;
                        data[idx + 2] = 255;
                        data[idx + 3] = 255;
                    } else {
                        const t = 1 - (dist / rim);
                        const curve = Math.sin(t * Math.PI * 0.5);
                        data[idx] = Math.round(128 + 127 * nx * curve);
                        data[idx + 1] = Math.round(128 + 127 * ny * curve);
                        data[idx + 2] = 255;
                        data[idx + 3] = 255;
                    }
                }
            }

            ctx.putImageData(imgData, 0, 0);
            if (feImage) {
                feImage.setAttribute('href', canvas.toDataURL('image/png'));
            }
        }

        window.updateLiquidGlass = updateDisplacementMap;
        updateDisplacementMap();

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => updateDisplacementMap());
            ro.observe(player);
        } else {
            window.addEventListener('resize', updateDisplacementMap, { passive: true });
        }

        if (!prefersReducedMotion) {
            player.addEventListener('pointermove', function (e) {
                const rect = player.getBoundingClientRect();
                const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
                const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
                player.style.setProperty('--glass-x', x.toFixed(1) + '%');
                player.style.setProperty('--glass-y', y.toFixed(1) + '%');
            }, { passive: true });

            player.addEventListener('pointerleave', function () {
                player.style.setProperty('--glass-x', '50%');
                player.style.setProperty('--glass-y', '50%');
            }, { passive: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLiquidGlass);
    } else {
        initLiquidGlass();
    }
})();
