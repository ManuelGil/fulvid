# Graph

Graph shows the focused folder document among documents it actually links to. It does not own the editor tab, Search, Explorer, or Focus.

Focus and Graph-local depth go through a deterministic pipeline:

```text
Focus + depth -> Projection -> Structural Selection -> Layout -> Composition -> canvas (Sigma)
```

Projection is undirected membership from resolved document links. Do not merge it with Context's directed `buildFocusGraph`. Same folder scan, Focus, and depth produce the same Core output.

Peek does not change Focus, so Graph does not re-project. Graph depth must not leak into other features.

Graph is not a knowledge graph, not a second document store, and not the product center. Improve the pipeline above or the Sigma view; do not add a second Graph system.

Code: `src/mainview/modules/graph/`. Ownership: [ARCHITECTURE.md](./ARCHITECTURE.md).
