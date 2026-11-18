#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch (GitHub Pages: Settings → Pages → Deploy from branch → gh-pages / root).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
remote=$(git remote get-url origin)
name=$(git config user.name || echo "deploy"); email=$(git config user.email || echo "deploy@users.noreply.github.com")
src=$(git rev-parse --short HEAD)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
  git clone --quiet --branch gh-pages --depth 1 "$remote" "$tmp"
  find "$tmp" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
else
  git init -q "$tmp"; git -C "$tmp" checkout -q -b gh-pages; git -C "$tmp" remote add origin "$remote"
fi
cp -R dist/. "$tmp"/
touch "$tmp/.nojekyll"
git -C "$tmp" add -A
if git -C "$tmp" diff --cached --quiet; then echo "Nothing to deploy."; exit 0; fi
git -C "$tmp" -c user.name="$name" -c user.email="$email" commit -q -m "Deploy $src"
git -C "$tmp" push origin gh-pages
echo "Published. Site: https://$(echo "$remote" | sed -E 's#.*github.com[:/]([^/]+)/([^/.]+)(\.git)?#\1.github.io/\2#')/"
