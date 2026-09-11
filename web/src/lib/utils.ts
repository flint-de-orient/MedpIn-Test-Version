import { createCn } from "cn/config";

/**
 * Class merging that knows this console's type scale.
 *
 * ---- The bug this exists to stop --------------------------------------
 *
 * `cn` resolves Tailwind conflicts by keeping the last class in a group, and
 * both a text colour and a font size are written `text-*`. It tells them apart
 * by recognising the size names — `text-sm`, `text-lg` — and this console does
 * not use those. Its scale is named for the job: `text-micro`, `text-caption`,
 * `text-body`, `text-title`, `text-heading`, `text-display`, `text-metric`.
 *
 * None of those are names the default tables know, so every one was classified
 * as a colour, and any real colour written before it in the same call was
 * dropped as a conflict:
 *
 *   cn("bg-primary text-primary-foreground ... text-title")
 *     -> "bg-primary ... text-title"          the white is gone
 *
 * That is the dark-text-on-dark-blue sign-in button. The source said
 * `text-primary-foreground`, the built CSS defined it, and the element never
 * carried it — so reading the code proved nothing and the contrast test, which
 * reads the source, had no way to see it either. It shipped on every filled
 * button and on every muted line written colour-first.
 *
 * Registering the scale as font sizes is the whole fix: `text-title` becomes a
 * size, stops colliding with colours, and both survive.
 *
 * Names must match `@theme` in globals.css. A step added there and not here is
 * a step that silently eats colours again.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["micro", "caption", "body", "title", "heading", "display", "metric"],
        },
      ],
    },
  },
});
