import type { NextConfig } from "next";

/**
 * A static export, not a server.
 *
 * The console is a client-side app that talks to the clinic API on another
 * origin. There is nothing to render on a server: every screen is behind a
 * login, so there is no SEO to serve and no first paint worth pre-rendering.
 *
 * What static export buys is the deployment we already have — `rsync` a folder
 * and reload nginx. Running `next start` would mean a second Node process on
 * the VPS to supervise, restart and keep patched, next to the one actually
 * treating patients.
 *
 * `trailingSlash` so nginx finds `/audit/index.html` from `/audit/` without a
 * rewrite rule that has to be kept in step with the routes.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,

  // No image optimiser exists in a static export, and every image here is an
  // uploaded logo served by the API anyway.
  images: { unoptimized: true },

  // A build that ships type errors is a build that lies about being green.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
