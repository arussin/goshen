/* HOPPER, the Goshen Terminal companion. Local sprite + canned dialogue only. */
(() => {
  'use strict';
  if (globalThis.GoshenCompanion) return;

  const WIDTH = 23;
  const HEIGHT = 14;
  const ACTIVITIES = new Set(['ready', 'typing', 'working', 'receiving']);
  const EVENT_DURATION = { pet: 3200, sent: 2400, complete: 4500, navigate: 2800 };
  const QUIPS = Object.freeze({
    ready: [
      'Low life. High carrot.',
      'The city sleeps. I keep watch.',
      'All ears. Zero subscriptions.',
      'Just a rabbit in the machine.',
      'Neon outside. Cozy in here.',
      'Dreaming in 8 bits.',
    ],
    typing: [
      'Ears up. Take your time.',
      'I hear the keys from here.',
      'A little signal in the noise.',
    ],
    working: [
      'Warming the thought tubes.',
      'Somewhere, a relay is clicking.',
      'Good thoughts take a few ticks.',
      'Keeping the phosphor warm.',
    ],
    receiving: [
      'Incoming. Follow the glow.',
      'Words from the other side.',
      'Catching the signal, one bit at a time.',
    ],
    pet: [
      'Headpat received. Morale +8.',
      'I am a very serious terminal rabbit.',
      'One more and I might reboot.',
      'Affection protocol: accepted.',
    ],
    sent: [
      'Your signal is out in the neon.',
      'Message away. Ears on the wire.',
      'Over to the other end.',
    ],
    complete: [
      'Fresh off the wire.',
      'Signal landed. Your move.',
      'And that is how the bits hop.',
    ],
    navigate: [
      'New channel. Same rabbit.',
      'Another corner of the grid.',
      'Terminal online. Make yourself at home.',
    ],
  });
  const LABELS = Object.freeze({
    idle: 'HOPPER / STANDBY',
    listening: 'HOPPER / ALL EARS',
    working: 'HOPPER / THINKING',
    receiving: 'HOPPER / RECEIVING',
    happy: 'HOPPER / HEADPAT',
    celebrating: 'HOPPER / SIGNAL LANDED',
    alert: 'HOPPER / UPLINK',
    exploring: 'HOPPER / NEW CHANNEL',
  });
  // Each # is one phosphor pixel. Eyes and poses are cut into this silhouette.
  const SILHOUETTE = [
    '',
    '      ##      ##',
    '      #:#    #:#',
    '      #:#    #:#',
    '      #:#    #:#',
    '     ############',
    '    ##############',
    '    ##############',
    '     ############',
    '       ########',
    '     ############  ##',
    '    ############### #',
    '      ####  ####',
    '      ####  ####',
  ];

  function sprite(mood, elapsed, motion) {
    const phase = motion ? Math.max(0, elapsed) : 0;
    const idle = mood === 'idle' || mood === 'exploring';
    const blink = motion && idle && phase % 5300 > 4950;
    const twitch = motion && phase % 7100 > 6500;
    const hopping = motion && ((idle && phase % 16000 > 14500 && phase % 16000 < 14900) ||
      (mood === 'celebrating' && phase % 850 > 280 && phase % 850 < 550));
    const dy = hopping ? -1 : 0;
    const grid = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(' '));
    const put = (x, y, value) => {
      if (y < 0 || y >= HEIGHT) return;
      Array.from(value).forEach((character, offset) => {
        if (x + offset >= 0 && x + offset < WIDTH) grid[y][x + offset] = character;
      });
    };
    const body = (x, y, value) => put(x, y + dy, value);
    SILHOUETTE.forEach((line, y) => body(0, y, line.replaceAll('#', '█').replaceAll(':', '░')));

    // The two dark, two-pixel eyes and small nose stay legible at terminal sizes.
    body(7, 6, '  ');
    body(13, 6, '  ');
    body(7, 7, '  ');
    body(13, 7, '  ');
    body(10, 8, ' ▀ ');
    body(10, 9, '▀ ▀');
    if (blink) {
      body(7, 6, '██');
      body(13, 6, '██');
      body(7, 7, '▄▄');
      body(13, 7, '▄▄');
    }
    if (twitch || mood === 'receiving') {
      body(13, 1, '    ');
      body(13, 2, ' ▄██');
      body(13, 3, '█░█ ');
    }
    if (mood === 'happy' || mood === 'celebrating') {
      body(7, 6, '▄▄');
      body(13, 6, '▄▄');
      body(7, 7, '██');
      body(13, 7, '██');
      body(10, 9, '▄ ▄');
      const high = motion && phase % 900 > 450;
      put(2, high ? 2 : 3, mood === 'happy' ? '♥' : '+');
      put(20, high ? 3 : 2, mood === 'happy' ? '♥' : '+');
      if (mood === 'celebrating') put(10, 0, motion && phase % 600 > 300 ? '* +' : '+ *');
    }
    if (mood === 'listening') {
      // A tiny cursor and attentive gaze acknowledge typing without reading text.
      body(7, 6, ' ▄');
      body(13, 6, ' ▄');
      put(2, 8, motion && phase % 1100 > 550 ? ' ' : '>');
    }
    if (mood === 'working') {
      const tap = motion && phase % 600 >= 300;
      body(5, 10, tap ? ' ▄' : '██');
      body(15, 10, tap ? '██' : '▄ ');
      put(6, 11, '┌─────────┐');
      put(6, 12, tap ? '│ ▪ ▫ ▪ ▫ │' : '│ ▫ ▪ ▫ ▪ │');
      put(6, 13, '└─────────┘');
      const ticks = motion ? Math.floor(phase / 400) % 4 : 3;
      put(1, 4, '.'.repeat(ticks));
    }
    if (mood === 'receiving' || mood === 'alert') {
      const wave = motion ? Math.floor(phase / 350) % 3 : 1;
      put(0, 9, ['  ·', ' :·', '(:·'][wave]);
      put(20, 9, ['·  ', '·: ', '·:)'][wave]);
    }
    if (hopping) put(6, 13, '░░░░  ░░░░');
    return grid.map(row => row.join('')).join('\n');
  }

  function create() {
    let currentActivity;
    let activityAt;
    let lastNow;
    let reaction;
    let line;
    let nextIdleQuipAt;
    let quipLockedUntil;
    let sequence;

    const safeTime = now => {
      const value = Number.isFinite(now) ? now : lastNow;
      lastNow = Math.max(lastNow, value);
      return lastNow;
    };
    function choose(kind, now) {
      const choices = QUIPS[kind] || QUIPS.ready;
      const index = (sequence[kind] || 0) % choices.length;
      sequence[kind] = index + 1;
      line = choices[index];
      nextIdleQuipAt = now + 22000;
    }

    function reset(now = 0) {
      lastNow = Number.isFinite(now) ? now : 0;
      currentActivity = 'ready';
      activityAt = lastNow;
      reaction = null;
      sequence = Object.create(null);
      quipLockedUntil = lastNow;
      choose('ready', lastNow);
    }

    function react(event, now) {
      if (!Object.prototype.hasOwnProperty.call(EVENT_DURATION, event)) return;
      const time = safeTime(now);
      reaction = { type: event, at: time, until: time + EVENT_DURATION[event] };
      choose(event, time);
      // Keep an event's line visible through the immediately following activity scan.
      quipLockedUntil = time + EVENT_DURATION[event];
    }

    function frame({ now = lastNow, activity = 'ready', motion = true, quips = true } = {}) {
      const time = safeTime(now);
      const nextActivity = ACTIVITIES.has(activity) ? activity : 'ready';
      if (nextActivity !== currentActivity) {
        currentActivity = nextActivity;
        activityAt = time;
        if (time >= quipLockedUntil) choose(nextActivity, time);
      } else if (nextActivity === 'ready' && quips && time >= nextIdleQuipAt && time >= quipLockedUntil) {
        choose('ready', time);
      }
      if (reaction && time >= reaction.until) reaction = null;
      let mood = { ready: 'idle', typing: 'listening', working: 'working', receiving: 'receiving' }[nextActivity];
      let poseAt = activityAt;
      if (reaction) {
        const eventMood = { pet: 'happy', sent: 'alert', complete: 'celebrating', navigate: 'exploring' }[reaction.type];
        // Live response activity takes over the short send/navigation pose.
        if (reaction.type === 'pet' || reaction.type === 'complete' || nextActivity === 'ready' || nextActivity === 'typing') {
          mood = eventMood;
          poseAt = reaction.at;
        }
      }
      return { art: sprite(mood, time - poseAt, Boolean(motion)), quip: quips ? line : '', mood, label: LABELS[mood] };
    }

    reset();
    return Object.freeze({ frame, react, reset });
  }

  globalThis.GoshenCompanion = Object.freeze({ create });
})();
