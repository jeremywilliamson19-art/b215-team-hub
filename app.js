/* B215 Team Hub front end. Plain JS, no build step.
   Talks to the Apps Script web app at TEAM_CONFIG.API_URL.
   All user-supplied text is rendered with textContent, never innerHTML. */
(function () {
  "use strict";

  const API_URL = String((window.TEAM_CONFIG && window.TEAM_CONFIG.API_URL) || "").trim();
  const CONNECTED = /^https?:\/\//.test(API_URL) && !/PASTE_YOUR/.test(API_URL);
  const KEY_ME = "b215.me";       // localStorage: { player, editCode } for this device's family
  const KEY_COACH = "b215.coach"; // sessionStorage: coach code for this tab only
  const KEY_THEME = "b215.theme";
  const FALLBACK_ERROR = "Couldn't save. Try again.";
  const REFRESH_MS = 30000; // how often open pages pick up other people's changes

  const $ = (id) => document.getElementById(id);

  const S = {
    pub: null,       // public payload from the API
    pubKey: "",      // its JSON, to tell whether a background refresh changed anything
    me: null,        // this device's family: { player, editCode }
    coachCode: null,
    coachData: null,
    settingsFilled: false,
    rosterFilled: false,
    dlgGame: null,   // game the treat dialog is claiming; null when just entering a code
    loadedAt: 0
  };

  /* ------------------------------------------------------------ storage */

  // Storage can throw (private mode, blocked site data), so every access goes through these.
  function store(name) { try { return window[name]; } catch (e) { return null; } }
  function readStore(name, key) {
    try { return store(name).getItem(key); } catch (e) { return null; }
  }
  function readJSON(name, key) {
    try { const v = JSON.parse(readStore(name, key)); return v && typeof v === "object" ? v : null; } catch (e) { return null; }
  }
  function writeStore(name, key, value) {
    try {
      if (value == null) store(name).removeItem(key);
      else store(name).setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch (e) { /* the page still works for this visit */ }
  }

  /* ---------------------------------------------------------------- API */

  class ApiError extends Error {
    constructor(message, code) { super(message || ""); this.code = code || "network"; }
  }

  async function api(action, body) {
    if (!CONNECTED) throw new ApiError("The site isn't connected yet. Add the Apps Script URL to config.js.", "config");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      // POST uses text/plain so the browser sends a "simple" request with no CORS preflight.
      const res = action === "get"
        ? await fetch(API_URL, { cache: "no-store", signal: ctrl.signal })
        : await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(Object.assign({ action }, body)),
            signal: ctrl.signal
          });
      if (!res.ok) throw new ApiError("", "http");
      const json = await res.json();
      if (!json || json.ok !== true) throw new ApiError(json && json.error, json && json.code);
      return json.data;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("", "network");
    } finally {
      clearTimeout(timer);
    }
  }

  function errText(err, fallback) {
    return (err && err.message) || fallback || FALLBACK_ERROR;
  }

  /** Disables a button and swaps its label while an async call runs. */
  async function busy(btn, label, fn) {
    const prev = btn.textContent;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.textContent = label;
    try { return await fn(); }
    finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      if (btn.textContent === label) btn.textContent = prev;
    }
  }

  /* ------------------------------------------------------------ helpers */

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(cls, text, onClick, label) {
    const b = el("button", cls, text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }
  function setStatus(id, text, kind) {
    const s = $(id);
    s.textContent = text || "";
    s.className = "status" + (kind ? " " + kind : "");
  }
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function showBanner(msg, retry) {
    $("banner-text").textContent = msg;
    $("banner-retry").hidden = !retry;
    $("banner").hidden = false;
  }
  function hideBanner() { $("banner").hidden = true; }

  function pad(n) { return String(n).padStart(2, "0"); }
  function todayStr() { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function fmtTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    if (!m) return t || "";
    const h = +m[1];
    return ((h % 12) || 12) + ":" + m[2] + " " + (h >= 12 ? "PM" : "AM");
  }
  function fmtDay(s) {
    const d = parseDate(s);
    return d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  }
  function gameName(g) {
    return [g.opponent ? "vs " + g.opponent : "Game", fmtDay(g.date), fmtTime(g.time)].filter(Boolean).join(" · ");
  }
  /** "the B210 game on Sat, Oct 24 at 3:00 PM", for sentences. */
  function gameSentence(g) {
    return "the " + (g.opponent ? g.opponent + " game" : "game") +
      (g.date ? " on " + fmtDay(g.date) : "") + (g.time ? " at " + fmtTime(g.time) : "");
  }
  function lines(s) { return String(s || "").split("\n").map((x) => x.trim()).filter(Boolean); }
  function parseByes(s) {
    return lines(s).map((line) => {
      const m = /^(\d{4}-\d{2}-\d{2})\s*[-–—:·]?\s*(.*)$/.exec(line);
      return m ? { date: m[1], label: m[2] } : null;
    }).filter(Boolean);
  }
  function settings() { return (S.pub && S.pub.settings) || {}; }
  function treatLimit() { return Number(settings().treatsPerFamily) || 1; }
  function claimsFor(player) {
    return player && S.pub ? S.pub.games.filter((g) => g.treatPlayer === player).length : 0;
  }

  /* ------------------------------------------------------------- render */

  function renderHeader() {
    const c = settings();
    $("hdr-team").textContent = c.teamName || "B215";
    $("hdr-season").textContent = c.season || "";
    $("hdr-coach").textContent = c.coach || "";
    $("foot-team").textContent = (c.teamName || "B215") + " Team Hub";
    document.title = (c.teamName || "B215") + " Team Hub";

    const phone = c.coachPhone || "";
    $("hdr-phone-wrap").hidden = !phone;
    $("hdr-phone").textContent = phone;
    if (phone) $("hdr-phone").href = "tel:" + phone.replace(/[^\d+]/g, "");
    $("hdr-location-wrap").hidden = !c.location;
    $("hdr-location").textContent = c.location || "";

    const w = $("welcome-text");
    w.replaceChildren();
    String(c.welcome || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      .forEach((p) => w.appendChild(el("p", null, p)));

    const ul = $("expect-list");
    ul.replaceChildren();
    lines(c.expectations).forEach((s) => ul.appendChild(el("li", null, s)));

    const lim = treatLimit();
    $("treat-note").textContent = [c.treatNote, "Each family signs up for " + (lim === 1 ? "one game." : lim + " games.")]
      .filter(Boolean).join(" ");
  }

  /** "This device: X's family", or a way to enter an existing treat code. */
  function renderMeLine() {
    const line = $("me-line");
    line.replaceChildren();
    if (!S.pub) return;
    if (S.me) {
      const t = el("span", null, "This device: ");
      t.appendChild(el("b", null, S.me.player + "'s family"));
      line.append(t, btn("btn-link", "Not you?", forgetMe));
    } else {
      line.append(el("span", null, "Signed up on another device?"), btn("btn-link", "Enter your treat code", () => openTreatDialog(null)));
    }
  }

  function renderGames() {
    const box = $("games");
    box.setAttribute("aria-busy", "false");
    box.replaceChildren();
    const games = (S.pub && S.pub.games) || [];
    const byes = parseByes(settings().byes);
    if (!games.length && !byes.length) {
      box.appendChild(el("div", "empty", "The game schedule is coming soon. Check back shortly."));
      return;
    }

    const today = todayStr();
    const me = S.me && S.me.player;
    const full = me && claimsFor(me) >= treatLimit();
    const nextGame = games.find((g) => g.date >= today);
    const items = games.map((g) => ({ kind: "game", date: g.date, time: g.time, g }))
      .concat(byes.map((b) => ({ kind: "bye", date: b.date, time: "", b })))
      .sort((a, b) => ((a.date || "9") + (a.time || "")).localeCompare((b.date || "9") + (b.time || "")));

    items.forEach((item) => {
      const past = item.date && item.date < today;
      const row = el("div", "game" + (past ? " past" : "") + (item.kind === "bye" ? " bye" : "") +
        (item.g && item.g === nextGame ? " next" : ""));
      row.appendChild(dateBlock(item.date));

      const info = el("div", "ginfo");
      const tr = el("div", "treat");

      if (item.kind === "bye") {
        info.appendChild(el("div", "opp", "No game" + (item.b.label ? " · " + item.b.label : "")));
        info.appendChild(el("div", "gsub", "Bye week"));
        row.append(info, tr);
        box.appendChild(row);
        return;
      }

      const g = item.g;
      if (g === nextGame) info.appendChild(el("div", "next-tag", "Next game"));
      const opp = el("div", "opp", g.opponent ? "vs " + g.opponent : "Game");
      if (g.homeAway) opp.appendChild(el("span", "ha" + (g.homeAway === "Home" ? " home" : ""), g.homeAway));
      info.appendChild(opp);
      const sub = [fmtTime(g.time), g.court].filter(Boolean).join(" · ");
      if (sub) info.appendChild(el("div", "gsub", sub));

      const label = gameName(g);
      if (g.treatPlayer && g.treatPlayer === me) {
        tr.appendChild(el("span", "mine", past ? "You brought treats" : "You're bringing treats"));
        if (!past) tr.appendChild(btn("btn-link", "Cancel", (e) => releaseTreat(g, e.currentTarget), "Cancel my treat signup for " + label));
      } else if (g.treatPlayer) {
        const t = el("span", "taken", "Treats: ");
        t.appendChild(el("b", null, g.treatPlayer + "'s family"));
        tr.appendChild(t);
      } else if (!past) {
        tr.appendChild(btn(full ? "btn-ghost" : "btn-primary", "Bring treats", (e) => bringTreats(g, e.currentTarget), "Bring treats for " + label));
      } else {
        tr.appendChild(el("span", "taken", "No treat signup"));
      }

      if (S.coachCode) {
        if (g.treatPlayer) tr.appendChild(btn("btn-link danger", "Clear treats", (e) => coachClearTreat(g, e.currentTarget), "Clear treat claim for " + label));
        tr.appendChild(btn("btn-link danger", "Remove game", (e) => removeGame(g, e.currentTarget), "Remove " + label));
      }

      row.append(info, tr);
      box.appendChild(row);
    });
  }

  function dateBlock(dateStr) {
    const d = parseDate(dateStr);
    const box = el("div", "date");
    box.appendChild(el("div", "dow", d ? d.toLocaleDateString("en-US", { weekday: "short" }) : "TBD"));
    box.appendChild(el("div", "day", d ? String(d.getDate()) : "–"));
    box.appendChild(el("div", "mon", d ? d.toLocaleDateString("en-US", { month: "short" }) : ""));
    if (d) box.setAttribute("aria-label", d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }));
    return box;
  }

  function renderAllergies() {
    const list = $("allergy-list");
    list.replaceChildren();
    const allergies = (S.pub && S.pub.allergies) || [];
    if (!allergies.length) {
      list.appendChild(el("div", "empty", "No allergies listed yet. Text Coach if your player has one."));
      return;
    }
    allergies.forEach((a) => {
      const r = el("div", "allergy");
      r.appendChild(el("div", "who", a.player));
      r.appendChild(el("div", "what", a.allergies));
      list.appendChild(r);
    });
  }

  function renderAll() {
    renderHeader();
    renderMeLine();
    renderGames();
    renderAllergies();
  }

  function applyPublic(pub) {
    if (!pub) return;
    S.pub = pub;
    S.pubKey = JSON.stringify(pub);
    S.loadedAt = Date.now();
    // A player removed from the roster can't claim anymore; drop them from this device.
    if (S.me && pub.roster.indexOf(S.me.player) < 0) setMe(null);
    hideBanner();
    // Re-rendering replaces the schedule buttons, so put keyboard focus back where it was.
    const active = document.activeElement;
    const focusLabel = active && $("games").contains(active) ? active.getAttribute("aria-label") : null;
    renderAll();
    if (focusLabel) {
      const again = [...$("games").querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === focusLabel);
      if (again) again.focus({ preventScroll: true });
    }
  }

  function setMe(me) {
    S.me = me;
    writeStore("localStorage", KEY_ME, me);
  }

  function forgetMe() {
    setMe(null);
    renderAll();
    toast("This device no longer remembers your family");
  }

  /* -------------------------------------------------------------- loads */

  async function loadPublic(quiet) {
    try {
      const pub = await api("get");
      if (quiet) {
        // Background refresh: skip when nothing changed, or while a schedule button is
        // mid-action (armed for a second tap or saving), so we don't yank it away.
        if (JSON.stringify(pub) === S.pubKey) { S.loadedAt = Date.now(); return; }
        if ($("games").querySelector('[data-armed="1"], [aria-busy="true"]')) return;
      }
      applyPublic(pub);
    } catch (err) {
      if (quiet) return;
      $("games").setAttribute("aria-busy", "false");
      const msg = err.code === "config" ? err.message : "Couldn't load the team info. Check your connection and try again.";
      showBanner(msg, err.code !== "config");
      if (!S.pub) {
        $("games").replaceChildren(el("div", "empty", "Schedule unavailable right now."));
        $("allergy-list").replaceChildren(el("div", "empty", "Allergy list unavailable right now."));
        $("welcome-text").replaceChildren();
      }
    }
  }

  /* -------------------------------------------------------------- treats */

  function bringTreats(g, button) {
    if (!S.me) { openTreatDialog(g); return; }
    const mine = claimsFor(S.me.player);
    if (mine >= treatLimit()) {
      toast("You're already signed up for " + mine + " game" + (mine === 1 ? "" : "s") + ". Cancel one to switch.");
      return;
    }
    busy(button, "Saving…", async () => {
      try {
        const data = await api("claimTreat", { gameId: g.id, player: S.me.player, editCode: S.me.editCode });
        applyPublic(data.public);
        toast("You're on treats for " + gameSentence(g) + ". Thank you!");
      } catch (err) {
        if (err.code === "auth" || err.code === "needs_code") {
          // The saved code no longer works (the coach may have reset it). Ask again.
          setMe(null);
          renderAll();
          openTreatDialog(g);
          setStatus("td-status", "Enter your treat code again.", "err");
          return;
        }
        toast(errText(err));
        if (err.code === "taken") loadPublic(true);
      }
    });
  }

  /** Opens the treat dialog. With a game it claims that game; with null it just links a code to this device. */
  function openTreatDialog(g) {
    S.dlgGame = g;
    const roster = (S.pub && S.pub.roster) || [];
    const sel = $("td-player");
    sel.replaceChildren(new Option("Choose your player…", ""));
    roster.forEach((p) => sel.appendChild(new Option(p, p)));
    $("td-title").textContent = g ? "Bring treats" : "Enter your treat code";
    $("td-game").textContent = g ? gameName(g) + (g.court ? " · " + g.court : "")
      : "Use the code you got the first time you signed up for treats, so you can manage your game from this device.";
    $("td-submit").textContent = g ? "Sign up" : "Use code";
    $("td-code").value = "";
    $("td-code-field").hidden = !!g;
    setStatus("td-status", "");
    $("td-form").hidden = false;
    $("td-done").hidden = true;
    const dlg = $("treat-dlg");
    if (!dlg.open) dlg.showModal();
    sel.focus();
  }

  async function submitTreatDialog(e) {
    e.preventDefault();
    const g = S.dlgGame;
    const player = $("td-player").value;
    const needCode = !$("td-code-field").hidden;
    const code = $("td-code").value.trim().toUpperCase();
    if (!player) { setStatus("td-status", "Choose your player.", "err"); $("td-player").focus(); return; }
    if (needCode && !/^[A-Z0-9]{6}$/.test(code)) {
      setStatus("td-status", "Treat codes are 6 letters and numbers.", "err");
      $("td-code").focus();
      return;
    }

    setStatus("td-status", g ? "Saving…" : "Checking…");
    await busy($("td-submit"), g ? "Saving…" : "Checking…", async () => {
      try {
        if (!g) {
          await api("checkCode", { player, editCode: code });
          setMe({ player, editCode: code });
          renderAll();
          $("treat-dlg").close();
          toast("This device now knows you're " + player + "'s family");
          return;
        }
        const data = await api("claimTreat", { gameId: g.id, player, editCode: needCode ? code : "" });
        applyPublic(data.public);
        if (data.editCode) {
          setMe({ player, editCode: data.editCode });
          renderAll();
          showTreatCode(g, data.editCode);
        } else {
          setMe({ player, editCode: code });
          renderAll();
          $("treat-dlg").close();
          toast("You're on treats for " + gameSentence(g) + ". Thank you!");
        }
      } catch (err) {
        if (err.code === "needs_code") {
          $("td-code-field").hidden = false;
          setStatus("td-status", player + "'s family already has a treat code. Enter it to sign up.", "err");
          $("td-code").focus();
          return;
        }
        setStatus("td-status", errText(err), "err");
        if (err.code === "taken") loadPublic(true);
      }
    });
  }

  function showTreatCode(g, code) {
    $("td-form").hidden = true;
    $("td-done").hidden = false;
    $("td-done-game").textContent = "You're bringing treats to " + gameSentence(g) + ". Thank you!";
    $("td-done-code").textContent = code;
    $("td-done-title").focus();
  }

  async function releaseTreat(g, button) {
    if (!confirmTap(button, "Tap again to cancel")) return;
    await busy(button, "Canceling…", async () => {
      try {
        const data = await api("releaseTreat", { gameId: g.id, player: S.me.player, editCode: S.me.editCode });
        applyPublic(data.public);
        toast("Treat signup canceled");
      } catch (err) {
        toast(errText(err));
      }
    });
  }

  /** First tap arms a destructive button for 3 seconds; second tap confirms. */
  function confirmTap(button, armedText) {
    if (button.dataset.armed === "1") return true;
    const prev = button.textContent;
    button.dataset.armed = "1";
    button.textContent = armedText;
    setTimeout(() => {
      if (button.isConnected && button.dataset.armed === "1") { button.dataset.armed = ""; button.textContent = prev; }
    }, 3000);
    return false;
  }

  /* --------------------------------------------------------------- coach */

  function routeCoach() {
    const wantCoach = location.hash === "#coach";
    $("coach").hidden = !S.coachCode;
    $("coach-login").hidden = !(wantCoach && !S.coachCode);
    $("coach-link").textContent = S.coachCode ? "Coach tools" : "Coach login";
    if (wantCoach) {
      const target = S.coachCode ? $("coach") : $("coach-login");
      requestAnimationFrame(() => {
        target.scrollIntoView();
        if (!S.coachCode) $("c-code").focus({ preventScroll: true });
      });
    }
  }

  async function coachLogin(e) {
    e.preventDefault();
    const code = $("c-code").value.trim();
    if (!code) { setStatus("c-status", "Enter the coach code.", "err"); $("c-code").focus(); return; }
    setStatus("c-status", "Checking…");
    await busy($("c-btn"), "Checking…", async () => {
      try {
        const data = await api("coachData", { coachCode: code });
        S.coachCode = code;
        writeStore("sessionStorage", KEY_COACH, code);
        $("c-code").value = "";
        setStatus("c-status", "");
        applyCoachData(data);
        routeCoach();
        $("coach").focus({ preventScroll: true });
      } catch (err) {
        setStatus("c-status", errText(err, "Couldn't check the code. Try again."), "err");
      }
    });
  }

  async function refreshCoach() {
    if (!S.coachCode) return;
    try {
      applyCoachData(await api("coachData", { coachCode: S.coachCode }));
    } catch (err) {
      if (err.code === "auth") { coachSignOut(); setStatus("c-status", errText(err), "err"); }
      else toast("Couldn't refresh coach data. Try again.");
    }
  }

  function applyCoachData(data) {
    S.coachData = data;
    applyPublic(data.public);
    if (!S.rosterFilled) fillRosterEditor(data.roster);
    if (!S.settingsFilled) fillSettingsForm();
  }

  function coachSignOut() {
    S.coachCode = null;
    S.coachData = null;
    S.settingsFilled = false;
    S.rosterFilled = false;
    writeStore("sessionStorage", KEY_COACH, null);
    $("roster-rows").replaceChildren();
    renderGames();
    routeCoach();
  }

  /* Roster & allergies editor: one row per player, saved together. */

  function fillRosterEditor(roster) {
    const box = $("roster-rows");
    box.replaceChildren();
    roster.forEach((r) => box.appendChild(rosterRow(r)));
    S.rosterFilled = true;
  }

  function rosterRow(r) {
    const row = el("div", "roster-row");
    const name = el("input", "r-name");
    name.maxLength = 60;
    name.value = r.player || "";
    const allergy = el("input", "r-allergy");
    allergy.maxLength = 300;
    allergy.value = r.allergies || "";
    allergy.placeholder = "Allergies (blank if none)";
    const code = el("span", "mono", r.editCode || "");
    if (r.editCode) code.setAttribute("aria-label", "Treat code " + r.editCode.split("").join(" "));
    const remove = btn("btn-link danger", "Remove", () => {
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      setStatus("r-status", "Removed. Save roster to keep the change.");
      (next ? next.querySelector("input") : $("r-add")).focus();
    });
    const syncLabels = () => {
      const who = name.value.trim() || "new player";
      name.setAttribute("aria-label", "Player name");
      allergy.setAttribute("aria-label", "Allergies for " + who);
      remove.setAttribute("aria-label", "Remove " + who);
    };
    name.addEventListener("input", syncLabels);
    syncLabels();
    row.append(name, allergy, code, remove);
    return row;
  }

  async function saveRoster(e) {
    e.preventDefault();
    const rows = [...$("roster-rows").querySelectorAll(".roster-row")].map((row) => ({
      player: row.querySelector(".r-name").value.trim(),
      allergies: row.querySelector(".r-allergy").value.trim()
    })).filter((r) => r.player);
    if (!rows.length) { setStatus("r-status", "The roster needs at least one player.", "err"); return; }
    const seen = new Set();
    const dup = rows.find((r) => { const k = r.player.toLowerCase(); if (seen.has(k)) return true; seen.add(k); return false; });
    if (dup) { setStatus("r-status", dup.player + " is listed twice.", "err"); return; }

    setStatus("r-status", "Saving…");
    await busy($("r-btn"), "Saving…", async () => {
      try {
        applyPublic((await api("saveRoster", { coachCode: S.coachCode, roster: rows })).public);
        S.rosterFilled = false;
        await refreshCoach();
        setStatus("r-status", "Saved.", "ok");
        toast("Roster saved");
      } catch (err) {
        setStatus("r-status", errText(err), "err");
      }
    });
  }

  function fillSettingsForm() {
    const c = settings();
    $("s-team").value = c.teamName || "";
    $("s-season").value = c.season || "";
    $("s-coach").value = c.coach || "";
    $("s-phone").value = c.coachPhone || "";
    $("s-location").value = c.location || "";
    $("s-welcome").value = c.welcome || "";
    $("s-expect").value = c.expectations || "";
    $("s-limit").value = c.treatsPerFamily || 1;
    $("s-treatnote").value = c.treatNote || "";
    $("s-byes").value = c.byes || "";
    S.settingsFilled = true;
  }

  async function saveSettings(e) {
    e.preventDefault();
    const badBye = lines($("s-byes").value).find((l) => !/^\d{4}-\d{2}-\d{2}\b/.test(l));
    if (badBye) { setStatus("s-status", "Start each bye line with a date like 2026-10-31.", "err"); $("s-byes").focus(); return; }
    const body = {
      coachCode: S.coachCode,
      settings: {
        teamName: $("s-team").value.trim(), season: $("s-season").value.trim(), coach: $("s-coach").value.trim(),
        coachPhone: $("s-phone").value.trim(), location: $("s-location").value.trim(), welcome: $("s-welcome").value.trim(),
        expectations: $("s-expect").value.trim(),
        treatsPerFamily: $("s-limit").value, treatNote: $("s-treatnote").value.trim(), byes: $("s-byes").value.trim()
      }
    };
    setStatus("s-status", "Saving…");
    await busy($("s-btn"), "Saving…", async () => {
      try {
        applyPublic((await api("saveSettings", body)).public);
        fillSettingsForm();
        setStatus("s-status", "Saved.", "ok");
        toast("Team details saved");
      } catch (err) {
        setStatus("s-status", errText(err), "err");
      }
    });
  }

  async function addGame(e) {
    e.preventDefault();
    const game = {
      date: $("g-date").value, time: $("g-time").value, opponent: $("g-opp").value.trim(),
      court: $("g-court").value.trim(), homeAway: $("g-ha").value
    };
    if (!game.date) { setStatus("g-status", "Pick a date.", "err"); $("g-date").focus(); return; }
    if (!game.opponent) { setStatus("g-status", "Add the opponent.", "err"); $("g-opp").focus(); return; }
    setStatus("g-status", "Adding…");
    await busy($("g-btn"), "Adding…", async () => {
      try {
        applyPublic((await api("addGame", { coachCode: S.coachCode, game })).public);
        setStatus("g-status", "Added.", "ok");
        ["g-date", "g-time", "g-opp", "g-court", "g-ha"].forEach((id) => { $(id).value = ""; });
        $("g-date").focus();
      } catch (err) {
        setStatus("g-status", errText(err), "err");
      }
    });
  }

  async function removeGame(g, button) {
    if (!confirmTap(button, "Tap again to remove")) return;
    await busy(button, "Removing…", async () => {
      try {
        applyPublic((await api("removeGame", { coachCode: S.coachCode, gameId: g.id })).public);
        toast("Game removed");
      } catch (err) {
        toast(errText(err, "Couldn't remove the game. Try again."));
      }
    });
  }

  async function coachClearTreat(g, button) {
    if (!confirmTap(button, "Tap again to clear")) return;
    await busy(button, "Clearing…", async () => {
      try {
        applyPublic((await api("releaseTreat", { coachCode: S.coachCode, gameId: g.id })).public);
        toast("Treat claim cleared");
      } catch (err) {
        toast(errText(err, "Couldn't clear it. Try again."));
      }
    });
  }

  /* --------------------------------------------------------------- theme */

  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    const label = mode === "light" ? "Light" : mode === "dark" ? "Dark" : "Auto";
    $("theme-btn").textContent = label;
    $("theme-btn").setAttribute("aria-label", "Color theme: " + label.toLowerCase() + ". Change theme");
  }
  function cycleTheme() {
    const cur = readStore("localStorage", KEY_THEME) || "auto";
    const next = cur === "auto" ? "light" : cur === "light" ? "dark" : "auto";
    writeStore("localStorage", KEY_THEME, next === "auto" ? null : next);
    applyTheme(next);
  }

  /* ---------------------------------------------------------------- init */

  $("td-form").addEventListener("submit", submitTreatDialog);
  $("td-cancel").addEventListener("click", () => $("treat-dlg").close());
  $("td-close").addEventListener("click", () => $("treat-dlg").close());
  $("td-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("td-done-code").textContent); toast("Code copied"); }
    catch (e) { toast("Couldn't copy. Write the code down instead."); }
  });
  $("login-form").addEventListener("submit", coachLogin);
  $("coach-out").addEventListener("click", coachSignOut);
  $("roster-form").addEventListener("submit", saveRoster);
  $("r-add").addEventListener("click", () => {
    const row = rosterRow({});
    $("roster-rows").appendChild(row);
    row.querySelector("input").focus();
  });
  $("game-form").addEventListener("submit", addGame);
  $("set-form").addEventListener("submit", saveSettings);
  $("banner-retry").addEventListener("click", (e) => busy(e.currentTarget, "Loading…", () => loadPublic(false)));
  $("theme-btn").addEventListener("click", cycleTheme);
  window.addEventListener("hashchange", routeCoach);
  // Keep every open page current with everyone else's changes: refresh every 30 seconds
  // while the page is visible, and right away when someone comes back to the tab.
  let refreshing = false;
  async function backgroundRefresh(minAge) {
    if (refreshing || !S.pub || document.visibilityState !== "visible" || Date.now() - S.loadedAt < minAge) return;
    refreshing = true;
    try { await loadPublic(true); } finally { refreshing = false; }
  }
  setInterval(() => backgroundRefresh(REFRESH_MS - 1000), REFRESH_MS);
  document.addEventListener("visibilitychange", () => backgroundRefresh(5000));
  window.addEventListener("focus", () => backgroundRefresh(5000));

  applyTheme(readStore("localStorage", KEY_THEME) || "auto");
  const saved = readJSON("localStorage", KEY_ME);
  if (saved && typeof saved.player === "string" && typeof saved.editCode === "string") S.me = saved;
  S.coachCode = readStore("sessionStorage", KEY_COACH);

  (async function start() {
    await loadPublic(false);
    routeCoach();
    if (S.pub) await refreshCoach();
  })();
})();
