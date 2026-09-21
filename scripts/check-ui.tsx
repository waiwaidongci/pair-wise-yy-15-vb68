import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).getComputedStyle = dom.window.getComputedStyle;

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: App } = await import("../src/App");

let pass = 0;
let fail = 0;
const assert = (n: string, c: boolean) => (c ? pass++ : (fail++, console.error("FAIL: " + n)));
const flush = () => act(async () => {});

const root = createRoot(document.getElementById("root")!);
await act(async () => {
  root.render(React.createElement(App));
});
await flush();

const text = () => document.body.textContent ?? "";
assert("标题渲染", text().includes("电子环"));
assert("概览指标渲染", text().includes("待复核队列"));
assert("种子待复核原因可见", text().includes("最近校准距开笼超过 72 小时") || text().includes("校准超72h"));
assert("发环台在役环可见", text().includes("CHN-E0001"));

// 切到训放台
const clickByText = async (t: string) => {
  const btn = [...document.querySelectorAll("button,summary")].find((b) =>
    (b.textContent ?? "").includes(t)
  ) as HTMLElement | undefined;
  if (!btn) throw new Error("未找到按钮: " + t);
  await act(async () => {
    btn.click();
  });
};
await clickByText("训放成绩台");
assert("排行渲染含名次", text().includes("80km"));
assert("未归巢提醒渲染", text().includes("未归巢"));

await clickByText("成绩复核台");
assert("复核队列渲染", text().includes("待复核队列"));
assert("单羽档案渲染", text().includes("历史成绩"));

await clickByText("规则与台账");
assert("规则文案渲染", text().includes("一羽一环在役"));
assert("台账事件流水渲染", text().includes("电子环发放"));

console.log(`\nUI render: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
