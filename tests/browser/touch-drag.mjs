// Optional real-Chromium regression checks. PluginAPI is a disposable fixture,
// not a running Super Productivity instance or an Android WebView.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 412, height: 824 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><iframe style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>',
  );
  const frame = page.frames()[1];
  await frame.setContent(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><main id="app"></main>',
  );
  await frame.addStyleTag({
    content: await readFile(
      new URL("../../src/style.css", import.meta.url),
      "utf8",
    ),
  });
  await frame.addScriptTag({
    content: `
    const tasks = Array.from({length: 16}, (_, i) => ({
      id: 't'+i, title: i === 0 ? 'Drag this task' : 'Test task '+i,
      projectId: 'p', tagIds: i === 1 ? ['doing'] : ['extra'], isDone: false,
    }));
    const values = new Map();
    window.fixture = {tasks, values, selected: []};
    window.PluginAPI = {
      Hooks: {}, registerHook() {},
      getActiveWorkContext: async () => ({id:'p', type:'PROJECT'}),
      getAllTags: async () => [{id:'backlog', title:'Backlog'}, {id:'doing', title:'Doing'}],
      getTasks: async () => tasks,
      getAllProjects: async () => [{id:'p', title:'Test'}],
      loadSyncedData: async key => values.get(key) || null,
      persistDataSynced: async (value, key) => values.set(key, value),
      selectTask: async id => fixture.selected.push(id),
      updateTask: async (id, patch) => Object.assign(tasks.find(t => t.id === id), patch),
    };
  `,
  });
  await frame.addScriptTag({
    content: (await readFile(
      new URL("../../src/board-core.js", import.meta.url),
      "utf8",
    )).replace("export { BoardCore };", ""),
  });
  await frame.addScriptTag({
    content: await readFile(
      new URL("../../src/board-ui.js", import.meta.url),
      "utf8",
    ),
  });
  await frame.waitForSelector(".card");
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" || type === "touchCancel"
        ? []
        : [{ x, y, id: 1 }],
    });
  const first = () => frame.locator('.card[data-task-id="t0"]');
  let bounds = await first().boundingBox();
  await touch("touchStart", bounds.x + 100, bounds.y + 25);
  await page.waitForTimeout(450);
  assert.equal(
    await frame.locator(".touch-drag-preview").count(),
    1,
    "hold must lift card",
  );
  assert.equal(
    await frame.locator(".card-menu").count(),
    0,
    "hold must not open actions",
  );
  await touch("touchMove", 360, bounds.y + 25);
  await touch("touchEnd");
  await frame.waitForFunction(() => fixture.tasks[0].tagIds.includes("doing"));
  assert.deepEqual(await frame.evaluate(() => fixture.tasks[0].tagIds), [
    "extra",
    "doing",
  ]);
  assert.deepEqual(
    await frame.evaluate(() => fixture.selected),
    [],
    "drop must not open details",
  );
  console.log(
    "PASS real touch hold + cross-lane drop in iframe; unrelated tags preserved",
  );

  // Swiping before the hold threshold must scroll, not drag.
  await page.waitForTimeout(750);
  const before = await frame.locator(".board").evaluate((el) => el.scrollLeft);
  await touch("touchStart", 280, 450);
  for (let x = 260; x >= 80; x -= 20) {
    await touch("touchMove", x, 450);
    await page.waitForTimeout(20);
  }
  await touch("touchEnd");
  await page.waitForTimeout(400);
  const after = await frame.locator(".board").evaluate((el) => el.scrollLeft);
  assert.ok(after > before, `swipe must scroll board (${before} -> ${after})`);
  assert.equal(await frame.locator(".touch-drag-preview").count(), 0);
  console.log("PASS native horizontal swipe scrolling without drag");

  // Reveal a card then use the separate menu and ordinary tap.
  await frame.locator(".board").evaluate((el) => {
    el.scrollLeft = 0;
  });
  const card = frame.locator('.card[data-task-id="t2"]');
  await card.locator(".card-actions").tap();
  assert.equal(await frame.locator(".card-menu").count(), 1);
  assert.deepEqual(await frame.evaluate(() => fixture.selected), []);
  await page.keyboard.press("Escape");
  bounds = await card.boundingBox();
  await page.touchscreen.tap(bounds.x + 100, bounds.y + 25);
  assert.deepEqual(await frame.evaluate(() => fixture.selected), ["t2"]);
  console.log("PASS explicit actions button and ordinary tap for details");

  // Cancellation must never persist a partial move.
  bounds = await card.boundingBox();
  const original = await frame.evaluate(() => JSON.stringify(fixture.tasks));
  await touch("touchStart", bounds.x + 100, bounds.y + 25);
  await page.waitForTimeout(450);
  await touch("touchMove", 360, bounds.y + 25);
  await touch("touchCancel");
  assert.equal(await frame.locator(".touch-drag-preview").count(), 0);
  assert.equal(
    await frame.evaluate(() => JSON.stringify(fixture.tasks)),
    original,
  );
  assert.equal(await frame.locator(".touch-drag-source").count(), 0);
  console.log("PASS interrupted touch drag cleans up without moving task");

  // Drag to a visible lane edge to reach columns beyond the phone viewport.
  await page.waitForTimeout(750);
  await frame.locator(".board").evaluate((el) => {
    el.scrollLeft = 0;
  });
  bounds = await card.boundingBox();
  await touch("touchStart", bounds.x + 100, bounds.y + 25);
  await page.waitForTimeout(450);
  await touch("touchMove", 398, bounds.y + 25);
  await page.waitForTimeout(300);
  assert.ok(await frame.locator(".board").evaluate((el) => el.scrollLeft) > 0);
  await touch("touchCancel");
  console.log("PASS horizontal edge auto-scroll during touch drag");

  await frame.locator(".board").evaluate((el) => {
    el.scrollLeft = 0;
  });
  bounds = await card.boundingBox();
  const cardList = frame.locator(".lane").first().locator(".cards");
  const listBounds = await cardList.boundingBox();
  await touch("touchStart", bounds.x + 100, bounds.y + 25);
  await page.waitForTimeout(450);
  await touch("touchMove", 100, listBounds.y + listBounds.height - 5);
  await page.waitForTimeout(300);
  assert.ok(await cardList.evaluate((el) => el.scrollTop) > 0);
  await touch("touchCancel");
  console.log("PASS vertical edge auto-scroll during touch drag");

  await cardList.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(750);
  await touch("touchStart", 100, 450);
  for (let y = 430; y >= 250; y -= 20) {
    await touch("touchMove", 100, y);
    await page.waitForTimeout(20);
  }
  await touch("touchEnd");
  await page.waitForTimeout(400);
  assert.ok(await cardList.evaluate((el) => el.scrollTop) > 0);
  assert.equal(await frame.locator(".touch-drag-preview").count(), 0);
  console.log("PASS native vertical swipe scrolling without drag");

  // Desktop input must still use the existing HTML drag/drop and right-click.
  await page.setViewportSize({ width: 1100, height: 824 });
  await cardList.evaluate((el) => {
    el.scrollTop = 0;
  });
  await card.click({ button: "right" });
  assert.equal(await frame.locator(".card-menu").count(), 1);
  await page.keyboard.press("Escape");
  await frame.locator('.card[data-task-id="t3"]').dragTo(
    frame.locator(".lane").nth(1),
  );
  await frame.waitForFunction(() => fixture.tasks[3].tagIds.includes("doing"));
  console.log("PASS desktop right-click and native HTML drag/drop");

  assert.deepEqual(errors, []);
  console.log("PASS no browser page errors");
} finally {
  await browser.close();
}
