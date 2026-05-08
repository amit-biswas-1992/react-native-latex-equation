# react-native-latex-equation — package context

Public npm package: <https://www.npmjs.com/package/react-native-latex-equation>
Owner: `amitverse` (on npm).
Source of truth for the implementation lives in `src/MathText.tsx`. The companion AI-agent skill is `SKILL.md`.

## Publishing — read this before bumping a version

**The npm publish token lives in 1Password. It is NEVER committed to the repo, never typed into a terminal that gets logged, and never pasted into chat.**

### Token convention

| Where | Name pattern | Notes |
|---|---|---|
| **npm Granular Access Token** | `npm-publish-<YYYY-MM-DD>` (the date is the expiry) | Generated at <https://www.npmjs.com/settings/amitverse/tokens/granular-access-tokens/new>. Required settings: ✅ Bypass 2FA, Read+Write, All packages, ≥7 day expiry. |
| **1Password item** | `npm-publish-amitverse-<YYYY-MM-DD>` (mirrors the npm token name + account) | Vault: `Personal`. Category: API Credential. Fields: `username=amitverse`, `credential=<token>`, `valid until=<expiry-date>`, `type=bearer`. URL field set to <https://www.npmjs.com/settings/amitverse/tokens>. |

The expiry date in the title is the contract — it lets anyone (human or agent) tell at a glance whether the token is still good without revealing the secret.

### Publish flow (each time)

```bash
cd "$(git rev-parse --show-toplevel)"   # this package's root

# 1. Pick the active token name. Either look it up:
TOKEN_ITEM=$(op item list --vault Personal --tags npm,publishing --format json \
  | python3 -c "import json,sys,datetime as d
items=[i for i in json.load(sys.stdin) if i['title'].startswith('npm-publish-amitverse-')]
today=d.date.today().isoformat()
valid=[i for i in items if i['title'].rsplit('-',3)[-3:]>=today.split('-')]
print(valid[0]['title'] if valid else 'EXPIRED')")

if [ "$TOKEN_ITEM" = "EXPIRED" ]; then
  echo "All stored tokens expired — generate a new one (see 'Rotation' below) and rerun."
  exit 1
fi

# 2. Pull the token into an isolated npmrc and publish.
TMPNPMRC=$(mktemp)
cat > "$TMPNPMRC" <<EOF
//registry.npmjs.org/:_authToken=$(op read "op://Personal/$TOKEN_ITEM/credential")
registry=https://registry.npmjs.org/
EOF

ISOHOME="/tmp/npm-iso-$$"
mkdir -p "$ISOHOME"
HOME="$ISOHOME" NPM_CONFIG_USERCONFIG="$TMPNPMRC" npm publish --access public

rm -f "$TMPNPMRC"
rm -rf "$ISOHOME"
```

The isolated `HOME` matters — npm's normal config precedence means a stale token in `~/.npmrc` can still trigger EOTP even when you pass a fresh token in another `.npmrc`. The throwaway `HOME` guarantees only your token-bearing config is read.

### Rotation — when the token expires

If the date in the token name has passed (or the publish step rejects with 401), generate a new one. **Do not edit the existing 1Password item — create a new one, then archive the old one.**

1. Open <https://www.npmjs.com/settings/amitverse/tokens/granular-access-tokens/new>.
2. Create a granular access token with:
   - Name: `npm-publish-<YYYY-MM-DD-of-new-expiry>`
   - ✅ Bypass two-factor authentication (2FA)
   - Permissions: Read and write
   - Selected packages: All packages
   - Expiration: ≥ 7 days, ≤ 90 days
3. Copy the token. Save to 1Password Personal vault:
   ```bash
   op item create \
     --category="API Credential" \
     --title="npm-publish-amitverse-<YYYY-MM-DD>" \
     --vault="Personal" \
     --url="https://www.npmjs.com/settings/amitverse/tokens" \
     --tags="npm,publishing" \
     username="amitverse" \
     credential="npm_…" \
     type="bearer" \
     "valid until[date]=<YYYY-MM-DD>" \
     notesPlain="Granular access token. Bypass 2FA, Read+Write all packages."
   ```
4. Verify retrieval:
   ```bash
   curl -sH "Authorization: Bearer $(op read 'op://Personal/npm-publish-amitverse-<YYYY-MM-DD>/credential')" \
     https://registry.npmjs.org/-/whoami
   # expects: {"username":"amitverse"}
   ```
5. Archive the old 1Password item (so the lookup script doesn't pick it):
   ```bash
   op item delete --archive "<old-item-id>"
   ```

### What absolutely must NOT happen

- ❌ Committing the token to git (in `.npmrc`, `eas.json`, an env file, anywhere). The repo's `~/.npmrc`-style files should never have an `_authToken` line that lands in a commit.
- ❌ Pasting the token into chat / a screenshot / a shared terminal. If it ever gets exposed, treat it as burnt: revoke at <https://www.npmjs.com/settings/amitverse/tokens> and regenerate per Rotation above.
- ❌ Reusing a single long-lived token forever. The 7–90 day expiry is the safety net — let it run out and rotate.

## Package metadata invariants

- `name`: `react-native-latex-equation` (unscoped — anyone can `npm install` it directly)
- License: MIT, copyright "Amit Biswas"
- Peer deps: `react`, `react-native`, `react-native-webview`. Don't add `react-native-webview` as a regular dep — that's a host-app concern.
- Files in tarball (per `package.json#files`): `dist/`, `src/`, `README.md`, `SKILL.md`, `LICENSE`. Anything else stays out.
- Keep `SKILL.md` in sync with `~/.claude/skills/react-native-latex-math/SKILL.md` — that's the canonical Claude Code skill version. Copy it across before each version bump.

## Build

`npm run build` runs `tsc` against `src/` → `dist/` (declarations + sourcemaps). `prepublishOnly` calls it automatically, so a `npm publish` always ships a fresh build.
