import assert from "node:assert/strict";
import { test } from "node:test";
import { readBrowserSession, writeBrowserSession } from "../src/browser-session.ts";

test("tab session survives a new reader, is API-scoped, and clears on sign-out", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    },
  });
  try {
    assert.equal(readBrowserSession("https://api.example"), "");
    writeBrowserSession("https://api.example", "session-token");
    assert.equal(readBrowserSession("https://api.example"), "session-token");
    assert.equal(readBrowserSession("https://another.example"), "");
    assert.deepEqual([...items.values()], ["session-token"]);
    writeBrowserSession("https://api.example", "");
    assert.equal(readBrowserSession("https://api.example"), "");
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("storage restrictions do not prevent sign-in or logout", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: () => {
      throw new Error("Storage blocked");
    },
  });
  try {
    assert.equal(readBrowserSession("https://api.example"), "");
    assert.doesNotThrow(() => writeBrowserSession("https://api.example", "token"));
    assert.doesNotThrow(() => writeBrowserSession("https://api.example", ""));
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
