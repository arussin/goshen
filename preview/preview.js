(() => {
  'use strict';
  const conversation = document.getElementById('conversation');
  const input = document.getElementById('prompt-textarea');
  const form = document.getElementById('composer-form');
  const send = document.getElementById('send-button');
  const dialog = document.getElementById('help-dialog');
  let stream = null;
  let turn = 0;
  const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const templates = {
    welcome: {
      prompt: 'What if my everyday workspace felt like a computer from another future?',
      heading: 'A terminal for the curious.',
      intro: 'Warm phosphor, a bank of blinking lights, and a small rabbit keeping watch at the edge of your conversation.',
      features: [['Find your frequency.', 'Warm amber, classic green, or ice-blue phosphor. Make the signal yours.'], ['Meet your terminal companion.', 'A pixel rabbit idles, perks up when you type, and has the occasional cyberpunk remark.'], ['Watch the signal arrive.', 'Light panels and ASCII animations react as responses arrive. Try DEMO RESPONSE to wake up the deck.']]
    },
    world: {prompt:'Help me imagine a city that only wakes up after midnight.', heading:'Somewhere, the lights come on.', intro:'Rain glides down the windows of an all-night repair shop. Above it, a thousand antennae listen to a sky full of borrowed dreams.', features:[['Start with a place.', 'The terminal district. Old machinery, warm kitchens, strange little shops.'], ['Give it a heartbeat.', 'The last tram carries musicians, night-shift engineers, and one impossible passenger.'], ['Leave a door open.', 'At 03:17, every radio in the city receives the same three words.']]},
    code: {prompt:'Imagine a small generative art project made entirely of text.', heading:'A universe, 80 columns wide.', intro:'Begin with a field of dots. Let a handful of particles drift through it, leaving quiet trails of punctuation in their wake.', features:[['Start small.', 'An 80 × 24 character canvas, a few particles, and a clock.'], ['Add a little physics.', 'Gravity bends the trails. The edges wrap. Every orbit becomes a sentence.'], ['Let it surprise you.', 'A single change in the seed gives you a different little sky.']]},
    music: {prompt:'Describe a soundtrack for a very long trip through space.',heading:'Nothing but the low hum.',intro:'Soft tape hiss, a warm electric piano, and an unhurried bass line. Enough room between the notes to watch the planets go by.',features:[['Departure.', 'A gentle pulse and the click of a switch.'], ['In transit.', 'Long synthesizer chords, drifting slowly out of phase.'], ['Arrival.', 'One clear melody. Something that feels like home.']]},
    notes: {prompt:'Why do old tools sometimes feel so good to use?',heading:'A little friction can be beautiful.',intro:'A switch has weight. A dial has a beginning and an end. The best tools tell you what they are doing, and invite you to take your time.',features:[['Make it tangible.', 'Clear boundaries, legible controls, deliberate choices.'], ['Keep the useful rituals.', 'A place to start. A satisfying moment when the work is done.'], ['Leave out the noise.', 'The interface should give your attention somewhere to settle.']]},
    ideas: {prompt:'Give me a starting point for my next side project.',heading:'Follow the small fascination.',intro:'Build something you wish you could reach for every day. Keep the first version small enough to finish, and personal enough to care about.',features:[['Notice.', 'What tiny annoyance keeps showing up in your day?'], ['Make.', 'One screen. One useful thing. One evening to get it working.'], ['Refine.', 'Live with it, and let actual use tell you what comes next.']]}
  };
  function message(role, text) {
    const article = document.createElement('article');
    article.className = 'message ' + (role === 'assistant' ? 'assistant-message' : '');
    article.dataset.testid = 'conversation-turn-' + (++turn);
    const label = document.createElement('div'); label.className = 'message-label';
    const who = document.createElement('span'); who.className = 'who'; who.textContent = role === 'user' ? 'YOU / OPERATOR' : 'CHATGPT / RESPONSE';
    const stamp = document.createElement('time'); stamp.textContent = time();
    label.append(who, stamp);
    const body = document.createElement('div'); body.dataset.messageAuthorRole = role;
    const copy = document.createElement('div'); copy.className = 'markdown'; copy.textContent = text || '';
    body.append(copy); article.append(label, body); conversation.append(article);
    return copy;
  }
  function cancelStream() {
    if (stream) clearInterval(stream); stream = null;
    send.dataset.testid = 'send-button'; send.setAttribute('aria-label','Send prompt'); send.innerHTML = 'TRANSMIT <span>↗</span>';
    conversation.querySelectorAll('.stream-cursor').forEach(el => el.classList.remove('stream-cursor'));
  }
  function chooseSession(key) {
    cancelStream(); input.value = ''; turn = 0; conversation.replaceChildren();
    document.querySelectorAll('[data-session]').forEach(a => { if (a.dataset.session === key) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
    const item = templates[key] || templates.welcome;
    message('user', item.prompt);
    const copy = message('assistant');
    const heading = document.createElement('h1'); heading.textContent = item.heading;
    const intro = document.createElement('p'); intro.className = 'intro-copy'; intro.textContent = item.intro;
    copy.append(heading, intro);
    item.features.forEach(([title, detail],index) => {
      const line = document.createElement('div'); line.className = 'feature-line';
      const n = document.createElement('span'); n.className = 'feature-number'; n.textContent = '0' + (index + 1);
      const text = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = title;
      const detailEl = document.createElement('span'); detailEl.textContent = detail; text.append(strong, detailEl); line.append(n, text); copy.append(line);
    });
    const end = document.createElement('div'); end.className = 'transmission-end'; end.innerHTML = '<span>END OF TRANSMISSION</span><span>AWAITING YOUR NEXT IDEA ▋</span>'; copy.append(end);
    conversation.scrollTop = 0;
  }
  function transmit(text) {
    if (stream) { cancelStream(); return; }
    if (!text.trim()) { input.focus(); return; }
    if (conversation.querySelector('.empty-chat')) conversation.replaceChildren();
    message('user', text); input.value = '';
    const copy = message('assistant'); copy.classList.add('streamed-copy','stream-cursor');
    send.dataset.testid = 'stop-button'; send.setAttribute('aria-label','Stop generating'); send.textContent = '■ STOP';
    const response = 'Signal received.\n\nThis is a simulated response for the terminal demo. On chatgpt.com, your conversations and responses will come from ChatGPT as usual.\n\nWatch the rabbit and light panels while these words arrive. Try a different phosphor color, tune the screen glow, or switch to focus mode for a little more room. Ambient animation and Rabbit quips can be switched off independently.\n\nThe terminal is yours. Make something good.';
    let index = 0;
    const streamingStarts = performance.now() + 800;
    stream = setInterval(() => {
      if (performance.now() < streamingStarts) return;
      index += 3; copy.textContent = response.slice(0,index); conversation.scrollTop = conversation.scrollHeight;
      if (index >= response.length) cancelStream();
    }, 60);
    conversation.scrollTop = conversation.scrollHeight;
  }
  form.addEventListener('submit', e => {e.preventDefault(); transmit(input.value);});
  input.addEventListener('keydown', e => {if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {e.preventDefault(); transmit(input.value);}});
  document.getElementById('new-chat').addEventListener('click', () => {
    cancelStream(); conversation.innerHTML = '<div class="empty-chat"><span class="overline">FREQUENCY OPEN / AWAITING INPUT</span><h1>Where should we<br>go from here?</h1><p>A blank screen. A blinking cursor. A whole new world on the other side.</p><div class="suggestions"><button>Imagine something new</button><button>Make a little magic</button><button>Follow a curiosity</button></div></div>';
    document.querySelectorAll('[data-session]').forEach(a=>a.removeAttribute('aria-current'));
    conversation.querySelectorAll('.suggestions button').forEach(b=>b.addEventListener('click',()=>transmit(b.textContent)));
    input.value=''; input.focus();
  });
  document.querySelectorAll('[data-session]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();chooseSession(a.dataset.session);}));
  document.getElementById('search-history').addEventListener('input',e=>{let matches=0;document.querySelectorAll('[data-session]').forEach(a=>{a.hidden=!a.textContent.toLowerCase().includes(e.target.value.toLowerCase());if(!a.hidden)matches++;});document.querySelector('.no-results').hidden=matches>0;});
  document.getElementById('demo-cycle').addEventListener('click',()=>transmit('Show me the incoming signal animation.'));
  const showHelp = e => {e.preventDefault();dialog.showModal();};
  ['help-button','install-link','model-info'].forEach(id=>document.getElementById(id).addEventListener('click',showHelp));
  document.querySelectorAll('.help-close,.help-done').forEach(b=>b.addEventListener('click',()=>dialog.close()));
  document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,[contenteditable="true"]')||document.querySelector('dialog[open]')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='/'){e.preventDefault();document.getElementById('search-history').focus();}if(e.key.toLowerCase()==='n'){document.getElementById('new-chat').click();}});
  const restore=document.getElementById('restore-deck');
  restore.addEventListener('click',()=>globalThis.CyberdeckSettings.save({enabled:true}));
  const watch = () => {if(globalThis.CyberdeckSettings){globalThis.CyberdeckSettings.subscribe(s=>restore.hidden=s.enabled);globalThis.CyberdeckSettings.load().then(s=>restore.hidden=s.enabled).catch(()=>{});}};
  watch(); chooseSession('welcome');
})();
