<!--
The template for a release's notes. Copy it into CHANGELOG.md as the newest entry, above the previous version, and fill it in.
The release workflow publishes the section titled "## vX.Y.Z" as the body of the GitHub Release, so what is written
here is what people read when they download the app. Delete these comments, and every section that has nothing in it.

Write for someone who uses Roboratory, not for someone who built it:
- what it does for them, in the words of the product; the reasoning is in docs/DECISIONS.md, so cite a D# instead of explaining
- present tense, no dates, no ticket numbers, no "we"
- each item starts with a bold phrase that names the thing; one or two sentences after it
-->

## vX.Y.Z

<!-- One paragraph: what this release is about, and the one thing a user will notice first. -->

### <The main area of the release>
<!-- e.g. The engine process, The command line, The Floor, Lines, Build mode, Managers, Platforms. One section per area. -->
- **What it is.** What it does, and for whom.

### Fixed
- **What was wrong, as the user met it.** What happens now.

### Tests
<!-- Only what a maintainer needs: a new layer, a new way to run them. Not a count of tests. -->
- **What changed in how the project is checked.**

### Upgrading
<!-- Only when something needs action: a changed command, a moved file, a setting to review. Otherwise delete the section. -->
- **What to do**, and what happens if you do not.

### Known limits
<!-- What this release does not do yet, or cannot yet be trusted with. Link the roadmap item rather than promising a date. -->
- **What is not there**, and where it is planned (docs/ROADMAP.md).
