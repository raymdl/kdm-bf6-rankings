# KDM BF6 Rankings

[Open the site](https://raymdl.github.io/kdm-bf6-rankings/).

The KDM community's Battlefield 6 statistics site: Career and Period
leaderboards, player history, head-to-head comparisons, weapon/vehicle data,
activity, and an experimental Effectiveness Lab. It is a static vanilla
JavaScript application with no build step.

## Data and ownership

GitHub Pages serves the HTML, CSS, and JavaScript. The
[kdm-discord-bot](https://github.com/raymdl/kdm-discord-bot) collects statistics
and publishes filtered JSON releases to public R2 through a delivery Worker.
The browser pins one release until reload. A returning tab can offer Reload
when newer data is available. Data older than eight hours is marked stale.

This repository's `data/` directory is a **frozen rollback snapshot**. It is
not the live data source and must not be edited as a way to update the site.
Private numeric and raw archives are not included here.

## Local preview and tests

Serve this repository root on port 4173 or 4174, which the delivery Worker
allows for localhost previews:

~~~powershell
npx serve -l 4173 .
~~~

Open [localhost:4173](http://localhost:4173/). The preview reads live public
release data. The command can download the serve package if it is not installed.
To use the frozen local snapshot deliberately, follow the
[data-loading guide](docs/DATA_LOADING.md#local-preview).

Run `npm test` with Node 20 or later. Tests use Node's built-in test runner;
there is no application build or package-install step for these tests.

## Change and deploy

Edit `index.html` and `assets/`. Keep data URL resolution in
[assets/data-source.js](assets/data-source.js). When changing shipped JavaScript
or CSS, update the relevant `?v=` import cache version in `index.html`.
Preview the affected routes and run the relevant tests before publication.

Site code is deployed through the repository's GitHub Pages configuration.
After an authorized merge/deployment, verify the live page and its cache version.
A site-code deployment does not collect stats or publish a new R2 data release.

## Documentation

- [Career/Period calculations, qualification, and favorites](docs/PERIOD_VIEWS.md)
- [Data loading, release pinning, caching, and recovery](docs/DATA_LOADING.md)
- [Effectiveness formulas and interpretation](EFFECTIVENESS_MEASURES.md)
- [Bot documentation index](https://github.com/raymdl/kdm-discord-bot/blob/main/docs/README.md): stats, generated artifacts, schedules, operations, and historical records

The frozen [kdm-bf6-archive](https://github.com/raymdl/kdm-bf6-archive) repository
is historical rollback material. Current numeric history belongs to private R2.
