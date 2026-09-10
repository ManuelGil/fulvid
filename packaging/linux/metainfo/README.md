# AppStream / Metainfo

`candidate.metainfo.xml` holds public fields that are already true. It is not a Flathub submission and it does not adopt a Flatpak App ID.

The `<id>` is a candidate (`dev.imgil.fulvid`). The shipping Electrobun identifier remains `fulvid.imgil.dev`. Desktop files remain `fulvid.desktop`.

Present: name, summary, description, developer, licenses, URLs, categories, icon name, launchable, content rating.

Omitted on purpose:

- Adopted Flatpak App ID
- `<releases>` until a GitHub Release exists
- `<screenshot>` URLs (files exist in [assets/screenshots/](../../../assets/screenshots/); do not invent a public URL)

`appstreamcli validate --no-net` succeeds. Pedantic check reports `releases-info-missing`.
