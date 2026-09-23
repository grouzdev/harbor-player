import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseState, type Release } from '../src/config/release.ts';
const published: Release = { version: '1.0.0', channel: 'stable', installer: 'https://example.com/setup.exe', portable: 'https://example.com/portable.exe', notes: 'https://example.com/release' };
test('unreleased never advertises stale asset links', () => {
  assert.deepEqual(releaseState({ ...published, channel: 'unreleased' }), { available: false, installer: null, portable: null, unsigned: false });
});
test('incomplete release cannot advertise downloads', () => {
  assert.equal(releaseState({ ...published, installer: null }).available, false);
  assert.equal(releaseState({ ...published, version: null }).portable, null);
});
test('unsigned beta identifies the warning and optional portable', () => {
  const state = releaseState({ ...published, channel: 'unsigned-beta', portable: null });
  assert.equal(state.unsigned, true);
  assert.equal(state.available, true);
  assert.equal(state.portable, null);
});
test('stable exposes both assets without an unsigned warning', () => {
  assert.deepEqual(releaseState(published), { available: true, installer: published.installer, portable: published.portable, unsigned: false });
});
