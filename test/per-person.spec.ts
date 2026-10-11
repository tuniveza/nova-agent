// P0-4: Nova Agent tells people apart. Chats, missions, quests, blocked times and reminders are
// tied to the person: online, the signed-in staff member Nova Bot's relay passes; on the PC, the
// person Nova Agent works for (who also owns everything made before owners existed).
//   Run: npm test
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

// Ana is the person Nova Agent works for on the PC; Bea and Cal are staff online
async function studio(at = "2026-10-07T09:00") {
  const nova = await boot(at);
  writeFileSync(`${process.env.NOVA_DATA_DIR}/staff.json`, JSON.stringify({ last: "ana" }));
  const person = await import("../src/person");
  const relay = await import("../src/relay");
  const chats = await import("../src/chats");
  const asked = (id: string, role = "staff", name = id[0].toUpperCase() + id.slice(1)) =>
    person.personFor(relay.relayedRequest({ method: "GET", path: "/quests/state", headers: {}, staff: { id, name, role } }));
  return { nova, person, relay, chats, asked };
}

describe("who's asking", () => {
  it("online: the staff member the relay passed; on the PC: the person Nova Agent works for", async () => {
    const { person, asked } = await studio();
    const bea = await asked("bea");
    expect(bea).toMatchObject({ id: "bea", name: "Bea", role: "staff", online: true, pcOwner: false, everyone: false });
    expect((await asked("dee", "admin")).everyone).toBe(true);
    const local = await person.personFor(new Request("http://localhost:4545/quests/state"));
    expect(local).toMatchObject({ id: "ana", online: false, pcOwner: true, everyone: true });
  });

  it("no header or address can pretend to be someone (only the relay's own requests count)", async () => {
    const { person } = await studio();
    const forged = new Request("http://online.nova-agent.invalid/quests/state", { headers: { "X-Nova-Online": "Bea", "X-Nova-Staff": JSON.stringify({ id: "bea", role: "admin" }) } });
    expect((await person.personFor(forged)).id).toBe("ana");
  });
});

describe("chats per person", () => {
  it("a relayed staff member's turn uses and saves their own history, and the Agent is told who they are", async () => {
    const { chats, asked, nova } = await studio();
    const bea = await asked("bea");
    const seen: { history: string[]; person: string }[] = [];
    const agent = async (history: { role: string; content: string }[], p: { id: string }) => {
      seen.push({ history: history.map((m) => m.content), person: p.id });
      return { reply: `Hi ${p.id}`, actions: [] };
    };
    await chats.chatTurn(bea, { message: "Plan my week" }, agent);
    await chats.chatTurn(bea, { message: "And Friday?" }, agent);
    expect(seen[1]).toEqual({ history: ["Plan my week", "Hi bea", "And Friday?"], person: "bea" });
    const file = JSON.parse(readFileSync(`${process.env.NOVA_DATA_DIR}/chats/bea.json`, "utf8"));
    expect(file.staffId).toBe("bea");
    expect(file.messages.map((m: { content: string }) => m.content)).toEqual(["Plan my week", "Hi bea", "And Friday?", "Hi bea"]);
    expect(nova).toBeTruthy();
  });

  it("A's chat isn't visible to B (B's history and B's Agent turn never include it)", async () => {
    const { chats, asked } = await studio();
    const bea = await asked("bea");
    const cal = await asked("cal");
    const agent = async (history: { content: string }[]) => ({ reply: `seen ${history.length}`, actions: [] });
    await chats.chatTurn(bea, { message: "My secret plan" }, agent);
    expect(chats.readChat("cal")).toEqual([]);
    let calSaw: string[] = [];
    await chats.chatTurn(cal, { message: "Hello" }, async (history) => ((calSaw = history.map((m) => m.content)), { reply: "Hi", actions: [] }));
    expect(calSaw).toEqual(["Hello"]);
    expect(chats.readChat("bea").map((m) => m.content)).toEqual(["My secret plan", "seen 1"]);
    // A page from before this sends the whole conversation: only its newest message is taken
    await chats.chatTurn(cal, { messages: [{ role: "user", content: "My secret plan" }, { role: "assistant", content: "x" }, { role: "user", content: "Again" }] }, agent);
    expect(chats.readChat("cal").map((m) => m.content)).toEqual(["Hello", "Hi", "Again", "seen 3"]);
  });

  it("the browser's old conversation is brought over for the PC's person only, once", async () => {
    const { chats, person, asked } = await studio();
    const old = [{ role: "user", content: "Old question" }, { role: "assistant", content: "Old answer" }];
    expect(chats.adoptChat(await asked("bea"), old)).toEqual({ adopted: 0 });
    expect(chats.readChat("bea")).toEqual([]);
    const ana = person.localPerson();
    expect(chats.adoptChat(ana, old)).toEqual({ adopted: 2 });
    expect(chats.readChat("ana").map((m) => m.content)).toEqual(["Old question", "Old answer"]);
    expect(chats.adoptChat(ana, [{ role: "user", content: "Again" }])).toEqual({ adopted: 0 });
  });

  it("the system prompt names the person and their role", async () => {
    const { asked } = await studio();
    const { systemPrompt } = await import("../src/chat");
    const prompt = systemPrompt(await asked("bea"));
    expect(prompt).toContain("You're talking to Bea (a member of staff at the studio, staff id bea)");
    expect(systemPrompt(await asked("dee", "admin", "Dee"))).toContain("Dee (an admin");
  });
});

describe("quests and missions per person", () => {
  const run = async (tools: any[], name: string, input: Record<string, unknown>) => tools.find((t) => t.name === name).run(input);

  it("a quest the Agent adds for a relayed staff member is theirs, and their tools show their own", async () => {
    const { nova, asked } = await studio();
    nova.setQuests({ quests: [{ id: "ana-q1", title: "Mix the EP", minutes: 60 }] });
    const { questTools } = await import("../src/chat");
    const bea = await asked("bea");
    const tools = questTools([], bea);
    await run(tools, "quest_add", { title: "Practise scales", minutes: 30 });
    const added = nova.store.readQuests().quests.find((q) => q.title === "Practise scales")!;
    expect(added.owner).toBe("bea");
    const list = await run(tools, "quests_list", {});
    expect(list).toContain("Practise scales");
    expect(list).not.toContain("Mix the EP");
    // Asking for everyone's: only admins
    expect(await run(tools, "quests_list", { everyone: true })).not.toContain("Mix the EP");
    const dee = questTools([], await asked("dee", "admin", "Dee"));
    const all = await run(dee, "quests_list", { everyone: true });
    expect(all).toContain("Mix the EP");
    expect(all).toContain("Practise scales");
  });

  it("staff can't change someone else's quest; an admin and the PC can", async () => {
    const { nova, asked } = await studio();
    nova.setQuests({ quests: [{ id: "ana-q1", title: "Mix the EP", minutes: 60 }] });
    const { questTools } = await import("../src/chat");
    await expect(run(questTools([], await asked("bea")), "quest_status", { id: "ana-q1", status: "done" })).rejects.toThrow(/not yours/);
    expect(nova.quest("ana-q1").status).toBe("todo");
    await run(questTools([], await asked("dee", "admin", "Dee")), "quest_status", { id: "ana-q1", status: "doing" });
    expect(nova.quest("ana-q1").status).toBe("doing");
    // Portal taps say who tapped
    expect(() => nova.actions.applyQuestTap({ kind: "quest", id: "ana-q1", action: "done", by: "bea", admin: false })).toThrow(/isn't theirs/);
    nova.actions.applyQuestTap({ kind: "quest", id: "ana-q1", action: "done", by: "ana", admin: false });
    expect(nova.quest("ana-q1").status).toBe("done");
  });

  it("existing data with no owner is the PC's person's, without being rewritten (a copy is kept once)", async () => {
    const { nova } = await studio();
    const file = `${process.env.NOVA_DATA_DIR}/quests.json`;
    // A quests.json from before owners
    writeFileSync(file, JSON.stringify({ rhythm: {}, missions: [{ id: "m1", title: "Release the EP" }], quests: [{ id: "q1", title: "Mix", minutes: 60, missionId: "m1" }], blocks: [] }));
    const st = nova.actions.questState({ id: "ana" });
    expect(st.quests.map((q) => [q.id, q.owner])).toEqual([["q1", "ana"]]);
    expect(st.missions.map((m) => [m.id, m.owner])).toEqual([["m1", "ana"]]);
    expect(nova.actions.questState({ id: "bea" }).quests).toEqual([]);
    nova.plan.replan();
    expect(existsSync(`${file}.pre-per-person`)).toBe(true);
    expect(JSON.parse(readFileSync(`${file}.pre-per-person`, "utf8")).quests[0]).not.toHaveProperty("owner");
    // Saved with no owner (still the PC's person's), so going back to the copy loses nothing
    expect(JSON.parse(readFileSync(file, "utf8")).quests[0].owner).toBe("");
  });

  it("Notes: a shared note's quest is found by whoever has it open (no copies), and its owner is whoever wrote it", async () => {
    const { nova } = await studio();
    nova.setQuests({ quests: [] });
    const q = nova.actions.addQuest({ title: "Write the hook", link: "note:n1|h1" }, "bea");
    expect(q.owner).toBe("bea");
    expect(nova.actions.addQuest({ title: "Write the hook", link: "note:n1|h1" }, "cal").id).toBe(q.id);
    expect(nova.actions.questState({ id: "cal", notes: true }).quests.map((x) => x.id)).toEqual([q.id]);
    expect(nova.actions.questState({ id: "cal" }).quests).toEqual([]);
  });

  it("each person's quests are planned in their own time: one person's never take another's", async () => {
    const { nova } = await studio("2026-10-07T09:00");
    const quest = (id: string, owner: string) => ({ id, owner, title: id, minutes: 60, earliest: "2026-10-07T10:00", deadline: "2026-10-07T23:00" });
    nova.setQuests({ quests: [quest("ana-1", ""), quest("ana-2", ""), quest("bea-1", "bea")] });
    nova.plan.replan();
    expect(nova.quest("ana-1").start).toBe("2026-10-07T10:00");
    expect(nova.quest("bea-1").start).toBe("2026-10-07T10:00");
    expect(nova.quest("ana-2").start).toBe("2026-10-07T11:00");
    // Bea's blocked time moves only Bea's quests
    nova.actions.addBlock("2026-10-07T09:30", "2026-10-07T12:00", "Out", "bea");
    expect(nova.quest("bea-1").start >= "2026-10-07T12:00").toBe(true);
    expect(nova.quest("ana-1").start).toBe("2026-10-07T10:00");
  });

  it("someone's own rhythm is theirs: setting it doesn't change the PC person's", async () => {
    const { nova } = await studio();
    nova.setQuests({ quests: [] });
    nova.actions.setRhythm({ wake: "10:00" }, "bea");
    const data = nova.store.readQuests();
    expect(data.rhythms.bea.wake).toBe("10:00");
    expect(data.rhythm.wake).toBe("07:00");
    expect(nova.actions.questState({ id: "bea" }).rhythm.wake).toBe("10:00");
    expect(nova.actions.questState({ id: "ana" }).rhythm.wake).toBe("07:00");
  });
});

describe("reminders reach their owner only", () => {
  it("a reminder for Bea's quest is for Bea's phones (never Ana's), and ownerless ones are Ana's", async () => {
    const { nova } = await studio("2026-10-07T09:55");
    nova.setQuests({
      quests: [
        { id: "bea-q", owner: "bea", title: "Practise scales", minutes: 30, fixedStart: "2026-10-07T10:00" },
        { id: "ana-q", title: "Mix the EP", minutes: 30, fixedStart: "2026-10-07T11:00" },
        { id: "picked", owner: "bea", title: "Call Sam", minutes: 5, fixedStart: "2026-10-07T12:00", phones: ["abcdef012345"] },
      ],
    });
    nova.start();
    await nova.run("2h10m");
    const bea = nova.pings("bea-q", "starting");
    expect(bea).toHaveLength(1);
    expect(bea[0].owner).toBe("bea");
    expect(bea[0].phones).toBeUndefined();
    expect(nova.pings("ana-q", "starting")[0].owner).toBe("ana");
    // Phones picked on the quest still go with it (Nova Bot sends to just those)
    expect(nova.pings("picked", "starting")[0]).toMatchObject({ owner: "bea", phones: ["abcdef012345"] });
    // Nothing of Bea's went out as Ana's
    expect(nova.sent.filter((p) => p.title.includes("Practise scales") && p.owner !== "bea")).toEqual([]);
  });

  it("the morning plan is each person's own quests, to their own phones", async () => {
    const { nova } = await studio("2026-10-07T06:58");
    nova.setQuests({
      rhythm: { dailyBriefing: true },
      quests: [
        { id: "bea-q", owner: "bea", title: "Practise scales", minutes: 30, fixedStart: "2026-10-07T10:00" },
        { id: "ana-q", title: "Mix the EP", minutes: 30, fixedStart: "2026-10-07T11:00" },
      ],
    });
    nova.start();
    await nova.run("5m");
    const briefings = nova.sent.filter((p) => p.kind === "briefing");
    expect(briefings.map((b) => b.owner).sort()).toEqual(["ana", "bea"]);
    const of = (who: string) => briefings.find((b) => b.owner === who)!.message;
    expect(of("bea")).toContain("Practise scales");
    expect(of("bea")).not.toContain("Mix the EP");
    expect(of("ana")).toContain("Mix the EP");
    expect(of("ana")).not.toContain("Practise scales");
  });
});

describe("Portal's copy", () => {
  it("says whose each quest and mission is, and each person's own 'now'", async () => {
    const { nova } = await studio("2026-10-07T09:55");
    nova.setQuests({ quests: [{ id: "bea-q", owner: "bea", title: "Practise scales", minutes: 30, fixedStart: "2026-10-07T10:00" }, { id: "ana-q", title: "Mix the EP", minutes: 30, fixedStart: "2026-10-07T11:00" }] });
    nova.plan.replan();
    const { snapshot } = await import("../src/quests/portalsync");
    const snap = snapshot();
    expect(snap.quests.map((q) => [q.id, q.owner]).sort()).toEqual([["ana-q", "ana"], ["bea-q", "bea"]]);
    expect(snap.people.bea.next.map((q: { id: string }) => q.id)).toEqual(["bea-q"]);
    expect(snap.people.ana.next.map((q: { id: string }) => q.id)).toEqual(["ana-q"]);
  });
});
