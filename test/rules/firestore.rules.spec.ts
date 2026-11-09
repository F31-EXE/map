// Security-rules tests. Need the Firestore emulator: `npm run test:rules`.
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';

let env: RulesTestEnvironment;
const TEAM = 'team1';
const CODE = 'K7QX2M';

const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;

async function createTeam(db: Firestore, uid: string, code = CODE, teamCode = CODE) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'teams', TEAM), { name: 'Север', code: teamCode, ownerId: uid });
  batch.set(doc(db, 'teamCodes', code), { teamId: TEAM });
  batch.set(doc(db, 'teams', TEAM, 'members', uid), { callsign: 'Гром', color: '#fff', joinCode: teamCode });
  return batch.commit();
}

const join = (db: Firestore, uid: string, code = CODE) =>
  setDoc(doc(db, 'teams', TEAM, 'members', uid), { callsign: 'Тень', color: '#fff', joinCode: code });

const marker = (by: string, kind = 'enemy') => ({ kind, label: 'x', lat: 55, lng: 37, createdBy: by, createdByName: 'n' });
const AVATAR = 'data:image/jpeg;base64,' + 'A'.repeat(4000);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-tacmap',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

describe('creating a team', () => {
  test('owner creates team, code and own membership in one batch', async () => {
    await assertSucceeds(createTeam(as('alice'), 'alice'));
  });
  test('code document must match the team code', async () => {
    await assertFails(createTeam(as('alice'), 'alice', 'ZZZZZZ', CODE));
  });
  test('cannot create a team owned by someone else', async () => {
    await assertFails(setDoc(doc(as('alice'), 'teams', 'x'), { name: 'n', code: 'C', ownerId: 'bob' }));
  });
  test('unauthenticated users can do nothing', async () => {
    const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(db, 'teamCodes', CODE)));
  });
});

describe('joining', () => {
  beforeEach(() => createTeam(as('alice'), 'alice'));

  test('code lookup by exact code works, listing codes does not', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'teamCodes', CODE)));
    await assertFails(getDocs(collection(as('bob'), 'teamCodes')));
  });
  test('joining with the right code succeeds', async () => {
    await assertSucceeds(join(as('bob'), 'bob'));
  });
  test('joining with a wrong code fails', async () => {
    await assertFails(join(as('bob'), 'bob', 'AAAAAA'));
  });
  test('cannot add someone else as a member', async () => {
    await assertFails(join(as('bob'), 'carol'));
  });
  test('non-members cannot read the team, roster or markers', async () => {
    const db = as('mallory');
    await assertFails(getDoc(doc(db, 'teams', TEAM)));
    await assertFails(getDocs(collection(db, 'teams', TEAM, 'members')));
    await assertFails(getDocs(collection(db, 'teams', TEAM, 'markers')));
  });
});

describe('as a member', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
  });

  test('reads the team and roster', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'teams', TEAM)));
    await assertSucceeds(getDocs(collection(as('bob'), 'teams', TEAM, 'members')));
  });
  test('publishes own position', async () => {
    await assertSucceeds(updateDoc(doc(as('bob'), 'teams', TEAM, 'members', 'bob'), { lat: 55.7, lng: 37.6 }));
  });
  test("cannot move someone else's position", async () => {
    await assertFails(updateDoc(doc(as('bob'), 'teams', TEAM, 'members', 'alice'), { lat: 0, lng: 0 }));
  });
  test('cannot rewrite own joinCode', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'teams', TEAM, 'members', 'bob'), { joinCode: 'X' }));
  });
  test('cannot change the team code', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'teams', TEAM), { code: 'NEWONE' }));
  });
  test('adds markers as self only', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'm1'), marker('bob')));
    await assertFails(setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'm2'), marker('alice')));
  });
  test('rejects oversized marker labels', async () => {
    await assertFails(
      setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'm1'), { ...marker('bob'), label: 'x'.repeat(41) })
    );
  });
  test('outsiders cannot add markers', async () => {
    await assertFails(setDoc(doc(as('mallory'), 'teams', TEAM, 'markers', 'm1'), marker('mallory')));
  });
  test('leaves the team', async () => {
    await assertSucceeds(deleteDoc(doc(as('bob'), 'teams', TEAM, 'members', 'bob')));
  });
  test('cannot kick others', async () => {
    await assertFails(deleteDoc(doc(as('bob'), 'teams', TEAM, 'members', 'alice')));
  });
  test('owner can kick', async () => {
    await assertSucceeds(deleteDoc(doc(as('alice'), 'teams', TEAM, 'members', 'bob')));
  });
});

describe('roles, colors and avatars', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
  });

  test('members set their own role', async () => {
    await assertSucceeds(updateDoc(doc(as('bob'), 'teams', TEAM, 'members', 'bob'), { role: 'sniper' }));
  });
  test('cannot join with command rights already set', async () => {
    await assertFails(
      setDoc(doc(as('carol'), 'teams', TEAM, 'members', 'carol'), {
        callsign: 'C',
        joinCode: CODE,
        canCommand: true,
      })
    );
  });
  test('owner changes team color; others cannot; color must be a hex', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'teams', TEAM), { color: '#FF4D4D' }));
    await assertFails(updateDoc(doc(as('bob'), 'teams', TEAM), { color: '#3D9BFF' }));
    await assertFails(updateDoc(doc(as('alice'), 'teams', TEAM), { color: 'red; drop' }));
  });
  test('members upload only their own small image avatar', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'teams', TEAM, 'avatars', 'bob'), { data: AVATAR }));
    await assertFails(setDoc(doc(as('bob'), 'teams', TEAM, 'avatars', 'alice'), { data: AVATAR }));
    await assertFails(setDoc(doc(as('bob'), 'teams', TEAM, 'avatars', 'bob'), { data: 'x'.repeat(70000) }));
    await assertFails(setDoc(doc(as('mallory'), 'teams', TEAM, 'avatars', 'mallory'), { data: AVATAR }));
  });
});

describe('command rights and orders', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await join(as('carol'), 'carol');
  });
  const grant = (by: string, to: string, v = true) =>
    updateDoc(doc(as(by), 'teams', TEAM, 'members', to), { canCommand: v });
  const order = (by: string, id = 'o1') => setDoc(doc(as(by), 'teams', TEAM, 'markers', id), marker(by, 'order-attack'));

  test('only the creator grants command rights', async () => {
    await assertFails(grant('bob', 'bob'));
    await assertFails(grant('bob', 'carol'));
    await assertSucceeds(grant('alice', 'bob'));
  });
  test('the creator cannot touch anything but rights on someone else', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'teams', TEAM, 'members', 'bob'), { canCommand: true, lat: 1 }));
  });
  test('members cannot change their own rights', async () => {
    await grant('alice', 'bob');
    await assertFails(grant('bob', 'bob', false));
  });
  test('orders: creator and granted members only', async () => {
    await assertSucceeds(order('alice', 'o1'));
    await assertFails(order('bob', 'o2'));
    await grant('alice', 'bob');
    await assertSucceeds(order('bob', 'o3'));
  });
  test('chain of command decides who may delete', async () => {
    // alice: squad creator (3), bob: sergeant (2), carol: fighter (1)
    await grant('alice', 'bob');
    const put = (by: string, id: string) => setDoc(doc(as(by), 'teams', TEAM, 'markers', id), marker(by));
    const del = (by: string, id: string) => deleteDoc(doc(as(by), 'teams', TEAM, 'markers', id));
    await order('alice', 'o1');
    await put('bob', 'b1');
    await put('carol', 'c1');
    await put('carol', 'c2');
    await assertFails(del('carol', 'o1')); // fighter vs creator's order
    await assertFails(del('carol', 'b1')); // fighter vs sergeant
    await assertFails(del('bob', 'o1')); // sergeant vs creator
    await assertSucceeds(del('carol', 'c1')); // own
    await assertSucceeds(del('bob', 'c2')); // sergeant over fighter
    await assertSucceeds(del('alice', 'b1')); // creator over sergeant
  });
  test('fighters cannot delete each other', async () => {
    await setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'b1'), marker('bob'));
    await assertFails(deleteDoc(doc(as('carol'), 'teams', TEAM, 'markers', 'b1')));
  });
});

describe('sides', () => {
  const SIDE = 'side1';
  const SIDE_CODE = 'SD4X7Q';
  const createSide = (uid: string, code = SIDE_CODE) => {
    const db = as(uid);
    const batch = writeBatch(db);
    batch.set(doc(db, 'sides', SIDE), { name: 'Север', code, ownerId: uid });
    batch.set(doc(db, 'sideCodes', SIDE_CODE), { sideId: SIDE });
    return batch.commit();
  };
  const attach = (by: string, code = SIDE_CODE) =>
    updateDoc(doc(as(by), 'teams', TEAM), { sideId: SIDE, sideCode: code });
  const sideOrder = (by: string, id = 's1', audience: string | null = 'commanders') =>
    setDoc(doc(as(by), 'teams', TEAM, 'markers', id), { ...marker(by, 'order-move'), audience, groupId: 'g1' });

  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await createSide('sam');
  });

  test('side code must match the side', async () => {
    await env.clearFirestore();
    await assertFails(createSide('sam', 'OTHER1'));
  });
  test('squad leader attaches with the right code only', async () => {
    await assertFails(attach('alice', 'WRONG1'));
    await assertFails(attach('bob'));
    await assertSucceeds(attach('alice'));
  });
  test('before attaching, the side commander sees nothing', async () => {
    await assertFails(getDoc(doc(as('sam'), 'teams', TEAM)));
    await assertFails(getDocs(collection(as('sam'), 'teams', TEAM, 'members')));
  });
  test('after attaching, the side commander lists squads and reads them', async () => {
    await attach('alice');
    const q = query(collection(as('sam'), 'teams'), where('sideId', '==', SIDE));
    await assertSucceeds(getDocs(q));
    await assertSucceeds(getDocs(collection(as('sam'), 'teams', TEAM, 'members')));
    await assertSucceeds(getDocs(collection(as('sam'), 'teams', TEAM, 'markers')));
  });
  test('nobody else can list a side', async () => {
    await attach('alice');
    await assertFails(getDocs(query(collection(as('mallory'), 'teams'), where('sideId', '==', SIDE))));
  });
  test('side commander sends orders to commanders only, nothing else', async () => {
    await attach('alice');
    await assertSucceeds(sideOrder('sam'));
    await assertFails(sideOrder('sam', 's2', null));
    await assertFails(setDoc(doc(as('sam'), 'teams', TEAM, 'markers', 'p1'), marker('sam')));
    await assertFails(updateDoc(doc(as('sam'), 'teams', TEAM, 'members', 'bob'), { canCommand: true }));
  });
  test('squad commander cannot delete the side commander\'s order; side commander deletes theirs', async () => {
    await attach('alice');
    await sideOrder('sam');
    await setDoc(doc(as('alice'), 'teams', TEAM, 'markers', 'a1'), marker('alice'));
    await assertFails(deleteDoc(doc(as('alice'), 'teams', TEAM, 'markers', 's1')));
    await assertSucceeds(deleteDoc(doc(as('sam'), 'teams', TEAM, 'markers', 'a1')));
  });
  test('side commander cancels own orders and can drop the squad, not hijack it', async () => {
    await attach('alice');
    await sideOrder('sam');
    await assertSucceeds(deleteDoc(doc(as('sam'), 'teams', TEAM, 'markers', 's1')));
    await assertFails(updateDoc(doc(as('sam'), 'teams', TEAM), { color: '#FF4D4D' }));
    await assertSucceeds(updateDoc(doc(as('sam'), 'teams', TEAM), { sideId: null, sideCode: null }));
    await assertFails(getDocs(collection(as('sam'), 'teams', TEAM, 'members')));
  });
  test('squad leader detaches', async () => {
    await attach('alice');
    await assertSucceeds(updateDoc(doc(as('alice'), 'teams', TEAM), { sideId: null, sideCode: null }));
  });
});

describe('marker votes and arrows', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await setDoc(doc(as('alice'), 'teams', TEAM, 'markers', 'm1'), marker('alice'));
  });
  const vote = (by: string, field: string, value: unknown) =>
    updateDoc(doc(as(by), 'teams', TEAM, 'markers', 'm1'), { [field]: value });

  test('members add their own vote', async () => {
    await assertSucceeds(vote('bob', 'staleVotes', arrayUnion('bob')));
    await assertSucceeds(vote('alice', 'doneVotes', arrayUnion('alice')));
  });
  test('no voting for others, no rewriting votes, no editing the marker', async () => {
    await assertFails(vote('bob', 'staleVotes', arrayUnion('alice')));
    await vote('alice', 'staleVotes', arrayUnion('alice'));
    await assertFails(vote('bob', 'staleVotes', ['bob']));
    await assertFails(vote('bob', 'label', 'hacked'));
  });
  test('outsiders cannot vote', async () => {
    await assertFails(vote('mallory', 'staleVotes', arrayUnion('mallory')));
  });
  test('markers cannot be created pre-voted', async () => {
    await assertFails(
      setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'm2'), { ...marker('bob'), staleVotes: ['a', 'b', 'c'] })
    );
  });
  test('arrows carry a bounded list of points', async () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 55 + i * 1e-4, lng: 37 }));
    await assertSucceeds(setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'a1'), { ...marker('bob', 'arrow'), points: pts(5) }));
    await assertFails(setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'a2'), { ...marker('bob', 'arrow'), points: pts(41) }));
  });
});

describe('team chat', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
  });
  const msg = (by: string, text = 'Контакт!', uid = by) =>
    setDoc(doc(as(by), 'teams', TEAM, 'messages', `${by}-1`), { uid, callsign: 'X', text });

  test('members post as themselves and read', async () => {
    await assertSucceeds(msg('bob'));
    await assertSucceeds(getDocs(collection(as('alice'), 'teams', TEAM, 'messages')));
  });
  test('no impersonation, empty or huge messages', async () => {
    await assertFails(msg('bob', 'hi', 'alice'));
    await assertFails(msg('bob', ''));
    await assertFails(msg('bob', 'x'.repeat(501)));
  });
  test('outsiders neither read nor post; nobody edits', async () => {
    await assertFails(msg('mallory'));
    await assertFails(getDocs(collection(as('mallory'), 'teams', TEAM, 'messages')));
    await msg('bob');
    await assertFails(updateDoc(doc(as('bob'), 'teams', TEAM, 'messages', 'bob-1'), { text: 'edited' }));
  });
});

describe('movement recording', () => {
  const start = (by: string) => {
    const db = as(by);
    const batch = writeBatch(db);
    batch.set(doc(db, 'teams', TEAM, 'recordings', 'r1'), { name: 'Игра', startedBy: by, endedAt: null });
    batch.update(doc(db, 'teams', TEAM), { recordingId: 'r1' });
    return batch.commit();
  };
  const track = (by: string, uid = by) =>
    setDoc(
      doc(as(by), 'teams', TEAM, 'recordings', 'r1', 'tracks', uid),
      { callsign: 'X', role: 'rifleman', points: arrayUnion({ lat: 55, lng: 37, t: 1 }) },
      { merge: true }
    );

  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
  });

  test('only commanders start recording', async () => {
    await assertFails(start('bob'));
    await assertSucceeds(start('alice'));
  });
  test('members append to their own track only', async () => {
    await start('alice');
    await assertSucceeds(track('bob'));
    await assertFails(track('bob', 'alice'));
    await assertFails(track('mallory'));
  });
  test('a fighter deletes only their own track', async () => {
    await start('alice');
    await track('bob');
    await track('alice');
    await assertFails(deleteDoc(doc(as('bob'), 'teams', TEAM, 'recordings', 'r1', 'tracks', 'alice')));
    await assertSucceeds(deleteDoc(doc(as('bob'), 'teams', TEAM, 'recordings', 'r1', 'tracks', 'bob')));
  });
  test('only commanders stop it', async () => {
    await start('alice');
    await assertFails(updateDoc(doc(as('bob'), 'teams', TEAM, 'recordings', 'r1'), { endedAt: 1 }));
    await assertFails(updateDoc(doc(as('bob'), 'teams', TEAM), { recordingId: null }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'teams', TEAM, 'recordings', 'r1'), { endedAt: 1 }));
  });
});

describe('status, assigned roles and pinned messages', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await join(as('carol'), 'carol');
    await updateDoc(doc(as('alice'), 'teams', TEAM, 'members', 'bob'), { canCommand: true });
  });
  const member = (by: string, uid: string) => doc(as(by), 'teams', TEAM, 'members', uid);
  const pin = (by: string, text = 'Сбор у моста в 14:00') =>
    updateDoc(doc(as(by), 'teams', TEAM), { pinned: { id: 'm1', text, callsign: 'Гром', uid: by, at: 1 } });

  test('members set their own status, only to known values', async () => {
    await assertSucceeds(updateDoc(member('carol', 'carol'), { status: 'dead' }));
    await assertSucceeds(updateDoc(member('carol', 'carol'), { status: 'afk' }));
    await assertFails(updateDoc(member('carol', 'carol'), { status: 'zombie' }));
  });
  test('superiors set role and status of those below them', async () => {
    await assertSucceeds(updateDoc(member('alice', 'carol'), { role: 'medic', status: 'dead' }));
    await assertSucceeds(updateDoc(member('bob', 'carol'), { role: 'sniper' }));
    await assertSucceeds(updateDoc(member('alice', 'bob'), { status: 'alive' }));
  });
  test('nobody edits equals or superiors, and commanders touch nothing else', async () => {
    await assertFails(updateDoc(member('carol', 'bob'), { status: 'dead' }));
    await assertFails(updateDoc(member('bob', 'alice'), { role: 'medic' }));
    await assertFails(updateDoc(member('alice', 'carol'), { role: 'medic', callsign: 'x' }));
    await assertFails(updateDoc(member('alice', 'carol'), { status: 'zombie' }));
  });
  test('commanders pin and unpin; fighters cannot; text is bounded', async () => {
    await assertSucceeds(pin('alice'));
    await assertSucceeds(pin('bob'));
    await assertSucceeds(updateDoc(doc(as('bob'), 'teams', TEAM), { pinned: null }));
    await assertFails(pin('carol'));
    await assertFails(pin('alice', 'x'.repeat(501)));
  });
  test('commanders place the snail grid; fighters cannot; only a lat/lng point', async () => {
    const team = (by: string) => doc(as(by), 'teams', TEAM);
    await assertSucceeds(updateDoc(team('alice'), { grid: { lat: 56.83, lng: 60.61 } }));
    await assertSucceeds(updateDoc(team('bob'), { grid: { lat: 56.84, lng: 60.62 } }));
    await assertSucceeds(updateDoc(team('bob'), { grid: null }));
    await assertFails(updateDoc(team('carol'), { grid: { lat: 56.83, lng: 60.61 } }));
    await assertFails(updateDoc(team('alice'), { grid: { lat: 156, lng: 60.61 } }));
    await assertFails(updateDoc(team('alice'), { grid: { lat: 56.83, lng: 60.61, x: 1 } }));
  });
});

describe('photos of photo markers', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await join(as('carol'), 'carol');
  });
  const photo = (by: string, id: string, createdBy = by, data = 'data:image/jpeg;base64,AAAA') =>
    setDoc(doc(as(by), 'teams', TEAM, 'photos', id), { data, createdBy, createdAt: serverTimestamp() });

  test('members add their own photos, read the squad\'s; outsiders see nothing', async () => {
    await assertSucceeds(photo('bob', 'p1'));
    await assertSucceeds(getDoc(doc(as('carol'), 'teams', TEAM, 'photos', 'p1')));
    await assertFails(getDoc(doc(as('mallory'), 'teams', TEAM, 'photos', 'p1')));
    await assertFails(photo('carol', 'p2', 'bob'));
    await assertFails(photo('bob', 'p3', 'bob', 'data:text/html;base64,AAAA'));
    await assertFails(photo('bob', 'p4', 'bob', 'data:image/jpeg;base64,' + 'A'.repeat(400000)));
  });
  test('the author or a superior deletes a photo', async () => {
    await photo('bob', 'p1');
    await assertFails(deleteDoc(doc(as('carol'), 'teams', TEAM, 'photos', 'p1')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'teams', TEAM, 'photos', 'p1')));
    await photo('carol', 'p2');
    await assertSucceeds(deleteDoc(doc(as('carol'), 'teams', TEAM, 'photos', 'p2')));
  });
});

describe('maps shared with the squad', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await join(as('carol'), 'carol');
  });
  const meta = (by: string, createdBy = by, extra: Record<string, unknown> = {}) =>
    setDoc(doc(as(by), 'teams', TEAM, 'maps', 'm1'), {
      name: 'Полигон',
      format: 'kmz',
      size: 10,
      parts: 1,
      createdBy,
      createdByName: 'x',
      createdAt: serverTimestamp(),
      ...extra,
    });
  const part = (by: string, createdBy = by) =>
    setDoc(doc(as(by), 'teams', TEAM, 'maps', 'm1', 'parts', '00'), { i: 0, data: 'AAAA', createdBy });

  test('members share maps as themselves; the squad reads them, outsiders do not', async () => {
    await assertSucceeds(part('bob'));
    await assertSucceeds(meta('bob'));
    await assertSucceeds(getDoc(doc(as('carol'), 'teams', TEAM, 'maps', 'm1', 'parts', '00')));
    await assertFails(getDoc(doc(as('mallory'), 'teams', TEAM, 'maps', 'm1')));
    await assertFails(setDoc(doc(as('carol'), 'teams', TEAM, 'maps', 'm2'), { name: 'x', format: 'exe', parts: 1, createdBy: 'carol' }));
    await assertFails(setDoc(doc(as('carol'), 'teams', TEAM, 'maps', 'm3'), { name: 'x', format: 'kmz', parts: 11, createdBy: 'carol' }));
  });
  test('the author or a superior takes a map away', async () => {
    await part('bob');
    await meta('bob');
    await assertFails(deleteDoc(doc(as('carol'), 'teams', TEAM, 'maps', 'm1')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'teams', TEAM, 'maps', 'm1')));
    await assertSucceeds(deleteDoc(doc(as('bob'), 'teams', TEAM, 'maps', 'm1', 'parts', '00')));
  });
});

describe('moving markers', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'm1'), marker('bob'));
  });
  const move = (by: string, data: Record<string, unknown>) => updateDoc(doc(as(by), 'teams', TEAM, 'markers', 'm1'), data);

  test('the author moves their marker', async () => {
    await assertSucceeds(move('bob', { lat: 55.1, lng: 37.2 }));
  });
  test('nobody else moves it, not even the squad creator', async () => {
    await assertFails(move('alice', { lat: 55.1, lng: 37.2 }));
  });
  test('moving changes the position only', async () => {
    await assertFails(move('bob', { lat: 55.1, label: 'другое' }));
    await assertFails(move('bob', { lat: 'север' }));
  });
});

describe('chat relayed over Bluetooth', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
  });
  const relay = (by: string, from: string, extra: Record<string, unknown> = {}) =>
    setDoc(doc(as(by), 'teams', TEAM, 'messages', 'm1'), { uid: from, callsign: 'Тень', text: 'Контакт!', createdAt: new Date(), relayedBy: by, ...extra });

  test("a member uploads a squadmate's message, marked as relayed", async () => {
    await assertSucceeds(relay('alice', 'bob'));
  });
  test('no relaying for strangers, outsiders, or without the mark', async () => {
    await assertFails(relay('alice', 'mallory'));
    await assertFails(relay('carol', 'bob'));
    await assertFails(relay('alice', 'bob', { relayedBy: 'bob' }));
  });
  test('the second upload of the same message is refused', async () => {
    await relay('alice', 'bob');
    await assertFails(setDoc(doc(as('bob'), 'teams', TEAM, 'messages', 'm1'), { uid: 'bob', callsign: 'Тень', text: 'Контакт!', createdAt: new Date() }));
  });
});

describe('markers relayed over Bluetooth', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await join(as('carol'), 'carol');
  });
  const relay = (by: string, data: Record<string, unknown>, id = 'r1') =>
    setDoc(doc(as(by), 'teams', TEAM, 'markers', id), { ...data, relayedBy: by });

  test("a member uploads a squadmate's marker", async () => {
    await assertSucceeds(relay('carol', marker('bob')));
  });
  test('relayed orders only from someone who may give them', async () => {
    await assertFails(relay('carol', marker('bob', 'order-attack'), 'o1'));
    await assertSucceeds(relay('carol', marker('alice', 'order-attack'), 'o2'));
  });
  test('no relaying for strangers, outsiders, side orders, or with a forged mark', async () => {
    await assertFails(relay('carol', marker('mallory')));
    await assertFails(setDoc(doc(as('dave'), 'teams', TEAM, 'markers', 'x'), { ...marker('bob'), relayedBy: 'dave' }));
    await assertFails(relay('carol', { ...marker('alice', 'order-attack'), audience: 'commanders' }));
    await assertFails(setDoc(doc(as('carol'), 'teams', TEAM, 'markers', 'y'), { ...marker('bob'), relayedBy: 'bob' }));
  });
  test('own markers cannot carry a relay mark', async () => {
    await assertFails(setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'z'), { ...marker('bob'), relayedBy: 'carol' }));
  });
});

describe('respawn waves', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'resp'), marker('bob', 'respawn'));
    await setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'foe'), marker('bob', 'enemy'));
  });
  const wave = (by: string, id: string, w: unknown) => updateDoc(doc(as(by), 'teams', TEAM, 'markers', id), { wave: w });

  test('commanders set and clear the schedule on respawn markers', async () => {
    await assertSucceeds(wave('alice', 'resp', { every: 900000, start: Date.now() }));
    await assertSucceeds(wave('alice', 'resp', null));
  });
  test('a commander may create a respawn with its schedule; a fighter may not', async () => {
    const w = { every: 600000, start: Date.now() };
    await assertSucceeds(setDoc(doc(as('alice'), 'teams', TEAM, 'markers', 'r2'), { ...marker('alice', 'respawn'), wave: w }));
    await assertFails(setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'r3'), { ...marker('bob', 'respawn'), wave: w }));
    await assertFails(setDoc(doc(as('alice'), 'teams', TEAM, 'markers', 'r4'), { ...marker('alice', 'enemy'), wave: w }));
  });
  test('not fighters, not other markers, not silly intervals', async () => {
    await assertFails(wave('bob', 'resp', { every: 900000, start: 1 }));
    await assertFails(wave('alice', 'foe', { every: 900000, start: 1 }));
    await assertFails(wave('alice', 'resp', { every: 1000, start: 1 }));
    await assertFails(wave('alice', 'resp', { every: 900000, start: 1, extra: true }));
  });
});

describe('control zone / hot zone', () => {
  const zone = { r: 400, hot: 75, every: 600000, start: 1_700_000_000_000, seed: 42 };
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await setDoc(doc(as('alice'), 'teams', TEAM, 'markers', 'hz'), { ...marker('alice', 'hotzone'), zone });
    await setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'foe'), marker('bob', 'enemy'));
  });
  const setZone = (by: string, id: string, z: unknown) => updateDoc(doc(as(by), 'teams', TEAM, 'markers', id), { zone: z });

  test('only commanders place a zone, and only with valid settings', async () => {
    await assertFails(setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'z1'), { ...marker('bob', 'hotzone'), zone }));
    await assertFails(setDoc(doc(as('alice'), 'teams', TEAM, 'markers', 'z2'), marker('alice', 'hotzone')));
    await assertFails(setDoc(doc(as('alice'), 'teams', TEAM, 'markers', 'z3'), { ...marker('alice', 'hotzone'), zone: { ...zone, hot: 900 } }));
    await assertFails(setDoc(doc(as('alice'), 'teams', TEAM, 'markers', 'z4'), { ...marker('alice', 'enemy'), zone }));
  });
  test('commanders change the settings; fighters and other markers cannot', async () => {
    await assertSucceeds(setZone('alice', 'hz', { ...zone, r: 600, seed: 7 }));
    await assertFails(setZone('bob', 'hz', { ...zone, r: 600 }));
    await assertFails(setZone('alice', 'foe', zone));
    await assertFails(setZone('alice', 'hz', { ...zone, every: 1000 }));
    await assertFails(setZone('alice', 'hz', null));
  });
  test('a zone is never relayed over Bluetooth', async () => {
    await assertFails(
      setDoc(doc(as('bob'), 'teams', TEAM, 'markers', 'z5'), { ...marker('alice', 'hotzone'), zone, relayedBy: 'bob' })
    );
  });
});

describe('team game', () => {
  beforeEach(async () => {
    await createTeam(as('alice'), 'alice');
    await join(as('bob'), 'bob');
    await join(as('carol'), 'carol');
    await updateDoc(doc(as('alice'), 'teams', TEAM, 'members', 'bob'), { canCommand: true });
  });
  const factions = [{ name: 'Красные', color: '#FF4D4D' }, { name: 'Синие', color: '#3D9BFF' }];

  test('only the creator sets up teams', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'teams', TEAM), { factions }));
    await assertFails(updateDoc(doc(as('bob'), 'teams', TEAM), { factions: factions.slice(0, 1) }));
    await assertFails(updateDoc(doc(as('alice'), 'teams', TEAM), { factions: Array(7).fill(factions[0]) }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'teams', TEAM), { factions: null }));
  });
  test('only the creator puts players into teams; nobody switches their own team', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'teams', TEAM, 'members', 'carol'), { faction: 1 }));
    await assertFails(updateDoc(doc(as('bob'), 'teams', TEAM, 'members', 'carol'), { faction: 0 }));
    await assertFails(updateDoc(doc(as('carol'), 'teams', TEAM, 'members', 'carol'), { faction: 0 }));
    await assertFails(updateDoc(doc(as('alice'), 'teams', TEAM, 'members', 'carol'), { faction: 6 }));
  });
  test('players add their own points', async () => {
    await assertSucceeds(updateDoc(doc(as('carol'), 'teams', TEAM, 'members', 'carol'), { 'pts.z1': increment(2) }));
    await assertFails(updateDoc(doc(as('carol'), 'teams', TEAM, 'members', 'bob'), { 'pts.z1': increment(2) }));
  });
  test('mortar crews set their own range', async () => {
    await assertSucceeds(updateDoc(doc(as('carol'), 'teams', TEAM, 'members', 'carol'), { role: 'mortar', range: 200 }));
    await assertFails(updateDoc(doc(as('carol'), 'teams', TEAM, 'members', 'carol'), { range: 0 }));
    await assertFails(updateDoc(doc(as('carol'), 'teams', TEAM, 'members', 'carol'), { range: '200' }));
    await assertFails(updateDoc(doc(as('carol'), 'teams', TEAM, 'members', 'bob'), { range: 150 }));
  });
});
