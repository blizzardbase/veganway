// Start a poll. Route: /add/poll, already signed in (RequireAccount).
// Default export required: AddRoute lazy loads it.
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Plus, X } from 'lucide-react';
import {
  POLL_OPTION_MAX, POLL_OPTIONS_MAX, POLL_OPTIONS_MIN, TOPIC_TITLE_MAX, TOPIC_TITLE_MIN,
} from '../../../shared/types/talk';
import { ApiError } from '../../api/client';
import { Button, Chip, ChipRow, Field, IconButton, StickyBar, TopBar, useToast } from '../../ui';
import { useCreateTopic } from './api';
import { fieldError, formError } from './fields';

const DURATIONS = [1, 3, 7, 14] as const;

export default function AddPollForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateTopic();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<{ key: number; text: string }[]>([{ key: 1, text: '' }, { key: 2, text: '' }]);
  const [days, setDays] = useState<(typeof DURATIONS)[number]>(7);
  const [touched, setTouched] = useState(false);
  const nextKey = useRef(3);

  const filled = options.map((o) => o.text.trim()).filter(Boolean);
  const questionShort = question.trim().length < TOPIC_TITLE_MIN;
  const tooFew = filled.length < POLL_OPTIONS_MIN;
  const dupes = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (questionShort || tooFew || dupes || create.isPending) return;
    create.mutate(
      { kind: 'poll', title: question.trim(), options: filled, durationDays: days },
      {
        onSuccess: ({ topic }) => {
          toast.show({ message: 'Poll started' });
          navigate(`/talk/${topic.id}`, { replace: true });
        },
      },
    );
  };

  const err = create.error;
  const optionsServerError = err instanceof ApiError && err.field?.startsWith('options') ? err.message : null;
  const optionsError = touched && tooFew
    ? `Add at least ${POLL_OPTIONS_MIN} options.`
    : touched && dupes ? 'Each option must be different.' : optionsServerError;
  const general = formError(err, ['title', 'options', 'durationDays', 'closesAt']);

  return (
    <>
      <TopBar title="Start a poll" back />
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field
          label="Question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={TOPIC_TITLE_MAX}
          placeholder="e.g. Which area needs more vegan options?"
          error={(touched && questionShort ? `Use at least ${TOPIC_TITLE_MIN} characters for the question.` : null) ?? fieldError(err, 'title')}
          autoFocus
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-bold text-ink">Options</legend>
          {options.map((o, i) => (
            <div key={o.key} className="flex items-center gap-2">
              <Field
                label={`Option ${i + 1}`}
                hideLabel
                className="flex-1"
                value={o.text}
                maxLength={POLL_OPTION_MAX}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setOptions((list) => list.map((x) => (x.key === o.key ? { ...x, text: e.target.value } : x)))}
              />
              {options.length > POLL_OPTIONS_MIN && (
                <IconButton label={`Remove option ${i + 1}`} onClick={() => setOptions((list) => list.filter((x) => x.key !== o.key))}>
                  <X size={20} aria-hidden="true" />
                </IconButton>
              )}
            </div>
          ))}
          {options.length < POLL_OPTIONS_MAX && (
            <Button
              variant="ghost"
              size="md"
              className="self-start"
              icon={<Plus size={18} aria-hidden="true" />}
              onClick={() => setOptions((list) => [...list, { key: nextKey.current++, text: '' }])}
            >
              Add option
            </Button>
          )}
          {optionsError && <p role="alert" className="text-sm font-semibold text-danger">{optionsError}</p>}
        </fieldset>
        <div className="flex flex-col gap-2">
          <p id="poll-duration" className="text-sm font-bold text-ink">Open for</p>
          <ChipRow label="Open for">
            {DURATIONS.map((d) => (
              <Chip key={d} selected={days === d} onClick={() => setDays(d)}>{d === 1 ? '1 day' : `${d} days`}</Chip>
            ))}
          </ChipRow>
        </div>
        <StickyBar>
          {general && <p role="alert" className="text-sm font-semibold text-danger">{general}</p>}
          <Button type="submit" block busy={create.isPending} busyLabel="Posting">Post poll</Button>
        </StickyBar>
      </form>
    </>
  );
}
