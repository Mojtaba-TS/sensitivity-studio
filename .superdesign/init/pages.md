# Page dependency trees

## `/` (Sensitivity Studio)

Entry: `frontend/src/App.tsx`

Dependencies:

- `frontend/src/App.css`
- `frontend/src/api.ts` (network client and result types; no visual UI)
- `frontend/src/sampleModel.ts` (initial editor content; no visual UI)
- `recharts` (line chart rendering)

The desktop render is a top header, a two-column workspace with model code at left and parameter/sweep cards at right, followed by conditional result cards and a conditional sensitivity chart.

