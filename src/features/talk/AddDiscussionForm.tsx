// Start a discussion. Route: /add/discussion, already signed in (RequireAccount).
// ?listing=<id>&name=&slug=&kind= preselects a linked listing ("Start a discussion about this").
// Default export required: AddRoute lazy loads it.
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { TOPIC_BODY_MAX, TOPIC_TITLE_MAX, TOPIC_TITLE_MIN, type LinkedListing, type ListingKind } from '../../../shared/types/talk';
import { Button, Field, StickyBar, TopBar, useToast } from '../../ui';
import { useCreateTopic } from './api';
import { fieldError, formError, ListingPicker, TagInput } from './fields';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: ListingKind[] = ['place', 'product', 'service'];

function preselected(params: URLSearchParams): LinkedListing[] {
  const id = params.get('listing');
  if (!id || !GUID.test(id)) return [];
  const kind = params.get('kind') as ListingKind | null;
  return [{ id, name: params.get('name') || 'Linked listing', slug: params.get('slug') ?? '', kind: kind && KINDS.includes(kind) ? kind : 'place' }];
}

export default function AddDiscussionForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateTopic();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [listings, setListings] = useState<LinkedListing[]>(() => preselected(params));
  const [touched, setTouched] = useState(false);

  const titleShort = title.trim().length < TOPIC_TITLE_MIN;
  const localTitleError = touched && titleShort ? `Use at least ${TOPIC_TITLE_MIN} characters for the title.` : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (titleShort || create.isPending) return;
    create.mutate(
      { kind: 'discussion', title: title.trim(), body: body.trim() || null, tags, listingIds: listings.map((l) => l.id) },
      {
        onSuccess: ({ topic }) => {
          toast.show({ success: true, message: 'Discussion started' });
          navigate(`/talk/${topic.id}`, { replace: true });
        },
      },
    );
  };

  const err = create.error;
  const general = formError(err, ['title', 'body', 'tags', 'listingIds']);

  return (
    <>
      <TopBar title="Start a discussion" back />
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title && setTouched(true)}
          maxLength={TOPIC_TITLE_MAX}
          placeholder="e.g. Best vegan biryani in Dubai?"
          error={localTitleError ?? fieldError(err, 'title')}
          autoFocus
        />
        <Field
          multiline
          label="Details (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={TOPIC_BODY_MAX}
          placeholder="Add context, what you tried, what you are looking for"
          hint="No phone numbers or emails, please."
          error={fieldError(err, 'body')}
        />
        <TagInput value={tags} onChange={setTags} error={fieldError(err, 'tags')} />
        <ListingPicker value={listings} onChange={setListings} error={fieldError(err, 'listingIds')} />
        <StickyBar>
          {general && <p role="alert" className="text-sm font-semibold text-danger">{general}</p>}
          <Button type="submit" block busy={create.isPending} busyLabel="Posting">Post discussion</Button>
        </StickyBar>
      </form>
    </>
  );
}
