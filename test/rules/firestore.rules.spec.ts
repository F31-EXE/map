// Security-rules tests. Need the Firestore emulator: `npm run test:rules`.
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
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
  test('plain members cannot cancel orders but can clear markers', async () => {
    await order('alice', 'o1');
    await setDoc(doc(as('alice'), 'teams', TEAM, 'markers', 'm1'), marker('alice'));
    await assertFails(deleteDoc(doc(as('carol'), 'teams', TEAM, 'markers', 'o1')));
    await assertSucceeds(deleteDoc(doc(as('carol'), 'teams', TEAM, 'markers', 'm1')));
    await grant('alice', 'carol');
    await assertSucceeds(deleteDoc(doc(as('carol'), 'teams', TEAM, 'markers', 'o1')));
  });
});
