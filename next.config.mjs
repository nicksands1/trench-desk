/** @type {import('next').NextConfig} */
const nextConfig = {
  // `postgres` (postgres-js) must not be bundled by Next's server build.
  serverExternalPackages: ["postgres"],
  // We typecheck with `tsc --noEmit` and run unit tests separately; keep build
  // from failing on lint config we don't ship.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
