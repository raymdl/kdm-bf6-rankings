import test from "node:test";
import assert from "node:assert/strict";
import { pairwiseOvertakeFlags } from "../assets/overtakes.js";

test("marks the new higher player on the exact day two Career series cross", () => {
  const flags = pairwiseOvertakeFlags({
    aryanDemon: [12540, 12580, 12600, 12630, 12670, 12780],
    nick: [12515, 12590, 12600, 12680, 12680, 12760]
  });

  assert.deepEqual(flags.aryanDemon, [false, false, false, false, false, true]);
  assert.deepEqual(flags.nick, [false, true, false, false, false, false]);
});

test("marks all three observed July 24 rivalry crossings without notification data", () => {
  const cases = [
    ["AryanDemon", "NICK.", 12673, 12679, 12780, 12759],
    ["Medic_Wolfy", "Shindyz", 14634, 14662, 14800, 14759],
    ["ITzFAMiLY", "Kamikaze", 13996, 14108, 14219, 14207]
  ];

  for (const [overtaker, overtaken, previousOvertaker, previousOvertaken, currentOvertaker, currentOvertaken] of cases) {
    const flags = pairwiseOvertakeFlags({
      [overtaker]: [previousOvertaker, currentOvertaker],
      [overtaken]: [previousOvertaken, currentOvertaken]
    });
    assert.deepEqual(flags[overtaker], [false, true], `${overtaker} should receive the July 24 halo`);
    assert.deepEqual(flags[overtaken], [false, false], `${overtaken} should not receive the July 24 halo`);
  }
});

test("derives every selected pair independently when more than two players are visible", () => {
  const flags = pairwiseOvertakeFlags({
    alpha: [10, 40],
    bravo: [20, 30],
    charlie: [30, 20]
  });

  assert.deepEqual(flags.alpha, [false, true]);
  assert.deepEqual(flags.bravo, [false, true]);
  assert.deepEqual(flags.charlie, [false, false]);
});

test("ties, touches without crossing, and missing values do not create halos", () => {
  const flags = pairwiseOvertakeFlags({
    alpha: [10, 20, 20, null, 40],
    bravo: [20, 20, 10, 30, 30]
  });

  assert.deepEqual(flags.alpha, [false, false, false, false, false]);
  assert.deepEqual(flags.bravo, [false, false, false, false, false]);
});
