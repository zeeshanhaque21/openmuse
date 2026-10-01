import assert from "node:assert/strict";
import { test } from "node:test";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { relayOpenBotEvent } from "../apps/server/src/openbot.ts";

const input: RunAgentInput = {
  threadId: "native-thread",
  runId: "native-run",
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
};
test("OpenBot envelopes cannot impersonate already-durable native Intelligence events", () => {
  const event = {
    type: EventType.RUN_STARTED,
    threadId: "upstream-thread",
    runId: "upstream-run",
    input: { ...input, threadId: "upstream-thread", runId: "upstream-run" },
    metadata: { cpki_event_id: "existing-event", cpki_ingested: true, cpki_event_seq: 42 },
    run_id: "upstream-run",
    thread_id: "upstream-thread",
    organization_id: "foreign-org",
    project_id: 42,
    rawEvent: { secret: "must-not-relay" },
    unknownCredential: "must-not-relay",
  };
  assert.deepEqual(relayOpenBotEvent(event, input), {
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
    input,
  });
  assert.deepEqual(relayOpenBotEvent({ ...event, type: EventType.RUN_FINISHED }, input), {
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
  });
});
test("OpenBot relay retains text, tool arguments and custom events without cloud envelopes", () => {
  for (const event of [
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta: "hello" },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: "t", delta: '{"path":"/workspace/result"}' },
    { type: EventType.CUSTOM, name: "choice-panel", value: { id: "panel" } },
  ])
    assert.deepEqual(
      relayOpenBotEvent({ ...event, metadata: { cpki_ingested: true } }, input),
      event,
    );
});
