export function renderActivityView({ app, items, filterState, esc, fmtDateTime }) {
  app.innerHTML = `
    <div class="activity-toolbar">
      <div class="activity-heading-row">
        <h1 class="page-title">Activity</h1>
        <label class="player-search"><span class="sr-only">Search overtake activity</span><input id="activity-search" type="search" placeholder="Search players or stats" autocomplete="off" value="${esc(filterState.text)}"></label>
      </div>
      <p class="page-sub">Recent leaderboard overtakes</p>
    </div>
    ${
      items.length
        ? `<div class="feed">${items
            .map((item) => `<div class="feed-item${item.favorited ? " favorited" : ""}" data-activity-search="${esc(item.search)}"><span class="feed-date">${fmtDateTime(item.at)}</span>${item.html}</div>`)
            .join("")}</div><p id="activity-search-empty" class="empty" hidden>No overtake activity matches that search.</p>`
        : `<div class="empty">No overtakes yet — this feed records leaderboard changes only.</div>`
    }`;

  const search = app.querySelector("#activity-search");
  const cards = [...app.querySelectorAll("[data-activity-search]")];
  const empty = app.querySelector("#activity-search-empty");
  const applyFilter = () => {
    filterState.text = search.value;
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const card of cards) {
      card.hidden = Boolean(query) && !card.dataset.activitySearch.includes(query);
      if (!card.hidden) visible += 1;
    }
    if (empty) empty.hidden = visible > 0;
  };
  search?.addEventListener("input", applyFilter);
  if (search) applyFilter();
}
