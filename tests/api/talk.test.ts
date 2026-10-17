import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { asAdmin, backdateUser, makeTestApp, signUp, type SignedUp, type TestApp } from '../helpers.js';
import type { Db } from '../../server/db.js';
import type {
  LinkedTopicsResponse, RepliesResponse, ReplyResponse, TopicListResponse, TopicResponse, UpvoteResponse, VoteResponse,
} from '../../shared/types/talk.js';

interface ErrorBody { error: string; code?: string; field?: string }

let slugCounter = 0;
async function insertListing(db: Db, userId: string, opts: { name?: string; hidden?: boolean; kind?: 'place' | 'product' | 'service' } = {}): Promise<string> {
  slugCounter++;
  const name = opts.name ?? `Test Place ${slugCounter}`;
  const kind = opts.kind ?? 'place';
  const row = await db.one<{ id: string }>(
    `INSERT INTO listings (kind, name, slug, vegan_status, created_by, hidden)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [kind, name, `test-${slugCounter}-${Date.now()}`, kind === 'product' ? 'vegan_product' : 'fully_vegan', userId, opts.hidden ?? false],
  );
  return row.id;
}

/** Members that exist only to cast upvotes in ranking tests. System accounts skip the login columns. */
async function insertVoters(db: Db, n: number, tag: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const row = await db.one<{ id: string }>(
      `INSERT INTO users (pseudonym, is_system) VALUES ($1, true) RETURNING id`,
      [`Voter ${tag} ${i} ${Date.now()}`],
    );
    ids.push(row.id);
  }
  return ids;
}

async function createDiscussion(m: SignedUp, extra: Record<string, unknown> = {}) {
  const res = await m.agent.post<TopicResponse>('/api/talk/topics', { kind: 'discussion', title: 'Best tofu scramble in Dubai?', ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.topic;
}

async function createPoll(m: SignedUp, extra: Record<string, unknown> = {}) {
  const res = await m.agent.post<TopicResponse>('/api/talk/topics', {
    kind: 'poll', title: 'Which area needs more vegan options?', options: ['Marina', 'Deira', 'JLT'], ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.topic;
}

describe('talk: create discussions and polls', () => {
  let app: TestApp;
  let alice: SignedUp;
  before(async () => {
    app = await makeTestApp();
    alice = await signUp(app.agent());
    await backdateUser(app.db, alice.user.id, 48);
  });
  after(async () => { await app.close(); });

  test('creates a discussion with tags and linked listings, and returns it in full', async () => {
    const a = await insertListing(app.db, alice.user.id, { name: 'Tofu House' });
    const b = await insertListing(app.db, alice.user.id, { name: 'Soy Shop', kind: 'product' });
    const topic = await createDiscussion(alice, {
      body: 'Looking for the best one.\nSecond line here.',
      tags: ['  Breakfast ', 'tofu', 'TOFU'],
      listingIds: [a, b],
    });
    assert.equal(topic.kind, 'discussion');
    assert.equal(topic.title, 'Best tofu scramble in Dubai?');
    assert.equal(topic.excerpt, 'Looking for the best one.');
    assert.deepEqual(topic.tags, ['breakfast', 'tofu']);
    assert.deepEqual(topic.listings.map((l) => l.name), ['Tofu House', 'Soy Shop']);
    assert.deepEqual(topic.listings.map((l) => l.kind), ['place', 'product']);
    assert.ok(topic.listings[0].slug);
    assert.equal(topic.author.name, alice.user.pseudonym);
    assert.equal(topic.mine, true);
    assert.equal(topic.poll, null);
    assert.equal(topic.replyCount, 0);
    assert.equal(topic.upvotes, 0);
  });

  test('rejects bad discussions with a readable 400', async () => {
    const hidden = await insertListing(app.db, alice.user.id, { hidden: true });
    const l1 = await insertListing(app.db, alice.user.id);
    const l2 = await insertListing(app.db, alice.user.id);
    const l3 = await insertListing(app.db, alice.user.id);
    const l4 = await insertListing(app.db, alice.user.id);
    const cases: [Record<string, unknown>, string][] = [
      [{ kind: 'discussion', title: 'Hey' }, 'title'],
      [{ kind: 'discussion', title: 'x'.repeat(121) }, 'title'],
      [{ kind: 'discussion', title: 'A fine title', body: 'x'.repeat(4001) }, 'body'],
      [{ kind: 'discussion', title: 'A fine title', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'tags'],
      [{ kind: 'discussion', title: 'A fine title', tags: ['<script>'] }, 'tags.0'],
      [{ kind: 'discussion', title: 'A fine title', listingIds: [l1, l2, l3, l4] }, 'listingIds'],
      [{ kind: 'discussion', title: 'A fine title', listingIds: [hidden] }, 'listingIds'],
      [{ kind: 'discussion', title: 'A fine title', listingIds: ['00000000-0000-4000-8000-0000000000ff'] }, 'listingIds'],
      [{ kind: 'discussion', title: 'A fine title', listingIds: ['not-an-id'] }, 'listingIds.0'],
      [{ kind: 'essay', title: 'A fine title' }, 'kind'],
    ];
    for (const [body, field] of cases) {
      const res = await alice.agent.post<ErrorBody>('/api/talk/topics', body);
      assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 80)} -> ${res.status}`);
      assert.equal(res.body.field, field, `${JSON.stringify(body).slice(0, 80)} -> ${JSON.stringify(res.body)}`);
      assert.ok(res.body.error.length > 0);
    }
  });

  test('creates a poll that closes in 7 days by default, or after the chosen duration', async () => {
    const poll = await createPoll(alice);
    assert.equal(poll.kind, 'poll');
    assert.ok(poll.poll);
    assert.deepEqual(poll.poll.options.map((o) => o.label), ['Marina', 'Deira', 'JLT']);
    assert.equal(poll.poll.resultsVisible, false);
    assert.equal(poll.poll.options[0].votes, undefined);
    const days = (Date.parse(poll.poll.closesAt) - Date.now()) / 86_400_000;
    assert.ok(days > 6.99 && days <= 7, `closes in ${days} days`);
    const short = await createPoll(alice, { durationDays: 3 });
    const shortDays = (Date.parse(short.poll!.closesAt) - Date.now()) / 86_400_000;
    assert.ok(shortDays > 2.99 && shortDays <= 3);
    const at = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const exact = await createPoll(alice, { closesAt: at });
    assert.equal(exact.poll!.closesAt, at);
  });

  test('rejects bad polls with a readable 400', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ options: ['Only one'] }, 'options'],
      [{ options: ['1', '2', '3', '4', '5', '6', '7'] }, 'options'],
      [{ options: ['Fine', '   '] }, 'options.1'],
      [{ options: ['Fine', 'x'.repeat(81)] }, 'options.1'],
      [{ options: ['Same', 'same'] }, 'options'],
      [{ options: ['A', 'B'], durationDays: 31 }, 'durationDays'],
      [{ options: ['A', 'B'], durationDays: 0 }, 'durationDays'],
      [{ options: ['A', 'B'], closesAt: new Date(Date.now() + 40 * 86_400_000).toISOString() }, 'closesAt'],
      [{ options: ['A', 'B'], closesAt: new Date(Date.now() - 1000).toISOString() }, 'closesAt'],
      [{ options: ['A', 'B'], title: 'No' }, 'title'],
    ];
    for (const [extra, field] of cases) {
      const res = await alice.agent.post<ErrorBody>('/api/talk/topics', { kind: 'poll', title: 'A good question', ...extra });
      assert.equal(res.status, 400, `${JSON.stringify(extra).slice(0, 80)} -> ${res.status}`);
      assert.equal(res.body.field, field, `${JSON.stringify(extra).slice(0, 80)} -> ${JSON.stringify(res.body)}`);
    }
    const missing = await alice.agent.post<ErrorBody>('/api/talk/topics', { kind: 'poll', title: 'A good question' });
    assert.equal(missing.status, 400);
  });

  test('rejects contact details in a title, body, tag or poll option', async () => {
    for (const extra of [
      { title: 'Call me on +971 50 123 4567' },
      { body: 'Email me at someone@example.com' },
      { tags: ['0501234567890'] },
    ]) {
      const res = await alice.agent.post<ErrorBody>('/api/talk/topics', { kind: 'discussion', title: 'A fine title', ...extra });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'contact_details');
    }
    const poll = await alice.agent.post<ErrorBody>('/api/talk/topics', { kind: 'poll', title: 'A good question', options: ['Fine', 'ring 050 123 4567'] });
    assert.equal(poll.status, 400);
    assert.equal(poll.body.code, 'contact_details');
  });

  test('an account under a day old can start 5 topics a day', async () => {
    const fresh = await signUp(app.agent());
    for (let i = 0; i < 5; i++) await createDiscussion(fresh, { title: `Fresh topic ${i}` });
    const sixth = await fresh.agent.post<ErrorBody>('/api/talk/topics', { kind: 'discussion', title: 'One too many' });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.code, 'daily_cap');
  });
});

describe('talk: poll votes', () => {
  let app: TestApp;
  let alice: SignedUp;
  let bob: SignedUp;
  before(async () => {
    app = await makeTestApp();
    alice = await signUp(app.agent());
    await backdateUser(app.db, alice.user.id, 48);
    bob = await signUp(app.agent());
  });
  after(async () => { await app.close(); });

  test('results stay hidden until the member votes, then show; one vote each, changeable', async () => {
    const poll = await createPoll(alice);
    const [marina, deira] = poll.poll!.options;

    const first = await alice.agent.post<VoteResponse>(`/api/talk/topics/${poll.id}/vote`, { optionId: marina.id });
    assert.equal(first.status, 200);
    assert.equal(first.body.poll.myVote, marina.id);
    assert.equal(first.body.poll.resultsVisible, true);
    assert.deepEqual(first.body.poll.options.map((o) => o.votes), [1, 0, 0]);

    // Bob has not voted: labels only, not even the total.
    const bobView = await bob.agent.get<TopicResponse>(`/api/talk/topics/${poll.id}`);
    assert.equal(bobView.body.topic.poll!.resultsVisible, false);
    assert.equal(bobView.body.topic.poll!.totalVotes, undefined);
    assert.ok(bobView.body.topic.poll!.options.every((o) => o.votes === undefined));
    assert.deepEqual(bobView.body.topic.poll!.options.map((o) => o.label), ['Marina', 'Deira', 'JLT']);

    // Signed out: the same, and in the list too.
    const anon = app.agent();
    const anonView = await anon.get<TopicResponse>(`/api/talk/topics/${poll.id}`);
    assert.equal(anonView.status, 200);
    assert.equal(anonView.body.topic.poll!.resultsVisible, false);
    assert.ok(anonView.body.topic.poll!.options.every((o) => o.votes === undefined));
    const list = await anon.get<TopicListResponse>('/api/talk/topics?sort=new');
    const inList = list.body.items.find((t) => t.id === poll.id)!;
    assert.ok(inList.poll!.options.every((o) => o.votes === undefined));

    // Bob votes and now sees results.
    const bobVote = await bob.agent.post<VoteResponse>(`/api/talk/topics/${poll.id}/vote`, { optionId: marina.id });
    assert.deepEqual(bobVote.body.poll.options.map((o) => o.votes), [2, 0, 0]);

    // Alice changes her vote: still one vote per member.
    const change = await alice.agent.post<VoteResponse>(`/api/talk/topics/${poll.id}/vote`, { optionId: deira.id });
    assert.equal(change.status, 200);
    assert.equal(change.body.poll.myVote, deira.id);
    assert.deepEqual(change.body.poll.options.map((o) => o.votes), [1, 1, 0]);
    assert.equal(change.body.poll.totalVotes, 2);
    const again = await alice.agent.post<VoteResponse>(`/api/talk/topics/${poll.id}/vote`, { optionId: deira.id });
    assert.equal(again.body.poll.totalVotes, 2);
    const rows = await app.db.query('SELECT 1 FROM poll_votes WHERE topic_id = $1', [poll.id]);
    assert.equal(rows.length, 2);

    // Undo withdraws the vote, and results hide again.
    const undo = await bob.agent.delete<VoteResponse>(`/api/talk/topics/${poll.id}/vote`);
    assert.equal(undo.status, 200);
    assert.equal(undo.body.poll.myVote, null);
    assert.equal(undo.body.poll.resultsVisible, false);
    assert.equal(undo.body.poll.totalVotes, undefined);
  });

  test('a vote after close is rejected with 409, and results then show to everyone', async () => {
    const poll = await createPoll(alice);
    const [a] = poll.poll!.options;
    await alice.agent.post(`/api/talk/topics/${poll.id}/vote`, { optionId: a.id });
    await app.db.query(`UPDATE topics SET closes_at = now() - interval '1 minute' WHERE id = $1`, [poll.id]);
    const late = await bob.agent.post<ErrorBody>(`/api/talk/topics/${poll.id}/vote`, { optionId: a.id });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'poll_closed');
    const change = await alice.agent.post<ErrorBody>(`/api/talk/topics/${poll.id}/vote`, { optionId: poll.poll!.options[1].id });
    assert.equal(change.status, 409);
    const anon = await app.agent().get<TopicResponse>(`/api/talk/topics/${poll.id}`);
    assert.equal(anon.body.topic.poll!.closed, true);
    assert.equal(anon.body.topic.poll!.resultsVisible, true);
    assert.deepEqual(anon.body.topic.poll!.options.map((o) => o.votes), [1, 0, 0]);
  });

  test('a vote must name an option of that poll, on a poll', async () => {
    const poll = await createPoll(alice);
    const other = await createPoll(alice);
    const wrong = await bob.agent.post<ErrorBody>(`/api/talk/topics/${poll.id}/vote`, { optionId: other.poll!.options[0].id });
    assert.equal(wrong.status, 400);
    const discussion = await createDiscussion(alice);
    const notPoll = await bob.agent.post<ErrorBody>(`/api/talk/topics/${discussion.id}/vote`, { optionId: poll.poll!.options[0].id });
    assert.equal(notPoll.status, 400);
    assert.equal(notPoll.body.code, 'not_a_poll');
    const signedOut = await app.agent().post(`/api/talk/topics/${poll.id}/vote`, { optionId: poll.poll!.options[0].id });
    assert.equal(signedOut.status, 401);
  });
});

describe('talk: replies and upvotes', () => {
  let app: TestApp;
  let alice: SignedUp;
  let bob: SignedUp;
  before(async () => {
    app = await makeTestApp();
    alice = await signUp(app.agent());
    await backdateUser(app.db, alice.user.id, 48);
    bob = await signUp(app.agent());
  });
  after(async () => { await app.close(); });

  test('a reply to a reply attaches to its top level parent', async () => {
    const topic = await createDiscussion(alice);
    const top = await bob.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, body: 'Try the place in JLT.' });
    assert.equal(top.status, 201);
    assert.equal(top.body.reply.parentId, null);
    const child = await alice.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, parentId: top.body.reply.id, body: 'Which one?' });
    assert.equal(child.body.reply.parentId, top.body.reply.id);
    const grandchild = await bob.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, parentId: child.body.reply.id, body: 'The one near the metro.' });
    assert.equal(grandchild.status, 201);
    assert.equal(grandchild.body.reply.parentId, top.body.reply.id, 'flattened to one level');

    const thread = await app.agent().get<RepliesResponse>(`/api/talk/replies?target_type=topic&target_id=${topic.id}`);
    assert.equal(thread.status, 200);
    assert.equal(thread.body.items.length, 1);
    assert.deepEqual(thread.body.items[0].replies.map((r) => r.body), ['Which one?', 'The one near the metro.']);
    assert.equal(thread.body.total, 3);
    const detail = await app.agent().get<TopicResponse>(`/api/talk/topics/${topic.id}`);
    assert.equal(detail.body.topic.replyCount, 3);
  });

  test('a parent from another thread is refused', async () => {
    const t1 = await createDiscussion(alice);
    const t2 = await createDiscussion(alice);
    const r1 = await bob.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'topic', targetId: t1.id, body: 'Hello' });
    const res = await bob.agent.post<ErrorBody>('/api/talk/replies', { targetType: 'topic', targetId: t2.id, parentId: r1.body.reply.id, body: 'Hi' });
    assert.equal(res.status, 404);
  });

  test('replies work on listings too', async () => {
    const listing = await insertListing(app.db, alice.user.id);
    const res = await bob.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'listing', targetId: listing, body: 'Great falafel.' });
    assert.equal(res.status, 201);
    const thread = await app.agent().get<RepliesResponse>(`/api/talk/replies?target_type=listing&target_id=${listing}`);
    assert.equal(thread.body.items.length, 1);
    const missing = await bob.agent.post('/api/talk/replies', { targetType: 'listing', targetId: '00000000-0000-4000-8000-0000000000ff', body: 'Hi' });
    assert.equal(missing.status, 404);
  });

  test('reply validation: empty, too long, contact details', async () => {
    const topic = await createDiscussion(alice);
    const empty = await bob.agent.post<ErrorBody>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, body: '   ' });
    assert.equal(empty.status, 400);
    const long = await bob.agent.post<ErrorBody>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, body: 'x'.repeat(2001) });
    assert.equal(long.status, 400);
    const contact = await bob.agent.post<ErrorBody>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, body: 'WhatsApp me on 050 123 4567' });
    assert.equal(contact.status, 400);
    assert.equal(contact.body.code, 'contact_details');
    const email = await bob.agent.post<ErrorBody>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, body: 'write to bob (at) mail (dot) com' });
    assert.equal(email.status, 400);
    assert.equal(email.body.code, 'contact_details');
  });

  test('a reply upvote toggles once per member', async () => {
    const topic = await createDiscussion(alice);
    const reply = await bob.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, body: 'Worth it.' });
    const path = `/api/talk/replies/${reply.body.reply.id}/upvote`;
    const on = await alice.agent.post<UpvoteResponse>(path);
    assert.deepEqual(on.body, { upvoted: true, upvotes: 1 });
    const bobOn = await bob.agent.post<UpvoteResponse>(path);
    assert.deepEqual(bobOn.body, { upvoted: true, upvotes: 2 });
    const off = await alice.agent.post<UpvoteResponse>(path);
    assert.deepEqual(off.body, { upvoted: false, upvotes: 1 });
    const rows = await app.db.query(`SELECT 1 FROM upvotes WHERE target_type = 'reply' AND target_id = $1`, [reply.body.reply.id]);
    assert.equal(rows.length, 1);
    const thread = await bob.agent.get<RepliesResponse>(`/api/talk/replies?target_type=topic&target_id=${topic.id}`);
    assert.equal(thread.body.items[0].upvotes, 1);
    assert.equal(thread.body.items[0].upvoted, true);
  });

  test('a topic upvote toggles too', async () => {
    const topic = await createDiscussion(alice);
    const on = await bob.agent.post<UpvoteResponse>(`/api/talk/topics/${topic.id}/upvote`);
    assert.deepEqual(on.body, { upvoted: true, upvotes: 1 });
    const off = await bob.agent.post<UpvoteResponse>(`/api/talk/topics/${topic.id}/upvote`);
    assert.deepEqual(off.body, { upvoted: false, upvotes: 0 });
  });

  test('a member deletes only their own reply, and it shows as Deleted', async () => {
    const topic = await createDiscussion(alice);
    const reply = await bob.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, body: 'Oops, wrong thread.' });
    const child = await alice.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, parentId: reply.body.reply.id, body: 'No worries.' });
    assert.equal(child.status, 201);
    const notMine = await alice.agent.delete<ErrorBody>(`/api/talk/replies/${reply.body.reply.id}`);
    assert.equal(notMine.status, 403);
    const del = await bob.agent.delete(`/api/talk/replies/${reply.body.reply.id}`);
    assert.equal(del.status, 200);
    const thread = await app.agent().get<RepliesResponse>(`/api/talk/replies?target_type=topic&target_id=${topic.id}`);
    const shown = thread.body.items[0];
    assert.equal(shown.deleted, true);
    assert.equal(shown.body, '');
    assert.equal(shown.author, null);
    assert.equal(shown.replies.length, 1, 'answers keep their place');
    const stored = await app.db.one<{ body: string }>('SELECT body FROM replies WHERE id = $1', [reply.body.reply.id]);
    assert.equal(stored.body, '', 'the text is gone from the database');
    const upvote = await alice.agent.post(`/api/talk/replies/${reply.body.reply.id}/upvote`);
    assert.equal(upvote.status, 404);
  });
});

describe('talk: Hot and New ordering', () => {
  let app: TestApp;
  let alice: SignedUp;
  before(async () => {
    app = await makeTestApp();
    alice = await signUp(app.agent());
    await backdateUser(app.db, alice.user.id, 48);
  });
  after(async () => { await app.close(); });

  async function backdate(topicId: string, hours: number) {
    await app.db.query(`UPDATE topics SET created_at = now() - make_interval(hours => $2) WHERE id = $1`, [topicId, hours]);
  }
  async function upvote(topicId: string, voters: string[]) {
    for (const v of voters) await app.db.query(`INSERT INTO upvotes (target_type, target_id, user_id) VALUES ('topic', $1, $2)`, [topicId, v]);
  }

  test('a fresher topic with equal votes ranks first, and a heavily upvoted topic from earlier today beats a fresh empty one', async () => {
    const voters = await insertVoters(app.db, 25, 'hot');
    const older = await createDiscussion(alice, { title: 'Older equal', tags: ['ranking'] });
    const fresher = await createDiscussion(alice, { title: 'Fresher equal', tags: ['ranking'] });
    await backdate(older.id, 6);
    await backdate(fresher.id, 1);
    await upvote(older.id, voters.slice(0, 3));
    await upvote(fresher.id, voters.slice(0, 3));

    const popular = await createDiscussion(alice, { title: 'Popular this morning', tags: ['ranking'] });
    const empty = await createDiscussion(alice, { title: 'Fresh and empty', tags: ['ranking'] });
    await backdate(popular.id, 12);
    await upvote(popular.id, voters);

    const hot = await app.agent().get<TopicListResponse>('/api/talk/topics?sort=hot&tag=ranking');
    assert.equal(hot.status, 200);
    const order = hot.body.items.map((t) => t.title);
    assert.ok(order.indexOf('Fresher equal') < order.indexOf('Older equal'), order.join(' > '));
    assert.ok(order.indexOf('Popular this morning') < order.indexOf('Fresh and empty'), order.join(' > '));
    assert.equal(hot.body.items.find((t) => t.title === 'Popular this morning')!.upvotes, 25);
    assert.equal(hot.body.items.find((t) => t.id === empty.id)!.upvotes, 0);

    const fresh = await app.agent().get<TopicListResponse>('/api/talk/topics?sort=new&tag=ranking');
    assert.deepEqual(fresh.body.items.map((t) => t.title), ['Fresh and empty', 'Fresher equal', 'Older equal', 'Popular this morning']);
  });

  test('replies count towards Hot at half an upvote', async () => {
    const bob = await signUp(app.agent());
    const quiet = await createDiscussion(alice, { title: 'Quiet', tags: ['replies'] });
    const busy = await createDiscussion(alice, { title: 'Busy', tags: ['replies'] });
    await backdate(quiet.id, 1);
    await backdate(busy.id, 2);
    for (let i = 0; i < 4; i++) await bob.agent.post('/api/talk/replies', { targetType: 'topic', targetId: busy.id, body: `Reply ${i}` });
    const hot = await app.agent().get<TopicListResponse>('/api/talk/topics?sort=hot&tag=replies');
    assert.deepEqual(hot.body.items.map((t) => t.title), ['Busy', 'Quiet']);
    assert.equal(hot.body.items[0].replyCount, 4);
  });

  test('cursor pagination walks every topic once, in both sorts', async () => {
    for (let i = 0; i < 7; i++) await createDiscussion(alice, { title: `Page item ${i}`, tags: ['paging'] });
    for (const sort of ['new', 'hot']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url: string = `/api/talk/topics?sort=${sort}&tag=paging&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await app.agent().get<TopicListResponse>(url);
        assert.equal(res.status, 200);
        seen.push(...res.body.items.map((t) => t.id));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      assert.equal(pages, 3, sort);
      assert.equal(seen.length, 7, sort);
      assert.equal(new Set(seen).size, 7, sort);
    }
    const bad = await app.agent().get<ErrorBody>('/api/talk/topics?sort=new&cursor=garbage');
    assert.equal(bad.status, 400);
  });
});

describe('talk: access, pins and hiding', () => {
  let app: TestApp;
  let alice: SignedUp;
  let admin: SignedUp;
  before(async () => {
    app = await makeTestApp();
    alice = await signUp(app.agent());
    await backdateUser(app.db, alice.user.id, 48);
    admin = await asAdmin(app);
  });
  after(async () => { await app.close(); });

  test('signed out visitors can read but every write is 401', async () => {
    const topic = await createDiscussion(alice);
    const anon = app.agent();
    assert.equal((await anon.get('/api/talk/topics')).status, 200);
    assert.equal((await anon.get(`/api/talk/topics/${topic.id}`)).status, 200);
    assert.equal((await anon.get(`/api/talk/replies?target_type=topic&target_id=${topic.id}`)).status, 200);
    assert.equal((await anon.get('/api/talk/tags')).status, 200);
    const writes = [
      anon.post('/api/talk/topics', { kind: 'discussion', title: 'A fine title' }),
      anon.post(`/api/talk/topics/${topic.id}/upvote`),
      anon.post('/api/talk/replies', { targetType: 'topic', targetId: topic.id, body: 'Hi' }),
      anon.post(`/api/talk/topics/${topic.id}/pin`, { pinned: true }),
    ];
    for (const res of await Promise.all(writes)) assert.equal(res.status, 401);
  });

  test('pinning needs an admin, and pinned topics come first in Hot and New', async () => {
    const pinMe = await createDiscussion(alice, { title: 'Introduce yourself', tags: ['pins'] });
    await app.db.query(`UPDATE topics SET created_at = now() - interval '20 days' WHERE id = $1`, [pinMe.id]);
    await createDiscussion(alice, { title: 'Something newer', tags: ['pins'] });
    const member = await alice.agent.post<ErrorBody>(`/api/talk/topics/${pinMe.id}/pin`, { pinned: true });
    assert.equal(member.status, 403);
    const ok = await admin.agent.post<{ pinned: boolean }>(`/api/talk/topics/${pinMe.id}/pin`, { pinned: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.pinned, true);
    for (const sort of ['hot', 'new']) {
      const list = await app.agent().get<TopicListResponse>(`/api/talk/topics?sort=${sort}&tag=pins`);
      assert.equal(list.body.items[0].title, 'Introduce yourself', sort);
      assert.equal(list.body.items[0].pinned, true);
    }
    const logged = await app.db.query(`SELECT 1 FROM audit WHERE action = 'topic.pin' AND target_id = $1`, [pinMe.id]);
    assert.equal(logged.length, 1);
    const unpin = await admin.agent.post<{ pinned: boolean }>(`/api/talk/topics/${pinMe.id}/pin`, { pinned: false });
    assert.equal(unpin.body.pinned, false);
  });

  test('hidden topics and replies are shown to admins only', async () => {
    const topic = await createDiscussion(alice, { title: 'Hidden one', tags: ['hiding'] });
    const reply = await alice.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'topic', targetId: topic.id, body: 'A reply' });
    const visible = await createDiscussion(alice, { title: 'Visible one', tags: ['hiding'] });
    const hiddenReply = await alice.agent.post<ReplyResponse>('/api/talk/replies', { targetType: 'topic', targetId: visible.id, body: 'Hidden reply' });
    await app.db.query('UPDATE topics SET hidden = true WHERE id = $1', [topic.id]);
    await app.db.query('UPDATE replies SET hidden = true WHERE id = $1', [hiddenReply.body.reply.id]);

    const list = await alice.agent.get<TopicListResponse>('/api/talk/topics?sort=new&tag=hiding');
    assert.deepEqual(list.body.items.map((t) => t.title), ['Visible one']);
    assert.equal((await alice.agent.get(`/api/talk/topics/${topic.id}`)).status, 404);
    assert.equal((await app.agent().get(`/api/talk/replies?target_type=topic&target_id=${topic.id}`)).status, 404);
    assert.equal((await alice.agent.post(`/api/talk/replies/${reply.body.reply.id}/upvote`)).status, 404);
    const thread = await alice.agent.get<RepliesResponse>(`/api/talk/replies?target_type=topic&target_id=${visible.id}`);
    assert.equal(thread.body.items.length, 0);

    const adminView = await admin.agent.get<TopicResponse>(`/api/talk/topics/${topic.id}`);
    assert.equal(adminView.status, 200);
    assert.equal(adminView.body.topic.hidden, true);
    const adminThread = await admin.agent.get<RepliesResponse>(`/api/talk/replies?target_type=topic&target_id=${visible.id}`);
    assert.equal(adminThread.body.items[0].hidden, true);
  });

  test('linked topics list up to three discussions about a listing, and hide hidden listings', async () => {
    const listing = await insertListing(app.db, alice.user.id, { name: 'Linked Cafe' });
    for (let i = 0; i < 4; i++) await createDiscussion(alice, { title: `About the cafe ${i}`, listingIds: [listing] });
    const linked = await app.agent().get<LinkedTopicsResponse>(`/api/talk/linked?listing_id=${listing}`);
    assert.equal(linked.status, 200);
    assert.equal(linked.body.items.length, 3);
    assert.equal(linked.body.total, 4);
    assert.equal(linked.body.items[0].title, 'About the cafe 3');
    const bad = await app.agent().get('/api/talk/linked?listing_id=nope');
    assert.equal(bad.status, 400);

    const topicId = linked.body.items[0].id;
    await app.db.query('UPDATE listings SET hidden = true WHERE id = $1', [listing]);
    const detail = await alice.agent.get<TopicResponse>(`/api/talk/topics/${topicId}`);
    assert.deepEqual(detail.body.topic.listings, []);
  });

  test('a deleted account shows as Former member', async () => {
    const leaver = await signUp(app.agent());
    const topic = await createDiscussion(leaver, { title: 'Leaving soon' });
    await app.db.query('UPDATE users SET deleted_at = now() WHERE id = $1', [leaver.user.id]);
    const detail = await app.agent().get<TopicResponse>(`/api/talk/topics/${topic.id}`);
    assert.deepEqual(detail.body.topic.author, { name: 'Former member', former: true });
  });

  test('unknown or malformed ids are 404, never 500', async () => {
    assert.equal((await app.agent().get('/api/talk/topics/not-a-uuid')).status, 404);
    assert.equal((await app.agent().get('/api/talk/topics/00000000-0000-4000-8000-0000000000ff')).status, 404);
    assert.equal((await alice.agent.post('/api/talk/topics/xyz/upvote')).status, 404);
  });
});
