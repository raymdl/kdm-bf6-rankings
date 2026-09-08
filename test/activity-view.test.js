import test from "node:test";
import assert from "node:assert/strict";
import { renderActivityView } from "../assets/activity-view.js";

test("Activity preserves saved search and filters cards on input", () => {
  const filterState = { text: "alpha" };
  const search = { value: filterState.text, addEventListener(type, listener) {
    assert.equal(type, "input");
    this.onInput = listener;
  } };
  const cards = ["alpha kills", "beta assists"].map((text) => ({ dataset: { activitySearch: text } }));
  const empty = {};
  const app = {
    querySelector: (selector) => selector === "#activity-search" ? search : empty,
    querySelectorAll: () => cards
  };
  renderActivityView({ app, filterState,
    items: [{ at: "now", html: "overtake", search: "alpha kills", favorited: true }],
    esc: (value) => String(value).replaceAll('"', "&quot;"), fmtDateTime: () => "date"
  });
  assert.match(app.innerHTML, /id="activity-search"/);
  assert.match(app.innerHTML, /feed-item favorited/);
  assert.deepEqual(cards.map((card) => card.hidden), [false, true]);
  search.value = "  BETA  ";
  search.onInput();
  assert.equal(filterState.text, "  BETA  ");
  assert.deepEqual(cards.map((card) => card.hidden), [true, false]);
  assert.equal(empty.hidden, true);
  search.value = "missing";
  search.onInput();
  assert.equal(empty.hidden, false);
});
