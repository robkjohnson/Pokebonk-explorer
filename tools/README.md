# PokeBonk data tools

## Automatic updates (Windows)
1. Install Node.js once if you don't have it: `winget install OpenJS.NodeJS.LTS`
2. Double-click **update.cmd** to check now. If pokebonk.com has a new build it:
   - downloads the game's scripts + data into `raw/<version>/`
   - extracts every table into `extracted/<version>/` (json, csv, meta.json)
   - writes `extracted/<version>/CHANGES.md` (the game's patch notes + every data row that changed)
   - copies it to `extracted/latest/` and writes `extracted/latest.txt` (version, build, folder)
3. Double-click **schedule.cmd** to run that check every 3 hours in the background
   (**unschedule.cmd** removes it). Every run is logged in `update.log`.

`extracted/latest/` is only replaced when all tables were found; if the game's code changed
shape, the log says ERROR and the previous good data stays in `latest`.

## Command line
    node update.mjs                 check + update if needed
    node update.mjs --check         only check (exit code 10 = update available)
    node update.mjs --force         re-download and re-extract the current build
    node update.mjs --reextract 0.8.91   re-run extraction on an existing raw/ folder
    node extract.mjs <rawDir> <outRoot>  extractor only
    node csv.mjs <extracted/<version>>   CSVs only
    node diff.mjs <old> <new>            CHANGES.md only

## Builder page
`PokeBonk Builder.html` (in the data folder) is regenerated whenever new data is promoted to
`extracted/latest`. Open it in any browser. Rebuild by hand:
`node build-ui.mjs ../extracted/latest "../PokeBonk Builder.html"`. Layout lives in `builder.template.html`.

## Shareable website (GitHub Pages)
1. On GitHub create an empty repo, e.g. `pokebonk-builder`.
2. Double-click **setup-pages.cmd** and paste the repo URL. It clones the repo into `..\site-repo`,
   writes `config.json`, and pushes the site (index.html + data.json).
3. On GitHub: repo → Settings → Pages → "Deploy from a branch" → `main` / root.
   The site appears at `https://<you>.github.io/pokebonk-builder/`.
After that, every update that finds a new game build also pushes the new data to the site.
Publish manually any time with `node update.mjs --publish`.
Needs Git (`winget install Git.Git`); the first push opens a GitHub sign-in window.
