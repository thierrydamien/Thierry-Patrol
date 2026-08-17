/*
 * Cross-device co-op, end to end.
 *
 * The jsdom suite cannot test this: there is no WebRTC in jsdom and no second
 * machine here anyway. So this runs two browser CONTEXTS in one Chromium with
 * a real RTCPeerConnection between them - which is the same code path two
 * tablets take, minus the Wi-Fi.
 *
 * It proves the things reading the code cannot: that the handshake completes,
 * that the guest's finger reaches the host's seat two, that the host's world
 * arrives on the guest's screen, and that a child playing on the far tablet
 * banks their coins into their OWN save and not the host's.
 *
 * The /room rendezvous is served from memory in here. Nothing may reach the
 * family's live Squad Sync while a test is driving profiles about, and the
 * route below aborts everything that is not the local file server.
 *
 * Run:  node tools/build.js
 *       python3 -m http.server 8321 --bind 127.0.0.1 &
 *       node _nettest.js
 */
const { chromium } = require("playwright-core");

const ROOMS = new Map();                     // the whole signalling server

function attachRoutes(ctx){
  return ctx.route("**/*", route => {
    const req = route.request();
    const u = new URL(req.url());
    if(u.pathname === "/room"){
      const key = (u.searchParams.get("code") || "") + ":" + (u.searchParams.get("slot") || "");
      if(req.method() === "PUT"){
        ROOMS.set(key, req.postData() || "");
        return route.fulfill({ status:200, contentType:"application/json", body:'{"ok":true}' });
      }
      const got = ROOMS.get(key);
      return route.fulfill({ status:200, contentType:"application/json",
        body: JSON.stringify(got ? { data: got } : {}) });
    }
    if(req.url().startsWith("http://127.0.0.1:8321")) return route.continue();
    return route.abort();
  });
}

async function boot(browser, pilot, colour){
  const ctx = await browser.newContext({ viewport:{ width:1180, height:820 } });
  await attachRoutes(ctx);
  const page = await ctx.newPage();
  const tag = pilot;
  page.on("pageerror", e => console.log("PAGEERROR[" + tag + "]:", e.message));
  page.on("console", m => { if(m.type() === "error") console.log("CONSOLE[" + tag + "]:", m.text()); });
  await page.goto("http://127.0.0.1:8321/index.html", { waitUntil:"load" });
  await page.waitForFunction(() => window.SF && window.SF.ui && window.SF.netcode, null, { timeout:15000 });
  await page.evaluate(({ pilot, colour }) => {
    const SF = window.SF;
    const p = SF.profile.blank(pilot);
    p.missionsVer = 99; p.money = 3000; p.shipColor = colour;
    p.upgrades = { gun:2, spread:1, engine:2 };
    SF.profile.save(p);
    SF.ui.renderProfiles();
    Array.from(document.querySelectorAll("#profileGrid .profile-card"))
      .find(c => new RegExp(pilot, "i").test(c.textContent)).click();
  }, { pilot, colour });
  return page;
}

const wait = (page, fn, ms) => page.waitForFunction(fn, null, { timeout: ms || 20000 });

(async () => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars",
           "--use-fake-ui-for-media-stream", "--allow-loopback-in-peer-connection"],
  });
  let bad = 0;
  const ok = (label, cond) => {
    console.log((cond ? "PASS  " : "FAIL  ") + label);
    if(!cond) bad++;
  };

  const A = await boot(browser, "Hostie", "#ff6b4a");    // the host
  const B = await boot(browser, "Guestie", "#3fc9ff");   // the guest

  // --- the handshake, driven through the real buttons ---
  // TWO DEVICES asks which pilot is on this tablet before host-or-join.
  await A.evaluate(() => {
    document.getElementById("netModeBtn").click();
    Array.from(document.querySelectorAll("#profileGrid .profile-card"))
      .find(c => /HOSTIE/i.test(c.textContent)).click();
    document.getElementById("netHostBtn").click();
  });
  await wait(A, () => window.SF.netcode.phase() === "waiting", 25000);
  const code = await A.evaluate(() => window.SF.netcode.code());
  ok("the host opens a room and gets a four-character code", /^[A-Z0-9]{4}$/.test(code));

  await B.evaluate(c => {
    document.getElementById("netModeBtn").click();
    Array.from(document.querySelectorAll("#profileGrid .profile-card"))
      .find(c2 => /GUESTIE/i.test(c2.textContent)).click();
    document.getElementById("netJoinBtn").click();
    document.getElementById("netCodeInput").value = c;
    document.getElementById("netJoinGo").click();
  }, code);

  await wait(A, () => window.SF.netcode.live(), 30000);
  await wait(B, () => window.SF.netcode.live(), 30000);
  ok("both devices report a live link",
    await A.evaluate(() => window.SF.netcode.live()) &&
    await B.evaluate(() => window.SF.netcode.live()));
  ok("each side knows who the other pilot is",
    /GUESTIE/i.test(await A.evaluate(() => JSON.stringify(window.SF.netcode.mate()))) &&
    /HOSTIE/i.test(await B.evaluate(() => JSON.stringify(window.SF.netcode.mate()))));

  // --- fly it ---
  const launch = page => page.evaluate(() => {
    window.SF.ui.show("screen-game");
    window.dispatchEvent(new Event("resize"));
    window.SF.game.startMission(1, "pilot");
    window.SF.game.godMode = true;
    window.dispatchEvent(new Event("resize"));
  });
  await launch(A);
  await launch(B);
  await A.waitForTimeout(2500);

  const seats = p => p.evaluate(() => (window.SF.game.world.players || [])
    .map(q => (q.acct && (q.acct.callsign || q.acct.name)) || "?"));
  const seatsA = await seats(A), seatsB = await seats(B);
  ok("the host is seat one on BOTH screens, so the two pictures agree",
    JSON.stringify(seatsA) === JSON.stringify(seatsB) &&
    /HOSTIE/i.test(seatsA[0] || "") && /GUESTIE/i.test(seatsA[1] || ""));

  // --- the guest's finger moves the host's seat two ---
  await B.evaluate(() => {
    const s = window.SF.input.state;
    s.dragging = true; s.dragX = window.SF.entityConst.VW * 0.88; s.dragY = 300;
  });
  await A.waitForTimeout(1500);
  const hostSeatTwoX = await A.evaluate(() => window.SF.game.world.players[1].x);
  const vw = await A.evaluate(() => window.SF.entityConst.VW);
  ok("the guest's stick flies seat two on the host (" + Math.round(hostSeatTwoX) +
     " of " + vw + ")", hostSeatTwoX > vw * 0.66);

  // --- and the host's world arrives on the guest's screen ---
  const hostWorld = await A.evaluate(() => ({
    enemies: window.SF.game.world.enemies.countAlive(),
    x0: Math.round(window.SF.game.world.players[0].x),
    x1: Math.round(window.SF.game.world.players[1].x),
    score: window.SF.game.run.score,
  }));
  const guestWorld = await B.evaluate(() => ({
    enemies: window.SF.game.world.enemies.countAlive(),
    x0: Math.round(window.SF.game.world.players[0].x),
    x1: Math.round(window.SF.game.world.players[1].x),
    score: window.SF.game.run.score,
    snapAge: Date.now() - window.SF.netcode._state.snapAt,
  }));
  console.log("  host :", JSON.stringify(hostWorld));
  console.log("  guest:", JSON.stringify(guestWorld));
  ok("the guest is being fed fresh snapshots", guestWorld.snapAge < 1500);
  ok("both ships are in the same place on both screens",
    Math.abs(hostWorld.x0 - guestWorld.x0) < 90 &&
    Math.abs(hostWorld.x1 - guestWorld.x1) < 90);
  ok("the host's enemies are on the guest's screen too",
    hostWorld.enemies > 0 && Math.abs(hostWorld.enemies - guestWorld.enemies) <= 4);
  ok("the guest never simulates: its score is the host's, not its own",
    guestWorld.score === hostWorld.score);

  // --- the far pilot banks their own flight ---
  const before = await B.evaluate(() => window.SF.profile.load("Guestie").money);
  await A.evaluate(() => {
    window.SF.game.world.players[1].purse = 250;
    window.SF.game.world.players[1].killsGot = 7;
    window.SF.game.endMission(true);
  });
  await B.waitForTimeout(1200);
  const after = await B.evaluate(() => {
    const q = window.SF.profile.load("Guestie");
    return { money: q.money, kills: q.totalKills, done: q.missionsCompleted };
  });
  console.log("  guest banked:", JSON.stringify(after), "(was " + before + ")");
  ok("the far pilot's coins land in the far pilot's own save",
    after.money >= before + 250 && after.kills >= 7 && after.done >= 1);

  console.log(bad ? "\nRESULT: FAIL (" + bad + ")" : "\nRESULT: PASS");
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
