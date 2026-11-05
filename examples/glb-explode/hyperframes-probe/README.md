# HyperFrames probe (мера переносимости)

Probe-композиция: тот же meshopt-GLB (`assets/s1045_lod3.glb`) и тот же разлёт
по именованным нодам, что и в `examples/glb-explode`, но собранная под HyperFrames
(HTML + three.js 0.184.0 ESM с CDN + `MeshoptDecoder` + GSAP-клок).

Запуск:

```bash
cd examples/glb-explode/hyperframes-probe
npx hyperframes check
npx hyperframes snapshot --at 0,1,2,4 --no-end
```

Результат (2026-11-05, Linux, headless Chromium + SwiftShader):
- meshopt-ассет грузится и рендерится; 115 именованных mesh-нод разлетаются;
- два независимых прогона `snapshot` дают **побайтово идентичные** кадры
  (ffmpeg PSNR = inf для t=0,1,2,4);
- `snapshot` сам собирает contact sheet.

Известные замечания линтера `hyperframes check` (нужны при порте в registry-блок):
- `content_overlap` — лейблы «liver»/«stomach» перекрываются;
- `contrast` — 2.89:1 и 3.79:1 (нужно ≥4.5:1) на лейблах;
- `craft` warning — размер текста 22 px (минимум 28 px);
- камера не пересчитывается под разлёт — части уходят за кадр.
