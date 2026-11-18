# Asset Attribution

_Last updated: 2026-11-18 (Phase 1, Task 4)_

All third-party assets in this project are **free CC0** (Creative Commons Zero)
— the preferred license for this project. No paid packs are used, and no file is
shipped whose license could not be verified at download time.

## Third-party assets shipped

### Kenney — Furniture Kit (version 2.0)
Licensed **CC0** (https://creativecommons.org/publicdomain/zero/1.0/).
Author: **Kenney** (www.kenney.nl). Created 20-10-2018 per the kit's License.txt.
Source page: https://kenney.nl/assets/furniture-kit
Downloaded 2026-11-18 from kenney.nl via the site's own `download-link` endpoint
(same signed URL a browser receives after clicking "Continue without
donating…"; unauthenticated requests get `{"error":"forbidden"}`). Files are
shipped **unmodified** at `public/assets/furniture-kit/` with the kit's
`License.txt` included verbatim.

| File (`public/assets/furniture-kit/`) | Used for |
| --- | --- |
| `bookcaseOpen.glb` | Tall gondola shelf archetype (scaled to 2.0 m at load) |
| `bookcaseOpenLow.glb` | Low gondola shelf archetype (scaled to 1.1 m at load) |
| `kitchenBar.glb` | Checkout counter candidate (scaled to 0.95 m at load) |
| `License.txt` | The kit's CC0 license text, unmodified |

Only these four files are shipped — the full pack (140 models) is not in the
repo. Shelf/counter glTFs are loaded at runtime and **fall back to procedural
primitives automatically** if missing or unloadable (see
`src/three/assets.ts`), so the game boots with zero downloads as well.

## Procedural assets (generated at runtime)

Everything below is **procedural — generated at runtime, no third-party
assets**: box/cylinder/capsule/sphere/plane primitives with
`MeshLambertMaterial` (`flatShading`) and `CanvasTexture` labels drawn on a
2D canvas with system fonts only (no font files ship).

- **Product packages** (~12 catalog items in `src/data/products.ts`): Milo
  300 g tin (green/brown), Maggi Curry Noodles, Roti Canai Frozen (5pk),
  Nasi Lemak Bungkus, Tens Egg tray, Kuih Bahulu, Full Cream Milk 1 L, Mee
  Hoon 500 g, Telur Ayam 10pk, Kopi 3-in-1 (10pk), Bicarbonate of Soda 250 g,
  Soap Bar — each with a Malaysian-style packaging label (brand, variant,
  detail line, faux barcode seeded from the product id).
- **Procedural shelf fallback** (tall ×1.6 m wide, low variant) and
  **counter fallback** (cream base, wood top, dark kick plate).
- **Signage**: `KEDAI RUNCIT` ("MINI MARKET · EST. 1987") behind the till;
  `Grab` "PICK-UP POINT" (Grab green `#00aa5b`) at the pickup counter.
- **Customers**: 3 deterministic capsule/low-poly figures (terracotta /
  songkok / tudung variants).

## Trademark note

"Milo", "Maggi" (Nestlé), and "Grab" (Grab Holdings) are trademarks of their
respective owners. They appear here as nominative, parody-flavored packaging
homages in a non-commercial "cozy" fan project; this project is not affiliated
with, or endorsed by, any of these companies. Product colorways are
"inspired-by" homages, not reproductions of official artwork.

## Assets evaluated but NOT shipped

- **Kenney — City Kit Commercial** (CC0, https://kenney.nl/assets/city-kit-commercial):
  verified CC0 on the asset page but not downloaded — it is an exterior
  building kit, irrelevant to the interior Phase 1 slice.
- **Quaternius — furniture packs** (CC0, verified on quaternius.com): downloads
  are hosted in Google Drive folders and are not scriptable from a build
  environment; not used.
- **KayKit (itch.io) / Sketchfab free section**: require manual/authenticated
  download; unavailable at build time — not used.
- No other third-party files of any kind are shipped.

## Guarantees & how to add assets

- CC0 preferred; CC-BY allowed only with an entry above (file, source URL,
  license, author, modifications). Unclear license ⇒ do not ship the file;
  use the procedural fallback instead. (Licensing is verified per file — the
  shipped set above is CC0-verified.)
- No paid packs. No runtime downloads from external hosts — everything ships in
  the repo under `public/assets/`.
- If a shipped file is ever replaced or removed, update this manifest in the
  same change.
