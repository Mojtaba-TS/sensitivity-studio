# Theme

## Compact token summary

- Font: `Inter, ui-sans-serif, system-ui, sans-serif`; monospace data/editor font: `ui-monospace, SFMono-Regular, Consolas, monospace`
- Canvas background: `#f5f7fb`; primary text: `#172033`; muted text: `#738096`; status text: `#61708a`
- Primary blue: `#315efb`; pale primary surface: `#e9eeff`
- Card: white, `1px #e5e9f2` border, `14px` radius, `20px` padding, `0 8px 24px #15244d08` shadow
- Inputs: `1px #d9e0ed` border, `7-9px` radius; editor surface `#f8faff`
- Main desktop max width: `1440px`; workspace columns: `1.5fr / .8fr`; mobile breakpoint: `850px`

## Raw source: `frontend/src/index.css`

```css
:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f5f7fb; font-synthesis: none; } * { box-sizing: border-box; } body { margin: 0; min-width: 320px; }
```

## Raw source: `frontend/src/App.css`

```css
main { max-width: 1440px; margin: auto; padding: 42px 32px 64px; color: #172033; }
header, .card-title, .results { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
h1 { margin: 3px 0 0; font-size: 30px; letter-spacing: -.8px; } h2 { font-size: 15px; margin: 0 0 14px; } p { margin: 0; }
.eyebrow { color: #315efb; font-weight: 700; letter-spacing: 1.3px; font-size: 11px; }.status { color: #61708a; font-size: 13px; }
.workspace { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(300px, .8fr); gap: 20px; margin-top: 30px; }.side-stack { display: grid; gap: 20px; align-content: start; }
.card { background: #fff; border: 1px solid #e5e9f2; border-radius: 14px; padding: 20px; box-shadow: 0 8px 24px #15244d08; }
textarea { width: 100%; min-height: 470px; resize: vertical; box-sizing: border-box; border: 1px solid #d9e0ed; border-radius: 9px; background: #f8faff; padding: 16px; color: #172033; font: 13px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
button { border: 0; border-radius: 8px; padding: 9px 13px; color: white; background: #315efb; font-weight: 650; cursor: pointer; } button.quiet { background: #e9eeff; color: #315efb; } button:disabled { opacity: .45; cursor: not-allowed; }
.parameter { display: flex; align-items: center; justify-content: space-between; padding: 11px 0; border-top: 1px solid #edf0f5; font: 13px ui-monospace, monospace; }.parameter input, .sweep-grid input, select { width: 94px; border: 1px solid #d9e0ed; border-radius: 7px; padding: 8px; background: white; }.muted { color: #738096; font-size: 13px; line-height: 1.45; }.sweep-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }.sweep-grid select, .sweep-grid button { grid-column: span 2; width: 100%; }
.results { align-items: stretch; margin-top: 20px; }.results > * { flex: 1; }.metric strong { display: block; font-size: 34px; margin: 12px 0 5px; }.metric p, small { color: #738096; }.table-card table { width: 100%; border-collapse: collapse; font: 13px ui-monospace, monospace; }.table-card td { border-top: 1px solid #edf0f5; padding: 8px 0; }.table-card td:last-child { text-align: right; }.chart-card { margin-top: 20px; }
@media (max-width: 850px) { main { padding: 25px 16px; } header, .results { align-items: flex-start; flex-direction: column; }.workspace { grid-template-columns: 1fr; } }
```

