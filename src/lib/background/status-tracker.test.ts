import type {
  BrowserContextSubmissionSummaryV1,
  BrowserSubmissionStatus,
} from "@cognia/companion-client"

import {
  EMPTY_SNAPSHOT,
  badgeFor,
  countStatuses,
  diffStatuses,
  followUps,
  notificationMessageKey,
  shouldKeepPolling,
} from "./status-tracker"

function item(
  submissionId: string,
  status: BrowserSubmissionStatus,
  extra: Partial<BrowserContextSubmissionSummaryV1> = {}
): BrowserContextSubmissionSummaryV1 {
  return {
    submissionId,
    title: `Task ${submissionId}`,
    sourceHost: "example.com",
    captureMode: "metadata",
    status,
    submittedAt: 1,
    updatedAt: 2,
    deepLink: `cognia://s/${submissionId}`,
    ...extra,
  }
}

describe("counts and polling", () => {
  it("counts in-flight and waiting tasks, ignoring finished and stalled ones", () => {
    const items = [
      item("a", "queued"),
      item("b", "running"),
      item("c", "needs_input"),
      item("d", "completed"),
      item("e", "host_unavailable"),
    ]
    expect(countStatuses(items)).toEqual({ running: 2, needsInput: 1 })
    expect(shouldKeepPolling(items)).toBe(true)
    expect(shouldKeepPolling([item("d", "completed"), item("e", "host_unavailable")])).toBe(false)
  })
})

describe("badgeFor", () => {
  it("puts a waiting site decision first", () => {
    expect(badgeFor({ running: 3, needsInput: 0 }, 1)).toEqual({
      text: "!",
      tone: "attention",
    })
  })

  it("counts work, toned by whether anything waits on the person", () => {
    expect(badgeFor({ running: 0, needsInput: 0 }, 0)).toEqual({
      text: "",
      tone: "none",
    })
    expect(badgeFor({ running: 2, needsInput: 0 }, 0)).toEqual({
      text: "2",
      tone: "busy",
    })
    expect(badgeFor({ running: 1, needsInput: 1 }, 0)).toEqual({
      text: "2",
      tone: "attention",
    })
    expect(badgeFor({ running: 120, needsInput: 0 }, 0).text).toBe("99+")
  })
})

describe("diffStatuses", () => {
  it("takes the first read as a baseline", () => {
    const { transitions, next } = diffStatuses(EMPTY_SNAPSHOT, [
      item("a", "completed"),
      item("b", "needs_input"),
    ])
    expect(transitions).toEqual([])
    expect(next).toEqual({
      primed: true,
      statuses: { a: "completed", b: "needs_input" },
      // Only what can still change is followed.
      tracked: { b: { label: "Task b" } },
    })
  })

  it("remembers what an unsettled task is called and where it acts, and whose it is", () => {
    const owned = { ...EMPTY_SNAPSHOT, owner: "http://h#d" }
    const first = diffStatuses(owned, [
      item("a", "running", { title: "", sourceHost: "a.test", sessionId: "s1" }),
    ]).next
    expect(first).toEqual({
      primed: true,
      statuses: { a: "running" },
      tracked: { a: { label: "a.test", sessionId: "s1" } },
      owner: "http://h#d",
    })
    // Re-read by id, with no title or conversation: both are kept.
    const later = diffStatuses(first, [{ submissionId: "a", status: "needs_input" }]).next
    expect(later.tracked).toEqual({ a: { label: "a.test", sessionId: "s1" } })
    expect(diffStatuses(later, [{ submissionId: "a", status: "completed" }]).next).toEqual({
      primed: true,
      statuses: { a: "completed" },
      owner: "http://h#d",
    })
  })

  it("announces completion, failure and a new wait for input once each", () => {
    const base = diffStatuses(EMPTY_SNAPSHOT, [
      item("a", "running"),
      item("b", "running"),
      item("c", "queued"),
    ]).next
    const { transitions, next } = diffStatuses(base, [
      item("a", "completed"),
      item("b", "failed"),
      item("c", "running"),
      item("d", "needs_input"),
      item("e", "completed"),
    ])
    expect(transitions.map((entry) => [entry.item.submissionId, entry.from, entry.to])).toEqual([
      ["a", "running", "completed"],
      ["b", "running", "failed"],
      ["d", null, "needs_input"],
    ])
    expect(diffStatuses(next, [item("a", "completed")]).transitions).toEqual([])
  })

  it("names the unsettled tasks a read missed, newest first and bounded", () => {
    const snapshot = diffStatuses(EMPTY_SNAPSHOT, [
      item("a", "running"),
      item("b", "completed"),
      item("c", "needs_input"),
      item("d", "queued"),
    ]).next
    expect(followUps(snapshot, [item("d", "running")], 5)).toEqual(["a", "c"])
    expect(followUps(snapshot, [], 1)).toEqual(["a"])
    expect(followUps(EMPTY_SNAPSHOT, [], 5)).toEqual([])
  })

  it("names the message for each announced status", () => {
    expect(notificationMessageKey("completed")).toBe("notifyCompleted")
    expect(notificationMessageKey("failed")).toBe("notifyFailed")
    expect(notificationMessageKey("needs_input")).toBe("notifyNeedsInput")
  })
})
