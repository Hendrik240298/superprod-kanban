// Real Chromium iframe checks against a disposable PluginAPI, not the installed app.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const source = async (name) =>
  await readFile(new URL(`../../src/${name}`, import.meta.url), "utf8");
const errors = [];
async function fixture(touch = false) {
  const context = await browser.newContext({
    viewport: { width: 980, height: 850 },
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(
    '<iframe style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>',
  );
  const frame = page.frames()[1];
  await frame.setContent('<main id="app"></main>');
  await frame.addStyleTag({ content: await source("style.css") });
  await frame.addStyleTag({
    content:
      ":root { --font-size-md:14px; --card-border-radius:6px; --focus-ring-width:3px; --focus-ring-offset:4px; --focus-ring-color:rgb(25, 90, 180); }",
  });
  await frame.addScriptTag({
    content: `
    window.fixture = {
      tasks: ['a','b'].map((id,i) => ({id, title:i ? 'Second' : 'First', projectId:'p', tagIds:[], isDone:false})),
      hooks:{}, values:new Map(), writes:[], selected:[], actions:[], paused:false,
    };
    window.PluginAPI = {
      Hooks:{ANY_TASK_UPDATE:'task', WORK_CONTEXT_CHANGE:'context'},
      registerHook:(key,fn) => fixture.hooks[key] = fn,
      getActiveWorkContext:async () => ({id:'p', type:'PROJECT'}),
      getAllProjects:async () => [{id:'p', title:'Test'}],
      getAllTags:async () => [{id:'backlog',title:'Backlog'},{id:'doing',title:'Doing'}],
      getTasks:async () => structuredClone(fixture.tasks),
      loadSyncedData:async key => fixture.values.get(key),
      persistDataSynced:async (value,key) => fixture.values.set(key,value),
      updateTask:async (id,patch) => {
        if (fixture.paused) await new Promise(resolve => fixture.release = resolve);
        fixture.writes.push({id,patch});
        Object.assign(fixture.tasks.find(t => t.id === id), patch);
      },
      addTask:async fields => { fixture.writes.push(fields); fixture.tasks.push({id:'child',...fields}); return 'child'; },
      selectTask:async id => fixture.selected.push(id),
      startTracking:async id => fixture.actions.push(['track',id]),
      dispatchAction:async action => {
        await Promise.resolve();
        fixture.actions.push(action.type);
        if (fixture.rejectActions) throw new Error('Not allowed');
      },
      closeWorkContextView:async () => {},
    };
  `,
  });
  await frame.addScriptTag({
    content: (await source("board-core.js")).replace(
      "export { BoardCore };",
      "",
    ),
  });
  await frame.addScriptTag({ content: await source("board-ui.js") });
  await frame.locator(".card").first().waitFor();
  return {
    context,
    page,
    frame,
    card: (id) => frame.locator(`.card[data-task-id="${id}"]`),
  };
}
async function check(name, action, touch = false) {
  const f = await fixture(touch);
  try {
    await action(f);
    console.log(`PASS ${name}`);
  } finally {
    await f.context.close();
  }
}
try {
  await check(
    "m menu supports hjkl and leaves form text alone",
    async ({ page, frame, card }) => {
      await card("a").focus();
      await page.keyboard.press("m");
      const menu = frame.locator(".card-menu");
      const buttons = menu.locator("button");
      await buttons.first().waitFor();
      await page.keyboard.press("j");
      assert.equal(
        await buttons.nth(1).evaluate((n) => document.activeElement === n),
        true,
      );
      await page.keyboard.press("k");
      assert.equal(
        await buttons.first().evaluate((n) => document.activeElement === n),
        true,
      );
      await menu.getByRole("menuitem", { name: /Estimate/ }).focus();
      await page.keyboard.press("l");
      await menu.locator(".card-menu-back").waitFor();
      await page.keyboard.press("h");
      await menu.locator(".card-menu-back").waitFor({ state: "detached" });
      await menu.getByRole("menuitem", { name: /Add subtask/ }).focus();
      await page.keyboard.press("Enter");
      const input = menu.locator("input");
      await input.waitFor();
      await input.focus();
      await page.keyboard.type("hjkl");
      assert.equal(await input.inputValue(), "hjkl");
      await page.keyboard.press("Escape");
      await input.waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      assert.equal(
        await card("a").evaluate((n) => document.activeElement === n),
        true,
      );
    },
  );
  await check(
    "card and menu keyboard focus stays inside clipped edges",
    async ({ page, frame, card }) => {
      const assertInsetRing = async (target) => {
        const ring = await target.evaluate((n) => {
          const s = getComputedStyle(n);
          return {
            width: parseFloat(s.outlineWidth),
            offset: parseFloat(s.outlineOffset),
            style: s.outlineStyle,
          };
        });
        assert.equal(ring.style, "solid", "keyboard focus must remain visible");
        assert.ok(
          ring.width > 0 && ring.width + ring.offset <= 0,
          "focus ring protrudes into a clipping scroll container: " +
            JSON.stringify(ring),
        );
      };
      await card("a").focus();
      await page.keyboard.press("Shift");
      await assertInsetRing(card("a"));
      await page.keyboard.press("m");
      const menu = frame.locator(".card-menu");
      await menu.waitFor();
      await assertInsetRing(menu.locator("button").first());
      await menu.locator("button").last().focus();
      await assertInsetRing(menu.locator("button").last());
      await page.screenshot({
        path:
          new URL("../../dist/polish-menu-focus.png", import.meta.url).pathname,
      });
    },
  );
  await check(
    "completion repeat safety, focus and no persistent completion UI",
    async ({ page, frame, card }) => {
      const silent = async () => {
        assert.equal(
          await frame.locator(".completion-feedback, .completion-undo").count(),
          0,
        );
        assert.equal(
          await frame.getByRole("button", { name: "Undo", exact: true })
            .count(),
          0,
        );
        assert.equal(await frame.locator("#board-status").innerText(), "");
      };
      await card("a").focus();
      await page.keyboard.down("d");
      await card("a").waitFor({ state: "detached" });
      await page.keyboard.down("d");
      assert.equal(await card("b").count(), 1);
      assert.equal(
        await card("b").evaluate((n) => document.activeElement === n),
        true,
      );
      await page.keyboard.up("d");
      await silent();
      await card("b").locator(".card-complete").click();
      await card("b").waitFor({ state: "detached" });
      await silent();
      assert.equal(
        await frame.locator(".board").evaluate((n) =>
          document.activeElement === n
        ),
        true,
      );
      assert.equal(
        await frame.evaluate(() => fixture.tasks.every((task) => task.isDone)),
        true,
      );
    },
  );
  await check(
    "busy title keeps draft, then retries once",
    async ({ page, frame, card }) => {
      await frame.evaluate(() => fixture.paused = true);
      await card("a").locator(".card-complete").click();
      await frame.waitForFunction(() => fixture.release);
      await card("b").evaluate((n) => n.startEditing());
      await card("b").locator("input").fill("Retained busy title");
      await page.keyboard.press("Enter");
      assert.equal(await card("b").locator("input").isVisible(), true);
      assert.match(await frame.locator("#board-status").innerText(), /busy/);
      await frame.evaluate(() => {
        fixture.paused = false;
        fixture.release();
      });
      await card("a").waitFor({ state: "detached" });
      assert.equal(
        await card("b").locator("input").inputValue(),
        "Retained busy title",
      );
      await page.keyboard.press("Enter");
      await frame.waitForFunction(() =>
        fixture.tasks[1].title === "Retained busy title"
      );
      assert.equal(
        await frame.evaluate(() =>
          fixture.writes.filter((w) => w.patch?.title).length
        ),
        1,
      );
    },
  );
  await check(
    "menu refresh preserves draft, caret, focus and accepts save",
    async ({ frame, card }) => {
      await card("a").locator(".card-actions").click();
      await frame.getByRole("menuitem", { name: /^Add subtask/ }).click();
      const input = frame.locator(".card-menu-form input");
      await input.fill("Retained menu draft");
      await input.evaluate((n) => n.setSelectionRange(4, 4));
      await frame.evaluate(() => {
        document.querySelector(".board").dataset.old = "yes";
        fixture.hooks.task();
      });
      await frame.waitForFunction(() =>
        document.querySelector(".board").dataset.old !== "yes"
      );
      assert.deepEqual(
        await input.evaluate(
          (n) => [n.value, n.selectionStart, document.activeElement === n],
        ),
        ["Retained menu draft", 4, true],
      );
      await input.press("Enter");
      await frame.locator(".card-menu").waitFor({ state: "detached" });
      assert.equal(
        await frame.evaluate(() =>
          fixture.tasks.find((t) => t.id === "child").title
        ),
        "Retained menu draft",
      );
    },
  );
  await check(
    "valid blur commits and Escape cancels",
    async ({ page, frame, card }) => {
      await card("a").evaluate((n) => n.startEditing());
      await card("a").locator("input").fill("Blur committed title");
      await frame.locator(".task-add-input").first().focus();
      await frame.waitForFunction(() =>
        fixture.tasks[0].title === "Blur committed title"
      );
      await card("b").evaluate((n) => n.startEditing());
      await card("b").locator("input").fill("Cancelled draft");
      await page.keyboard.press("Escape");
      assert.equal(await card("b").locator("input").isVisible(), false);
      assert.equal(
        await frame.evaluate(() => fixture.tasks[1].title),
        "Second",
      );
    },
  );
  await check(
    "invalid unfocused blur draft survives refresh",
    async ({ frame, card }) => {
      await card("a").evaluate((n) => n.startEditing());
      await card("a").locator("input").fill("Title @every Friday");
      await frame.locator(".task-add-input").first().focus();
      await frame.evaluate(() => {
        document.querySelector(".board").dataset.old = "yes";
        fixture.hooks.task();
      });
      await frame.waitForFunction(() =>
        document.querySelector(".board").dataset.old !== "yes"
      );
      assert.equal(await card("a").locator("input").isVisible(), true);
      assert.equal(
        await card("a").locator("input").inputValue(),
        "Title @every Friday",
      );
      assert.equal(await frame.evaluate(() => fixture.writes.length), 0);
    },
  );
  await check(
    "focus setup rejection reports tracking and offers List fallback",
    async ({ frame, card }) => {
      await frame.evaluate(() => fixture.rejectActions = true);
      await card("a").locator(".card-actions").click();
      await frame.getByRole("menuitem", { name: /^Open focus setup/ }).click();
      await frame.locator(".focus-list-fallback").waitFor();
      assert.match(
        await frame.locator("#board-status").innerText(),
        /tracking started/,
      );
      assert.deepEqual(await frame.evaluate(() => fixture.actions), [
        ["track", "a"],
        "[FocusMode] Show Overlay",
        "[FocusMode] Show Focus Overlay",
      ]);
    },
  );
  await check(
    "exported theme geometry and coarse completion hit target",
    async ({ frame, card }) => {
      const metrics = await card("a").evaluate((n) => {
        const button = n.querySelector(".card-complete");
        const style = getComputedStyle(n);
        return [
          style.fontSize,
          style.borderRadius,
          button.getBoundingClientRect().width,
          button.getBoundingClientRect().height,
          getComputedStyle(button, "::before").width,
        ];
      });
      assert.deepEqual(metrics, ["14px", "6px", 44, 44, "16px"]);
    },
    true,
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
