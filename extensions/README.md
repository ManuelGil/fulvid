# Extensions directory

Fulvid does **not** ship extension packs here.

```text
Fulvid provides the extension host.
fulvid-extensions provides the extensions.
```

Discovery loads only from `userData/extensions/` at runtime. An empty tree here is the normal state.

- Product packs: sibling [`fulvid-extensions`](../../fulvid-extensions/)
- Host-contract test fixtures only: [`tests/extensions/fixtures/`](../tests/extensions/fixtures/)
- Contract: [`docs/EXTENSIONS.md`](../docs/EXTENSIONS.md)

Do not add packs under this directory to demonstrate the API. Install from Folder... (or copy into `userData/extensions/`) instead.
