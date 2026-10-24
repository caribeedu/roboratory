# Roboratory — Releasing

How a version is cut. The notes of a release are its entry in [CHANGELOG.md](../CHANGELOG.md), written from [`.github/RELEASE_TEMPLATE.md`](../.github/RELEASE_TEMPLATE.md); the release workflow ([`release.yml`](../.github/workflows/release.yml)) builds the app and publishes them.

## Before the tag

1. **The branch is merged and the CI is green** on the last commit (unit and e2e, on macOS, Windows and Linux).
2. **The version is set.** `package.json` and `package-lock.json` carry `X.Y.Z`; the README's status line names the version; `docs/ROADMAP.md` no longer lists what this version delivered.
3. **The entry is written.** `CHANGELOG.md` has a `## vX.Y.Z` section made from the template, as the newest entry. The workflow stops if the section is missing, and publishes it as the body of the release.
4. **The docs match the code.** Read the entry against `README.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` and `docs/DEVELOPMENT.md`: a command, a path or a number that changed is changed there too.
5. **The packaged app works.** `npm run package`, then `npm run test:e2e`, on the machine you have; the CI covers the others.

## The tag

```bash
git switch main
```

```bash
git pull
```

```bash
git tag -a vX.Y.Z -m "Roboratory X.Y.Z"
```

```bash
git push origin vX.Y.Z
```

Pushing the tag starts the workflow, which:

1. refuses a tag that does not match the version in `package.json`, or a version with no entry in the changelog;
2. runs the type check and the unit tests;
3. builds the app on macOS, Windows and Linux (`npm run make`);
4. creates the GitHub Release with the entry as its body and the archives attached. Versions below 1.0 are marked as pre-releases.

## After the tag

- Open the release and check the notes read well on their own, and that all three archives are attached (macOS, Windows, Linux).
- The builds are not signed or notarized yet; the first launch on macOS and Windows asks the person to allow it. The notes should say so under "Known limits" until that changes.
- A workflow that failed after the tag is fixed on `main` and run again from the Actions tab (`workflow_dispatch` builds without publishing); the tag is only moved when nothing was published.
