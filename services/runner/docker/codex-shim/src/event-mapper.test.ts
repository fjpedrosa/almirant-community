import { beforeEach, describe, expect, it } from "bun:test";
import {
  mapCodexEventToSse,
  type CodexMappingContext,
} from "./event-mapper.js";

const SESSION_ID = "session-test-1";

const makeContext = (): CodexMappingContext => ({
  messageSnapshots: new Map(),
});

describe("mapCodexEventToSse", () => {
  let context: CodexMappingContext;

  beforeEach(() => {
    context = makeContext();
  });

  it("does not render internal todo_list items as visible transcript text", () => {
    const updated = mapCodexEventToSse(
      SESSION_ID,
      {
        type: "item.updated",
        item: {
          id: "todo-list-1",
          type: "todo_list",
        },
      },
      context,
    );
    const completed = mapCodexEventToSse(
      SESSION_ID,
      {
        type: "item.completed",
        item: {
          id: "todo-list-1",
          type: "todo_list",
        },
      },
      context,
    );

    expect(updated.events).toEqual([]);
    expect(completed.events).toEqual([]);
  });
});
