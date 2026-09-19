# PatentGraph Frontend

## Development

Use Node.js 22.12+ in a local checkout (a GitHub virtual workspace cannot run npm commands directly).

```sh
npm install
npm test
npm run lint
npm run build
npm run dev -- --host 127.0.0.1
```

The query API defaults to `http://localhost:8000`; override it with `VITE_API_URL`.

## Graph Workspace

- Views start with up to 12 nodes, prioritizing anchor cases and connection count. Selecting a node expands one hop of currently unfiltered relationships, up to 50 visible nodes. "Explore from here" starts a fresh neighborhood. Expansion uses the returned graph, not additional server queries.
- Type filters apply to both nodes and relationships. Focus dims nodes beyond the selected hop radius. Shortest paths use all returned, unfiltered nodes, even if not expanded. Paths are undirected by default; "Follow arrows" respects relationship direction. Paths longer than 50 nodes remain listed in full, with only the first 50 rendered.
- Node size is based on connection count or incoming `CITES` edges in the returned result, not global database counts or estimated portfolio value. Entity colors and shapes are shared between 2D and 3D. Only entity types supplied by the API are shown; the UI does not invent litigants, courts, inventors, or assignees.
- PNG and PDF export the current viewport, including focus and path styling, with a legend. In 2D, "Visible subgraph" exports all currently displayed nodes regardless of zoom. PDF contains a raster image suitable for decks; notes are not embedded in image exports.
- Notes save locally by node ID. They are not uploaded or synchronized. To give teammates a copy, explicitly include notes in a snapshot link. Imported notes remain in that snapshot until edited locally or shared again.
- Share links embed a compressed graph snapshot, selected node, expansion, filters, path, focus, metric, node positions, and 2D viewport or 3D camera. Recipients can open them without the query API. Snapshots are not live collaboration and have no access control: anyone holding a link can read its data. Exclude unexpanded/filtered nodes to reduce disclosure and link size. Notes are excluded by default.
- Snapshots are stored in the URL fragment, not the query string. Browser history, clipboard tools, and messaging services can still retain them. Share only through approved channels. Links above 60,000 encoded characters are rejected; messaging systems may impose smaller limits.

## Verification

`npm test` covers normalization, metrics, expansion limits, filtered/directed paths, focus radii, and snapshot round-trips and rejection. Before release, exercise PNG/PDF downloads, note persistence, share restoration, and 2D/3D pan/zoom at desktop and mobile sizes with a WebGL-capable browser.

## Tooling

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
