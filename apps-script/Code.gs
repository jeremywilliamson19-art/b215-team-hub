/**
 * B215 Team Hub: Google Apps Script backend.
 *
 * Bind this script to a Google Sheet (Extensions > Apps Script), run setup()
 * once, add a COACH_CODE script property, then deploy as a web app.
 * See README.md for the full walkthrough.
 *
 * Parents never log in. The first time a family claims a treat game for their
 * player, they get a random 6-character treat code; changing that family's
 * claims later needs the code. The coach code (Script Properties) can do anything.
 */

var TABS = {
  settings: { name: 'Settings', headers: ['key', 'value'] },
  games: { name: 'Games', headers: ['id', 'date', 'time', 'opponent', 'court', 'homeAway', 'treatPlayer'] },
  roster: { name: 'Roster', headers: ['player', 'allergies'] },
  // One row per player whose family has claimed treats: the code that lets them change it.
  families: { name: 'Families', headers: ['player', 'editCode', 'createdAt'] }
};

var LIMITS = {
  player: 60, allergies: 300, editCode: 10,
  opponent: 60, court: 40,
  teamName: 60, season: 120, coach: 80, coachPhone: 30, location: 120, welcome: 2000,
  expectations: 2000, treatNote: 400, byes: 1000
};

var SETTING_KEYS = ['teamName', 'season', 'coach', 'coachPhone', 'location', 'welcome', 'expectations',
  'treatsPerFamily', 'treatNote', 'byes'];

var MAX_ROSTER = 30;
var MAX_BODY = 20000;
var EDIT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
var COACH_FAIL_LIMIT = 20; // failed coach-code attempts allowed per 10 minutes

var SEED = {
  settings: {
    teamName: 'B215',
    season: '2026 Junior Jazz · 2nd Grade Boys',
    coach: 'Jeremy Williamson',
    coachPhone: '801-897-6855',
    location: 'J.L. Sorenson Recreation Center',
    welcome: "Welcome to the team! I'm excited to coach these boys this season. Our goals are simple: get better every week, play hard, be great teammates, and have fun.\n\n" +
      'Please grab a game below to bring treats, and text me about any allergies so I can add them to the list.',
    expectations: [
      'All games are on Saturdays at the J.L. Sorenson Recreation Center. Check the court number for each game.',
      'Arrive 15 minutes before tip-off, dressed and ready to warm up.',
      'Bring a water bottle and your jersey to every game.',
      'Every player gets playing time. Effort and listening at practice matter most.',
      'Cheer for everyone. Let the coaches coach and the refs ref.',
      'If your player will miss a practice or game, text Coach as early as you can.'
    ].join('\n'),
    treatsPerFamily: '1',
    treatNote: 'The treat family brings a drink and a simple snack for every player after the game. Please check the allergy list first.',
    byes: '2026-10-31 Halloween\n2026-11-28 Thanksgiving'
  },
  // date, time (24h), opponent, court, home/away
  games: [
    ['2026-10-24', '15:00', 'B210', 'Court 3', 'Home'],
    ['2026-11-07', '17:00', 'B219', 'Court 1A', 'Away'],
    ['2026-11-14', '16:00', 'B222', 'Court 1B', 'Away'],
    ['2026-11-21', '17:00', 'B208', 'Court 2', 'Home'],
    ['2026-12-05', '16:00', 'B206', 'Court 1A', 'Home'],
    ['2026-12-12', '15:00', 'B216', 'Court 2', 'Home'],
    ['2026-12-19', '15:00', 'B220', 'Court 1B', 'Away']
  ]
};

/**
 * Player names stay out of this public file. Paste Roster.gs (kept only on the
 * coach's computer) into the Apps Script project as a second file before running
 * setup(), or add players later in the coach view.
 */
function seedRoster_() {
  return typeof LOCAL_ROSTER !== 'undefined' && Array.isArray(LOCAL_ROSTER) ? LOCAL_ROSTER : [];
}

/* ------------------------------------------------------------------ setup */

/** Run once from the Apps Script editor. Safe to re-run: it only seeds empty tabs. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (k) { ensureTab_(ss, TABS[k]); });

  if (sheet_('settings').getLastRow() < 2) {
    appendRows_('settings', Object.keys(SEED.settings).map(function (k) { return [k, SEED.settings[k]]; }));
  }
  if (sheet_('games').getLastRow() < 2) {
    appendRows_('games', SEED.games.map(function (g) { return [newId_('g'), g[0], g[1], g[2], g[3], g[4], '']; }));
  }
  if (sheet_('roster').getLastRow() < 2 && seedRoster_().length) {
    appendRows_('roster', seedRoster_().map(function (p) { return [p, '']; }));
  }
  if (!PropertiesService.getScriptProperties().getProperty('COACH_CODE')) {
    Logger.log('Setup done. Next: Project Settings > Script Properties > add COACH_CODE.');
  } else {
    Logger.log('Setup done.');
  }
}

function ensureTab_(ss, tab) {
  var sh = ss.getSheetByName(tab.name) || ss.insertSheet(tab.name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, tab.headers.length).setValues([tab.headers]);
    sh.getRange(1, 1, 1, tab.headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ------------------------------------------------------------- web entry */

function doGet() {
  try {
    return json_({ ok: true, data: publicData_() });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: null });
  }
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > MAX_BODY) throw userError_('Bad request.');
    var body;
    try { body = JSON.parse(raw); } catch (_) { throw userError_('Bad request.'); }
    if (!body || typeof body !== 'object') throw userError_('Bad request.');
    var handler = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!handler) throw userError_('Unknown action.');
    return json_({ ok: true, data: handler(body) });
  } catch (err) {
    if (err && err.userMessage) return json_({ ok: false, error: err.userMessage, code: err.code || 'invalid' });
    console.error(err);
    return json_({ ok: false, error: null, code: 'server' });
  }
}

var ACTIONS = {
  claimTreat: claimTreat_,
  releaseTreat: releaseTreat_,
  checkCode: checkCode_,
  coachData: coachData_,
  saveSettings: saveSettings_,
  saveRoster: saveRoster_,
  addGame: addGame_,
  removeGame: removeGame_
};

/* --------------------------------------------------------------- actions */

/**
 * Claims a game's treat slot for a player's family. The first claim for a player
 * creates their treat code and returns it once; later claims need that code.
 */
function claimTreat_(body) {
  var player = clean_(body.player, LIMITS.player);
  return withLock_(function () {
    // Everything is re-read inside the lock so two families can't take the same slot.
    if (rosterNames_().indexOf(player) < 0) throw userError_('Pick your player from the list.');
    var games = read_('games');
    var game = findGame_(games, body.gameId);
    if (game.date && game.date < today_()) throw userError_('That game has already been played.');
    if (game.treatPlayer === player) return { player: player, public: publicData_() };
    if (game.treatPlayer) throw userError_('Another family just took that game.', 'taken');

    var coach = !!body.coachCode && checkCoach_(body.coachCode);
    var fam = familyFor_(player);
    var newCode = '';
    if (fam) {
      if (!coach) authorize_(fam, body.editCode);
    } else {
      newCode = newEditCode_();
    }

    var limit = settings_().treatsPerFamily;
    var mine = games.filter(function (g) { return g.treatPlayer === player; }).length;
    if (mine >= limit && !coach) {
      throw userError_(player + "'s family is already bringing treats for " + mine + ' game' + (mine === 1 ? '' : 's') +
        '. Cancel one to switch.', 'limit');
    }

    if (newCode) appendRows_('families', [[player, newCode, new Date().toISOString()]]);
    game.treatPlayer = player;
    writeRow_('games', game._row, game);
    var out = { player: player, public: publicData_() };
    if (newCode) out.editCode = newCode;
    return out;
  });
}

function releaseTreat_(body) {
  return withLock_(function () {
    var game = findGame_(read_('games'), body.gameId);
    if (body.coachCode) {
      requireCoach_(body);
    } else {
      var player = clean_(body.player, LIMITS.player);
      if (!game.treatPlayer || game.treatPlayer !== player) throw userError_("That treat slot isn't yours to cancel.", 'auth');
      var fam = familyFor_(player);
      if (!fam) throw userError_("That treat slot isn't yours to cancel.", 'auth');
      authorize_(fam, body.editCode);
    }
    game.treatPlayer = '';
    writeRow_('games', game._row, game);
    return { public: publicData_() };
  });
}

/** Lets a family use their treat code on a new device. */
function checkCode_(body) {
  var player = clean_(body.player, LIMITS.player);
  var fam = familyFor_(player);
  if (!fam) throw userError_(player ? player + "'s family doesn't have a treat code yet. Just tap Bring treats." : 'Pick your player.', 'not_found');
  authorize_(fam, body.editCode);
  return { player: player };
}

function coachData_(body) {
  requireCoach_(body);
  var codes = {};
  read_('families').forEach(function (f) { codes[f.player] = f.editCode; });
  return {
    roster: read_('roster').map(function (r) {
      return { player: r.player, allergies: r.allergies, editCode: codes[r.player] || '' };
    }),
    public: publicData_()
  };
}

function saveSettings_(body) {
  requireCoach_(body);
  var input = body.settings && typeof body.settings === 'object' ? body.settings : {};
  var clean = {};
  SETTING_KEYS.forEach(function (k) {
    if (!(k in input)) return;
    if (k === 'treatsPerFamily') {
      var n = parseInt(input[k], 10);
      clean[k] = String(isNaN(n) ? 1 : Math.max(1, Math.min(10, n)));
    } else {
      clean[k] = clean_(input[k], LIMITS[k], true);
    }
  });
  if (clean.teamName === '') delete clean.teamName;

  return withLock_(function () {
    var rows = read_('settings');
    Object.keys(clean).forEach(function (k) {
      var row = rows.filter(function (r) { return r.key === k; })[0];
      if (row) writeRow_('settings', row._row, { key: k, value: clean[k] });
      else appendRows_('settings', [[k, clean[k]]]);
    });
    return { public: publicData_() };
  });
}

/** Replaces the roster: [{ player, allergies }]. */
function saveRoster_(body) {
  requireCoach_(body);
  if (!Array.isArray(body.roster)) throw userError_('Bad request.');
  var seen = {};
  var rows = [];
  body.roster.forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    var name = clean_(r.player, LIMITS.player);
    if (!name || seen[name.toLowerCase()] || rows.length >= MAX_ROSTER) return;
    seen[name.toLowerCase()] = true;
    rows.push([name, clean_(r.allergies, LIMITS.allergies)]);
  });
  if (!rows.length) throw userError_('The roster needs at least one player.');

  return withLock_(function () {
    var sh = sheet_('roster');
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    appendRows_('roster', rows);
    return { public: publicData_() };
  });
}

function addGame_(body) {
  requireCoach_(body);
  var g = body.game && typeof body.game === 'object' ? body.game : {};
  var date = clean_(g.date, 10);
  if (!isDate_(date)) throw userError_('Pick a valid date.');
  var time = clean_(g.time, 5);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw userError_('Pick a valid tip-off time.');
  var opponent = clean_(g.opponent, LIMITS.opponent);
  if (!opponent) throw userError_('Add the opponent.');
  var homeAway = ['Home', 'Away'].indexOf(g.homeAway) >= 0 ? g.homeAway : '';
  var game = {
    id: newId_('g'), date: date, time: time, opponent: opponent,
    court: clean_(g.court, LIMITS.court), homeAway: homeAway, treatPlayer: ''
  };
  return withLock_(function () {
    appendRows_('games', [rowFrom_('games', game)]);
    return { public: publicData_() };
  });
}

function removeGame_(body) {
  requireCoach_(body);
  return withLock_(function () {
    var game = findGame_(read_('games'), body.gameId);
    sheet_('games').deleteRow(game._row);
    return { public: publicData_() };
  });
}

/* ------------------------------------------------------------ public view */

function publicData_() {
  var roster = read_('roster');
  return {
    settings: settings_(),
    games: read_('games').sort(byDateTime_).map(function (g) {
      return {
        id: g.id, date: g.date, time: g.time, opponent: g.opponent, court: g.court,
        homeAway: g.homeAway, treatPlayer: g.treatPlayer
      };
    }),
    roster: roster.map(function (r) { return r.player; }).filter(Boolean),
    allergies: roster
      .filter(function (r) { return r.player && r.allergies; })
      .sort(function (a, b) { return a.player.localeCompare(b.player); })
      .map(function (r) { return { player: r.player, allergies: r.allergies }; })
  };
}

function settings_() {
  var out = {};
  SETTING_KEYS.forEach(function (k) { out[k] = SEED.settings[k]; });
  read_('settings').forEach(function (r) { if (SETTING_KEYS.indexOf(r.key) >= 0) out[r.key] = r.value; });
  var n = parseInt(out.treatsPerFamily, 10);
  out.treatsPerFamily = isNaN(n) ? 1 : Math.max(1, Math.min(10, n));
  return out;
}

function rosterNames_() {
  return read_('roster').map(function (r) { return r.player; }).filter(Boolean);
}

function familyFor_(player) {
  if (!player) return null;
  return read_('families').filter(function (f) { return f.player === player; })[0] || null;
}

/* ------------------------------------------------------------ auth helpers */

/** Checks a family's treat code. Throws needs_code when none was sent, auth when it's wrong. */
function authorize_(fam, code) {
  code = clean_(code, LIMITS.editCode).toUpperCase();
  if (!code) throw userError_('Enter the treat code for ' + fam.player + "'s family.", 'needs_code');
  if (fam.editCode && code === String(fam.editCode).toUpperCase()) return;
  Utilities.sleep(800);
  throw userError_("That treat code doesn't match.", 'auth');
}

function requireCoach_(body) {
  if (!checkCoach_(body.coachCode)) throw userError_("That coach code doesn't match.", 'auth');
}

function checkCoach_(code) {
  var expected = PropertiesService.getScriptProperties().getProperty('COACH_CODE');
  if (!expected) throw userError_('Coach code is not set up yet. Add COACH_CODE in Script Properties.', 'auth');
  var cache = CacheService.getScriptCache();
  var fails = parseInt(cache.get('coachFails') || '0', 10);
  if (fails >= COACH_FAIL_LIMIT) throw userError_('Too many wrong coach codes. Try again in 10 minutes.', 'auth');
  if (typeof code === 'string' && code.trim() !== '' && code.trim() === expected.trim()) return true;
  cache.put('coachFails', String(fails + 1), 600);
  Utilities.sleep(800);
  return false;
}

/* ------------------------------------------------------------- validation */

/** Trims, strips control characters and caps length. Newlines survive only when multiline is true. */
function clean_(v, max, multiline) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  s = multiline
    ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return s.trim().slice(0, max || 200).trim();
}

function isDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}

function userError_(message, code) {
  var err = new Error(message);
  err.userMessage = message;
  err.code = code || 'invalid';
  return err;
}

/* ---------------------------------------------------------- sheet helpers */

function sheet_(tab) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS[tab].name);
  if (!sh) throw new Error('Missing tab ' + TABS[tab].name + '. Run setup() first.');
  return sh;
}

/** Reads a tab into objects keyed by header, with _row holding the sheet row number. */
function read_(tab) {
  var headers = TABS[tab].headers;
  var values = sheet_(tab).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1 };
    var any = false;
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = cellOut_(values[i][j], headers[j]);
      if (obj[headers[j]] !== '') any = true;
    }
    if (any) out.push(obj);
  }
  return out;
}

function cellOut_(v, header) {
  if (v === null || v === undefined) return '';
  var tz = Session.getScriptTimeZone();
  if (v instanceof Date) return Utilities.formatDate(v, tz, header === 'time' ? 'HH:mm' : 'yyyy-MM-dd');
  var s = String(v).trim();
  if (header === 'time') return normTime_(s);
  return s;
}

/** Accepts "15:00", "3:00 PM" or "3 pm" typed into the sheet by hand. */
function normTime_(s) {
  var m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(s);
  if (!m) return s;
  var h = parseInt(m[1], 10);
  var ap = m[3] ? m[3].toLowerCase() : '';
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return (h < 10 ? '0' : '') + h + ':' + (m[2] || '00');
}

function rowFrom_(tab, obj) {
  return TABS[tab].headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
}

function writeRow_(tab, row, obj) {
  var vals = rowFrom_(tab, obj).map(cellIn_);
  sheet_(tab).getRange(row, 1, 1, vals.length).setValues([vals]);
}

function appendRows_(tab, rows) {
  if (!rows.length) return;
  var sh = sheet_(tab);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length)
    .setValues(rows.map(function (r) { return r.map(cellIn_); }));
}

/**
 * Prefixes text with an apostrophe so Sheets stores it as plain text: no formula
 * injection (=, +, -, @), and dates and times are not reformatted.
 */
function cellIn_(v) {
  if (typeof v === 'string') return v === '' ? '' : "'" + v;
  return v;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw userError_('The site is busy right now. Try again.', 'busy');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ misc */

function findGame_(games, id) {
  var game = games.filter(function (g) { return g.id === id; })[0];
  if (!game) throw userError_('That game is no longer on the schedule.', 'not_found');
  return game;
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function newEditCode_() {
  var code = '';
  for (var i = 0; i < 6; i++) {
    var n = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16);
    code += EDIT_CODE_ALPHABET.charAt(n % EDIT_CODE_ALPHABET.length);
  }
  return code;
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function byDateTime_(a, b) {
  return ((a.date || '9') + (a.time || '')).localeCompare((b.date || '9') + (b.time || ''));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
