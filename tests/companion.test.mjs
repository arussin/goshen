import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/companion.js', import.meta.url), 'utf8');

function companion() {
  const context = vm.createContext({});
  vm.runInContext(source, context, { filename: 'companion.js' });
  return context.GoshenCompanion.create();
}

test('HOPPER renders bounded terminal art and cycles idle blink, ear and hop poses', () => {
  const hopper = companion();
  const poses = new Set();
  for (let now = 0; now <= 16000; now += 100) {
    const view = hopper.frame({ now });
    assert.equal(view.mood, 'idle');
    assert.match(view.label, /^HOPPER/);
    const rows = view.art.split('\n');
    assert.equal(rows.length, 14);
    assert.ok(rows.every(row => Array.from(row).length === 23));
    poses.add(view.art);
  }
  assert.ok(poses.size >= 4, 'Rabbit should blink, twitch and hop as well as rest');
});

test('activity transitions visibly acknowledge typing, work and incoming response', () => {
  const hopper = companion();
  const ready = hopper.frame({ now: 0 });
  const typing = hopper.frame({ now: 10, activity: 'typing' });
  const working = hopper.frame({ now: 20, activity: 'working' });
  const tapping = hopper.frame({ now: 350, activity: 'working' });
  const receiving = hopper.frame({ now: 400, activity: 'receiving' });
  assert.equal(typing.mood, 'listening');
  assert.equal(working.mood, 'working');
  assert.equal(receiving.mood, 'receiving');
  assert.equal(new Set([ready.art, typing.art, working.art, receiving.art]).size, 4);
  assert.notEqual(working.art, tapping.art);
  assert.match(working.art, /┌─────────┐/);
  assert.notEqual(ready.quip, working.quip);
});

test('pet and completion reactions expire and do not mask future response activity', () => {
  const hopper = companion();
  hopper.react('pet', 0);
  const pet = hopper.frame({ now: 100 });
  assert.equal(pet.mood, 'happy');
  assert.match(pet.art, /♥/);
  assert.match(pet.quip, /Headpat/);
  assert.equal(hopper.frame({ now: 3300 }).mood, 'idle');
  hopper.react('complete', 3400);
  assert.equal(hopper.frame({ now: 3500 }).mood, 'celebrating');
  assert.equal(hopper.frame({ now: 8000, activity: 'working' }).mood, 'working');
  hopper.react('sent', 8100);
  assert.equal(hopper.frame({ now: 8200, activity: 'receiving' }).mood, 'receiving');
});

test('reduced motion preserves a fixed pose and mood for each activity', () => {
  for (const activity of ['ready', 'typing', 'working', 'receiving']) {
    const hopper = companion();
    const first = hopper.frame({ now: 0, activity, motion: false });
    for (const now of [400, 5100, 6700, 14600, 25000, 120000]) {
      const later = hopper.frame({ now, activity, motion: false });
      assert.equal(later.art, first.art, `Reduced-motion ${activity} art must stay still`);
      assert.equal(later.mood, first.mood);
    }
  }
});

test('idle dialogue remains independent of animation and can be silenced', () => {
  const hopper = companion();
  const first = hopper.frame({ now: 0, motion: false });
  const later = hopper.frame({ now: 22000, motion: false });
  assert.equal(later.art, first.art);
  assert.equal(later.mood, first.mood);
  assert.notEqual(later.quip, first.quip, 'Quips stay active when ambient animation is off');
  assert.equal(hopper.frame({ now: 23000, motion: false, quips: false }).quip, '');
  assert.equal(hopper.frame({ now: 66000, motion: false, quips: false }).quip, '');
  assert.equal(hopper.frame({ now: 88000, motion: true, quips: false }).quip, '');
});

test('quips are sparse, can be hidden, and react to categories without echoing private input', () => {
  const hopper = companion();
  const first = hopper.frame({ now: 0 });
  assert.equal(hopper.frame({ now: 21999 }).quip, first.quip);
  assert.notEqual(hopper.frame({ now: 22000 }).quip, first.quip);
  hopper.react('sent', 23000, 'code');
  const coding = hopper.frame({ now: 23001, activity: 'working' });
  assert.match(coding.quip, /bugs/);
  assert.equal(hopper.frame({ now: 23002, activity: 'working', quips: false }).quip, '');
  const privateText = '<script>secret conversation 7942</script>';
  hopper.react('sent', 26000, privateText);
  const arbitrary = hopper.frame({ now: 26001, activity: 'typing', topic: privateText });
  assert.ok(!JSON.stringify(arbitrary).includes(privateText));
  assert.ok(!JSON.stringify(arbitrary).includes('7942'));
});

test('companion state is isolated and resets reproducibly without ambient browser APIs', () => {
  const one = companion();
  const two = companion();
  assert.equal(one.frame({ now: 0 }).art, two.frame({ now: 0 }).art);
  one.react('pet', 1);
  assert.equal(one.frame({ now: 2 }).mood, 'happy');
  assert.equal(two.frame({ now: 2 }).mood, 'idle');
  one.reset(0);
  assert.equal(JSON.stringify(one.frame({ now: 2 })), JSON.stringify(two.frame({ now: 2 })));
  one.react('unknown', 100, 'secret');
  assert.equal(one.frame({ now: 3, activity: 'unrecognized' }).mood, 'idle');
});
