// Shared booking logic. The same code runs in the browser (demo mode) and in Apps Script (live).
var Core = (function () {
  var BUFFER_MIN = 10;
  var PORTFOLIOS = [
    'Publicity and Publications',
    'Logistics and Welfare',
    'Programmer',
    'Group Leader - Solertia',
    'Group Leader - Peritia',
    'Group Leader - Meliora',
    'Group Leader - Sagacitas'
  ];
  var WRITE_ACTIONS = ['book', 'cancel', 'addSlots', 'deleteSlots', 'importApplicants'];
  var ADMIN_ACTIONS = ['admin', 'addSlots', 'deleteSlots', 'importApplicants'];

  function norm(s) { return String(s == null ? '' : s).trim(); }
  function lc(s) { return norm(s).toLowerCase(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  // "YYYY-MM-DDTHH:MM" in Singapore time <-> minutes since epoch
  function toMin(s) { return Date.parse(s + ':00+08:00') / 60000; }
  function minToStr(m) {
    var d = new Date((m + 480) * 60000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
      'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  function clash(a, b, buffer) {
    var buf = buffer == null ? BUFFER_MIN : buffer;
    return toMin(a.start) < toMin(b.end) + buf && toMin(b.start) < toMin(a.end) + buf;
  }
  function uniq(arr) { return arr.filter(function (x, i) { return x && arr.indexOf(x) === i; }); }
  function byStart(x, y) { return x.start < y.start ? -1 : x.start > y.start ? 1 : 0; }
  function newId() { return Math.random().toString(36).slice(2, 10); }

  function matchPortfolio(s) {
    var v = lc(s).replace(/&/g, 'and').replace(/\s+/g, ' ');
    if (!v) return '';
    var exact = PORTFOLIOS.filter(function (p) { return lc(p) === v; })[0];
    if (exact) return exact;
    var part = PORTFOLIOS.filter(function (p) { return lc(p).indexOf(v) >= 0 || v.indexOf(lc(p)) >= 0; });
    if (part.length === 1) return part[0];
    var house = PORTFOLIOS.filter(function (p) { var h = lc(p.split(' - ')[1] || '-'); return v.indexOf(h) >= 0; });
    if (house.length === 1) return house[0];
    return norm(s);
  }

  function findApplicant(db, email) {
    return db.applicants.filter(function (a) { return lc(a.email) === lc(email); })[0];
  }
  function choicesOf(a) { return uniq([norm(a.choice1), norm(a.choice2)]); }
  function taken(db, slotId) { return db.bookings.filter(function (b) { return b.slotId === slotId; }).length; }
  function cap(s) { return Math.max(1, Number(s.capacity) || 1); }

  function applicantView(db, email, now) {
    var a = findApplicant(db, email);
    if (!a) throw new Error("We couldn't find " + norm(email) + " in the applicant list. Use the email you applied with, or contact the FOP committee.");
    var choices = choicesOf(a);
    var mine = db.bookings.filter(function (b) { return lc(b.email) === lc(a.email); }).map(function (b) {
      var s = db.slots.filter(function (x) { return x.id === b.slotId; })[0] || {};
      return { slotId: b.slotId, portfolio: b.portfolio, start: b.start, end: b.end, location: s.location || '' };
    });
    var slots = db.slots.filter(function (s) {
      return choices.indexOf(s.portfolio) >= 0 && toMin(s.start) > now;
    }).map(function (s) {
      return { id: s.id, portfolio: s.portfolio, start: s.start, end: s.end, location: s.location || '', left: Math.max(0, cap(s) - taken(db, s.id)) };
    }).sort(byStart);
    return { ok: true, applicant: { name: a.name, email: a.email, choices: choices }, mine: mine, slots: slots, buffer: BUFFER_MIN };
  }

  function book(db, req, now) {
    var a = findApplicant(db, req.email);
    if (!a) throw new Error('We could not find your email in the applicant list.');
    var slot = db.slots.filter(function (s) { return s.id === req.slotId; })[0];
    if (!slot) throw new Error('That slot no longer exists. Refresh and pick another.');
    if (choicesOf(a).indexOf(slot.portfolio) < 0) throw new Error('That slot belongs to a portfolio you did not apply for.');
    if (toMin(slot.start) <= now) throw new Error('That slot has already started.');
    var mine = db.bookings.filter(function (b) { return lc(b.email) === lc(a.email); });
    var same = mine.filter(function (b) { return b.portfolio === slot.portfolio; })[0];
    if (same && same.slotId === slot.id) return { result: applicantView(db, a.email, now), dirty: [] };
    if (taken(db, slot.id) >= cap(slot)) throw new Error('Someone just took that slot. Please pick another one.');
    var other = mine.filter(function (b) { return b.portfolio !== slot.portfolio && clash(b, slot); })[0];
    if (other) throw new Error('That slot is too close to your ' + other.portfolio + ' interview. Please pick another one.');
    if (same) db.bookings.splice(db.bookings.indexOf(same), 1);
    var row = {
      timestamp: new Date(now * 60000).toISOString(), slotId: slot.id, email: a.email, name: a.name,
      portfolio: slot.portfolio, start: slot.start, end: slot.end
    };
    db.bookings.push(row);
    return {
      result: applicantView(db, a.email, now), dirty: ['bookings'],
      notify: { type: 'booked', to: a.email, name: a.name, portfolio: slot.portfolio, start: slot.start, end: slot.end, location: slot.location || '', changed: !!same }
    };
  }

  function cancel(db, req, now) {
    var i = -1;
    db.bookings.forEach(function (b, j) { if (lc(b.email) === lc(req.email) && b.slotId === req.slotId) i = j; });
    if (i < 0) throw new Error('No booking found to cancel.');
    db.bookings.splice(i, 1);
    return { result: applicantView(db, req.email, now), dirty: ['bookings'] };
  }

  function adminView(db) {
    var bySlot = {};
    db.bookings.forEach(function (b) { (bySlot[b.slotId] = bySlot[b.slotId] || []).push({ name: b.name, email: b.email }); });
    var ports = uniq(PORTFOLIOS.concat(db.slots.map(function (s) { return s.portfolio; }),
      [].concat.apply([], db.applicants.map(choicesOf))));
    return {
      ok: true, portfolios: ports, buffer: BUFFER_MIN,
      slots: db.slots.map(function (s) {
        return { id: s.id, portfolio: s.portfolio, start: s.start, end: s.end, capacity: cap(s), location: s.location || '', booked: bySlot[s.id] || [] };
      }).sort(byStart),
      applicants: db.applicants.map(function (a) {
        return {
          email: a.email, name: a.name, choice1: a.choice1, choice2: a.choice2,
          bookings: db.bookings.filter(function (b) { return lc(b.email) === lc(a.email); })
            .map(function (b) { return { portfolio: b.portfolio, start: b.start, end: b.end }; })
        };
      })
    };
  }

  function addSlots(db, r) {
    var portfolio = norm(r.portfolio), len = Number(r.length), capacity = Math.max(1, Number(r.capacity) || 1);
    if (!portfolio) throw new Error('Pick a portfolio.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(norm(r.date))) throw new Error('Pick a date.');
    if (!/^\d{2}:\d{2}$/.test(norm(r.from)) || !/^\d{2}:\d{2}$/.test(norm(r.to))) throw new Error('Enter start and end times.');
    if (!(len >= 5 && len <= 180)) throw new Error('Slot length must be between 5 and 180 minutes.');
    var m = toMin(r.date + 'T' + r.from), end = toMin(r.date + 'T' + r.to), added = 0;
    if (!(end > m)) throw new Error('End time must be after start time.');
    for (; m + len <= end; m += len) {
      var start = minToStr(m);
      var dup = db.slots.some(function (s) { return s.portfolio === portfolio && s.start === start; });
      if (dup) continue;
      db.slots.push({ id: newId(), portfolio: portfolio, start: start, end: minToStr(m + len), capacity: capacity, location: norm(r.location) });
      added++;
    }
    var res = adminView(db); res.message = added + ' slot' + (added === 1 ? '' : 's') + ' added.';
    return { result: res, dirty: added ? ['slots'] : [] };
  }

  function deleteSlots(db, r) {
    var ids = r.ids || [], removed = 0, kept = 0;
    db.slots = db.slots.filter(function (s) {
      if (ids.indexOf(s.id) < 0) return true;
      if (taken(db, s.id)) { kept++; return true; }
      removed++; return false;
    });
    var res = adminView(db);
    res.message = removed + ' slot' + (removed === 1 ? '' : 's') + ' deleted.' + (kept ? ' ' + kept + ' booked slot' + (kept === 1 ? ' was' : 's were') + ' kept; ask the applicant to rebook first.' : '');
    return { result: res, dirty: removed ? ['slots'] : [] };
  }

  function importApplicants(db, r) {
    var added = 0, updated = 0, skipped = 0;
    (r.rows || []).forEach(function (x) {
      var email = lc(x.email);
      if (!email || email.indexOf('@') < 0) { skipped++; return; }
      var rec = { email: email, name: norm(x.name), choice1: matchPortfolio(x.choice1), choice2: matchPortfolio(x.choice2) };
      var cur = findApplicant(db, email);
      if (cur) { cur.name = rec.name || cur.name; cur.choice1 = rec.choice1; cur.choice2 = rec.choice2; updated++; }
      else { db.applicants.push(rec); added++; }
    });
    var res = adminView(db);
    res.message = added + ' added, ' + updated + ' updated' + (skipped ? ', ' + skipped + ' skipped (no valid email)' : '') + '.';
    return { result: res, dirty: added || updated ? ['applicants'] : [] };
  }

  function handle(db, req, ctx) {
    var act = req.action, now = ctx.now;
    if (ADMIN_ACTIONS.indexOf(act) >= 0 && norm(req.pass) !== norm(ctx.adminPass)) throw new Error('Wrong passcode.');
    switch (act) {
      case 'lookup': return { result: applicantView(db, req.email, now), dirty: [] };
      case 'book': return book(db, req, now);
      case 'cancel': return cancel(db, req, now);
      case 'admin': return { result: adminView(db), dirty: [] };
      case 'addSlots': return addSlots(db, req);
      case 'deleteSlots': return deleteSlots(db, req);
      case 'importApplicants': return importApplicants(db, req);
      default: throw new Error('Unknown action: ' + act);
    }
  }

  return {
    handle: handle, WRITE_ACTIONS: WRITE_ACTIONS, PORTFOLIOS: PORTFOLIOS, BUFFER_MIN: BUFFER_MIN,
    toMin: toMin, minToStr: minToStr, clash: clash, matchPortfolio: matchPortfolio
  };
})();
