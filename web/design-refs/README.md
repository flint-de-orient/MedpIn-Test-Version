# Design references

Reference material for the console redesign. **Not a palette** — see the
"On the reference material" section of `../DESIGN.md` for what is taken from a
reference and what is deliberately left.

The direction, settled 2026-09-10:

> Match the reference layout and hierarchy. Keep MedPin's blue `#003399`, 6px
> radii, blue-and-neutral colour system, typography and component styling.

Take: layout and composition, information hierarchy, spacing rhythm,
information density, interaction polish.

Leave: colours, branding, radii, exact visual styling.

---

Drop reference images in this folder. Anything above 2000px on the long edge
cannot be read directly — downscale a copy alongside the original:

```bash
python -c "
from PIL import Image
im = Image.open('original.png'); im.thumbnail((2000, 2000))
im.save('original.view.png')
"
```
